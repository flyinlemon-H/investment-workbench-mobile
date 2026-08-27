(function portfolioReviewContextModule(root,factory){
  const identity=typeof module==='object'&&module.exports?require('./symbol-identity.js'):root&&root.SymbolIdentity;
  const planV2=typeof module==='object'&&module.exports?require('./plan-v2.js'):root&&root.PlanV2;
  const planReview=typeof module==='object'&&module.exports?require('./plan-review.js'):root&&root.PlanReview;
  const api=factory(identity,planV2,planReview);
  if(typeof module==='object'&&module.exports)module.exports=api;
  if(root)root.PortfolioReviewContext=Object.freeze(api);
})(typeof globalThis!=='undefined'?globalThis:this,function(SymbolIdentity,PlanV2,PlanReview){
  'use strict';

  const MAX_SELECTED_STOCKS=12;
  const TODAY_RELEVANCE=Object.freeze(['current','usable_with_caution','outdated','unavailable','inconsistent']);
  // Reuse product semantics: News Catalyst owns 7/30-day lookbacks and the
  // workbench already asks for valuation/fundamental refresh after 30 days.
  const RELEVANCE_POLICY=Object.freeze({newsLookbackDays:7,newsHistoricalDays:30,valuationCurrentDays:30,fundamentalCurrentDays:30});
  const CONTRACT_EXAMPLE=Object.freeze({portfolioReview:{
    reviewDate:'2026-08-18',summary:'今日组合的简洁结论。',marketContext:'仅写输入事实支持的市场背景；没有则写“未提供”。',portfolioRiskLevel:'moderate',
    priorityStocks:[{symbol:'601138.SS',priority:'high',reason:'优先复核原因。',focus:'今天关注什么。',planRelation:'与既有计划的关系。'}],
    riskAttention:[{symbol:'601138.SS',reason:'风险关注原因。'}],
    planWatch:[{symbol:'601138.SS',status:'approaching',reason:'接近价格区，仍需确认计划的其他条件。'}],
    candidateReview:[{symbol:'601138.SS',reason:'值得进一步复核的原因，不代表买入。'}],
    portfolioRisks:['仅写结构化事实支持的组合层风险。'],todayFocus:['今天最重要的复核事项。'],dataLimitations:['说明数据问题对今天判断的实际影响。'],confidence:'medium'
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
  function daysBetween(value,reviewDate){
    const from=dateOnly(value),to=dateOnly(reviewDate);if(!from||!to)return null;
    const start=Date.parse(`${from}T00:00:00Z`),end=Date.parse(`${to}T00:00:00Z`);
    if(!Number.isFinite(start)||!Number.isFinite(end)||start>end)return null;
    return Math.floor((end-start)/86400000);
  }
  function sameNumber(a,b){const left=number(a),right=number(b);if(left===null||right===null)return true;return Math.abs(left-right)<=Math.max(0.000001,Math.abs(right)*0.001)}
  function normalizedLevels(value){return arr(value).map(number).filter(item=>item!==null&&item>0)}
  function sameLevels(a,b){
    const left=normalizedLevels(a),right=normalizedLevels(b);if(!left.length||!right.length)return true;
    if(left.length!==right.length)return false;
    return left.every((value,index)=>sameNumber(value,right[index]));
  }
  function latestCompleteBar(stock){
    return arr(stock&&stock.priceHistory).filter(row=>row&&row.is_complete_bar!==false&&dateOnly(row.date)&&positive(row.close)).sort((a,b)=>dateOnly(a.date).localeCompare(dateOnly(b.date))).at(-1)||null;
  }

  function currentPrice(stock){
    const direct=positive(stock&&stock.currentPrice)||positive(stock&&stock.lastUnitPrice);
    if(direct)return direct;
    const value=positive(stock&&stock.currentValue),shares=positive(stock&&stock.shares);
    return value&&shares?Number((value/shares).toFixed(6)):null;
  }
  function holdingFacts(stock,portfolioTotal=null){
    const shares=Math.max(0,number(stock&&stock.shares)??0),price=currentPrice(stock),explicit=positive(stock&&stock.currentValue)||positive(stock&&stock.marketValue);
    const currentMarketValue=explicit||(shares>0&&price?Number((shares*price).toFixed(2)):null),type=text(stock&&stock.type).toLowerCase();
    const holdingStatus=shares>0?'held':(type==='watching'||type==='watchlist'?'watchlist':'zero_position_candidate');
    const currentWeight=currentMarketValue!==null&&portfolioTotal&&portfolioTotal>0?Number((currentMarketValue/portfolioTotal*100).toFixed(2)):null;
    return {currentShares:shares,shares,avgCost:positive(stock&&stock.avgCost)||positive(stock&&stock.cost),currentPrice:price,currentMarketValue,marketValue:currentMarketValue,currentWeight,weight:currentWeight,weightBasis:currentWeight===null?'unavailable':'known_application_holdings',holdingStatus};
  }
  function allKnownHoldingMarketValue(stocks){
    const held=selectableStocks(stocks).filter(stock=>(number(stock&&stock.shares)??0)>0);if(!held.length)return null;
    const values=held.map(stock=>holdingFacts(stock).currentMarketValue);return values.every(value=>value!==null)?Number(values.reduce((sum,value)=>sum+value,0).toFixed(2)):null;
  }

  function technicalConsistency(stock){
    const data=object(stock&&stock.technicalData),review=object(stock&&stock.technicalReview),short=object(review.shortTermTechnical),lastBar=latestCompleteBar(stock);
    const technicalAsOf=dateOnly(data.technicalAsOf),latestDate=dateOnly(data.latestCompleteBar),historyDate=lastBar?dateOnly(lastBar.date):'',levelDate=dateOnly(data.supportResistanceAsOf||data.levelsAsOf||data.supportResistanceDate),reviewPriceDate=dateOnly(short.priceUpdatedAt),reviewAligned=Boolean(reviewPriceDate&&technicalAsOf&&reviewPriceDate===technicalAsOf),warnings=[];
    const invariantDates=[technicalAsOf,latestDate,historyDate].filter(Boolean);if(new Set(invariantDates).size>1)warnings.push('完整日线日期、技术快照日期与最新完整K线未对齐。');
    if(levelDate&&technicalAsOf&&levelDate!==technicalAsOf)warnings.push('支撑压力字段不属于当前技术快照。');
    if(lastBar&&data.price!==null&&data.price!==undefined&&!sameNumber(data.price,lastBar.close))warnings.push('技术快照价格与最新完整K线收盘价未对齐。');
    if(reviewAligned&&(!sameLevels(short.supportLevels,data.supportLevels)||!sameLevels(short.resistanceLevels,data.resistanceLevels)))warnings.push('同一技术快照中的支撑压力字段不一致。');
    const levelsAligned=Boolean((positive(data.supportPrice)||positive(data.resistancePrice))||(levelDate&&technicalAsOf&&levelDate===technicalAsOf));
    return {consistent:warnings.length===0,invariantComplete:Boolean(technicalAsOf&&latestDate&&historyDate&&technicalAsOf===latestDate&&latestDate===historyDate),levelsAligned,reviewAligned,warnings,technicalAsOf,latestDate,historyDate};
  }
  function compactTechnical(stock,options={}){
    const data=object(stock&&stock.technicalData),review=object(stock&&stock.technicalReview),short=object(review.shortTermTechnical),cycle=object(review.cycleTechnical),status=text(data.technicalDataStatus)||'unavailable',check=technicalConsistency(stock);
    let todayRelevance='usable_with_caution',warning='';
    if(status==='unavailable'||!check.technicalAsOf)todayRelevance='unavailable';
    else if(status==='anomaly'||!check.consistent)todayRelevance='inconsistent';
    else if(status==='fresh'&&check.invariantComplete)todayRelevance='current';
    else if(status==='stale')todayRelevance='outdated';
    else warning='缺少完整的技术快照对齐元数据，仅作谨慎参考。';
    if(todayRelevance==='inconsistent')warning='支撑压力字段或技术快照日期存在不一致，不用于精确价位判断。';
    if(todayRelevance==='outdated')warning='技术资料已超过当前模块的新鲜度要求，不作为今日精确判断。';
    const preciseLevelsUsable=todayRelevance==='current'&&check.consistent&&check.levelsAligned,supports=positive(data.supportPrice)?[positive(data.supportPrice)]:normalizedLevels(data.supportLevels),resistances=positive(data.resistancePrice)?[positive(data.resistancePrice)]:normalizedLevels(data.resistanceLevels),judgment=check.reviewAligned?short:{};
    if(todayRelevance==='current'&&!preciseLevelsUsable)warning='当前技术快照可用，但支撑压力的来源日期无法确认，不用于精确价位判断。';
    return {status,analysisDate:check.technicalAsOf,latestCompleteBar:check.latestDate,priceHistoryLastCompleteDate:check.historyDate,todayRelevance,dataQuality:todayRelevance==='inconsistent'?'inconsistent':(todayRelevance==='unavailable'?'unavailable':(check.invariantComplete?'consistent':'unverified')),warning,consistencyWarnings:check.warnings.slice(0,3),currentJudgment:{trendStatus:text(judgment.trendStatus||data.trendStatus)||'unclear',technicalSummary:todayRelevance==='inconsistent'?'':text(judgment.technicalSummary||data.technicalSummary),riskFlags:arr(judgment.riskFlags||data.riskFlags).map(text).filter(Boolean).slice(0,8),actionHint:todayRelevance==='inconsistent'?'':text(judgment.actionHint||data.actionHint),confidence:todayRelevance==='inconsistent'?'low':(text(judgment.confidence)||'low')},essentialFacts:{snapshotPrice:positive(data.price),supportLevels:preciseLevelsUsable?supports.slice(0,4):[],resistanceLevels:preciseLevelsUsable?resistances.slice(0,4):[],preciseLevelsUsable,cyclePosition:text(cycle.cyclePosition||data.cyclePosition)||'unclear',cycleSummary:text(cycle.cycleSummary||data.cycleSummary)}};
  }
  function newsItemText(item){if(typeof item==='string')return text(item);const value=object(item);return text(value.summary||value.title||value.keyPoint||value.event||JSON.stringify(value))}
  function compactNews(stock,options={}){
    const catalyst=object(stock&&stock.recentCatalyst),sentiment=object(stock&&stock.shortTermSentiment),completeness=object(stock&&stock.informationCompleteness),events=arr(catalyst.recentEvents).map(item=>typeof item==='string'?item:clone(item)).slice(0,6);
    const hasSnapshot=Boolean(catalyst.analysisDate||catalyst.latestSourceDate||catalyst.todayCatalyst||events.length||sentiment.updatedAt||sentiment.marketMood||sentiment.fundFlowView),status=hasSnapshot?(text(catalyst.freshnessStatus)||'unknown'):'unavailable',analysisDate=dateOnly(catalyst.analysisDate||sentiment.updatedAt),latestSourceDate=dateOnly(catalyst.latestSourceDate),recencyDate=latestSourceDate||analysisDate;
    const age=daysBetween(recencyDate,options.reviewDate),lookback=positive(catalyst.lookbackDays)||RELEVANCE_POLICY.newsLookbackDays,historicalWindow=positive(catalyst.monthlyLookbackDays)||RELEVANCE_POLICY.newsHistoricalDays;
    let todayRelevance='unavailable';
    if(hasSnapshot){if(age===null)todayRelevance='usable_with_caution';else if(['fresh','acceptable'].includes(status)&&age<=lookback)todayRelevance='current';else if(age<=historicalWindow)todayRelevance='usable_with_caution';else todayRelevance='outdated'}
    const snapshot={todayCatalyst:text(catalyst.todayCatalyst),recentEvents:events,catalystLevel:text(catalyst.catalystCoverage)||'unknown',sentiment:text(sentiment.marketMood),fundFlow:text(sentiment.fundFlowView),riskFlags:arr(sentiment.riskFlags).map(text).filter(Boolean).slice(0,6),actionHint:text(catalyst.actionHint||sentiment.actionHint),dataCompleteness:text(completeness.news||catalyst.catalystCoverage)||'unknown'};
    const historicalItems=[...arr(catalyst.monthlyCatalysts).map(text),...(todayRelevance==='current'?[]:[snapshot.todayCatalyst,...events.map(newsItemText)])].filter(Boolean).slice(0,8);
    return {status,analysisDate,latestSourceDate,todayRelevance,dataQuality:todayRelevance==='unavailable'?'unavailable':(todayRelevance==='current'?'consistent':'dated'),warning:todayRelevance==='outdated'?'该新闻快照已超出当前新闻模块的30天历史参考范围，不是今日催化。':(todayRelevance==='usable_with_caution'?'该快照只可作为历史或延续性背景，不是今日新闻。':''),currentSnapshot:todayRelevance==='current'?snapshot:null,historicalReference:historicalItems.length?{status:'historical_reference',asOf:recencyDate,items:historicalItems}:null};
  }
  function compactFundamental(stock,options={}){
    const ai=object(stock&&stock.aiReviews),review=object(stock&&stock.financialReview||ai.financialReview),data=object(stock&&stock.financialData),fresh=object(stock&&stock.dataFreshness),completeness=object(stock&&stock.informationCompleteness),summary=text(review.summary||review.financialSummary||review.conclusion||data.summary||data.financialSummary),important=arr(review.keyPoints||review.positivePoints||review.attentionPoints).map(text).filter(Boolean).slice(0,5);
    const available=Boolean(summary||important.length||review.growthQuality||review.revenueTrend||review.profitTrend),status=available?(text(completeness.fundamentals)||'available'):'unavailable',analysisDate=dateOnly(review.updatedAt||review.analysisDate||data.updatedAt||data.reportDate||fresh.financialUpdatedAt),age=daysBetween(analysisDate,options.reviewDate),todayRelevance=!available||['unknown','unavailable'].includes(status)?'unavailable':(age!==null&&age<=RELEVANCE_POLICY.fundamentalCurrentDays?'current':'usable_with_caution');
    return {status,analysisDate,todayRelevance,dataQuality:todayRelevance==='unavailable'?'unavailable':'consistent',confidence:todayRelevance==='unavailable'?'low':(text(review.confidence)||'low'),summary:todayRelevance==='unavailable'?'':summary,importantPoints:todayRelevance==='unavailable'?[]:important};
  }
  function compactValuation(stock,options={}){
    const review=object(stock&&stock.valuationReview),data=object(stock&&stock.valuationData),fresh=object(stock&&stock.dataFreshness),complete=object(stock&&stock.informationCompleteness),summary=text(review.summary||data.valuationConclusion||data.valuationNote),level=text(review.valuationLevel||review.level||review.status||data.valuationLevel),available=Boolean(summary||level||positive(data.peTtm)||positive(data.pe)||positive(data.pb));
    const status=available?(text(complete.valuation)||'available'):'unavailable',analysisDate=dateOnly(review.updatedAt||review.analysisDate||data.updatedAt||data.lastUpdated||fresh.valuationUpdatedAt),age=daysBetween(analysisDate,options.reviewDate),todayRelevance=!available?'unavailable':(age!==null&&age<=RELEVANCE_POLICY.valuationCurrentDays?'current':'usable_with_caution');
    return {status,analysisDate,todayRelevance,dataQuality:todayRelevance==='unavailable'?'unavailable':'consistent',level:level||'unknown',conclusion:summary,confidence:text(review.confidence)||'low',warning:todayRelevance==='usable_with_caution'?'估值日期较早，可用于区间背景，不作为今日精确估值快照。':''};
  }
  function compactLongTerm(stock,options={}){
    const logic=object(stock&&stock.longTermLogic),complete=object(stock&&stock.informationCompleteness),thesis=text(logic.investmentThesis||stock&&stock.thesis||stock&&stock.notes),available=Boolean(thesis||logic.updatedAt||arr(logic.coreDrivers).length||arr(logic.longTermRisks).length),status=available?(text(logic.logicStatus)||'unclear'):'unavailable',analysisDate=dateOnly(logic.updatedAt),validUntil=dateOnly(logic.validUntil),nextReviewDate=dateOnly(logic.nextReviewDate);
    let todayRelevance='unavailable';if(available){if(validUntil&&validUntil<dateOnly(options.reviewDate))todayRelevance='outdated';else if(nextReviewDate&&nextReviewDate<dateOnly(options.reviewDate))todayRelevance='usable_with_caution';else if(status==='valid'&&(validUntil||nextReviewDate))todayRelevance='current';else todayRelevance='usable_with_caution'}
    return {status,analysisDate,validUntil,nextReviewDate,todayRelevance,dataQuality:todayRelevance==='unavailable'?'unavailable':'consistent',confidence:text(logic.confidence)||'low',thesisSummary:thesis,validationPoints:arr(logic.coreDrivers).map(text).filter(Boolean).slice(0,5),invalidationRisks:arr(logic.longTermRisks).map(text).filter(Boolean).slice(0,5),dataCompleteness:text(complete.longTermLogic)||'unknown'};
  }
  function stripHistoricalWeightNarrative(value){return text(value).split(/(?<=[。！？；;\n])/).filter(part=>!/当前仓位|实际仓位|持仓占比|current\s*weight|actual\s*weight|position\s*percentage/i.test(part)).join('').trim()}
  function compactAllocation(stock){
    const decision=object(stock&&stock.allocationDecision),strategy=object(stock&&stock.strategy),position=object(stock&&stock.positionManagementReview),target=positive(decision.recommendedTargetWeight)??positive(strategy.targetWeight)??positive(stock&&stock.targetPct),upper=positive(decision.recommendedMaxWeight)??positive(strategy.maxWeight)??positive(stock&&stock.capPct),analysisDate=dateOnly(decision.updatedAt||position.updatedAt),conclusion=stripHistoricalWeightNarrative(decision.conclusion||position.summary),available=Boolean(target!==null||upper!==null||decision.recommendedWeightRange||conclusion);
    return {status:available?'available':'unavailable',analysisDate,todayRelevance:available?(analysisDate?'current':'usable_with_caution'):'unavailable',dataQuality:available?'consistent':'unavailable',targetWeight:target,recommendedRange:text(decision.recommendedWeightRange),upperLimit:upper,strategicConclusion:conclusion};
  }
  function compactPlans(stock,options={}){
    const price=currentPrice(stock),reviewDate=options.reviewDate,symbol=canonicalSymbol(symbolOf(stock));
    return arr(stock&&stock.plans).map(plan=>PlanV2.normalizePlan(plan)).filter(plan=>plan.status==='active'&&['active','needs_review'].includes(plan.validityStatus)).map(plan=>{
      const compact=PlanV2.compactForPortfolio(plan,price,reviewDate),additionalConditions=Object.values(compact.conditions).flat().map(item=>item.text).filter(Boolean).slice(0,8),status=PlanReview&&typeof PlanReview.reviewStatusForPlan==='function'?PlanReview.reviewStatusForPlan(options.planReviewStore,symbol,plan):{review:null,freshness:{status:'absent',reason:'尚未复核'}},reviewJudgment=status.review?{outcome:status.review.reviewOutcome,summary:status.review.summary,confidence:status.review.confidence,reviewedAt:status.review.reviewedAt,freshness:status.freshness.status,meaning:status.freshness.reason}:{outcome:null,summary:'',confidence:'low',reviewedAt:null,freshness:'absent',meaning:'尚未保存计划复核'};
      return {...compact,triggerOn:compact.triggerDirection,status:'active',priceCondition:compact.priceTriggerStatus==='unavailable'?'not_available':compact.priceTriggerStatus,additionalConditions,requiresManualConfirmation:true,reviewJudgment};
    }).filter(plan=>plan.triggerPrice!==null||plan.note).slice(0,8);
  }
  function stockContext(stock,options={}){const symbol=canonicalSymbol(symbolOf(stock));if(!symbol)throw new Error('组合复核股票缺少 canonical symbol。');return {stock:{name:text(stock&&stock.name),symbol,role:text(stock&&stock.role),theme:text(stock&&stock.theme),type:text(stock&&stock.type)},holding:holdingFacts(stock,options.portfolioMarketValue),allocation:compactAllocation(stock),technical:compactTechnical(stock,options),news:compactNews(stock,options),fundamental:compactFundamental(stock,options),valuation:compactValuation(stock,options),longTermLogic:compactLongTerm(stock,options),plans:compactPlans(stock,options)}}
  function relevanceCounts(stocks,key){return TODAY_RELEVANCE.reduce((out,value)=>(out[value]=stocks.filter(stock=>stock[key]&&stock[key].todayRelevance===value).length,out),{})}
  function readinessLabel(counts){const parts=[];if(counts.current)parts.push(`${counts.current}较新`);if(counts.usable_with_caution)parts.push(`${counts.usable_with_caution}需谨慎`);if(counts.outdated)parts.push(`${counts.outdated}较旧`);if(counts.unavailable)parts.push(`${counts.unavailable}缺失`);if(counts.inconsistent)parts.push(`${counts.inconsistent}不一致`);return parts.join(' / ')||'0可用'}
  function readiness(stocks){
    const counts=Object.fromEntries(['technical','news','fundamental','valuation','longTermLogic'].map(key=>[key,relevanceCounts(stocks,key)])),highImpactProblems=['technical','news'].reduce((sum,key)=>sum+counts[key].outdated+counts[key].unavailable+counts[key].inconsistent,0),planReviews=stocks.flatMap(stock=>stock.plans||[]).map(plan=>plan.reviewJudgment||{}),reviewGaps=planReviews.filter(review=>['absent','stale'].includes(review.freshness)).length,cautionReviews=planReviews.filter(review=>['needs_review','likely_invalid'].includes(review.outcome)).length,confidenceProblems=highImpactProblems+(reviewGaps||cautionReviews?1:0);
    return {stockCount:stocks.length,technical:readinessLabel(counts.technical),news:readinessLabel(counts.news),fundamental:readinessLabel(counts.fundamental),valuation:readinessLabel(counts.valuation),longTermLogic:readinessLabel(counts.longTermLogic),planReviews:{total:planReviews.length,current:planReviews.length-reviewGaps,missingOrStale:reviewGaps,caution:cautionReviews},counts,suggestedConfidence:confidenceProblems>=2?'low':(confidenceProblems===1?'medium':'high')};
  }
  function namesFor(stocks,predicate){return stocks.filter(predicate).map(item=>item.stock.name||item.stock.symbol)}
  function coordinationLimitations(stocks,portfolio){
    const limitations=['本次只覆盖所选股票，并非完整券商组合，因此不能据此判断整个账户的真实集中度。'],unavailableNews=namesFor(stocks,item=>item.news.todayRelevance==='unavailable'),oldNews=namesFor(stocks,item=>item.news.todayRelevance==='outdated'),badTechnical=namesFor(stocks,item=>item.technical.todayRelevance==='inconsistent');
    if(unavailableNews.length)limitations.push(`${unavailableNews.join('、')}缺少最新新闻资料，短期催化判断置信度较低。`);if(oldNews.length)limitations.push(`${oldNews.join('、')}仅有较早新闻资料，不能作为今日催化。`);if(badTechnical.length)limitations.push(`${badTechnical.join('、')}的技术快照存在不一致，暂不使用精确支撑压力位。`);if(stocks.some(item=>item.holding.currentWeight===null))limitations.push('部分仓位权重口径不完整，暂不进行精确超配判断。');if(portfolio.knownCash===null)limitations.push('当前未提供可靠现金数据，因此无法判断现金比例和新增资金承受能力。');return limitations.slice(0,5);
  }
  function buildPortfolioContext(stocks,options={}){
    const selected=selectableStocks(stocks);if(selected.length<1)throw new Error('请至少选择一只股票。');if(selected.length>MAX_SELECTED_STOCKS)throw new Error(`今日组合最多选择 ${MAX_SELECTED_STOCKS} 只股票。`);
    const seen=new Set();selected.forEach(stock=>{const symbol=canonicalSymbol(symbolOf(stock));if(!symbol)throw new Error('组合复核股票缺少 canonical symbol。');if(seen.has(symbol))throw new Error(`组合中存在重复 symbol：${symbol}。`);seen.add(symbol)});
    const allStocks=selectableStocks(options.allStocks&&options.allStocks.length?options.allStocks:selected),portfolioMarketValue=allKnownHoldingMarketValue(allStocks),reviewDate=dateOnly(options.reviewDate)||new Date().toISOString().slice(0,10),contexts=selected.map(stock=>stockContext(stock,{portfolioMarketValue,reviewDate,planReviewStore:options.planReviewStore})),selectedValues=contexts.map(item=>item.holding.currentMarketValue).filter(value=>value!==null),knownMarketValue=selectedValues.length?Number(selectedValues.reduce((sum,value)=>sum+value,0).toFixed(2)):null;
    const portfolio={stockCount:contexts.length,knownMarketValue,marketValueScope:'selected_review_universe',knownApplicationHoldingsMarketValue:portfolioMarketValue,knownCash:null,cashStatus:'unavailable',selectionScope:'selected_review_universe_not_confirmed_full_brokerage_portfolio',notes:'当前持仓与价格来自应用状态；实际券商持仓与成交记录具有最终权威。'};
    const planReferences=PlanV2.buildContextReference(contexts,reviewDate);
    return {reviewDate,generatedAt:text(options.generatedAt)||new Date().toISOString(),portfolio,readiness:readiness(contexts),coordinationLimitations:coordinationLimitations(contexts,portfolio),planReferences,stocks:contexts};
  }
  function buildRequest(stocks,options={}){
    const context=buildPortfolioContext(stocks,options);
    return [
      '你是一名谨慎的组合级每日复核助理。你的任务不是重复逐只股票分析，而是比较所选股票（本次选择的股票）并给出今天的组合复核优先级。','',
      '事实协调规则：','1. 只能使用下方结构化事实；程序拥有当前持仓、价格、日期、计划、todayRelevance 和数据一致性，禁止重算或改写。','2. 当前持仓事实优先于配置分析中的历史仓位描述；当前程序技术事实优先于旧技术叙述；当前新闻快照优先于历史催化；只有标记为当前有效的计划可作为当前计划输入。','3. 计划复核只是判断，不能覆盖计划事实。计划版本不一致时，旧复核必须视为过期；没有复核或复核过期时应降低置信度，但不得自动移除计划。','4. 只有 todayRelevance=current 的高时效资料可直接描述为今日信息；usable_with_caution 只能作为带日期的谨慎参考；outdated 只能作为历史背景；stale、unavailable、unknown 或 inconsistent 都必须降低对应事实的可用性。','5. currentSnapshot 与 historicalReference 不得混用；历史新闻只能称为“历史参考”或“延续性背景”。','6. 实际券商持仓、成交和订单具有最终权威；本次选择的股票不一定等于完整券商组合。','7. 明确区分 held、watchlist 与 zero_position_candidate；零仓候选不得使用“继续持有”等措辞。','8. 复核既有计划，但不得修改、覆盖或新增存储计划。价格跨过阈值只表示“价格已触发，待确认其他条件”，绝不等于完整计划条件已满足。需复核或历史参考计划不得静默提高今日优先级。','9. 不得发明持仓、价格、财务、新闻、计划、仓位或市场背景，也不给确定性买卖指令。','',
      '用户语言边界：','1. 正常用户文字（summary、marketContext、reason、focus、planRelation、portfolioRisks、todayFocus、dataLimitations）不得出现内部字段名、对象名、英文枚举或实现术语。','2. 禁止在正常文字中出现：selected_review_universe、knownMarketValue、knownApplicationHoldingsMarketValue、knownCash、cashStatus、weightStatus、allocation、fundamental、valuation、marketContext、todayRelevance、fresh、stale、unknown、unavailable、inconsistent。结构化 JSON 的固定字段名和枚举字段值除外。','3. 把内部状态翻译成自然中文及其后果。例如不要写“knownCash=null, cashStatus=unavailable”，应写“当前未提供可靠现金数据，因此无法判断现金比例和新增资金承受能力”。','4. 模块名称使用“基本面、估值、配置”；所选范围使用“本次复核股票、本次选择的股票、本次复核范围”。','5. dataLimitations 优先 3–5 条且最多 5 条，合并同类问题；每条只说明这项问题如何影响今天的判断，不得输出字段审计清单。','6. portfolioRisks 只写集中度、同步技术风险、计划触发聚集、关键资料覆盖、估值集中或影响决策的已知冲突。','',
      '复核任务：','1. 比较股票并识别今日最高优先级关注。','2. 识别持仓、技术、新闻、估值、配置与主题集中风险。','3. 对计划区分“接近价格区、价格已触发待确认、计划需复核、尚未接近、不明确”；输入的 fullConditionStatus 无法证明时，绝不能写“完整条件已满足”。','4. 优先卡只写股票、优先级、今天为何重要、观察什么及相关计划，避免重复完整模块摘要。','5. confidence 综合覆盖度、对今日的适用性、不一致和高影响模块缺失；多个高时效模块较旧/缺失/不一致时降低置信度，单独估值较旧不必自动降为低。','',
      '严格输出要求：','1. 只输出严格 JSON，不要 Markdown、代码围栏或额外解释。','2. 顶层只能包含 portfolioReview；内部必须完整包含示例中的全部字段，即使数组为空也要返回 []。','3. 只能引用输入 stocks 中的精确 symbol；禁止名称匹配、后缀猜测、部分推断或新增股票。','4. 同一 section 内 symbol 不得重复。','5. portfolioRiskLevel 只能为 low, moderate, high, unclear。','6. priority 只能为 high, medium, low。','7. planWatch.status 只能为 approaching, triggered, invalidated, not_close, unclear；triggered 的 reason 必须明确只是价格触发且仍待确认。','8. confidence 只能为 high, medium, low。','9. reviewDate 必须等于输入 reviewDate。','',
      '程序生成的组合上下文：',JSON.stringify(context,null,2),'','严格输出结构示例（内容仅示意，必须按输入事实重写）：',JSON.stringify(CONTRACT_EXAMPLE,null,2)
    ].join('\n');
  }
  function requestMetrics(request){const value=String(request??'');const bytes=typeof TextEncoder==='function'?new TextEncoder().encode(value).length:Buffer.byteLength(value,'utf8');return {characters:value.length,bytes,kilobytes:Number((bytes/1024).toFixed(1)),approxTokens:Math.ceil(value.length/2.2)}}

  return {MAX_SELECTED_STOCKS,TODAY_RELEVANCE,RELEVANCE_POLICY,CONTRACT_EXAMPLE,selectableStocks,holdingFacts,technicalConsistency,compactTechnical,compactNews,compactFundamental,compactValuation,compactLongTerm,compactAllocation,compactPlans,stockContext,readiness,coordinationLimitations,buildPortfolioContext,buildRequest,requestMetrics};
});
