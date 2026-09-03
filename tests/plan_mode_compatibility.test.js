'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const Plan=require('../src/plan-v2'),Review=require('../src/plan-review'),Portfolio=require('../src/portfolio-review-context'),Discussion=require('../src/discussion-plan-workflow');
const root=path.resolve(__dirname,'..'),read=file=>fs.readFileSync(path.join(root,file),'utf8'),plain=value=>JSON.parse(JSON.stringify(value));
const historical={schemaVersion:'plan.v2',id:'historical-hash-v1',planVersion:7,action:'reduce',triggerPrice:35,triggerDirection:'above',quantity:100,status:'active',validityStatus:'active',createdAt:'2026-08-20T00:00:00Z',updatedAt:'2026-08-27T00:00:00Z',lastReviewedAt:'2026-08-27T00:00:00Z',priceTriggerStatus:'near',triggeredAt:null,fullConditionStatus:'unproven',conditions:{technical:['保持条件'],invalidation:[{text:'失效证据',status:'unconfirmed'}]},allocationConstraint:{maxPositionPct:12,targetWeightRange:'8%-12%'},source:'manual',note:'历史哈希固定样例',nextReviewDate:'2026-09-20',validUntil:'2026-12-31'};
const plan=overrides=>Plan.normalizePlan({...historical,...overrides});
const watch=overrides=>plan({id:'controlled-watch',planMode:'state_watch',triggerPrice:null,quantity:null,...overrides});
const stock=plans=>({id:'fixture',code:'600000.SS',name:'兼容性测试',type:'holding',shares:0,avgCost:0,currentPrice:34,capPct:12,plans});
async function runtime(plans=[]){
  const fields=new Map(),alerts=[],saved=[];let fail=false;
  const context={console,TextEncoder,Uint8Array,ArrayBuffer,AbortController,crypto:require('node:crypto').webcrypto,setTimeout:()=>0,clearTimeout(){},alert:msg=>alerts.push(msg),confirm:()=>{throw Error('unexpected confirmation')},navigator:{},document:{getElementById(id){if(!fields.has(id))fields.set(id,{value:'',innerHTML:'',style:{},dataset:{},classList:{add(){},remove(){},toggle(){}},focus(){},addEventListener(){}});return fields.get(id)},querySelectorAll:()=>[]}};
  context.window=context;context.globalThis=context;vm.createContext(context);
  vm.runInContext('globalThis.structuredClone=value=>JSON.parse(JSON.stringify(value))',context);
  for(const file of ['src/symbol-identity.js','src/strict-ai-json.js','src/plan-v2.js','src/plan-review.js','src/batch-technical-review.js','src/state.js','src/import-export.js','src/position.js','src/rebalance.js','src/v13-plan-engine.js','src/v13-recommendation-engine.js','src/ui-render.js','src/operation-entry.js','src/plan-update-draft.js','src/plan-review-ui.js','src/storage/storage-errors.js','src/storage/storage-validation.js','src/storage/draft-adapter.js','src/storage/storage-manager.js'])vm.runInContext(read(file),context,{filename:file});
  let persisted=null;
  const manager=context.InvestmentStorage.manager.create({localAdapter:{loadMainState:()=>persisted,saveMainState(value){if(fail)throw Error('fixture critical save failure');context.InvestmentStorage.validation.validateState(value);persisted=context.structuredClone(value);saved.push(plain(value))}},idbAdapter:{open:async()=>{throw Error('fixture offline IDB')},close(){}},draftAdapter:{initialize:async()=>{},flush:async()=>{},close(){}},clone:context.structuredClone});
  await manager.initialize();context.StorageManager=manager;
  const evaluate=code=>vm.runInContext(code,context);
  evaluate('state=normalize('+JSON.stringify({stocks:[stock(plans)],updatedAt:1})+');render=()=>{};currentTab="holding";');
  return {context,fields,alerts,saved,manager,evaluate,readState:()=>plain(evaluate('state')),fail:()=>{fail=true},close:()=>manager.close()};
}

