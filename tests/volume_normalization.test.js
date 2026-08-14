'use strict';

const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const test=require('node:test');
const vm=require('node:vm');

const root=path.resolve(__dirname,'..');
const read=file=>fs.readFileSync(path.join(root,file),'utf8');

function loadRuntime(){
  const context={console,window:{},globalThis:null};
  context.globalThis=context;
  vm.createContext(context);
  vm.runInContext(read('src/state.js'),context,{filename:'state.js'});
  vm.runInContext('this.volumeRuntime={volumeScaleForProvider,normalizeVolumeComparison,updateTechnicalDataFromPriceHistory};',context);
  return context.volumeRuntime;
}

const runtime=loadRuntime();

function row(index,provider,volume,close=50){
  return {date:new Date(Date.parse('2026-05-01T00:00:00Z')+index*86400000).toISOString().slice(0,10),close:close+index/10,volume,provider,is_complete_bar:true};
}

test('P4 normalizes EastMoney A-share lots to Yahoo share units across a provider transition',()=>{
  const history=[
    ...Array.from({length:5},(_,index)=>row(index,'yahoo',10_000_000)),
    ...Array.from({length:5},(_,index)=>row(index+5,'eastmoney',100_000))
  ];
  const result=runtime.normalizeVolumeComparison(history,'601138.SS');
  assert.equal(runtime.volumeScaleForProvider('eastmoney','601138.SS'),100);
  assert.equal(result.volumeStatus,'comparable');
  assert.equal(result.volumeProviderTransition,true);
  assert.equal(result.volume,10_000_000);
  assert.equal(result.volumeChangePct,0);
});

test('P4 keeps EastMoney Hong Kong volume in shares',()=>{
  const history=[
    ...Array.from({length:5},(_,index)=>row(index,'yahoo',2_000_000)),
    ...Array.from({length:5},(_,index)=>row(index+5,'eastmoney',2_000_000))
  ];
  const result=runtime.normalizeVolumeComparison(history,'2899.HK');
  assert.equal(runtime.volumeScaleForProvider('eastmoney','2899.HK'),1);
  assert.equal(result.volumeStatus,'comparable');
  assert.equal(result.volumeChangePct,0);
});

test('P4 marks an unproven provider scale unavailable instead of comparing raw values',()=>{
  const history=[
    ...Array.from({length:5},(_,index)=>row(index,'yahoo',10_000_000)),
    ...Array.from({length:5},(_,index)=>row(index+5,'mystery',100_000))
  ];
  const result=runtime.normalizeVolumeComparison(history,'601138.SS');
  assert.equal(result.volumeStatus,'unavailable');
  assert.equal(result.volumeWarning,'provider_scale_mismatch');
  assert.equal(result.volumeChangePct,null);
});

test('P4 published bridge no longer emits the known fake minus-95-percent scale signal',()=>{
  const context={window:{}};
  vm.createContext(context);
  vm.runInContext(read('data/market_data_bridge.js'),context);
  const incoming=context.window.MARKET_DATA_BRIDGE.stocks.find(stock=>String(stock.symbol).toUpperCase()==='601869.SS');
  assert(incoming);
  assert(incoming.technicalIndicators.volume_change.change_pct<-90);
  const normalized=runtime.normalizeVolumeComparison(JSON.parse(JSON.stringify(incoming.priceHistory)),incoming.symbol);
  assert.equal(normalized.volumeStatus,'comparable');
  assert(normalized.volumeChangePct>-90,`normalized change should not preserve fake scale signal: ${normalized.volumeChangePct}`);
  const stock={code:incoming.symbol,priceHistory:JSON.parse(JSON.stringify(incoming.priceHistory)),marketDataFreshness:incoming.marketDataFreshness,technicalIndicators:JSON.parse(JSON.stringify(incoming.technicalIndicators))};
  runtime.updateTechnicalDataFromPriceHistory(stock,{referenceDate:'2026-08-14'});
  assert.equal(stock.technicalIndicators.volume_change.unit,'shares');
  assert.equal(stock.technicalIndicators.volume_change.change_pct,normalized.volumeChangePct);
});

test('P4 volume normalization does not change price, MA, or MACD calculations',()=>{
  const closes=Array.from({length:70},(_,index)=>row(index,index<35?'yahoo':'eastmoney',index<35?10_000_000:100_000,30));
  const stock={code:'601138.SS',priceHistory:closes,marketDataFreshness:{kline_status:'current'}};
  runtime.updateTechnicalDataFromPriceHistory(stock,{referenceDate:'2026-08-14'});
  assert.equal(stock.technicalData.price,36.9);
  assert(stock.technicalData.ma5>0);
  assert(stock.technicalData.ma20>0);
  assert(Number.isFinite(stock.technicalData.macd.dif));
  assert.equal(stock.technicalData.volumeStatus,'comparable');
});
