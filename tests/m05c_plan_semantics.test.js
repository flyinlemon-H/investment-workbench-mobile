'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const context=require('../src/portfolio-review-context.js');
const contract=require('../src/portfolio-review-contract.js');

const fixture=JSON.parse(fs.readFileSync(path.join(__dirname,'fixtures/m05c-real-trial-2026-08-18.json'),'utf8'));
const symbols=fixture.stocks.map(stock=>stock.code);
function review(reason='价格已触发，待确认其他条件。'){return {portfolioReview:{reviewDate:fixture.reviewDate,summary:'今天先复核计划条件。',marketContext:'未提供。',portfolioRiskLevel:'moderate',priorityStocks:[],riskAttention:[],planWatch:[{symbol:'603296.SS',status:'triggered',reason}],candidateReview:[],portfolioRisks:[],todayFocus:['确认价格之外的计划条件。'],dataLimitations:['本次复核范围有限，无法代表完整账户。'],confidence:'medium'}}}

test('crossed plan prices remain price-only triggers with full condition unproven',()=>{
  const result=context.buildPortfolioContext(fixture.stocks,{allStocks:fixture.stocks,reviewDate:fixture.reviewDate}),bySymbol=Object.fromEntries(result.stocks.map(item=>[item.stock.symbol,item]));
  const huaqin=bySymbol['603296.SS'].plans[0];
  assert.equal(huaqin.priceCondition,'triggered');
  assert.equal(huaqin.fullConditionStatus,'unproven');
  assert.equal(huaqin.userMeaning,'价格已触发，待确认其他条件');
  assert.deepEqual(huaqin.additionalConditions,['技术止跌确认','成交量确认']);
  assert.ok(bySymbol['601869.SS'].plans.every(plan=>plan.priceCondition==='triggered'&&plan.fullConditionStatus==='unproven'));
});

test('contract accepts conservative price-trigger wording and rejects full-condition claims',()=>{
  assert.equal(contract.validate(review(),{expectedSymbols:symbols,reviewDate:fixture.reviewDate}).ok,true);
  const full=contract.validate(review('完整条件已满足。'),{expectedSymbols:symbols,reviewDate:fixture.reviewDate});assert.equal(full.ok,false);
  const ambiguous=contract.validate(review('已到计划条件。'),{expectedSymbols:symbols,reviewDate:fixture.reviewDate});assert.equal(ambiguous.ok,false);
});

test('result UI localizes triggered status as price-triggered pending confirmation',()=>{
  const ui=fs.readFileSync(path.join(__dirname,'../src/portfolio-review-ui.js'),'utf8');
  assert.match(ui,/triggered:'价格已触发，待确认其他条件'/);
  assert.doesNotMatch(ui,/triggered:'已到计划条件'/);
});

