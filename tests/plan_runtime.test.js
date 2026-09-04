'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const Plan=require('../src/plan-v2.js'),Review=require('../src/plan-review.js'),Discussion=require('../src/discussion-workbench.js'),Runtime=require('../src/plan-runtime.js');
const Universe=require('../src/universe-auto-add.js');
const root=path.resolve(__dirname,'..'),clone=value=>JSON.parse(JSON.stringify(value));
const definition=(name='支撑结构观察')=>({planMode:'state_watch',name,applicableConditions:['中期趋势仍可观察'],entryConditions:['进入约定结构区域时开始观察'],confirmationConditions:['结构得到进一步确认'],invalidationConditions:['关键结构被有效破坏'],reviewAction:'hold_watch',priceReferences:[],allocationConstraint:{maxPositionPct:15,targetWeightRange:null},note:'保持人工复核',validUntil:null,nextReviewDate:null});
function current(version='discussion_v1',stateId=`state_${version}`){
  return Discussion.normalizeState({schemaVersion:Discussion.LEGACY_STATE_SCHEMA_VERSION,stateId,symbol:'600000.SS',sourceDiscussionVersion:version,stage:'结构观察',summary:'当前处于结构观察阶段，仍需等待进一步确认。',keyChanges:[],risks:['结构可能转弱'],watchPoints:['观察确认条件'],planRelation:'与观察纪律一致',confidence:'medium',technicalAsOf:'2026-09-03',confirmedAt:'2026-09-04T01:00:00.000Z',confirmedDate:'2026-09-04',technicalSnapshot:{anchorBar:{date:'2026-09-03',close:10,adjustment:'qfq',priceBasis:'close',provider:'fixture'}},references:{technical:{technicalAsOf:'2026-09-03',latestCompleteBar:'2026-09-03',anchorBar:{date:'2026-09-03',close:10,adjustment:'qfq',priceBasis:'close',provider:'fixture'}},plans:[],planReviews:[],holding:{},longTermLogic:{},modules:{}}});
}
function stock(plans=[Plan.createWatchPlan(definition(),{now:'2026-09-04T00:00:00.000Z'})],discussion=current()){
  return {id:'stock_runtime',code:'600000.SS',name:'Runtime Fixture',type:'holding',shares:0,avgCost:0,capPct:20,plans,discussionState:{schemaVersion:Discussion.STORE_SCHEMA_VERSION,current:discussion,history:[]}};
}
function state(plans,discussion){return {stocks:[stock(plans,discussion)],updatedAt:1,planRuntimeStates:Runtime.defaultStore(),executionLog:[]}}
const judgment=(phase='forming',assessment='advance',overrides={})=>({planRuntimeReview:{suggestedPhase:phase,transitionAssessment:assessment,summary:'已经进入观察窗口，结构正在形成但确认尚未完成。',evidence:['当前结论支持继续观察结构'],watchPoints:['确认条件是否完成'],risks:['关键结构被破坏时应降级'],confidence:'medium',...overrides}});
async function apply(appState,planId,review,now='2026-09-04T02:00:00.000Z'){
  let adopted=appState,writes=0;const prepared=Runtime.prepare(appState,appState.stocks[0].id,planId),preview=Runtime.process(JSON.stringify(review),{state:appState,prepared});
  const result=await Runtime.commit(preview,appState,{saveCandidate:async()=>{writes++},adoptCandidate:candidate=>{adopted=candidate}},{confirmed:true,now});
  return {prepared,preview,result,state:adopted,writes};
}

test('missing Runtime branch is a deterministic empty store and does not alter Plan Definition',()=>{
  assert.deepEqual(Runtime.normalizeStore(undefined),Runtime.defaultStore());
  const plan=Plan.createWatchPlan(definition(),{now:'2026-09-04T00:00:00.000Z'}),before=clone(plan);
  assert.equal(Runtime.runtimeFor({stocks:[stock([plan])]},plan.id),null);assert.deepEqual(plan,before);
});

