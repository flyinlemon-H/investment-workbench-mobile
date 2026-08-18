'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const context=require('../src/portfolio-review-context.js');

const fixture=JSON.parse(fs.readFileSync(path.join(__dirname,'fixtures/m05c-real-trial-2026-08-18.json'),'utf8'));
const result=context.buildPortfolioContext(fixture.stocks,{allStocks:fixture.stocks,reviewDate:fixture.reviewDate,generatedAt:fixture.generatedAt});
const bySymbol=Object.fromEntries(result.stocks.map(item=>[item.stock.symbol,item]));

test('current holding weight wins and historical allocation weight is removed from current context',()=>{
  const zijin=bySymbol['2899.HK'];
  assert.equal(zijin.holding.currentWeight,9.24);
  assert.equal(zijin.holding.weight,9.24);
  assert.equal(Object.hasOwn( zijin.allocation,'currentWeight'),false);
  assert.equal(Object.hasOwn(zijin.allocation,'weightStatus'),false);
  assert.equal(JSON.stringify(zijin.allocation).includes('20.61'),false);
  assert.match(zijin.allocation.strategicConclusion,/资源卫星仓/);
});

test('technical snapshot mismatch is surfaced without recalculating precise levels',()=>{
  const fiber=bySymbol['601869.SS'];
  assert.equal(fiber.technical.todayRelevance,'inconsistent');
  assert.equal(fiber.technical.dataQuality,'inconsistent');
  assert.equal(fiber.technical.essentialFacts.preciseLevelsUsable,false);
  assert.deepEqual(fiber.technical.essentialFacts.supportLevels,[]);
  assert.deepEqual(fiber.technical.essentialFacts.resistanceLevels,[]);
  assert.match(fiber.technical.warning,/不用于精确价位判断/);
  assert.deepEqual(fixture.stocks[3].technicalData.supportLevels,[420,400]);
});

test('complete-bar invariant produces current technical relevance only when all dates agree',()=>{
  const fii=bySymbol['601138.SS'];
  assert.equal(fii.technical.analysisDate,'2026-08-17');
  assert.equal(fii.technical.latestCompleteBar,'2026-08-17');
  assert.equal(fii.technical.priceHistoryLastCompleteDate,'2026-08-17');
  assert.equal(fii.technical.todayRelevance,'current');
  assert.equal(fii.technical.essentialFacts.preciseLevelsUsable,true);
});

