(function(root){
  'use strict';
  let client=null,engine=null;
  const statuses=new Map();
  function configuration(){
    const config=root.UNIVERSE_CLOUD_CONFIG;
    if(!config||!config.projectRef||config.url!==`https://${config.projectRef}.supabase.co`||!/^sb_publishable_[A-Za-z0-9_-]+$/.test(config.publishableKey))throw new Error('ANALYSIS_SYNC_CONFIG_INVALID');
    return config;
  }
  function sdkClient(){
    if(client)return client;const config=configuration();
    if(!root.UniverseSupabaseSdk)throw new Error('ANALYSIS_SYNC_SDK_UNAVAILABLE');
    client=root.UniverseSupabaseSdk.createClient(config.url,config.publishableKey,{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true,storageKey:`universe-auth-${config.projectRef}`}});
    return client;
  }
  async function authenticated(){const sdk=sdkClient(),{data,error}=await sdk.auth.getSession();if(error)throw error;if(!data.session)throw Object.assign(new Error('ANALYSIS_SYNC_AUTH_REQUIRED'),{status:401});return sdk}
  function transport(){return {
    getCurrent:async(moduleType,entityKey)=>{const sdk=await authenticated(),{data,error}=await sdk.rpc('get_analysis_module',{p_module_type:moduleType,p_entity_key:entityKey});if(error)throw {...error,status:error.status};return data||null},
    listCurrent:async()=>{const sdk=await authenticated(),{data,error}=await sdk.rpc('list_analysis_modules');if(error)throw {...error,status:error.status};return Array.isArray(data)?data:[]},
    publish:async candidate=>{const sdk=await authenticated(),{data,error}=await sdk.rpc('publish_analysis_module',{p_module_type:candidate.moduleType,p_entity_key:candidate.entityKey,p_module_schema_version:candidate.moduleSchemaVersion,p_payload_hash:candidate.payloadHash,p_payload:candidate.payload,p_expected_revision:candidate.expectedRevision,p_expected_hash:candidate.expectedHash});if(error)throw {...error,status:error.status};return data}
  }}
  function initialize(){
    if(engine)return engine;
    const metadata=root.ManualAnalysisSync.createMetadataStore({storage:root.localStorage,key:`manual-analysis-sync-device-${configuration().projectRef}-v1`});
    engine=root.ManualAnalysisSync.createEngine({transport:transport(),metadataStore:metadata});
    engine.register(root.LongTermLogicSyncAdapter);return engine;
  }
  function key(moduleType,entityKey){return `${moduleType}:${entityKey}`}
  function markLocalChanged(entityKey){statuses.set(key('long_term_logic',entityKey),{state:'local_changed',message:'本地已更新 · 尚未同步'});if(typeof root.refreshLongLogicModalIfOpen==='function')root.refreshLongLogicModalIfOpen()}
  function mark(moduleType,entityKey,state,message){statuses.set(key(moduleType,entityKey),{state,message});if(typeof root.refreshLongLogicModalIfOpen==='function')root.refreshLongLogicModalIfOpen()}
  function statusFor(moduleType,entityKey){return statuses.get(key(moduleType,entityKey))||{state:'unknown',message:'本地已保存 · 同步状态待检查'}}
  function publisherUi(){return !root.matchMedia||root.matchMedia('(min-width: 769px)').matches}
  function mobileUi(){return !publisherUi()}
  root.ManualAnalysisSyncCloud=Object.freeze({initialize,statusFor,mark,markLocalChanged,publisherUi,mobileUi});
})(typeof window!=='undefined'?window:globalThis);
