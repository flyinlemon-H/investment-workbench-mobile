'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const context=require('../src/portfolio-review-context.js');
const contract=require('../src/portfolio-review-contract.js');

const fixture=JSON.parse(fs.readFileSync(path.join(__dirname,'fixtures/m05c-real-trial-2026-08-18.json'),'utf8'));
const symbols=fixture.stocks.map(stock=>stock.code);
function review(overrides={}){return {portfolioReview:{reviewDate:fixture.reviewDate,summary:'今日优先复核技术风险与计划条件。',marketContext:'未提供完整市场背景。',portfolioRiskLevel:'moderate',priorityStocks:[{symbol:'601869.SS',priority:'high',reason:'技术资料存在冲突，精确价位暂不采用。',focus:'等待结构重新确认。',planRelation:'价格已进入复核区，仍需确认附加条件。'}],riskAttention:[],planWatch:[{symbol:'603296.SS',status:'triggered',reason:'价格已触发，待确认其他条件。'}],candidateReview:[],portfolioRisks:['所选股票的科技主题集中度较高。'],todayFocus:['先复核存在技术资料冲突的股票。'],dataLimitations:['本次并非完整券商组合，无法判断整个账户的真实集中度。'],confidence:'low',...overrides}}}

test('prompt explicitly bans backend vocabulary and requires natural Chinese consequences',()=>{
  const prompt=context.buildRequest(fixture.stocks,{allStocks:fixture.stocks,reviewDate:fixture.reviewDate,generatedAt:fixture.generatedAt});
  for(const term of contract.FORBIDDEN_USER_TERMS)assert.match(prompt,new RegExp(term));
  assert.match(prompt,/当前未提供可靠现金数据，因此无法判断现金比例/);
  assert.match(prompt,/最多 5 条/);
  assert.match(prompt,/字段审计清单/);
});

test('normal user-facing values accept natural Chinese and reject every forbidden internal term',()=>{
  assert.equal(contract.validate(review(),{expectedSymbols:symbols,reviewDate:fixture.reviewDate}).ok,true);
  for(const term of contract.FORBIDDEN_USER_TERMS){
    const payload=review({summary:`今日结论 ${term}`}),result=contract.validate(payload,{expectedSymbols:symbols,reviewDate:fixture.reviewDate});
    assert.equal(result.ok,false,term);assert.equal(result.code,'internal_jargon',term);
  }
});

test('data limitations are compressed to five consequence-oriented items',()=>{
  const internalIssues=Array.from({length:10},(_,index)=>`第${index+1}项资料问题影响判断。`),invalid=review({dataLimitations:internalIssues}),validation=contract.validate(invalid,{expectedSymbols:symbols,reviewDate:fixture.reviewDate});
  assert.equal(validation.ok,false);assert.equal(validation.code,'too_many_data_limitations');
  const built=context.buildPortfolioContext(fixture.stocks,{allStocks:fixture.stocks,reviewDate:fixture.reviewDate});
  assert.ok(built.coordinationLimitations.length<=5);
  assert.ok(built.coordinationLimitations.every(item=>/因此|无法|不能|置信度|暂不/.test(item)));
});

