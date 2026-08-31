'use strict';

const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const test=require('node:test');
const Batch=require('../src/batch-technical-review.js');
const Multi=require('../src/multi-stock-analysis.js');

const root=path.resolve(__dirname,'..');
const read=file=>fs.readFileSync(path.join(root,file),'utf8');

test('INT-01/02 preserves the eight-tab detail workspace and session preference wiring',()=>{
  const source=read('src/ui-render.js');
  assert.match(source,/DETAIL_WORKSPACE_TABS=Object\.freeze\(\['ai','plan','operation','technical','news','fundamental','valuation','longterm'\]\)/);
  assert.match(source,/DETAIL_WORKSPACE_SESSION_KEY='v13_detail_workspace_tab_v1'/);
  for(const label of ['讨论','计划','操作记录','技术面','新闻催化','基本面','估值\/配置','长期逻辑']){
    assert.match(source,new RegExp(`label:'${label}'`));
  }
  assert.match(source,/loadDetailWorkspacePreference/);
  assert.match(source,/sessionStorage\.setItem\(DETAIL_WORKSPACE_SESSION_KEY/);
  assert.match(source,/ArrowRight|ArrowLeft/);
});

test('index keeps Workbench storage ordering and adds M05A modules at the narrow seam',()=>{
  const html=read('index.html');
  const symbolIdentity=html.indexOf('src/symbol-identity.js');
  const storage=html.indexOf('src/storage/storage-manager.js');
  const storageValidation=html.indexOf('src/storage/storage-validation.js');
  const multiTab=html.indexOf('src/multi-tab-protection.js');
  const state=html.indexOf('src/state.js');
  const ui=html.indexOf('src/ui-render.js');
  const batch=html.indexOf('src/batch-technical-review.js');
  const multi=html.indexOf('src/multi-stock-analysis.js');
  const price=html.indexOf('src/price-refresh.js');
  const app=html.indexOf('src/app.js');
  assert(symbolIdentity>=0&&symbolIdentity<storageValidation&&storageValidation<storage&&storage<multiTab&&multiTab<state);
  assert(ui>=0&&ui<batch&&batch<multi&&multi<price&&price<app);
  assert.match(html,/id="batchTechnicalReviewBtn"/);
  assert.doesNotMatch(html,/m05a-mobile-analysis-20260814/);
});

test('390x844 workflow keeps touch targets, readable inputs, and scrollable full-screen modals',()=>{
  const source=read('src/multi-stock-analysis.js');
  const fixture=read('tests/fixtures/mobile-390.html');
  const html=read('index.html');
  assert.match(fixture,/#mobileFrame\{[^}]*width:390px;height:844px/);
  assert.match(source,/#multiStockAnalysisModal button,#batchTechnicalReviewModal button\{min-height:44px\}/);
  assert.match(source,/#multiStockAnalysisModal textarea,#batchTechnicalReviewModal textarea\{font-size:16px!important\}/);
  assert.match(source,/height:100dvh/);
  assert.match(source,/overflow-y:auto/);
  assert.match(html,/@media\(max-width:768px\)\{\.workspace-tablist\{display:grid;grid-template-columns:repeat\(4,minmax\(0,1fr\)\);[^}]*overflow:visible/);
  assert.match(html,/\.workspace-tab\{min-width:0;width:100%;min-height:44px/);
});

test('Workbench saveState architecture remains intact and shared technical helpers are wired',()=>{
  const state=read('src/state.js');
  const ui=read('src/ui-render.js');
  assert.match(state,/const persist=value=>StorageManager\.saveState\(value,options\)/);
  assert.match(state,/MultiTabProtection\.runProtectedSave/);
  assert.match(state,/function applyTechnicalReviewToStock/);
  assert.match(ui,/function validateSingleStockTechnicalReview/);
  assert.match(ui,/applyTechnicalReviewToStock\(stock,validation\.normalized\)/);
});

function stock(index){
  return {
    id:`s${index}`,
    code:`TEST${index}.SS`,
    name:`测试 ${index}`,
    type:'holding',
    currentPrice:10+index,
    priceHistory:[{date:'2026-08-13',close:10+index}],
    technicalData:{},
    technicalReview:{}
  };
}
const validReview=index=>({
  inputCoverage:{hasRecentKline:true,hasCycleKline:false},
  shortTermTechnical:{trendStatus:'sideways',technicalSummary:`摘要 ${index}`,supportLevels:[],resistanceLevels:[]},
  finalTechnicalConclusion:`结论 ${index}`
});
const validator=review=>review&&typeof review==='object'
  ?{valid:true,normalized:review}
  :{valid:false,error:'invalid review'};

test('INT-03 generates one request for five selected stocks',()=>{
  const stocks=Array.from({length:5},(_,index)=>stock(index+1));
  const request=Multi.buildRequest(stocks);
  stocks.forEach(item=>assert.match(request,new RegExp(item.code.replace('.','\\.'))));
  assert.equal((request.match(/"symbol":/g)||[]).length,6);
});

test('INT-04 previews mixed failures but keeps the strict batch at zero eligible',()=>{
  const stocks=Array.from({length:4},(_,index)=>stock(index+1));
  const payload={technicalReviews:[
    ...stocks.slice(0,3).map((item,index)=>({symbol:item.code,technicalReview:validReview(index+1)})),
    {symbol:stocks[3].code,technicalReview:null},
    {symbol:'UNKNOWN.SS',technicalReview:validReview(9)}
  ]};
  const preview=Batch.process(JSON.stringify(payload),stocks,validator);
  assert.deepEqual(preview.summary,{total:5,valid:3,invalid:1,unknown:1,duplicate:0});
  assert.equal(preview.batchStatus,'invalid');
  assert.equal(Batch.eligibleEntries(preview).length,0);
});

test('INT-07 partial refresh keeps failed stock data and continues',async()=>{
  const stocks=Array.from({length:5},(_,index)=>stock(index+1));
  const before=structuredClone(stocks[2]);
  const result=await Multi.refreshSelectedStocks(stocks,async item=>{
    if(item===stocks[2])return {ok:false,errors:['unavailable']};
    item.currentPrice+=1;
    return {ok:true,price:item.currentPrice,source:'fixture'};
  });
  assert.equal(result.successCount,4);
  assert.equal(result.failureCount,1);
  assert.deepEqual(stocks[2],before);
});

test('INT-08 rerun replaces intended review without duplicating stocks',async()=>{
  const current={stocks:Array.from({length:3},(_,index)=>stock(index+1)),marker:'stable'};
  const apply=(target,review)=>{target.technicalReview=structuredClone(review)};
  async function run(runId,state){
    const payload={technicalReviews:state.stocks.map((item,index)=>({
      symbol:item.code,
      technicalReview:validReview(`${runId}-${index}`)
    }))};
    const preview=Batch.process(JSON.stringify(payload),state.stocks,validator);
    let adopted=state;
    const result=await Batch.commit(preview,state,{
      applyTechnicalReview:apply,
      saveCandidate:async candidate=>candidate,
      adoptCandidate:candidate=>{adopted=candidate},
      render:()=>{}
    });
    return {result,state:adopted};
  }
  const first=await run('A',current);
  const second=await run('B',first.state);
  assert.equal(first.result.status,'completed');
  assert.equal(second.result.status,'completed');
  assert.equal(second.state.stocks.length,3);
  assert.equal(new Set(second.state.stocks.map(item=>item.id)).size,3);
  assert.match(second.state.stocks[0].technicalReview.finalTechnicalConclusion,/B-/);
});
