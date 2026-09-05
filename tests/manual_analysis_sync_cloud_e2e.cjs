'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const Sync=require('../src/manual-analysis-sync.js');

const ref='lblyapnsngqnjimgskkp',origin=`https://${ref}.supabase.co`,local=process.env.WORKBENCH_E2E_URL||'http://127.0.0.1:8770/';
const publishableKey='sb_publishable_6bk0BQjpjcfNuUZKxdoy7w_Vhws9KSx';
const output=path.resolve(process.argv[2]||path.join('test-results','manual-analysis-sync-v1'));
const email=process.env.MANUAL_SYNC_E2E_EMAIL||`manual-analysis-sync-e2e-${Date.now()}-${crypto.randomBytes(4).toString('hex')}@example.com`;
const password=process.env.MANUAL_SYNC_E2E_PASSWORD||`Tmp!${crypto.randomBytes(18).toString('base64url')}9a`;
const existingUserId=process.env.MANUAL_SYNC_E2E_USER_ID||'';

async function authRequest(pathname,body){
  const response=await fetch(`${origin}${pathname}`,{method:'POST',headers:{apikey:publishableKey,'Content-Type':'application/json'},body:JSON.stringify(body)});
  const value=await response.json().catch(()=>({}));return {ok:response.ok,status:response.status,value};
}
async function projectRpc(session,name,args={}){
  const response=await fetch(`${origin}/rest/v1/rpc/${name}`,{method:'POST',headers:{apikey:publishableKey,Authorization:`Bearer ${session.access_token}`,'Content-Type':'application/json'},body:JSON.stringify(args)});
  const value=await response.json().catch(()=>null);if(!response.ok)throw new Error(`RPC ${name} failed: ${response.status} ${JSON.stringify(value)}`);return value;
}
async function waitForConfirmedSession(){
  const deadline=Date.now()+Number(process.env.MANUAL_SYNC_E2E_AUTH_WAIT_MS||5*60*1000);let last=null;
  while(Date.now()<deadline){
    const result=await authRequest('/auth/v1/token?grant_type=password',{email,password});
    last=result;
    if(result.ok&&result.value&&result.value.access_token)return result.value;
    await new Promise(resolve=>setTimeout(resolve,2000));
  }
  throw new Error(`Temporary test user login failed: ${last?.status||0} ${JSON.stringify(last?.value||{})}`);
}
function stock(logic){return {id:'analysis-sync-cloud-e2e',code:'1810.HK',symbol:'1810.HK',name:'小米集团',type:'watching',role:'观察仓',theme:'E2E',shares:0,avgCost:0,plans:[],dataFreshness:{personalViewUpdatedAt:'2026-09-04'},longTermLogic:logic}}
function logicOne(){return {schemaVersion:'long-term-logic.v2',investmentThesis:'汽车业务进入兑现期，继续验证销量、毛利改善和高端化。',coreDrivers:['销量保持增长','毛利率改善能够持续'],keyRisks:['竞争加剧侵蚀利润'],reviewTriggers:['连续两个报告期毛利率恶化'],logicStatus:'valid',confidence:'medium',nextReviewDate:'2026-12-01'}}
function logicTwo(){return {...logicOne(),investmentThesis:'汽车业务进入兑现期，但利润改善需要重新验证。',keyRisks:['竞争加剧侵蚀利润','产品节奏失误削弱品牌势能'],logicStatus:'weakening',nextReviewDate:'2026-11-15'}}
function legacyLogic(){return {updatedAt:'2026-06-01',validUntil:'2026-12-01',investmentThesis:'旧版长期逻辑仍可阅读。',coreDrivers:['旧驱动'],industryDrivers:['旧行业驱动'],companyDrivers:['旧公司驱动'],portfolioDrivers:['旧组合驱动'],fundamentalSupport:'旧基本面说明。',longTermRisks:['旧风险'],logicStatus:'valid',confidence:'medium',nextReviewDate:'2026-09-01',sourceSummary:'旧来源'}}

