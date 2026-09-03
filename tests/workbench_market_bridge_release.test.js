'use strict';

const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const test=require('node:test');
const vm=require('node:vm');

const root=path.resolve(__dirname,'..');
const read=file=>fs.readFileSync(path.join(root,file),'utf8');

function loadPublishedBridge(){
  const context={window:{}};
  vm.createContext(context);
  vm.runInContext(read('data/market_data_bridge.js'),context);
  return context.window.MARKET_DATA_BRIDGE;
}

function loadTechnicalRuntime(){
  const context={console,window:{},globalThis:null};
  context.globalThis=context;
  vm.createContext(context);
  vm.runInContext(read('src/state.js'),context,{filename:'state.js'});
  vm.runInContext('this.runtime={updateTechnicalDataFromPriceHistory};',context);
  return context.runtime;
}

test('release publishes an internally consistent 19-stock market bridge with technical indicators',()=>{
  const bridge=loadPublishedBridge();
  assert.match(bridge.generatedAt,/^\d{4}-\d{2}-\d{2}T/);
  assert.equal(bridge.stocks.length,19);
  const stock=bridge.stocks.find(item=>item.symbol==='2899.HK');
  assert(stock);
  const lastDate=stock.priceHistory.at(-1).date;
  assert.equal(bridge.stocks.every(item=>item.priceHistory.every(bar=>bar.is_complete_bar===true)),true);
  assert.equal(stock.marketDataFreshness.last_trade_date,lastDate);
  assert.equal(stock.technicalIndicators.last_trade_date,lastDate);
  for(const key of ['ma5','ma10','ma20','ma60'])assert.equal(typeof stock.technicalIndicators[key],'number');
  for(const key of ['dif','dea','histogram'])assert.equal(typeof stock.technicalIndicators.macd[key],'number');
});

test('Workbench consumes bridge data through one critical save',async()=>{
  const bridge=loadPublishedBridge();
  const incoming=bridge.stocks.find(item=>item.symbol==='2899.HK');
  const stock={
    code:'2899.HK',
    priceHistory:[],
    marketDataFreshness:{},
    technicalIndicators:{}
  };
  const saves=[];
  let technicalRefreshes=0;
  const context={
    window:{MARKET_DATA_BRIDGE:{...bridge,stocks:[incoming]},SymbolIdentity:require('../src/symbol-identity.js')},
    state:{stocks:[stock],updatedAt:'before'},
    structuredClone,
    normalizePriceHistory:rows=>structuredClone(rows),
    updateTechnicalDataFromPriceHistory:target=>{technicalRefreshes+=1;target.technicalData={technicalAsOf:target.priceHistory.at(-1).date,technicalDataStatus:'fresh'}},
    saveState:async(value,options)=>saves.push({value,options})
  };
  vm.createContext(context);
  vm.runInContext(`${read('src/market-data-bridge.js')}\nthis.applyMarketDataBridge=applyMarketDataBridge;`,context);
  const changed=await context.applyMarketDataBridge();
  assert.equal(changed,1);
  assert.equal(saves.length,1);
  assert.equal(technicalRefreshes,1);
  assert.equal(saves[0].options.critical,true);
  assert.equal(stock.priceHistory.at(-1).date,incoming.priceHistory.at(-1).date);
  assert.equal(stock.marketDataFreshness.fetched_at,incoming.marketDataFreshness.fetched_at);
  assert.deepEqual(stock.technicalIndicators,incoming.technicalIndicators);
  assert.equal(stock.technicalData.technicalAsOf,incoming.priceHistory.at(-1).date);
});

test('601138.SS runtime derives program-owned dates and same-snapshot levels from the final complete bar',()=>{
  const bridge=loadPublishedBridge();
  const incoming=bridge.stocks.find(item=>item.symbol==='601138.SS');
  assert(incoming);
  const lastDate=incoming.priceHistory.at(-1).date;
  const stock={
    code:incoming.symbol,
    priceHistory:structuredClone(incoming.priceHistory),
    marketDataFreshness:structuredClone(incoming.marketDataFreshness),
    technicalIndicators:structuredClone(incoming.technicalIndicators),
    technicalData:{technicalAsOf:'2026-08-14',latestCompleteBar:'2026-08-14',technicalDataStatus:'stale'},
    technicalReview:{updatedAt:'2099-01-01'}
  };
  const result=loadTechnicalRuntime().updateTechnicalDataFromPriceHistory(stock,{referenceDate:lastDate});
  assert.equal(result.technicalAsOf,lastDate);
  assert.equal(stock.priceHistory.at(-1).is_complete_bar,true);
  assert.equal(stock.marketDataFreshness.last_trade_date,lastDate);
  assert.equal(stock.technicalIndicators.last_trade_date,lastDate);
  assert.equal(stock.technicalData.latestCompleteBar,lastDate);
  assert.equal(stock.technicalData.technicalAsOf,lastDate);
  assert.notEqual(stock.technicalData.technicalAsOf,stock.technicalReview.updatedAt);
  assert.equal(stock.technicalData.ma5,incoming.technicalIndicators.ma5);
  assert.equal(stock.technicalData.macd.dif,incoming.technicalIndicators.macd.dif);
  assert(stock.technicalData.supportPrice>0);
  assert(stock.technicalData.resistancePrice>=stock.technicalData.supportPrice);
});

test('Plan compatibility release cache-busts the transport and Workbench modules',()=>{
  const html=read('index.html');
  const version='plan-mode-compatibility-phase1a-20260903';
  assert.match(html,new RegExp(`<meta name="app-asset-version" content="${version}">`));
  for(const asset of [
    'data/backend_config.js',
    'src/api/api-errors.js',
    'src/api/api-client.js',
    'src/api/health-api.js',
    'src/api/ai-api.js',
    'src/long-term-logic-contract.js',
    'src/long-term-logic-workflow.js',
    'src/symbol-identity.js',
    'src/universe-handoff.js',
    'src/technical-view-ux.js',
    'src/plan-v2.js',
    'src/plan-review.js',
    'src/plan-review-ui.js',
    'src/v13-core-model.js',
    'src/v13-plan-engine.js',
    'src/v13-recommendation-engine.js',
    'src/storage/storage-validation.js',
    'src/state.js',
    'data/market_data_bridge.js',
    'data/market_task_status_bridge.js',
    'src/market-data-bridge.js',
    'src/plan-update-draft.js',
    'src/rebalance.js',
    'src/clipboard.js',
    'src/strict-ai-json.js',
    'src/discussion-workbench.js',
    'src/discussion-state-contract.js',
    'src/discussion-plan-workflow.js',
    'src/ui-render.js',
    'src/batch-technical-review.js',
    'src/multi-stock-analysis.js',
    'src/portfolio-review-context.js',
    'src/portfolio-review-contract.js',
    'src/decision-compression-context.js',
    'src/decision-compression-contract.js',
    'src/portfolio-review-ui.js',
    'src/price-refresh.js',
    'src/app.js'
  ])assert.match(html,new RegExp(`${asset.replace(/[.*+?^${}()|[\\]\\]/g,'\\$&')}\\?v=${version}`));
});
