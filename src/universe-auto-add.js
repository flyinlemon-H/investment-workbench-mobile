(function(root,factory){
  const api=factory(root);
  if(typeof module==='object'&&module.exports)module.exports=api;
  if(root)root.UniverseAutoAdd=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(root){
  'use strict';
  const VERSION=1,UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  function projection(snapshot){
    const handoff=root.UniverseHandoff||(typeof require==='function'?require('./universe-handoff.js'):null);
    return handoff.universeRows(snapshot&&snapshot.stocks).map(row=>({symbol:row.symbol,displayName:(row.displayName||'').slice(0,120)}));
  }
  function errorState(error){
    const status=Number(error&&error.status),code=String(error&&error.code||'');
    if(status===401||code==='PGRST301'||code==='refresh_token_not_found'||code==='refresh_token_already_used')return 'auth_required';
    if(status===403||code==='42501')return 'error';
    if(error&&error.name==='TypeError'||status>=500||status===0)return 'offline';
    return 'error';
  }
  function createQueue(options){
    const storage=options.storage,key=options.key,changed=options.changed||(()=>{}),lock=options.lock||((fn)=>fn());
    let userId=null,currentStatus='pending',memory=null,serial=Promise.resolve(),pumping=null;
    function read(){
      const raw=storage.getItem(key);
      if(raw===null)return null;
      const data=JSON.parse(raw);
      if(data.schemaVersion!==VERSION||!Array.isArray(data.observed)||!Array.isArray(data.items))throw new Error('UNIVERSE_QUEUE_INVALID');
      for(const item of data.items){
        if(!item||typeof item.symbol!=='string'||!['pending','synced'].includes(item.state)||!(item.owner===null||UUID.test(item.owner))||typeof item.displayName!=='string')throw new Error('UNIVERSE_QUEUE_INVALID');
      }
      return data;
    }
    function mutate(fn){
      const operation=()=>lock(async()=>{
        let data=read();
        data=fn(data);
        storage.setItem(key,JSON.stringify(data));memory=data;changed();return data;
      });
      const task=serial.then(operation);
      serial=task.catch(()=>{currentStatus='error';changed()});
      return task;
    }
    function observe(rows,initial){
      const ownerAtCommit=userId||(memory&&memory.lastOwner)||null;
      return mutate(data=>{
        if(!data){
          // Existing stocks are a baseline, never an implicit full-state upload.
          data={schemaVersion:VERSION,observed:[],lastOwner:null,items:[]};
          if(initial){data.observed=rows.map(row=>row.symbol);return data}
        }
        const before=new Set(data.observed),owner=ownerAtCommit||data.lastOwner||null;
        for(const row of rows)if(!before.has(row.symbol)&&!data.items.some(item=>item.owner===owner&&item.symbol===row.symbol)){
          data.items.push({...row,owner,state:'pending'});
        }
        data.observed=rows.map(row=>row.symbol);return data;
      });
    }
    async function setUser(value){
      if(value!==null&&!UUID.test(value))throw new Error('UNIVERSE_USER_INVALID');
      userId=value;
      await mutate(data=>{
        data=data||{schemaVersion:VERSION,observed:[],lastOwner:null,items:[]};
        if(value){
          data.lastOwner=value;
          // Offline-before-first-login additions bind once. Account changes never move them.
          for(const item of data.items)if(item.owner===null)item.owner=value;
          const merged=new Map();
          for(const item of data.items){const id=String(item.owner)+':'+item.symbol;const prior=merged.get(id);if(!prior||item.state==='synced')merged.set(id,item)}
          data.items=[...merged.values()];
        }
        return data;
      });
      currentStatus=userId?'pending':'auth_required';changed();
    }
    function status(){
      const data=memory;
      const own=(data&&data.items||[]).filter(item=>item.owner===userId||(!userId&&item.owner===(data&&data.lastOwner||null)));
      const pending=own.filter(item=>item.state==='pending').length;
      return {state:currentStatus==='error'?'error':pending&&options.online&&options.online()===false?'offline':(!userId?'auth_required':pending?currentStatus:'synced'),pending,synced:own.length-pending,signedIn:Boolean(userId)};
    }
    async function pump(){
      if(pumping)return pumping;
      pumping=(async()=>{
        await serial;
        if(!userId){currentStatus='auth_required';changed();return}
        if(options.online&&options.online()===false){currentStatus='offline';changed();return}
        currentStatus='pending';changed();
        const activeUser=userId;
        let data;
        try{data=read();memory=data}catch(_error){currentStatus='error';changed();return}
        while(true){
          if(userId!==activeUser)return;
          try{data=read();memory=data}catch(_error){currentStatus='error';changed();return}
          const item=(data&&data.items||[]).find(item=>item.owner===activeUser&&item.state==='pending');
          if(!item)break;
          try{
            // Explicit allowlist: no snapshot, holdings, Plan or other state crosses this boundary.
            await options.insert({user_id:activeUser,symbol:item.symbol,display_name:item.displayName});
            await mutate(latest=>{for(const row of latest.items)if(row.owner===activeUser&&row.symbol===item.symbol)row.state='synced';return latest});
          }catch(error){currentStatus=errorState(error);changed();return}
        }
        currentStatus='synced';changed();
      })().finally(()=>{pumping=null});
      return pumping;
    }
    return {initialize:snapshot=>observe(projection(snapshot),true),committed:snapshot=>observe(projection(snapshot),false),setUser,pump,status,flush:()=>serial};
  }

  let queue=null,initialized=false,scheduled=null,initialization=null;
  function safeRefresh(){if(typeof root.renderUniverseCloudStatus==='function')root.renderUniverseCloudStatus()}
  function configuration(){return root.SupabaseBrowserClient.configuration()}
  function sdkClient(){return root.SupabaseBrowserClient.getClient()}
  function schedule(){
    safeRefresh();if(scheduled!==null)return;
    scheduled=root.setTimeout(()=>{scheduled=null;if(queue)void queue.pump().then(safeRefresh).catch(safeRefresh)},300);
  }
  function initialize(snapshot){
    if(initialized)return initialization;
    initialized=true;
    const config=configuration(),lockName=`universe-add-queue-${config.projectRef}`;
    queue=createQueue({storage:root.localStorage,key:lockName,changed:safeRefresh,
      lock:task=>root.navigator&&root.navigator.locks?root.navigator.locks.request(lockName,task):task(),
      online:()=>!root.navigator||root.navigator.onLine!==false,
      insert:async row=>{
        const sdk=sdkClient(),session=await root.SupabaseBrowserClient.getSession();
        if(!session||session.user.id!==row.user_id)throw {status:401};
        const result=await sdk.from('stock_universe_entries').upsert(row,{onConflict:'user_id,symbol',ignoreDuplicates:true});
        if(result.error)throw {...result.error,status:result.status};
      }
    });
    initialization=queue.initialize(snapshot).catch(safeRefresh);
    root.StorageManager.subscribeStateCommits(committed=>queue.committed(committed).then(schedule).catch(safeRefresh));
    root.addEventListener('online',schedule);
    root.addEventListener('storage',event=>{if(event.key===lockName)schedule()});
    // Auth/network is deliberately outside bootstrap/local persistence completion.
    void initialization.then(()=>{root.setTimeout(()=>{
      try{root.SupabaseBrowserClient.onAuthStateChange((_event,session)=>queue.setUser(session?.user?.id||null).then(schedule).catch(safeRefresh))}catch(_error){safeRefresh()}
    },0)});
    return initialization;
  }
  function status(){return queue?queue.status():{state:'auth_required',pending:0,synced:0,signedIn:false}}
  async function signIn(email,password){await root.SupabaseBrowserClient.signIn(email,password);return true}
  async function signUp(email,password){return Boolean((await root.SupabaseBrowserClient.signUp(email,password)).session)}
  async function signOut(){await root.SupabaseBrowserClient.signOut()}
  async function issueReader(){
    const bytes=new Uint8Array(32);root.crypto.getRandomValues(bytes);
    const token=[...bytes].map(b=>b.toString(16).padStart(2,'0')).join('');
    const {data,error}=await sdkClient().rpc('register_stock_universe_reader',{p_token:token,p_label:'DailyMarketUpdate'});
    if(error)throw error;
    return {schemaVersion:1,projectRef:configuration().projectRef,userId:data.userId,token,expiresAt:data.expiresAt};
  }
  async function readers(){const {data,error}=await sdkClient().rpc('list_stock_universe_readers');if(error)throw error;return data}
  async function revokeReader(id){const {error}=await sdkClient().rpc('revoke_stock_universe_reader',{p_id:id});if(error)throw error}
  return {createQueue,projection,errorState,initialize,status,getClient:sdkClient,signIn,signUp,signOut,issueReader,readers,revokeReader,
    retry:async()=>{if(queue){try{const session=await root.SupabaseBrowserClient.getSession();await queue.setUser(session?.user?.id||null)}catch(_error){}return queue.pump()}},
    flush:()=>queue&&queue.flush()};
});
