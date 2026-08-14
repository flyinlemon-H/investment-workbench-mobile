(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  if(root)root.MultiStockAnalysis=Object.freeze(api);
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';

  const BATCH_WARNING_THRESHOLD=10;

  const OUTPUT_EXAMPLE={
    technicalReviews:[{
      symbol:'EXACT.SYMBOL',
      review:{
        trendStatus:'sideways',
        technicalSummary:'',
        riskFlags:[],
        actionHint:'',
        confidence:'medium',
        finalTechnicalConclusion:'',holdHint:'',addHint:'',reduceHint:''
      }
    }]
  };

  function text(value){return String(value??'').trim()}
  function symbolOf(stock){return text(stock&&(stock.code||stock.symbol))}
  function clone(value){return JSON.parse(JSON.stringify(value))}
  function arr(value){return Array.isArray(value)?value:[]}
  function isCash(stock){return text(stock&&stock.type).toLowerCase()==='cash'||(!symbolOf(stock)&&/现金/.test(text(stock&&stock.name)))}

  function selectableStocks(stocks){
    return arr(stocks).filter(stock=>symbolOf(stock)&&!isCash(stock));
  }

  function exactAvailableSymbols(stocks){
    return new Set(selectableStocks(stocks).map(symbolOf));
  }

  function normalizePreferences(value,stocks=[]){
    const source=value&&typeof value==='object'&&!Array.isArray(value)?value:{};
    const available=exactAvailableSymbols(stocks);
    const keep=symbols=>arr(symbols).map(text).filter((symbol,index,all)=>symbol&&all.indexOf(symbol)===index&&(!available.size||available.has(symbol)));
    const groups=arr(source.groups).map(group=>({
      id:text(group&&group.id),
      name:text(group&&group.name),
      symbols:keep(group&&group.symbols)
    })).filter(group=>group.id&&group.name&&group.symbols.length);
    const groupIds=new Set();
    const uniqueGroups=groups.filter(group=>!groupIds.has(group.id)&&groupIds.add(group.id));
    const defaultGroupId=uniqueGroups.some(group=>group.id===text(source.defaultGroupId))?text(source.defaultGroupId):'';
    return {lastSymbols:keep(source.lastSymbols),defaultGroupId,groups:uniqueGroups};
  }

  function initialSelection(preferences,stocks=[]){
    const normalized=normalizePreferences(preferences,stocks);
    if(normalized.lastSymbols.length)return normalized.lastSymbols.slice();
    const defaultGroup=normalized.groups.find(group=>group.id===normalized.defaultGroupId);
    return defaultGroup?defaultGroup.symbols.slice():[];
  }

  function saveGroup(preferences,group,stocks=[]){
    const normalized=normalizePreferences(preferences,stocks);
    const candidate=normalizePreferences({groups:[group]},stocks).groups[0];
    if(!candidate)throw new Error('分析组合需要名称和至少一只有效股票。');
    return {...normalized,groups:normalized.groups.filter(item=>item.id!==candidate.id).concat(candidate)};
  }

  function deleteGroup(preferences,groupId,stocks=[]){
    const normalized=normalizePreferences(preferences,stocks);
    const id=text(groupId);
    return {...normalized,defaultGroupId:normalized.defaultGroupId===id?'':normalized.defaultGroupId,groups:normalized.groups.filter(group=>group.id!==id)};
  }

  function recentPriceHistory(stock,limit=120){
    return arr(stock&&stock.priceHistory).map(row=>({
      date:text(row&&row.date),
      close:Number(row&&row.close)
    })).filter(row=>row.date&&Number.isFinite(row.close)&&row.close>0).slice(-Math.max(1,limit));
  }

  function stockContext(stock,helpers={}){
    const symbol=symbolOf(stock);
    if(!symbol)throw new Error('分析股票缺少 exact symbol。');
    const currentPrice=typeof helpers.currentPrice==='function'?helpers.currentPrice(stock):(stock.currentPrice||stock.lastUnitPrice||null);
    const technicalData=typeof helpers.technicalData==='function'?helpers.technicalData(stock):stock.technicalData;
    const technicalReview=typeof helpers.technicalReview==='function'?helpers.technicalReview(stock):stock.technicalReview;
    const freshness=typeof helpers.dataFreshness==='function'?helpers.dataFreshness(stock):stock.dataFreshness;
    const technical=clone(technicalData&&typeof technicalData==='object'?technicalData:{});
    return {
      symbol,
      name:text(stock.name),
      type:text(stock.type),
      role:text(stock.role),
      theme:text(stock.theme),
      currentPrice:Number.isFinite(Number(currentPrice))&&Number(currentPrice)>0?Number(currentPrice):null,
      priceUpdatedAt:text(stock.priceUpdatedAt||stock.valueUpdatedAt||(freshness&&freshness.priceUpdatedAt)),
      syncStatus:text(stock.syncStatus)||'unknown',
      lastSyncError:text(stock.lastSyncError),
      dataFreshness:clone(freshness&&typeof freshness==='object'?freshness:{}),
      technicalAsOf:text(technical.technicalAsOf),
      latestCompleteBar:text(technical.latestCompleteBar),
      technicalDataStatus:text(technical.technicalDataStatus)||'unavailable',
      technicalData:technical,
      previousTechnicalReview:clone(technicalReview&&typeof technicalReview==='object'?technicalReview:{}),
      recentPriceHistory:recentPriceHistory(stock)
    };
  }

  function buildRequest(stocks,helpers={}){
    const selected=selectableStocks(stocks);
    if(selected.length<2)throw new Error('请至少选择两只有 exact symbol 的股票。');
    const contexts=selected.map(stock=>stockContext(stock,helpers));
    return [
      '你是一名严谨的股票技术分析助理。请一次完成下面全部股票的技术复核。',
      '',
      '输出要求：',
      '1. 只输出严格 JSON；不要 Markdown、代码围栏或解释。',
      '2. 顶层必须只有 technicalReviews 数组。',
      '3. 每个输入 symbol 必须原样、精确地输出一次；禁止名称匹配、大小写变换、前后缀猜测或新增股票。',
      '4. 每项只能包含 symbol 和 review；review 只返回判断，不要返回或重算 currentPrice、priceUpdatedAt、technicalAsOf、MA、MACD、K线或周期数值。',
      '5. trendStatus 只能是 uptrend、downtrend、sideways、recovery、rebound、unclear 之一。',
      '6. technicalDataStatus 为 stale、unavailable 或 anomaly 时，只给条件化结论，并降低 confidence；不要发明缺失事实。',
      '7. 结论使用简体中文；只给条件化复核，不给确定性买卖指令。riskFlags 必须保持字符串数组。',
      '',
      '股票上下文：',
      JSON.stringify(contexts,null,2),
      '',
      '严格输出结构示例（用输入股票逐项替换示例项）：',
      JSON.stringify(OUTPUT_EXAMPLE,null,2)
    ].join('\n');
  }

  async function refreshSelectedStocks(stocks,refreshOne,options={}){
    if(typeof refreshOne!=='function')throw new Error('缺少行情刷新函数。');
    const selected=selectableStocks(stocks);
    const results=[];
    const delayMs=Math.max(0,Number(options.delayMs)||0);
    for(let index=0;index<selected.length;index+=1){
      const stock=selected[index];
      let result;
      try{
        const raw=await refreshOne(stock);
        result={
          id:String(stock.id||''),symbol:symbolOf(stock),name:text(stock.name),
          ok:Boolean(raw&&raw.ok),price:raw&&Number.isFinite(Number(raw.price))?Number(raw.price):null,
          source:text(raw&&raw.source),errors:arr(raw&&raw.errors).map(text).filter(Boolean)
        };
        if(!result.ok&&!result.errors.length)result.errors=['刷新失败，已保留原数据'];
      }catch(error){
        result={id:String(stock.id||''),symbol:symbolOf(stock),name:text(stock.name),ok:false,price:null,source:'',errors:[text(error&&error.message)||String(error)]};
      }
      results.push(result);
      if(typeof options.onProgress==='function')options.onProgress({index:index+1,total:selected.length,result,results:results.slice()});
      if(delayMs&&index<selected.length-1)await new Promise(resolve=>setTimeout(resolve,delayMs));
    }
    return {
      total:results.length,
      successCount:results.filter(item=>item.ok).length,
      failureCount:results.filter(item=>!item.ok).length,
      results
    };
  }

  return {BATCH_WARNING_THRESHOLD,OUTPUT_EXAMPLE,selectableStocks,normalizePreferences,initialSelection,saveGroup,deleteGroup,recentPriceHistory,stockContext,buildRequest,refreshSelectedStocks};
});

