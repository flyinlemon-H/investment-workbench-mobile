'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {setup,OWNER,OTHER}=require('./helpers/bounded-db.cjs');
const crypto=require('node:crypto'),K=require('../src/market-data-canonical.js');
const copy=x=>structuredClone(x);
async function running(h){const token=crypto.randomBytes(32).toString('hex');await h.account('register_worker',{token});
 const task=await h.account('request',{symbol:'2899.HK',taskType:'UPDATE_DAILY_MARKET_DATA'});await h.worker(token,'claim',{});
 const current=await h.daily(token,'current',{symbol:'2899.HK'});const p=copy(h.f.submission);
 p.taskId=task.taskId;p.expectedVersion=current.versionId;p.expectedGeneration=current.generation;p.expectedHash=current.bundleHash;
 p.bundle.marketDataFreshness.resultVersion=task.taskId;p.bundleHash=await K.factsHash(p.bundle);return{token,task,p,current}}
test('real archived A→C independently parsed, computed and atomically published by SQL',async()=>{
 const h=await setup();try{
  const preview=(await h.db.query('select market_private.daily_technical($1) as v',[h.f.submission.bundle.priceHistory])).rows[0].v;
  assert.deepEqual(preview,h.f.preview);
  const check=(await h.db.query('select market_private.daily_check($1,$2,$3) as v',[h.f.baseline.bundle,h.f.observations.A,h.f.submission])).rows[0].v;
  assert.equal(check.tier,'AUDITED_REVISION');assert.equal(check.changedDates,140);assert.equal(check.maxPriceDelta,.000004);
  const token='e'.repeat(64);await h.account('register_worker',{token});
  const requested=await h.account('request',{symbol:'2899.HK',taskType:'UPDATE_DAILY_MARKET_DATA'});
  await h.worker(token,'claim',{});
  const p=structuredClone(h.f.submission);p.taskId=requested.taskId;p.expectedVersion=h.baseline.versionId;
  p.bundle.marketDataFreshness.resultVersion=p.taskId;
  const K=require('../src/market-data-canonical.js');p.bundleHash=await K.factsHash(p.bundle);
  const result=await h.daily(token,'finish',p);assert.equal(result.status,'succeeded');
  const current=await h.read();assert.equal(current.generation,1);assert.equal(current.bundle.priceHistory.length,436);
  assert.equal(current.bundle.priceHistory.at(-1).date,'2026-10-16');assert.equal(current.previousId,h.baseline.versionId);
  assert.equal(current.observation,undefined);assert.equal(current.receipt.observations,undefined);
  assert.equal(await h.read(OTHER),null);
  assert.equal((await h.daily(token,'finish',p)).dailyVersion,result.dailyVersion);
  await h.account('revoke_worker',{});
  await assert.rejects(h.daily(token,'finish',p),/worker_unauthorized/);
 }finally{await h.db.close()}
});

test('policy rejection matrix never mutates the current version',async t=>{
 const h=await setup();try{
  const original=copy(h.f.submission),base=h.f.baseline.bundle,old=h.f.observations.A;
  const check=p=>h.db.query('select market_private.daily_check($1,$2,$3) as v',[base,old,p]);
  const cases=[
   ['policy allowlist',p=>p.policyVersion='self-approved','DAILY_PROTOCOL_MISMATCH'],
   ['command is not a task parameter',p=>p.command='do-not-run','DAILY_PROTOCOL_MISMATCH'],
   ['output content tamper',p=>p.bundle.priceHistory[0].close+=.01,'DAILY_FACTS_MISMATCH'],
   ['technical tamper',p=>p.bundle.technicalData.ma5+=.01,'DAILY_FACTS_MISMATCH'],
   ['AI judgment cannot become current',p=>p.bundle.technicalData.aiJudgmentStatus='current','DAILY_FACTS_MISMATCH'],
   ['raw hash mismatch',p=>p.observation.rawHash='a'.repeat(64),'RAW_PROVENANCE_REQUIRED'],
   ['repeat must be independent',p=>p.repeat=copy(p.observation),'REPEAT_OBSERVATION_REQUIRED'],
   ['future observation',p=>p.repeat.asOf='2099-01-01T00:00:00Z',null],
  ];
  function rawChange(p,mutate){for(const key of ['observation','repeat']){const data=JSON.parse(p[key].raw);mutate(data.chart.result[0]);p[key].raw=JSON.stringify(data);p[key].rawHash=crypto.createHash('sha256').update(p[key].raw).digest('hex')}}
  cases.push(
   ['wrong raw symbol',p=>rawChange(p,r=>r.meta.symbol='0005.HK'),'RAW_SYMBOL_MISMATCH'],
   ['currency',p=>rawChange(p,r=>r.meta.currency='USD'),'RAW_SYMBOL_MISMATCH'],
   ['raw quote change',p=>rawChange(p,r=>r.indicators.quote[0].open[0]+=.01),'RAW_QUOTE_CHANGED'],
   ['volume change',p=>rawChange(p,r=>r.indicators.quote[0].volume[0]+=1),'RAW_QUOTE_CHANGED'],
   ['large adjclose revision',p=>rawChange(p,r=>r.indicators.adjclose[0].adjclose[0]+=1),null],
   ['duplicate historical date',p=>rawChange(p,r=>r.timestamp[1]=r.timestamp[0]),'INVALID_HISTORY'],
   ['missing adjustment',p=>rawChange(p,r=>r.indicators.adjclose[0].adjclose[0]=null),'INVALID_HISTORY'],
   ['unstable repeat',p=>{const q=copy(p);rawChange(q,r=>r.indicators.adjclose[0].adjclose[0]+=.01);p.repeat=q.repeat},'RAW_OUTPUT_MISMATCH']
  );
  for(const[name,mutate,error]of cases)await t.test(name,async()=>{const p=copy(original);mutate(p);await assert.rejects(check(p),error?new RegExp(error):undefined)});
  assert.equal((await h.read()).versionId,h.baseline.versionId);
 }finally{await h.db.close()}
});

