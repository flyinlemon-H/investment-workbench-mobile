'use strict';

const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const test=require('node:test');
const Workbench=require('../src/discussion-workbench.js');
const Contract=require('../src/discussion-state-contract.js');

function dateAt(index,start='2026-07-01'){return new Date(Date.parse(`${start}T00:00:00Z`)+index*86400000).toISOString().slice(0,10)}
function bars(count,start='2026-07-01'){return Array.from({length:count},(_,index)=>({date:dateAt(index,start),close:100+index,adjustment:'qfq',price_basis:'adjusted',provider:'fixture',is_complete_bar:true}))}
function fixture(name){return fs.readFileSync(path.join(__dirname,'fixtures',name),'utf8')}
function stock(overrides={}){
  return {id:'stock-1',code:'601138.SS',name:'工业富联',type:'holding',role:'核心仓',shares:100,avgCost:42,currentPrice:55,priceUpdatedAt:'2026-08-31',priceSource:'fixture',priceHistory:bars(30),technicalData:{technicalDataStatus:'fresh',trendStatus:'uptrend',supportLevels:[50,48],resistanceLevels:[58],latestCompleteBar:dateAt(29),technicalAsOf:dateAt(29)},technicalReview:{updatedAt:'2026-08-31T08:00:00Z',shortTermTechnical:{trendStatus:'uptrend',cyclePosition:'mid_uptrend',technicalSummary:'趋势延续',riskFlags:['near_resistance'],confidence:'medium'}},plans:[],longTermLogic:{updatedAt:'2026-08-20T08:00:00Z',logicStatus:'valid',investmentThesis:'长期逻辑',coreDrivers:['增长'],longTermRisks:['波动']},...overrides};
}
function stock600(overrides={}){return stock({id:'stock-600487',code:'600487.SS',name:'青岛啤酒',type:'holding',role:'核心仓',...overrides});}
function judgment(prepared,overrides={}){const symbol=prepared&&prepared.context&&prepared.context.symbol||'601138.SS';return {currentState:{symbol,sourceDiscussionVersion:prepared.sourceDiscussionVersion,actionAssessment:{category:'hold_watch',priority:'low',headline:'当前没有临近的仓位决策窗口，维持常规观察。',reasons:['趋势修复但尚未出现需要调整仓位的确认信号。'],upgradeConditions:['关键结构确认后提高复核优先级。'],downgradeConditions:['当前修复结构被后续走势破坏。']},attentionLevel:'normal',trendAssessment:{overall:'recovery',timeframes:[{timeframe:'日线',status:'recovery',explanation:'价格延续修复但仍需量价确认。'}]},structureAssessment:[],stage:'修复观察',focusPoints:['观察量价能否确认修复延续。'],summary:'本轮确认继续观察。',keyChanges:['价格修复'],risks:['压力位风险'],watchPoints:['观察成交量'],planRelation:{status:'neutral',summary:'当前计划仅作为观察条件，不自动修改；价格触发不等于完整条件满足。'},confidence:'medium',...overrides}}}
function preview(prepared,overrides={}){const facts=prepared.context.currentFacts;return Contract.process(JSON.stringify(judgment(prepared,overrides)),{expectedSymbol:prepared.context.symbol,sourceDiscussionVersion:prepared.sourceDiscussionVersion,holdingShares:facts.holding.shares,hasActivePlan:facts.plans.length>0,technicalDataStatus:facts.technical.dataStatus,programProvesFullPlanConditions:false})}
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
  assert.ok(archive.request.length<5000);assert.match(archive.request,/只输出唯一一个完整的 ```json 代码块/);assert.match(archive.request,/代码块外不得有任何文字/);assert.match(archive.request,/代码块内必须是一个完整严格 JSON 对象/);assert.doesNotMatch(archive.request,/不要 Markdown 代码围栏/);assert.match(archive.request,new RegExp(prepared.sourceDiscussionVersion));
  assert.equal(archive.technicalDataStatus,'fresh');assert.match(archive.request,/程序当前 technicalDataStatus: fresh/);assert.match(archive.request,/confidence 可根据证据使用 high、medium 或 low/);assert.match(archive.request,/不得仅因为 fresh 自动使用 high/);
  assert.match(archive.request,/PROGRAM OWNS FACTS \/ AI OWNS JUDGMENTS/);assert.match(archive.request,/程序上下文中出现的字段不代表它属于输出 schema/);assert.match(archive.request,/其余 input-only context 不得复制到 JSON/);
  const allowlist=archive.request.match(/currentState 顶层只能包含以下字段，不得新增任何其他字段：([^。]+)。/)?.[1].split('、');assert.deepEqual(allowlist,Contract.RESULT_FIELDS);
  assert.match(archive.request,/symbol 与 sourceDiscussionVersion 是 allowlist 内的程序绑定字段，必须原样返回/);assert.match(archive.request,/technicalDataStatus 不在 allowlist 中，不得返回/);
  for(const field of ['technicalDataStatus','technicalAsOf','latestCompleteBar','currentStateId/stateId','contextHash/protectedHash','原始 Plan 对象','内部 references','schema/debug 字段'])assert.ok(archive.request.includes(field),field);
  assert.match(archive.request,/下划线 _ 不需要也不得转义/);assert.ok(archive.request.includes('discussion\\_v2\\_9a35cb46'));assert.match(archive.request,/只能使用标准定义的转义/);
  assert.match(archive.request,/trendAssessment\.timeframes 的每项必须且只能包含 timeframe、status、explanation/);assert.match(archive.request,/structureAssessment 的每项必须且只能包含 timeframe、type、status、source、sourceAsOf、shortReason/);assert.match(archive.request,/不得在 structureAssessment 中使用 explanation/);
  for(const field of ['"timeframe":"60分钟"','"type":"top"','"status":"forming"','"source":"ai_chart_judgment"','"sourceAsOf":""','"shortReason":'])assert.ok(archive.request.includes(field),field);
  assert.doesNotMatch(archive.request,/接受 explanation 作为|兼容旧字段|自动填充缺失/);
  assert.doesNotMatch(archive.request,/priceHistory|完整日线|technicalSnapshot/);
});

test('Archive Prompt carries the actual four-state technical freshness fact and forbids high confidence unless fresh',()=>{
  for(const technicalDataStatus of ['stale','unavailable','anomaly']){
    const prepared=Workbench.buildDiscussionRequest(stock({technicalData:{technicalDataStatus}})),archive=Workbench.buildArchiveRequest(prepared);
    assert.equal(archive.technicalDataStatus,technicalDataStatus);assert.match(archive.request,new RegExp(`程序当前 technicalDataStatus: ${technicalDataStatus}`));assert.match(archive.request,/technicalDataStatus 是程序拥有的输入上下文，只用于判断 confidence，不得输出到 currentState JSON/);assert.match(archive.request,new RegExp(`当前技术资料不是 fresh（实际为 ${technicalDataStatus}）`));assert.match(archive.request,/confidence 不得输出 high，只能根据证据使用 medium 或 low/);assert.match(archive.request,/正确输出保留 "confidence":"medium" 且不含 technicalDataStatus/);assert.match(archive.request,/错误输出含 "technicalDataStatus":"stale","confidence":"medium"，会被 strict schema 拒绝/);assert.ok(archive.request.length<5000);
  }
  const missing=Workbench.buildArchiveRequest(Workbench.buildDiscussionRequest(stock({technicalData:{}})));assert.equal(missing.technicalDataStatus,'unavailable');assert.match(missing.request,/程序当前 technicalDataStatus: unavailable/);
});

test('production input-only boundary fixtures preserve strict schema and freshness guards with zero writes',()=>{
  const options={expectedSymbol:'2899.HK',sourceDiscussionVersion:'discussion_v2_input_only_boundary',holdingShares:2000,hasActivePlan:true,technicalDataStatus:'stale',programProvesFullPlanConditions:false};
  const invalidRaw=fixture('production-current-state-input-only-boundary-invalid.json.txt'),parsed=Contract.parse(invalidRaw),invalid=Contract.process(invalidRaw,options);
  assert.equal(parsed.ok,true);assert.equal(invalid.ok,false);assert.equal(invalid.code,'validation_error');assert.equal(invalid.previewReady,false);assert.equal(invalid.writes,0);assert.match(invalid.message,/currentState contains unknown fields: technicalDataStatus/);assert.doesNotMatch(invalid.message,/JSON 格式/);
  const validRaw=fixture('production-current-state-input-only-boundary-valid.json.txt'),valid=Contract.process(validRaw,options);
  assert.equal(Contract.parse(validRaw).ok,true);assert.equal(valid.ok,true,valid.message);assert.equal(valid.previewReady,true);assert.equal(valid.writes,0);assert.equal(valid.currentState.confidence,'medium');assert.equal('technicalDataStatus' in valid.currentState,false);
  const freshHighValue=Contract.parse(validRaw).value;freshHighValue.currentState.confidence='high';const freshHigh=Contract.process(JSON.stringify(freshHighValue),{...options,technicalDataStatus:'fresh'});assert.equal(freshHigh.ok,true,freshHigh.message);assert.equal(freshHigh.previewReady,true);assert.equal(freshHigh.writes,0);
  const staleHigh=Contract.process(JSON.stringify(freshHighValue),options);assert.equal(staleHigh.ok,false);assert.equal(staleHigh.code,'validation_error');assert.equal(staleHigh.previewReady,false);assert.equal(staleHigh.writes,0);assert.match(staleHigh.message,/技术资料未标记为较新时 confidence 不能为 high/);
});

test('600487 production-like missing anchor is blocked at archive readiness with clear explanation',()=>{
  const raw=fixture('production-current-state-600487-missing-anchor.json.txt'),source=stock600({technicalData:{technicalDataStatus:'stale',latestCompleteBar:'2026-09-01',technicalAsOf:'2026-09-01'}}),prepared=Workbench.buildDiscussionRequest(source),preparedMissingAnchor=Object.assign({},prepared,{technicalSnapshot:Object.assign({},prepared.technicalSnapshot,{anchorBar:{}})}),validRaw=raw.replace('__SOURCE_DISCUSSION_VERSION__',prepared.sourceDiscussionVersion),fact=prepared.context.currentFacts;
  const valid=Contract.parse(validRaw),result=Contract.process(validRaw,{expectedSymbol:prepared.context.symbol,sourceDiscussionVersion:prepared.sourceDiscussionVersion,holdingShares:fact.holding.shares,hasActivePlan:fact.plans.length>0,technicalDataStatus:fact.technical.dataStatus,programProvesFullPlanConditions:false,prepared:preparedMissingAnchor});
  assert.equal(valid.ok,true);
  assert.equal(result.ok,true);
  assert.equal(result.previewReady,false);
  assert.equal(result.code,'anchor_not_ready');
  assert.equal(result.writes,0);
  assert.match(result.message,/完整日K技术锚点|缺少有效的完整日K技术锚点/);
});

test('preview readiness requires valid anchor and blocks missing or invalid close',()=>{
  const base=stock600({technicalData:{technicalDataStatus:'stale'}}),prepared=Workbench.buildDiscussionRequest(base),fact=prepared.context.currentFacts,raw=fixture('production-current-state-600487-missing-anchor.json.txt').replace('__SOURCE_DISCUSSION_VERSION__',prepared.sourceDiscussionVersion);
  const missingAnchor=Contract.process(raw,{expectedSymbol:prepared.context.symbol,sourceDiscussionVersion:prepared.sourceDiscussionVersion,holdingShares:fact.holding.shares,hasActivePlan:false,technicalDataStatus:fact.technical.dataStatus,programProvesFullPlanConditions:false,prepared:{...prepared,technicalSnapshot:{...prepared.technicalSnapshot,anchorBar:{}}}});
  assert.equal(missingAnchor.ok,true);
  assert.equal(missingAnchor.previewReady,false);
  assert.equal(missingAnchor.writes,0);

  const invalidClose=Contract.process(raw,{expectedSymbol:prepared.context.symbol,sourceDiscussionVersion:prepared.sourceDiscussionVersion,holdingShares:fact.holding.shares,hasActivePlan:false,technicalDataStatus:fact.technical.dataStatus,programProvesFullPlanConditions:false,prepared:{...prepared,technicalSnapshot:{...prepared.technicalSnapshot,anchorBar:{...prepared.technicalSnapshot.anchorBar,close:0}}}});
  assert.equal(invalidClose.ok,true);
  assert.equal(invalidClose.previewReady,false);
  assert.equal(invalidClose.writes,0);
});

test('anchor mismatch blocks readiness with explicit Chinese blocker',()=>{
  const base=stock600({technicalData:{technicalDataStatus:'stale'}}),prepared=Workbench.buildDiscussionRequest(base),fact=prepared.context.currentFacts,raw=fixture('production-current-state-600487-missing-anchor.json.txt').replace('__SOURCE_DISCUSSION_VERSION__',prepared.sourceDiscussionVersion);
  const mismatch=Contract.process(raw,{expectedSymbol:prepared.context.symbol,sourceDiscussionVersion:prepared.sourceDiscussionVersion,holdingShares:fact.holding.shares,hasActivePlan:false,technicalDataStatus:fact.technical.dataStatus,programProvesFullPlanConditions:false,prepared:{...prepared,references:{...(prepared.references||{}),technical:{...(prepared.references&&prepared.references.technical||{}),technicalAsOf:'2026-01-02'}}}});
  assert.equal(mismatch.ok,true);
  assert.equal(mismatch.previewReady,false);
  assert.equal(mismatch.code,'anchor_not_ready');
  assert.match(mismatch.message,/缺少完整日K技术锚点/);assert.equal(mismatch.reason,'anchor_date_mismatch');
});

test('commit is blocked when readiness is false and saveCandidate is never called',async()=>{
  const source=stock600({technicalData:{technicalDataStatus:'stale'}}),prepared=Workbench.buildDiscussionRequest(source),fact=prepared.context.currentFacts,raw=fixture('production-current-state-600487-missing-anchor.json.txt').replace('__SOURCE_DISCUSSION_VERSION__',prepared.sourceDiscussionVersion);
  const invalidPrepared=Object.assign({},prepared,{
    technicalSnapshot:Object.assign({}, prepared.technicalSnapshot, {
      anchorBar:Object.assign({}, prepared.technicalSnapshot.anchorBar, { close: 0 }),
    }),
  });
  const result=Contract.process(
    raw,
    {
      expectedSymbol: prepared.context.symbol,
      sourceDiscussionVersion: prepared.sourceDiscussionVersion,
      holdingShares: fact.holding.shares,
      hasActivePlan: false,
      technicalDataStatus: fact.technical.dataStatus,
      programProvesFullPlanConditions: false,
      prepared: invalidPrepared,
    },
  );
  let called=0;
  const commitResult=await Contract.commit(result,{stocks:[source]},{saveCandidate:()=>{called+=1;return {}}},{prepared});
  assert.equal(commitResult.status,'preview_required');
  assert.equal(commitResult.writes,0);
  assert.equal(called,0);
});

test('anchor changes after preview reject commit as stale and do not write',async()=>{
  const first=confirmedState(stock600());
  const prepared=Workbench.buildDiscussionRequest(first.stock),result=preview(prepared);
  const stale=JSON.parse(JSON.stringify(first.stock));
  stale.priceHistory=stale.priceHistory.concat([{date:'2026-09-01',close:88,adjustment:'qfq',price_basis:'adjusted',provider:'fixture',is_complete_bar:true}]);
  const failed=await Contract.commit(result,{stocks:[stale]},{saveCandidate:()=>{throw new Error('must not write')}},{prepared,timeZone:'Asia/Shanghai'});
  assert.equal(failed.status,'invalid');
  assert.equal(failed.writes,0);
  assert.match(failed.error&&failed.error.message?failed.error.message:'',/受保护的持仓、技术锚点、计划或长期逻辑已经变化/);
});

test('archive validation rejects wrong symbol/version, unknown fields, malformed and truncated JSON with zero writes',()=>{
  const prepared=Workbench.buildDiscussionRequest(stock()),options={expectedSymbol:'601138.SS',sourceDiscussionVersion:prepared.sourceDiscussionVersion};
  assert.equal(Contract.process(JSON.stringify(judgment(prepared,{symbol:'000001.SZ'})),options).writes,0);
  const oldSource=Contract.process(JSON.stringify(judgment(prepared,{sourceDiscussionVersion:'discussion_v1_stale'})),options);assert.equal(oldSource.ok,false);assert.equal(oldSource.code,'validation_error');assert.match(oldSource.message,/结论来源版本已过期或不一致/);assert.doesNotMatch(oldSource.message,/JSON 格式/);
  assert.equal(Contract.process(JSON.stringify({currentState:{...judgment(prepared).currentState,extra:'x'}}),options).ok,false);
  const malformed=Contract.process('{"currentState":',options);assert.equal(malformed.writes,0);assert.equal(malformed.code,'parse_error');assert.match(malformed.message,/JSON/);
  const envelopeError=Contract.process(JSON.stringify({...judgment(prepared),extra:{}}),options);assert.equal(envelopeError.writes,0);assert.equal(envelopeError.code,'schema_error');assert.match(envelopeError.message,/JSON 已解析/);
  const structural=judgment(prepared);delete structural.currentState.trendAssessment.timeframes[0].explanation;const structuralError=Contract.process(JSON.stringify(structural),options);assert.equal(structuralError.ok,false);assert.equal(structuralError.code,'validation_error');assert.match(structuralError.message,/timeframes\[0\] 缺少字段：explanation/);assert.doesNotMatch(structuralError.message,/JSON 格式/);
  assert.equal(Contract.process('```json\n{}\n```',options).writes,0);
});

test('preview is mandatory and stale protected source facts reject with zero writes',async()=>{
  const base=stock(),prepared=Workbench.buildDiscussionRequest(base),result=preview(prepared),mutated={...base,shares:101};
  assert.throws(()=>Contract.buildCandidate({stocks:[mutated]},result,{prepared}),/受保护的持仓、技术锚点、计划或长期逻辑已经变化，请重新开始讨论/);
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
