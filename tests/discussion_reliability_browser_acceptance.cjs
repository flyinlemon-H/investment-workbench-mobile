'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright'),F=require('./fixtures/discussion-protected-facts.js');
const output=path.resolve(process.env.ACCEPTANCE_OUTPUT||'test-results/discussion-reliability'),url='http://127.0.0.1:8768/';
(async()=>{
  fs.mkdirSync(output,{recursive:true});const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_EXECUTABLE||undefined}),results=[];
  try{for(const viewport of [{width:360,height:800},{width:390,height:844},{width:1280,height:900}]){
    const context=await browser.newContext({viewport}),page=await context.newPage(),errors=[],aiRequests=[];
    page.on('request',request=>{if(/\/ai\/(?:request|chat|completion)|deepseek|api\.openai\.com/i.test(request.url()))aiRequests.push(request.url())});
    page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.dismiss());
    await context.route('**/*',r=>new URL(r.request().url()).origin===new URL(url).origin?r.continue():r.abort());
    await page.goto(url);await page.waitForFunction(()=>document.getElementById('main')?.dataset.storageState==='ready');await page.waitForLoadState('networkidle');
    await page.evaluate(()=>{globalThis.hotfixWrites=0;globalThis.hotfixStarts=0;globalThis.hotfixRealSave=saveState;saveState=async(...args)=>{hotfixWrites++;if(globalThis.hotfixSaveFail)return false;return hotfixRealSave(...args)};const realStart=startStockDiscussion;startStockDiscussion=(...args)=>{hotfixStarts++;return realStart(...args)};if(window.AiApi)window.AiApi=Object.freeze({...window.AiApi,request:()=>{throw new Error('Paid AI forbidden')}})});
    const scenarios=[];
    for(const kind of ['v3','v1','v2','none','historical','pending','stale']){
      const stock=F.stock(kind==='stale'?'v3':kind,kind==='v3'?100:0);
      if(kind==='stale'){stock.recentCatalyst={analysisDate:'2026-07-15',todayCatalyst:'旧资料，仅作背景',freshnessStatus:'stale'};stock.longTermLogic={investmentThesis:'历史逻辑',updatedAt:'2026-07-15'}}
      await page.evaluate(stock=>{state=createValidatedCandidateSnapshot({stocks:[stock],updatedAt:null});discussionPreparedContexts.clear();render();openStockDetail(stock.id,'ai')},stock);
      const start=page.locator('.discussion-workbench [data-detail-action="start-stock-discussion"]'),archive=page.locator('[data-detail-action="prepare-discussion-archive"]');
      assert.equal(await start.count(),1);assert.equal(await archive.count(),1);assert.equal(await page.locator('.discussion-actions').count(),1);
      const duplicates=await page.evaluate(()=>{const ids=[...document.querySelectorAll('[id]')].map(n=>n.id);return ids.filter((id,i)=>ids.indexOf(id)!==i)});assert.deepEqual(duplicates,[]);
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
      const box=await start.boundingBox();assert.ok(box.y>=0&&box.y+box.height<=viewport.height,`${kind} CTA first viewport ${JSON.stringify(box)}`);
      const count=await page.evaluate(()=>hotfixStarts);await start.click();assert.equal(await page.evaluate(()=>hotfixStarts),count+1);
      const request=await page.locator('#discussionPreparedPrompt').inputValue();if(stock.shares===0)assert.match(request,/当前持仓数量：0[\s\S]*当前为零持仓标的/);
      await page.locator('#discussionPromptCloseBtn').click();
      if(kind==='pending'){assert.match(await page.locator('.discussion-technical-readiness').innerText(),/待|不足|缺|未/);await archive.click();assert.equal(await page.locator('#discussionPromptDialog').evaluate(n=>n.classList.contains('show')),false)}
      if(['v1','v3','none','pending'].includes(kind))await page.screenshot({path:path.join(output,`${kind}-${viewport.width}.png`),fullPage:true});
      scenarios.push(kind);
    }
    // Isolated canonical storage, deterministic zero and held imports, no remote writes.
    for(const shares of [0,100]){
      await page.evaluate(async stock=>{state=createValidatedCandidateSnapshot({stocks:[stock],updatedAt:null});await persistCandidateSnapshot(state);discussionPreparedContexts.clear();render();openStockDetail(stock.id,'ai');globalThis.hotfixBefore=JSON.stringify(state);globalThis.hotfixWrites=0},F.stock('none',shares));
      await page.locator('[data-detail-action="import-discussion-state"]').click();
      const prepared=await page.evaluate(()=>discussionPreparedContexts.get(discussionStockKey(state.stocks[0]))),valid=F.judgment(prepared),textarea=page.locator('#discussionImportText'),confirm=page.locator('#discussionImportConfirmBtn');
      assert.equal(await confirm.isDisabled(),true);
      await page.evaluate(()=>{globalThis.hotfixBefore=JSON.stringify(state)});
      for(const [kind,wording] of Object.entries(F.cases)){
        const raw=JSON.stringify(F.output(prepared,wording));await textarea.fill(raw);await page.locator('#discussionImportPreviewBtn').click();
        assert.equal(await confirm.isEnabled(),true);assert.equal(await textarea.inputValue(),raw);assert.equal(await page.locator('#discussionImportPreview .discussion-post-import-diagnostics').count(),0);assert.equal(await page.evaluate(()=>hotfixWrites),0);
      }
      // Structural failure still preserves raw input and disables Confirm even after DOM tampering.
      await textarea.fill('{');await page.locator('#discussionImportPreviewBtn').click();assert.equal(await confirm.isDisabled(),true);
      await page.evaluate(async()=>{document.getElementById('discussionImportConfirmBtn').disabled=false;await confirmDiscussionImport()});assert.equal(await confirm.isDisabled(),true);assert.equal(await page.evaluate(()=>hotfixWrites),0);
      await page.locator('#discussionImportReturnBtn').click();await page.locator('[data-detail-action="import-discussion-state"]').click();assert.equal(await textarea.inputValue(),'{');
      valid.currentState.userDecision.warning.summary=F.qualitative;
      await textarea.fill(JSON.stringify(valid));assert.equal(await confirm.isDisabled(),true);await page.locator('#discussionImportPreviewBtn').click();assert.equal(await confirm.isEnabled(),true);assert.equal(await page.evaluate(()=>hotfixWrites),0);
      // Direct DOM value changes cannot adopt an old valid preview.
      await page.evaluate(()=>{document.getElementById('discussionImportText').value='{}'});await confirm.click();assert.equal(await confirm.isDisabled(),true);assert.equal(await page.evaluate(()=>hotfixWrites),0);
      await textarea.fill(JSON.stringify(valid));await page.locator('#discussionImportPreviewBtn').click();
      await page.evaluate(()=>{globalThis.hotfixBefore=JSON.stringify(state);globalThis.hotfixSaveFail=true});await confirm.click();assert.equal(await confirm.isDisabled(),true);assert.equal(await page.evaluate(()=>JSON.stringify(state)===hotfixBefore),true);
      await page.evaluate(()=>{hotfixSaveFail=false;hotfixWrites=0});await page.locator('#discussionImportPreviewBtn').click();assert.equal(await confirm.isEnabled(),true);
      await page.screenshot({path:path.join(output,`valid-${shares}-${viewport.width}.png`),fullPage:true});
      await page.evaluate(()=>Promise.all([confirmDiscussionImport(),confirmDiscussionImport()]));assert.equal(await page.evaluate(()=>hotfixWrites),1);
      assert.equal(await page.evaluate(()=>state.stocks[0].discussionState.current.references.holding.shares),shares);
      assert.equal(await page.evaluate(()=>Object.keys(DiscussionV4.store(state).decisions).length),0);
      await page.reload();await page.waitForFunction(()=>document.getElementById('main')?.dataset.storageState==='ready');assert.equal(await page.evaluate(()=>state.stocks[0].discussionState.current.references.holding.shares),shares);
      // Restore instrumentation after reload for the next isolated fixture.
      await page.evaluate(()=>{globalThis.hotfixRealSave=saveState;saveState=async(...args)=>{hotfixWrites++;if(globalThis.hotfixSaveFail)return false;return hotfixRealSave(...args)}});
    }
    assert.deepEqual(errors,[]);assert.deepEqual(aiRequests,[]);results.push({viewport,scenarios,protectedFactCases:Object.keys(F.cases),proposalPreviewZeroWrites:true,structuralRetryPreservesInput:true,realUserDecisionsCreated:0,automaticAiRequests:aiRequests.length,uniqueCTA:true,oneActionPerTap:true,invalidImportDisabled:true,invalidZeroWrites:true,recoveryPreservesInput:true,validZeroAndHeldSave:true,storageFailureAtomic:true,doubleSavePrevented:true,noPageErrors:true});await context.close();
  }}finally{await browser.close()}
  fs.writeFileSync(path.join(output,'results.json'),JSON.stringify(results,null,2));console.log(JSON.stringify(results));
})().catch(error=>{console.error(error);process.exitCode=1});
