'use strict';

const assert=require('node:assert/strict');
const test=require('node:test');
const Workbench=require('../src/discussion-workbench.js');
const Contract=require('../src/discussion-state-contract.js');

function dateAt(index,start='2026-07-01'){return new Date(Date.parse(`${start}T00:00:00Z`)+index*86400000).toISOString().slice(0,10)}
function bars(count,start='2026-07-01'){return Array.from({length:count},(_,index)=>({date:dateAt(index,start),close:100+index,adjustment:'qfq',price_basis:'adjusted',provider:'fixture',is_complete_bar:true}))}
function stock(overrides={}){
  return {id:'stock-1',code:'601138.SS',name:'工业富联',type:'holding',role:'核心仓',shares:100,avgCost:42,currentPrice:55,priceUpdatedAt:'2026-08-31',priceSource:'fixture',priceHistory:bars(30),technicalData:{technicalDataStatus:'fresh',trendStatus:'uptrend',supportLevels:[50,48],resistanceLevels:[58],latestCompleteBar:dateAt(29),technicalAsOf:dateAt(29)},technicalReview:{updatedAt:'2026-08-31T08:00:00Z',shortTermTechnical:{trendStatus:'uptrend',cyclePosition:'mid_uptrend',technicalSummary:'趋势延续',riskFlags:['near_resistance'],confidence:'medium'}},plans:[],longTermLogic:{updatedAt:'2026-08-20T08:00:00Z',logicStatus:'valid',investmentThesis:'长期逻辑',coreDrivers:['增长'],longTermRisks:['波动']},...overrides};
}
function judgment(prepared,overrides={}){return {currentState:{symbol:'601138.SS',sourceDiscussionVersion:prepared.sourceDiscussionVersion,stage:'修复观察',summary:'本轮确认继续观察。',keyChanges:['价格修复'],risks:['压力位风险'],watchPoints:['观察成交量'],planRelation:'当前计划仅作为观察条件，不自动修改。',confidence:'medium',...overrides}}}
function preview(prepared,overrides={}){return Contract.process(JSON.stringify(judgment(prepared,overrides)),{expectedSymbol:'601138.SS',sourceDiscussionVersion:prepared.sourceDiscussionVersion})}
function confirmedState(sourceStock,now='2026-08-31T08:00:00Z'){
  const prepared=Workbench.buildDiscussionRequest(sourceStock),result=preview(prepared),built=Contract.buildCandidate({stocks:[sourceStock]},result,{prepared,now,timeZone:'Asia/Shanghai'});
  return {prepared,result,built,state:built.candidate.stocks[0].discussionState.current,stock:built.candidate.stocks[0]};
}

test('Discussion State absence is backward compatible and normalization is canonical',()=>{
  assert.deepEqual(Workbench.normalizeStore(),Workbench.defaultStore());
  const base=stock(),saved=confirmedState(base).state,normalized=Workbench.normalizeStore({current:saved,history:[]});
  assert.equal(Workbench.validateStore(normalized).ok,true);
  assert.equal(normalized.current.schemaVersion,Workbench.STATE_SCHEMA_VERSION);
  assert.equal(normalized.current.symbol,'601138.SS');
});

test('Discussion State survives a full JSON export/import round trip without transcripts or daily arrays',()=>{
  const saved=confirmedState(stock()).stock,roundTrip=JSON.parse(JSON.stringify({stocks:[saved]})).stocks[0];
  assert.deepEqual(roundTrip.discussionState,saved.discussionState);
  assert.equal('request' in roundTrip.discussionState.current,false);
  assert.equal('bars' in roundTrip.discussionState.current.technicalSnapshot,false);
});

test('confirmed save uses program IDs, timestamps, local date, technical anchor and rejects AI authority fields',()=>{
  const base=stock(),prepared=Workbench.buildDiscussionRequest(base),bad=judgment(prepared,{confirmedAt:'2000-01-01T00:00:00Z'});
  assert.equal(Contract.process(JSON.stringify(bad),{expectedSymbol:'601138.SS',sourceDiscussionVersion:prepared.sourceDiscussionVersion}).ok,false);
  const built=Contract.buildCandidate({stocks:[base]},preview(prepared),{prepared,now:'2026-08-31T16:30:00Z',timeZone:'Asia/Shanghai'}),saved=built.currentState;
  assert.match(saved.stateId,/^discussionstate_/);
  assert.equal(saved.confirmedAt,'2026-08-31T16:30:00.000Z');
  assert.equal(saved.confirmedDate,'2026-09-01');
  assert.equal(saved.technicalAsOf,dateAt(29));
  assert.equal(saved.technicalSnapshot.anchorBar.close,129);
  assert.equal(saved.technicalSnapshot.anchorBar.adjustment,'qfq');
});

