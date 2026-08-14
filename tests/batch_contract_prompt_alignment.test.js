'use strict';

const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const test=require('node:test');
const vm=require('node:vm');
const Batch=require('../src/batch-technical-review.js');
const Multi=require('../src/multi-stock-analysis.js');

const fixture=JSON.parse(fs.readFileSync(path.join(__dirname,'fixtures/m05b-hotfix3-contract-trial.json'),'utf8'));
const baseReview=riskFlags=>({
  trendStatus:Batch.contract.trendStatuses[0],
  technicalSummary:'技术摘要',
  riskFlags,
  actionHint:'等待确认',
  confidence:Batch.contract.confidenceLevels[0],
  finalTechnicalConclusion:'技术结论',
  holdHint:'继续观察',
  addHint:'确认后复核',
  reduceHint:'跌破后复核'
});
const stocks=fixture.stocks.map((entry,index)=>({
  id:`contract-${index+1}`,
  code:entry.symbol,
  name:`契约标的 ${index+1}`,
  type:'holding',
  technicalData:{technicalDataStatus:'fresh'}
}));
const passthroughValidator=review=>({valid:true,normalized:review});

function promptEnums(prompt,field){
  const match=prompt.match(new RegExp(`${field} 固定枚举：([^。]+)。`));
  assert(match,`${field} enum line must be present`);
  return match[1].split(', ');
}

function preview(reviews,selected=stocks){
  return Batch.process(JSON.stringify({technicalReviews:reviews}),selected,passthroughValidator,{expectedSymbols:selected.map(stock=>stock.code)});
}

test('Batch Contract exposes one deeply immutable enum source',()=>{
  assert(Object.isFrozen(Batch.contract));
  assert(Object.isFrozen(Batch.contract.trendStatuses));
  assert(Object.isFrozen(Batch.contract.riskFlags));
  assert(Object.isFrozen(Batch.contract.confidenceLevels));
  assert.equal(Batch.TREND_STATUSES,Batch.contract.trendStatuses);
  assert.equal(Batch.RISK_FLAGS,Batch.contract.riskFlags);
  assert.equal(Batch.CONFIDENCE_LEVELS,Batch.contract.confidenceLevels);
  assert.throws(()=>Batch.contract.riskFlags.push('invented_flag'),TypeError);
});

test('request prompt enums exactly match the authoritative Batch Contract',()=>{
  const prompt=Multi.buildRequest(stocks.slice(0,2));
  assert.deepEqual(promptEnums(prompt,'riskFlags'),[...Batch.contract.riskFlags]);
  assert.deepEqual(promptEnums(prompt,'trendStatus'),[...Batch.contract.trendStatuses]);
  assert.deepEqual(promptEnums(prompt,'confidence'),[...Batch.contract.confidenceLevels]);
  assert.match(prompt,/禁止自创、翻译、改写、组合或同义替换新的 riskFlag/);
  assert.match(prompt,/如无适用项，返回 \[\]/);
});

test('output example uses only values from the current contract',()=>{
  const review=Multi.outputExample().technicalReviews[0].review;
  assert(Batch.contract.trendStatuses.includes(review.trendStatus));
  assert(review.riskFlags.every(flag=>Batch.contract.riskFlags.includes(flag)));
  assert(Batch.contract.confidenceLevels.includes(review.confidence));
});

test('request generation fails closed when the Batch Contract is unavailable',()=>{
  const source=fs.readFileSync(path.join(__dirname,'../src/multi-stock-analysis.js'),'utf8');
  const context={module:{exports:{}},exports:{},console,globalThis:null,require:specifier=>{
    if(specifier==='./symbol-identity.js')return {canonicalSymbol:value=>String(value||'').trim().toUpperCase()};
    if(specifier==='./batch-technical-review.js')return null;
    throw new Error(`unexpected dependency: ${specifier}`);
  }};
  context.globalThis=context;
  vm.createContext(context);
  vm.runInContext(source,context,{filename:'multi-stock-analysis.js'});
  assert.throws(()=>context.module.exports.buildRequest([{code:'ONE.SS'},{code:'TWO.SS'}]),/Batch contract unavailable/);
});

test('valid, empty, invalid, and mixed riskFlags fail closed with exact diagnostics',()=>{
  const target=stocks.slice(0,1);
  for(const flags of [['near_previous_high','resistance_overhead','short_term_volatility'],[]]){
    const result=preview([{symbol:target[0].code,review:baseReview(flags)}],target);
    assert.equal(result.batchStatus,'valid');
    assert.equal(result.summary.valid,1);
  }
  for(const [flags,illegal] of [[['momentum_cooling'],'momentum_cooling'],[['trend_weakening','support_test'],'support_test']]){
    const result=preview([{symbol:target[0].code,review:baseReview(flags)}],target);
    assert.equal(result.batchStatus,'invalid');
    assert.equal(result.errorType,Batch.ERROR_TYPES.VALIDATION);
    assert.equal(result.summary.valid,0);
    assert.equal(result.summary.invalid,1);
    assert.match(result.items[0].reason,new RegExp(illegal));
    assert.match(Batch.renderResult(result),new RegExp(`${target[0].code}[\\s\\S]*${illegal}`));
  }
});

test('12-stock mobile trial fixture is complete and all contract riskFlags validate',()=>{
  fixture.stocks.forEach(entry=>entry.riskFlags.forEach(flag=>assert(Batch.contract.riskFlags.includes(flag),flag)));
  const reviews=fixture.stocks.map(entry=>({symbol:entry.symbol,review:baseReview(entry.riskFlags)}));
  const result=preview(reviews);
  assert.equal(result.batchStatus,'valid');
  assert.deepEqual(result.completeness,{expected:12,detected:12,expectedSymbols:stocks.map(stock=>stock.code),detectedSymbols:stocks.map(stock=>stock.code),missingSymbols:[]});
  assert.deepEqual(result.summary,{total:12,valid:12,invalid:0,unknown:0,duplicate:0});
});

test('legacy previousJudgment risk text remains context and never expands the whitelist',()=>{
  const legacy='MACD绿柱持续出现，短期动能偏弱';
  const selected=stocks.slice(0,2).map((stock,index)=>index?stock:{...stock,technicalReview:{shortTermTechnical:{riskFlags:[legacy]}}});
  const before=[...Batch.contract.riskFlags];
  const prompt=Multi.buildRequest(selected);
  assert.match(prompt,new RegExp(legacy));
  assert.deepEqual(promptEnums(prompt,'riskFlags'),before);
  assert(!Batch.contract.riskFlags.includes(legacy));
});
