'use strict';

const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const test=require('node:test');
const vm=require('node:vm');
const Multi=require('../src/multi-stock-analysis.js');
const Batch=require('../src/batch-technical-review.js');

const root=path.resolve(__dirname,'..');
const read=file=>fs.readFileSync(path.join(root,file),'utf8');

function loadRuntime(){
  const context={console,window:{},globalThis:null,setTimeout:()=>0,clearTimeout:()=>{}};
  context.globalThis=context;
  vm.createContext(context);
  vm.runInContext(read('src/state.js'),context,{filename:'state.js'});
  vm.runInContext(read('src/ui-render.js'),context,{filename:'ui-render.js'});
  vm.runInContext('this.runtime={validator:validateSingleStockTechnicalReview,apply:applyTechnicalReviewToStock,updateFacts:updateTechnicalDataFromPriceHistory,normalizeVolume:normalizeVolumeComparison};',context);
  return context.runtime;
}

const runtime=loadRuntime();

function stocks(count=20,status='fresh'){
  return Array.from({length:count},(_,index)=>({
    id:`s${index+1}`,code:`M${String(index+1).padStart(2,'0')}.SS`,name:`标的 ${index+1}`,type:'holding',currentPrice:50+index,priceUpdatedAt:'2026-08-14',
    priceHistory:Array.from({length:60},(_,day)=>({date:new Date(Date.parse('2026-05-01T00:00:00Z')+day*86400000).toISOString().slice(0,10),close:20+day+index,is_complete_bar:true,provider:'yahoo',volume:1_000_000})),
    technicalData:{price:79+index,latestCompleteBar:'2026-08-13',technicalAsOf:status==='stale'?'2026-07-08':'2026-08-13',technicalDataStatus:status,technicalWarning:status==='fresh'?'':'完整日线技术数据已过期',ma5:77,ma10:74,ma20:69,ma60:49,macd:{dif:2,dea:1,histogram:2}},
    technicalReview:{shortTermTechnical:{trendStatus:'sideways',technicalSummary:'旧摘要',riskFlags:[],actionHint:'等待',confidence:'medium'},finalTechnicalConclusion:'旧结论'},notes:'保留'
  }));
}

function judgment(index,confidence='medium'){
  return {trendStatus:'sideways',technicalSummary:`摘要 ${index}`,riskFlags:[],actionHint:'等待确认',confidence,finalTechnicalConclusion:`结论 ${index}`,holdHint:'持有观察',addHint:'确认后复核',reduceHint:'跌破后复核'};
}

function envelope(selected,confidence='medium'){
  return JSON.stringify({technicalReviews:selected.map((stock,index)=>({symbol:stock.code,review:judgment(index+1,confidence)}))});
}

async function commit(preview,current,save=async candidate=>candidate){
  let live=current,saves=0;
  const result=await Batch.commit(preview,current,{applyTechnicalReview:runtime.apply,saveCandidate:async(candidate,options)=>{saves+=1;assert.equal(options.critical,true);return save(candidate)},adoptCandidate:candidate=>{live=candidate},render:()=>{}});
  return {result,live,saves};
}

test('E2E-01 saved group -> refresh five -> V2 preview -> one critical save',async()=>{
  const current={stocks:stocks(8)};
  const group=Multi.saveGroup({}, {id:'core',name:'核心关注',symbols:current.stocks.slice(0,5).map(stock=>stock.code)},current.stocks);
  const selectedSymbols=Multi.initialSelection({...group,defaultGroupId:'core'},current.stocks);
  const selected=current.stocks.filter(stock=>selectedSymbols.includes(stock.code));
  const refreshed=await Multi.refreshSelectedStocks(selected,async stock=>({ok:true,price:stock.currentPrice,source:'fixture'}));
  assert.equal(refreshed.successCount,5);
  assert(Multi.buildRequest(selected).length>0);
  const preview=Batch.process(envelope(selected),current.stocks,runtime.validator,{expectedSymbols:selectedSymbols});
  assert.equal(preview.batchStatus,'valid');
  const saved=await commit(preview,current);
  assert.equal(saved.result.status,'completed');
  assert.equal(saved.saves,1);
  assert.equal(saved.live.stocks[4].technicalReview.finalTechnicalConclusion,'结论 5');
});

