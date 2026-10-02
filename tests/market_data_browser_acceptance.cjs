'use strict';
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const {createDatabase,OWNER}=require('./helpers/market-db.cjs'),{resultFor}=require('./helpers/market-fixture.cjs');
(async()=>{
 const api=await createDatabase(),token=crypto.randomBytes(32).toString('hex');await api.account('register_worker',{token});
 const {spawn}=require('node:child_process'),real=process.env.MARKET_REAL_PROVIDER==='1';
 const root=path.resolve('.'),output=path.resolve('test-results/market-data-orchestrator');fs.mkdirSync(output,{recursive:true});
 const server=http.createServer(async(req,res)=>{
  try{
   if(real&&req.url==='/__market_worker_test_rpc'&&req.method==='POST'){let body='';for await(const chunk of req)body+=chunk;const value=JSON.parse(body);if(value.token!==token)throw Error('unauthorized');res.setHeader('Content-Type','application/json');res.end(JSON.stringify(await api.worker(token,value.action,value.input)));return;}
   if(req.url==='/__market_test_rpc'&&req.method==='POST'){
    let body='';for await(const chunk of req)body+=chunk;const value=JSON.parse(body);const result=await api.account(value.action,value.input);res.setHeader('Content-Type','application/json');res.end(JSON.stringify({data:result}));return;
   }
   const pathname=decodeURIComponent(new URL(req.url,'http://localhost').pathname),file=path.resolve(root,'.'+(pathname==='/'?'/index.html':pathname));
   if(!file.startsWith(root+path.sep))throw Error('path denied');res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript':file.endsWith('.html')?'text/html':'text/plain');res.end(fs.readFileSync(file));
  }catch(error){res.statusCode=400;res.end(JSON.stringify({error:{message:error.message}}))}
 });await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const url=`http://127.0.0.1:${server.address().port}`;
 const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_EXECUTABLE||undefined}),results=[];
 try{for(const viewport of (real?[{width:390,height:844}]:[{width:1280,height:900},{width:390,height:844},{width:360,height:800}])){
  const context=await browser.newContext({viewport}),page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
  page.on('dialog',d=>d.dismiss());
  await context.route('**/*',route=>{
   const u=route.request().url();if(new URL(u).origin!==url)return route.abort();
   if(u.includes('/src/supabase-browser-client.js'))return route.fulfill({contentType:'text/javascript',body:`window.SupabaseBrowserClient={getSession:async()=>window.marketTestSignedOut?null:({user:{id:'${OWNER}'}}),getUser:async()=>({id:'${OWNER}'}),onAuthStateChange:fn=>{setTimeout(()=>fn('INITIAL_SESSION',{user:{id:'${OWNER}'}}),0);return ()=>{}},configuration:()=>({projectRef:'local-test'}),getClient:()=>({rpc:async(name,args)=>{if(name!=='market_data_account')return {data:null};return fetch('/__market_test_rpc',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:args.p_action,input:args.p_input})}).then(r=>r.json())},from:()=>({upsert:async()=>({})})})};`});
   return route.continue();
  });
  await page.goto(url);await page.waitForFunction(()=>document.querySelector('#main')?.dataset.storageState==='ready');
  await page.evaluate(async()=>{
   const source={id:'market-test',code:'601869.SS',name:'行情编排隔离验收',type:'holding',shares:100,avgCost:10,currentPrice:11,plans:[],priceHistory:[{date:'2026-09-01',open:10,high:12,low:9,close:11,volume:1000,is_complete_bar:true,provider:'fixture',adjustment:'qfq',price_basis:'adjusted'}],marketDataFreshness:{last_trade_date:'2026-09-01',is_complete_bar:true,kline_status:'current'},technicalIndicators:{last_trade_date:'2026-09-01'}};
   const candidate=createValidatedCandidateSnapshot({stocks:[source],updatedAt:null});await persistCandidateSnapshot(candidate);state=candidate;render();openStockDetail('market-test','technical');
   globalThis.protectedBefore=JSON.stringify({shares:state.stocks[0].shares,avgCost:state.stocks[0].avgCost,plans:state.stocks[0].plans,orders:state.orders});
  });
  assert.equal(await page.evaluate(()=>DiscussionDataReadiness.technical(state.stocks[0]).ready),false);
  await page.locator('[data-market-update]').click();await page.waitForFunction(()=>document.querySelector('[data-market-status]')?.textContent==='等待执行端');
  await page.locator('[data-market-orchestrator]').screenshot({path:path.join(output,`queued-${viewport.width}.png`)});
  let claimed;
  if(real){
   const worker=(await api.db.query('select id from market_private.workers where owner=$1',[OWNER])).rows[0];
   const completion=new Promise((resolve,reject)=>{const child=spawn('python',['-B','-m','tests.market_worker_acceptance','--url',url,'--source-root',process.env.MARKET_SOURCE_ROOT,'--seed','test-results/market-data-orchestrator/real-provider-result.json'],{windowsHide:true,env:{...process.env,MARKET_TEST_CREDENTIAL:JSON.stringify({token,userId:OWNER,workerId:worker.id})}});let log='';child.stdout.on('data',data=>log+=data);child.stderr.on('data',data=>log+=data);child.on('error',reject);child.on('exit',code=>code===0?resolve(log):reject(Error(log)))});
   const log=await completion;assert.match(log,/"status": "running"/);assert.match(log,/"status": "succeeded"/);fs.writeFileSync(path.join(output,'real-worker-log.jsonl'),log);
   claimed=await api.account('read',{symbol:'601869.SS'});assert(['eastmoney','yahoo'].includes(claimed.result.provider));assert.equal(claimed.result.dataUpdated,true);
  }else{
   claimed=await api.worker(token,'claim',{});assert.equal(claimed.status,'running');await page.evaluate(()=>MarketDataTaskUi.poll());
   await page.waitForFunction(()=>document.querySelector('[data-market-status]')?.textContent==='正在更新行情');
   await page.locator('[data-market-orchestrator]').screenshot({path:path.join(output,`running-${viewport.width}.png`)});
   await page.evaluate(()=>openStockDetail('market-test','ai'));
   await api.worker(token,'finish',{taskId:claimed.taskId,result:resultFor(claimed)});
  }
  await page.evaluate(()=>MarketDataTaskUi.poll());
  await page.evaluate(()=>openStockDetail('market-test','technical'));await page.evaluate(()=>MarketDataTaskUi.poll());
  await page.waitForFunction(()=>document.querySelector('[data-market-status]')?.textContent.includes('行情已更新至'));
  assert.equal(await page.evaluate(()=>DiscussionDataReadiness.technical(state.stocks[0]).ready),true);
  assert.equal(await page.evaluate(()=>TechnicalViewUx.canonicalTechnicalDate(state.stocks[0]).fresh),true);
  assert.equal(await page.evaluate(()=>DiscussionWorkbench.buildContext(state.stocks[0]).context.currentFacts.technical.resultVersion),claimed.taskId);
  await page.locator('[data-market-orchestrator]').screenshot({path:path.join(output,`succeeded-${viewport.width}.png`)});
  await page.locator('[data-market-update]').click();await page.waitForFunction(()=>document.querySelector('[data-market-status]')?.textContent==='等待执行端');const failed=await api.worker(token,'claim',{});
  await api.worker(token,'finish',{taskId:failed.taskId,error:'provider_or_pipeline_failure'});await page.evaluate(()=>MarketDataTaskUi.poll());
  await page.waitForFunction(()=>document.querySelector('[data-market-status]')?.textContent==='更新失败');assert.match(await page.locator('[data-market-reason]').innerText(),/行情来源暂时不可用/);
  assert.equal(await page.evaluate(()=>state.stocks[0].marketDataFreshness.resultVersion),claimed.taskId);
  assert.equal(await page.evaluate(()=>JSON.stringify({shares:state.stocks[0].shares,avgCost:state.stocks[0].avgCost,plans:state.stocks[0].plans,orders:state.orders})===protectedBefore),true);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  await page.locator('[data-market-orchestrator]').screenshot({path:path.join(output,`failed-${viewport.width}.png`)});
  await page.evaluate(()=>window.marketTestSignedOut=true);await page.locator('[data-market-update]').click();await page.waitForFunction(()=>document.querySelector('[data-market-status]')?.textContent.includes('请先在账户设置中登录'));
  assert.deepEqual(errors,[]);results.push({viewport,queued:true,running:true,succeeded:true,failed:true,version:claimed.taskId,freshnessAgreement:true,previousPreserved:true,noProtectedChanges:true,noOverflow:true,errors});await context.close();
 }
 fs.writeFileSync(path.join(output,real?'real-local-loop-results.json':'browser-results.json'),JSON.stringify(results,null,2));console.log(JSON.stringify(results));
 }finally{await browser.close();await new Promise(resolve=>server.close(resolve));await api.db.close()}
})().catch(error=>{console.error(error);process.exitCode=1});
