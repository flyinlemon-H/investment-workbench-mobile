'use strict';

const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const test=require('node:test');
const PlanV2=require('../src/plan-v2.js');
const Workbench=require('../src/discussion-workbench.js');
const Workflow=require('../src/discussion-plan-workflow.js');

const now='2026-09-01T12:00:00Z';
const stateValue=(overrides={})=>({schemaVersion:Workbench.STATE_SCHEMA_VERSION,stateId:'discussionstate_fixture',symbol:'601138.SS',sourceDiscussionVersion:'discussion_v2_fixture',actionAssessment:{category:'reduce_review',priority:'high',headline:'减仓条件进入复核窗口。',reasons:['结构接近讨论确认的风险窗口。'],upgradeConditions:['确认结构破坏。'],downgradeConditions:['结构重新修复。']},attentionLevel:'window',trendAssessment:{overall:'recovery',timeframes:[{timeframe:'日线',status:'recovery',explanation:'修复仍待确认。'}]},structureAssessment:[],stage:'减仓复核',focusPoints:['确认结构是否破坏。'],summary:'本轮讨论形成明确减仓条件。',keyChanges:[],risks:['价格触发不等于完整条件确认。'],watchPoints:[],planRelation:{status:'no_matching_plan',summary:'没有匹配的减仓计划。'},confidence:'medium',technicalAsOf:'2026-09-01',confirmedAt:now,confirmedDate:'2026-09-01',technicalSnapshot:{anchorBar:{date:'2026-09-01',close:55,adjustment:'forward',priceBasis:'close',provider:'fixture'},technicalDataStatus:'fresh',supportPrice:50,resistancePrice:60},references:{technical:{technicalAsOf:'2026-09-01',latestCompleteBar:'2026-09-01',reviewUpdatedAt:null,reviewHash:'technical_fixture',anchorBar:{date:'2026-09-01',close:55,adjustment:'forward',priceBasis:'close',provider:'fixture'}},plans:[],planReviews:[],holding:{shares:500,avgCost:40,role:'核心',type:'holding',hash:'holding_fixture'},longTermLogic:{updatedAt:null,logicStatus:'valid',hash:'logic_fixture'},allocation:{status:'unconfirmed'},modules:{news:{updatedAt:'',hash:'news_fixture'},fundamental:{updatedAt:'',hash:'fundamental_fixture'},valuation:{updatedAt:'',hash:'valuation_fixture'}}},...overrides});
const stock=(overrides={})=>({id:'stock-1',name:'工业富联',code:'601138.SS',symbol:'601138.SS',shares:500,capPct:20,strategy:{maxWeight:20,minTradeUnit:100,minTradeUnitConfirmed:true},discussionState:{schemaVersion:Workbench.STORE_SCHEMA_VERSION,current:stateValue(),history:[]},plans:[],...overrides});
const conditions=()=>({technical:['日线结构确认破坏。'],fundamental:[],catalyst:[],allocation:[],market:[],other:[]});
const draftPlan=(overrides={})=>({action:'reduce',triggerPrice:null,triggerDirection:null,quantity:100,conditions:conditions(),invalidationConditions:['日线结构重新修复并确认。'],allocationConstraint:{maxPositionPct:null,targetWeightRange:null},validUntil:null,nextReviewDate:'2026-09-15',note:'结构破坏确认后减仓 100 股。',...overrides});
function envelope(prepared,overrides={}){return {schemaVersion:Workflow.SCHEMA_VERSION,operation:'create',symbol:prepared.symbol,...prepared.binding,targetPlan:null,plan:draftPlan(),reason:'当前对话明确形成减仓计划。',risks:['完整条件仍需用户确认。'],unresolvedItems:[],...overrides}}
function target(plan){return {id:plan.id,planVersion:plan.planVersion,snapshotHash:Workflow.planSnapshotHash(plan)}}
function smartStructure(value){let inString=false,escaped=false;return JSON.stringify(value).split('').map(char=>{if(escaped){escaped=false;return char}if(char==='\\'){if(inString)escaped=true;return char}if(char==='"'){inString=!inString;return inString?'“':'”'}return char}).join('')}
function reducePlan(id,triggerPrice,quantity,note){return PlanV2.createPlan({id,action:'reduce',triggerPrice,triggerDirection:'above',quantity,conditions:{technical:[`${triggerPrice} 附近压力确认。`],invalidation:['突破并站稳。']},note},{now,source:'manual'})}

test('整理计划 works without Discussion or Current State and adds optional current context only when available',()=>{
  const standalone=Workflow.prepare(stock({discussionState:undefined}),{sessionId:'standalone',now});
  assert.match(standalone.request,/当前 AI 对话/);assert.match(standalone.request,/不要重新做完整分析/);assert.match(standalone.request,/不要创造/);assert.match(standalone.request,/只输出一个 JSON 对象/);
  assert.equal(standalone.symbol,'601138.SS');assert.equal(standalone.context.holding.status,'held');assert.equal(standalone.hasCurrentState,false);assert.equal(standalone.context.currentState,undefined);assert.equal(standalone.binding.sourceDiscussionVersion,undefined);assert.equal(standalone.binding.currentStateId,undefined);assert.equal(standalone.binding.currentStateHash,undefined);assert.match(standalone.binding.draftSessionHash,/^plandraftsession_/);
  const prepared=Workflow.prepare(stock(),{sessionId:'with-current-state',now});assert.equal(prepared.hasCurrentState,true);assert.equal(prepared.context.currentState.actionAssessment.category,'reduce_review');
  assert.deepEqual(Object.keys(prepared.context.currentState).sort(),['actionAssessment','attentionLevel','focusPoints','planRelation','structureAssessment','trendAssessment'].sort());
  assert.doesNotMatch(prepared.request,/priceHistory|bars|technicalSnapshot|完整日K/);
});