test('current moves to bounded history and same-day confirmations are preserved',()=>{
  let source=stock();
  for(let index=0;index<33;index++){
    const prepared=Workbench.buildDiscussionRequest(source),result=preview(prepared,{summary:`同日结论 ${index}`}),built=Contract.buildCandidate({stocks:[source]},result,{prepared,now:`2026-08-31T08:${String(index).padStart(2,'0')}:00Z`,timeZone:'Asia/Shanghai'});source=built.candidate.stocks[0];
  }
  assert.equal(source.discussionState.history.length,30);
  assert.equal(source.discussionState.current.summary,'同日结论 32');
  assert.equal(source.discussionState.history.at(-1).summary,'同日结论 31');
  assert.equal(new Set(source.discussionState.history.map(item=>item.stateId)).size,30);
  assert.ok(source.discussionState.history.every(item=>item.confirmedDate==='2026-08-31'));
});

test('barsAfter handles zero, one, many and excludes incomplete rows in ascending order',()=>{
  const base=stock({priceHistory:bars(4)}),anchor={date:dateAt(3),close:103,adjustment:'qfq',priceBasis:'adjusted',provider:'fixture'};
  assert.deepEqual(Workbench.barsAfter(base,anchor,{symbol:'601138.SS'}).bars,[]);
  base.priceHistory.push({...bars(1,'2026-07-05')[0],close:104},{date:'2026-07-06',close:105,adjustment:'qfq',price_basis:'adjusted',provider:'fixture',is_complete_bar:false});
  assert.equal(Workbench.barsAfter(base,anchor,{symbol:'601138.SS'}).bars.length,1);
  base.priceHistory.push(...bars(4,'2026-07-07').reverse());
  assert.deepEqual(Workbench.barsAfter(base,anchor,{symbol:'601138.SS'}).bars.map(item=>item.date),['2026-07-05','2026-07-07','2026-07-08','2026-07-09','2026-07-10']);
});

test('weekends are not fabricated and a suspicious retained-history gap is warned',()=>{
  const history=[{date:'2026-08-28',close:100,adjustment:'qfq',price_basis:'adjusted',provider:'fixture',is_complete_bar:true},{date:'2026-09-14',close:101,adjustment:'qfq',price_basis:'adjusted',provider:'fixture',is_complete_bar:true}],base=stock({priceHistory:history});
  const result=Workbench.barsAfter(base,{date:'2026-08-28',close:100,adjustment:'qfq',priceBasis:'adjusted',provider:'fixture'},{symbol:'601138.SS'});
  assert.equal(result.bars.length,1);assert.match(result.warnings.join(''),/间隔异常/);
  assert.equal(result.bars.some(item=>['2026-08-29','2026-08-30'].includes(item.date)),false);
});

test('missing, outside, future, symbol and adjustment anomalies never pretend incremental continuity',()=>{
  const base=stock({priceHistory:bars(10)});
  assert.equal(Workbench.barsAfter(base,{date:'2026-07-05',close:104,adjustment:'qfq',priceBasis:'adjusted',provider:'fixture'},{symbol:'000001.SZ'}).mode,'blocked');
  assert.equal(Workbench.barsAfter(base,{date:'2026-06-01',close:90,adjustment:'qfq',priceBasis:'adjusted',provider:'fixture'}).mode,'bootstrap');
  assert.equal(Workbench.barsAfter(base,{date:'2026-07-20',close:120,adjustment:'qfq',priceBasis:'adjusted',provider:'fixture'}).mode,'blocked');
  assert.equal(Workbench.barsAfter(base,{date:'2026-07-05',close:104,adjustment:'hfq',priceBasis:'adjusted',provider:'fixture'}).mode,'bootstrap');
  const missing=stock({priceHistory:bars(10).filter(row=>row.date!=='2026-07-05')});
  assert.equal(Workbench.barsAfter(missing,{date:'2026-07-05',close:104,adjustment:'qfq',priceBasis:'adjusted',provider:'fixture'}).mode,'bootstrap');
});

test('new symbol bootstrap is bounded to fresh 30 and stale 45 complete bars',()=>{
  const fresh=Workbench.buildContext(stock({priceHistory:bars(80),discussionState:undefined})),stale=Workbench.buildContext(stock({priceHistory:bars(80),technicalData:{technicalDataStatus:'stale'}}));
  assert.equal(fresh.context.mode,'bootstrap');assert.equal(fresh.context.currentFacts.technical.bars.length,30);
  assert.equal(stale.context.currentFacts.technical.bars.length,45);assert.match(stale.context.limitations.join(''),/谨慎讨论/);
});