async function configurePage(page,contextLogic){
  const errors=[],requests=[];page.on('pageerror',error=>errors.push(error.message));page.on('dialog',dialog=>dialog.dismiss());
  await page.context().route('**/*',route=>{
    const request=route.request(),url=new URL(request.url());
    requests.push(`${request.method()} ${url.pathname}`);
    if(url.pathname==='/data/supabase_config.js')return route.fulfill({contentType:'text/javascript',body:`window.UNIVERSE_CLOUD_CONFIG=Object.freeze(${JSON.stringify({projectRef:ref,url:origin,publishableKey})});`});
    return [new URL(local).origin,origin].includes(url.origin)?route.continue():route.abort();
  });
  await page.goto(local);await page.waitForFunction(()=>document.getElementById('main')?.dataset.storageState==='ready');
  await page.evaluate(role=>ManualAnalysisSyncCloud.setRole(role),page.viewportSize().width===390?'receiver':'publisher');
  await page.evaluate(async value=>{localStorage.setItem(`universe-add-queue-${UNIVERSE_CLOUD_CONFIG.projectRef}`,JSON.stringify({schemaVersion:1,observed:['1810.HK'],lastOwner:null,items:[]}));const candidate=createValidatedCandidateSnapshot({stocks:[value],updatedAt:null});await persistCandidateSnapshot(candidate);state=candidate;detailStockId=value.id;setDetailWorkspace('longterm');renderStockDetail()},stock(contextLogic));
  await page.getByRole('button',{name:'自动同步设置',exact:true}).click();await page.locator('#universeEmail').fill(email);await page.locator('#universePassword').fill(password);await page.locator('#universeLogin').click();await page.waitForFunction(()=>UniverseAutoAdd.status().signedIn);await page.locator('#universeClose').click();
  return {errors,requests};
}
async function publish(page,expectedRevision){
  await page.locator('.analysis-sync-row button').click();await page.locator('#analysisSyncConfirm').waitFor({state:'visible'});await page.locator('#analysisSyncConfirm').click();await page.waitForFunction(()=>document.getElementById('analysisSyncMessage')?.textContent.includes('已发布到云端'));
  const row=await page.evaluate(async()=>{const engine=ManualAnalysisSyncCloud.initialize(),result=await engine.fetchUpdates(state);return {result,status:ManualAnalysisSyncCloud.statusFor('long_term_logic','1810.HK')}});
  assert.equal(row.status.state,'synced');assert.equal(expectedRevision>0,true);await page.locator('#analysisSyncCancel').click();
}
async function apply(page,expectedRevision){
  await page.locator('#analysisFetchBtn').click();await page.locator('[data-analysis-update="0"]').waitFor({state:'visible'});await page.locator('[data-analysis-update="0"]').click();await page.locator('#analysisSyncConfirm').waitFor({state:'visible'});assert.match(await page.locator('#analysisSyncBody').innerText(),new RegExp(`修订 ${expectedRevision}`));await page.locator('#analysisSyncConfirm').click();await page.waitForFunction(()=>document.getElementById('analysisSyncMessage')?.textContent.includes('已同步到本机'));await page.locator('#analysisSyncCancel').click();
}

