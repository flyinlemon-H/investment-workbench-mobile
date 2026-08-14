'use strict';

const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const test=require('node:test');
const vm=require('node:vm');
const Multi=require('../src/multi-stock-analysis.js');

const root=path.resolve(__dirname,'..');
const read=file=>fs.readFileSync(path.join(root,file),'utf8');

function loadRuntime(){
  const context={console,window:{},globalThis:null};
  context.globalThis=context;
  vm.createContext(context);
  vm.runInContext(read('src/state.js'),context,{filename:'state.js'});
  vm.runInContext('this.freshnessRuntime={normalizePriceHistory,updateTechnicalDataFromPriceHistory,technicalFreshnessStatus,latestCompletePriceBar};',context);
  return context.freshnessRuntime;
}

const runtime=loadRuntime();

function history(count=70){
  const rows=[];
  const start=Date.parse('2026-05-01T00:00:00Z');
  for(let index=0;rows.length<count;index+=1){
    const date=new Date(start+index*86400000);
    if(date.getUTCDay()===0||date.getUTCDay()===6)continue;
    rows.push({date:date.toISOString().slice(0,10),close:20+rows.length,volume:1000+rows.length,provider:'fixture',is_complete_bar:true});
  }
  rows[rows.length-1].date='2026-08-13';
  return rows;
}

test('P1 separates realtime price from latest complete daily technical facts',()=>{
  const stock={
    code:'601138.SS',currentPrice:99,priceUpdatedAt:'2026-08-14',priceHistory:history(),
    dataFreshness:{priceUpdatedAt:'2026-08-14'},
    marketDataFreshness:{last_trade_date:'2026-08-13',kline_status:'current'},
    technicalIndicators:{last_trade_date:'2026-08-13',updated_at:'2026-08-13T08:30:00Z',ma5:86,ma10:83.5,ma20:78.5,ma60:58.5,macd:{dif:2,dea:1.5,histogram:1}}
  };
  const result=runtime.updateTechnicalDataFromPriceHistory(stock,{referenceDate:'2026-08-14'});
  assert.equal(result.status,'fresh');
  assert.equal(stock.currentPrice,99);
  assert.equal(stock.priceUpdatedAt,'2026-08-14');
  assert.equal(stock.technicalData.price,89);
  assert.equal(stock.technicalData.technicalAsOf,'2026-08-13');
  assert.equal(stock.technicalData.latestCompleteBar,'2026-08-13');
  assert.equal(stock.technicalData.technicalDataStatus,'fresh');
  assert.equal(stock.technicalData.ma5,86);
  assert.deepEqual(JSON.parse(JSON.stringify(stock.technicalData.macd)),{dif:2,dea:1.5,histogram:1});
  assert.equal(stock.dataFreshness.technicalUpdatedAt,'2026-08-13');
});

test('P1 classifies stale, unavailable, and future anomaly explicitly',()=>{
  assert.equal(runtime.technicalFreshnessStatus('2026-07-08','2026-08-14',{}),'stale');
  assert.equal(runtime.technicalFreshnessStatus('','2026-08-14',{}),'unavailable');
  assert.equal(runtime.technicalFreshnessStatus('2026-08-15','2026-08-14',{}),'anomaly');
});

test('P1 batch context exposes the same program-owned technical facts',()=>{
  const rows=history();
  const stocks=['601138.SS','2899.HK'].map((code,index)=>({
    code,name:code,currentPrice:100+index,priceUpdatedAt:'2026-08-14',priceHistory:rows,
    technicalData:{technicalAsOf:'2026-08-13',latestCompleteBar:'2026-08-13',technicalDataStatus:'fresh',ma5:86,ma10:83.5,ma20:78.5,ma60:58.5,macd:{dif:2,dea:1.5,histogram:1}}
  }));
  const context=Multi.stockContext(stocks[0]);
  assert.equal(context.currentPrice,100);
  assert.equal(context.priceUpdatedAt,'2026-08-14');
  assert.equal(context.technicalAsOf,'2026-08-13');
  assert.equal(context.technicalDataStatus,'fresh');
  const request=Multi.buildRequest(stocks);
  assert.match(request,/"technicalAsOf": "2026-08-13"/);
  assert.match(request,/"technicalDataStatus": "fresh"/);
});

test('P1 realtime quote refresh no longer promotes intraday price into complete history',()=>{
  const source=read('src/price-refresh.js');
  assert.doesNotMatch(source,/cachePriceHistoryFromRefresh/);
  assert.doesNotMatch(source,/touchDataFreshness\(s,'technicalUpdatedAt',r\.updatedAt\)/);
  assert.match(source,/touchDataFreshness\(s,'priceUpdatedAt',r\.updatedAt\)/);
});
