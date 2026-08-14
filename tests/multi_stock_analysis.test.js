'use strict';

const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const test=require('node:test');
const Multi=require('../src/multi-stock-analysis.js');

const stocks=[
  {id:'a',code:'601138.SS',name:'工业富联',type:'holding',currentPrice:55,priceUpdatedAt:'2026-08-14',dataFreshness:{priceUpdatedAt:'2026-08-14',technicalUpdatedAt:'2026-08-14'},technicalData:{ma20:52,ma60:48,trendStatus:'uptrend'},technicalReview:{finalTechnicalConclusion:'旧结论 A'},priceHistory:[{date:'2026-08-13',close:54},{date:'2026-08-14',close:55}]},
  {id:'b',code:'2899.HK',name:'紫金矿业',type:'holding',lastUnitPrice:30,dataFreshness:{priceUpdatedAt:'2026-08-14'},technicalData:{ma20:28},technicalReview:{finalTechnicalConclusion:'旧结论 B'}},
  {id:'cash',name:'现金',type:'cash',currentValue:1000},
  {id:'missing',name:'无代码',type:'watching'}
];

test('selectable stocks exclude cash and missing symbols',()=>{
  assert.deepEqual(Multi.selectableStocks(stocks).map(stock=>stock.id),['a','b']);
});

test('M05B selection memory prefers last exact symbols and never normalizes case',()=>{
  const preferences={
    lastSymbols:['2899.HK','601138.ss','UNKNOWN.SS','2899.HK'],
    defaultGroupId:'core',
    groups:[{id:'core',name:'核心关注',symbols:['601138.SS']}]
  };
  const normalized=Multi.normalizePreferences(preferences,stocks);
  assert.deepEqual(normalized.lastSymbols,['2899.HK']);
  assert.deepEqual(Multi.initialSelection(preferences,stocks),['2899.HK']);
});

test('M05B default group is used only when there is no last selection',()=>{
  const preferences={defaultGroupId:'core',groups:[{id:'core',name:'核心关注',symbols:['601138.SS','2899.HK']}]};
  assert.deepEqual(Multi.initialSelection(preferences,stocks),['601138.SS','2899.HK']);
  assert.deepEqual(Multi.initialSelection({},stocks),[]);
});

test('M05B fixed groups save and delete exact available symbols',()=>{
  const saved=Multi.saveGroup({}, {id:'watch',name:'观察组合',symbols:['601138.SS','601138.ss','2899.HK']},stocks);
  assert.deepEqual(saved.groups,[{id:'watch',name:'观察组合',symbols:['601138.SS','2899.HK']}]);
  const selected={...saved,defaultGroupId:'watch'};
  assert.deepEqual(Multi.deleteGroup(selected,'watch',stocks),{lastSymbols:[],defaultGroupId:'',groups:[]});
});

test('builds one unified request with exact symbols and existing batch schema',()=>{
  const request=Multi.buildRequest(stocks);
  assert.match(request,/601138\.SS/);
  assert.match(request,/2899\.HK/);
  assert.match(request,/"technicalReviews"/);
  assert.match(request,/"review"/);
  assert.match(request,/AI only judgments|只返回判断/);
  assert.match(request,/每个输入 symbol 必须原样、精确地输出一次/);
  assert.doesNotMatch(request,/"symbol": "无代码"/);
  assert.equal((request.match(/股票上下文：/g)||[]).length,1);
});

test('request context includes technical data, freshness, and recent price history',()=>{
  const request=Multi.buildRequest(stocks.slice(0,2));
  assert.match(request,/"ma20": 52/);
  assert.match(request,/"technicalUpdatedAt": "2026-08-14"/);
  assert.match(request,/"close": 55/);
  assert.match(request,/"previousTechnicalReview"/);
});

test('requires at least two exact-symbol stocks',()=>{
  assert.throws(()=>Multi.buildRequest(stocks.slice(0,1)),/至少选择两只/);
  assert.throws(()=>Multi.buildRequest(stocks.slice(2)),/至少选择两只/);
});

test('recent history is bounded and invalid rows are omitted',()=>{
  const history=Array.from({length:130},(_,index)=>({date:`d${index}`,close:index+1}));
  history.push({date:'bad',close:null});
  const recent=Multi.recentPriceHistory({priceHistory:history},120);
  assert.equal(recent.length,120);
  assert.equal(recent[0].close,11);
  assert.equal(recent.at(-1).close,130);
});

test('browser integration exposes one-copy and one-paste path into batch preview',()=>{
  const source=fs.readFileSync(path.resolve(__dirname,'../src/multi-stock-analysis.js'),'utf8');
  const batch=fs.readFileSync(path.resolve(__dirname,'../src/batch-technical-review.js'),'utf8');
  const html=fs.readFileSync(path.resolve(__dirname,'../index.html'),'utf8');
  assert.match(source,/复制统一请求/);
  assert.match(source,/AI 返回的 Batch JSON/);
  assert.match(source,/BatchTechnicalReviewUI\.openWithInput/);
  assert.match(source,/multiStockAnalysisQuickBtn/);
  assert.match(source,/m05aMobileStyles/);
  assert.match(source,/max-height:100dvh/);
  assert.match(source,/min-height:44px/);
  assert.match(source,/统一分析请求已准备（通常无需展开）/);
  assert.match(source,/multiStockSelectAllBtn/);
  assert.match(source,/multiStockClearAllBtn/);
  assert.match(source,/保存当前组合/);
  assert.match(source,/BATCH_WARNING_THRESHOLD=10/);
  assert.match(source,/已复制 ✓/);
  assert.match(source,/document\.execCommand\('copy'\)!==true/);
  assert.match(source,/multiStockRequestDetails/);
  assert.match(source,/openWithInput\(raw,selectedStocks\(\)\.map\(symbolOf\)\)/);
  assert.match(batch,/openWithInput/);
  assert.match(batch,/Batch JSON 输入（预览后自动收起）/);
  assert.match(batch,/inputDetails\.open=false/);
  assert.match(html,/src\/multi-stock-analysis\.js/);
});

test('selected refresh continues after partial failures and reports exact symbols',async()=>{
  const calls=[];
  const progress=[];
  const summary=await Multi.refreshSelectedStocks(stocks,async stock=>{
    calls.push(stock.id);
    if(stock.id==='b')throw new Error('source unavailable');
    return {ok:true,price:56,source:'fixture'};
  },{onProgress:item=>progress.push(item.result.symbol)});
  assert.deepEqual(calls,['a','b']);
  assert.deepEqual(progress,['601138.SS','2899.HK']);
  assert.equal(summary.successCount,1);
  assert.equal(summary.failureCount,1);
  assert.match(summary.results[1].errors[0],/source unavailable/);
});

test('failed refresh orchestration leaves existing market data untouched',async()=>{
  const target={id:'x',code:'000001.SZ',name:'测试股',currentPrice:12,priceHistory:[{date:'2026-08-13',close:12}]};
  const before=structuredClone(target);
  const summary=await Multi.refreshSelectedStocks([target],async()=>({ok:false,errors:['offline']}));
  assert.equal(summary.failureCount,1);
  assert.deepEqual(target,before);
});

test('selected refresh requires the existing refresh callback',async()=>{
  await assert.rejects(()=>Multi.refreshSelectedStocks(stocks),/缺少行情刷新函数/);
});
