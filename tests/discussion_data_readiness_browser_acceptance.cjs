'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const output=process.env.ACCEPTANCE_OUTPUT?path.resolve(process.env.ACCEPTANCE_OUTPUT,'readiness'):path.resolve('test-results/discussion-data-readiness-v1'),url=process.env.BROWSER_ACCEPTANCE_URL||'http://127.0.0.1:8768/';
(async()=>{
  fs.mkdirSync(output,{recursive:true});const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_EXECUTABLE||undefined}),results=[];
  try{for(const viewport of [{width:1280,height:900},{width:390,height:844},{width:360,height:800}]){
    const context=await browser.newContext({viewport}),page=await context.newPage(),errors=[],dialogs=[],external=[];
    page.on('pageerror',e=>errors.push(e.message));page.on('dialog',async d=>{dialogs.push(d.message());await d.dismiss()});
    await context.route('**/*',r=>{if(new URL(r.request().url()).origin===new URL(url).origin)return r.continue();external.push(r.request().url());return r.abort()});
    await page.goto(url);await page.waitForFunction(()=>document.getElementById('main')?.dataset.storageState==='ready');
    await page.evaluate(async()=>{
      const source={id:'readiness-test',code:'601138.SS',name:'隔离资料验收',type:'holding',shares:100,avgCost:40,currentPrice:50,plans:[],priceHistory:[{date:'2026-09-04',close:50,is_complete_bar:true,provider:'fixture',adjustment:'qfq',price_basis:'adjusted'}],technicalData:{technicalAsOf:'2026-09-04',latestCompleteBar:'2026-09-04',technicalDataStatus:'fresh',price:50},marketDataFreshness:{last_trade_date:'2026-09-04',is_complete_bar:true,kline_status:'current'},technicalIndicators:{last_trade_date:'2026-09-04'},recentCatalyst:{analysisDate:'2026-07-15',latestSourceDate:'2026-07-15',todayCatalyst:'历史事件，仅供背景参考',freshnessStatus:'stale'},longTermLogic:{investmentThesis:'历史长期逻辑',logicStatus:'valid',updatedAt:'2026-07-15'}};
      const candidate=createValidatedCandidateSnapshot({stocks:[source],updatedAt:null});await persistCandidateSnapshot(candidate);state=candidate;render();openStockDetail('readiness-test','ai');
      globalThis.readinessOriginal=structuredClone(state);globalThis.readinessCalls=0;
      if(window.AiApi)window.AiApi=Object.freeze({...window.AiApi,request:()=>{readinessCalls++;throw new Error('Paid AI forbidden')}});
    });
    assert.match(await page.locator('.discussion-technical-readiness').innerText(),/行情数据正常/);
    assert.equal(await page.locator('.discussion-supporting-data').evaluate(n=>n.open),false);
    await page.locator('.discussion-workbench').evaluate(n=>n.scrollIntoView({block:'start'}));
    for(const action of ['start-stock-discussion','prepare-discussion-archive']){const box=await page.locator(`.discussion-actions [data-detail-action="${action}"]`).boundingBox();assert.ok(box.y<viewport.height&&box.y>=0)}
    await page.locator('.discussion-actions [data-detail-action="start-stock-discussion"]').click();await page.locator('#discussionPromptCloseBtn').click();
    await page.screenshot({path:path.join(output,`technical-ready-${viewport.width}.png`),fullPage:true});
    const originalVersion=await page.evaluate(()=>discussionPreparedContexts.get('601138.SS').sourceDiscussionVersion);
    // Actual view/cancel path must preserve the prepared object and same symbol.
    await page.locator('.discussion-supporting-data summary').click();await page.locator('.discussion-supporting-data [data-workspace="news"]').click();
    assert.equal(await page.locator('.discussion-return').count(),1);
    await page.locator('[data-detail-action="import-recent-catalyst-json"]').filter({visible:true}).first().click();await page.locator('#sentimentImportCancelBtn').click();
    await page.locator('[data-detail-action="return-to-discussion"]').click();assert.equal(await page.locator('.discussion-context-stale').count(),0);assert.equal(await page.evaluate(()=>discussionPreparedContexts.get('601138.SS').sourceDiscussionVersion),originalVersion);
    // Save changed news through the existing import UI and real local persistence.
    await page.locator('.discussion-supporting-data summary').click();await page.locator('.discussion-supporting-data [data-workspace="news"]').click();
    await page.locator('[data-detail-action="import-recent-catalyst-json"]').filter({visible:true}).first().click();
    await page.locator('#sentimentImportText').fill(JSON.stringify({recentCatalyst:{analysisDate:'2026-09-06',latestSourceDate:'2026-09-04',todayCatalyst:'新增公告，需要核对事件影响',freshnessStatus:'fresh',recentEvents:['新的公告依据']}}));await page.locator('#sentimentImportSaveBtn').click();
    await page.waitForFunction(()=>!document.getElementById('sentimentImportModal')?.classList.contains('show'));
    assert.match(await page.locator('.discussion-return').innerText(),/新闻已更新.*返回讨论/s);await page.locator('[data-detail-action="return-to-discussion"]').click();
    assert.match(await page.locator('.discussion-context-stale').innerText(),/资料已更新.*重新开始讨论/s);
    assert.equal(await page.evaluate(()=>discussionStockKey(state.stocks.find(s=>s.id===detailStockId))),'601138.SS');
    const writesBefore=await page.evaluate(()=>JSON.stringify(state));await page.locator('.discussion-actions [data-detail-action="prepare-discussion-archive"]').click();assert.match(dialogs.at(-1),/资料已更新/);assert.equal(await page.evaluate(()=>JSON.stringify(state)),writesBefore);
    await page.screenshot({path:path.join(output,`return-changed-${viewport.width}.png`),fullPage:true});
    await page.locator('.discussion-context-stale [data-detail-action="start-stock-discussion"]').click();assert.notEqual(await page.evaluate(()=>discussionPreparedContexts.get('601138.SS').sourceDiscussionVersion),originalVersion);await page.locator('#discussionPromptCloseBtn').click();
    // All supporting workspaces and Plan have the same return path.
    for(const target of ['fundamental','longterm','valuation','technical','plan']){
      if(target==='plan')await page.locator('#workspace-tab-plan').click();else{await page.locator('#workspace-tab-research').click();await page.locator(`.research-navigation [data-workspace="${target}"]`).click();}assert.equal(await page.locator('.discussion-return').count(),1);await page.locator('[data-detail-action="return-to-discussion"]').click();assert.equal(await page.locator('#workspace-tab-ai').getAttribute('aria-selected'),'true');assert.equal(await page.locator('.discussion-context-stale').count(),0);
    }
    await page.evaluate(()=>{openStockDetail('readiness-test','news')});assert.equal(await page.locator('.discussion-return').count(),0);
    await page.evaluate(()=>{openStockDetail('readiness-test','ai');state.stocks[0].priceHistory=[];renderStockDetail()});assert.match(await page.locator('.discussion-technical-readiness').innerText(),/缺少完整日K/);assert.match(await page.locator('.discussion-status-warning').innerText(),/当前无法保存/);
    await page.locator('.discussion-technical-readiness [data-workspace="technical"]').click();assert.equal(await page.locator('#workspace-tab-research').getAttribute('aria-selected'),'true');await page.locator('[data-detail-action="return-to-discussion"]').click();
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);assert.equal(await page.evaluate(()=>readinessCalls),0);assert.deepEqual(errors,[]);assert.equal(external.filter(u=>/deepseek|\/ai\/|\/rpc\/|rest\/v1/.test(u)).length,0);
    await page.locator('.discussion-workbench').evaluate(n=>n.scrollIntoView({block:'start'}));await page.screenshot({path:path.join(output,`technical-missing-${viewport.width}.png`),fullPage:true});
    results.push({viewport,compact:true,sameSymbol:true,unchangedAndCancel:true,realNewsSave:true,staleArchiveBlocked:true,regeneration:true,allReturnPaths:true,normalEntryNoReturn:true,noAutomaticAi:true,noOverflow:true,errors,dialogs});await context.close();
  }}finally{await browser.close()}
  fs.writeFileSync(path.join(output,'results.json'),JSON.stringify(results,null,2));console.log(JSON.stringify(results));
})().catch(e=>{console.error(e);process.exitCode=1});
