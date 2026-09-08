'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright'),F=require('./fixtures/homepage-attention');
const output=path.resolve('test-results/management-category'),url='http://127.0.0.1:8768/';
(async()=>{
  fs.mkdirSync(output,{recursive:true});const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_EXECUTABLE||undefined}),results=[];
  try{for(const viewport of [{width:360,height:800},{width:390,height:844},{width:1280,height:900}]){
    const context=await browser.newContext({viewport,acceptDownloads:true}),page=await context.newPage(),errors=[];
    page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.dismiss());
    await context.route('**/*',r=>new URL(r.request().url()).origin===new URL(url).origin?r.continue():r.abort());
    await page.goto(url);await page.waitForFunction(()=>document.getElementById('main')?.dataset.storageState==='ready');
    const fixture=await F.runtime('action_review');fixture.stocks[0].managementCategory='core';fixture.stocks[0].watchlist=true;
    for(const [id,category,shares,type,role] of [['watch','watch',10,'watching','观察仓'],['candidate','candidate',0,'etf','卫星仓'],['etf','etf',100,'etf','核心仓'],['growth',null,100,'holding','成长仓'],['satellite',null,100,'holding','卫星仓'],['missing',null,0,'holding','']])fixture.stocks.push(F.stock({id,name:`测试${id}`,code:`60000${fixture.stocks.length}.SS`,shares,type,role,...(category?{managementCategory:category}:{})}));
    await page.evaluate(async data=>{const candidate=createValidatedCandidateSnapshot(data);await persistCandidateSnapshot(candidate);state=candidate;globalThis.categoryWrites=0;globalThis.realCategoryPersist=persistCandidateSnapshot;persistCandidateSnapshot=async candidate=>{categoryWrites++;return realCategoryPersist(candidate)};navigateWorkbench('targets')},fixture);
    assert.deepEqual(await page.locator('[data-target-filter]').allTextContents(),['核心仓','观察仓','候选仓','ETF']);
    assert.equal(await page.locator('[data-target-filter="core"]').getAttribute('aria-pressed'),'true');assert.equal(await page.locator('.target-card').count(),1);
    const ids=[];for(const key of ['core','watch','candidate','etf']){await page.locator(`[data-target-filter="${key}"]`).click();assert.equal(await page.locator('.target-card').count(),1);ids.push(await page.locator('[data-target-edit]').getAttribute('data-target-edit'))}
    assert.equal(new Set(ids).size,4);
    await page.locator('[data-target-filter="watch"]').click();await page.locator('[data-target-stock="watch"]').first().click();assert.equal(await page.locator('#workspace-tab-ai').getAttribute('aria-selected'),'true');
    await page.evaluate(()=>{detailStockId=null;render()});assert.equal(await page.locator('[data-target-filter="watch"]').getAttribute('aria-pressed'),'true');
    await page.locator('#targetSearch').fill('测试candidate');assert.match(await page.locator('.empty').textContent(),/当前分类中没有匹配标的/);await page.locator('#targetSearch').fill('测试watch');assert.equal(await page.locator('.target-card').count(),1);
    await page.locator('[data-tab="targets"]').click();assert.equal(await page.locator('#targetSearch').inputValue(),'');assert.equal(await page.locator('[data-target-filter="core"]').getAttribute('aria-pressed'),'true');assert.equal(await page.evaluate(()=>categoryWrites),0);
    await page.screenshot({path:path.join(output,`categories-${viewport.width}.png`),fullPage:true});
    // Category-only editor preserves all business data, hashes and Universe queue.
    await page.evaluate(()=>{globalThis.categoryBefore=JSON.stringify(state);globalThis.contextBefore=JSON.stringify(DiscussionWorkbench.buildContext(state.stocks[0],discussionOptions()))});
    await page.locator('[data-target-edit="home-stock"]').click();await page.locator('#fManagementCategory').selectOption('candidate');await page.locator('#saveBtn').click();assert.match(await page.locator('#fManagementCategoryError').textContent(),/候选仓/);assert.equal(await page.evaluate(()=>categoryWrites),0);
    await page.locator('#fManagementCategory').selectOption('watch');
    await page.evaluate(()=>{persistCandidateSnapshot=async()=>{throw Error('模拟存储失败')}});await page.locator('#saveBtn').click();assert.match(await page.locator('#fManagementCategoryError').textContent(),/未保存/);assert.equal(await page.evaluate(()=>JSON.stringify(state)===categoryBefore),true);
    await page.evaluate(()=>{persistCandidateSnapshot=async candidate=>{categoryWrites++;return realCategoryPersist(candidate)}});await page.locator('#saveBtn').click();await page.waitForFunction(()=>!document.getElementById('modal').classList.contains('show'));
    assert.equal(await page.evaluate(()=>{const before=JSON.parse(categoryBefore),after=structuredClone(state);after.updatedAt=before.updatedAt;after.stocks[0].managementCategory=before.stocks[0].managementCategory;return JSON.stringify(after)===JSON.stringify(before)&&JSON.stringify(DiscussionWorkbench.buildContext(state.stocks[0],discussionOptions()))===contextBefore}),true);
    assert.equal(await page.evaluate(()=>categoryWrites),1);
    // Legacy batch: explicit preview, stale preview, failure retention, duplicate confirm.
    await page.locator('#targetAssign').click();assert.equal(await page.locator('#categoryAssignmentDialog select').count(),3);assert.deepEqual(await page.locator('#categoryAssignmentDialog select').evaluateAll(nodes=>nodes.map(n=>n.value)),['','','']);
    await page.locator('[data-category-id="growth"]').selectOption('core');await page.locator('[data-category-id="satellite"]').selectOption('watch');await page.locator('[data-category-id="missing"]').selectOption('candidate');
    await page.locator('#categoryAssignmentReview').click();assert.equal(await page.locator('#categoryAssignmentConfirm').isEnabled(),true);
    await page.evaluate(()=>state.stocks.find(s=>s.id==='growth').shares=101);await page.locator('#categoryAssignmentConfirm').click();assert.match(await page.locator('#categoryAssignmentError').textContent(),/重新预览/);assert.equal(await page.evaluate(()=>categoryWrites),1);
    await page.locator('#categoryAssignmentReview').click();await page.evaluate(()=>{globalThis.migrationBefore=JSON.stringify(state);persistCandidateSnapshot=async()=>{throw Error('模拟存储失败')}});await page.locator('#categoryAssignmentConfirm').click();assert.match(await page.locator('#categoryAssignmentError').textContent(),/原数据保留/);assert.equal(await page.evaluate(()=>JSON.stringify(state)===migrationBefore),true);assert.equal(await page.locator('[data-category-id="growth"]').inputValue(),'core');
    await page.screenshot({path:path.join(output,`migration-${viewport.width}.png`),fullPage:true});
    await page.evaluate(()=>{persistCandidateSnapshot=async candidate=>{categoryWrites++;await new Promise(resolve=>setTimeout(resolve,50));return realCategoryPersist(candidate)}});
    await page.evaluate(()=>{document.getElementById('categoryAssignmentConfirm').click();document.getElementById('categoryAssignmentConfirm').click()});await page.waitForFunction(()=>!document.getElementById('categoryAssignmentDialog'));assert.equal(await page.evaluate(()=>categoryWrites),2);assert.equal(await page.locator('#targetAssign').count(),0);
    // New stock: explicit required choice, no inferred default, compatible shares and one save.
    await page.locator('#targetAdd').click();assert.equal(await page.locator('#fManagementCategory').inputValue(),'');await page.locator('#fName').fill('新增隔离ETF候选');await page.locator('#fCode').fill('510500.SS');await page.locator('#fShares').fill('0');await page.locator('#saveBtn').click();assert.match(await page.locator('#fManagementCategoryError').textContent(),/明确选择/);assert.equal(await page.evaluate(()=>categoryWrites),2);
    await page.locator('#fManagementCategory').selectOption('etf');await page.locator('#saveBtn').click();assert.match(await page.locator('#fManagementCategoryError').textContent(),/无持仓/);
    await page.locator('#typeToggle [data-type="etf"]').click();await page.locator('#fManagementCategory').selectOption('candidate');await page.locator('#saveBtn').click();await page.waitForFunction(()=>!document.getElementById('modal').classList.contains('show'));assert.equal(await page.evaluate(()=>categoryWrites),3);
    assert.deepEqual(await page.evaluate(()=>{const s=state.stocks.find(s=>s.code==='510500.SS');return [s.managementCategory,s.type,s.shares]}),['candidate','etf',0]);
    // Lifecycle now requires one combined ETF rebuild confirmation.
    await page.evaluate(()=>openModal(state.stocks.find(s=>s.code==='510500.SS').id));await page.locator('#fShares').fill('100');await page.locator('#saveBtn').click();
    assert.deepEqual(await page.locator('#holdingLifecycleCategory option').evaluateAll(nodes=>nodes.map(n=>n.value)),['etf']);
    assert.equal(await page.evaluate(()=>state.stocks.find(s=>s.code==='510500.SS').shares),0);
    await page.locator('#holdingLifecycleConfirm').click();await page.waitForFunction(()=>!document.getElementById('modal').classList.contains('show'));
    assert.deepEqual(await page.evaluate(()=>{const s=state.stocks.find(s=>s.code==='510500.SS');return [s.managementCategory,s.shares]}),['etf',100]);
    // Actual export/restore boundary in isolated canonical storage; legacy still readable.
    await page.evaluate(async()=>{globalThis.backup=alpha3ExportSnapshot(state);const restored=createValidatedCandidateSnapshot(JSON.parse(JSON.stringify(backup)),{touchUpdatedAt:false});await realCategoryPersist(restored);state=restored});
    assert.equal(await page.evaluate(()=>JSON.stringify(state.stocks.map(s=>s.managementCategory))===JSON.stringify(backup.stocks.map(s=>s.managementCategory))),true);
    await page.evaluate(async()=>{const legacy=structuredClone(backup);for(const s of legacy.stocks)delete s.managementCategory;globalThis.legacyCandidate=createValidatedCandidateSnapshot(legacy,{touchUpdatedAt:false});await realCategoryPersist(legacyCandidate);state=legacyCandidate;navigateWorkbench('targets')});assert.equal(await page.locator('#targetAssign').count(),1);assert.equal(await page.evaluate(()=>state.stocks.some(s=>Object.hasOwn(s,'managementCategory'))),false);await page.reload();await page.waitForFunction(()=>document.getElementById('main')?.dataset.storageState==='ready');await page.locator('[data-tab="targets"]').click();assert.equal(await page.locator('#targetAssign').count(),1);
    for(const key of ['core','watch','candidate','etf']){const button=page.locator(`[data-target-filter="${key}"]`);await button.focus();await page.keyboard.press('Enter');assert.equal(await button.getAttribute('aria-pressed'),'true')}
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
    assert.equal(await page.evaluate(()=>new Set([...document.querySelectorAll('[id]')].map(n=>n.id)).size===document.querySelectorAll('[id]').length),true);
    const positions=await page.locator('[data-target-filter]').evaluateAll(nodes=>nodes.map(n=>n.getBoundingClientRect().top));assert.equal(new Set(positions).size,1);assert.deepEqual(errors,[]);
    results.push({viewport,fourUniqueCategories:true,categoryOnlyAtomic:true,migrationAtomic:true,noSilentMapping:true,requiredAdd:true,backupLegacyRestore:true,lifecycleConfirmed:true,noOverflow:true,errors});await context.close();
  }}finally{await browser.close()}
  fs.writeFileSync(path.join(output,'results.json'),JSON.stringify(results,null,2));console.log(JSON.stringify(results));
})().catch(e=>{console.error(e);process.exitCode=1});
