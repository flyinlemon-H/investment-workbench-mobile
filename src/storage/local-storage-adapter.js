(function localStorageAdapterModule(global){
  'use strict';

  const root=global.InvestmentStorage=global.InvestmentStorage||{};
  const KEYS=Object.freeze({
    main:'portfolio_manual_v502_network_price_20260610',
    planDrafts:'v13_plan_update_drafts_v1',
    operationDrafts:'v13_operation_entry_drafts_v1'
  });

  function storageErrors(){
    if(!root.errors)throw new Error('InvestmentStorage.errors must load before local-storage-adapter.js.');
    return root.errors;
  }

  function create(options={}){
    const storage=options.storage===undefined?global.localStorage:options.storage;

    function requireStorage(operation){
      if(!storage||typeof storage.getItem!=='function')throw storageErrors().create('read_failed',operation);
      return storage;
    }

    function raw(key,operation){
      try{return requireStorage(operation).getItem(key)}
      catch(error){throw storageErrors().normalize(error,operation,'read_failed')}
    }

    function parse(key,operation,emptyValue){
      const value=raw(key,operation);
      if(value===null)return emptyValue;
      try{return JSON.parse(value)}
      catch(_error){throw storageErrors().create('validation_failed',operation)}
    }

    function write(key,value,operation){
      let serialized;
      try{serialized=JSON.stringify(value)}
      catch(_error){throw storageErrors().create('validation_failed',operation)}
      try{requireStorage(operation).setItem(key,serialized)}
      catch(error){throw storageErrors().normalize(error,operation,'write_failed')}
      return serialized;
    }

    function remove(key,operation){
      try{requireStorage(operation).removeItem(key)}
      catch(error){throw storageErrors().normalize(error,operation,'write_failed')}
    }

    return Object.freeze({
      loadMainState:()=>parse(KEYS.main,'localStorage.loadMainState',null),
      saveMainState:value=>write(KEYS.main,value,'localStorage.saveMainState'),
      removeMainState:()=>remove(KEYS.main,'localStorage.removeMainState'),
      loadPlanDrafts:()=>parse(KEYS.planDrafts,'localStorage.loadPlanDrafts',{}),
      savePlanDrafts:value=>write(KEYS.planDrafts,value,'localStorage.savePlanDrafts'),
      loadOperationDrafts:()=>parse(KEYS.operationDrafts,'localStorage.loadOperationDrafts',{}),
      saveOperationDrafts:value=>write(KEYS.operationDrafts,value,'localStorage.saveOperationDrafts'),
      getRawSnapshot:()=>Object.freeze({
        [KEYS.main]:raw(KEYS.main,'localStorage.getRawSnapshot'),
        [KEYS.planDrafts]:raw(KEYS.planDrafts,'localStorage.getRawSnapshot'),
        [KEYS.operationDrafts]:raw(KEYS.operationDrafts,'localStorage.getRawSnapshot')
      }),
      keys:KEYS
    });
  }

  root.local=Object.freeze({create,KEYS});
})(typeof window!=='undefined'?window:globalThis);
