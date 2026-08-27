'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const PlanV2=require('../src/plan-v2.js');
const PlanReview=require('../src/plan-review.js');
const PortfolioContext=require('../src/portfolio-review-context.js');

const now='2026-08-27T10:00:00.000Z';
const later='2026-08-28T10:00:00.000Z';
function makePlan(id='plan-a',overrides={}){
  return PlanV2.createPlan({id,action:'buy',triggerPrice:100,triggerDirection:'below',note:`计划 ${id}`,allocationConstraint:{maxPositionPct:12,targetWeightRange:'8%-12%'},conditions:{technical:['支撑确认'],fundamental:['逻辑未破坏']},...overrides},{now,source:overrides.source||'manual'});
}
function makeStock(code='600000.SS',plans=[makePlan()]){
  return {id:code,name:`标的 ${code}`,code,type:'holding',role:'核心仓',theme:'测试',shares:100,currentPrice:105,currentValue:10500,targetPct:10,capPct:12,plans};
}
function fixture(){return {stocks:[makeStock('600000.SS',[makePlan('plan-a')]),makeStock('000001.SZ',[makePlan('plan-b',{action:'sell',triggerPrice:120,triggerDirection:'above'})])]}}
function contextFor(state=fixture()){
  return PlanReview.buildContext(state.stocks,{allStocks:state.stocks,portfolioContext:PortfolioContext,reviewDate:'2026-08-27',generatedAt:now,planReviewStore:state.planReviews});
}
function responseFor(context,outcomes=['still_valid','likely_invalid']){
  return {planReviews:context.expectedPlans.map((item,index)=>({symbol:item.symbol,planId:item.planId,planVersion:item.planVersion,review:{outcome:outcomes[index]||'needs_review',summary:`第 ${index+1} 条复核结论`,changedPremises:index?['前提有变化']:[],riskFlags:index?['资料需人工确认']:[],suggestedChanges:index?[{field:'triggerPrice',suggestion:'请用户重新检查触发价格，不提供替代数字'}]:[],confidence:index?'low':'medium'}}))};
}
function previewFor(state=fixture(),outcomes){const context=contextFor(state),result=PlanReview.process(JSON.stringify(responseFor(context,outcomes)),{expectedPlans:context.expectedPlans,reviewDate:context.reviewDate});return {context,result}}
async function saveReview(state,outcomes){const {result}=previewFor(state,outcomes);return PlanReview.commitReviewSnapshot(result,state,{saveCandidate:async candidate=>candidate},{now})}

test('canonical PlanReview normalization exposes separate review schema',()=>{
  const value=PlanReview.normalizePlanReview({reviewId:'r1',symbol:'600000.SH',planId:'p1',planVersion:2,planSnapshotHash:'h',reviewDate:'2026-08-27',reviewedAt:now,outcome:'still_valid',priceTriggerStatus:'near',fullConditionStatus:'unproven',changedPremises:[' x ','x'],riskFlags:[],suggestedChanges:[],summary:'可继续复核',confidence:'medium'});
  assert.equal(value.schemaVersion,'plan-review.v1');assert.equal(value.symbol,'600000.SS');assert.equal(value.reviewOutcome,'still_valid');assert.deepEqual(value.changedPremises,['x']);assert.equal(value.source,'ai_batch_review');
});

test('PlanReview validation requires Plan ID, version and snapshot hash',()=>{
  const base={reviewId:'r1',schemaVersion:'plan-review.v1',symbol:'600000.SS',planId:'p1',planSnapshotHash:'h',reviewDate:'2026-08-27',reviewedAt:now,reviewOutcome:'still_valid',summary:'ok',confidence:'medium'};
  assert.equal(PlanReview.validatePlanReview(base).ok,false);assert.match(PlanReview.validatePlanReview({...base,planVersion:1,planId:''}).errors.join(' '),/planId/);assert.equal(PlanReview.validatePlanReview({...base,planVersion:1}).ok,true);
});

test('review becomes stale when Plan version or authoritative snapshot changes',()=>{
  const plan=makePlan(),review=PlanReview.normalizePlanReview({reviewId:'r',symbol:'600000.SS',planId:plan.id,planVersion:plan.planVersion,planSnapshotHash:PlanReview.planSnapshotHash(plan),reviewDate:'2026-08-27',reviewedAt:now,reviewOutcome:'still_valid',summary:'ok',confidence:'medium'});
  assert.equal(PlanReview.reviewFreshness(review,plan).status,'current');assert.equal(PlanReview.reviewFreshness(review,PlanV2.reconfirmPlan(plan,{now:later})).status,'stale');assert.equal(PlanReview.reviewFreshness(review,{...plan,note:'事实变化'}).status,'stale');
});