test('first Runtime review previews then commits revision 1 with exact protected bindings',async()=>{
  const plan=Plan.createWatchPlan(definition(),{now:'2026-09-04T00:00:00.000Z'}),appState=state([plan]),before=clone(plan),run=await apply(appState,plan.id,judgment());
  assert.equal(run.preview.outcome,'first');assert.equal(run.preview.confirmReady,true);assert.equal(run.writes,1);assert.equal(run.result.status,'completed');
  const runtime=Runtime.runtimeFor(run.state,plan.id);assert.equal(runtime.runtimeRevision,1);assert.equal(runtime.phase,'forming');assert.equal(runtime.sourcePlanVersion,1);assert.equal(runtime.sourcePlanSnapshotHash,Review.planSnapshotHash(plan));assert.equal(runtime.sourceCurrentStateId,'state_discussion_v1');assert.equal(runtime.sourceDiscussionVersion,'discussion_v1');assert.equal(runtime.history.length,1);assert.equal(runtime.history[0].fromPhase,null);assert.deepEqual(run.state.stocks[0].plans[0],before);
});

test('forming to confirmed increments runtimeRevision only and preserves Plan snapshot',async()=>{
  const plan=Plan.createWatchPlan(definition(),{now:'2026-09-04T00:00:00.000Z'}),appState=state([plan]),first=await apply(appState,plan.id,judgment()),hash=Review.planSnapshotHash(first.state.stocks[0].plans[0]);
  const second=await apply(first.state,plan.id,judgment('confirmed','advance',{summary:'结构与确认条件已得到实质满足。'}),'2026-09-04T03:00:00.000Z'),runtime=Runtime.runtimeFor(second.state,plan.id);
  assert.equal(runtime.runtimeRevision,2);assert.equal(runtime.phase,'confirmed');assert.equal(runtime.history.length,2);assert.equal(runtime.history[1].fromPhase,'forming');assert.equal(runtime.history[1].toPhase,'confirmed');assert.equal(second.state.stocks[0].plans[0].planVersion,1);assert.equal(Review.planSnapshotHash(second.state.stocks[0].plans[0]),hash);
});

test('identical hold is canonical no_change with zero writes and no history noise',async()=>{
  const plan=Plan.createWatchPlan(definition(),{now:'2026-09-04T00:00:00.000Z'}),first=await apply(state([plan]),plan.id,judgment()),runtime=clone(Runtime.runtimeFor(first.state,plan.id));
  const same=judgment('forming','hold'),run=await apply(first.state,plan.id,same);
  assert.equal(run.preview.outcome,'no_change');assert.equal(run.preview.confirmReady,false);assert.equal(run.result.status,'no_change');assert.equal(run.writes,0);assert.deepEqual(Runtime.runtimeFor(run.state,plan.id),runtime);
});

test('multiple state-watch Plans keep independent Runtime records',async()=>{
  const a=Plan.createWatchPlan(definition('计划 A'),{now:'2026-09-04T00:00:00.000Z'}),b=Plan.createWatchPlan(definition('计划 B'),{now:'2026-09-04T00:01:00.000Z'}),appState=state([a,b]);
  const first=await apply(appState,a.id,judgment('watch_zone','advance')),second=await apply(first.state,b.id,judgment('confirmed','advance'));
  assert.equal(Runtime.runtimeFor(second.state,a.id).phase,'watch_zone');assert.equal(Runtime.runtimeFor(second.state,b.id).phase,'confirmed');assert.equal(Object.keys(second.state.planRuntimeStates.byPlanId).length,2);
});

test('Plan version or snapshot change after Preview blocks Confirm with zero writes',async()=>{
  for(const kind of ['version','snapshot']){
    const plan=Plan.createWatchPlan(definition(),{now:'2026-09-04T00:00:00.000Z'}),appState=state([plan]),prepared=Runtime.prepare(appState,'stock_runtime',plan.id),preview=Runtime.process(JSON.stringify(judgment()),{state:appState,prepared});
    if(kind==='version')appState.stocks[0].plans[0]=Plan.editWatchPlan(plan,definition('已编辑定义'),{now:'2026-09-04T01:00:00.000Z'});else appState.stocks[0].plans[0].updatedAt='2026-09-04T01:00:00.000Z';
    let writes=0;const result=await Runtime.commit(preview,appState,{saveCandidate:async()=>writes++},{confirmed:true});assert.equal(result.status,'stale');assert.equal(writes,0);assert.equal(Runtime.runtimeFor(appState,plan.id),null);
  }
});

