'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const root=path.resolve(__dirname,'..');
const source=file=>fs.readFileSync(path.join(root,file),'utf8');
const MAIN='portfolio_manual_v502_network_price_20260610';
const PLAN_DRAFTS='v13_plan_update_drafts_v1';
const OPERATION_DRAFTS='v13_operation_entry_drafts_v1';

function sharedStore(){
  let tail=Promise.resolve();
  return {
    raw:new Map(),records:{meta:[],portfolio_state:[],drafts:[],migration:[]},
    writes:0,attempts:0,idbWrites:0,failWrite:false,failRead:false,
    locks:{request(_name,options,operation){
      assert.equal(options.mode,'exclusive');
      const result=tail.then(operation);tail=result.catch(()=>{});return result;
    }}
  };
}

async function tab(shared=sharedStore()){
  const context={console,TextEncoder,Uint8Array,ArrayBuffer,Date,AbortController,setTimeout,clearTimeout};
  context.window=context;context.globalThis=context;
  vm.createContext(context);
  vm.runInContext('globalThis.structuredClone=value=>JSON.parse(JSON.stringify(value));',context);
  context.localStorage={
    getItem:key=>shared.raw.has(key)?shared.raw.get(key):null,
    setItem(key,value){shared.attempts++;if(shared.failWrite)throw new Error('simulated atomic setItem failure');shared.raw.set(key,value);shared.writes++;},
    removeItem(){throw new Error('Unexpected deletion');}
  };
  const idb={
    open:async()=>{},close(){},
    get:async(store,key)=>shared.records[store].find(row=>row.key===key||row.id===key||row.migrationId===key)||null,
    async runTransaction(stores,mode,operation){
      assert.equal(mode,'readonly','empty proof must not write a version or migration marker');
      if(shared.failRead)throw new Error('simulated read failure');
      return operation({getAll:async store=>shared.records[store].slice()});
    },
    put(){shared.idbWrites++;throw new Error('Unexpected IndexedDB write');}
  };
  for(const file of [
    'src/symbol-identity.js','src/storage/storage-errors.js','src/storage/storage-checksum.js',
    'src/storage/storage-validation.js','src/storage/local-storage-adapter.js','src/storage/draft-adapter.js',
    'src/storage/migration-v1.js','src/storage/cutover-v1.js','src/storage/storage-manager.js',
    'src/multi-tab-protection.js','src/state.js','src/import-export.js','src/universe-handoff.js',
    'src/market-data-bridge.js'
  ])vm.runInContext(source(file),context,{filename:file});
  const local=context.InvestmentStorage.local.create({storage:context.localStorage});
  const manager=context.InvestmentStorage.manager.create({localAdapter:local,idbAdapter:idb,clone:context.structuredClone});
  context.StorageManager=manager;
  context.navigator={locks:shared.locks};
  const main={dataset:{storageState:'loading'}};
  context.document={getElementById:()=>main};
  context.render=()=>{};
  context.showStorageLoadingShell=()=>{main.dataset.storageState='loading';};
  context.showStorageInitializationError=error=>{main.dataset.storageState='error';context.lastError=error;};
  context.refreshShadowMigrationPanel=async()=>{};
  const app=source('src/app.js');
  const start=app.indexOf('let applicationServicesStarted=false;');
  const end=app.indexOf("if(typeof window!=='undefined'&&typeof window.addEventListener",start);
  vm.runInContext(app.slice(start,end),context,{filename:'app-lifecycle.js'});
  const bootstrap=app.indexOf('async function bootstrapApplication(){');
  vm.runInContext(app.slice(bootstrap,app.indexOf('const applicationReady=',bootstrap)),context,{filename:'app-bootstrap.js'});
  await manager.initialize();
  return {context,manager,main,shared,
    realm:value=>vm.runInContext(`(${JSON.stringify(value)})`,context),
    readState:()=>JSON.parse(vm.runInContext('JSON.stringify(state)',context)),
    status:()=>context.MultiTabProtection.getStatus(),
    close:()=>{context.MultiTabProtection.close();manager.close();}
  };
}

