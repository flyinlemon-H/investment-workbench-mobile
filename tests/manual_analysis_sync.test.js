'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const Sync=require('../src/manual-analysis-sync.js');
const Contract=require('../src/long-term-logic-contract.js');
const Workflow=require('../src/long-term-logic-workflow.js');
const Adapter=require('../src/long-term-logic-sync-adapter.js');

function judgment(overrides={}){return {investmentThesis:'核心业务进入兑现期，继续观察需求、利润改善与竞争优势。',coreDrivers:['核心需求持续增长','利润率改善能够延续','竞争优势保持稳定'],keyRisks:['行业需求明显转弱','竞争加剧侵蚀利润'],reviewTriggers:['连续两个报告期利润率恶化','核心需求显著低于指引'],logicStatus:'valid',confidence:'medium',nextReviewDate:'2026-12-01',...overrides}}
function slimStock(overrides={}){return {id:'stock-1',code:'1810.HK',symbol:'1810.HK',name:'小米集团',type:'watching',plans:[],dataFreshness:{},longTermLogic:Contract.storedLogic(judgment()),...overrides}}
function legacyStock(){return {id:'stock-1',code:'1810.HK',symbol:'1810.HK',name:'小米集团',type:'watching',plans:[],dataFreshness:{},longTermLogic:{updatedAt:'2026-06-01',validUntil:'2026-12-01',investmentThesis:'旧版长期逻辑仍然可读。',coreDrivers:['旧驱动'],industryDrivers:['旧行业驱动'],companyDrivers:['旧公司驱动'],portfolioDrivers:['旧组合驱动'],fundamentalSupport:'旧基本面说明。',longTermRisks:['旧风险'],logicStatus:'valid',confidence:'medium',nextReviewDate:'2026-09-01',sourceSummary:'旧来源'}}}
function memoryTransport(){
  const rows=new Map();let writes=0;
  const key=(m,e)=>`${m}:${e}`;
  return {
    get writes(){return writes},
    async getCurrent(m,e){return structuredClone(rows.get(key(m,e))||null)},
    async listCurrent(){return [...rows.values()].map(row=>structuredClone(row))},
    async publish(input){
      const current=rows.get(key(input.moduleType,input.entityKey));
      if(current&&current.payloadHash===input.payloadHash)return {status:'no_change',module:structuredClone(current)};
      if((current&&current.revision!==input.expectedRevision)||(!current&&input.expectedRevision!==0)||(current&&current.payloadHash!==input.expectedHash))return {status:'conflict'};
      const next={moduleType:input.moduleType,entityKey:input.entityKey,moduleSchemaVersion:input.moduleSchemaVersion,revision:current?current.revision+1:1,payloadHash:input.payloadHash,publishedAt:new Date().toISOString(),payload:structuredClone(input.payload)};
      rows.set(key(input.moduleType,input.entityKey),next);writes++;return {status:'published',module:structuredClone(next)};
    },
    replace(row){rows.set(key(row.moduleType,row.entityKey),structuredClone(row))}
  };
}

test('canonical SHA-256 ignores object key order and changes with meaningful payload',async()=>{
  assert.equal(await Sync.payloadHash({b:2,a:1}),await Sync.payloadHash({a:1,b:2}));
  assert.notEqual(await Sync.payloadHash({a:1}),await Sync.payloadHash({a:2}));
});

test('cloud envelope rejects unknown top-level fields',async()=>{
  const payload=judgment(),envelope={moduleType:'long_term_logic',entityKey:'1810.HK',moduleSchemaVersion:Contract.MODULE_SCHEMA_VERSION,revision:1,payloadHash:await Sync.payloadHash(payload),publishedAt:new Date().toISOString(),payload};
  assert.equal((await Sync.validateEnvelope(envelope)).ok,true);
  assert.equal((await Sync.validateEnvelope({...envelope,deviceId:'must-not-cross-boundary'})).ok,false);
});

test('PC publish is preview-only, uses CAS revisions, and unchanged content performs zero cloud writes',async()=>{
  const transport=memoryTransport(),engine=Sync.createEngine({transport});engine.register(Adapter);let state={stocks:[slimStock()]};
  const first=await engine.preparePublish('long_term_logic','1810.HK',state);assert.equal(first.status,'preview');assert.equal(transport.writes,0);
  const published=await engine.confirmPublish(first,state);assert.equal(published.status,'published');assert.equal(published.envelope.revision,1);assert.equal(transport.writes,1);
  const same=await engine.preparePublish('long_term_logic','1810.HK',state);assert.equal(same.status,'no_change');assert.equal(same.writes,0);assert.equal(transport.writes,1);
  state=structuredClone(state);state.stocks[0].longTermLogic.investmentThesis='核心产品进入新阶段，需要继续验证利润改善。';
  const second=await engine.preparePublish('long_term_logic','1810.HK',state);assert.equal(second.expectedCloudRevision,1);assert.equal((await engine.confirmPublish(second,state)).envelope.revision,2);assert.equal(transport.writes,2);
});