test('Current State identity change after Preview blocks Confirm and does not silently rebind',async()=>{
  const plan=Plan.createWatchPlan(definition(),{now:'2026-09-04T00:00:00.000Z'}),appState=state([plan]),prepared=Runtime.prepare(appState,'stock_runtime',plan.id),preview=Runtime.process(JSON.stringify(judgment()),{state:appState,prepared});
  appState.stocks[0].discussionState.current=current('discussion_v2');let writes=0;const result=await Runtime.commit(preview,appState,{saveCandidate:async()=>writes++},{confirmed:true});assert.equal(result.status,'stale');assert.equal(writes,0);assert.equal(Runtime.runtimeFor(appState,plan.id),null);
});

test('Definition edit leaves existing Runtime revision and phase untouched but derives stale binding',async()=>{
  const plan=Plan.createWatchPlan(definition(),{now:'2026-09-04T00:00:00.000Z'}),first=await apply(state([plan]),plan.id,judgment()),before=clone(Runtime.runtimeFor(first.state,plan.id));
  first.state.stocks[0].plans[0]=Plan.editWatchPlan(first.state.stocks[0].plans[0],definition('定义已更新'),{now:'2026-09-04T04:00:00.000Z'});
  assert.deepEqual(Runtime.runtimeFor(first.state,plan.id),before);assert.equal(Runtime.bindingStatus(first.state,plan.id),'definition_changed');assert.equal(first.state.stocks[0].plans[0].planVersion,2);
});

test('Current State change marks Runtime stale while keeping its historical judgment',async()=>{
  const plan=Plan.createWatchPlan(definition(),{now:'2026-09-04T00:00:00.000Z'}),first=await apply(state([plan]),plan.id,judgment()),before=clone(Runtime.runtimeFor(first.state,plan.id));
  first.state.stocks[0].discussionState.current=current('discussion_v2');assert.deepEqual(Runtime.runtimeFor(first.state,plan.id),before);assert.equal(Runtime.bindingStatus(first.state,plan.id),'current_state_changed');
});

test('explicit review of a stale Runtime refreshes protected bindings even when judgment text is unchanged',async()=>{
  const plan=Plan.createWatchPlan(definition(),{now:'2026-09-04T00:00:00.000Z'}),first=await apply(state([plan]),plan.id,judgment());first.state.stocks[0].discussionState.current=current('discussion_v2');
  const refreshed=await apply(first.state,plan.id,judgment('forming','hold'),'2026-09-04T04:00:00.000Z'),runtime=Runtime.runtimeFor(refreshed.state,plan.id);assert.equal(refreshed.preview.outcome,'change');assert.equal(refreshed.writes,1);assert.equal(runtime.runtimeRevision,2);assert.equal(runtime.sourceCurrentStateId,'state_discussion_v2');assert.equal(runtime.sourceDiscussionVersion,'discussion_v2');assert.equal(Runtime.bindingStatus(refreshed.state,plan.id),'current');
});

test('history is capped at 30, retains latest entries and stays internally valid',()=>{
  const plan=Plan.createWatchPlan(definition(),{now:'2026-09-04T00:00:00.000Z'}),binding={planId:plan.id,planVersion:1,snapshotHash:Review.planSnapshotHash(plan),stateId:'state_discussion_v1',sourceDiscussionVersion:'discussion_v1'};let record=null;
  for(let index=1;index<=35;index++)record=Runtime.buildRecord(record,{suggestedPhase:'forming',transitionAssessment:'hold',summary:`有意义的同阶段复核 ${index}`,evidence:['证据'],watchPoints:['观察'],risks:['风险'],confidence:'medium'},binding,new Date(Date.UTC(2026,8,4,0,index)).toISOString());
  assert.equal(record.runtimeRevision,35);assert.equal(record.history.length,30);assert.equal(record.history[0].runtimeRevision,6);assert.equal(record.history.at(-1).runtimeRevision,35);assert.equal(Runtime.validateRecord(record).ok,true,Runtime.validateRecord(record).errors.join(';'));
});

