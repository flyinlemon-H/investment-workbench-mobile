(function(){
  'use strict';
  const fixture=new URLSearchParams(location.search).get('fixture')||'A';
  function securities(count){return Array.from({length:count},(_,index)=>({id:`fixture-${index+1}`,name:`证券 ${index+1}`,code:`${600000+index}.SS`,type:'holding'}))}
  function facts(symbol){return {symbol,priceHistory:[{date:'2026-08-26',close:10,is_complete_bar:true}],marketDataFreshness:{last_trade_date:'2026-08-26',is_complete_bar:true},technicalIndicators:{last_trade_date:'2026-08-26'}}}
  function apply(){
    const count=fixture==='A'?19:20;
    const acknowledged=fixture==='B'||fixture==='C'?19:count;
    const rows=securities(count);
    state={stocks:fixture==='A'?[...rows,{id:'cash',name:'现金',role:'现金',theme:'现金'}]:rows,updatedAt:null};
    UniverseHandoff.reconcileState(state,{stocks:rows.slice(0,acknowledged).map(stock=>facts(stock.code))},{now:'2026-08-27T09:00:00.000Z'});
    if(fixture==='C')state.universeSync.manifest.lastHandoffAt='2026-08-27T09:05:00.000Z';
    currentTab='tools';detailStockId=null;render();
    document.body.dataset.acceptanceFixture=fixture;
    document.body.dataset.acceptanceRecords=String(state.stocks.length);
    document.body.dataset.acceptanceSecurities=String(UniverseHandoff.universeRows(state.stocks).length);
    document.body.dataset.acceptancePending=String(UniverseHandoff.pendingCount(state));
  }
  setTimeout(apply,1200);
})();
