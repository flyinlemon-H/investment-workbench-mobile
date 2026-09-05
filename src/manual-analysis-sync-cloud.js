(function(root){
  'use strict';
  let engine=null,owner;
  const statuses=new Map();
  function configuration(){return root.SupabaseBrowserClient.configuration()}
  function sdkClient(){return root.SupabaseBrowserClient.getClient()}
  function authRequired(){return Object.assign(new Error('ANALYSIS_SYNC_AUTH_REQUIRED'),{status:401})}
  async function rpc(name,args){
    const session=await root.SupabaseBrowserClient.getSession();if(!session)throw authRequired();
    const {data,error}=await sdkClient().rpc(name,args);
    const current=await root.SupabaseBrowserClient.getSession();if(!current||current.user.id!==session.user.id)throw authRequired();
    if(error)throw {...error,status:error.status};return data;
  }
  function transport(){return {
    getCurrent:async(moduleType,entityKey)=>(await rpc('get_analysis_module',{p_module_type:moduleType,p_entity_key:entityKey}))||null,
    listCurrent:async()=>{const data=await rpc('list_analysis_modules');return Array.isArray(data)?data:[]},
    publish:candidate=>rpc('publish_analysis_module',{p_module_type:candidate.moduleType,p_entity_key:candidate.entityKey,p_module_schema_version:candidate.moduleSchemaVersion,p_payload_hash:candidate.payloadHash,p_payload:candidate.payload,p_expected_revision:candidate.expectedRevision,p_expected_hash:candidate.expectedHash})
  }}
  function initialize(){
    if(engine)return engine;
    const metadata=root.ManualAnalysisSync.createMetadataStore({storage:root.localStorage,key:`manual-analysis-sync-device-${configuration().projectRef}-v1`});
    engine=root.ManualAnalysisSync.createEngine({transport:transport(),metadataStore:metadata});
    engine.register(root.LongTermLogicSyncAdapter);
    root.SupabaseBrowserClient.onAuthStateChange((_event,session)=>{
      const next= session?.user?.id||null;if(owner===next)return;owner=next;
      statuses.clear();
      if(typeof root.invalidateAnalysisSyncPreview==='function')root.invalidateAnalysisSyncPreview();
      if(typeof root.refreshLongLogicModalIfOpen==='function')root.refreshLongLogicModalIfOpen();
    });return engine;
  }
  function key(moduleType,entityKey){return `${moduleType}:${entityKey}`}
  function markLocalChanged(entityKey){statuses.set(key('long_term_logic',entityKey),{state:'local_changed',message:'本地已更新 · 尚未同步'});if(typeof root.refreshLongLogicModalIfOpen==='function')root.refreshLongLogicModalIfOpen();if(typeof root.renderStockDetail==='function')root.renderStockDetail()}
  function mark(moduleType,entityKey,state,message){statuses.set(key(moduleType,entityKey),{state,message});if(typeof root.refreshLongLogicModalIfOpen==='function')root.refreshLongLogicModalIfOpen();if(typeof root.renderStockDetail==='function')root.renderStockDetail()}
  function statusFor(moduleType,entityKey){return statuses.get(key(moduleType,entityKey))||{state:'unknown',message:'本地已保存 · 同步状态待检查'}}
  // Browser-local workflow preference, never an authorization role. RLS owns access.
  const ROLE_KEY='analysis_sync_role';
  function role(){try{return root.localStorage.getItem(ROLE_KEY)==='publisher'?'publisher':'receiver'}catch(_error){return 'receiver'}}
  function setRole(value){if(!['publisher','receiver'].includes(value))throw new Error('ANALYSIS_SYNC_ROLE_INVALID');root.localStorage.setItem(ROLE_KEY,value);roleChanged()}
  function roleChanged(){if(typeof root.invalidateAnalysisSyncPreview==='function')root.invalidateAnalysisSyncPreview();if(typeof root.initializeManualAnalysisSyncUi==='function')root.initializeManualAnalysisSyncUi();if(typeof root.refreshLongLogicModalIfOpen==='function')root.refreshLongLogicModalIfOpen();if(typeof root.renderStockDetail==='function')root.renderStockDetail()}
  if(root.addEventListener)root.addEventListener('storage',event=>{if(event.key===ROLE_KEY||event.key===null)roleChanged()});
  function publisherUi(){return role()==='publisher'}
  function mobileUi(){return !publisherUi()}
  root.ManualAnalysisSyncCloud=Object.freeze({initialize,getClient:sdkClient,statusFor,mark,markLocalChanged,publisherUi,mobileUi,role,setRole,ROLE_KEY});
})(typeof window!=='undefined'?window:globalThis);
