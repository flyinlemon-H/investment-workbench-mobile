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
  assert.equal(prepared.session.id,'session-fixture');assert.equal(prepared.session.version,1);assert.match(prepared.session.hash,/^plandraftsession_/);assert.match(prepared.session.protectedFactsHash,/^plandraftfacts_/);assert.equal(prepared.protectedFacts.symbol,'601138.SS');assert.equal(prepared.protectedFacts.holding.status,'held');assert.equal(prepared.protectedFacts.holding.shares,500);assert.equal(prepared.protectedFacts.holding.minTradeUnit,100);assert.deepEqual(prepared.protectedFacts.plans,[{id:'reduce-session',planVersion:1,snapshotHash:Workflow.planSnapshotHash(plan)}]);
});

test('holding or relevant Plan changes stale the session while Current State changes do not',()=>{
  const plan=PlanV2.createPlan({id:'reduce-stale',action:'reduce',triggerPrice:60,triggerDirection:'above',conditions:{technical:['压力确认。'],invalidation:['突破。']},note:'原计划。'},{now,source:'manual'}),current=stock({plans:[plan],discussionState:undefined}),prepared=Workflow.prepare(current),raw=JSON.stringify(envelope(prepared,{operation:'no_change',targetPlan:target(plan),plan:null,reason:'当前计划保持合适。'}));
  const holdingChanged=Workflow.process(raw,{stock:{...current,shares:400},prepared});assert.equal(holdingChanged.ok,false);assert.match(holdingChanged.message,/当前计划或持仓状态已发生变化/);
  const planChanged=Workflow.process(raw,{stock:{...current,plans:[PlanV2.applyAuthoritativeEdit(plan,{note:'已经变化。'},{now:'2026-09-01T13:00:00Z'})]},prepared});assert.equal(planChanged.ok,false);assert.match(planChanged.message,/当前计划或持仓状态已发生变化/);
  const stateOnly=Workflow.process(raw,{stock:{...current,discussionState:{schemaVersion:Workbench.STORE_SCHEMA_VERSION,current:stateValue({stateId:'new-state',sourceDiscussionVersion:'discussion_v2_new'}),history:[]}},prepared});assert.equal(stateOnly.ok,true,stateOnly.message);
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

test('quantity, allocation, held/zero-position, matching direction, and ambiguity rules are enforced',()=>{
  const held=stock(),prepared=Workflow.prepare(held);
  assert.match(Workflow.process(JSON.stringify(envelope(prepared,{plan:draftPlan({quantity:600})})),{stock:held,prepared}).message,/超过当前持仓/);
  assert.match(Workflow.process(JSON.stringify(envelope(prepared,{plan:draftPlan({quantity:150})})),{stock:held,prepared}).message,/最小交易单位 100/);
  assert.match(Workflow.process(JSON.stringify(envelope(prepared,{plan:draftPlan({allocationConstraint:{maxPositionPct:30,targetWeightRange:null}})})),{stock:held,prepared}).message,/超过程序当前保护上限/);
  const zero=stock({shares:0}),zeroPrepared=Workflow.prepare(zero),wrong=Workflow.process(JSON.stringify(envelope(zeroPrepared)),{stock:zero,prepared:zeroPrepared});assert.equal(wrong.ok,false);assert.match(wrong.message,/零持仓/);
  const entry=Workflow.process(JSON.stringify(envelope(zeroPrepared,{plan:draftPlan({action:'buy',quantity:null,allocationConstraint:{maxPositionPct:10,targetWeightRange:null},note:'建仓条件确认后进入计划。'}),reason:'讨论明确形成建仓计划。'})),{stock:zero,prepared:zeroPrepared});assert.equal(entry.ok,true,entry.message);
  const add=PlanV2.createPlan({id:'add-1',action:'add',triggerPrice:50,triggerDirection:'below',allocationConstraint:{maxPositionPct:20,targetWeightRange:null},conditions:{technical:['回踩确认。'],invalidation:['结构破坏。']},note:'加仓计划。'},{now,source:'manual'}),withAdd=stock({plans:[add]}),withAddPrepared=Workflow.prepare(withAdd),duplicate=Workflow.process(JSON.stringify(envelope(withAddPrepared,{plan:draftPlan({action:'add',allocationConstraint:{maxPositionPct:20,targetWeightRange:null}})})),{stock:withAdd,prepared:withAddPrepared});assert.match(duplicate.message,/已存在同方向当前计划/);
  const reduce=PlanV2.createPlan({id:'reduce-2',action:'reduce',triggerPrice:60,triggerDirection:'above',conditions:{technical:['压力确认。'],invalidation:['突破。']},note:'减仓计划。'},{now,source:'manual'}),multiple=stock({plans:[add,reduce]}),multiplePrepared=Workflow.prepare(multiple),ambiguous=Workflow.process(JSON.stringify(envelope(multiplePrepared,{operation:'no_change',targetPlan:null,plan:null,reason:'当前计划保持不变。'})),{stock:multiple,prepared:multiplePrepared});assert.match(ambiguous.message,/必须明确绑定/);
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
  assert.match(html,/src\/discussion-plan-workflow\.js/);assert.match(html,/discussion-plan-import-modal[^}]*max-height:min\(92dvh,820px\)[^}]*overflow:auto/);assert.match(html,/@media\(max-width:768px\)[\s\S]*discussion-plan-import-modal\{max-height:calc\(100dvh - 24px\)/);assert.match(html,/discussion-plan-summary>div\{grid-template-columns:1fr/);
  assert.match(fixture,/width:min\(390px,100%\)/);assert.match(fixture,/min-height:844px/);assert.match(fixture,/discussionPrepare/);assert.match(fixture,/discussionImport/);assert.match(fixture,/DiscussionPlanWorkflow\.prepare/);assert.match(fixture,/DiscussionPlanWorkflow\.process/);assert.match(fixture,/DiscussionPlanWorkflow\.commit/);assert.match(fixture,/正式计划写入次数/);assert.doesNotMatch(fixture,/discussionState|sourceDiscussionVersion|localStorage|indexedDB|fetch\(/);
});
