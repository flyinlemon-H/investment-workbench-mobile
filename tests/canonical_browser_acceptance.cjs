'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const url=process.env.CLARITY_URL||'http://127.0.0.1:8778/',output=path.resolve('.rebase/canonical-hash-v1/canonical-viewports');
(async()=>{fs.mkdirSync(output,{recursive:true});const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_EXECUTABLE||undefined}),results=[];
 try{for(const width of [360,390,1280]){const context=await browser.newContext({viewport:{width,height:900}}),page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));await context.route('**/*',r=>new URL(r.request().url()).origin===new URL(url).origin?r.continue():r.abort());await page.goto(url+'provider-rebase-review.html');
  const cap=JSON.parse(fs.readFileSync('.rebase/approved-migration-delivery/fixture-9999.HK.json','utf8')),c=JSON.parse(cap.candidate);c.candidateHash=crypto.createHash('sha256').update(cap.candidate).digest('hex');c.candidateId='rebase_'+c.candidateHash;
  await page.locator('#candidate-file').setInputFiles({name:'synthetic-canonical.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(c))});await page.getByText('canonicalSerializationVersion',{exact:true}).waitFor();
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);assert.match(await page.locator('#review-content').innerText(),/MARKET_DATA_CANONICAL_SERIALIZATION_V1/);assert.deepEqual(errors,[]);
  const hashes=await page.evaluate(async()=>[await MarketDataCanonical.hash(MarketDataCanonical.parse('33219061')),await MarketDataCanonical.hash(MarketDataCanonical.parse('33219061.0')),await MarketDataCanonical.hash(MarketDataCanonical.parse('33219062'))]);assert.equal(hashes[0],hashes[1]);assert.notEqual(hashes[0],hashes[2]);
  await page.screenshot({path:path.join(output,width+'.png'),fullPage:true});results.push({width,canonicalRuntime:true,schema4Review:true,noOverflow:true,noPageErrors:true,realWrites:0});await context.close();}
 }finally{await browser.close()}fs.writeFileSync(path.join(output,'results.json'),JSON.stringify(results,null,2));console.log(JSON.stringify({passed:results.length,results}));
})().catch(e=>{console.error(e.message);process.exitCode=1});