test('mode is explicit, absent is legacy, invalid explicit values fail closed',()=>{
  for(const fields of [{},{triggerPrice:null,quantity:null,action:'observe'},{action:'reduce',note:'state_watch'}])assert.equal(plan(fields).planMode,'legacy_price');
  for(const mode of Plan.PLAN_MODES)assert.equal(plan({planMode:mode}).planMode,mode);
  for(const mode of [null,undefined,'','watch','LEGACY_PRICE',0]){assert.throws(()=>plan({planMode:mode}),/planMode/);assert.equal(Plan.validatePlan({...plan(),planMode:mode}).ok,false)}
  assert.throws(()=>Plan.applyAuthoritativeEdit(plan(),{planMode:'state_watch'}),/不可编辑/);
  assert.equal(plan({unknownFuture:'discard'}).unknownFuture,undefined);
});

test('historical plansnap fixture stays plansnap_ed0cd296 (captured from production baseline before edits)',()=>{
  assert.equal(Review.planSnapshotHash(historical),'plansnap_ed0cd296');
  assert.equal(Review.planSnapshotHash({...historical,planMode:'legacy_price'}),'plansnap_ed0cd296');
  assert.equal(Review.planSnapshotHash(plan()),'plansnap_ed0cd296');
});

for(const nullable of [{triggerPrice:null},{quantity:null},{triggerPrice:null,quantity:null}])test('real stock editor save preserves nullable '+JSON.stringify(nullable),async t=>{
  const r=await runtime([plan(nullable)]);t.after(r.close);const before=r.readState().stocks[0].plans;assert.doesNotMatch(r.readState().stocks[0].sellRule,/undefined/);
  r.context.openModal('fixture');r.fields.get('fName').value='仅修改股票名称';await r.context.save();
  assert.equal(r.alerts.length,0,r.alerts.join(';'));assert.equal(r.saved.length,1);assert.deepEqual(r.saved[0].stocks[0].plans,before);assert.equal(r.readState().stocks[0].name,'仅修改股票名称');
  await r.context.loadState();assert.deepEqual(r.readState().stocks[0].plans,before);
});

test('nullable note edit retains identity and increments only supported canonical revision',async t=>{
  const r=await runtime([plan({triggerPrice:null,quantity:null})]);t.after(r.close);r.context.openModal('fixture');r.evaluate('tempSell[0].note="明确更新备注"');await r.context.save();const p=r.readState().stocks[0].plans[0];assert.equal(p.id,historical.id);assert.equal(p.planVersion,8);assert.equal(p.triggerPrice,null);assert.equal(p.quantity,null);assert.deepEqual(p.conditions,plan().conditions);
});

test('explicit row removal still cancels the original Plan and preserves its ID',async t=>{
  const r=await runtime([plan({triggerPrice:null,quantity:null})]);t.after(r.close);r.context.openModal('fixture');r.evaluate('tempSell.splice(0,1)');await r.context.save();const p=r.readState().stocks[0].plans[0];assert.equal(p.status,'cancelled');assert.equal(p.id,historical.id);assert.equal(p.planVersion,8);
});

for(const row of [{triggerPrice:null,quantity:100},{triggerPrice:35,quantity:null},{triggerPrice:0,quantity:100},{triggerPrice:35,quantity:-1}])test('new invalid legacy editor row is rejected '+JSON.stringify(row),async t=>{
  const r=await runtime([]);t.after(r.close);r.context.openModal('fixture');r.evaluate('tempBuy.push('+JSON.stringify({id:'',action:'buy',triggerDirection:'below',...row})+')');await r.context.save();assert.equal(r.saved.length,0);assert.match(r.alerts.join(';'),/新计划/);assert.equal(r.readState().stocks[0].plans.length,0);
});

test('new valid legacy row still saves and mode injection cannot change an existing row',async t=>{
  const r=await runtime([]);t.after(r.close);r.context.openModal('fixture');r.evaluate('tempBuy.push({id:"",action:"buy",triggerPrice:30,quantity:100,triggerDirection:"below"})');await r.context.save();assert.equal(r.saved.length,1);assert.equal(r.readState().stocks[0].plans[0].planMode,'legacy_price');r.context.openModal('fixture');r.evaluate('tempBuy[0].planMode="state_watch"');await r.context.save();assert.equal(r.saved.length,1);assert.match(r.alerts.join(';'),/状态观察/);
});

