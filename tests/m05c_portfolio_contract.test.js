'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const contract=require('../src/portfolio-review-contract.js');

const symbols=['601138.SS','601899.SS','300308.SZ'];
function validReview(overrides={}){return {portfolioReview:{reviewDate:'2026-08-17',summary:'整体以观察和计划复核为主。',marketContext:'未提供完整市场背景。',portfolioRiskLevel:'moderate',priorityStocks:[{symbol:'601138.ss',priority:'high',reason:'重仓且接近压力。',focus:'等待关键位置确认。',planRelation:'接近原减仓复核区。'}],riskAttention:[{symbol:'601899.SS',reason:'高位整理需要关注承接。'}],planWatch:[{symbol:'601138.SS',status:'approaching',reason:'接近既有计划。'}],candidateReview:[{symbol:'300308.SZ',reason:'零仓候选，仅值得进一步复核。'}],portfolioRisks:['所选标的存在主题相关性。'],todayFocus:['先复核重仓股关键位置。'],dataLimitations:['所选范围不一定是完整券商组合。'],confidence:'medium',...overrides}}}

test('valid M05C contract parses, validates, and canonicalizes symbols',()=>{
  const result=contract.process(JSON.stringify(validReview()),{expectedSymbols:symbols,reviewDate:'2026-08-17'});
  assert.equal(result.ok,true);
  assert.equal(result.review.priorityStocks[0].symbol,'601138.SS');
  assert.equal(result.review.portfolioRiskLevel,'moderate');
});

test('M05C contract recovers wrapping fence and structural smart quotes while preserving Chinese quotes',()=>{
  const payload=validReview({summary:'用户说“原计划”仍需保留。'});
  const standard=JSON.stringify(payload);
  let open=true;const smart=standard.replace(/"/g,()=>{const value=open?'“':'”';open=!open;return value});
  const result=contract.process(`\n\`\`\`json\n${smart}\n\`\`\`\n`,{expectedSymbols:symbols,reviewDate:'2026-08-17'});
  assert.equal(result.ok,true,result.message);
  assert.equal(result.input.smartQuotesRecovered,true);
  assert.equal(result.review.summary,'用户说“原计划”仍需保留。');
});

test('M05C unknown symbol fails the entire coherent snapshot',()=>{
  const payload=validReview();payload.portfolioReview.riskAttention=[{symbol:'AAPL',reason:'不应出现。'}];
  const result=contract.process(JSON.stringify(payload),{expectedSymbols:symbols,reviewDate:'2026-08-17'});
  assert.equal(result.ok,false);assert.match(result.message,/不在本次所选股票/);
});

test('M05C duplicate symbol in one section fails closed',()=>{
  const payload=validReview();payload.portfolioReview.priorityStocks.push({...payload.portfolioReview.priorityStocks[0],symbol:'601138.SS'});
  const result=contract.process(JSON.stringify(payload),{expectedSymbols:symbols,reviewDate:'2026-08-17'});
  assert.equal(result.ok,false);assert.match(result.message,/symbol 重复/);
});

test('M05C rejects malformed, truncated, unsupported enum, missing, and extra fields',()=>{
  assert.equal(contract.process('{"portfolioReview":',{expectedSymbols:symbols}).ok,false);
  const urgent=validReview();urgent.portfolioReview.priorityStocks[0].priority='urgent';assert.match(contract.process(JSON.stringify(urgent),{expectedSymbols:symbols}).message,/urgent/);
  const missing=validReview();delete missing.portfolioReview.todayFocus;assert.match(contract.process(JSON.stringify(missing),{expectedSymbols:symbols}).message,/缺少字段/);
  const extra=validReview();extra.portfolioReview.score=88;assert.match(contract.process(JSON.stringify(extra),{expectedSymbols:symbols}).message,/未知字段/);
});

test('M05C symbol coverage is intentionally partial but references remain selected-only',()=>{
  const payload=validReview({priorityStocks:[],riskAttention:[],planWatch:[],candidateReview:[]});
  const result=contract.process(JSON.stringify(payload),{expectedSymbols:symbols,reviewDate:'2026-08-17'});
  assert.equal(result.ok,true);
});

module.exports={validReview,symbols};
