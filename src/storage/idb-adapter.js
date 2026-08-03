(function indexedDbAdapterModule(global){
  'use strict';

  const root=global.InvestmentStorage=global.InvestmentStorage||{};
  const DATABASE_NAME='investment-workbench-mobile';
  const DATABASE_VERSION=1;
  const STORE_DEFINITIONS=Object.freeze({
    meta:Object.freeze({keyPath:'key'}),
    portfolio_state:Object.freeze({keyPath:'id'}),
    drafts:Object.freeze({
      keyPath:'id',
      indexes:Object.freeze([
        Object.freeze({name:'kind',keyPath:'kind',options:{unique:false}}),
        Object.freeze({name:'updatedAt',keyPath:'updatedAt',options:{unique:false}})
      ])
    }),
    migration:Object.freeze({keyPath:'migrationId'})
  });

  function storageErrors(){
    if(!root.errors)throw new Error('InvestmentStorage.errors must load before idb-adapter.js.');
    return root.errors;
  }

  function requestResult(request,operation,fallbackType){
    return new Promise((resolve,reject)=>{
      request.onsuccess=()=>resolve(request.result);
      request.onerror=()=>reject(storageErrors().normalize(request.error,operation,fallbackType));
    });
  }

  function create(options={}){
    const factory=options.indexedDBFactory===undefined?global.indexedDB:options.indexedDBFactory;
    const databaseName=options.databaseName||DATABASE_NAME;
    const version=options.version||DATABASE_VERSION;
    let database=null;

    function createSchema(request){
      const db=request.result;
      Object.entries(STORE_DEFINITIONS).forEach(([name,definition])=>{
        let store;
        if(!db.objectStoreNames.contains(name)){
          store=db.createObjectStore(name,{keyPath:definition.keyPath});
        }else if(request.transaction){
          store=request.transaction.objectStore(name);
        }
        (definition.indexes||[]).forEach(index=>{
          if(store&&!store.indexNames.contains(index.name))store.createIndex(index.name,index.keyPath,index.options);
        });
      });
    }

    function open(){
      if(database)return Promise.resolve(database);
      if(!factory||typeof factory.open!=='function')return Promise.reject(storageErrors().create('idb_unavailable','idb.open'));
      return new Promise((resolve,reject)=>{
        let request;
        let settled=false;
        try{request=factory.open(databaseName,version)}
        catch(error){reject(storageErrors().normalize(error,'idb.open','idb_open_failed'));return}
        request.onupgradeneeded=()=>{
          try{createSchema(request)}
          catch(error){
            try{request.transaction&&request.transaction.abort()}catch(_error){}
            if(!settled){settled=true;reject(storageErrors().normalize(error,'idb.upgrade','idb_open_failed'))}
          }
        };
        request.onblocked=()=>{
          if(!settled){settled=true;reject(storageErrors().create('idb_open_failed','idb.open.blocked'))}
        };
        request.onerror=()=>{
          if(!settled){settled=true;reject(storageErrors().normalize(request.error,'idb.open','idb_open_failed'))}
        };
        request.onsuccess=()=>{
          if(settled){request.result.close();return}
          settled=true;
          database=request.result;
          database.onversionchange=()=>{database.close();database=null};
          resolve(database);
        };
      });
    }

    function close(){if(database)database.close();database=null}

    async function runTransaction(storeNames,mode,callback){
      const db=await open();
      const names=Array.isArray(storeNames)?storeNames:[storeNames];
      return new Promise((resolve,reject)=>{
        let transaction;
        let callbackResult;
        let callbackError=null;
        let callbackSettled=false;
        let transactionCompleted=false;
        let settled=false;
        try{transaction=db.transaction(names,mode)}
        catch(error){reject(storageErrors().normalize(error,'idb.transaction','unknown_storage_error'));return}

        const operation=(storeName,method,...args)=>{
          if(!names.includes(storeName))return Promise.reject(storageErrors().create('validation_failed','idb.transaction.store'));
          try{
            const request=transaction.objectStore(storeName)[method](...args);
            return requestResult(request,`idb.${method}`,method==='get'||method==='getAll'?'read_failed':'write_failed');
          }catch(error){
            return Promise.reject(storageErrors().normalize(error,`idb.${method}`,method==='get'||method==='getAll'?'read_failed':'write_failed'));
          }
        };
        const context=Object.freeze({
          get:(storeName,key)=>operation(storeName,'get',key).then(value=>value===undefined?null:value),
          put:(storeName,value)=>operation(storeName,'put',value),
          delete:(storeName,key)=>operation(storeName,'delete',key),
          getAll:storeName=>operation(storeName,'getAll')
        });

        const finishCompleted=()=>{
          if(settled||!transactionCompleted||!callbackSettled)return;
          settled=true;
          if(callbackError)reject(callbackError);else resolve(callbackResult);
        };
        transaction.oncomplete=()=>{transactionCompleted=true;finishCompleted()};
        transaction.onerror=()=>{
          if(settled)return;
          settled=true;
          reject(callbackError||storageErrors().normalize(transaction.error,'idb.transaction','unknown_storage_error'));
        };
        transaction.onabort=()=>{
          if(settled)return;
          settled=true;
          reject(callbackError||storageErrors().normalize(transaction.error,'idb.transaction.abort','write_failed'));
        };

        Promise.resolve().then(()=>callback(context)).then(result=>{
          callbackResult=result;
          callbackSettled=true;
          finishCompleted();
        }).catch(error=>{
          callbackError=storageErrors().normalize(error,'idb.transaction.callback','unknown_storage_error');
          callbackSettled=true;
          if(transactionCompleted){finishCompleted();return}
          try{transaction.abort()}catch(_error){if(!settled){settled=true;reject(callbackError)}}
        });
      });
    }

    const read=(store,key)=>runTransaction(store,'readonly',tx=>tx.get(store,key));
    const readAll=store=>runTransaction(store,'readonly',tx=>tx.getAll(store));
    const write=(store,value)=>runTransaction(store,'readwrite',tx=>tx.put(store,value));
    const remove=(store,key)=>runTransaction(store,'readwrite',tx=>tx.delete(store,key));

    return Object.freeze({
      open,
      close,
      get:read,
      put:write,
      delete:remove,
      getAll:readAll,
      runTransaction,
      databaseName,
      version,
      storeNames:Object.freeze(Object.keys(STORE_DEFINITIONS))
    });
  }

  root.idb=Object.freeze({create,DATABASE_NAME,DATABASE_VERSION,STORE_DEFINITIONS});
})(typeof window!=='undefined'?window:globalThis);
