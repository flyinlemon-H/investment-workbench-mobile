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

test('release publishes the current 19-stock market bridge with technical indicators',()=>{
  const bridge=loadPublishedBridge();
  assert.equal(bridge.generatedAt,'2026-08-13T08:30:04.458306+00:00');
  assert.equal(bridge.stocks.length,19);
  const stock=bridge.stocks.find(item=>item.symbol==='2899.HK');
  assert(stock);
  assert.equal(stock.priceHistory.at(-1).date,'2026-08-13');
  assert.equal(stock.marketDataFreshness.last_trade_date,'2026-08-13');
  assert.equal(stock.technicalIndicators.last_trade_date,'2026-08-13');
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
    window:{MARKET_DATA_BRIDGE:{...bridge,stocks:[incoming]}},
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
  assert.equal(stock.priceHistory.at(-1).date,'2026-08-13');
  assert.equal(stock.marketDataFreshness.fetched_at,incoming.marketDataFreshness.fetched_at);
  assert.deepEqual(stock.technicalIndicators,incoming.technicalIndicators);
  assert.equal(stock.technicalData.technicalAsOf,'2026-08-13');
});

test('M05B Hotfix 1 release version cache-busts the bridge and Workbench modules',()=>{
  const html=read('index.html');
  const version='m05b-hotfix1-workbench-mobile-20260814';
  assert.match(html,new RegExp(`<meta name="app-asset-version" content="${version}">`));
  for(const asset of [
    'src/symbol-identity.js',
    'data/market_data_bridge.js',
    'data/market_task_status_bridge.js',
    'src/market-data-bridge.js',
    'src/ui-render.js',
    'src/batch-technical-review.js',
    'src/multi-stock-analysis.js',
    'src/app.js'
  ])assert.match(html,new RegExp(`${asset.replace(/[.*+?^${}()|[\\]\\]/g,'\\$&')}\\?v=${version}`));
});