test('mixed same-content Plans keep separate IDs, order, modes through editor export import critical storage reload',async t=>{
  const plans=[plan({id:'first'}),watch(),plan({id:'second'})],r=await runtime(plans);t.after(r.close);const before=r.readState().stocks[0].plans;
  r.context.openModal('fixture');assert.equal(r.evaluate('tempSell.length'),2);assert.match(r.fields.get('planEditorReadOnly').innerHTML,/状态观察计划/);r.fields.get('fNotes').value='metadata only';await r.context.save();
  assert.deepEqual(r.readState().stocks[0].plans,before);
  r.evaluate('globalThis.exported=alpha3ExportSnapshot(state);globalThis.imported=createValidatedCandidateSnapshot(JSON.parse(JSON.stringify(exported)))');await r.context.persistCandidateSnapshot(r.context.imported);await r.context.loadState();assert.deepEqual(r.readState().stocks[0].plans,before);
});

test('critical save failure leaves canonical state intact',async t=>{
  const r=await runtime([watch()]);t.after(r.close);const before=r.readState();r.context.openModal('fixture');r.fields.get('fName').value='failed mutation';r.fail();await r.context.save();assert.deepEqual(r.readState(),before);assert.equal(r.saved.length,0);
});

test('invalid mode in candidate is rejected with zero writes',async()=>{let writes=0;const result=await Plan.commitCandidate({stocks:[stock([plan()])]},candidate=>{candidate.stocks[0].plans[0].planMode='unknown';return candidate},{save:()=>writes++});assert.equal(result.status,'invalid');assert.equal(writes,0)});

test('state watch with trade-like action price quantity never executes or synthesizes legacy signals',async t=>{
  const p=watch({action:'sell',triggerPrice:30,triggerDirection:'above',quantity:100,priceTriggerStatus:'triggered'}),r=await runtime([p]);t.after(r.close);const before=r.readState();await r.context.executePlan('fixture',p.id);assert.equal(r.saved.length,0);assert.match(r.alerts.join(';'),/不能记录/);assert.deepEqual(r.readState(),before);
  assert.equal(r.context.v13DerivedPlanTriggered(stock([p]),p),false);assert.equal(r.context.checkPlanTriggerLevel(p,{price:40},{}),'none');assert.equal(r.context.v13RecommendationFromPlan({},p,{price:40},{}),null);assert.equal(r.context.stockUrgency(stock([p])).triggered,0);assert.equal(r.context.v13PlanGapInfo(stock([p]),p),null);assert.equal(r.context.v13PlanDisplayCategory(p),'observe');assert.equal(r.context.v13DerivedPlanValidity(stock([p]),p).homeEligible,false);
  assert.equal(r.context.getActivePlanByType([p],'sell'),null);assert.deepEqual(plain(r.context.getDisplayActivePlans([p])),[]);
  assert.equal(r.context.chips([p],'sell',40),'');const readOnlyHtml=r.context.planListHtml([p],'observe',40);assert.match(readOnlyHtml,/仅供只读参考/);assert.doesNotMatch(readOnlyHtml,/class="trig-row (?:buy|sell)"/);assert.match(r.context.formatPlanForDiscussion(stock([p]),p),/只读/);
  const operation=r.context.OperationEntry.defaultDraft(r.context.OperationEntry.manualContext(stock([p])));assert.equal(operation.new_shares,0);assert.equal(operation.previous_shares,0);assert.equal(operation.action,undefined);
});

