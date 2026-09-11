'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const W=require('../src/discussion-workbench.js'),C=require('../src/discussion-state-contract.js'),F=require('./fixtures/discussion-reliability.js'),Plan=require('../src/plan-v2.js');
const manual={transport:'manual'},copy=value=>JSON.parse(JSON.stringify(value));
function scenario(before,after,kind='none'){
  const stock=F.stock(kind,before),state={stocks:[stock]},prepared=W.buildDiscussionRequest(stock,{state});
  stock.shares=after;const current=W.buildContext(stock,{state}),raw=F.judgment(current);raw.currentState.sourceDiscussionVersion=prepared.sourceDiscussionVersion;
  return {stock,state,prepared,current,raw:JSON.stringify(raw)};
}
function preview(s,raw=s.raw){const warning=C.processImport(raw,s.prepared,s.current,manual);return C.processImport(raw,s.prepared,s.current,{...manual,acknowledgment:warning.reconciliation?.acknowledgment})}
for(const [before,after] of [[6000,3200],[1000,1340],[3200,0],[0,100]])test(`${before} → ${after}: acknowledgment then current-fact atomic save`,async()=>{
  const s=scenario(before,after),warning=C.processImport(s.raw,s.prepared,s.current,manual);
  assert.equal(warning.code,'holding_acknowledgment_required',warning.message);assert.equal(warning.previewReady,false);assert.equal(warning.reconciliation.oldShares,before);assert.equal(warning.reconciliation.newShares,after);
  assert.equal(warning.reconciliation.statusChanged,(before>0)!==(after>0));assert.doesNotMatch(warning.message,/重新开始|已过期/);
  let writes=0,saved;const rejected=await C.commit(warning,s.state,{saveCandidate:()=>writes++},{prepared:s.prepared,...manual});assert.equal(rejected.writes,0);
  const result=preview(s);assert.equal(result.previewReady,true,result.message);assert.equal(result.currentState.sourceDiscussionVersion,s.prepared.sourceDiscussionVersion);
  const committed=await C.commit(result,s.state,{saveCandidate:async candidate=>{writes++;saved=candidate}},{prepared:s.prepared,...manual});
  assert.equal(committed.status,'completed',committed.error?.message);assert.equal(writes,1);assert.equal(saved.stocks[0].discussionState.current.references.holding.shares,after);assert.equal(s.stock.discussionState.current,null);
  assert.equal(saved.stocks[0].discussionState.current.userConfirmedStaleHolding,undefined);assert.equal(saved.stocks[0].discussionState.current.acknowledgment,undefined);assert.equal(JSON.parse(s.raw).currentState.shares,undefined);
});
for(const [before,after,headline] of [[3200,0,'继续持有'],[3200,0,'建议减仓'],[3200,0,'保护已有利润'],[3200,0,'持仓继续观察'],[0,100,'当前没有持仓，暂不建仓'],[0,100,'等待首次建仓']])test(`${before} → ${after} conflicting judgment remains importable: ${headline}`,async()=>{
  const s=scenario(before,after),raw=JSON.parse(s.raw);raw.currentState.userDecision.headline=headline;
  const result=preview(s,JSON.stringify(raw));assert.equal(result.ok,true,result.message);
  const built=C.buildCandidate(s.state,result,{prepared:s.prepared,...manual});assert.equal(built.currentState.userDecision.headline,headline);assert.equal(built.currentState.references.holding.shares,after);assert.equal(built.candidate.stocks[0].shares,after);
});

