'use strict';
// Real bundled SDK + application, synthetic HTTP only. No production credentials or remote writes.
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const ROOT=path.resolve(__dirname,'..'),OUTPUT=path.join(ROOT,'test-results/auth-login-feedback');
const REF='lblyapnsngqnjimgskkp',REMOTE=`https://${REF}.supabase.co`,EMAIL='login-fixture@example.invalid',PASSWORD='fixture-login-password',PRIVATE='RAW_AUTH_FIXTURE_NEVER_DISPLAY';
const user={id:'11111111-1111-4111-8111-111111111111',email:EMAIL,aud:'authenticated',role:'authenticated',app_metadata:{provider:'email',providers:['email']},user_metadata:{},created_at:'2026-01-01T00:00:00Z'};
function session(){const now=Math.floor(Date.now()/1000);return {access_token:[{alg:'HS256',typ:'JWT'},{sub:user.id,role:'authenticated',aud:'authenticated',iat:now,exp:now+3600}].map(x=>Buffer.from(JSON.stringify(x)).toString('base64url')).join('.')+'.synthetic',refresh_token:'synthetic-login-refresh',token_type:'bearer',expires_in:3600,expires_at:now+3600,user}}
const server=http.createServer((req,res)=>{
  const pathname=decodeURIComponent(new URL(req.url,'http://localhost').pathname),file=path.resolve(ROOT,'.'+(pathname==='/'?'/index.html':pathname));
  if(!file.startsWith(ROOT+path.sep)||!fs.existsSync(file)||!fs.statSync(file).isFile()){res.writeHead(404);return res.end()}
  res.setHeader('Content-Type',file.endsWith('.html')?'text/html; charset=utf-8':file.endsWith('.js')?'application/javascript; charset=utf-8':'application/json');res.end(fs.readFileSync(file));
});
async function main(){
  fs.mkdirSync(OUTPUT,{recursive:true});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const base=`http://127.0.0.1:${server.address().port}/`;
  const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_EXECUTABLE||undefined});
  const report={mode:'Chromium mobile viewport simulation; not real iOS Safari or WebKit',remoteRequests:0,checks:[],viewports:[]};
  try{for(const width of [360,390,1280]){
    const context=await browser.newContext({viewport:{width,height:844}}),page=await context.newPage();
    let mode='ok',signins=0,signups=0,updates=0,releasePending=null;const logs=[],pageErrors=[];
    page.on('console',msg=>logs.push(msg.text()));page.on('pageerror',error=>pageErrors.push(error.message));
    await context.route('**/*',async route=>{
      const request=route.request(),url=new URL(request.url()),json=(value,status=200)=>route.fulfill({status,contentType:'application/json',headers:{'X-Supabase-Api-Version':'2024-01-01','Access-Control-Expose-Headers':'X-Supabase-Api-Version'},body:JSON.stringify(value)});
      if(url.origin===new URL(base).origin&&url.pathname==='/data/supabase_config.js')return route.fulfill({contentType:'application/javascript',body:`window.UNIVERSE_CLOUD_CONFIG=${JSON.stringify({projectRef:REF,url:REMOTE,publishableKey:'sb_publishable_fixture'})}`});
      if(url.origin===REMOTE){
        if(url.pathname==='/auth/v1/token'){
          signins++;if(mode==='pending'){await new Promise(resolve=>{releasePending=resolve});return json({code:'invalid_credentials',message:PRIVATE},400)}
          if(mode==='network')return route.abort();
          if(mode==='ok')return json(session());
          return json({code:mode==='unknown'?PRIVATE:mode,message:PRIVATE,password:PASSWORD,access_token:'synthetic-sensitive-payload'},mode==='over_request_rate_limit'?429:mode==='service'?503:400);
        }
        if(url.pathname==='/auth/v1/signup'){signups++;return json({user,session:null})}
        if(url.pathname==='/auth/v1/user'){if(request.method()==='PUT')updates++;return json(user)}
        if(url.pathname==='/auth/v1/logout')return route.fulfill({status:204});
        if(url.pathname.startsWith('/rest/v1/'))return json([]);
        return route.abort();
      }
      return url.origin===new URL(base).origin?route.continue():route.abort();
    });
    const check=async(name,work)=>{await work();report.checks.push({width,name})};
    const feedback=()=>page.locator('#universeLoginFeedback');
    async function inside(selector){
      await page.waitForFunction(selector=>{const e=document.querySelector(selector),modal=e?.closest('.modal');if(!e||e.hidden||!modal)return false;const r=e.getBoundingClientRect(),m=modal.getBoundingClientRect();return r.top>=Math.max(0,m.top)-1&&r.bottom<=Math.min(innerHeight,m.bottom)+1&&r.left>=0&&r.right<=innerWidth+1},selector);
    }
    async function capture(name,selector){if(selector)await inside(selector);await page.screenshot({path:path.join(OUTPUT,`${width}-${name}.png`)});}
    async function open(){await page.evaluate(()=>openUniverseSyncSettings())}
    async function login(password=PASSWORD){await page.locator('#universeEmail').fill(EMAIL);await page.locator('#universePassword').fill(password);await page.locator('#universeLogin').click();await page.waitForFunction(()=>!document.getElementById('universeLogin').disabled)}
    async function logout(){await page.locator('#universeSignout').click();await page.locator('#universeLogin').waitFor({state:'visible'})}
    await page.goto(base);await page.waitForFunction(()=>document.querySelector('#main')?.dataset.storageState==='ready');const before=await page.evaluate(()=>JSON.stringify(state));
    await page.getByRole('button',{name:'更多',exact:true}).click();await page.locator('[data-more-page="tools"]').click();await page.locator('#accountToolsSection summary').click();await page.getByRole('button',{name:'账户与同步设置',exact:true}).click();
    await check('normal login and forgot controls visible',async()=>{await inside('#universeLogin');await capture('A-login','#universeForgotPassword')});
    await check('CASE 1 empty email does not submit',async()=>{await page.locator('#universeLogin').click();assert.equal(await feedback().innerText(),'请输入邮箱。');assert.equal(signins,0);await inside('#universeLoginFeedback')});
    await check('CASE 2 empty password does not submit; editing clears error',async()=>{await page.locator('#universeEmail').fill(EMAIL);assert.equal(await feedback().isVisible(),false);await page.locator('#universeLogin').click();assert.equal(await feedback().innerText(),'请输入密码。');assert.equal(signins,0)});
    await check('CASE 5 signup six characters still rejected',async()=>{await page.locator('#universePassword').fill('xxxxxx');await page.locator('#universeSignup').click();assert.equal(signups,0);assert.match(await page.locator('#universeAuthMessage').innerText(),/至少 8 位/)});
    await check('signup eight-character policy preserves email confirmation flow',async()=>{await page.locator('#universePassword').fill(PASSWORD);await page.locator('#universeSignup').click();await page.waitForFunction(()=>document.getElementById('universeAuthMessage').textContent.includes('邮件'));assert.equal(signups,1)});
    await page.evaluate(()=>{window.__loginEvents=[];SupabaseBrowserClient.onAuthStateChange(event=>__loginEvents.push(event))});
    for(const length of [6,7])await check(`CASE ${length===6?3:4} ${length}-character login calls SDK and stores session`,async()=>{const count=signins;await login('x'.repeat(length));await page.locator('#universeSignout').waitFor({state:'visible'});assert.equal(signins,count+1);assert.equal(await page.evaluate(()=>Boolean(localStorage.getItem('universe-auth-'+UNIVERSE_CLOUD_CONFIG.projectRef))&&UniverseAutoAdd.status().signedIn),true);await logout()});
    const errors=[['invalid_credentials','invalid_credentials','邮箱或密码不正确。','C-invalid'],['email_not_confirmed','email_unconfirmed','该账户的邮箱尚未完成确认，请先完成邮箱确认。','E-unconfirmed'],['over_request_rate_limit','rate_limited','尝试次数过多，请稍后再试。','rate'],['network','network','无法连接登录服务，请检查网络后重试。','D-network'],['service','service','登录服务暂时不可用，请稍后再试。','service'],['unknown','unknown','登录未完成，请重试。','unknown']];
    for(const [failure,category,message,screen] of errors)await check('CASE 7-15 '+category+' safe error and enabled retry',async()=>{
      mode=failure;await login();assert.equal(await feedback().innerText(),message);assert.equal(await feedback().getAttribute('data-category'),category);assert.equal(await page.locator('#universePassword').inputValue(),'');assert.equal(await page.locator('#universeLogin').isEnabled(),true);assert.equal(await page.locator('#passwordRecoveryDialog.show').count(),0);
      const diagnostic=await page.evaluate(()=>AuthLoginFeedback.getDiagnostic());assert.equal(diagnostic.category,category);assert.equal(diagnostic.operation,'sign_in');assert.equal(JSON.stringify(diagnostic).includes(PRIVATE),false);assert.equal((await page.locator('body').innerText()).includes(PRIVATE),false);await capture(screen,'#universeLoginFeedback');
    });
    await check('CASE 16 explicit loading and one request for repeated click',async()=>{
      mode='pending';await page.locator('#universePassword').fill(PASSWORD);await page.locator('#universeLogin').click();await page.waitForFunction(()=>document.getElementById('universeLogin').textContent==='登录中…');const count=signins;
      assert.equal(await page.locator('#universeLogin').isDisabled(),true);await page.evaluate(()=>document.getElementById('universeLogin').click());assert.equal(signins,count);await capture('B-loading','#universeLoginFeedback');releasePending();await page.waitForFunction(()=>!document.getElementById('universeLogin').disabled);
    });
    await check('CASE 20 forgot clears login errors without opening password update',async()=>{await page.locator('#universeForgotPassword').click();assert.equal(await feedback().textContent(),'');assert.equal(await page.evaluate(()=>AuthLoginFeedback.getDiagnostic()),null);await capture('G-forgot','#passwordRecoveryEmail');assert.equal(await page.locator('#passwordRecoveryUpdate').isVisible(),false);await page.locator('#passwordRecoveryClose').click();await open()});
    await check('CASE 22 close/reopen clears stale error',async()=>{mode='invalid_credentials';await login();await page.locator('#universeClose').click();await open();assert.equal(await feedback().isVisible(),false);assert.equal(await page.evaluate(()=>AuthLoginFeedback.getDiagnostic()),null)});
    await check('late failure cannot restore closed/reopened error',async()=>{mode='pending';await page.locator('#universePassword').fill(PASSWORD);await page.locator('#universeLogin').click();await page.locator('#universeClose').click();await open();releasePending();await page.waitForFunction(()=>!document.getElementById('universeLogin').disabled);assert.equal(await feedback().isVisible(),false)});
    if(width<500)await check('reduced viewport simulates keyboard occlusion; feedback remains visible',async()=>{await page.setViewportSize({width,height:460});mode='network';await login();await inside('#universeLoginFeedback');await capture('keyboard-feedback');await page.setViewportSize({width,height:844})});
    await check('CASE 17-19 success clears error, emits SIGNED_IN, hides login and shows account',async()=>{
      mode='ok';await login();await page.locator('#universeSignout').waitFor({state:'visible'});assert.equal(await page.locator('#universeLoginFields').isVisible(),false);assert.equal(await page.evaluate(()=>__loginEvents.includes('SIGNED_IN')),true);assert.equal(await page.evaluate(()=>AuthLoginFeedback.getDiagnostic()),null);assert.equal(await feedback().textContent(),'');await capture('F-success','#universeSignout');
    });
    await check('session restore and external SIGNED_IN preserve account UI',async()=>{
      await page.reload();await page.waitForFunction(()=>UniverseAutoAdd.status().signedIn);await open();await page.locator('#universeSignout').waitFor({state:'visible'});await logout();await page.evaluate(({email,password})=>SupabaseBrowserClient.getClient().auth.signInWithPassword({email,password}),{email:EMAIL,password:PASSWORD});await page.locator('#universeSignout').waitFor({state:'visible'});
    });
    await check('CASE 6/21 PASSWORD_RECOVERY form and six-character rejection unchanged',async()=>{
      const current=session(),hash=new URLSearchParams({access_token:current.access_token,refresh_token:current.refresh_token,expires_in:'3600',expires_at:String(current.expires_at),token_type:'bearer',type:'recovery'});
      await page.goto(base+'?auth=recovery#'+hash);await page.waitForFunction(()=>SupabaseBrowserClient.recovery.getState().status==='ready');await capture('H-recovery','#passwordRecoveryUpdate');await page.locator('#passwordRecoveryNew').fill('xxxxxx');await page.locator('#passwordRecoveryConfirm').fill('xxxxxx');await page.locator('#passwordRecoveryUpdate').click();assert.equal(updates,0);assert.match(await page.locator('#passwordRecoveryMessage').innerText(),/至少 8 位/);
    });
    await check('CASE 13/14 no credential or raw error diagnostic/log and no business writes',async()=>{
      for(const secret of [PRIVATE,PASSWORD,'synthetic-login-refresh','synthetic-sensitive-payload',EMAIL])assert.equal(logs.some(line=>line.includes(secret)),false,'sensitive console data');
      assert.deepEqual(pageErrors,[]);assert.equal(await page.evaluate(()=>JSON.stringify(state)),before);
    });
    report.viewports.push({width,status:'PASS'});await context.close();
  }report.status='PASS';fs.writeFileSync(path.join(OUTPUT,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
  }finally{await browser.close();await new Promise(resolve=>server.close(resolve))}
}
main().catch(error=>{console.error('AUTH_LOGIN_FEEDBACK_BROWSER_FAILED: '+error.message);server.close();process.exitCode=1});