test('authorization, CAS, failure injection, immutable audit and complete restore',async t=>{
 const h=await setup();try{
  const {token,task,p,current}=await running(h);
  const counts=async()=>(await h.db.query('select (select count(*) from market_private.daily_versions)::int versions,(select count(*) from market_private.results)::int results,(select generation from market_private.daily_heads where owner=$1) generation',[OWNER])).rows[0];
  const before=await counts();const rebaseBefore=(await h.db.query('select row_to_json(h) v from market_private.migration_heads h')).rows;
  await t.test('anon cannot read; authenticated cannot submit or bootstrap',async()=>{
   await assert.rejects(h.rawrpc('market_data_daily_current',['2899.HK']),/permission denied/);
   await assert.rejects(h.rawrpc('market_data_daily_worker',[token,'finish',p],'authenticated',OWNER),/permission denied/);
   for(const role of ['anon','authenticated','service_role']){
    for(const sql of ['select * from market_private.daily_versions','update market_private.daily_heads set enabled=true',"select market_private.daily_restore(null,null,null,'not permitted')"]){
     await assert.rejects(h.db.transaction(async tx=>{await tx.exec('set local role '+role);await tx.exec(sql)}),/permission denied/);
    }
   }
  });
  await t.test('outsider and invalid capability',async()=>{
   assert.equal(await h.read(OTHER),null);await assert.rejects(h.daily('f'.repeat(64),'finish',p),/worker_unauthorized/);
   const other='b'.repeat(64);await h.account('register_worker',{token:other},OTHER);
   assert.equal(await h.daily(other,'current',{symbol:'2899.HK'}),null);
   await assert.rejects(h.daily(other,'finish',p),/task_not_owned/);
  });
  await t.test('CAS/generation/hash and policy disabled',async()=>{
   for(const[k,v]of [['expectedGeneration',99],['expectedVersion',OTHER],['expectedHash','a'.repeat(64)]])await assert.rejects(h.daily(token,'finish',{...p,[k]:v}),/VERSION_CONFLICT/);
   await h.db.exec('update market_private.daily_heads set enabled=false');await assert.rejects(h.daily(token,'finish',p),/DAILY_POLICY_DISABLED/);await h.db.exec('update market_private.daily_heads set enabled=true');
  });
  await t.test('failure after version insert rolls back every effect',async()=>{
   await h.db.exec("create function public.inject_daily_failure() returns trigger language plpgsql as $$begin raise exception 'injected_atomic_failure';end$$;create trigger inject_daily_failure after insert on market_private.results for each row execute function public.inject_daily_failure()");
   await assert.rejects(h.daily(token,'finish',p),/injected_atomic_failure/);assert.deepEqual(await counts(),before);
   assert.equal((await h.account('read',{taskId:task.taskId})).status,'running');
   await h.db.exec('drop trigger inject_daily_failure on market_private.results;drop function public.inject_daily_failure()');
  });
  await t.test('old finish cannot bypass trusted submit',async()=>{
   const b=p.bundle,r={schemaVersion:1,taskId:p.taskId,resultVersion:p.taskId,symbol:'2899.HK',provider:'yahoo',requestedAt:task.requestedAt,completedAt:new Date().toISOString(),latestCompleteBar:b.priceHistory.at(-1).date,technicalAsOf:b.priceHistory.at(-1).date,dataUpdated:true,warnings:[],fingerprint:'a'.repeat(64),stock:{symbol:'2899.HK',priceHistory:b.priceHistory,marketDataFreshness:b.marketDataFreshness,technicalIndicators:{...b.technicalIndicators,technicalSnapshot:b.technicalData}}};
   await assert.rejects(h.worker(token,'finish',{taskId:task.taskId,result:r}),/DAILY_TRUSTED_RECEIPT_REQUIRED/);assert.deepEqual(await counts(),before);
  });
  const result=await h.daily(token,'finish',p);const after=await h.read();
  await t.test('idempotence binds the whole submission and immutable audit',async()=>{
   assert.equal((await h.daily(token,'finish',p)).dailyVersion,result.dailyVersion);
   await assert.rejects(h.daily(token,'finish',{...p,policyVersion:'changed'}),/DUPLICATE_SUBMISSION_MISMATCH/);
   await assert.rejects(h.db.exec("update market_private.daily_versions set receipt='{}'"),/immutable_migration/);
   await assert.rejects(h.db.exec('delete from market_private.daily_versions'),/immutable_migration/);
  });
  await t.test('restore is full facts, new generation, disabled; old Rebase pointers unchanged',async()=>{
   const restored=(await h.db.query('select market_private.daily_restore($1,$2,$3,$4) v',[OWNER,after.versionId,current.versionId,'isolated recovery acceptance'])).rows[0].v;
   assert.equal(restored.generation,2);assert.equal(restored.enabled,false);assert.deepEqual(restored.bundle,current.bundle);assert.equal(restored.bundleHash,current.bundleHash);
   assert.equal(restored.previousId,after.versionId);assert.equal((await counts()).versions,3);
   assert.deepEqual((await h.db.query('select row_to_json(h) v from market_private.migration_heads h')).rows,rebaseBefore);
  });
 }finally{await h.db.close()}
});