test('selection includes active and legacy needs-review Plans, excludes terminal Plans and no-Plan stocks',()=>{
  const legacy=PlanV2.normalizePlan({id:'legacy',action:'buy',price:88,triggerOn:'below',note:'旧计划'}),done=PlanV2.terminatePlan(makePlan('done'),'completed',{now});
  const stocks=[makeStock('600000.SS',[legacy]),makeStock('000001.SZ',[done]),makeStock('0700.HK',[])];
  assert.deepEqual(PlanReview.selectableStocks(stocks,{reviewDate:'2026-08-27'}).map(stock=>stock.code),['600000.SS']);assert.equal(PlanReview.candidatePlans(stocks[0],'2026-08-27')[0].freshness,'historical_only');
});

test('context is compact, carries deterministic premise facts, and does not invent market regime',()=>{
  const state={stocks:[makeStock('600000.SS',[makePlan('p',{validUntil:'2026-08-26',nextReviewDate:'2026-08-26',allocationConstraint:{maxPositionPct:5,targetWeightRange:'4%-5%'}})])]};
  const context=contextFor(state),candidate=context.stocks[0].plans[0],codes=candidate.programPremiseFacts.map(item=>item.code);
  assert.equal(context.marketContext.status,'unavailable');assert.ok(codes.includes('valid_until_passed'));assert.ok(codes.includes('review_date_passed'));assert.ok(codes.includes('allocation_limit_exceeded'));assert.ok(codes.includes('technical_not_current'));assert.equal(Object.hasOwn(context.stocks[0],'priceHistory'),false);
});

test('request contract separates program facts, AI judgment and user mutations',()=>{
  const state=fixture(),request=PlanReview.buildRequest(state.stocks,{allStocks:state.stocks,portfolioContext:PortfolioContext,reviewDate:'2026-08-27',generatedAt:now});
  assert.match(request,/只输出判断，不修改正式计划/);assert.match(request,/不得发明触发价/);assert.match(request,/价格已触发不等于完整条件/);assert.match(request,/每个预期 Plan ID\/版本必须恰好返回一次/);assert.match(request,/市场状态模块，不得臆测/);
});

test('valid response produces preview and natural Chinese summary without writes',()=>{
  const {result}=previewFor();const html=PlanReview.renderPreview(result,symbol=>`名称 ${symbol}`);
  assert.equal(result.ok,true);assert.equal(result.writes,0);assert.match(html,/继续有效 1/);assert.match(html,/可能失效 1/);assert.match(html,/当前计划/);assert.match(html,/这是 AI 复核结果，不是正式计划修改/);assert.doesNotMatch(html,/still_valid|likely_invalid|planVersion|snapshotHash/);
});

test('malformed and truncated JSON produce zero eligible writes',()=>{
  const expected=contextFor().expectedPlans;for(const raw of ['not json','{"planReviews":[']){const result=PlanReview.process(raw,{expectedPlans:expected,reviewDate:'2026-08-27'});assert.equal(result.ok,false);assert.equal(result.writes,0);assert.equal(PlanReview.eligibleEntries(result).length,0)}
});

test('unexpected symbol is rejected',()=>{const context=contextFor(),value=responseFor(context);value.planReviews[0].symbol='0700.HK';const result=PlanReview.process(JSON.stringify(value),{expectedPlans:context.expectedPlans});assert.equal(result.ok,false);assert.match(result.message,/unexpected symbol/)});
test('unexpected Plan ID is rejected',()=>{const context=contextFor(),value=responseFor(context);value.planReviews[0].planId='unknown';const result=PlanReview.process(JSON.stringify(value),{expectedPlans:context.expectedPlans});assert.equal(result.ok,false);assert.match(result.message,/unexpected Plan ID/)});
test('wrong Plan version is rejected',()=>{const context=contextFor(),value=responseFor(context);value.planReviews[0].planVersion++;const result=PlanReview.process(JSON.stringify(value),{expectedPlans:context.expectedPlans});assert.equal(result.ok,false);assert.match(result.message,/wrong Plan version/)});
test('duplicate review and missing selected Plan are both rejected',()=>{const context=contextFor(),value=responseFor(context);value.planReviews=[value.planReviews[0],value.planReviews[0]];const result=PlanReview.process(JSON.stringify(value),{expectedPlans:context.expectedPlans});assert.equal(result.ok,false);assert.match(result.message,/duplicate PlanReview/);assert.match(result.message,/missing selected Plan/)});
test('extra records and extra fields are rejected',()=>{const context=contextFor(),value=responseFor(context);value.planReviews[0].extra=true;const result=PlanReview.process(JSON.stringify(value),{expectedPlans:context.expectedPlans});assert.equal(result.ok,false);assert.match(result.message,/item fields invalid/)});

