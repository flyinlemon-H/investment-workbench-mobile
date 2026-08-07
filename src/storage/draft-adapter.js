(function draftAdapterModule(global){
  'use strict';

  const root=global.InvestmentStorage=global.InvestmentStorage||{};
  const KINDS=Object.freeze(['plan_update','operation_entry']);

  function storageErrors(){
    if(!root.errors)throw new Error('InvestmentStorage.errors must load before draft-adapter.js.');
    return root.errors;
  }

  function create(options={}){
    const localAdapter=options.localAdapter;
    const idbAdapter=options.idbAdapter;
    const getActiveSource=options.getActiveSource||(()=> 'localStorage');
    const clone=options.clone||global.structuredClone;
    const caches={plan_update:new Map(),operation_entry:new Map()};
    let initialized=false;
    let writeTail=Promise.resolve();

    function validateKind(kind,operation){
      if(!KINDS.includes(kind))throw storageErrors().create('validation_failed',operation);
    }

    function cloneValue(value,operation){
      if(value===undefined)return undefined;
      if(typeof clone!=='function')throw storageErrors().create('validation_failed',operation);
      try{return clone(value)}catch(error){throw storageErrors().normalize(error,operation,'validation_failed')}
    }

    function validateId(id,operation){
      if(typeof id!=='string'||!id.trim())throw storageErrors().create('validation_failed',operation);
      return id;
    }

    function canonicalId(kind,id){return `draft:${kind}:${encodeURIComponent(id)}`}

    function mapFrom(value){
      return new Map(Object.entries(value&&typeof value==='object'&&!Array.isArray(value)?value:{}));
    }

    function mapObject(kind){return Object.fromEntries(caches[kind])}

    async function initialize(){
      if(initialized)return;
      if(getActiveSource()==='indexeddb'){
        const rows=await idbAdapter.getAll('drafts');
        KINDS.forEach(kind=>caches[kind].clear());
        (Array.isArray(rows)?rows:[]).forEach(row=>{
          if(row&&KINDS.includes(row.kind)&&typeof row.entityId==='string'&&row.id===canonicalId(row.kind,row.entityId)){
            caches[row.kind].set(row.entityId,cloneValue(row.payload,'draft.initialize'));
          }
        });
      }else{
        caches.plan_update=mapFrom(localAdapter.loadPlanDrafts());
        caches.operation_entry=mapFrom(localAdapter.loadOperationDrafts());
      }
      initialized=true;
    }

    function requireInitialized(operation){if(!initialized)throw storageErrors().create('read_failed',operation)}

    function getDraft(kind,id){
      validateKind(kind,'draft.get');validateId(id,'draft.get');requireInitialized('draft.get');
      return caches[kind].has(id)?cloneValue(caches[kind].get(id),'draft.get'):null;
    }

    function listDrafts(kind){
      validateKind(kind,'draft.list');requireInitialized('draft.list');
      return Array.from(caches[kind],([id,payload])=>Object.freeze({id,payload:cloneValue(payload,'draft.list')}));
    }

    function enqueue(operation){
      const result=writeTail.then(operation);
      writeTail=result.catch(()=>{});
      return result;
    }

    function persistLocal(kind){
      const value=mapObject(kind);
      return kind==='plan_update'?localAdapter.savePlanDrafts(value):localAdapter.saveOperationDrafts(value);
    }

    function saveDraft(kind,id,payload){
      validateKind(kind,'draft.save');validateId(id,'draft.save');requireInitialized('draft.save');
      const snapshot=cloneValue(payload,'draft.save');
      caches[kind].set(id,snapshot);
      return enqueue(async()=>{
        try{
          if(getActiveSource()==='indexeddb'){
            await idbAdapter.put('drafts',{id:canonicalId(kind,id),kind,entityId:id,updatedAt:new Date().toISOString(),payload:cloneValue(snapshot,'draft.save')});
          }else persistLocal(kind);
          return cloneValue(snapshot,'draft.save');
        }catch(error){throw storageErrors().normalize(error,'draft.save','write_failed')}
      });
    }

    function deleteDraft(kind,id){
      validateKind(kind,'draft.delete');validateId(id,'draft.delete');requireInitialized('draft.delete');
      caches[kind].delete(id);
      return enqueue(async()=>{
        try{
          if(getActiveSource()==='indexeddb')await idbAdapter.delete('drafts',canonicalId(kind,id));
          else persistLocal(kind);
        }catch(error){throw storageErrors().normalize(error,'draft.delete','write_failed')}
      });
    }

    const flush=()=>writeTail;
    return Object.freeze({initialize,getDraft,saveDraft,deleteDraft,listDrafts,flush,canonicalId,kinds:KINDS});
  }

  root.drafts=Object.freeze({create,KINDS});
})(typeof window!=='undefined'?window:globalThis);
