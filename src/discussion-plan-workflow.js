(function planDiscussionWorkflowModule(root,factory){
  const planV2=typeof module==='object'&&module.exports?require('./plan-v2.js'):root&&root.PlanV2;
  const identity=typeof module==='object'&&module.exports?require('./symbol-identity.js'):root&&root.SymbolIdentity;
  const strictAiJson=typeof module==='object'&&module.exports?require('./strict-ai-json.js'):root&&root.StrictAiJson;
  const workbench=typeof module==='object'&&module.exports?require('./discussion-workbench.js'):root&&root.DiscussionWorkbench;
  const planReview=typeof module==='object'&&module.exports?require('./plan-review.js'):root&&root.PlanReview;
  const api=factory(planV2,identity,strictAiJson,workbench,planReview);
  if(typeof module==='object'&&module.exports)module.exports=api;
  if(root)root.DiscussionPlanWorkflow=Object.freeze(api);
})(typeof globalThis!=='undefined'?globalThis:this,function(PlanV2,SymbolIdentity,StrictAiJson,DiscussionWorkbench,PlanReview){
  'use strict';

  if(!PlanV2||!SymbolIdentity||!StrictAiJson||!DiscussionWorkbench||!PlanReview)throw new Error('DiscussionPlanWorkflow dependencies are unavailable.');
  const SCHEMA_VERSION='discussion-plan-draft.v1';
  const OPERATIONS=Object.freeze(['create','update','no_change','invalidate','complete']);
  const PLAN_ACTIONS=Object.freeze(['buy','add','reduce','sell']);
  const TOP_FIELDS=Object.freeze(['schemaVersion','operation','symbol','draftSessionId','draftSessionVersion','draftSessionHash','sourceDiscussionVersion','currentStateId','currentStateHash','sourceStateId','sourceStateHash','targetPlan','plan','reason','risks','unresolvedItems']);
  const REQUIRED_TOP_FIELDS=Object.freeze(['schemaVersion','operation','symbol','targetPlan','plan','reason','risks','unresolvedItems']);
  const TARGET_FIELDS=Object.freeze(['id','planVersion','snapshotHash']);
  const PLAN_FIELDS=Object.freeze(['action','triggerPrice','triggerDirection','quantity','conditions','invalidationConditions','allocationConstraint','validUntil','nextReviewDate','note']);
  const CONDITION_FIELDS=Object.freeze(['technical','fundamental','catalyst','allocation','market','other']);
  const ALLOCATION_FIELDS=Object.freeze(['maxPositionPct','targetWeightRange']);
  const OPERATION_LABELS=Object.freeze({create:'新增计划',update:'修改计划',no_change:'保持不变',invalidate:'计划失效',complete:'计划完成'});
  const object=value=>value&&typeof value==='object'&&!Array.isArray(value)?value:{};
  const array=value=>Array.isArray(value)?value:[];
  const text=value=>String(value??'').trim();
  const clone=value=>value===undefined?undefined:JSON.parse(JSON.stringify(value));
  const canonical=value=>SymbolIdentity.canonicalSymbol(value);
  const positive=value=>{const number=Number(value);return Number.isFinite(number)&&number>0?number:null};
  const dateOnly=value=>{const raw=text(value);return raw&&/^\d{4}-\d{2}-\d{2}$/.test(raw)&&Number.isFinite(Date.parse(`${raw}T00:00:00Z`))?raw:null};
  const escapeHtml=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  let sessionSequence=0;

  function exactFields(source,allowed,label,errors,required=allowed){
    if(!source||typeof source!=='object'||Array.isArray(source)){errors.push(`${label} 必须是对象`);return false}
    const keys=Object.keys(source),extra=keys.filter(key=>!allowed.includes(key)),missing=required.filter(key=>!Object.prototype.hasOwnProperty.call(source,key));
    if(extra.length)errors.push(`${label} 包含未知字段：${extra.join('、')}`);
    if(missing.length)errors.push(`${label} 缺少字段：${missing.join('、')}`);
    return !extra.length&&!missing.length;
  }
  function stringList(value,label,errors,{limit=12,itemLimit=240}={}){
    if(!Array.isArray(value)){errors.push(`${label} 必须是字符串数组`);return []}
    if(value.length>limit)errors.push(`${label} 最多 ${limit} 项`);
    const rows=value.map(text);if(rows.some((item,index)=>!item||item.length>itemLimit||typeof value[index]!=='string'))errors.push(`${label} 每项必须是 1 至 ${itemLimit} 字的文字`);
    return rows.filter(Boolean).slice(0,limit);
  }
  function discussionBinding(state){
    const current=DiscussionWorkbench.normalizeState(state),sourceStateHash=`discussionstate_${DiscussionWorkbench.hash(current)}`;
    return {sourceDiscussionVersion:text(current.sourceDiscussionVersion),sourceStateId:text(current.stateId),sourceStateHash};
  }
  function planSnapshotHash(plan){return PlanReview.planSnapshotHash(PlanV2.normalizePlan(plan))}
  function planLabelBase(plan){
    const action=PlanV2.normalizePlan(plan).action;return action==='buy'?'建仓计划':(action==='add'?'加仓计划':(['reduce','sell'].includes(action)?'减仓计划':'计划'));
  }
  function replacementRootId(plan,byId){
    let current=plan,rootId=current.id;const seen=new Set([rootId]);
    while(current){const source=object(object(current.legacy).discussionPlanSource),previousId=text(source.replacesPlanId);if(!previousId||seen.has(previousId))break;rootId=previousId;seen.add(previousId);current=byId.get(previousId)||null}
    return rootId;
  }
  function planDisplayEntries(plans){
    const normalized=array(plans).map(plan=>PlanV2.normalizePlan(plan)),byId=new Map(normalized.map(plan=>[plan.id,plan])),indexById=new Map(normalized.map((plan,index)=>[plan.id,index]));
    const rows=normalized.filter(plan=>plan.status==='active'&&['active','needs_review'].includes(plan.validityStatus)).map((plan,index)=>({plan,index,base:planLabelBase(plan),slotKey:replacementRootId(plan,byId)}));
    const slotsByBase=new Map();
    rows.forEach(row=>{if(!slotsByBase.has(row.base))slotsByBase.set(row.base,[]);const slots=slotsByBase.get(row.base);if(!slots.includes(row.slotKey))slots.push(row.slotKey)});
    slotsByBase.forEach(slots=>slots.sort((a,b)=>(indexById.get(a)??Number.MAX_SAFE_INTEGER)-(indexById.get(b)??Number.MAX_SAFE_INTEGER)));
    return rows.map(row=>{const slots=slotsByBase.get(row.base),position=slots.indexOf(row.slotKey)+1,label=slots.length>1?`${row.base} ${position}`:row.base;return {plan:row.plan,label,slotKey:row.slotKey}});
  }
  function activePlans(stock){return planDisplayEntries(stock&&stock.plans).map(entry=>entry.plan)}
  function compactPlan(plan,displayLabel=''){
    const normalized=PlanV2.normalizePlan(plan),conditions={};
    CONDITION_FIELDS.forEach(category=>{conditions[category]=array(normalized.conditions&&normalized.conditions[category]).map(item=>item.text).filter(Boolean)});
    return {displayLabel:text(displayLabel)||planLabelBase(normalized),id:normalized.id,planVersion:normalized.planVersion,snapshotHash:planSnapshotHash(normalized),action:normalized.action,triggerPrice:normalized.triggerPrice,triggerDirection:normalized.triggerDirection,quantity:normalized.quantity,conditions,invalidationConditions:array(normalized.conditions&&normalized.conditions.invalidation).map(item=>item.text).filter(Boolean),allocationConstraint:clone(normalized.allocationConstraint),validUntil:normalized.validUntil,nextReviewDate:normalized.nextReviewDate,note:normalized.note,status:normalized.status,validityStatus:normalized.validityStatus};
  }
  function compactCurrentState(current){
    return {actionAssessment:clone(current.actionAssessment),attentionLevel:current.attentionLevel,trendAssessment:clone(current.trendAssessment),structureAssessment:clone(current.structureAssessment),focusPoints:clone(current.focusPoints),planRelation:clone(current.planRelation)};
  }
  function minTradeUnit(stock){
    const strategy=object(stock&&stock.strategy),configured=Number(strategy.minTradeUnit),explicit=strategy.minTradeUnitConfirmed===true||Boolean(text(strategy.minTradeUnitSource));
    if(configured>1||explicit&&configured>=1)return configured;
    const symbol=canonical(stock&&(stock.code||stock.symbol));if(/\.(SS|SZ)$/.test(symbol))return 100;
    return null;
  }
  function currentStateContext(stock){
    const store=DiscussionWorkbench.normalizeStore(stock&&stock.discussionState),current=store.current;
    if(!current||current.schemaVersion!==DiscussionWorkbench.STATE_SCHEMA_VERSION||!text(current.stateId)||!text(current.sourceDiscussionVersion))return {current:null,context:null,provenance:null};
    const legacy=discussionBinding(current);
    return {current,context:compactCurrentState(current),provenance:{sourceDiscussionVersion:legacy.sourceDiscussionVersion,currentStateId:legacy.sourceStateId,currentStateHash:legacy.sourceStateHash}};
  }
  function protectedFacts(stock){
    const symbol=canonical(stock&&(stock.code||stock.symbol)),shares=Number(stock&&stock.shares);
    if(!symbol||!Number.isFinite(shares)||shares<0)throw new Error('当前持仓或计划基础信息不足，暂时无法整理正式计划。');
    const avgCost=Number(stock&&(stock.avgCost??stock.cost)),plans=planDisplayEntries(stock&&stock.plans).map(entry=>compactPlan(entry.plan,entry.label)),holding={status:shares>0?'held':'zero_position',shares,avgCost:Number.isFinite(avgCost)&&avgCost>=0?avgCost:null,role:text(stock&&stock.role),type:text(stock&&stock.type),minTradeUnit:minTradeUnit(stock),maxPositionPct:protectedCap(stock)};
    const snapshot={symbol,stockId:text(stock&&stock.id),holding,plans:plans.map(plan=>({id:plan.id,planVersion:plan.planVersion,snapshotHash:plan.snapshotHash}))};
    return {symbol,holding,plans,snapshot,hash:`plandraftfacts_${DiscussionWorkbench.hash(snapshot)}`};
  }
  function createDraftSession(facts,options={}){
    const version=1,createdAt=text(options.now)||new Date().toISOString();sessionSequence+=1;
    const id=text(options.sessionId)||(typeof crypto!=='undefined'&&typeof crypto.randomUUID==='function'?`plandraft_${crypto.randomUUID()}`:`plandraft_${DiscussionWorkbench.hash({facts:facts.hash,createdAt,sessionSequence,nonce:Math.random()})}`);
    const requestedTarget=options.scopedTargetPlanId;
    let targetPlan=null,targetLabel='';
    if(requestedTarget!==undefined&&requestedTarget!==null){
      const targetId=text(requestedTarget);if(!targetId)throw new Error('本次整理的目标计划无效，请重新整理计划。');
      const matched=array(facts.plans).find(plan=>plan.id===targetId);if(!matched)throw new Error('本次整理的目标计划不属于当前正式计划，请重新整理计划。');
      targetPlan={id:matched.id,planVersion:matched.planVersion,snapshotHash:matched.snapshotHash};targetLabel=text(matched.displayLabel);
    }
    const hashInput={id,version,protectedFactsHash:facts.hash};if(targetPlan)hashInput.targetPlan=targetPlan;
    const hash=`plandraftsession_${DiscussionWorkbench.hash(hashInput)}`;
    return {id,version,hash,protectedFactsHash:facts.hash,createdAt,targetPlan,targetLabel};
  }
  function sessionBinding(session){return {draftSessionId:session.id,draftSessionVersion:session.version,draftSessionHash:session.hash}}
  function promptPlanSummary(plan){
    const conditions=CONDITION_FIELDS.flatMap(key=>array(plan.conditions&&plan.conditions[key])).filter(Boolean),trigger=plan.triggerPrice===null?'无明确价格，仅按条件':`${plan.triggerDirection==='above'?'达到或高于':'达到或低于'} ${plan.triggerPrice}`,conditionText=conditions.length?conditions.slice(0,3).join('；'):'无额外条件';
    return `${trigger}；${conditionText}${plan.quantity!==null?`；数量 ${plan.quantity}`:''}`;
  }
  function promptPlanSection(plans){
    if(!plans.length)return '### 当前正式计划\n\n无。';
    return ['### 当前正式计划','',...plans.flatMap((plan,index)=>[`#### 计划 ${String.fromCharCode(65+index)} — ${plan.displayLabel}`,`- direction: ${plan.action}`,`- 摘要: ${promptPlanSummary(plan)}`,`- targetPlan: ${JSON.stringify({id:plan.id,planVersion:plan.planVersion,snapshotHash:plan.snapshotHash})}`,''])].join('\n').trimEnd();
  }
  function prepare(stock,options={}){
    const facts=protectedFacts(stock),optional=currentStateContext(stock),session=createDraftSession(facts,options),binding={...sessionBinding(session),...object(optional.provenance)},context={symbol:facts.symbol,name:text(stock&&stock.name),holding:clone(facts.holding),plans:clone(facts.plans),planDraftSession:{id:session.id,version:session.version,hash:session.hash,targetPlan:clone(session.targetPlan)}};
    if(optional.context)context.currentState=clone(optional.context);
    const schema={schemaVersion:SCHEMA_VERSION,operation:'create | update | no_change | invalidate | complete',symbol:facts.symbol,...sessionBinding(session),targetPlan:clone(session.targetPlan),plan:null,reason:'',risks:[],unresolvedItems:[]};
    if(optional.provenance)Object.assign(schema,optional.provenance);
    const planShape={action:'buy | add | reduce | sell',triggerPrice:null,triggerDirection:null,quantity:null,conditions:{technical:[],fundamental:[],catalyst:[],allocation:[],market:[],other:[]},invalidationConditions:[],allocationConstraint:{maxPositionPct:null,targetWeightRange:null},validUntil:null,nextReviewDate:null,note:''};
    const targetShape={id:'精确复制计划 ID',planVersion:1,snapshotHash:'精确复制 snapshotHash'};
    const request=[
      '请继续在当前 AI 对话中使用。请根据当前这个 AI 对话中已经形成的讨论结论，整理计划草案。不要重新做完整分析。',
      '程序提供的持仓和现有正式计划仅用于事实绑定。不要重新分析，也不要创造本对话中没有明确形成的价格、数量、仓位、条件或日期。',
      optional.context?'程序中已有当前结论，可作为辅助参考。':'程序中没有已保存的当前结论，这不是错误，也不影响整理计划。',
      '只输出本轮 AI 对话中明确讨论并形成结论的一个计划。没有被本轮讨论涉及的既有计划不得输出，程序会自动保持其原状态。',
      '本 V1 信封一次只表示一个计划操作；如果本轮明确讨论了多个计划，请分别整理，不要合并成批量结果。',
      '对已有计划：内容相同使用 no_change，实质变化使用 update，明确取消使用 invalidate，已经完成使用 complete；这四种 operation 都必须精确复制对应计划的 targetPlan id、planVersion、snapshotHash，不得省略、修改或猜测。',
      '如果本轮对话已经针对某个具体既有计划作出判断，即使结论是“不修改”，也不能返回 targetPlan:null；必须返回 no_change 并精确复制该计划的 targetPlan。',
      '同一业务计划发生变化必须使用 update，不能用 create 逃避绑定。create 仅用于本轮明确建立的全新独立计划，例如新增一个不同档位；它的 targetPlan 必须为 null，且不会替换其他计划。',
      '不得按列表第一项、最近价格、触发价高低、方向或最新 AI 输出猜测 targetPlan。只有用户最终确认后，草案才会成为正式计划。',
      session.targetPlan?`本次 Plan Draft Session 已由程序明确限定为“${session.targetLabel}”，只允许对这个既有计划使用 no_change、update、invalidate 或 complete，targetPlan 必须精确等于 ${JSON.stringify(session.targetPlan)}；即使结论是不修改，也不得返回 targetPlan:null，也不得使用 create。`:'本次 Plan Draft Session 未由程序预选具体计划。只有当前对话完全没有形成任何需要保存的具体计划结论时，才可使用 no_change、targetPlan 为 null，并在 reason 说明“当前对话未形成需要保存的具体计划结论”。',
      'no_change、targetPlan 为 null 只表示“本轮未形成需要保存的具体计划结论”；它不表示任何既有计划已被复核、继续有效、保持不变或得到重新确认。',
      '计划可以只使用明确的结构或技术条件而不填触发价；没有明确依据时 triggerPrice、quantity 或配置字段必须为 null，不得补造。',
      'create / update 时 plan 必须使用完整结构；其余 operation 的 plan 必须为 null。所有条件初始都只是待确认，JSON 草案本身不会执行交易。',
      '如必要信息仍未解决，将项目写入 unresolvedItems；程序会允许预览但禁止保存不完整计划。',
      '只输出唯一一个完整的 ```json 代码块；代码块外不得有任何文字。代码块内必须是一个完整严格 JSON 对象，不得附加解释或额外包装。',
      '',
      promptPlanSection(facts.plans),
      '',
      '程序权威上下文：',JSON.stringify(context,null,2),
      '',
      '严格输出信封：',JSON.stringify(schema,null,2),
      '',
      'create / update 时 plan 结构：',JSON.stringify(planShape,null,2),
      '',
      'no_change / update / invalidate / complete 针对已有计划时 targetPlan 结构：',JSON.stringify(targetShape,null,2)
    ].join('\n');
    return {request,context,binding,session:clone(session),protectedFacts:clone(facts.snapshot),protectedFactsHash:facts.hash,symbol:facts.symbol,sourceState:clone(optional.current),provenance:clone(optional.provenance),plans:clone(facts.plans),hasCurrentState:Boolean(optional.context),metrics:DiscussionWorkbench.requestMetrics(request)};
  }
  function directionGroup(action){return ['buy','add'].includes(action)?'increase':['reduce','sell'].includes(action)?'decrease':''}
  function findCurrentPlan(stock,target){
    const id=text(target&&target.id);return activePlans(stock).find(plan=>plan.id===id)||null;
  }
  function normalizeDraftPlan(source,errors){
    if(!exactFields(source,PLAN_FIELDS,'plan',errors))return null;
    const raw=object(source),action=text(raw.action),triggerPrice=raw.triggerPrice===null?null:positive(raw.triggerPrice),triggerDirection=raw.triggerDirection===null?null:text(raw.triggerDirection),quantity=raw.quantity===null?null:positive(raw.quantity),conditionsSource=object(raw.conditions),allocationSource=object(raw.allocationConstraint);
    if(!PLAN_ACTIONS.includes(action))errors.push('plan.action 为未知固定值');
    if(raw.triggerPrice!==null&&triggerPrice===null)errors.push('triggerPrice 必须是正数或 null');
    if(![null,'above','below'].includes(triggerDirection))errors.push('triggerDirection 必须是 above、below 或 null');
    if((triggerPrice===null)!==(triggerDirection===null))errors.push('触发价格与触发方向必须同时提供或同时为 null');
    if(raw.quantity!==null&&(!Number.isInteger(quantity)||quantity<=0))errors.push('quantity 必须是正整数或 null');
    exactFields(raw.conditions,CONDITION_FIELDS,'plan.conditions',errors);
    const conditions={};CONDITION_FIELDS.forEach(key=>{conditions[key]=stringList(conditionsSource[key],`conditions.${key}`,errors,{limit:8,itemLimit:200})});
    const invalidationConditions=stringList(raw.invalidationConditions,'invalidationConditions',errors,{limit:8,itemLimit:200});
    exactFields(raw.allocationConstraint,ALLOCATION_FIELDS,'allocationConstraint',errors);
    const maxPositionPct=allocationSource.maxPositionPct===null?null:positive(allocationSource.maxPositionPct),targetWeightRange=allocationSource.targetWeightRange===null?null:text(allocationSource.targetWeightRange);
    if(allocationSource.maxPositionPct!==null&&(maxPositionPct===null||maxPositionPct>100))errors.push('maxPositionPct 必须是 0 至 100 之间的正数或 null');
    if(allocationSource.targetWeightRange!==null&&(!targetWeightRange||targetWeightRange.length>80))errors.push('targetWeightRange 必须是 1 至 80 字文字或 null');
    const validUntil=raw.validUntil===null?null:dateOnly(raw.validUntil),nextReviewDate=raw.nextReviewDate===null?null:dateOnly(raw.nextReviewDate),note=text(raw.note);
    if(raw.validUntil!==null&&!validUntil)errors.push('validUntil 必须是 YYYY-MM-DD 或 null');
    if(raw.nextReviewDate!==null&&!nextReviewDate)errors.push('nextReviewDate 必须是 YYYY-MM-DD 或 null');
    if(!note||note.length>300)errors.push('note 必须是 1 至 300 字文字');
    return {action,triggerPrice,triggerDirection,quantity,conditions,invalidationConditions,allocationConstraint:{maxPositionPct,targetWeightRange},validUntil,nextReviewDate,note};
  }
  function planPatch(plan){return {action:plan.action,triggerPrice:plan.triggerPrice,triggerDirection:plan.triggerDirection,quantity:plan.quantity,conditions:{...clone(plan.conditions),invalidation:clone(plan.invalidationConditions)},allocationConstraint:clone(plan.allocationConstraint),validUntil:plan.validUntil,nextReviewDate:plan.nextReviewDate,fullConditionStatus:'unproven',note:plan.note}}
  function protectedCap(stock){const values=[stock&&stock.capPct,stock&&stock.strategy&&stock.strategy.maxWeight].map(Number).filter(value=>Number.isFinite(value)&&value>0);return values.length?Math.min(...values):null}
  function semanticCompleteness(plan,stock,errors){
    const conditionCount=CONDITION_FIELDS.reduce((sum,key)=>sum+array(plan.conditions[key]).length,0);
    if(plan.triggerPrice===null&&!conditionCount)errors.push('计划缺少明确触发价或条件');
    if(!plan.invalidationConditions.length)errors.push('计划缺少明确失效条件');
    if(['buy','add'].includes(plan.action)&&!PlanV2.hasAllocationPremise(planPatch(plan)))errors.push('加仓或建仓计划缺少已确认的配置约束');
    const shares=Math.max(0,Number(stock&&stock.shares)||0);if(['reduce','sell'].includes(plan.action)&&plan.quantity!==null&&plan.quantity>shares)errors.push('减仓数量超过当前持仓');
    const unit=minTradeUnit(stock);if(plan.quantity!==null&&unit&&plan.quantity%unit!==0)errors.push(`数量不符合最小交易单位 ${unit}`);
    const cap=protectedCap(stock);if(cap&&plan.allocationConstraint.maxPositionPct!==null&&plan.allocationConstraint.maxPositionPct>cap)errors.push('计划配置上限超过程序当前保护上限');
  }
  function process(raw,options={}){
    const parsed=StrictAiJson.parseStrictAiJson(raw);if(!parsed.ok)return {ok:false,previewReady:false,confirmReady:false,writes:0,code:'parse_error',message:parsed.userMessage||'AI JSON 无法安全解析。',errors:[parsed.userMessage||'AI JSON 无法安全解析。'],input:parsed.input,diagnostics:parsed.diagnostics};
    const draft=object(parsed.value),errors=[],stock=options.stock,prepared=options.prepared;
    if(!prepared||!prepared.session)errors.push('当前没有可验证的计划上下文，请重新整理计划。');
    let liveFacts=null;try{liveFacts=protectedFacts(stock)}catch(error){errors.push(error&&error.message?error.message:'当前计划基础信息不足，请先补齐相关数据。')}
    if(prepared&&prepared.session&&liveFacts&&prepared.session.protectedFactsHash!==liveFacts.hash)errors.push('当前计划或持仓状态已发生变化，请重新整理计划。');
    exactFields(parsed.value,TOP_FIELDS,'Plan Draft',errors,REQUIRED_TOP_FIELDS);
    const operation=text(draft.operation),symbol=canonical(draft.symbol),reason=text(draft.reason),risks=stringList(draft.risks,'risks',errors,{limit:8,itemLimit:200}),unresolvedItems=stringList(draft.unresolvedItems,'unresolvedItems',errors,{limit:8,itemLimit:200});
    if(draft.schemaVersion!==SCHEMA_VERSION)errors.push(`schemaVersion 必须是 ${SCHEMA_VERSION}`);
    if(!OPERATIONS.includes(operation))errors.push('operation 为未知固定值');
    if(!symbol||!prepared||symbol!==prepared.symbol)errors.push('symbol 与当前标的不一致');
    const hasSession=text(draft.draftSessionId)&&Number.isInteger(Number(draft.draftSessionVersion))&&text(draft.draftSessionHash);
    if(!hasSession)errors.push('当前没有可验证的计划上下文，请重新整理计划。');
    else if(!prepared||text(draft.draftSessionId)!==prepared.session.id||Number(draft.draftSessionVersion)!==prepared.session.version||text(draft.draftSessionHash)!==prepared.session.hash)errors.push('计划上下文无法验证，请重新整理计划。');
    const provenance=object(prepared&&prepared.provenance),providedStateId=text(draft.currentStateId||draft.sourceStateId),providedStateHash=text(draft.currentStateHash||draft.sourceStateHash),providedDiscussionVersion=text(draft.sourceDiscussionVersion);
    if(text(draft.currentStateId)&&text(draft.sourceStateId)&&text(draft.currentStateId)!==text(draft.sourceStateId))errors.push('可选当前结论来源标识不一致');
    if(text(draft.currentStateHash)&&text(draft.sourceStateHash)&&text(draft.currentStateHash)!==text(draft.sourceStateHash))errors.push('可选当前结论来源哈希不一致');
    if((providedDiscussionVersion||providedStateId||providedStateHash)&&(!provenance.currentStateId||providedDiscussionVersion&&providedDiscussionVersion!==provenance.sourceDiscussionVersion||providedStateId&&providedStateId!==provenance.currentStateId||providedStateHash&&providedStateHash!==provenance.currentStateHash))errors.push('可选当前结论来源与准备时上下文不一致');
    if(!reason||reason.length>300)errors.push('reason 必须是 1 至 300 字文字');
    let target=null,currentPlan=null,targetLabel='';
    if(draft.targetPlan!==null){
      if(exactFields(draft.targetPlan,TARGET_FIELDS,'targetPlan',errors)){
        target={id:text(draft.targetPlan.id),planVersion:Number(draft.targetPlan.planVersion),snapshotHash:text(draft.targetPlan.snapshotHash)};
        if(!target.id||!Number.isInteger(target.planVersion)||target.planVersion<1||!target.snapshotHash)errors.push('targetPlan 绑定无效');
        const sessionPlan=array(prepared&&prepared.plans).find(plan=>plan.id===target.id&&plan.planVersion===target.planVersion&&plan.snapshotHash===target.snapshotHash);
        if(!sessionPlan)errors.push('targetPlan 不属于本次 Plan Draft Session，请重新整理计划');else targetLabel=text(sessionPlan.displayLabel);
        currentPlan=findCurrentPlan(stock,target);
        if(!currentPlan||currentPlan.planVersion!==target.planVersion||planSnapshotHash(currentPlan)!==target.snapshotHash)errors.push('当前计划已发生变化，请重新整理计划');
      }
    }
    const scopedTarget=object(prepared&&prepared.session&&prepared.session.targetPlan),scopedOperation=['no_change','update','invalidate','complete'].includes(operation);
    if(operation==='no_change'&&scopedTarget.id&&!target)errors.push('本次 Plan Draft Session 已明确针对一个计划，no_change 必须精确绑定 targetPlan');
    if(scopedOperation&&scopedTarget.id&&target&&(target.id!==scopedTarget.id||target.planVersion!==scopedTarget.planVersion||target.snapshotHash!==scopedTarget.snapshotHash))errors.push('targetPlan 与本次 Plan Draft Session 明确绑定的目标计划不一致');
    if(['update','invalidate','complete'].includes(operation)&&!target)errors.push(`${operation} 必须精确绑定当前计划`);
    if(operation==='create'&&draft.targetPlan!==null)errors.push('create 的 targetPlan 必须为 null');
    if(operation==='create'&&scopedTarget.id)errors.push('本次 Plan Draft Session 已明确针对既有计划，不能使用 create');
    let plan=null;if(draft.plan!==null)plan=normalizeDraftPlan(draft.plan,errors);
    if(['create','update'].includes(operation)&&!plan)errors.push(`${operation} 必须提供完整 plan`);
    if(!['create','update'].includes(operation)&&draft.plan!==null)errors.push(`${operation} 的 plan 必须为 null`);
    if(plan){
      semanticCompleteness(plan,stock,errors);
      const shares=Math.max(0,Number(stock&&stock.shares)||0),group=directionGroup(plan.action);
      if(shares>0&&plan.action==='buy')errors.push('当前已有持仓，不能创建建仓计划');
      if(shares<=0&&plan.action!=='buy')errors.push('当前为零持仓，只能整理建仓计划');
      if(operation==='update'&&currentPlan&&directionGroup(currentPlan.action)!==group)errors.push('更新草案不能改变既有计划方向');
      if(operation==='update'&&currentPlan&&PlanV2.stable(PlanV2.authoritativeContent?PlanV2.authoritativeContent(currentPlan):planPatchFromCanonical(currentPlan))===PlanV2.stable(planPatch(plan)))errors.push('计划没有实际变化，请使用 no_change');
    }
    const normalized={schemaVersion:SCHEMA_VERSION,operation,symbol,draftSessionId:text(draft.draftSessionId),draftSessionVersion:Number(draft.draftSessionVersion),draftSessionHash:text(draft.draftSessionHash),targetPlan:target,plan,reason,risks,unresolvedItems};
    if(providedDiscussionVersion)normalized.sourceDiscussionVersion=providedDiscussionVersion;
    if(providedStateId)normalized.currentStateId=providedStateId;
    if(providedStateHash)normalized.currentStateHash=providedStateHash;
    if(errors.length)return {ok:false,previewReady:false,confirmReady:false,writes:0,code:'validation_error',message:errors.join('；'),errors,draft:normalized,prepared};
    const noWrite=operation==='no_change',noPlanResult=noWrite&&!target,confirmReady=!noWrite&&!unresolvedItems.length,unaffectedPlanCount=noPlanResult?0:Math.max(0,activePlans(stock).length-(target?1:0));
    return {ok:true,previewReady:true,confirmReady,writes:0,code:noWrite?'no_change':(confirmReady?'ready':'incomplete'),message:noWrite?(target?'该计划与当前正式版本一致，无需修改。':'本轮未形成需要保存的具体计划结论。'):(confirmReady?'计划草案已通过校验，请预览后确认。':'计划信息尚不完整'),errors:[],draft:normalized,prepared,currentPlan:currentPlan?PlanV2.normalizePlan(currentPlan):null,targetLabel,unaffectedPlanCount,noPlanResult};
  }
  function planPatchFromCanonical(plan){const p=PlanV2.normalizePlan(plan),conditions={};CONDITION_FIELDS.forEach(key=>{conditions[key]=array(p.conditions[key]).map(item=>item.text)});return planPatch({action:p.action,triggerPrice:p.triggerPrice,triggerDirection:p.triggerDirection,quantity:p.quantity,conditions,invalidationConditions:array(p.conditions.invalidation).map(item=>item.text),allocationConstraint:p.allocationConstraint,validUntil:p.validUntil,nextReviewDate:p.nextReviewDate,note:p.note})}
  function diff(current,plan){
    if(!current||!plan)return [];
    const before=planPatchFromCanonical(current),after=planPatch(plan),labels={action:'方向',triggerPrice:'触发价',triggerDirection:'触发方向',quantity:'数量',conditions:'条件',allocationConstraint:'配置约束',validUntil:'有效期',nextReviewDate:'下次复核',note:'说明'};
    return Object.keys(labels).filter(key=>PlanV2.stable(before[key])!==PlanV2.stable(after[key])).map(key=>({field:key,label:labels[key],before:clone(before[key]),after:clone(after[key])}));
  }
  function renderPlanSummary(plan){
    if(!plan)return '<div class="card-note">无计划内容</div>';
    const action={buy:'建仓',add:'加仓',reduce:'减仓',sell:'减仓'}[plan.action]||plan.action,conditions=CONDITION_FIELDS.flatMap(key=>array(plan.conditions&&plan.conditions[key])).filter(Boolean),trigger=plan.triggerPrice===null?'仅按明确条件':`${plan.triggerDirection==='above'?'价格达到或高于':'价格达到或低于'} ${plan.triggerPrice}`,allocation=object(plan.allocationConstraint),hasAllocation=allocation.maxPositionPct!==null&&allocation.maxPositionPct!==undefined||Boolean(text(allocation.targetWeightRange));
    return `<div class="discussion-plan-summary"><div><b>方向</b><span>${escapeHtml(action)}</span></div><div><b>触发 / 条件</b><span>${escapeHtml(trigger)}${conditions.length?`；${escapeHtml(conditions.join('；'))}`:''}</span></div><div><b>失效条件</b><span>${escapeHtml(array(plan.invalidationConditions).join('；')||'未提供')}</span></div>${plan.quantity!==null?`<div><b>数量</b><span>${escapeHtml(plan.quantity)}</span></div>`:''}${hasAllocation?`<div><b>配置</b><span>${escapeHtml(allocation.maxPositionPct!==null&&allocation.maxPositionPct!==undefined?`上限 ${allocation.maxPositionPct}%`:allocation.targetWeightRange)}</span></div>`:''}<div><b>说明</b><span>${escapeHtml(plan.note)}</span></div></div>`;
  }
  function previewValue(value){
    if(value===null||value===undefined||value==='')return '未设置';
    if(Array.isArray(value))return value.map(item=>text(item&&item.text||item)).filter(Boolean).join('；')||'未设置';
    if(typeof value==='object'){const source=object(value);if(Object.prototype.hasOwnProperty.call(source,'maxPositionPct')||Object.prototype.hasOwnProperty.call(source,'targetWeightRange'))return [source.maxPositionPct!==null&&source.maxPositionPct!==undefined?`上限 ${source.maxPositionPct}%`:'',text(source.targetWeightRange)].filter(Boolean).join('；')||'未设置';return Object.values(source).map(previewValue).filter(item=>item&&item!=='未设置').join('；')||'未设置'}
    return String(value);
  }
  function renderPreview(result){
    if(!result||!result.ok)return `<div class="alert"><b>计划草案未通过</b><div>${escapeHtml(result&&result.message||'未知错误')}</div><div>未写入任何数据。</div></div>`;
    const draft=result.draft,noPlanResult=draft.operation==='no_change'&&!draft.targetPlan,label=noPlanResult?'未形成具体计划结论':(OPERATION_LABELS[draft.operation]||draft.operation),targetLabel=result.targetLabel||draft.targetPlan&&draft.targetPlan.id||'',target=targetLabel?`<section><h4>目标计划</h4><div class="discussion-plan-target"><strong>${escapeHtml(targetLabel)}</strong></div></section>`:'',unaffected=result.unaffectedPlanCount>0?`<div class="card-note">其他 ${result.unaffectedPlanCount} 个当前计划不受影响；本次未重新确认它们。</div>`:'';
    if(draft.operation==='no_change')return `<section class="discussion-plan-preview"><h3>${escapeHtml(label)}</h3>${target}<div class="hint">${escapeHtml(draft.targetPlan?'该计划与当前正式版本一致，无需修改。':'本轮未形成需要保存的具体计划结论。')}</div>${draft.targetPlan?`<p>${escapeHtml(draft.reason)}</p>`:''}${unaffected}<div class="card-note">${escapeHtml(draft.targetPlan?'不会创建计划版本，也不会修改任何数据。':'不会修改、重新确认或更新任何计划及其元数据。')}</div></section>`;
    const current=result.currentPlan?`<section><h4>当前正式内容</h4>${renderPlanSummary(planPatchFromCanonical(result.currentPlan))}</section>`:'',next=draft.plan?`<section><h4>本次结果 · ${draft.operation==='create'?'新增独立计划':'修改后的计划'}</h4>${renderPlanSummary(draft.plan)}</section>`:'',changes=draft.operation==='update'?diff(result.currentPlan,draft.plan):[];
    const changeHtml=changes.length?`<div class="discussion-plan-diff"><b>主要变化</b><ul>${changes.map(item=>`<li><b>${escapeHtml(item.label)}</b><div>原：${escapeHtml(previewValue(item.before))}</div><div>新：${escapeHtml(previewValue(item.after))}</div></li>`).join('')}</ul></div>`:'';
    const unresolved=draft.unresolvedItems.length?`<div class="alert"><b>计划信息尚不完整</b><ul>${draft.unresolvedItems.map(item=>`<li>${escapeHtml(item)}</li>`).join('')}</ul></div>`:'';
    const lifecycle=!draft.plan?`<section><h4>本次结果</h4><div class="discussion-plan-summary"><div><b>状态</b><span>${escapeHtml(label)}</span></div><div><b>原因</b><span>${escapeHtml(draft.reason)}</span></div></div></section>`:'',replacement=draft.operation==='update'?`<div class="card-note">确认后，新计划将替代 ${escapeHtml(targetLabel||'目标计划')}；旧计划保留为“已替换”的历史记录。</div>`:'';
    return `<section class="discussion-plan-preview"><h3>${escapeHtml(label)}</h3>${target}${current}${next}${lifecycle}${changeHtml}${replacement}${unaffected}${draft.risks.length?`<div class="alert">风险 / 提醒：${escapeHtml(draft.risks.join('；'))}</div>`:''}${unresolved}<div class="card-note">当前仅为预览；确认前不会写入计划，也不会执行交易或改变持仓。</div></section>`;
  }
  function findStock(state,symbol){return array(state&&state.stocks).find(stock=>canonical(stock&&(stock.code||stock.symbol))===canonical(symbol))||null}
  async function commit(result,state,deps={},options={}){
    if(!result||!result.ok||!result.previewReady)return {status:'invalid',writes:0,error:new Error('必须先完成有效预览。')};
    if(result.draft.operation==='no_change')return {status:'no_change',writes:0,state};
    if(!result.confirmReady)return {status:'incomplete',writes:0,error:new Error('计划信息尚不完整。')};
    const currentStock=findStock(state,result.draft.symbol);if(!currentStock)return {status:'invalid',writes:0,error:new Error('找不到计划标的。')};
    let fresh;try{fresh=process(JSON.stringify(result.draft),{stock:currentStock,prepared:result.prepared})}catch(error){return {status:'invalid',writes:0,error}}
    if(!fresh.ok||!fresh.confirmReady)return {status:'stale',writes:0,error:new Error(fresh.message||'当前上下文已变化。')};
    const operation=fresh.draft.operation,draft=fresh.draft;
    return PlanV2.commitCandidate(state,candidate=>{
      const stock=findStock(candidate,draft.symbol);if(!stock)throw new Error('找不到计划标的。');const plans=array(stock.plans).map(plan=>PlanV2.normalizePlan(plan));
      const source={draftSessionId:draft.draftSessionId,draftSessionVersion:draft.draftSessionVersion,draftSessionHash:draft.draftSessionHash,operation};if(draft.sourceDiscussionVersion)source.sourceDiscussionVersion=draft.sourceDiscussionVersion;if(draft.currentStateId)source.currentStateId=draft.currentStateId;if(draft.currentStateHash)source.currentStateHash=draft.currentStateHash;
      if(operation==='create'){
        const created=PlanV2.createPlan(planPatch(draft.plan),{now:options.now,source:'ai_refresh'});created.legacy={...object(created.legacy),discussionPlanSource:source};plans.push(created);
      }else{
        const index=plans.findIndex(plan=>plan.id===draft.targetPlan.id);if(index<0)throw new Error('当前计划已发生变化，请重新整理计划');const current=plans[index];
        if(current.planVersion!==draft.targetPlan.planVersion||planSnapshotHash(current)!==draft.targetPlan.snapshotHash)throw new Error('当前计划已发生变化，请重新整理计划');
        if(operation==='update'){
          plans[index]=PlanV2.terminatePlan(current,'replaced',{now:options.now,reason:'由用户确认的讨论计划草案替换'});
          const created=PlanV2.createPlan(planPatch(draft.plan),{now:options.now,source:'ai_refresh'});created.legacy={...object(created.legacy),discussionPlanSource:{...source,replacesPlanId:current.id,replacesPlanVersion:current.planVersion}};plans.push(created);
        }else if(operation==='invalidate')plans[index]=PlanV2.terminatePlan(current,'cancelled',{now:options.now,reason:draft.reason});
        else if(operation==='complete')plans[index]=PlanV2.terminatePlan(current,'completed',{now:options.now,reason:draft.reason});
      }
      stock.plans=plans;stock.updatedAt=Date.now();return candidate;
    },{save:deps.saveCandidate,adopt:deps.adoptCandidate,rollback:deps.rollback});
  }

  return Object.freeze({SCHEMA_VERSION,OPERATIONS,PLAN_ACTIONS,OPERATION_LABELS,TOP_FIELDS,REQUIRED_TOP_FIELDS,TARGET_FIELDS,PLAN_FIELDS,CONDITION_FIELDS,prepare,process,diff,renderPreview,commit,discussionBinding,currentStateContext,protectedFacts,createDraftSession,sessionBinding,planSnapshotHash,activePlans,compactPlan,planDisplayEntries,planLabelBase,planPatch,planPatchFromCanonical,minTradeUnit,clone});
});