test('smart quote JSON recovery works',()=>{const context=contextFor(),raw=JSON.stringify(responseFor(context)).replace(/"([^"\\]*(?:\\.[^"\\]*)*)"/g,'“$1”');const result=PlanReview.process(raw,{expectedPlans:context.expectedPlans,reviewDate:context.reviewDate});assert.equal(result.ok,true);assert.equal(result.input.smartQuotesRecovered,true)});
test('Markdown fence JSON recovery works',()=>{const context=contextFor(),raw=`\n\`\`\`json\n${JSON.stringify(responseFor(context))}\n\`\`\`\n`;const result=PlanReview.process(raw,{expectedPlans:context.expectedPlans,reviewDate:context.reviewDate});assert.equal(result.ok,true)});

test('preview is required before save',async()=>{const state=fixture(),result=await PlanReview.commitReviewSnapshot({ok:false,previewReady:false},state,{saveCandidate:async()=>{throw new Error('must not write')}});assert.equal(result.status,'preview_required');assert.equal(result.writes,0)});

test('one successful import creates one coherent review snapshot and leaves Plans unchanged',async()=>{
  const state=fixture(),before=JSON.stringify(state.stocks.map(stock=>stock.plans)),saved=await saveReview(state);
  assert.equal(saved.status,'completed');assert.equal(saved.writes,1);assert.equal(saved.state.planReviews.snapshots.length,1);assert.equal(saved.state.planReviews.snapshots[0].reviews.length,2);assert.equal(JSON.stringify(saved.state.stocks.map(stock=>stock.plans)),before);assert.deepEqual(saved.state.planReviews.snapshots[0].reviews,saved.reviews);
});

test('review save rejects a stale preview if Plan changed before commit',async()=>{
  const state=fixture(),{result}=previewFor(state);state.stocks[0].plans[0]=PlanV2.reconfirmPlan(state.stocks[0].plans[0],{now:later});let writes=0;const saved=await PlanReview.commitReviewSnapshot(result,state,{saveCandidate:async()=>{writes++}});
  assert.equal(saved.status,'invalid');assert.equal(saved.writes,0);assert.equal(writes,0);
});

test('failed review save preserves previous review snapshot and authoritative state',async()=>{
  const first=await saveReview(fixture()),state=first.state,before=JSON.stringify(state);const {result}=previewFor(state,['needs_review','completed_candidate']);let rolled=false;
  const failed=await PlanReview.commitReviewSnapshot(result,state,{saveCandidate:async()=>{throw new Error('disk full')},rollback:original=>{rolled=original===state}},{now:later});
  assert.equal(failed.status,'failed');assert.equal(rolled,true);assert.equal(JSON.stringify(state),before);assert.equal(state.planReviews.snapshots.length,1);
});

test('AI still_valid and likely_invalid judgments never mutate or reconfirm Plan',async()=>{
  const state=fixture(),before=JSON.stringify(state.stocks),saved=await saveReview(state,['still_valid','likely_invalid']);assert.equal(JSON.stringify(saved.state.stocks),before);assert.equal(saved.state.stocks[0].plans[0].lastReviewedAt,null);assert.equal(saved.state.stocks[1].plans[0].status,'active');
});

test('explicit reconfirm preserves facts and increments Plan version',async()=>{
  const state=fixture(),before=state.stocks[0].plans[0],result=await PlanReview.applyPlanActions(state,[{symbol:'600000.SS',planId:before.id,action:'reconfirm',nextReviewDate:'2026-09-27'}],{saveCandidate:async candidate=>candidate},{now:later}),after=result.state.stocks[0].plans[0];
  assert.equal(result.status,'completed');assert.equal(after.planVersion,before.planVersion+1);assert.equal(after.lastReviewedAt,later);assert.equal(after.triggerPrice,before.triggerPrice);assert.deepEqual(after.conditions,before.conditions);
});

test('explicit invalidation preserves Plan object and records reason and termination',async()=>{
  const state=fixture(),plan=state.stocks[0].plans[0],result=await PlanReview.applyPlanActions(state,[{symbol:'600000.SS',planId:plan.id,action:'invalidate',reason:'核心前提已变化'}],{saveCandidate:async candidate=>candidate},{now:later}),after=result.state.stocks[0].plans[0];
  assert.equal(result.status,'completed');assert.equal(after.id,plan.id);assert.equal(after.planVersion,plan.planVersion+1);assert.equal(after.status,'cancelled');assert.equal(after.validityStatus,'invalid');assert.equal(after.invalidationReason,'核心前提已变化');assert.equal(after.terminatedAt,later);assert.equal(result.state.stocks[0].plans.length,1);
});

test('explicit completion preserves Plan object and excludes it from active inputs',async()=>{
  const state=fixture(),plan=state.stocks[0].plans[0],result=await PlanReview.applyPlanActions(state,[{symbol:'600000.SS',planId:plan.id,action:'complete'}],{saveCandidate:async candidate=>candidate},{now:later}),after=result.state.stocks[0].plans[0];
  assert.equal(after.id,plan.id);assert.equal(after.status,'completed');assert.equal(after.validityStatus,'completed');assert.equal(after.planVersion,2);assert.equal(PlanReview.candidatePlans(result.state.stocks[0],'2026-08-28').length,0);assert.equal(PortfolioContext.buildPortfolioContext(result.state.stocks,{reviewDate:'2026-08-28'}).stocks[0].plans.length,0);
});

test('Plan edit candidate shows only explicit structured diff',()=>{const plan=makePlan(),diff=PlanReview.buildPlanEditDiff(plan,{triggerPrice:98,note:'新备注'},{now:later});assert.equal(diff.changed,true);assert.deepEqual(diff.diff.map(item=>item.field),['triggerPrice','note']);assert.equal(diff.next.planVersion,2)});

test('vague AI suggestion remains text and cannot silently become numeric change',()=>{
  const plan=makePlan(),review={suggestedChanges:[{field:'triggerPrice',suggestion:'请重新考虑价格'}]},draft=PlanReview.createPlanUpdateDraft(plan,review);
  assert.deepEqual(draft.patch,{});assert.equal(draft.requiresExplicitValues,true);assert.equal(draft.suggestions[0].suggestion,'请重新考虑价格');assert.equal(draft.planVersion,plan.planVersion);
});

test('batch reconfirm performs one atomic save',async()=>{
  const state=fixture(),actions=state.stocks.map(stock=>({symbol:stock.code,planId:stock.plans[0].id,action:'reconfirm'}));let writes=0;const result=await PlanReview.applyPlanActions(state,actions,{saveCandidate:async candidate=>{writes++;return candidate}},{now:later});
  assert.equal(result.status,'completed');assert.equal(result.writes,1);assert.equal(writes,1);assert.deepEqual(result.state.stocks.map(stock=>stock.plans[0].planVersion),[2,2]);
});

test('invalid batch action is atomic and produces zero writes',async()=>{
  const state=fixture(),before=JSON.stringify(state),actions=[{symbol:'600000.SS',planId:'plan-a',action:'reconfirm'},{symbol:'000001.SZ',planId:'missing',action:'reconfirm'}];let writes=0;const result=await PlanReview.applyPlanActions(state,actions,{saveCandidate:async()=>{writes++}},{now:later});
  assert.equal(result.status,'invalid');assert.equal(result.writes,0);assert.equal(writes,0);assert.equal(JSON.stringify(state),before);
});

test('failed batch Plan save rolls back without changing authoritative state',async()=>{
  const state=fixture(),before=JSON.stringify(state);let rolled=false;const result=await PlanReview.applyPlanActions(state,[{symbol:'600000.SS',planId:'plan-a',action:'reconfirm'}],{saveCandidate:async()=>{throw new Error('fail')},rollback:original=>{rolled=original===state}},{now:later});
  assert.equal(result.status,'failed');assert.equal(rolled,true);assert.equal(JSON.stringify(state),before);
});

test('confirmed Plan mutation makes its old PlanReview stale',async()=>{
  const saved=await saveReview(fixture()),review=PlanReview.currentReview(saved.state.planReviews,'600000.SS','plan-a'),mutated=await PlanReview.applyPlanActions(saved.state,[{symbol:'600000.SS',planId:'plan-a',action:'reconfirm'}],{saveCandidate:async candidate=>candidate},{now:later});
  assert.equal(PlanReview.reviewFreshness(review,mutated.state.stocks[0].plans[0]).status,'stale');
});

test('Portfolio Review consumes current judgment without changing Plan facts',async()=>{
  const saved=await saveReview(fixture(),['likely_invalid','still_valid']),state=saved.state,planBefore=JSON.stringify(state.stocks[0].plans[0]),context=PortfolioContext.buildPortfolioContext(state.stocks,{allStocks:state.stocks,reviewDate:'2026-08-27',planReviewStore:state.planReviews}),row=context.stocks[0].plans[0];
  assert.equal(row.reviewJudgment.outcome,'likely_invalid');assert.equal(row.reviewJudgment.freshness,'current');assert.equal(row.triggerPrice,100);assert.equal(row.validityStatus,'active');assert.equal(JSON.stringify(state.stocks[0].plans[0]),planBefore);assert.equal(context.readiness.planReviews.caution,1);
});

test('Portfolio Review marks old judgment stale and lowers confidence without removing Plan',async()=>{
  const saved=await saveReview(fixture()),state=saved.state;state.stocks[0].plans[0]=PlanV2.reconfirmPlan(state.stocks[0].plans[0],{now:later});const context=PortfolioContext.buildPortfolioContext(state.stocks,{reviewDate:'2026-08-28',planReviewStore:state.planReviews}),row=context.stocks[0].plans[0];
  assert.equal(row.reviewJudgment.freshness,'stale');assert.equal(context.readiness.planReviews.missingOrStale,1);assert.equal(row.id,'plan-a');
});

test('legacy needs-review Plan remains cautious in Portfolio and batch context',()=>{
  const legacy=PlanV2.normalizePlan({id:'legacy',action:'buy',price:88,triggerOn:'below',note:'旧计划'}),state={stocks:[makeStock('600000.SS',[legacy])]},portfolio=PortfolioContext.buildPortfolioContext(state.stocks,{reviewDate:'2026-08-27'}),batch=contextFor(state);
  assert.equal(portfolio.stocks[0].plans[0].validityStatus,'needs_review');assert.equal(portfolio.stocks[0].plans[0].freshness,'historical_only');assert.equal(batch.stocks[0].plans[0].reviewClass,'historical_only');assert.ok(batch.stocks[0].plans[0].programPremiseFacts.some(item=>item.code==='legacy_review_unknown'));
});

test('end-to-end isolated fixture saves judgments then applies only two explicit actions',async()=>{
  const state=fixture();state.stocks.push(makeStock('0700.HK',[makePlan('plan-c',{action:'observe',triggerPrice:null,triggerDirection:null,allocationConstraint:{}})]));const context=contextFor(state),json=responseFor(context,['still_valid','likely_invalid','needs_review']),preview=PlanReview.process(JSON.stringify(json),{expectedPlans:context.expectedPlans,reviewDate:context.reviewDate}),before=JSON.stringify(state.stocks),saved=await PlanReview.commitReviewSnapshot(preview,state,{saveCandidate:async candidate=>candidate},{now});
  assert.equal(JSON.stringify(saved.state.stocks),before);const changed=await PlanReview.applyPlanActions(saved.state,[{symbol:'600000.SS',planId:'plan-a',action:'reconfirm'},{symbol:'000001.SZ',planId:'plan-b',action:'invalidate',reason:'用户确认失效'}],{saveCandidate:async candidate=>candidate},{now:later});
  assert.equal(changed.state.stocks[0].plans[0].planVersion,2);assert.equal(changed.state.stocks[1].plans[0].status,'cancelled');assert.equal(changed.state.stocks[2].plans[0].planVersion,1);assert.equal(PlanReview.reviewStatusForPlan(changed.state.planReviews,'600000.SS',changed.state.stocks[0].plans[0]).freshness.status,'stale');assert.equal(PlanReview.reviewStatusForPlan(changed.state.planReviews,'0700.HK',changed.state.stocks[2].plans[0]).freshness.status,'current');
});

test('mobile UI exposes staged actions and no automatic Plan mutation route',()=>{
  const source=fs.readFileSync(path.join(__dirname,'../src/plan-review-ui.js'),'utf8');for(const label of ['批量复核','保存复核','保持不变','确认有效','修改计划','标记失效','标记完成','预览差异','确认修改'])assert.match(source,new RegExp(label));assert.match(source,/confirm\(/);assert.match(source,/buildPlanEditDiff/);assert.doesNotMatch(source,/suggestedChanges[^\n]*patch\s*=/);
});

test('existing single-stock Plan Refresh remains proposal, diff/confirmation, then candidate save',()=>{
  const source=fs.readFileSync(path.join(__dirname,'../src/ui-render.js'),'utf8');assert.match(source,/PlanV2\.createPlan/);assert.match(source,/confirm\(/);assert.match(source,/PlanV2\.commitCandidate/);assert.match(source,/待确认|预览|提案/);
});
