'use strict';
// Synthetic stocks in fresh browser storage; no external requests or user data.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const F=require('./fixtures/discussion-protected-facts'),E=require('../src/entry-decision');
const url='http://127.0.0.1:8768/',output=path.resolve('test-results/entry/browser');
const ready=()=>({...E.example(),state:'entry_ready',path:'breakout_confirmation',directionConfirmed:true,confirmationSatisfied:true,position:'acceptable',completedConditions:['突破近期压力并稳定保持']});
(async()=>{
  fs.mkdirSync(output,{recursive:true});const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_EXECUTABLE||undefined}),results=[];
  try{for(const viewport of [{width:360,height:800},{width:390,height:844},{width:1280,height:900}]){
    const context=await browser.newContext({viewport}),page=await context.newPage(),errors=[];
    page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.dismiss());
    await context.route('**/*',r=>new URL(r.request().url()).origin===new URL(url).origin?r.continue():r.abort());
    await page.goto(url);await page.waitForFunction(()=>document.getElementById('main')?.dataset.storageState==='ready');await page.waitForLoadState('networkidle');
    await page.evaluate(async stock=>{stock.name='长飞光纤场景·合成验收';stock.plans=[PlanV2.createPlan({id:'entry-legacy-plan',action:'buy',triggerPrice:420,triggerDirection:'below',quantity:100,note:'既有计划',conditions:{technical:['回踩承接'],invalidation:['结构失效']}},{source:'manual'})];stock.plans[0].validityStatus='needs_review';state=createValidatedCandidateSnapshot({stocks:[stock]});await persistCandidateSnapshot(state);render();openStockDetail(stock.id,'ai')},F.stock('none',0));
    const authority=()=>page.evaluate(()=>JSON.stringify({shares:state.stocks[0].shares,plans:state.stocks[0].plans,price:state.stocks[0].currentPrice,runtime:state.planRuntimeStates,orders:state.orders,trades:state.trades}));
    const before=await authority();
    async function importEntry(entry,extra={}){
      await page.locator('[data-detail-action="start-stock-discussion"]').click();await page.locator('#discussionPromptCloseBtn').click();
      const p=await page.evaluate(()=>discussionPreparedContexts.get(discussionStockKey(state.stocks[0]))),raw=F.judgment(p),d=raw.currentState.userDecision,a=raw.currentState.actionAssessment;
      if(entry){for(const [key,summary] of Object.entries({holding:'当前无持仓。',takeProfit:'当前无持仓，不适用。',stopLoss:'尚未持有，无需处理。'}))d[key]={status:'not_applicable',summary};d.positionDirection.summary=entry.state==='entry_ready'?'进入首次建仓复核。':'按当前路径观察。';a.entryDecision=entry;a.headline=E.STATES[entry.state];a.category={wait_setup:'no_action',setup_forming:'wait_confirmation',entry_ready:'entry_review',entry_extended:'wait_confirmation',setup_failed:'no_action'}[entry.state];d.positionDirection.status=['entry_ready','setup_forming'].includes(entry.state)?'add_review':'add_watch';d.addAssessment.status=entry.state==='entry_ready'?'add_review':'wait';d.headline=E.STATES[entry.state];d.addAssessment.summary=entry.state==='entry_ready'?'建仓条件已经满足，可以进入首次建仓复核。':'结合当前路径继续判断。'}
      Object.assign(a,extra);await page.locator('[data-detail-action="import-discussion-state"]').click();await page.locator('#discussionImportText').fill(JSON.stringify(raw));await page.locator('#discussionImportPreviewBtn').click();assert.equal(await page.locator('#discussionImportConfirmBtn').isEnabled(),true);if(entry)assert.equal(await page.locator('#discussionImportPreview .discussion-entry-decision').count(),1);assert.equal(await page.locator('#discussionImportPreview .discussion-post-import-diagnostics').count(),0);await page.locator('#discussionImportConfirmBtn').click();await page.waitForFunction(()=>!document.getElementById('discussionImportDialog').classList.contains('show'));
      assert.equal(await authority(),before);return raw;
    }
    const card=page.locator('.discussion-workbench > .discussion-user-decision-card');
    await importEntry(null,{upgradeConditions:['突破近期压力并稳定保持']});assert.equal(await card.locator('.discussion-entry-decision').count(),0);
    const forming={...E.example(),state:'setup_forming',path:'pullback_confirmation',previousConditions:[{condition:'突破近期压力并稳定保持',status:'pending',evidence:'尚未突破'}],pendingConditions:['突破近期压力并稳定保持']};
    await importEntry(forming,{upgradeConditions:['突破近期压力并稳定保持']});assert.match(await card.innerText(),/建仓条件正在形成/);
    const confirmed={...ready(),previousConditions:[{condition:'突破近期压力并稳定保持',status:'satisfied',evidence:'新增完整日K已突破并保持'}],transitionReason:'没有回踩，直接突破并保持'};
    await importEntry(confirmed,{upgradeConditions:[]});assert.match(await card.locator('.discussion-entry-decision').innerText(),/建仓条件已成立[\s\S]*突破确认/);assert.doesNotMatch(await card.locator('.discussion-entry-decision').innerText(),/尚待确认|继续等待/);assert.equal(await card.locator('.discussion-post-import-diagnostics').count(),0);assert.match(await card.locator('.discussion-program-references').innerText(),/既有 Plan.*程序事实/s);
    await card.scrollIntoViewIfNeeded();await page.screenshot({path:path.join(output,`ready-${viewport.width}.png`),fullPage:true});
    await page.reload();await page.waitForFunction(()=>document.getElementById('main')?.dataset.storageState==='ready');await page.waitForLoadState('networkidle');await page.evaluate(()=>openStockDetail(state.stocks[0].id,'ai'));assert.match(await card.locator('.discussion-entry-decision').innerText(),/建仓条件已成立/);assert.equal(await authority(),before);
    // A contradiction remains importable and is diagnosed against actual saved history.
    await importEntry({...ready(),state:'setup_forming',pendingConditions:['再等一次回踩']},{upgradeConditions:[]});assert.ok(await card.locator('[data-diagnostic="entry_upgrade_not_acknowledged"]').count());assert.ok(await card.locator('[data-diagnostic="entry_downgrade_unexplained"]').count());
    for(const entry of [{...ready(),state:'entry_extended',position:'extended'},{...ready(),path:'platform_breakout',transitionReason:'高位平台收敛后再次突破'},{...ready(),state:'setup_failed',confirmationSatisfied:false,negativeEvidence:[{type:'breakout_failure',detail:'突破后迅速跌回原区域',isNew:true}]}]){await importEntry(entry,{upgradeConditions:[]});assert.match(await card.locator('.discussion-entry-decision').innerText(),new RegExp(E.STATES[entry.state]));assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false)}
    await page.evaluate(()=>{state.stocks[0].shares=100;renderStockDetail()});assert.equal(await card.locator('.discussion-entry-decision').count(),0);
    assert.deepEqual(errors,[]);results.push({viewport,oldV3:true,forming:true,pathMigration:true,ready:true,extended:true,platform:true,failed:true,postImportDiagnostics:true,reload:true,protectedFactsUnchanged:true,heldEntryHidden:true,noOverflow:true,pageErrors:errors});await context.close();
  }}finally{await browser.close()}
  fs.writeFileSync(path.join(output,'results.json'),JSON.stringify(results,null,2));console.log(JSON.stringify(results));
})().catch(e=>{console.error(e);process.exitCode=1});
