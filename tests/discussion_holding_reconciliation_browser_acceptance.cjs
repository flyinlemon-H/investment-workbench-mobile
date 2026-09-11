'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright'),F=require('./fixtures/discussion-reliability.js');
const output=path.resolve(process.env.ACCEPTANCE_OUTPUT||'test-results/holding-reconciliation'),url='http://127.0.0.1:8768/';
(async()=>{
  fs.mkdirSync(output,{recursive:true});const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_EXECUTABLE||undefined}),results=[];
  try{for(const viewport of [{width:360,height:800},{width:390,height:844},{width:1280,height:900}]){
    const context=await browser.newContext({viewport}),page=await context.newPage(),errors=[];
    page.on('pageerror',error=>errors.push(error.message));page.on('dialog',dialog=>dialog.dismiss());
    await context.route('**/*',route=>new URL(route.request().url()).origin===new URL(url).origin?route.continue():route.abort());
    await page.goto(url);await page.waitForFunction(()=>document.getElementById('main')?.dataset.storageState==='ready');
    await page.evaluate(()=>{globalThis.reconciliationWrites=0;globalThis.actualSave=saveState;saveState=async(...args)=>{reconciliationWrites++;if(globalThis.failReconciliationSave)return false;return actualSave(...args)};if(window.AiApi)window.AiApi=Object.freeze({...window.AiApi,request:()=>{throw new Error('No paid AI')}})});
    const cases=[];
    for(const [before,after,conflict] of [[6000,3200,false],[3200,0,false],[0,100,false],[3200,0,true],[0,100,true],[3200,3200,false]]){
      await page.evaluate(stock=>{state=createValidatedCandidateSnapshot({stocks:[stock],updatedAt:null});discussionPreparedContexts.clear();render();openStockDetail(stock.id,'ai');startStockDiscussion(state.stocks[0]);closeDiscussionPromptDialog();globalThis.reconciliationWrites=0},F.stock('none',before));
      const original=await page.evaluate(()=>discussionPreparedContexts.get(discussionStockKey(state.stocks[0])));
      await page.evaluate(shares=>{state.stocks[0].shares=shares;renderStockDetail()},after);
      assert.equal(await page.locator('.discussion-context-stale').count(),0);
      // Organize remains available, with today's facts and the original source binding.
      await page.locator('[data-detail-action="prepare-discussion-archive"]').click();
      const archive=await page.locator('#discussionPreparedPrompt').inputValue();assert.ok(archive.includes(original.sourceDiscussionVersion));assert.ok(archive.includes(`当前持仓数量：${after}`));
      await page.locator('#discussionPromptCloseBtn').click();await page.locator('[data-detail-action="import-discussion-state"]').click();
      const current=await page.evaluate(()=>DiscussionWorkbench.buildContext(state.stocks[0],discussionOptions())),raw=F.judgment(current);raw.currentState.sourceDiscussionVersion=original.sourceDiscussionVersion;
      if(conflict)raw.currentState.userDecision.headline=after===0?'保护已有利润，继续持有':'当前没有持仓，暂不建仓';
      const text=JSON.stringify(raw),input=page.locator('#discussionImportText'),confirm=page.locator('#discussionImportConfirmBtn'),ack=page.locator('#discussionHoldingAcknowledgeBtn');
      await input.fill(text);await page.locator('#discussionImportPreviewBtn').click();
      if(before!==after){
        assert.equal(await ack.isVisible(),true);assert.equal(await confirm.isDisabled(),true);assert.equal(await page.locator('#discussionImportPreview').innerHTML(),'');assert.equal(await input.inputValue(),text);
        const message=await page.locator('#discussionImportMessage').innerText();assert.ok(message.includes(before.toLocaleString('zh-CN')));assert.ok(message.includes(after.toLocaleString('zh-CN')));assert.doesNotMatch(message,/重新开始|过期/);
        if((before>0)!==(after>0))assert.match(message,/持仓状态/);
        const box=await page.locator('#discussionImportMessage').boundingBox();assert.ok(box.y>=0&&box.y+box.height<=viewport.height,`warning visible ${JSON.stringify(box)}`);
        const action=await ack.boundingBox();assert.ok(action.y>=0&&action.y+action.height<=viewport.height,'acknowledgment visible');
        await page.screenshot({path:path.join(output,`warning-${before}-${after}-${viewport.width}.png`)});
        // Return/reopen preserves pasted JSON, but acknowledgment stays in the import session.
        await page.locator('#discussionImportReturnBtn').click();await page.locator('[data-detail-action="import-discussion-state"]').click();assert.equal(await input.inputValue(),text);
        await page.locator('#discussionImportPreviewBtn').click();await ack.click();
      }else assert.equal(await ack.isVisible(),false);
      {
        assert.equal(await confirm.isEnabled(),true);assert.equal(await page.evaluate(()=>reconciliationWrites),0);
        if(before===6000){
          // Confirm must refuse a Preview bound to an older canonical quantity.
          await page.evaluate(()=>{state.stocks[0].shares=3300});await confirm.click();assert.equal(await confirm.isDisabled(),true);assert.match(await page.locator('#discussionImportMessage').innerText(),/预览后当前事实已变化/);assert.equal(await page.evaluate(()=>reconciliationWrites),0);assert.equal(await input.inputValue(),text);
          await page.locator('#discussionImportPreviewBtn').click();assert.equal(await ack.isVisible(),true);await ack.click();
          await page.evaluate(()=>{globalThis.beforeFailedSave=JSON.stringify(state);globalThis.failReconciliationSave=true});await confirm.click();assert.equal(await page.evaluate(()=>JSON.stringify(state)===beforeFailedSave),true);
          await page.evaluate(()=>{failReconciliationSave=false;reconciliationWrites=0});await page.locator('#discussionImportPreviewBtn').click();
        }
        await page.evaluate(()=>Promise.all([confirmDiscussionImport(),confirmDiscussionImport()]));assert.equal(await page.evaluate(()=>reconciliationWrites),1);
        assert.equal(await page.evaluate(()=>state.stocks[0].discussionState.current.references.holding.shares),before===6000?3300:after);
        assert.equal(await page.evaluate(()=>state.stocks[0].discussionState.current.acknowledgment),undefined);
        if(conflict)assert.equal(await page.locator('.discussion-post-import-diagnostics').count(),1);
      }
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);cases.push({before,after,conflict,pass:true});
    }
    assert.deepEqual(errors,[]);results.push({viewport,cases,jsonPreserved:true,currentFactSave:true,stalePreviewBlocked:true,atomicFailure:true,doubleSavePrevented:true,noPageErrors:true});await context.close();
  }}finally{await browser.close()}
  fs.writeFileSync(path.join(output,'results.json'),JSON.stringify(results,null,2));console.log(JSON.stringify(results));
})().catch(error=>{console.error(error);process.exitCode=1});
