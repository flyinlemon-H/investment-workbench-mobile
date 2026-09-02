(function storageManagerModule(global){
  'use strict';

  const root=global.InvestmentStorage=global.InvestmentStorage||{};
  const STATUS_VALUES=Object.freeze(['idle','saving','saved','error']);

  function storageErrors(){
    if(!root.errors)throw new Error('InvestmentStorage.errors must load before storage-manager.js.');
    return root.errors;
  }

  function create(options={}){
    const localAdapter=options.localAdapter||root.local.create(options.localOptions||{});
    const idbAdapter=options.idbAdapter||root.idb.create(options.idbOptions||{});
    const clone=options.clone||global.structuredClone;
    let initialized=false;
    let initializationPromise=null;
    let indexedDbAvailable=false;
    let activeSource='localStorage';
    let sourceMarker=null;
    let sourceMarkerStatus='missing';
    let storageState='localstorage_active';
    let revision=0;
    let persistenceStatus='idle';
    let lastError=null;
    let queue=[];
    let draining=false;
    let drainScheduled=false;
    let idleWaiters=[];
    let migrationRunner=null;
    let cutoverRunner=null;
    let draftAdapter=null;

    function status(){
      return Object.freeze({
        activeSource,
        revision,
        persistenceStatus,
        indexedDbAvailable,
        storageState,
        pendingWrites:queue.length+(draining?1:0)
      });
    }

    function initialize(){
      if(initialized)return Promise.resolve(status());
      if(initializationPromise)return initializationPromise;
      initializationPromise=(async()=>{
        try{await idbAdapter.open();indexedDbAvailable=true}
        catch(_error){indexedDbAvailable=false;activeSource='localStorage';storageState='localstorage_active';sourceMarkerStatus='unavailable'}
        if(indexedDbAvailable){
          const resolved=await cutover().resolveStartup();
          sourceMarker=resolved.record||null;
          sourceMarkerStatus=resolved.markerStatus;
          storageState=resolved.status;
          activeSource=resolved.activeSource||'localStorage';
          revision=Number(resolved.record&&resolved.record.revision)||0;
        }
        if(storageState==='recovery_required'){
          initialized=true;
          return status();
        }
        if(!root.drafts)throw storageErrors().create('validation_failed','storageManager.drafts.module');
        draftAdapter=options.draftAdapter||root.drafts.create({localAdapter,idbAdapter,getActiveSource:()=>activeSource,assertWriteAllowed:()=>assertWriteAllowed(),persistIndexedDbDraft:(kind,id,payload,remove)=>cutover().persistActiveDraft(kind,id,payload,remove),clone});
        await draftAdapter.initialize();
        initialized=true;
        return status();
      })();
      return initializationPromise;
    }

    async function loadState(){
      if(!initialized)await initialize();
      if(storageState==='recovery_required')throw storageErrors().create('validation_failed','storageManager.loadState.recovery_required');
      if(activeSource==='indexeddb'){
        const record=await idbAdapter.get('portfolio_state','active');
        if(!record||!Object.prototype.hasOwnProperty.call(record,'payload'))throw storageErrors().create('read_failed','storageManager.loadState.indexeddb');
        return cloneState(record.payload);
      }
      return localAdapter.loadMainState();
    }

    async function canInitializeEmptyState(){
      if(!initialized)await initialize();
      const pristine=()=>indexedDbAvailable&&activeSource==='localStorage'
        &&storageState==='localstorage_active'&&sourceMarker===null&&sourceMarkerStatus==='missing'
        &&revision===0&&persistenceStatus==='idle'&&!queue.length&&!draining&&!drainScheduled;
      if(!pristine())return false;
      const localEmpty=()=>{
        const raw=localAdapter.getRawSnapshot(),keys=localAdapter.keys;
        return Boolean(keys)&&['main','planDrafts','operationDrafts'].every(name=>raw[keys[name]]===null);
      };
      if(!localEmpty())return false;
      // An absent main key is not enough: old versions, drafts or staging records
      // must never be mistaken for a brand-new store. This proof is read-only.
      const stores=['meta','portfolio_state','drafts','migration'];
      const empty=await idbAdapter.runTransaction(stores,'readonly',async tx=>{
        const rows=await Promise.all(stores.map(store=>tx.getAll(store)));
        return rows.every(values=>Array.isArray(values)&&values.length===0);
      });
      return empty&&pristine()&&localEmpty();
    }

    function migration(){
      if(!root.migrationV1)throw storageErrors().create('validation_failed','storageManager.migration.module');
      if(!migrationRunner)migrationRunner=root.migrationV1.create({
        localAdapter,
        idbAdapter,
        normalizeState:options.normalizeState||global.normalize,
        clone,
        now:options.now,
        checksumOptions:options.checksumOptions,
        hooks:options.migrationHooks
      });
      return migrationRunner;
    }

    function cutover(){
      if(!root.cutoverV1)throw storageErrors().create('validation_failed','storageManager.cutover.module');
      if(!cutoverRunner)cutoverRunner=root.cutoverV1.create({
        localAdapter,idbAdapter,now:options.now,checksumOptions:options.checksumOptions,hooks:options.cutoverHooks,lockManager:options.lockManager
      });
      return cutoverRunner;
    }

    async function assertWriteAllowed(){
      if(indexedDbAvailable)await cutover().assertWriteAllowed(activeSource);
    }

    async function requireMigrationFoundation(){
      if(!initialized)await initialize();
      if(!indexedDbAvailable)throw storageErrors().create('idb_unavailable','storageManager.migration');
      return migration();
    }

    async function getMigrationStatus(){return (await requireMigrationFoundation()).getStatus()}
    async function getShadowMigrationPreflight(){return (await requireMigrationFoundation()).getPreflightSummary()}
    async function runShadowMigration(optionsValue={}){return (await requireMigrationFoundation()).runShadowMigration(optionsValue)}
    async function clearMigrationStaging(){return (await requireMigrationFoundation()).clearStaging()}
    async function getCutoverStatus(){
      if(!initialized)await initialize();
      if(!indexedDbAvailable)throw storageErrors().create('idb_unavailable','storageManager.cutover.status');
      return cutover().inspect();
    }
    async function adoptIndexedDbResult(result){
      if(!result||result.status!=='indexeddb_active'||result.activeSource!=='indexeddb')throw storageErrors().create('validation_failed','storageManager.cutover.result');
      activeSource='indexeddb';storageState='indexeddb_active';sourceMarker=result.marker;sourceMarkerStatus='valid';
      draftAdapter=root.drafts.create({localAdapter,idbAdapter,getActiveSource:()=>activeSource,assertWriteAllowed:()=>assertWriteAllowed(),persistIndexedDbDraft:(kind,id,payload,remove)=>cutover().persistActiveDraft(kind,id,payload,remove),clone});
      await draftAdapter.initialize();
      return result;
    }
    async function executeActiveCutover(optionsValue={}){
      if(!initialized)await initialize();
      if(!indexedDbAvailable)throw storageErrors().create('idb_unavailable','storageManager.cutover.activate');
      await flush();
      const result=await cutover().activate(optionsValue);
      return adoptIndexedDbResult(result);
    }
    async function retryActiveCutover(optionsValue={}){
      if(!initialized)await initialize();
      if(!indexedDbAvailable)throw storageErrors().create('idb_unavailable','storageManager.cutover.retry');
      await flush();
      const persistent=await cutover().inspect();
      if(!persistent||!['localstorage_active','staging_ready','cutover_in_progress','indexeddb_active','recovery_required'].includes(persistent.status))throw storageErrors().create('validation_failed','storageManager.cutover.retry.status');
      const result=await cutover().retry(optionsValue);
      return adoptIndexedDbResult(result);
    }
    async function recoverUsingLegacy(){
      if(!initialized)await initialize();
      if(!indexedDbAvailable)throw storageErrors().create('idb_unavailable','storageManager.cutover.legacy');
      const result=await cutover().useLegacy();
      activeSource='localStorage';storageState='localstorage_active';sourceMarker=result.marker;sourceMarkerStatus='valid';
      draftAdapter=root.drafts.create({localAdapter,idbAdapter,getActiveSource:()=>activeSource,assertWriteAllowed:()=>assertWriteAllowed(),persistIndexedDbDraft:(kind,id,payload,remove)=>cutover().persistActiveDraft(kind,id,payload,remove),clone});
      await draftAdapter.initialize();
      return result;
    }

    function cloneState(value){
      if(typeof clone!=='function')throw storageErrors().create('validation_failed','storageManager.clone');
      try{return clone(value)}
      catch(error){throw storageErrors().normalize(error,'storageManager.clone','validation_failed')}
    }

    function settleIdle(){
      if(draining||drainScheduled||queue.length)return;
      const waiters=idleWaiters;
      idleWaiters=[];
      waiters.forEach(waiter=>lastError?waiter.reject(lastError):waiter.resolve(status()));
    }

    async function drain(){
      if(draining)return;
      drainScheduled=false;
      draining=true;
      while(queue.length){
        const batch=queue.shift();
        persistenceStatus='saving';
        try{
          await assertWriteAllowed();
          if(activeSource==='indexeddb')await cutover().persistActiveState(batch.snapshot);
          else localAdapter.saveMainState(batch.snapshot);
          revision+=1;
          persistenceStatus='saved';
          lastError=null;
          const result=Object.freeze({revision,persistedAt:new Date().toISOString(),activeSource});
          batch.waiters.forEach(waiter=>waiter.resolve(result));
        }catch(error){
          const normalized=storageErrors().normalize(error,'storageManager.saveState','write_failed');
          persistenceStatus='error';
          lastError=normalized;
          batch.waiters.forEach(waiter=>waiter.reject(normalized));
        }
      }
      draining=false;
      settleIdle();
    }

    function scheduleDrain(){
      if(draining||drainScheduled)return;
      drainScheduled=true;
      Promise.resolve().then(drain);
    }

    function saveState(value,optionsValue={}){
      if(!initialized)return initialize().then(()=>saveState(value,optionsValue));
      let snapshot;
      try{snapshot=cloneState(value)}catch(error){return Promise.reject(error)}
      const critical=optionsValue&&optionsValue.critical===true;
      const promise=new Promise((resolve,reject)=>{
        const waiter={resolve,reject};
        const pending=queue[queue.length-1];
        if(!critical&&pending&&!pending.critical){
          pending.snapshot=snapshot;
          pending.waiters.push(waiter);
        }else{
          queue.push({snapshot,critical,waiters:[waiter]});
        }
      });
      persistenceStatus='saving';
      scheduleDrain();
      return promise;
    }

    async function flush(){
      if(draining||drainScheduled||queue.length)await new Promise((resolve,reject)=>idleWaiters.push({resolve,reject}));
      else if(lastError)throw lastError;
      if(draftAdapter)await draftAdapter.flush();
      return status();
    }

    function close(){idbAdapter.close()}

    const managerFacade={
      initialize,
      loadState,
      canInitializeEmptyState,
      saveState,
      flush,
      getMigrationStatus,
      getShadowMigrationPreflight,
      runShadowMigration,
      clearMigrationStaging,
      getCutoverStatus,
      executeActiveCutover,
      retryActiveCutover,
      recoverUsingLegacy,
      getActiveSource:()=>activeSource,
      getActiveSourceInfo:()=>Object.freeze({activeSource,storageState,markerValue:sourceMarker&&sourceMarker.value||null,marker:sourceMarker,markerStatus:sourceMarkerStatus,indexedDbActivationEnabled:Boolean(root.cutoverV1)}),
      getDraft:(kind,id)=>draftAdapter.getDraft(kind,id),
      saveDraft:(kind,id,payload)=>draftAdapter.saveDraft(kind,id,payload),
      deleteDraft:(kind,id)=>draftAdapter.deleteDraft(kind,id),
      listDrafts:kind=>draftAdapter.listDrafts(kind),
      getPersistenceStatus:status,
      close
    };
    Object.defineProperty(managerFacade,'activeSource',{enumerable:true,get:()=>activeSource});
    return Object.freeze(managerFacade);
  }

  let singleton=null;
  function defaultManager(){if(!singleton)singleton=create();return singleton}

  root.manager=Object.freeze({create,STATUS_VALUES});
  const globalManager={
    initialize:(...args)=>defaultManager().initialize(...args),
    loadState:(...args)=>defaultManager().loadState(...args),
    canInitializeEmptyState:(...args)=>defaultManager().canInitializeEmptyState(...args),
    saveState:(...args)=>defaultManager().saveState(...args),
    flush:(...args)=>defaultManager().flush(...args),
    getMigrationStatus:(...args)=>defaultManager().getMigrationStatus(...args),
    getShadowMigrationPreflight:(...args)=>defaultManager().getShadowMigrationPreflight(...args),
    runShadowMigration:(...args)=>defaultManager().runShadowMigration(...args),
    clearMigrationStaging:(...args)=>defaultManager().clearMigrationStaging(...args),
    getCutoverStatus:(...args)=>defaultManager().getCutoverStatus(...args),
    executeActiveCutover:(...args)=>defaultManager().executeActiveCutover(...args),
    retryActiveCutover:(...args)=>defaultManager().retryActiveCutover(...args),
    recoverUsingLegacy:(...args)=>defaultManager().recoverUsingLegacy(...args),
    getActiveSource:()=>defaultManager().getActiveSource(),
    getActiveSourceInfo:()=>defaultManager().getActiveSourceInfo(),
    getDraft:(...args)=>defaultManager().getDraft(...args),
    saveDraft:(...args)=>defaultManager().saveDraft(...args),
    deleteDraft:(...args)=>defaultManager().deleteDraft(...args),
    listDrafts:(...args)=>defaultManager().listDrafts(...args),
    getPersistenceStatus:(...args)=>defaultManager().getPersistenceStatus(...args),
    close:()=>defaultManager().close()
  };
  Object.defineProperty(globalManager,'activeSource',{enumerable:true,get:()=>defaultManager().getActiveSource()});
  global.StorageManager=Object.freeze(globalManager);
})(typeof window!=='undefined'?window:globalThis);
