'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const Readiness=require('../src/discussion-data-readiness'),Workbench=require('../src/discussion-workbench'),Contract=require('../src/discussion-state-contract'),Homepage=require('../src/homepage-attention'),Plan=require('../src/plan-v2');
const F=require('./fixtures/homepage-attention');
const options={now:F.NOW,reviewDate:'2026-09-06'};
function research(){return F.stock({recentCatalyst:{analysisDate:'2026-07-15',latestSourceDate:'2026-07-15',todayCatalyst:'旧事件',freshnessStatus:'stale'},longTermLogic:{investmentThesis:'长期增长',logicStatus:'valid',updatedAt:'2026-07-15'},financialData:{reportPeriod:'2026Q2',lastUpdated:'2026-08-30'},financialReview:{summary:'季度增长',updatedAt:'2026-08-30'}})}
function result(prepared){const saved=F.accept(F.stock()).discussionState.current;saved.userDecision.stopLoss.summary='当前本金风险可控。';const keys=['userDecision','actionAssessment','attentionLevel','trendAssessment','structureAssessment','stage','focusPoints','summary','keyChanges','risks','watchPoints','planRelation','confidence'];const currentState={symbol:prepared.context.symbol,sourceDiscussionVersion:prepared.sourceDiscussionVersion,...Object.fromEntries(keys.map(key=>[key,saved[key]]))};return Contract.process(JSON.stringify({currentState}),{prepared,expectedSymbol:prepared.context.symbol,sourceDiscussionVersion:prepared.sourceDiscussionVersion,holdingShares:100,technicalDataStatus:prepared.context.currentFacts.technical.dataStatus})}
test('current K plus old News/LTL stays ready with neutral dates and no required research',()=>{
  const model=Readiness.build(research(),options);assert.equal(model.technical.ready,true);assert.match(model.technical.label,/行情数据正常.*09-04/);
  for(const key of Object.keys(Readiness.MODULES)){assert.equal(model[key].required,false);assert.doesNotMatch(model[key].label,/待更新|过期|需复核/)}
  assert.equal(model.news.todayRelevance,'outdated');assert.equal(model.fundamental.label,'2026Q2');assert.equal(model.valuation.label,'未提供');
});
test('weekend and long holiday honor canonical freshness without a second calendar',()=>{
  const stock=F.stock({marketDataFreshness:{last_trade_date:F.DAY,is_complete_bar:true,kline_status:'current'},technicalIndicators:{last_trade_date:F.DAY}});
  for(const now of [F.NOW,'2026-09-15T04:00:00Z'])assert.equal(Readiness.build(stock,{now}).technical.ready,true);
});
for(const [name,patch,status] of [
  ['missing K',{priceHistory:[]},'unavailable'],['incomplete K',{priceHistory:[{date:F.DAY,close:50,is_complete_bar:false}]},'unavailable'],['invalid close',{priceHistory:[{date:F.DAY,close:0,is_complete_bar:true}]},'unavailable'],
  ['stale snapshot',{technicalData:{technicalAsOf:F.DAY,latestCompleteBar:F.DAY,technicalDataStatus:'stale'}},'stale'],
  ['mismatched indicator',{marketDataFreshness:{last_trade_date:F.DAY,is_complete_bar:true,kline_status:'current'},technicalIndicators:{last_trade_date:'2026-09-03'}},'anomaly'],
  ['mismatched snapshot',{technicalData:{technicalAsOf:'2026-09-03',latestCompleteBar:F.DAY,technicalDataStatus:'fresh'}},'anomaly'],
  ['unknown status',{technicalData:{technicalAsOf:F.DAY,latestCompleteBar:F.DAY,technicalDataStatus:'unknown'}},'unknown']
])test(`technical ${name} remains limited`,()=>{const model=Readiness.build(F.stock(patch),options);assert.equal(model.technical.status,status);assert.equal(model.technical.ready,false);assert.match(model.technical.actionNote,/电脑端.*手机浏览器不会/)});
test('missing K permits discussion but keeps archive anchor guard',()=>{const prepared=Workbench.buildDiscussionRequest(F.stock({priceHistory:[]}),options);assert.match(prepared.request,/自由讨论仍可继续/);assert.equal(Contract.assessTechnicalAnchorReadiness(prepared).ready,false);assert.equal(result(prepared).previewReady,false)});
test('prepared prompt includes all canonical readiness inputs and minimum evidence rules',()=>{
  const prepared=Workbench.buildDiscussionRequest(research(),options);
  for(const key of ['technical','news','fundamental','longTermLogic','valuation','plan','runtime'])assert.ok(prepared.context.dataReadiness[key]);
  assert.match(prepared.request,/不得仅因.*较旧或缺失就要求更新/);assert.match(prepared.request,/不能用旧新闻或基本面替代缺失日K/);assert.match(prepared.request,/dataReadiness 是 input-only/);
});
const questions=[
  {question:'今天是否安全持有？',required:[],answer:'技术面仍可观察持仓；近期新闻依据不足，因此不判断是否存在新的事件性风险。'},
  {question:'现在有没有高位减仓风险？',required:[],answer:'依据当前技术事实判断高位风险，结构转弱时再复核仓位。'},
  {question:'如果想加仓应该等什么？',required:[],answer:'等待回落后稳定，暂不追高。'},
  {question:'今天大跌是不是消息导致？',required:['news'],answer:'本次判断需要近期新闻依据，建议先更新新闻。'},
  {question:'长期逻辑是不是变了？',required:['longTermLogic','fundamental','news'],answer:'本次判断需要对照长期逻辑、相关财报及事件证据；现有资料不足，建议补充相关依据。'}
];
for(const fixture of questions)test(`deterministic response contract: ${fixture.question}`,()=>{
  const prompt=Workbench.buildDiscussionRequest(research(),options).request;assert.ok(prompt.includes(fixture.question));
  assert.equal(Readiness.build(research(),options).technical.ready,true);
  assert.ok(fixture.required.length<4);assert.doesNotMatch(fixture.answer,/更新全部|估值/);
  if(!fixture.required.length)assert.doesNotMatch(fixture.answer,/先更新/);else assert.match(fixture.answer,/本次判断需要/);
});
test('opening or reordering canonical keys leaves the session current',()=>{
  const stock=research(),prepared=Workbench.buildContext(stock,options);stock.recentCatalyst=Object.fromEntries(Object.entries(stock.recentCatalyst).reverse());
  assert.equal(Readiness.sessionChanged(prepared,Workbench.buildContext(stock,options)),false);
});
for(const [name,mutate] of [
  ['News',s=>s.recentCatalyst.todayCatalyst='新的事件'],['News sentiment',s=>s.shortTermSentiment={marketMood:'事件影响扩大',updatedAt:'2026-09-06'}],['Fundamental raw data',s=>s.financialData.revenue=123],['Fundamental review',s=>s.financialReview.summary='新的财报结论'],['Valuation',s=>s.valuationData={valuationConclusion:'区间改变'}],['LTL',s=>s.longTermLogic.investmentThesis='逻辑改变'],['Plan',s=>s.plans.push(Plan.createPlan({action:'add',triggerPrice:40,triggerDirection:'below',quantity:100}))],['technical freshness',s=>s.technicalData.technicalDataStatus='stale']
])test(`${name} changes invalidate session and reject old confirmation without writes`,async()=>{
  const stock=research(),prepared=Workbench.buildDiscussionRequest(stock,options),parsed=result(prepared);assert.equal(parsed.previewReady,true,parsed.message);mutate(stock);
  const rebuilt=Workbench.buildContext(stock,options);assert.equal(Readiness.sessionChanged(prepared,rebuilt),true);assert.notEqual(prepared.sourceDiscussionVersion,rebuilt.sourceDiscussionVersion);
  let writes=0;const saved=await Contract.commit(parsed,{stocks:[stock]},{saveCandidate:()=>writes++},{prepared,now:F.NOW});assert.notEqual(saved.status,'completed');assert.equal(writes,0);
});
test('soft evidence changes do not redefine protectedHash or Current State schema',()=>{
  const stock=research(),before=Workbench.buildContext(stock,options);stock.recentCatalyst.todayCatalyst='新的事件';const after=Workbench.buildContext(stock,options);
  assert.equal(before.protectedHash,after.protectedHash);assert.notEqual(before.evidenceHash,after.evidenceHash);assert.equal(Workbench.STATE_SCHEMA_VERSION,'stock-discussion.state.v3');
});
test('Runtime revision keeps its exact protected binding',async()=>{
  const state=await F.runtime(),stock=state.stocks[0],prepared=Workbench.buildContext(stock,{...options,state});
  state.planRuntimeStates.byPlanId[stock.plans[0].id].runtimeRevision++;
  const rebuilt=Workbench.buildContext(stock,{...options,state});
  assert.notEqual(prepared.protectedHash,rebuilt.protectedHash);assert.equal(Readiness.sessionChanged(prepared,rebuilt),true);
});
test('high confidence cannot bypass inconsistent technical readiness',()=>{
  const stock=research();stock.technicalData.latestCompleteBar='2026-09-03';
  const prepared=Workbench.buildContext(stock,options),parsed=result(prepared);
  assert.equal(prepared.context.dataReadiness.technical.ready,false);
  assert.equal(parsed.ok,true,parsed.message);const value={currentState:{...parsed.currentState,confidence:'high'}};
  assert.equal(Contract.process(JSON.stringify(value),{prepared,expectedSymbol:prepared.context.symbol,sourceDiscussionVersion:prepared.sourceDiscussionVersion,holdingShares:100,technicalDataStatus:'fresh'}).ok,false);
});
test('soft age and availability alone never change homepage alert count',()=>{
  const state=F.state(),before=Homepage.build(state,{now:F.NOW});
  Object.assign(state.stocks[0],research());const after=Homepage.build(state,{now:F.NOW});
  assert.equal(after.count,before.count);
});
