(function(root,factory){
  const identity=typeof module==='object'&&module.exports?require('./symbol-identity.js'):root&&root.SymbolIdentity;
  const strictAiJson=typeof module==='object'&&module.exports?require('./strict-ai-json.js'):root&&root.StrictAiJson;
  const api=factory(identity,strictAiJson);
  if(typeof module==='object'&&module.exports)module.exports=api;
  if(root)root.BatchTechnicalReview=Object.freeze(api);
})(typeof globalThis!=='undefined'?globalThis:this,function(SymbolIdentity,StrictAiJson){
  'use strict';

  if(!SymbolIdentity||typeof SymbolIdentity.canonicalSymbol!=='function')throw new Error('SymbolIdentity helper 不可用。');
  if(!StrictAiJson||typeof StrictAiJson.parseStrictAiJson!=='function')throw new Error('StrictAiJson helper 不可用。');
  const canonicalSymbol=SymbolIdentity.canonicalSymbol;

  const STATUS=Object.freeze({
    VALID:'valid',
    INVALID_SCHEMA:'invalid_schema',
    UNKNOWN_SYMBOL:'unknown_symbol',
    DUPLICATE_SYMBOL:'duplicate_symbol',
    INVALID_ITEM:'invalid_item',
    MISSING_SYMBOL:'missing_symbol',
    MISSING_TECHNICAL_REVIEW:'missing_technical_review'
  });
  const TREND_STATUSES=Object.freeze(['uptrend','downtrend','sideways','recovery','rebound','unclear']);
  const RISK_FLAGS=Object.freeze(['near_previous_high','high_level_rebreakout','high_level_overextension','short_term_volatility','resistance_overhead','gap_risk','trend_weakening','below_ma20','below_ma60','distribution_risk','breakout_failure','volume_divergence','support_breakdown']);
  const CONFIDENCE_LEVELS=Object.freeze(['high','medium','low']);
  const contract=Object.freeze({
    trendStatuses:TREND_STATUSES,
    riskFlags:RISK_FLAGS,
    confidenceLevels:CONFIDENCE_LEVELS
  });
  const V2_REVIEW_FIELDS=Object.freeze(['trendStatus','technicalSummary','riskFlags','actionHint','confidence','finalTechnicalConclusion','holdHint','addHint','reduceHint']);
  const ERROR_TYPES=Object.freeze({
    PARSE:'PARSE_ERROR',
    STRUCTURE:'STRUCTURE_ERROR',
    COMPLETENESS:'COMPLETENESS_ERROR',
    VALIDATION:'VALIDATION_ERROR'
  });

  function emptySummary(){
    return {total:0,valid:0,invalid:0,unknown:0,duplicate:0};
  }

  function invalidBatch(code,reason,type=ERROR_TYPES.VALIDATION,input=null){
    return {batchStatus:'invalid',summary:emptySummary(),items:[],error:{code,reason,type},errorType:type,input};
  }

  function parseAiBatchJsonInput(raw){
    const result=StrictAiJson.parseStrictAiJson(raw);
    if(result.ok)return result;
    return {...result,error:{...result.error,type:ERROR_TYPES.PARSE}};
  }

  function stockSymbol(stock){
    return String(stock&&(stock.code||stock.symbol)||'').trim();
  }

  function technicalReviewFromJudgment(review,stock){
    if(!review||typeof review!=='object'||Array.isArray(review))return {valid:false,error:'review 必须是对象。'};
    const extra=Object.keys(review).filter(key=>!V2_REVIEW_FIELDS.includes(key));
    if(extra.length)return {valid:false,error:`review 包含程序事实或未知字段：${extra.join(', ')}。`};
    const trendStatus=String(review.trendStatus||'').trim();
    if(!TREND_STATUSES.includes(trendStatus))return {valid:false,error:`trendStatus 必须是固定枚举：${TREND_STATUSES.join(', ')}。`};
    const confidence=String(review.confidence||'').trim();
    if(!CONFIDENCE_LEVELS.includes(confidence))return {valid:false,error:`confidence 必须是固定枚举：${CONFIDENCE_LEVELS.join(', ')}。`};
    if(!Array.isArray(review.riskFlags))return {valid:false,error:'riskFlags 必须是字符串数组。'};
    const invalidRiskFlags=[...new Set(review.riskFlags.filter(flag=>typeof flag!=='string'||!RISK_FLAGS.includes(flag)).map(flag=>typeof flag==='string'?flag:(JSON.stringify(flag)??String(flag))))];
    if(invalidRiskFlags.length)return {valid:false,error:`riskFlags 包含不支持的枚举：${invalidRiskFlags.join(', ')}。`};
    for(const key of V2_REVIEW_FIELDS.filter(key=>!['trendStatus','riskFlags','confidence'].includes(key))){
      if(typeof review[key]!=='string')return {valid:false,error:`review.${key} 必须是字符串。`};
    }
    const facts=stock&&stock.technicalData&&typeof stock.technicalData==='object'?stock.technicalData:{};
    const previous=stock&&stock.technicalReview&&typeof stock.technicalReview==='object'?stock.technicalReview:{};
    const history=Array.isArray(stock&&stock.priceHistory)?stock.priceHistory.filter(row=>row&&row.is_complete_bar!==false):[];
    const technicalDataStatus=String(facts.technicalDataStatus||'unavailable');
    const warning=String(facts.technicalWarning||'')||(technicalDataStatus==='fresh'?'':`technicalDataStatus: ${technicalDataStatus}`);
    return {valid:true,normalized:{
      updatedAt:new Date().toISOString(),
      inputCoverage:{hasRecentKline:history.length>0,hasCycleKline:Boolean(previous.cycleTechnical&&previous.cycleTechnical.dataSource&&previous.cycleTechnical.dataSource!=='none'),cycleDataSource:String(previous.cycleTechnical&&previous.cycleTechnical.dataSource||'program_facts'),warning},
      shortTermTechnical:{
        lookbackDays:history.length,price:facts.price??null,priceUpdatedAt:String(facts.technicalAsOf||facts.priceUpdatedAt||''),
        ma5:facts.ma5??null,ma10:facts.ma10??null,ma20:facts.ma20??null,ma60:facts.ma60??null,
        trendStatus, supportLevels:Array.isArray(facts.supportLevels)?facts.supportLevels:[],resistanceLevels:Array.isArray(facts.resistanceLevels)?facts.resistanceLevels:[],
        technicalSummary:review.technicalSummary,riskFlags:review.riskFlags.slice(),actionHint:review.actionHint,confidence
      },
      cycleTechnical:previous.cycleTechnical&&typeof previous.cycleTechnical==='object'?previous.cycleTechnical:{lookbackDays:history.length,cyclePosition:'unclear',cycleSummary:'',cycleHigh:null,cycleLow:null,currentPercentile:null,distanceToCycleHighPct:null,distanceToCycleLowPct:null,lastCycleUpdatedAt:String(facts.technicalAsOf||''),dataSource:'program_facts',confidence},
      priceActionEvent:previous.priceActionEvent&&typeof previous.priceActionEvent==='object'?previous.priceActionEvent:{detected:false,type:'unknown',changePct:null,volumeStatus:'unknown',needsNewsExplanation:false,eventReason:''},
      finalTechnicalConclusion:review.finalTechnicalConclusion,holdHint:review.holdHint,addHint:review.addHint,reduceHint:review.reduceHint
    }};
  }

  function buildStockIndex(stocks){
    return SymbolIdentity.buildStockIndex(stocks);
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

  function classifyItem(item,index,stockLookup,seen,validateTechnicalReview,expectedSet){
    const base={index,symbol:'',matchedStock:null,status:STATUS.INVALID_ITEM,reason:'',contractVersion:'',technicalReview:null,preview:null};
    if(!item||typeof item!=='object'||Array.isArray(item)){
      return {...base,reason:'Item 必须是对象。'};
    }
    if(typeof item.symbol!=='string'||!item.symbol.trim()){
      return {...base,status:STATUS.MISSING_SYMBOL,reason:'缺少非空字符串 symbol。',technicalReview:item.technicalReview??item.review??null};
    }
    const symbol=canonicalSymbol(item.symbol);
    base.symbol=symbol;
    const isV2=Object.prototype.hasOwnProperty.call(item,'review');
    const isV1=Object.prototype.hasOwnProperty.call(item,'technicalReview');
    if(isV2&&isV1)return {...base,status:STATUS.INVALID_SCHEMA,reason:'每项只能使用 review（V2）或 technicalReview（兼容 V1）其中之一。'};
    if(!isV2&&!isV1)return {...base,status:STATUS.MISSING_TECHNICAL_REVIEW,reason:'缺少 review。'};
    const itemExtra=Object.keys(item).filter(key=>!['symbol',isV2?'review':'technicalReview'].includes(key));
    if(itemExtra.length)return {...base,status:STATUS.INVALID_SCHEMA,reason:`Item 包含未知字段：${itemExtra.join(', ')}。`};
    base.contractVersion=isV2?'v2':'v1';
    base.technicalReview=isV2?item.review:item.technicalReview;
    if(seen.has(symbol)){
      return {...base,status:STATUS.DUPLICATE_SYMBOL,reason:`symbol ${symbol} 在本批次中重复。`};
    }
    seen.add(symbol);
    if(expectedSet&&expectedSet.size&&!expectedSet.has(symbol)){
      return {...base,status:STATUS.UNKNOWN_SYMBOL,reason:`symbol ${symbol} 不在本次 expected symbols 中。`};
    }
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
      const contract=isV2?technicalReviewFromJudgment(item.review,stock):{valid:true,normalized:item.technicalReview};
      if(!contract.valid)validation=contract;
      else validation=validateTechnicalReview(contract.normalized,stock);
    }catch(error){
      validation={valid:false,error:error&&error.message?error.message:String(error)};
    }
    if(!validation||validation.valid!==true){
      return {...base,matchedStock,status:STATUS.INVALID_SCHEMA,reason:String(validation&&validation.error||'technicalReview 未通过单股校验。')};
    }
    const normalized=validation.normalized;
    return {...base,matchedStock,status:STATUS.VALID,reason:`已通过 Batch Contract ${isV2?'V2':'V1 compatibility'} 和单股校验。`,technicalReview:normalized,preview:previewFor(stock,symbol,normalized)};
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
    if(!result||result.batchStatus!=='valid')return [];
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
      const stock=lookup.index.get(canonicalSymbol(entry.symbol));
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

  function process(rawJson,stocks,validateTechnicalReview,options={}){
    if(typeof validateTechnicalReview!=='function')return invalidBatch('validator_unavailable','单股 technicalReview validator 不可用。');
    const parsed=parseAiBatchJsonInput(rawJson);
    if(!parsed.ok)return invalidBatch(parsed.error.code,parsed.error.reason,parsed.error.type,parsed.input);
    const envelope=parsed.value;
    if(!envelope||typeof envelope!=='object'||Array.isArray(envelope)){
      return invalidBatch('invalid_top_level','顶层必须是包含 technicalReviews 数组的对象。',ERROR_TYPES.STRUCTURE,parsed.input);
    }
    if(!Object.prototype.hasOwnProperty.call(envelope,'technicalReviews')){
      return invalidBatch('missing_technical_reviews','顶层缺少 technicalReviews。',ERROR_TYPES.STRUCTURE,parsed.input);
    }
    if(!Array.isArray(envelope.technicalReviews)){
      return invalidBatch('invalid_technical_reviews','technicalReviews 必须是数组。',ERROR_TYPES.STRUCTURE,parsed.input);
    }
    const topLevelExtra=Object.keys(envelope).filter(key=>key!=='technicalReviews');
    if(topLevelExtra.length)return invalidBatch('unknown_top_level_fields',`顶层包含未知字段：${topLevelExtra.join(', ')}。`,ERROR_TYPES.STRUCTURE,parsed.input);
    const stockLookup=buildStockIndex(stocks);
    const expectedSymbols=Array.isArray(options.expectedSymbols)?options.expectedSymbols.map(canonicalSymbol).filter((symbol,index,all)=>symbol&&all.indexOf(symbol)===index):[];
    const expectedSet=expectedSymbols.length?new Set(expectedSymbols):null;
    const seen=new Set();
    const items=envelope.technicalReviews.map((item,index)=>classifyItem(item,index,stockLookup,seen,validateTechnicalReview,expectedSet));
    const detectedSymbols=Array.from(new Set(items.map(item=>item.symbol).filter(Boolean)));
    const missingSymbols=expectedSymbols.filter(symbol=>!detectedSymbols.includes(symbol));
    missingSymbols.forEach(symbol=>items.push({index:items.length,symbol,matchedStock:null,status:STATUS.MISSING_SYMBOL,reason:`AI 返回缺少 expected symbol：${symbol}。`,contractVersion:'v2',technicalReview:null,preview:null}));
    const summary=summarize(items);
    const batchStatus=summary.total>0&&summary.valid===summary.total&&missingSymbols.length===0?'valid':'invalid';
    items.forEach(item=>{if(item.preview)item.preview.batchStatus=batchStatus});
    const completenessFailure=missingSymbols.length>0||items.some(item=>[STATUS.MISSING_SYMBOL,STATUS.UNKNOWN_SYMBOL,STATUS.DUPLICATE_SYMBOL].includes(item.status));
    const errorType=batchStatus==='valid'?null:(completenessFailure?ERROR_TYPES.COMPLETENESS:ERROR_TYPES.VALIDATION);
    return {batchStatus,summary,items,error:null,errorType,input:parsed.input,completeness:{expected:expectedSymbols.length||detectedSymbols.length,detected:detectedSymbols.length,expectedSymbols,detectedSymbols,missingSymbols}};
  }

  function escapeHtml(value){
    return String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  }

  function renderResult(result){
    if(!result)return '';
    const titles={[ERROR_TYPES.PARSE]:'JSON 格式有误',[ERROR_TYPES.STRUCTURE]:'结果结构有误',[ERROR_TYPES.COMPLETENESS]:'结果不完整',[ERROR_TYPES.VALIDATION]:'结果校验失败'};
    if(result.error)return `<div class="hint"><b>${escapeHtml(titles[result.errorType]||'批次无效')}</b><div class="card-note">${escapeHtml(result.error.reason)}</div><div class="card-note">本批次未写入。</div></div>`;
    const s=result.summary;
    const eligible=eligibleEntries(result).length;
    const completeness=result.completeness||{};
    const missing=Array.isArray(completeness.missingSymbols)&&completeness.missingSymbols.length?`<div class="card-note">Missing: ${escapeHtml(completeness.missingSymbols.join(', '))}</div>`:'';
    const counts=completeness.expected!==undefined?`应有 ${completeness.expected} · 识别 ${completeness.detected}`:`总计 ${s.total}`;
    const normalized=result.input&&result.input.smartQuotesRecovered?'<div class="card-note">已自动修正非标准引号</div>':'';
    const heading=result.batchStatus==='valid'?'批次预览通过':(titles[result.errorType]||'批次无效');
    const summary=`<div class="hint"><b>${escapeHtml(heading)}</b>${normalized}<div class="card-note">${counts} · 可更新 ${eligible} · 有效 ${s.valid} · 无效 ${s.invalid} · 未知 ${s.unknown} · 重复 ${s.duplicate}</div>${missing}${result.batchStatus!=='valid'?'<div class="card-note">本批次未写入。</div>':''}</div>`;
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

  return {STATUS,ERROR_TYPES,TREND_STATUSES,RISK_FLAGS,CONFIDENCE_LEVELS,contract,V2_REVIEW_FIELDS,preprocessStrictAiJson:StrictAiJson.preprocessStrictAiJson,parseAiBatchJsonInput,technicalReviewFromJudgment,process,renderResult,buildStockIndex,eligibleEntries,buildCandidate,commit,createCommitController,createWorkbenchCandidateSaver};
});

(function(root){
  'use strict';
  if(!root||!root.document)return;

  let currentPreview=null;
  let expectedSymbols=[];
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
    modal.innerHTML=`<div class="modal"><h2>批量技术复核</h2><div class="modal-sub">先严格匹配、校验和预览；确认后仅批量更新完整且可应用的技术复核。</div><details class="m05a-batch-input-details" id="batchTechnicalReviewInputDetails" open><summary>JSON 输入（预览后自动收起）</summary><textarea id="batchTechnicalReviewText" aria-label="批量 JSON" style="min-height:260px;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:12px" placeholder='{"technicalReviews":[{"symbol":"601138.SS","review":{"trendStatus":"sideways"}}]}'></textarea></details><div class="modal-actions"><button class="btn ghost" id="batchTechnicalReviewCloseBtn" type="button">关闭</button><button class="btn ghost" id="batchTechnicalReviewPreviewBtn" type="button">解析并预览</button><button class="btn" id="batchTechnicalReviewConfirmBtn" type="button" disabled>批量保存</button></div><div id="batchTechnicalReviewStatus" style="margin-top:14px"></div><div id="batchTechnicalReviewResult" style="margin-top:14px"></div></div>`;
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
      confirmButton.textContent=saving?'保存中…':'批量保存';
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
    expectedSymbols=[];
    document.getElementById('batchTechnicalReviewResult').innerHTML='';
    const inputDetails=document.getElementById('batchTechnicalReviewInputDetails');
    if(inputDetails)inputDetails.open=true;
    setStatus('');
    setSaving(false);
    modal.classList.add('show');
    setTimeout(()=>document.getElementById('batchTechnicalReviewText').focus(),50);
  }

  function openWithInput(raw,symbols=[]){
    openModal();
    expectedSymbols=Array.isArray(symbols)?symbols.slice():[];
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
    const result=root.BatchTechnicalReview.process(raw,stocks,validator,{expectedSymbols});
    currentPreview=result;
    document.getElementById('batchTechnicalReviewResult').innerHTML=root.BatchTechnicalReview.renderResult(result);
    const eligible=root.BatchTechnicalReview.eligibleEntries(result).length;
    const inputDetails=document.getElementById('batchTechnicalReviewInputDetails');
    if(inputDetails&&eligible>0)inputDetails.open=false;
    if(eligible)setStatus(`${result.input&&result.input.smartQuotesRecovered?'已自动修正非标准引号\n':''}可更新 ${eligible} 只股票；确认后将一次保存全部变更。`);
    else if(result.errorType===root.BatchTechnicalReview.ERROR_TYPES.PARSE)setStatus(`JSON 格式有误\n${result.input&&result.input.smartQuoteRecoveryAttempted?'检测到非标准引号，自动修复失败。\n本批次未写入。':'无法解析 AI 结果，本批次未写入。'}`,'error');
    else if(result.errorType===root.BatchTechnicalReview.ERROR_TYPES.STRUCTURE)setStatus(`结果结构有误\n${result.error&&result.error.reason||'顶层结构不符合批量结果要求。'}\n本批次未写入。`,'error');
    else if(result.errorType===root.BatchTechnicalReview.ERROR_TYPES.COMPLETENESS){
      const completeness=result.completeness||{};
      const missing=Array.isArray(completeness.missingSymbols)?completeness.missingSymbols:[];
      setStatus(`结果不完整\n应有 ${completeness.expected??0}\n识别 ${completeness.detected??0}\n缺少 ${missing.length}${missing.length?`：${missing.join(', ')}`:''}\n本批次未写入。`,'error');
    }else{
      const invalid=result.items&&result.items.find(item=>item.status!==root.BatchTechnicalReview.STATUS.VALID);
      setStatus(`结果校验失败\n${invalid?`${invalid.symbol||`第 ${invalid.index+1} 项`}：${invalid.reason}`:'字段未通过校验。'}\n本批次未写入。`,'error');
    }
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
