/* Password recovery intent only. Supabase remains the sole credential/session owner. */
(function(root,factory){
  const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.AuthPasswordRecovery=api;
})(typeof window!=='undefined'?window:globalThis,function(){
  'use strict';
  const PRODUCTION='fntslvdxnupmdljnadec',TEST='lblyapnsngqnjimgskkp';
  const PRODUCTION_URL='https://flyinlemon-h.github.io/investment-workbench-mobile/';
  const MIN_LENGTH=8,MAX_AGE=30*60*1000;
  const messages={email:'请输入有效邮箱地址。',rate:'请求过于频繁，请稍后再试。',network:'网络连接失败，请稍后重试。',service:'暂时无法完成请求，请稍后重试。',expired:'密码重置链接已失效，请重新发送。',password:'请输入至少 8 位的新密码。',mismatch:'两次输入的密码不一致。',weak:'密码不符合账户安全要求，请换一个更安全的密码。',same:'新密码不能与原密码相同。',busy:'请求正在处理中，请稍候。',redirect:'当前页面不能发送密码重置邮件，请打开正式应用。'};
  function fault(code){return Object.assign(new Error(messages[code]||messages.service),{code})}
  function category(error){
    if(error?.status===429||['over_email_send_rate_limit','over_request_rate_limit'].includes(error?.code))return 'rate';
    if(error?.name==='AuthRetryableFetchError'||error?.name==='AbortError'||error?.name==='TypeError'||error?.status===0)return 'network';
    if(error?.code==='weak_password')return 'weak';
    if(error?.code==='same_password')return 'same';
    if(error?.status===401||error?.status===403||['session_not_found','session_expired','refresh_token_not_found','refresh_token_already_used','bad_jwt','user_not_found','reauthentication_needed'].includes(error?.code))return 'expired';
    return 'service';
  }
  function create({root,getClient,configuration,signOut}){
    const listeners=new Set();let state={status:'idle'},generation=0,started=false,eventSeen=false,updating=false,sending=false,expiryTimer=null;
    let pending=null,owner=null,deadline=0;
    const url=new URL(root.location.href),intent=url.searchParams.get('auth')==='recovery'||new URLSearchParams(url.hash.slice(1)).get('type')==='recovery';
    const hasCallback=['access_token','refresh_token','code','error','error_code'].some(key=>url.searchParams.has(key)||new URLSearchParams(url.hash.slice(1)).has(key));
    const key=()=>`auth-recovery-intent-${configuration().projectRef}`;
    function readMarker(){try{const m=JSON.parse(root.sessionStorage.getItem(key()));return m&&typeof m.userId==='string'&&Number.isFinite(m.until)&&m.until>Date.now()&&m.until<=Date.now()+MAX_AGE?m:null}catch(_error){return null}}
    function clearMarker(){try{root.sessionStorage.removeItem(key())}catch(_error){}}
    function saveMarker(){try{root.sessionStorage.setItem(key(),JSON.stringify({userId:owner,until:deadline}))}catch(_error){/* Current page still works when storage is unavailable. */}}
    function cleanUrl(done=false){
      try{const next=new URL(root.location.href);next.hash='';for(const k of ['access_token','refresh_token','token','token_hash','code','error','error_code','error_description','expires_in','expires_at','token_type','type'])next.searchParams.delete(k);if(done)next.searchParams.delete('auth');root.history.replaceState(root.history.state,'',next.pathname+next.search)}catch(_error){}
    }
    function publish(status){state={status};for(const listener of listeners)listener({...state})}
    function clear(){generation++;owner=null;deadline=0;clearMarker();if(expiryTimer)root.clearTimeout(expiryTimer);expiryTimer=null}
    function expire(){clear();cleanUrl();publish('expired')}
    function reset(){const active=intent||state.status!=='idle'||readMarker();clear();if(active)cleanUrl(true);publish('idle')}
    function arm(){if(expiryTimer)root.clearTimeout(expiryTimer);expiryTimer=root.setTimeout(()=>expire(),Math.max(0,deadline-Date.now()))}
    async function validate(userId,until,epoch){
      try{
        const {data,error}=await getClient().auth.getUser();
        if(epoch!==generation)return;
        if(error||!data?.user||data.user.id!==userId||until<=Date.now()){expire();return}
        owner=userId;deadline=until;saveMarker();cleanUrl();publish('ready');arm();
      }catch(_error){if(epoch===generation)expire()}
    }
    function accept(event,value){
      if(event==='PASSWORD_RECOVERY'){
        eventSeen=true;clear();publish('checking');
        if(!value?.user?.id){expire();return}
        const epoch=generation,until=Math.min(Date.now()+MAX_AGE,Number.isFinite(value.expires_at)?value.expires_at*1000:Infinity);
        // Leave the SDK Auth callback before making any further SDK calls.
        pending=new Promise(resolve=>root.setTimeout(()=>resolve(validate(value.user.id,until,epoch)),0));
      }else if(event==='SIGNED_OUT'){
        const active=['ready','checking','updating'].includes(state.status);clear();publish(active?'expired':'idle');
      }else if(owner&&value?.user?.id&&value.user.id!==owner){expire()}
    }
    async function start(){
      if(started)return;started=true;
      const marker=readMarker();if(intent||marker)publish('checking');
      try{
        const sdk=getClient();const initialized=await sdk.auth.initialize();
        await new Promise(resolve=>root.setTimeout(resolve,0));
        if(eventSeen){await pending;return}
        if(intent&&(initialized.error||hasCallback)){expire();return}
        if(marker){const {data,error}=await sdk.auth.getSession();if(error||data?.session?.user?.id!==marker.userId){expire();return}await validate(marker.userId,marker.until,generation);return}
        if(intent)expire();
      }catch(_error){if(intent||marker)expire()}
    }
    function redirectTo(){
      const ref=configuration().projectRef,here=new URL(root.location.href);let destination;
      if(ref===PRODUCTION)destination=new URL(PRODUCTION_URL);
      else if(ref===TEST&&['localhost','127.0.0.1','[::1]'].includes(here.hostname)&&['http:','https:'].includes(here.protocol))destination=new URL('./',here);
      else throw fault('redirect');
      destination.search='?auth=recovery';destination.hash='';return destination.href;
    }
    async function request(email){
      email=String(email||'').trim();if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)||email.length>254)throw fault('email');
      if(sending)throw fault('busy');sending=true;
      try{
        const destination=redirectTo(),{error}=await getClient().auth.resetPasswordForEmail(email,{redirectTo:destination});
        if(error&&!['user_not_found','email_not_confirmed'].includes(error.code))throw fault(['email_address_invalid','validation_failed'].includes(error.code)?'email':category(error));
        return '如果该邮箱已注册，我们会发送密码重置邮件。请查看收件箱和垃圾邮件。';
      }catch(error){throw fault(messages[error?.code]?error.code:category(error))}finally{sending=false}
    }
    async function update(password,confirmation){
      if(typeof password!=='string'||password.length<MIN_LENGTH)throw fault('password');
      if(password!==confirmation)throw fault('mismatch');
      if(updating)throw fault('busy');
      if(state.status!=='ready'||!owner||deadline<=Date.now()){expire();throw fault('expired')}
      const epoch=generation,userId=owner;updating=true;if(expiryTimer)root.clearTimeout(expiryTimer);expiryTimer=null;publish('updating');
      try{
        const sdk=getClient(),{data,error}=await sdk.auth.getUser();
        if(error)throw fault(category(error));
        if(epoch!==generation||data?.user?.id!==userId||deadline<=Date.now())throw fault('expired');
        const result=await sdk.auth.updateUser({password});
        if(result.error)throw fault(category(result.error));
        if(epoch!==generation||result.data?.user?.id!==userId)throw fault('expired');
        clear();cleanUrl(true);publish('success');return true;
      }catch(error){
        const code=messages[error?.code]?error.code:category(error);
        if(code==='expired'||deadline<=Date.now())expire();else if(epoch===generation){publish('ready');arm()}
        throw fault(code);
      }finally{updating=false;password=null;confirmation=null}
    }
    async function cancel(){if(['ready','updating','checking'].includes(state.status))await signOut();reset()}
    return Object.freeze({accept,start,request,update,cancel,reset,redirectTo,getState:()=>({...state}),subscribe(listener){listeners.add(listener);listener({...state});return ()=>listeners.delete(listener)},minLength:MIN_LENGTH});
  }
  return {create,MIN_LENGTH,PRODUCTION_URL};
});
