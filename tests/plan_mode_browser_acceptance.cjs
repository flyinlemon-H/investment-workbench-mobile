'use strict';
// Isolated, loopback-only acceptance. Never attach to a user's browser profile.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const output=path.resolve(process.argv[2]||'.'),url='http://127.0.0.1:8768/';
(async()=>{
  const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_EXECUTABLE||undefined});
  const results=[];
  try{for(const viewport of [{width:1280,height:900},{width:390,height:844}]){
    const context=await browser.newContext({viewport}),page=await context.newPage(),errors=[],dialogs=[];
    page.on('pageerror',error=>errors.push(error.message));page.on('dialog',async dialog=>{dialogs.push(dialog.message());await dialog.dismiss()});
    await context.route('**/*',route=>new URL(route.request().url()).origin===new URL(url).origin?route.continue():route.abort());
    await page.goto(url);await page.waitForFunction(()=>document.getElementById('main')?.dataset.storageState==='ready');
    assert.equal(await page.evaluate(()=>state.stocks.length),0);
    await page.evaluate(async()=>{
      const base={schemaVersion:'plan.v2',planVersion:7,action:'reduce',triggerDirection:'above',status:'active',validityStatus:'active',createdAt:'2026-08-20T00:00:00Z',updatedAt:'2026-08-27T00:00:00Z',lastReviewedAt:'2026-08-27T00:00:00Z',priceTriggerStatus:'not_triggered',fullConditionStatus:'unproven',source:'manual',conditions:{technical:['合成条件，仅用于隔离验收']}};
      const plans=[{...base,id:'fixture-price-null',triggerPrice:null,quantity:100,note:'既有计划：价格待定'},{...base,id:'fixture-quantity-null',triggerPrice:40,quantity:null,note:'既有计划：数量待定'},{...base,id:'fixture-both-null',triggerPrice:null,quantity:null,note:'既有条件计划：价格与数量待定'},{...base,id:'fixture-watch',planMode:'state_watch',action:'sell',triggerPrice:35,quantity:100,note:'合成状态观察计划，保持只读'}];
      const candidate=createValidatedCandidateSnapshot({stocks:[{id:'mode-acceptance',name:'隔离兼容验收',code:'600000.SS',type:'holding',shares:0,avgCost:0,currentPrice:34,plans}],updatedAt:null});
      await persistCandidateSnapshot(candidate);state=candidate;render();
    });
    const before=await page.evaluate(()=>JSON.stringify(state.stocks[0].plans));
    const originalPanel=await page.evaluate(()=>positionPlanPanel(state.stocks[0]));assert.match(originalPanel,/状态观察计划（只读）/);assert.doesNotMatch(originalPanel,/sell 35/);
    await page.evaluate(()=>openModal('mode-acceptance'));await page.locator('#fNotes').fill('仅修改标的备注');
    assert.equal(await page.locator('#buyRows [data-field]').count(),0);assert.equal(await page.locator('#sellRows [data-field="triggerPrice"]').count(),3);
    assert.match(await page.locator('#planEditorReadOnly').innerText(),/状态观察计划.*暂不支持/);
    await page.locator('#planEditorReadOnly').scrollIntoViewIfNeeded();await page.screenshot({path:path.join(output,'phase1a-'+viewport.width+'-editor.png')});
    await page.locator('#saveBtn').click();await page.waitForFunction(()=>!document.getElementById('modal').classList.contains('show'));
    assert.equal(await page.evaluate(()=>JSON.stringify(state.stocks[0].plans)),before);
    await page.reload();await page.waitForFunction(()=>document.getElementById('main')?.dataset.storageState==='ready');
    assert.equal(await page.evaluate(()=>JSON.stringify(state.stocks[0].plans)),before);
    await page.evaluate(()=>openStockDetail('mode-acceptance','plan'));await page.evaluate(()=>openPlanCenter());
    assert.match(await page.locator('#main').innerText(),/状态观察计划/);assert.equal(await page.locator('[data-execute-plan="fixture-watch"]').count(),0);
    await page.screenshot({path:path.join(output,'phase1a-'+viewport.width+'-plans.png'),fullPage:true});
    await page.evaluate(()=>{closePlanCenter();openStockDetail('mode-acceptance','ai')});
    console.log('NAV '+viewport.width+' '+(await page.locator('[data-workspace-tab]').allTextContents()).join(' / '));
    assert.match(await page.locator('#main').innerText(),/当前状态|当前正式状态|Current State/);
    await page.screenshot({path:path.join(output,'phase1a-'+viewport.width+'-discussion.png'),fullPage:true});
    await page.evaluate(()=>PlanReviewUI.open());assert.ok((await page.locator('#planReviewRequestText').inputValue()).length>0);
    await page.screenshot({path:path.join(output,'phase1a-'+viewport.width+'-review.png')});await page.evaluate(()=>PlanReviewUI.close());
    const facts=await page.evaluate(()=>({count:state.stocks.length,shares:state.stocks[0].shares,plans:state.stocks[0].plans.length,execution:state.executionLog?.length||0,overflow:document.documentElement.scrollWidth>innerWidth,planCount:plansCount('sell'),modes:state.stocks[0].plans.map(p=>p.planMode)}));
    assert.equal(facts.count,1);assert.equal(facts.shares,0);assert.equal(facts.execution,0);assert.equal(facts.plans,4);assert.equal(facts.overflow,false);assert.deepEqual(errors,[]);assert.deepEqual(dialogs,[]);
    assert.equal(await page.getByRole('button',{name:/PC.*mobile|PC.*手机|电脑模式|手机模式/i}).count(),0);
    await page.evaluate(async()=>{const empty=createValidatedCandidateSnapshot({stocks:[],updatedAt:null});await persistCandidateSnapshot(empty);state=empty;StorageManager.close();if(window.MultiTabProtection)MultiTabProtection.close();localStorage.clear();for(const db of await indexedDB.databases()){await new Promise((resolve,reject)=>{const req=indexedDB.deleteDatabase(db.name);req.onsuccess=resolve;req.onerror=reject;req.onblocked=resolve})}});
    await context.close();results.push({viewport,...facts,errors,dialogs,cleaned:true});
  }}finally{await browser.close()}
  fs.writeFileSync(path.join(output,'phase1a-browser-results.json'),JSON.stringify(results,null,2));console.log(JSON.stringify(results,null,2));
})().catch(error=>{console.error(error);process.exitCode=1});
