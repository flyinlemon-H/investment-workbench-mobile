(function(root,factory){
  const api=factory(root);
  if(typeof module==='object'&&module.exports)module.exports=api;
  if(root)root.TechnicalFreshness=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(root){
  'use strict';
  function dateOnly(value){const s=String(value||'').slice(0,10);return /^\d{4}-\d{2}-\d{2}$/.test(s)&&Number.isFinite(Date.parse(s))&&new Date(s).toISOString().slice(0,10)===s?s:''}
  function marketDate(value=new Date()){
    if(typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value))return dateOnly(value);
    const d=new Date(value);if(!Number.isFinite(d.getTime()))return '';
    return new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).format(d);
  }
  function businessDays(asOf,reference){let days=0;for(let cursor=Date.parse(asOf)+86400000;cursor<=Date.parse(reference);cursor+=86400000){const day=new Date(cursor).getUTCDay();if(day!==0&&day!==6)days++}return days}
  function ageStatus(asOf,reference=new Date(),market={}){
    const date=dateOnly(asOf),today=marketDate(reference);
    if(!date)return 'unavailable';
    if(!today||date>today)return 'anomaly';
    const days=businessDays(date,today);
    if(market.kline_status==='failed')return 'unknown';
    return days>3||market.kline_status==='stale'?'stale':'fresh';
  }
  function evaluate(stock={},options={}){
    const td=stock.technicalData||{},market=stock.marketDataFreshness||{},indicators=stock.technicalIndicators||{};
    const bars=(stock.priceHistory||[]).filter(b=>b&&b.is_complete_bar!==false&&dateOnly(b.date)&&Number(b.close)>0&&Number.isFinite(Number(b.close))).sort((a,b)=>a.date.localeCompare(b.date));
    const last=bars.at(-1),asOf=dateOnly(td.technicalAsOf),latest=dateOnly(td.latestCompleteBar),history=last?dateOnly(last.date):'';
    const incomplete=!asOf||!latest||!history,conflict=Boolean(asOf&&[latest,history,market.last_trade_date,indicators.last_trade_date].filter(Boolean).some(d=>d!==asOf));
    const raw=td.technicalDataStatus||'unavailable',age=ageStatus(asOf,options.referenceDate||options.reviewDate||options.now||new Date(),market);
    // Reuse existing snapshot and bridge validators; freshness owns only the policy.
    const portfolio=typeof module==='object'&&module.exports?require('./portfolio-review-context.js'):root.PortfolioReviewContext;
    const universe=typeof module==='object'&&module.exports?require('./universe-handoff.js'):root.UniverseHandoff;
    const consistent=portfolio?portfolio.technicalConsistency(stock).consistent:true;
    const bridgeInvalid=Boolean(market.last_trade_date&&universe&&!universe.validBridgeFacts({...stock,symbol:stock.code||stock.symbol}));
    let status=incomplete?'unavailable':raw==='fresh'?'current':raw==='stale'?'stale':raw==='unavailable'?'unavailable':'unknown';
    if(status==='current'&&age!=='fresh')status=age;
    if(conflict||!consistent||bridgeInvalid||raw==='anomaly'||age==='anomaly'||options.consistent===false)status='anomaly';
    return {status,ready:status==='current',technicalAsOf:asOf,latestCompleteBar:latest,historyLastDate:history,conflict,incomplete,ageStatus:age,ageInBusinessDays:asOf?businessDays(asOf,marketDate(options.referenceDate||options.reviewDate||options.now||new Date())):NaN};
  }
  return Object.freeze({dateOnly,marketDate,ageStatus,evaluateTechnicalFreshness:evaluate});
});
