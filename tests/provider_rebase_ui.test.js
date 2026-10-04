'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const context={console,TechnicalFreshness:require('../src/technical-freshness.js')};vm.createContext(context);
vm.runInContext(fs.readFileSync(require.resolve('../src/state.js'),'utf8'),context);
const W=require('../src/discussion-workbench.js');
vm.runInContext(fs.readFileSync(require.resolve('../src/import-export.js'),'utf8'),context);
const contract={symbol:'2899.HK',canonicalProvider:'yahoo',providerVersion:'v1',adjustment:'qfq',priceBasis:'adjusted',normalizationVersion:'python-round-6-v1',historyWindow:{start:'2026-10-02',end:'2026-10-02'}};
const receipt={sourceContract:contract,dataContentVersion:'h',technicalVersion:'t',latestCompleteBar:'2026-10-02',historyWriteGuard:{version:'provider-revision-engine-v1',classification:'STABLE',contentHash:'h'}};
const row={date:'2026-10-02',open:10,high:12,low:9,close:11,volume:100,provider:'yahoo',adjustment:'qfq',price_basis:'adjusted',is_complete_bar:true};
test('certified history rejects legacy/static/CSV mixed overwrite',()=>{
 const stock={marketDataFreshness:{...receipt,sourceMigration:{generation:2}}};
 assert.throws(()=>context.assertMarketHistoryContinuity(stock,[row],{}),/UNSAFE_WRITE_PATH_BLOCKED/);
 assert.throws(()=>context.assertMarketHistoryContinuity(stock,[{...row,provider:'eastmoney'}],{sourceContract:contract}),/UNSAFE_WRITE_PATH_BLOCKED/);
 assert.throws(()=>context.assertMarketHistoryContinuity(stock,[row],{...receipt,sourceMigration:{generation:1}}),/generation/);
 assert.doesNotThrow(()=>context.assertMarketHistoryContinuity(stock,[row],{...receipt,sourceMigration:{generation:2}}));
});
test('source-change context preserves saved discussion and emits existing continuity warning',()=>{
 const stock={code:'2899.HK',priceHistory:[row],technicalData:{technicalAsOf:row.date,latestCompleteBar:row.date,technicalDataStatus:'fresh'},
  discussionState:{current:{summary:'must survive'},history:[{summary:'historical'}]},
  marketDataFreshness:{sourceMigration:{previousVersion:'old',currentVersion:'new',generation:1}}};
 const saved=JSON.stringify(stock),r=W.barsAfter(stock,row,{symbol:stock.code});
 assert.equal(r.mode,'bootstrap');assert.match(r.warnings[0],/来源已迁移/);assert.equal(JSON.stringify(stock),saved);
 assert.equal(W.barsAfter(stock,row,{symbol:'601869.SS'}).mode,'blocked');
});
test('unknown AI judgments are not fabricated by candidate technical facts',()=>{
 const stock={code:'2899.HK',priceHistory:[row],marketDataFreshness:{sourceContract:contract,dataVersion:'fixture'},technicalIndicators:{last_trade_date:row.date,ma60:null},
  technicalReview:{shortTermTechnical:{trendStatus:'uptrend',riskFlags:['old']}}};
 const review=JSON.stringify(stock.technicalReview);context.updateTechnicalDataFromPriceHistory(stock,{referenceDate:'2026-10-04'});
 assert.equal(stock.technicalData.ma60,null);assert.equal(JSON.stringify(stock.technicalReview),review);
});
test('same dates cannot hide a rebase version conflict or resurrect old AI judgments',()=>{
 const stock={code:'2899.HK',priceHistory:[row],marketDataFreshness:{last_trade_date:row.date,kline_status:'current',dataVersion:'new',sourceMigration:{aiJudgmentStatus:'needs_review'}},
  technicalData:{technicalAsOf:row.date,latestCompleteBar:row.date,technicalDataStatus:'fresh',dataVersion:'old'},
  technicalIndicators:{last_trade_date:row.date,dataVersion:'new'},technicalReview:{shortTermTechnical:{trendStatus:'uptrend',riskFlags:['old risk'],technicalSummary:'old conclusion'}}};
 assert.equal(context.TechnicalFreshness.evaluateTechnicalFreshness(stock,{referenceDate:'2026-10-04'}).ready,false);
 const snapshot=W.technicalSnapshot(stock);assert.equal(snapshot.trendStatus,'unclear');assert.deepEqual(snapshot.riskFlags,[]);
 assert.equal(stock.technicalReview.shortTermTechnical.trendStatus,'uptrend');
});

test('full snapshot import rejects old market history before persistence',async()=>{
 let writes=0;
 context.StorageManager={saveState:async()=>{writes++;return true}};
 context.importFixture={stocks:[{code:'2899.HK',priceHistory:[row],marketDataFreshness:{...receipt,sourceMigration:{generation:2}}}]};
 vm.runInContext('state=importFixture',context);
 await assert.rejects(context.persistCandidateSnapshot({stocks:[{code:'2899.HK',priceHistory:[row]}]}),/UNSAFE_WRITE_PATH_BLOCKED/);
 assert.equal(writes,0);
 await context.persistCandidateSnapshot(context.importFixture);
 assert.equal(writes,1);
 vm.runInContext('state={stocks:[]}',context);
 delete context.importFixture;delete context.StorageManager;
});