test('action_review requires explicit confirmation and never creates execution, holding or order state',async()=>{
  const plan=Plan.createWatchPlan(definition(),{now:'2026-09-04T00:00:00.000Z'}),first=await apply(state([plan]),plan.id,judgment('confirmed','advance'));
  const prepared=Runtime.prepare(first.state,'stock_runtime',plan.id),preview=Runtime.process(JSON.stringify(judgment('action_review','advance',{summary:'条件足以进入人工操作复核。'})),{state:first.state,prepared});let writes=0;
  const blocked=await Runtime.commit(preview,first.state,{saveCandidate:async()=>writes++},{confirmed:false});assert.equal(blocked.status,'confirmation_required');assert.equal(writes,0);
  const run=await Runtime.commit(preview,first.state,{saveCandidate:async()=>writes++,adoptCandidate:candidate=>{first.state=candidate}},{confirmed:true,now:'2026-09-04T05:00:00.000Z'}),runtime=Runtime.runtimeFor(first.state,plan.id);
  assert.equal(run.status,'completed');assert.equal(runtime.phase,'action_review');assert.equal(runtime.history.at(-1).acknowledgedAt,'2026-09-04T05:00:00.000Z');assert.equal(first.state.executionLog.length,0);for(const key of ['orders','tradeHistory','brokerFacts'])assert.equal(first.state[key],undefined);assert.equal(first.state.stocks[0].shares,0);
});

test('invalidated changes Runtime only and leaves Plan Definition present',async()=>{
  const plan=Plan.createWatchPlan(definition(),{now:'2026-09-04T00:00:00.000Z'}),first=await apply(state([plan]),plan.id,judgment()),run=await apply(first.state,plan.id,judgment('invalidated','invalidate',{summary:'关键失效条件已被实质触发。'}));
  assert.equal(Runtime.runtimeFor(run.state,plan.id).phase,'invalidated');assert.equal(run.state.stocks[0].plans.length,1);assert.equal(run.state.stocks[0].plans[0].status,'active');assert.equal(run.state.stocks[0].plans[0].planVersion,1);
});

test('legacy plans and missing Current State fail early without a Runtime session',()=>{
  const legacy=Plan.createPlan({action:'buy',triggerPrice:9,quantity:100},{now:'2026-09-04T00:00:00.000Z'}),legacyState=state([legacy]);assert.throws(()=>Runtime.prepare(legacyState,'stock_runtime',legacy.id),/旧版价格计划/);
  const watch=Plan.createWatchPlan(definition(),{now:'2026-09-04T00:00:00.000Z'}),missing=state([watch]);missing.stocks[0].discussionState=Discussion.defaultStore();assert.throws(()=>Runtime.prepare(missing,'stock_runtime',watch.id),/请先完成一次个股讨论/);
});

test('strict AI and persisted Runtime schemas reject unknown, contradictory and malformed data',async()=>{
  const plan=Plan.createWatchPlan(definition(),{now:'2026-09-04T00:00:00.000Z'}),appState=state([plan]);
  for(const raw of [JSON.stringify({planRuntimeReview:{...judgment().planRuntimeReview,planId:plan.id}}),JSON.stringify(judgment('confirmed','hold')),'```json\n{"planRuntimeReview":\n```']){
    const prepared=Runtime.prepare(appState,'stock_runtime',plan.id),result=Runtime.process(raw,{state:appState,prepared});assert.equal(result.ok,false);assert.equal(result.writes,0);
  }
  const first=await apply(appState,plan.id,judgment()),store=clone(first.state.planRuntimeStates);store.extra=true;assert.equal(Runtime.validateStore(store).ok,false);delete store.extra;store.byPlanId[plan.id].history=[];assert.equal(Runtime.validateStore(store).ok,false);
});

test('orphan Runtime is preserved and derives missing_plan rather than rebinding by symbol',async()=>{
  const plan=Plan.createWatchPlan(definition(),{now:'2026-09-04T00:00:00.000Z'}),first=await apply(state([plan]),plan.id,judgment()),runtime=clone(Runtime.runtimeFor(first.state,plan.id));first.state.stocks[0].plans=[];
  assert.equal(Runtime.bindingStatus(first.state,plan.id),'missing_plan');assert.deepEqual(Runtime.runtimeFor(first.state,plan.id),runtime);assert.equal(Runtime.validateStore(first.state.planRuntimeStates).ok,true);
});

