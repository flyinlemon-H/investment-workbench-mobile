'use strict';

const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const test=require('node:test');
const vm=require('node:vm');
const Multi=require('../src/multi-stock-analysis.js');
const Batch=require('../src/batch-technical-review.js');

function loadSingleStockRuntime(){
  const context={console,window:{},globalThis:null,setTimeout:()=>0,clearTimeout:()=>{}};
  context.globalThis=context;
  vm.createContext(context);
  const root=path.resolve(__dirname,'..');
  vm.runInContext(fs.readFileSync(path.join(root,'src/state.js'),'utf8'),context,{filename:'state.js'});
  vm.runInContext(fs.readFileSync(path.join(root,'src/ui-render.js'),'utf8'),context,{filename:'ui-render.js'});
  vm.runInContext('globalThis.singleStockRuntime={validator:validateSingleStockTechnicalReview,apply:applyTechnicalReviewToStock};',context);
  return context.singleStockRuntime;
}

const runtime=loadSingleStockRuntime();
const stockSpecs=[
  ['601138.SS','工业富联'],
  ['2899.HK','紫金矿业'],
  ['601869.SS','长飞光纤'],
  ['002824.SZ','和胜股份'],
  ['603296.SS','华勤技术']
];

function makeState(){
  return {stocks:stockSpecs.map(([code,name],index)=>({
    id:`s${index+1}`,code,name,type:'holding',currentPrice:10+index,
    priceUpdatedAt:'2026-08-13',priceHistory:[{date:'2026-08-13',close:10+index}],
    technicalData:{ma20:9+index},technicalReview:{finalTechnicalConclusion:`旧结论 ${index+1}`},
    notes:`保留字段 ${index+1}`
  })),portfolioStrategy:{name:'保持不变'}};
}

function validReview(index,run='A'){
  return {
    inputCoverage:{hasRecentKline:true,hasCycleKline:false},
    shortTermTechnical:{trendStatus:'sideways',technicalSummary:`摘要 ${run}-${index}`,supportLevels:[index],resistanceLevels:[index+1]},
    finalTechnicalConclusion:`结论 ${run}-${index}`
  };
}

function aiEnvelope(stocks,run='A'){
  return JSON.stringify({technicalReviews:stocks.map((stock,index)=>({symbol:stock.code,technicalReview:validReview(index+1,run)}))});
}

async function commitPreview(preview,current,saveImpl=async candidate=>candidate){
  const holder={state:current,saveCalls:0};
  const result=await Batch.commit(preview,current,{
    applyTechnicalReview:runtime.apply,
    saveCandidate:async(candidate,options)=>{holder.saveCalls+=1;assert.equal(options.critical,true);return saveImpl(candidate)},
    adoptCandidate:candidate=>{holder.state=candidate},
    render:()=>{}
  });
  return {result,holder};
}

test('E2E-01 five stocks refresh, preview, confirm, and persist with one critical save',async()=>{
  const current=makeState();
  const refresh=await Multi.refreshSelectedStocks(current.stocks,async stock=>{
    stock.currentPrice+=1;
    stock.priceUpdatedAt='2026-08-14';
    stock.priceHistory.push({date:'2026-08-14',close:stock.currentPrice});
    return {ok:true,price:stock.currentPrice,source:'fixture'};
  });
  assert.equal(refresh.successCount,5);
  const request=Multi.buildRequest(current.stocks);
  stockSpecs.forEach(([symbol])=>assert.match(request,new RegExp(symbol.replace('.','\\.'))));
  const preview=Batch.process(aiEnvelope(current.stocks),current.stocks,runtime.validator);
  assert.deepEqual(preview.summary,{total:5,valid:5,invalid:0,unknown:0,duplicate:0});
  const committed=await commitPreview(preview,current);
  assert.equal(committed.result.status,'completed');
  assert.equal(committed.holder.saveCalls,1);
  assert.equal(committed.holder.state.stocks[4].technicalReview.finalTechnicalConclusion,'结论 A-5');
  assert.equal(committed.holder.state.stocks[4].notes,'保留字段 5');
});

test('E2E-02 partial market failure continues and preserves unavailable stock data',async()=>{
  const current=makeState();
  const unavailable=current.stocks[2];
  const before=structuredClone(unavailable);
  const summary=await Multi.refreshSelectedStocks(current.stocks,async stock=>{
    if(stock===unavailable)return {ok:false,errors:['行情 unavailable']};
    stock.currentPrice+=1;
    return {ok:true,price:stock.currentPrice};
  });
  assert.equal(summary.successCount,4);
  assert.equal(summary.failureCount,1);
  assert.deepEqual(unavailable,before);
  assert.match(summary.results[2].errors[0],/unavailable/);
  assert.match(Multi.buildRequest(current.stocks),/601869\.SS/);
});

test('E2E-03 invalid and unmatched AI items are previewed but never saved',async()=>{
  const current=makeState();
  const items=JSON.parse(aiEnvelope(current.stocks.slice(0,2))).technicalReviews;
  items.push({symbol:'UNKNOWN.SS',technicalReview:validReview(8)});
  items.push({symbol:current.stocks[2].code,technicalReview:null});
  const preview=Batch.process(JSON.stringify({technicalReviews:items}),current.stocks,runtime.validator);
  assert.equal(preview.summary.valid,2);
  assert.equal(preview.summary.unknown,1);
  assert.equal(preview.summary.invalid,1);
  const committed=await commitPreview(preview,current);
  assert.equal(committed.result.status,'no_eligible');
  assert.equal(committed.result.summary.updated,0);
  assert.equal(committed.holder.saveCalls,0);
  assert.equal(committed.holder.state.stocks[0].technicalReview.finalTechnicalConclusion,'旧结论 1');
  assert.equal(committed.holder.state.stocks[2].technicalReview.finalTechnicalConclusion,'旧结论 3');
});

test('E2E-04 critical save failure preserves original state and reports failure',async()=>{
  const current=makeState();
  const before=structuredClone(current);
  const preview=Batch.process(aiEnvelope(current.stocks),current.stocks,runtime.validator);
  const committed=await commitPreview(preview,current,async()=>{throw new Error('disk unavailable')});
  assert.equal(committed.result.status,'failed');
  assert.equal(committed.result.stage,'save');
  assert.deepEqual(committed.holder.state,before);
});

test('E2E-05 workflow rerun replaces intended reviews and preserves unrelated fields',async()=>{
  const initial=makeState();
  const firstPreview=Batch.process(aiEnvelope(initial.stocks,'A'),initial.stocks,runtime.validator);
  const first=await commitPreview(firstPreview,initial);
  const secondPreview=Batch.process(aiEnvelope(first.holder.state.stocks,'B'),first.holder.state.stocks,runtime.validator);
  const second=await commitPreview(secondPreview,first.holder.state);
  assert.equal(second.result.status,'completed');
  assert.equal(second.holder.saveCalls,1);
  assert.equal(second.holder.state.stocks[0].technicalReview.finalTechnicalConclusion,'结论 B-1');
  assert.equal(second.holder.state.stocks[0].notes,'保留字段 1');
  assert.equal(second.holder.state.portfolioStrategy.name,'保持不变');
});
