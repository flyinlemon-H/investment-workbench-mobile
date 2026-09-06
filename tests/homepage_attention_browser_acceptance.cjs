'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright'),F=require('./fixtures/homepage-attention.js');
const output=process.env.ACCEPTANCE_OUTPUT?path.resolve(process.env.ACCEPTANCE_OUTPUT,'homepage'):path.resolve('test-results/homepage-attention'),url=process.env.BROWSER_ACCEPTANCE_URL||'http://127.0.0.1:8768/';
(async()=>{
  fs.mkdirSync(output,{recursive:true});
  const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_EXECUTABLE||undefined}),results=[];
  try{
    for(const viewport of [{width:1280,height:900},{width:390,height:844},{width:360,height:800}]){
      const context=await browser.newContext({viewport}),page=await context.newPage(),errors=[],external=[];
      page.on('pageerror',error=>errors.push(error.message));page.on('dialog',dialog=>dialog.dismiss());
      await context.route('**/*',route=>{if(new URL(route.request().url()).origin===new URL(url).origin)return route.continue();external.push(route.request().url());return route.abort()});
      await page.addInitScript(({now})=>{const OriginalDate=Date;globalThis.Date=class extends OriginalDate{constructor(...args){super(...(args.length?args:[now]))}static now(){return new OriginalDate(now).getTime()}}},{now:F.NOW});
      await page.goto(url);await page.waitForFunction(()=>document.getElementById('main')?.dataset.storageState==='ready');
      async function seed(fixture,marketTask=null){
        await page.evaluate(({fixture,marketTask})=>{
          const candidate=createValidatedCandidateSnapshot(fixture);
          // Bind isolated accepted fixtures to the application's own normalized facts.
          for(const stock of candidate.stocks){const current=stock.discussionState?.current;if(current){current.references=DiscussionWorkbench.references(stock,{state:candidate,planReviewStore:candidate.planReviews,planReviewApi:PlanReview});current.technicalSnapshot=DiscussionWorkbench.technicalSnapshot(stock)}}
          state=candidate;window.MARKET_TASK_STATUS=marketTask;detailStockId=null;detailSubView='';currentTab='dashboard';render();
        },{fixture,marketTask});
      }
      const quiet=F.state({collectionInputs:{newsRawText:'已有旧新闻资料'},aiReviews:{},dataFreshness:{newsUpdatedAt:'2020-01-01',financialUpdatedAt:'2020-01-01',valuationUpdatedAt:'2020-01-01'}});
      await seed(quiet);assert.equal(await page.locator('[data-home-attention-item]').count(),0);assert.equal(await page.locator('[data-home-attention-count]').innerText(),'0');assert.match(await page.locator('[data-home-quiet]').innerText(),/今日暂无/);
      assert.doesNotMatch(await page.locator('#main').innerText(),/新闻.*复核|待更新清单|复核任务|Discussion.*更新|同步正常/);
      assert.equal(await page.locator('#syncHint').isVisible(),false);
      assert.equal(await page.locator('.universe-cloud-bar').isVisible(),false);
      const quietBox=await page.locator('[data-home-quiet]').boundingBox();assert.ok(quietBox.y+quietBox.height<viewport.height);
      await page.screenshot({path:path.join(output,`quiet-${viewport.width}.png`),fullPage:true});
      await page.evaluate(()=>{state.stocks[0].newsReview={analysisDate:'2026-09-06',summary:'已更新新闻'};state.stocks[0].dataFreshness.newsUpdatedAt='2026-09-06';renderDashboard()});assert.equal(await page.locator('[data-home-attention-count]').innerText(),'0');

      const app=await F.runtime('action_review');app.stocks[0].name='紫金矿业';app.stocks[0].id='plan-stock';
      const risk=F.state({id:'risk-stock',code:'601139.SS',name:'工业富联'},{attentionLevel:'focused',userDecision:{stopLoss:{status:'risk_control',summary:'关键风险需要复核。'},riskSource:'stock'}}).stocks[0];
      const missing=F.stock({id:'data-stock',code:'603296.SS',name:'华勤技术',priceHistory:[],technicalData:{technicalDataStatus:'unavailable'}});app.stocks.push(risk,missing);
      await seed(app);assert.equal(await page.locator('[data-home-attention-item]').count(),3);assert.equal(await page.locator('[data-home-attention-count]').innerText(),'3');
      assert.match(await page.locator('[data-home-attention-item]').first().innerText(),/工业富联[\s\S]*需要风险控制/);
      const firstBox=await page.locator('[data-home-attention-item]').first().boundingBox();assert.ok(firstBox.y+firstBox.height<viewport.height,'first risk card including CTA fits first screen');
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
      await page.screenshot({path:path.join(output,`risk-${viewport.width}.png`),fullPage:true});
      await page.locator('[data-home-attention-action="discussion"]').click();assert.equal(await page.locator('#workspace-tab-ai').getAttribute('aria-selected'),'true');assert.equal(await page.locator('#discussionPromptDialog.show').count(),0);
      await seed(app);await page.locator('[data-home-attention-action="plan"]').click();assert.equal(await page.locator('#workspace-tab-plan').getAttribute('aria-selected'),'true');
      await seed(app);await page.locator('[data-home-attention-action="technical"]').click();assert.equal(await page.locator('#workspace-tab-research').getAttribute('aria-selected'),'true');
      const broken=F.state();broken.stocks[0].priceHistory=[];await seed(broken,F.failedTask());assert.equal(await page.locator('[data-home-attention-item]').count(),1);await page.locator('[data-home-attention-action="technical"]').click();assert.equal(await page.locator('#workspace-tab-research').getAttribute('aria-selected'),'true');
      await seed(app);assert.deepEqual(errors,[]);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
      assert.equal(external.filter(value=>/deepseek|\/ai\//i.test(value)).length,0);
      results.push({viewport,quiet:true,newsRegressionCount:0,eligibleCount:3,riskFirst:true,firstCardFullyVisible:true,ctaRoutes:['ai','plan','technical','market-task-technical'],noAutoDiscussion:true,noOverflow:true,errors,externalRequestsBlocked:external.length});
      await context.close();
    }
  }finally{await browser.close()}
  fs.writeFileSync(path.join(output,'results.json'),JSON.stringify(results,null,2));console.log(JSON.stringify(results));
})().catch(error=>{console.error(error);process.exitCode=1});
