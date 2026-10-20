'use strict';
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const {spawn}=require('node:child_process'),{chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const {setup,OWNER}=require('./helpers/bounded-db.cjs');
const discussionFixture=require('./fixtures/discussion-reliability.js').stock().discussionState;
discussionFixture.current.symbol='2899.HK';discussionFixture.current.summary='既有讨论正文，行情更新不得改写。';discussionFixture.history=[structuredClone(discussionFixture.current)];
(async()=>{
 const root=path.resolve('.'),output=path.resolve('test-results/bounded-daily');fs.mkdirSync(output,{recursive:true});
 const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_EXECUTABLE||undefined}),results=[];
 try{for(const stable of [false,true])for(const viewport of [{width:360,height:800},{width:390,height:844},{width:1280,height:900}]){
  const h=await setup(stable),token=crypto.randomBytes(32).toString('hex'),credential=await h.account('register_worker',{token});
  const server=http.createServer(async(req,res)=>{try{
   if(req.method==='POST'){
    let text='';for await(const chunk of req)text+=chunk;const q=JSON.parse(text);res.setHeader('Content-Type','application/json');
    if(req.url==='/__worker'){
     assert.equal(q.token,token);res.end(JSON.stringify(q.fn==='daily'?await h.daily(token,q.action,q.input):await h.worker(token,q.action,q.input)));return;
    }
    if(req.url==='/__browser'){
     const data=q.name==='market_data_daily_current'?await h.read():q.name==='market_data_account'?await h.account(q.args.p_action,q.args.p_input):null;
     res.end(JSON.stringify({data}));return;
    }
   }
   const pathname=new URL(req.url,'http://localhost').pathname,file=path.resolve(root,'.'+(pathname==='/'?'/index.html':pathname));
   if(!file.startsWith(root+path.sep))throw Error('path denied');res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript':file.endsWith('.html')?'text/html':'text/plain');res.end(fs.readFileSync(file));
  }catch(error){res.statusCode=400;res.end(JSON.stringify({error:{message:error.message}}))}});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const url=`http://127.0.0.1:${server.address().port}`;
  const context=await browser.newContext({viewport}),page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.dismiss());
  try{
   await page.clock.setFixedTime(new Date('2026-10-20T02:45:00Z'));
   await context.route('**/*',route=>{
    const u=route.request().url();if(new URL(u).origin!==url)return route.abort();
    if(u.includes('/src/supabase-browser-client.js'))return route.fulfill({contentType:'text/javascript',body:`window.SupabaseBrowserClient={getSession:async()=>({user:{id:'${OWNER}'}}),getUser:async()=>({id:'${OWNER}'}),onAuthStateChange:fn=>{setTimeout(()=>fn('INITIAL_SESSION',{user:{id:'${OWNER}'}}),0);return ()=>{}},configuration:()=>({projectRef:'local-test'}),getClient:()=>({rpc:async(name,args)=>fetch('/__browser',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name,args})}).then(r=>r.json()),from:()=>({upsert:async()=>({})})})};`});return route.continue();
   });
   await page.goto(url);await page.waitForFunction(()=>document.querySelector('#main')?.dataset.storageState==='ready');
   await page.evaluate(async ({b,discussion})=>{
    const plan=PlanV2.createPlan({id:'protected-plan',action:'buy',triggerPrice:20,triggerDirection:'below',quantity:100,note:'既有隔离计划'},{source:'manual'});
    const stock={id:'bounded-test',code:'2899.HK',name:'隔离日更验收',type:'holding',shares:100,avgCost:10,currentPrice:31,plans:[plan],discussionState:discussion,...b};
    const other=Array.from({length:22},(_,i)=>({id:'protected-'+i,code:String(1000+i)+'.HK',name:'保护标的',type:'watch'}));
    const next=createValidatedCandidateSnapshot({stocks:[stock,...other],updatedAt:null});
    // Exact approved market facts are the receiver baseline; business normalization stays intact.
    Object.assign(next.stocks[0],b);await StorageManager.saveState(next,{critical:true});MultiTabProtection.observeLoadedState(next);state=next;render();openStockDetail('bounded-test','technical');
    globalThis.protection=JSON.stringify({other:state.stocks.slice(1),shares:state.stocks[0].shares,plans:state.stocks[0].plans,orders:state.orders,discussions:state.stocks[0].discussionState});
   },{b:h.f.baseline.bundle,discussion:discussionFixture});
   assert.equal(await page.evaluate(()=>state.stocks[0].discussionState.history.length),1);
   await page.evaluate(()=>MarketDataTaskUi.poll());
   await page.locator('[data-market-update]').click();await page.waitForFunction(()=>document.querySelector('[data-market-status]')?.textContent==='等待执行端');
   const queued=await h.account('read',{symbol:'2899.HK'});assert.equal((await h.account('request',{symbol:'2899.HK',taskType:'UPDATE_DAILY_MARKET_DATA'})).taskId,queued.taskId);
   await page.screenshot({path:path.join(output,`queued-${viewport.width}.png`)});
   const log=await new Promise((resolve,reject)=>{
    const child=spawn(process.env.PYTHON_EXECUTABLE||'python',['-B','-m','tests.bounded_worker_replay'],{windowsHide:true,stdio:['pipe','pipe','pipe']});
    let out='',err='';child.stdout.on('data',d=>out+=d);child.stderr.on('data',d=>err+=d);child.on('error',reject);child.on('exit',code=>code===0?resolve(out):reject(Error(err+'\n'+out)));
    child.stdin.end(JSON.stringify({url,credential:{...credential,token},sourceRoot:process.env.MARKET_SOURCE_ROOT}));
   });assert.match(log,/"status": "running"/);assert.match(log,/"status": "succeeded"/);
   await page.evaluate(()=>MarketDataTaskUi.poll());await page.waitForFunction(()=>state.stocks[0].priceHistory.length===436);
   await page.evaluate(()=>openStockDetail('bounded-test','technical'));await page.evaluate(()=>MarketDataTaskUi.poll());
   const current=await h.read(),facts=await page.evaluate(()=>({date:state.stocks[0].marketDataFreshness.latestCompleteBar,technical:state.stocks[0].technicalData.technicalVersion,content:state.stocks[0].technicalData.dataContentVersion,judgment:state.stocks[0].technicalData.aiJudgmentStatus,readiness:DiscussionDataReadiness.technical(state.stocks[0]),context:DiscussionWorkbench.buildContext(state.stocks[0]).context.currentFacts.technical,
    protected:JSON.stringify({other:state.stocks.slice(1),shares:state.stocks[0].shares,plans:state.stocks[0].plans,orders:state.orders,discussions:state.stocks[0].discussionState})===protection}));
   assert.equal(facts.date,'2026-10-16');assert.equal(facts.technical,current.bundle.technicalData.technicalVersion);assert.equal(facts.content,current.bundle.technicalData.dataContentVersion);assert.equal(facts.judgment,'needs_review');assert.equal(facts.protected,true);assert.equal(facts.readiness.ready,true,JSON.stringify(facts.readiness));assert.equal(facts.context.resultVersion,queued.taskId);
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
   assert.equal(current.receipt.tier,stable?'NORMAL_UPDATE':'AUDITED_REVISION');
   await page.screenshot({path:path.join(output,`${stable?'append':'revision'}-succeeded-${viewport.width}.png`)});
   assert.equal(await page.evaluate(()=>DiscussionDataReadiness.technical(state.stocks[0],{now:new Date('2026-11-05T08:00:00Z')}).ready),false);
   const failed=await h.account('request',{symbol:'2899.HK',taskType:'UPDATE_DAILY_MARKET_DATA'});await h.worker(token,'claim',{});await h.worker(token,'finish',{taskId:failed.taskId,error:'PRICE_DELTA_EXCEEDED'});await page.evaluate(()=>MarketDataTaskUi.poll());
   assert.match(await page.locator('[data-market-status]').innerText(),/历史行情待复核/);
   assert.match(await page.locator('[data-market-reason]').innerText(),/超出已验证范围/);
   assert.equal(await page.evaluate(()=>state.stocks[0].marketDataFreshness.resultVersion),queued.taskId);
   await page.reload();await page.waitForFunction(()=>document.querySelector('#main')?.dataset.storageState==='ready');
   await page.evaluate(()=>openStockDetail('bounded-test','technical'));await page.evaluate(()=>MarketDataTaskUi.poll());
   assert.equal(await page.evaluate(()=>state.stocks[0].priceHistory.length),436);
   assert.equal(await page.evaluate(()=>state.stocks[0].marketDailyReceipt.versionId),current.versionId);
   assert.deepEqual(errors,[]);results.push({viewport,tier:current.receipt.tier,archivedRealProviderReplay:true,actualWorkerRunOnce:true,sqlServerRevalidation:true,duplicateSuppressed:true,offlineQueued:true,bars:436,latest:'2026-10-16',technicalAgreement:true,discussionReady:true,protected22:true,reload:true,physicalPhone:false});
  }finally{await context.close();await new Promise(r=>server.close(r));await h.db.close()}
 }
 fs.writeFileSync(path.join(output,'browser-results.json'),JSON.stringify(results,null,2));console.log(JSON.stringify(results));
 }finally{await browser.close()}
})().catch(error=>{console.error(error);process.exitCode=1});
