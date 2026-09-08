'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright'),F=require('./fixtures/homepage-screening.js');
const output=path.resolve(process.env.ACCEPTANCE_OUTPUT||'test-results/screening-browser','screening'),url='http://127.0.0.1:8768/';
(async()=>{
  fs.mkdirSync(output,{recursive:true});
  const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_EXECUTABLE||undefined}),results=[];
  try{
    for(const viewport of [{width:1280,height:900},{width:390,height:844},{width:360,height:800}]){
      const context=await browser.newContext({viewport}),page=await context.newPage(),errors=[],aiRequests=[];
      page.on('pageerror',error=>errors.push(error.message));
      await context.route('**/*',route=>{const request=route.request();if(/deepseek|\/ai\//i.test(request.url()))aiRequests.push(request.url());return new URL(request.url()).origin===new URL(url).origin?route.continue():route.abort()});
      await page.addInitScript(({now})=>{const OriginalDate=Date;globalThis.Date=class extends OriginalDate{constructor(...args){super(...(args.length?args:[now]))}static now(){return new OriginalDate(now).getTime()}}},{now:F.NOW});
      await page.goto(url);await page.waitForFunction(()=>document.getElementById('main')?.dataset.storageState==='ready');
      async function seed(fixture){return page.evaluate(fixture=>{
        state=createValidatedCandidateSnapshot(fixture);window.MARKET_TASK_STATUS=null;detailStockId=null;detailSubView='';currentTab='dashboard';
        for(const stock of state.stocks){const current=stock.discussionState?.current;if(current){current.references=DiscussionWorkbench.references(stock,{state,planReviewStore:state.planReviews,planReviewApi:PlanReview});current.technicalSnapshot=DiscussionWorkbench.technicalSnapshot(stock)}}
        const before=JSON.stringify(state);render();return {before,after:JSON.stringify(state)};
      },fixture)}
      const cards=page.locator('[data-home-attention-item]');
      const risk=F.state({risk:true});risk.stocks[0].name='筛查持仓样本';
      const snapshots=await seed(risk);assert.equal(snapshots.before,snapshots.after);assert.equal(await cards.count(),1);assert.equal(await page.locator('[data-home-attention-count]').innerText(),'1');
      assert.match(await cards.innerText(),/注意持仓风险/);assert.doesNotMatch(await cards.innerText(),/MA20|MA60|MACD|减仓|止盈|止损|technical|action_review|支撑|均线/);
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
      const box=await cards.boundingBox();assert.ok(box.y+box.height<viewport.height);await page.screenshot({path:path.join(output,`risk-${viewport.width}.png`),fullPage:true});
      await page.locator('[data-home-attention-action="discussion"]').click();assert.equal(await page.locator('#workspace-tab-ai').getAttribute('aria-selected'),'true');assert.equal(await page.locator('#discussionPromptDialog.show').count(),0);
      for(const [held,action,title] of [[true,'add','可以考虑加仓'],[true,'reduce','可考虑减仓'],[false,'buy','可以考虑建仓']]){
        await seed(F.state({held,action}));assert.equal(await cards.count(),1);assert.match(await cards.innerText(),new RegExp(title));assert.match(await cards.innerText(),/其他条件/);assert.equal(await cards.locator('[data-home-attention-action="discussion"]').count(),1);
        if(!held){assert.doesNotMatch(await cards.innerText(),/持有|持仓|加仓|减仓|止盈|止损/);await page.screenshot({path:path.join(output,`entry-${viewport.width}.png`),fullPage:true})}
      }
      for(const held of [true,false]){await seed(F.state({held}));assert.equal(await cards.count(),0)}
      await seed(F.state({risk:true,current:true}));assert.equal(await cards.count(),0);
      await page.evaluate(()=>{state.stocks[0].shares++;renderDashboard()});assert.equal(await cards.count(),1);assert.match(await cards.innerText(),/注意持仓风险/);
      await seed(F.state({risk:true,current:true}));
      await page.evaluate(()=>{state.stocks[0].discussionState.current.technicalSnapshot.anchorBar.date='2026-09-03';renderDashboard()});assert.match(await cards.innerText(),/注意持仓风险/);
      await seed(F.state({held:false,risk:true,action:'reduce'}));assert.equal(await cards.count(),0);
      const broken=F.state({risk:true,action:'reduce'});broken.stocks[0].priceHistory=[];await seed(broken);assert.equal(await cards.locator('[data-home-attention-action="discussion"]').count(),0);
      await seed(F.state({risk:true,action:'add'}));assert.equal(await cards.count(),1);assert.match(await cards.innerText(),/注意持仓风险/);assert.doesNotMatch(await cards.innerText(),/可以考虑加仓/);
      assert.deepEqual(errors,[]);assert.deepEqual(aiRequests,[]);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
      results.push({viewport,riskWithoutDiscussion:true,planTriggers:['increase','reduce','entry'],currentStatePrecedence:true,staleStateFallback:true,quiet:true,zeroPosition:true,readOnly:true,noAutoAI:true,noOverflow:true,errors});
      await context.close();
    }
  }finally{await browser.close()}
  fs.writeFileSync(path.join(output,'results.json'),JSON.stringify(results,null,2));console.log(JSON.stringify(results));
})().catch(error=>{console.error(error);process.exitCode=1});
