'use strict';
// Default: real bundled SDK against deterministic Auth/RPC HTTP fixtures.
// --real <fixture.json>: only the dedicated test project; caller owns fixture cleanup.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const ref='lblyapnsngqnjimgskkp',origin=`https://${ref}.supabase.co`,local='http://127.0.0.1:8768';
const key='sb_publishable_6bk0BQjpjcfNuUZKxdoy7w_Vhws9KSx',real=process.argv[2]==='--real';
const fixture=real?JSON.parse(fs.readFileSync(process.argv[3],'utf8')):{userId:'11111111-1111-4111-8111-111111111111',email:'fixture@example.net',password:'deterministic-fixture'};
const output=path.resolve('test-results/integration-hardening');
const sdkWrapper=`;(()=>{window.__authCounts={clients:0,subscriptions:0,signouts:0};const create=UniverseSupabaseSdk.createClient;window.UniverseSupabaseSdk={...UniverseSupabaseSdk,createClient:(...args)=>{__authCounts.clients++;const client=create(...args),on=client.auth.onAuthStateChange.bind(client.auth),out=client.auth.signOut.bind(client.auth);client.auth.onAuthStateChange=(...args)=>{__authCounts.subscriptions++;return on(...args)};client.auth.signOut=(...args)=>{__authCounts.signouts++;return out(...args)};return client}}})();//`;
let serial=0;
function session(){const now=Math.floor(Date.now()/1000);const claims={sub:fixture.userId,role:'authenticated',aud:'authenticated',iat:now,exp:now+3600,session_id:fixture.userId,sequence:++serial};return {access_token:Buffer.from(JSON.stringify({alg:'HS256',typ:'JWT'})).toString('base64url')+'.'+Buffer.from(JSON.stringify(claims)).toString('base64url')+'.fixture',refresh_token:`fixture-refresh-${serial}`,token_type:'bearer',expires_in:3600,expires_at:now+3600,user:{id:fixture.userId,aud:'authenticated',role:'authenticated',email:fixture.email,app_metadata:{provider:'email',providers:['email']},user_metadata:{},created_at:'2026-09-05T00:00:00Z'}}}
(async()=>{
 fs.mkdirSync(output,{recursive:true});const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_EXECUTABLE||undefined});const context=await browser.newContext({viewport:{width:500,height:900}}),page=await context.newPage(),errors=[],requests=[];let row=null,corruptResponse=null,stage='login';
 page.on('pageerror',e=>errors.push(e.message));
 try{
  let restored=session();
  if(real){const response=await context.request.post(`${origin}/auth/v1/token?grant_type=password`,{headers:{apikey:key},data:{email:fixture.email,password:fixture.password}});assert.equal(response.status(),200,'temporary test fixture login');restored=await response.json();assert.equal(restored.user.id,fixture.userId)}
  await context.route('**/*',async route=>{
   const request=route.request(),url=new URL(request.url());
   if(url.origin===local&&url.pathname==='/data/supabase_config.js')return route.fulfill({contentType:'text/javascript',body:`window.UNIVERSE_CLOUD_CONFIG=${JSON.stringify({projectRef:ref,url:origin,publishableKey:key})}`});
   if(url.origin===local&&url.pathname==='/src/vendor/supabase-client.js')return route.fulfill({contentType:'text/javascript',body:fs.readFileSync(path.join(__dirname,'../src/vendor/supabase-client.js'),'utf8')+sdkWrapper});
   if(url.origin===origin){
    requests.push({path:url.pathname,method:request.method(),authorization:request.headers().authorization});
    if(real){
      if(corruptResponse&&url.pathname.endsWith('/publish_analysis_module')){
        const response=await route.fetch(),value=await response.json();assert.ok(['published','no_change'].includes(value.status));
        if(corruptResponse==='unknown')value.status='future_unknown_status';else delete value.module.revision;
        return route.fulfill({response,json:value});
      }
      return route.continue();
    }
    const json=value=>route.fulfill({contentType:'application/json',body:JSON.stringify(value)});
    if(url.pathname==='/auth/v1/token')return json(session());
    if(url.pathname==='/auth/v1/logout')return route.fulfill({status:204});
    if(url.pathname==='/rest/v1/stock_universe_entries')return json([]);
    if(url.pathname.endsWith('/get_analysis_module'))return json(row);
    if(url.pathname.endsWith('/list_analysis_modules'))return json(row?[row]:[]);
    if(url.pathname.endsWith('/publish_analysis_module')){const a=request.postDataJSON();if(row?.payloadHash===a.p_payload_hash)return json({status:'no_change',module:row});row={moduleType:a.p_module_type,entityKey:a.p_entity_key,moduleSchemaVersion:a.p_module_schema_version,revision:row?row.revision+1:1,payloadHash:a.p_payload_hash,payload:a.p_payload,publishedAt:new Date().toISOString()};return json(corruptResponse==='unknown'?{status:'future_unknown_status',module:row}:corruptResponse==='malformed'?{status:'published',module:{...row,revision:null}}:{status:'published',module:row})}
    return route.fulfill({status:404});
   }
   return url.origin===local?route.continue():route.abort();
  });
  await context.addInitScript(({restored,ref})=>{if(!sessionStorage.getItem('fixtureSeeded')){localStorage.setItem(`universe-auth-${ref}`,JSON.stringify(restored));sessionStorage.setItem('fixtureSeeded','1')}},{restored,ref});
  await page.goto(local);await page.waitForFunction(()=>UniverseAutoAdd.status().signedIn);assert.equal(await page.evaluate(()=>UniverseAutoAdd.getClient()===ManualAnalysisSyncCloud.getClient()),true);assert.deepEqual(await page.evaluate(()=>[__authCounts.clients,__authCounts.subscriptions]),[1,1]);
  await page.evaluate(()=>{window.__events=[];SupabaseBrowserClient.onAuthStateChange(event=>__events.push(event))});
  stage='refresh';const refreshed=await page.evaluate(async()=>{const client=SupabaseBrowserClient.getClient(),before=(await SupabaseBrowserClient.getSession()).access_token;const {data,error}=await client.auth.refreshSession();if(error)throw new Error('refresh failed');return {changed:before!==data.session.access_token,owner:data.session.user.id}});assert.equal(refreshed.changed,true);assert.equal(refreshed.owner,fixture.userId);
  stage='concurrent';const result=await page.evaluate(async()=>{
   const logic={schemaVersion:'long-term-logic.v2',investmentThesis:'继续验证需求增长与利润改善。',coreDrivers:['需求增长'],keyRisks:['竞争加剧'],reviewTriggers:['利润率恶化'],logicStatus:'valid',confidence:'medium',nextReviewDate:'2026-12-01'};
   const candidate=createValidatedCandidateSnapshot({stocks:[{id:'combined',code:'1810.HK',name:'隔离测试',type:'watching',plans:[],longTermLogic:logic}],updatedAt:null});await persistCandidateSnapshot(candidate);state=candidate;
   ManualAnalysisSyncCloud.setRole('publisher');const engine=ManualAnalysisSyncCloud.initialize();const preview=await engine.preparePublish('long_term_logic','1810.HK',state);
   const [_,published]=await Promise.all([UniverseAutoAdd.retry(),engine.confirmPublish(preview,state)]);const repeat=await engine.confirmPublish(preview,state);return {published:published.status,repeat:repeat.status,user:(await SupabaseBrowserClient.getUser()).id,synced:UniverseAutoAdd.status().state};
  });assert.equal(result.published,'published');assert.equal(result.repeat,'no_change');assert.equal(result.user,fixture.userId);assert.equal(result.synced,'synced');
  const universe=requests.find(r=>r.path==='/rest/v1/stock_universe_entries'),publish=requests.find(r=>r.path.endsWith('/publish_analysis_module'));assert.ok(universe&&publish);assert.equal(universe.authorization,publish.authorization);
  stage='signout';const before=await page.evaluate(()=>JSON.stringify(state));await page.evaluate(()=>UniverseAutoAdd.signOut());await page.waitForFunction(()=>!UniverseAutoAdd.status().signedIn);assert.equal(await page.evaluate(()=>JSON.stringify(state)),before);assert.equal(await page.evaluate(async()=>{try{await ManualAnalysisSyncCloud.initialize().fetchUpdates(state);return false}catch(e){return e.status===401}}),true);
  await page.evaluate(async()=>{const candidate=createValidatedCandidateSnapshot({...state,stocks:[...state.stocks,{id:'pending',code:'0700.HK',name:'待同步',type:'watching',plans:[]}]});await persistCandidateSnapshot(candidate);state=candidate;await UniverseAutoAdd.flush()});assert.equal(await page.evaluate(()=>UniverseAutoAdd.status().state),'auth_required');
  stage='signin-recovery';await page.evaluate(({email,password})=>UniverseAutoAdd.signIn(email,password),fixture);await page.waitForFunction(()=>UniverseAutoAdd.status().signedIn);await page.evaluate(()=>UniverseAutoAdd.retry());assert.equal(await page.evaluate(()=>UniverseAutoAdd.status().pending),0);await page.evaluate(()=>ManualAnalysisSyncCloud.initialize().fetchUpdates(state));
  assert.equal(await page.evaluate(()=>__events.filter(e=>e==='SIGNED_OUT').length),1);assert.deepEqual(await page.evaluate(()=>[__authCounts.clients,__authCounts.subscriptions,__authCounts.signouts]),[1,1,1]);
  // Remote module remains visible before any local stock exists. Count real table requests.
  stage='missing-stock';const missingBefore=requests.filter(r=>r.path==='/rest/v1/stock_universe_entries').length;
  await page.evaluate(async()=>{
    window.__savedStocks=structuredClone(state.stocks);const candidate=createValidatedCandidateSnapshot({stocks:[],updatedAt:null});await persistCandidateSnapshot(candidate);state=candidate;await UniverseAutoAdd.flush();
    window.__persist=persistCandidateSnapshot;window.__applyWrites=0;persistCandidateSnapshot=async c=>{__applyWrites++;return __persist(c)};
    window.__missingCanonical=JSON.stringify(state);window.__missingLedger=localStorage.getItem(`universe-add-queue-${UNIVERSE_CLOUD_CONFIG.projectRef}`);ManualAnalysisSyncCloud.setRole('receiver');
  });
  await page.locator('#analysisFetchBtn').click();await page.locator('[data-analysis-update="0"]').waitFor();assert.equal(await page.locator('[data-analysis-update="0"]').isEnabled(),false);assert.match(await page.locator('#analysisSyncBody').innerText(),/本机尚未添加该股票/);assert.equal(await page.locator('#analysisSyncConfirm').isVisible(),false);
  assert.equal(await page.evaluate(()=>__applyWrites===0&&JSON.stringify(state)===__missingCanonical&&localStorage.getItem(`universe-add-queue-${UNIVERSE_CLOUD_CONFIG.projectRef}`)===__missingLedger),true);assert.equal(requests.filter(r=>r.path==='/rest/v1/stock_universe_entries').length,missingBefore);
  const remoteRevision=await page.evaluate(async()=>{const update=(await ManualAnalysisSyncCloud.initialize().fetchUpdates(state)).updates[0];return update.envelope.revision});await page.locator('#analysisSyncCancel').click();
  stage='stock-added-apply';await page.evaluate(async()=>{persistCandidateSnapshot=__persist;const stock=structuredClone(__savedStocks[0]);delete stock.longTermLogic;const candidate=createValidatedCandidateSnapshot({stocks:[stock],updatedAt:null});await persistCandidateSnapshot(candidate);state=candidate});
  await page.locator('#analysisFetchBtn').click();await page.locator('[data-analysis-update="0"]').click();await page.locator('#analysisSyncConfirm').waitFor({state:'visible'});assert.match(await page.locator('#analysisSyncBody').innerText(),new RegExp('修订 '+remoteRevision));await page.locator('#analysisSyncConfirm').click();await page.waitForFunction(()=>document.getElementById('analysisSyncMessage').textContent.includes('已同步到本机'));await page.locator('#analysisSyncCancel').click();
  // Corrupt only the response, after the real server commits. Re-read/retry reconciles.
  await page.evaluate(()=>ManualAnalysisSyncCloud.setRole('publisher'));
  for(const fault of ['unknown','malformed']){
    await page.evaluate(async fault=>{const candidate=structuredClone(state);candidate.stocks[0].longTermLogic.investmentThesis+=' '+fault+' 验证。';delete candidate.stocks[0].longTermLogicAudit;const validated=createValidatedCandidateSnapshot(candidate);await persistCandidateSnapshot(validated);state=validated},fault);
    stage='envelope-'+fault;corruptResponse=fault;await page.evaluate(()=>openLongTermLogicPublish('combined'));await page.locator('#analysisSyncConfirm').waitFor({state:'visible'});await page.locator('#analysisSyncConfirm').click();await page.waitForFunction(()=>document.getElementById('analysisSyncMessage').textContent.includes('同步结果校验失败'));
    assert.notEqual(await page.evaluate(()=>ManualAnalysisSyncCloud.statusFor('long_term_logic','1810.HK').state),'synced');assert.equal(await page.locator('#analysisSyncConfirm').isVisible(),false);await page.locator('#analysisSyncCancel').click();corruptResponse=null;
    const reconciled=await page.evaluate(()=>ManualAnalysisSyncCloud.initialize().preparePublish('long_term_logic','1810.HK',state));assert.equal(reconciled.status,'no_change');
  }
  stage='reload';await page.reload();await page.waitForFunction(()=>UniverseAutoAdd.status().signedIn);assert.equal(await page.evaluate(()=>ManualAnalysisSyncCloud.role()),'publisher');assert.deepEqual(errors,[]);
  const report={result:'PASS',mode:real?'dedicated-test-project':'real-sdk-mocked-http',project:ref,oneClient:true,oneSubscription:true,legacyStorageRestore:true,refreshSession:true,concurrentModules:true,published:true,noChange:true,signOut:true,pendingRecovery:true,missingLocalStockZeroWrites:true,stockAddedLaterSameRevision:true,unknownEnvelopeRejected:true,malformedEnvelopeRejected:true,serverCommitReconciled:true,reload:true,pageErrors:errors};fs.writeFileSync(path.join(output,real?'shared-auth-real.json':'shared-auth-sdk.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
 }catch(error){console.error(JSON.stringify({stage,diagnostic:await page.evaluate(()=>({storage:document.getElementById('main')?.dataset.storageState,message:document.getElementById('analysisSyncMessage')?.textContent,authEvents:window.__events,universe:window.UniverseAutoAdd?.status()})).catch(()=>null)}));throw error}finally{await page.evaluate(()=>SupabaseBrowserClient.signOut()).catch(()=>{});await context.close();await browser.close()}
})().catch(e=>{console.error(String(e.message).replaceAll(fixture.password,'[redacted]').replace(/Bearer [A-Za-z0-9_.-]+/gi,'Bearer [redacted]'));process.exitCode=1});
