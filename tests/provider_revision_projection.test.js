'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {assertProjection}=require('../scripts/market_history_projection_guard');
function stock(){
 const date='2026-10-02',v='fixture-content',t='fixture-technical';
 return {symbol:'2899.HK',priceHistory:[{date,open:10,high:12,low:9,close:11,volume:10,provider:'yahoo',adjustment:'qfq',price_basis:'adjusted',is_complete_bar:true}],
 marketDataFreshness:{dataContentVersion:v,technicalVersion:t,historyWriteGuard:{version:'provider-revision-engine-v1',classification:'STABLE',contentHash:v},sourceContract:{symbol:'2899.HK',canonicalProvider:'yahoo',providerVersion:'fixture',normalizationVersion:'python-round-6-v1',adjustment:'qfq',priceBasis:'adjusted',historyWindow:{start:date,end:date}}},
 technicalIndicators:{dataContentVersion:v,technicalVersion:t},technicalData:{dataContentVersion:v,technicalVersion:t,technicalAsOf:date,latestCompleteBar:date}};
}
test('publisher rejects legacy input without probe even when dates look fresh',()=>{
 const row=stock();delete row.marketDataFreshness.historyWriteGuard;
 assert.throws(()=>assertProjection(row),/UNSAFE_WRITE_PATH_BLOCKED/);
});
test('publisher cannot turn a revision into an ordinary update by supplying a receipt',()=>{
 const old=stock(),next=structuredClone(old);next.priceHistory[0].close+=.000004;
 assert.throws(()=>assertProjection(next,old),/SAME_PROVIDER_REVISION/);
});
test('publisher requires one technical version and refuses stale generation',()=>{
 const row=stock();row.technicalData.technicalVersion='old';
 assert.throws(()=>assertProjection(row),/VERSION_CONFLICT/);
 const old=stock(),next=stock();old.marketDataFreshness.sourceMigration={generation:2};next.marketDataFreshness.sourceMigration={generation:1};
 assert.throws(()=>assertProjection(next,old),/VERSION_CONFLICT/);
});
test('publisher accepts an unchanged verified projection',()=>assert.doesNotThrow(()=>assertProjection(stock(),stock())));
