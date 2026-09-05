(function(root){
  'use strict';
  // One session owner. Preserve the production SDK storage key and format.
  let client=null,session=null,ready=null,known=false,version=0;
  const listeners=new Set();
  function configuration(){
    const config=root.UNIVERSE_CLOUD_CONFIG;
    if(!config||!config.projectRef||config.url!==`https://${config.projectRef}.supabase.co`||!/^sb_publishable_[A-Za-z0-9_-]+$/.test(config.publishableKey))throw new Error('SUPABASE_CONFIG_INVALID');
    return config;
  }
  function notify(listener,event,value){
    // Never run consumer work while the SDK holds its Auth lock.
    root.setTimeout(()=>{if(listeners.has(listener))Promise.resolve().then(()=>listener(event,value)).catch(()=>{})},0);
  }
  function accept(event,value){
    value=value||null;
    if(known&&session?.access_token===value?.access_token&&session?.user?.id===value?.user?.id)return;
    known=true;session=value;version++;
    for(const listener of listeners)notify(listener,event,session);
  }
  function getClient(){
    if(client)return client;
    const config=configuration();if(!root.UniverseSupabaseSdk)throw new Error('SUPABASE_SDK_UNAVAILABLE');
    client=root.UniverseSupabaseSdk.createClient(config.url,config.publishableKey,{
      auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true,storageKey:`universe-auth-${config.projectRef}`},
      global:{fetch:async(input,init={})=>{
        const controller=new root.AbortController(),cancel=()=>controller.abort();
        if(init.signal){if(init.signal.aborted)cancel();else init.signal.addEventListener('abort',cancel,{once:true})}
        const timer=root.setTimeout(cancel,15000);
        try{return await root.fetch(input,{...init,signal:controller.signal})}
        finally{root.clearTimeout(timer);if(init.signal)init.signal.removeEventListener('abort',cancel)}
      }}
    });
    client.auth.onAuthStateChange((event,value)=>accept(event,value));
    return client;
  }
  function initialize(){
    if(!ready){const sdk=getClient(),before=version;ready=sdk.auth.getSession().then(({data,error})=>{if(error)throw error;if(version===before)accept('INITIAL_SESSION',data.session);return session}).catch(error=>{ready=null;throw error})}
    return ready;
  }
  async function getSession(){await initialize();const before=version,{data,error}=await getClient().auth.getSession();if(error)throw error;if(version===before)accept('SESSION',data.session);return session}
  async function getUser(){return (await getSession())?.user||null}
  function onAuthStateChange(listener){listeners.add(listener);if(known)notify(listener,'INITIAL_SESSION',session);void initialize().catch(()=>{});return ()=>listeners.delete(listener)}
  async function signIn(email,password){const {data,error}=await getClient().auth.signInWithPassword({email,password});if(error)throw error;accept('SIGNED_IN',data.session);return data}
  async function signUp(email,password){const {data,error}=await getClient().auth.signUp({email,password,options:{emailRedirectTo:new URL('./',root.location.href).href}});if(error)throw error;if(data.session)accept('SIGNED_IN',data.session);return data}
  async function signOut(){const {error}=await getClient().auth.signOut({scope:'local'});if(error)throw error;accept('SIGNED_OUT',null)}
  root.SupabaseBrowserClient=Object.freeze({configuration,getClient,initialize,getSession,getUser,onAuthStateChange,signIn,signUp,signOut});
})(typeof window!=='undefined'?window:globalThis);
