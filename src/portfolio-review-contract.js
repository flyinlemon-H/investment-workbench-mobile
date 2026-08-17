(function portfolioReviewContractModule(root,factory){
  const identity=typeof module==='object'&&module.exports?require('./symbol-identity.js'):root&&root.SymbolIdentity;
  const batch=typeof module==='object'&&module.exports?require('./batch-technical-review.js'):root&&root.BatchTechnicalReview;
  const api=factory(identity,batch);
  if(typeof module==='object'&&module.exports)module.exports=api;
  if(root)root.PortfolioReviewContract=Object.freeze(api);
})(typeof globalThis!=='undefined'?globalThis:this,function(SymbolIdentity,BatchTechnicalReview){
  'use strict';
  const PORTFOLIO_RISK_LEVELS=Object.freeze(['low','moderate','high','unclear']);
  const PRIORITY_LEVELS=Object.freeze(['high','medium','low']);
  const PLAN_STATUSES=Object.freeze(['approaching','triggered','invalidated','not_close','unclear']);
  const CONFIDENCE_LEVELS=Object.freeze(['high','medium','low']);
  const REVIEW_FIELDS=Object.freeze(['reviewDate','summary','marketContext','portfolioRiskLevel','priorityStocks','riskAttention','planWatch','candidateReview','portfolioRisks','todayFocus','dataLimitations','confidence']);
  const ITEM_FIELDS=Object.freeze({priorityStocks:['symbol','priority','reason','focus','planRelation'],riskAttention:['symbol','reason'],planWatch:['symbol','status','reason'],candidateReview:['symbol','reason']});

  function text(value){return String(value??'').trim()}
  function clone(value){return JSON.parse(JSON.stringify(value))}
  function object(value){return value&&typeof value==='object'&&!Array.isArray(value)}
  function canonical(value){return SymbolIdentity.canonicalSymbol(value)}
  function fail(code,message,input=null){return {ok:false,code,message,input,value:null,review:null}}
  function exactFields(value,allowed,path){const extra=Object.keys(value).filter(key=>!allowed.includes(key)),missing=allowed.filter(key=>!Object.prototype.hasOwnProperty.call(value,key));if(missing.length)return `${path} 缺少字段：${missing.join(', ')}。`;if(extra.length)return `${path} 包含未知字段：${extra.join(', ')}。`;return ''}
  function validateStringArray(value,path){if(!Array.isArray(value))return `${path} 必须是数组。`;for(let i=0;i<value.length;i+=1)if(typeof value[i]!=='string'||!value[i].trim())return `${path}[${i}] 必须是非空字符串。`;return ''}
  function validateSymbolItems(review,key,allowedSymbols){
    const items=review[key];if(!Array.isArray(items))return `${key} 必须是数组。`;
    const seen=new Set();
    for(let index=0;index<items.length;index+=1){
      const item=items[index],path=`${key}[${index}]`;
      if(!object(item))return `${path} 必须是对象。`;
      const shape=exactFields(item,ITEM_FIELDS[key],path);if(shape)return shape;
      const symbol=canonical(item.symbol);if(!symbol||!allowedSymbols.has(symbol))return `${path}.symbol 不在本次所选股票中：${text(item.symbol)||'（空）'}。`;
      if(seen.has(symbol))return `${key} 中 symbol 重复：${symbol}。`;seen.add(symbol);item.symbol=symbol;
      for(const field of ITEM_FIELDS[key].filter(field=>field!=='symbol'))if(typeof item[field]!=='string')return `${path}.${field} 必须是字符串。`;
      if(!text(item.reason))return `${path}.reason 不能为空。`;
      if(key==='priorityStocks'&&!PRIORITY_LEVELS.includes(item.priority))return `${symbol} priority 使用了不支持的值：${text(item.priority)||'（空）'}。`;
      if(key==='planWatch'&&!PLAN_STATUSES.includes(item.status))return `${symbol} planWatch.status 使用了不支持的值：${text(item.status)||'（空）'}。`;
    }
    return '';
  }
  function validate(value,options={}){
    if(!object(value))return fail('invalid_top_level','顶层必须是包含 portfolioReview 的对象。');
    const top=exactFields(value,['portfolioReview'],'顶层');if(top)return fail('invalid_top_level',top);
    const review=value.portfolioReview;if(!object(review))return fail('invalid_review','portfolioReview 必须是对象。');
    const shape=exactFields(review,REVIEW_FIELDS,'portfolioReview');if(shape)return fail('invalid_review',shape);
    for(const field of ['reviewDate','summary','marketContext','portfolioRiskLevel','confidence'])if(typeof review[field]!=='string')return fail('invalid_field',`portfolioReview.${field} 必须是字符串。`);
    if(!/^\d{4}-\d{2}-\d{2}$/.test(review.reviewDate))return fail('invalid_review_date','reviewDate 必须是 YYYY-MM-DD。');
    if(options.reviewDate&&review.reviewDate!==options.reviewDate)return fail('review_date_mismatch',`reviewDate 必须为 ${options.reviewDate}。`);
    if(!text(review.summary))return fail('invalid_summary','summary 不能为空。');
    if(!PORTFOLIO_RISK_LEVELS.includes(review.portfolioRiskLevel))return fail('invalid_risk_level',`portfolioRiskLevel 使用了不支持的值：${text(review.portfolioRiskLevel)||'（空）'}。`);
    if(!CONFIDENCE_LEVELS.includes(review.confidence))return fail('invalid_confidence',`confidence 使用了不支持的值：${text(review.confidence)||'（空）'}。`);
    const allowed=new Set((options.expectedSymbols||[]).map(canonical).filter(Boolean));if(!allowed.size)return fail('missing_expected_symbols','缺少本次所选股票范围，无法安全校验 symbol。');
    for(const key of Object.keys(ITEM_FIELDS)){const error=validateSymbolItems(review,key,allowed);if(error)return fail('invalid_symbol_section',error)}
    for(const key of ['portfolioRisks','todayFocus','dataLimitations']){const error=validateStringArray(review[key],key);if(error)return fail('invalid_string_array',error)}
    return {ok:true,code:'valid',message:'组合复核结果校验通过。',input:null,value:{portfolioReview:clone(review)},review:clone(review)};
  }
  function process(raw,options={}){
    if(!BatchTechnicalReview||typeof BatchTechnicalReview.parseAiBatchJsonInput!=='function')return fail('parser_unavailable','安全 JSON 解析器不可用。');
    const parsed=BatchTechnicalReview.parseAiBatchJsonInput(raw);if(!parsed.ok)return fail('parse_error',parsed.error.reason,parsed.input);
    const result=validate(parsed.value,options);result.input=parsed.input;return result;
  }
  function buildSnapshot(result,options={}){
    if(!result||result.ok!==true)throw new Error('只有校验通过的组合复核可以创建快照。');
    const generatedAt=text(options.generatedAt)||new Date().toISOString(),savedAt=text(options.savedAt)||new Date().toISOString();
    return {reviewDate:result.review.reviewDate,generatedAt,savedAt,selectedSymbols:(options.expectedSymbols||[]).map(canonical).filter(Boolean),review:clone(result.review)};
  }
  function buildCandidate(currentState,result,options={}){
    if(!currentState||typeof currentState!=='object'||!Array.isArray(currentState.stocks))throw new Error('当前应用状态无效。');
    const candidate=clone(currentState),snapshot=buildSnapshot(result,options),existing=candidate.portfolioReview&&typeof candidate.portfolioReview==='object'?candidate.portfolioReview:{};
    const history=Array.isArray(existing.history)?clone(existing.history):[];
    const nextHistory=history.filter(item=>item&&item.reviewDate!==snapshot.reviewDate).concat(clone(snapshot)).sort((a,b)=>String(b.reviewDate).localeCompare(String(a.reviewDate))).slice(0,30);
    candidate.portfolioReview={current:snapshot,history:nextHistory};
    if(snapshot.selectedSymbols.length){
      const preferences=candidate.multiStockAnalysis&&typeof candidate.multiStockAnalysis==='object'?candidate.multiStockAnalysis:{};
      candidate.multiStockAnalysis={...preferences,lastSymbols:snapshot.selectedSymbols.slice()};
    }
    return {candidate,snapshot};
  }
  async function commit(result,currentState,deps={},options={}){
    if(!result||result.ok!==true)return {status:'invalid',error:new Error(result&&result.message||'组合复核结果无效。')};
    if(typeof deps.saveCandidate!=='function'||typeof deps.adoptCandidate!=='function'||typeof deps.render!=='function')return {status:'failed',stage:'candidate',error:new Error('组合复核持久化依赖不可用。')};
    let built;try{built=buildCandidate(currentState,result,options)}catch(error){return {status:'failed',stage:'candidate',error}}
    let savedCandidate=built.candidate;
    try{const saved=await deps.saveCandidate(built.candidate,{critical:true});if(saved===false||(saved&&saved.ok===false))throw new Error('critical save 返回失败。');if(saved&&saved.state&&typeof saved.state==='object')savedCandidate=saved.state;else if(saved&&typeof saved==='object'&&Array.isArray(saved.stocks))savedCandidate=saved}catch(error){return {status:'failed',stage:'save',error}}
    try{deps.adoptCandidate(savedCandidate);deps.render()}catch(error){return {status:'saved_render_failed',stage:'render',state:savedCandidate,snapshot:built.snapshot,error}}
    return {status:'completed',state:savedCandidate,snapshot:built.snapshot};
  }
  function renderPreview(result,nameForSymbol=symbol=>symbol){
    const esc=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
    if(!result||!result.ok)return `<div class="hint"><b>结果校验失败</b><div class="card-note">${esc(result&&result.message||'无法校验结果。')}</div><div class="card-note">尚未写入任何数据。</div></div>`;
    const riskLabels={low:'低',moderate:'中等',high:'高',unclear:'不明确'},confidenceLabels={high:'高',medium:'中',low:'低'},priorityLabels={high:'高',medium:'中',low:'低'};
    const review=result.review,priority=review.priorityStocks.map(item=>`<div class="m05c-preview-row"><div><b>${esc(nameForSymbol(item.symbol))}</b> · 优先级 ${esc(priorityLabels[item.priority]||item.priority)}</div><div>${esc(item.reason)}</div></div>`).join('');
    return `<div class="hint"><b>预览通过</b><div class="card-note">风险 ${esc(riskLabels[review.portfolioRiskLevel]||review.portfolioRiskLevel)} · 置信度 ${esc(confidenceLabels[review.confidence]||review.confidence)} · 尚未写入</div></div><div class="card"><div class="card-title">组合结论</div><div>${esc(review.summary)}</div></div>${priority?`<div class="card"><div class="card-title">优先关注</div>${priority}</div>`:''}`;
  }
  function createCommitController(commitFn=commit){let pending=false;return Object.freeze({get pending(){return pending},run(...args){if(pending)return Promise.resolve({status:'busy'});pending=true;return Promise.resolve().then(()=>commitFn(...args)).finally(()=>{pending=false})}})}
  function text(value){return String(value??'').trim()}
  return {PORTFOLIO_RISK_LEVELS,PRIORITY_LEVELS,PLAN_STATUSES,CONFIDENCE_LEVELS,REVIEW_FIELDS,ITEM_FIELDS,validate,process,buildSnapshot,buildCandidate,commit,renderPreview,createCommitController};
});
