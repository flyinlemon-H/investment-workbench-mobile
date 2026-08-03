(function storageMigrationV1Module(global){
  'use strict';

  const root=global.InvestmentStorage=global.InvestmentStorage||{};
  const MIGRATION_ID='localstorage-to-idb-v1';
  const STATE_STAGING_ID=`staging:migration:${MIGRATION_ID}`;
  const DRAFT_STAGING_PREFIX=`staging:migration:${MIGRATION_ID}:draft:`;
  const ALLOWED_STATUSES=Object.freeze(['not_started','copying','validating','ready','failed']);
  const STAGING_OVERHEAD_BYTES=64*1024;

  function dependency(name){
    if(!root[name])throw new Error(`InvestmentStorage.${name} must load before migration-v1.js.`);
    return root[name];
  }
  function storageErrors(){return dependency('errors')}
  function nowValue(now){return typeof now==='function'?String(now()):new Date().toISOString()}
  function defaultRecord(sourceKeysPresent=[]){
    return Object.freeze({
      migrationId:MIGRATION_ID,
      sourceChecksum:'',
      semanticChecksum:'',
      status:'not_started',
      startedAt:null,
      validatedAt:null,
      completedAt:null,
      errorCode:null,
      sourceKeysPresent:Object.freeze([...sourceKeysPresent]),
      validationSummary:Object.freeze({sourceDetected:sourceKeysPresent.length>0})
    });
  }
  function parseRaw(raw,key,missingValue,operation){
    if(raw[key]===null)return missingValue;
    try{return JSON.parse(raw[key])}
    catch(_error){throw storageErrors().create('validation_failed',operation)}
  }
  function sameRaw(left,right,keyOrder){return keyOrder.every(key=>left[key]===right[key])}
  function draftRecord(kind,entityId,payload){
    return {
      id:`${DRAFT_STAGING_PREFIX}${kind}:${encodeURIComponent(entityId)}`,
      kind,
      entityId,
      updatedAt:null,
      payload
    };
  }

  function create(options={}){
    const localAdapter=options.localAdapter;
    const idbAdapter=options.idbAdapter;
    const normalizeState=options.normalizeState;
    const clone=options.clone||global.structuredClone;
    const now=options.now;
    const checksumOptions=options.checksumOptions||{};
    const hooks=options.hooks||{};
    if(!localAdapter||!idbAdapter)throw storageErrors().create('validation_failed','migration.create.adapters');

    const keyOrder=[localAdapter.keys.main,localAdapter.keys.planDrafts,localAdapter.keys.operationDrafts];
    function sourceKeys(raw){return keyOrder.filter(key=>raw[key]!==null)}
    async function checksumSource(raw){return dependency('checksum').sourceChecksum(raw,keyOrder,checksumOptions)}
    async function checksumSemantic(envelope){return dependency('checksum').semanticChecksum(envelope,checksumOptions)}
    function notify(record,onStatus){if(typeof onStatus==='function')onStatus(Object.freeze({...record}))}

    async function getStatus(){
      const existing=await idbAdapter.get('migration',MIGRATION_ID);
      if(existing){
        if(!ALLOWED_STATUSES.includes(existing.status)||existing.completedAt!==null)throw storageErrors().create('validation_failed','migration.status.record');
        return Object.freeze({...existing,sourceKeysPresent:Object.freeze([...(existing.sourceKeysPresent||[])])});
      }
      const raw=localAdapter.getRawSnapshot();
      return defaultRecord(sourceKeys(raw));
    }

    function utf8Length(value){return new TextEncoder().encode(String(value||'')).length}
    async function getPreflightSummary(){
      const raw=localAdapter.getRawSnapshot();
      const present=sourceKeys(raw);
      if(present.length===0)return Object.freeze({
        activeSource:'localStorage',sourceKeysPresent:Object.freeze([]),mainStateBytes:0,sourceBytes:0,
        stocksCount:0,planDraftsCount:0,operationDraftsCount:0,sourceChecksumPrefix:'',
        estimatedStagingBytes:0,safetyMarginBytes:0,requiredAvailableBytes:0
      });
      const main=parseRaw(raw,localAdapter.keys.main,{stocks:[],updatedAt:null},'migration.preflight.main');
      const planDrafts=parseRaw(raw,localAdapter.keys.planDrafts,{},'migration.preflight.planDrafts');
      const operationDrafts=parseRaw(raw,localAdapter.keys.operationDrafts,{},'migration.preflight.operationDrafts');
      const validation=dependency('validation');
      if(!validation.isPlainObject(main)||!validation.isPlainObject(planDrafts)||!validation.isPlainObject(operationDrafts))throw storageErrors().create('validation_failed','migration.preflight.shape');
      if(typeof normalizeState!=='function'||typeof clone!=='function')throw storageErrors().create('validation_failed','migration.preflight.normalize');
      const normalizedState=normalizeState(clone(main));
      const envelope=validation.semanticEnvelope(normalizedState,clone(planDrafts),clone(operationDrafts));
      const summary=validation.validateEnvelope(envelope);
      const sourceChecksumValue=await checksumSource(raw);
      const semanticBytes=utf8Length(dependency('checksum').stableSerialize(envelope));
      const mainStateBytes=raw[localAdapter.keys.main]===null?0:utf8Length(raw[localAdapter.keys.main]);
      const sourceBytes=keyOrder.reduce((total,key)=>total+(raw[key]===null?0:utf8Length(raw[key])),0);
      const estimatedStagingBytes=Math.ceil(Math.max(sourceBytes,semanticBytes)*1.25)+STAGING_OVERHEAD_BYTES;
      const safetyMarginBytes=estimatedStagingBytes;
      return Object.freeze({
        activeSource:'localStorage',sourceKeysPresent:Object.freeze([...present]),mainStateBytes,sourceBytes,
        stocksCount:summary.stocksCount,planDraftsCount:summary.planDraftsCount,operationDraftsCount:summary.operationDraftsCount,
        sourceChecksumPrefix:sourceChecksumValue.slice(0,10),estimatedStagingBytes,safetyMarginBytes,
        requiredAvailableBytes:estimatedStagingBytes+safetyMarginBytes
      });
    }

    async function deleteStagingInTransaction(tx){
      const drafts=await tx.getAll('drafts');
      const deletes=drafts.filter(record=>record&&String(record.id||'').startsWith(DRAFT_STAGING_PREFIX)).map(record=>tx.delete('drafts',record.id));
      deletes.push(tx.delete('portfolio_state',STATE_STAGING_ID));
      await Promise.all(deletes);
    }

    async function clearStaging(){
      await idbAdapter.runTransaction(['portfolio_state','drafts','migration'],'readwrite',async tx=>{
        await deleteStagingInTransaction(tx);
        await tx.delete('migration',MIGRATION_ID);
      });
      return defaultRecord(sourceKeys(localAdapter.getRawSnapshot()));
    }

    async function writeCopy(records){
      await idbAdapter.runTransaction(['portfolio_state','drafts','migration'],'readwrite',async tx=>{
        await deleteStagingInTransaction(tx);
        const writes=[tx.put('portfolio_state',records.stateRecord),tx.put('migration',records.migrationRecord)];
        records.draftRecords.forEach(record=>writes.push(tx.put('drafts',record)));
        await Promise.all(writes);
      });
    }

    async function readStaging(){
      return idbAdapter.runTransaction(['portfolio_state','drafts','migration'],'readonly',async tx=>{
        const [stateRecord,drafts,migrationRecord]=await Promise.all([
          tx.get('portfolio_state',STATE_STAGING_ID),
          tx.getAll('drafts'),
          tx.get('migration',MIGRATION_ID)
        ]);
        return {stateRecord,draftRecords:drafts.filter(record=>record&&String(record.id||'').startsWith(DRAFT_STAGING_PREFIX)),migrationRecord};
      });
    }

    function reconstructDrafts(records){
      const plan={};
      const operation={};
      records.forEach(record=>{
        if(!record||typeof record.entityId!=='string')throw storageErrors().create('validation_failed','migration.readback.draft');
        const target=record.kind==='plan_update'?plan:record.kind==='operation_entry'?operation:null;
        if(!target||Object.prototype.hasOwnProperty.call(target,record.entityId))throw storageErrors().create('validation_failed','migration.readback.draft');
        target[record.entityId]=record.payload;
      });
      return {plan,operation};
    }

    async function markFailed(error,context){
      const normalized=storageErrors().normalize(error,'migration.shadow','validation_failed');
      if(context&&context.sourceChecksum){
        const failed={
          migrationId:MIGRATION_ID,
          sourceChecksum:context.sourceChecksum,
          semanticChecksum:context.semanticChecksum||'',
          status:'failed',
          startedAt:context.startedAt||null,
          validatedAt:null,
          completedAt:null,
          errorCode:normalized.type,
          sourceKeysPresent:[...(context.sourceKeysPresent||[])],
          validationSummary:{}
        };
        try{await idbAdapter.put('migration',failed)}catch(_writeError){}
        notify(failed,context.onStatus);
      }
      throw normalized;
    }

    async function validateStagingAndReady(rawBefore,context,expectedSummary,onStatus){
      const validation=dependency('validation');
      const validating={
        migrationId:MIGRATION_ID,sourceChecksum:context.sourceChecksum,semanticChecksum:context.semanticChecksum,status:'validating',
        startedAt:context.startedAt,validatedAt:null,completedAt:null,errorCode:null,
        sourceKeysPresent:[...context.sourceKeysPresent],validationSummary:{}
      };
      await idbAdapter.put('migration',validating);
      notify(validating,onStatus);
      if(typeof hooks.beforeReadback==='function')await hooks.beforeReadback();
      const readback=await readStaging();
      if(!readback.stateRecord||readback.stateRecord.id!==STATE_STAGING_ID||!readback.migrationRecord||readback.migrationRecord.status!=='validating')throw storageErrors().create('validation_failed','migration.readback.records');
      if(readback.stateRecord.sourceChecksum!==context.sourceChecksum||readback.stateRecord.semanticChecksum!==context.semanticChecksum)throw storageErrors().create('validation_failed','migration.readback.checksum');
      const restoredDrafts=reconstructDrafts(readback.draftRecords);
      const readbackEnvelope=validation.semanticEnvelope(readback.stateRecord.payload,restoredDrafts.plan,restoredDrafts.operation);
      const readbackSummary=validation.validateEnvelope(readbackEnvelope);
      const readbackSemanticChecksum=await checksumSemantic(readbackEnvelope);
      if(readbackSemanticChecksum!==context.semanticChecksum)throw storageErrors().create('validation_failed','migration.readback.semantic');
      if(expectedSummary&&dependency('checksum').stableSerialize(readbackSummary)!==dependency('checksum').stableSerialize(expectedSummary))throw storageErrors().create('validation_failed','migration.readback.summary');
      if(typeof hooks.beforeSourceRecheck==='function')await hooks.beforeSourceRecheck();
      const rawAfter=localAdapter.getRawSnapshot();
      const sourceChecksumAfter=await checksumSource(rawAfter);
      if(sourceChecksumAfter!==context.sourceChecksum||!sameRaw(rawBefore,rawAfter,keyOrder))throw storageErrors().create('validation_failed','migration.source.changed');
      const ready={
        migrationId:MIGRATION_ID,sourceChecksum:context.sourceChecksum,semanticChecksum:context.semanticChecksum,status:'ready',
        startedAt:context.startedAt,validatedAt:nowValue(now),completedAt:null,errorCode:null,
        sourceKeysPresent:[...context.sourceKeysPresent],
        validationSummary:{...readbackSummary,sourceChecksumUnchanged:true,semanticChecksumReadback:true,localStorageBytesUnchanged:true}
      };
      await idbAdapter.put('migration',ready);
      notify(ready,onStatus);
      return Object.freeze({...ready,sourceKeysPresent:Object.freeze([...ready.sourceKeysPresent]),validationSummary:Object.freeze({...ready.validationSummary})});
    }

    async function runShadowMigration(runOptions={}){
      const onStatus=runOptions.onStatus;
      const context={onStatus,sourceChecksum:'',semanticChecksum:'',sourceKeysPresent:[],startedAt:null};
      try{
        const rawBefore=localAdapter.getRawSnapshot();
        context.sourceKeysPresent=sourceKeys(rawBefore);
        if(context.sourceKeysPresent.length===0)return defaultRecord([]);
        context.sourceChecksum=await checksumSource(rawBefore);
        const existing=await idbAdapter.get('migration',MIGRATION_ID);
        if(existing&&existing.status==='ready'&&existing.sourceChecksum===context.sourceChecksum&&existing.completedAt===null)return Object.freeze({...existing});
        if(existing&&existing.status==='validating'&&existing.sourceChecksum===context.sourceChecksum&&existing.completedAt===null){
          context.semanticChecksum=existing.semanticChecksum;
          context.startedAt=existing.startedAt;
          return await validateStagingAndReady(rawBefore,context,null,onStatus);
        }

        const main=parseRaw(rawBefore,localAdapter.keys.main,{stocks:[],updatedAt:null},'migration.parse.main');
        const planDrafts=parseRaw(rawBefore,localAdapter.keys.planDrafts,{},'migration.parse.planDrafts');
        const operationDrafts=parseRaw(rawBefore,localAdapter.keys.operationDrafts,{},'migration.parse.operationDrafts');
        const validation=dependency('validation');
        if(!validation.isPlainObject(main)||!validation.isPlainObject(planDrafts)||!validation.isPlainObject(operationDrafts))throw storageErrors().create('validation_failed','migration.parse.shape');
        if(typeof normalizeState!=='function'||typeof clone!=='function')throw storageErrors().create('validation_failed','migration.normalize.unavailable');
        const normalizedState=normalizeState(clone(main));
        const envelope=validation.semanticEnvelope(normalizedState,clone(planDrafts),clone(operationDrafts));
        const validationSummary=validation.validateEnvelope(envelope);
        context.semanticChecksum=await checksumSemantic(envelope);
        context.startedAt=nowValue(now);

        const copying={
          migrationId:MIGRATION_ID,sourceChecksum:context.sourceChecksum,semanticChecksum:context.semanticChecksum,status:'copying',
          startedAt:context.startedAt,validatedAt:null,completedAt:null,errorCode:null,
          sourceKeysPresent:[...context.sourceKeysPresent],validationSummary:{}
        };
        notify(copying,onStatus);
        const draftRecords=[];
        Object.keys(envelope.drafts.plan_update).sort().forEach(key=>draftRecords.push(draftRecord('plan_update',key,envelope.drafts.plan_update[key])));
        Object.keys(envelope.drafts.operation_entry).sort().forEach(key=>draftRecords.push(draftRecord('operation_entry',key,envelope.drafts.operation_entry[key])));
        await writeCopy({
          stateRecord:{id:STATE_STAGING_ID,schemaVersion:normalizedState.schemaVersion||normalizedState.alpha3DataVersion||null,updatedAt:null,sourceChecksum:context.sourceChecksum,semanticChecksum:context.semanticChecksum,payload:normalizedState},
          draftRecords,
          migrationRecord:copying
        });
        if(typeof hooks.afterStaging==='function')await hooks.afterStaging();
        return await validateStagingAndReady(rawBefore,context,validationSummary,onStatus);
      }catch(error){return markFailed(error,context)}
    }

    return Object.freeze({getStatus,getPreflightSummary,runShadowMigration,clearStaging});
  }

  root.migrationV1=Object.freeze({
    create,
    MIGRATION_ID,
    STATE_STAGING_ID,
    DRAFT_STAGING_PREFIX,
    ALLOWED_STATUSES,
    STAGING_OVERHEAD_BYTES
  });
})(typeof window!=='undefined'?window:globalThis);
