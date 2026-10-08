/* MARKET_DATA_CANONICAL_SERIALIZATION_V1. Hashes are evidence, never authority. */
(function(root){
 'use strict';
 const VERSION='MARKET_DATA_CANONICAL_SERIALIZATION_V1',SAFE=Number.MAX_SAFE_INTEGER;
 const tokens=new WeakMap();
 class ExactNumber{constructor(text){number(text);tokens.set(this,text);Object.freeze(this)}}
 function number(text){
  if(text.length>2048||! /^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?$/.test(text))throw Error('canonical_invalid_number');
  let [mantissa,exponent='0']=text.toLowerCase().split('e'),negative=mantissa.startsWith('-');if(negative)mantissa=mantissa.slice(1);
  let [whole,fraction='']=mantissa.split('.'),e=Number(exponent)-fraction.length,c=(whole+fraction).replace(/^0+/,'');
  if(!Number.isSafeInteger(e)||Math.abs(e)>10000||c.length>1024)throw Error('canonical_number_limit');
  if(!c)return 'd0e0';while(c.endsWith('0')){c=c.slice(0,-1);e++}
  return 'd'+(negative?'-':'')+c+'e'+e;
 }
 function hex(s){
  for(let i=0;i<s.length;i++){const x=s.charCodeAt(i);if(x>=0xd800&&x<=0xdbff){const y=s.charCodeAt(++i);if(!(y>=0xdc00&&y<=0xdfff))throw Error('canonical_invalid_unicode')}else if(x>=0xdc00&&x<=0xdfff)throw Error('canonical_invalid_unicode')}
  return Array.from(new TextEncoder().encode(s),x=>x.toString(16).padStart(2,'0')).join('');
 }
 function encode(x,depth=0){
  if(depth>64)throw Error('canonical_depth_limit');
  if(x===null)return 'n';if(x===true)return 't';if(x===false)return 'f';
  if(typeof x==='string')return 's'+hex(x);
  if(typeof x==='number'){if(!Number.isFinite(x))throw Error('canonical_nonfinite');if(Number.isInteger(x)&&Math.abs(x)>SAFE)throw Error('canonical_unsafe_number_use_lossless_json');return number(String(x))}
  if(tokens.has(x))return number(tokens.get(x));
  if(Array.isArray(x)){if(Object.keys(x).length!==x.length)throw Error('canonical_sparse_array');return '['+x.map(v=>encode(v,depth+1)).join(',')+']'}
  if(x&&Object.getPrototypeOf(x)!==null&&Object.getPrototypeOf(x)!==Object.prototype)throw Error('canonical_unsupported_type');
  if(x&&typeof x==='object')return '{'+Object.keys(x).sort((a,b)=>hex(a)<hex(b)?-1:hex(a)>hex(b)?1:0).map(k=>'s'+hex(k)+':'+encode(x[k],depth+1)).join(',')+'}';
  throw Error('canonical_unsupported_type');
 }
 function parse(text){
  if(typeof text!=='string'||text.length>12000000)throw Error('canonical_size_limit');let i=0;
  function ws(){while(/[\x20\t\r\n]/.test(text[i]||'!'))i++}
  function value(depth=0){
   if(depth>64)throw Error('canonical_depth_limit');ws();const ch=text[i];
   if(ch==='"'){const start=i++;while(i<text.length){if(text[i]==='\\'){i+=2;continue}if(text[i++]==='"'){const s=JSON.parse(text.slice(start,i));hex(s);return s}}throw Error('canonical_json')}
   if(ch==='{'||ch==='['){i++;const object=ch==='{',out=object?Object.create(null):[],end=object?'}':']';ws();if(text[i]===end){i++;return out}while(true){ws();if(object){if(text[i]!=='"')throw Error('canonical_json');const k=value(depth+1);if(Object.hasOwn(out,k))throw Error('canonical_duplicate_key');ws();if(text[i++]!==':')throw Error('canonical_json');out[k]=value(depth+1)}else out.push(value(depth+1));ws();if(text[i]===end){i++;return out}if(text[i++]!==',')throw Error('canonical_json')}}
   for(const [s,v] of [['null',null],['true',true],['false',false]])if(text.startsWith(s,i)){i+=s.length;return v}
   const m=text.slice(i).match(/^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?/);if(!m)throw Error('canonical_json');i+=m[0].length;return new ExactNumber(m[0]);
  }
  const result=value();ws();if(i!==text.length)throw Error('canonical_json');return result;
 }
 async function hash(value){const bytes=new TextEncoder().encode(VERSION+'\n'+encode(value));const crypto=root.crypto||(typeof require==='function'?require('node:crypto').webcrypto:null);return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),x=>x.toString(16).padStart(2,'0')).join('')}
 function facts(stock){
  const fields=['priceHistory','technicalIndicators','technicalData','marketDataFreshness'];
  if(!stock||Object.keys(stock).sort().join()!==fields.sort().join())throw Error('canonical_fact_fields');
  const rows=stock.priceHistory;if(!Array.isArray(rows)||!rows.length||rows.length>3000)throw Error('canonical_bars');let prior='';
  for(const row of rows){const d=row.date;if(typeof d!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(d)||d.startsWith('0000')||!Number.isFinite(Date.parse(d+'T00:00:00Z'))||new Date(d+'T00:00:00Z').toISOString().slice(0,10)!==d||d<=prior)throw Error('canonical_bar_order_or_date');prior=d}return stock;
 }
 const api={VERSION,encode,parse,hash,facts,factsHash:stock=>hash(facts(stock))};
 if(typeof module!=='undefined'&&module.exports)module.exports=api;root.MarketDataCanonical=api;
})(typeof window==='undefined'?globalThis:window);
