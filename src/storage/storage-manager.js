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
    let revision=0;
    let persistenceStatus='idle';
    let lastError=null;
    let queue=[];
    let draining=false;
    let drainScheduled=false;
    let idleWaiters=[];
    let migrationRunner=null;

    function status(){
      return Object.freeze({
        activeSource:'localStorage',
        revision,
        persistenceStatus,
        indexedDbAvailable,
        pendingWrites:queue.length+(draining?1:0)
      });
    }

    function initialize(){
      if(initialized)return Promise.resolve(status());
      if(initializationPromise)return initializationPromise;
      initializationPromise=(async()=>{
        try{await idbAdapter.open();indexedDbAvailable=true}
        catch(_error){indexedDbAvailable=false}
        initialized=true;
        return status();
      })();
      return initializationPromise;
    }

    async function loadState(){
      if(!initialized)await initialize();
      return localAdapter.loadMainState();
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

    async function requireMigrationFoundation(){
      if(!initialized)await initialize();
      if(!indexedDbAvailable)throw storageErrors().create('idb_unavailable','storageManager.migration');
      return migration();
    }

    async function getMigrationStatus(){return (await requireMigrationFoundation()).getStatus()}
    async function getShadowMigrationPreflight(){return (await requireMigrationFoundation()).getPreflightSummary()}
    async function runShadowMigration(optionsValue={}){return (await requireMigrationFoundation()).runShadowMigration(optionsValue)}
    async function clearMigrationStaging(){return (await requireMigrationFoundation()).clearStaging()}

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
          localAdapter.saveMainState(batch.snapshot);
          revision+=1;
          persistenceStatus='saved';
          lastError=null;
          const result=Object.freeze({revision,persistedAt:new Date().toISOString(),activeSource:'localStorage'});
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

    function flush(){
      if(!draining&&!drainScheduled&&!queue.length)return lastError?Promise.reject(lastError):Promise.resolve(status());
      return new Promise((resolve,reject)=>idleWaiters.push({resolve,reject}));
    }

    function close(){idbAdapter.close()}

    return Object.freeze({
      initialize,
      loadState,
      saveState,
      flush,
      getMigrationStatus,
      getShadowMigrationPreflight,
      runShadowMigration,
      clearMigrationStaging,
      getPersistenceStatus:status,
      close,
      activeSource:'localStorage'
    });
  }

  let singleton=null;
  function defaultManager(){if(!singleton)singleton=create();return singleton}

  root.manager=Object.freeze({create,STATUS_VALUES});
  global.StorageManager=Object.freeze({
    initialize:(...args)=>defaultManager().initialize(...args),
    loadState:(...args)=>defaultManager().loadState(...args),
    saveState:(...args)=>defaultManager().saveState(...args),
    flush:(...args)=>defaultManager().flush(...args),
    getMigrationStatus:(...args)=>defaultManager().getMigrationStatus(...args),
    getShadowMigrationPreflight:(...args)=>defaultManager().getShadowMigrationPreflight(...args),
    runShadowMigration:(...args)=>defaultManager().runShadowMigration(...args),
    clearMigrationStaging:(...args)=>defaultManager().clearMigrationStaging(...args),
    getPersistenceStatus:(...args)=>defaultManager().getPersistenceStatus(...args),
    close:()=>defaultManager().close(),
    activeSource:'localStorage'
  });
})(typeof window!=='undefined'?window:globalThis);
