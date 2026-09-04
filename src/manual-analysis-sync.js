(function(root,factory){
  const api=factory(root);
  if(typeof module==='object'&&module.exports)module.exports=api;
  if(root)root.ManualAnalysisSync=Object.freeze(api);
})(typeof globalThis!=='undefined'?globalThis:this,function(root){
  'use strict';
  const ENVELOPE_FIELDS=Object.freeze(['moduleType','entityKey','moduleSchemaVersion','revision','payloadHash','publishedAt','payload']);
  const MODULE_PATTERN=/^[a-z][a-z0-9_]{0,63}$/;
  const ENTITY_PATTERN=/^[A-Z0-9][A-Z0-9._-]{0,63}$/;
  const SCHEMA_PATTERN=/^[a-z][a-z0-9-]*\.v[1-9][0-9]*$/;
  const HASH_PATTERN=/^sha256:[0-9a-f]{64}$/;

  function object(value){return Boolean(value&&typeof value==='object'&&!Array.isArray(value))}
  function clone(value){return value===undefined?undefined:JSON.parse(JSON.stringify(value))}
  function stable(value){
    if(Array.isArray(value))return `[${value.map(stable).join(',')}]`;
    if(object(value))return `{${Object.keys(value).sort().map(key=>`${JSON.stringify(key)}:${stable(value[key])}`).join(',')}}`;
    return JSON.stringify(value===undefined?null:value);
  }
  async function payloadHash(value){
    const input=new TextEncoder().encode(stable(value));
    let bytes;
    if(root.crypto&&root.crypto.subtle)bytes=new Uint8Array(await root.crypto.subtle.digest('SHA-256',input));
    else if(typeof require==='function')bytes=Uint8Array.from(require('node:crypto').createHash('sha256').update(input).digest());
    else throw new Error('SYNC_CRYPTO_UNAVAILABLE');
    return `sha256:${[...bytes].map(byte=>byte.toString(16).padStart(2,'0')).join('')}`;
  }
  function exactFields(value,fields){const keys=Object.keys(value);return keys.length===fields.length&&keys.every(key=>fields.includes(key))}
  function normalizeEnvelope(value){
    if(!object(value))return null;
    const allowedKeys=['moduleType','module_type','entityKey','entity_key','moduleSchemaVersion','module_schema_version','revision','payloadHash','payload_hash','publishedAt','published_at','payload'];
    if(Object.keys(value).some(key=>!allowedKeys.includes(key)))return null;
    const normalized={
      moduleType:value.moduleType??value.module_type,
      entityKey:value.entityKey??value.entity_key,
      moduleSchemaVersion:value.moduleSchemaVersion??value.module_schema_version,
      revision:value.revision,
      payloadHash:value.payloadHash??value.payload_hash,
      publishedAt:value.publishedAt??value.published_at,
      payload:value.payload
    };
    return normalized;
  }
  async function validateEnvelope(value){
    const envelope=normalizeEnvelope(value);
    if(!envelope||!exactFields(envelope,ENVELOPE_FIELDS))return {ok:false,code:'invalid_envelope',message:'云端更新格式无效。'};
    if(!MODULE_PATTERN.test(String(envelope.moduleType||''))||!ENTITY_PATTERN.test(String(envelope.entityKey||''))||!SCHEMA_PATTERN.test(String(envelope.moduleSchemaVersion||'')))return {ok:false,code:'invalid_identity',message:'云端更新标识无效。'};
    if(!Number.isSafeInteger(Number(envelope.revision))||Number(envelope.revision)<1||!HASH_PATTERN.test(String(envelope.payloadHash||''))||!object(envelope.payload)||!Number.isFinite(Date.parse(envelope.publishedAt)))return {ok:false,code:'invalid_envelope',message:'云端更新版本或内容无效。'};
    const digest=await payloadHash(envelope.payload);
    if(digest!==envelope.payloadHash)return {ok:false,code:'hash_mismatch',message:'云端更新完整性校验失败。'};
    return {ok:true,envelope:{...clone(envelope),revision:Number(envelope.revision)}};
  }
  function createMetadataStore(options={}){
    const storage=options.storage,key=options.key||'manual-analysis-sync-device-v1';
    function read(){
      try{const parsed=JSON.parse(storage.getItem(key)||'null');return object(parsed)&&parsed.schemaVersion===1&&object(parsed.applied)?parsed:{schemaVersion:1,applied:{}}}catch(_error){return {schemaVersion:1,applied:{}}}
    }
    function recordApplied(envelope){const data=read();data.applied[`${envelope.moduleType}:${envelope.entityKey}`]={revision:envelope.revision,payloadHash:envelope.payloadHash,appliedAt:new Date().toISOString()};storage.setItem(key,JSON.stringify(data))}
    function applied(moduleType,entityKey){return clone(read().applied[`${moduleType}:${entityKey}`]||null)}
    return Object.freeze({recordApplied,applied});
  }
  function createEngine(options={}){
    const adapters=new Map(),transport=options.transport,metadata=options.metadataStore||null;
    if(!transport)throw new Error('SYNC_TRANSPORT_REQUIRED');
    function register(adapter){
      if(!adapter||!MODULE_PATTERN.test(String(adapter.moduleType||''))||adapters.has(adapter.moduleType))throw new Error('SYNC_ADAPTER_INVALID');
      for(const method of ['serialize','validate','diff','buildCandidate','renderLabel'])if(typeof adapter[method]!=='function')throw new Error('SYNC_ADAPTER_INVALID');
      adapters.set(adapter.moduleType,adapter);return adapter;
    }
    function adapterFor(moduleType){return adapters.get(moduleType)||null}
    async function localSnapshot(adapter,state,entityKey){
      const payload=adapter.serialize(state,entityKey);
      if(payload===null)return {payload:null,payloadHash:null};
      const checked=adapter.validate(payload);if(!checked||!checked.ok)throw new Error(checked&&checked.message||'LOCAL_MODULE_INVALID');
      return {payload:clone(checked.payload||payload),payloadHash:await payloadHash(checked.payload||payload)};
    }
    async function preparePublish(moduleType,entityKey,state){
      const adapter=adapterFor(moduleType);if(!adapter)return {status:'unsupported',writes:0,message:'当前版本暂不支持此更新。'};
      const local=await localSnapshot(adapter,state,entityKey);if(!local.payload)return {status:'missing_local',writes:0,message:'本机没有可同步的长期逻辑。'};
      const rawCloud=await transport.getCurrent(moduleType,entityKey),cloud=rawCloud?await validateEnvelope(rawCloud):null;
      if(cloud&&!cloud.ok)throw new Error(cloud.message);
      if(cloud&&cloud.envelope.moduleSchemaVersion!==adapter.moduleSchemaVersion)return {status:'unsupported_schema',writes:0,message:'云端版本暂不受支持。'};
      if(cloud&&cloud.envelope.payloadHash===local.payloadHash)return {status:'no_change',writes:0,localHash:local.payloadHash,cloud:cloud.envelope,message:'本地与云端内容一致。'};
      const current=cloud&&cloud.envelope||null;
      return Object.freeze({status:'preview',writes:0,direction:'publish',moduleType,entityKey,moduleSchemaVersion:adapter.moduleSchemaVersion,localHash:local.payloadHash,payload:clone(local.payload),expectedCloudRevision:current?current.revision:0,expectedCloudHash:current?current.payloadHash:null,diff:adapter.diff(current&&current.payload||null,local.payload),label:adapter.renderLabel(entityKey,state),firstPublication:!current});
    }
    async function confirmPublish(preview,state){
      if(!preview||preview.status!=='preview'||preview.direction!=='publish')return {status:'invalid_preview',writes:0};
      const adapter=adapterFor(preview.moduleType);if(!adapter)return {status:'unsupported',writes:0};
      const local=await localSnapshot(adapter,state,preview.entityKey);
      if(local.payloadHash!==preview.localHash)return {status:'stale_local',writes:0,message:'本地长期逻辑已变化，请重新预览。'};
      const result=await transport.publish({moduleType:preview.moduleType,entityKey:preview.entityKey,moduleSchemaVersion:preview.moduleSchemaVersion,payloadHash:preview.localHash,payload:clone(preview.payload),expectedRevision:preview.expectedCloudRevision,expectedHash:preview.expectedCloudHash});
      if(!result||result.status==='conflict')return {status:'stale_cloud',writes:0,message:'云端版本已变化，请重新预览。'};
      return {status:result.status==='no_change'?'no_change':'published',writes:result.status==='no_change'?0:1,envelope:normalizeEnvelope(result.module||result.envelope||result)};
    }
    async function fetchUpdates(state){
      const rows=await transport.listCurrent(),updates=[],unsupported=[];
      for(const row of rows||[]){
        const checked=await validateEnvelope(row);if(!checked.ok){unsupported.push({code:checked.code,message:checked.message});continue}
        const envelope=checked.envelope,adapter=adapterFor(envelope.moduleType);
        if(!adapter){unsupported.push({envelope,message:'当前版本暂不支持此更新'});continue}
        if(envelope.moduleSchemaVersion!==adapter.moduleSchemaVersion){unsupported.push({envelope,message:'当前版本暂不支持此更新'});continue}
        const valid=adapter.validate(envelope.payload);if(!valid||!valid.ok){unsupported.push({envelope,message:valid&&valid.message||'云端更新内容无效'});continue}
        const local=await localSnapshot(adapter,state,envelope.entityKey);
        if(local.payloadHash!==envelope.payloadHash)updates.push(Object.freeze({envelope:clone(envelope),label:adapter.renderLabel(envelope.entityKey,state),localHash:local.payloadHash}));
      }
      return {status:'completed',writes:0,updates,unsupported};
    }
    async function prepareApply(value,state){
      const checked=await validateEnvelope(value&&value.envelope?value.envelope:value);if(!checked.ok)return {status:checked.code,writes:0,message:checked.message};
      const envelope=checked.envelope,adapter=adapterFor(envelope.moduleType);
      if(!adapter||envelope.moduleSchemaVersion!==adapter.moduleSchemaVersion)return {status:'unsupported',writes:0,message:'当前版本暂不支持此更新。'};
      const valid=adapter.validate(envelope.payload);if(!valid||!valid.ok)return {status:'invalid_payload',writes:0,message:valid&&valid.message||'云端更新内容无效。'};
      const fingerprint=typeof adapter.sourceFingerprint==='function'?adapter.sourceFingerprint(state,envelope.entityKey):(await localSnapshot(adapter,state,envelope.entityKey)).payloadHash;
      return Object.freeze({status:'preview',writes:0,direction:'apply',envelope:clone(envelope),sourceFingerprint:fingerprint,diff:adapter.diff(adapter.serialize(state,envelope.entityKey),envelope.payload),label:adapter.renderLabel(envelope.entityKey,state)});
    }
    async function confirmApply(preview,state,deps={}){
      if(!preview||preview.status!=='preview'||preview.direction!=='apply')return {status:'invalid_preview',writes:0};
      const envelope=preview.envelope,adapter=adapterFor(envelope.moduleType);if(!adapter)return {status:'unsupported',writes:0};
      const exact=await transport.getCurrent(envelope.moduleType,envelope.entityKey),checked=exact?await validateEnvelope(exact):null;
      if(!checked||!checked.ok||checked.envelope.revision!==envelope.revision||checked.envelope.payloadHash!==envelope.payloadHash)return {status:'stale_cloud',writes:0,message:'云端版本已变化，请获取最新版本。'};
      const fingerprint=typeof adapter.sourceFingerprint==='function'?adapter.sourceFingerprint(state,envelope.entityKey):(await localSnapshot(adapter,state,envelope.entityKey)).payloadHash;
      if(fingerprint!==preview.sourceFingerprint)return {status:'stale_local',writes:0,message:'本机数据已变化，请重新预览。'};
      let candidate;try{candidate=adapter.buildCandidate(state,envelope)}catch(error){return {status:'invalid_candidate',writes:0,error,message:error.message}}
      try{
        const saved=await deps.saveCandidate(candidate,{critical:true});
        if(saved===false||(saved&&saved.ok===false))throw new Error('SYNC_SAVE_FAILED');
        const next=saved&&saved.state?saved.state:candidate;if(typeof deps.adoptCandidate==='function')deps.adoptCandidate(next);
        let metadataRecorded=true;
        if(metadata)try{metadata.recordApplied(envelope)}catch(_error){metadataRecorded=false}
        return {status:'applied',writes:1,state:next,envelope,metadataRecorded};
      }catch(error){return {status:'failed',writes:0,error,message:'同步到本机失败，原有长期逻辑保持不变。'}}
    }
    return Object.freeze({register,adapterFor,preparePublish,confirmPublish,fetchUpdates,prepareApply,confirmApply});
  }
  return Object.freeze({ENVELOPE_FIELDS,stable,payloadHash,normalizeEnvelope,validateEnvelope,createMetadataStore,createEngine});
});
