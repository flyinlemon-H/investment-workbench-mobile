(function(root){
  'use strict';
  const Runtime=root.PlanRuntime,Plan=root.PlanV2;
  if(!Runtime||!Plan)throw new Error('PlanRuntimeUI dependencies are unavailable.');
  const esc=Runtime.escapeHtml;
  let prepared=null,preview=null,busy=false,returnFocus=null;
  const byId=id=>document.getElementById(id);
  function styles(){
    if(byId('planRuntimeStyles'))return;
    const style=document.createElement('style');style.id='planRuntimeStyles';
    style.textContent='.plan-runtime-card{margin:14px 0 4px;padding:14px;border:1px solid var(--line);background:rgba(255,255,255,.44);min-width:0;overflow-wrap:anywhere}.plan-runtime-head{display:flex;align-items:flex-start;justify-content:space-between;gap:10px;flex-wrap:wrap}.plan-runtime-phase{font-size:22px;font-weight:700;margin:4px 0}.plan-runtime-points{margin:8px 0 0;padding-left:20px}.plan-runtime-points li{margin:5px 0}.plan-runtime-history{margin-top:12px}.plan-runtime-history-row{padding:10px 0;border-top:1px solid var(--line);overflow-wrap:anywhere}.runtime-dialog{max-width:720px;width:100%;max-height:92vh;overflow:auto;overscroll-behavior:contain}.runtime-dialog textarea{width:100%;min-width:0;box-sizing:border-box;font-size:16px;resize:vertical}.runtime-dialog #runtimePromptText{min-height:220px}.runtime-dialog #runtimeResultText{min-height:160px}.runtime-preview{overflow-wrap:anywhere}.runtime-preview-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}.runtime-preview-grid>div{padding:10px;border:1px solid var(--line);min-width:0}.runtime-preview-grid span{display:block;color:var(--ink3);font-size:12px}.runtime-preview-grid b{display:block;margin-top:4px}.runtime-actions{display:flex;flex-wrap:wrap;gap:8px;margin:12px 0}.runtime-actions .btn{min-height:44px}.runtime-dialog [hidden]{display:none!important}@media(max-width:520px){.runtime-dialog{padding:16px;max-height:94dvh}.runtime-preview-grid{grid-template-columns:1fr}.runtime-actions>.btn{flex:1 1 auto}.runtime-confirm-actions{position:sticky;bottom:-16px;z-index:2;margin:12px -16px -16px;padding:12px 16px 16px;background:var(--paper,#f7f2e8);border-top:1px solid var(--line)}.plan-runtime-phase{font-size:20px}}';
    document.head.appendChild(style);
  }
  function historyRow(item){
    const from=item.fromPhase?Runtime.PHASE_LABELS[item.fromPhase]:'首次建立',to=Runtime.PHASE_LABELS[item.toPhase]||item.toPhase;
    return `<div class="plan-runtime-history-row"><div><b>${esc(from)} → ${esc(to)}</b></div><div class="card-note">${esc(item.committedAt.slice(0,16).replace('T',' '))} · 来源结论 ${esc(item.sourceDiscussionVersion)}</div><div>${esc(item.summary)}</div></div>`;
  }
  function card(plan,stock,appState){
    if(!plan||plan.planMode!=='state_watch')return '<div class="card-note">旧版价格计划暂不支持状态跟踪。</div>';
    const runtime=Runtime.runtimeFor(appState,plan.id),status=Runtime.bindingStatus(appState,plan.id),button=`<button class="btn small" type="button" data-runtime-review data-runtime-stock="${esc(stock.id)}" data-runtime-plan="${esc(plan.id)}">复核状态</button>`;
    if(!runtime)return `<section class="plan-runtime-card" data-runtime-plan-card="${esc(plan.id)}"><div class="plan-runtime-head"><div><div class="card-title">当前状态</div><div class="plan-runtime-phase">尚未建立状态</div></div>${button}</div><div class="card-note">完成一次个股讨论并整理结论后，可为这个计划建立独立运行状态。</div></section>`;
    const stale=status!=='current',warning=status==='definition_changed'?'计划定义已变化，需要重新复核当前状态。':status==='current_state_changed'?'最新个股结论已变化，需要重新复核当前状态。':status==='missing_plan'?'原计划已不存在；仅保留历史状态记录。':'';
    const points=runtime.watchPoints.length?`<ul class="plan-runtime-points">${runtime.watchPoints.map(item=>`<li>${esc(item)}</li>`).join('')}</ul>`:'<div class="card-note">暂无新增观察重点。</div>';
    const history=runtime.history.slice().reverse();
    return `<section class="plan-runtime-card" data-runtime-plan-card="${esc(plan.id)}"><div class="plan-runtime-head"><div><div class="card-title">当前状态</div><div class="plan-runtime-phase">${stale?`上次：${esc(Runtime.PHASE_LABELS[runtime.phase])}`:esc(Runtime.PHASE_LABELS[runtime.phase])}</div></div>${status==='missing_plan'?'':button}</div>${warning?`<div class="alert">${esc(warning)}</div>`:''}<p>${esc(runtime.summary)}</p><div class="card-title">当前重点</div>${points}<div class="card-note">来源：基于最近一次个股结论 · Runtime ${runtime.runtimeRevision}</div>${runtime.phase==='action_review'?'<div class="alert">当前处于“操作复核”。请结合计划条件和最新状态人工确认下一步，不代表自动执行。</div>':''}<details class="plan-runtime-history"><summary class="card-title" style="cursor:pointer">状态记录（${history.length}）</summary>${history.map(historyRow).join('')}</details></section>`;
  }
  function ensureDialog(){
    styles();if(byId('planRuntimeDialog'))return byId('planRuntimeDialog');
    const modal=document.createElement('div');modal.id='planRuntimeDialog';modal.className='modal-bg';modal.setAttribute('role','dialog');modal.setAttribute('aria-modal','true');modal.setAttribute('aria-labelledby','planRuntimeTitle');document.body.appendChild(modal);
    modal.addEventListener('click',event=>{if(event.target===modal)close()});
    modal.addEventListener('keydown',event=>{if(event.key==='Escape'){event.preventDefault();close()}if(event.key==='Tab'){const items=[...modal.querySelectorAll('textarea,button')].filter(el=>!el.disabled&&el.getClientRects().length);if(event.shiftKey&&document.activeElement===items[0]){event.preventDefault();items.at(-1)?.focus()}else if(!event.shiftKey&&document.activeElement===items.at(-1)){event.preventDefault();items[0]?.focus()}}});
    return modal;
  }
  function open(stockId,planId){
    if(busy)return;
    try{
      if(prepared)Runtime.release(prepared);prepared=Runtime.prepare(state,stockId,planId);preview=null;returnFocus=document.activeElement;
      const plan=Runtime.findPlan(state,planId).plan,runtime=Runtime.runtimeFor(state,planId),modal=ensureDialog();
      modal.innerHTML=`<div class="modal runtime-dialog"><h2 id="planRuntimeTitle">复核状态</h2><p class="card-note">${esc(plan.name)} · ${runtime?`当前为“${esc(Runtime.PHASE_LABELS[runtime.phase])}”`:'首次建立运行状态'}</p><div class="alert">本流程只更新 Plan Runtime State。不会修改计划定义、持仓、配置或执行交易。</div><label for="runtimePromptText">Runtime Review 请求</label><textarea id="runtimePromptText" readonly></textarea><div class="runtime-actions"><button class="btn ghost" type="button" id="runtimeCopyBtn">复制请求</button></div><label for="runtimeResultText">AI Runtime JSON</label><textarea id="runtimeResultText" placeholder="粘贴 AI 返回的单个 JSON 代码围栏或纯 JSON"></textarea><div class="runtime-actions"><button class="btn" type="button" id="runtimePreviewBtn">预览状态</button><button class="btn ghost" type="button" id="runtimeCloseBtn">取消</button></div><div id="runtimeStatus" class="card-note" role="status" aria-live="polite"></div><div id="runtimePreview"></div><div class="runtime-actions runtime-confirm-actions"><button class="btn" type="button" id="runtimeConfirmBtn" disabled>确认状态变化</button><button class="btn ghost" type="button" id="runtimeDoneBtn">返回</button></div></div>`;
      byId('runtimePromptText').value=Runtime.request(prepared);byId('runtimeCopyBtn').addEventListener('click',copyPrompt);byId('runtimePreviewBtn').addEventListener('click',showPreview);byId('runtimeConfirmBtn').addEventListener('click',confirmSave);byId('runtimeCloseBtn').addEventListener('click',close);byId('runtimeDoneBtn').addEventListener('click',close);byId('runtimeResultText').addEventListener('input',invalidatePreview);
      modal.classList.add('show');byId('runtimeResultText').focus();
    }catch(error){alert(error.message)}
  }
  async function copyPrompt(){const result=await root.ClipboardUtils.copyTextWithFallback(byId('runtimePromptText').value,{selectableElement:byId('runtimePromptText')});byId('runtimeStatus').textContent=result.ok?'请求已复制。':'请长按请求文本手动复制。'}
  function invalidatePreview(){preview=null;byId('runtimeConfirmBtn').disabled=true;byId('runtimePreview').innerHTML='';byId('runtimeStatus').textContent='内容改变后请重新预览。'}
  function showPreview(){
    if(busy)return;preview=Runtime.process(byId('runtimeResultText').value,{state,prepared});byId('runtimeStatus').textContent=preview.message;byId('runtimePreview').innerHTML=Runtime.renderPreview(preview);const confirm=byId('runtimeConfirmBtn');confirm.disabled=!preview.confirmReady;confirm.textContent=preview.review&&preview.review.suggestedPhase==='action_review'?'确认进入操作复核':'确认状态变化';byId('runtimePreview').scrollIntoView({block:'start',behavior:'auto'});
  }
  async function confirmSave(){
    if(busy||!preview?.confirmReady)return;busy=true;byId('runtimeConfirmBtn').disabled=true;
    const result=await Runtime.commit(preview,state,{saveCandidate:async candidate=>{const validated=createValidatedCandidateSnapshot(candidate,{touchUpdatedAt:false});await persistCandidateSnapshot(validated);return {state:validated}},adoptCandidate:candidate=>{state=candidate}},{confirmed:true});busy=false;
    if(result.status==='completed'){close();render();return}
    byId('runtimeStatus').textContent=`未保存：${result.error?.message||'请重新复核状态'}。原 Runtime 保持不变。`;preview=null;byId('runtimeConfirmBtn').disabled=true;
  }
  function close(){if(busy)return;Runtime.release(prepared);prepared=null;preview=null;byId('planRuntimeDialog')?.classList.remove('show');returnFocus?.focus?.()}
  styles();
  document.addEventListener('click',event=>{const button=event.target.closest('[data-runtime-review]');if(button)open(button.dataset.runtimeStock,button.dataset.runtimePlan)});
  root.PlanRuntimeUI=Object.freeze({card,open,close});
})(typeof globalThis!=='undefined'?globalThis:this);
