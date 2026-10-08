/* Dedicated projection of server-verified immutable migrations. No ordinary guard bypass. */
(function(root){
 'use strict';
 const VERSION='approved-provider-migration-v1',FIELDS=['priceHistory','marketDataFreshness','technicalIndicators','technicalData'];
 const clone=x=>structuredClone(x),sha=x=>typeof x==='string'&&/^[a-f0-9]{64}$/.test(x);
 const stable=x=>JSON.stringify(sort(x));
 function sort(x){if(Array.isArray(x))return x.map(sort);if(x&&typeof x==='object')return Object.fromEntries(Object.keys(x).sort().map(k=>[k,sort(x[k])]));return x}
 const facts=s=>Object.fromEntries(FIELDS.map(k=>[k,clone(Object.hasOwn(s,k)?s[k]:(k==='priceHistory'?[]:{}))]));
 const canonical=()=>root.MarketDataCanonical||(typeof require==='function'?require('./market-data-canonical.js'):null);
 async function baselineMatches(c,stock,expected){
  if(c.candidate?.schemaVersion!==4)return stable(facts(stock))===stable(expected);
  const K=canonical(),b=c.candidate.baselineBinding;
  if(!K||b?.canonicalSerializationVersion!==K.VERSION||b.legacyBaseHash!==c.expectedCurrentVersion||b.expectedCurrentVersion!==c.expectedCurrentVersion||await K.factsHash(c.baseBundle)!==b.canonicalContentHash)throw Error('canonical_baseline_binding_mismatch');
  if(c.canonicalSerializationVersion!==K.VERSION||await K.factsHash(c.bundle)!==c.currentCanonicalHash||await K.factsHash(c.previousBundle)!==c.previousCanonicalHash)throw Error('canonical_transport_precision_mismatch');
  return await K.factsHash(facts(stock))===await K.factsHash(expected);
 }
 function verify(c,owner,symbol){
  if(!c)return null;
  if(c.protocol!==VERSION||c.guardVersion!==VERSION||c.owner!==owner||c.symbol!==symbol||!Number.isSafeInteger(c.generation)||c.generation<0||!sha(c.currentVersion)||!sha(c.expectedCurrentVersion)||!['staged','approved','applied','rolled_back','superseded'].includes(c.status)||['candidateHash','contentHash','approvalPackageHash'].some(k=>!sha(c[k])))throw Error('migration_context_invalid');
  if(!c.bundle)return c;
  if(!['applied','rolled_back'].includes(c.status)||!c.approvalId||!c.approvedAt||!c.appliedAt||!c.previousVersion||!c.previousBundle||c.generation<1||Object.keys(c.bundle).sort().join(',')!==FIELDS.slice().sort().join(','))throw Error('migration_context_invalid');
  const b=c.bundle,rows=b.priceHistory;
  if(!Array.isArray(rows)||!rows.length||rows.length>3000)throw Error('migration_bundle_invalid');
  let prev='';for(const r of rows){if(!/^\d{4}-\d{2}-\d{2}$/.test(r.date)||r.date<=prev||r.is_complete_bar!==true||['open','high','low','close'].some(k=>!Number.isFinite(r[k])||r[k]<=0)||r.high<Math.max(r.open,r.close,r.low)||r.low>Math.min(r.open,r.close)||r.adjustment!=='qfq'||r.price_basis!=='adjusted')throw Error('migration_bundle_invalid');prev=r.date}
  if(c.status==='applied'){
   if(c.currentVersion!==c.candidateHash||c.previousVersion!==c.expectedCurrentVersion||stable(b.marketDataFreshness.sourceContract)!==stable(c.targetSourceContract)||rows.some(r=>r.provider!==c.targetSourceContract.canonicalProvider))throw Error('migration_contract_invalid');
   const tv=b.marketDataFreshness.technicalVersion;if(!sha(tv))throw Error('migration_versions_invalid');
   for(const k of FIELDS.slice(1))if(b[k].dataContentVersion!==c.contentHash||b[k].technicalVersion!==tv||b[k].latestCompleteBar!==prev)throw Error('migration_versions_invalid');
  }else if(c.currentVersion!==c.expectedCurrentVersion||stable(b)!==stable(c.baseBundle))throw Error('migration_rollback_invalid');
  return c;
 }
 function exact(c){return Object.fromEntries(['migrationId','symbol','candidateHash','contentHash','approvalPackageHash','expectedCurrentVersion','expectedGeneration','guardVersion','approvalId'].map(k=>[k,c[k]]))}
 function create({rpc,user,getState,persist,adopt,changed=()=>{}}){
  let pending=false;
  async function read(symbol,action='current'){const owner=await user();if(!owner)return null;const c=await rpc(action,{symbol});if(await user()!==owner)throw Error('account_changed');return verify(c,owner,symbol)}
  async function sync(symbol){
   if(pending)return null;pending=true;
   try{
    const c=await read(symbol);if(!c?.bundle)return c;
    const original=getState(),index=original.stocks.findIndex(s=>(root.SymbolIdentity?.canonicalMarketSymbol(s.code||s.symbol)||s.code||s.symbol)===symbol);
    if(index<0)return c;
    const stock=original.stocks[index],local=stock.marketMigration;
    if(local?.owner===c.owner&&local.generation>=c.generation)return c;
    const expected=c.status==='rolled_back'?c.previousBundle:c.baseBundle;
    if(!await baselineMatches(c,stock,expected))throw Error('migration_local_version_conflict');
    const next=clone(original),target=next.stocks[index];
    for(const key of FIELDS)target[key]=clone(c.bundle[key]);
    target.marketMigration={owner:c.owner,migrationId:c.migrationId,version:c.currentVersion,previousVersion:c.previousVersion,generation:c.generation,status:c.status,approvalId:c.approvalId,previousSnapshot:clone(c.previousBundle),previousReview:clone(stock.marketRevisionReview??null)};
    if(c.status==='applied'&&target.marketRevisionReview)target.marketRevisionReview={...target.marketRevisionReview,status:'resolved_by_approved_migration',migrationId:c.migrationId};
    if(c.status==='rolled_back'){
     if(local?.previousReview)target.marketRevisionReview=clone(local.previousReview);else delete target.marketRevisionReview;
    }
    next.updatedAt=Math.max(Date.now(),(Number(original.updatedAt)||0)+1);
    const matches=await baselineMatches(c,getState().stocks[index],expected);
    // Hashing awaits WebCrypto; recheck identity and facts after the last await.
    if(await user()!==c.owner||getState()!==original||!matches||stable(facts(getState().stocks[index]))!==stable(expected))throw Error('migration_local_version_conflict');
    // Persistence receives a detached complete state. It must commit before UI adoption.
    await persist(next,original,c.owner);
    adopt(next);changed(c);return c;
   }finally{pending=false}
  }
  async function command(action,c,extra={}){
   const owner=await user();if(owner!==c.owner)throw Error('account_changed');
   const value=await rpc(action,{...exact(c),...extra});
   if(await user()!==owner)throw Error('account_changed');return verify(value,owner,c.symbol);
  }
  return {read,sync,command};
 }
 const api={VERSION,create,verify,facts,exact,stable};
 if(typeof module!=='undefined'&&module.exports)module.exports=api;root.ApprovedMarketMigration=api;
})(typeof window==='undefined'?globalThis:window);
