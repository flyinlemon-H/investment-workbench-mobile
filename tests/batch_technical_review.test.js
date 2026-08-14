'use strict';

const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const test=require('node:test');
const vm=require('node:vm');
const Batch=require('../src/batch-technical-review.js');

const stocks=Array.from({length:10},(_,index)=>({
  id:`stock-${index+1}`,
  code:`TEST${index+1}.SS`,
  name:`测试标的 ${index+1}`,
  technicalReview:{finalTechnicalConclusion:`原结论 ${index+1}`}
}));

function loadSingleStockRuntime(){
  const context={console,window:{},globalThis:null,setTimeout:()=>0,clearTimeout:()=>{}};
  context.globalThis=context;
  vm.createContext(context);
  const root=path.resolve(__dirname,'..');
  vm.runInContext(fs.readFileSync(path.join(root,'src/state.js'),'utf8'),context,{filename:'state.js'});
  vm.runInContext(fs.readFileSync(path.join(root,'src/ui-render.js'),'utf8'),context,{filename:'ui-render.js'});
  vm.runInContext('globalThis.singleStockRuntime={validator:validateSingleStockTechnicalReview,apply:applyTechnicalReviewToStock};',context);
  return context.singleStockRuntime;
}

const singleStockRuntime=loadSingleStockRuntime();
const singleStockValidator=singleStockRuntime.validator;
const validReview=index=>({
  inputCoverage:{hasRecentKline:true,hasCycleKline:false},
  shortTermTechnical:{trendStatus:'sideways',technicalSummary:`技术摘要 ${index}`,supportLevels:[index],resistanceLevels:[index+1]},
  finalTechnicalConclusion:`技术结论 ${index}`
});
const envelope=items=>JSON.stringify({technicalReviews:items});
const item=(index,review=validReview(index))=>({symbol:`TEST${index}.SS`,technicalReview:review});

test('accepts a two-item valid batch and builds previews',()=>{
  const result=Batch.process(envelope([item(1),item(2)]),stocks,singleStockValidator);
  assert.equal(result.batchStatus,'valid');
  assert.deepEqual(result.summary,{total:2,valid:2,invalid:0,unknown:0,duplicate:0});
  assert.equal(result.items[0].preview.stockName,'测试标的 1');
  assert.equal(result.items[0].preview.summary,'技术结论 1');
});

test('handles a ten-item valid batch',()=>{
  const result=Batch.process(envelope(Array.from({length:10},(_,index)=>item(index+1))),stocks,singleStockValidator);
  assert.equal(result.batchStatus,'valid');
  assert.equal(result.summary.total,10);
  assert.equal(result.summary.valid,10);
  assert.equal(result.items.length,10);
});

test('rejects malformed and empty JSON without preview items',()=>{
  for(const raw of ['', '{"technicalReviews":[}', 'not json']){
    const result=Batch.process(raw,stocks,singleStockValidator);
    assert.equal(result.batchStatus,'invalid');
    assert.equal(result.error.code,'parse_error');
    assert.deepEqual(result.items,[]);
  }
});

test('rejects invalid top-level shapes',()=>{
  const cases=[
    ['[]','invalid_top_level'],
    ['{}','missing_technical_reviews'],
    ['{"technicalReviews":{}}','invalid_technical_reviews'],
    ['{"reviews":[]}','missing_technical_reviews']
  ];
  for(const [raw,code] of cases)assert.equal(Batch.process(raw,stocks,singleStockValidator).error.code,code);
});

test('uses exact stock symbols and never name or case fallback',()=>{
  const result=Batch.process(envelope([
    item(1),
    {symbol:'test2.ss',technicalReview:validReview(2)},
    {symbol:'测试标的 3',technicalReview:validReview(3)}
  ]),stocks,singleStockValidator);
  assert.deepEqual(result.items.map(entry=>entry.status),['valid','unknown_symbol','unknown_symbol']);
  assert.equal(result.items[0].matchedStock.symbol,'TEST1.SS');
});

test('normalizes only surrounding whitespace for symbol lookup',()=>{
  const result=Batch.process(envelope([{symbol:'  TEST1.SS  ',technicalReview:validReview(1)}]),stocks,singleStockValidator);
  assert.equal(result.items[0].status,'valid');
  assert.equal(result.items[0].symbol,'TEST1.SS');
});

