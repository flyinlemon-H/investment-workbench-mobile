(function storageErrorsModule(global){
  'use strict';

  const root=global.InvestmentStorage=global.InvestmentStorage||{};
  const MESSAGES=Object.freeze({
    idb_unavailable:'IndexedDB is unavailable in this browser.',
    idb_open_failed:'IndexedDB could not be opened.',
    read_failed:'Local data could not be read.',
    write_failed:'Local data could not be saved.',
    quota_exceeded:'Browser storage quota was exceeded.',
    validation_failed:'Stored data failed validation.',
    stale_tab:'A newer revision was saved by another tab.',
    unknown_storage_error:'An unknown storage error occurred.'
  });
  const RETRYABLE=Object.freeze({
    idb_unavailable:false,
    idb_open_failed:true,
    read_failed:true,
    write_failed:true,
    quota_exceeded:true,
    validation_failed:false,
    stale_tab:false,
    unknown_storage_error:true
  });

  class InvestmentStorageError extends Error{
    constructor(type,operation){
      const safeType=Object.prototype.hasOwnProperty.call(MESSAGES,type)?type:'unknown_storage_error';
      super(MESSAGES[safeType]);
      this.name='InvestmentStorageError';
      this.type=safeType;
      this.operation=String(operation||'storage');
      this.retryable=RETRYABLE[safeType];
      Object.setPrototypeOf(this,InvestmentStorageError.prototype);
    }
  }

  function isQuotaError(error){
    return Boolean(error&&(
      error.name==='QuotaExceededError'||
      error.name==='NS_ERROR_DOM_QUOTA_REACHED'||
      error.code===22||error.code===1014
    ));
  }

  function create(type,operation){return new InvestmentStorageError(type,operation)}
  function normalize(error,operation,fallbackType){
    if(error instanceof InvestmentStorageError)return error;
    if(isQuotaError(error))return create('quota_exceeded',operation);
    return create(fallbackType||'unknown_storage_error',operation);
  }

  root.errors=Object.freeze({
    Error:InvestmentStorageError,
    TYPES:Object.freeze(Object.keys(MESSAGES)),
    MESSAGES,
    create,
    normalize,
    isQuotaError
  });
})(typeof window!=='undefined'?window:globalThis);
