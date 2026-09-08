(function(root,factory){const node=typeof module==='object'&&module.exports;const api=factory(node?require('./plan-v2'):root.PlanV2,node?require('./plan-context-contract'):root.PlanContextContract,node?require('./plan-review'):root.PlanReview,node?require('./discussion-v4'):root.DiscussionV4);if(node)module.exports=api;else root.PlanV4=api})(typeof globalThis!=='undefined'?globalThis:this,function(P,C,R,D){
  'use strict';
  const SCHEMA='plan-definitions.v4',HASH_CONTRACT='plan-v4-definition.sha256.v1',INTENTS=['entry','increase','reduce','hold_watch','risk_review'],LIFECYCLES=['active','cancelled','completed','superseded'];
  const clone=C.clone,stable=C.stable,uid=D.uid;
  const exact=(v,keys)=>v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).sort().join(',')===keys.slice().sort().join(',');
  function empty(){return {schemaVersion:SCHEMA,byId:{},receipts:{}}}
  function store(state){return state.planDefinitionsV4||empty()}
  function definitionHash(definition){return 'sha256:'+C.sha256(stable(definition))}
  function validateDefinition(value){
    if(!exact(value,['actionIntent','rules'])||!INTENTS.includes(value.actionIntent)||!value.rules||!['legacy_price','state_watch'].includes(value.rules.planMode))throw new Error('Plan V4 长期定义无效');
    const rules=value.rules;let plan;
    if(rules.planMode==='state_watch'){
      const checked=P.validateWatchDefinition(rules);if(!checked.ok)throw new Error(checked.errors.join('；'));
      const expected={add_review:'increase',reduce_review:'reduce',hold_watch:'hold_watch',risk_control:'risk_review'}[rules.reviewAction];if(value.actionIntent!==expected)throw new Error('观察方向与长期意图不一致');
      plan=P.createWatchPlan(rules,{now:'2000-01-01T00:00:00.000Z'});
    }else{
      if(!exact(rules,['planMode','action','triggerPrice','triggerDirection','quantity','conditions','allocationConstraint','validUntil','nextReviewDate','note']))throw new Error('价格计划定义字段无效');
      const actions={entry:['buy'],increase:['add'],reduce:['sell','reduce'],hold_watch:['observe'],risk_review:['observe']};if(!actions[value.actionIntent].includes(rules.action))throw new Error('计划动作与长期意图不一致');
      if(!exact(rules.conditions,P.CONDITION_CATEGORIES)||Object.values(rules.conditions).some(rows=>!Array.isArray(rows)||rows.length>12||rows.some(t=>typeof t!=='string'||!t.trim()||t.length>240)))throw new Error('计划条件必须为明确文字');
      for(const key of ['triggerPrice','quantity'])if(rules[key]!==null&&(typeof rules[key]!=='number'||!Number.isFinite(rules[key])||rules[key]<=0||key==='quantity'&&!Number.isInteger(rules[key])))throw new Error('计划价格或数量无效');
      if(![null,'above','below'].includes(rules.triggerDirection)||(rules.triggerPrice===null)!==(rules.triggerDirection===null))throw new Error('价格和方向必须同时明确');
      if(!exact(rules.allocationConstraint,['maxPositionPct','targetWeightRange']))throw new Error('配置约束格式无效');
      const a=rules.allocationConstraint;if(a.maxPositionPct!==null&&(typeof a.maxPositionPct!=='number'||!Number.isFinite(a.maxPositionPct)||a.maxPositionPct<=0||a.maxPositionPct>100)||a.targetWeightRange!==null&&(typeof a.targetWeightRange!=='string'||!a.targetWeightRange.trim()||a.targetWeightRange.length>80))throw new Error('配置约束无效');
      for(const key of ['validUntil','nextReviewDate'])if(rules[key]!==null&&(!/^\d{4}-\d{2}-\d{2}$/.test(rules[key])||!Number.isFinite(Date.parse(rules[key]))||new Date(rules[key]).toISOString().slice(0,10)!==rules[key]))throw new Error('计划日期无效');
      if(typeof rules.note!=='string'||rules.note.length>1000)throw new Error('计划说明无效');
      if(!rules.triggerPrice&&!Object.values(rules.conditions).some(rows=>rows.length))throw new Error('计划缺少关注条件');
      if(!rules.conditions.invalidation.length)throw new Error('计划缺少失效规则');
      if(['entry','increase'].includes(value.actionIntent)&&!P.hasAllocationPremise(rules))throw new Error('建仓或加仓需要配置约束');
      plan=P.createPlan(rules,{now:'2000-01-01T00:00:00.000Z'});
    }
    if(stable(C.definition(plan))!==stable(rules))throw new Error('计划定义需要明确规范值，不能隐式补全');return clone(value);
  }
  function legacyDefinition(plan,actionIntent){
    const rules=C.definition(plan);
    // A legacy buy might mean entry or repeat increase: caller must choose explicitly.
    if(!INTENTS.includes(actionIntent))throw new Error('请明确确认长期规划意图');
    if(rules.planMode==='legacy_price'&&['entry','increase'].includes(actionIntent)&&['buy','add'].includes(rules.action))rules.action=actionIntent==='entry'?'buy':'add';
    return validateDefinition({actionIntent,rules});
  }
  function ref(record){const revision=record.revisions.at(-1);return {planId:record.planId,revisionId:revision.revisionId,definitionHash:revision.definitionHash,hashContractVersion:HASH_CONTRACT}}
  function read(state,planId){
    const record=store(state).byId[planId],found=C.exactPlan(state,planId);
    if(record)return {kind:'v4',record:clone(record),planRef:ref(record),compatibility:found&&stable(C.definition(found.plan))===stable(record.revisions.at(-1).definition.rules)?'current':'conflict'};
    if(!found)return {kind:'missing',planId};
    return {kind:'legacy',planId,legacyPlan:clone(found.plan),definitionRef:C.readableDefinitionRef(found.plan),requiresExplicitConversion:true,replacesPlanId:found.plan.legacy?.discussionPlanSource?.replacesPlanId||null};
  }
  function projection(definition,existing,now){
    validateDefinition(definition);const rules=definition.rules;
    if(existing&&existing.planMode!==rules.planMode)throw new Error('不能通过修改切换旧计划模式；请明确替代');
    if(rules.planMode==='state_watch')return existing?P.editWatchPlan(existing,rules,{now}):P.createWatchPlan(rules,{now});
    const {planMode,...patch}=rules;return existing?P.applyAuthoritativeEdit(existing,{...patch,fullConditionStatus:'unproven'},{now}):P.createPlan(patch,{now,source:'manual'});
  }
  function assertApplicable(stock,definition,existing=null){
    const plan=projection(definition,null,'2000-01-01T00:00:00.000Z'),result=C.applicability(stock,plan),shares=C.holding(stock).shares;
    if(result.status!=='applicable')throw new Error('当前持仓不适用：'+result.reasons.join('、'));
    if(definition.actionIntent==='entry'&&shares!==0)throw new Error('已有持仓不能确认新的建仓规划');
    if(['increase','reduce'].includes(definition.actionIntent)&&!(shares>0))throw new Error('当前没有可适用的持仓');
    const caps=[stock.capPct,stock.strategy?.maxWeight].map(Number).filter(n=>n>0);if(caps.length&&definition.rules.allocationConstraint.maxPositionPct>Math.min(...caps))throw new Error('计划配置上限超过当前保护约束');
    if(existing&&existing.status!=='active')throw new Error('已结束计划不能修改');
  }
  function writeRevision(candidate,stockId,planId,definition,source=null,now=new Date().toISOString()){
    definition=validateDefinition(definition);const stock=candidate.stocks.find(s=>s.id===stockId);if(!stock)throw new Error('找不到计划标的');
    const existing=planId?C.exactPlan(candidate,planId):null;if(planId&&(!existing||existing.stock.id!==stockId))throw new Error('目标计划不存在或不唯一');
    assertApplicable(stock,definition,existing?.plan);if(!candidate.planDefinitionsV4)candidate.planDefinitionsV4=empty();const s=candidate.planDefinitionsV4,old=planId?s.byId[planId]:null;
    if(old&&stable(old.revisions.at(-1).definition)===stable(definition))return {noChange:true,planRef:ref(old)};
    const projected=projection(definition,existing?.plan,now),id=existing?.plan.id||projected.id;projected.id=id;
    const record=old||{planId:id,symbol:C.context(candidate,stockId).symbol,lifecycle:'active',supersededByPlanId:null,legacyOrigin:existing?{plan:clone(existing.plan),planSnapshotHash:R.planSnapshotHash(existing.plan),definitionRef:C.readableDefinitionRef(existing.plan)}:null,revisions:[]};
    if(record.lifecycle!=='active')throw new Error('已结束计划不能修改');
    const revision={revisionId:uid('planrevision'),revisionNumber:record.revisions.length+1,definition,definitionHash:definitionHash(definition),hashContractVersion:HASH_CONTRACT,confirmedAt:new Date(now).toISOString(),source:clone(source)};
    record.revisions.push(revision);s.byId[id]=record;
    if(existing)stock.plans[stock.plans.findIndex(p=>p.id===id)]=projected;else (stock.plans||(stock.plans=[])).push(projected);
    return {noChange:false,planRef:ref(record)};
  }
  function validate(state){
    const s=state.planDefinitionsV4;if(s===undefined)return true;
    if(!exact(s,['schemaVersion','byId','receipts'])||s.schemaVersion!==SCHEMA||!s.byId||typeof s.byId!=='object'||Array.isArray(s.byId)||!s.receipts||typeof s.receipts!=='object'||Array.isArray(s.receipts))throw new Error('Plan V4 store 无效');
    for(const [id,r] of Object.entries(s.byId)){
      if(!exact(r,['planId','symbol','lifecycle','supersededByPlanId','legacyOrigin','revisions'])||id!==r.planId||!LIFECYCLES.includes(r.lifecycle)||!Array.isArray(r.revisions)||!r.revisions.length)throw new Error('Plan V4 记录无效');
      r.revisions.forEach((v,i)=>{if(!exact(v,['revisionId','revisionNumber','definition','definitionHash','hashContractVersion','confirmedAt','source'])||typeof v.revisionId!=='string'||!v.revisionId||v.revisionNumber!==i+1||v.hashContractVersion!==HASH_CONTRACT||!Number.isFinite(Date.parse(v.confirmedAt)))throw new Error('Plan revision 无效');validateDefinition(v.definition);if(definitionHash(v.definition)!==v.definitionHash)throw new Error('Definition hash 不一致')});
      const found=C.exactPlan(state,id),lifecycle={active:'active',cancelled:'cancelled',completed:'completed',superseded:'replaced'}[r.lifecycle];
      if(!found||C.context(state,found.stock.id).symbol!==r.symbol||found.plan.status!==lifecycle||stable(C.definition(found.plan))!==stable(r.revisions.at(-1).definition.rules))throw new Error('V4 与旧计划投影冲突，请使用 V4 预览确认入口；原始数据保留');
      if(r.legacyOrigin!==null){if(!exact(r.legacyOrigin,['plan','planSnapshotHash','definitionRef'])||r.legacyOrigin.plan.id!==id||R.planSnapshotHash(r.legacyOrigin.plan)!==r.legacyOrigin.planSnapshotHash||stable(C.readableDefinitionRef(r.legacyOrigin.plan))!==stable(r.legacyOrigin.definitionRef))throw new Error('旧计划来源损坏')}
      if(r.supersededByPlanId!==null&&(!s.byId[r.supersededByPlanId]||r.lifecycle!=='superseded'))throw new Error('替代关系无效');
      const revisionIds=new Set();for(const revision of r.revisions){if(revisionIds.has(revision.revisionId))throw new Error('重复修订身份');revisionIds.add(revision.revisionId);if(revision.source!==null&&(!exact(revision.source,['receiptId','discussionId','decisionId'])||!s.receipts[revision.source.receiptId]||s.receipts[revision.source.receiptId].source.decisionId!==revision.source.decisionId||s.receipts[revision.source.receiptId].source.discussionId!==revision.source.discussionId))throw new Error('计划修订缺少对应变更回执')}
    }
    for(const [id,r] of Object.entries(s.receipts)){
      if(!exact(r,['receiptId','symbol','confirmedAt','operation','source','draft','priorPlanRef','newPlanRef','before','after'])||id!==r.receiptId||!Number.isFinite(Date.parse(r.confirmedAt))||!['create','update','no_change','cancel','supersede','complete'].includes(r.operation)||!exact(r.source,['decisionId','discussionId']))throw new Error('计划变更回执无效');
      const decision=D.store(state).decisions[r.source.decisionId];if(!decision||decision.discussionId!==r.source.discussionId||decision.symbol!==r.symbol)throw new Error('计划回执缺少真实用户确认');
      const draft=r.draft;if(!exact(draft,['schemaVersion','definitionContract','draftSessionId','contextHash','operation','symbol','targetRef','definition','reason','risks','unresolvedItems'])||draft.schemaVersion!=='discussion-plan-draft.v1'||draft.definitionContract!==SCHEMA||draft.symbol!==r.symbol||draft.operation!==r.operation||stable(draft.targetRef)!==stable(r.priorPlanRef)||typeof draft.draftSessionId!=='string'||!draft.draftSessionId||!/^sha256:[0-9a-f]{64}$/.test(draft.contextHash)||typeof draft.reason!=='string'||!draft.reason.trim()||draft.reason.length>1000||!Array.isArray(draft.risks)||draft.risks.length>12||draft.risks.some(v=>typeof v!=='string'||!v.trim()||v.length>240)||!Array.isArray(draft.unresolvedItems)||draft.unresolvedItems.length)throw new Error('回执草案无效');
      if(['create','update','supersede'].includes(r.operation)){validateDefinition(r.after);if(stable(r.after)!==stable(draft.definition)||!r.newPlanRef)throw new Error('回执与定义不一致')}else if(r.after!==null||draft.definition!==null)throw new Error('生命周期回执不得修改定义');
      for(const ref of [r.priorPlanRef,r.newPlanRef])if(ref!==null&&(!exact(ref,['planId','definitionRef','legacyPlanVersion','legacySnapshotHash','lifecycle'])||typeof ref.planId!=='string'||!ref.planId||!Number.isInteger(ref.legacyPlanVersion)||ref.legacyPlanVersion<1||typeof ref.legacySnapshotHash!=='string'||!['active','cancelled','completed','replaced'].includes(ref.lifecycle)))throw new Error('回执计划引用无效');
      if(r.operation==='create'&&r.priorPlanRef!==null||r.operation!=='create'&&r.operation!=='no_change'&&!r.priorPlanRef||r.operation==='supersede'&&r.newPlanRef?.planId===r.priorPlanRef?.planId||r.operation==='update'&&r.newPlanRef?.planId!==r.priorPlanRef?.planId)throw new Error('回执身份关系无效');
    }
    return true;
  }
  return Object.freeze({SCHEMA,HASH_CONTRACT,INTENTS,LIFECYCLES,empty,store,definitionHash,validateDefinition,legacyDefinition,ref,read,projection,assertApplicable,writeRevision,validate});
});