test('uses stock.symbol when the existing stock has no code',()=>{
  const symbolOnly=[{id:'symbol-only',symbol:'ONLY.HK',name:'仅 symbol 标的'}];
  const result=Batch.process(envelope([{symbol:'ONLY.HK',technicalReview:validReview(1)}]),symbolOnly,singleStockValidator);
  assert.equal(result.items[0].status,'valid');
  assert.equal(result.items[0].matchedStock.symbol,'ONLY.HK');
});

test('reports later duplicate symbols without overwriting the first',()=>{
  const result=Batch.process(envelope([item(1),item(1)]),stocks,singleStockValidator);
  assert.deepEqual(result.items.map(entry=>entry.status),['valid','duplicate_symbol']);
  assert.deepEqual(result.summary,{total:2,valid:1,invalid:0,unknown:0,duplicate:1});
  assert.equal(result.batchStatus,'partial');
});

test('retains every invalid item with one stable classification and reason',()=>{
  const result=Batch.process(envelope([
    null,
    {},
    {symbol:'TEST1.SS'},
    {symbol:'UNKNOWN.SS',technicalReview:validReview(1)},
    {symbol:'TEST2.SS',technicalReview:[]}
  ]),stocks,singleStockValidator);
  assert.deepEqual(result.items.map(entry=>entry.status),[
    'invalid_item','missing_symbol','missing_technical_review','unknown_symbol','invalid_schema'
  ]);
  assert(result.items.every(entry=>entry.reason));
  assert.deepEqual(result.summary,{total:5,valid:0,invalid:4,unknown:1,duplicate:0});
});

test('shows mixed batch failures and consistent summary',()=>{
  const result=Batch.process(envelope([
    item(1),
    {symbol:'UNKNOWN.SS',technicalReview:validReview(2)},
    {symbol:'TEST2.SS',technicalReview:[]},
    item(1)
  ]),stocks,singleStockValidator);
  assert.equal(result.batchStatus,'partial');
  assert.deepEqual(result.summary,{total:4,valid:1,invalid:1,unknown:1,duplicate:1});
  assert.equal(result.items.length,4);
});

test('batch validity matches the existing single-stock validator',()=>{
  const accepted=validReview(1);
  const rejected=[];
  const directAccepted=singleStockValidator(accepted,stocks[0]);
  const directRejected=singleStockValidator(rejected,stocks[0]);
  const result=Batch.process(envelope([
    {symbol:'TEST1.SS',technicalReview:accepted},
    {symbol:'TEST2.SS',technicalReview:rejected}
  ]),stocks,singleStockValidator);
  assert.equal(result.items[0].status,directAccepted.valid?'valid':'invalid_schema');
  assert.equal(result.items[1].status,directRejected.valid?'valid':'invalid_schema');
  assert.equal(result.items[0].technicalReview.finalTechnicalConclusion,directAccepted.normalized.finalTechnicalConclusion);
});

test('parse, validation, failures, and preview do not mutate stock state',()=>{
  const before=JSON.stringify(stocks);
  Batch.process(envelope([item(1),{symbol:'UNKNOWN.SS',technicalReview:{}}]),stocks,singleStockValidator);
  Batch.process('{bad json',stocks,singleStockValidator);
  assert.equal(JSON.stringify(stocks),before);
});

test('fails closed when the authoritative validator is unavailable',()=>{
  const result=Batch.process(envelope([item(1)]),stocks,null);
  assert.equal(result.batchStatus,'invalid');
  assert.equal(result.error.code,'validator_unavailable');
});

test('ambiguous existing stock symbols are not auto-selected',()=>{
  const duplicatedStocks=[stocks[0],{...stocks[0],id:'other'}];
  const result=Batch.process(envelope([item(1)]),duplicatedStocks,singleStockValidator);
  assert.equal(result.items[0].status,'unknown_symbol');
  assert.match(result.items[0].reason,/不唯一/);
});

test('rendered preview exposes summary and every failure reason',()=>{
  const result=Batch.process(envelope([item(1),{symbol:'UNKNOWN.SS',technicalReview:{}}]),stocks,singleStockValidator);
  const html=Batch.renderResult(result);
  assert.match(html,/总计 2/);
  assert.match(html,/unknown_symbol/);
  assert.match(html,/未找到 exact symbol/);
  assert.doesNotMatch(html,/保存成功|导入成功/);
});

