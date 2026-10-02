'use strict';
// Opt-in only. Never use production, service_role, or a persisted real browser profile.
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),crypto=require('node:crypto'),assert=require('node:assert/strict'),cp=require('node:child_process');
const {createClient}=require('@supabase/supabase-js');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const TARGET='lblyapnsngqnjimgskkp',KEY='sb_publishable_6bk0BQjpjcfNuUZKxdoy7w_Vhws9KSx',REMOTE=`https://${TARGET}.supabase.co`;
if(process.env.MARKET_REMOTE_ACCEPTANCE!==TARGET)throw Error('Explicit test project opt-in required');
const output=path.resolve('test-results/market-remote'),seed=path.join(output,'seed.json'),source=process.env.MARKET_SOURCE_ROOT;
fs.mkdirSync(output,{recursive:true});
const accounts=JSON.parse(cp.execFileSync('python',['-B','-c',"from pathlib import Path;from scripts.fetch_cloud_universe import protect;print(protect(Path('test-results/market-remote/accounts.bin').read_bytes(),decrypt=True).decode())"],{encoding:'utf8',windowsHide:true}));
const clients={},credentials={},evidence={projectId:TARGET,startedAt:new Date().toISOString(),accounts:accounts.map(({password,...x})=>x),checks:[],loops:[],externalRequests:[]};
let stage='initialization';
function check(name,value,details={}){assert(value,name);evidence.checks.push({name,passed:true,...details});console.log(JSON.stringify({check:name,passed:true}))}
async function rpc(client,action,input){const {data,error}=await client.rpc('market_data_account',{p_action:action,p_input:input});if(error)throw Error(`account_rpc:${error.code}:${error.message}`);return data}
async function rawRPC(name,body,{jwt,headers={}}={}){const response=await fetch(`${REMOTE}/rest/v1/rpc/${name}`,{method:'POST',headers:{apikey:KEY,'Content-Type':'application/json',...(jwt?{Authorization:`Bearer ${jwt}`}:{ }),...headers},body:JSON.stringify(body),signal:AbortSignal.timeout(20000)});return {status:response.status,data:await response.json()}}
async function workerRPC(label,action,input){return rawRPC('market_data_worker',{p_token:credentials[label].token,p_action:action,p_input:input})}
async function spawnWorker(mode){
 let resolveRunning,rejectRunning;const running=new Promise((resolve,reject)=>{resolveRunning=resolve;rejectRunning=reject});let observed=false;
 const done=new Promise((resolve,reject)=>{
  const child=cp.spawn('python',['-B','-m','tests.market_remote_worker','--source-root',source,'--seed',seed,'--mode',mode],{windowsHide:true,env:{...process.env,MARKET_REMOTE_CREDENTIAL:JSON.stringify(credentials.owner)}});
  let stdout='',stderr='';child.stdout.on('data',chunk=>{stdout+=chunk.toString();for(const line of stdout.split(/\r?\n/)){try{const event=JSON.parse(line);if(event.observed==='remote_claim'&&!observed){observed=true;resolveRunning(event)}}catch(_){}}});
  child.stderr.on('data',chunk=>stderr+=chunk.toString());child.on('error',reject);child.on('exit',code=>{if(!observed)rejectRunning(Error('worker_did_not_claim'));fs.appendFileSync(path.join(output,'worker-log.jsonl'),stdout);if(code!==0)reject(Error(`worker_process_failed:${code}`));else resolve(stdout)});
 });return {running,done};
}
(async()=>{
 let browser,server,page;
 try{
  stage='auth';
  for(const a of accounts){const sdk=createClient(REMOTE,KEY,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}});const {data,error}=await sdk.auth.signInWithPassword({email:a.email,password:a.password});if(error)throw Error(`auth_failed:${error.code}`);check(`real_auth_${a.label}`,data.user.id===a.userId);clients[a.label]=sdk}
  stage='security';
  const guest=await rawRPC('market_data_account',{p_action:'request',p_input:{symbol:'601869.SS',taskType:'UPDATE_DAILY_MARKET_DATA'}});check('unauthenticated_create_denied',guest.status>=400,{status:guest.status});
  const forged=await rawRPC('market_data_worker',{p_token:'0'.repeat(64),p_action:'claim',p_input:{}});check('unauthorized_worker_denied',forged.status>=400,{status:forged.status});
  const rotating=Array.from({length:8},()=>crypto.randomBytes(32).toString('hex'));
  await Promise.all(rotating.map(token=>rpc(clients.owner,'register_worker',{token})));
  const rotated=await Promise.all(rotating.map(token=>rawRPC('market_data_worker',{p_token:token,p_action:'claim',p_input:{}})));
  check('concurrent_rotation_one_valid_capability',rotated.filter(r=>r.status===200).length===1&&rotated.filter(r=>r.status>=400&&r.data.code==='42501').length===7,{statuses:rotated.map(r=>r.status)});
  for(const label of ['owner','outsider']){const token=crypto.randomBytes(32).toString('hex'),identity=await rpc(clients[label],'register_worker',{token});credentials[label]={...identity,projectRef:TARGET,token}}
  const request={symbol:'601869.SS',taskType:'UPDATE_DAILY_MARKET_DATA'};
  for(const [label,input] of Object.entries({invalid_symbol:{...request,symbol:'../601869.SS'},invalid_type:{...request,taskType:'SHELL'},command:{...request,command:'calc'},path:{...request,path:'C:/private'},url:{...request,url:'https://example.invalid'},owner:{...request,owner:accounts[1].userId}})){
   const result=await clients.owner.rpc('market_data_account',{p_action:'request',p_input:input});check(`reject_${label}`,Boolean(result.error));
  }
  for(const [label,input] of Object.entries({taskType:{taskType:'SHELL'},symbol:{symbol:'../x'},command:{command:'calc'},path:{path:'C:/x'},url:{url:'https://example.invalid'}})){
   const result=await workerRPC('owner','claim',input);check(`worker_reject_${label}`,result.status>=400);
  }
  const deniedAction=await workerRPC('owner','execute',{command:'calc'});check('worker_only_claim_finish',deniedAction.status>=400);
  const ownerSession=(await clients.owner.auth.getSession()).data.session;
  for(const schema of ['public','market_private'])for(const table of ['tasks','results','workers']){
   const response=await fetch(`${REMOTE}/rest/v1/${table}?select=*`,{headers:{apikey:KEY,Authorization:`Bearer ${ownerSession.access_token}`,'Accept-Profile':schema}});check(`direct_${schema}_${table}_denied`,response.status>=400,{status:response.status});await response.arrayBuffer();
  }
  // A capability alone does not authenticate a browser account operation.
  check('worker_cannot_create_tasks',(await rawRPC('market_data_account',{p_action:'request',p_input:request})).status>=400);
  stage='browser_setup';
  server=http.createServer((req,res)=>{try{const pathname=decodeURIComponent(new URL(req.url,'http://localhost').pathname),file=path.resolve('.','.'+(pathname==='/'?'/index.html':pathname));if(!file.startsWith(path.resolve('.')+path.sep))throw Error('denied');res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript':file.endsWith('.html')?'text/html':'text/plain');if(pathname==='/data/supabase_config.js')res.end(`window.UNIVERSE_CLOUD_CONFIG=${JSON.stringify({projectRef:TARGET,url:REMOTE,publishableKey:KEY})};`);else res.end(fs.readFileSync(file))}catch(_){res.statusCode=404;res.end()}});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const local=`http://127.0.0.1:${server.address().port}`;
  browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_EXECUTABLE||undefined});const context=await browser.newContext({viewport:{width:390,height:844}}),pageErrors=[];page=await context.newPage();
  page.on('pageerror',e=>pageErrors.push(e.message));page.on('dialog',d=>d.dismiss());
  await context.route('**/*',route=>{const u=new URL(route.request().url());if(u.origin===local)return route.continue();if(u.origin===REMOTE&&(u.pathname.startsWith('/auth/v1/')||u.pathname==='/rest/v1/rpc/market_data_account'))return route.continue();evidence.externalRequests.push({origin:u.origin,path:u.pathname,blocked:true});return route.abort()});
  await page.goto(local);await page.waitForFunction(()=>document.querySelector('#main')?.dataset.storageState==='ready');
  const stockSeed=JSON.parse(fs.readFileSync(seed,'utf8'));
  await page.evaluate(async stockSeed=>{const candidate=createValidatedCandidateSnapshot({stocks:[{...stockSeed,id:'remote-acceptance',code:stockSeed.symbol,name:'远端行情隔离验收',type:'watching',shares:0,avgCost:0,plans:[]}],updatedAt:null});await persistCandidateSnapshot(candidate);state=candidate;render();openStockDetail('remote-acceptance','technical');globalThis.protectedBefore=JSON.stringify({shares:state.stocks[0].shares,plans:state.stocks[0].plans,orders:state.orders});},stockSeed);
  await page.evaluate(async account=>{await SupabaseBrowserClient.signIn(account.email,account.password)},accounts.find(a=>a.label==='owner'));
  check('browser_is_test_project',await page.evaluate(()=>SupabaseBrowserClient.configuration().projectRef=== 'lblyapnsngqnjimgskkp'));
  check('initial_stale_agreement',await page.evaluate(()=>!TechnicalViewUx.canonicalTechnicalDate(state.stocks[0]).fresh&&!DiscussionDataReadiness.technical(state.stocks[0]).ready));
  stage='remote_incremental_loop';
  await page.locator('[data-market-update]').click();await page.waitForFunction(()=>document.querySelector('[data-market-status]')?.textContent==='等待执行端');
  let task=await rpc(clients.owner,'read',{symbol:request.symbol});
  const duplicate=await Promise.all(Array.from({length:8},()=>rpc(clients.owner,'request',request)));check('duplicate_active_reused',duplicate.every(x=>x.taskId===task.taskId));
  await new Promise(resolve=>setTimeout(resolve,6000));const offline=await rpc(clients.owner,'read',{taskId:task.taskId});check('worker_offline_remains_queued',offline.status==='queued'&&!offline.startedAt&&!offline.workerId);
  check('outsider_cannot_read_task',await rpc(clients.outsider,'read',{taskId:task.taskId})===null);
  await page.locator('[data-market-orchestrator]').screenshot({path:path.join(output,'remote-queued-390.png')});
  const work=await spawnWorker('real');await work.running;await page.evaluate(()=>MarketDataTaskUi.poll());
  await page.waitForFunction(()=>document.querySelector('[data-market-status]')?.textContent==='正在更新行情');
  check('running_visible',true);await page.locator('[data-market-orchestrator]').screenshot({path:path.join(output,'remote-running-390.png')});
  check('second_claim_does_not_execute',(await workerRPC('owner','claim',{})).data===null);
  check('outsider_cannot_finish',(await workerRPC('outsider','finish',{taskId:task.taskId,error:'test'})).status>=400);
  await work.done;task=await rpc(clients.owner,'read',{taskId:task.taskId});check('remote_succeeded',task.status==='succeeded',{status:task.status,error:task.error});
  check('actual_incremental_bars',task.result.dataUpdated&&task.result.stock.priceHistory.length>stockSeed.priceHistory.length,{before:stockSeed.priceHistory.length,after:task.result.stock.priceHistory.length});
  check('version_matches_request',task.resultVersion===task.taskId&&task.result.resultVersion===task.taskId&&task.result.taskId===task.taskId);
  check('provider_continuity',task.result.provider===stockSeed.marketDataFreshness.provider,{provider:task.result.provider});
  await page.evaluate(()=>MarketDataTaskUi.poll());await page.waitForFunction(()=>document.querySelector('[data-market-status]')?.textContent.includes('行情已更新至'));
  const facts=await page.evaluate(()=>{const stock=state.stocks[0],context=DiscussionWorkbench.buildContext(stock).context;return {pageFresh:TechnicalViewUx.canonicalTechnicalDate(stock).fresh,ready:context.dataReadiness.technical.ready,dataStatus:context.currentFacts.technical.dataStatus,resultVersion:context.currentFacts.technical.resultVersion,latestCompleteBar:stock.technicalData.latestCompleteBar,technicalAsOf:stock.technicalData.technicalAsOf}});
  check('freshness_discussion_same_version',facts.pageFresh&&facts.ready&&facts.resultVersion===task.taskId&&facts.latestCompleteBar===task.result.latestCompleteBar&&facts.technicalAsOf===task.result.technicalAsOf,facts);
  evidence.loops.push({taskId:task.taskId,resultVersion:task.resultVersion,requestedAt:task.requestedAt,startedAt:task.startedAt,completedAt:task.completedAt,provider:task.result.provider,seedBars:stockSeed.priceHistory.length,resultBars:task.result.stock.priceHistory.length,dataUpdated:task.result.dataUpdated,fingerprint:task.result.fingerprint,...facts});
  await page.locator('[data-market-orchestrator]').screenshot({path:path.join(output,'remote-succeeded-390.png')});
  const validTask=task,validResult=JSON.stringify(task.result);
  check('outsider_cannot_read_result',await rpc(clients.outsider,'read',{taskId:task.taskId})===null);
  stage='failure_preservation';
  await page.locator('[data-market-update]').click();await page.waitForFunction(()=>document.querySelector('[data-market-status]')?.textContent==='等待执行端');const failureTask=await rpc(clients.owner,'read',{symbol:request.symbol});
  const failure=await spawnWorker('provider_failure');await failure.running;await failure.done;task=await rpc(clients.owner,'read',{taskId:failureTask.taskId});
  check('provider_failure_is_failed',task.status==='failed'&&task.error==='provider_or_pipeline_failure');
  check('previous_remote_result_unchanged',JSON.stringify((await rpc(clients.owner,'read',{taskId:validTask.taskId})).result)===validResult);
  await page.evaluate(()=>MarketDataTaskUi.poll());await page.waitForFunction(()=>document.querySelector('[data-market-status]')?.textContent==='更新失败');
  check('previous_browser_result_preserved',await page.evaluate(version=>state.stocks[0].marketDataFreshness.resultVersion===version,validTask.taskId));
  await page.locator('[data-market-orchestrator]').screenshot({path:path.join(output,'remote-failed-390.png')});
  stage='retry_and_no_change';
  const retry=await rpc(clients.owner,'request',request);check('retry_has_new_task',retry.taskId!==failureTask.taskId&&retry.status==='queued');
  const again=await spawnWorker('real');await again.running;await again.done;const repeated=await rpc(clients.owner,'read',{taskId:retry.taskId});check('no_change_succeeds',repeated.status==='succeeded'&&!repeated.result.dataUpdated&&repeated.result.fingerprint===validTask.result.fingerprint,{status:repeated.status,error:repeated.error});
  check('finish_idempotent',(await workerRPC('owner','finish',{taskId:retry.taskId,error:'late retry'})).data.status==='succeeded');
  await page.evaluate(()=>MarketDataTaskUi.poll());
  check('no_business_field_mutation',await page.evaluate(()=>JSON.stringify({shares:state.stocks[0].shares,plans:state.stocks[0].plans,orders:state.orders})===protectedBefore));
  check('no_browser_errors_or_overflow',pageErrors.length===0&&await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  stage='capability_revocation';
  for(const label of ['owner','outsider']){await rpc(clients[label],'revoke_worker',{});check(`revoked_worker_${label}_denied`,(await workerRPC(label,'claim',{})).status>=400)}
  evidence.completedAt=new Date().toISOString();evidence.status='passed';
 }catch(error){evidence.status='failed';evidence.failedStage=stage;evidence.failure=String(error.message).slice(0,400);if(page){evidence.browserStatus=await page.locator('[data-market-status]').allTextContents().catch(()=>[]);await page.screenshot({path:path.join(output,'remote-diagnostic.png')}).catch(()=>{})}console.error(JSON.stringify({stage,error:evidence.failure,browserStatus:evidence.browserStatus}));process.exitCode=1}
 finally{
  for(const label of Object.keys(clients)){try{await rpc(clients[label],'revoke_worker',{});await clients[label].auth.signOut({scope:'global'})}catch(_){}}
  if(browser)await browser.close();if(server)await new Promise(resolve=>server.close(resolve));
  fs.writeFileSync(path.join(output,'remote-results.json'),JSON.stringify(evidence,null,2));
 }
})();
