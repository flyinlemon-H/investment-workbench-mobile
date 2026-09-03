'use strict';
// Synthetic loopback-only acceptance, new browser contexts, external requests blocked.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const output=path.resolve(process.argv[2]||'.'),url='http://127.0.0.1:8768/';
const fixtures=require('./fixtures/state-watch-definitions.json');
(async()=>{
  const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_EXECUTABLE||undefined}),results=[];
  async function ready(page){await page.waitForFunction(()=>document.getElementById('main')?.dataset.storageState==='ready')}
  async function noOverflow(page,label){assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,label+' document');assert.equal(await page.locator('.watch-dialog').evaluate(el=>el.scrollWidth>el.clientWidth+1).catch(()=>false),false,label+' dialog')}
  async function fillDefinition(page,definition){await page.locator('#watch-name').fill(definition.name);await page.locator('#watch-reviewAction').selectOption(definition.reviewAction);for(const key of ['entryConditions','confirmationConditions','invalidationConditions'])await page.locator('#watch-'+key).fill(definition[key].join('\n'))}
  try{for(const viewport of [{width:1280,height:900},{width:390,height:844}]){
    const context=await browser.newContext({viewport}),page=await context.newPage(),errors=[],dialogs=[];
    page.on('pageerror',error=>errors.push(error.message));page.on('dialog',async dialog=>{dialogs.push(dialog.message());await dialog.dismiss()});
    await context.route('**/*',route=>new URL(route.request().url()).origin===new URL(url).origin?route.continue():route.abort());
    await page.goto(url);await ready(page);assert.equal(await page.evaluate(()=>state.stocks.length),0);
    await page.evaluate(async()=>{
      const plan=PlanV2.createPlan({action:'buy',triggerPrice:25,triggerDirection:'below',quantity:100,allocationConstraint:{maxPositionPct:12},note:'合成传统计划'},{now:'2026-09-03T00:00:00Z'});
      const candidate=createValidatedCandidateSnapshot({stocks:[{id:'watch-acceptance',name:'隔离观察验收',code:'600000.SS',type:'holding',shares:0,avgCost:0,currentPrice:null,capPct:20,plans:[plan]}],updatedAt:null});
      await persistCandidateSnapshot(candidate);state=candidate;render();
      globalThis.phase1bWrites=0;const persist=persistCandidateSnapshot;persistCandidateSnapshot=async candidate=>{const result=await persist(candidate);phase1bWrites++;return result};
      globalThis.phase1bLegacy=JSON.stringify(state.stocks[0].plans[0]);globalThis.phase1bCurrentState=JSON.stringify(state.stocks[0].discussionState);
      openStockDetail('watch-acceptance','plan');openPlanCenter();
    });
    await page.getByRole('button',{name:'新建观察计划',exact:true}).click();
    await fillDefinition(page,fixtures[0]);await page.locator('#watchOptional summary').click();
    await page.locator('#watch-applicableConditions').fill('中期上升趋势仍然有效');
    await page.locator('#watchAddReference').click();await page.locator('[data-ref-type]').selectOption('watch_zone');await page.locator('[data-ref-from]').fill('37');await page.locator('[data-ref-to]').fill('40');await page.locator('[data-ref-meaning]').fill('前高及高位压力观察区域');
    await page.locator('#watchMaxPosition').fill('15');await page.locator('#watch-note').fill('按约定结构进行复核，保留独立的执行决定。');
    await noOverflow(page,'create form');await page.locator('.watch-dialog').evaluate(el=>el.scrollTop=0);await page.screenshot({path:path.join(output,`phase1b-${viewport.width}-create.png`)});
    await page.locator('#watchPreviewBtn').click();await page.locator('#watchConfirmBtn').waitFor({state:'visible'});
    assert.equal(await page.locator('#watchConfirmBtn').isEnabled(),true,await page.locator('#watchStatus').innerText());
    assert.match(await page.locator('#watchPreview').innerText(),/高位风险观察/);assert.match(await page.locator('#watchPreview').innerText(),/37–40/);assert.doesNotMatch(await page.locator('#watchPreview').innerText(),/reduce_review/);
    assert.equal(await page.evaluate(()=>phase1bWrites),0);await noOverflow(page,'create preview');
    await page.screenshot({path:path.join(output,`phase1b-${viewport.width}-preview.png`)});
    await page.locator('#watchConfirmBtn').click();await page.waitForFunction(()=>!document.getElementById('watchDefinitionDialog').classList.contains('show'));
    assert.equal(await page.evaluate(()=>phase1bWrites),1);const created=await page.evaluate(()=>state.stocks[0].plans.find(p=>p.planMode==='state_watch'));
    assert.equal(created.planVersion,1);assert.equal(created.quantity,null);assert.equal(created.triggerPrice,null);assert.equal(created.triggerDirection,null);assert.equal(created.action,null);
    assert.equal(await page.evaluate(()=>JSON.stringify(state.stocks[0].plans[0])===phase1bLegacy),true);
    assert.equal(await page.locator(`[data-execute-plan="${created.id}"]`).count(),0);await noOverflow(page,'plan card');await page.screenshot({path:path.join(output,`phase1b-${viewport.width}-card.png`),fullPage:true});
    await page.reload();await ready(page);assert.deepEqual(await page.evaluate(()=>state.stocks[0].plans.find(p=>p.planMode==='state_watch')),created);
    await page.evaluate(()=>{openStockDetail('watch-acceptance','plan');openPlanCenter()});
    await page.locator(`[data-watch-edit="${created.id}"]`).first().click();
    await page.locator('#watch-confirmationConditions').fill('关键支撑有效失守\n反弹修复失败');await page.locator('#watch-name').fill('高位风险持续观察');
    await page.locator('#watchPreviewBtn').click();assert.match(await page.locator('#watchPreview').innerText(),/纪律变化/);assert.match(await page.locator('#watchPreview').innerText(),/原：高位风险观察/);assert.match(await page.locator('#watchPreview').innerText(),/新：高位风险持续观察/);assert.match(await page.locator('#watchPreview').innerText(),/版本 1 → 2/);await noOverflow(page,'edit diff');await page.screenshot({path:path.join(output,`phase1b-${viewport.width}-diff.png`)});
    await page.locator('#watchConfirmBtn').click();await page.waitForFunction(()=>!document.getElementById('watchDefinitionDialog').classList.contains('show'));
    const updated=await page.evaluate(()=>state.stocks[0].plans.find(p=>p.planMode==='state_watch'));assert.equal(updated.id,created.id);assert.equal(updated.planVersion,2);assert.equal(updated.createdAt,created.createdAt);
    const beforeNoChange=await page.evaluate(()=>JSON.stringify(state));
    await page.locator(`[data-watch-edit="${created.id}"]`).first().click();await page.locator('#watchPreviewBtn').click();assert.match(await page.locator('#watchPreview').innerText(),/保持不变/);assert.equal(await page.locator('#watchConfirmBtn').isEnabled(),false);assert.equal(await page.evaluate(()=>JSON.stringify(state)),beforeNoChange);await page.locator('#watchDoneBtn').click();
    // Real AI envelope path without calling any AI service: copy its bound shape, inject synthetic rules.
    await page.getByRole('button',{name:'新建观察计划',exact:true}).click();await page.locator('#watchAiDetails summary').click();
    const aiDraft=await page.locator('#watchPromptText').inputValue();const envelopeText=aiDraft.split('\n\n').find(part=>part.startsWith('{')&&part.includes('draftSessionId'));const envelope=JSON.parse(envelopeText);envelope.definition=fixtures[1];envelope.reason='明确新建回撤支撑观察纪律';
    await page.locator('#watchDraftText').fill(JSON.stringify(envelope));await page.locator('#watchAiPreviewBtn').click();assert.equal(await page.locator('#watchConfirmBtn').isEnabled(),true,await page.locator('#watchStatus').innerText());await page.locator('#watchConfirmBtn').click();await page.waitForFunction(()=>!document.getElementById('watchDefinitionDialog').classList.contains('show'));
    await page.getByRole('button',{name:'新建观察计划',exact:true}).click();await fillDefinition(page,fixtures[2]);await page.locator('#watchPreviewBtn').click();await page.locator('#watchConfirmBtn').click();await page.waitForFunction(()=>!document.getElementById('watchDefinitionDialog').classList.contains('show'));
    assert.equal(await page.evaluate(()=>state.stocks[0].plans.length),4);
    // Export/import/reload using the real candidate/storage path, restricted to synthetic local state.
    const beforeExport=await page.evaluate(()=>JSON.stringify(state.stocks[0].plans));await page.evaluate(async()=>{const exported=alpha3ExportSnapshot(state),candidate=createValidatedCandidateSnapshot(JSON.parse(JSON.stringify(exported)),{requireWatchDefinition:true});await persistCandidateSnapshot(candidate);state=candidate});await page.reload();await ready(page);assert.equal(await page.evaluate(()=>JSON.stringify(state.stocks[0].plans)),beforeExport);
    await page.evaluate(()=>{openStockDetail('watch-acceptance','plan');openPlanCenter()});
    // Persistence failure keeps the canonical object and stored snapshot unchanged.
    await page.locator(`[data-watch-edit="${created.id}"]`).first().click();await page.locator('#watch-name').fill('不得保存的测试改名');await page.locator('#watchPreviewBtn').click();const beforeFailure=await page.evaluate(()=>JSON.stringify(state));
    await page.evaluate(()=>{globalThis.phase1bPersist=persistCandidateSnapshot;persistCandidateSnapshot=async()=>{throw Error('synthetic persistence failure')}});await page.locator('#watchConfirmBtn').click();await page.waitForFunction(()=>document.getElementById('watchStatus').textContent.includes('未保存'));assert.match(await page.locator('#watchStatus').innerText(),/未保存/);assert.equal(await page.evaluate(()=>JSON.stringify(state)),beforeFailure);await page.evaluate(()=>{persistCandidateSnapshot=phase1bPersist});await page.locator('#watchDoneBtn').click();
    // A second local tab saves after Preview; the first tab must not silently rebase.
    const other=await context.newPage();other.on('pageerror',error=>errors.push(error.message));await other.goto(url);await ready(other);
    await page.locator(`[data-watch-edit="${created.id}"]`).first().click();await page.locator('#watch-name').fill('过期标签页不得保存');await page.locator('#watchPreviewBtn').click();
    await other.evaluate(id=>{openStockDetail('watch-acceptance','plan');openPlanCenter();StateWatchUI.open('watch-acceptance',id)},created.id);await other.locator('#watch-name').fill('另一标签页已确认的主题');await other.locator('#watchPreviewBtn').click();await other.locator('#watchConfirmBtn').click();await other.waitForFunction(()=>!document.getElementById('watchDefinitionDialog').classList.contains('show'));
    assert.match(await page.locator('#multiTabConflictBanner').innerText(),/只读保护/);await page.locator('#watchConfirmBtn').dispatchEvent('click');await page.waitForFunction(()=>document.getElementById('watchStatus').textContent.includes('未保存'));assert.match(await page.locator('#watchStatus').innerText(),/未保存/);await page.locator('#multiTabConflictBanner').getByRole('button').click();await ready(page);assert.equal(await page.evaluate(id=>state.stocks[0].plans.find(p=>p.id===id).name,created.id),'另一标签页已确认的主题');assert.equal(await page.evaluate(id=>state.stocks[0].plans.find(p=>p.id===id).planVersion,created.id),3);await other.close();
    // Safe legacy execution gate, stock editor preservation and navigation.
    await page.evaluate(id=>executePlan('watch-acceptance',id),created.id);assert.equal(dialogs.length,1);assert.match(dialogs[0],/不能记录/);dialogs.length=0;
    const beforeEditor=await page.evaluate(()=>JSON.stringify(state.stocks[0].plans));await page.evaluate(()=>openModal('watch-acceptance'));await page.locator('#fNotes').fill('普通标的编辑仅更改备注');await page.locator('#saveBtn').click();await page.waitForFunction(()=>!document.getElementById('modal').classList.contains('show'));assert.equal(await page.evaluate(()=>JSON.stringify(state.stocks[0].plans)),beforeEditor);
    await page.evaluate(()=>openStockDetail('watch-acceptance','ai'));assert.match(await page.locator('#main').innerText(),/当前状态|当前正式状态|Current State/);await page.screenshot({path:path.join(output,`phase1b-${viewport.width}-discussion.png`),fullPage:true});
    await page.evaluate(()=>PlanReviewUI.open());assert.match(await page.locator('#planReviewRequestText').inputValue(),/另一标签页已确认的主题/);assert.match(await page.locator('#planReviewRequestText').inputValue(),/回撤支撑观察/);await page.screenshot({path:path.join(output,`phase1b-${viewport.width}-review.png`)});
    const reviews=await page.evaluate(()=>({planReviews:state.stocks[0].plans.map(p=>({symbol:'600000.SS',planId:p.id,planVersion:p.planVersion,review:{outcome:'needs_review',summary:'仅为合成资料复核，不修改观察纪律',changedPremises:[],riskFlags:[],suggestedChanges:[],confidence:'low'}}))}));
    await page.locator('#planReviewResultText').fill(JSON.stringify(reviews));await page.locator('#planReviewPreviewBtn').click();await page.locator('#planReviewSaveBtn').click();await page.locator('[data-watch-from-review]').first().waitFor();await page.locator('[data-watch-from-review]').first().click();assert.match(await page.locator('#watchDefinitionTitle').innerText(),/编辑观察计划/);assert.equal(await page.locator('#watch-name').inputValue(),'另一标签页已确认的主题');await page.locator('#watchPreviewBtn').click();assert.match(await page.locator('#watchPreview').innerText(),/保持不变/);await page.locator('#watchDoneBtn').click();
    const facts=await page.evaluate(()=>({count:state.stocks.length,shares:state.stocks[0].shares,plans:state.stocks[0].plans.length,execution:state.executionLog?.length||0,legacyName:state.stocks[0].plans[0].note,overflow:document.documentElement.scrollWidth>innerWidth,modes:state.stocks[0].plans.map(p=>p.planMode),runtime:state.planRuntimeStates||null,watchVersions:state.stocks[0].plans.filter(p=>p.planMode==='state_watch').map(p=>p.planVersion),runtimeFields:state.stocks[0].plans.some(p=>['phase','runtimeRevision','matchedConditions','unmetConditions'].some(key=>Object.hasOwn(p,key)))}));
    assert.equal(facts.execution,0);assert.equal(facts.shares,0);assert.equal(facts.legacyName,'合成传统计划');assert.equal(facts.overflow,false);assert.equal(facts.runtime,null);assert.equal(facts.runtimeFields,false);assert.deepEqual(errors,[]);assert.deepEqual(dialogs,[]);
    await page.evaluate(async()=>{const empty=createValidatedCandidateSnapshot({stocks:[],updatedAt:null});await persistCandidateSnapshot(empty);state=empty;StorageManager.close();MultiTabProtection.close();localStorage.clear();for(const db of await indexedDB.databases())await new Promise(resolve=>{const req=indexedDB.deleteDatabase(db.name);req.onsuccess=resolve;req.onerror=resolve;req.onblocked=resolve})});await context.close();results.push({viewport,...facts,errors,dialogs,createPreviewConfirm:true,sameIdUpdate:true,noChange:true,aiDraft:true,roundtrip:true,persistenceFailure:true,staleTabRejected:true,currentStateNavigation:true,planReview:true,cleaned:true});
    console.log('PASS '+viewport.width+'x'+viewport.height);
  }}finally{await browser.close()}
  fs.writeFileSync(path.join(output,'phase1b-browser-results.json'),JSON.stringify(results,null,2));console.log(JSON.stringify(results,null,2));
})().catch(error=>{console.error(error);process.exitCode=1});