test('persistence UI exposes explicit confirmation and critical candidate save',()=>{
  const source=fs.readFileSync(path.resolve(__dirname,'../src/batch-technical-review.js'),'utf8');
  const html=fs.readFileSync(path.resolve(__dirname,'../index.html'),'utf8');
  assert.match(source,/解析并预览/);
  assert.match(source,/确认批量更新/);
  assert.match(source,/saveState\(candidate,options\)/);
  assert.match(source,/critical:true/);
  assert.doesNotMatch(source,/localStorage\s*\.|indexedDB\s*\./);
  assert.match(html,/batchTechnicalReviewBtn/);
  assert.match(html,/src\/batch-technical-review\.js/);
});

function simpleApply(stock,review){
  stock.technicalReview=JSON.parse(JSON.stringify(review));
}

function commitDeps(overrides={}){
  const events=[];
  const holder={authoritative:null,saveCalls:0,renderCalls:0};
  return {
    events,
    holder,
    deps:{
      applyTechnicalReview:simpleApply,
      saveCandidate:async(candidate,options)=>{
        holder.saveCalls++;
        events.push('save');
        assert.equal(options.critical,true);
        return candidate;
      },
      adoptCandidate:candidate=>{
        events.push('adopt');
        holder.authoritative=candidate;
      },
      render:()=>{
        events.push('render');
        holder.renderCalls++;
      },
      ...overrides
    }
  };
}

test('commits multiple valid entries through one critical save before adopt and render',async()=>{
  const current={stocks:stocks.slice(0,3).map(stock=>({...stock,notes:`保留 ${stock.id}`})),portfolioStrategy:{name:'保持不变'}};
  const before=JSON.stringify(current);
  const preview=Batch.process(envelope([item(1),item(2),item(3)]),current.stocks,singleStockValidator);
  const fixture=commitDeps();
  fixture.holder.authoritative=current;
  const result=await Batch.commit(preview,current,fixture.deps);
  assert.equal(result.status,'completed');
  assert.deepEqual(result.summary,{updated:3,skipped:0,warnings:0,failed:0});
  assert.equal(fixture.holder.saveCalls,1);
  assert.deepEqual(fixture.events,['save','adopt','render']);
  assert.equal(JSON.stringify(current),before);
  assert.equal(fixture.holder.authoritative.stocks[0].technicalReview.finalTechnicalConclusion,'技术结论 1');
  assert.equal(fixture.holder.authoritative.stocks[1].technicalReview.finalTechnicalConclusion,'技术结论 2');
  assert.equal(fixture.holder.authoritative.stocks[2].notes,'保留 stock-3');
  assert.deepEqual(fixture.holder.authoritative.portfolioStrategy,{name:'保持不变'});
});

test('valid entries persist while invalid and unmatched entries are skipped without creating stocks',async()=>{
  const current={stocks:stocks.slice(0,3).map(stock=>JSON.parse(JSON.stringify(stock)))};
  const preview=Batch.process(envelope([
    item(1),
    {symbol:'TEST2.SS',technicalReview:[]},
    {symbol:'UNKNOWN.SS',technicalReview:validReview(9)},
    item(3)
  ]),current.stocks,singleStockValidator);
  const fixture=commitDeps();
  fixture.holder.authoritative=current;
  const result=await Batch.commit(preview,current,fixture.deps);
  assert.equal(result.status,'completed');
  assert.deepEqual(result.summary,{updated:2,skipped:2,warnings:0,failed:0});
  assert.equal(fixture.holder.saveCalls,1);
  assert.equal(fixture.holder.authoritative.stocks.length,3);
  assert.equal(fixture.holder.authoritative.stocks[0].technicalReview.finalTechnicalConclusion,'技术结论 1');
  assert.equal(fixture.holder.authoritative.stocks[1].technicalReview.finalTechnicalConclusion,'原结论 2');
  assert.equal(fixture.holder.authoritative.stocks[2].technicalReview.finalTechnicalConclusion,'技术结论 3');
});

test('persistence keeps exact-symbol protection for similar code and stock-name inputs',async()=>{
  const current={stocks:stocks.slice(0,3).map(stock=>JSON.parse(JSON.stringify(stock)))};
  const preview=Batch.process(envelope([
    item(1),
    {symbol:'test2.ss',technicalReview:validReview(2)},
    {symbol:'测试标的 3',technicalReview:validReview(3)}
  ]),current.stocks,singleStockValidator);
  const fixture=commitDeps();
  fixture.holder.authoritative=current;
  const result=await Batch.commit(preview,current,fixture.deps);
  assert.equal(result.status,'completed');
  assert.deepEqual(result.summary,{updated:1,skipped:2,warnings:0,failed:0});
  assert.equal(fixture.holder.authoritative.stocks[0].technicalReview.finalTechnicalConclusion,'技术结论 1');
  assert.equal(fixture.holder.authoritative.stocks[1].technicalReview.finalTechnicalConclusion,'原结论 2');
  assert.equal(fixture.holder.authoritative.stocks[2].technicalReview.finalTechnicalConclusion,'原结论 3');
});

