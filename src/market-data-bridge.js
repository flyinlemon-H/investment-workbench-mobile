function applyMarketDataBridge(){
  const payload=window.MARKET_DATA_BRIDGE;
  if(!payload||!Array.isArray(payload.stocks)||!payload.stocks.length)return 0;
  let changed=0;
  payload.stocks.forEach(incoming=>{
    const symbol=String(incoming.symbol||'').trim().toUpperCase();
    const stock=state.stocks.find(item=>String(item.code||item.symbol||'').trim().toUpperCase()===symbol);
    if(!stock)return;
    const currentFetched=String(stock.marketDataFreshness&&stock.marketDataFreshness.fetched_at||'');
    const nextFetched=String(incoming.marketDataFreshness&&incoming.marketDataFreshness.fetched_at||'');
    if(currentFetched&&nextFetched&&currentFetched>=nextFetched)return;
    stock.priceHistory=normalizePriceHistory(incoming.priceHistory||[]);
    stock.marketDataFreshness=incoming.marketDataFreshness||{};
    stock.technicalIndicators=incoming.technicalIndicators||{};
    changed++;
  });
  if(changed)saveState();
  return changed;
}