test('empty storage: first application bootstrap reaches ready without stale_tab or investment data',async()=>{
  const t=await tab();
  assert.equal((await t.context.bootstrapApplication()).status,'ready');
  assert.equal(t.main.dataset.storageState,'ready');
  assert.equal(t.status().status,'fresh');
  const stored=JSON.parse(t.shared.raw.get(MAIN));
  assert.deepEqual(stored.stocks,[]);
  for(const key of ['holdings','plans','allocation','orders','tradeHistory','executionLog','brokerFacts'])assert.equal(stored[key],undefined,key);
  assert.equal(t.shared.idbWrites,0);
  t.close();
});

test('empty storage: loading establishes only an in-memory persisted-null baseline with zero writes',async()=>{
  const t=await tab();await t.context.loadState();
  assert.equal(t.status().baselineRevision,'empty');assert.equal(t.status().baselineKnown,true);
  assert.deepEqual(t.readState().stocks,[]);assert.equal(t.readState().updatedAt,null);
  assert.equal(t.shared.raw.size,0);assert.equal(t.shared.writes,0);assert.equal(t.shared.idbWrites,0);
  assert.equal(t.manager.getPersistenceStatus().revision,0);t.close();
});

test('empty storage: normal recovery candidate can save via the unchanged protected entry',async()=>{
  const t=await tab();await t.context.loadState();t.main.dataset.storageState='error';
  await t.context.persistCandidateSnapshot(t.realm({stocks:[],updatedAt:1}));
  assert.deepEqual(JSON.parse(t.shared.raw.get(MAIN)),{stocks:[],updatedAt:1});
  assert.equal(t.shared.writes,1);assert.equal(t.manager.getPersistenceStatus().revision,1);
  assert.equal(t.status().baselineRevision,'1:0');t.close();
});

test('existing canonical state/version follows the original baseline path, including a persisted empty portfolio',async()=>{
  for(const updatedAt of [null,0,7]){
    const shared=sharedStore();shared.raw.set(MAIN,JSON.stringify({stocks:[],updatedAt,allocation:{sentinel:'unchanged'}}));
    const t=await tab(shared);
    t.context.StorageManager={...t.manager,canInitializeEmptyState:async()=>{throw new Error('Existing state must not use empty initialization');}};
    await t.context.loadState();assert.equal(t.status().baselineRevision,`${updatedAt}:0`);
    await t.context.saveState(undefined,{critical:true});
    assert.equal(JSON.parse(shared.raw.get(MAIN)).allocation.sentinel,'unchanged');
    assert.equal(shared.writes,1);t.close();
  }
});

test('empty special case rejects stored null, drafts, metadata, old versions, canonical records and migration history',async()=>{
  const cases=[
    shared=>shared.raw.set(MAIN,'null'),
    shared=>shared.raw.set(PLAN_DRAFTS,'{}'),
    shared=>shared.raw.set(OPERATION_DRAFTS,'{}'),
    shared=>shared.records.meta.push({key:'previous_version',revision:1}),
    shared=>shared.records.meta.push({key:'active_storage',value:'localStorage'}),
    shared=>shared.records.portfolio_state.push({id:'active',payload:{stocks:[],updatedAt:9}}),
    shared=>shared.records.drafts.push({id:'old-draft'}),
    shared=>shared.records.migration.push({migrationId:'old-run',status:'failed'})
  ];
  for(const setup of cases){
    const shared=sharedStore();setup(shared);const before=JSON.stringify([...shared.raw]);const t=await tab(shared);
    await assert.rejects(()=>t.context.loadState(),error=>error.type==='stale_tab');
    assert.equal(t.status().baselineKnown,false);assert.equal(shared.writes,0);assert.equal(shared.idbWrites,0);
    assert.equal(JSON.stringify([...shared.raw]),before);t.close();
  }
});

test('a formerly loaded tab may not reclassify deleted or version-mismatched state as first initialization',async()=>{
  const shared=sharedStore();shared.raw.set(MAIN,JSON.stringify({stocks:[],updatedAt:1}));const t=await tab(shared);
  await t.context.loadState();shared.raw.delete(MAIN);
  await assert.rejects(()=>t.context.loadState(),error=>error.type==='stale_tab');
  await assert.rejects(()=>t.context.saveState(undefined,{critical:true}),error=>error.type==='stale_tab');
  assert.equal(shared.writes,0);assert.equal(t.status().status,'stale');t.close();
});

