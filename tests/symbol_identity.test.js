'use strict';

const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const test=require('node:test');
const SymbolIdentity=require('../src/symbol-identity.js');
const Batch=require('../src/batch-technical-review.js');
const Multi=require('../src/multi-stock-analysis.js');

const review={inputCoverage:{},shortTermTechnical:{trendStatus:'sideways'},finalTechnicalConclusion:'fixture'};
const validator=value=>({valid:true,normalized:value});
const envelope=symbol=>JSON.stringify({technicalReviews:[{symbol,technicalReview:review}]});

test('canonicalSymbol trims and uppercases ASCII letters only',()=>{
  assert.equal(SymbolIdentity.canonicalSymbol(' 2899.hk '),'2899.HK');
  assert.equal(SymbolIdentity.canonicalSymbol('601138.ss'),'601138.SS');
  assert.equal(SymbolIdentity.canonicalSymbol('工业富联'),'工业富联');
});

test('historical lowercase stocks match uppercase AI symbols and expected symbols',()=>{
  for(const symbol of ['2899.hk','601138.ss']){
    const result=Batch.process(envelope(SymbolIdentity.canonicalSymbol(symbol)),[{id:symbol,code:symbol,name:'fixture'}],validator,{expectedSymbols:[symbol]});
    assert.equal(result.batchStatus,'valid');
    assert.equal(result.items[0].status,'valid');
    assert.equal(result.items[0].matchedStock.symbol,symbol);
  }
});

test('suffix mismatch, missing suffix, and name fallback remain unknown',()=>{
  const stocks=[{id:'target',code:'601138.ss',name:'工业富联'}];
  for(const symbol of ['601138.SZ','601138','工业富联']){
    const result=Batch.process(envelope(symbol),stocks,validator);
    assert.equal(result.items[0].status,'unknown_symbol');
  }
});

test('case-only duplicates in one response are rejected canonically',()=>{
  const raw=JSON.stringify({technicalReviews:[
    {symbol:'601138.ss',technicalReview:review},
    {symbol:'601138.SS',technicalReview:review}
  ]});
  const result=Batch.process(raw,[{id:'target',code:'601138.SS'}],validator);
  assert.deepEqual(result.items.map(item=>item.status),['valid','duplicate_symbol']);
  assert.equal(Batch.eligibleEntries(result).length,0);
});

test('canonical collisions in existing stocks are ambiguous and never auto-selected',()=>{
  const stocks=[{id:'one',code:'601138.ss'},{id:'two',code:'601138.SS'}];
  const lookup=SymbolIdentity.buildStockIndex(stocks);
  assert(lookup.ambiguous.has('601138.SS'));
  assert.equal(lookup.index.has('601138.SS'),false);
  assert.equal(Batch.process(envelope('601138.SS'),stocks,validator).items[0].status,'unknown_symbol');
});

test('analysis selection memory and groups resolve case-only variants to the stored stock code',()=>{
  const stocks=[{id:'one',code:'601138.ss',type:'holding'},{id:'two',code:'2899.hk',type:'holding'}];
  const preferences={lastSymbols:['601138.SS'],groups:[{id:'g',name:'G',symbols:['2899.HK','2899.hk']} ]};
  assert.deepEqual(Multi.normalizePreferences(preferences,stocks),{
    lastSymbols:['601138.ss'],defaultGroupId:'',groups:[{id:'g',name:'G',symbols:['2899.hk']}]
  });
});

test('new and edited stock save path canonicalizes code and blocks canonical duplicates',()=>{
  const source=fs.readFileSync(path.resolve(__dirname,'../src/ui-render.js'),'utf8');
  assert.match(source,/SymbolIdentity\.canonicalSymbol\(document\.getElementById\('fCode'\)\.value\)/);
  assert.match(source,/SymbolIdentity\.buildStockIndex\(otherStocks\)/);
  assert.match(source,/lookup\.index\.has\(code\)\|\|lookup\.ambiguous\.has\(code\)/);
  assert.match(source,/const payload=\{type:formType,name,code,/);
});