test('duplicate conflicts exclude every entry for that exact symbol from persistence',async()=>{
  const current={stocks:stocks.slice(0,2).map(stock=>JSON.parse(JSON.stringify(stock)))};
  const preview=Batch.process(envelope([item(1),item(1)]),current.stocks,singleStockValidator);
  assert.deepEqual(preview.items.map(entry=>entry.status),['valid','duplicate_symbol']);
  assert.deepEqual(Batch.eligibleEntries(preview),[]);
  const fixture=commitDeps();
  fixture.holder.authoritative=current;
  const result=await Batch.commit(preview,current,fixture.deps);
  assert.equal(result.status,'no_eligible');
  assert.equal(fixture.holder.saveCalls,0);
  assert.equal(fixture.holder.renderCalls,0);
  assert.equal(fixture.holder.authoritative,current);
});

test('no eligible entries do not save, adopt, or render success',async()=>{
  const current={stocks:stocks.slice(0,2).map(stock=>JSON.parse(JSON.stringify(stock)))};
  const preview=Batch.process(envelope([
    {symbol:'UNKNOWN.SS',technicalReview:validReview(1)},
    {symbol:'TEST2.SS',technicalReview:[]}
  ]),current.stocks,singleStockValidator);
  const fixture=commitDeps();
  fixture.holder.authoritative=current;
  const result=await Batch.commit(preview,current,fixture.deps);
  assert.equal(result.status,'no_eligible');
  assert.deepEqual(result.summary,{updated:0,skipped:2,warnings:0,failed:0});
  assert.equal(fixture.holder.saveCalls,0);
  assert.deepEqual(fixture.events,[]);
});

test('critical save failure preserves authoritative state and never renders candidate',async()=>{
  const current={stocks:stocks.slice(0,2).map(stock=>JSON.parse(JSON.stringify(stock)))};
  const before=JSON.stringify(current);
  const preview=Batch.process(envelope([item(1),item(2)]),current.stocks,singleStockValidator);
  let authoritative=current;
  let saveCalls=0;
  let adoptCalls=0;
  let renderCalls=0;
  const result=await Batch.commit(preview,current,{
    applyTechnicalReview:simpleApply,
    saveCandidate:async()=>{saveCalls++;throw new Error('storage unavailable')},
    adoptCandidate:candidate=>{adoptCalls++;authoritative=candidate},
    render:()=>{renderCalls++}
  });
  assert.equal(result.status,'failed');
  assert.equal(result.stage,'save');
  assert.equal(saveCalls,1);
  assert.equal(adoptCalls,0);
  assert.equal(renderCalls,0);
  assert.equal(authoritative,current);
  assert.equal(JSON.stringify(current),before);
});

test('candidate application failure occurs before save and preserves original state',async()=>{
  const current={stocks:stocks.slice(0,2).map(stock=>JSON.parse(JSON.stringify(stock)))};
  const before=JSON.stringify(current);
  const preview=Batch.process(envelope([item(1),item(2)]),current.stocks,singleStockValidator);
  const fixture=commitDeps({applyTechnicalReview:()=>{throw new Error('apply failed')}});
  fixture.holder.authoritative=current;
  const result=await Batch.commit(preview,current,fixture.deps);
  assert.equal(result.status,'failed');
  assert.equal(result.stage,'candidate');
  assert.equal(fixture.holder.saveCalls,0);
  assert.deepEqual(fixture.events,[]);
  assert.equal(JSON.stringify(current),before);
});

test('a render error after save is reported as persisted instead of save failure',async()=>{
  const current={stocks:stocks.slice(0,1).map(stock=>JSON.parse(JSON.stringify(stock)))};
  const preview=Batch.process(envelope([item(1)]),current.stocks,singleStockValidator);
  const fixture=commitDeps({render:()=>{fixture.events.push('render');throw new Error('render failed')}});
  fixture.holder.authoritative=current;
  const result=await Batch.commit(preview,current,fixture.deps);
  assert.equal(result.status,'saved_render_failed');
  assert.deepEqual(fixture.events,['save','adopt','render']);
  assert.notEqual(fixture.holder.authoritative,current);
  assert.equal(fixture.holder.authoritative.stocks[0].technicalReview.finalTechnicalConclusion,'技术结论 1');
});

