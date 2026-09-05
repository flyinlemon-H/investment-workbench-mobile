(function(){
  let session={user:{id:'11111111-1111-4111-8111-111111111111'},access_token:'fixture-session'},listener;
  window.__sharedFixture={constructions:0,subscriptions:0,inserts:0,signouts:0};
  window.UniverseSupabaseSdk={createClient:()=>{
    __sharedFixture.constructions++;
    return {auth:{getSession:async()=>({data:{session}}),onAuthStateChange:fn=>{__sharedFixture.subscriptions++;listener=fn},signOut:async()=>{__sharedFixture.signouts++;session=null;listener('SIGNED_OUT',null);return {}},signInWithPassword:async()=>{session={user:{id:'11111111-1111-4111-8111-111111111111'},access_token:'fixture-signin'};listener('SIGNED_IN',session);return {data:{session}}}},from:()=>({upsert:async()=>{__sharedFixture.inserts++;return {}}}),rpc:async(name,args)=>{
      const mock=window.__analysisSyncMock||{row:null};
      if(name==='get_analysis_module')return {data:mock.row};
      if(name==='list_analysis_modules')return {data:mock.row?[structuredClone(mock.row)]:[]};
      if(name==='publish_analysis_module'){
        if(mock.badStatus)return {data:{status:mock.badStatus}};
        if(mock.row?.payloadHash===args.p_payload_hash)return {data:{status:'no_change',module:structuredClone(mock.row)}};
        mock.writes++;mock.row={moduleType:args.p_module_type,entityKey:args.p_entity_key,moduleSchemaVersion:args.p_module_schema_version,revision:mock.row?mock.row.revision+1:1,payloadHash:args.p_payload_hash,publishedAt:'2026-09-05T00:00:00Z',payload:structuredClone(args.p_payload)};
        return {data:{status:'published',module:structuredClone(mock.row)}};
      }
      return {data:null};
    }};
  }};
})();
