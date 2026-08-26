'use strict';

const assert=require('node:assert/strict');
const test=require('node:test');
const {prepareMarketBridge}=require('../scripts/prepare_market_bridge');
const {validateBridgeContent,readAssignment}=require('../scripts/publish_market_bridges');

function bridge(){
  const stocks=Array.from({length:19},(_,index)=>{
    const symbol=`${String(600000+index)}.SS`;
    return {
      symbol,
      priceHistory:[
        {date:'2026-08-25',open:10,high:11,low:9,close:10.5,volume:1000,is_complete_bar:true},
        {date:'2026-08-26',open:10.5,high:12,low:10,close:11,volume:500,is_complete_bar:false}
      ],
      marketDataFreshness:{last_trade_date:'2026-08-25'},
      technicalIndicators:{last_trade_date:'2026-08-25',supportLevels:[9],resistanceLevels:[12]}
    };
  });
  return `window.MARKET_DATA_BRIDGE = ${JSON.stringify({generatedAt:'2026-08-26T03:20:59.393700+00:00',stocks})};\n`;
}

test('preparer removes incomplete intraday tails without recomputing authoritative technical facts',()=>{
  const prepared=prepareMarketBridge(bridge());
  assert.equal(prepared.removedBars,19);
  assert.equal(prepared.latestDate,'2026-08-25');
  const summary=validateBridgeContent(prepared.content);
  assert.equal(summary.latestDate,'2026-08-25');
  const stock=readAssignment(prepared.content,'MARKET_DATA_BRIDGE').stocks[0];
  assert.equal(stock.priceHistory.at(-1).date,'2026-08-25');
  assert.equal(stock.priceHistory.at(-1).is_complete_bar,true);
  assert.deepEqual(stock.technicalIndicators.supportLevels,[9]);
  assert.deepEqual(stock.technicalIndicators.resistanceLevels,[12]);
});

test('preparer fails closed when authoritative dates do not match the last complete bar',()=>{
  assert.throws(()=>prepareMarketBridge(bridge().replace('"last_trade_date":"2026-08-25"','"last_trade_date":"2026-08-24"')),/freshness date conflicts/);
});
