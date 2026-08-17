'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const contract=require('../src/portfolio-review-contract.js');

const symbols=['601138.SS','601899.SS'];
function payload(summary,date='2026-08-17'){return {portfolioReview:{reviewDate:date,summary,marketContext:'未提供。',portfolioRiskLevel:'moderate',priorityStocks:[{symbol:'601138.SS',priority:'high',reason:summary,focus:'复核',planRelation:'接近计划'}],riskAttention:[],planWatch:[],candidateReview:[],portfolioRisks:[],todayFocus:[summary],dataLimitations:['范围有限'],confidence:'medium'}}}
function processed(summary,date='2026-08-17'){return contract.process(JSON.stringify(payload(summary,date)),{expectedSymbols:symbols,reviewDate:date})}
function morningState(){const morning=contract.buildSnapshot(processed('上午结论'),{expectedSymbols:symbols,generatedAt:'2026-08-17T09:30:00+08:00',savedAt:'2026-08-17T09:31:00+08:00'});return {stocks:[{code:'601138.SS',plans:[{action:'buy',price:49}]},{code:'601899.SS',plans:[]}],multiStockAnalysis:{groups:[{id:'g',name:'默认',symbols}]},portfolioReview:{current:morning,history:[morning]},updatedAt:1}}

test('M05C preview and validation perform zero writes and do not mutate plans',()=>{
  const state=morningState(),before=JSON.stringify(state),result=processed('下午结论');
  assert.equal(result.ok,true);assert.equal(JSON.stringify(state),before);
});

test('M05C successful save performs one critical write then adopts one coherent afternoon snapshot',async()=>{
  const state=morningState(),beforePlans=JSON.stringify(state.stocks.map(stock=>stock.plans));let writes=0,optionsSeen=null,adopted=null;
  const result=await contract.commit(processed('下午完整结论'),state,{saveCandidate:async(candidate,options)=>{writes+=1;optionsSeen=options;return candidate},adoptCandidate:candidate=>{adopted=candidate},render:()=>{}},{expectedSymbols:symbols,generatedAt:'2026-08-17T14:10:00+08:00',savedAt:'2026-08-17T14:11:00+08:00'});
  assert.equal(result.status,'completed');assert.equal(writes,1);assert.equal(optionsSeen.critical,true);
  assert.equal(adopted.portfolioReview.current.review.summary,'下午完整结论');
  assert.equal(adopted.portfolioReview.current.review.todayFocus[0],'下午完整结论');
  assert.equal(JSON.stringify(adopted.portfolioReview.current).includes('上午结论'),false);
  assert.equal(adopted.portfolioReview.history.length,1);assert.equal(adopted.portfolioReview.history[0].review.summary,'下午完整结论');
  assert.deepEqual(adopted.multiStockAnalysis.lastSymbols,symbols);
  assert.equal(JSON.stringify(adopted.stocks.map(stock=>stock.plans)),beforePlans);
});

test('M05C failed replacement leaves morning review and authoritative state byte-logically intact',async()=>{
  const state=morningState(),before=JSON.stringify(state);let adopted=false,rendered=false;
  const result=await contract.commit(processed('下午失败候选'),state,{saveCandidate:async()=>{throw new Error('injected failure')},adoptCandidate:()=>{adopted=true},render:()=>{rendered=true}},{expectedSymbols:symbols,generatedAt:'2026-08-17T14:10:00+08:00'});
  assert.equal(result.status,'failed');assert.equal(result.stage,'save');assert.equal(adopted,false);assert.equal(rendered,false);assert.equal(JSON.stringify(state),before);assert.equal(state.portfolioReview.current.review.summary,'上午结论');
});

test('M05C different review dates retain bounded history while current is the latest complete snapshot',()=>{
  const state=morningState();const next=contract.buildCandidate(state,processed('次日结论','2026-08-18'),{expectedSymbols:symbols,generatedAt:'2026-08-18T14:00:00+08:00'}).candidate;
  assert.equal(next.portfolioReview.current.reviewDate,'2026-08-18');assert.equal(next.portfolioReview.history.length,2);assert.deepEqual(next.portfolioReview.history.map(item=>item.reviewDate),['2026-08-18','2026-08-17']);
});