test('publish preview binds the exact local payload and rejects a changed local judgment',async()=>{
  const transport=memoryTransport(),engine=Sync.createEngine({transport});engine.register(Adapter);const state={stocks:[slimStock()]},preview=await engine.preparePublish('long_term_logic','1810.HK',state);
  state.stocks[0].longTermLogic.coreDrivers[0]='预览后发生变化';const result=await engine.confirmPublish(preview,state);assert.equal(result.status,'stale_local');assert.equal(result.writes,0);assert.equal(transport.writes,0);
});

test('mobile fetch and preview do not mutate; Confirm uses canonical candidate save and records no investment sync fields',async()=>{
  const transport=memoryTransport(),publisher=Sync.createEngine({transport});publisher.register(Adapter);const pc={stocks:[slimStock()]};await publisher.confirmPublish(await publisher.preparePublish('long_term_logic','1810.HK',pc),pc);
  const deviceStorage=new Map(),metadata=Sync.createMetadataStore({storage:{getItem:key=>deviceStorage.get(key)||null,setItem:(key,value)=>deviceStorage.set(key,value)},key:'device'}),mobile=Sync.createEngine({transport,metadataStore:metadata});mobile.register(Adapter);
  let state={stocks:[legacyStock()]},before=structuredClone(state),writes=0;const fetched=await mobile.fetchUpdates(state);assert.equal(fetched.updates.length,1);assert.deepEqual(state,before);
  const preview=await mobile.prepareApply(fetched.updates[0],state);assert.equal(preview.status,'preview');assert.deepEqual(state,before);
  const applied=await mobile.confirmApply(preview,state,{saveCandidate:async candidate=>{writes++;return candidate},adoptCandidate:candidate=>{state=candidate}});assert.equal(applied.status,'applied');assert.equal(writes,1);assert.equal(state.stocks[0].longTermLogic.schemaVersion,Contract.MODULE_SCHEMA_VERSION);assert.equal(Object.hasOwn(state.stocks[0].longTermLogic,'lastAppliedRevision'),false);assert.equal(Object.hasOwn(state,'manualAnalysisSync'),false);assert.equal(metadata.applied('long_term_logic','1810.HK').revision,1);
});

test('mobile apply fails closed on storage failure and on a cloud revision changed after Preview',async()=>{
  const transport=memoryTransport(),engine=Sync.createEngine({transport});engine.register(Adapter);const pc={stocks:[slimStock()]};await engine.confirmPublish(await engine.preparePublish('long_term_logic','1810.HK',pc),pc);
  const local={stocks:[legacyStock()]},preview=await engine.prepareApply((await engine.fetchUpdates(local)).updates[0],local),before=structuredClone(local);
  const failed=await engine.confirmApply(preview,local,{saveCandidate:async()=>{throw new Error('injected')}});assert.equal(failed.status,'failed');assert.equal(failed.writes,0);assert.deepEqual(local,before);
  pc.stocks[0].longTermLogic.investmentThesis='云端在手机确认前又更新。';await engine.confirmPublish(await engine.preparePublish('long_term_logic','1810.HK',pc),pc);
  const stale=await engine.confirmApply(preview,local,{saveCandidate:async()=>{throw new Error('must not write')}});assert.equal(stale.status,'stale_cloud');assert.equal(stale.writes,0);
});

test('device receipt failure never rolls back or falsely fails a completed canonical save',async()=>{
  const transport=memoryTransport(),publisher=Sync.createEngine({transport});publisher.register(Adapter);const pc={stocks:[slimStock()]};await publisher.confirmPublish(await publisher.preparePublish('long_term_logic','1810.HK',pc),pc);
  const metadata=Sync.createMetadataStore({storage:{getItem:()=>null,setItem:()=>{throw new Error('quota')}},key:'receipt'}),mobile=Sync.createEngine({transport,metadataStore:metadata});mobile.register(Adapter);let state={stocks:[legacyStock()]};
  const update=(await mobile.fetchUpdates(state)).updates[0],preview=await mobile.prepareApply(update,state),result=await mobile.confirmApply(preview,state,{saveCandidate:async candidate=>candidate,adoptCandidate:candidate=>{state=candidate}});
  assert.equal(result.status,'applied');assert.equal(result.metadataRecorded,false);assert.equal(state.stocks[0].longTermLogic.schemaVersion,Contract.MODULE_SCHEMA_VERSION);
});