test('incremental context sends exactly 0, 3, and 10 new bars within disciplined size budgets',()=>{
  const first=confirmedState(stock()),anchorStock=first.stock,anchorRows=anchorStock.priceHistory.slice();
  for(const count of [0,3,10]){
    const source={...anchorStock,priceHistory:anchorRows.concat(bars(count,'2026-08-01'))},prepared=Workbench.buildDiscussionRequest(source);
    assert.equal(prepared.context.mode,'continuation');assert.equal(prepared.context.currentFacts.technical.bars.length,count);
    assert.ok(prepared.metrics.characters<25000);
    if(count===0)assert.match(prepared.context.continuity.barMessage,/暂无新的完整日K/);
  }
});

test('representative 08-25 to 08-31 continuation contains exactly four exchange bars',()=>{
  const base=stock({priceHistory:[{date:'2026-08-25',close:51,adjustment:'qfq',price_basis:'adjusted',provider:'fixture',is_complete_bar:true}]}),first=confirmedState(base,'2026-08-25T09:00:00Z').stock;
  first.priceHistory=first.priceHistory.concat(['2026-08-26','2026-08-27','2026-08-28','2026-08-31'].map((date,index)=>({date,close:52+index,adjustment:'qfq',price_basis:'adjusted',provider:'fixture',is_complete_bar:true})));
  const context=Workbench.buildContext(first).context;
  assert.equal(context.currentFacts.technical.bars.length,4);assert.deepEqual(context.currentFacts.technical.bars.map(item=>item.date),['2026-08-26','2026-08-27','2026-08-28','2026-08-31']);
});

test('PlanReview stale status is translated naturally and unchanged news is omitted after confirmation',()=>{
  const plan={schemaVersion:'plan.v2',id:'p1',planVersion:2,action:'add',triggerPrice:50,status:'active',validityStatus:'active',source:'manual'},api={planSnapshotHash:()=>`plansnap_current`,reviewStatusForPlan:()=>({review:{reviewId:'r1',planVersion:1,reviewedAt:'2026-08-20T00:00:00Z',planSnapshotHash:'plansnap_old'},freshness:{status:'stale'}})},base=stock({plans:[plan],recentCatalyst:{updatedAt:'2026-08-30',todayCatalyst:'公告更新'}}),options={planReviewApi:api,planReviewStore:{}};
  const bootstrap=Workbench.buildContext(base,options);assert.equal(bootstrap.context.currentFacts.planReviews[0].statusText,'计划变更后尚未重新复核');assert.ok(bootstrap.context.currentFacts.modules.news);
  const saved=Contract.buildCandidate({stocks:[base]},preview(Workbench.buildDiscussionRequest(base,options)),{prepared:Workbench.buildDiscussionRequest(base,options),planReviewApi:api,now:'2026-08-31T08:00:00Z'});
  const continued=Workbench.buildContext(saved.candidate.stocks[0],options);assert.equal(continued.context.currentFacts.modules.news,null);
});

test('normal new bars keep Current State current while Plan, holding, logic and anchor changes require review',()=>{
  const first=confirmedState(stock()),source=first.stock;
  source.priceHistory=source.priceHistory.concat(bars(3,'2026-08-01'));
  assert.equal(Workbench.stateFreshness(source,source.discussionState.current).status,'current');
  const holding={...source,shares:200};assert.match(Workbench.stateFreshness(holding,source.discussionState.current).reason,/持仓/);
  const plan={...source,plans:[{schemaVersion:'plan.v2',id:'p1',planVersion:2,action:'add',triggerPrice:50,status:'active',validityStatus:'active',source:'manual'}]};assert.match(Workbench.stateFreshness(plan,source.discussionState.current).reason,/计划/);
  const logic={...source,longTermLogic:{...source.longTermLogic,logicStatus:'broken'}};assert.match(Workbench.stateFreshness(logic,source.discussionState.current).reason,/长期逻辑/);
});

test('discussion context includes holdings, no-plan behavior and honest unavailable allocation',()=>{
  const context=Workbench.buildContext(stock({plans:[],allocationDecision:{recommendedTargetWeight:20}})).context;
  assert.equal(context.currentFacts.holding.shares,100);assert.equal(context.currentFacts.holding.avgCost,42);assert.equal(context.currentFacts.holding.currentPrice,55);
  assert.deepEqual(context.currentFacts.plans,[]);assert.equal(context.currentFacts.allocation.message,'当前目标仓位尚未确认');
  assert.equal('currentWeight' in context.currentFacts.holding,false);
});