test('unchanged holding has no warning and follows normal Preview',()=>{const s=scenario(3200,3200);const result=C.processImport(s.raw,s.prepared,s.current,manual);assert.equal(result.previewReady,true,result.message);assert.equal(result.reconciliation.status,'no_change');assert.equal(result.acknowledgment,null)});
for(const kind of ['v1','v2','v3','historical'])test(`historical ${kind} wording never supplies current holding facts`,()=>{const s=scenario(100,0,kind);assert.equal(preview(s).previewReady,true)});
const otherChanges=[
  ['Plan',s=>s.stock.plans.push(Plan.createPlan({action:'add',triggerPrice:40,triggerDirection:'below',quantity:100}))],
  ['LTL',s=>s.stock.longTermLogic={investmentThesis:'新逻辑',updatedAt:'2026-09-08'}],
  ['cost',s=>s.stock.avgCost+=1],['role',s=>s.stock.role='other'],['type',s=>s.stock.type='watchlist'],
  ['news',s=>s.stock.recentCatalyst={todayCatalyst:'新消息'}],
  ['market risk',s=>s.stock.discussionMarketRisk={status:'risk',summary:'风险提升'}],
  ['source state',s=>s.stock.discussionState=F.stock('v3').discussionState],
  ['technical freshness',s=>s.stock.technicalData.technicalDataStatus='stale']
];
for(const [name,mutate] of otherChanges)test(`holding + ${name} cannot reconcile or save`,async()=>{
  const s=scenario(1000,1340);mutate(s);s.current=W.buildContext(s.stock,{state:s.state});
  assert.equal(C.reconcileContext(s.prepared,s.current,manual).status,'hard_block');
  const result=C.processImport(s.raw,s.prepared,s.current,manual);assert.equal(result.previewReady,false);let writes=0;
  await C.commit({...result,ok:true,previewReady:true,currentState:JSON.parse(s.raw).currentState},s.state,{saveCandidate:()=>writes++},{prepared:s.prepared,...manual});assert.equal(writes,0);
});
test('holding + Runtime revision remains hard protected',()=>{
  const stock=F.stock('none',100),plan=Plan.createPlan({action:'add',triggerPrice:40,triggerDirection:'below',quantity:100});stock.plans=[plan];
  const runtime={planId:plan.id,phase:'watching',runtimeRevision:1},state={stocks:[stock],planRuntimeStates:{byPlanId:{[plan.id]:runtime}}},prepared=W.buildContext(stock,{state});
  stock.shares=200;runtime.runtimeRevision=2;const result=C.reconcileContext(prepared,W.buildContext(stock,{state}),manual);assert.equal(result.status,'hard_block');assert.ok(result.changes.includes('runtime_changed'));
});
test('holding plus invalid anchor returns specific anchor failure',()=>{const s=scenario(100,200);s.stock.priceHistory=[];s.stock.technicalData={technicalDataStatus:'unavailable'};s.current=W.buildContext(s.stock,{state:s.state});const result=C.processImport(s.raw,s.prepared,s.current,manual);assert.equal(result.code,'anchor_not_ready');assert.equal(result.reason,'anchor_date_invalid')});
for(const transport of [undefined,'api','bridge'])test(`holding reconciliation fails closed for transport ${transport}`,()=>{const s=scenario(100,200);assert.equal(C.processImport(s.raw,s.prepared,s.current,{transport}).code,'context_changed')});
for(const alter of [p=>delete p.sourceBinding,p=>delete p.references,p=>p.context.currentFacts.holding.shares=50,p=>p.sourceDiscussionVersion='discussion_v3_unknown',p=>p.protectedHash='unknown',p=>p.sourceBinding.currentStateId='other',p=>p.protectedSnapshot.holding.avgCost+=1])test(`ambiguous snapshot fails closed: ${alter}`,()=>{const s=scenario(100,200);alter(s.prepared);assert.equal(C.reconcileContext(s.prepared,s.current,manual).status,'hard_block')});
test('identical facts with a version mismatch are still blocked',()=>{const s=scenario(100,100);s.prepared.sourceDiscussionVersion+='x';assert.equal(C.reconcileContext(s.prepared,s.current,manual).status,'hard_block')});
test('wrong symbol or source version in AI JSON cannot use reconciliation',()=>{for(const key of ['symbol','sourceDiscussionVersion']){const s=scenario(100,200),raw=JSON.parse(s.raw);raw.currentState[key]='other';assert.equal(preview(s,JSON.stringify(raw)).ok,false)}});
test('AI cannot echo or override shares',()=>{const s=scenario(100,200),raw=JSON.parse(s.raw);raw.currentState.shares=200;assert.equal(preview(s,JSON.stringify(raw)).ok,false)});
test('secondary judgment prose remains importable without changing current facts',()=>{for(const [before,after,summary] of [[100,0,'保护已有利润，继续持有。'],[0,100,'当前没有持仓，等待首次建仓。']]){const s=scenario(before,after),raw=JSON.parse(s.raw);raw.currentState.summary=summary;assert.equal(preview(s,JSON.stringify(raw)).ok,true)}});
test('schema errors do not create acknowledgment or confirm-ready Preview',()=>{const s=scenario(100,200);for(const raw of ['{}','{','{"currentState":{}}']){const result=C.processImport(raw,s.prepared,s.current,manual);assert.equal(result.ok,false);assert.notEqual(result.code,'holding_acknowledgment_required')}});
for(const before of [1000,1340])test(`holding changes after Preview (${before}) require renewed acknowledgment`,async()=>{
  const s=scenario(before,1340),result=preview(s);assert.equal(result.previewReady,true);s.stock.shares=1500;let writes=0;
  const committed=await C.commit(result,s.state,{saveCandidate:()=>writes++},{prepared:s.prepared,...manual});assert.equal(committed.status,'invalid');assert.match(committed.error.message,/预览后当前事实已变化/);assert.equal(writes,0);
  s.current=W.buildContext(s.stock,{state:s.state});const again=C.processImport(s.raw,s.prepared,s.current,{...manual,acknowledgment:result.acknowledgment});assert.equal(again.code,'holding_acknowledgment_required');assert.equal(again.reconciliation.oldShares,before);assert.equal(again.reconciliation.newShares,1500);assert.equal(preview(s).previewReady,true);
});
test('reconciled storage failure never adopts a partially changed canonical state',async()=>{const s=scenario(100,200),before=copy(s.state);let adopts=0;const saved=await C.commit(preview(s),s.state,{saveCandidate:async()=>false,adoptCandidate:()=>adopts++},{prepared:s.prepared,...manual});assert.equal(saved.status,'failed');assert.equal(adopts,0);assert.deepEqual(s.state,before)});