(function(root){
  'use strict';
  if(!root||!root.document||!root.MultiStockAnalysis)return;

  let selectedSymbols=new Set();
  let copyFeedbackTimer=0;

  function appStocks(){return typeof state==='object'&&state&&Array.isArray(state.stocks)?state.stocks:[]}
  function defaults(){return root.MultiStockAnalysis.selectableStocks(appStocks())}
  function symbolOf(stock){return String(stock&&(stock.code||stock.symbol)||'').trim()}
  function preferenceState(){return root.MultiStockAnalysis.normalizePreferences(state&&state.multiStockAnalysis,state&&state.stocks)}

  function ensureStyles(){
    if(document.getElementById('m05aMobileStyles'))return;
    const style=document.createElement('style');
    style.id='m05aMobileStyles';
    style.textContent=`
      .m05a-tab-entry{flex:0 0 auto;min-height:44px;border:0;border-bottom:2px solid var(--seal);padding:11px 16px 9px;background:var(--paper);color:var(--seal);font-weight:900;letter-spacing:1px;white-space:nowrap;cursor:pointer}
      .m05a-request-details,.m05a-batch-input-details{margin-bottom:13px;border:1px solid var(--line);background:rgba(255,255,255,.18)}
      .m05a-request-details summary,.m05a-batch-input-details summary{min-height:44px;display:flex;align-items:center;padding:9px 11px;color:var(--ink2);font-size:12px;font-weight:800;cursor:pointer}
      .m05a-request-details textarea,.m05a-batch-input-details textarea{border-width:1px 0 0;margin:0}
      .m05b-selection-toolbar{display:flex;flex-wrap:wrap;align-items:center;gap:8px;margin:8px 0}
      .m05b-selection-toolbar .btn{min-height:44px}
      .m05b-selection-count{font-weight:900;color:var(--ink2)}
      .m05b-batch-warning{margin:8px 0;color:var(--seal);font-weight:800;line-height:1.5}
      .m05b-group-row{display:grid;grid-template-columns:minmax(0,1fr) auto auto auto;gap:8px;align-items:center;margin:8px 0 12px}
      @media(max-width:640px){
        #multiStockAnalysisModal,#batchTechnicalReviewModal{padding:0;align-items:stretch;overflow:hidden}
        #multiStockAnalysisModal>.modal,#batchTechnicalReviewModal>.modal{width:100%;height:100vh;height:100dvh;max-height:100vh;max-height:100dvh;margin:0;padding:16px 14px 24px;border:0;box-shadow:none;overflow-y:auto;overscroll-behavior:contain;-webkit-overflow-scrolling:touch}
        #multiStockAnalysisModal button,#batchTechnicalReviewModal button{min-height:44px}
        #multiStockAnalysisModal .modal-actions,#batchTechnicalReviewModal .modal-actions{flex-wrap:wrap;gap:8px}
        #multiStockAnalysisModal .modal-actions .btn,#batchTechnicalReviewModal .modal-actions .btn{flex:1 1 140px}
        #multiStockAnalysisModal textarea,#batchTechnicalReviewModal textarea{font-size:16px!important}
        #multiStockAnalysisModal .m05a-stock-grid{grid-template-columns:1fr!important}
        #multiStockAnalysisModal .m05b-group-row{grid-template-columns:1fr 1fr}
        #multiStockAnalysisModal .m05b-group-row select{grid-column:1/-1}
        #batchTechnicalReviewResult .card{padding:12px;overflow-wrap:anywhere}
        #batchTechnicalReviewResult .card-note{font-size:13px;line-height:1.6}
      }`;
    document.head.appendChild(style);
  }

  function makeEntry(id,className){
    const button=document.createElement('button');
    button.className=className;
    button.id=id;
    button.type='button';
    button.textContent='今日分析';
    button.addEventListener('click',openModal);
    return button;
  }

  function ensureButton(){
    const tabs=document.querySelector('.tabs');
    const actions=document.getElementById('globalActions');
    if(tabs&&!document.getElementById('multiStockAnalysisQuickBtn'))tabs.insertBefore(makeEntry('multiStockAnalysisQuickBtn','m05a-tab-entry'),tabs.firstChild);
    if(actions&&!document.getElementById('multiStockAnalysisBtn'))actions.insertBefore(makeEntry('multiStockAnalysisBtn','btn small'),actions.firstChild);
  }

  function ensureModal(){
    let modal=document.getElementById('multiStockAnalysisModal');
    if(modal)return modal;
    modal=document.createElement('div');
    modal.className='modal-bg import-layer';
    modal.id='multiStockAnalysisModal';
    modal.innerHTML=`<div class="modal"><h2>今日多股分析</h2><div class="modal-sub">1 选择股票 · 2 刷新并生成 · 3 一次复制 / 粘贴 · 4 预览并一次保存</div><div id="multiStockSelection"></div><details class="m05a-request-details" id="multiStockRequestDetails"><summary>统一分析请求已准备（通常无需展开）</summary><textarea id="multiStockRequestText" aria-label="统一分析请求" readonly style="min-height:220px;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:12px"></textarea></details><div class="modal-actions" style="justify-content:flex-start;flex-wrap:wrap"><button class="btn ghost" id="multiStockCloseBtn" type="button">关闭</button><button class="btn ghost" id="multiStockRefreshBtn" type="button">刷新并生成请求</button><button class="btn" id="multiStockCopyBtn" type="button">复制统一请求</button></div><div class="form-row" style="margin-top:16px"><label for="multiStockResultText">粘贴 AI 返回的统一 Batch JSON</label><textarea id="multiStockResultText" style="min-height:180px;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:12px" placeholder='{"technicalReviews":[...]}'></textarea></div><div class="modal-actions"><button class="btn" id="multiStockPreviewBtn" type="button">查看统一结果</button></div><div class="card-note" id="multiStockStatus" role="status" aria-live="polite" style="white-space:pre-line;margin-top:10px"></div></div>`;
    document.body.appendChild(modal);
    modal.addEventListener('click',event=>{if(event.target===modal)closeModal()});
    document.getElementById('multiStockCloseBtn').addEventListener('click',closeModal);
    document.getElementById('multiStockRefreshBtn').addEventListener('click',refreshSelectedData);
    document.getElementById('multiStockCopyBtn').addEventListener('click',copyRequest);
    document.getElementById('multiStockPreviewBtn').addEventListener('click',previewResult);
    return modal;
  }

  function renderSelection(){
    const stocks=defaults();
    const prefs=preferenceState();
    const target=document.getElementById('multiStockSelection');
    const options=['<option value="">选择固定分析组合</option>'].concat(prefs.groups.map(group=>`<option value="${escAttr(group.id)}">${escHtml(group.name)}（${group.symbols.length}）</option>`)).join('');
    const warning=selectedSymbols.size>root.MultiStockAnalysis.BATCH_WARNING_THRESHOLD?`<div class="m05b-batch-warning">已选 ${selectedSymbols.size} 只，请求和 AI 返回内容可能较长（仍可继续）</div>`:'';
    target.innerHTML=`<div class="form-row"><label>分析股票</label><div class="m05b-selection-toolbar"><button class="btn ghost" id="multiStockSelectAllBtn" type="button">全选</button><button class="btn ghost" id="multiStockClearAllBtn" type="button">取消全选</button><span class="m05b-selection-count">已选 ${selectedSymbols.size} / ${stocks.length}</span></div>${warning}<div class="m05b-group-row"><select id="multiStockGroupSelect" aria-label="固定分析组合">${options}</select><button class="btn ghost" id="multiStockLoadGroupBtn" type="button">加载组合</button><button class="btn ghost" id="multiStockSaveGroupBtn" type="button">保存当前组合</button><button class="btn ghost" id="multiStockDeleteGroupBtn" type="button">删除组合</button></div><div class="m05a-stock-grid" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:8px">${stocks.map(stock=>`<label style="display:flex;align-items:center;gap:8px;min-height:44px;border:1px solid var(--line);padding:8px;margin:0"><input type="checkbox" data-multi-stock-symbol="${escAttr(symbolOf(stock))}" style="width:auto"${selectedSymbols.has(symbolOf(stock))?' checked':''}><span>${escHtml(stock.name||stock.code||stock.symbol)}<small style="display:block;color:var(--ink3)">${escHtml(symbolOf(stock))}</small></span></label>`).join('')}</div></div>`;
    document.getElementById('multiStockSelectAllBtn').addEventListener('click',()=>{selectedSymbols=new Set(stocks.map(symbolOf));renderSelection();generateRequest()});
    document.getElementById('multiStockClearAllBtn').addEventListener('click',()=>{selectedSymbols.clear();renderSelection();generateRequest()});
    document.getElementById('multiStockLoadGroupBtn').addEventListener('click',loadSelectedGroup);
    document.getElementById('multiStockSaveGroupBtn').addEventListener('click',saveCurrentGroup);
    document.getElementById('multiStockDeleteGroupBtn').addEventListener('click',deleteSelectedGroup);
    target.querySelectorAll('[data-multi-stock-symbol]').forEach(input=>input.addEventListener('change',()=>{
      if(input.checked)selectedSymbols.add(input.dataset.multiStockSymbol);else selectedSymbols.delete(input.dataset.multiStockSymbol);
      renderSelection();
      generateRequest();
    }));
  }

  function escHtml(value){return String(value??'').replace(/[&<>]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]))}
  function escAttr(value){return escHtml(value).replace(/"/g,'&quot;')}
  function selectedStocks(){return defaults().filter(stock=>selectedSymbols.has(symbolOf(stock)))}
  function groupId(name){return `group-${String(name||'').trim().toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff]+/g,'-').replace(/^-|-$/g,'').slice(0,36)||Date.now()}`}
  async function persistPreferences(next){
    state.multiStockAnalysis=next;
    await saveState(state);
    return next;
  }
  function chosenGroup(){
    const select=document.getElementById('multiStockGroupSelect');
    return preferenceState().groups.find(group=>group.id===(select&&select.value));
  }
  function loadSelectedGroup(){
    const group=chosenGroup();
    if(!group){setStatus('请先选择一个固定分析组合。');return}
    selectedSymbols=new Set(group.symbols);
    renderSelection();generateRequest();setStatus(`已加载组合“${group.name}”，共 ${group.symbols.length} 只。`);
  }
  async function saveCurrentGroup(){
    if(!selectedSymbols.size){setStatus('请先选择至少一只股票再保存组合。');return}
    const name=typeof prompt==='function'?String(prompt('组合名称')||'').trim():'';
    if(!name){setStatus('未保存组合：需要填写组合名称。');return}
    try{
      const current=preferenceState();
      const existing=current.groups.find(group=>group.name===name);
      const id=existing?existing.id:groupId(name);
      const next=root.MultiStockAnalysis.saveGroup(current,{id,name,symbols:[...selectedSymbols]},defaults());
      const makeDefault=!next.defaultGroupId&&typeof confirm==='function'&&confirm('设为默认分析组合？');
      await persistPreferences({...next,defaultGroupId:makeDefault?id:next.defaultGroupId});
      renderSelection();setStatus(`已保存固定分析组合“${name}”。`);
    }catch(error){setStatus(`组合保存失败：${error&&error.message?error.message:String(error)}`)}
  }
  async function deleteSelectedGroup(){
    const group=chosenGroup();
    if(!group){setStatus('请先选择要删除的组合。');return}
    if(typeof confirm==='function'&&!confirm(`删除分析组合“${group.name}”？`))return;
    try{await persistPreferences(root.MultiStockAnalysis.deleteGroup(preferenceState(),group.id,defaults()));renderSelection();setStatus(`已删除组合“${group.name}”。`)}catch(error){setStatus(`组合删除失败：${error&&error.message?error.message:String(error)}`)}
  }
  function helpers(){return {
    currentPrice:stock=>typeof getComparablePrice==='function'?(getComparablePrice(stock)||stockCurrentPrice(stock)):stock.currentPrice,
    technicalData:stock=>typeof normalizeTechnicalData==='function'?normalizeTechnicalData(stock.technicalData):stock.technicalData,
    technicalReview:stock=>typeof normalizeTechnicalReview==='function'?normalizeTechnicalReview(stock.technicalReview,stock):stock.technicalReview,
    dataFreshness:stock=>typeof normalizeDataFreshness==='function'?normalizeDataFreshness(stock.dataFreshness):stock.dataFreshness
  }}

  function setStatus(message){document.getElementById('multiStockStatus').textContent=message||''}
  async function refreshSelectedData(){
    const stocks=selectedStocks();
    if(!stocks.length){setStatus('请至少选择一只可刷新的股票。');return null}
    if(typeof refreshOnePrice!=='function'){setStatus('现有行情刷新功能不可用。');return null}
    const button=document.getElementById('multiStockRefreshBtn');
    const controls=['multiStockRefreshBtn','multiStockCopyBtn','multiStockPreviewBtn'].map(id=>document.getElementById(id)).filter(Boolean);
    controls.forEach(control=>{control.disabled=true});
    if(button)button.textContent='刷新中 0 / '+stocks.length;
    try{
      const summary=await root.MultiStockAnalysis.refreshSelectedStocks(
        stocks,
        stock=>refreshOnePrice(stock.id,{silent:true}),
        {delayMs:350,onProgress:progress=>{
          if(button)button.textContent=`刷新中 ${progress.index} / ${progress.total}`;
          const mark=progress.result.ok?'成功':'失败（保留旧数据）';
          setStatus(`${progress.result.name||progress.result.symbol}：${mark}`);
        }}
      );
      if(typeof applyMarketDataBridge==='function')await applyMarketDataBridge();
      await persistPreferences({...preferenceState(),lastSymbols:selectedStocks().map(symbolOf)});
      generateRequest();
      const failures=summary.results.filter(item=>!item.ok);
      const details=failures.map(item=>`- ${item.name||item.symbol}：${item.errors.join('；')||'刷新失败，已保留旧数据'}`).join('\n');
      setStatus(`批量刷新完成：成功 ${summary.successCount}，失败 ${summary.failureCount}。${details?'\n失败项未覆盖原数据：\n'+details:''}\n统一请求已按最新可用数据重新生成。`);
      return summary;
    }finally{
      controls.forEach(control=>{control.disabled=false});
      if(button)button.textContent='刷新并生成请求';
    }
  }
  function generateRequest(){
    try{
      const request=root.MultiStockAnalysis.buildRequest(selectedStocks(),helpers());
      document.getElementById('multiStockRequestText').value=request;
      setStatus(`已生成 1 个统一请求，包含 ${selectedStocks().length} 只股票。`);
      return request;
    }catch(error){
      document.getElementById('multiStockRequestText').value='';
      setStatus(error&&error.message?error.message:String(error));
      return '';
    }
  }

  function showCopyFeedback(label,message){
    const button=document.getElementById('multiStockCopyBtn');
    if(copyFeedbackTimer)clearTimeout(copyFeedbackTimer);
    if(button)button.textContent=label;
    setStatus(message);
    copyFeedbackTimer=setTimeout(()=>{if(button)button.textContent='复制统一请求'},2200);
  }
  async function copyRequest(){
    const request=generateRequest();
    if(!request)return;
    const button=document.getElementById('multiStockCopyBtn');
    if(button)button.textContent='复制中…';
    try{
      if(!navigator.clipboard||typeof navigator.clipboard.writeText!=='function')throw new Error('clipboard_unavailable');
      await navigator.clipboard.writeText(request);
      showCopyFeedback('已复制 ✓','统一请求已复制，可以直接粘贴给 AI。');
    }catch(_error){fallbackCopy()}
  }

  function fallbackCopy(){
    const field=document.getElementById('multiStockRequestText');
    field.focus();field.select();
    try{
      if(typeof document.execCommand!=='function'||document.execCommand('copy')!==true)throw new Error('fallback_failed');
      showCopyFeedback('已复制 ✓','统一请求已复制，可以直接粘贴给 AI。');
    }catch(_){
      const details=document.getElementById('multiStockRequestDetails');
      if(details)details.open=true;
      field.focus();field.select();
      showCopyFeedback('请手动复制','自动复制失败，请长按已选中的请求文本手动复制。');
    }
  }

  function previewResult(){
    const raw=document.getElementById('multiStockResultText').value.trim();
    if(!raw){setStatus('请先粘贴 AI 返回的 Batch JSON。');return}
    if(!root.BatchTechnicalReviewUI||typeof root.BatchTechnicalReviewUI.openWithInput!=='function'){
      setStatus('批量预览功能不可用。');return;
    }
    closeModal();
    root.BatchTechnicalReviewUI.openWithInput(raw,selectedStocks().map(symbolOf));
  }

  function openModal(){
    const modal=ensureModal();
    const stocks=defaults();
    selectedSymbols=new Set(root.MultiStockAnalysis.initialSelection(preferenceState(),stocks));
    document.getElementById('multiStockResultText').value='';
    modal.classList.add('show');
    renderSelection();
    generateRequest();
  }
  function closeModal(){const modal=document.getElementById('multiStockAnalysisModal');if(modal)modal.classList.remove('show')}

  ensureStyles();
  ensureButton();
  root.MultiStockAnalysisUI=Object.freeze({open:openModal,close:closeModal,generateRequest,refreshSelectedData,previewResult});
})(typeof globalThis!=='undefined'?globalThis:this);
