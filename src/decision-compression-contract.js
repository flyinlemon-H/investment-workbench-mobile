(function decisionCompressionContractModule(root,factory){
  const identity=typeof module==='object'&&module.exports?require('./symbol-identity.js'):root&&root.SymbolIdentity;
  const planV2=typeof module==='object'&&module.exports?require('./plan-v2.js'):root&&root.PlanV2;
  const batch=typeof module==='object'&&module.exports?require('./batch-technical-review.js'):root&&root.BatchTechnicalReview;
  const contextBuilder=typeof module==='object'&&module.exports?require('./decision-compression-context.js'):root&&root.DecisionCompressionContext;
  const api=factory(identity,planV2,batch,contextBuilder);
  if(typeof module==='object'&&module.exports)module.exports=api;
  if(root)root.DecisionCompressionContract=Object.freeze(api);
})(typeof globalThis!=='undefined'?globalThis:this,function(SymbolIdentity,PlanV2,BatchTechnicalReview,DecisionCompressionContext){
  'use strict';

  if(!SymbolIdentity||!PlanV2||!BatchTechnicalReview||!DecisionCompressionContext)throw new Error('Decision Compression contract dependencies are unavailable.');
  const SNAPSHOT_SCHEMA_VERSION='decision-compression.snapshot.v1';
  const STORE_SCHEMA_VERSION='decision-compression.store.v1';
  const PRIORITIES=Object.freeze(['high','medium','low']);
  const ACTION_CATEGORIES=Object.freeze(['review_now','wait_confirmation','risk_control','watch','no_action']);
  const BLOCKERS=Object.freeze(['plan_needs_review','full_conditions_unproven','allocation_conflict','stale_technical_data','missing_news','missing_fundamental','stale_plan_review','insufficient_market_context','no_current_plan']);
  const PLAN_STATES=Object.freeze(['current_valid','needs_review','historical_only','likely_invalid_unconfirmed','changed_since_review','recently_reviewed','no_current_plan']);
  const CONFIDENCE_LEVELS=Object.freeze(['high','medium','low']);
  const ROOT_FIELDS=Object.freeze(['reviewDate','overallSummary','items','noActionSymbols','confidence','limitations']);
  const ITEM_FIELDS=Object.freeze(['symbol','priority','actionCategory','reason','blockers','planState','confidence']);
  const DANGEROUS_PATTERNS=Object.freeze([/立即买入/,/立即卖出/,/必须加仓/,/必须减仓/,/直接执行计划/,/满仓/,/清仓/]);
  const UNSUPPORTED_MARKET_PATTERNS=Object.freeze([/大盘已突破/,/牛市开始/,/市场转强/,/风险偏好提升/,/盘中.{0,8}(?:上涨|下跌|反转|跳空)/]);
  const INTERNAL_TERMS=Object.freeze(['review_now','wait_confirmation','risk_control','watch','no_action','blockers','PlanReview','freshness','validityStatus','priceTriggerStatus','fullConditionStatus','planVersion','historical_only','likely_invalid']);

  function text(value){return String(value??'').trim()}
  function array(value){return Array.isArray(value)?value:[]}
  function object(value){return value&&typeof value==='object'&&!Array.isArray(value)}
  function clone(value){return value===undefined?undefined:JSON.parse(JSON.stringify(value))}
  function canonical(value){return SymbolIdentity.canonicalSymbol(value)}
  function exactFields(value,allowed,path){const keys=Object.keys(value),missing=allowed.filter(key=>!Object.prototype.hasOwnProperty.call(value,key)),extra=keys.filter(key=>!allowed.includes(key));if(missing.length)return `${path} 缺少字段：${missing.join(', ')}。`;if(extra.length)return `${path} 包含未知字段：${extra.join(', ')}。`;return ''}
  function invalid(code,message,input=null){return {ok:false,previewReady:false,writes:0,code,message,input,value:null,decision:null}}
  function contextFacts(context){return new Map(array(context&&context.stocks).map(stock=>[canonical(stock&&stock.symbol),stock]).filter(([symbol])=>symbol))}
  function priorityRank(value){return {high:3,medium:2,low:1}[value]||0}
  function validateUserText(value,path){
    if(typeof value!=='string'||!text(value))return `${path} 必须是非空字符串。`;
    if(DANGEROUS_PATTERNS.some(pattern=>pattern.test(value)))return `${path} 包含确定性交易指令。`;
    if(UNSUPPORTED_MARKET_PATTERNS.some(pattern=>pattern.test(value)))return `${path} 包含没有权威市场或盘中事实支持的表述。`;
    const internal=INTERNAL_TERMS.find(term=>new RegExp(term.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'),'i').test(value));if(internal)return `${path} 暴露了内部状态词 ${internal}。`;
    if(/完整条件已满足|已到完整计划条件/.test(value))return `${path} 把未证明的完整条件写成已确认。`;
    return '';
  }
  function validate(value,options={}){
    if(!object(value))return invalid('invalid_top_level','顶层必须是包含 decisionCompression 的对象。');const top=exactFields(value,['decisionCompression'],'顶层');if(top)return invalid('invalid_top_level',top);
    const decision=value.decisionCompression;if(!object(decision))return invalid('invalid_decision','decisionCompression 必须是对象。');const shape=exactFields(decision,ROOT_FIELDS,'decisionCompression');if(shape)return invalid('invalid_decision',shape);
    const context=options.context;if(!context||context.schemaVersion!==DecisionCompressionContext.SCHEMA_VERSION)return invalid('missing_context','缺少本次权威决策压缩上下文。');
    if(typeof decision.reviewDate!=='string'||decision.reviewDate!==context.reviewDate)return invalid('review_date_mismatch',`reviewDate 必须为 ${context.reviewDate}。`);
    for(const [path,valueText] of [['overallSummary',decision.overallSummary]]){const error=validateUserText(valueText,path);if(error)return invalid('unsafe_text',error)}
    if(text(decision.overallSummary).length>100||/[\r\n]/.test(decision.overallSummary))return invalid('summary_too_long','overallSummary 必须是一句简洁结论。');
    if(!CONFIDENCE_LEVELS.includes(decision.confidence))return invalid('invalid_confidence','decisionCompression.confidence 无效。');
    if(!Array.isArray(decision.items)||decision.items.length>DecisionCompressionContext.MAX_DETAILED_ITEMS)return invalid('invalid_items',`items 必须是数组且最多 ${DecisionCompressionContext.MAX_DETAILED_ITEMS} 项。`);
    if(!Array.isArray(decision.noActionSymbols))return invalid('invalid_no_action','noActionSymbols 必须是数组。');
    if(!Array.isArray(decision.limitations)||decision.limitations.length>3)return invalid('invalid_limitations','limitations 必须是最多 3 条的数组。');
    for(let index=0;index<decision.limitations.length;index+=1){const error=validateUserText(decision.limitations[index],`limitations[${index}]`);if(error)return invalid('unsafe_text',error)}
    const expected=array(context.portfolio&&context.portfolio.selectedSymbols).map(canonical),allowed=new Set(expected),facts=contextFacts(context),seen=new Set();let previousRank=Infinity;
    for(let index=0;index<decision.items.length;index+=1){
      const item=decision.items[index],path=`items[${index}]`;if(!object(item))return invalid('invalid_item',`${path} 必须是对象。`);const itemShape=exactFields(item,ITEM_FIELDS,path);if(itemShape)return invalid('invalid_item',itemShape);
      const symbol=canonical(item.symbol);if(!symbol||!allowed.has(symbol))return invalid('unknown_symbol',`${path}.symbol 不在本次所选股票中：${text(item.symbol)||'（空）'}。`);if(seen.has(symbol))return invalid('duplicate_symbol',`symbol 重复：${symbol}。`);seen.add(symbol);item.symbol=symbol;
      if(!PRIORITIES.includes(item.priority))return invalid('invalid_priority',`${symbol} priority 无效。`);const rank=priorityRank(item.priority);if(rank>previousRank)return invalid('invalid_ranking','items 必须按 high、medium、low 排序。');previousRank=rank;
      if(!ACTION_CATEGORIES.includes(item.actionCategory)||item.actionCategory==='no_action')return invalid('invalid_action_category',`${symbol} 的暂不处理事项应放入 noActionSymbols。`);
      const reasonError=validateUserText(item.reason,`${path}.reason`);if(reasonError)return invalid('unsafe_text',reasonError);if(text(item.reason).length>120||/[\r\n]/.test(item.reason))return invalid('reason_too_long',`${symbol} reason 必须保持一句简洁说明。`);
      if(!Array.isArray(item.blockers)||item.blockers.length>2||new Set(item.blockers).size!==item.blockers.length)return invalid('invalid_blockers',`${symbol} blockers 必须是最多 2 个且不重复。`);
      const stockFacts=facts.get(symbol),eligibility=object(stockFacts&&stockFacts.eligibleBlockers)?stockFacts.eligibleBlockers:{};for(const blocker of item.blockers){if(!BLOCKERS.includes(blocker))return invalid('invalid_blocker',`${symbol} blocker 无效：${text(blocker)}。`);if(eligibility[blocker]!==true)return invalid('unsupported_blocker',`${symbol} blocker 没有程序事实支持：${blocker}。`)}
      if(!PLAN_STATES.includes(item.planState)||!array(stockFacts&&stockFacts.allowedPlanStates).includes(item.planState))return invalid('unsupported_plan_state',`${symbol} planState 没有当前计划事实支持。`);
      if(!CONFIDENCE_LEVELS.includes(item.confidence))return invalid('invalid_confidence',`${symbol} confidence 无效。`);
      if(item.priority==='high'&&stockFacts&&stockFacts.highAttentionEligible!==true)return invalid('unsupported_high_priority',`${symbol} 缺少支持高优先级的当前事实。`);
      if(stockFacts&&stockFacts.technical&&stockFacts.technical.todayUse!=='current'&&item.confidence==='high')return invalid('unsupported_confidence',`${symbol} 技术资料并非当前可用，置信度不能为 high。`);
      const triggeredUnproven=array(stockFacts&&stockFacts.plans).some(plan=>plan.priceTrigger==='triggered'&&plan.fullConditions!=='confirmed');if(triggeredUnproven&&!item.blockers.includes('full_conditions_unproven'))return invalid('missing_condition_blocker',`${symbol} 的计划价格已触发但完整条件未确认，必须保留“条件未确认”阻碍。`);
      if(item.planState==='likely_invalid_unconfirmed'&&(item.actionCategory!=='review_now'||!item.blockers.includes('plan_needs_review')))return invalid('unsafe_likely_invalid',`${symbol} 的可能失效判断必须保持为立即复核，并说明计划需复核。`);
    }
    for(let index=0;index<decision.noActionSymbols.length;index+=1){const raw=decision.noActionSymbols[index];if(typeof raw!=='string')return invalid('invalid_no_action',`noActionSymbols[${index}] 必须是字符串。`);const symbol=canonical(raw);if(!symbol||!allowed.has(symbol))return invalid('unknown_symbol',`noActionSymbols[${index}] 不在本次所选股票中：${text(raw)||'（空）'}。`);if(seen.has(symbol))return invalid('duplicate_symbol',`symbol 重复：${symbol}。`);seen.add(symbol);decision.noActionSymbols[index]=symbol}
    const missing=expected.filter(symbol=>!seen.has(symbol));if(missing.length)return invalid('missing_symbol',`以下所选股票未被覆盖：${missing.join('、')}。`);
    return {ok:true,previewReady:true,writes:0,code:'valid',message:'今日处理结果已通过严格校验，尚未写入。',input:null,value:{decisionCompression:clone(decision)},decision:clone(decision)};
  }
  function process(raw,options={}){const parsed=BatchTechnicalReview.parseAiBatchJsonInput(raw);if(!parsed.ok)return invalid('parse_error',parsed.error.reason,parsed.input);const result=validate(parsed.value,options);result.input=parsed.input;return result}
  function auditHash(context){return `decisionctx_${PlanV2.hash({reviewDate:context.reviewDate,auditReferences:context.auditReferences,stocks:context.stocks.map(stock=>({symbol:stock.symbol,holding:stock.holding,plans:stock.plans,allocationConflict:stock.allocationConflict,technical:stock.technical,keyLimitations:stock.keyLimitations}))})}`}
  function buildSnapshot(result,context,options={}){if(!result||!result.ok||!result.previewReady)throw new Error('只有校验通过的今日处理结果可以创建快照。');if(!context||context.schemaVersion!==DecisionCompressionContext.SCHEMA_VERSION)throw new Error('决策压缩上下文无效。');const savedAt=text(options.savedAt)||new Date().toISOString(),snapshotId=`decision_${PlanV2.hash(`${savedAt}|${auditHash(context)}|${PlanV2.stable(result.decision)}`)}`;return {snapshotId,schemaVersion:SNAPSHOT_SCHEMA_VERSION,reviewDate:result.decision.reviewDate,generatedAt:context.generatedAt,savedAt,selectedSymbols:context.portfolio.selectedSymbols.slice(),contextHash:auditHash(context),auditReferences:clone(context.auditReferences),decision:clone(result.decision)}}
  function validateSnapshot(snapshot){const source=object(snapshot)?snapshot:{},errors=[];if(source.schemaVersion!==SNAPSHOT_SCHEMA_VERSION)errors.push('Decision Compression snapshot schema invalid');if(!text(source.snapshotId)||!/^\d{4}-\d{2}-\d{2}$/.test(text(source.reviewDate))||!text(source.savedAt)||!Array.isArray(source.selectedSymbols)||!text(source.contextHash)||!object(source.auditReferences)||!object(source.decision))errors.push('Decision Compression snapshot shape invalid');return {ok:errors.length===0,errors}}
  function validateStore(store){const source=object(store)?store:{},errors=[];if(source.schemaVersion!==STORE_SCHEMA_VERSION)errors.push('Decision Compression store schema invalid');if(source.current!==null&&source.current!==undefined){const current=validateSnapshot(source.current);errors.push(...current.errors)}if(!Array.isArray(source.history))errors.push('Decision Compression history invalid');else source.history.forEach(snapshot=>errors.push(...validateSnapshot(snapshot).errors));return {ok:errors.length===0,errors}}
  function rebuildContext(state,context){return DecisionCompressionContext.buildDecisionContext(state&&state.portfolioReview&&state.portfolioReview.current,state&&state.stocks,{allStocks:state&&state.stocks,reviewDate:context.reviewDate,generatedAt:context.generatedAt,planReviewStore:state&&state.planReviews})}
  function buildCandidate(currentState,result,options={}){
    if(!currentState||!Array.isArray(currentState.stocks))throw new Error('当前应用状态无效。');const context=options.context;if(!context)throw new Error('缺少决策压缩上下文。');const freshContext=rebuildContext(currentState,context);if(auditHash(freshContext)!==auditHash(context))throw new Error('组合复核、计划、计划复核或持仓事实已变化，请重新生成今日处理。');
    const candidate=clone(currentState),snapshot=buildSnapshot(result,context,options),existing=object(candidate.decisionCompression)?candidate.decisionCompression:{},history=array(existing.history).filter(item=>item&&item.reviewDate!==snapshot.reviewDate).concat(clone(snapshot)).sort((a,b)=>String(b.reviewDate).localeCompare(String(a.reviewDate))).slice(0,30);candidate.decisionCompression={schemaVersion:STORE_SCHEMA_VERSION,current:snapshot,history};const validation=validateStore(candidate.decisionCompression);if(!validation.ok)throw new Error(validation.errors.join('；'));return {candidate,snapshot};
  }
  async function commit(result,currentState,deps={},options={}){
    if(!result||!result.ok||!result.previewReady)return {status:'invalid',writes:0,error:new Error(result&&result.message||'今日处理结果无效。')};if(typeof deps.saveCandidate!=='function')return {status:'failed',stage:'candidate',writes:0,error:new Error('今日处理持久化依赖不可用。')};let built;try{built=buildCandidate(currentState,result,options)}catch(error){return {status:'invalid',stage:'candidate',writes:0,error}}
    try{const saved=await deps.saveCandidate(built.candidate,{critical:true}),next=saved&&saved.state?saved.state:(saved&&Array.isArray(saved.stocks)?saved:built.candidate);if(saved===false||(saved&&saved.ok===false))throw new Error('critical save 返回失败。');if(typeof deps.adoptCandidate==='function')deps.adoptCandidate(next);if(typeof deps.render==='function')deps.render();return {status:'completed',writes:1,state:next,snapshot:built.snapshot}}catch(error){if(typeof deps.rollback==='function')deps.rollback(currentState);return {status:'failed',stage:'save',writes:1,error}}
  }
  function renderPreview(result,nameForSymbol=symbol=>symbol){const esc=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));if(!result||!result.ok)return `<div class="hint"><b>结果校验失败</b><div class="card-note">${esc(result&&result.message||'无法校验结果。')}</div><div class="card-note">尚未写入任何数据。</div></div>`;const action={review_now:'立即复核',wait_confirmation:'等待确认',risk_control:'风险控制',watch:'观察'},priority={high:'高',medium:'中',low:'低'};return `<div class="hint"><b>预览通过</b><div class="card-note">${result.decision.items.length} 项今日处理 · ${result.decision.noActionSymbols.length} 只暂不处理 · 尚未写入</div></div><div class="card"><div class="card-title">今日组合结论</div><div>${esc(result.decision.overallSummary)}</div></div>${result.decision.items.map(item=>`<div class="card"><div class="card-title">${esc(nameForSymbol(item.symbol))} · ${esc(action[item.actionCategory])} · ${esc(priority[item.priority])}</div><div>${esc(item.reason)}</div></div>`).join('')}`}
  function createCommitController(){let pending=false;return Object.freeze({get pending(){return pending},run(fn){if(pending)return Promise.resolve({status:'busy'});pending=true;return Promise.resolve().then(fn).finally(()=>{pending=false})}})}

  return Object.freeze({SNAPSHOT_SCHEMA_VERSION,STORE_SCHEMA_VERSION,PRIORITIES,ACTION_CATEGORIES,BLOCKERS,PLAN_STATES,CONFIDENCE_LEVELS,ROOT_FIELDS,ITEM_FIELDS,DANGEROUS_PATTERNS,UNSUPPORTED_MARKET_PATTERNS,validate,process,auditHash,buildSnapshot,validateSnapshot,validateStore,buildCandidate,commit,renderPreview,createCommitController,clone});
});
