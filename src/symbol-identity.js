(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  if(root)root.SymbolIdentity=Object.freeze(api);
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';

  const MARKET_SYMBOL_PATTERN=/^(?:\d{6}\.(?:SS|SZ)|\d{4,5}\.HK)$/;

  function uppercase(value){
    return String(value??'').trim().replace(/[a-z]/g,letter=>letter.toUpperCase());
  }

  function canonicalMarketSymbol(value){
    const raw=uppercase(value);
    const mainland=raw.match(/^(\d{6})\.(SS|SH|SZ)$/);
    if(mainland)return `${mainland[1]}.${mainland[2]==='SH'?'SS':mainland[2]}`;
    const hongKong=raw.match(/^(\d{1,5})\.HK$/);
    if(hongKong)return `${hongKong[1].padStart(4,'0')}.HK`;
    return '';
  }

  function canonicalSymbol(value){
    return canonicalMarketSymbol(value)||uppercase(value);
  }

  function isSupportedMarketSymbol(value){
    const symbol=canonicalMarketSymbol(value);
    return Boolean(symbol&&MARKET_SYMBOL_PATTERN.test(symbol));
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

  return {MARKET_SYMBOL_PATTERN,canonicalSymbol,canonicalMarketSymbol,isSupportedMarketSymbol,stockSymbol,buildStockIndex};
});