test('Long-Term adapter is an explicit module-only allowlist and generic engine accepts a fake test adapter',async()=>{
  const payload=Adapter.serialize({stocks:[slimStock({shares:99,plans:[{id:'secret'}],currentState:{secret:true}})]},'1810.HK');assert.deepEqual(Object.keys(payload),Adapter.PAYLOAD_FIELDS);assert.equal(JSON.stringify(payload).includes('shares'),false);assert.equal(JSON.stringify(payload).includes('plans'),false);assert.equal(JSON.stringify(payload).includes('currentState'),false);
  const fake={moduleType:'fake_module',moduleSchemaVersion:'fake-module.v1',serialize:()=>({value:'ok'}),validate:value=>({ok:value&&value.value==='ok',payload:value}),diff:()=>[],buildCandidate:state=>state,renderLabel:()=> '测试模块'};
  const engine=Sync.createEngine({transport:memoryTransport()});engine.register(fake);assert.equal((await engine.preparePublish('fake_module','ENTITY_1',{})).status,'preview');assert.equal((await engine.preparePublish('unknown_module','ENTITY_1',{})).status,'unsupported');
});

test('mandatory backup-to-PC acceptance stays local-first until explicit Sync Preview and Confirm',async()=>{
  const mobileBackup=JSON.stringify({stocks:[legacyStock()]});let pcState=JSON.parse(mobileBackup);assert.equal(pcState.stocks[0].longTermLogic.industryDrivers[0],'旧行业驱动');
  const prepared=Workflow.prepare(pcState.stocks[0],{promptDate:'2026-09-04'}),result=Workflow.processPrepared(JSON.stringify({binding:{symbol:prepared.context.symbol,contextHash:prepared.context.contextHash},longTermLogic:judgment()}),prepared),transport=memoryTransport();
  const committed=await Contract.commit(result,pcState,{saveCandidate:async candidate=>candidate,adoptCandidate:candidate=>{pcState=candidate}},{context:prepared.context,transport:{kind:'api'}});assert.equal(committed.status,'completed');assert.equal(pcState.stocks[0].longTermLogic.schemaVersion,Contract.MODULE_SCHEMA_VERSION);assert.equal(transport.writes,0);
  const engine=Sync.createEngine({transport});engine.register(Adapter);const preview=await engine.preparePublish('long_term_logic','1810.HK',pcState);assert.equal(preview.status,'preview');assert.equal(transport.writes,0);await engine.confirmPublish(preview,pcState);assert.equal(transport.writes,1);
});

test('legacy and Slim backups load together without silently consolidating legacy driver sections',()=>{
  const context={console};context.globalThis=context;context.window=context;vm.createContext(context);vm.runInContext(fs.readFileSync(path.join(__dirname,'..','src','state.js'),'utf8'),context);
  context.legacy=legacyStock();context.slim=slimStock();
  const values=JSON.parse(vm.runInContext('JSON.stringify([normalizeLongTermLogic(legacy.longTermLogic,legacy),normalizeLongTermLogic(slim.longTermLogic,slim)])',context));
  assert.deepEqual(values[0].coreDrivers,['旧驱动']);assert.deepEqual(values[0].industryDrivers,['旧行业驱动']);assert.deepEqual(values[0].companyDrivers,['旧公司驱动']);assert.deepEqual(values[0].portfolioDrivers,['旧组合驱动']);assert.equal(values[0].fundamentalSupport,'旧基本面说明。');assert.equal(values[0].schemaVersion,undefined);
  assert.deepEqual(values[1],slimStock().longTermLogic);assert.equal(Object.hasOwn(values[1],'fundamentalSupport'),false);
});

test('migration keeps analysis snapshots private, owner-bound, atomic, and independent of PC Reader',()=>{
  const sql=fs.readFileSync(path.join(__dirname,'..','supabase','migrations','20260904105937_manual_analysis_sync_v1.sql'),'utf8');
  assert.match(sql,/analysis_private\.analysis_sync_modules/);assert.match(sql,/enable row level security/);assert.match(sql,/auth\.uid\(\)/);assert.match(sql,/pg_advisory_xact_lock/);assert.match(sql,/payload_hash=p_payload_hash/);assert.match(sql,/ANALYSIS_PAYLOAD_INVALID/);assert.match(sql,/revoke all on analysis_private\.analysis_sync_modules from public,anon,authenticated/i);assert.doesNotMatch(sql,/stock_universe_reader|service_role|publisher_device|device_attestation/i);
});

test('mobile UI persists a detached candidate before adopting it as live state',()=>{
  const source=fs.readFileSync(path.join(__dirname,'..','src','manual-analysis-sync-ui.js'),'utf8');
  assert.match(source,/saveCandidate:async candidate=>\{const validated=createValidatedCandidateSnapshot\(candidate,\{touchUpdatedAt:false\}\);await persistCandidateSnapshot\(validated\);return \{state:validated\}\}/);
  assert.doesNotMatch(source,/confirmApply\([^\n]+saveCandidate:candidate=>saveState/);
});
