/* Trusted daily head receiver. Ordinary import/continuity guards stay strict. */
(function(root){
 'use strict';
 const VERSION='bounded-daily-revision-v1',FIELDS=['priceHistory','technicalIndicators','technicalData','marketDataFreshness'];
 const BARS=['date','open','high','low','close','volume','amount','provider','adjustment','price_basis','is_complete_bar'];
 const TECH=['price','technicalAsOf','ma5','ma10','ma20','ma60','ma120','macd','supportPrice','resistancePrice','volume','volumeAvg20','volumeChangePct'];
 const clone=x=>structuredClone(x),K=()=>root.MarketDataCanonical||(typeof require==='function'?require('./market-data-canonical.js'):null);
 const stable=x=>JSON.stringify(x),facts=s=>Object.fromEntries(FIELDS.map(k=>[k,clone(s[k]??(k==='priceHistory'?[]:{}))]));
 async function identity(b){const m=b.marketDataFreshness||{};return K().hash({bars:b.priceHistory.map(r=>Object.fromEntries(BARS.map(k=>[k,r[k]??null]))),sourceContract:m.sourceContract,
  contentVersion:m.dataContentVersion??null,technicalVersion:m.technicalVersion??null,technical:Object.fromEntries(TECH.map(k=>[k,b.technicalData?.[k]??null]))})}
 async function verify(c,owner){
  if(!c)return null;
  if(c.protocol!==VERSION||c.owner!==owner||c.symbol!=='2899.HK'||!Number.isSafeInteger(c.generation)||c.generation<0||!c.versionId||!Array.isArray(c.ancestors)||!c.ancestors.length||c.ancestors.length>129)throw Error('daily_context_invalid');
  if(await K().factsHash(c.bundle)!==c.bundleHash||await identity(c.bundle)!==c.identityHash||c.ancestors[0].versionId!==c.versionId||c.ancestors[0].identityHash!==c.identityHash)throw Error('daily_transport_hash_mismatch');
  const b=c.bundle,last=b.priceHistory.at(-1).date,m=b.marketDataFreshness;
  if(b.priceHistory.some(r=>r.provider!=='yahoo'||r.adjustment!=='qfq'||r.price_basis!=='adjusted'||r.is_complete_bar!==true)||m.sourceContract.symbol!=='2899.HK'||m.sourceContract.canonicalProvider!=='yahoo'||m.sourceContract.volumeUnit!=='shares'||m.sourceContract.priceUnit!=='HKD/share')throw Error('daily_contract_invalid');
  for(const key of FIELDS.slice(1))if(b[key].latestCompleteBar!==last||b[key].dataContentVersion!==m.dataContentVersion||b[key].technicalVersion!==m.technicalVersion)throw Error('daily_versions_invalid');
  if(b.technicalData.aiJudgmentStatus!=='needs_review')throw Error('daily_judgment_invalid');
  return c;
 }
 function create({rpc,user,getState,persist,adopt,changed=()=>{}}){
  let pending=null;
  async function read(symbol){if(symbol!=='2899.HK')return null;const owner=await user();if(!owner)return null;
   const c=await verify(await rpc(symbol),owner);if(await user()!==owner)throw Error('account_changed');return c}
  async function sync(symbol){
   if(symbol!=='2899.HK')return null;
   if(pending)return pending;
   pending=(async()=>{
    const c=await read(symbol);if(!c)return null;
    const original=getState(),snapshot=stable(original),index=original.stocks.findIndex(s=>(root.SymbolIdentity?.canonicalMarketSymbol(s.code||s.symbol)||s.code||s.symbol)===symbol);
    if(index<0)return c;
    const stock=original.stocks[index],local=facts(stock),hash=await identity(local);
    if(stock.marketDailyReceipt?.owner===c.owner&&stock.marketDailyReceipt.generation>c.generation)throw Error('daily_remote_generation_conflict');
    if(!c.ancestors.some(a=>a.identityHash===hash))throw Error('daily_local_version_conflict');
    if(hash===c.identityHash&&stock.marketDailyReceipt?.versionId===c.versionId){changed(c);return c}
    const next=clone(original),target=next.stocks[index];
    for(const key of FIELDS)target[key]=clone(c.bundle[key]);
    // A verifiable local recovery point is persisted atomically with the new facts.
    target.marketDailyReceipt={owner:c.owner,versionId:c.versionId,generation:c.generation,identityHash:c.identityHash,
     previousId:c.previousId,previousLocalSnapshot:local,previousLocalHash:await K().factsHash(local),receipt:clone(c.receipt)};
    if(target.marketRevisionReview)target.marketRevisionReview={...target.marketRevisionReview,status:'resolved_by_daily_receipt',dailyVersion:c.versionId};
    next.updatedAt=Math.max(Date.now(),Number(original.updatedAt||0)+1);
    if(await user()!==c.owner||getState()!==original||stable(getState())!==snapshot)throw Error('daily_local_version_conflict');
    await persist(next,original,c.owner);adopt(next);changed(c);return c;
   })().finally(()=>{pending=null});return pending;
  }
  return {read,sync};
 }
 const api={VERSION,create,verify,identity,facts};if(typeof module!=='undefined'&&module.exports)module.exports=api;root.MarketDataDailyReceiver=api;
})(typeof window==='undefined'?globalThis:window);