test('commit controller rejects a repeated click while the first save is pending',async()=>{
  let release;
  let calls=0;
  const controller=Batch.createCommitController(()=>{
    calls++;
    return new Promise(resolve=>{release=resolve});
  });
  const first=controller.run('first');
  assert.equal(controller.pending,true);
  const second=await controller.run('second');
  assert.equal(second.status,'busy');
  assert.equal(calls,1);
  release({status:'completed'});
  assert.equal((await first).status,'completed');
  assert.equal(controller.pending,false);
});

test('shared single-stock apply helper preserves unrelated fields and writes derived technical data',()=>{
  const stock={
    ...JSON.parse(JSON.stringify(stocks[0])),
    notes:'不得修改',
    dataFreshness:{priceUpdatedAt:'2026-08-01'},
    technicalData:{symbol:'TEST1.SS',ma20:10,ma60:20}
  };
  const validation=singleStockValidator(validReview(1),stock);
  assert.equal(validation.valid,true);
  singleStockRuntime.apply(stock,validation.normalized);
  assert.equal(stock.notes,'不得修改');
  assert.equal(stock.technicalReview.finalTechnicalConclusion,'技术结论 1');
  assert.equal(stock.technicalData.symbol,'TEST1.SS');
  assert.equal(stock.technicalData.technicalSummary,'技术摘要 1');
  assert(stock.dataFreshness.technicalUpdatedAt);
});

test('Workbench candidate adapter performs one critical save and returns the adopted state',async()=>{
  const authoritative={stocks:[],marker:'authoritative'};
  const candidate={stocks:[],marker:'candidate'};
  let live=authoritative;
  let saveCalls=0;
  const saveCandidate=Batch.createWorkbenchCandidateSaver({
    getState:()=>live,
    setState:value=>{live=value},
    persist:async(value,options)=>{
      saveCalls++;
      assert.equal(options.critical,true);
      live=value;
    }
  });
  const saved=await saveCandidate(candidate,{critical:true});
  assert.equal(saveCalls,1);
  assert.equal(live,candidate);
  assert.equal(saved,candidate);
});

test('Workbench candidate adapter restores authoritative state after persistence rejection',async()=>{
  const authoritative={stocks:[],marker:'authoritative'};
  const candidate={stocks:[],marker:'candidate'};
  let live=authoritative;
  let persisted=authoritative;
  let saveCalls=0;
  const saveCandidate=Batch.createWorkbenchCandidateSaver({
    getState:()=>live,
    setState:value=>{live=value},
    persist:async value=>{
      saveCalls++;
      live=value;
      throw new Error('quota exceeded');
    }
  });
  await assert.rejects(()=>saveCandidate(candidate,{critical:true}),/quota exceeded/);
  assert.equal(saveCalls,1);
  assert.equal(live,authoritative);
  assert.equal(persisted,authoritative);
});

test('Workbench failure injection keeps preview, skips success render, and restores state',async()=>{
  const authoritative={stocks:JSON.parse(JSON.stringify(stocks)),marker:'A'};
  const preview=Batch.process(JSON.stringify({technicalReviews:[{
    symbol:'TEST1.SS',
    technicalReview:validReview(1)
  }]}),authoritative.stocks,singleStockValidator);
  let live=authoritative;
  let persisted=authoritative;
  let renderCalls=0;
  const saveCandidate=Batch.createWorkbenchCandidateSaver({
    getState:()=>live,
    setState:value=>{live=value},
    persist:async candidate=>{
      live=candidate;
      throw new Error('injected persistence failure');
    }
  });
  const result=await Batch.commit(preview,authoritative,{
    applyTechnicalReview:singleStockRuntime.apply,
    saveCandidate,
    adoptCandidate:candidate=>{live=candidate},
    render:()=>{renderCalls++}
  });
  assert.equal(result.status,'failed');
  assert.equal(result.stage,'save');
  assert.equal(live,authoritative);
  assert.equal(persisted,authoritative);
  assert.equal(renderCalls,0);
  assert.equal(Batch.eligibleEntries(preview).length,1);
});
