'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
const assetRoot=process.env.GUARD_ASSET_ROOT||path.resolve(__dirname,'..');
const read=p=>fs.readFileSync(path.join(assetRoot,p),'utf8');
function fixture(){
 const rows=['2026-09-29','2026-09-30'].map(date=>({date,open:10,high:12,low:9,close:11,volume:100,amount:null,provider:'yahoo',adjustment:'qfq',price_basis:'adjusted',is_complete_bar:true}));
 const v='a'.repeat(64),t='b'.repeat(64),last=rows.at(-1).date;
 return {code:'1810.HK',symbol:'1810.HK',id:'synthetic-only',shares:7,plans:[{id:'keep'}],discussionState:{current:{summary:'preserve'}},priceHistory:rows,
 marketDataFreshness:{last_trade_date:last,latestCompleteBar:last,fetched_at:'2026-10-01T08:00:00Z',revisionStatus:'revision_stable',dataContentVersion:v,technicalVersion:t,historyWriteGuard:{version:'provider-revision-engine-v1',classification:'STABLE',contentHash:v},sourceContract:{symbol:'1810.HK',market:'HK',interval:'daily',canonicalProvider:'yahoo',providerVersion:'fixture-v1',normalizationVersion:'python-round-6-v1',adjustment:'qfq',priceBasis:'adjusted',historyWindow:{start:rows[0].date,end:last},units:{}}},
 technicalIndicators:{dataContentVersion:v,technicalVersion:t,last_trade_date:last},technicalData:{dataContentVersion:v,technicalVersion:t,technicalAsOf:last,latestCompleteBar:last,technicalDataStatus:'fresh'}};
}
function csv(s){const fields=['date','open','high','low','close','volume','amount','provider','adjustment','price_basis','is_complete_bar'];const {priceHistory,...meta}=s;return '# market-data-snapshot: '+JSON.stringify(meta)+'\n'+fields.join(',')+'\n'+priceHistory.map(r=>fields.map(k=>r[k]??'').join(',')).join('\n')}
function harness(stock){
 let writes=0;const context={console,structuredClone,setTimeout:()=>{},setInterval:()=>{},document:{hidden:true,addEventListener(){},querySelectorAll:()=>[],getElementById:()=>null},alert(){}};context.window=context;vm.createContext(context);
 for(const file of ['src/technical-freshness.js','src/symbol-identity.js','src/state.js','src/import-export.js','src/ui-render.js','src/market-data-bridge.js','src/market-data-orchestrator.js'])vm.runInContext(read(file),context,{filename:file});
 context.seed={stocks:[structuredClone(stock)],updatedAt:'protected'};vm.runInContext('state=seed',context);
 context.StorageManager={saveState:async()=>{writes++;return true}};context.saveState=async()=>{writes++;return true};
 context.SupabaseBrowserClient={getUser:async()=>({id:'isolated-owner'}),getSession:async()=>({user:{id:'isolated-owner'}}),onAuthStateChange(){},getClient:()=>({rpc:async()=>({data:context.task,error:null})})};
 vm.runInContext(read('src/market-data-task-ui.js'),context);
 return {context,writes:()=>writes,state:()=>vm.runInContext('JSON.stringify(state)',context),async run(route,incoming){
  if(route==='JSON'){await context.persistCandidateSnapshot({stocks:[incoming],updatedAt:'candidate'});return}
  if(route==='CSV')return context.applyPriceHistoryCsvText(context.seed.stocks[0],csv(incoming));
  if(route==='Bridge'){context.MARKET_DATA_BRIDGE={stocks:[incoming]};return context.applyMarketDataBridge()}
  const id='11111111-1111-4111-8111-111111111111',last=incoming.priceHistory.at(-1).date;
  context.task={taskId:id,requestedBy:'isolated-owner',symbol:'1810.HK',status:'succeeded',resultVersion:id,result:{schemaVersion:1,taskId:id,resultVersion:id,symbol:'1810.HK',provider:incoming.marketDataFreshness.sourceContract?.canonicalProvider||'yahoo',latestCompleteBar:last,technicalAsOf:last,stock:incoming}};
  return context.MarketDataTaskUi.client.sync('1810.HK');
 }};
}
const cases={
 stable:(old,next)=>{next.marketDataFreshness.fetched_at='2026-10-02T08:00:00Z'},
 provider:(old,next)=>{next.priceHistory.forEach(r=>r.provider='eastmoney');next.marketDataFreshness.sourceContract.canonicalProvider='eastmoney'},
 revision:(old,next)=>{next.priceHistory[0].close+=.000004},
 mixed:(old,next)=>{old.priceHistory[0].provider='eastmoney'},
 missing:(old,next)=>{delete next.marketDataFreshness.sourceContract},
 conflict:(old,next)=>{next.technicalIndicators.technicalVersion='c'.repeat(64)},
 status:(old,next)=>{next.marketDataFreshness.revisionStatus='review_required'}
};
const codes={provider:'PROVIDER_SWITCH_REQUIRED',revision:'HISTORICAL_REVISION_REVIEW_REQUIRED',mixed:'MIXED_HISTORY_REBASE_REQUIRED',missing:'UNSAFE_IMPORT_BLOCKED',conflict:'VERSION_CONFLICT',status:'HISTORICAL_REVISION_REVIEW_REQUIRED'};
for(const route of ['JSON','CSV','Bridge','Remote'])for(const [scenario,mutate] of Object.entries(cases))test(`${route}: ${scenario} uses shared guard and preserves rejected facts`,async()=>{
 const old=fixture(),next=structuredClone(old);next.marketDataFreshness.fetched_at='2026-10-02T08:00:00Z';mutate(old,next);
 const h=harness(old),before=h.state();
 if(scenario==='stable'){await h.run(route,next);assert.equal(h.writes(),1)}
 else{await assert.rejects(h.run(route,next),error=>error.code===codes[scenario]);assert.equal(h.writes(),0);assert.equal(h.state(),before)}
});
test('CSV without provenance is readable legacy data but cannot write canonical bars',async()=>{const h=harness(fixture()),before=h.state();assert.equal(h.context.parsePriceHistoryCsv('date,close\n2026-09-30,11').records.length,1);await assert.rejects(h.context.applyPriceHistoryCsvText(h.context.seed.stocks[0],'date,close\n2026-09-30,11'),/UNSAFE_IMPORT_BLOCKED/);assert.equal(h.state(),before);assert.equal(h.writes(),0)});
test('unchanged bars do not bypass changed technical version validation',async()=>{const a=fixture(),b=structuredClone(a);b.technicalData.technicalVersion='c'.repeat(64);const h=harness(a);await assert.rejects(h.run('Remote',b),/VERSION_CONFLICT/);assert.equal(h.writes(),0)});
test('optional absent amount is not normalized into fake zero',()=>{const h=harness(fixture());assert.equal(h.context.normalizePriceHistory(fixture())[0].amount,undefined)});
test('all six rejection categories have specific Chinese messages',()=>{const h=harness(fixture());for(const code of new Set(Object.values(codes))){assert.match(h.context.marketHistoryGuardMessage({code}),/[\u4e00-\u9fff]/);assert.doesNotMatch(h.context.marketHistoryGuardMessage({code}),/^行情更新失败$/)}});
module.exports={fixture,harness,csv};

test('unit key order does not reject an equivalent source contract',async()=>{const a=fixture(),b=structuredClone(a);a.marketDataFreshness.sourceContract.units={yahoo:{volume:{unit:'shares',scale:1},price:{unit:'HKD/share',currency:'HKD',scale:1}}};b.marketDataFreshness.sourceContract.units={yahoo:{price:{unit:'HKD/share',currency:'HKD',scale:1},volume:{unit:'shares',scale:1}}};b.marketDataFreshness.fetched_at='2026-10-02T08:00:00Z';const h=harness(a);await h.run('JSON',b);assert.equal(h.writes(),1)});
test('CSV persistence failure restores all protected facts',async()=>{const a=fixture(),b=structuredClone(a),h=harness(a),before=h.state();b.marketDataFreshness.fetched_at='2026-10-02T08:00:00Z';h.context.saveState=async()=>{throw new Error('fixture persistence failure')};await assert.rejects(h.run('CSV',b),/fixture persistence failure/);assert.equal(h.state(),before)});