test('state watch price evaluation is neutral and quote observation preserves canonical content',()=>{
  const p=watch({triggerPrice:35,triggerDirection:'above',quantity:100,priceTriggerStatus:'near',triggeredAt:'2026-08-28T00:00:00Z'});assert.equal(Plan.evaluatePriceTrigger(p,40).status,'unavailable');assert.deepEqual(Plan.observePriceTrigger(p,40),p);assert.deepEqual(Plan.normalizePlan(p,{currentPrice:40,observePrice:true}),p);
  const legacy=plan({priceTriggerStatus:'not_triggered',triggeredAt:null}),near=Plan.observePriceTrigger(legacy,34),crossed=Plan.observePriceTrigger(near,35,{now:'2026-09-03T00:00:00Z'});assert.equal(near.priceTriggerStatus,'near');assert.equal(crossed.priceTriggerStatus,'triggered');assert.equal(crossed.triggeredAt,'2026-09-03T00:00:00Z');assert.equal(crossed.planVersion,7);assert.equal(crossed.fullConditionStatus,'unproven');
});

test('legacy versions retain no-op edit reconfirm termination semantics',()=>{const p=plan();assert.equal(Plan.applyAuthoritativeEdit(p,{note:p.note}).planVersion,7);assert.equal(Plan.reconfirmPlan(p).planVersion,8);assert.equal(Plan.terminatePlan(p,'completed').planVersion,8);for(const fn of [()=>Plan.applyAuthoritativeEdit(watch(),{note:'x'}),()=>Plan.reconfirmPlan(watch()),()=>Plan.terminatePlan(watch(),'completed')])assert.throws(fn,/状态观察/)});

test('old TradePlan and AI refresh converters reject explicit state watch at root or item',async t=>{
  const r=await runtime([watch()]);t.after(r.close);for(const input of [{planMode:'state_watch',planItems:[]},{planItems:[{planMode:'state_watch',action:'sell',triggerPrice:35,quantity:100}]}]){assert.throws(()=>r.context.normalizeImportedTradePlan(input,stock([])),/状态观察/);assert.throws(()=>r.context.tradePlanToPlans(input,stock([])),/状态观察/)}
  assert.throws(()=>r.context.v13NormalizeImportedRefreshPlan(stock([]),watch(),''),/状态观察/);assert.equal(r.context.v13ValidatePlanRefreshPayload(stock([]),{planMode:'state_watch',symbol:'600000.SS',plans:[]}).ok,false);
});

test('PlanReview builds neutral context renders read-only and refuses edits with zero writes',async t=>{
  const p=watch({action:'buy',triggerPrice:35,quantity:100}),s=stock([p]),ctx=Review.buildContext([s],{portfolioContext:Portfolio,reviewDate:'2026-09-03'});assert.equal(ctx.stocks[0].plans[0].action,'observe');assert.equal(ctx.stocks[0].plans[0].priceTriggerStatus,'unavailable');assert.equal(ctx.stocks[0].plans[0].readOnly,true);
  let writes=0;for(const action of ['reconfirm','complete','invalidate','edit']){const result=await Review.applyPlanActions({stocks:[s]},[{action,symbol:s.code,planId:p.id,patch:{note:'x'},reason:'test'}],{saveCandidate:()=>writes++});assert.equal(result.status,'invalid')}assert.equal(writes,0);
  const r=await runtime([p]);t.after(r.close);r.evaluate('state.planReviews=PlanReview.normalizeStore({currentByPlan:{"600000.SS|controlled-watch":'+JSON.stringify({reviewId:'review-fixture',planId:p.id,planVersion:p.planVersion,planSnapshotHash:Review.planSnapshotHash(p),symbol:s.code,reviewOutcome:'still_valid',summary:'只读复核',reviewedAt:'2026-09-03T00:00:00Z',confidence:'medium',reviewDate:'2026-09-03'})+'}})');r.context.PlanReviewUI.renderSaved();const html=r.fields.get('planReviewBody').innerHTML;assert.match(html,/状态观察计划/);assert.match(html,/data-plan-review-edit=[^>]+disabled/);assert.doesNotMatch(html,/data-plan-review-batch=/);
});

test('Discussion keeps state watch as reference but rejects targeted legacy Draft operations',()=>{
  const p=watch({action:'reduce',triggerPrice:35,quantity:100}),s=stock([p]),prepared=Discussion.prepare(s);assert.equal(prepared.context.plans[0].readOnly,true);assert.equal(prepared.context.plans[0].quantity,null);
  const draft={schemaVersion:Discussion.SCHEMA_VERSION,operation:'no_change',symbol:s.code,...prepared.binding,targetPlan:{id:p.id,planVersion:p.planVersion,snapshotHash:Review.planSnapshotHash(p)},plan:null,reason:'保持不变',risks:[],unresolvedItems:[]};const result=Discussion.process(JSON.stringify(draft),{stock:s,prepared});assert.equal(result.ok,false);assert.match(result.errors.join(';'),/状态观察/);
});


