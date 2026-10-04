async function applyMarketDataBridge(options={}){
  const payload=window.MARKET_DATA_BRIDGE;
  if(!payload||!Array.isArray(payload.stocks)||!payload.stocks.length)return 0;
  // Validate the entire batch before mutating any stock.
  payload.stocks.forEach(incoming=>{
    const symbol=window.SymbolIdentity.canonicalMarketSymbol(incoming.symbol);
    const stock=state.stocks.find(item=>window.SymbolIdentity.canonicalMarketSymbol(item.code||item.symbol)===symbol);
    if(stock)assertMarketHistoryContinuity(stock,incoming.priceHistory,incoming.marketDataFreshness);
  });
  let changed=0;const previous=[];const stateUpdatedAt=state.updatedAt;
  payload.stocks.forEach(incoming=>{
    const symbol=window.SymbolIdentity.canonicalMarketSymbol(incoming.symbol);
    if(!symbol)return;
    const stock=state.stocks.find(item=>window.SymbolIdentity.canonicalMarketSymbol(item.code||item.symbol)===symbol);
    if(!stock)return;
    // A later failed/static delivery cannot replace an acknowledged valid result.
    if(stock.marketDataFreshness?.resultVersion&&(incoming.marketDataFreshness?.kline_status==='failed'||String(incoming.marketDataFreshness?.last_trade_date||'')<String(stock.marketDataFreshness.last_trade_date||'')))return;
    const currentFetched=String(stock.marketDataFreshness&&stock.marketDataFreshness.fetched_at||'');
    const nextFetched=String(incoming.marketDataFreshness&&incoming.marketDataFreshness.fetched_at||'');
    if(currentFetched&&nextFetched&&currentFetched>=nextFetched)return;
    previous.push({stock,priceHistory:structuredClone(stock.priceHistory),marketDataFreshness:structuredClone(stock.marketDataFreshness),technicalIndicators:structuredClone(stock.technicalIndicators),technicalData:structuredClone(stock.technicalData),dataFreshness:structuredClone(stock.dataFreshness)});
    stock.priceHistory=normalizePriceHistory(incoming.priceHistory||[]);
    stock.marketDataFreshness=incoming.marketDataFreshness||{};
    stock.technicalIndicators=incoming.technicalIndicators||{};
    if(incoming.technicalData)stock.technicalData={...stock.technicalData,...structuredClone(incoming.technicalData)};
    if(typeof updateTechnicalDataFromPriceHistory==='function')updateTechnicalDataFromPriceHistory(stock);
    changed++;
  });
  if(changed&&options.persist!==false){
    try{await saveState(state,{critical:true})}
    catch(error){
      previous.forEach(item=>{item.stock.priceHistory=item.priceHistory;item.stock.marketDataFreshness=item.marketDataFreshness;item.stock.technicalIndicators=item.technicalIndicators;item.stock.technicalData=item.technicalData;item.stock.dataFreshness=item.dataFreshness});
      state.updatedAt=stateUpdatedAt;throw error;
    }
  }
  return changed;
}
