(function(root,factory){
  const api=factory(root);
  if(typeof module==='object'&&module.exports)module.exports=api;
  if(root)root.UniverseHandoff=Object.freeze(api);
})(typeof globalThis!=='undefined'?globalThis:this,function(root){
  'use strict';

  const SCHEMA_VERSION=1;
  const CHECKSUM_ALGORITHM='SHA-256';
  const FILE_PREFIX='investment-workbench-universe';

  function identity(){
    if(root&&root.SymbolIdentity)return root.SymbolIdentity;
    if(typeof require==='function')return require('./symbol-identity.js');
    throw new Error('SymbolIdentity is unavailable.');
  }

  function canonical(value){return identity().canonicalMarketSymbol(value)}
  function isCash(stock){return String(stock&&stock.role||'').trim()==='现金'||String(stock&&stock.theme||'').trim()==='现金'}
  function stockSymbol(stock){return canonical(stock&&(stock.code||stock.symbol))}
  function isoNow(now){return (now instanceof Date?now:new Date(now||Date.now())).toISOString()}
  function text(value){return String(value??'').trim()}

  function universeRows(stocks){
    const bySymbol=new Map();
    (Array.isArray(stocks)?stocks:[]).forEach(stock=>{
      if(!stock||isCash(stock))return;
      const symbol=stockSymbol(stock);
      if(!symbol)return;
      const displayName=text(stock.name);
      if(!bySymbol.has(symbol)||(!bySymbol.get(symbol).displayName&&displayName)){
        bySymbol.set(symbol,{symbol,active:true,...(displayName?{displayName}:{})});
      }
    });
    return [...bySymbol.values()].sort((a,b)=>a.symbol.localeCompare(b.symbol,'en'));
  }

  function validBridgeFacts(stock){
    if(!stock||!canonical(stock.symbol))return false;
    const history=Array.isArray(stock.priceHistory)?stock.priceHistory:[];
    const complete=history.filter(bar=>bar&&bar.is_complete_bar===true&&/^\d{4}-\d{2}-\d{2}$/.test(String(bar.date||''))&&Number.isFinite(Number(bar.close)));
    if(!complete.length)return false;
    const latest=complete.map(bar=>String(bar.date)).sort().at(-1);
    const freshness=stock.marketDataFreshness&&typeof stock.marketDataFreshness==='object'?stock.marketDataFreshness:{};
    const indicators=stock.technicalIndicators&&typeof stock.technicalIndicators==='object'?stock.technicalIndicators:{};
    return freshness.last_trade_date===latest&&freshness.is_complete_bar===true&&indicators.last_trade_date===latest;
  }

  function acknowledgedSymbols(bridge){
    const set=new Set();
    (bridge&&Array.isArray(bridge.stocks)?bridge.stocks:[]).forEach(stock=>{
      const symbol=canonical(stock&&stock.symbol);
      if(symbol&&validBridgeFacts(stock))set.add(symbol);
    });
    return set;
  }

  function normalizeSyncState(value){
    const source=value&&typeof value==='object'&&!Array.isArray(value)?value:{};
    const pending=[...new Set((Array.isArray(source.pendingSymbols)?source.pendingSymbols:[]).map(canonical).filter(Boolean))].sort();
    const manifest=source.manifest&&typeof source.manifest==='object'&&!Array.isArray(source.manifest)?source.manifest:{};
    return {
      schemaVersion:SCHEMA_VERSION,
      pendingSymbols:pending,
      manifest:{
        fingerprint:text(manifest.fingerprint),
        revision:Number.isSafeInteger(manifest.revision)&&manifest.revision>0?manifest.revision:0,
        generatedAt:text(manifest.generatedAt),
        checksum:text(manifest.checksum),
        lastHandoffAt:text(manifest.lastHandoffAt)
      }
    };
  }

  function rowFingerprint(rows){return JSON.stringify(rows.map(row=>[row.symbol,row.displayName||'']))}

  function ensureManifestSnapshot(state,now){
    const rows=universeRows(state&&state.stocks);
    const sync=normalizeSyncState(state&&state.universeSync);
    const fingerprint=rowFingerprint(rows);
    if(sync.manifest.fingerprint!==fingerprint){
      sync.manifest.fingerprint=fingerprint;
      sync.manifest.revision=Math.max(1,sync.manifest.revision+1);
      sync.manifest.generatedAt=isoNow(now);
      sync.manifest.checksum='';
      sync.manifest.lastHandoffAt='';
    }else if(!sync.manifest.generatedAt){
      sync.manifest.generatedAt=isoNow(now);
      sync.manifest.revision=Math.max(1,sync.manifest.revision);
    }
    state.universeSync=sync;
    return {sync,rows};
  }

  function reconcileState(state,bridge,options={}){
    if(!state||typeof state!=='object')throw new Error('State must be an object.');
    const before=JSON.stringify(normalizeSyncState(state.universeSync));
    const {sync,rows}=ensureManifestSnapshot(state,options.now);
    const acknowledged=acknowledgedSymbols(bridge);
    sync.pendingSymbols=rows.map(row=>row.symbol).filter(symbol=>!acknowledged.has(symbol));
    state.universeSync=sync;
    return {
      changed:before!==JSON.stringify(sync),
      pendingSymbols:[...sync.pendingSymbols],
      acknowledgedSymbols:rows.map(row=>row.symbol).filter(symbol=>acknowledged.has(symbol)),
      invalidStockCount:invalidStockCount(state)
    };
  }

  function markPending(state,value,options={}){
    const symbol=canonical(value);
    if(!symbol)throw new Error('仅支持 6 位 A 股代码（.SS/.SZ）或有效港股代码（.HK）。');
    const {sync}=ensureManifestSnapshot(state,options.now);
    sync.pendingSymbols=[...new Set([...sync.pendingSymbols,symbol])].sort();
    state.universeSync=sync;
    return symbol;
  }

  function stableManifestPayload(state,now){
    const {sync,rows}=ensureManifestSnapshot(state,now);
    return {schemaVersion:SCHEMA_VERSION,generatedAt:sync.manifest.generatedAt,revision:sync.manifest.revision,symbols:rows};
  }

  function canonicalJson(value){
    if(Array.isArray(value))return `[${value.map(canonicalJson).join(',')}]`;
    if(value&&typeof value==='object')return `{${Object.keys(value).sort().map(key=>`${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
    return JSON.stringify(value);
  }

  async function sha256(value){
    const subtle=root&&root.crypto&&root.crypto.subtle;
    if(!subtle)throw new Error('当前浏览器无法生成安全校验值。');
    const bytes=new TextEncoder().encode(value);
    const digest=await subtle.digest('SHA-256',bytes);
    return [...new Uint8Array(digest)].map(byte=>byte.toString(16).padStart(2,'0')).join('');
  }

  async function buildManifest(state,options={}){
    const payload=stableManifestPayload(state,options.now);
    const value=await sha256(canonicalJson(payload));
    state.universeSync.manifest.checksum=value;
    return {...payload,checksum:{algorithm:CHECKSUM_ALGORITHM,value}};
  }

  function manifestFilename(manifest){return `${FILE_PREFIX}-r${String(manifest.revision).padStart(6,'0')}.json`}

  async function shareOrDownloadManifest(manifest,options={}){
    const nav=options.navigator||root.navigator;
    const doc=options.document||root.document;
    const BlobCtor=options.Blob||root.Blob;
    const FileCtor=options.File||root.File;
    const Url=options.URL||root.URL;
    const filename=options.filename||manifestFilename(manifest);
    const content=`${JSON.stringify(manifest,null,2)}\n`;
    const blob=new BlobCtor([content],{type:'application/json'});
    if(nav&&typeof nav.share==='function'&&FileCtor){
      const file=new FileCtor([blob],filename,{type:'application/json'});
      if(typeof nav.canShare!=='function'||nav.canShare({files:[file]})){
        try{await nav.share({files:[file],title:'股票同步',text:'请保存到 OneDrive 的 investment-workbench-mobile-sync/inbox 文件夹。'});return {method:'share',filename,content}}
        catch(error){if(error&&error.name==='AbortError')return {method:'cancelled',filename,content}}
      }
    }
    if(!doc||!Url||typeof Url.createObjectURL!=='function')throw new Error('当前环境无法分享或下载同步文件。');
    const href=Url.createObjectURL(blob);
    const anchor=doc.createElement('a');
    anchor.href=href;anchor.download=filename;anchor.style.display='none';
    (doc.body||doc.documentElement).appendChild(anchor);anchor.click();anchor.remove();
    if(typeof Url.revokeObjectURL==='function')setTimeout(()=>Url.revokeObjectURL(href),0);
    return {method:'download',filename,content};
  }

  function isPending(state,value){const symbol=canonical(value);return Boolean(symbol&&normalizeSyncState(state&&state.universeSync).pendingSymbols.includes(symbol))}
  function pendingCount(state){return normalizeSyncState(state&&state.universeSync).pendingSymbols.length}
  function invalidStockCount(state){return (state&&Array.isArray(state.stocks)?state.stocks:[]).filter(stock=>stock&&!isCash(stock)&&!stockSymbol(stock)).length}

  return {SCHEMA_VERSION,CHECKSUM_ALGORITHM,FILE_PREFIX,canonicalJson,universeRows,validBridgeFacts,acknowledgedSymbols,normalizeSyncState,ensureManifestSnapshot,reconcileState,markPending,buildManifest,manifestFilename,shareOrDownloadManifest,isPending,pendingCount,invalidStockCount};
});
