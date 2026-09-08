(function(root,factory){const node=typeof module==='object'&&module.exports;const api=factory(node?require('./plan-context-contract'):root.PlanContextContract,node?require('./discussion-workbench'):root.DiscussionWorkbench,node?require('./plan-v2'):root.PlanV2);if(node)module.exports=api;else root.DiscussionV4=api})(typeof globalThis!=='undefined'?globalThis:this,function(C,D,P){
  'use strict';
  const SCHEMA='discussion-decisions.v4',OUTCOMES=['keep_current_plan','continue_waiting','consider_entry','consider_increase','consider_reduce','decline_current_suggestion','review_plan_change'];
  const LABELS={keep_current_plan:'保持当前计划',continue_waiting:'继续等待',consider_entry:'愿意考虑建仓',consider_increase:'愿意考虑加仓',consider_reduce:'愿意考虑减仓',decline_current_suggestion:'暂不接受当前建议',review_plan_change:'复核长期计划变化'};
  const sources=new Map(),sessions=new WeakMap(),used=new WeakSet(),pending=new WeakSet();
  const clone=C.clone,stable=C.stable;
  const uid=prefix=>`${prefix}_${typeof crypto!=='undefined'&&crypto.randomUUID?crypto.randomUUID():Date.now().toString(36)+'_'+Math.random().toString(36).slice(2)}`;
  function empty(){return {schemaVersion:SCHEMA,discussions:{},decisions:{}}}
  function store(state){return state.discussionDecisionsV4||empty()}
  function exact(value,keys){return value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).sort().join(',')===keys.slice().sort().join(',')}
  function validSource(value,symbol){
    if(value===null)return true;
    if(!exact(value,['type','reasonCode','observedAt','sourceAsOf','planRef','evidenceRef','symbol'])||value.symbol!==symbol||!['homepage','plan','manual'].includes(value.type)||typeof value.reasonCode!=='string'||value.reasonCode.length>160||!Number.isFinite(Date.parse(value.observedAt))||!(value.sourceAsOf===null||D.validDate(value.sourceAsOf)))return false;
    const ref=value.planRef;return (!ref||(C.validDefinitionRef(ref,{allowUnknown:true})))&&(value.evidenceRef===null||typeof value.evidenceRef==='string'&&value.evidenceRef.length<300);
  }
  function source(state,stockId,item=null,type='manual',now=new Date()){
    const stock=state.stocks.find(s=>s.id===stockId);if(!stock)throw new Error('找不到标的');const found=item?.planId?C.exactPlan(state,item.planId):null;
    if(found&&found.stock.id!==stockId)throw new Error('来源计划与标的不一致');
    const value={type,reasonCode:String(item?.code||item?.signalType||'manual_entry'),observedAt:new Date(now).toISOString(),sourceAsOf:item?.sourceAsOf||null,planRef:found?(C.definitionRefFor(state,found.plan)||{planId:found.plan.id,definitionHash:null,hashContractVersion:C.HASH_CONTRACT}):null,evidenceRef:item?.signalType?item.signalType+':'+C.sha256(stable({price:stock.currentPrice??null,shares:stock.shares,indicators:stock.technicalIndicators||null,latest:D.technicalSnapshot(stock).anchorBar})):null,symbol:D.canonical(stock)};
    if(!validSource(value,value.symbol))throw new Error('讨论来源无效');return value;
  }
  function rememberSource(stockId,value){sources.set(stockId,clone(value))}
  function sourceFor(stockId){return clone(sources.get(stockId)||null)}
  function revalidateSource(state,stockId,value){
    const stock=state.stocks.find(s=>s.id===stockId);if(!stock||!validSource(value,D.canonical(stock)))throw new Error('讨论来源与标的不一致');
    const context=C.context(state,stockId),binding=value?.planRef?C.binding(state,value.planRef):null,reasons=[];
    if(binding&&binding.bindingStatus!=='current')reasons.push('source_plan_changed');
    if(value?.evidenceRef?.includes(':')){const fingerprint=C.sha256(stable({price:stock.currentPrice??null,shares:stock.shares,indicators:stock.technicalIndicators||null,latest:D.technicalSnapshot(stock).anchorBar}));if(value.evidenceRef.split(':')[1]!==fingerprint)reasons.push('source_facts_changed')}
    if(value?.sourceAsOf&&value.sourceAsOf!==context.factsAsOf)reasons.push('source_evidence_changed');
    if(value?.planRef&&binding?.bindingStatus==='current'){
      const found=C.exactPlan(state,value.planRef.planId),a=C.applicability(found.stock,found.plan);
      if(a.status!=='applicable')reasons.push(...a.reasons);
      if(value.evidenceRef?.startsWith('plan_trigger:')&&P.evaluatePriceTrigger(found.plan,found.stock.currentPrice).status!=='triggered')reasons.push('price_no_longer_triggered');
    }
    if(stock.technicalData?.technicalDataStatus&&stock.technicalData.technicalDataStatus!=='fresh')reasons.push('technical_not_current');
    return {source:clone(value),status:reasons.length?'changed':'revalidated',reasons,currentContext:context};
  }
  function recordJudgment(state,stockId,current,sourceContext=null){
    const stock=state.stocks.find(s=>s.id===stockId);if(!stock||!D.validateState(current).ok||current.symbol!==D.canonical(stock)||!validSource(sourceContext,current.symbol))throw new Error('Discussion snapshot 无效');
    if(!state.discussionDecisionsV4)state.discussionDecisionsV4=empty();const id='discussion_'+current.stateId;
    if(!state.discussionDecisionsV4.discussions[id])state.discussionDecisionsV4.discussions[id]={discussionId:id,symbol:current.symbol,recordedAt:current.confirmedAt,sourceContext:clone(sourceContext),judgment:clone(current)};
    return id;
  }
  function validate(value){
    if(!exact(value,['schemaVersion','discussions','decisions'])||value.schemaVersion!==SCHEMA)throw new Error('Discussion V4 store 无效');
    for(const key of ['discussions','decisions'])if(!value[key]||typeof value[key]!=='object'||Array.isArray(value[key]))throw new Error('Discussion V4 collection 无效');
    for(const [id,item] of Object.entries(value.discussions)){
      if(!exact(item,['discussionId','symbol','recordedAt','sourceContext','judgment'])||id!==item.discussionId||!item.symbol||!Number.isFinite(Date.parse(item.recordedAt))||!validSource(item.sourceContext,item.symbol)||item.judgment!==null&&(!D.validateState(item.judgment).ok||item.judgment.symbol!==item.symbol))throw new Error('Discussion V4 snapshot 无效');
    }
    for(const [id,item] of Object.entries(value.decisions)){
      const discussion=value.discussions[item?.discussionId];
      if(!exact(item,['decisionId','discussionId','symbol','confirmedAt','outcome','note','consideredJudgmentRef','planDisposition','context'])||id!==item.decisionId||!discussion||discussion.symbol!==item.symbol||!OUTCOMES.includes(item.outcome)||!Number.isFinite(Date.parse(item.confirmedAt))||typeof item.note!=='string'||item.note.length>500||!['keep','none','change'].includes(item.planDisposition)||!item.context||item.context.symbol!==item.symbol)throw new Error('真实用户确认记录无效');
      const expected=discussion.judgment?{stateId:discussion.judgment.stateId,sourceDiscussionVersion:discussion.judgment.sourceDiscussionVersion}:null;
      if(stable(expected)!==stable(item.consideredJudgmentRef))throw new Error('用户确认引用与 AI 判断不一致');
      const c=item.context,disposition=item.outcome==='keep_current_plan'?'keep':['continue_waiting','decline_current_suggestion'].includes(item.outcome)?'none':'change';
      if(!exact(c,['schemaVersion','stockId','symbol','holding','evidence','technicalAnchor','factsAsOf','plans','assessmentRefs','currentStateRef','sourceSignal'])||c.schemaVersion!=='plan-discussion.context.v1'||typeof c.stockId!=='string'||!c.stockId||!exact(c.holding,['shares','avgCost'])||c.holding.shares!==null&&(!Number.isFinite(c.holding.shares)||c.holding.shares<0)||!Array.isArray(c.plans)||!Array.isArray(c.assessmentRefs)||!c.evidence||!c.technicalAnchor||stable(c.currentStateRef)!==stable(expected)||item.planDisposition!==disposition)throw new Error('用户确认的事实快照损坏');
      for(const plan of c.plans)if(!exact(plan,['planId','definitionRef','applicability','bindingStatus'])||typeof plan.planId!=='string'||plan.definitionRef!==null&&(!C.validDefinitionRef(plan.definitionRef)||plan.definitionRef.planId!==plan.planId))throw new Error('用户确认的计划引用损坏');
    }
    return true;
  }
  function prepareDecision(state,stockId,input={}){
    const stock=state.stocks.find(s=>s.id===stockId),context=C.context(state,stockId),outcome=input.outcome,note=String(input.note||'').trim();
    if(!OUTCOMES.includes(outcome)||note.length>500||context.holding.shares===null)throw new Error('请核对确认内容和持仓事实');
    if(context.holding.shares===0&&['consider_increase','consider_reduce'].includes(outcome)||context.holding.shares>0&&outcome==='consider_entry')throw new Error('确认方向与当前持仓不一致');
    if(outcome==='keep_current_plan'&&!stock.plans?.some(p=>p.status==='active'))throw new Error('当前没有可保持的正式计划');
    const sourceContext=input.sourceContext??sourceFor(stockId),revalidated=revalidateSource(state,stockId,sourceContext),current=stock.discussionState?.current||null;
    const prepared={stockId,outcome,note,context,sourceContext,revalidation:{status:revalidated.status,reasons:revalidated.reasons},judgment:clone(current)};
    sessions.set(prepared,stable(prepared));return prepared;
  }
  function buildDecision(state,prepared,now=new Date()){
    if(!sessions.has(prepared)||sessions.get(prepared)!==stable(prepared)||used.has(prepared))throw new Error('确认会话已失效');
    const current=prepareDecision(state,prepared.stockId,{outcome:prepared.outcome,note:prepared.note,sourceContext:prepared.sourceContext});
    if(stable(current.context)!==stable(prepared.context)||stable(current.judgment)!==stable(prepared.judgment))throw new Error('当前事实或判断已变化，请重新确认');
    const candidate=clone(state),confirmedAt=new Date(now).toISOString();if(!candidate.discussionDecisionsV4)candidate.discussionDecisionsV4=empty();
    const s=candidate.discussionDecisionsV4,discussionId=uid('discussion');
    if(!s.discussions[discussionId])s.discussions[discussionId]={discussionId,symbol:prepared.context.symbol,recordedAt:confirmedAt,sourceContext:clone(prepared.sourceContext),judgment:clone(prepared.judgment)};
    const decision={decisionId:uid('decision'),discussionId,symbol:prepared.context.symbol,confirmedAt,outcome:prepared.outcome,note:prepared.note,consideredJudgmentRef:clone(prepared.context.currentStateRef),planDisposition:prepared.outcome==='keep_current_plan'?'keep':['continue_waiting','decline_current_suggestion'].includes(prepared.outcome)?'none':'change',context:clone(prepared.context)};
    s.decisions[decision.decisionId]=decision;validate(s);return {candidate,decision};
  }
  async function commitDecision(state,prepared,deps={},options={}){
    if(options.confirmed!==true)return {status:'confirmation_required',writes:0};if(pending.has(prepared))return {status:'busy',writes:0};pending.add(prepared);
    try{const built=buildDecision(state,prepared,options.now);const saved=await deps.saveCandidate(built.candidate,{critical:true});if(saved===false||saved?.ok===false)throw new Error('保存失败');used.add(prepared);const next=saved?.state||built.candidate;deps.adoptCandidate?.(next);return {status:'completed',writes:1,state:next,decision:built.decision}}
    catch(error){return {status:'failed',writes:0,error}}finally{pending.delete(prepared)}
  }
  function latestDecision(state,symbol){return Object.values(store(state).decisions).filter(d=>d.symbol===symbol).sort((a,b)=>b.confirmedAt.localeCompare(a.confirmedAt)).at(0)||null}
  return Object.freeze({SCHEMA,OUTCOMES,LABELS,empty,store,validate,uid,source,validSource,rememberSource,sourceFor,revalidateSource,recordJudgment,prepareDecision,buildDecision,commitDecision,latestDecision});
});
