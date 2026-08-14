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

test('M05B selection memory resolves case-only variants to available stock symbols',()=>{
  const preferences={
    lastSymbols:['2899.HK','601138.ss','UNKNOWN.SS','2899.HK'],
    defaultGroupId:'core',
    groups:[{id:'core',name:'核心关注',symbols:['601138.SS']}]
  };
  const normalized=Multi.normalizePreferences(preferences,stocks);
  assert.deepEqual(normalized.lastSymbols,['2899.HK','601138.SS']);
  assert.deepEqual(Multi.initialSelection(preferences,stocks),['2899.HK','601138.SS']);
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
  assert.match(request,/字母大小写差异可接受/);
  assert.doesNotMatch(request,/"symbol": "无代码"/);
  assert.equal((request.match(/股票上下文：/g)||[]).length,1);
});

test('request context includes technical data, freshness, and recent price history',()=>{
  const request=Multi.buildRequest(stocks.slice(0,2));
  assert.match(request,/"ma20": 52/);
  assert.match(request,/"technicalFacts"/);
  assert.match(request,/"realtimeFreshness"/);
  assert.match(request,/"close": 55/);
  assert.match(request,/"previousJudgment"/);
  assert.doesNotMatch(request,/"previousTechnicalReview"/);
});

test('requires at least two stocks with symbols',()=>{
  assert.throws(()=>Multi.buildRequest(stocks.slice(0,1)),/至少选择两只/);
  assert.throws(()=>Multi.buildRequest(stocks.slice(2)),/至少选择两只/);
});

test('recent history is bounded and invalid rows are omitted',()=>{
  const history=Array.from({length:130},(_,index)=>({date:`d${index}`,close:index+1}));
  history.push({date:'bad',close:null});
  const recent=Multi.recentPriceHistory({priceHistory:history});
  assert.equal(recent.length,30);
  assert.equal(recent[0].close,101);
  assert.equal(recent.at(-1).close,130);
});

function richStock(index,status='fresh'){
  const history=Array.from({length:120},(_,row)=>({date:`2026-${String(Math.floor(row/28)+1).padStart(2,'0')}-${String(row%28+1).padStart(2,'0')}`,close:20+row+index}));
  return {
    id:`rich-${index}`,code:`RICH${index}.SS`,name:`丰富标的 ${index}`,type:'holding',role:'核心仓',theme:'测试',currentPrice:150+index,priceUpdatedAt:'2026-08-14',priceHistory:history,
    dataFreshness:{priceUpdatedAt:'2026-08-14',technicalUpdatedAt:'2026-08-13',newsUpdatedAt:'2026-08-01',financialUpdatedAt:'2026-06-30'},
    technicalData:{price:139+index,latestCompleteBar:'2026-08-13',technicalAsOf:'2026-08-13',technicalDataStatus:status,technicalWarning:status==='fresh'?'':'stale fixture',ma5:137,ma10:134,ma20:129,ma60:109,macd:{dif:2,dea:1.5,histogram:1},supportLevels:[120,125],resistanceLevels:[145],pricePosition:{lookbackDays:120,high:145,low:20,currentPercentile:90},technicalSummary:'重复的旧摘要不应进入 facts'},
    technicalReview:{updatedAt:'2026-08-01',inputCoverage:{warning:'旧覆盖详情'},shortTermTechnical:{trendStatus:'sideways',technicalSummary:'旧判断摘要',riskFlags:['near_previous_high'],actionHint:'等待',confidence:'medium',ma5:1,ma10:2,ma20:3,ma60:4},cycleTechnical:{cycleSummary:'很长的旧周期对象'},finalTechnicalConclusion:'旧结论',holdHint:'持有提示',addHint:'加仓提示',reduceHint:'减仓提示'}
  };
}