test('two independent empty-tab runtimes retain exclusive-lock conflict detection with one winner',async()=>{
  const shared=sharedStore(),a=await tab(shared),b=await tab(shared);
  await Promise.all([a.context.loadState(),b.context.loadState()]);
  const results=await Promise.allSettled([
    a.context.persistCandidateSnapshot(a.realm({stocks:[],updatedAt:11})),
    b.context.persistCandidateSnapshot(b.realm({stocks:[],updatedAt:12}))
  ]);
  assert.equal(results.filter(result=>result.status==='fulfilled').length,1);
  const rejected=results.find(result=>result.status==='rejected');assert.equal(rejected.reason.type,'stale_tab');
  assert.equal(shared.writes,1);assert.equal(JSON.parse(shared.raw.get(MAIN)).updatedAt,11);
  assert.equal(b.status().status,'stale');a.close();b.close();
});

test('normal existing-state competing tabs still reject a real old version without overwriting the winner',async()=>{
  const shared=sharedStore();shared.raw.set(MAIN,JSON.stringify({stocks:[],updatedAt:1}));
  const a=await tab(shared),b=await tab(shared);await Promise.all([a.context.loadState(),b.context.loadState()]);
  await a.context.persistCandidateSnapshot(a.realm({stocks:[],updatedAt:2}));
  await assert.rejects(()=>b.context.persistCandidateSnapshot(b.realm({stocks:[],updatedAt:3})),error=>error.type==='stale_tab');
  assert.equal(shared.writes,1);assert.equal(JSON.parse(shared.raw.get(MAIN)).updatedAt,2);a.close();b.close();
});

test('empty-state first-save failure leaves no canonical bytes, version increment or partial initialization',async()=>{
  const t=await tab();await t.context.loadState();t.shared.failWrite=true;
  await assert.rejects(()=>t.context.persistCandidateSnapshot(t.realm({stocks:[],updatedAt:1})),error=>error.type==='write_failed');
  assert.equal(t.shared.writes,0);assert.equal(t.shared.raw.size,0);assert.equal(t.shared.idbWrites,0);
  assert.equal(t.manager.getPersistenceStatus().revision,0);assert.equal(t.manager.getPersistenceStatus().pendingWrites,0);
  assert.equal(t.status().baselineRevision,'empty');t.close();
  t.shared.failWrite=false;const reloaded=await tab(t.shared);await reloaded.context.loadState();
  await reloaded.context.persistCandidateSnapshot(reloaded.realm({stocks:[],updatedAt:2}));
  assert.equal(t.shared.writes,1);reloaded.close();
});

test('empty-state proof failure does not establish even an in-memory baseline or write anything',async()=>{
  const t=await tab();t.shared.failRead=true;
  await assert.rejects(()=>t.context.loadState(),/simulated read failure/);
  assert.equal(t.status().baselineKnown,false);assert.equal(t.shared.writes,0);assert.equal(t.manager.getPersistenceStatus().revision,0);t.close();
});

test('first empty initialization requires the existing exclusive-lock facility',async()=>{
  const t=await tab();t.context.navigator.locks=null;
  await assert.rejects(()=>t.context.loadState(),error=>error.type==='stale_tab');
  assert.equal(t.status().baselineKnown,false);assert.equal(t.shared.writes,0);t.close();
});

test('new write records appearing after empty observation are rechecked inside the first-save lock',async()=>{
  const t=await tab();await t.context.loadState();t.shared.records.meta.push({key:'new_version',revision:3});
  await assert.rejects(()=>t.context.persistCandidateSnapshot(t.realm({stocks:[],updatedAt:1})),error=>error.type==='stale_tab');
  assert.equal(t.shared.writes,0);assert.equal(t.shared.raw.size,0);t.close();
});

test('a successful prior write prevents empty initialization even when the raw main key later disappears',async()=>{
  const t=await tab();await t.manager.saveState(t.realm({stocks:[],updatedAt:1}),{critical:true});
  t.shared.raw.delete(MAIN);assert.equal(await t.manager.canInitializeEmptyState(),false);
  const before=t.shared.writes;await assert.rejects(()=>t.context.loadState(),error=>error.type==='stale_tab');
  assert.equal(t.shared.writes,before);t.close();
});
