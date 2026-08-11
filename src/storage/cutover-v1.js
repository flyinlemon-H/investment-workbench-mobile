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
  function codedError(type,operation,errorCode){
    const error=errors().create(type,operation);
    error.errorCode=String(errorCode||type||'UNKNOWN_STORAGE_ERROR');
    return error;
  }
  function normalizedError(error,operation,fallbackType,errorCode){
    const normalized=errors().normalize(error,operation,fallbackType);
    if(!normalized.errorCode)normalized.errorCode=String(errorCode||normalized.type||'UNKNOWN_STORAGE_ERROR');
    return normalized;
  }
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
    function sameValue(left,right){return checksum.stableSerialize(left)===checksum.stableSerialize(right)}
    function stagingError(operation){return codedError('validation_failed',operation,'STAGING_STALE')}
    function activeError(operation){return codedError('validation_failed',operation,'ACTIVE_READBACK_FAILED')}
    function stateError(operation){return codedError('validation_failed',operation,'CUTOVER_STATE_MISMATCH')}
    async function inspect(){
      const parsed=parseMarker(await idbAdapter.get('meta',MARKER_KEY));
      const migrationRecord=await idbAdapter.get('migration',migration.MIGRATION_ID);
      const effectiveStatus=parsed.status==='localstorage_active'&&migrationRecord&&migrationRecord.status==='ready'?'staging_ready':parsed.status;
      return freeze({...parsed,status:effectiveStatus,migrationStatus:migrationRecord&&migrationRecord.status||'not_started',migrationRecord});
    }
    async function verifyReady(){
      try{
        const raw=localAdapter.getRawSnapshot();
        const sourceChecksum=await checksum.sourceChecksum(raw,keyOrder,checksumOptions);
        const [migrationRecord,stateRecord,draftRows]=await Promise.all([
          idbAdapter.get('migration',migration.MIGRATION_ID),
          idbAdapter.get('portfolio_state',migration.STATE_STAGING_ID),
          idbAdapter.getAll('drafts')
        ]);
        if(!migrationRecord||migrationRecord.migrationId!==migration.MIGRATION_ID||migrationRecord.status!=='ready'||migrationRecord.completedAt!==null)throw stagingError('cutover.precheck.status');
        if(migrationRecord.sourceChecksum!==sourceChecksum)throw stagingError('cutover.precheck.source_stale');
        if(!stateRecord||stateRecord.id!==migration.STATE_STAGING_ID||stateRecord.sourceChecksum!==sourceChecksum||stateRecord.semanticChecksum!==migrationRecord.semanticChecksum)throw stagingError('cutover.precheck.staging');
        const stagingRows=draftRows.filter(row=>row&&String(row.id||'').startsWith(migration.DRAFT_STAGING_PREFIX));
        const drafts=reconstruct(stagingRows,migration.DRAFT_STAGING_PREFIX);
        const checked=await envelopeChecksum(stateRecord.payload,drafts);
        if(checked.semanticChecksum!==migrationRecord.semanticChecksum)throw stagingError('cutover.precheck.semantic');
        const expected={...migrationRecord.validationSummary};
        delete expected.sourceChecksumUnchanged;delete expected.semanticChecksumReadback;delete expected.localStorageBytesUnchanged;
        if(!sameValue(checked.summary,expected))throw stagingError('cutover.precheck.summary');
        return freeze({
          migrationRecord,stateRecord,drafts,stagingRows,sourceChecksum,
          semanticChecksum:checked.semanticChecksum,stagingChecksum:checked.semanticChecksum,
          validationSummary:checked.summary
        });
      }catch(error){
        if(error&&error.type==='validation_failed'&&!error.errorCode)error.errorCode='STAGING_STALE';
        throw error;
      }
    }
    async function verifyActive(record){
      try{
        const [stateRecord,draftRows,migrationRecord]=await Promise.all([
          idbAdapter.get('portfolio_state',ACTIVE_STATE_ID),idbAdapter.getAll('drafts'),idbAdapter.get('migration',migration.MIGRATION_ID)
        ]);
        if(!record||!stateRecord||stateRecord.id!==ACTIVE_STATE_ID||!migrationRecord||migrationRecord.migrationId!==migration.MIGRATION_ID||migrationRecord.status!=='completed'||!migrationRecord.completedAt)throw activeError('cutover.active.records');
        const drafts=reconstruct(draftRows.filter(row=>row&&String(row.id||'').startsWith('draft:')),'draft:');
        const checked=await envelopeChecksum(stateRecord.payload,drafts);
        if(checked.semanticChecksum!==record.semanticChecksum||stateRecord.semanticChecksum!==record.semanticChecksum||migrationRecord.semanticChecksum!==record.stagingChecksum)throw activeError('cutover.active.semantic');
        return freeze({stateRecord,drafts,migrationRecord,validationSummary:checked.summary});
      }catch(error){
        if(error&&error.type==='validation_failed'&&!error.errorCode)error.errorCode='ACTIVE_READBACK_FAILED';
        throw error;
      }
    }
    async function persistActiveState(payload){
      const [markerRecord,stateRecord,draftRows]=await Promise.all([
        idbAdapter.get('meta',MARKER_KEY),idbAdapter.get('portfolio_state',ACTIVE_STATE_ID),idbAdapter.getAll('drafts')
      ]);
      const parsed=parseMarker(markerRecord);
      if(parsed.status!=='indexeddb_active'||!stateRecord)throw codedError('stale_tab','cutover.persist.state','ACTIVE_SOURCE_STALE');
      const drafts=reconstruct(draftRows.filter(row=>row&&String(row.id||'').startsWith('draft:')),'draft:');
      const checked=await envelopeChecksum(payload,drafts);
      const updatedAt=nowValue(now);
      const nextState={id:ACTIVE_STATE_ID,schemaVersion:payload&&payload.schemaVersion||null,updatedAt,sourceChecksum:parsed.record.sourceChecksum,semanticChecksum:checked.semanticChecksum,payload};
      const nextMarker={...parsed.record,semanticChecksum:checked.semanticChecksum,revision:(Number(parsed.record.revision)||0)+1,updatedAt};
      await idbAdapter.runTransaction(['meta','portfolio_state'],'readwrite',async tx=>{
        const [liveMarkerRecord,liveState]=await Promise.all([tx.get('meta',MARKER_KEY),tx.get('portfolio_state',ACTIVE_STATE_ID)]);
        const live=parseMarker(liveMarkerRecord);
        if(live.status!=='indexeddb_active'||!liveState||Number(live.record.revision)!==Number(parsed.record.revision)||liveState.semanticChecksum!==stateRecord.semanticChecksum)throw codedError('stale_tab','cutover.persist.state.revision','ACTIVE_REVISION_CHANGED');
        const writes=[tx.put('portfolio_state',nextState),tx.put('meta',nextMarker)];
        await Promise.all(writes);
      });
      return freeze({semanticChecksum:checked.semanticChecksum,updatedAt});
    }
    async function persistActiveDraft(kind,id,payload,remove){
      if(!['plan_update','operation_entry'].includes(kind)||typeof id!=='string'||!id)throw errors().create('validation_failed','cutover.persist.draft.input');
      const [markerRecord,stateRecord,rows]=await Promise.all([
        idbAdapter.get('meta',MARKER_KEY),idbAdapter.get('portfolio_state',ACTIVE_STATE_ID),idbAdapter.getAll('drafts')
      ]);
      const parsed=parseMarker(markerRecord);
      if(parsed.status!=='indexeddb_active'||!stateRecord)throw codedError('stale_tab','cutover.persist.draft','ACTIVE_SOURCE_STALE');
      const drafts=reconstruct(rows.filter(row=>row&&String(row.id||'').startsWith('draft:')),'draft:');
      if(remove)delete drafts[kind][id];else drafts[kind][id]=payload;
      const checked=await envelopeChecksum(stateRecord.payload,drafts);
      const updatedAt=nowValue(now),draftId=canonicalDraftId(kind,id);
      const nextState={...stateRecord,semanticChecksum:checked.semanticChecksum,updatedAt};
      const nextMarker={...parsed.record,semanticChecksum:checked.semanticChecksum,revision:(Number(parsed.record.revision)||0)+1,updatedAt};
      const draftRecord=remove?null:{id:draftId,kind,entityId:id,updatedAt,payload};
      await idbAdapter.runTransaction(['meta','portfolio_state','drafts'],'readwrite',async tx=>{
        const [liveMarkerRecord,liveState]=await Promise.all([tx.get('meta',MARKER_KEY),tx.get('portfolio_state',ACTIVE_STATE_ID)]);
        const live=parseMarker(liveMarkerRecord);
        if(live.status!=='indexeddb_active'||!liveState||Number(live.record.revision)!==Number(parsed.record.revision)||liveState.semanticChecksum!==stateRecord.semanticChecksum)throw codedError('stale_tab','cutover.persist.draft.revision','ACTIVE_REVISION_CHANGED');
        const writes=[remove?tx.delete('drafts',draftId):tx.put('drafts',draftRecord),tx.put('portfolio_state',nextState),tx.put('meta',nextMarker)];
        await Promise.all(writes);
      });
      return freeze({semanticChecksum:checked.semanticChecksum,updatedAt});
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
      const normalized=normalizedError(error,'cutover.activate','write_failed','CUTOVER_RECOVERY_REQUIRED');
      const recovery=marker('recovery_required',{
        migrationId:migration.MIGRATION_ID,sourceChecksum:precheck&&precheck.sourceChecksum,
        semanticChecksum:precheck&&precheck.semanticChecksum,stagingChecksum:precheck&&precheck.stagingChecksum,
        errorCode:normalized.errorCode,updatedAt:nowValue(now)
      });
      try{await idbAdapter.put('meta',recovery)}
      catch(markerError){throw codedError(markerError&&markerError.type||'write_failed','cutover.recovery.marker','RECOVERY_MARKER_WRITE_FAILED')}
      throw normalized;
    }
    function completedMarker(current,migrationRecord){
      return marker('indexeddb_active',{
        migrationId:migration.MIGRATION_ID,
        cutoverAt:migrationRecord.completedAt,
        sourceChecksum:migrationRecord.sourceChecksum,
        semanticChecksum:migrationRecord.semanticChecksum,
        stagingChecksum:migrationRecord.semanticChecksum,
        revision:Number(current&&current.record&&current.record.revision)||0,
        updatedAt:nowValue(now)
      });
    }
    async function finalizeCompleted(current,migrationRecord){
      if(!migrationRecord||migrationRecord.status!=='completed'||!migrationRecord.completedAt)throw stateError('cutover.retry.completed.migration');
      const finalMarker=completedMarker(current,migrationRecord);
      await verifyActive(finalMarker);
      await idbAdapter.runTransaction(['meta','portfolio_state','migration'],'readwrite',async tx=>{
        const [liveMarkerRecord,liveState,liveMigration]=await Promise.all([
          tx.get('meta',MARKER_KEY),tx.get('portfolio_state',ACTIVE_STATE_ID),tx.get('migration',migration.MIGRATION_ID)
        ]);
        if(!sameValue(liveMarkerRecord,current.record)||!liveState||liveState.semanticChecksum!==finalMarker.semanticChecksum||!liveMigration||liveMigration.status!=='completed'||liveMigration.semanticChecksum!==finalMarker.stagingChecksum)throw stateError('cutover.retry.completed.changed');
        await tx.put('meta',finalMarker);
      });
      const persisted=parseMarker(await idbAdapter.get('meta',MARKER_KEY));
      if(persisted.status!=='indexeddb_active')throw activeError('cutover.retry.completed.marker_readback');
      const verified=await verifyActive(persisted.record);
      return freeze({status:'indexeddb_active',activeSource:'indexeddb',marker:persisted.record,validationSummary:verified.validationSummary,recovered:true});
    }
    async function promote(precheck,current){
      let inProgress=current&&current.status==='cutover_in_progress'?current.record:null;
      const startedAt=nowValue(now);
      if(inProgress){
        if(inProgress.sourceChecksum!==precheck.sourceChecksum||inProgress.semanticChecksum!==precheck.semanticChecksum||inProgress.stagingChecksum!==precheck.stagingChecksum)throw stateError('cutover.retry.in_progress.checksum');
      }else{
        inProgress=marker('cutover_in_progress',{...precheck,migrationId:migration.MIGRATION_ID,updatedAt:startedAt});
        try{await idbAdapter.put('meta',inProgress)}
        catch(error){throw normalizedError(error,'cutover.marker.in_progress','write_failed','CUTOVER_IN_PROGRESS_MARKER_WRITE_FAILED')}
      }
      if(typeof hooks.afterInProgress==='function')await hooks.afterInProgress(inProgress);
      const completedAt=nowValue(now);
      const finalMarker=marker('indexeddb_active',{...precheck,migrationId:migration.MIGRATION_ID,cutoverAt:completedAt,updatedAt:completedAt});
      try{
        await idbAdapter.runTransaction(['meta','portfolio_state','drafts','migration'],'readwrite',async tx=>{
          const [liveMarkerRecord,stagingState,allDrafts,liveMigration]=await Promise.all([
            tx.get('meta',MARKER_KEY),tx.get('portfolio_state',migration.STATE_STAGING_ID),tx.getAll('drafts'),tx.get('migration',migration.MIGRATION_ID)
          ]);
          const liveMarker=parseMarker(liveMarkerRecord);
          const liveStagingRows=allDrafts.filter(row=>row&&String(row.id||'').startsWith(migration.DRAFT_STAGING_PREFIX));
          const liveDrafts=reconstruct(liveStagingRows,migration.DRAFT_STAGING_PREFIX);
          if(liveMarker.status!=='cutover_in_progress'||!liveMarker.record||liveMarker.record.sourceChecksum!==precheck.sourceChecksum||liveMarker.record.semanticChecksum!==precheck.semanticChecksum)throw stateError('cutover.transaction.marker');
          if(!stagingState||!liveMigration||liveMigration.status!=='ready'||liveMigration.completedAt!==null||!sameValue(stagingState,precheck.stateRecord)||!sameValue(liveDrafts,precheck.drafts)||!sameValue(liveMigration,precheck.migrationRecord))throw stagingError('cutover.transaction.baseline_changed');
          const writes=[];
          allDrafts.filter(row=>row&&String(row.id||'').startsWith('draft:')).forEach(row=>writes.push(tx.delete('drafts',row.id)));
          writes.push(tx.put('portfolio_state',{id:ACTIVE_STATE_ID,schemaVersion:stagingState.schemaVersion||null,updatedAt:completedAt,sourceChecksum:precheck.sourceChecksum,semanticChecksum:precheck.semanticChecksum,payload:stagingState.payload}));
          for(const kind of ['plan_update','operation_entry'])for(const id of Object.keys(liveDrafts[kind]).sort())writes.push(tx.put('drafts',{id:canonicalDraftId(kind,id),kind,entityId:id,updatedAt:completedAt,payload:liveDrafts[kind][id]}));
          writes.push(tx.put('migration',{...liveMigration,status:'completed',completedAt,validatedAt:liveMigration.validatedAt,errorCode:null}));
          writes.push(tx.put('meta',finalMarker));
          await Promise.all(writes);
        });
      }catch(error){throw normalizedError(error,'cutover.transaction.promotion','write_failed','CUTOVER_PROMOTION_FAILED')}
      if(typeof hooks.afterActivationTransaction==='function')await hooks.afterActivationTransaction(finalMarker);
      const verified=await verifyActive(finalMarker);
      return freeze({status:'indexeddb_active',activeSource:'indexeddb',marker:finalMarker,validationSummary:verified.validationSummary});
    }
    async function activate(runOptions={}){
      const exclusive=runOptions.withExclusiveLock||defaultExclusive;
      return exclusive(async()=>{
        let precheck;
        try{
          const current=parseMarker(await idbAdapter.get('meta',MARKER_KEY));
          if(current.status==='indexeddb_active'){
            const verified=await verifyActive(current.record);
            return freeze({status:'indexeddb_active',activeSource:'indexeddb',alreadyActive:true,marker:current.record,validationSummary:verified.validationSummary});
          }
          if(current.status==='cutover_in_progress'||current.status==='recovery_required'||current.markerStatus==='invalid')throw stateError('cutover.activate.recovery_required');
          precheck=await verifyReady();
          if(typeof hooks.afterPrecheck==='function')await hooks.afterPrecheck(precheck);
          return await promote(precheck,current);
        }catch(error){return setRecovery(precheck,error)}
      });
    }
    async function retry(runOptions={}){
      const exclusive=runOptions.withExclusiveLock||defaultExclusive;
      return exclusive(async()=>{
        let precheck;
        try{
          const current=parseMarker(await idbAdapter.get('meta',MARKER_KEY));
          const migrationRecord=await idbAdapter.get('migration',migration.MIGRATION_ID);
          if(current.markerStatus==='invalid')throw stateError('cutover.retry.marker_invalid');
          if(current.status==='indexeddb_active'){
            const verified=await verifyActive(current.record);
            return freeze({status:'indexeddb_active',activeSource:'indexeddb',alreadyActive:true,marker:current.record,validationSummary:verified.validationSummary});
          }
          if(migrationRecord&&migrationRecord.status==='completed'){
            if(!['cutover_in_progress','recovery_required'].includes(current.status))throw stateError('cutover.retry.completed.marker');
            return await finalizeCompleted(current,migrationRecord);
          }
          if(!migrationRecord||migrationRecord.status!=='ready'||migrationRecord.completedAt!==null)throw stagingError('cutover.retry.staging_status');
          if(!['localstorage_active','cutover_in_progress','recovery_required'].includes(current.status))throw stateError('cutover.retry.state');
          precheck=await verifyReady();
          if(typeof hooks.afterPrecheck==='function')await hooks.afterPrecheck(precheck);
          return await promote(precheck,current);
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
    return Object.freeze({inspect,verifyReady,verifyActive,resolveStartup,activate,retry,useLegacy,assertWriteAllowed,persistActiveState,persistActiveDraft,parseMarker});
  }

  root.cutoverV1=Object.freeze({create,parseMarker,marker,MARKER_KEY,MARKER_VERSION,ACTIVE_STATE_ID,STATES,CUTOVER_LOCK_NAME});
})(typeof window!=='undefined'?window:globalThis);