test('P3 fresh context uses 30 complete closes and stale context adapts to 45',()=>{
  const fresh=Multi.stockContext(richStock(1,'fresh'));
  const stale=Multi.stockContext(richStock(2,'stale'));
  assert.equal(fresh.recentCompleteDailyCloses.length,30);
  assert.equal(stale.recentCompleteDailyCloses.length,45);
  assert.equal(fresh.technicalFacts.ma20,129);
  assert.equal(fresh.previousJudgment.finalTechnicalConclusion,'旧结论');
  assert.equal(fresh.previousJudgment.updatedAt,undefined);
  assert.equal(fresh.technicalFacts.technicalSummary,undefined);
});

test('P3 ten-stock request is materially smaller than the M05A context shape',()=>{
  const sample=Array.from({length:10},(_,index)=>richStock(index+1));
  const request=Multi.buildRequest(sample);
  const legacyContexts=sample.map(stock=>({
    symbol:stock.code,name:stock.name,type:stock.type,role:stock.role,theme:stock.theme,currentPrice:stock.currentPrice,priceUpdatedAt:stock.priceUpdatedAt,syncStatus:'unknown',lastSyncError:'',
    dataFreshness:stock.dataFreshness,technicalData:stock.technicalData,previousTechnicalReview:stock.technicalReview,recentPriceHistory:stock.priceHistory
  }));
  const legacy=JSON.stringify(legacyContexts,null,2);
  assert(request.length<legacy.length*.65,`expected ${request.length} to be below 65% of legacy ${legacy.length}`);
  assert.match(request,/不要返回或重算 currentPrice/);
});

test('P3 generates a visible-size request for twenty stocks without a tokenizer dependency',()=>{
  const request=Multi.buildRequest(Array.from({length:20},(_,index)=>richStock(index+1)));
  const metrics=Multi.requestMetrics(request);
  assert(metrics.characters>0);
  assert(metrics.bytes>=metrics.characters);
  assert(metrics.kilobytes>0);
  assert.equal((request.match(/"symbol":/g)||[]).length,21);
  const source=fs.readFileSync(path.resolve(__dirname,'../src/multi-stock-analysis.js'),'utf8');
  assert.match(source,/请求长度约/);
  assert.doesNotMatch(source,/tokenizer|tiktoken/i);
});

test('browser integration exposes one-copy and one-paste path into batch preview',()=>{
  const source=fs.readFileSync(path.resolve(__dirname,'../src/multi-stock-analysis.js'),'utf8');
  const batch=fs.readFileSync(path.resolve(__dirname,'../src/batch-technical-review.js'),'utf8');
  const html=fs.readFileSync(path.resolve(__dirname,'../index.html'),'utf8');
  assert.match(source,/刷新并生成/);
  assert.match(source,/复制给 AI/);
  assert.match(source,/粘贴 AI 结果/);
  assert.match(source,/预览结果/);
  assert.match(source,/BatchTechnicalReviewUI\.openWithInput/);
  assert.match(source,/multiStockAnalysisQuickBtn/);
  assert.match(source,/m05aMobileStyles/);
  assert.match(source,/max-height:100dvh/);
  assert.match(source,/min-height:44px/);
  assert.match(source,/AI 分析请求已准备/);
  assert.doesNotMatch(source,/复制统一请求|查看统一结果/);
  assert.match(source,/multiStockSelectAllBtn/);
  assert.match(source,/multiStockClearAllBtn/);
  assert.match(source,/保存当前组合/);
  assert.match(source,/BATCH_WARNING_THRESHOLD=10/);
  assert.match(source,/已复制 ✓/);
  assert.match(source,/document\.execCommand\('copy'\)!==true/);
  assert.match(source,/multiStockRequestDetails/);
  assert.match(source,/openWithInput\(raw,selectedStocks\(\)\.map\(symbolOf\)\)/);
  assert.match(batch,/openWithInput/);
  assert.match(batch,/JSON 输入（预览后自动收起）/);
  assert.match(batch,/批量保存/);
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
