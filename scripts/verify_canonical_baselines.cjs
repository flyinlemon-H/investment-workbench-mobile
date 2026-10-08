'use strict';
// Read-only cross-language real-baseline check; never writes market facts.
const fs=require('node:fs'),assert=require('node:assert/strict'),K=require('../src/market-data-canonical.js');
(async()=>{const audit=JSON.parse(fs.readFileSync(process.argv[2],'utf8')),results=[];
 for(const entry of audit.results){let text=fs.readFileSync(entry.source,'utf8').replace(/^\uFEFF/,'');if(text.trimStart().startsWith('window.MARKET_DATA_BRIDGE ='))text=text.slice(text.indexOf('=')+1).trim().replace(/;$/,'');const data=K.parse(text),items=data.symbols||data.stocks,match=items.filter(s=>(s.symbol||s.code)===audit.symbol);assert.equal(match.length,1);const stock=match[0].marketFacts||match[0],facts=Object.fromEntries(['priceHistory','technicalData','technicalIndicators','marketDataFreshness'].map(k=>[k,Object.hasOwn(stock,k)?stock[k]:k==='priceHistory'?[]:{}]));const hash=await K.factsHash(facts);assert.equal(hash,entry.canonicalContentHash);assert.equal(hash,audit.expectedCanonicalHash);results.push({source:entry.source,hash,pythonJavaScriptMatch:true})}
 console.log(JSON.stringify({version:K.VERSION,results}));
})().catch(e=>{console.error(e.message);process.exitCode=1});
