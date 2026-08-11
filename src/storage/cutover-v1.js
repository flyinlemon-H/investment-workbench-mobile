(function storageCutoverV1Module(global){
  'use strict';

  const root=global.InvestmentStorage=global.InvestmentStorage||{};
  const MARKER_KEY='active_storage';
  const MARKER_VERSION=1;
  const ACTIVE_STATE_ID='active';
  const STATES=Object.freeze(['localstorage_active','staging_ready','cutover_in_progress','indexeddb_active','recovery_required']);
  const CUTOVER_LOCK_NAME='investment-workbench-main-state-write-v1';

  function dependency(name){
    if(!root[name])throw new Error(`InvestmentStorage.${name} must load before cutover-v1.js.`);
    return root[name];
  }
  function errors(){return dependency('errors')}
  function nowValue(now){return typeof now==='function'?String(now()):new Date().toISOString()}
  function freeze(value){return Object.freeze({...value})}
  function canonicalDraftId(kind,id){return `draft:${kind}:${encodeURIComponent(id)}`}
  function marker(status,values={}){
    return {
      key:MARKER_KEY,
      markerVersion:MARKER_VERSION,
      value:status==='indexeddb_active'?'indexeddb':'localStorage',
      status:status==='indexeddb_active'?'completed':status,
      storageState:status,
      activeSource:status==='indexeddb_active'?'indexeddb':'localStorage',
      legacySource:'localStorage',
      migrationId:values.migrationId||dependency('migrationV1').MIGRATION_ID,
      cutoverAt:values.cutoverAt||null,
      sourceChecksum:values.sourceChecksum||'',
      semanticChecksum:values.semanticChecksum||'',
      stagingChecksum:values.stagingChecksum||'',
      errorCode:values.errorCode||null,
      revision:Number.isSafeInteger(values.revision)&&values.revision>=0?values.revision:0,
      updatedAt:values.updatedAt||null
    };
  }
  function parseMarker(value){
    if(value===null||value===undefined)return freeze({status:'localstorage_active',activeSource:'localStorage',markerStatus:'missing',record:null});
    if(value&&value.key===MARKER_KEY&&value.value==='localStorage'&&!value.status)return freeze({status:'localstorage_active',activeSource:'localStorage',markerStatus:'legacy',record:value});
    const persistentState=value&&value.status==='completed'?'indexeddb_active':value&&value.status;
    if(value&&value.key===MARKER_KEY&&value.markerVersion===MARKER_VERSION&&STATES.includes(persistentState)&&(!value.storageState||value.storageState===persistentState)){
      const expected=persistentState==='indexeddb_active'?'indexeddb':'localStorage';
      if(value.activeSource!==expected||value.value!==expected)return freeze({status:'recovery_required',activeSource:null,markerStatus:'invalid',record:value});
      return freeze({status:persistentState,activeSource:value.activeSource,markerStatus:'valid',record:value});
    }
    return freeze({status:'recovery_required',activeSource:null,markerStatus:'invalid',record:value});
  }

  function create(options={}){
    const localAdapter=options.localAdapter;
    const idbAdapter=options.idbAdapter;
    const checksumOptions=options.checksumOptions||{};
    const now=options.now;
    const hooks=options.hooks||{};
    if(!localAdapter||!idbAdapter)throw errors().create('validation_failed','cutover.create.adapters');
    const migration=dependency('migrationV1');
    const validation=dependency('validation');
    const checksum=dependency('checksum');
    const adapterKeys=localAdapter.keys||(root.local&&root.local.KEYS);
    if(!adapterKeys)throw errors().create('validation_failed','cutover.create.keys');
    const keyOrder=[adapterKeys.main,adapterKeys.planDrafts,adapterKeys.operationDrafts];

    function reconstruct(records,prefix){
      const drafts={plan_update:{},operation_entry:{}};
      records.filter(row=>row&&String(row.id||'').startsWith(prefix)).forEach(row=>{
        if(!drafts[row.kind]||typeof row.entityId!=='string'||Object.prototype.hasOwnProperty.call(drafts[row.kind],row.entityId))throw errors().create('validation_failed','cutover.drafts');
        drafts[row.kind][row.entityId]=row.payload;
      });
      return drafts;
    }
    async function envelopeChecksum(state,drafts){
      const envelope=validation.semanticEnvelope(state,drafts.plan_update,drafts.operation_entry);
      const summary=validation.validateEnvelope(envelope);
      return {envelope,summary,semanticChecksum:await checksum.semanticChecksum(envelope,checksumOptions)};
    }
    async function inspect(){
      const parsed=parseMarker(await idbAdapter.get('meta',MARKER_KEY));
      const migrationRecord=await idbAdapter.get('migration',migration.MIGRATION_ID);
      const effectiveStatus=parsed.status==='localstorage_active'&&migrationRecord&&migrationRecord.status==='ready'?'staging_ready':parsed.status;
      return freeze({...parsed,status:effectiveStatus,migrationStatus:migrationRecord&&migrationRecord.status||'not_started',migrationRecord});
    }
    async function verifyReady(){
      const raw=localAdapter.getRawSnapshot();
      const sourceChecksum=await checksum.sourceChecksum(raw,keyOrder,checksumOptions);
      const [migrationRecord,stateRecord,draftRows]=await Promise.all([
        idbAdapter.get('migration',migration.MIGRATION_ID),
        idbAdapter.get('portfolio_state',migration.STATE_STAGING_ID),
        idbAdapter.getAll('drafts')
      ]);
      if(!migrationRecord||migrationRecord.status!=='ready'||migrationRecord.completedAt!==null)throw errors().create('validation_failed','cutover.precheck.status');
      if(migrationRecord.sourceChecksum!==sourceChecksum)throw errors().create('validation_failed','cutover.precheck.source_stale');
      if(!stateRecord||stateRecord.sourceChecksum!==sourceChecksum||stateRecord.semanticChecksum!==migrationRecord.semanticChecksum)throw errors().create('validation_failed','cutover.precheck.staging');
      const drafts=reconstruct(draftRows,migration.DRAFT_STAGING_PREFIX);
      const checked=await envelopeChecksum(stateRecord.payload,drafts);
      if(checked.semanticChecksum!==migrationRecord.semanticChecksum)throw errors().create('validation_failed','cutover.precheck.semantic');
      const expected={...migrationRecord.validationSummary};
      delete expected.sourceChecksumUnchanged;delete expected.semanticChecksumReadback;delete expected.localStorageBytesUnchanged;
      if(checksum.stableSerialize(checked.summary)!==checksum.stableSerialize(expected))throw errors().create('validation_failed','cutover.precheck.summary');
      return freeze({migrationRecord,stateRecord,drafts,sourceChecksum,semanticChecksum:checked.semanticChecksum,stagingChecksum:checked.semanticChecksum,validationSummary:checked.summary});
    }
    async function verifyActive(record){
      const [stateRecord,draftRows,migrationRecord]=await Promise.all([
        idbAdapter.get('portfolio_state',ACTIVE_STATE_ID),idbAdapter.getAll('drafts'),idbAdapter.get('migration',migration.MIGRATION_ID)
      ]);
      if(!stateRecord||!migrationRecord||migrationRecord.status!=='completed')throw errors().create('validation_failed','cutover.active.records');
      const drafts=reconstruct(draftRows,'draft:');
      const checked=await envelopeChecksum(stateRecord.payload,drafts);
      if(checked.semanticChecksum!==record.semanticChecksum||stateRecord.semanticChecksum!==record.semanticChecksum||migrationRecord.semanticChecksum!==record.stagingChecksum)throw errors().create('validation_failed','cutover.active.semantic');
      return freeze({stateRecord,drafts,migrationRecord,validationSummary:checked.summary});
    }
    async function persistActiveState(payload){
      return idbAdapter.runTransaction(['meta','portfolio_state','drafts'],'readwrite',async tx=>{
        const parsed=parseMarker(await tx.get('meta',MARKER_KEY));
        if(parsed.status!=='indexeddb_active')throw errors().create('stale_tab','cutover.persist.state');
        const drafts=reconstruct(await tx.getAll('drafts'),'draft:');
        const checked=await envelopeChecksum(payload,drafts);const updatedAt=nowValue(now);
        await tx.put('portfolio_state',{id:ACTIVE_STATE_ID,schemaVersion:payload&&payload.schemaVersion||null,updatedAt,sourceChecksum:parsed.record.sourceChecksum,semanticChecksum:checked.semanticChecksum,payload});
        await tx.put('meta',{...parsed.record,semanticChecksum:checked.semanticChecksum,revision:(Number(parsed.record.revision)||0)+1,updatedAt});
        return freeze({semanticChecksum:checked.semanticChecksum,updatedAt});
      });
    }
    async function persistActiveDraft(kind,id,payload,remove){
      if(!['plan_update','operation_entry'].includes(kind)||typeof id!=='string'||!id)throw errors().create('validation_failed','cutover.persist.draft.input');
      return idbAdapter.runTransaction(['meta','portfolio_state','drafts'],'readwrite',async tx=>{
        const parsed=parseMarker(await tx.get('meta',MARKER_KEY));const stateRecord=await tx.get('portfolio_state',ACTIVE_STATE_ID);
        if(parsed.status!=='indexeddb_active'||!stateRecord)throw errors().create('stale_tab','cutover.persist.draft');
        const rows=await tx.getAll('drafts'),drafts=reconstruct(rows,'draft:');
        if(remove)delete drafts[kind][id];else drafts[kind][id]=payload;
        const checked=await envelopeChecksum(stateRecord.payload,drafts);const updatedAt=nowValue(now),draftId=canonicalDraftId(kind,id);
        if(remove)await tx.delete('drafts',draftId);else await tx.put('drafts',{id:draftId,kind,entityId:id,updatedAt,payload});
        await tx.put('portfolio_state',{...stateRecord,semanticChecksum:checked.semanticChecksum,updatedAt});
        await tx.put('meta',{...parsed.record,semanticChecksum:checked.semanticChecksum,revision:(Number(parsed.record.revision)||0)+1,updatedAt});
        return freeze({semanticChecksum:checked.semanticChecksum,updatedAt});
      });
    }
    async function resolveStartup(){
      const parsed=parseMarker(await idbAdapter.get('meta',MARKER_KEY));
      if(parsed.markerStatus==='invalid')return parsed;
      if(parsed.status==='indexeddb_active'){
        try{await verifyActive(parsed.record)}catch(_error){return freeze({status:'recovery_required',activeSource:null,markerStatus:'active_invalid',record:parsed.record})}
      }
      if(parsed.status==='cutover_in_progress')return freeze({...parsed,status:'recovery_required',activeSource:null,markerStatus:'interrupted'});
      if(parsed.status==='localstorage_active'){
        const migrationRecord=await idbAdapter.get('migration',migration.MIGRATION_ID);
        if(migrationRecord&&migrationRecord.status==='ready')return freeze({...parsed,status:'staging_ready'});
      }
      return parsed;
    }
    async function defaultExclusive(callback){
      const locks=options.lockManager||(global.navigator&&global.navigator.locks);
      if(!locks||typeof locks.request!=='function')throw errors().create('stale_tab','cutover.lock.unavailable');
      return locks.request(CUTOVER_LOCK_NAME,{mode:'exclusive'},callback);
    }
    async function setRecovery(precheck,error){
      const normalized=errors().normalize(error,'cutover.activate','write_failed');
      const recovery=marker('recovery_required',{
        migrationId:migration.MIGRATION_ID,sourceChecksum:precheck&&precheck.sourceChecksum,
        semanticChecksum:precheck&&precheck.semanticChecksum,stagingChecksum:precheck&&precheck.stagingChecksum,
        errorCode:normalized.type,updatedAt:nowValue(now)
      });
      try{await idbAdapter.put('meta',recovery)}catch(_ignored){}
      throw normalized;
    }
    async function activate(runOptions={}){
      const exclusive=runOptions.withExclusiveLock||defaultExclusive;
      return exclusive(async()=>{
        let precheck;
        try{
          const current=parseMarker(await idbAdapter.get('meta',MARKER_KEY));
          if(current.status==='indexeddb_active')return freeze({status:'indexeddb_active',activeSource:'indexeddb',alreadyActive:true,marker:current.record});
          if(current.status==='cutover_in_progress'||current.markerStatus==='invalid')throw errors().create('validation_failed','cutover.activate.recovery_required');
          precheck=await verifyReady();
          if(typeof hooks.afterPrecheck==='function')await hooks.afterPrecheck(precheck);
          const startedAt=nowValue(now);
          const inProgress=marker('cutover_in_progress',{...precheck,migrationId:migration.MIGRATION_ID,updatedAt:startedAt});
          await idbAdapter.put('meta',inProgress);
          if(typeof hooks.afterInProgress==='function')await hooks.afterInProgress(inProgress);
          const completedAt=nowValue(now);
          const finalMarker=marker('indexeddb_active',{...precheck,migrationId:migration.MIGRATION_ID,cutoverAt:completedAt,updatedAt:completedAt});
          await idbAdapter.runTransaction(['meta','portfolio_state','drafts','migration'],'readwrite',async tx=>{
            const liveMarker=parseMarker(await tx.get('meta',MARKER_KEY));
            if(liveMarker.status!=='cutover_in_progress')throw errors().create('validation_failed','cutover.transaction.marker');
            const stagingState=await tx.get('portfolio_state',migration.STATE_STAGING_ID);
            const allDrafts=await tx.getAll('drafts');
            const stagedDrafts=reconstruct(allDrafts,migration.DRAFT_STAGING_PREFIX);
            const checked=await envelopeChecksum(stagingState&&stagingState.payload,stagedDrafts);
            if(!stagingState||checked.semanticChecksum!==precheck.semanticChecksum)throw errors().create('validation_failed','cutover.transaction.readback');
            const deletes=allDrafts.filter(row=>row&&String(row.id||'').startsWith('draft:')).map(row=>tx.delete('drafts',row.id));
            await Promise.all(deletes);
            await tx.put('portfolio_state',{id:ACTIVE_STATE_ID,schemaVersion:stagingState.schemaVersion||null,updatedAt:completedAt,sourceChecksum:precheck.sourceChecksum,semanticChecksum:precheck.semanticChecksum,payload:stagingState.payload});
            for(const kind of ['plan_update','operation_entry'])for(const id of Object.keys(stagedDrafts[kind]).sort())await tx.put('drafts',{id:canonicalDraftId(kind,id),kind,entityId:id,updatedAt:completedAt,payload:stagedDrafts[kind][id]});
            await tx.put('migration',{...precheck.migrationRecord,status:'completed',completedAt,validatedAt:precheck.migrationRecord.validatedAt,errorCode:null});
            await tx.put('meta',finalMarker);
          });
          if(typeof hooks.afterActivationTransaction==='function')await hooks.afterActivationTransaction(finalMarker);
          await verifyActive(finalMarker);
          return freeze({status:'indexeddb_active',activeSource:'indexeddb',marker:finalMarker,validationSummary:precheck.validationSummary});
        }catch(error){return setRecovery(precheck,error)}
      });
    }
    async function useLegacy(){
      const current=parseMarker(await idbAdapter.get('meta',MARKER_KEY));
      const record=marker('localstorage_active',{
        migrationId:migration.MIGRATION_ID,
        sourceChecksum:current.record&&current.record.sourceChecksum,
        semanticChecksum:current.record&&current.record.semanticChecksum,
        stagingChecksum:current.record&&current.record.stagingChecksum,
        updatedAt:nowValue(now)
      });
      await idbAdapter.put('meta',record);
      return freeze({status:'localstorage_active',activeSource:'localStorage',marker:record});
    }
    async function assertWriteAllowed(source){
      const parsed=parseMarker(await idbAdapter.get('meta',MARKER_KEY));
      if(parsed.markerStatus==='invalid'||parsed.status==='cutover_in_progress'||parsed.status==='recovery_required')throw errors().create('stale_tab','cutover.write.recovery');
      if(source==='localStorage'&&parsed.status==='indexeddb_active')throw errors().create('stale_tab','cutover.write.legacy');
      if(source==='indexeddb'&&parsed.status!=='indexeddb_active')throw errors().create('stale_tab','cutover.write.indexeddb');
      return true;
    }
    return Object.freeze({inspect,verifyReady,verifyActive,resolveStartup,activate,useLegacy,assertWriteAllowed,persistActiveState,persistActiveDraft,parseMarker});
  }

  root.cutoverV1=Object.freeze({create,parseMarker,marker,MARKER_KEY,MARKER_VERSION,ACTIVE_STATE_ID,STATES,CUTOVER_LOCK_NAME});
})(typeof window!=='undefined'?window:globalThis);
