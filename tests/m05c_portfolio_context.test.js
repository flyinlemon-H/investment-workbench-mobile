'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const context=require('../src/portfolio-review-context.js');

const fixture=JSON.parse(fs.readFileSync(path.join(__dirname,'fixtures/m05c-mixed-portfolio.json'),'utf8'));
const pick=count=>fixture.stocks.slice(0,count);

test('M05C context includes only selected canonical symbols and compact program facts',()=>{
  const result=context.buildPortfolioContext(pick(3),{allStocks:fixture.stocks,reviewDate:fixture.reviewDate,generatedAt:fixture.generatedAt});
  assert.deepEqual(result.stocks.map(item=>item.stock.symbol),['601138.SS','601899.SS','601869.SS']);
  assert.equal(result.reviewDate,'2026-08-17');
  assert.equal(result.generatedAt,fixture.generatedAt);
  assert.equal(result.portfolio.selectionScope,'selected_review_universe_not_confirmed_full_brokerage_portfolio');
  assert.equal(result.portfolio.cashStatus,'unavailable');
  assert.equal(Object.hasOwn(result.stocks[0],'priceHistory'),false);
  assert.equal(JSON.stringify(result).includes('recentCompleteDailyCloses'),false);
});

test('M05C context preserves heavy, small, watchlist, and zero-position distinctions',()=>{
  const result=context.buildPortfolioContext(fixture.stocks,{allStocks:fixture.stocks,reviewDate:fixture.reviewDate});
  const bySymbol=Object.fromEntries(result.stocks.map(item=>[item.stock.symbol,item]));
  assert.equal(bySymbol['601138.SS'].holding.holdingStatus,'held');
  assert.equal(bySymbol['601138.SS'].holding.shares,5000);
  assert.ok(bySymbol['601138.SS'].holding.weight>bySymbol['601869.SS'].holding.weight);
  assert.equal(bySymbol['300308.SZ'].holding.holdingStatus,'watchlist');
  assert.equal(bySymbol['300750.SZ'].holding.holdingStatus,'watchlist');
  assert.equal(bySymbol['300308.SZ'].holding.marketValue,null);
});

test('M05C context preserves module freshness and separates current August news from July history',()=>{
  const stock=context.buildPortfolioContext([fixture.stocks[0]],{allStocks:fixture.stocks,reviewDate:fixture.reviewDate}).stocks[0];
  assert.equal(stock.technical.status,'fresh');
  assert.equal(stock.technical.analysisDate,'2026-08-15');
  assert.equal(stock.news.analysisDate,'2026-08-17');
  assert.deepEqual(stock.news.currentSnapshot.recentEvents,['8月订单信息']);
  assert.equal(JSON.stringify(stock.news.currentSnapshot).includes('7月历史行业催化'),false);
  assert.deepEqual(stock.news.historicalReference,{status:'historical_reference',asOf:'2026-08-17',items:['7月历史行业催化']});
  const stale=context.buildPortfolioContext([fixture.stocks[2]],{reviewDate:fixture.reviewDate}).stocks[0];
  assert.equal(stale.technical.status,'stale');
  assert.equal(stale.news.status,'unavailable');
  assert.equal(stale.valuation.status,'unavailable');
});

test('M05C context includes allocation, fundamental, valuation, long-term logic, and active plans without mutation',()=>{
  const before=JSON.stringify(fixture.stocks[0].plans);
  const stock=context.buildPortfolioContext([fixture.stocks[0]],{allStocks:fixture.stocks,reviewDate:fixture.reviewDate}).stocks[0];
  assert.equal(stock.allocation.targetWeight,22);
  assert.equal(stock.allocation.upperLimit,28);
  assert.equal(stock.fundamental.summary,'盈利质量稳定，订单兑现仍是重点。');
  assert.equal(stock.valuation.level,'expensive');
  assert.equal(stock.longTermLogic.status,'valid');
  assert.equal(stock.plans.length,2);
  assert.equal(stock.plans[0].triggerPrice,49);
  assert.equal(JSON.stringify(fixture.stocks[0].plans),before);
});

test('M05C prompt enforces comparison, holdings, plans, stale data, broker boundary, and strict JSON',()=>{
  const prompt=context.buildRequest(pick(3),{allStocks:fixture.stocks,reviewDate:fixture.reviewDate,generatedAt:fixture.generatedAt});
  for(const phrase of ['比较所选股票','实际券商持仓','zero_position_candidate','不得修改、覆盖或新增存储计划','stale、unavailable、unknown','不得发明','不给确定性买卖指令','只输出严格 JSON','顶层只能包含 portfolioReview'])assert.match(prompt,new RegExp(phrase.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')));
  assert.match(prompt,/reviewDate 必须等于输入 reviewDate/);
});

test('M05C supports 1 through 12 stocks and reports bounded request sizes',t=>{
  assert.equal(context.buildPortfolioContext(pick(1),{reviewDate:fixture.reviewDate}).stocks.length,1);
  assert.equal(context.buildPortfolioContext(pick(12),{reviewDate:fixture.reviewDate}).stocks.length,12);
  assert.throws(()=>context.buildPortfolioContext(fixture.stocks.concat({...fixture.stocks[0],code:'999999.SS'}),{reviewDate:fixture.reviewDate}),/最多选择 12/);
  const metrics=[3,8,12].map(count=>context.requestMetrics(context.buildRequest(pick(count),{allStocks:fixture.stocks,reviewDate:fixture.reviewDate,generatedAt:fixture.generatedAt})));
  metrics.forEach(metric=>{assert.ok(metric.characters>1000);assert.ok(metric.characters<160000);assert.ok(metric.approxTokens<80000)});
  assert.ok(metrics[0].characters<metrics[1].characters&&metrics[1].characters<metrics[2].characters);
  t.diagnostic(`M05C request sizes — 3: ${metrics[0].characters} chars / ~${metrics[0].approxTokens} tokens; 8: ${metrics[1].characters} / ~${metrics[1].approxTokens}; 12: ${metrics[2].characters} / ~${metrics[2].approxTokens}`);
});
