function normalizeQuoteCode(code){
  return String(code||'').trim().toUpperCase();
}
function codeKind(code){
  const c=normalizeQuoteCode(code);
  if(/^\d{1,5}\.HK$/.test(c))return 'hk';
  if(/^\d{6}\.(SS|SZ)$/.test(c))return 'cn';
  if(/^[A-Z.]{1,10}$/.test(c))return 'us';
  return 'unknown';
}
function validateQuoteCode(code,type){
  const c=normalizeQuoteCode(code);
  if(!c)return {ok:false,reason:'缺少行情代码'};
  if(type==='etf'){
    if(/^(5\d{5}|1[568]\d{4})\.(SS|SZ)$/.test(c))return {ok:true,kind:'etf-cn'};
    if(/^\d{4,5}\.HK$/.test(c))return {ok:true,kind:'etf-hk'};
    return {ok:false,reason:'ETF 代码格式不正确：A股ETF请用 510300.SS / 159915.SZ，港股ETF请用 2800.HK。'};
  }
  if(/^\d{1,5}\.HK$/.test(c))return {ok:true,kind:'hk'};
  if(/^\d{6}\.SS$/.test(c)||/^\d{6}\.SZ$/.test(c))return {ok:true,kind:'cn'};
  if(/^[A-Z.]{1,10}$/.test(c))return {ok:true,kind:'us'};
  return {ok:false,reason:'行情代码格式不正确：港股如 1810.HK，A股如 601138.SS / 000001.SZ，ETF如 510300.SS。'};
}
function sourceErrorMessage(source,err){
  return `${source}: ${err&&err.message?err.message:err}`;
}
function formatSourceErrors(errors){
  if(!errors||!errors.length)return '无详细错误';
  return errors.map(x=>`- ${x}`).join('\n');
}
function cachePriceHistoryFromRefresh(stock,price,date){
  const p=Number(price);
  if(!stock||!(p>0))return false;
  const d=normalizePriceDate(date||new Date().toISOString().slice(0,10));
  if(!d)return false;
  stock.priceHistory=normalizePriceHistory([...(Array.isArray(stock.priceHistory)?stock.priceHistory:[]),{date:d,close:p}]);
  if(typeof updateTechnicalDataFromPriceHistory==='function')updateTechnicalDataFromPriceHistory(stock);
  return true;
}
async function fetchJsonWithFallback(url){
  const endpoints=[
    {name:'直接请求',url},
    {name:'corsproxy.io',url:`https://corsproxy.io/?${encodeURIComponent(url)}`},
    {name:'codetabs',url:`https://api.codetabs.com/v1/proxy/?quest=${encodeURIComponent(url)}`},
    {name:'AllOrigins',url:`https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`},
    {name:'thingproxy',url:`https://thingproxy.freeboard.io/fetch/${url}`}
  ];
  const errors=[];
  for(const ep of endpoints){
    const ctrl=new AbortController();
    const timer=setTimeout(()=>ctrl.abort(),8000);
    try{
      const res=await fetch(ep.url,{cache:'no-store',signal:ctrl.signal});
      clearTimeout(timer);
      if(!res.ok)throw new Error(`HTTP ${res.status}`);
      const txt=await res.text();
      let data;
      try{data=JSON.parse(txt)}catch(_){throw new Error('返回内容不是 JSON')}
      return {data,via:ep.name};
    }catch(err){
      clearTimeout(timer);
      const reason=err.name==='AbortError'?'超时':err.message;
      errors.push(`${ep.name}: ${reason}`);
    }
  }
  const e=new Error(`全部 ${endpoints.length} 个代理渠道均失败`);
  e.sourceErrors=errors;
  throw e;
}
function toEastMoneyCode(code){
  const clean=normalizeQuoteCode(code);
  if(!clean)return null;
  if(clean.endsWith('.SS'))return '1.'+clean.slice(0,-3);
  if(clean.endsWith('.SZ'))return '0.'+clean.slice(0,-3);
  if(clean.endsWith('.HK'))return '116.'+clean.slice(0,-3).padStart(5,'0');
  if(/^[A-Z]+$/.test(clean))return '105.'+clean;
  if(/^[56]/.test(clean))return '1.'+clean;
  if(/^(0|1|3|159|16)/.test(clean))return '0.'+clean;
  return null;
}
function extractEastMoneyPrice(data){
  if(!data||!data.data)return null;
  const d=data.data;
  let raw=d.f43;
  if(typeof raw!=='number'||raw<=0||isNaN(raw))raw=d.f60;
  if(typeof raw!=='number'||raw<=0||isNaN(raw))return null;
  const price=Number(raw.toFixed(4));
  const change=(typeof d.f170==='number'&&!isNaN(d.f170))?Number(d.f170.toFixed(2)):null;
  return {price,change};
}
function fetchEastMoneyViaJsonp(url){
  return new Promise((resolve,reject)=>{
    const cb='emcb_'+Date.now()+'_'+Math.floor(Math.random()*10000);
    const script=document.createElement('script');
    const timer=setTimeout(()=>{cleanup();reject(new Error('JSONP 超时'))},8000);
    function cleanup(){clearTimeout(timer);try{delete window[cb]}catch(_){window[cb]=undefined}if(script.parentNode)script.parentNode.removeChild(script)}
    window[cb]=(data)=>{cleanup();const r=extractEastMoneyPrice(data);if(r===null){const snip=JSON.stringify(data||{}).slice(0,250);console.warn('[东财] 响应解析失败:',data);reject(new Error('JSONP 无有效价格 | '+snip))}else{resolve(r)}};
    script.onerror=()=>{cleanup();reject(new Error('JSONP 脚本加载失败'))};
    script.src=url+'&cb='+cb;
    document.body.appendChild(script);
  });
}
async function fetchFromEastMoney(code){
  const emCode=toEastMoneyCode(code);
  if(!emCode)throw new Error('代码格式无法识别为东方财富 secid');
  const url=`https://push2.eastmoney.com/api/qt/stock/get?secid=${emCode}&fields=f43,f44,f45,f46,f47,f48,f57,f58,f60,f168,f170&fltt=2&invt=2&ut=fa5fd1943c7b386f172d6893dbfba10b`;
  const errors=[];
  try{
    const ctrl=new AbortController();
    const timer=setTimeout(()=>ctrl.abort(),6000);
    const res=await fetch(url,{cache:'no-store',signal:ctrl.signal});
    clearTimeout(timer);
    if(!res.ok)throw new Error(`HTTP ${res.status}`);
    const data=await res.json();
    const r=extractEastMoneyPrice(data);
    if(r!==null)return {price:r.price,change:r.change,updatedAt:new Date().toISOString().slice(0,10),source:'东方财富·直连'};
    throw new Error('响应中没有有效价格');
  }catch(err){
    errors.push(sourceErrorMessage('东方财富直连',err));
  }
  try{
    const r=await fetchEastMoneyViaJsonp(url);
    return {price:r.price,change:r.change,updatedAt:new Date().toISOString().slice(0,10),source:'东方财富·JSONP'};
  }catch(err){
    errors.push(sourceErrorMessage('东方财富JSONP',err));
  }
  const e=new Error('东方财富全部通道失败');
  e.sourceErrors=errors;
  throw e;
}
async function fetchFromYahoo(code){
  const clean=normalizeQuoteCode(code);
  if(!clean)throw new Error('缺少行情代码');
  const yahooUrl=`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(clean)}?interval=1d&range=1d`;
  try{
    const {data,via}=await fetchJsonWithFallback(yahooUrl);
    const result=data?.chart?.result?.[0];
    const meta=result?.meta||{};
    const quote=result?.indicators?.quote?.[0]||{};
    const closes=Array.isArray(quote.close)?quote.close.filter(v=>v!==null&&v!==undefined&&!isNaN(Number(v))):[];
    const price=meta.regularMarketPrice ?? closes[closes.length-1] ?? meta.previousClose;
    if(price===undefined||price===null||isNaN(Number(price)))throw new Error('未获取到有效价格');
    const prev=meta.chartPreviousClose ?? meta.previousClose;
    const change=(typeof prev==='number'&&typeof price==='number'&&prev>0)?Number(((price-prev)/prev*100).toFixed(2)):null;
    return {price:Number(price),change,updatedAt:new Date().toISOString().slice(0,10),source:`Yahoo·${via}`};
  }catch(err){
    if(err.sourceErrors)err.sourceErrors=err.sourceErrors.map(x=>`Yahoo ${x}`);
    throw err;
  }
}
async function fetchStockPrice(code,type){
  const valid=validateQuoteCode(code,type);
  if(!valid.ok){
    const e=new Error(valid.reason);
    e.sourceErrors=[`格式校验: ${valid.reason}`];
    throw e;
  }
  const errs=[];
  try{return await fetchFromEastMoney(code)}catch(e){errs.push(...(e.sourceErrors||[sourceErrorMessage('东方财富',e)]))}
  try{return await fetchFromYahoo(code)}catch(e){errs.push(...(e.sourceErrors||[sourceErrorMessage('Yahoo',e)]))}
  const err=new Error('所有数据源均失败');
  err.sourceErrors=errs;
  throw err;
}
async function refreshOnePrice(id,opts={}){
  const s=state.stocks.find(x=>x.id===id);
  if(!s)return {ok:false,name:'未知标的',errors:['标的不存在']};
  const isEtf=s.type==='etf';
  const fail=(msg,errors=[msg])=>{if(!opts.silent)alert(msg);return {ok:false,name:s.name,errors}};
  if(isCashRow(s))return fail(`「${s.name}」为现金台账，请通过「编辑」手动维护当前市值。`);
  if(!s.code)return fail(`请先给「${s.name}」填写行情代码。`);
  const valid=validateQuoteCode(s.code,s.type);
  if(!valid.ok)return fail(`${s.name} 行情代码校验失败：\n${valid.reason}`,[`格式校验: ${valid.reason}`]);
  if(isEtf){
    const shares=Number(s.shares);
    if(isNaN(shares)||shares<=0)return fail(`「${s.name}」没有填写份额，无法用单价计算市值。请先到编辑界面补充份额。`);
  }
  try{
    s.syncStatus='updating';saveState();render();
    const r=await fetchStockPrice(s.code,s.type);
    if(isEtf){
      const shares=Number(s.shares);
      s.currentValue=Number((r.price*shares).toFixed(2));
      s.valueUpdatedAt=r.updatedAt;
      s.priceSource=r.source;
      s.lastUnitPrice=r.price;
      s.dailyChange=r.change;
    }else{
      s.currentPrice=r.price;
      s.priceUpdatedAt=r.updatedAt;
      s.priceSource=r.source;
      s.dailyChange=r.change;
    }
    if(cachePriceHistoryFromRefresh(s,r.price,r.updatedAt))touchDataFreshness(s,'technicalUpdatedAt',r.updatedAt);
    touchDataFreshness(s,'priceUpdatedAt',r.updatedAt);
    s.syncStatus='success';
    saveState();render();
    return {ok:true,name:s.name,source:r.source,price:r.price};
  }catch(err){
    const errors=err.sourceErrors||[err.message||String(err)];
    s.syncStatus='failed';s.lastSyncError=errors.join('\n');saveState();render();
    if(!opts.silent)alert(`${s.name} ${isEtf?'市值':'价格'}刷新失败，已保留原值。\n\n失败原因：\n${formatSourceErrors(errors)}`);
    return {ok:false,name:s.name,errors};
  }
}
function wait(ms){return new Promise(resolve=>setTimeout(resolve,ms))}
async function fetchFxRate(silent){
  const btn=document.getElementById('fxBtn');
  if(btn)btn.textContent='汇率刷新中...';
  try{
    const r=await fetchFromYahoo('HKDCNY=X');
    const rate=Number(Number(r.price).toFixed(4));
    if(!(rate>0)||rate>2)throw new Error('返回汇率数值异常 '+r.price);
    state.fx={hkdcny:rate,updatedAt:r.updatedAt,source:r.source};
    saveState();render();
    return true;
  }catch(err){
    render();
    const errors=err.sourceErrors||[err.message||String(err)];
    if(!silent)alert('HKD→CNY 汇率联网获取失败，仍使用原汇率 '+fxHKD()+'。\n\n原因：\n'+formatSourceErrors(errors)+'\n\n可点击「汇率」按钮手动输入。');
    return false;
  }
}
async function onFxClick(){
  const f=state.fx||{};
  const input=prompt(`HKD→CNY 汇率\n当前：${fxHKD()}（${f.source||'默认'}${f.updatedAt?' · '+f.updatedAt:''}）\n\n· 输入新汇率后点确定 = 手动设置\n· 留空直接点确定 = 联网自动获取`,'');
  if(input===null)return;
  const t=String(input).trim();
  if(t===''){await fetchFxRate(false);return}
  const v=Number(t);
  if(isNaN(v)||v<=0||v>2)return alert('汇率数值不合理，请输入 0~2 之间的数字，例如 0.92。');
  state.fx={hkdcny:Number(v.toFixed(4)),updatedAt:new Date().toISOString().slice(0,10),source:'手动'};
  saveState();render();
}
async function refreshAllPrices(){
  const targets=state.stocks.filter(s=>s.code&&!isCashRow(s));
  if(!targets.length)return alert('没有可刷新的行情代码。');
  if(state.stocks.some(s=>getCurrency(s)==='HKD'))await fetchFxRate(true);
  const results=[];
  for(const s of targets){
    const r=await refreshOnePrice(s.id,{silent:true});
    results.push(r);
    await wait(500);
  }
  const ok=results.filter(r=>r.ok);
  const fail=results.filter(r=>!r.ok);
  const failedText=fail.length?'\n\n失败明细：\n'+fail.map(r=>`- ${r.name}: ${(r.errors||[]).join('；')}`).join('\n'):'';
  alert(`刷新完成：成功 ${ok.length} 个，失败 ${fail.length} 个。${failedText}`);
}
async function testQuoteCode(){
  const code=document.getElementById('fCode').value.trim();
  const type=formType;
  const valid=validateQuoteCode(code,type);
  if(!valid.ok)return alert('行情代码校验失败：\n'+valid.reason);
  try{
    const r=await fetchStockPrice(code,type);
    alert(`行情代码可用。\n\n代码：${normalizeQuoteCode(code)}\n来源：${r.source}\n价格：${r.price}\n日期：${r.updatedAt}`);
  }catch(err){
    alert(`行情代码格式通过，但测试获取失败。\n\n失败原因：\n${formatSourceErrors(err.sourceErrors||[err.message||String(err)])}`);
  }
}
