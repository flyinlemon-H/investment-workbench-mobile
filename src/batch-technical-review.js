(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  if(root)root.BatchTechnicalReview=Object.freeze(api);
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';

  const STATUS=Object.freeze({
    VALID:'valid',
    INVALID_SCHEMA:'invalid_schema',
    UNKNOWN_SYMBOL:'unknown_symbol',
    DUPLICATE_SYMBOL:'duplicate_symbol',
    INVALID_ITEM:'invalid_item',
    MISSING_SYMBOL:'missing_symbol',
    MISSING_TECHNICAL_REVIEW:'missing_technical_review'
  });

  function emptySummary(){
    return {total:0,valid:0,invalid:0,unknown:0,duplicate:0};
  }

  function invalidBatch(code,reason){
    return {batchStatus:'invalid',summary:emptySummary(),items:[],error:{code,reason}};
  }

  function stockSymbol(stock){
    return String(stock&&(stock.code||stock.symbol)||'').trim();
  }

  function buildStockIndex(stocks){
    const index=new Map();
    const ambiguous=new Set();
    (Array.isArray(stocks)?stocks:[]).forEach(stock=>{
      const symbol=stockSymbol(stock);
      if(!symbol)return;
      if(index.has(symbol))ambiguous.add(symbol);
      else index.set(symbol,stock);
    });
    ambiguous.forEach(symbol=>index.delete(symbol));
    return {index,ambiguous};
  }

  function previewFor(stock,symbol,review){
    const shortTerm=review&&review.shortTermTechnical&&typeof review.shortTermTechnical==='object'?review.shortTermTechnical:{};
    const cycle=review&&review.cycleTechnical&&typeof review.cycleTechnical==='object'?review.cycleTechnical:{};
    return {
      symbol,
      stockName:String(stock&&(stock.name||stock.code||stock.symbol)||symbol),
      validationStatus:STATUS.VALID,
      batchStatus:'pending',
      summary:String(review&&(review.finalTechnicalConclusion||shortTerm.technicalSummary)||''),
      trendStatus:String(shortTerm.trendStatus||''),
      cyclePosition:String(cycle.cyclePosition||''),
      supportLevels:Array.isArray(shortTerm.supportLevels)?shortTerm.supportLevels.slice():[],
      resistanceLevels:Array.isArray(shortTerm.resistanceLevels)?shortTerm.resistanceLevels.slice():[]
    };
  }

  function classifyItem(item,index,stockLookup,seen,validateTechnicalReview){
    const base={index,symbol:'',matchedStock:null,status:STATUS.INVALID_ITEM,reason:'',technicalReview:null,preview:null};
    if(!item||typeof item!=='object'||Array.isArray(item)){
      return {...base,reason:'Item 必须是对象。'};
    }
    if(typeof item.symbol!=='string'||!item.symbol.trim()){
      return {...base,status:STATUS.MISSING_SYMBOL,reason:'缺少非空字符串 symbol。',technicalReview:item.technicalReview??null};
    }
    const symbol=item.symbol.trim();
    base.symbol=symbol;
    base.technicalReview=item.technicalReview??null;
    if(!Object.prototype.hasOwnProperty.call(item,'technicalReview')){
      return {...base,status:STATUS.MISSING_TECHNICAL_REVIEW,reason:'缺少 technicalReview。'};
    }
    if(seen.has(symbol)){
      return {...base,status:STATUS.DUPLICATE_SYMBOL,reason:`symbol ${symbol} 在本批次中重复。`};
    }
    seen.add(symbol);
    if(stockLookup.ambiguous.has(symbol)){
      return {...base,status:STATUS.UNKNOWN_SYMBOL,reason:`现有股票中 symbol ${symbol} 不唯一，无法安全匹配。`};
    }
    const stock=stockLookup.index.get(symbol);
    if(!stock){
      return {...base,status:STATUS.UNKNOWN_SYMBOL,reason:`未找到 exact symbol：${symbol}。`};
    }
    const matchedStock={id:stock.id??null,symbol:stockSymbol(stock),name:String(stock.name||'')};
    let validation;
    try{
      validation=validateTechnicalReview(item.technicalReview,stock);
    }catch(error){
      validation={valid:false,error:error&&error.message?error.message:String(error)};
    }
    if(!validation||validation.valid!==true){
      return {...base,matchedStock,status:STATUS.INVALID_SCHEMA,reason:String(validation&&validation.error||'technicalReview 未通过单股校验。')};
    }
    const normalized=validation.normalized;
    return {...base,matchedStock,status:STATUS.VALID,reason:'已通过单股 technicalReview 校验。',technicalReview:normalized,preview:previewFor(stock,symbol,normalized)};
  }

  function summarize(items){
    const summary=emptySummary();
    summary.total=items.length;
    items.forEach(item=>{
      if(item.status===STATUS.VALID)summary.valid++;
      else if(item.status===STATUS.UNKNOWN_SYMBOL)summary.unknown++;
      else if(item.status===STATUS.DUPLICATE_SYMBOL)summary.duplicate++;
      else summary.invalid++;
    });
    return summary;
  }

  function duplicateConflictSymbols(result){
    const conflicts=new Set();
    const items=result&&Array.isArray(result.items)?result.items:[];
    items.forEach(item=>{
      if(item&&item.status===STATUS.DUPLICATE_SYMBOL&&item.symbol)conflicts.add(item.symbol);
    });
    return conflicts;
  }

  function eligibleEntries(result){
    const conflicts=duplicateConflictSymbols(result);
    const items=result&&Array.isArray(result.items)?result.items:[];
    return items.filter(item=>item&&item.status===STATUS.VALID&&!conflicts.has(item.symbol));
  }

  function cloneState(value){
    return JSON.parse(JSON.stringify(value));
  }

  function buildCandidate(currentState,result,applyTechnicalReview){
    if(typeof applyTechnicalReview!=='function')throw new Error('technicalReview apply helper 不可用。');
    if(!currentState||typeof currentState!=='object'||!Array.isArray(currentState.stocks))throw new Error('当前应用状态无效。');
    const eligible=eligibleEntries(result);
    const candidate=cloneState(currentState);
    const lookup=buildStockIndex(candidate.stocks);
    eligible.forEach(entry=>{
      const stock=lookup.index.get(entry.symbol);
      if(!stock||lookup.ambiguous.has(entry.symbol))throw new Error(`candidate 中无法 exact match symbol：${entry.symbol}。`);
      applyTechnicalReview(stock,entry.technicalReview);
    });
    return {candidate,eligible};
  }

  function batchCommitSummary(result,updated,failed=0){
    const total=result&&result.summary?Number(result.summary.total)||0:0;
    const warnings=result&&result.summary?Number(result.summary.warning||result.summary.warnings)||0:0;
    return {updated,skipped:Math.max(0,total-updated),warnings,failed};
  }

  async function commit(result,currentState,deps={}){
    const eligible=eligibleEntries(result);
    if(!eligible.length){
      return {status:'no_eligible',summary:batchCommitSummary(result,0),eligible:[]};
    }
    if(typeof deps.saveCandidate!=='function'||typeof deps.adoptCandidate!=='function'||typeof deps.render!=='function'){
      return {status:'failed',stage:'candidate',summary:batchCommitSummary(result,0,eligible.length),eligible,error:new Error('批量持久化依赖不可用。')};
    }
    let candidate;
    try{
      candidate=buildCandidate(currentState,result,deps.applyTechnicalReview).candidate;
    }catch(error){
      return {status:'failed',stage:'candidate',summary:batchCommitSummary(result,0,eligible.length),eligible,error};
    }
    let savedCandidate=candidate;
    try{
      const saved=await deps.saveCandidate(candidate,{critical:true});
      if(saved===false||(saved&&saved.ok===false))throw new Error('critical save 返回失败。');
      if(saved&&saved.state&&typeof saved.state==='object')savedCandidate=saved.state;
      else if(saved&&typeof saved==='object'&&Array.isArray(saved.stocks))savedCandidate=saved;
    }catch(error){
      return {status:'failed',stage:'save',summary:batchCommitSummary(result,0,eligible.length),eligible,error};
    }
    try{
      deps.adoptCandidate(savedCandidate);
      if(typeof deps.afterAdopt==='function')deps.afterAdopt(eligible,savedCandidate);
      deps.render();
    }catch(error){
      return {status:'saved_render_failed',stage:'render',summary:batchCommitSummary(result,eligible.length),eligible,state:savedCandidate,error};
    }
    return {status:'completed',summary:batchCommitSummary(result,eligible.length),eligible,state:savedCandidate};
  }

  function createCommitController(commitFn=commit){
    let pending=false;
    return Object.freeze({
      get pending(){return pending},
      run(...args){
        if(pending)return Promise.resolve({status:'busy'});
        pending=true;
        return Promise.resolve().then(()=>commitFn(...args)).finally(()=>{pending=false});
      }
    });
  }

  function process(rawJson,stocks,validateTechnicalReview){
    if(typeof validateTechnicalReview!=='function')return invalidBatch('validator_unavailable','单股 technicalReview validator 不可用。');
    let envelope;
    try{
      const text=String(rawJson??'').trim();
      if(!text)throw new Error('输入为空。');
      envelope=JSON.parse(text);
    }catch(error){
      return invalidBatch('parse_error',`JSON 解析失败：${error&&error.message?error.message:String(error)}`);
    }
    if(!envelope||typeof envelope!=='object'||Array.isArray(envelope)){
      return invalidBatch('invalid_top_level','顶层必须是包含 technicalReviews 数组的对象。');
    }
    if(!Object.prototype.hasOwnProperty.call(envelope,'technicalReviews')){
      return invalidBatch('missing_technical_reviews','顶层缺少 technicalReviews。');
    }
    if(!Array.isArray(envelope.technicalReviews)){
      return invalidBatch('invalid_technical_reviews','technicalReviews 必须是数组。');
    }
    const stockLookup=buildStockIndex(stocks);
    const seen=new Set();
    const items=envelope.technicalReviews.map((item,index)=>classifyItem(item,index,stockLookup,seen,validateTechnicalReview));
    const summary=summarize(items);
    const batchStatus=summary.total>0&&summary.valid===summary.total?'valid':(summary.valid>0?'partial':'invalid');
    items.forEach(item=>{if(item.preview)item.preview.batchStatus=batchStatus});
    return {batchStatus,summary,items,error:null};
  }

  function escapeHtml(value){
    return String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  }

  function renderResult(result){
    if(!result)return '';
    if(result.error)return `<div class="hint"><b>批次无效</b><div class="card-note">${escapeHtml(result.error.reason)}</div></div>`;
    const s=result.summary;
    const eligible=eligibleEntries(result).length;
    const summary=`<div class="hint"><b>批次状态：${escapeHtml(result.batchStatus)}</b><div class="card-note">总计 ${s.total} · 可更新 ${eligible} · 有效 ${s.valid} · 无效 ${s.invalid} · 未知 ${s.unknown} · 重复 ${s.duplicate}</div></div>`;
    const items=result.items.map(item=>{
      const title=item.matchedStock&&item.matchedStock.name?`${item.matchedStock.name} · ${item.symbol}`:(item.symbol||`第 ${item.index+1} 项`);
      const preview=item.preview?`<div class="card-note">${escapeHtml(item.preview.summary||'暂无结论摘要')}</div><div class="card-note">趋势 ${escapeHtml(item.preview.trendStatus||'—')} · 周期 ${escapeHtml(item.preview.cyclePosition||'—')}</div>`:'';
      return `<div class="card" style="margin:10px 0"><div class="card-title">${escapeHtml(title)} · ${escapeHtml(item.status)}</div><div class="card-note">${escapeHtml(item.reason)}</div>${preview}</div>`;
    }).join('');
    return summary+items;
  }

  function createWorkbenchCandidateSaver(deps={}){
    if(typeof deps.getState!=='function'||typeof deps.setState!=='function'||typeof deps.persist!=='function'){
      throw new Error('Workbench candidate save adapter 依赖不可用。');
    }
    return async function saveCandidate(candidate,options={}){
      const authoritative=deps.getState();
      try{
        await deps.persist(candidate,{...options,critical:true});
        return deps.getState()||candidate;
      }catch(error){
        deps.setState(authoritative);
        throw error;
      }
    };
  }

  return {STATUS,process,renderResult,buildStockIndex,eligibleEntries,buildCandidate,commit,createCommitController,createWorkbenchCandidateSaver};
});