test('Discussion Prompt is natural, continuation-focused, screenshot-aware, and not an archive contract',()=>{
  const request=Workbench.buildDiscussionRequest(stock()).request;
  assert.match(request,/基于上次已确认状态和之后新增事实/);assert.match(request,/如需判断今天盘中强弱，请结合用户随后提供的分时截图/);
  assert.doesNotMatch(request,/只输出严格 JSON/);assert.doesNotMatch(request,/完整 fundamental|完整 valuation/);
  assert.doesNotMatch(request,/stateId|reviewHash|snapshotHash/);
});

test('Archive Prompt is short, strict, versioned, and does not resend history',()=>{
  const prepared=Workbench.buildDiscussionRequest(stock()),archive=Workbench.buildArchiveRequest(prepared);
  assert.ok(archive.request.length<2500);assert.match(archive.request,/只输出严格 JSON/);assert.match(archive.request,new RegExp(prepared.sourceDiscussionVersion));
  assert.doesNotMatch(archive.request,/priceHistory|完整日线|technicalSnapshot/);
});

test('archive validation rejects wrong symbol/version, unknown fields, malformed and truncated JSON with zero writes',()=>{
  const prepared=Workbench.buildDiscussionRequest(stock()),options={expectedSymbol:'601138.SS',sourceDiscussionVersion:prepared.sourceDiscussionVersion};
  assert.equal(Contract.process(JSON.stringify(judgment(prepared,{symbol:'000001.SZ'})),options).writes,0);
  assert.equal(Contract.process(JSON.stringify(judgment(prepared,{sourceDiscussionVersion:'discussion_v1_stale'})),options).ok,false);
  assert.equal(Contract.process(JSON.stringify({currentState:{...judgment(prepared).currentState,extra:'x'}}),options).ok,false);
  assert.equal(Contract.process('{"currentState":',options).writes,0);assert.equal(Contract.process('```json\n{}\n```',options).writes,0);
  assert.equal(Contract.process(JSON.stringify({...judgment(prepared),extra:{}}),options).writes,0);
});

test('preview is mandatory and stale protected source facts reject with zero writes',async()=>{
  const base=stock(),prepared=Workbench.buildDiscussionRequest(base),result=preview(prepared),mutated={...base,shares:101};
  assert.throws(()=>Contract.buildCandidate({stocks:[mutated]},result,{prepared}),/受保护/);
  assert.deepEqual(await Contract.commit(null,{stocks:[base]},{saveCandidate:()=>{throw new Error('must not write')}}),{status:'preview_required',writes:0});
});

test('atomic save changes only discussionState and preserves Plan, PlanReview, holdings, technical, allocation and logic',async()=>{
  const base=stock({plans:[{schemaVersion:'plan.v2',id:'p1',planVersion:1,action:'add',triggerPrice:50,status:'active',validityStatus:'active',source:'manual'}],allocationDecision:{recommendedTargetWeight:20}}),root={stocks:[base],planReviews:{schemaVersion:'plan-review.store.v1',currentByPlan:{},history:[],snapshots:[]}},protectedBefore=JSON.parse(JSON.stringify({plans:base.plans,planReviews:root.planReviews,shares:base.shares,avgCost:base.avgCost,technicalData:base.technicalData,allocationDecision:base.allocationDecision,longTermLogic:base.longTermLogic})),prepared=Workbench.buildDiscussionRequest(base,{state:root,planReviewStore:root.planReviews}),result=preview(prepared);
  const committed=await Contract.commit(result,root,{saveCandidate:async candidate=>candidate},{prepared,now:'2026-08-31T08:00:00Z'});
  assert.equal(committed.status,'completed');assert.equal(committed.writes,1);
  const after=committed.state.stocks[0];assert.deepEqual({plans:after.plans,planReviews:committed.state.planReviews,shares:after.shares,avgCost:after.avgCost,technicalData:after.technicalData,allocationDecision:after.allocationDecision,longTermLogic:after.longTermLogic},protectedBefore);
});

test('critical or multi-tab stale-save failure preserves prior current/history',async()=>{
  const first=confirmedState(stock()),root={stocks:[first.stock]},before=JSON.parse(JSON.stringify(first.stock.discussionState)),prepared=Workbench.buildDiscussionRequest(first.stock),result=preview(prepared),rollback=[];
  const failed=await Contract.commit(result,root,{saveCandidate:async()=>({ok:false,type:'stale_tab'}),rollback:value=>rollback.push(value)},{prepared,now:'2026-08-31T09:00:00Z'});
  assert.equal(failed.status,'failed');assert.equal(failed.writes,1);assert.deepEqual(root.stocks[0].discussionState,before);assert.equal(rollback.length,1);
});
