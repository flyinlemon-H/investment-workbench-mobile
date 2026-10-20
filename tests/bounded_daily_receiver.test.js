'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),{setup,OWNER,OTHER}=require('./helpers/bounded-db.cjs');
const D=require('../src/market-data-daily-receiver.js'),K=require('../src/market-data-canonical.js');
test('trusted receiver local CAS, fake receipt, protection, persistence and recovery',async t=>{
 const h=await setup();try{
  const token='c'.repeat(64);await h.account('register_worker',{token});const task=await h.account('request',{symbol:'2899.HK',taskType:'UPDATE_DAILY_MARKET_DATA'});await h.worker(token,'claim',{});
  const p=structuredClone(h.f.submission);p.taskId=task.taskId;p.expectedVersion=h.baseline.versionId;p.bundle.marketDataFreshness.resultVersion=p.taskId;p.bundleHash=await K.factsHash(p.bundle);
  await h.daily(token,'finish',p);const remote=await h.read();
  function fixture(options={}){
   let owner=OWNER,state={stocks:[{code:'2899.HK',shares:123,plans:[{id:'existing-plan'}],discussionState:{history:['unchanged']},marketMigration:{id:'original-rebase-unchanged'},...structuredClone(h.f.baseline.bundle)},...Array.from({length:22},(_,i)=>({code:(1000+i)+'.HK',protected:true}))],orders:[{id:'existing-order'}],updatedAt:1},stored=null;
   const getState=()=>state;
   const client=D.create({rpc:options.rpc||(()=>Promise.resolve(remote)),user:async()=>owner,getState,
    persist:options.persist|| (async next=>{stored=structuredClone(next)}),adopt:next=>{state=next}});
   return {client,getState,getStored:()=>stored,setOwner:v=>{owner=v}};
  }
  await t.test('preserves protected business and original migration; verifies backup hash',async()=>{
   const f=fixture(),before=structuredClone(f.getState());await f.client.sync('2899.HK');const after=f.getState();
   assert.equal(after.stocks[0].priceHistory.length,436);assert.deepEqual(after.stocks.slice(1),before.stocks.slice(1));
   for(const key of ['shares','plans','discussionState','marketMigration'])assert.deepEqual(after.stocks[0][key],before.stocks[0][key]);assert.deepEqual(after.orders,before.orders);
   assert.equal(await K.factsHash(after.stocks[0].marketDailyReceipt.previousLocalSnapshot),after.stocks[0].marketDailyReceipt.previousLocalHash);
   assert.deepEqual(f.getStored(),after);await f.client.sync('2899.HK');assert.deepEqual(f.getState(),after);
  });
  await t.test('unsynced business edit during RPC is retained',async()=>{
   let f;f=fixture({rpc:async()=>{f.getState().stocks[0].plans.push({id:'new-unsynced-plan'});return remote}});
   await f.client.sync('2899.HK');assert.equal(f.getState().stocks[0].plans.at(-1).id,'new-unsynced-plan');
  });
  await t.test('market history or technical local edits are never overwritten',async()=>{
   for(const change of [s=>s.priceHistory[0].close+=.1,s=>s.technicalData.ma5+=1]){const f=fixture();change(f.getState().stocks[0]);const before=structuredClone(f.getState());await assert.rejects(f.client.sync('2899.HK'),/daily_local_version_conflict/);assert.deepEqual(f.getState(),before);assert.equal(f.getStored(),null)}
  });
  await t.test('wrong owner and forged canonical hash fail before persistence',async()=>{
   for(const change of [c=>c.owner=OTHER,c=>c.bundleHash='0'.repeat(64),c=>c.bundle.technicalData.macd.dif+=1]){const c=structuredClone(remote);change(c);const f=fixture({rpc:async()=>c});await assert.rejects(f.client.sync('2899.HK'));assert.equal(f.getStored(),null)}
  });
  await t.test('critical persistence failure does not adopt partial facts',async()=>{
   const f=fixture({persist:async()=>{throw Error('storage_failure')}}),before=structuredClone(f.getState());await assert.rejects(f.client.sync('2899.HK'),/storage_failure/);assert.deepEqual(f.getState(),before);
  });
  await t.test('restore receipt receives all old facts without reapplying old daily result',async()=>{
   let current=remote;const f=fixture({rpc:async()=>current});await f.client.sync('2899.HK');
   await h.db.query('select market_private.daily_restore($1,$2,$3,$4)',[OWNER,remote.versionId,h.baseline.versionId,'isolated browser recovery']);current=await h.read();await f.client.sync('2899.HK');
   assert.deepEqual(D.facts(f.getState().stocks[0]),h.f.baseline.bundle);assert.equal(f.getState().stocks[0].marketDailyReceipt.generation,2);
  });
 }finally{await h.db.close()}
});
