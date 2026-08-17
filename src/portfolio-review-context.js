(function portfolioReviewContextModule(root,factory){
  const identity=typeof module==='object'&&module.exports?require('./symbol-identity.js'):root&&root.SymbolIdentity;
  const api=factory(identity);
  if(typeof module==='object'&&module.exports)module.exports=api;
  if(root)root.PortfolioReviewContext=Object.freeze(api);
})(typeof globalThis!=='undefined'?globalThis:this,function(SymbolIdentity){
  'use strict';

  const MAX_SELECTED_STOCKS=12;
  const CONTRACT_EXAMPLE=Object.freeze({portfolioReview:{
    reviewDate:'2026-08-17',summary:'今日组合的简洁结论。',marketContext:'仅写输入事实支持的市场背景；没有则写“未提供”。',portfolioRiskLevel:'moderate',
    priorityStocks:[{symbol:'601138.SS',priority:'high',reason:'优先复核原因。',focus:'今天关注什么。',planRelation:'与既有计划的关系。'}],
    riskAttention:[{symbol:'601138.SS',reason:'风险关注原因。'}],
    planWatch:[{symbol:'601138.SS',status:'approaching',reason:'接近既有计划条件。'}],
    candidateReview:[{symbol:'601138.SS',reason:'值得进一步复核的原因，不代表买入。'}],
    portfolioRisks:['仅写结构化事实支持的组合层风险。'],todayFocus:['今天最重要的复核事项。'],dataLimitations:['明确缺失、过期和覆盖范围限制。'],confidence:'medium'
  }});

  function text(value){return String(value??'').trim()}
  function arr(value){return Array.isArray(value)?value:[]}
  function object(value){return value&&typeof value==='object'&&!Array.isArray(value)?value:{}}
  function clone(value){return JSON.parse(JSON.stringify(value))}
  function number(value){if(value===null||value===undefined||value==='')return null;const n=Number(value);return Number.isFinite(n)?n:null}
  function positive(value){const n=number(value);return n!==null&&n>0?n:null}
  function dateOnly(value){const match=text(value).match(/^\d{4}-\d{2}-\d{2}/);return match?match[0]:''}
  function canonicalSymbol(value){return SymbolIdentity&&typeof SymbolIdentity.canonicalSymbol==='function'?SymbolIdentity.canonicalSymbol(value):text(value).toUpperCase()}
  function symbolOf(stock){return text(stock&&(stock.code||stock.symbol))}
  function isCash(stock){const type=text(stock&&stock.type).toLowerCase();return type==='cash'||type==='system'||stock&&stock.isCash===true||(!symbolOf(stock)&&/现金/.test(text(stock&&stock.name)))}
  function selectableStocks(stocks){return arr(stocks).filter(stock=>symbolOf(stock)&&!isCash(stock))}

  function currentPrice(stock){
    const direct=positive(stock&&stock.currentPrice)||positive(stock&&stock.lastUnitPrice);
    if(direct)return direct;
    const value=positive(stock&&stock.currentValue),shares=positive(stock&&stock.shares);
    return value&&shares?Number((value/shares).toFixed(6)):null;
  }
  function holdingFacts(stock,portfolioTotal=null){
    const shares=Math.max(0,number(stock&&stock.shares)??0);
    const price=currentPrice(stock);
    const explicit=positive(stock&&stock.currentValue)||positive(stock&&stock.marketValue);
    const marketValue=explicit||(shares>0&&price?Number((shares*price).toFixed(2)):null);
    const type=text(stock&&stock.type).toLowerCase();
    const holdingStatus=shares>0?'held':(type==='watching'||type==='watchlist'?'watchlist':'zero_position_candidate');
    const weight=marketValue!==null&&portfolioTotal&&portfolioTotal>0?Number((marketValue/portfolioTotal*100).toFixed(2)):null;
    return {shares,avgCost:positive(stock&&stock.avgCost)||positive(stock&&stock.cost),currentPrice:price,marketValue,weight,weightBasis:weight===null?'unavailable':'known_application_holdings',holdingStatus};
  }
  function allKnownHoldingMarketValue(stocks){
    const held=selectableStocks(stocks).filter(stock=>(number(stock&&stock.shares)??0)>0);
    if(!held.length)return null;
    const values=held.map(stock=>holdingFacts(stock).marketValue);
    return values.every(value=>value!==null)?Number(values.reduce((sum,value)=>sum+value,0).toFixed(2)):null;
  }

  function compactTechnical(stock){
    const data=object(stock&&stock.technicalData),review=object(stock&&stock.technicalReview),short=object(review.shortTermTechnical),cycle=object(review.cycleTechnical);
    const status=text(data.technicalDataStatus)||'unavailable';
    return {
      status,analysisDate:dateOnly(data.technicalAsOf||data.latestCompleteBar||review.updatedAt),latestCompleteBar:dateOnly(data.latestCompleteBar),
      judgment:{trendStatus:text(short.trendStatus||data.trendStatus)||'unclear',technicalSummary:text(short.technicalSummary||review.finalTechnicalConclusion||data.technicalSummary),riskFlags:arr(short.riskFlags||data.riskFlags).map(text).filter(Boolean).slice(0,8),actionHint:text(short.actionHint||data.actionHint),holdHint:text(review.holdHint||data.holdHint),addHint:text(review.addHint||data.addHint),reduceHint:text(review.reduceHint||data.reduceHint),confidence:text(short.confidence)||'low'},
      essentialFacts:{supportLevels:arr(short.supportLevels&&short.supportLevels.length?short.supportLevels:data.supportLevels).slice(0,4),resistanceLevels:arr(short.resistanceLevels&&short.resistanceLevels.length?short.resistanceLevels:data.resistanceLevels).slice(0,4),cyclePosition:text(cycle.cyclePosition||data.cyclePosition)||'unclear',cycleSummary:text(cycle.cycleSummary||data.cycleSummary)}
    };
  }
  function compactNews(stock){
    const catalyst=object(stock&&stock.recentCatalyst),sentiment=object(stock&&stock.shortTermSentiment),completeness=object(stock&&stock.informationCompleteness);
    const currentEvents=arr(catalyst.recentEvents).map(item=>typeof item==='string'?item:clone(item)).slice(0,6);
    const hasCurrent=Boolean(catalyst.analysisDate||catalyst.latestSourceDate||catalyst.todayCatalyst||currentEvents.length||sentiment.updatedAt||sentiment.marketMood||sentiment.fundFlowView);
    const historical=arr(catalyst.monthlyCatalysts).map(text).filter(Boolean).slice(0,3);
    return {
      status:hasCurrent?(text(catalyst.freshnessStatus)||'unknown'):'unavailable',analysisDate:dateOnly(catalyst.analysisDate||sentiment.updatedAt),latestSourceDate:dateOnly(catalyst.latestSourceDate),
      currentSnapshot:{todayCatalyst:text(catalyst.todayCatalyst),recentEvents:currentEvents,catalystLevel:text(catalyst.catalystCoverage)||'unknown',sentiment:text(sentiment.marketMood),fundFlow:text(sentiment.fundFlowView),riskFlags:arr(sentiment.riskFlags).map(text).filter(Boolean).slice(0,6),actionHint:text(catalyst.actionHint||sentiment.actionHint),dataCompleteness:text(completeness.news||catalyst.catalystCoverage)||'unknown'},
      historicalReference:historical.length?{status:'historical_reference',items:historical}:null
    };
  }
  function compactFundamental(stock){
    const ai=object(stock&&stock.aiReviews),review=object(stock&&stock.financialReview||ai.financialReview),data=object(stock&&stock.financialData),fresh=object(stock&&stock.dataFreshness),completeness=object(stock&&stock.informationCompleteness);
    const summary=text(review.summary||review.financialSummary||review.conclusion||data.summary||data.financialSummary);
    const important=arr(review.keyPoints||review.positivePoints||review.attentionPoints).map(text).filter(Boolean).slice(0,5);
    const available=Boolean(summary||important.length||review.growthQuality||review.revenueTrend||review.profitTrend);
    return {status:available?(text(completeness.fundamentals)||'available'):'unavailable',analysisDate:dateOnly(review.updatedAt||review.analysisDate||data.updatedAt||data.reportDate||fresh.financialUpdatedAt),confidence:text(review.confidence)||'low',summary,importantPoints:important};
  }
  function compactValuation(stock){
    const review=object(stock&&stock.valuationReview),data=object(stock&&stock.valuationData),fresh=object(stock&&stock.dataFreshness),complete=object(stock&&stock.informationCompleteness);
    const summary=text(review.summary||data.valuationConclusion||data.valuationNote),level=text(review.valuationLevel||review.level||review.status||data.valuationLevel);
    const available=Boolean(summary||level||positive(data.peTtm)||positive(data.pe)||positive(data.pb));
    return {status:available?(text(complete.valuation)||'available'):'unavailable',analysisDate:dateOnly(review.updatedAt||review.analysisDate||data.updatedAt||data.lastUpdated||fresh.valuationUpdatedAt),level:level||'unknown',conclusion:summary,confidence:text(review.confidence)||'low'};
  }
  function compactLongTerm(stock){
    const logic=object(stock&&stock.longTermLogic),complete=object(stock&&stock.informationCompleteness);
    const thesis=text(logic.investmentThesis||stock&&stock.thesis||stock&&stock.notes),available=Boolean(thesis||logic.updatedAt||arr(logic.coreDrivers).length||arr(logic.longTermRisks).length);
    return {status:available?(text(logic.logicStatus)||'unclear'):'unavailable',analysisDate:dateOnly(logic.updatedAt),validUntil:dateOnly(logic.validUntil),nextReviewDate:dateOnly(logic.nextReviewDate),confidence:text(logic.confidence)||'low',thesisSummary:thesis,validationPoints:arr(logic.coreDrivers).map(text).filter(Boolean).slice(0,5),invalidationRisks:arr(logic.longTermRisks).map(text).filter(Boolean).slice(0,5),dataCompleteness:text(complete.longTermLogic)||'unknown'};
  }
  function compactAllocation(stock){
    const decision=object(stock&&stock.allocationDecision),strategy=object(stock&&stock.strategy),position=object(stock&&stock.positionManagementReview);
    const target=number(strategy.targetWeight)??number(stock&&stock.targetPct),upper=number(strategy.maxWeight)??number(stock&&stock.capPct);
    return {targetWeight:target,recommendedRange:text(decision.recommendedWeightRange),upperLimit:upper,conclusion:text(decision.conclusion||position.summary),weightStatus:text(position.weightStatus)||'unknown',capitalAllocationView:text(decision.capitalAllocationView)||'unknown'};
  }
  function compactPlans(stock){
    return arr(stock&&stock.plans).filter(plan=>{
      const status=text(plan&&plan.status).toLowerCase();return !['completed','cancelled','canceled','closed','done'].includes(status);
    }).map(plan=>({id:text(plan&&plan.id),action:text(plan&&plan.action)||'watch',triggerPrice:positive(plan&&((plan.price!==undefined)?plan.price:plan.triggerPrice)),triggerOn:text(plan&&plan.triggerOn),status:text(plan&&plan.status)||'active',note:text(plan&&plan.note||plan&&plan.condition||plan&&plan.description)})).filter(plan=>plan.triggerPrice!==null||plan.note).slice(0,8);
  }
  function stockContext(stock,options={}){
    const symbol=canonicalSymbol(symbolOf(stock));
    if(!symbol)throw new Error('组合复核股票缺少 canonical symbol。');
    return {stock:{name:text(stock&&stock.name),symbol,role:text(stock&&stock.role),theme:text(stock&&stock.theme),type:text(stock&&stock.type)},holding:holdingFacts(stock,options.portfolioMarketValue),allocation:compactAllocation(stock),technical:compactTechnical(stock),news:compactNews(stock),fundamental:compactFundamental(stock),valuation:compactValuation(stock),longTermLogic:compactLongTerm(stock),plans:compactPlans(stock)};
  }
  function readiness(stocks){
    const total=stocks.length,count=key=>stocks.filter(stock=>stock[key]&&stock[key].status!=='unavailable').length;
    return {stockCount:total,technical:`${count('technical')}/${total}`,news:`${count('news')}/${total}`,fundamental:`${count('fundamental')}/${total}`,valuation:`${count('valuation')}/${total}`,longTermLogic:`${count('longTermLogic')}/${total}`};
  }
  function buildPortfolioContext(stocks,options={}){
    const selected=selectableStocks(stocks);
    if(selected.length<1)throw new Error('请至少选择一只股票。');
    if(selected.length>MAX_SELECTED_STOCKS)throw new Error(`今日组合最多选择 ${MAX_SELECTED_STOCKS} 只股票。`);
    const seen=new Set();
    selected.forEach(stock=>{const symbol=canonicalSymbol(symbolOf(stock));if(!symbol)throw new Error('组合复核股票缺少 canonical symbol。');if(seen.has(symbol))throw new Error(`组合中存在重复 symbol：${symbol}。`);seen.add(symbol)});
    const allStocks=selectableStocks(options.allStocks&&options.allStocks.length?options.allStocks:selected);
    const portfolioMarketValue=allKnownHoldingMarketValue(allStocks);
    const contexts=selected.map(stock=>stockContext(stock,{portfolioMarketValue}));
    const selectedValues=contexts.map(item=>item.holding.marketValue).filter(value=>value!==null);
    const knownMarketValue=selectedValues.length?Number(selectedValues.reduce((sum,value)=>sum+value,0).toFixed(2)):null;
    return {reviewDate:dateOnly(options.reviewDate)||new Date().toISOString().slice(0,10),generatedAt:text(options.generatedAt)||new Date().toISOString(),portfolio:{stockCount:contexts.length,knownMarketValue,marketValueScope:'selected_review_universe',knownApplicationHoldingsMarketValue:portfolioMarketValue,knownCash:null,cashStatus:'unavailable',selectionScope:'selected_review_universe_not_confirmed_full_brokerage_portfolio',notes:'持仓与价格来自应用状态；实际券商持仓与成交记录具有最终权威。'},readiness:readiness(contexts),stocks:contexts};
  }
  function buildRequest(stocks,options={}){
    const context=buildPortfolioContext(stocks,options);
    return [
      '你是一名谨慎的组合级每日复核助理。你的任务不是重复逐只股票分析，而是比较所选股票并给出今天的组合复核优先级。','',
      '事实边界：','1. 只能使用下方结构化事实；程序拥有持仓、价格、日期、计划和各模块状态，禁止重算或改写这些事实。','2. holdings 仅作复核上下文；实际券商持仓、成交和订单具有最终权威。','3. selected_review_universe 不一定等于完整券商组合；权重、现金或覆盖不完整时必须在 dataLimitations 明示。','4. 明确区分 held、watchlist 与 zero_position_candidate；零仓候选不得使用“继续持有”等措辞。','5. 复核既有计划是否接近、满足或可能失效，但不得修改、覆盖或新增存储计划。','6. technical/news/fundamental/valuation/longTermLogic 的 stale、unavailable、unknown 和日期必须影响置信度；历史参考不得表述为今日新事实。','7. 不得发明持仓、价格、财务、新闻、计划、仓位或市场背景。','8. 不给确定性买卖指令，不声称订单已经或将会执行；使用“优先复核、保持观察、等待确认、风险提高”等审慎语言。','',
      '复核任务：','1. 比较股票并识别今日最高优先级关注。','2. 识别持仓、技术、新闻、估值、配置与主题集中风险。','3. 识别接近、触发、失效或尚未接近的既有计划。','4. 识别应保持观察的标的与值得进一步复核的零仓候选。','5. 明确数据质量限制，并据此给出整体 confidence。','',
      '严格输出要求：','1. 只输出严格 JSON，不要 Markdown、代码围栏或额外解释。','2. 顶层只能包含 portfolioReview；内部必须完整包含示例中的全部字段，即使数组为空也要返回 []。','3. 只能引用输入 universe 中的精确 symbol；大小写差异可接受，但禁止名称匹配、后缀猜测、部分推断或新增股票。','4. 同一 section 内 symbol 不得重复；无需在任何数组覆盖全部股票。','5. portfolioRiskLevel 只能为 low, moderate, high, unclear。','6. priority 只能为 high, medium, low。','7. planWatch.status 只能为 approaching, triggered, invalidated, not_close, unclear。','8. confidence 只能为 high, medium, low。','9. reviewDate 必须等于输入 reviewDate。','',
      '程序生成的组合上下文：',JSON.stringify(context,null,2),'','严格输出结构示例（内容仅示意，必须按输入事实重写）：',JSON.stringify(CONTRACT_EXAMPLE,null,2)
    ].join('\n');
  }
  function requestMetrics(request){const value=String(request??'');const bytes=typeof TextEncoder==='function'?new TextEncoder().encode(value).length:Buffer.byteLength(value,'utf8');return {characters:value.length,bytes,kilobytes:Number((bytes/1024).toFixed(1)),approxTokens:Math.ceil(value.length/2.2)}}

  return {MAX_SELECTED_STOCKS,CONTRACT_EXAMPLE,selectableStocks,holdingFacts,compactTechnical,compactNews,compactFundamental,compactValuation,compactLongTerm,compactAllocation,compactPlans,stockContext,buildPortfolioContext,buildRequest,requestMetrics};
});
