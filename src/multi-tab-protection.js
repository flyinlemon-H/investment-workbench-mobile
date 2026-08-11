(function multiTabProtectionModule(global){
  'use strict';

  const CHANNEL_NAME='investment-workbench-multitab-v1';
  const LOCK_NAME='investment-workbench-main-state-write-v1';
  const DRAFT_LOCK_PREFIX='investment-workbench-draft-write-v1';
  const MAIN_KEY='portfolio_manual_v502_network_price_20260610';
  const DRAFT_KEYS=Object.freeze({plan_update:'v13_plan_update_drafts_v1',operation_entry:'v13_operation_entry_drafts_v1'});

  function clone(value){return typeof global.structuredClone==='function'?global.structuredClone(value):JSON.parse(JSON.stringify(value))}
  function revisionOf(value){
    if(!value||typeof value!=='object'||Array.isArray(value))return 'empty';
    const updatedAt=value.updatedAt===null||value.updatedAt===undefined?'null':String(value.updatedAt);
    const stocks=Array.isArray(value.stocks)?value.stocks.length:'invalid';
    return `${updatedAt}:${stocks}`;
  }
  function stableSerialize(value){
    if(Array.isArray(value))return '['+value.map(stableSerialize).join(',')+']';
    if(value&&typeof value==='object')return '{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+stableSerialize(value[key])).join(',')+'}';
    return JSON.stringify(value);
  }
  function draftRevisionOf(value){
    if(value===null||value===undefined)return 'missing';
    const serialized=stableSerialize(value);let first=2166136261;let second=5381;
    for(let index=0;index<serialized.length;index++){
      const code=serialized.charCodeAt(index);first=Math.imul(first^code,16777619);second=Math.imul(second,33)^code;
    }
    return `${serialized.length}:${(first>>>0).toString(16).padStart(8,'0')}:${(second>>>0).toString(16).padStart(8,'0')}`;
  }
  function draftResource(kind,id){return `${kind}:${String(id)}`}
  function staleError(){
    const errors=global.InvestmentStorage&&global.InvestmentStorage.errors;
    return errors&&typeof errors.create==='function'?errors.create('stale_tab','multiTab.save'):{name:'StorageError',type:'stale_tab',message:'This tab is stale.',operation:'multiTab.save',retryable:false};
  }
  function renderConflict(documentRef,reload){
    if(!documentRef||!documentRef.body)return;
    documentRef.body.dataset.multiTabState='stale';
    if(documentRef.getElementById&&documentRef.getElementById('multiTabConflictBanner'))return;
    const banner=documentRef.createElement('div');banner.id='multiTabConflictBanner';banner.setAttribute&&banner.setAttribute('role','alert');
    banner.style.cssText='position:fixed;left:12px;right:12px;bottom:12px;z-index:9999;padding:12px;border:1px solid #b83a2b;background:#fff7f5;color:#6f2018;border-radius:8px;box-shadow:0 4px 18px rgba(0,0,0,.18)';
    const text=documentRef.createElement('span');text.textContent='检测到其它标签页已保存更新。当前页面已进入只读保护，不能覆盖较新的数据。';
    const button=documentRef.createElement('button');button.type='button';button.className='btn';button.textContent='重新加载最新数据';button.style.marginLeft='10px';
    button.addEventListener('click',()=>reload());banner.appendChild(text);banner.appendChild(button);documentRef.body.appendChild(banner);
  }

  function create(options={}){
    const loadCurrent=options.loadCurrent;
    const loadCurrentDraft=options.loadCurrentDraft;
    const lockManager=options.lockManager===undefined?(global.navigator&&global.navigator.locks):options.lockManager;
    const documentRef=options.document===undefined?global.document:options.document;
    const windowTarget=options.windowTarget===undefined?global:options.windowTarget;
    const reload=options.reload||(()=>{if(global.location&&typeof global.location.reload==='function')global.location.reload()});
    let channel=options.channel;
    if(channel===undefined&&typeof global.BroadcastChannel==='function'){
      try{channel=new global.BroadcastChannel(CHANNEL_NAME)}catch(_error){channel=null}
    }
    let baselineRevision='empty';let baselineKnown=false;let stale=false;let peerSeen=false;let closed=false;
    const draftBaselines=new Map();

    function markStale(){
      if(stale)return;
      stale=true;renderConflict(documentRef,reload);
    }
    function observeLoadedState(value){baselineRevision=revisionOf(value);baselineKnown=true;stale=false;return baselineRevision}
    function observeDraft(kind,id,value){const key=draftResource(kind,id),revision=draftRevisionOf(value);draftBaselines.set(key,revision);return revision}
    function getStatus(){return Object.freeze({status:stale?'stale':'fresh',baselineRevision,baselineKnown,peerSeen,draftResources:draftBaselines.size})}
    function assertFresh(){if(stale)throw staleError();return true}
    function receive(message){
      const data=message&&message.data||message;
      if(!data||typeof data!=='object')return;
      if(data.type==='hello'){peerSeen=true;if(channel&&data.reply!==true)channel.postMessage({type:'hello',reply:true});return}
      if(data.type==='state_saved'){
        peerSeen=true;
        if(baselineKnown&&String(data.revision)!==baselineRevision)markStale();
      }
      if(data.type==='storage_cutover'){peerSeen=true;markStale()}
      if(data.type==='draft_saved'&&DRAFT_KEYS[data.kind]&&typeof data.id==='string'){
        peerSeen=true;const key=draftResource(data.kind,data.id);
        if(draftBaselines.has(key)&&String(data.revision)!==draftBaselines.get(key))markStale();
      }
    }
    if(channel){channel.onmessage=receive;try{channel.postMessage({type:'hello',reply:false})}catch(_error){}}
    function storageListener(event){
      if(!event)return;
      if(event.key!==MAIN_KEY){
        const kind=Object.keys(DRAFT_KEYS).find(item=>DRAFT_KEYS[item]===event.key);
        if(!kind)return;
        try{
          const values=event.newValue===null?{}:JSON.parse(event.newValue);
          if(!values||typeof values!=='object'||Array.isArray(values))throw new Error('invalid draft map');
          for(const [key,baseline] of draftBaselines){
            if(!key.startsWith(kind+':'))continue;
            const id=key.slice(kind.length+1),current=Object.prototype.hasOwnProperty.call(values,id)?values[id]:null;
            if(draftRevisionOf(current)!==baseline){markStale();break}
          }
        }catch(_error){markStale()}
        return;
      }
      if(event.newValue===null)return;
      try{
        const revision=revisionOf(JSON.parse(event.newValue));
        if(baselineKnown&&revision!==baselineRevision)markStale();
      }catch(_error){markStale()}
    }
    if(windowTarget&&typeof windowTarget.addEventListener==='function')windowTarget.addEventListener('storage',storageListener);

    async function protectedOperation(snapshot,persist,runOptions){
      assertFresh();
      const shouldVerify=runOptions.critical===true||peerSeen;
      if(shouldVerify){
        if(typeof loadCurrent!=='function')throw staleError();
        let current;
        try{current=await loadCurrent()}catch(error){if(runOptions.allowUninitialized!==true)throw error}
        if(current!==undefined){
          const currentRevision=revisionOf(current);
          if(baselineKnown&&currentRevision!==baselineRevision){markStale();throw staleError()}
          if(!baselineKnown&&runOptions.allowUninitialized!==true){markStale();throw staleError()}
        }
      }
      const result=await persist(snapshot);
      baselineRevision=revisionOf(snapshot);baselineKnown=true;stale=false;
      if(channel)try{channel.postMessage({type:'state_saved',revision:baselineRevision})}catch(_error){}
      return result;
    }
    function runProtectedSave(value,persist,runOptions={}){
      if(closed)return Promise.reject(staleError());
      const snapshot=clone(value);
      const operation=()=>protectedOperation(snapshot,persist,runOptions);
      if(lockManager&&typeof lockManager.request==='function')return lockManager.request(LOCK_NAME,{mode:'exclusive'},operation);
      return operation();
    }
    function runExclusiveCutover(operation){
      if(closed||typeof operation!=='function')return Promise.reject(staleError());
      const guarded=async()=>{
        assertFresh();
        const result=await operation();
        if(channel)try{channel.postMessage({type:'storage_cutover'})}catch(_error){}
        return result;
      };
      if(!lockManager||typeof lockManager.request!=='function')return Promise.reject(staleError());
      return lockManager.request(LOCK_NAME,{mode:'exclusive'},guarded);
    }
    async function protectedDraftOperation(kind,id,expected,next,persist){
      assertFresh();
      if(typeof loadCurrentDraft!=='function')throw staleError();
      const current=await loadCurrentDraft(kind,id);
      if(draftRevisionOf(current)!==draftRevisionOf(expected)){markStale();throw staleError()}
      const result=await persist(next);
      const revision=observeDraft(kind,id,next);
      if(channel)try{channel.postMessage({type:'draft_saved',kind,id:String(id),revision})}catch(_error){}
      return result;
    }
    function runProtectedDraftSave(kind,id,expected,next,persist){
      if(closed||!DRAFT_KEYS[kind]||typeof id!=='string'||!id||typeof persist!=='function')return Promise.reject(staleError());
      if(!draftBaselines.has(draftResource(kind,id)))observeDraft(kind,id,expected);
      const operation=()=>protectedDraftOperation(kind,id,expected,clone(next),persist);
      const name=`${DRAFT_LOCK_PREFIX}:${kind}:${encodeURIComponent(id)}`;
      if(lockManager&&typeof lockManager.request==='function')return lockManager.request(name,{mode:'exclusive'},operation);
      return operation();
    }
    function close(){
      closed=true;
      if(channel&&typeof channel.close==='function')channel.close();
      if(windowTarget&&typeof windowTarget.removeEventListener==='function')windowTarget.removeEventListener('storage',storageListener);
    }
    return Object.freeze({observeLoadedState,observeDraft,runProtectedSave,runProtectedDraftSave,runExclusiveCutover,assertFresh,markStale,getStatus,receive,close});
  }

  let singleton=null;
  function loadLiveDraft(kind,id){
    if(global.StorageManager&&global.StorageManager.getActiveSource&&global.StorageManager.getActiveSource()!=='localStorage')return global.StorageManager.getDraft(kind,id);
    const local=global.InvestmentStorage&&global.InvestmentStorage.local;
    if(!local||typeof local.create!=='function')throw staleError();
    const adapter=local.create(),values=kind==='plan_update'?adapter.loadPlanDrafts():adapter.loadOperationDrafts();
    return values&&Object.prototype.hasOwnProperty.call(values,id)?values[id]:null;
  }
  function defaultGuard(){
    if(!singleton)singleton=create({loadCurrent:()=>global.StorageManager.loadState(),loadCurrentDraft:loadLiveDraft});
    return singleton;
  }
  global.InvestmentMultiTab=Object.freeze({create,revisionOf,draftRevisionOf,CHANNEL_NAME,LOCK_NAME,DRAFT_LOCK_PREFIX,MAIN_KEY,DRAFT_KEYS});
  global.MultiTabProtection=Object.freeze({
    observeLoadedState:value=>defaultGuard().observeLoadedState(value),
    runProtectedSave:(...args)=>defaultGuard().runProtectedSave(...args),
    runProtectedDraftSave:(...args)=>defaultGuard().runProtectedDraftSave(...args),
    runExclusiveCutover:(...args)=>defaultGuard().runExclusiveCutover(...args),
    assertFresh:()=>defaultGuard().assertFresh(),
    getStatus:()=>defaultGuard().getStatus(),
    close:()=>defaultGuard().close()
  });
})(typeof window!=='undefined'?window:globalThis);
