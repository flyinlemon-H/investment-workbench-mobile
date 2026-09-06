'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright'),F=require('./fixtures/homepage-attention.js');
const output=process.env.ACCEPTANCE_OUTPUT?path.resolve(process.env.ACCEPTANCE_OUTPUT,'ui'):path.resolve('test-results/ui-simplification-v1a'),url=process.env.BROWSER_ACCEPTANCE_URL||'http://127.0.0.1:8768/';
(async()=>{
  fs.mkdirSync(output,{recursive:true});const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_EXECUTABLE||undefined}),results=[];
  try{for(const viewport of [{width:390,height:844},{width:360,height:800},{width:1280,height:900}]){
    const context=await browser.newContext({viewport,acceptDownloads:true}),page=await context.newPage(),errors=[];
    page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.dismiss());
    await context.route('**/*',r=>new URL(r.request().url()).origin===new URL(url).origin?r.continue():r.abort());
    await page.addInitScript(({now})=>{const D=Date;globalThis.Date=class extends D{constructor(...args){super(...(args.length?args:[now]))}static now(){return new D(now).getTime()}}},{now:F.NOW});
    await page.goto(url);await page.waitForFunction(()=>document.getElementById('main')?.dataset.storageState==='ready');
    const safetyChecks=[];
    async function auditUi(label){
      const inspection=await page.evaluate(()=>{
        const byId=new Map();for(const node of document.querySelectorAll('[id]')){if(!byId.has(node.id))byId.set(node.id,[]);byId.get(node.id).push(node)}
        const duplicateIds=[...byId].filter(([,nodes])=>nodes.length>1).map(([id])=>id);
        const hiddenLegacy=[...document.querySelectorAll('.tabs [data-tab][hidden],#maintenanceControlParking button,#maintenanceControlParking input,#maintenanceControlParking a,[data-ui-disposition="hide"]')];
        const focusableHidden=[];for(const node of hiddenLegacy){node.focus();if(document.activeElement===node)focusableHidden.push(node.id||node.dataset.tab||node.textContent)}
        return {duplicateIds,focusableHidden,hiddenChecked:hiddenLegacy.length};
      });
      assert.deepEqual(inspection.duplicateIds,[],label+' duplicate DOM IDs');
      assert.deepEqual(inspection.focusableHidden,[],label+' hidden legacy controls cannot receive focus');
      const first=page.locator('.tabs [data-tab="dashboard"]');await first.focus();let cycleCompleted=false,tabStops=0;
      for(let i=0;i<180;i++){
        await page.keyboard.press('Tab');tabStops++;
        const focus=await page.evaluate(()=>{const node=document.activeElement;return {forbidden:Boolean(node?.closest('#maintenanceControlParking,[hidden],[data-ui-disposition="hide"]')),tab:node?.dataset?.tab||'',id:node?.id||''}});
        assert.equal(focus.forbidden,false,label+' Tab reached hidden legacy control '+focus.id);
        if(focus.tab==='dashboard'){cycleCompleted=true;break}
      }
      assert.ok(cycleCompleted,label+' completed real Tab cycle');
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,label+' horizontal overflow');
      safetyChecks.push({page:label,duplicateIds:[],hiddenChecked:inspection.hiddenChecked,hiddenFocus:false,tabStops,tabCycle:true,noOverflow:true});
    }
    const fixture=await F.runtime('action_review',{attentionLevel:'focused',userDecision:{stopLoss:{status:'risk_control',summary:'关键风险需要复核。'},riskSource:'stock'}});
    fixture.stocks.push(F.accept(F.stock({id:'huaqin',name:'华勤技术',code:'603296.SS',shares:0,type:'watching'})),F.accept(F.stock({id:'etf',name:'测试ETF',code:'510300.SS',type:'etf'})));
    await page.evaluate(async fixture=>{const candidate=createValidatedCandidateSnapshot(fixture);for(const stock of candidate.stocks){const current=stock.discussionState.current;current.references=DiscussionWorkbench.references(stock,{state:candidate,planReviewStore:candidate.planReviews,planReviewApi:PlanReview});current.technicalSnapshot=DiscussionWorkbench.technicalSnapshot(stock)}await persistCandidateSnapshot(candidate);state=candidate;currentTab='dashboard';render();globalThis.uiProtected=()=>JSON.stringify({stocks:state.stocks.map(s=>({id:s.id,shares:s.shares,avgCost:s.avgCost,plans:s.plans,discussionState:s.discussionState})),runtime:state.planRuntimeStates,planReviews:state.planReviews,executionLog:state.executionLog});globalThis.uiOriginal=uiProtected();globalThis.uiSaveCalls=0;const realSave=saveState;saveState=(...args)=>{uiSaveCalls++;return realSave(...args)};sessionStorage.setItem('v13_detail_workspace_tab_v1','technical')},fixture);
    await auditUi('今日');
    const nav=page.locator('.tabs button:visible');assert.deepEqual(await nav.allTextContents(),['今日','标的','计划','记录','更多']);
    await page.locator('[data-home-attention-action="discussion"]').click();assert.equal(await page.locator('#workspace-tab-ai').getAttribute('aria-selected'),'true');
    assert.deepEqual(await page.locator('[data-workspace-tab]').allTextContents(),['当前判断','计划','研究资料','历史']);
    assert.equal(await page.locator('.universe-cloud-bar').isVisible(),false);assert.equal(await page.locator('#analysisFetchBtn').isVisible(),false);
    const discussionAction=await page.locator('[data-detail-action="start-stock-discussion"]').boundingBox();assert.ok(discussionAction.y+discussionAction.height<=viewport.height,'primary discussion action fits first screen');
    await page.locator('#workspace-tab-ai').focus();await page.keyboard.press('End');assert.equal(await page.locator('#workspace-tab-history').getAttribute('aria-selected'),'true');await page.keyboard.press('Home');assert.equal(await page.locator('#workspace-tab-ai').getAttribute('aria-selected'),'true');
    await auditUi('当前判断');
    await page.screenshot({path:path.join(output,`discussion-${viewport.width}.png`),fullPage:true});
    await page.locator('#workspace-tab-research').click();assert.equal(await page.locator('.research-navigation button').count(),5);await page.locator('.research-navigation [data-workspace="news"]').click();
    await auditUi('研究资料-新闻');
    assert.equal(await page.locator('[data-detail-action="return-to-discussion"]').isVisible(),true);await page.locator('[data-detail-action="return-to-discussion"]').click();
    await page.locator('[data-workspace="plan"]').click();await page.locator('[data-detail-action="view-plan-center"]').click();assert.equal(await page.locator('#planCenterPreparePlanBtn').isVisible(),true);await auditUi('单股计划中心');await page.locator('#planCenterBackBtn').click();
    await page.locator('#workspace-tab-history').click();assert.equal(await page.locator('#discussionHistoryPanel').count(),1);assert.match(await page.locator('#workspace-panel').innerText(),/相关计划历史.*用户操作记录/s);
    await auditUi('单股历史');
    await page.locator('[data-tab="targets"]').click();await page.locator('#targetSearch').fill('华勤');await page.locator('[data-target-stock="huaqin"]').first().click();assert.equal(await page.locator('#workspace-tab-ai').getAttribute('aria-selected'),'true');assert.match(await page.locator('.detail-compact-header').innerText(),/华勤技术/);
    await page.locator('[data-tab="targets"]').click();await page.locator('#targetSearch').fill('');for(const [filter,count] of [['holding',2],['watching',1],['etf',1],['zero',1],['all',3]]){await page.locator(`[data-target-filter="${filter}"]`).click();assert.equal(await page.locator('.target-card').count(),count)}
    await auditUi('标的');
    await page.screenshot({path:path.join(output,`targets-${viewport.width}.png`),fullPage:true});
    await page.locator('[data-tab="plans"]').click();await auditUi('计划');await page.locator('[data-target-stock="home-stock"]').first().click();assert.equal(await page.locator('#workspace-tab-plan').getAttribute('aria-selected'),'true');assert.equal(await page.locator('[data-runtime-review]').count()>0,true);await auditUi('单股计划');
    await page.locator('[data-tab="logs"]').click();await auditUi('记录');await page.locator('[data-tab="more"]').click();await auditUi('更多');await page.locator('[data-more-page="analysis"]').click();await auditUi('高级比较-默认');assert.equal(await page.locator('.comparison-table th').count(),6);assert.equal(await page.locator('#advancedComparisonDetails').evaluate(n=>n.open),false);await page.locator('#advancedComparisonDetails summary').click();await page.locator('#analysisRole').selectOption('观察仓');assert.equal(await page.locator('#analysisRole').inputValue(),'观察仓');await auditUi('高级比较-展开');
    await page.locator('[data-tab="more"]').click();assert.equal(await page.locator('#resetBtn').isVisible(),false);await page.locator('#moreBackup').click();assert.equal(await page.locator('#exportBtn').isVisible(),true);assert.equal(await page.locator('#resetBtn').isVisible(),false);
    assert.deepEqual(await page.locator('.tool-section>summary').allTextContents(),['行情与数据','同步','备份与恢复','账户','高级维护','危险操作']);
    await auditUi('工具-备份与恢复');
    await page.screenshot({path:path.join(output,`backup-${viewport.width}.png`),fullPage:true});
    await page.locator('[data-tab="targets"]').click();await page.locator('[data-tab="more"]').click();await page.locator('#moreBackup').click();assert.equal(await page.locator('#exportBtn').count(),1);await auditUi('工具-反复导航后');
    assert.equal(await page.evaluate(()=>uiProtected()===uiOriginal),true,'navigation preserves protected business state');assert.equal(await page.evaluate(()=>uiSaveCalls),0,'navigation never persists data');
    const downloadPromise=page.waitForEvent('download');await page.locator('#exportBtn').click();const download=await downloadPromise;assert.match(download.suggestedFilename(),/\.json$/);
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);assert.deepEqual(errors,[]);
    results.push({viewport,primaryNavigation:5,stockWorkspaces:4,scenario1:true,scenario2:true,researchReturn:true,planAndRuntime:true,history:true,backupDownload:true,filters:true,advancedComparison:true,navigationWriteFree:true,noOverflow:true,hiddenLegacyTabSafe:true,uniqueIds:true,safetyChecks,errors});await context.close();
  }}finally{await browser.close()}
  fs.writeFileSync(path.join(output,'results.json'),JSON.stringify(results,null,2));console.log(JSON.stringify(results));
})().catch(e=>{console.error(e);process.exitCode=1});