test('generic candidate cannot change or remove the mode of an existing ID',async()=>{
  for(const [original,next] of [[watch(),plan({id:'controlled-watch'})],[plan(),watch({id:historical.id})]]){let writes=0;const result=await Plan.commitCandidate({stocks:[stock([original])]},candidate=>{candidate.stocks[0].plans=[next];return candidate},{save:()=>writes++});assert.equal(result.status,'invalid');assert.match(result.error.message,/planMode/);assert.equal(writes,0)}
});

test('confirmed AI refresh replacement preserves controlled state watch and archives only legacy',async t=>{
  const r=await runtime([watch(),plan()]);t.after(r.close);const before=r.readState().stocks[0].plans[0],row={type:'observe',status:'active',summary:'新增旧模式观察',validity:{nextReviewDate:'2026-12-31'},reviewRequirement:{conditions:['人工确认']},triggerPrice:null,quantity:null,riskFlags:[],notes:[]};
  const result=await r.context.v13ImportPlanRefreshPayload(r.evaluate('state.stocks[0]'),{symbol:'600000.SS',replaceExistingPlans:true,plans:[row]},{confirmed:true});assert.equal(result.ok,true);const plans=r.readState().stocks[0].plans;assert.deepEqual(plans[0],before);assert.equal(plans[1].status,'replaced');assert.equal(plans[1].planVersion,8);assert.equal(plans[2].planMode,'legacy_price');
});

test('old PlanUpdateDraft validates baseline but rejects mode injection and guarded archive targets',async t=>{
  const r=await runtime([watch()]);t.after(r.close);const stock=r.evaluate('state.stocks[0]'),ctx={stock,request:{request_id:'request',source_decision_id:'decision',symbol:stock.code}},draft={draft_id:'draft',source_request_id:'request',source_decision_id:'decision',symbol:stock.code,draft_status:'draft',summary:'fixture',plan_strategy:'fixture',proposed_plans:[{plan_id:null,action_type:'observe',trigger_price:null,quantity:null,status:'active',priority:1,reason:'fixture',conditions:[],invalidation_conditions:[],source:'ai_plan_update_draft',valid_until:'2026-12-31'}],plans_to_archive:[],risk_flags:[],notes:[],created_at:'2026-09-03T00:00:00Z'};
  assert.equal(r.context.PlanUpdateDraft.validate(draft,ctx).business_valid,true);
  for(const change of [{planMode:'state_watch'},{plans_to_archive:['controlled-watch']},{proposed_plans:[{...draft.proposed_plans[0],plan_id:'controlled-watch'}]},{proposed_plans:[{...draft.proposed_plans[0],planMode:'state_watch'}]}])assert.equal(r.context.PlanUpdateDraft.validate({...draft,...change},ctx).business_valid,false);
  assert.throws(()=>r.context.PlanUpdateDraft.formalPlan(watch()),/状态观察/);
});

test('real quote refresh updates price and preserves state watch canonical content without runtime transitions',async t=>{
  const r=await runtime([watch({triggerPrice:35,quantity:100,priceTriggerStatus:'near'})]);t.after(r.close);vm.runInContext(read('src/price-refresh.js'),r.context);r.evaluate('fetchStockPrice=async()=>({price:50,source:"fixture",updatedAt:"2026-09-03T00:00:00Z",change:1})');const before=r.readState().stocks[0].plans[0],result=await r.context.runPriceRefresh('fixture',{silent:true});assert.equal(result.ok,true);assert.equal(r.saved.length,1);assert.equal(r.readState().stocks[0].currentPrice,50);assert.deepEqual(r.readState().stocks[0].plans[0],before);assert.equal(r.readState().stocks[0].shares,0);
});