test('pure append 430→436 retains all prior facts and uses NORMAL_UPDATE',async()=>{
 const h=await setup(true);try{const {token,p}=await running(h);await h.daily(token,'finish',p);const c=await h.read();
  assert.equal(c.receipt.tier,'NORMAL_UPDATE');assert.equal(c.receipt.changedDates,0);assert.equal(c.bundle.priceHistory.length,436);
  assert.deepEqual(c.bundle.priceHistory.slice(0,430),h.f.baseline.bundle.priceHistory);
 }finally{await h.db.close()}
});

test('independent SQL numerical and discrete boundaries reject adversarial raw evidence',async t=>{
 const h=await setup();try{
  function shifted(value,steps){const b=Buffer.alloc(4);b.writeFloatBE(value);b.writeUInt32BE(b.readUInt32BE()+steps);return b.readFloatBE()}
  function observed(raw,source){const text=JSON.stringify(raw);return {...source,raw:text,rawHash:crypto.createHash('sha256').update(text).digest('hex')}}
  const originalA=JSON.parse(h.f.observations.A.raw),originalB=JSON.parse(h.f.observations.B.raw);
  async function rejectChanged(mutator,expected){const p=copy(h.f.submission);for(const key of ['observation','repeat']){const raw=JSON.parse(p[key].raw);mutator(raw.chart.result[0]);p[key]=observed(raw,p[key])}await assert.rejects(h.db.query('select market_private.daily_check($1,$2,$3)',[h.f.baseline.bundle,h.f.observations.A,p]),new RegExp(expected))}
  await t.test('exactly representable three ULPs are still rejected',()=>rejectChanged(r=>r.indicators.adjclose[0].adjclose[0]=shifted(originalA.chart.result[0].indicators.adjclose[0].adjclose[0],3),'ADJCLOSE_STEP_EXCEEDED'));
  await t.test('141 changed historical days are rejected',async()=>{
   const aa=originalA.chart.result[0].indicators.adjclose[0].adjclose,bb=originalB.chart.result[0].indicators.adjclose[0].adjclose;
   const i=aa.findIndex((a,i)=>a===bb[i]&&a<20);assert(i>=0);
   await rejectChanged(r=>r.indicators.adjclose[0].adjclose[i]=shifted(aa[i],1),'UNCALIBRATED_REVISION_RANGE');
  });
  await t.test('a tiny revision crossing a discrete technical boundary is rejected',async()=>{
   const raw=copy(originalA),r=raw.chart.result[0];r.timestamp=r.timestamp.slice(0,430);
   for(const key of Object.keys(r.indicators.quote[0]))r.indicators.quote[0][key]=Array(430).fill(key==='volume'?1000:key==='high'?21:key==='low'?19:20);
   r.indicators.adjclose[0].adjclose=Array(430).fill(20);
   const old=observed(raw,h.f.observations.A),base=copy(h.f.baseline.bundle);
   base.priceHistory=(await h.db.query('select market_private.daily_raw($1) v',[old])).rows[0].v.bars;
   r.indicators.adjclose[0].adjclose[0]=shifted(20,1);const p=copy(h.f.submission);p.observation=observed(raw,p.observation);p.repeat=observed(raw,p.repeat);
   await assert.rejects(h.db.query('select market_private.daily_check($1,$2,$3)',[base,old,p]),/TECHNICAL_DECISION_BOUNDARY_CHANGED/);
  });
  await t.test('binary64 round-half-even matches Python golden cases',async()=>{
   for(const[x,n,y]of [[2.675,2,2.67],[1.005,2,1],[.0000005,6,0],[.0000015,6,.000002],[-2.675,2,-2.67]])assert.equal(Number((await h.db.query('select market_private.daily_round($1,$2) v',[x,n])).rows[0].v),y);
  });
 }finally{await h.db.close()}
});
