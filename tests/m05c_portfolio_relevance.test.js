'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const context=require('../src/portfolio-review-context.js');

const fixture=JSON.parse(fs.readFileSync(path.join(__dirname,'fixtures/m05c-real-trial-2026-08-18.json'),'utf8'));
const build=stocks=>context.buildPortfolioContext(stocks,{allStocks:fixture.stocks,reviewDate:fixture.reviewDate,generatedAt:fixture.generatedAt});

test('portfolio relevance enum is orchestration-only and module-specific',()=>{
  assert.deepEqual(context.TODAY_RELEVANCE,['current','usable_with_caution','outdated','unavailable','inconsistent']);
  const result=build(fixture.stocks),bySymbol=Object.fromEntries(result.stocks.map(item=>[item.stock.symbol,item]));
  assert.equal(bySymbol['601138.SS'].technical.todayRelevance,'current');
  assert.equal(bySymbol['601138.SS'].news.todayRelevance,'current');
  assert.equal(bySymbol['603296.SS'].valuation.todayRelevance,'usable_with_caution');
  assert.equal(bySymbol['603296.SS'].longTermLogic.todayRelevance,'current');
});

test('June news marked fresh by its module cannot become current August news',()=>{
  const stock=build([fixture.stocks[0]]).stocks[0];
  assert.equal(stock.news.status,'fresh');
  assert.notEqual(stock.news.todayRelevance,'current');
  assert.equal(stock.news.todayRelevance,'outdated');
  assert.equal(stock.news.currentSnapshot,null);
  assert.match(stock.news.warning,/不是今日催化/);
  assert.match(JSON.stringify(stock.news.historicalReference),/历史|6月矿产价格背景/);
});

test('recent dated news remains current while unknown fundamental authority wins over high confidence',()=>{
  const result=build(fixture.stocks),bySymbol=Object.fromEntries(result.stocks.map(item=>[item.stock.symbol,item]));
  assert.equal(bySymbol['601138.SS'].news.todayRelevance,'current');
  assert.equal(bySymbol['601138.SS'].news.latestSourceDate,'2026-08-16');
  assert.equal(bySymbol['603296.SS'].fundamental.status,'unknown');
  assert.equal(bySymbol['603296.SS'].fundamental.todayRelevance,'unavailable');
  assert.equal(bySymbol['603296.SS'].fundamental.confidence,'low');
  assert.equal(bySymbol['603296.SS'].fundamental.summary,'');
});

test('time-sensitive coverage reduces portfolio confidence but old valuation alone does not force low confidence',()=>{
  assert.equal(build(fixture.stocks).readiness.suggestedConfidence,'low');
  const onlyValuationOld=structuredClone(fixture.stocks[1]);
  onlyValuationOld.valuationReview.updatedAt='2026-06-01';
  onlyValuationOld.informationCompleteness.valuation='medium';
  const result=context.buildPortfolioContext([onlyValuationOld],{allStocks:[onlyValuationOld],reviewDate:fixture.reviewDate});
  assert.equal(result.stocks[0].valuation.todayRelevance,'usable_with_caution');
  assert.equal(result.readiness.suggestedConfidence,'high');
});