test('E2E-02 no selection warns and performs no refresh',async()=>{
  assert.deepEqual(Multi.initialSelection({},stocks(3)),[]);
  assert.throws(()=>Multi.buildRequest([]),/至少选择两只/);
  let calls=0;
  const summary=await Multi.refreshSelectedStocks([],async()=>{calls+=1});
  assert.equal(summary.total,0);
  assert.equal(calls,0);
});

test('E2E-03 all nineteen remains allowed with a non-blocking batch warning threshold',()=>{
  const selected=stocks(19);
  assert(selected.length>Multi.BATCH_WARNING_THRESHOLD);
  assert(Multi.buildRequest(selected).length>0);
  assert.match(read('src/multi-stock-analysis.js'),/仍可继续/);
});

test('E2E-04 partial market refresh continues remaining exact symbols',async()=>{
  const selected=stocks(5);
  const result=await Multi.refreshSelectedStocks(selected,async stock=>stock===selected[2]?{ok:false,errors:['unavailable']}:{ok:true,price:stock.currentPrice});
  assert.equal(result.successCount,4);
  assert.equal(result.failureCount,1);
  assert.equal(result.results[3].symbol,selected[3].code);
});

test('E2E-05 realtime date and previous complete-day technical date stay separate',()=>{
  const stock=stocks(1)[0];
  const context=Multi.stockContext(stock);
  assert.equal(context.priceUpdatedAt,'2026-08-14');
  assert.equal(context.technicalAsOf,'2026-08-13');
  assert.equal(context.technicalDataStatus,'fresh');
});

test('E2E-06 stale facts are explicit and AI judgments cannot rewrite program facts',()=>{
  const selected=stocks(2,'stale');
  const request=Multi.buildRequest(selected);
  assert.match(request,/"technicalDataStatus": "stale"/);
  assert.match(request,/不要返回或重算 currentPrice/);
  const invalid=JSON.parse(envelope(selected,'low'));
  invalid.technicalReviews[0].review.ma20=999;
  const preview=Batch.process(JSON.stringify(invalid),selected,runtime.validator,{expectedSymbols:selected.map(stock=>stock.code)});
  assert.equal(preview.batchStatus,'invalid');
  assert.deepEqual(Batch.eligibleEntries(preview),[]);
});

test('E2E-07 truncated JSON produces zero writes',async()=>{
  const current={stocks:stocks(3)};
  const preview=Batch.process('{"technicalReviews":[',current.stocks,runtime.validator,{expectedSymbols:current.stocks.map(stock=>stock.code)});
  const saved=await commit(preview,current);
  assert.equal(preview.error.code,'parse_error');
  assert.equal(saved.result.status,'no_eligible');
  assert.equal(saved.saves,0);
});

test('E2E-08 one missing expected symbol produces zero writes',async()=>{
  const current={stocks:stocks(3)};
  const preview=Batch.process(envelope(current.stocks.slice(0,2)),current.stocks,runtime.validator,{expectedSymbols:current.stocks.map(stock=>stock.code)});
  const saved=await commit(preview,current);
  assert.deepEqual(preview.completeness.missingSymbols,[current.stocks[2].code]);
  assert.equal(saved.result.status,'no_eligible');
  assert.equal(saved.saves,0);
});

test('E2E-09 save failure restores the original authoritative state',async()=>{
  const current={stocks:stocks(3)},before=structuredClone(current);
  const preview=Batch.process(envelope(current.stocks),current.stocks,runtime.validator,{expectedSymbols:current.stocks.map(stock=>stock.code)});
  const saved=await commit(preview,current,async()=>{throw new Error('disk unavailable')});
  assert.equal(saved.result.status,'failed');
  assert.equal(saved.result.stage,'save');
  assert.deepEqual(saved.live,before);
});

test('E2E-10 unknown provider scale is unavailable and never creates a fake volume signal',()=>{
  const history=[...Array.from({length:5},(_,index)=>({date:`2026-07-0${index+1}`,close:50,volume:10_000_000,provider:'yahoo'})),...Array.from({length:5},(_,index)=>({date:`2026-07-${index+6}`,close:50,volume:100_000,provider:'unknown'}))];
  const volume=runtime.normalizeVolume(history,'601138.SS');
  assert.equal(volume.volumeStatus,'unavailable');
  assert.equal(volume.volumeChangePct,null);
});
