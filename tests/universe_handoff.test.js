'use strict';

const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const test=require('node:test');
const SymbolIdentity=require('../src/symbol-identity.js');
const Universe=require('../src/universe-handoff.js');

const now='2026-08-26T09:00:00.000Z';
const validFacts=symbol=>({
  symbol,
  priceHistory:[{date:'2026-08-25',close:10,is_complete_bar:true}],
  marketDataFreshness:{last_trade_date:'2026-08-25',is_complete_bar:true},
  technicalIndicators:{last_trade_date:'2026-08-25'}
});

test('mobile add creates durable pending state and a reload keeps it pending',()=>{
  const state={stocks:[{id:'new',name:'fixture',code:'600000.SH',shares:88,avgCost:9,plans:[{price:8}],aiReviews:{x:1}}]};
  Universe.markPending(state,'600000.SH',{now});
  Universe.reconcileState(state,{stocks:[]},{now});
  assert.deepEqual(state.universeSync.pendingSymbols,['600000.SS']);
  const reloaded=JSON.parse(JSON.stringify(state));
  Universe.reconcileState(reloaded,{stocks:[]},{now});
  assert.deepEqual(reloaded.universeSync.pendingSymbols,['600000.SS']);
});

test('mobile stock save path marks the new canonical symbol pending before its critical save',()=>{
  const source=fs.readFileSync(path.resolve(__dirname,'../src/ui-render.js'),'utf8');
  assert.match(source,/UniverseHandoff\.markPending\(state,code\)/);
  assert.match(source,/UniverseHandoff\.reconcileState\(state,window\.MARKET_DATA_BRIDGE\)/);
});

test('first-load bootstrap acknowledges only symbols with valid authoritative bridge facts',()=>{
  const state={stocks:[{code:'2899.hk',name:'known'},{code:'000858.sz',name:'historical pending'}]};
  const result=Universe.reconcileState(state,{stocks:[validFacts('2899.HK')]},{now});
  assert.deepEqual(result.acknowledgedSymbols,['2899.HK']);
  assert.deepEqual(result.pendingSymbols,['000858.SZ']);
  assert.equal(Universe.reconcileState(state,{stocks:[validFacts('2899.HK')]},{now}).changed,false);
});

test('manifest is minimal, canonical, checksummed, and deterministic until membership changes',async()=>{
  const state={stocks:[
    {code:'600000.SH',name:'浦发银行',shares:88,avgCost:9,plans:[{price:8}],allocationDecision:{x:1},aiReviews:{x:1},technicalIndicators:{fake:true}},
    {code:'700.hk',name:'腾讯',role:'观察仓'},
    {name:'cash',role:'现金',shares:1000}
  ]};
  Universe.reconcileState(state,{stocks:[]},{now});
  const first=await Universe.buildManifest(state,{now});
  const second=await Universe.buildManifest(state,{now:'2026-08-27T09:00:00.000Z'});
  assert.deepEqual(first,second);
  assert.deepEqual(first.symbols,[
    {symbol:'0700.HK',active:true,displayName:'腾讯'},
    {symbol:'600000.SS',active:true,displayName:'浦发银行'}
  ]);
  const serialized=JSON.stringify(first);
  for(const forbidden of ['shares','avgCost','plans','allocationDecision','aiReviews','technicalIndicators'])assert.doesNotMatch(serialized,new RegExp(forbidden));
  assert.match(first.checksum.value,/^[0-9a-f]{64}$/);
});

test('strict market identity normalizes aliases and rejects malformed forms',()=>{
  assert.equal(SymbolIdentity.canonicalMarketSymbol(' 600000.sh '),'600000.SS');
  assert.equal(SymbolIdentity.canonicalMarketSymbol('700.hk'),'0700.HK');
  assert.equal(SymbolIdentity.canonicalMarketSymbol('000858.sz'),'000858.SZ');
  for(const invalid of ['600000','ABC.US','浦发银行','123.SS','123456.HK'])assert.equal(SymbolIdentity.canonicalMarketSymbol(invalid),'');
});

test('pending clears only after canonical bridge acknowledgement with valid facts',()=>{
  const state={stocks:[{code:'600000.sh',name:'fixture'}]};
  Universe.reconcileState(state,{stocks:[]},{now});
  assert.equal(Universe.isPending(state,'600000.SS'),true);
  Universe.reconcileState(state,{stocks:[{symbol:'600000.ss',priceHistory:[]}]},{now});
  assert.equal(Universe.isPending(state,'600000.SS'),true);
  Universe.reconcileState(state,{stocks:[validFacts('600000.ss')]},{now});
  assert.equal(Universe.isPending(state,'600000.SH'),false);
});