(function(root){
  'use strict';
  if(!root||!root.document)return;

  let currentPreview=null;
  const commitController=root.BatchTechnicalReview.createCommitController();
  const saveCandidateWithRollback=root.BatchTechnicalReview.createWorkbenchCandidateSaver({
    getState:()=>state,
    setState:value=>{state=value},
    persist:(candidate,options)=>saveState(candidate,options)
  });

  function ensureModal(){
    let modal=document.getElementById('batchTechnicalReviewModal');
    if(modal)return modal;
    modal=document.createElement('div');
    modal.className='modal-bg import-layer';
    modal.id='batchTechnicalReviewModal';
    modal.innerHTML=`<div class="modal"><h2>批量技术复核</h2><div class="modal-sub">先严格匹配、校验和预览；确认后仅批量更新可应用的技术复核。</div><details class="m05a-batch-input-details" id="batchTechnicalReviewInputDetails" open><summary>Batch JSON 输入（预览后自动收起）</summary><textarea id="batchTechnicalReviewText" aria-label="批量 JSON" style="min-height:260px;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:12px" placeholder='{"technicalReviews":[{"symbol":"601138.SS","technicalReview":{}}]}'></textarea></details><div class="modal-actions"><button class="btn ghost" id="batchTechnicalReviewCloseBtn" type="button">关闭</button><button class="btn ghost" id="batchTechnicalReviewPreviewBtn" type="button">解析并预览</button><button class="btn" id="batchTechnicalReviewConfirmBtn" type="button" disabled>确认批量更新</button></div><div id="batchTechnicalReviewStatus" style="margin-top:14px"></div><div id="batchTechnicalReviewResult" style="margin-top:14px"></div></div>`;
    document.body.appendChild(modal);
    modal.addEventListener('click',event=>{if(event.target===modal)closeModal()});
    document.getElementById('batchTechnicalReviewCloseBtn').addEventListener('click',closeModal);
    document.getElementById('batchTechnicalReviewPreviewBtn').addEventListener('click',previewBatch);
    document.getElementById('batchTechnicalReviewConfirmBtn').addEventListener('click',confirmBatch);
    document.getElementById('batchTechnicalReviewText').addEventListener('input',invalidatePreview);
    return modal;
  }

  function setStatus(message,kind=''){
    const target=document.getElementById('batchTechnicalReviewStatus');
    if(!target)return;
    target.className=message?'hint':'';
    target.style.whiteSpace='pre-line';
    target.textContent=message;
    if(kind==='error')target.style.borderLeftColor='var(--seal)';
    else target.style.borderLeftColor='';
  }

  function setSaving(saving){
    const confirmButton=document.getElementById('batchTechnicalReviewConfirmBtn');
    const previewButton=document.getElementById('batchTechnicalReviewPreviewBtn');
    if(confirmButton){
      confirmButton.disabled=saving||!currentPreview||root.BatchTechnicalReview.eligibleEntries(currentPreview).length===0;
      confirmButton.textContent=saving?'保存中…':'确认批量更新';
    }
    if(previewButton)previewButton.disabled=saving;
  }

  function invalidatePreview(){
    if(commitController.pending)return;
    currentPreview=null;
    setSaving(false);
    setStatus('');
    const result=document.getElementById('batchTechnicalReviewResult');
    if(result)result.innerHTML='';
  }

  function openModal(){
    const modal=ensureModal();
    currentPreview=null;
    document.getElementById('batchTechnicalReviewResult').innerHTML='';
    const inputDetails=document.getElementById('batchTechnicalReviewInputDetails');
    if(inputDetails)inputDetails.open=true;
    setStatus('');
    setSaving(false);
    modal.classList.add('show');
    setTimeout(()=>document.getElementById('batchTechnicalReviewText').focus(),50);
  }

  function openWithInput(raw){
    openModal();
    document.getElementById('batchTechnicalReviewText').value=String(raw??'');
    previewBatch();
  }

  function closeModal(){
    const modal=document.getElementById('batchTechnicalReviewModal');
    if(modal)modal.classList.remove('show');
  }

  function previewBatch(){
    if(commitController.pending)return;
    const raw=document.getElementById('batchTechnicalReviewText').value;
    const stocks=(typeof state!=='undefined'&&state&&Array.isArray(state.stocks))?state.stocks:[];
    const validator=typeof validateSingleStockTechnicalReview==='function'?validateSingleStockTechnicalReview:null;
    const result=root.BatchTechnicalReview.process(raw,stocks,validator);
    currentPreview=result;
    document.getElementById('batchTechnicalReviewResult').innerHTML=root.BatchTechnicalReview.renderResult(result);
    const eligible=root.BatchTechnicalReview.eligibleEntries(result).length;
    const inputDetails=document.getElementById('batchTechnicalReviewInputDetails');
    if(inputDetails&&eligible>0)inputDetails.open=false;
    setStatus(eligible?`可更新 ${eligible} 只股票；确认后将一次保存全部变更。`:'No eligible technical reviews to update.');
    setSaving(false);
  }

  async function confirmBatch(){
    if(commitController.pending)return;
    if(!currentPreview||root.BatchTechnicalReview.eligibleEntries(currentPreview).length===0){
      setStatus('No eligible technical reviews to update.','error');
      return;
    }
    setStatus('Saving...');
    setSaving(true);
    const result=await commitController.run(currentPreview,state,{
      applyTechnicalReview:(stock,review)=>applyTechnicalReviewToStock(stock,review),
      saveCandidate:saveCandidateWithRollback,
      adoptCandidate:candidate=>{state=candidate},
      afterAdopt:eligible=>eligible.forEach(entry=>{
        if(entry.matchedStock&&typeof markV13DecisionReviewDirty==='function')markV13DecisionReviewDirty(entry.matchedStock.id,'technicalReview');
      }),
      render:()=>render()
    });
    if(result.status==='completed'){
      const s=result.summary;
      setStatus(`Batch update completed\nUpdated: ${s.updated}\nSkipped: ${s.skipped}\nWarnings: ${s.warnings}\nFailed: ${s.failed}`);
      currentPreview=null;
    }else if(result.status==='saved_render_failed'){
      setStatus('Batch update was saved, but the page could not refresh. Reload the page to view the saved data.','error');
      currentPreview=null;
    }else if(result.status==='no_eligible'){
      setStatus('No eligible technical reviews to update.','error');
    }else if(result.status!=='busy'){
      setStatus('Batch update failed.\nNo batch changes were saved.','error');
    }
    setSaving(false);
  }

  const button=document.getElementById('batchTechnicalReviewBtn');
  if(button)button.addEventListener('click',openModal);
  root.BatchTechnicalReviewUI=Object.freeze({open:openModal,openWithInput,close:closeModal});
})(typeof globalThis!=='undefined'?globalThis:this);