test('prompt includes exact existing Plan snapshots without unrelated historical analysis',()=>{
  const plan=PlanV2.createPlan({id:'reduce-1',action:'reduce',triggerPrice:60,triggerDirection:'above',quantity:100,conditions:{technical:['压力位确认。'],invalidation:['突破并站稳。']},note:'压力位减仓。'},{now,source:'manual'}),prepared=Workflow.prepare(stock({plans:[plan]}));
  assert.equal(prepared.context.plans.length,1);assert.equal(prepared.context.plans[0].id,'reduce-1');assert.equal(prepared.context.plans[0].planVersion,1);assert.match(prepared.context.plans[0].snapshotHash,/^plansnap_/);assert.match(prepared.request,/reduce-1/);
});

test('Prompt enumerates readable Plan slots and requires exact single-target semantics',()=>{
  const first=reducePlan('reduce-first',60,100,'第一档减仓。'),second=reducePlan('reduce-second',70,100,'第二档减仓。'),prepared=Workflow.prepare(stock({plans:[first,second],discussionState:undefined}),{sessionId:'two-plan-prompt',now});
  assert.deepEqual(prepared.plans.map(plan=>plan.displayLabel),['减仓计划 1','减仓计划 2']);
  for(const wording of ['### 当前正式计划','计划 A — 减仓计划 1','计划 B — 减仓计划 2','只输出本轮 AI 对话中明确讨论并形成结论的一个计划','没有被本轮讨论涉及的既有计划不得输出','内容相同使用 no_change','实质变化使用 update','create 仅用于本轮明确建立的全新独立计划','不得按列表第一项','不得省略、修改或猜测','即使结论是“不修改”','当前对话未形成需要保存的具体计划结论','不表示任何既有计划已被复核'])assert.match(prepared.request,new RegExp(wording.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')));
  for(const plan of prepared.plans){assert.match(prepared.request,new RegExp(plan.id));assert.match(prepared.request,new RegExp(String(plan.planVersion)));assert.match(prepared.request,new RegExp(plan.snapshotHash))}
});

test('create, update, no_change, invalidate, and complete strict envelopes parse preview-only',()=>{
  const existing=PlanV2.createPlan({id:'reduce-1',action:'reduce',triggerPrice:60,triggerDirection:'above',quantity:100,conditions:{technical:['压力位确认。'],invalidation:['突破并站稳。']},note:'原减仓计划。'},{now,source:'manual'}),held=stock({plans:[existing],discussionState:undefined}),prepared=Workflow.prepare(held);
  const cases=[
    ['create',stock({discussionState:undefined}),null,draftPlan()],
    ['update',held,target(existing),draftPlan({note:'修改后的减仓计划。'})],
    ['no_change',held,target(existing),null],
    ['invalidate',held,target(existing),null],
    ['complete',held,target(existing),null]
  ];
  for(const [operation,current,targetPlan,plan] of cases){const p=Workflow.prepare(current),result=Workflow.process(JSON.stringify(envelope(p,{operation,targetPlan,plan,reason:operation==='no_change'?'当前计划保持合适。':`${operation} 已由讨论明确确认。`})),{stock:current,prepared:p});assert.equal(result.ok,true,`${operation}: ${result.message}`);assert.equal(result.previewReady,true);assert.equal(result.writes,0);assert.equal(result.confirmReady,operation!=='no_change');assert.match(Workflow.renderPreview(result),new RegExp(Workflow.OPERATION_LABELS[operation]))}
  assert.equal(prepared.symbol,'601138.SS');
});

test('unknown operation, symbol, Plan Draft Session, Plan version, and Plan snapshot fail closed',()=>{
  const plan=PlanV2.createPlan({id:'reduce-1',action:'reduce',triggerPrice:60,triggerDirection:'above',conditions:{technical:['压力位确认。'],invalidation:['突破并站稳。']},note:'原计划。'},{now,source:'manual'}),current=stock({plans:[plan]}),prepared=Workflow.prepare(current),base=envelope(prepared,{operation:'update',targetPlan:target(plan),plan:draftPlan({note:'修改。'})});
  for(const [patch,pattern] of [[{operation:'merge'},/未知固定值/],[{symbol:'000001.SZ'},/标的不一致/],[{draftSessionId:'old'},/计划上下文无法验证/],[{targetPlan:{...target(plan),planVersion:2}},/当前计划已发生变化/],[{targetPlan:{...target(plan),snapshotHash:'plansnap_old'}},/当前计划已发生变化/]]){const result=Workflow.process(JSON.stringify({...base,...patch}),{stock:current,prepared});assert.equal(result.ok,false);assert.equal(result.writes,0);assert.match(result.message,pattern)}
});

test('shared strict parser accepts smart quotes and one full Markdown fence',()=>{
  const current=stock(),prepared=Workflow.prepare(current),value=envelope(prepared);
  for(const raw of [smartStructure(value),`\`\`\`json\n${JSON.stringify(value)}\n\`\`\``]){const result=Workflow.process(raw,{stock:current,prepared});assert.equal(result.ok,true,result.message);assert.equal(result.writes,0)}
});

test('shared strict parser keeps safe invalid \\_ recovery for standalone Plan Draft JSON',()=>{
  const current=stock({discussionState:undefined}),prepared=Workflow.prepare(current),value=envelope(prepared,{operation:'no_change',targetPlan:null,plan:null,reason:'standalone_plan_no_change'}),raw=JSON.stringify(value).replace(/standalone_plan_no_change/,'standalone\\_plan\\_no\\_change'),result=Workflow.process(raw,{stock:current,prepared});
  assert.equal(result.ok,true,result.message);assert.equal(result.draft.reason,'standalone_plan_no_change');assert.equal(result.writes,0);
});

test('Plan Draft Session binds symbol, holding, constraints, and relevant Plan snapshots',()=>{
  const plan=PlanV2.createPlan({id:'reduce-session',action:'reduce',triggerPrice:60,triggerDirection:'above',conditions:{technical:['压力确认。'],invalidation:['突破。']},note:'会话计划。'},{now,source:'manual'}),prepared=Workflow.prepare(stock({plans:[plan],discussionState:undefined}),{sessionId:'session-fixture',now});
  assert.equal(prepared.session.id,'session-fixture');assert.equal(prepared.session.version,1);assert.match(prepared.session.hash,/^plandraftsession_/);assert.match(prepared.session.protectedFactsHash,/^plandraftfacts_/);assert.equal(prepared.session.targetPlan,null);assert.equal(prepared.context.planDraftSession.targetPlan,null);assert.equal(prepared.protectedFacts.symbol,'601138.SS');assert.equal(prepared.protectedFacts.holding.status,'held');assert.equal(prepared.protectedFacts.holding.shares,500);assert.equal(prepared.protectedFacts.holding.minTradeUnit,100);assert.deepEqual(prepared.protectedFacts.plans,[{id:'reduce-session',planVersion:1,snapshotHash:Workflow.planSnapshotHash(plan)}]);
});

test('program-scoped Plan Draft Sessions bind one exact target into the Session hash without changing the V1 envelope',()=>{
  const first=reducePlan('reduce-first',60,100,'第一档减仓。'),second=reducePlan('reduce-second',70,100,'第二档减仓。'),current=stock({plans:[first,second],discussionState:undefined}),base={sessionId:'same-session-id',now},unscoped=Workflow.prepare(current,base),scopedA=Workflow.prepare(current,{...base,scopedTargetPlanId:first.id}),scopedB=Workflow.prepare(current,{...base,scopedTargetPlanId:second.id});
  assert.equal(unscoped.session.targetPlan,null);assert.deepEqual(scopedA.session.targetPlan,target(first));assert.deepEqual(scopedA.context.planDraftSession.targetPlan,target(first));assert.equal(scopedA.session.targetLabel,'减仓计划 1');assert.deepEqual(scopedB.session.targetPlan,target(second));assert.notEqual(scopedA.session.hash,scopedB.session.hash);assert.notEqual(scopedA.session.hash,unscoped.session.hash);assert.match(scopedA.request,/本次 Plan Draft Session 已由程序明确限定为“减仓计划 1”/);assert.match(scopedA.request,/即使结论是不修改，也不得返回 targetPlan:null，也不得使用 create/);
  assert.throws(()=>Workflow.prepare(current,{scopedTargetPlanId:'missing-plan'}),/不属于当前正式计划/);assert.throws(()=>Workflow.prepare(current,{scopedTargetPlanId:' '}),/目标计划无效/);
});

test('holding or relevant Plan changes stale the session while Current State changes do not',()=>{
  const plan=PlanV2.createPlan({id:'reduce-stale',action:'reduce',triggerPrice:60,triggerDirection:'above',conditions:{technical:['压力确认。'],invalidation:['突破。']},note:'原计划。'},{now,source:'manual'}),current=stock({plans:[plan],discussionState:undefined}),prepared=Workflow.prepare(current),raw=JSON.stringify(envelope(prepared,{operation:'no_change',targetPlan:target(plan),plan:null,reason:'当前计划保持合适。'}));
  const holdingChanged=Workflow.process(raw,{stock:{...current,shares:400},prepared});assert.equal(holdingChanged.ok,false);assert.match(holdingChanged.message,/当前计划或持仓状态已发生变化/);
  const planChanged=Workflow.process(raw,{stock:{...current,plans:[PlanV2.applyAuthoritativeEdit(plan,{note:'已经变化。'},{now:'2026-09-01T13:00:00Z'})]},prepared});assert.equal(planChanged.ok,false);assert.match(planChanged.message,/当前计划或持仓状态已发生变化/);
  const stateOnly=Workflow.process(raw,{stock:{...current,discussionState:{schemaVersion:Workbench.STORE_SCHEMA_VERSION,current:stateValue({stateId:'new-state',sourceDiscussionVersion:'discussion_v2_new'}),history:[]}},prepared});assert.equal(stateOnly.ok,true,stateOnly.message);
});

test('an unrelated active Plan change currently stales the whole safety-first session',()=>{
  const first=reducePlan('reduce-first',60,100,'第一档减仓。'),second=reducePlan('reduce-second',70,100,'第二档减仓。'),current=stock({plans:[first,second],discussionState:undefined}),prepared=Workflow.prepare(current),raw=JSON.stringify(envelope(prepared,{operation:'no_change',targetPlan:target(first),plan:null,reason:'第一档保持不变。'})),changedSecond=PlanV2.applyAuthoritativeEdit(second,{note:'第二档已经改变。'},{now:'2026-09-01T13:00:00Z'}),result=Workflow.process(raw,{stock:{...current,plans:[first,changedSecond]},prepared});
  assert.equal(result.ok,false);assert.match(result.message,/当前计划或持仓状态已发生变化/);
});

test('optional Current State provenance may be omitted or supplied with new and legacy names',()=>{
  const current=stock(),prepared=Workflow.prepare(current),base=envelope(prepared);
  const omitted={...base};delete omitted.sourceDiscussionVersion;delete omitted.currentStateId;delete omitted.currentStateHash;assert.equal(Workflow.process(JSON.stringify(omitted),{stock:current,prepared}).ok,true);
  const legacy={...omitted,sourceDiscussionVersion:prepared.provenance.sourceDiscussionVersion,sourceStateId:prepared.provenance.currentStateId,sourceStateHash:prepared.provenance.currentStateHash};const accepted=Workflow.process(JSON.stringify(legacy),{stock:current,prepared});assert.equal(accepted.ok,true,accepted.message);assert.equal(accepted.draft.currentStateId,prepared.provenance.currentStateId);
});

test('old RC12 Discussion-bound JSON without a verifiable Plan Draft Session fails with regeneration guidance',()=>{
  const current=stock(),prepared=Workflow.prepare(current),legacy=envelope(prepared);delete legacy.draftSessionId;delete legacy.draftSessionVersion;delete legacy.draftSessionHash;legacy.sourceStateId=legacy.currentStateId;legacy.sourceStateHash=legacy.currentStateHash;delete legacy.currentStateId;delete legacy.currentStateHash;
  const result=Workflow.process(JSON.stringify(legacy),{stock:current,prepared});assert.equal(result.ok,false);assert.equal(result.writes,0);assert.match(result.message,/当前没有可验证的计划上下文，请重新整理计划/);
});

test('malformed, truncated, wrapped, and extra-field inputs make zero writes',()=>{
  const current=stock(),prepared=Workflow.prepare(current),value=envelope(prepared),inputs=['{"schemaVersion":','说明\n'+JSON.stringify(value),JSON.stringify(value)+'\n说明',JSON.stringify({...value,unknown:true})];
  for(const raw of inputs){const result=Workflow.process(raw,{stock:current,prepared});assert.equal(result.ok,false);assert.equal(result.confirmReady,false);assert.equal(result.writes,0)}
});

test('missing semantic facts and unresolved items preview safely but cannot confirm',()=>{
  const current=stock(),prepared=Workflow.prepare(current),missing=Workflow.process(JSON.stringify(envelope(prepared,{plan:draftPlan({triggerPrice:null,triggerDirection:null,conditions:{technical:[],fundamental:[],catalyst:[],allocation:[],market:[],other:[]},invalidationConditions:[]})})),{stock:current,prepared});
  assert.equal(missing.ok,false);assert.match(missing.message,/缺少明确触发价或条件/);assert.match(missing.message,/缺少明确失效条件/);
  const unresolved=Workflow.process(JSON.stringify(envelope(prepared,{unresolvedItems:['减仓数量尚未确认。']})),{stock:current,prepared});assert.equal(unresolved.ok,true);assert.equal(unresolved.previewReady,true);assert.equal(unresolved.confirmReady,false);assert.equal(unresolved.code,'incomplete');assert.match(Workflow.renderPreview(unresolved),/计划信息尚不完整/);
});

test('quantity, allocation, held/zero-position, and independent create rules are enforced',()=>{
  const held=stock(),prepared=Workflow.prepare(held);
  assert.match(Workflow.process(JSON.stringify(envelope(prepared,{plan:draftPlan({quantity:600})})),{stock:held,prepared}).message,/超过当前持仓/);
  assert.match(Workflow.process(JSON.stringify(envelope(prepared,{plan:draftPlan({quantity:150})})),{stock:held,prepared}).message,/最小交易单位 100/);
  assert.match(Workflow.process(JSON.stringify(envelope(prepared,{plan:draftPlan({allocationConstraint:{maxPositionPct:30,targetWeightRange:null}})})),{stock:held,prepared}).message,/超过程序当前保护上限/);
  const zero=stock({shares:0}),zeroPrepared=Workflow.prepare(zero),wrong=Workflow.process(JSON.stringify(envelope(zeroPrepared)),{stock:zero,prepared:zeroPrepared});assert.equal(wrong.ok,false);assert.match(wrong.message,/零持仓/);
  const entry=Workflow.process(JSON.stringify(envelope(zeroPrepared,{plan:draftPlan({action:'buy',quantity:null,allocationConstraint:{maxPositionPct:10,targetWeightRange:null},note:'建仓条件确认后进入计划。'}),reason:'讨论明确形成建仓计划。'})),{stock:zero,prepared:zeroPrepared});assert.equal(entry.ok,true,entry.message);
  const add=PlanV2.createPlan({id:'add-1',action:'add',triggerPrice:50,triggerDirection:'below',allocationConstraint:{maxPositionPct:20,targetWeightRange:null},conditions:{technical:['回踩确认。'],invalidation:['结构破坏。']},note:'加仓计划。'},{now,source:'manual'}),withAdd=stock({plans:[add]}),withAddPrepared=Workflow.prepare(withAdd),additional=Workflow.process(JSON.stringify(envelope(withAddPrepared,{plan:draftPlan({action:'add',allocationConstraint:{maxPositionPct:20,targetWeightRange:null},note:'本轮形成新的独立加仓档位。'}),reason:'当前对话明确形成新的独立加仓档位。'})),{stock:withAdd,prepared:withAddPrepared});assert.equal(additional.ok,true,additional.message);assert.equal(withAdd.plans.length,1);
});

test('targeted and global no_change meanings stay distinct without prose-based Plan inference',async()=>{
  const first=reducePlan('reduce-first',60,100,'第一档减仓。'),second=reducePlan('reduce-second',70,100,'第二档减仓。'),current=stock({plans:[first,second],discussionState:undefined}),prepared=Workflow.prepare(current,{sessionId:'two-plan-target',now}),scopedA=Workflow.prepare(current,{sessionId:'scope-a',now,scopedTargetPlanId:first.id}),scopedB=Workflow.prepare(current,{sessionId:'scope-b',now,scopedTargetPlanId:second.id}),before=structuredClone(current.plans);
  const scopedANull=Workflow.process(JSON.stringify(envelope(scopedA,{operation:'no_change',targetPlan:null,plan:null,reason:'当前对话未形成需要保存的具体计划结论。'})),{stock:current,prepared:scopedA});assert.equal(scopedANull.ok,false);assert.match(scopedANull.message,/no_change 必须精确绑定 targetPlan/);
  const scopedAWrong=Workflow.process(JSON.stringify(envelope(scopedA,{operation:'no_change',targetPlan:target(second),plan:null,reason:'第二档保持不变。'})),{stock:current,prepared:scopedA});assert.equal(scopedAWrong.ok,false);assert.match(scopedAWrong.message,/明确绑定的目标计划不一致/);
  for(const [scoped,plan,label] of [[scopedA,first,'减仓计划 1'],[scopedB,second,'减仓计划 2']]){const result=Workflow.process(JSON.stringify(envelope(scoped,{operation:'no_change',targetPlan:target(plan),plan:null,reason:'该计划的正式内容保持不变。'})),{stock:current,prepared:scoped});assert.equal(result.ok,true,result.message);assert.equal(result.targetLabel,label)}
  const global=Workflow.process(JSON.stringify(envelope(prepared,{operation:'no_change',targetPlan:null,plan:null,reason:'当前对话未形成需要保存的具体计划结论。'})),{stock:current,prepared});assert.equal(global.ok,true,global.message);assert.equal(global.noPlanResult,true);assert.equal(global.draft.targetPlan,null);assert.equal(global.unaffectedPlanCount,0);assert.equal(global.confirmReady,false);assert.equal(global.writes,0);const globalHtml=Workflow.renderPreview(global);assert.match(globalHtml,/未形成具体计划结论/);assert.match(globalHtml,/不会修改、重新确认或更新任何计划及其元数据/);assert.doesNotMatch(globalHtml,/目标计划|其他 \d+ 个当前计划|所有计划保持不变|当前计划继续有效/);
  const globalRoot={stocks:[structuredClone(current)],planReviews:{history:['unchanged'],currentByPlan:{}}},globalBefore=structuredClone(globalRoot),globalCommit=await Workflow.commit(global,globalRoot,{saveCandidate:async()=>{throw new Error('global no-result must not save')},adoptCandidate:()=>{throw new Error('must not adopt')},rollback:()=>{throw new Error('must not rollback')}});assert.equal(globalCommit.status,'no_change');assert.equal(globalCommit.writes,0);assert.deepEqual(globalRoot,globalBefore);
  const proseMentionsA=Workflow.process(JSON.stringify(envelope(prepared,{operation:'no_change',targetPlan:null,plan:null,reason:'本轮谈到第一档，但未形成需要保存的具体计划结论。'})),{stock:current,prepared});assert.equal(proseMentionsA.ok,true,proseMentionsA.message);assert.equal(proseMentionsA.noPlanResult,true);assert.equal(proseMentionsA.targetLabel,'');
  const exactBWithAProse=Workflow.process(JSON.stringify(envelope(prepared,{operation:'no_change',targetPlan:target(second),plan:null,reason:'正文声称第一档不变，但程序只校验精确身份。'})),{stock:current,prepared});assert.equal(exactBWithAProse.ok,true,exactBWithAProse.message);assert.equal(exactBWithAProse.targetLabel,'减仓计划 2');assert.match(Workflow.renderPreview(exactBWithAProse),/目标计划[\s\S]*减仓计划 2/);
  const exact=Workflow.process(JSON.stringify(envelope(prepared,{operation:'no_change',targetPlan:target(first),plan:null,reason:'本轮仅讨论第一档，正式内容保持不变。'})),{stock:current,prepared});
  assert.equal(exact.ok,true,exact.message);assert.equal(exact.confirmReady,false);assert.equal(exact.targetLabel,'减仓计划 1');assert.equal(exact.unaffectedPlanCount,1);assert.match(Workflow.renderPreview(exact),/目标计划[\s\S]*减仓计划 1[\s\S]*该计划与当前正式版本一致，无需修改[\s\S]*其他 1 个当前计划不受影响/);
  const committed=await Workflow.commit(exact,{stocks:[current]},{saveCandidate:async()=>{throw new Error('no_change must not save')}});assert.equal(committed.status,'no_change');assert.equal(committed.writes,0);assert.deepEqual(current.plans,before);
  const badTargets=[{...target(first),id:'unknown-plan'},{...target(first),planVersion:2},{...target(first),snapshotHash:'plansnap_wrong'}];
  for(const badTarget of badTargets){const result=Workflow.process(JSON.stringify(envelope(prepared,{operation:'no_change',targetPlan:badTarget,plan:null,reason:'保持不变。'})),{stock:current,prepared});assert.equal(result.ok,false);assert.match(result.message,/targetPlan 不属于本次 Plan Draft Session|当前计划已发生变化/)}
  const preparedWithoutSecond={...prepared,plans:prepared.plans.filter(plan=>plan.id!==second.id)},notInSession=Workflow.process(JSON.stringify(envelope(prepared,{operation:'no_change',targetPlan:target(second),plan:null,reason:'保持不变。'})),{stock:current,prepared:preparedWithoutSecond});assert.equal(notInSession.ok,false);assert.match(notInSession.message,/targetPlan 不属于本次 Plan Draft Session/);
});

test('production global no-result fixture imports in an unscoped two-Plan Session as a pure no-op',async()=>{
  const first=reducePlan('2899-reduce-first',13,1000,'第一档减仓。'),second=reducePlan('2899-reduce-second',15,1000,'第二档减仓。'),current=stock({id:'2899-fixture',code:'2899.HK',symbol:'2899.HK',name:'紫金矿业',shares:2000,plans:[first,second],discussionState:undefined}),prepared=Workflow.prepare(current,{sessionId:'production-no-result',now}),fixture=fs.readFileSync(path.join(__dirname,'fixtures','production-plan-draft-global-no-result.json.txt'),'utf8').trim(),raw=fixture.replace('plandraft\\_d65b5b7b-6eb3-4a69-b777-fc7a5a8e111f',prepared.binding.draftSessionId).replace('plandraftsession\\_25302168',prepared.binding.draftSessionHash),result=Workflow.process(raw,{stock:current,prepared});
  assert.equal(result.ok,true,result.message);assert.equal(result.noPlanResult,true);assert.equal(result.draft.operation,'no_change');assert.equal(result.draft.targetPlan,null);assert.equal(result.writes,0);assert.equal(result.confirmReady,false);assert.match(result.message,/本轮未形成需要保存的具体计划结论/);const html=Workflow.renderPreview(result);assert.match(html,/本轮未形成需要保存的具体计划结论/);assert.doesNotMatch(html,/保持现有正式计划不变|所有计划保持不变|当前计划继续有效/);
  const root={stocks:[structuredClone(current)]},before=structuredClone(root),committed=await Workflow.commit(result,root,{saveCandidate:async()=>{throw new Error('production no-result must not save')}});assert.equal(committed.status,'no_change');assert.equal(committed.writes,0);assert.deepEqual(root,before);
});

test('single-Plan targeted no_change and all mutation operations require their program-owned target',()=>{
  const plan=reducePlan('reduce-only',60,100,'单一减仓计划。'),current=stock({plans:[plan],discussionState:undefined}),scoped=Workflow.prepare(current,{scopedTargetPlanId:plan.id});assert.match(scoped.request,/必须返回 no_change 并精确复制该计划的 targetPlan/);
  const nullNoChange=Workflow.process(JSON.stringify(envelope(scoped,{operation:'no_change',targetPlan:null,plan:null,reason:'具体计划不需要修改。'})),{stock:current,prepared:scoped});assert.equal(nullNoChange.ok,false);assert.match(nullNoChange.message,/no_change 必须精确绑定 targetPlan/);
  for(const operation of ['update','invalidate','complete']){const result=Workflow.process(JSON.stringify(envelope(scoped,{operation,targetPlan:null,plan:operation==='update'?draftPlan({note:'修改。'}):null,reason:`${operation} 结论。`})),{stock:current,prepared:scoped});assert.equal(result.ok,false);assert.match(result.message,new RegExp(`${operation} 必须精确绑定当前计划`))}
  const scopedCreate=Workflow.process(JSON.stringify(envelope(scoped,{operation:'create',targetPlan:null,plan:draftPlan({triggerPrice:80,triggerDirection:'above',note:'试图绕过 scoped 目标。'}),reason:'试图新增。'})),{stock:current,prepared:scoped});assert.equal(scopedCreate.ok,false);assert.match(scopedCreate.message,/已明确针对既有计划，不能使用 create/);
  const createStock=stock({plans:[plan],discussionState:undefined}),createPrepared=Workflow.prepare(createStock),created=Workflow.process(JSON.stringify(envelope(createPrepared,{operation:'create',targetPlan:null,plan:draftPlan({triggerPrice:80,triggerDirection:'above',note:'新独立档位。'}),reason:'形成新独立计划。'})),{stock:createStock,prepared:createPrepared});assert.equal(created.ok,true,created.message);assert.equal(created.draft.targetPlan,null);
});

test('targeted update replaces only its slot after confirmation and preserves the other Plan',async()=>{
  const first=reducePlan('reduce-first',60,100,'第一档减仓。'),second=reducePlan('reduce-second',70,100,'第二档减仓。'),current=stock({plans:[first,second],discussionState:undefined}),root={stocks:[current]},prepared=Workflow.prepare(current,{sessionId:'two-plan-update',now}),updatedPlan=draftPlan({triggerPrice:62,triggerDirection:'above',note:'第一档触发条件调整为 62。'}),preview=Workflow.process(JSON.stringify(envelope(prepared,{operation:'update',targetPlan:target(first),plan:updatedPlan,reason:'本轮只调整第一档减仓。'})),{stock:current,prepared}),before=structuredClone(current.plans);
  assert.equal(preview.ok,true,preview.message);assert.equal(preview.targetLabel,'减仓计划 1');assert.equal(preview.unaffectedPlanCount,1);assert.deepEqual(current.plans,before);const html=Workflow.renderPreview(preview);for(const wording of ['目标计划','减仓计划 1','当前正式内容','本次结果','原：','新：','旧计划保留为“已替换”的历史记录','其他 1 个当前计划不受影响'])assert.match(html,new RegExp(wording));
  const result=await Workflow.commit(preview,root,{saveCandidate:async candidate=>candidate},{now:'2026-09-01T16:00:00Z'});assert.equal(result.status,'completed');assert.equal(result.writes,1);
  const plans=result.state.stocks[0].plans,retired=plans.find(plan=>plan.id===first.id),untouched=plans.find(plan=>plan.id===second.id),successor=plans.find(plan=>plan.id!==first.id&&plan.id!==second.id);assert.equal(retired.status,'replaced');assert.equal(retired.planVersion,2);assert.deepEqual(untouched,PlanV2.normalizePlan(second));assert(successor);assert.equal(successor.status,'active');assert.equal(successor.triggerPrice,62);assert.equal(successor.legacy.discussionPlanSource.replacesPlanId,first.id);
  const labels=new Map(Workflow.planDisplayEntries(plans).map(entry=>[entry.plan.id,entry.label]));assert.equal(labels.get(successor.id),'减仓计划 1');assert.equal(labels.get(second.id),'减仓计划 2');
});

test('new independent slot, invalidate, and complete affect only the explicitly selected Plan',async()=>{
  const first=reducePlan('reduce-first',60,100,'第一档减仓。'),second=reducePlan('reduce-second',70,100,'第二档减仓。'),base=stock({plans:[first,second],discussionState:undefined});
  async function apply(current,draft,time){const root={stocks:[current]},prepared=Workflow.prepare(current),preview=Workflow.process(JSON.stringify(envelope(prepared,draft)),{stock:current,prepared});assert.equal(preview.ok,true,preview.message);assert.equal(preview.writes,0);return Workflow.commit(preview,root,{saveCandidate:async candidate=>candidate},{now:time})}
  const created=await apply(structuredClone(base),{operation:'create',targetPlan:null,plan:draftPlan({triggerPrice:80,triggerDirection:'above',note:'第三个独立减仓档位。'}),reason:'本轮明确新增第三个独立减仓档位。'},'2026-09-01T17:00:00Z');assert.equal(created.status,'completed');const createdPlans=created.state.stocks[0].plans;assert.equal(createdPlans.length,3);assert.deepEqual(createdPlans.find(plan=>plan.id===first.id),PlanV2.normalizePlan(first));assert.deepEqual(createdPlans.find(plan=>plan.id===second.id),PlanV2.normalizePlan(second));assert.deepEqual(Workflow.planDisplayEntries(createdPlans).map(entry=>entry.label),['减仓计划 1','减仓计划 2','减仓计划 3']);
  const invalidated=await apply(structuredClone(base),{operation:'invalidate',targetPlan:target(first),plan:null,reason:'本轮明确取消第一档。'},'2026-09-01T18:00:00Z');assert.equal(invalidated.state.stocks[0].plans.find(plan=>plan.id===first.id).status,'cancelled');assert.deepEqual(invalidated.state.stocks[0].plans.find(plan=>plan.id===second.id),PlanV2.normalizePlan(second));
  const completed=await apply(structuredClone(base),{operation:'complete',targetPlan:target(first),plan:null,reason:'第一档已经完成。'},'2026-09-01T19:00:00Z');assert.equal(completed.state.stocks[0].plans.find(plan=>plan.id===first.id).status,'completed');assert.deepEqual(completed.state.stocks[0].plans.find(plan=>plan.id===second.id),PlanV2.normalizePlan(second));
});

test('unrelated active Plan does not become update target and stale target never rebases',()=>{
  const add=PlanV2.createPlan({id:'add-1',action:'add',triggerPrice:50,triggerDirection:'below',allocationConstraint:{maxPositionPct:20,targetWeightRange:null},conditions:{technical:['回踩确认。'],invalidation:['结构破坏。']},note:'加仓计划。'},{now,source:'manual'}),current=stock({plans:[add]}),prepared=Workflow.prepare(current),createReduce=Workflow.process(JSON.stringify(envelope(prepared)),{stock:current,prepared});assert.equal(createReduce.ok,true,createReduce.message);
  const wrongUpdate=Workflow.process(JSON.stringify(envelope(prepared,{operation:'update',targetPlan:target(add),plan:draftPlan(),reason:'修改减仓计划。'})),{stock:current,prepared});assert.equal(wrongUpdate.ok,false);assert.match(wrongUpdate.message,/不能改变既有计划方向/);
  const changed=stock({plans:[PlanV2.applyAuthoritativeEdit(add,{note:'计划已经改变。'},{now:'2026-09-01T13:00:00Z'})]}),stale=Workflow.process(JSON.stringify(envelope(prepared,{operation:'invalidate',targetPlan:target(add),plan:null,reason:'明确失效。'})),{stock:changed,prepared});assert.equal(stale.ok,false);assert.match(stale.message,/当前计划或持仓状态已发生变化|当前计划已发生变化/);
});

test('a Current State-only save does not stale an independently prepared Plan draft',()=>{
  const original=stock(),prepared=Workflow.prepare(original),raw=JSON.stringify(envelope(prepared)),changed=stock({discussionState:{schemaVersion:Workbench.STORE_SCHEMA_VERSION,current:stateValue({stateId:'discussionstate_new',sourceDiscussionVersion:'discussion_v2_new',summary:'新的讨论结论。'}),history:[stateValue()]}}),result=Workflow.process(raw,{stock:changed,prepared});
  assert.equal(result.ok,true,result.message);assert.equal(result.writes,0);
});

test('preview does not write; explicit confirmation writes once, preserves history, and leaves protected domains unchanged',async()=>{
  const existing=PlanV2.createPlan({id:'reduce-1',action:'reduce',triggerPrice:60,triggerDirection:'above',quantity:100,conditions:{technical:['压力位确认。'],invalidation:['突破并站稳。']},note:'原减仓计划。'},{now,source:'manual'}),currentStock=stock({plans:[existing],technicalData:{technicalAsOf:'2026-09-01'},allocationDecision:{recommendedTargetWeight:15},longTermLogic:{logicStatus:'valid'}}),root={stocks:[currentStock],planReviews:{schemaVersion:'plan-review.store.v1',currentByPlan:{},history:[],snapshots:[]},portfolioReview:{current:{id:'review'}},updatedAt:1},prepared=Workflow.prepare(currentStock),result=Workflow.process(JSON.stringify(envelope(prepared,{operation:'update',targetPlan:target(existing),plan:draftPlan({note:'确认结构破坏后减仓。'}),reason:'讨论确认修改原减仓计划。'})),{stock:currentStock,prepared});
  const protectedBefore=structuredClone({discussionState:currentStock.discussionState,shares:currentStock.shares,technicalData:currentStock.technicalData,allocationDecision:currentStock.allocationDecision,longTermLogic:currentStock.longTermLogic,planReviews:root.planReviews,portfolioReview:root.portfolioReview}),saves=[];
  assert.equal(result.writes,0);assert.equal(saves.length,0);
  const committed=await Workflow.commit(result,root,{saveCandidate:async candidate=>{saves.push(structuredClone(candidate));return candidate}},{now:'2026-09-01T14:00:00Z'});
  assert.equal(committed.status,'completed');assert.equal(committed.writes,1);assert.equal(saves.length,1);
  const next=committed.state.stocks[0],retired=next.plans.find(plan=>plan.id==='reduce-1'),successor=next.plans.find(plan=>plan.id!=='reduce-1');assert.equal(retired.status,'replaced');assert(successor);assert.equal(successor.status,'active');assert.equal(successor.fullConditionStatus,'unproven');assert.equal(successor.note,'确认结构破坏后减仓。');
  assert.deepEqual({discussionState:next.discussionState,shares:next.shares,technicalData:next.technicalData,allocationDecision:next.allocationDecision,longTermLogic:next.longTermLogic,planReviews:committed.state.planReviews,portfolioReview:committed.state.portfolioReview},protectedBefore);
});

test('no_change creates no Plan version and lifecycle operations require explicit confirmation',async()=>{
  const existing=PlanV2.createPlan({id:'reduce-1',action:'reduce',triggerPrice:60,triggerDirection:'above',conditions:{technical:['压力位确认。'],invalidation:['突破并站稳。']},note:'原减仓计划。'},{now,source:'manual'}),current=stock({plans:[existing]}),root={stocks:[current]},prepared=Workflow.prepare(current),noChange=Workflow.process(JSON.stringify(envelope(prepared,{operation:'no_change',targetPlan:target(existing),plan:null,reason:'当前计划保持合适。'})),{stock:current,prepared}),noWrite=await Workflow.commit(noChange,root,{saveCandidate:async()=>{throw new Error('must not write')}});assert.equal(noWrite.status,'no_change');assert.equal(noWrite.writes,0);assert.equal(root.stocks[0].plans[0].planVersion,1);
  const invalidation=Workflow.process(JSON.stringify(envelope(prepared,{operation:'invalidate',targetPlan:target(existing),plan:null,reason:'讨论明确确认原计划失效。'})),{stock:current,prepared});assert.equal(invalidation.confirmReady,true);assert.equal(root.stocks[0].plans[0].status,'active');
});

test('create, invalidate, complete, and zero-position entry use one confirmed canonical save path',async()=>{
  async function apply(current,draft){const root={stocks:[current]},prepared=Workflow.prepare(current),preview=Workflow.process(JSON.stringify(envelope(prepared,draft)),{stock:current,prepared}),saves=[];assert.equal(preview.ok,true,preview.message);const result=await Workflow.commit(preview,root,{saveCandidate:async candidate=>{saves.push(candidate);return candidate}},{now:'2026-09-01T15:00:00Z'});assert.equal(result.status,'completed');assert.equal(result.writes,1);assert.equal(saves.length,1);return result.state.stocks[0]}
  const created=await apply(stock(),{});assert.equal(created.plans.length,1);assert.equal(created.plans[0].status,'active');assert.equal(created.plans[0].fullConditionStatus,'unproven');
  const zero=stock({shares:0}),zeroPrepared=Workflow.prepare(zero),entryPlan=draftPlan({action:'buy',quantity:null,allocationConstraint:{maxPositionPct:10,targetWeightRange:null},note:'条件确认后建仓。'}),entry=await apply(zero,{plan:entryPlan,reason:'本轮明确形成建仓计划。'});assert.equal(entry.plans[0].action,'buy');
  const invalidTarget=PlanV2.createPlan({id:'invalidate-1',action:'reduce',triggerPrice:60,triggerDirection:'above',conditions:{technical:['压力确认。'],invalidation:['突破。']},note:'待失效计划。'},{now,source:'manual'}),invalidated=await apply(stock({plans:[invalidTarget]}),{operation:'invalidate',targetPlan:target(invalidTarget),plan:null,reason:'讨论明确确认计划失效。'});assert.equal(invalidated.plans[0].status,'cancelled');assert.equal(invalidated.plans[0].invalidationReason,'讨论明确确认计划失效。');
  const completeTarget=PlanV2.createPlan({id:'complete-1',action:'reduce',triggerPrice:60,triggerDirection:'above',conditions:{technical:['压力确认。'],invalidation:['突破。']},note:'待完成计划。'},{now,source:'manual'}),completed=await apply(stock({plans:[completeTarget]}),{operation:'complete',targetPlan:target(completeTarget),plan:null,reason:'讨论明确确认计划生命周期完成。'});assert.equal(completed.plans[0].status,'completed');assert.equal(completed.plans[0].validityStatus,'completed');
  assert.equal(zeroPrepared.context.holding.status,'zero_position');
});

test('UI exposes the immediate modal, single import path, preview/confirm hierarchy, and mobile-safe layout',()=>{
  const root=path.resolve(__dirname,'..'),ui=fs.readFileSync(path.join(root,'src/ui-render.js'),'utf8'),html=fs.readFileSync(path.join(root,'index.html'),'utf8'),fixture=fs.readFileSync(path.join(root,'tests/fixtures/discussion-plan-mobile-acceptance.html'),'utf8');
  for(const wording of ['整理计划','计划整理已准备','请继续在当前 AI 对话中使用此 Prompt','已复制，可以在当前 AI 对话中继续','导入计划','预览','确认保存计划'])assert.match(ui,new RegExp(wording));
  const prepare=ui.slice(ui.indexOf('function prepareDiscussionPlan'),ui.indexOf('function ensureDiscussionArchiveContext'));assert.match(prepare,/DiscussionPlanWorkflow\.prepare/);assert.match(prepare,/openDiscussionPromptDialog\(stock,'plan'\)/);assert.doesNotMatch(prepare,/renderStockDetail|scrollIntoView|saveState/);
  const importer=ui.slice(ui.indexOf('function ensureDiscussionPlanImportDialog'),ui.indexOf('function aiDiscussionWorkspacePanel'));assert.match(importer,/DiscussionPlanWorkflow\.process/);assert.match(importer,/DiscussionPlanWorkflow\.renderPreview/);assert.match(importer,/DiscussionPlanWorkflow\.commit/);assert.match(importer,/confirmButton\.disabled=!result\.confirmReady/);
  assert.match(ui,/function v13PlanBusinessLabelMap/);assert.match(ui,/planDisplayEntries/);assert.match(ui,/当前正式计划：/);assert.match(ui,/未讨论计划保持不变/);
  assert.match(html,/src\/discussion-plan-workflow\.js/);assert.match(html,/discussion-plan-import-modal[^}]*max-height:min\(92dvh,820px\)[^}]*overflow:auto/);assert.match(html,/@media\(max-width:768px\)[\s\S]*discussion-plan-import-modal\{max-height:calc\(100dvh - 24px\)/);assert.match(html,/discussion-plan-summary>div\{grid-template-columns:1fr/);
  assert.match(fixture,/width:min\(390px,100%\)/);assert.match(fixture,/min-height:844px/);assert.match(fixture,/discussionPrepare/);assert.match(fixture,/discussionImport/);assert.match(fixture,/DiscussionPlanWorkflow\.prepare/);assert.match(fixture,/DiscussionPlanWorkflow\.process/);assert.match(fixture,/DiscussionPlanWorkflow\.commit/);assert.match(fixture,/scopedTargetPlanId/);assert.match(fixture,/\['update','global','scoped-null'\]/);assert.match(fixture,/正式计划写入次数/);assert.doesNotMatch(fixture,/discussionState|sourceDiscussionVersion|localStorage|indexedDB|fetch\(/);
});