test('critical or stale-tab save failure preserves the previous Runtime atomically',async()=>{
  for(const error of [new Error('disk failed'),Object.assign(new Error('stale tab'),{type:'stale_tab'})]){
    const plan=Plan.createWatchPlan(definition(),{now:'2026-09-04T00:00:00.000Z'}),appState=state([plan]),prepared=Runtime.prepare(appState,'stock_runtime',plan.id),preview=Runtime.process(JSON.stringify(judgment()),{state:appState,prepared}),before=clone(appState);let adopted=false;
    const result=await Runtime.commit(preview,appState,{saveCandidate:async()=>{throw error},adoptCandidate:()=>{adopted=true}},{confirmed:true});assert.equal(result.status,'failed');assert.equal(result.writes,0);assert.equal(result.attemptedWrites,1);assert.equal(adopted,false);assert.deepEqual(appState,before);
  }
});

test('raw import rejects malformed Runtime before normalization can drop or repair it',()=>{
  const context={console,PlanV2:Plan,PlanRuntime:Runtime,normalize:value=>value,structuredClone:clone};context.globalThis=context;vm.createContext(context);vm.runInContext(fs.readFileSync(path.join(root,'src/import-export.js'),'utf8'),context);
  context.payload={stocks:[],planRuntimeStates:{schemaVersion:Runtime.STORE_SCHEMA_VERSION,byPlanId:{bad:{schemaVersion:Runtime.SCHEMA_VERSION,planId:'bad'}}}};
  assert.throws(()=>vm.runInContext('createValidatedCandidateSnapshot(payload)',context),/Runtime|字段|history/);
});

test('canonical storage validation accepts valid or orphan Runtime and rejects malformed records',async()=>{
  const plan=Plan.createWatchPlan(definition(),{now:'2026-09-04T00:00:00.000Z'}),first=await apply(state([plan]),plan.id,judgment()),context={console,PlanV2:Plan,PlanRuntime:Runtime,SymbolIdentity:require('../src/symbol-identity.js')};context.globalThis=context;vm.createContext(context);for(const file of ['src/storage/storage-errors.js','src/storage/storage-validation.js'])vm.runInContext(fs.readFileSync(path.join(root,file),'utf8'),context);
  context.payload=JSON.stringify(first.state);assert.doesNotThrow(()=>vm.runInContext('InvestmentStorage.validation.validateState(JSON.parse(payload))',context));const orphan=clone(first.state);orphan.stocks[0].plans=[];context.payload=JSON.stringify(orphan);assert.doesNotThrow(()=>vm.runInContext('InvestmentStorage.validation.validateState(JSON.parse(payload))',context));orphan.planRuntimeStates.byPlanId[plan.id].runtimeRevision=0;context.payload=JSON.stringify(orphan);assert.throws(()=>vm.runInContext('InvestmentStorage.validation.validateState(JSON.parse(payload))',context));
});

test('Runtime-only canonical commits produce an empty Stock Universe diff',async()=>{
  const plan=Plan.createWatchPlan(definition(),{now:'2026-09-04T00:00:00.000Z'}),appState=state([plan]),before=Universe.projection(appState),first=await apply(appState,plan.id,judgment());assert.deepEqual(Universe.projection(first.state),before);
  const memory=new Map(),requests=[],queue=Universe.createQueue({storage:{getItem:key=>memory.get(key)??null,setItem:(key,value)=>memory.set(key,value)},key:'runtime-universe',online:()=>true,insert:async row=>requests.push(row)});await queue.initialize(appState);await queue.setUser('aa000000-0000-4000-8000-000000000001');await queue.committed(first.state);await queue.pump();assert.deepEqual(requests,[]);
});

test('pre-Phase2 normalizer preserves the unknown top-level Runtime branch on routine save',()=>{
  const context={console};context.globalThis=context;context.window=context;vm.createContext(context);vm.runInContext(fs.readFileSync(path.join(root,'src/state.js'),'utf8'),context);
  const sentinel={schemaVersion:'plan-runtime.store.v1',byPlanId:{keep:{sentinel:true}}};context.payload=JSON.stringify({stocks:[],updatedAt:1,planRuntimeStates:sentinel});const result=JSON.parse(vm.runInContext('JSON.stringify(normalize(JSON.parse(payload)))',context));assert.deepEqual(result.planRuntimeStates,sentinel);
});