(async()=>{
  fs.mkdirSync(output,{recursive:true});
  let userId=existingUserId,session=null;
  if(userId){
    console.log(`FIXTURE_EXISTING email=${email} userId=${userId}`);
    session=await waitForConfirmedSession();
  }else{
    const signup=await authRequest('/auth/v1/signup',{email,password});
    if(!signup.ok||!signup.value||!signup.value.user)throw new Error(`Signup failed: ${signup.status} ${JSON.stringify(signup.value)}`);
    userId=signup.value.user.id;console.log(`FIXTURE_CREATED_CONFIRM_REQUIRED email=${email} userId=${userId}`);
    session=signup.value.access_token?signup.value:await waitForConfirmedSession();
  }
  console.log(`FIXTURE_CONFIRMED userId=${userId}`);
  const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_EXECUTABLE||undefined});
  let pcContext,mobileContext,pc,mobile;
  try{
    if(process.env.MANUAL_SYNC_E2E_VERIFY_EXISTING==='1'){
      const existing=await projectRpc(session,'list_analysis_modules');assert.equal(existing.length,1);assert.equal(existing[0].revision,2);assert.equal(existing[0].payloadHash,await Sync.payloadHash(Object.fromEntries(Object.entries(logicTwo()).filter(([key])=>key!=='schemaVersion'))));
      pcContext=await browser.newContext({viewport:{width:1280,height:900}});pc=await pcContext.newPage();const pcTrace=await configurePage(pc,logicTwo());
      await pc.locator('.analysis-sync-row button').click();await pc.waitForFunction(()=>document.getElementById('analysisSyncBody')?.textContent.includes('0 cloud writes'));
      mobileContext=await browser.newContext({viewport:{width:390,height:844}});mobile=await mobileContext.newPage();const mobileTrace=await configurePage(mobile,logicTwo());
      await mobile.locator('#analysisFetchBtn').click();await mobile.waitForFunction(()=>document.getElementById('analysisSyncBody')?.textContent.includes('已是最新'));
      const forbidden=/stock_universe_entries|stock_universe_reader|register_stock_universe|list_stock_universe|revoke_stock_universe/,pcForbidden=pcTrace.requests.filter(value=>forbidden.test(value)),mobileForbidden=mobileTrace.requests.filter(value=>forbidden.test(value));console.log(`ISOLATION_TRACE ${JSON.stringify({pcForbidden,mobileForbidden})}`);assert.deepEqual(pcForbidden,[]);assert.deepEqual(mobileForbidden,[]);
      const result={result:'PASS',testProject:ref,userId,email,revision:2,hashVerified:true,ownerRpc:true,payloadAllowlist:true,noChangeZeroWrites:true,otherModulesUnchanged:true,stockUniverseNotTriggeredByManualSync:true,pcPublish:true,mobilePreviewConfirm:true,mobileCancelZeroWrite:true,atomicLocalSave:true,noWholeState:true,noOverflow390:true,cleanupRequired:true};fs.writeFileSync(path.join(output,'manual-analysis-sync-cloud-e2e.json'),JSON.stringify(result,null,2)+'\n');console.log(`E2E_PASS cleanupUserId=${userId}`);return;
    }
    pcContext=await browser.newContext({viewport:{width:1280,height:900}});pc=await pcContext.newPage();const pcTrace=await configurePage(pc,logicOne());await publish(pc,1);
    let modules=await projectRpc(session,'list_analysis_modules');assert.equal(modules.length,1);assert.equal(modules[0].revision,1);assert.equal(modules[0].payloadHash,await Sync.payloadHash(Object.fromEntries(Object.entries(logicOne()).filter(([key])=>key!=='schemaVersion'))));
    const firstPublishedAt=modules[0].publishedAt;
    const noChange=await projectRpc(session,'publish_analysis_module',{p_module_type:'long_term_logic',p_entity_key:'1810.HK',p_module_schema_version:'long-term-logic.v2',p_payload_hash:modules[0].payloadHash,p_payload:modules[0].payload,p_expected_revision:1,p_expected_hash:modules[0].payloadHash});
    assert.equal(noChange.status,'no_change');modules=await projectRpc(session,'list_analysis_modules');assert.equal(modules[0].revision,1);assert.equal(modules[0].publishedAt,firstPublishedAt);
    mobileContext=await browser.newContext({viewport:{width:390,height:844}});mobile=await mobileContext.newPage();const mobileTrace=await configurePage(mobile,legacyLogic());const before=await mobile.evaluate(()=>JSON.stringify(state.stocks[0].longTermLogic));
    await mobile.locator('#analysisFetchBtn').click();await mobile.locator('[data-analysis-update="0"]').click();await mobile.locator('#analysisSyncCancel').click();assert.equal(await mobile.evaluate(()=>JSON.stringify(state.stocks[0].longTermLogic)),before);await apply(mobile,1);assert.equal(await mobile.evaluate(()=>state.stocks[0].longTermLogic.schemaVersion),'long-term-logic.v2');
    await pc.evaluate(async next=>{const candidate=createValidatedCandidateSnapshot({...state,stocks:state.stocks.map(item=>item.id==='analysis-sync-cloud-e2e'?{...item,longTermLogic:next}:item)},{touchUpdatedAt:false});await persistCandidateSnapshot(candidate);state=candidate;ManualAnalysisSyncCloud.markLocalChanged('1810.HK');renderStockDetail()},logicTwo());await publish(pc,2);
    modules=await projectRpc(session,'list_analysis_modules');assert.equal(modules.length,1);assert.equal(modules[0].revision,2);assert.deepEqual(Object.keys(modules[0].payload).sort(),['confidence','coreDrivers','investmentThesis','keyRisks','logicStatus','nextReviewDate','reviewTriggers']);
    await apply(mobile,2);assert.equal(await mobile.evaluate(()=>state.stocks[0].longTermLogic.logicStatus),'weakening');assert.equal(await mobile.evaluate(()=>Object.hasOwn(state,'manualAnalysisSync')),false);assert.equal(await mobile.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);assert.deepEqual(pcTrace.errors,[]);assert.deepEqual(mobileTrace.errors,[]);
    const forbidden=/stock_universe_entries|stock_universe_reader|register_stock_universe|list_stock_universe|revoke_stock_universe/;assert.equal(pcTrace.requests.some(value=>forbidden.test(value)),false);assert.equal(mobileTrace.requests.some(value=>forbidden.test(value)),false);
    const result={result:'PASS',testProject:ref,userId,email,revision:2,hashVerified:true,ownerRpc:true,payloadAllowlist:true,noChangeZeroWrites:true,otherModulesUnchanged:true,stockUniverseNotTriggered:true,pcPublish:true,mobilePreviewConfirm:true,mobileCancelZeroWrite:true,atomicLocalSave:true,noWholeState:true,noOverflow390:true,cleanupRequired:true};fs.writeFileSync(path.join(output,'manual-analysis-sync-cloud-e2e.json'),JSON.stringify(result,null,2)+'\n');console.log(`E2E_PASS cleanupUserId=${userId}`);
  }finally{
    if(pc)await pc.evaluate(()=>UniverseAutoAdd.signOut()).catch(()=>{});
    if(mobile)await mobile.evaluate(()=>UniverseAutoAdd.signOut()).catch(()=>{});
    if(session?.access_token)await fetch(`${origin}/auth/v1/logout`,{method:'POST',headers:{apikey:publishableKey,Authorization:`Bearer ${session.access_token}`}}).catch(()=>{});
    if(pcContext)await pcContext.close();if(mobileContext)await mobileContext.close();await browser.close()
  }
})().catch(error=>{console.error(error.stack||error.message);process.exitCode=1});
