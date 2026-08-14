(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  if(root)root.SymbolIdentity=Object.freeze(api);
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';

  function canonicalSymbol(value){
    return String(value??'').trim().replace(/[a-z]/g,letter=>letter.toUpperCase());
  }

  function stockSymbol(stock){
    return canonicalSymbol(stock&&(stock.code||stock.symbol));
  }

  function buildStockIndex(stocks){
    const index=new Map();
    const ambiguous=new Set();
    (Array.isArray(stocks)?stocks:[]).forEach(stock=>{
      const symbol=stockSymbol(stock);
      if(!symbol)return;
      if(index.has(symbol))ambiguous.add(symbol);
      else index.set(symbol,stock);
    });
    ambiguous.forEach(symbol=>index.delete(symbol));
    return {index,ambiguous};
  }

  return {canonicalSymbol,stockSymbol,buildStockIndex};
});
