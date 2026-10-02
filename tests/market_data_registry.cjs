'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const {createDatabase,OWNER,OTHER}=require('./helpers/market-db.cjs');
const C=require('../src/market-data-orchestrator');
const {resultFor}=require('./helpers/market-fixture.cjs');
test('real Postgres migration enforces lifecycle, ownership, capabilities and immutable delivery',async t=>{
 const api=await createDatabase(),token=crypto.randomBytes(32).toString('hex'),otherToken=crypto.randomBytes(32).toString('hex');
 try{
 await assert.rejects(api.rpc('anon',null,'account',['request',C.request('601869.SS')]),/permission denied/);
 await assert.rejects(api.account('request',C.request('601869.SS'),null),/authentication_required/);
 for(const input of [{symbol:'../cmd',taskType:C.TYPE},{symbol:'601869.SS',taskType:'SHELL'},{...C.request('601869.SS'),command:'calc'},{...C.request('601869.SS'),path:'C:/secret'},{...C.request('601869.SS'),url:'https://evil'}])await assert.rejects(api.account('request',input));
 const auth=await api.account('register_worker',{token});await api.account('register_worker',{token:otherToken},OTHER);
 const task=await api.account('request',C.request('601869.SS'));
 assert.equal(task.status,'queued');assert.equal(C.presentation(task),'等待执行端');
 const duplicates=await Promise.all(Array.from({length:8},()=>api.account('request',C.request(task.symbol))));assert(duplicates.every(t=>t.taskId===task.taskId));
 assert.equal(await api.account('read',{taskId:task.taskId},OTHER),null);
 await assert.rejects(api.worker('0'.repeat(64),'claim',{}),/unauthorized/);
 const claimed=await api.worker(token,'claim',{});assert.equal(claimed.status,'running');assert.equal(claimed.workerId,auth.workerId);assert.equal(await api.worker(token,'claim',{}),null);
 await assert.rejects(api.worker(otherToken,'finish',{taskId:task.taskId,error:'injected'}),/task_not_owned/);
 const result=resultFor(task);const bad=structuredClone(result);bad.stock.priceHistory[0].is_complete_bar=false;
 await assert.rejects(api.worker(token,'finish',{taskId:task.taskId,result:bad}),/invalid_bar/);
 assert.equal((await api.account('read',{taskId:task.taskId})).status,'running');
 const done=await api.worker(token,'finish',{taskId:task.taskId,result});assert.equal(done.status,'succeeded');assert.equal(done.resultVersion,task.taskId);
 assert.deepEqual(await api.worker(token,'finish',{taskId:task.taskId,error:'late error'}),done);
 const delivered=await api.account('read',{taskId:task.taskId});assert.equal(delivered.result.resultVersion,done.resultVersion);
 const next=await api.account('request',C.request(task.symbol));assert.notEqual(next.taskId,task.taskId);
 const nextClaim=await api.worker(token,'claim',{});assert.equal(nextClaim.previousResult.taskId,task.taskId);
 await api.worker(token,'finish',{taskId:next.taskId,error:'provider_or_pipeline_failure'});
 assert.deepEqual((await api.account('read',{taskId:task.taskId})).result,delivered.result);
 const retry=await api.account('request',C.request(task.symbol));await api.worker(token,'claim',{});
 await api.db.query("update market_private.tasks set lease_until=now()-interval '1 minute' where id=$1",[retry.taskId]);
 assert.equal((await api.account('read',{taskId:retry.taskId})).error,'worker_lease_expired');
 assert.equal((await api.worker(token,'finish',{taskId:retry.taskId,result:resultFor(retry)})).status,'failed');
 const all=await api.db.query('select count(*)::int as n from market_private.results');assert.equal(all.rows[0].n,1);
 await api.account('revoke_worker',{});await assert.rejects(api.worker(token,'claim',{}),/unauthorized/);
 for(const role of ['anon','authenticated'])await assert.rejects(api.db.transaction(async tx=>{await tx.exec(`set local role ${role}`);return tx.query('select * from market_private.tasks')}),/permission denied/);
 }finally{await api.db.close()}
});
