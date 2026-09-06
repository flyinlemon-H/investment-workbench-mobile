(function(root,factory){
  const node=typeof module==='object'&&module.exports;
  const api=factory(()=>node?require('./portfolio-review-context.js'):root.PortfolioReviewContext,()=>node?require('./universe-handoff.js'):root.UniverseHandoff,()=>node?require('./plan-v2.js'):root.PlanV2);
  if(node)module.exports=api;else root.DiscussionDataReadiness=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(getPortfolio,getUniverse,getPlan){
  'use strict';
  const text=value=>String(value??'').trim();
  const obj=value=>value&&typeof value==='object'?value:{};
  const MODULES=Object.freeze({news:{label:'新闻',workspace:'news'},fundamental:{label:'基本面',workspace:'fundamental'},longTermLogic:{label:'长期逻辑',workspace:'longterm'},valuation:{label:'估值',workspace:'valuation'}});
  const RULES=[
    '资料按本次问题的必要性使用：不得仅因新闻、基本面、长期逻辑或估值较旧或缺失就要求更新；只有当前问题实质依赖该资料、现有依据不足以负责地回答时，才建议补充最少必要资料。',
    '禁止泛化要求“建议先更新新闻、基本面、估值和长期逻辑后再讨论”，除非本次问题确实同时依赖全部资料。资料状态不是周期维护待办。',
    '当前技术强弱、持有风险、高位减仓、支撑失效、加仓时机和当前止盈止损判断，以有效完整日K为硬前提。dataReadiness.technical.ready 不为 true 时，必须明确降低置信度、作条件判断或先建议补齐行情，不能用旧新闻或基本面替代缺失日K。自由讨论仍可继续。',
    '只有今日适用的新闻可以描述为近期事件依据；历史资料不能冒充今天新闻。不得发明缺失的新闻、财务、长期逻辑或估值事实。',
    '如果技术资料有效，面对“今天是否安全持有？”、“现在有没有高位减仓风险？”、“如果想加仓应该等什么？”可继续技术和仓位判断，不强制更新新闻；必要时说明“近期新闻依据不足，因此不判断是否存在新的事件性风险”。',
    '面对“今天大跌是不是消息导致？”，若近期新闻依据不足，应说“本次判断需要近期新闻依据，建议先更新新闻。”仍可按用户意愿先作条件化分析，不强制阻断。',
    '面对“长期逻辑是不是变了？”，检查长期逻辑、相关财报与事件证据；只建议补充其中实质不足的资料，不能泛化更新全部模块。',
    '资料不足只限制依赖它的结论，明确保留不确定性。userDecision 保持当前结论、仓位方向、加仓评估、警惕与止盈止损的简短表达，不写资料检查清单。dataReadiness 是 input-only，不得写入 currentState JSON。'
  ].join('\n');
  function technical(stock,options={}){
    const portfolio=getPortfolio(),universe=getUniverse(),facts=portfolio.compactTechnical(stock),check=portfolio.technicalConsistency(stock),raw=obj(stock.technicalData),bridge=obj(stock.marketDataFreshness);
    let status=({current:'current',outdated:'stale',inconsistent:'anomaly',unavailable:'unavailable'})[facts.todayRelevance]||'unknown';
    if(!check.historyDate||!check.invariantComplete)status='unavailable';
    if(!check.consistent||raw.technicalDataStatus==='anomaly')status='anomaly';
    if(check.historyDate&&bridge.last_trade_date&&!universe.validBridgeFacts({symbol:stock.code||stock.symbol,priceHistory:stock.priceHistory,marketDataFreshness:bridge,technicalIndicators:stock.technicalIndicators}))status='anomaly';
    if(status==='current'&&bridge.kline_status==='stale')status='stale';
    if(status==='current'&&bridge.kline_status==='failed')status='unknown';
    if(status==='unavailable'&&universe.isPending(options.state||{},stock.code||stock.symbol))status='pending';
    const labels={current:`行情数据正常 · 日K截至 ${check.technicalAsOf.slice(5)}`,stale:'行情数据待更新 · 当前技术判断不能作为最新依据',unavailable:check.historyDate?'技术快照不完整 · 当前技术判断受限':'缺少完整日K · 请先补齐行情数据',anomaly:'行情数据异常 · 当前技术判断受限',pending:'等待行情覆盖 · 当前技术判断受限',unknown:'行情状态待确认 · 当前技术判断受限'};
    return {status,ready:status==='current',asOf:check.technicalAsOf||null,latestCompleteBar:check.historyDate||null,indicatorAsOf:text(stock.technicalIndicators&&stock.technicalIndicators.last_trade_date)||null,programStatus:text(raw.technicalDataStatus)||'unavailable',marketStatus:text(bridge.kline_status)||'unknown',dataQuality:facts.dataQuality,label:labels[status],workspace:'technical',actionLabel:'查看行情 / 检查同步状态',actionNote:'完整日K由电脑端行情流程生成；此处查看行情及同步状态，手机浏览器不会直接生成日K。'};
  }
  function build(stock,options={}){
    const portfolio=getPortfolio(),reviewDate=options.reviewDate||portfolio.localCalendarDate(options.now||new Date(),{timeZone:options.timeZone||'Asia/Shanghai'}),opts={reviewDate};
    const evidence={news:portfolio.compactNews(stock,opts),fundamental:portfolio.compactFundamental(stock,opts),longTermLogic:portfolio.compactLongTerm(stock,opts),valuation:portfolio.compactValuation(stock,opts)};
    const sources={news:obj(stock.recentCatalyst),fundamental:obj(stock.financialReview),longTermLogic:obj(stock.longTermLogic),valuation:obj(stock.valuationReview)};
    const fallback={fundamental:obj(stock.financialData),valuation:obj(stock.valuationData),longTermLogic:obj(stock.longTermLogicAudit&&stock.longTermLogicAudit.current)};
    const result={technical:technical(stock,options)};
    for(const [key,meta] of Object.entries(MODULES)){
      const item=evidence[key],source=sources[key],extra=fallback[key]||{},asOf=text(source.updatedAt||source.analysisDate||extra.updatedAt||extra.lastUpdated||item.analysisDate)||null;
      const available=item.todayRelevance!=='unavailable',period=key==='fundamental'?text(stock.financialData&&stock.financialData.reportPeriod):'';
      result[key]={...meta,status:item.status,todayRelevance:item.todayRelevance,available,asOf,sourceAsOf:item.latestSourceDate||null,reportPeriod:period||null,label:period|| (asOf?`更新于 ${asOf.slice(0,10)}`:(available?'已提供 · 日期未提供':'未提供')),required:false,evidence:item};
    }
    result.plan={status:(stock.plans||[]).length?'available':'unavailable',count:(stock.plans||[]).length};
    const runtime=obj(options.state&&options.state.planRuntimeStates&&options.state.planRuntimeStates.byPlanId);
    result.runtime={status:(stock.plans||[]).some(plan=>runtime[plan.id])?'available':'unavailable'};
    return result;
  }
  // Canonical research evidence only; never persist this session fingerprint in investment data.
  function evidenceSnapshot(stock){
    return {news:stock.recentCatalyst||null,shortTermSentiment:stock.shortTermSentiment||null,financialReviewFallback:stock.financialReview?null:stock.aiReviews&&stock.aiReviews.financialReview||null,sourceDates:{financial:stock.dataFreshness&&stock.dataFreshness.financialUpdatedAt||null,valuation:stock.dataFreshness&&stock.dataFreshness.valuationUpdatedAt||null},logicNotes:stock.longTermLogic&&stock.longTermLogic.investmentThesis||stock.thesis?'':stock.notes||'',financialData:stock.financialData||null,financialReview:stock.financialReview||null,valuationData:stock.valuationData||null,valuationReview:stock.valuationReview||null,longTermLogic:stock.longTermLogic||null,thesis:stock.thesis||'',longTermLogicAudit:stock.longTermLogicAudit&&stock.longTermLogicAudit.current||null,informationCompleteness:stock.informationCompleteness||null};
  }
  function fingerprint(stock){return `discussion_evidence_${getPlan().hash(evidenceSnapshot(stock))}`}
  function sessionChanged(prepared,rebuilt){return Boolean(prepared&&(prepared.protectedHash!==rebuilt.protectedHash||prepared.sourceDiscussionVersion!==rebuilt.sourceDiscussionVersion||prepared.evidenceHash!==rebuilt.evidenceHash))}
  return Object.freeze({MODULES,RULES,technical,build,evidenceSnapshot,fingerprint,sessionChanged});
});
