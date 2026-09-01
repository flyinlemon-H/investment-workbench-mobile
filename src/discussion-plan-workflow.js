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
  const TOP_FIELDS=Object.freeze(['schemaVersion','operation','symbol','sourceDiscussionVersion','sourceStateId','sourceStateHash','targetPlan','plan','reason','risks','unresolvedItems']);
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

  function exactFields(source,allowed,label,errors){
    if(!source||typeof source!=='object'||Array.isArray(source)){errors.push(`${label} 必须是对象`);return false}
    const keys=Object.keys(source),extra=keys.filter(key=>!allowed.includes(key)),missing=allowed.filter(key=>!Object.prototype.hasOwnProperty.call(source,key));
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
  function activePlans(stock){return array(stock&&stock.plans).map(plan=>PlanV2.normalizePlan(plan)).filter(plan=>plan.status==='active'&&['active','needs_review'].includes(plan.validityStatus))}
  function compactPlan(plan){
    const normalized=PlanV2.normalizePlan(plan),conditions={};
    CONDITION_FIELDS.forEach(category=>{conditions[category]=array(normalized.conditions&&normalized.conditions[category]).map(item=>item.text).filter(Boolean)});
    return {id:normalized.id,planVersion:normalized.planVersion,snapshotHash:planSnapshotHash(normalized),action:normalized.action,triggerPrice:normalized.triggerPrice,triggerDirection:normalized.triggerDirection,quantity:normalized.quantity,conditions,invalidationConditions:array(normalized.conditions&&normalized.conditions.invalidation).map(item=>item.text).filter(Boolean),allocationConstraint:clone(normalized.allocationConstraint),validUntil:normalized.validUntil,nextReviewDate:normalized.nextReviewDate,note:normalized.note,status:normalized.status,validityStatus:normalized.validityStatus};
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
  function prepare(stock){
    const store=DiscussionWorkbench.normalizeStore(stock&&stock.discussionState),current=store.current;
    if(!current||current.schemaVersion!==DiscussionWorkbench.STATE_SCHEMA_VERSION)throw new Error('请先导入并确认本轮讨论结论，再整理计划。');
    if(!current.stateId||!current.sourceDiscussionVersion)throw new Error('当前讨论结论缺少安全绑定，请重新整理并导入结论。');
    const binding=discussionBinding(current),symbol=canonical(stock&&(stock.code||stock.symbol)),shares=Math.max(0,Number(stock&&stock.shares)||0),plans=activePlans(stock).map(compactPlan),currentState=compactCurrentState(current);
    const context={symbol,name:text(stock&&stock.name),holding:{status:shares>0?'held':'zero_position',shares},discussion:currentState,plans,binding};
    const schema={schemaVersion:SCHEMA_VERSION,operation:'create | update | no_change | invalidate | complete',symbol,sourceDiscussionVersion:binding.sourceDiscussionVersion,sourceStateId:binding.sourceStateId,sourceStateHash:binding.sourceStateHash,targetPlan:null,plan:null,reason:'',risks:[],unresolvedItems:[]};
    const planShape={action:'buy | add | reduce | sell',triggerPrice:null,triggerDirection:null,quantity:null,conditions:{technical:[],fundamental:[],catalyst:[],allocation:[],market:[],other:[]},invalidationConditions:[],allocationConstraint:{maxPositionPct:null,targetWeightRange:null},validUntil:null,nextReviewDate:null,note:''};
    const targetShape={id:'精确复制计划 ID',planVersion:1,snapshotHash:'精确复制 snapshotHash'};
    const request=[
      '请继续使用刚才这个 AI 对话中已经完成的股票讨论，不要重新做完整分析。',
      '只把本轮讨论中实际达成的正式计划结论整理为严格 JSON；不要发明价格、数量、仓位、条件或日期。',
      '如果既有计划保持合适，operation 使用 no_change；如果本轮没有形成足够完整的正式计划，也使用 no_change，并在 reason 说明“本轮未形成正式计划”。',
      'create 仅用于没有同方向当前计划且讨论明确形成新计划；update / invalidate / complete 必须精确引用下方某个 targetPlan 的 id、planVersion、snapshotHash。',
      '计划可以只使用明确的结构或技术条件而不填触发价；没有明确依据时 triggerPrice、quantity 或配置字段必须为 null，不得补造。',
      'create / update 时 plan 必须使用完整结构；其余 operation 的 plan 必须为 null。所有条件初始都只是待确认，JSON 草案本身不会执行交易。',
      '如必要信息仍未解决，将项目写入 unresolvedItems；程序会允许预览但禁止保存不完整计划。',
      '只输出一个 JSON 对象，不要 Markdown、代码围栏、解释或额外包装。',
      '',
      '程序权威上下文：',JSON.stringify(context,null,2),
      '',
      '严格输出信封：',JSON.stringify(schema,null,2),
      '',
      'create / update 时 plan 结构：',JSON.stringify(planShape,null,2),
      '',
      'update / invalidate / complete 时 targetPlan 结构：',JSON.stringify(targetShape,null,2)
    ].join('\n');
    return {request,context,binding,symbol,sourceState:clone(current),plans:clone(plans),metrics:DiscussionWorkbench.requestMetrics(request)};
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
    const parsed=StrictAiJson.parseStrictAiJson(raw);if(!parsed.ok)return {ok:false,previewReady:false,confirmReady:false,writes:0,code:'parse_error',message:parsed.userMessage||'AI JSON 无法安全解析。',errors:[parsed.userMessage||'AI JSON 无法安全解析。']};
    const draft=object(parsed.value),errors=[],stock=options.stock,prepared=options.prepared||prepare(stock);let livePrepared=null;
    try{livePrepared=prepare(stock)}catch(error){errors.push(error&&error.message?error.message:'当前讨论结论不可用')}
    if(livePrepared&&(prepared.binding.sourceDiscussionVersion!==livePrepared.binding.sourceDiscussionVersion||prepared.binding.sourceStateId!==livePrepared.binding.sourceStateId||prepared.binding.sourceStateHash!==livePrepared.binding.sourceStateHash))errors.push('讨论结论已发生变化，请重新整理计划');
    exactFields(parsed.value,TOP_FIELDS,'Plan Draft',errors);
    const operation=text(draft.operation),symbol=canonical(draft.symbol),reason=text(draft.reason),risks=stringList(draft.risks,'risks',errors,{limit:8,itemLimit:200}),unresolvedItems=stringList(draft.unresolvedItems,'unresolvedItems',errors,{limit:8,itemLimit:200});
    if(draft.schemaVersion!==SCHEMA_VERSION)errors.push(`schemaVersion 必须是 ${SCHEMA_VERSION}`);
    if(!OPERATIONS.includes(operation))errors.push('operation 为未知固定值');
    if(!symbol||symbol!==prepared.symbol)errors.push('symbol 与当前标的不一致');
    if(text(draft.sourceDiscussionVersion)!==prepared.binding.sourceDiscussionVersion||text(draft.sourceStateId)!==prepared.binding.sourceStateId||text(draft.sourceStateHash)!==prepared.binding.sourceStateHash)errors.push('讨论结论已发生变化，请重新整理计划');
    if(!reason||reason.length>300)errors.push('reason 必须是 1 至 300 字文字');
    let target=null,currentPlan=null;
    if(draft.targetPlan!==null){
      if(exactFields(draft.targetPlan,TARGET_FIELDS,'targetPlan',errors)){
        target={id:text(draft.targetPlan.id),planVersion:Number(draft.targetPlan.planVersion),snapshotHash:text(draft.targetPlan.snapshotHash)};
        if(!target.id||!Number.isInteger(target.planVersion)||target.planVersion<1||!target.snapshotHash)errors.push('targetPlan 绑定无效');
        currentPlan=findCurrentPlan(stock,target);
        if(!currentPlan||currentPlan.planVersion!==target.planVersion||planSnapshotHash(currentPlan)!==target.snapshotHash)errors.push('当前计划已发生变化，请重新整理计划');
      }
    }
    if(['update','invalidate','complete'].includes(operation)&&!target)errors.push(`${operation} 必须精确绑定当前计划`);
    if(operation==='create'&&draft.targetPlan!==null)errors.push('create 的 targetPlan 必须为 null');
    let plan=null;if(draft.plan!==null)plan=normalizeDraftPlan(draft.plan,errors);
    if(['create','update'].includes(operation)&&!plan)errors.push(`${operation} 必须提供完整 plan`);
    if(!['create','update'].includes(operation)&&draft.plan!==null)errors.push(`${operation} 的 plan 必须为 null`);
    if(plan){
      semanticCompleteness(plan,stock,errors);
      const shares=Math.max(0,Number(stock&&stock.shares)||0),group=directionGroup(plan.action);
      if(shares>0&&plan.action==='buy')errors.push('当前已有持仓，不能创建建仓计划');
      if(shares<=0&&plan.action!=='buy')errors.push('当前为零持仓，只能整理建仓计划');
      if(operation==='create'&&activePlans(stock).some(existing=>directionGroup(existing.action)===group))errors.push('已存在同方向当前计划，请使用 update 或 no_change');
      if(operation==='update'&&currentPlan&&directionGroup(currentPlan.action)!==group)errors.push('更新草案不能改变既有计划方向');
      if(operation==='update'&&currentPlan&&PlanV2.stable(PlanV2.authoritativeContent?PlanV2.authoritativeContent(currentPlan):planPatchFromCanonical(currentPlan))===PlanV2.stable(planPatch(plan)))errors.push('计划没有实际变化，请使用 no_change');
    }
    if(draft.targetPlan===null&&operation==='no_change'&&activePlans(stock).length>1&&/既有|当前计划|保持/.test(reason))errors.push('多个当前计划下的 no_change 必须明确绑定 targetPlan');
    const normalized={schemaVersion:SCHEMA_VERSION,operation,symbol,sourceDiscussionVersion:text(draft.sourceDiscussionVersion),sourceStateId:text(draft.sourceStateId),sourceStateHash:text(draft.sourceStateHash),targetPlan:target,plan,reason,risks,unresolvedItems};
    if(errors.length)return {ok:false,previewReady:false,confirmReady:false,writes:0,code:'validation_error',message:errors.join('；'),errors,draft:normalized,prepared};
    const noWrite=operation==='no_change',confirmReady=!noWrite&&!unresolvedItems.length;
    return {ok:true,previewReady:true,confirmReady,writes:0,code:noWrite?'no_change':(confirmReady?'ready':'incomplete'),message:noWrite?'本轮讨论未形成需要保存的计划变更':(confirmReady?'计划草案已通过校验，请预览后确认。':'计划信息尚不完整'),errors:[],draft:normalized,prepared,currentPlan:currentPlan?PlanV2.normalizePlan(currentPlan):null};
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
  function renderPreview(result){
    if(!result||!result.ok)return `<div class="alert"><b>计划草案未通过</b><div>${escapeHtml(result&&result.message||'未知错误')}</div><div>未写入任何数据。</div></div>`;
    const draft=result.draft,label=OPERATION_LABELS[draft.operation]||draft.operation;
    if(draft.operation==='no_change')return `<section class="discussion-plan-preview"><h3>${escapeHtml(label)}</h3><div class="hint">本轮讨论未形成需要保存的计划变更</div><p>${escapeHtml(draft.reason)}</p><div class="card-note">不会创建计划版本，也不会修改任何数据。</div></section>`;
    const current=result.currentPlan?`<section><h4>当前计划</h4>${renderPlanSummary(planPatchFromCanonical(result.currentPlan))}</section>`:'',next=draft.plan?`<section><h4>${draft.operation==='create'?'新计划草案':'新计划草案'}</h4>${renderPlanSummary(draft.plan)}</section>`:'',changes=draft.operation==='update'?diff(result.currentPlan,draft.plan):[];
    const changeHtml=changes.length?`<div class="discussion-plan-diff"><b>主要变化</b><ul>${changes.map(item=>`<li>${escapeHtml(item.label)}</li>`).join('')}</ul></div>`:'';
    const unresolved=draft.unresolvedItems.length?`<div class="alert"><b>计划信息尚不完整</b><ul>${draft.unresolvedItems.map(item=>`<li>${escapeHtml(item)}</li>`).join('')}</ul></div>`:'';
    const lifecycle=!draft.plan?`<div class="discussion-plan-summary"><div><b>目标计划</b><span>${escapeHtml(result.currentPlan&&result.currentPlan.note||draft.targetPlan&&draft.targetPlan.id||'—')}</span></div><div><b>原因</b><span>${escapeHtml(draft.reason)}</span></div></div>`:'';
    return `<section class="discussion-plan-preview"><h3>${escapeHtml(label)}</h3>${current}${next}${lifecycle}${changeHtml}${draft.risks.length?`<div class="alert">风险 / 提醒：${escapeHtml(draft.risks.join('；'))}</div>`:''}${unresolved}<div class="card-note">当前仅为预览；确认前不会写入计划，也不会执行交易或改变持仓。</div></section>`;
  }
  function findStock(state,symbol){return array(state&&state.stocks).find(stock=>canonical(stock&&(stock.code||stock.symbol))===canonical(symbol))||null}
  async function commit(result,state,deps={},options={}){
    if(!result||!result.ok||!result.previewReady)return {status:'invalid',writes:0,error:new Error('必须先完成有效预览。')};
    if(result.draft.operation==='no_change')return {status:'no_change',writes:0,state};
    if(!result.confirmReady)return {status:'incomplete',writes:0,error:new Error('计划信息尚不完整。')};
    const currentStock=findStock(state,result.draft.symbol);if(!currentStock)return {status:'invalid',writes:0,error:new Error('找不到计划标的。')};
    let fresh;try{fresh=process(JSON.stringify(result.draft),{stock:currentStock,prepared:prepare(currentStock)})}catch(error){return {status:'invalid',writes:0,error}}
    if(!fresh.ok||!fresh.confirmReady)return {status:'stale',writes:0,error:new Error(fresh.message||'当前上下文已变化。')};
    const operation=fresh.draft.operation,draft=fresh.draft;
    return PlanV2.commitCandidate(state,candidate=>{
      const stock=findStock(candidate,draft.symbol);if(!stock)throw new Error('找不到计划标的。');const plans=array(stock.plans).map(plan=>PlanV2.normalizePlan(plan));
      if(operation==='create'){
        const created=PlanV2.createPlan(planPatch(draft.plan),{now:options.now,source:'ai_refresh'});created.legacy={...object(created.legacy),discussionPlanSource:{sourceDiscussionVersion:draft.sourceDiscussionVersion,sourceStateId:draft.sourceStateId,sourceStateHash:draft.sourceStateHash,operation}};plans.push(created);
      }else{
        const index=plans.findIndex(plan=>plan.id===draft.targetPlan.id);if(index<0)throw new Error('当前计划已发生变化，请重新整理计划');const current=plans[index];
        if(current.planVersion!==draft.targetPlan.planVersion||planSnapshotHash(current)!==draft.targetPlan.snapshotHash)throw new Error('当前计划已发生变化，请重新整理计划');
        if(operation==='update'){
          plans[index]=PlanV2.terminatePlan(current,'replaced',{now:options.now,reason:'由用户确认的讨论计划草案替换'});
          const created=PlanV2.createPlan(planPatch(draft.plan),{now:options.now,source:'ai_refresh'});created.legacy={...object(created.legacy),discussionPlanSource:{sourceDiscussionVersion:draft.sourceDiscussionVersion,sourceStateId:draft.sourceStateId,sourceStateHash:draft.sourceStateHash,operation,replacesPlanId:current.id,replacesPlanVersion:current.planVersion}};plans.push(created);
        }else if(operation==='invalidate')plans[index]=PlanV2.terminatePlan(current,'cancelled',{now:options.now,reason:draft.reason});
        else if(operation==='complete')plans[index]=PlanV2.terminatePlan(current,'completed',{now:options.now,reason:draft.reason});
      }
      stock.plans=plans;stock.updatedAt=Date.now();return candidate;
    },{save:deps.saveCandidate,adopt:deps.adoptCandidate,rollback:deps.rollback});
  }

  return Object.freeze({SCHEMA_VERSION,OPERATIONS,PLAN_ACTIONS,OPERATION_LABELS,TOP_FIELDS,TARGET_FIELDS,PLAN_FIELDS,CONDITION_FIELDS,prepare,process,diff,renderPreview,commit,discussionBinding,planSnapshotHash,activePlans,compactPlan,planPatch,planPatchFromCanonical,minTradeUnit,clone});
});
