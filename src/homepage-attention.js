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

  function riskSignals(current,held,relevant){
    if(!current||current.confidence==='low')return [];
    const d=current.userDecision,a=current.actionAssessment||{},signals=[];
    const add=(code,priority,title,summary)=>signals.push({code,priority,title,summary});
    if(d){
      // No inferred broad-market signal: the existing market context has no freshness binding.
      if(d.riskSource==='market')return [];
      if(held){
        if([d.holding.status,d.positionDirection.status,d.stopLoss.status].includes('risk_control'))add('risk_control','critical','需要风险控制','关键风险上升，需要复核当前仓位的风险控制。');
        if([d.holding.status,d.positionDirection.status].includes('reduce_review'))add('reduce_review','high','需要减仓复核','当前持有安全判断转弱，仓位值得优先复核。');
        if(['watch','review'].includes(d.takeProfit.status))add('take_profit','high','开始关注利润保护','当前止盈判断需要关注，复核利润保护条件。');
        if(d.holding.status==='caution'&&focused(current))add('holding_caution','medium','当前持有安全判断转弱','当前仓位需要重点观察风险变化。');
        if(d.stopLoss.status==='watch'&&focused(current))add('stop_loss_watch','medium','风险控制条件值得关注','需要重点观察风险是否进一步上升。');
      }else if(relevant&&d.addAssessment.status==='avoid'&&['stock','both'].includes(d.riskSource)&&focused(current))add('entry_risk','medium','建仓风险需要关注','计划中的建仓需要重新审视下行风险。');
      if(d.addAssessment.status==='add_review'&&['add_review','entry_review'].includes(a.category)&&a.priority==='high')add('opportunity','high',held?'加仓机会值得复核':'建仓机会值得复核','当前条件值得进一步复核，仍需确认计划约束。');
    }else if(current.schemaVersion===Discussion.V2_STATE_SCHEMA_VERSION){
      // Narrow compatibility for validated V2 judgments, never legacy free-text risk inference.
      if(held&&a.category==='risk_control'&&a.priority==='high')add('risk_control','critical','需要风险控制','当前风险判断需要优先复核仓位安全。');
      if(held&&a.category==='reduce_review'&&a.priority==='high')add('reduce_review','high','需要减仓复核','当前仓位值得优先复核。');
      if(!held&&a.category==='entry_review'&&a.priority==='high')add('opportunity','high','建仓机会值得复核','当前条件值得进一步复核。');
    }
    return signals;
  }

  function build(state={},options={}){
    const now=options.now??Date.now(),items=[];
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
      if(source.status==='current')for(const signal of riskSignals(source.current,held,relevant))add(signal,'risk_current_state',source.current.technicalAsOf,'current','discussion',source.current.confirmedAt);

      for(const plan of plans){
        if(!Plan.hasWatchDefinition(plan))continue;
        const runtime=Runtime.runtimeFor(state,plan.id);
        if(!runtime||!Runtime.validateRecord(runtime).ok||!actionablePhases.includes(runtime.phase))continue;
        const binding=Runtime.bindingStatus(state,plan.id);
        if(['definition_changed','current_state_changed'].includes(binding)){
          add({code:'runtime_binding',planId:plan.id,priority:['confirmed','action_review','invalidated'].includes(runtime.phase)?'high':'medium',title:'计划状态需要重新复核',summary:'计划定义或已保存结论发生变化，原状态不能作为当前依据。'},'plan_runtime',runtime.updatedAt,'stale','plan');continue;
        }
        if(binding!=='current'||source.status!=='current'||health.status!=='current'||Plan.freshness(plan,Discussion.localCalendarDate(new Date(now),{timeZone:'Asia/Shanghai'}))!=='current')continue;
        if(['watch_zone','forming'].includes(runtime.phase)&&(!relevant||runtime.confidence==='low'||(runtime.phase==='forming'&&!focused(source.current))))continue;
        const labels={watch_zone:['medium','已到达观察区间','已到达观察区间，条件还未成熟。'],forming:['medium','计划条件正在形成','条件正在形成，需要继续重点观察。'],confirmed:['high','关键条件已经确立','计划已确认关键条件，值得复核下一步。'],action_review:['high','计划进入操作复核','关键条件已经确立，已进入操作复核。'],downgraded:['high','计划条件转弱','条件转弱，计划需要重新观察。'],invalidated:['critical','原有条件失效','原有条件已失效，需要重新复核计划。']};
        const [priority,title,summary]=labels[runtime.phase],transition=array(runtime.history).filter(entry=>entry.fromPhase!==entry.toPhase).at(-1);
        add({code:runtime.phase,planId:plan.id,priority,title,summary},'plan_runtime',runtime.updatedAt,'current','plan',transition&&transition.committedAt||runtime.updatedAt);
      }
      candidates.sort((a,b)=>rank[a.priority]-rank[b.priority]||(a.source==='technical_data'?-1:b.source==='technical_data'?1:0)||epoch(b.changedAt)-epoch(a.changedAt));
      if(!candidates.length)continue;
      const primary=candidates[0];
      items.push({...primary,id:`stock:${Discussion.canonical(stock)}`,stockId:stock.id,name:stock.name||stock.code,held,relevance:plans.some(Plan.hasWatchDefinition)?2:row.watching?1:0,secondary:candidates[1]?candidates[1].title:'',causes:candidates.map(item=>({code:item.code,source:item.source,sourceStatus:item.sourceStatus,sourceAsOf:item.sourceAsOf,planId:item.planId||null}))});
    }
    items.sort((a,b)=>rank[a.priority]-rank[b.priority]||Number(b.held)-Number(a.held)||epoch(b.changedAt)-epoch(a.changedAt)||b.relevance-a.relevance);
    return {items,count:items.length,counts:Object.fromEntries(Object.keys(rank).map(priority=>[priority,items.filter(item=>item.priority===priority).length])),quietText:'今日暂无需要优先关注的风险。'};
  }
  return Object.freeze({build,technicalHealth,judgmentSource});
});
