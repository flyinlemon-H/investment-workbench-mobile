'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright'),F=require('./fixtures/discussion-protected-facts');
const output=path.resolve(process.env.ACCEPTANCE_OUTPUT||'test-results/permissive/browser'),url='http://127.0.0.1:8768/';
(async()=>{
  fs.mkdirSync(output,{recursive:true});const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_EXECUTABLE||undefined}),results=[];
  try{for(const viewport of [{width:360,height:800},{width:390,height:844},{width:1280,height:900}]){
    const context=await browser.newContext({viewport}),page=await context.newPage(),errors=[],ai=[];
    page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.dismiss());page.on('request',r=>{if(/\/ai\/(?:request|chat|completion)|deepseek|api\.openai\.com/i.test(r.url()))ai.push(r.url())});
    await context.route('**/*',r=>new URL(r.request().url()).origin===new URL(url).origin?r.continue():r.abort());
    await page.goto(url);await page.waitForFunction(()=>document.getElementById('main')?.dataset.storageState==='ready');await page.waitForLoadState('networkidle');
    const cases=[{id:'match',shares:6000,prose:'当前持有6000股',count:0},{id:'mismatch',shares:6000,prose:'当前持有4000股',count:1},{id:'zero',shares:0,prose:'继续持有，建议减仓20%',count:1},{id:'proposal',shares:0,prose:'当前可以建仓，建议关注60–65，初始仓位3%，建议买入1000股',count:0}];
    for(const c of cases){
      await page.evaluate(async stock=>{state=createValidatedCandidateSnapshot({stocks:[stock],updatedAt:null});await persistCandidateSnapshot(state);discussionPreparedContexts.clear();render();openStockDetail(stock.id,'ai')},F.stock('none',c.shares));
      await page.locator('.discussion-workbench [data-detail-action="start-stock-discussion"]').click();await page.locator('#discussionPromptCloseBtn').click();
      await page.locator('[data-detail-action="import-discussion-state"]').click();
      const prepared=await page.evaluate(()=>discussionPreparedContexts.get(discussionStockKey(state.stocks[0]))),raw=F.judgment(prepared);raw.currentState.userDecision.headline=c.prose;
      await page.evaluate(()=>{globalThis.importBefore=JSON.stringify(state)});
      await page.locator('#discussionImportText').fill(JSON.stringify(raw));await page.locator('#discussionImportPreviewBtn').click();assert.equal(await page.locator('#discussionImportConfirmBtn').isEnabled(),true);assert.equal(await page.locator('#discussionImportPreview .discussion-post-import-diagnostics').count(),0);assert.equal(await page.evaluate(()=>JSON.stringify(state)===importBefore),true);
      await page.locator('#discussionImportConfirmBtn').click();await page.waitForFunction(()=>!document.getElementById('discussionImportDialog').classList.contains('show'));
      assert.equal(await page.locator('.discussion-user-headline h3').innerText(),c.prose);assert.equal(await page.locator('.discussion-post-import-diagnostics').count(),c.count);
      const authority=await page.evaluate(()=>{const project=value=>({stocks:value.stocks.map(stock=>Object.fromEntries(['shares','avgCost','cost','currentPrice','managementCategory','plans','trades','orders','executionLog','longTermLogic','allocationDecision'].map(key=>[key,stock[key]??null]))),...Object.fromEntries(['holdings','trades','orders','executionLog','planReviews','planRuntimeStates','decisionRecords','decisionStates'].map(key=>[key,value[key]??null]))});return {before:project(JSON.parse(importBefore)),after:project(state)}});assert.deepEqual(authority.after,authority.before);

      assert.equal(await page.evaluate(()=>Object.keys(DiscussionV4.store(state).decisions).length),0);
      // Reload reads real persisted storage and uses the same import snapshot.
      await page.reload();await page.waitForFunction(()=>document.getElementById('main')?.dataset.storageState==='ready');await page.waitForLoadState('networkidle');await page.evaluate(()=>openStockDetail(state.stocks[0].id,'ai'));
      assert.equal(await page.locator('.discussion-user-headline h3').innerText(),c.prose);assert.equal(await page.locator('.discussion-post-import-diagnostics').count(),c.count);
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
      if(c.count)await page.locator('.discussion-post-import-diagnostics').scrollIntoViewIfNeeded();
      await page.screenshot({path:path.join(output,`${c.id}-${viewport.width}.png`),fullPage:true});
      if(c.id==='match'){
        await page.evaluate(async()=>{state.stocks[0].shares=3200;await persistCandidateSnapshot(state);renderStockDetail()});assert.equal(await page.locator('.discussion-post-import-diagnostics').count(),0);
        assert.equal(await page.evaluate(()=>state.stocks[0].discussionState.current.references.holding.shares),6000);
        await page.reload();await page.waitForFunction(()=>document.getElementById('main')?.dataset.storageState==='ready');await page.evaluate(()=>openStockDetail(state.stocks[0].id,'ai'));assert.equal(await page.locator('.discussion-post-import-diagnostics').count(),0);
      }
    }
    assert.deepEqual(errors,[]);assert.deepEqual(ai,[]);results.push({viewport,cases:cases.map(c=>c.id),reloadPreservesContext:true,laterFactsDoNotRewriteHistory:true,authorityUnchanged:true,automaticAiRequests:0,noOverflow:true});await context.close();
  }}finally{await browser.close()}
  fs.writeFileSync(path.join(output,'results.json'),JSON.stringify(results,null,2));console.log(JSON.stringify(results));
})().catch(error=>{console.error(error);process.exitCode=1});
