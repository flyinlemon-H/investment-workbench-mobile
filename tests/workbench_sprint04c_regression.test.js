'use strict';

const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const test=require('node:test');
const vm=require('node:vm');

const root=path.resolve(__dirname,'..');
function runtime(files,extra={}){
  const context={
    console,
    structuredClone,
    TextEncoder,
    Uint8Array,
    ArrayBuffer,
    AbortController,
    setTimeout,
    clearTimeout,
    ...extra,
    globalThis:null
  };
  context.globalThis=context;
  vm.createContext(context);
  for(const file of files){
    vm.runInContext(fs.readFileSync(path.join(root,file),'utf8'),context,{filename:file});
  }
  return context;
}

test('Sprint04C critical local persistence keeps one queued write and revision',async()=>{
  const context=runtime([
    'src/storage/storage-errors.js',
    'src/storage/storage-manager.js'
  ]);
  context.InvestmentStorage.drafts={};
  let saves=0;
  let saved=null;
  const localAdapter={
    loadMainState:()=>saved,
    saveMainState:value=>{saves++;saved=structuredClone(value)}
  };
  const idbAdapter={open:async()=>{throw new Error('fixture idb unavailable')},close:()=>{}};
  const draftAdapter={initialize:async()=>{},flush:async()=>{},close:()=>{}};
  const manager=context.InvestmentStorage.manager.create({
    localAdapter,
    idbAdapter,
    draftAdapter,
    clone:structuredClone
  });
  const initialized=await manager.initialize();
  assert.equal(initialized.activeSource,'localStorage');
  await manager.saveState({stocks:[],updatedAt:1},{critical:true});
  await manager.flush();
  assert.equal(saves,1);
  assert.deepEqual(saved,{stocks:[],updatedAt:1});
  assert.equal(manager.getPersistenceStatus().revision,1);
  manager.close();
});

test('Sprint04C cutover parser recognizes IndexedDB active and forces invalid markers to recovery',()=>{
  const context=runtime(['src/storage/storage-errors.js']);
  context.InvestmentStorage.migrationV1={MIGRATION_ID:'fixture-migration'};
  vm.runInContext(fs.readFileSync(path.join(root,'src/storage/cutover-v1.js'),'utf8'),context,{filename:'src/storage/cutover-v1.js'});
  const cutover=context.InvestmentStorage.cutoverV1;
  const active=cutover.marker('indexeddb_active',{revision:3,semanticChecksum:'ABC'});
  assert.equal(cutover.parseMarker(active).status,'indexeddb_active');
  const invalid={...active,activeSource:'localStorage'};
  const recovered=cutover.parseMarker(invalid);
  assert.equal(recovered.status,'recovery_required');
  assert.equal(recovered.markerStatus,'invalid');
});

test('Sprint04C multi-tab guard rejects stale writes and retains exclusive lock path',async()=>{
  const messages=[];
  const context=runtime([
    'src/storage/storage-errors.js',
    'src/multi-tab-protection.js'
  ]);
  let current={stocks:[{id:'a'}],updatedAt:1};
  const guard=context.InvestmentMultiTab.create({
    loadCurrent:async()=>current,
    lockManager:{request:async(_name,_options,operation)=>operation()},
    channel:{postMessage:message=>messages.push(message),close:()=>{}},
    document:null,
    windowTarget:null
  });
  guard.observeLoadedState(current);
  let writes=0;
  await guard.runProtectedSave({...current,updatedAt:2},async snapshot=>{
    writes++;
    current=snapshot;
    return snapshot;
  },{critical:true});
  assert.equal(writes,1);
  assert.equal(messages.at(-1).type,'state_saved');
  guard.receive({type:'state_saved',revision:'999:1'});
  assert.equal(guard.getStatus().status,'stale');
  await assert.rejects(
    ()=>guard.runProtectedSave({...current,updatedAt:3},async()=>{}, {critical:true}),
    error=>error&&error.type==='stale_tab'
  );
  guard.close();
});

test('Sprint04C revision, checksum, recovery, lock, and BroadcastChannel safeguards remain present',()=>{
  const cutover=fs.readFileSync(path.join(root,'src/storage/cutover-v1.js'),'utf8');
  const checksum=fs.readFileSync(path.join(root,'src/storage/storage-checksum.js'),'utf8');
  const multiTab=fs.readFileSync(path.join(root,'src/multi-tab-protection.js'),'utf8');
  assert.match(cutover,/ACTIVE_REVISION_CHANGED/);
  assert.match(cutover,/recovery_required/);
  assert.match(cutover,/locks\.request|CUTOVER_LOCK_NAME/);
  assert.match(checksum,/semanticChecksum/);
  assert.match(checksum,/SHA-256/);
  assert.match(multiTab,/BroadcastChannel/);
  assert.match(multiTab,/stale_tab/);
});
