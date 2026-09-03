(function decisionCompressionContextModule(root,factory){
  const identity=typeof module==='object'&&module.exports?require('./symbol-identity.js'):root&&root.SymbolIdentity;
  const planV2=typeof module==='object'&&module.exports?require('./plan-v2.js'):root&&root.PlanV2;
  const planReview=typeof module==='object'&&module.exports?require('./plan-review.js'):root&&root.PlanReview;
  const portfolioContext=typeof module==='object'&&module.exports?require('./portfolio-review-context.js'):root&&root.PortfolioReviewContext;
  const api=factory(identity,planV2,planReview,portfolioContext);
  if(typeof module==='object'&&module.exports)module.exports=api;
  if(root)root.DecisionCompressionContext=Object.freeze(api);
})(typeof globalThis!=='undefined'?globalThis:this,function(SymbolIdentity,PlanV2,PlanReview,PortfolioReviewContext){
  'use strict';

  if(!SymbolIdentity||!PlanV2||!PlanReview||!PortfolioReviewContext)throw new Error('Decision Compression dependencies are unavailable.');
  const SCHEMA_VERSION='decision-compression-context.v1';
  const MAX_DETAILED_ITEMS=5;
  const BLOCKER_PRECEDENCE=Object.freeze(['full_conditions_unproven','plan_needs_review','allocation_conflict','stale_plan_review','stale_technical_data','missing_news','missing_fundamental','no_current_plan','insufficient_market_context']);
  const SAFETY_BLOCKERS=Object.freeze(['full_conditions_unproven','plan_needs_review','allocation_conflict','stale_plan_review']);
  const MARKET_CONTEXT=Object.freeze({status:'unavailable',meaning:'当前没有权威市场环境模块；不得据此声称大盘突破、牛市开始、市场转强或风险偏好提升。'});

  function text(value){return String(value??'').trim()}
  function array(value){return Array.isArray(value)?value:[]}
  function object(value){return value&&typeof value==='object'&&!Array.isArray(value)?value:{}}
  function clone(value){return value===undefined?undefined:JSON.parse(JSON.stringify(value))}
  function canonical(value){return SymbolIdentity.canonicalSymbol(value)}
  function dateOnly(value){const match=text(value).match(/^\d{4}-\d{2}-\d{2}/);return match?match[0]:''}
  function number(value){if(value===null||value===undefined||value==='')return null;const result=Number(value);return Number.isFinite(result)?result:null}
  function priorityRank(value){return {high:3,medium:2,low:1}[value]||0}
  function symbolOf(stock){return canonical(stock&&(stock.code||stock.symbol))}
  function stockMap(stocks){return new Map(array(stocks).map(stock=>[symbolOf(stock),stock]).filter(([symbol])=>symbol))}

  function portfolioReviewReference(snapshot){
    const source=object(snapshot),review=object(source.review),content={schemaVersion:'portfolio-review.snapshot.v1',reviewDate:dateOnly(source.reviewDate||review.reviewDate),generatedAt:text(source.generatedAt),savedAt:text(source.savedAt),selectedSymbols:array(source.selectedSymbols).map(canonical).filter(Boolean),planReferences:clone(object(source.planReferences)),review:clone(review)};
    return {schemaVersion:content.schemaVersion,reviewDate:content.reviewDate,generatedAt:content.generatedAt,savedAt:content.savedAt,reviewHash:`portfolio_${PlanV2.hash(content)}`};
  }
  function reviewSignals(review,symbol){
    const normalized=canonical(symbol),priority=array(review.priorityStocks).find(item=>canonical(item&&item.symbol)===normalized),risk=array(review.riskAttention).find(item=>canonical(item&&item.symbol)===normalized),plan=array(review.planWatch).find(item=>canonical(item&&item.symbol)===normalized),candidate=array(review.candidateReview).find(item=>canonical(item&&item.symbol)===normalized);
    return {priority:priority&&['high','medium','low'].includes(priority.priority)?priority.priority:null,reason:text(priority&&priority.reason),riskAttention:Boolean(risk),riskReason:text(risk&&risk.reason),planWatchStatus:text(plan&&plan.status)||null,planWatchReason:text(plan&&plan.reason),candidateReview:Boolean(candidate),candidateReason:text(candidate&&candidate.reason)};
  }
  function allocationConflict(holding,allocation,plans){
    const weight=number(holding&&holding.currentWeight),configurationUpper=number(allocation&&allocation.upperLimit),planUppers=array(plans).map(plan=>number(plan&&plan.allocationConstraint&&plan.allocationConstraint.maxPositionPct)).filter(value=>value!==null&&value>0),upperCandidates=[configurationUpper,...planUppers].filter(value=>value!==null&&value>0),upperLimit=upperCandidates.length?Math.min(...upperCandidates):null,conflict=weight!==null&&upperLimit!==null&&weight>upperLimit;
    return {conflict,currentWeight:weight,upperLimit,meaning:conflict?`当前权重 ${weight.toFixed(1)}% 高于已知配置或计划上限 ${upperLimit.toFixed(1)}%。`:(upperLimit===null?'没有可比较的明确仓位上限。':(weight===null?'当前权重口径不足，无法确认是否超出上限。':'当前权重未高于已知上限。'))};
  }
  function rawPlanFor(stock,planId){return array(stock&&stock.plans).map(plan=>PlanV2.normalizePlan(plan)).find(plan=>plan.id===planId)||null}
  function compactPlanFacts(stock,baseStock,reviewDate,store){
    const symbol=baseStock.stock.symbol;
    return array(baseStock.plans).map(compact=>{
      const raw=rawPlanFor(stock,compact.id),status=raw?PlanReview.reviewStatusForPlan(store,symbol,raw):{review:null,freshness:{status:'absent',reason:'尚未保存计划复核'}},currentReview=status.review&&status.freshness.status==='current'?status.review:null,staleReview=status.review&&status.freshness.status==='stale'?status.review:null;
      return {...(compact.planMode==='state_watch'?{planMode:'state_watch',definitionSummary:compact.definitionSummary,reviewAction:compact.reviewAction}:{}),planId:compact.id,planVersion:compact.planVersion,planSnapshotHash:raw?PlanReview.planSnapshotHash(raw):'',validity:compact.freshness,priceTrigger:compact.priceTriggerStatus,fullConditions:compact.fullConditionStatus,allocationConstraint:clone(compact.allocationConstraint),currentReview:currentReview?{reviewId:currentReview.reviewId,outcome:currentReview.reviewOutcome,reviewedAt:currentReview.reviewedAt,confidence:currentReview.confidence}:null,staleReview:staleReview?{reviewId:staleReview.reviewId,reviewedAt:staleReview.reviewedAt,meaning:status.freshness.reason}:null,meaning:compact.freshness==='historical_only'?'仅作为历史计划参考':(compact.freshness==='needs_review'?'原计划需重新确认有效性':(compact.priceTriggerStatus==='triggered'&&compact.fullConditionStatus!=='confirmed'?'计划价格已触发，但完整条件尚未确认':(currentReview&&currentReview.reviewOutcome==='still_valid'?'计划近期已复核':'当前有效计划')))};
    });
  }
  function allowedPlanStates(plans){
    const states=new Set(),current=array(plans).filter(plan=>plan.validity==='current'),reviewable=array(plans).filter(plan=>plan.validity==='needs_review'),historical=array(plans).filter(plan=>plan.validity==='historical_only');
    if(current.length)states.add('current_valid');
    if(reviewable.length)states.add('needs_review');
    if(historical.length)states.add('historical_only');
    if(!current.length&&!reviewable.length)states.add('no_current_plan');
    if(array(plans).some(plan=>plan.currentReview&&plan.currentReview.outcome==='still_valid'))states.add('recently_reviewed');
    if(array(plans).some(plan=>plan.currentReview&&plan.currentReview.outcome==='likely_invalid'))states.add('likely_invalid_unconfirmed');
    if(array(plans).some(plan=>plan.staleReview))states.add('changed_since_review');
    return [...states];
  }
  function limitationFacts(baseStock,signals,plans){
    const result=[],technical=text(baseStock.technical&&baseStock.technical.todayRelevance),news=text(baseStock.news&&baseStock.news.todayRelevance),fundamental=text(baseStock.fundamental&&baseStock.fundamental.todayRelevance),valuation=text(baseStock.valuation&&baseStock.valuation.todayRelevance),decisionRelevant=signals.priority==='high'||signals.riskAttention||array(plans).some(plan=>['triggered','near'].includes(plan.priceTrigger)||plan.currentReview&&['needs_review','likely_invalid'].includes(plan.currentReview.outcome));
    if(technical!=='current')result.push({code:'stale_technical_data',meaning:technical==='unavailable'?'缺少可用于今日判断的技术资料。':'技术资料较旧或不一致，不能作为今日精确确认。',decisionRelevant:true});
    if(['unavailable','outdated'].includes(news))result.push({code:'missing_news',meaning:'缺少最新新闻，暂不提高结论强度。',decisionRelevant});
    if(fundamental==='unavailable')result.push({code:'missing_fundamental',meaning:'基本面资料不足，仅在计划前提复核时影响置信度。',decisionRelevant:decisionRelevant&&array(plans).some(plan=>plan.currentReview&&['needs_review','likely_invalid'].includes(plan.currentReview.outcome))});
    if(valuation==='unavailable'&&signals.riskAttention)result.push({code:'valuation_unavailable',meaning:'估值资料不足，不支持强化风险结论。',decisionRelevant:true});
    return result.slice(0,4);
  }
  function blockerEligibility(baseStock,signals,plans,allocation){
    const planNeedsReview=plans.some(plan=>['needs_review','historical_only'].includes(plan.validity)||plan.currentReview&&['needs_review','likely_invalid'].includes(plan.currentReview.outcome)),fullUnproven=plans.some(plan=>['triggered','near'].includes(plan.priceTrigger)&&plan.fullConditions!=='confirmed'),staleReview=plans.some(plan=>plan.staleReview),limitations=limitationFacts(baseStock,signals,plans),currentPlan=plans.some(plan=>['current','needs_review'].includes(plan.validity));
    return {plan_needs_review:planNeedsReview,full_conditions_unproven:fullUnproven,allocation_conflict:allocation.conflict,stale_technical_data:limitations.some(item=>item.code==='stale_technical_data'),missing_news:limitations.some(item=>item.code==='missing_news'&&item.decisionRelevant),missing_fundamental:limitations.some(item=>item.code==='missing_fundamental'&&item.decisionRelevant),stale_plan_review:staleReview,insufficient_market_context:true,no_current_plan:!currentPlan};
  }
  function highAttentionEligible(signals,plans,allocation,baseStock){
    return Boolean(allocation.conflict||signals.priority==='high'||signals.riskAttention||array(plans).some(plan=>plan.validity==='needs_review'||plan.validity==='current'&&['triggered','near'].includes(plan.priceTrigger)||plan.currentReview&&['needs_review','likely_invalid'].includes(plan.currentReview.outcome))||array(baseStock.technical&&baseStock.technical.currentJudgment&&baseStock.technical.currentJudgment.riskFlags).length);
  }
  function auditPlanReferences(stockContexts){
    return stockContexts.map(item=>({symbol:item.symbol,plans:item.plans.map(plan=>({planId:plan.planId,planVersion:plan.planVersion,planSnapshotHash:plan.planSnapshotHash,planReviewId:plan.currentReview&&plan.currentReview.reviewId||null,planReviewedAt:plan.currentReview&&plan.currentReview.reviewedAt||null}))}));
  }
  function buildDecisionContext(portfolioSnapshot,stocks,options={}){
    const snapshot=object(portfolioSnapshot),review=object(snapshot.review);if(!dateOnly(snapshot.reviewDate||review.reviewDate)||!text(review.summary))throw new Error('需要先保存一份完整的组合复核。');
    const allStocks=PortfolioReviewContext.selectableStocks(array(options.allStocks&&options.allStocks.length?options.allStocks:stocks)),bySymbol=stockMap(allStocks),selectedSymbols=array(snapshot.selectedSymbols).map(canonical).filter(Boolean);if(!selectedSymbols.length)throw new Error('组合复核没有可用于压缩的股票范围。');if(new Set(selectedSymbols).size!==selectedSymbols.length)throw new Error('组合复核股票范围存在重复 symbol。');
    const selected=selectedSymbols.map(symbol=>bySymbol.get(symbol)).filter(Boolean);if(selected.length!==selectedSymbols.length)throw new Error('组合复核中的股票已不在当前应用状态，请重新生成组合复核。');
    const reviewDate=dateOnly(snapshot.reviewDate||review.reviewDate),base=PortfolioReviewContext.buildPortfolioContext(selected,{allStocks,reviewDate,generatedAt:options.generatedAt,planReviewStore:options.planReviewStore}),savedPlanHash=text(snapshot.planReferences&&snapshot.planReferences.contextHash),sourceStatus=savedPlanHash&&savedPlanHash===base.planReferences.contextHash?'current':'plan_facts_changed',stockContexts=base.stocks.map(baseStock=>{
      const symbol=baseStock.stock.symbol,stock=bySymbol.get(symbol),signals=reviewSignals(review,symbol),plans=compactPlanFacts(stock,baseStock,reviewDate,options.planReviewStore),allocation=allocationConflict(baseStock.holding,baseStock.allocation,plans),limitations=limitationFacts(baseStock,signals,plans),eligibleBlockers=blockerEligibility(baseStock,signals,plans,allocation),blockerFacts=BLOCKER_PRECEDENCE.filter(code=>eligibleBlockers[code]===true);
      return {symbol,name:baseStock.stock.name,holding:{status:baseStock.holding.holdingStatus,shares:baseStock.holding.currentShares,currentWeight:baseStock.holding.currentWeight},portfolioReviewJudgment:{sourceStatus,priority:sourceStatus==='current'?signals.priority:null,reason:sourceStatus==='current'?signals.reason:'',riskAttention:sourceStatus==='current'&&signals.riskAttention,planWatchStatus:sourceStatus==='current'?signals.planWatchStatus:null},technical:{todayUse:baseStock.technical.todayRelevance,riskFlags:array(baseStock.technical.currentJudgment&&baseStock.technical.currentJudgment.riskFlags).slice(0,3)},plans,allocationConflict:allocation,keyLimitations:limitations,allowedPlanStates:allowedPlanStates(plans),eligibleBlockers,blockerFacts,highAttentionEligible:highAttentionEligible(sourceStatus==='current'?signals:{},plans,allocation,baseStock)};
    }),portfolioReference=portfolioReviewReference(snapshot),auditReferences={portfolioReview:portfolioReference,plans:auditPlanReferences(stockContexts)};
    return {schemaVersion:SCHEMA_VERSION,reviewDate,generatedAt:text(options.generatedAt)||new Date().toISOString(),portfolio:{selectedSymbols,sourceStatus,summary:text(review.summary),riskLevel:text(review.portfolioRiskLevel),concentrationRisks:array(review.portfolioRisks).map(text).filter(Boolean).slice(0,3),materialLimitations:array(review.dataLimitations).map(text).filter(Boolean).slice(0,3)},marketContext:MARKET_CONTEXT,auditReferences,stocks:stockContexts};
  }
  function buildRequest(portfolioSnapshot,stocks,options={}){
    const context=buildDecisionContext(portfolioSnapshot,stocks,options),material=context.stocks.filter(item=>item.highAttentionEligible);if(material.length>MAX_DETAILED_ITEMS)throw new Error(`当前有 ${material.length} 只股票具备高关注事实，超过 ${MAX_DETAILED_ITEMS} 项详细处理上限，请缩小本次复核范围。`);const detailed=(material.length?material:context.stocks.slice(0,1)),detailedSymbols=new Set(detailed.map(item=>item.symbol)),rest=context.stocks.filter(item=>!detailedSymbols.has(item.symbol)).map(item=>item.symbol),example={decisionCompression:{reviewDate:context.reviewDate,overallSummary:'今天先复核最关键的计划与风险冲突，其余标的保持观察。',items:detailed.map(item=>({symbol:item.symbol,priority:item.highAttentionEligible?'high':'medium',actionCategory:item.highAttentionEligible?'review_now':'watch',reason:'用一句自然中文说明最主要的处理原因。',blockerPriority:item.blockerFacts.slice(0,1),planState:item.allowedPlanStates[0],confidence:item.technical.todayUse==='current'?'medium':'low'})),noActionSymbols:rest,confidence:'medium',limitations:['当前没有权威市场环境判断，相关结论保持谨慎。']}};
    return [
      '你是谨慎的每日组合决策压缩助理。你的任务是回答“现在最值得用户注意什么”，不是给出确定性交易指令。','',
      '权威边界：','1. 程序拥有持仓、权重、计划有效性、价格触发、完整条件、计划复核新鲜度、资料适用性、完整 blockerFacts 和组合复核来源状态；不得重算、改写、删除或发明。','2. AI 只判断主导原因、实际复核优先级、阻碍事实的强调顺序和处理类型。用户确认后才能修改计划；本任务不得修改计划、计划复核、持仓、配置或订单。','3. 价格已触发只表示“计划价格已触发，但完整条件尚未确认”，绝不等于可以直接执行。','4. needs_review 或 likely_invalid 只能提高复核优先级，不能把正式计划标记失效；historical_only 仅作历史参考，不能单独驱动高优先级。','5. staleReview 只说明旧复核已过期；不得采用其旧结论。计划变化后应写“计划变更后尚未重新复核”。','6. 当前没有权威市场环境或盘中模块。不得声称大盘突破、牛市开始、市场转强、风险偏好提升，也不得发明盘中涨跌、跳空、午后反转或实时量价。','7. 本次复核范围、所选数量和完整覆盖由程序显示；不要在 overallSummary 或 limitations 中重复范围说明。','',
      '压缩规则：','1. items 只保留 3–5 个最高价值事项；所选股票少于 3 只或实际事项不足时可以更少，但最多 5 个详细处理。其余低关注股票放入 noActionSymbols，不生成等大的详细卡；highAttentionEligible=true 的股票不得放入 noActionSymbols。','2. priority 只表示注意力优先级：high 今天需要复核；medium 值得监控；low 低优先。不得因为存在计划就机械标 high。','3. actionCategory 只能为 review_now, wait_confirmation, risk_control, watch, no_action；它们分别表示立即复核、等待确认、风险控制、观察、暂不处理，不是买卖指令。no_action 应放入 noActionSymbols。','4. 每个 reason 只写一句自然中文，保留一至两个主导驱动，不罗列全部模块。blockerPriority 最多 2 个，只能引用该股票 blockerFacts；它只表示强调顺序，省略不会删除程序事实。','5. planState 只能从该股票 allowedPlanStates 中选择。likely_invalid_unconfirmed 要表达“可能已不适用，但尚未由用户确认失效”。','6. 缺失资料只有在 decisionRelevant 或对应 blockerFacts 中存在时才进入首层；不得让数据限制压过主导决策原因。','7. 技术资料非 current 时，该股票 confidence 不得为 high。','',
      '危险措辞：','压缩文字中禁止出现“立即买入、立即卖出、必须加仓、必须减仓、直接执行计划、满仓、清仓”。不得输出内部字段名、英文枚举或 PlanReview 等实现术语。','',
      '严格 JSON 契约：','1. 只输出严格 JSON；顶层只能包含 decisionCompression。','2. decisionCompression 必须完整包含 reviewDate, overallSummary, items, noActionSymbols, confidence, limitations。','3. item 必须完整包含 symbol, priority, actionCategory, reason, blockerPriority, planState, confidence。不要输出 blockers 或 blockerFacts。','4. symbol 必须精确来自 selectedSymbols；items 与 noActionSymbols 合计必须恰好覆盖全部 selectedSymbols，不得缺少、重复或新增。','5. items 必须按 high、medium、low 排序，最多 5 项详细处理。blockerPriority 最多 2 项。limitations 最多 3 项。','6. reviewDate 必须与输入一致；priority 只能为 high, medium, low；confidence 只能为 high, medium, low。','',
      '程序生成的决策压缩上下文：',JSON.stringify(context,null,2),'','严格输出示例（字段结构可复用，内容必须按输入事实重写）：',JSON.stringify(example,null,2)
    ].join('\n');
  }
  function requestMetrics(request){const value=String(request??'');const bytes=typeof TextEncoder==='function'?new TextEncoder().encode(value).length:Buffer.byteLength(value,'utf8');return {characters:value.length,bytes,kilobytes:Number((bytes/1024).toFixed(1)),approxTokens:Math.ceil(value.length/2.2)}}

  return Object.freeze({SCHEMA_VERSION,MAX_DETAILED_ITEMS,BLOCKER_PRECEDENCE,SAFETY_BLOCKERS,MARKET_CONTEXT,portfolioReviewReference,reviewSignals,allocationConflict,allowedPlanStates,buildDecisionContext,buildRequest,requestMetrics,priorityRank,clone});
});
