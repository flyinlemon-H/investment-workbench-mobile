(function portfolioReviewUiModule(root){
  'use strict';
  if(!root||!root.document)return;
  let selectedSymbols=new Set(),currentContext=null,currentPreview=null,copyTimer=null,mode='result';
  const commitController=root.PortfolioReviewContract.createCommitController();
  const saveCandidateWithRollback=root.BatchTechnicalReview.createWorkbenchCandidateSaver({getState:()=>state,setState:value=>{state=value},persist:(candidate,options)=>saveState(candidate,options)});
  const esc=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  const displayText=value=>{
    let out=String(value??'');
    out=out.replace(/knownCash\s*[:=]\s*(?:null|unavailable)/gi,'当前未提供可靠现金数据').replace(/cashStatus\s*[:=]\s*unavailable/gi,'现金资料暂未提供');
    const terms=[['knownApplicationHoldingsMarketValue','程序中已记录持仓的已知市值'],['knownMarketValue','本次复核股票的已知市值'],['selected_review_universe_not_confirmed_full_brokerage_portfolio','本次复核范围并非完整券商组合'],['selected_review_universe','本次复核范围'],['weightStatus','仓位判断状态'],['marketContext','市场背景'],['todayRelevance','资料对今日判断的适用性'],['allocation','配置'],['fundamental','基本面'],['valuation','估值'],['inconsistent','数据存在不一致'],['unavailable','暂未提供'],['unknown','当前无法确认'],['stale','资料较旧'],['fresh','资料较新']];
    for(const [from,to] of terms)out=out.replace(new RegExp(from,'gi'),to);
    return out;
  };
  const displayEsc=value=>esc(displayText(value));
  const symbolOf=stock=>String(stock&&(stock.code||stock.symbol)||'').trim();
  const canonical=value=>root.SymbolIdentity.canonicalSymbol(value);
  const stocks=()=>root.MultiStockAnalysis.selectableStocks(state&&state.stocks);
  const selectedStocks=()=>stocks().filter(stock=>selectedSymbols.has(canonical(symbolOf(stock))));
  const prefs=()=>root.MultiStockAnalysis.normalizePreferences(state&&state.multiStockAnalysis,state&&state.stocks);
  const nameForSymbol=symbol=>{const stock=stocks().find(item=>canonical(symbolOf(item))===canonical(symbol));return stock?`${stock.name||symbol} · ${canonical(symbol)}`:canonical(symbol)};
  const currentSnapshot=()=>state&&state.portfolioReview&&state.portfolioReview.current&&state.portfolioReview.current.review?state.portfolioReview.current:null;

  function ensureStyles(){
    if(document.getElementById('m05cStyles'))return;
    const style=document.createElement('style');style.id='m05cStyles';style.textContent=`
      .m05c-switch{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin:10px 0 14px}.m05c-switch .btn{min-height:44px}.m05c-switch .m05c-module-active{background:var(--seal);border-color:var(--seal);color:var(--paper)}
      .m05c-workflow-head,.m05c-workflow-actions{display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap;margin:0 0 14px}.m05c-workflow-head .m05c-section-title{margin:0}.m05c-workflow-actions{justify-content:flex-start;margin-top:14px}
      .m05c-selection-toolbar{display:flex;align-items:center;flex-wrap:wrap;gap:8px;margin:8px 0}.m05c-selection-toolbar .btn{min-height:44px}.m05c-count{font-weight:900;color:var(--ink2)}
      .m05c-stock-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(145px,1fr));gap:8px}.m05c-stock-option{display:flex;align-items:center;gap:8px;min-height:48px;border:1px solid var(--line);padding:8px;margin:0}.m05c-stock-option input{width:auto}
      .m05c-readiness{display:flex;flex-wrap:wrap;gap:6px;margin:10px 0}.m05c-readiness span{border:1px solid var(--line);padding:4px 7px;font-size:12px;background:rgba(255,255,255,.3)}
      .m05c-result-hero{border-left:4px solid var(--seal);padding:14px;margin-bottom:12px}.m05c-result-meta{display:flex;justify-content:space-between;gap:8px;color:var(--ink3);font-size:12px;margin-bottom:8px}.m05c-result-summary{font-size:16px;font-weight:800;line-height:1.65}.m05c-risk{display:inline-flex;margin-top:9px;padding:4px 8px;border:1px solid var(--seal);color:var(--seal);font-weight:900}
      .m05c-section{margin:12px 0}.m05c-section-title{font-weight:900;font-size:15px;margin-bottom:7px}.m05c-result-row{display:block;width:100%;border:1px solid var(--line);background:rgba(255,255,255,.26);padding:10px;margin:7px 0;text-align:left;color:inherit}.m05c-result-row button{color:var(--seal);font-weight:900;background:none;border:0;padding:0;text-align:left}.m05c-row-label{display:flex;align-items:center;justify-content:space-between;gap:8px;font-weight:900}.m05c-row-note{margin-top:4px;color:var(--ink2);font-size:13px;line-height:1.55}.m05c-bullets{margin:0;padding-left:20px}.m05c-bullets li{margin:5px 0;line-height:1.55}.m05c-preview-row{padding:8px 0;border-top:1px solid var(--line)}
      #portfolioReviewModal textarea{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:12px}
      @media(max-width:640px){#portfolioReviewModal{padding:0;align-items:stretch;overflow:hidden}#portfolioReviewModal>.modal{width:100%;height:100vh;height:100dvh;max-height:100vh;max-height:100dvh;margin:0;padding:14px 14px 24px;border:0;box-shadow:none;overflow-y:auto;overscroll-behavior:contain;-webkit-overflow-scrolling:touch}#portfolioReviewModal button{min-height:44px}#portfolioReviewModal textarea{font-size:16px}.m05c-stock-grid{grid-template-columns:1fr}.m05c-result-hero{padding:12px}.m05c-result-summary{font-size:15px}}
    `;document.head.appendChild(style);
  }
  function ensureModal(){
    let modal=document.getElementById('portfolioReviewModal');if(modal)return modal;
    modal=document.createElement('div');modal.className='modal-bg import-layer';modal.id='portfolioReviewModal';modal.innerHTML=`<div class="modal"><h2>今日组合</h2><div class="m05c-switch m05c-module-nav" aria-label="复核模块"><button class="btn ghost" id="m05cTechnicalBtn" type="button">技术复核</button><button class="btn m05c-module-active" type="button" aria-current="page">今日组合</button></div><div id="m05cBody"></div><div class="modal-actions"><button class="btn ghost" id="m05cCloseBtn" type="button">关闭</button></div></div>`;
    document.body.appendChild(modal);modal.addEventListener('click',event=>{if(event.target===modal)close()});
    document.getElementById('m05cCloseBtn').addEventListener('click',close);document.getElementById('m05cTechnicalBtn').addEventListener('click',()=>{close();root.MultiStockAnalysisUI.open()});
    return modal;
  }
  function setMode(next){mode=next;renderBody()}
  function riskLabel(value){return {low:'低风险',moderate:'中等风险',high:'高风险',unclear:'风险不明确'}[value]||'风险不明确'}
  function priorityLabel(value){return {high:'高',medium:'中',low:'低'}[value]||value}
  function planLabel(value){return {approaching:'接近价格区',triggered:'价格已触发，待确认其他条件',invalidated:'计划需复核',not_close:'尚未接近',unclear:'不明确'}[value]||'不明确'}
  function confidenceLabel(value){return {high:'高',medium:'中',low:'低'}[value]||value}
  function stockRow(item,kind){
    const symbol=canonical(item.symbol),stock=stocks().find(row=>canonical(symbolOf(row))===symbol),name=stock&&stock.name||symbol;
    const badge=kind==='priority'?priorityLabel(item.priority):kind==='plan'?planLabel(item.status):'';
    return `<div class="m05c-result-row"><div class="m05c-row-label"><button type="button" data-m05c-symbol="${esc(symbol)}">${esc(name)}</button>${badge?`<span>${esc(badge)}</span>`:''}</div><div class="m05c-row-note">${displayEsc(item.reason)}</div>${item.focus?`<div class="m05c-row-note">→ ${displayEsc(item.focus)}</div>`:''}${item.planRelation?`<div class="m05c-row-note">计划：${displayEsc(item.planRelation)}</div>`:''}</div>`;
  }
  function listSection(title,items,kind){return items&&items.length?`<section class="m05c-section"><div class="m05c-section-title">${esc(title)}</div>${items.map(item=>stockRow(item,kind)).join('')}</section>`:''}
  function bullets(title,items){return items&&items.length?`<section class="m05c-section"><div class="m05c-section-title">${esc(title)}</div><ul class="m05c-bullets">${items.map(item=>`<li>${displayEsc(item)}</li>`).join('')}</ul></section>`:''}
  function limitationSection(items){const limited=Array.isArray(items)?items.slice(0,5):[];return limited.length?`<details class="m05c-section m05c-limitations"><summary class="m05c-section-title">数据限制（${limited.length}）</summary><ul class="m05c-bullets">${limited.map(item=>`<li>${displayEsc(item)}</li>`).join('')}</ul></details>`:''}
  function renderSavedResult(){
    const snapshot=currentSnapshot();if(!snapshot)return `<div class="empty">还没有今日组合复核。<br><button class="btn" id="m05cStartBtn" type="button" style="margin-top:12px">生成组合复核</button></div>`;
    const review=snapshot.review,stamp=String(snapshot.generatedAt||snapshot.savedAt||'').replace('T',' ').slice(0,16);
    return `<div class="m05c-result-hero"><div class="m05c-result-meta"><span>${esc(review.reviewDate)}</span><span>${esc(stamp)}</span></div><div class="m05c-section-title">今日组合结论</div><div class="m05c-result-summary">${displayEsc(review.summary)}</div><span class="m05c-risk">${esc(riskLabel(review.portfolioRiskLevel))}</span></div><div class="m05c-workflow-actions"><button class="btn" id="m05cGenerateModeBtn" type="button">生成组合复核</button></div>${listSection('优先关注',review.priorityStocks,'priority')}${bullets('今日重点',review.todayFocus)}${listSection('风险关注',review.riskAttention,'risk')}${listSection('计划接近',review.planWatch,'plan')}${listSection('候选观察',review.candidateReview,'candidate')}${bullets('组合风险',review.portfolioRisks)}${limitationSection(review.dataLimitations)}<div class="card-note">复核置信度：${esc(confidenceLabel(review.confidence))}</div>`;
  }
  function renderSelection(){
    const all=stocks(),preference=prefs(),groups=preference.groups||[],options=['<option value="">加载固定组合</option>'].concat(groups.map(group=>`<option value="${esc(group.id)}">${esc(group.name)}（${group.symbols.length}）</option>`)).join('');
    return `<div class="form-row" id="m05cSelectionStart"><label>选择股票（1–12只）</label><div class="m05c-selection-toolbar"><button class="btn ghost" id="m05cSelectAllBtn" type="button">全选前12</button><button class="btn ghost" id="m05cClearBtn" type="button">取消全选</button><span class="m05c-count">已选 ${selectedSymbols.size} / 12</span></div><div class="m05c-selection-toolbar"><select id="m05cGroupSelect" aria-label="固定分析组合">${options}</select><button class="btn ghost" id="m05cLoadGroupBtn" type="button">加载组合</button></div><div class="m05c-stock-grid">${all.map(stock=>{const symbol=canonical(symbolOf(stock));return `<label class="m05c-stock-option"><input type="checkbox" data-m05c-select="${esc(symbol)}"${selectedSymbols.has(symbol)?' checked':''}><span>${esc(stock.name||symbol)}<small style="display:block;color:var(--ink3)">${esc(symbol)}</small></span></label>`}).join('')}</div></div>`;
  }
  function renderGenerate(){
    const resultAction=currentSnapshot()?'<button class="btn ghost" id="m05cViewResultBtn" type="button">查看今日结果</button>':'';
    return `<div class="m05c-workflow-head"><div class="m05c-section-title">选择股票</div>${resultAction}</div>${renderSelection()}<div class="m05c-readiness" id="m05cReadiness"></div><div class="modal-actions" style="justify-content:flex-start;flex-wrap:wrap"><button class="btn ghost" id="m05cRefreshBtn" type="button">刷新结构化上下文</button><button class="btn" id="m05cCopyBtn" type="button">复制给 AI</button></div><details class="m05a-request-details" id="m05cRequestDetails"><summary>组合复核请求已准备</summary><textarea id="m05cRequestText" aria-label="组合复核请求" readonly style="min-height:190px"></textarea></details><div class="form-row"><label for="m05cResultText">粘贴 AI 结果</label><textarea id="m05cResultText" style="min-height:180px" placeholder='{"portfolioReview":{...}}'></textarea></div><div class="modal-actions"><button class="btn ghost" id="m05cBackToSelectionBtn" type="button">返回选股</button><button class="btn" id="m05cPreviewBtn" type="button">预览结果</button><button class="btn" id="m05cSaveBtn" type="button" disabled>保存复核</button></div><div id="m05cStatus" class="card-note" role="status" aria-live="polite" style="white-space:pre-line;margin-top:10px"></div><div id="m05cPreview"></div>`;
  }
  function renderBody(){
    const body=document.getElementById('m05cBody');if(!body)return;body.innerHTML=mode==='result'?renderSavedResult():renderGenerate();
    body.querySelectorAll('[data-m05c-symbol]').forEach(button=>button.addEventListener('click',()=>openDetail(button.dataset.m05cSymbol)));
    const start=document.getElementById('m05cStartBtn');if(start)start.addEventListener('click',()=>setMode('generate'));
    const generate=document.getElementById('m05cGenerateModeBtn');if(generate)generate.addEventListener('click',()=>setMode('generate'));
    if(mode==='generate')bindGenerate();
  }
  function setStatus(message,error=false){const target=document.getElementById('m05cStatus');if(!target)return;target.textContent=message||'';target.style.color=error?'var(--seal)':''}
  function bindGenerate(){
    const viewResult=document.getElementById('m05cViewResultBtn');if(viewResult)viewResult.addEventListener('click',()=>setMode('result'));
    document.getElementById('m05cBackToSelectionBtn').addEventListener('click',()=>document.getElementById('m05cSelectionStart').scrollIntoView({behavior:'smooth',block:'start'}));
    document.getElementById('m05cSelectAllBtn').addEventListener('click',()=>{selectedSymbols=new Set(stocks().slice(0,12).map(stock=>canonical(symbolOf(stock))));renderBody()});
    document.getElementById('m05cClearBtn').addEventListener('click',()=>{selectedSymbols.clear();renderBody()});
    document.getElementById('m05cLoadGroupBtn').addEventListener('click',()=>{const id=document.getElementById('m05cGroupSelect').value,group=prefs().groups.find(item=>item.id===id);if(!group){setStatus('请先选择固定组合。',true);return}selectedSymbols=new Set(group.symbols.map(canonical).slice(0,12));renderBody()});
    document.querySelectorAll('[data-m05c-select]').forEach(input=>input.addEventListener('change',()=>{const symbol=input.dataset.m05cSelect;if(input.checked){if(selectedSymbols.size>=12){input.checked=false;setStatus('今日组合最多选择 12 只股票。',true);return}selectedSymbols.add(symbol)}else selectedSymbols.delete(symbol);currentPreview=null;generateRequest()}));
    document.getElementById('m05cRefreshBtn').addEventListener('click',refreshContext);document.getElementById('m05cCopyBtn').addEventListener('click',copyRequest);document.getElementById('m05cPreviewBtn').addEventListener('click',preview);document.getElementById('m05cSaveBtn').addEventListener('click',saveReview);document.getElementById('m05cResultText').addEventListener('input',()=>{currentPreview=null;document.getElementById('m05cSaveBtn').disabled=true;document.getElementById('m05cPreview').innerHTML=''});generateRequest();
  }
  function generateRequest(){
    const requestField=document.getElementById('m05cRequestText');if(!requestField)return '';
    try{currentContext=root.PortfolioReviewContext.buildPortfolioContext(selectedStocks(),{allStocks:stocks(),planReviewStore:state.planReviews});const request=root.PortfolioReviewContext.buildRequest(selectedStocks(),{allStocks:stocks(),reviewDate:currentContext.reviewDate,generatedAt:currentContext.generatedAt,planReviewStore:state.planReviews});requestField.value=request;const ready=currentContext.readiness,metrics=root.PortfolioReviewContext.requestMetrics(request);document.getElementById('m05cReadiness').innerHTML=`<span>${ready.stockCount}只股票</span><span>技术 ${ready.technical}</span><span>新闻 ${ready.news}</span><span>基本面 ${ready.fundamental}</span><span>估值 ${ready.valuation}</span><span>计划复核 ${ready.planReviews.current}/${ready.planReviews.total}</span>`;setStatus(`请求约 ${metrics.characters} 字符 / ${metrics.approxTokens} tokens。`);return request}catch(error){currentContext=null;requestField.value='';document.getElementById('m05cReadiness').innerHTML='';setStatus(error&&error.message||String(error),true);return ''}
  }
  async function refreshContext(){
    const chosen=selectedStocks();if(!chosen.length){setStatus('请至少选择一只股票。',true);return}const button=document.getElementById('m05cRefreshBtn');button.disabled=true;button.textContent='刷新中…';
    try{if(typeof refreshOnePrice!=='function')throw new Error('现有行情刷新功能不可用。');const summary=await root.MultiStockAnalysis.refreshSelectedStocks(chosen,stock=>refreshOnePrice(stock.id,{silent:true}),{delayMs:350,onProgress:p=>{button.textContent=`刷新中 ${p.index}/${p.total}`}});if(typeof applyMarketDataBridge==='function')await applyMarketDataBridge();generateRequest();setStatus(`结构化上下文已刷新：成功 ${summary.successCount}，失败 ${summary.failureCount}；失败项保留旧数据并标明状态。`)}catch(error){setStatus(error&&error.message||String(error),true)}finally{button.disabled=false;button.textContent='刷新结构化上下文'}
  }
  async function copyRequest(){const request=generateRequest();if(!request)return;const button=document.getElementById('m05cCopyBtn');try{await navigator.clipboard.writeText(request);button.textContent='已复制 ✓';setStatus('组合复核请求已复制，可以粘贴给 AI。')}catch(_){const field=document.getElementById('m05cRequestText');document.getElementById('m05cRequestDetails').open=true;field.focus();field.select();try{document.execCommand('copy');button.textContent='已复制 ✓'}catch(_error){button.textContent='请手动复制';setStatus('自动复制失败，请长按已选中的文本手动复制。',true)}}if(copyTimer)clearTimeout(copyTimer);copyTimer=setTimeout(()=>{if(button)button.textContent='复制给 AI'},2200)}
  function preview(){
    if(!currentContext&&!generateRequest())return;const raw=document.getElementById('m05cResultText').value.trim();if(!raw){setStatus('请先粘贴 AI 结果。',true);return}const expected=selectedStocks().map(stock=>canonical(symbolOf(stock)));currentPreview=root.PortfolioReviewContract.process(raw,{expectedSymbols:expected,reviewDate:currentContext.reviewDate});document.getElementById('m05cPreview').innerHTML=root.PortfolioReviewContract.renderPreview(currentPreview,nameForSymbol);document.getElementById('m05cSaveBtn').disabled=!currentPreview.ok;setStatus(currentPreview.ok?'预览通过；确认后保存一份完整的今日组合快照。':`${currentPreview.message}\n未写入任何数据。`,!currentPreview.ok)
  }
  async function saveReview(){
    if(commitController.pending||!currentPreview||!currentPreview.ok)return;const button=document.getElementById('m05cSaveBtn');button.disabled=true;button.textContent='保存中…';const expected=selectedStocks().map(stock=>canonical(symbolOf(stock)));
    const result=await commitController.run(currentPreview,state,{saveCandidate:saveCandidateWithRollback,adoptCandidate:candidate=>{state=candidate},render:()=>render()},{expectedSymbols:expected,generatedAt:currentContext.generatedAt,planReferences:currentContext.planReferences});
    if(result.status==='completed'||result.status==='saved_render_failed'){currentPreview=null;mode='result';renderBody()}else{setStatus('保存失败；上一份有效组合复核保持不变。',true);button.disabled=false;button.textContent='保存复核'}
  }
  function openDetail(symbol){const stock=stocks().find(item=>canonical(symbolOf(item))===canonical(symbol));if(!stock||typeof openStockDetail!=='function')return;close();openStockDetail(stock.id)}
  function open(){ensureStyles();ensureModal();const initial=root.MultiStockAnalysis.initialSelection(prefs(),stocks()).map(canonical);selectedSymbols=new Set(initial.slice(0,12));if(!selectedSymbols.size)selectedSymbols=new Set(stocks().slice(0,Math.min(8,stocks().length)).map(stock=>canonical(symbolOf(stock))));currentContext=null;currentPreview=null;mode=currentSnapshot()?'result':'generate';document.getElementById('portfolioReviewModal').classList.add('show');setMode(mode)}
  function close(){const modal=document.getElementById('portfolioReviewModal');if(modal)modal.classList.remove('show')}
  ensureStyles();root.PortfolioReviewUI=Object.freeze({open,close,renderSavedResult,generateRequest});
})(typeof globalThis!=='undefined'?globalThis:this);
