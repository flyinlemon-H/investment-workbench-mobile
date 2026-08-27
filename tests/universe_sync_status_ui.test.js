'use strict';

const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const test=require('node:test');
const vm=require('node:vm');
require('../src/symbol-identity.js');
const Universe=require('../src/universe-handoff.js');

const root=path.resolve(__dirname,'..');
const read=file=>fs.readFileSync(path.join(root,file),'utf8');
const now='2026-08-27T09:00:00.000Z';
const validFacts=symbol=>({
  symbol,
  priceHistory:[{date:'2026-08-26',close:10,is_complete_bar:true}],
  marketDataFreshness:{last_trade_date:'2026-08-26',is_complete_bar:true},
  technicalIndicators:{last_trade_date:'2026-08-26'}
});
const securities=count=>Array.from({length:count},(_,index)=>({
  id:`security-${index+1}`,
  name:`证券 ${index+1}`,
  code:`${600000+index}.SS`,
  type:'holding'
}));
const reconciledState=(securityCount,acknowledgedCount)=>{
  const stocks=securities(securityCount);
  const state={stocks};
  Universe.reconcileState(state,{stocks:stocks.slice(0,acknowledgedCount).map(stock=>validFacts(stock.code))},{now});
  return state;
};

function renderStatus(state,{userAgent='fixture'}={}){
  const elements={
    pcSyncControl:{hidden:true},
    pcSyncStatus:{textContent:''},
    syncPcBtn:{hidden:true}
  };
  const context={
    console,
    window:{UniverseHandoff:Universe,navigator:{userAgent}},
    document:{getElementById:id=>elements[id]||null},
    fixture:state,
    globalThis:null,
    setTimeout:()=>0,
    clearTimeout:()=>{}
  };
  context.globalThis=context;
  vm.createContext(context);
  vm.runInContext(read('src/state.js'),context,{filename:'state.js'});
  vm.runInContext(read('src/ui-render.js'),context,{filename:'ui-render.js'});
  vm.runInContext("state=fixture;currentTab='tools';detailStockId=null;renderPcSyncStatus();",context);
  return elements;
}

test('zero pending renders persistent PC sync status with canonical security count and hides action',()=>{
  const state=reconciledState(19,19);
  state.stocks.push({id:'cash',name:'现金',role:'现金',theme:'现金'});
  const status=Universe.statusPresentation(state);
  assert.equal(state.stocks.length,20);
  assert.equal(status.securityCount,19);
  assert.equal(status.text,'PC同步 · 已同步 19只');
  assert.equal(status.showAction,false);

  const elements=renderStatus(state);
  assert.equal(elements.pcSyncControl.hidden,false);
  assert.equal(elements.pcSyncStatus.textContent,'PC同步 · 已同步 19只');
  assert.equal(elements.syncPcBtn.hidden,true);
});

test('one pending security shows its count and the existing PC sync action',()=>{
  const state=reconciledState(20,19);
  const status=Universe.statusPresentation(state);
  assert.equal(status.text,'PC同步 · 1只等待同步');
  assert.equal(status.pendingCount,1);
  assert.equal(status.showAction,true);

  const elements=renderStatus(state);
  assert.equal(elements.pcSyncStatus.textContent,'PC同步 · 1只等待同步');
  assert.equal(elements.syncPcBtn.hidden,false);
});

test('multiple pending securities display the correct count',()=>{
  const status=Universe.statusPresentation(reconciledState(20,17));
  assert.equal(status.text,'PC同步 · 3只等待同步');
  assert.equal(status.pendingCount,3);
  assert.equal(status.showAction,true);
});

test('handed-off but unacknowledged remains distinct from synced',()=>{
  const state=reconciledState(20,19);
  state.universeSync.manifest.lastHandoffAt='2026-08-27T09:05:00.000Z';
  const status=Universe.statusPresentation(state);
  assert.equal(status.text,'PC同步 · 已交接，等待PC更新 1只');
  assert.equal(status.showAction,true);
  assert.doesNotMatch(status.text,/已同步 20只/);
});

test('valid bridge acknowledgement transitions waiting status to synced',()=>{
  const state=reconciledState(20,19);
  state.universeSync.manifest.lastHandoffAt='2026-08-27T09:05:00.000Z';
  assert.equal(Universe.statusPresentation(state).text,'PC同步 · 已交接，等待PC更新 1只');
  Universe.reconcileState(state,{stocks:state.stocks.map(stock=>validFacts(stock.code))},{now:'2026-08-27T10:00:00.000Z'});
  const status=Universe.statusPresentation(state);
  assert.equal(status.text,'PC同步 · 已同步 20只');
  assert.equal(status.showAction,false);
});

test('stock pending badges retain canonical symbol semantics',()=>{
  const state=reconciledState(2,1);
  assert.equal(Universe.isPending(state,'600001.SH'),true);
  assert.equal(Universe.isPending(state,'600000.SH'),false);
  const ui=read('src/ui-render.js');
  assert.match(ui,/UniverseHandoff\.isPending\(state,s\.code\|\|s\.symbol\).*等待同步/);
});

test('normal status copy never leaks internal sync fields or enums',()=>{
  const states=[reconciledState(19,19),reconciledState(20,19)];
  states[1].universeSync.manifest.lastHandoffAt='2026-08-27T09:05:00.000Z';
  const copy=states.map(state=>Universe.statusPresentation(state).text).join(' ');
  assert.doesNotMatch(copy,/schemaVersion|pendingSymbols|fingerprint|revision|checksum|SHA-256|pending|acknowledged/i);
});

test('Safari sharing capability does not affect status visibility',()=>{
  const state=reconciledState(19,19);
  const elements=renderStatus(state,{userAgent:'Mozilla/5.0 Version/18.0 Mobile Safari/605.1.15'});
  assert.equal(elements.pcSyncControl.hidden,false);
  assert.equal(elements.pcSyncStatus.textContent,'PC同步 · 已同步 19只');
});

test('Tools toolbar places compact status before other actions without a zero-state disabled button',()=>{
  const index=read('index.html');
  assert.ok(index.indexOf('id="pcSyncControl"')<index.indexOf('id="globalActions"'));
  assert.match(index,/id="pcSyncStatus" role="status" aria-live="polite"/);
  assert.doesNotMatch(index,/同步到PC（无待同步）|同步到PC \(无待同步\)/);
  assert.match(index,/@media\(max-width:390px\).*\.pc-sync-status/);
});
