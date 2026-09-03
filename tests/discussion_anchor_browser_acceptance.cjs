'use strict';
// Real application handlers in isolated browser storage; all external requests blocked.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const raw=fs.readFileSync(path.join(__dirname,'fixtures/production-current-state-600487-missing-anchor.json.txt'),'utf8');
const output=path.resolve(process.argv[2]||'.'),url='http://127.0.0.1:8768/';
(async()=>{
  const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_EXECUTABLE||undefined}),results=[];
  try{for(const viewport of [{width:1280,height:900},{width:390,height:844}]){
    const context=await browser.newContext({viewport}),page=await context.newPage(),errors=[],dialogs=[];
    page.on('pageerror',e=>errors.push(e.message));page.on('dialog',async d=>{dialogs.push(d.message());await d.dismiss()});
    await context.route('**/*',r=>new URL(r.request().url()).origin===new URL(url).origin?r.continue():r.abort());
    await page.goto(url);await page.waitForFunction(()=>document.getElementById('main')?.dataset.storageState==='ready');
    await page.evaluate(async()=>{
      const candidate=createValidatedCandidateSnapshot({stocks:[{id:'anchor-acceptance',code:'600487.SS',name:'隔离锚点验收',type:'holding',shares:100,avgCost:18,currentPrice:20,capPct:20,priceHistory:[],plans:[]}],updatedAt:null});
      await persistCandidateSnapshot(candidate);state=candidate;render();openStockDetail('anchor-acceptance','discussion');
      globalThis.anchorAttempts=0;globalThis.anchorRealSave=saveState;
      saveState=async(...args)=>{anchorAttempts++;return anchorRealSave(...args)};
      startStockDiscussion(state.stocks[0]);
    });
    assert.equal(await page.locator('#discussionPromptDialog').evaluate(e=>e.classList.contains('show')),true);
    await page.evaluate(()=>{closeDiscussionPromptDialog();prepareDiscussionArchive(state.stocks[0])});
    assert.match(dialogs.at(-1),/完整日K技术锚点.*当前讨论可以继续/);
    // Old/open modal defense: intentionally bypass only the early entry, then use real preview/confirm handlers.
    const oldRaw=await page.evaluate(raw=>{
      const stock=state.stocks[0],prepared=discussionPreparedContexts.get(discussionStockKey(stock));
      const dialog=ensureDiscussionImportDialog();dialog.dataset.stockId=stock.id;dialog.classList.add('show');
      return raw.replace('__SOURCE_DISCUSSION_VERSION__',prepared.sourceDiscussionVersion);
    },raw);
    await page.locator('#discussionImportText').fill(oldRaw);await page.locator('#discussionImportPreviewBtn').click();
    assert.equal(await page.locator('#discussionImportConfirmBtn').isDisabled(),true);
    assert.match(await page.locator('#discussionImportMessage').innerText(),/AI结论格式已通过校验.*暂不能保存/);
    async function visibleStatus(label){
      const box=await page.locator('#discussionImportMessage').boundingBox();assert.ok(box&&box.y>=0&&box.y+box.height<=viewport.height,label);
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,'document overflow');
      assert.equal(await page.locator('#discussionImportDialog .modal').evaluate(e=>e.scrollWidth>e.clientWidth+1),false,'modal overflow');
      await page.screenshot({path:path.join(output,`anchor-${viewport.width}-${label}.png`)});
    }
    await visibleStatus('missing');assert.equal(await page.evaluate(()=>anchorAttempts),0);
    await page.evaluate(()=>{
      closeDiscussionImportDialog();state.stocks[0].priceHistory=[{date:'2026-09-02',close:20,is_complete_bar:true,adjustment:'qfq',price_basis:'adjusted',provider:'fixture'}];
      prepareDiscussionArchive(state.stocks[0]);
    });
    assert.match(dialogs.at(-1),/重新开始讨论并整理结论/);
    async function prepareValid(){
      const bound=await page.evaluate(raw=>{
        startStockDiscussion(state.stocks[0]);closeDiscussionPromptDialog();openDiscussionImportDialog(state.stocks[0]);
        return raw.replace('__SOURCE_DISCUSSION_VERSION__',discussionPreparedContexts.get(discussionStockKey(state.stocks[0])).sourceDiscussionVersion);
      },raw);
      await page.locator('#discussionImportText').fill(bound);await page.locator('#discussionImportPreviewBtn').click();
      assert.equal(await page.locator('#discussionImportConfirmBtn').isEnabled(),true,await page.locator('#discussionImportMessage').innerText());
    }
    await prepareValid();await page.locator('#discussionImportConfirmBtn').click();
    await page.waitForFunction(()=>!document.getElementById('discussionImportDialog').classList.contains('show'));
    assert.equal(await page.evaluate(()=>anchorAttempts),1);
    assert.equal(await page.evaluate(()=>DiscussionWorkbench.validateState(state.stocks[0].discussionState.current).ok),true);
    await prepareValid();await page.locator('#discussionImportConfirmBtn').click();await page.waitForFunction(()=>!document.getElementById('discussionImportDialog').classList.contains('show'));
    assert.equal(await page.evaluate(()=>state.stocks[0].discussionState.history.length),1);
    for(const mode of ['protected','storage','stale_tab']){
      await prepareValid();
      await page.evaluate(mode=>{
        if(mode==='protected')state.stocks[0].priceHistory.push({date:'2026-09-03',close:21,is_complete_bar:true});
        else saveState=async()=>{anchorAttempts++;if(mode==='stale_tab')throw {type:'stale_tab',message:'This tab is stale.'};throw new Error('synthetic storage failure')};
        globalThis.anchorBefore=JSON.stringify(state);globalThis.anchorBeforeAttempts=anchorAttempts;
        document.getElementById('discussionImportPreview').style.minHeight='1500px';
      },mode);
      await page.locator('#discussionImportConfirmBtn').click();
      await page.waitForFunction(()=>/无法保存|保存失败|不能覆盖|已经变化/.test(document.getElementById('discussionImportMessage').textContent));
      await visibleStatus(mode);
      assert.equal(await page.evaluate(()=>JSON.stringify(state)===anchorBefore),true);
      assert.equal(await page.evaluate(()=>anchorAttempts-anchorBeforeAttempts),mode==='protected'?0:1);
      if(mode==='protected')assert.match(await page.locator('#discussionImportMessage').innerText(),/持仓、技术锚点、计划或长期逻辑已经变化/);
      if(mode==='stale_tab')assert.match(await page.locator('#discussionImportMessage').innerText(),/当前旧页面不能覆盖/);
      await page.evaluate(()=>{closeDiscussionImportDialog();saveState=async(...args)=>{anchorAttempts++;return anchorRealSave(...args)}});
    }
    assert.deepEqual(errors,[]);results.push({viewport,missingAnchor:true,validSave:true,history:true,protectedRejection:true,storageFailure:true,staleTab:true,visibleFeedback:true,noOverflow:true,pageErrors:errors});await context.close();
  }}finally{await browser.close()}
  fs.writeFileSync(path.join(output,'anchor-browser-results.json'),JSON.stringify(results,null,2));console.log(JSON.stringify(results));
})().catch(e=>{console.error(e);process.exitCode=1});
