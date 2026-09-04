(function(root){
  'use strict';
  let activePreview=null,lastUpdates=[];
  function h(value){return typeof esc==='function'?esc(value):String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]))}
  function stockForId(id){return typeof state!=='undefined'&&state&&Array.isArray(state.stocks)?state.stocks.find(stock=>String(stock.id)===String(id)):null}
  function statusPanel(stock){
    if(!root.ManualAnalysisSyncCloud||!stock)return '';
    const entityKey=root.SymbolIdentity.stockSymbol(stock),status=root.ManualAnalysisSyncCloud.statusFor('long_term_logic',entityKey),isSlim=root.LongTermLogicContract.isSlimLogic(stock.longTermLogic);
    if(root.ManualAnalysisSyncCloud.publisherUi())return `<div class="analysis-sync-row"><span class="analysis-sync-status">${h(isSlim?status.message:'旧版长期逻辑可继续阅读；下次 API 更新后可同步')}</span><button class="btn ghost small" type="button" onclick="openLongTermLogicPublish('${h(stock.id)}')" ${isSlim?'':'disabled'}>同步到手机</button></div>`;
    return `<div class="analysis-sync-row"><span class="analysis-sync-status">分析更新由本机主动获取并确认后写入</span></div>`;
  }
  function dialog(){
    let modal=document.getElementById('analysisSyncDialog');if(modal)return modal;
    modal=document.createElement('div');modal.id='analysisSyncDialog';modal.className='modal-bg';
    modal.innerHTML='<div class="modal analysis-sync-modal"><h2 id="analysisSyncTitle">分析同步</h2><div id="analysisSyncBody"></div><p id="analysisSyncMessage" role="status" aria-live="polite"></p><div class="modal-actions"><button class="btn ghost" id="analysisSyncCancel">取消</button><button class="btn" id="analysisSyncConfirm" hidden>确认</button></div></div>';
    document.body.appendChild(modal);document.getElementById('analysisSyncCancel').onclick=close;document.getElementById('analysisSyncConfirm').onclick=confirmActive;return modal;
  }
  function show(title,body,confirmText=''){const modal=dialog();document.getElementById('analysisSyncTitle').textContent=title;document.getElementById('analysisSyncBody').innerHTML=body;document.getElementById('analysisSyncMessage').textContent='';const button=document.getElementById('analysisSyncConfirm');button.hidden=!confirmText;button.textContent=confirmText||'确认';button.disabled=false;modal.classList.add('show')}
  function close(){const modal=document.getElementById('analysisSyncDialog');if(modal)modal.classList.remove('show');activePreview=null}
  function statusText(value){return {valid:'逻辑有效',weakening:'逻辑转弱',broken:'逻辑失效',unclear:'暂不明确',high:'高',medium:'中',low:'低'}[value]||value||'—'}
  function diffHtml(diff){
    if(!diff||!diff.length)return '<div class="hint">内容没有变化。</div>';
    return `<div class="analysis-sync-diff">${diff.map(item=>{
      if(item.added||item.removed)return `<section><b>${h(item.label)}</b>${(item.added||[]).map(value=>`<div class="analysis-sync-added">＋ ${h(value)}</div>`).join('')}${(item.removed||[]).map(value=>`<div class="analysis-sync-removed">－ ${h(value)}</div>`).join('')}</section>`;
      return `<section><b>${h(item.label)}</b><div class="analysis-sync-before">本机/原版本：${h(statusText(item.before))}</div><div class="analysis-sync-after">云端/新版本：${h(statusText(item.after))}</div></section>`;
    }).join('')}</div>`;
  }
  function errorMessage(error){const status=Number(error&&error.status);if(status===401)return '请先在“自动同步设置”中登录同一账户。';if(status===403||String(error&&error.code)==='42501')return '当前账户无权执行此操作。';return '同步服务暂不可用，本机数据未改变。'}
  async function openPublish(stockId){
    const stock=stockForId(stockId);if(!stock)return;const entityKey=root.SymbolIdentity.stockSymbol(stock),engine=root.ManualAnalysisSyncCloud.initialize();
    show(`${stock.name||entityKey} · 长期逻辑`,'<div class="hint">正在比较本机与云端版本…</div>');
    try{
      const preview=await engine.preparePublish('long_term_logic',entityKey,state);
      if(preview.status==='no_change'){root.ManualAnalysisSyncCloud.mark('long_term_logic',entityKey,'synced','已同步');show(`${stock.name||entityKey} · 长期逻辑`,'<div class="hint">本机与云端内容一致，无需再次同步；0 cloud writes。</div>');return}
      if(preview.status!=='preview'){show(`${stock.name||entityKey} · 长期逻辑`,`<div class="alert">${h(preview.message||'当前内容暂不能同步。')}</div>`);return}
      activePreview=preview;show(`${preview.label}${preview.firstPublication?' · 首次同步':''}`,`<p>本机版本：最新<br>云端版本：${preview.firstPublication?'尚无':'旧版本（修订 '+preview.expectedCloudRevision+'）'}</p>${diffHtml(preview.diff)}<p class="card-note">打开预览不会写入云端。只有确认后才发布。</p>`,'确认同步');
    }catch(error){show(`${stock.name||entityKey} · 长期逻辑`,`<div class="alert">${h(errorMessage(error))}</div>`)}
  }
  async function fetchUpdates(){
    const engine=root.ManualAnalysisSyncCloud.initialize();show('获取分析更新','<div class="hint">正在检查云端已发布版本…</div>');
    try{
      const result=await engine.fetchUpdates(state);lastUpdates=result.updates;
      if(!lastUpdates.length){show('获取分析更新',`<div class="hint">已是最新${result.unsupported.length?'；另有当前版本暂不支持的更新':''}。</div>`);return}
      const rows=lastUpdates.map((item,index)=>`<button class="analysis-update-item" type="button" data-analysis-update="${index}"><b>${h(item.label)}</b><span>PC 更新：${h(new Date(item.envelope.publishedAt).toLocaleString('zh-CN'))}</span><span>查看差异 →</span></button>`).join('');show(`发现 ${lastUpdates.length} 项更新`,rows);document.querySelectorAll('[data-analysis-update]').forEach(button=>button.onclick=()=>openApply(Number(button.dataset.analysisUpdate)));
    }catch(error){show('获取分析更新',`<div class="alert">${h(errorMessage(error))}</div>`)}
  }
  async function openApply(index){
    const envelope=lastUpdates[index];if(!envelope)return;const engine=root.ManualAnalysisSyncCloud.initialize(),preview=await engine.prepareApply(envelope,state);
    if(preview.status!=='preview'){show('分析同步',`<div class="alert">${h(preview.message||'当前版本暂不支持此更新。')}</div>`);return}
    activePreview=preview;show(preview.label,`<p>本机版本与云端修订 ${preview.envelope.revision} 的变化：</p>${diffHtml(preview.diff)}<p class="card-note">确认后才会通过现有安全存储写入本机；不会创建持仓。</p>`,'同步到本机');
  }
  async function confirmActive(){
    if(!activePreview)return;const preview=activePreview,button=document.getElementById('analysisSyncConfirm'),message=document.getElementById('analysisSyncMessage');button.disabled=true;message.textContent='正在确认精确版本…';
    try{
      const engine=root.ManualAnalysisSyncCloud.initialize();
      if(preview.direction==='publish'){
        const result=await engine.confirmPublish(preview,state),entityKey=preview.entityKey;
        if(result.status==='published'||result.status==='no_change'){root.ManualAnalysisSyncCloud.mark('long_term_logic',entityKey,'synced','已同步');activePreview=null;button.hidden=true;message.textContent=result.status==='published'?'已发布到云端；手机仍需主动获取并确认。':'内容未变化；0 cloud writes。';return}
        message.textContent=result.message||'版本已变化，请重新预览。';return;
      }
      const result=await engine.confirmApply(preview,state,{saveCandidate:async candidate=>{const validated=createValidatedCandidateSnapshot(candidate,{touchUpdatedAt:false});await persistCandidateSnapshot(validated);return {state:validated}},adoptCandidate:candidate=>{state=candidate}});
      if(result.status==='applied'){root.ManualAnalysisSyncCloud.mark('long_term_logic',preview.envelope.entityKey,'synced','已同步到本机');activePreview=null;button.hidden=true;message.textContent='已同步到本机。';render();return}
      message.textContent=result.message||'同步失败，本机原有内容保持不变。';
    }catch(error){message.textContent=errorMessage(error)}finally{button.disabled=false}
  }
  function initializeUi(){const button=document.getElementById('analysisFetchBtn');if(!button||!root.ManualAnalysisSyncCloud)return;button.hidden=!root.ManualAnalysisSyncCloud.mobileUi();button.onclick=fetchUpdates}
  root.analysisSyncStatusPanel=statusPanel;root.openLongTermLogicPublish=openPublish;root.fetchManualAnalysisUpdates=fetchUpdates;root.initializeManualAnalysisSyncUi=initializeUi;
})(window);
