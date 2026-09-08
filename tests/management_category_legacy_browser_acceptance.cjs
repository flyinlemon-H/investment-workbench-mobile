'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright'),F=require('./fixtures/management-category-legacy');
const output=path.resolve('test-results/category-legacy-hotfix'),url='http://127.0.0.1:8768/';
(async()=>{
  fs.mkdirSync(output,{recursive:true});const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_EXECUTABLE||undefined}),results=[];
  try{for(const viewport of [{width:360,height:800},{width:390,height:844},{width:1280,height:900}]){
    const context=await browser.newContext({viewport}),page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
    await context.route('**/*',r=>new URL(r.request().url()).origin===new URL(url).origin?r.continue():r.abort());
    await page.goto(url);await page.waitForFunction(()=>document.getElementById('main')?.dataset.storageState==='ready');
    await page.evaluate(async fixture=>{const candidate=createValidatedCandidateSnapshot(fixture);await persistCandidateSnapshot(candidate);state=candidate;globalThis.legacyBase=structuredClone(state);globalThis.legacyRealPersist=persistCandidateSnapshot;globalThis.legacyWrites=0;persistCandidateSnapshot=async next=>{legacyWrites++;return legacyRealPersist(next)};navigateWorkbench('targets')},F.mixed());
    const reset=async()=>page.evaluate(()=>{document.getElementById('categoryAssignmentDialog')?.remove();state=structuredClone(legacyBase);legacyWrites=0;persistCandidateSnapshot=async next=>{legacyWrites++;return legacyRealPersist(next)};navigateWorkbench('targets')});
    const open=async()=>{await page.locator('#targetAssign').click();assert.equal(await page.locator('#categoryAssignmentDialog select').count(),23);assert.equal(await page.locator('#categoryAssignmentReview').isEnabled(),false)};
    const selectAll=async()=>{for(const a of F.choices(F.mixed()))await page.locator(`[data-category-id="${a.id}"]`).selectOption(a.managementCategory)};
    const review=async()=>{await page.locator('#categoryAssignmentReview').click();assert.equal(await page.locator('#categoryAssignmentConfirm').isEnabled(),true)};
    assert.match(await page.locator('.category-maintenance').textContent(),/有 23 个/);await open();
    assert.equal(await page.locator('[data-category-id="cash"]').count(),0);
    assert.deepEqual((await page.locator('#categoryAssignmentDialog select').evaluateAll(nodes=>nodes.map(n=>n.dataset.categoryId))).sort(),F.choices(F.mixed()).map(a=>a.id).sort());
    assert.equal(await page.locator('#categoryAssignmentDialog select').evaluateAll(nodes=>nodes.every(n=>n.labels.length===1)),true);
    await selectAll();await review();assert.equal(await page.locator('#categoryAssignmentPreview li').count(),23);assert.doesNotMatch(await page.locator('#categoryAssignmentPreview').textContent(),/现金/);
    assert.equal(await page.evaluate(()=>legacyWrites),0);assert.equal(await page.evaluate(()=>JSON.stringify(state)===JSON.stringify(legacyBase)),true);
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth||document.querySelector('dialog').scrollWidth>document.querySelector('dialog').clientWidth),false);
    assert.equal(await page.evaluate(()=>new Set([...document.querySelectorAll('[id]')].map(n=>n.id)).size===document.querySelectorAll('[id]').length),true);
    await page.screenshot({path:path.join(output,`preview-${viewport.width}.png`),fullPage:true});
    await page.locator('#categoryAssignmentCancel').click();assert.equal(await page.evaluate(()=>legacyWrites),0);
    await open();await selectAll();await review();
    // Confirm failure keeps the canonical state and every choice; no partial save.
    for(const kind of ['throw','false']){
      await page.evaluate(kind=>{persistCandidateSnapshot=async()=>{if(kind==='throw')throw Error('模拟存储失败');return false}},kind);
      await page.locator('#categoryAssignmentConfirm').click();assert.match(await page.locator('#categoryAssignmentError').textContent(),/原数据保留/);
      assert.equal(await page.evaluate(()=>JSON.stringify(state)===JSON.stringify(legacyBase)),true);assert.equal(await page.locator('[data-category-id="legacy-0"]').inputValue(),'core');
    }
    await page.evaluate(()=>{persistCandidateSnapshot=async next=>{legacyWrites++;await new Promise(resolve=>setTimeout(resolve,50));return legacyRealPersist(next)}});
    await page.evaluate(()=>{document.getElementById('categoryAssignmentConfirm').click();document.getElementById('categoryAssignmentConfirm').click()});
    await page.waitForFunction(()=>!document.getElementById('categoryAssignmentDialog'));assert.equal(await page.evaluate(()=>legacyWrites),1);assert.equal(await page.locator('#targetAssign').count(),0);
    assert.equal(await page.evaluate(()=>{const next=structuredClone(state);next.updatedAt=legacyBase.updatedAt;next.stocks.forEach(s=>delete s.managementCategory);return JSON.stringify(next)===JSON.stringify(legacyBase)}),true);
    assert.equal(await page.evaluate(()=>JSON.stringify(state.stocks.at(-1))===JSON.stringify(legacyBase.stocks.at(-1))),true);
    let count=0;for(const key of ['core','watch','candidate','etf']){await page.locator(`[data-target-filter="${key}"]`).click();count+=await page.locator('.target-card').count()}
    assert.equal(count,23);await page.locator('#targetSearch').fill('现金');assert.equal(await page.locator('.target-card').count(),0);
    await page.reload();await page.waitForFunction(()=>document.getElementById('main')?.dataset.storageState==='ready');await page.locator('[data-tab="targets"]').click();assert.equal(await page.locator('#targetAssign').count(),0);
    assert.equal(await page.evaluate(()=>Object.hasOwn(state.stocks.find(s=>s.id==='cash'),'managementCategory')),false);
    // Restore test baseline after reload; only synthetic state is touched.
    await page.evaluate(fixture=>{globalThis.legacyBase=createValidatedCandidateSnapshot(fixture);globalThis.legacyRealPersist=persistCandidateSnapshot},F.mixed());
    for(const phase of ['preview','confirm'])for(const kind of ['invalid','duplicate','changed','removed','added','category']){
      await reset();await open();await selectAll();if(phase==='confirm')await review();
      await page.evaluate(kind=>{if(kind==='invalid')state.stocks[0].code='INVALID';if(kind==='duplicate')state.stocks[1].code=state.stocks[0].code;if(kind==='changed')state.stocks[0].code='603296.SS';if(kind==='removed')state.stocks.shift();if(kind==='added')state.stocks.push({...state.stocks[0],id:'extra',code:'603296.SS'});if(kind==='category')state.stocks[0].managementCategory='core';globalThis.beforeReject=JSON.stringify(state)},kind);
      await page.locator(phase==='preview'?'#categoryAssignmentReview':'#categoryAssignmentConfirm').click();
      assert.match(await page.locator('#categoryAssignmentError').textContent(),kind==='invalid'?/无效标的代码：INVALID/:kind==='duplicate'?/重复标的代码：600000.SS/:/变化|移除/);
      assert.equal(await page.locator('#categoryAssignmentConfirm').isEnabled(),false);assert.equal(await page.evaluate(()=>legacyWrites),0);assert.equal(await page.evaluate(()=>JSON.stringify(state)===beforeReject),true);
      assert.equal(await page.locator('[data-category-id="legacy-0"]').inputValue(),'core');
      await page.locator('#categoryAssignmentCancel').click();
    }
    await reset();await page.evaluate(()=>{state.stocks.push({id:'special-1',type:'system',code:''},{id:'special-2',objectType:'cash',code:''});navigateWorkbench('targets')});await open();await selectAll();await review();assert.equal(await page.evaluate(()=>legacyWrites),0);await page.locator('#categoryAssignmentCancel').click();
    assert.deepEqual(errors,[]);results.push({viewport,eligible:23,excluded:1,exactSets:true,zeroPreviewCancelWrites:true,atomicConfirm:true,storageFailureRetainsChoices:true,identityGuardsBothPhases:true,blankSpecialsExcluded:true,backupReload:true,noOverflow:true,errors});await context.close();
  }}finally{await browser.close()}
  fs.writeFileSync(path.join(output,'results.json'),JSON.stringify(results,null,2));console.log(JSON.stringify(results));
})().catch(e=>{console.error(e);process.exitCode=1});
