'use strict';

const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const test=require('node:test');
const Batch=require('../src/batch-technical-review.js');

const root=path.resolve(__dirname,'..');
const fixture=name=>fs.readFileSync(path.join(root,'tests','fixtures',name),'utf8');
const stock={id:'stock-1',code:'601138.SS',name:'工业富联',technicalData:{technicalDataStatus:'fresh'}};
const validator=review=>({valid:true,normalized:review});
const judgment={
  trendStatus:'sideways',technicalSummary:'测试',riskFlags:[],actionHint:'观察',confidence:'medium',
  finalTechnicalConclusion:'测试',holdHint:'观察',addHint:'等待',reduceHint:'暂无'
};

test('standard JSON parses without normalization',()=>{
  const result=Batch.parseAiBatchJsonInput('{"technicalReviews":[]}');
  assert.equal(result.ok,true);
  assert.deepEqual(result.value,{technicalReviews:[]});
  assert.deepEqual(result.input.normalizations,[]);
  assert.equal(result.input.smartQuoteRecoveryAttempted,false);
});

test('a complete json Markdown fence is removed but commentary is never extracted',()=>{
  for(const raw of ['```json\n{"technicalReviews":[]}\n```','```\n{"technicalReviews":[]}\n```']){
    const result=Batch.parseAiBatchJsonInput(raw);
    assert.equal(result.ok,true);
    assert.equal(result.input.fenceRemoved,true);
  }
  const commentary=Batch.parseAiBatchJsonInput('下面是结果：\n{"technicalReviews":[]}');
  assert.equal(commentary.ok,false);
  assert.equal(commentary.error.type,'PARSE_ERROR');
});

test('smart quotes used as JSON punctuation recover after the standard parse fails',()=>{
  const result=Batch.parseAiBatchJsonInput('{ “technicalReviews”: [] }');
  assert.equal(result.ok,true);
  assert.equal(result.input.smartQuotesRecovered,true);
  assert.deepEqual(result.value,{technicalReviews:[]});
});

test('a full smart-quote Batch Contract V2 envelope parses safely',()=>{
  const raw=`{
    “technicalReviews”: [{
      “symbol”: “601138.SS”,
      “review”: {
        “trendStatus”: “sideways”, “technicalSummary”: “测试”, “riskFlags”: [],
        “actionHint”: “观察”, “confidence”: “medium”, “finalTechnicalConclusion”: “测试”,
        “holdHint”: “观察”, “addHint”: “等待”, “reduceHint”: “暂无”
      }
    }]
  }`;
  const result=Batch.parseAiBatchJsonInput(raw);
  assert.equal(result.ok,true);
  assert.equal(result.input.smartQuotesRecovered,true);
  assert.equal(result.value.technicalReviews[0].symbol,'601138.SS');
  assert.equal(result.value.technicalReviews[0].review.confidence,'medium');
});

test('balanced Chinese smart quotes inside string content remain Unicode content',()=>{
  const result=Batch.parseAiBatchJsonInput('{“technicalSummary”: “价格重新站回“前期平台”附近”}');
  assert.equal(result.ok,true);
  assert.equal(result.value.technicalSummary,'价格重新站回“前期平台”附近');
  assert(!result.value.technicalSummary.includes('"前期平台"'));
});

test('an ambiguous unmatched smart quote inside content fails closed',()=>{
  const result=Batch.parseAiBatchJsonInput('{“technicalSummary”: “价格重新站回“前期平台附近”}');
  assert.equal(result.ok,false);
  assert.equal(result.error.type,'PARSE_ERROR');
});

test('single curly quotes are not normalized',()=>{
  const result=Batch.parseAiBatchJsonInput("{ ‘technicalReviews’: [] }");
  assert.equal(result.ok,false);
  assert.equal(result.input.smartQuoteRecoveryAttempted,false);
});

test('truncated smart-quote JSON fails closed as PARSE_ERROR',()=>{
  const result=Batch.process('{ “technicalReviews”: [',[],validator);
  assert.equal(result.batchStatus,'invalid');
  assert.equal(result.errorType,'PARSE_ERROR');
  assert.equal(Batch.eligibleEntries(result).length,0);
});

test('structure, completeness, and validation failures have distinct classifications',()=>{
  const structure=Batch.process('{"reviews":[]}',[stock],validator,{expectedSymbols:[stock.code]});
  assert.equal(structure.errorType,'STRUCTURE_ERROR');

  const incomplete=Batch.process(JSON.stringify({technicalReviews:[]}),[stock],validator,{expectedSymbols:[stock.code]});
  assert.equal(incomplete.errorType,'COMPLETENESS_ERROR');
  assert.deepEqual(incomplete.completeness,{expected:1,detected:0,expectedSymbols:['601138.SS'],detectedSymbols:[],missingSymbols:['601138.SS']});

  const invalid=Batch.process(JSON.stringify({technicalReviews:[{symbol:stock.code,review:{...judgment,trendStatus:'uptrend_pullback'}}]}),[stock],validator,{expectedSymbols:[stock.code]});
  assert.equal(invalid.errorType,'VALIDATION_ERROR');
  assert.match(invalid.items[0].reason,/trendStatus/);
});

test('two expected symbols with one detected reports one missing symbol',()=>{
  const second={...stock,id:'stock-2',code:'601869.SS',name:'长飞光纤'};
  const raw=JSON.stringify({technicalReviews:[{symbol:stock.code,review:judgment}]});
  const result=Batch.process(raw,[stock,second],validator,{expectedSymbols:[stock.code,second.code]});
  assert.equal(result.errorType,'COMPLETENESS_ERROR');
  assert.equal(result.completeness.expected,2);
  assert.equal(result.completeness.detected,1);
  assert.deepEqual(result.completeness.missingSymbols,['601869.SS']);
  assert.match(Batch.renderResult(result),/应有 2 · 识别 1/);
});

test('iPhone ChatGPT smart-quote paste previews successfully with zero writes before save',()=>{
  let writes=0;
  const result=Batch.process(fixture('iphone_chatgpt_smart_quote_batch.txt'),[stock],validator,{expectedSymbols:[stock.code]});
  assert.equal(result.batchStatus,'valid');
  assert.equal(result.input.smartQuotesRecovered,true);
  assert.equal(result.items[0].technicalReview.shortTermTechnical.technicalSummary,'价格仍位于“前期平台”附近，暂未形成有效突破。');
  assert.equal(writes,0);
  assert.match(Batch.renderResult(result),/已自动修正非标准引号/);
});
