'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const Home=require('../src/homepage-attention.js'),F=require('./fixtures/homepage-screening.js'),Plan=require('../src/plan-v2.js');
const build=state=>Home.build(state,{now:F.NOW});
const item=state=>build(state).items[0];
test('screening: missing Current State + strong program risk gives only holding attention',()=>{
  const app=F.state({risk:true}),result=item(app);
  assert.equal(result.title,'注意持仓风险');assert.equal(result.source,'program_technical_facts');assert.equal(result.requiresDiscussion,true);assert.equal(result.cta.action,'discussion');assert.equal(result.action,'hold');
  assert.doesNotMatch(result.title+result.summary,/减仓|止盈|止损|MA20|MACD|support|technical/);
});
test('screening: ordinary facts and stale research alone remain quiet',()=>{
  const app=F.state();Object.assign(app.stocks[0],{dataFreshness:{newsUpdatedAt:'2000-01-01',financialUpdatedAt:'2000-01-01',valuationUpdatedAt:'2000-01-01'},longTermLogic:{updatedAt:'2000-01-01'},technicalReview:{updatedAt:'2000-01-01',shortTermTechnical:{riskFlags:['breakdown'],technicalSummary:'应该减仓'}},technicalData:{...app.stocks[0].technicalData,riskFlags:['breakdown']}});
  assert.equal(build(app).count,0);
});
test('screening: valid AI judgment and valid quiet decision both retain precedence',()=>{
  for(const risk of [true,false]){const app=F.state({risk,action:'add'});F.accept(app.stocks[0],{userDecision:{positionDirection:{status:'reduce_review',summary:'当前可考虑减仓。'}}});assert.equal(item(app).source,'risk_current_state');assert.equal(item(app).title,'可考虑减仓');assert.equal(item(app).causes.length,1);F.accept(app.stocks[0]);assert.equal(build(app).count,0)}
});
test('screening: new bar invalidates old AI judgment; risk fallback never quotes it',()=>{
  for(const risk of [true,false]){const app=F.state({risk});F.accept(app.stocks[0],{userDecision:{stopLoss:{status:'risk_control',summary:'旧判断要求关注止损。'}}});const stock=app.stocks[0];stock.priceHistory.push({...stock.priceHistory[0],date:'2026-09-07'});Object.assign(stock.technicalData,{technicalAsOf:'2026-09-07',latestCompleteBar:'2026-09-07'});stock.technicalIndicators.last_trade_date='2026-09-07';const result=Home.build(app,{now:'2026-09-07T10:00:00Z'});assert.equal(result.count,risk?1:0);if(risk){assert.equal(result.items[0].title,'注意持仓风险');assert.equal(result.items[0].causes.some(c=>c.source==='risk_current_state'),false)}}
});
for(const [held,action,title] of [[true,'add','可以考虑加仓'],[true,'buy','可以考虑加仓'],[true,'reduce','可考虑减仓'],[true,'sell','可考虑减仓'],[false,'buy','可以考虑建仓']])test(`screening: ${held?'held':'zero'} ${action} objective price trigger`,()=>{
  const app=F.state({held,action}),result=item(app);assert.equal(result.title,title);assert.equal(result.code,'plan_trigger');assert.equal(result.cta.action,'discussion');assert.equal(result.planVersion,1);assert.equal(result.triggerStatus,'triggered');assert.match(result.summary,/其他条件/);assert.equal(app.stocks[0].plans[0].fullConditionStatus,'unproven');assert.equal(app.stocks[0].plans[0].priceTriggerStatus,'unavailable');
});
test('screening: invalid Current State does not block an independent valid price Plan',()=>{
  const app=F.state({action:'reduce'});F.accept(app.stocks[0],{userDecision:{takeProfit:{status:'review',summary:'旧止盈结论。'}}});app.stocks[0].shares++;assert.equal(item(app).title,'可考虑减仓');assert.equal(item(app).source,'plan_runtime');assert.doesNotMatch(item(app).secondary,/止盈/);
});
test('screening: canonical zero shares override stale holding type and category',()=>{
  for(const action of [null,'add','reduce','sell']){const app=F.state({held:false,risk:true,action});Object.assign(app.stocks[0],{type:'holding',managementCategory:'core',currentValue:5000});assert.equal(build(app).count,0)}
});
test('screening: no-plan opportunity never creates a buy or add decision',()=>{
  for(const held of [true,false])assert.equal(build(F.state({held})).count,0);
});
test('screening: partial weakness is insufficient; no action inferred from prose',()=>{
  for(const patch of [{ma20:50},{ma20:55,ma60:54},{macd:{histogram:0}},{macd:{histogram:null}},{ma60:0},{ma20:'52'}]){const app=F.state({risk:true});Object.assign(app.stocks[0].technicalIndicators,patch);assert.equal(build(app).count,0)}
});
test('screening: unhealthy, incomplete, nonfinite, duplicate and undated facts fail closed',()=>{
  const changes=[s=>s.technicalData.technicalDataStatus='stale',s=>s.technicalData.technicalDataStatus='anomaly',s=>s.priceHistory=[],s=>s.priceHistory[0].is_complete_bar=false,s=>delete s.priceHistory[0].is_complete_bar,s=>s.priceHistory[0].close=NaN,s=>s.priceHistory.push({...s.priceHistory[0]}),s=>s.technicalData.price=100,s=>delete s.technicalData.technicalAsOf];
  for(const change of changes){const app=F.state({risk:true,action:'reduce'});change(app.stocks[0]);assert.equal(build(app).items.some(i=>['program_technical_facts','plan_runtime'].includes(i.source)),false)}
  for(const date of [undefined,'2020-01-01','2026-09-07']){const app=F.state({risk:true});app.stocks[0].technicalIndicators.last_trade_date=date;assert.equal(build(app).count,0)}
});
test('screening: stale stored price-trigger status and unrelated live price never trigger',()=>{
  const app=F.state({action:'add'}),plan=app.stocks[0].plans[0];plan.priceTriggerStatus='triggered';plan.triggerPrice=45;assert.equal(build(app).count,0);plan.triggerPrice=49;assert.equal(build(app).count,0);plan.triggerPrice=50;app.stocks[0].currentPrice=10;assert.equal(build(app).count,0);
});
test('screening: plan edits immediately recompute against current version',()=>{
  const app=F.state({action:'reduce'}),stock=app.stocks[0];stock.plans[0]=Plan.applyAuthoritativeEdit(stock.plans[0],{triggerPrice:60},{now:F.NOW});assert.equal(build(app).count,0);stock.plans[0]=Plan.applyAuthoritativeEdit(stock.plans[0],{triggerPrice:50},{now:F.NOW});assert.equal(item(app).planVersion,3);
});
test('screening: inactive, expired, malformed, invalidated, unreviewed and allocation-less Plans cannot alert',()=>{
  const changes=[p=>p.status='completed',p=>p.status='replaced',p=>p.validityStatus='needs_review',p=>p.validUntil='2020-01-01',p=>p.nextReviewDate='2020-01-01',p=>p.planVersion=0,p=>p.triggerDirection=null,p=>p.source='migrated_legacy',p=>p.invalidationReason='失效',p=>p.conditions.invalidation=[{text:'已失效',status:'confirmed'}],p=>p.allocationConstraint={}];
  for(const change of changes){const app=F.state({action:'add'});change(app.stocks[0].plans[0]);assert.equal(build(app).count,0)}
});
test('screening: price reference and AI Runtime phase are not objective watch-condition triggers',async()=>{
  for(const phase of ['watch_zone','forming','confirmed','action_review']){const app=await F.runtime(phase);delete app.stocks[0].discussionState;const result=build(app);assert.equal(result.items.some(i=>i.code==='plan_trigger'),false);assert.equal(result.items.some(i=>/可以考虑|可考虑减仓/.test(i.title)),false)}
});
test('screening: one symbol one card; defensive facts suppress buy Plan and reduction wins generic risk',()=>{
  const app=F.state({risk:true,action:'add'});assert.equal(item(app).title,'注意持仓风险');assert.equal(item(app).secondary,'');app.stocks[0].plans.push(F.plan('reduce'));const result=build(app);assert.equal(result.count,1);assert.equal(result.items[0].title,'可考虑减仓');assert.equal(result.items[0].secondary,'');assert.equal(result.items[0].causes.length,1);
});
test('screening: duplicate Plan ids and unknown shares fail closed',()=>{
  const app=F.state({action:'add'});app.stocks[0].plans.push({...app.stocks[0].plans[0]});assert.equal(build(app).count,0);for(const shares of [undefined,null,NaN,-1]){const state=F.state({action:'buy'});state.stocks[0].shares=shares;assert.equal(build(state).count,0)}
});
test('screening: fresh risk takes precedence over generic stale Runtime binding notice',async()=>{
  const app=await F.runtime('action_review');delete app.stocks[0].discussionState;app.stocks[0].technicalIndicators=F.state({risk:true}).stocks[0].technicalIndicators;
  assert.equal(item(app).title,'注意持仓风险');assert.equal(item(app).secondary,'');assert.equal(item(app).cta.action,'discussion');
});
test('screening: deterministic read-only result preserves all facts and creates no permanent signals',()=>{
  const app=F.state({risk:true,action:'reduce'}),before=structuredClone(app);assert.deepEqual(build(app),build(app));assert.deepEqual(app,before);assert.equal('screeningSignals' in app,false);
});
