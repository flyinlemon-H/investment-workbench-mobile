/* App adapter: applies only market facts, using existing critical persistence. */
(function(root){
  'use strict';
  let owner=null,busy=false;
  const renderedVersions=new Map(),requestedSymbols=new Set();
  const errorText=error=>String(error?.message||'连接失败，请稍后重试');
  async function account(action,input){const {data,error}=await root.SupabaseBrowserClient.getClient().rpc('market_data_account',{p_action:action,p_input:input});if(error)throw Error(error.message||'行情服务不可用');return data}
  const client=root.MarketDataOrchestrator.createClient({rpc:account,user:async()=>{const session=await root.SupabaseBrowserClient.getSession();owner=session?.user?.id||null;return owner},changed:refresh,
    apply:async(snapshot,result,userId)=>{
      if((await root.SupabaseBrowserClient.getUser())?.id!==userId)throw Error('account_changed');
      const stock=state.stocks.find(s=>root.SymbolIdentity.canonicalMarketSymbol(s.code||s.symbol)===result.symbol);
      if(!stock)throw Error('标的已移除');
      if(stock.marketDataFreshness?.resultVersion===result.resultVersion)return;
      if(stock.marketDataFreshness?.last_trade_date>result.latestCompleteBar)throw Error('已有更新日K，拒绝覆盖旧版本');
      const currentTime=Date.parse(stock.marketDataFreshness?.fetched_at||''),incomingTime=Date.parse(snapshot.marketDataFreshness?.fetched_at||'');
      if(Number.isFinite(currentTime)&&Number.isFinite(incomingTime)&&currentTime>incomingTime)throw Error('已有较新行情，本次旧结果不会覆盖当前快照');
      const updatedAt=state.updatedAt;
      const keys=['priceHistory','marketDataFreshness','technicalIndicators','technicalData','dataFreshness'];
      const before=Object.fromEntries(keys.map(k=>[k,structuredClone(stock[k])]));
      try{
        stock.priceHistory=normalizePriceHistory(snapshot.priceHistory);
        stock.marketDataFreshness={...structuredClone(snapshot.marketDataFreshness),resultVersion:result.resultVersion,taskId:result.taskId,fingerprint:result.fingerprint};
        stock.technicalIndicators=structuredClone(snapshot.technicalIndicators);
        updateTechnicalDataFromPriceHistory(stock);
        await saveState(state,{critical:true});
      }catch(error){for(const k of keys)stock[k]=before[k];state.updatedAt=updatedAt;throw error}
    }
  });
  function refresh(){
    document.querySelectorAll('[data-market-orchestrator]').forEach(node=>{
      const symbol=node.dataset.marketOrchestrator,view=client.view(owner,symbol);
      node.querySelector('[data-market-status]').textContent=view?.error?`同步未完成：${view.error}`:root.MarketDataOrchestrator.presentation(view?.task,view?.applied);
      const version=node.querySelector('[data-market-version]');version.textContent=view?.applied?`结果版本 ${view.task.resultVersion}`:'';
      const reason=node.querySelector('[data-market-reason]');reason.textContent=view?.task?.error?`原因：${root.MarketDataOrchestrator.errorLabel(view.task.error)}`:'';
      const button=node.querySelector('[data-market-update]');button.disabled=Boolean(view?.task&&['queued','running'].includes(view.task.status));button.textContent=view?.task?.status==='failed'?'重试更新行情':'更新行情';
    });
  }
  async function poll(){
    if(busy||document.hidden)return;
    const nodes=[...document.querySelectorAll('[data-market-orchestrator]')],symbols=new Set(nodes.map(n=>n.dataset.marketOrchestrator));
    for(const symbol of requestedSymbols)symbols.add(symbol);
    if(typeof detailStockId!=='undefined'&&typeof state!=='undefined'){
      const current=state.stocks.find(s=>s.id===detailStockId),symbol=current&&root.SymbolIdentity.canonicalMarketSymbol(current.code||current.symbol);
      if(symbol)symbols.add(symbol);
    }
    if(!symbols.size)return;busy=true;
    try{for(const symbol of symbols){const task=await client.sync(symbol);if(task&&!['queued','running'].includes(task.status))requestedSymbols.delete(symbol);if(task?.status==='succeeded'&&renderedVersions.get(task.symbol)!==task.resultVersion&&typeof renderStockDetail==='function'){renderedVersions.set(task.symbol,task.resultVersion);renderStockDetail();refresh()}}}
    catch(error){for(const node of nodes)node.querySelector('[data-market-status]').textContent=errorText(error)}finally{busy=false}

  }
  function panel(symbol){
    try{root.MarketDataOrchestrator.request(symbol)}catch(_error){return ''}
    return `<section class="card" data-market-orchestrator="${symbol}" style="margin-bottom:12px;overflow-wrap:anywhere"><div class="card-title">行情更新</div><p data-market-status role="status" aria-live="polite">查询行情任务状态</p><p data-market-reason class="card-note"></p><p data-market-version class="card-note"></p><button class="btn" type="button" data-market-update="${symbol}">更新行情</button><details style="margin-top:12px"><summary>执行端设置</summary><p class="card-note">首次使用需在账户设置登录，并授权执行端。执行端未启动时，任务保持等待。</p><button class="btn ghost small" type="button" data-market-pair>生成执行端授权</button> <button class="btn ghost small" type="button" data-market-revoke>撤销执行端授权</button></details></section>`;
  }
  document.addEventListener('click',async event=>{
    const update=event.target.closest('[data-market-update]'),pair=event.target.closest('[data-market-pair]'),revoke=event.target.closest('[data-market-revoke]');
    if(!update&&!pair&&!revoke)return;
    try{
      if(update){update.disabled=true;requestedSymbols.add(update.dataset.marketUpdate);await client.sync(update.dataset.marketUpdate,true);refresh();return}
      if(revoke){await account('revoke_worker',{});await poll();return}
      const bytes=crypto.getRandomValues(new Uint8Array(32)),token=Array.from(bytes,b=>b.toString(16).padStart(2,'0')).join('');
      const value=await account('register_worker',{token});
      const blob=new Blob([JSON.stringify({...value,projectRef:root.SupabaseBrowserClient.configuration().projectRef,token})],{type:'application/json'});
      const url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download='market-worker-credential.json';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
      alert('执行端授权已生成。请在可信执行端配对，妥善保管并删除传输副本。');
    }catch(error){if(update){update.disabled=false;refresh();update.closest('[data-market-orchestrator]').querySelector('[data-market-status]').textContent=errorText(error)}else alert(errorText(error))}
  });
  root.MarketDataTaskUi={panel,poll,client};
  root.setInterval(poll,5000);
  root.SupabaseBrowserClient.onAuthStateChange((_event,session)=>{owner=session?.user?.id||null;client.clear();renderedVersions.clear();requestedSymbols.clear();void poll()});
})(window);
