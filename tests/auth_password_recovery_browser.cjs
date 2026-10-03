'use strict';
// Real bundled SDK + real application, deterministic Auth HTTP fixtures only.
// No remote requests, mailbox access, real credentials, HAR, video, or traces.
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const ROOT=path.resolve(__dirname,'..'),OUTPUT=path.join(ROOT,'test-results/auth-password-recovery');
const REF='lblyapnsngqnjimgskkp',REMOTE=`https://${REF}.supabase.co`,EMAIL='recovery-fixture@example.invalid',USER='11111111-1111-4111-8111-111111111111';
const user={id:USER,email:EMAIL,aud:'authenticated',role:'authenticated',app_metadata:{provider:'email',providers:['email']},user_metadata:{},created_at:'2026-01-01T00:00:00Z'};
function session(){const now=Math.floor(Date.now()/1000);return {access_token:[{alg:'HS256',typ:'JWT'},{sub:USER,role:'authenticated',aud:'authenticated',iat:now,exp:now+3600,session_id:USER}].map(x=>Buffer.from(JSON.stringify(x)).toString('base64url')).join('.')+'.synthetic',refresh_token:'synthetic-recovery-fixture',token_type:'bearer',expires_in:3600,expires_at:now+3600,user}}
const server=http.createServer((req,res)=>{
  const pathname=decodeURIComponent(new URL(req.url,'http://localhost').pathname),file=path.resolve(ROOT,'.'+(pathname==='/'?'/index.html':pathname));
  if(!file.startsWith(ROOT+path.sep)){res.writeHead(403);return res.end()}
  if(!fs.existsSync(file)||!fs.statSync(file).isFile()){res.writeHead(404);return res.end()}
  res.setHeader('Content-Type',file.endsWith('.html')?'text/html; charset=utf-8':file.endsWith('.js')?'application/javascript; charset=utf-8':'application/json');res.end(fs.readFileSync(file));
});
async function main(){
  fs.mkdirSync(OUTPUT,{recursive:true});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const base=`http://127.0.0.1:${server.address().port}/`;
  const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_EXECUTABLE||undefined}),report={mode:'real-bundled-sdk-with-mocked-auth-http',realEmailTest:'NOT_RUN',viewports:[],checks:[]};
  try{
    for(const width of [360,390,1280]){
      const context=await browser.newContext({viewport:{width,height:900}}),page=await context.newPage();let sent=0,updated=0,signins=0,signups=0,logouts=0,sendMode='ok',userMode='ok',mailStarted,releaseMail;const logs=[];
      page.on('console',msg=>logs.push(msg.text()));page.on('pageerror',()=>{throw Error('unexpected browser page error')});
      await context.route('**/*',async route=>{
        const request=route.request(),url=new URL(request.url()),json=(value,status=200)=>route.fulfill({status,contentType:'application/json',body:JSON.stringify(value)});
        if(url.origin===new URL(base).origin&&url.pathname==='/data/supabase_config.js')return route.fulfill({contentType:'text/javascript',body:`window.UNIVERSE_CLOUD_CONFIG=${JSON.stringify({projectRef:REF,url:REMOTE,publishableKey:'sb_publishable_fixture'})}`});
        if(url.origin===REMOTE){
          if(url.pathname==='/auth/v1/recover'){
            sent++;assert.equal(url.searchParams.get('redirect_to'),base+'?auth=recovery');
            if(sendMode==='rate')return json({code:'over_email_send_rate_limit',message:'private server detail'},429);
            if(sendMode==='network')return route.abort();
            if(sendMode==='delayed')await new Promise(resolve=>{releaseMail=resolve;mailStarted()});
            return json({});
          }
          if(url.pathname==='/auth/v1/user'){
            if(userMode==='expired')return json({code:'session_not_found',message:'private server detail'},401);
            if(request.method()==='PUT'){updated++;assert.deepEqual(Object.keys(request.postDataJSON()).filter(k=>request.postDataJSON()[k]!==null),['password'])}
            return json(user);
          }
          if(url.pathname==='/auth/v1/token'){signins++;return json(session())}
          if(url.pathname==='/auth/v1/signup'){signups++;return json({user,session:null})}
          if(url.pathname==='/auth/v1/logout'){logouts++;return route.fulfill({status:204})}
          if(url.pathname.startsWith('/rest/v1/'))return json([]);
          return route.abort();
        }
        return url.origin===new URL(base).origin?route.continue():route.abort();
      });
      const visible=selector=>page.locator(selector).waitFor({state:'visible'});
      const check=async(name,action)=>{await action();report.checks.push({width,name});};
      async function capture(name){
        const overflow=await page.evaluate(()=>{const d=document.querySelector('#passwordRecoveryDialog.show .modal')||document.querySelector('#universeSyncDialog.show .modal');return Boolean(d&&(d.getBoundingClientRect().left<0||d.getBoundingClientRect().right>innerWidth+1||d.scrollWidth>d.clientWidth+1))});
        assert.equal(overflow,false,'dialog must fit viewport');await page.screenshot({path:path.join(OUTPUT,`${width}-${name}.png`),fullPage:true});
      }
      await page.goto(base);await page.waitForFunction(()=>document.querySelector('#main')?.dataset.storageState==='ready');
      const before=await page.evaluate(()=>JSON.stringify(state));
      // Use the actual visible account route rather than opening a private test UI.
      await page.getByRole('button',{name:'更多',exact:true}).click();await page.locator('[data-more-page="tools"]').click();await page.locator('#accountToolsSection summary').click();await page.getByRole('button',{name:'账户与同步设置',exact:true}).click();
      await check('CASE 1 forgot entry visible',async()=>{await visible('#universeForgotPassword');await capture('login')});
      await page.locator('#universeEmail').fill(EMAIL);await page.locator('#universeForgotPassword').click();
      await check('email prefill and empty input',async()=>{assert.equal(await page.locator('#passwordRecoveryEmail').inputValue(),EMAIL);await page.locator('#passwordRecoveryEmail').fill('');await page.locator('#passwordRecoverySend').click();assert.match(await page.locator('#passwordRecoveryMessage').innerText(),/有效邮箱/);assert.equal(sent,0);await capture('forgot')});
      await page.locator('#passwordRecoveryEmail').fill(EMAIL);await page.locator('#passwordRecoverySend').click();await visible('#passwordRecoveryResend');const successText=await page.locator('#passwordRecoveryMessage').innerText();await capture('sent');
      await check('CASE 3/4 known and unknown email same UI',async()=>{await page.locator('#passwordRecoveryResend').click();await page.locator('#passwordRecoveryEmail').fill('unknown@example.invalid');await page.locator('#passwordRecoverySend').click();await visible('#passwordRecoveryResend');assert.equal(await page.locator('#passwordRecoveryMessage').innerText(),successText);assert.equal(sent,2)});
      await check('CASE 6 explicit rate limit without automatic retry',async()=>{await page.locator('#passwordRecoveryResend').click();sendMode='rate';await page.locator('#passwordRecoverySend').click();await page.waitForFunction(()=>document.querySelector('#passwordRecoveryMessage').textContent.includes('请求过于频繁'));assert.equal(sent,3);sendMode='ok'});
      await check('CASE 7 network failure is actionable without automatic email retry',async()=>{sendMode='network';await page.locator('#passwordRecoverySend').click();await page.waitForFunction(()=>document.querySelector('#passwordRecoveryMessage').textContent.includes('网络连接失败'));assert.equal(sent,4);sendMode='ok'});
      await check('closing pending mail request cannot reopen the dialog',async()=>{sendMode='delayed';const started=new Promise(resolve=>{mailStarted=resolve});await page.locator('#passwordRecoverySend').click();await started;await page.locator('#passwordRecoveryClose').click();releaseMail();await page.waitForFunction(()=>!document.querySelector('#passwordRecoverySend').disabled);assert.equal(await page.locator('#passwordRecoveryDialog.show').count(),0);sendMode='ok'});
      // Simulate only an Auth redirect response. Values below are synthetic SDK fixtures.
      const current=session(),hash=new URLSearchParams({access_token:current.access_token,refresh_token:current.refresh_token,expires_in:'3600',expires_at:String(current.expires_at),token_type:'bearer',type:'recovery'});
      await page.goto(base+'?auth=recovery#'+hash);await visible('#passwordRecoveryUpdate');await page.waitForFunction(()=>SupabaseBrowserClient.recovery.getState().status==='ready');
      await check('CASE 8 real SDK recovery event and clean URL',async()=>{assert.equal(new URL(page.url()).hash,'');await capture('new-password');await page.locator('#passwordRecoveryTitle').focus();await page.keyboard.press('Shift+Tab');assert.equal(await page.locator('#passwordRecoveryClose').evaluate(el=>el===document.activeElement),true);await page.keyboard.press('Tab');assert.equal(await page.locator('#passwordRecoveryNew').evaluate(el=>el===document.activeElement),true)});
      await page.locator('#passwordRecoveryNew').fill('new-fixture-password');await page.locator('#passwordRecoveryConfirm').fill('different-fixture');await page.locator('#passwordRecoveryUpdate').click();
      await check('CASE 9 mismatch zero update requests',async()=>{assert.match(await page.locator('#passwordRecoveryMessage').innerText(),/不一致/);assert.equal(updated,0);await capture('mismatch')});
      await check('CASE 10 short password zero update requests',async()=>{await page.locator('#passwordRecoveryNew').fill('short');await page.locator('#passwordRecoveryConfirm').fill('short');await page.locator('#passwordRecoveryUpdate').click();assert.match(await page.locator('#passwordRecoveryMessage').innerText(),/至少 8 位/);assert.equal(updated,0)});
      await page.reload();await page.waitForFunction(()=>SupabaseBrowserClient.recovery.getState().status==='ready');
      await check('CASE 18 reload uses non-secret intent',async()=>{const keys=await page.evaluate(()=>Object.keys(JSON.parse(sessionStorage.getItem('auth-recovery-intent-'+UNIVERSE_CLOUD_CONFIG.projectRef))).sort());assert.deepEqual(keys,['until','userId'])});
      await page.locator('#passwordRecoveryNew').fill('new-fixture-password');await page.locator('#passwordRecoveryConfirm').fill('new-fixture-password');await page.locator('#passwordRecoveryUpdate').click();await page.waitForFunction(()=>SupabaseBrowserClient.recovery.getState().status==='success');
      await check('CASE 11/12 password update and preserved session',async()=>{assert.equal(updated,1);assert.equal(await page.evaluate(async()=>Boolean((await SupabaseBrowserClient.getSession())?.user)),true);assert.match(await page.locator('#passwordRecoveryMessage').innerText(),/密码已更新/);assert.equal(await page.locator('#passwordRecoveryNew').inputValue(),'');await capture('success')});
      await page.locator('#passwordRecoveryClose').click();await page.reload();
      await check('CASE 16/17 ordinary restore and refresh do not reopen recovery',async()=>{await page.evaluate(()=>SupabaseBrowserClient.getClient().auth.refreshSession());assert.equal(await page.locator('#passwordRecoveryDialog.show').count(),0)});
      await page.goto(base+'?auth=recovery#error=access_denied&error_code=otp_expired&error_description=private');await page.waitForFunction(()=>SupabaseBrowserClient.recovery.getState().status==='expired');
      await check('CASE 13/15 expired or reused link preserves valid session and denies form',async()=>{assert.equal(await page.locator('#passwordRecoveryUpdate').isVisible(),false);assert.equal(await page.evaluate(async()=>Boolean((await SupabaseBrowserClient.getSession())?.user)),true);assert.equal(new URL(page.url()).hash,'');await capture('expired')});
      await page.locator('#passwordRecoveryClose').click();
      await check('CASE 14 invalid callback session cannot open password form',async()=>{userMode='expired';await page.goto(base+'?auth=recovery#'+hash);await page.waitForFunction(()=>SupabaseBrowserClient.recovery.getState().status==='expired');assert.equal(await page.locator('#passwordRecoveryUpdate').isVisible(),false);assert.equal(updated,1);userMode='ok';await page.locator('#passwordRecoveryClose').click()});
      await check('CASE 19/20/21 signup signin signout unchanged',async()=>{
        await page.evaluate(()=>openUniverseSyncSettings());await visible('#universeSignout');await page.locator('#universeSignout').click();await visible('#universeLogin');
        await page.locator('#universeEmail').fill(EMAIL);await page.locator('#universePassword').fill('old-fixture-password');await page.locator('#universeSignup').click();await page.waitForFunction(()=>document.querySelector('#universeAuthMessage').textContent.includes('邮件'));assert.equal(signups,1);
        await page.locator('#universePassword').fill('old-fixture-password');await page.locator('#universeLogin').click();await visible('#universeSignout');assert(signins>=1);await page.locator('#universeSignout').click();await visible('#universeLogin');assert.equal(logouts,2);
      });
      assert.equal(await page.evaluate(()=>JSON.stringify(state)),before,'recovery must not mutate business data');
      assert.equal(logs.some(s=>/new-fixture-password|old-fixture-password|synthetic-recovery-fixture|private server detail/.test(s)),false,'credentials and raw server errors never logged');
      report.viewports.push({width,result:'PASS',screens:7,remoteRequests:0});await context.close();
    }
    report.status='PASS';fs.writeFileSync(path.join(OUTPUT,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
  }finally{await browser.close();await new Promise(resolve=>server.close(resolve))}
}
main().catch(error=>{console.error('AUTH_RECOVERY_BROWSER_FAILED: '+error.message);server.close();process.exitCode=1});
