(function(root,factory){
  const node=typeof module==='object'&&module.exports;
  const api=factory(...(node?['portfolio-review-context','discussion-workbench','plan-v2','plan-review','plan-runtime','technical-view-ux','universe-handoff'].map(name=>require(`./${name}.js`)):[root.PortfolioReviewContext,root.DiscussionWorkbench,root.PlanV2,root.PlanReview,root.PlanRuntime,root.TechnicalViewUx,root.UniverseHandoff]));
  if(node)module.exports=api;else root.HomepageAttention=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(Portfolio,Discussion,Plan,PlanReview,Runtime,Technical,Universe){
  'use strict';
  const array=value=>Array.isArray(value)?value:[];
  const rank={critical:0,high:1,medium:2};
  const actionablePhases=['watch_zone','forming','confirmed','action_review','downgraded','invalidated'];
  const active=plan=>plan&&plan.status==='active'&&!['invalid','completed'].includes(plan.validityStatus);
  const focused=current=>current&&['focused','window'].includes(current.attentionLevel);
  const epoch=value=>Date.parse(value)||0;

  // Reuse canonical date/consistency and scheduler rules; never compare today's date to a bar.
  function technicalHealth(stock,state,now){
    const data=stock.technicalData||{},facts=Portfolio.compactTechnical(stock);
    const date=Technical.canonicalTechnicalDate({technicalData:data,priceHistory:stock.priceHistory,referenceDate:new Date(now)});
    let status='current',reason='';
    if(!date.historyLastDate){status='unavailable';reason='当前没有完整日K，技术判断暂不能作为当前依据。'}
    else if(date.conflict||facts.dataQuality==='inconsistent'||data.technicalDataStatus==='anomaly'){
      status='inconsistent';reason='技术日期或快照与最新完整日K不一致。';
    }else if(data.technicalDataStatus==='unavailable'||date.incomplete){status='unavailable';reason='缺少完整技术快照，当前技术判断暂不可用。'}
    else if(date.stale){status='stale';reason='当前技术资料已过期，暂不能作为最新判断依据。'}
    else if(!date.fresh){status=data.technicalDataStatus==='fresh'?'inconsistent':'pending';reason='技术数据尚未确认就绪，当前判断需等待数据。'}
    if(status==='current'&&stock.marketDataFreshness&&stock.marketDataFreshness.last_trade_date&&
      !Universe.validBridgeFacts({symbol:stock.code||stock.symbol,priceHistory:stock.priceHistory,marketDataFreshness:stock.marketDataFreshness,technicalIndicators:stock.technicalIndicators})){
      status='inconsistent';reason='行情来源日期或技术指标与完整日K不一致。';
    }
    if(status==='unavailable'&&Universe.isPending(state,stock.code||stock.symbol)){
      status='pending';reason='该标的尚未获得预期行情覆盖，当前技术判断需要等待完整日K。';
    }
    return {status,reason,sourceAsOf:date.technicalAsOf||date.historyLastDate||null};
  }

  function judgmentSource(stock,state,health){
    const raw=stock.discussionState&&stock.discussionState.current;
    if(!raw)return {status:'unavailable',current:null};
    const checked=Discussion.validateState(raw);
    if(!checked.ok)return {status:'invalid',current:null};
    const current=checked.state;
    if(health.status!=='current')return {status:'stale',current};
    const options={state,planReviewStore:state.planReviews,planReviewApi:PlanReview};
    const continuity=Discussion.stateFreshness(stock,current,options);
    const increment=Discussion.barsAfter(stock,current.technicalSnapshot.anchorBar,{symbol:current.symbol});
    const latest=Discussion.technicalSnapshot(stock);
    // Continuity allows new bars for Discussion. A homepage risk must describe the latest facts.
    const unchanged=continuity.status==='current'&&increment.mode==='incremental'&&!increment.bars.length&&
      latest.reviewHash===current.technicalSnapshot.reviewHash;
    return {status:unchanged?'current':'stale',current};
  }

  // Derived only; never written into Current State. No prose creates an action.
  function selectActionSignal(current,held,relevant=true){
    const debug={source:'risk_current_state',primaryDimension:null,primaryStatus:null,secondaryDimension:null,eligibilityReason:null,suppressionReason:null,conflicts:[]};
    const suppress=reason=>({primary:null,secondary:null,signals:[],debug:{...debug,suppressionReason:reason}});
    if(!current||current.confidence==='low')return suppress('missing_or_low_confidence');
    const d=current.userDecision,a=current.actionAssessment||{},signals=[];
    const add=(dimension,status,code,action,strength,order,priority,title,summary,reason)=>signals.push({dimension,status,code,action,strength,order,priority,title,summary,eligibilityReason:reason});
    if(d){
      const enums={holding:Discussion.HOLDING_STATUSES,positionDirection:Discussion.POSITION_DIRECTION_STATUSES,addAssessment:Discussion.ADD_ASSESSMENT_STATUSES,takeProfit:Discussion.TAKE_PROFIT_STATUSES,stopLoss:Discussion.STOP_LOSS_STATUSES};
      for(const [key,values] of Object.entries(enums))if(!values.includes(d[key]?.status))return suppress('unknown_status:'+key);
      if(!Discussion.RISK_SOURCES.includes(d.riskSource))return suppress('unknown_risk_source');
      // Preserve the market-source freshness boundary from Homepage Risk Alert V1.
      if(d.riskSource==='market')return suppress('market_context_not_freshness_bound');
      const h=d.holding.status,p=d.positionDirection.status,b=d.addAssessment.status,t=d.takeProfit.status,s=d.stopLoss.status;
      if(held?h==='not_applicable':h!=='not_applicable'||t!=='not_applicable'||s!=='not_applicable'||!['not_applicable','add_watch','add_review'].includes(p))return suppress('position_mismatch');
      // A bounded contradiction veto, not NLP action extraction: these literal negative /
      // future-only constructions can only REMOVE an enum-derived candidate. Unknown prose
      // never increases its strength. All displayed sentences below are fixed vocabulary.
      const veto=(dimension,topic)=>{
        const summary=String(d[dimension]?.summary||''),texts=[summary,String(d.headline||'')];
        const negative='尚未|还未|暂未|未进入|暂不|无需|不需要|不必|没有|暂无';
        const denied=texts.some(text=>new RegExp('(?:'+negative+')[^。；！？]{0,18}(?:'+topic+')').test(text)||new RegExp('(?:'+topic+')[^。；！？]{0,8}(?:'+negative+')').test(text))||/^(?:目前|当前|现在)?(?:如果|若|待|等到|一旦)/.test(summary);
        if(denied)debug.conflicts.push(dimension+':explicit_negative_or_future_only');
        return denied;
      };
      if(held){
        if(s==='risk_control'&&!veto('stopLoss','止损|本金风险|风险控制'))add('stopLoss',s,'stop_loss','stop_loss','consider',0,'critical','需关注止损','当前本金风险需要优先关注。','explicit_capital_risk');
        if((h==='risk_control'||p==='risk_control')&&!veto(p==='risk_control'?'positionDirection':'holding','风险控制|减仓'))add(p==='risk_control'?'positionDirection':'holding','risk_control','risk_control','hold','attention',1,'critical','注意持仓风险','当前仓位风险需要优先关注。','explicit_risk_control');
        // Holding safety cannot override an explicit hold direction into a reduction.
        if(h==='reduce_review'&&p!=='reduce_review')debug.conflicts.push('holding_reduce_without_position_reduce');
        if(p==='reduce_review'&&!veto('positionDirection','减仓|降低仓位|减少仓位'))add('positionDirection',p,'reduce_review','reduce','consider',2,'high','可考虑减仓','当前判断支持考虑减少仓位。','explicit_current_reduce');
        // watch is not a current take-profit action, regardless of priority or prose.
        if(t==='review'&&!veto('takeProfit','止盈|利润保护|保护利润'))add('takeProfit',t,'take_profit','take_profit','consider',3,'high','可以考虑止盈','当前需要关注已有利润的保护。','explicit_take_profit_review');
      }
      const defensive=held&&(p==='reduce_review'||p==='risk_control'||h==='risk_control'||s==='risk_control'||t==='review');
      const opportunity=b==='add_review'&&a.category===(held?'add_review':'entry_review')&&a.priority==='high';
      if(opportunity&&(defensive||p==='hold_no_add'))debug.conflicts.push('add_opportunity_conflicts_with_defensive_direction');
      if(opportunity&&!defensive&&p!=='hold_no_add'&&!veto('addAssessment','加仓|建仓|买入'))add('addAssessment',b,'opportunity',held?'add':'build','consider',held?4:5,'high',held?'可以考虑加仓':'可以考虑建仓',held?'当前判断支持考虑增加仓位。':'当前判断支持考虑买入建仓。','explicit_opportunity_high_priority');
      const meaningfulWait=focused(current)&&a.category==='wait_confirmation'&&['medium','high'].includes(a.priority)&&['wait','watch'].includes(b)&&(held?['hold_no_add','add_watch'].includes(p):['not_applicable','add_watch'].includes(p));
      const meaningfulAvoid=relevant&&focused(current)&&b==='avoid'&&['stock','both'].includes(d.riskSource);
      if(meaningfulWait||meaningfulAvoid)add('addAssessment',b,held?'add_restriction':'entry_risk',held?'add':'build','wait',6,'medium',held?'暂不加仓':'暂不建仓',held?'当前应等待，不急于增加仓位。':'当前应等待，不急于买入。',meaningfulWait?'focused_wait_decision':'focused_avoid_risk');
      if(held&&focused(current)&&(h==='caution'||s==='watch'))add(h==='caution'?'holding':'stopLoss',h==='caution'?h:s,'holding_caution','hold','attention',7,'medium','注意持仓风险','当前持仓有需要重点关注的风险。','focused_holding_risk');
    }else if(current.schemaVersion===Discussion.V2_STATE_SCHEMA_VERSION){
      if(held&&a.category==='risk_control'&&a.priority==='high')add('actionAssessment',a.category,'risk_control','hold','attention',1,'critical','注意持仓风险','当前仓位风险需要优先关注。','legacy_v2_explicit_risk');
      if(held&&a.category==='reduce_review'&&a.priority==='high')add('actionAssessment',a.category,'reduce_review','reduce','consider',2,'high','可考虑减仓','当前判断支持考虑减少仓位。','legacy_v2_explicit_reduce');
      if(!held&&a.category==='entry_review'&&a.priority==='high')add('actionAssessment',a.category,'opportunity','build','consider',5,'high','可以考虑建仓','当前判断支持考虑买入建仓。','legacy_v2_explicit_entry');
    }
    signals.sort((a,b)=>a.order-b.order);
    if(!signals.length)return suppress(debug.conflicts.length?'conflicting_judgment':'no_meaningful_current_action');
    const primary=signals[0],secondary=signals.find(signal=>signal.action!==primary.action&&signal.title!==primary.title)||null;
    Object.assign(debug,{primaryDimension:primary.dimension,primaryStatus:primary.status,secondaryDimension:secondary?.dimension||null,eligibilityReason:primary.eligibilityReason});
    return {primary,secondary,signals,debug};
  }

  function runtimeLanguage(phase,held){
    const title=held?'关注持仓安排':'关注建仓安排';
    const summaries={watch_zone:'操作条件还未成熟，请先等待。',forming:'操作条件还未成熟，请先等待。',confirmed:'结合当前判断，再决定是否调整仓位。',action_review:'结合当前判断，再决定是否调整仓位。',downgraded:'原先的操作依据减弱，请先谨慎等待。',invalidated:'原先的操作依据已失效，请暂停按原计划操作。'};
    return {title,summary:summaries[phase]};
  }

  function build(state={},options={}){
    const now=options.now??Date.now(),items=[],diagnostics=[];
    const stocks=Portfolio.selectableStocks(state.stocks).map(stock=>{
      const held=Portfolio.holdingFacts(stock).holdingStatus==='held',plans=array(stock.plans).filter(plan=>active(plan)&&!['inactive','historical_only'].includes(Plan.freshness(plan,Discussion.localCalendarDate(new Date(now),{timeZone:'Asia/Shanghai'}))));
      const watching=['watching','watchlist'].includes(stock.type),health=technicalHealth(stock,state,now);
      const source=judgmentSource(stock,state,health),attention=source.status==='current'&&focused(source.current);
      return {stock,held,plans,watching,health,source,relevant:held||plans.some(Plan.hasWatchDefinition)||watching||attention};
    });
    const task=options.marketTask,taskStatus=Technical.taskStatusPresentation(task,{now:new Date(now)}),run=task&&task.latest_run||{};
    const globalFailure=stocks.some(row=>row.relevant)&&taskStatus.current&&
      ((taskStatus.kind==='failed'&&!(Number(run.success)>0))||['failed','error'].includes(run.bridge_status)||['failed','error'].includes(run.workbench_delivery_status));
    const sync=options.syncStatus||{},syncBlocked=['error','auth_required','offline'].includes(sync.state)&&Number(sync.pending)>0&&stocks.some(row=>row.relevant&&['pending','unavailable'].includes(row.health.status)&&Universe.isPending(state,row.stock.code||row.stock.symbol));
    if(globalFailure)items.push({id:'system:market_task',stockId:null,name:'行情更新',source:'market_task',sourceAsOf:run.finished_at||task.last_run_time||task.generated_at,sourceStatus:'current',priority:'critical',title:'行情数据更新异常',summary:'行情任务未完成更新，相关技术判断暂不可作为最新依据。',cta:{action:'technical',stockId:stocks.find(row=>row.relevant).stock.id,label:'查看数据'},held:false,relevance:0,changedAt:run.finished_at||task.last_run_time});
    else if(syncBlocked)items.push({id:'system:sync',stockId:null,name:'股票清单同步',source:'system_sync',sourceAsOf:null,sourceStatus:'current',priority:'high',title:'同步阻塞行情获取',summary:'相关标的尚无可用行情，请检查股票清单同步。',cta:{action:'sync',label:'查看同步'},held:false,relevance:0,changedAt:null});

    for(const row of stocks){
      const {stock,held,plans,health,source,relevant}=row,candidates=[];
      const add=(signal,origin,asOf,status,action,changedAt=asOf)=>candidates.push({...signal,source:origin,sourceAsOf:asOf||null,sourceStatus:status,changedAt:changedAt||null,cta:{action,label:{discussion:'开始讨论',plan:'查看计划',technical:'查看数据'}[action]}});
      if(relevant&&health.status!=='current'){
        const explained=(globalFailure&&['stale','pending','unavailable'].includes(health.status))||(syncBlocked&&health.status==='pending');
        if(!explained)add({code:'data_health',priority:held&&plans.some(Plan.hasWatchDefinition)?'critical':'medium',title:health.status==='inconsistent'?'技术数据异常':health.status==='unavailable'?'日K / 技术数据缺失':'行情数据未更新',summary:health.reason},'technical_data',health.sourceAsOf,health.status,'technical');
      }
      const selection=source.status==='current'?selectActionSignal(source.current,held,relevant):null;
      diagnostics.push({stockId:stock.id,...(selection?.debug||{source:'risk_current_state',suppressionReason:'source_'+source.status})});
      if(selection?.primary)add({...selection.primary,actionDebug:selection.debug,secondary:selection.secondary?.title||''},'risk_current_state',source.current.technicalAsOf,'current','discussion',source.current.confirmedAt);

      for(const plan of plans){
        if(!Plan.hasWatchDefinition(plan))continue;
        const runtime=Runtime.runtimeFor(state,plan.id);
        if(!runtime||!Runtime.validateRecord(runtime).ok||!actionablePhases.includes(runtime.phase))continue;
        const binding=Runtime.bindingStatus(state,plan.id);
        if(['definition_changed','current_state_changed'].includes(binding)){
          add({code:'runtime_binding',planId:plan.id,priority:['confirmed','action_review','invalidated'].includes(runtime.phase)?'high':'medium',title:'原计划需要确认',summary:'操作依据已变化，请先确认原计划是否仍适用。'},'plan_runtime',runtime.updatedAt,'stale','plan');continue;
        }
        if(binding!=='current'||source.status!=='current'||health.status!=='current'||Plan.freshness(plan,Discussion.localCalendarDate(new Date(now),{timeZone:'Asia/Shanghai'}))!=='current')continue;
        if(['watch_zone','forming'].includes(runtime.phase)&&(!relevant||runtime.confidence==='low'||(runtime.phase==='forming'&&!focused(source.current))))continue;
        const priority={watch_zone:'medium',forming:'medium',confirmed:'high',action_review:'high',downgraded:'high',invalidated:'critical'}[runtime.phase];
        const {title,summary}=runtimeLanguage(runtime.phase,held),transition=array(runtime.history).filter(entry=>entry.fromPhase!==entry.toPhase).at(-1);
        add({code:runtime.phase,planId:plan.id,priority,title,summary},'plan_runtime',runtime.updatedAt,'current','plan',transition&&transition.committedAt||runtime.updatedAt);
      }
      const sourceRank={technical_data:0,risk_current_state:1,plan_runtime:2};
      candidates.sort((a,b)=>rank[a.priority]-rank[b.priority]||sourceRank[a.source]-sourceRank[b.source]||epoch(b.changedAt)-epoch(a.changedAt));
      if(!candidates.length)continue;
      const primary=candidates[0];
      items.push({...primary,id:`stock:${Discussion.canonical(stock)}`,stockId:stock.id,name:stock.name||stock.code,held,relevance:plans.some(Plan.hasWatchDefinition)?2:row.watching?1:0,secondary:primary.secondary||(candidates.find(item=>item!==primary&&item.title!==primary.title)?.title||''),causes:candidates.map(item=>({code:item.code,source:item.source,sourceStatus:item.sourceStatus,sourceAsOf:item.sourceAsOf,planId:item.planId||null}))});
    }
    items.sort((a,b)=>rank[a.priority]-rank[b.priority]||Number(b.held)-Number(a.held)||epoch(b.changedAt)-epoch(a.changedAt)||b.relevance-a.relevance);
    return {items,count:items.length,counts:Object.fromEntries(Object.keys(rank).map(priority=>[priority,items.filter(item=>item.priority===priority).length])),quietText:'今日暂无需要优先关注的风险。',diagnostics};
  }
  return Object.freeze({build,technicalHealth,judgmentSource,selectActionSignal});
});
