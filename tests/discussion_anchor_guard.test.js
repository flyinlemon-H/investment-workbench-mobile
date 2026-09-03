'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const Workbench=require('../src/discussion-workbench.js'),Contract=require('../src/discussion-state-contract.js');
const fixture=fs.readFileSync(require.resolve('./fixtures/production-current-state-600487-missing-anchor.json.txt'),'utf8');
const ui=fs.readFileSync(require.resolve('../src/ui-render.js'),'utf8');
const bar={date:'2026-09-02',close:20,is_complete_bar:true,adjustment:'qfq',price_basis:'adjusted',provider:'fixture'};
const stock=()=>({id:'anchor-fixture',code:'600487.SS',name:'隔离锚点测试',type:'holding',shares:100,avgCost:18,plans:[],priceHistory:[{...bar}]});
const parse=prepared=>Contract.process(fixture.replace('__SOURCE_DISCUSSION_VERSION__',prepared.sourceDiscussionVersion),{expectedSymbol:'600487.SS',sourceDiscussionVersion:prepared.sourceDiscussionVersion,holdingShares:100,hasActivePlan:false,technicalDataStatus:prepared.context.currentFacts.technical.dataStatus,prepared});
function uiContext(source){
  const sandbox={window:{DiscussionWorkbench:Workbench,DiscussionStateContract:Contract},discussionPreparedContexts:new Map(),discussionStockKey:()=>source.code,discussionOptions:()=>({}),Error};
  vm.createContext(sandbox);
  vm.runInContext(ui.slice(ui.indexOf('function ensureDiscussionArchiveContext'),ui.indexOf('function discussionPromptSummary')),sandbox);
  return sandbox;
}
test('real anchorless 600487 context supports natural discussion but archive entry rejects before prompt preparation',()=>{
  const source={...stock(),priceHistory:[],technicalData:{technicalDataStatus:'unavailable'}},prepared=Workbench.buildDiscussionRequest(source);
  assert.ok(prepared.request);assert.notEqual(prepared.context.currentFacts.technical.dataStatus,'fresh');
  assert.equal(Contract.assessTechnicalAnchorReadiness(prepared).ready,false);
  assert.throws(()=>uiContext(source).ensureDiscussionArchiveContext(source),/当前讨论可以继续.*暂不能保存.*重新开始讨论并整理结论/);
  const result=parse(prepared);assert.equal(result.ok,true);assert.equal(result.previewReady,false);
});
test('preview independently rejects absent snapshots, impossible dates, nonfinite closes, incomplete bars and inconsistent program dates',async()=>{
  for(const mutate of [p=>delete p.technicalSnapshot,p=>delete p.technicalSnapshot.anchorBar,p=>p.technicalSnapshot.anchorBar.date='2026-02-30',...[-1,0,NaN,Infinity,'invalid'].map(close=>p=>p.technicalSnapshot.anchorBar.close=close),p=>p.technicalSnapshot.anchorBar.is_complete_bar=false,p=>p.references.technical.technicalAsOf='',p=>p.references.technical.technicalAsOf='2026-09-01',p=>p.context.currentFacts.technical.technicalAsOf='2026-09-01']){
    const source=stock(),prepared=Workbench.buildDiscussionRequest(source);mutate(prepared);
    const result=parse(prepared);assert.equal(result.ok,true);assert.equal(result.previewReady,false);assert.match(result.message,/完整日K技术锚点/);
    let attempts=0;const root={stocks:[source]},before=JSON.stringify(root);
    const saved=await Contract.commit(result,root,{saveCandidate:()=>attempts++},{prepared});
    assert.equal(saved.status,'preview_required');assert.equal(attempts,0);assert.equal(JSON.stringify(root),before);
  }
});
test('refresh does not attach new data to an old prepared archive; explicitly restart discussion',()=>{
  const source={...stock(),priceHistory:[]},context=uiContext(source),old=Workbench.buildDiscussionRequest(source);
  context.discussionPreparedContexts.set(source.code,old);source.priceHistory=[bar];
  assert.throws(()=>context.ensureDiscussionArchiveContext(source),/重新开始讨论并整理结论/);
  assert.equal(parse(old).previewReady,false);
  context.discussionPreparedContexts.set(source.code,Workbench.buildDiscussionRequest(source));
  assert.ok(context.ensureDiscussionArchiveContext(source).archive.request);
});
test('valid anchors retain confirmed save and previous-state history',async()=>{
  let root={stocks:[stock()]},attempts=0;
  for(let n=0;n<2;n++){
    const prepared=Workbench.buildDiscussionRequest(root.stocks[0]),result=parse(prepared);
    assert.equal(result.previewReady,true);
    const saved=await Contract.commit(result,root,{saveCandidate:async candidate=>{attempts++;return {state:candidate}}},{prepared,now:`2026-09-03T01:0${n}:00Z`});
    assert.equal(saved.status,'completed');root=saved.state;
  }
  assert.equal(attempts,2);assert.equal(root.stocks[0].discussionState.history.length,1);
  assert.equal(Workbench.validateStore(root.stocks[0].discussionState).ok,true);
});
test('anchor, holdings, Plan and long-term logic changes after preview reject without candidate persistence',async()=>{
  for(const mutate of [s=>s.priceHistory.push({...bar,date:'2026-09-03',close:21}),s=>s.shares++,s=>s.plans.push(require('../src/plan-v2.js').createPlan({action:'buy',triggerPrice:19,triggerDirection:'below',quantity:100})),s=>s.longTermLogic={investmentThesis:'新的长期逻辑',updatedAt:'2026-09-03T02:00:00Z'}]){
    const source=stock(),prepared=Workbench.buildDiscussionRequest(source),result=parse(prepared);mutate(source);
    const root={stocks:[source]},before=JSON.stringify(root);let attempts=0;
    const saved=await Contract.commit(result,root,{saveCandidate:()=>attempts++},{prepared});
    assert.equal(saved.status,'invalid');assert.match(saved.error.message,/受保护的持仓/);assert.equal(attempts,0);assert.equal(JSON.stringify(root),before);
  }
});
test('failed storage attempts preserve canonical current/history and keep stale-tab diagnostics',async()=>{
  const source=stock(),prepared=Workbench.buildDiscussionRequest(source),initial=Contract.buildCandidate({stocks:[source]},parse(prepared),{prepared}).candidate;
  for(const failure of [false,{ok:false,type:'stale_tab'},new Error('simulated disk failure')]){
    const root=structuredClone(initial),context=Workbench.buildDiscussionRequest(root.stocks[0]),before=JSON.stringify(root);let attempts=0,adoptions=0;
    const result=await Contract.commit(parse(context),root,{saveCandidate:async()=>{attempts++;if(failure instanceof Error)throw failure;return failure},adoptCandidate:()=>adoptions++},{prepared:context});
    assert.equal(result.status,'failed');assert.equal(attempts,1);assert.equal(adoptions,0);assert.equal(JSON.stringify(root),before);
    if(failure&&failure.type)assert.equal(result.error.code,'stale_tab');
  }
});
test('save errors are localized and focus/scroll status without exposing implementation errors',()=>{
  const calls=[],region={textContent:'',scrollIntoView:()=>calls.push('scroll'),focus:()=>calls.push('focus')};
  const sandbox={document:{getElementById:()=>region},alert:()=>assert.fail('region exists')};vm.createContext(sandbox);
  vm.runInContext(ui.slice(ui.indexOf('function translateDiscussionImportFailureMessage'),ui.indexOf('function previewDiscussionImport')),sandbox);
  for(const error of [new Error('technical anchor mismatch; technical anchor bar invalid'),{code:'anchor_not_ready'},new Error('受保护的持仓、技术锚点、计划或长期逻辑已经变化'),{type:'stale_tab'},new Error('private internal details')]){
    const message=sandbox.translateDiscussionImportFailureMessage(error);sandbox.showDiscussionImportFailure(message);
    assert.match(region.textContent,/保存|覆盖/);assert.doesNotMatch(region.textContent,/technical anchor|private internal|stale_tab/);
  }
  assert.deepEqual(calls,Array.from({length:5},()=>['scroll','focus']).flat());
});
