'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const M=require('../src/market-data-orchestrator'),Fresh=require('../src/technical-freshness'),Ux=require('../src/technical-view-ux'),R=require('../src/discussion-data-readiness'),D=require('../src/discussion-workbench');
const {resultFor}=require('./helpers/market-fixture.cjs');
const fixture=()=>({taskId:'11111111-1111-4111-8111-111111111111',requestedBy:'owner',symbol:'601869.SS',taskType:M.TYPE,status:'queued',requestedAt:'2026-10-01T08:00:00Z'});
test('browser queues, reuses inflight requests, waits for worker and applies exact succeeded version',async()=>{
 let task=fixture(),calls=0,applied=0;const c=M.createClient({user:async()=> 'owner',rpc:async()=>{calls++;await new Promise(r=>setTimeout(r,2));return structuredClone(task)},apply:async(s,r)=>{applied++;assert.equal(r.resultVersion,task.taskId)}});
 await Promise.all([c.sync(task.symbol,true),c.sync(task.symbol,true)]);assert.equal(calls,1);assert.equal(M.presentation(c.view('owner',task.symbol).task),'等待执行端');assert.equal(applied,0);
 task.status='running';await c.sync(task.symbol);assert.equal(M.presentation(task),'正在更新行情');
 task={...task,status:'succeeded',resultVersion:task.taskId,result:resultFor(task)};await c.sync(task.symbol);assert.equal(applied,1);assert.match(M.presentation(task,true),/行情已更新至 2026-09-30/);
});
test('failed or invalid delivery never applies facts and retry creates another request',async()=>{
 let task={...fixture(),status:'failed',error:'provider_failure'},applied=0,calls=0;
 const c=M.createClient({user:async()=> 'owner',rpc:async()=>{calls++;return task},apply:async()=>applied++});
 await c.sync(task.symbol);assert.equal(applied,0);await c.sync(task.symbol,true);assert.equal(calls,2);
 task={...task,status:'succeeded',resultVersion:task.taskId,result:resultFor(task)};task.result.symbol='000001.SZ';await assert.rejects(c.sync(task.symbol),/identity/);assert.equal(applied,0);
});
test('explicit update survives an in-flight status read, with duplicate clicks coalesced',async()=>{
 let release,started;const reading=new Promise(r=>started=r),gate=new Promise(r=>release=r),calls=[];
 const c=M.createClient({user:async()=> 'owner',rpc:async action=>{calls.push(action);if(action==='read'){started();await gate;return null}return fixture()},apply:async()=>{}});
 const read=c.sync('601869.SS');await reading;
 const first=c.sync('601869.SS',true),second=c.sync('601869.SS',true);release();
 await Promise.all([read,first,second]);assert.deepEqual(calls,['read','request']);assert.equal(c.view('owner','601869.SS').task.status,'queued');
});
test('storage failures and account changes cannot acknowledge delivery',async()=>{
 let task={...fixture(),status:'succeeded',resultVersion:fixture().taskId};task.result=resultFor(task);let owner='owner';
 const c=M.createClient({user:async()=>owner,rpc:async()=>task,apply:async()=>{throw Error('disk_full')}});await assert.rejects(c.sync(task.symbol),/disk_full/);assert.equal(c.view(owner,task.symbol).applied,undefined);
 const switched=M.createClient({user:async()=>owner,rpc:async()=>{owner='other';return task},apply:async()=>{throw Error('must not apply')}});await assert.rejects(switched.sync(task.symbol),/account_changed/);
});
test('audit regression: page and discussion agree on stale despite persisted current flags',()=>{
 const task=fixture(),result=resultFor(task,'2026-09-01');const stock={...result.stock,code:task.symbol,shares:0,technicalData:{technicalAsOf:'2026-09-01',latestCompleteBar:'2026-09-01',technicalDataStatus:'fresh',price:11}};
 const opts={now:'2026-10-01T08:00:00Z',reviewDate:'2026-10-01'};
 assert.equal(Fresh.evaluateTechnicalFreshness(stock,opts).status,'stale');assert.equal(Ux.canonicalTechnicalDate({...stock,referenceDate:opts.reviewDate}).stale,true);assert.equal(R.technical(stock,opts).ready,false);assert.equal(D.buildContext(stock,opts).context.currentFacts.technical.dataStatus,'stale');
});
test('current result binds the same version to Discussion; failures remain limited',()=>{
 const task=fixture(),result=resultFor(task);const stock={...result.stock,code:task.symbol,shares:0,technicalData:{technicalAsOf:result.technicalAsOf,latestCompleteBar:result.latestCompleteBar,technicalDataStatus:'fresh',price:11}};stock.marketDataFreshness.resultVersion=task.taskId;
 const opts={now:'2026-10-01T08:00:00Z'};assert.equal(R.technical(stock,opts).ready,true);assert.equal(Ux.canonicalTechnicalDate({...stock,referenceDate:opts.now}).fresh,true);assert.equal(D.buildContext(stock,opts).context.currentFacts.technical.resultVersion,task.taskId);
 stock.marketDataFreshness.kline_status='failed';assert.equal(R.technical(stock,opts).ready,false);assert.equal(Ux.canonicalTechnicalDate({...stock,referenceDate:opts.now}).fresh,false);
});
test('UI boundary rejects injection and incomplete delivery',()=>{
 for(const s of ['../x','601869.SS;cmd','https://evil','600000'])assert.throws(()=>M.request(s));
 const task={...fixture(),status:'succeeded',resultVersion:fixture().taskId},r=resultFor(task);r.stock.priceHistory[0].is_complete_bar=false;assert.throws(()=>M.validateResult(task,r));
});
