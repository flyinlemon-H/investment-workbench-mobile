const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const {createQueue,projection}=require('../src/universe-auto-add.js');
const {canonicalMarketSymbol}=require('../src/symbol-identity.js');
const A='aa000000-0000-4000-8000-000000000001',B='aa000000-0000-4000-8000-000000000002';
const stock=(code,name='fixture')=>({code,name,shares:99,avgCost:88,plans:[{private:'plan'}],notes:'private'});
function environment(options={}){
 const data=options.data||new Map(),cloud=options.cloud||new Map(),requests=[];let online=true,fail=null;
 const storage={getItem:k=>data.get(k)??null,setItem:(k,v)=>data.set(k,v)};
 const queue=createQueue({storage,key:'test-queue',online:()=>online,lock:options.lock,insert:async row=>{requests.push(row);if(fail)throw fail;if(options.insert)await options.insert(row);const id=row.user_id+':'+row.symbol;if(!cloud.has(id))cloud.set(id,row)}});
 return {queue,data,cloud,requests,setOnline:value=>online=value,setFailure:value=>fail=value};
}
test('shared canonical symbol vectors and projection exclude investment fields/cash',()=>{
 for(const row of require('./fixtures/market-symbol-vectors.json'))assert.equal(canonicalMarketSymbol(row.input),row.canonical);
 assert.deepEqual(projection({stocks:[stock('600000.SH'),stock('600000.SS'),{...stock('000001.SZ'),role:'现金'}]}),[{symbol:'600000.SS',displayName:'fixture'}]);
});
test('baseline is not uploaded; only successfully observed additions use a minimal payload',async()=>{
 const e=environment();await e.queue.initialize({stocks:[stock('000001.SZ')]});await e.queue.setUser(A);await e.queue.pump();assert.equal(e.requests.length,0);
 await e.queue.committed({stocks:[stock('000001.SZ'),stock('600000.SH')]});await e.queue.pump();
 assert.deepEqual(e.requests,[{user_id:A,symbol:'600000.SS',display_name:'fixture'}]);assert.equal(e.queue.status().state,'synced');
});
test('offline pending survives reload, retry deduplicates, deletion and rename never write',async()=>{
 const e=environment();await e.queue.initialize({stocks:[]});await e.queue.setUser(A);e.setOnline(false);
 await e.queue.committed({stocks:[stock('600000.SS')]});await e.queue.pump();assert.equal(e.requests.length,0);assert.equal(e.queue.status().state,'offline');
 const next=environment({data:e.data,cloud:e.cloud});await next.queue.initialize({stocks:[stock('600000.SS')]});await next.queue.setUser(A);await next.queue.pump();
 await next.queue.committed({stocks:[stock('600000.SS','rename')]});await next.queue.committed({stocks:[]});await next.queue.pump();assert.equal(next.requests.length,1);assert.equal(next.cloud.size,1);
 await next.queue.committed({stocks:[stock('600000.SH','again')]});await next.queue.pump();assert.equal(next.requests.length,1);
});
test('timeout after server commit retries safely; Auth expiry preserves local queue',async()=>{
 const e=environment();await e.queue.initialize({stocks:[]});await e.queue.setUser(A);await e.queue.committed({stocks:[stock('600000.SS')]});
 e.cloud.set(A+':600000.SS',{});e.setFailure({status:0});await e.queue.pump();assert.equal(e.queue.status().state,'offline');
 e.setFailure({status:401});await e.queue.pump();assert.equal(e.queue.status().state,'auth_required');
 e.setFailure(null);await e.queue.pump();assert.equal(e.cloud.size,1);assert.equal(e.queue.status().pending,0);
});
test('cash exit adds, cash entry does not remove; user changes cannot move queued ownership',async()=>{
 const e=environment();await e.queue.initialize({stocks:[{...stock('600000.SS'),theme:'现金'}]});await e.queue.setUser(A);
 await e.queue.committed({stocks:[stock('600000.SS')]});await e.queue.setUser(B);await e.queue.pump();assert.equal(e.requests.length,0);
 await e.queue.setUser(A);await e.queue.pump();await e.queue.committed({stocks:[{...stock('600000.SS'),theme:'现金'}]});await e.queue.pump();assert.equal(e.requests.length,1);
});
test('crash after canonical commit but before observer completion is recovered from durable baseline',async()=>{
 const e=environment();await e.queue.initialize({stocks:[]});await e.queue.setUser(A);
 const reloaded=environment({data:e.data});await reloaded.queue.initialize({stocks:[stock('600000.SS')]});await reloaded.queue.setUser(A);await reloaded.queue.pump();assert.equal(reloaded.requests.length,1);
});
test('crash recovery retains previous owner even if another account signs in first',async()=>{
 const e=environment();await e.queue.initialize({stocks:[]});await e.queue.setUser(A);
 const reloaded=environment({data:e.data});await reloaded.queue.initialize({stocks:[stock('600487.SS')]});
 await reloaded.queue.setUser(B);await reloaded.queue.pump();assert.equal(reloaded.requests.length,0);
 await reloaded.queue.setUser(A);await reloaded.queue.pump();assert.equal(reloaded.requests[0].user_id,A);
});
test('new additions during an in-flight request are drained without another user action',async()=>{
 let release,started;const ready=new Promise(r=>started=r),pause=new Promise(r=>release=r);
 const e=environment({insert:async row=>{if(row.symbol==='600000.SS'){started();await pause}}});
 await e.queue.initialize({stocks:[]});await e.queue.setUser(A);await e.queue.committed({stocks:[stock('600000.SS')]});const pump=e.queue.pump();await ready;
 await e.queue.committed({stocks:[stock('600000.SS'),stock('000001.SZ')]});release();await pump;assert.equal(e.cloud.size,2);
});
test('two queue instances serialize local ledger changes and retain independent additions',async()=>{
 let serial=Promise.resolve();const lock=fn=>{const task=serial.then(fn);serial=task.catch(()=>{});return task};const data=new Map();
 const a=environment({data,lock}),b=environment({data,lock});await a.queue.initialize({stocks:[]});await b.queue.initialize({stocks:[]});await a.queue.setUser(A);await b.queue.setUser(A);
 await Promise.all([a.queue.committed({stocks:[stock('600000.SS')]}),b.queue.committed({stocks:[stock('000001.SZ')]})]);await a.queue.pump();assert.equal(a.cloud.size,2);
});
function storageManager(){
 let persisted=null,fail=false;const root={structuredClone,InvestmentStorage:{errors:{normalize:e=>e,create:()=>new Error('storage')},local:{create:()=>({loadMainState:()=>persisted,saveMainState:value=>{if(fail)throw new Error('disk');persisted=structuredClone(value)}})},idb:{create:()=>({open:async()=>{throw new Error('unavailable')},close(){}})},drafts:{create:()=>({initialize:async()=>{},flush:async()=>{}})}}};root.globalThis=root;
 vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../src/storage/storage-manager.js'),'utf8'),root);
 return {manager:root.StorageManager,fail:()=>fail=true};
}
test('StorageManager publishes actual coalesced committed snapshot, not rejected/intermediate candidates',async()=>{
 const {manager,fail}=storageManager(),seen=[];await manager.initialize();manager.subscribeStateCommits(value=>seen.push(value));
 const first=manager.saveState({stocks:[stock('600000.SS')]}),last=manager.saveState({stocks:[stock('000001.SZ')]});await Promise.all([first,last]);
 assert.equal(seen.length,1);assert.equal(seen[0].stocks[0].code,'000001.SZ');fail();await assert.rejects(manager.saveState({stocks:[]}));assert.equal(seen.length,1);
});
test('observer or network failure cannot reject a successful canonical save',async()=>{
 const {manager}=storageManager();await manager.initialize();manager.subscribeStateCommits(()=>{throw new Error('queue')});manager.subscribeStateCommits(()=>Promise.reject(new Error('offline')));
 await manager.saveState({stocks:[stock('600000.SS')]});assert.equal(manager.getPersistenceStatus().persistenceStatus,'saved');
});
