'use strict';
// Real Auth and INSERTs target only the test project; isolated browser storage.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const fixturePath=process.argv[2],output=path.resolve(process.argv[3]||'test-results');
const fixture=JSON.parse(fs.readFileSync(fixturePath,'utf8'));
const ref='lblyapnsngqnjimgskkp',origin=`https://${ref}.supabase.co`,local='http://127.0.0.1:8768';
const config={projectRef:ref,url:origin,publishableKey:'sb_publishable_6bk0BQjpjcfNuUZKxdoy7w_Vhws9KSx'};
(async()=>{
  fs.mkdirSync(output,{recursive:true});
  const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_EXECUTABLE||undefined}),results=[];
  try{for(const viewport of [{width:1280,height:900},{width:390,height:844}]){
    const context=await browser.newContext({viewport}),page=await context.newPage(),errors=[],inserts=[];
    page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.dismiss());
    await context.route('**/*',async route=>{
      const request=route.request(),url=new URL(request.url());
      if(url.pathname==='/data/supabase_config.js')return route.fulfill({contentType:'text/javascript',body:`window.UNIVERSE_CLOUD_CONFIG=Object.freeze(${JSON.stringify(config)});`});
      if(url.origin===origin&&url.pathname==='/rest/v1/stock_universe_entries'&&request.method()==='POST'){
        const row=request.postDataJSON();assert.deepEqual(Object.keys(row).sort(),['display_name','symbol','user_id']);
        assert.equal(row.user_id,fixture.userId);assert.ok(!url.searchParams.has('token'));
        const locallyCommitted=await page.evaluate(async symbol=>{
          await StorageManager.flush();const saved=await StorageManager.loadState();
          return UniverseHandoff.universeRows(saved.state?.stocks||saved.stocks).some(r=>r.symbol===symbol);
        },row.symbol);
        assert.equal(locallyCommitted,true,'local durable save precedes the cloud request');inserts.push(row.symbol);
      }
      return [origin,local].includes(url.origin)?route.continue():route.abort();
    });
    await page.goto(local);await page.waitForFunction(()=>document.getElementById('main')?.dataset.storageState==='ready');
    await page.getByRole('button',{name:'自动同步设置',exact:true}).click();
    await page.locator('#universeEmail').fill(fixture.email);await page.locator('#universePassword').fill(fixture.password);
    await page.locator('#universeLogin').click();await page.waitForFunction(()=>UniverseAutoAdd.status().signedIn);
    await page.locator('#universeClose').click();
    async function add(symbol){
      await page.locator('[data-tab="tools"]').click();
      await page.locator('#addBtn').click();await page.locator('#fName').fill('隔离新增验收');
      await page.locator('#fCode').fill(symbol);await page.locator('#fShares').fill('1');
      await page.locator('#fCost').fill('10');await page.locator('#fCurrentPrice').fill('10');
      await page.locator('#saveBtn').click();await page.waitForFunction(()=>!document.getElementById('modal').classList.contains('show'));
      await page.evaluate(()=>UniverseAutoAdd.flush());
    }
    await add('600487.SH');await page.waitForFunction(()=>UniverseAutoAdd.status().state==='synced'&&UniverseAutoAdd.status().synced>0);
    assert.ok(inserts.includes('600487.SS'));assert.match(await page.locator('#universeCloudStatus').innerText(),/等待 PC 更新行情/);
    await context.setOffline(true);const before=inserts.length;await add('688825.SS');
    await page.waitForFunction(()=>UniverseAutoAdd.status().state==='offline');assert.equal(inserts.length,before);
    assert.match(await page.locator('#universeCloudStatus').innerText(),/已保存在本机.*等待联网/);
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
    await page.screenshot({path:path.join(output,`universe-${viewport.width}-offline.png`),fullPage:false});
    await context.setOffline(false);await page.evaluate(()=>window.dispatchEvent(new Event('online')));
    await page.waitForFunction(()=>UniverseAutoAdd.status().state==='synced');
    await page.reload();await page.waitForFunction(()=>UniverseAutoAdd.status().signedIn&&UniverseAutoAdd.status().state==='synced');
    assert.equal(await page.evaluate(()=>state.stocks.some(s=>s.code==='688825.SS')),true);
    await page.getByRole('button',{name:'自动同步设置',exact:true}).click();
    assert.equal(await page.locator('#universeSyncDialog .modal').evaluate(e=>e.scrollWidth>e.clientWidth+1),false);
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
    await page.screenshot({path:path.join(output,`universe-${viewport.width}-settings.png`)});
    if(viewport.width===390){
      const reader=await page.evaluate(()=>UniverseAutoAdd.issueReader());
      fs.writeFileSync(path.join(path.dirname(fixturePath),'reader.json'),JSON.stringify(reader));
    }
    assert.deepEqual(errors,[]);results.push({viewport,realAuth:true,localBeforeCloud:true,canonical:true,offline:true,onlineRetry:true,persistentSession:true,marketPendingDistinct:true,noOverflow:true,pageErrors:errors});
    await page.evaluate(()=>UniverseAutoAdd.signOut());await context.close();
  }}finally{await browser.close()}
  fs.writeFileSync(path.join(output,'universe-browser-results.json'),JSON.stringify(results,null,2));console.log(JSON.stringify(results));
})().catch(e=>{console.error(e.message);process.exitCode=1});