test('revision and unit review have distinct visible mobile messages',()=>{
 const O=require('../src/market-data-orchestrator.js');
 assert.match(O.errorLabel('SAME_PROVIDER_REVISION'),/同一行情源.*修订/);
 assert.match(O.errorLabel('UNIT_CONTRACT_INCOMPLETE'),/单位.*不能应用/);
 assert.match(O.errorLabel('PROVIDER_SWITCH'),/来源与历史不同/);
 assert.match(O.presentation({status:'failed',error:'SAME_PROVIDER_REVISION'}),/待复核.*保留/);
});
test('unexplained revision overlay blocks readiness without rewriting the last valid snapshot',()=>{
 const stock={code:'2899.HK',priceHistory:[row],marketDataFreshness:{last_trade_date:row.date,kline_status:'current'},
 technicalData:{technicalAsOf:row.date,latestCompleteBar:row.date,technicalDataStatus:'fresh'},technicalIndicators:{last_trade_date:row.date}};
 const facts=JSON.stringify(stock);stock.marketRevisionReview={status:'review_required'};
 assert.equal(context.TechnicalFreshness.evaluateTechnicalFreshness(stock,{referenceDate:'2026-10-04'}).ready,false);
 delete stock.marketRevisionReview;assert.equal(JSON.stringify(stock),facts);
});
test('guard rejects micro revisions, missing historical dates, raw imports and mixed baselines',()=>{
 const stock={code:'2899.HK',priceHistory:[row],marketDataFreshness:{}};
 assert.throws(()=>context.assertMarketHistoryContinuity(stock,[{...row,close:11.000004}],receipt),/SAME_PROVIDER_REVISION/);
 assert.throws(()=>context.assertMarketHistoryContinuity(stock,[{...row,date:'2026-10-03'}],receipt),/SAME_PROVIDER_REVISION/);
 assert.throws(()=>context.assertMarketHistoryContinuity({},[row],receipt,{path:'import'}),/UNSAFE_WRITE_PATH_BLOCKED/);
 stock.priceHistory.push({...row,date:'2026-10-01',provider:'eastmoney'});
 assert.throws(()=>context.assertMarketHistoryContinuity(stock,[row],receipt),/PROVIDER_REBASE_REQUIRED/);
});
test('data and technical versions are checked independently of unchanged dates',()=>{
 const stock={code:'2899.HK',priceHistory:[row],marketDataFreshness:{last_trade_date:row.date,kline_status:'current',dataContentVersion:'new',technicalVersion:'tech2'},
 technicalData:{technicalAsOf:row.date,latestCompleteBar:row.date,technicalDataStatus:'fresh',dataContentVersion:'new',technicalVersion:'tech1'},
 technicalIndicators:{last_trade_date:row.date,dataContentVersion:'new',technicalVersion:'tech2'}};
 const outcome=context.TechnicalFreshness.evaluateTechnicalFreshness(stock,{referenceDate:'2026-10-04'});
 assert.equal(outcome.ready,false);assert.equal(outcome.conflict,true);
});

test('page, readiness and Discussion bind the same revision versions and block unresolved review',()=>{
 const U=require('../src/technical-view-ux.js'),D=require('../src/discussion-data-readiness.js');
 const stock={code:'2899.HK',priceHistory:[row],marketDataFreshness:{last_trade_date:row.date,kline_status:'current',dataContentVersion:'data2',technicalVersion:'tech2'},
 technicalData:{price:11,technicalAsOf:row.date,latestCompleteBar:row.date,technicalDataStatus:'fresh',dataContentVersion:'data2',technicalVersion:'tech2'},
 technicalIndicators:{last_trade_date:row.date,dataContentVersion:'data2',technicalVersion:'tech2'}};
 const opts={reviewDate:'2026-10-04'};
 for(const facts of [U.canonicalTechnicalDate({...stock,referenceDate:opts.reviewDate}),D.technical(stock,opts),W.buildContext(stock,opts).context.currentFacts.technical]){
   assert.equal(facts.dataContentVersion,'data2');assert.equal(facts.technicalVersion,'tech2');
 }
 stock.marketRevisionReview={status:'review_required'};
 assert.equal(U.canonicalTechnicalDate({...stock,referenceDate:opts.reviewDate}).fresh,false);
 assert.equal(D.technical(stock,opts).ready,false);
 assert.equal(W.buildContext(stock,opts).context.dataReadiness.technical.ready,false);
});
test('applied same-provider revision warns future Discussion without changing saved original',()=>{
 const stock={code:'2899.HK',priceHistory:[row],marketDataFreshness:{sourceMigration:{previousVersion:'old',currentVersion:'new',reason:'same_source_history_revision',aiJudgmentStatus:'needs_review'}},discussionState:{current:{summary:'preserve'}}};
 const before=JSON.stringify(stock);assert.match(W.barsAfter(stock,row,{symbol:stock.code}).warnings[0],/历史复权行情已修订/);
 assert.equal(JSON.stringify(stock),before);
});
