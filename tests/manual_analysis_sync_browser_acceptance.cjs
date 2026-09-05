'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const output=path.resolve(process.argv[2]||path.join('test-results','manual-analysis-sync-v1')),url='http://127.0.0.1:8768/';

(async()=>{
  fs.mkdirSync(output,{recursive:true});const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_EXECUTABLE||undefined}),results=[];
  try{
    for(const viewport of [{width:1280,height:900,role:"publisher"},{width:500,height:900,role:"publisher"},{width:390,height:844,role:"receiver"},{width:1024,height:900,role:"receiver"}]){
      const context=await browser.newContext({viewport}),page=await context.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));
      await context.route('**/*',route=>new URL(route.request().url()).pathname==='/src/vendor/supabase-client.js'?route.fulfill({contentType:'text/javascript',body:fs.readFileSync(path.join(__dirname,'fixtures/shared-auth-sdk.js'),'utf8')}):new URL(route.request().url()).origin===new URL(url).origin?route.continue():route.abort());
      await page.goto(url);await page.waitForFunction(()=>document.getElementById('main')?.dataset.storageState==='ready');
      await page.waitForFunction(()=>UniverseAutoAdd.status().signedIn);
      assert.equal(await page.evaluate(()=>ManualAnalysisSyncCloud.role()),'receiver');
      await page.getByRole('button',{name:'自动同步设置',exact:true}).click();await page.locator(`[name=analysisSyncRole][value=${viewport.role}]`).check();await page.locator('#universeClose').click();
      const mobile=viewport.role==='receiver',fetch=page.locator('#analysisFetchBtn'),fetchDiag=await page.evaluate(()=>{const el=document.getElementById('analysisFetchBtn');return {hidden:el.hidden,display:getComputedStyle(el).display,parent:getComputedStyle(el.parentElement).display,role:ManualAnalysisSyncCloud.mobileUi(),width:innerWidth}});assert.equal(await fetch.isVisible(),mobile,`${viewport.width}px fetch visibility ${JSON.stringify(fetchDiag)}`);
      await page.evaluate(async()=>{
        const stock={id:'sync-acceptance',code:'1810.HK',symbol:'1810.HK',name:'小米集团',type:'watching',role:'观察仓',theme:'消费电子',plans:[],dataFreshness:{personalViewUpdatedAt:'2026-09-04'},longTermLogic:{schemaVersion:'long-term-logic.v2',investmentThesis:'汽车业务进入兑现期，核心观察销量、毛利改善和高端化是否持续。',coreDrivers:['核心产品销量保持增长','毛利率改善能够持续','高端化形成稳定用户认知'],keyRisks:['竞争加剧导致利润改善中断','产品节奏失误削弱品牌势能'],reviewTriggers:['连续两个报告期毛利率恶化','核心产品销量显著偏离公司指引'],logicStatus:'valid',confidence:'medium',nextReviewDate:'2026-12-01'}};
        const candidate=createValidatedCandidateSnapshot({stocks:[stock],updatedAt:null});await persistCandidateSnapshot(candidate);state=candidate;detailStockId='sync-acceptance';setDetailWorkspace('longterm');renderStockDetail();
      });
      const publish=page.locator('.analysis-sync-row button');assert.equal(await publish.count(),mobile?0:1,`${viewport.width}px publisher count`);
      const statusText=mobile?await page.locator('.analysis-sync-row').innerText():await publish.locator('..').innerText();assert.match(statusText,mobile?/主动获取并确认/:/同步状态待检查/);
      await page.evaluate(async isMobile=>{
        const payload={investmentThesis:'云端发布的新投资逻辑，仍需验证销量与毛利改善是否持续。',coreDrivers:['销量保持增长','毛利率继续改善'],keyRisks:['竞争显著加剧'],reviewTriggers:['连续两个报告期毛利率恶化'],logicStatus:'weakening',confidence:'medium',nextReviewDate:'2026-12-15'};
        const payloadHash=await ManualAnalysisSync.payloadHash(payload);
        window.__analysisSyncMock={writes:0,row:isMobile?{moduleType:'long_term_logic',entityKey:'1810.HK',moduleSchemaVersion:'long-term-logic.v2',revision:1,payloadHash,publishedAt:'2026-09-04T02:35:00.000Z',payload}:null};
      },mobile);
      if(mobile){
        const savedStock=await page.evaluate(async()=>{const stock=structuredClone(state.stocks[0]);const empty=createValidatedCandidateSnapshot({stocks:[],updatedAt:null});await persistCandidateSnapshot(empty);state=empty;await UniverseAutoAdd.flush();await UniverseAutoAdd.retry();window.__zeroBaseline={state:JSON.stringify(state),ledger:localStorage.getItem(`universe-add-queue-${UNIVERSE_CLOUD_CONFIG.projectRef}`),requests:__sharedFixture.inserts};window.__zeroWrites=0;window.__originalPersist=persistCandidateSnapshot;persistCandidateSnapshot=async c=>{__zeroWrites++;return __originalPersist(c)};return stock});
        await fetch.click();await page.locator('[data-analysis-update="0"]').waitFor();assert.equal(await page.locator('[data-analysis-update="0"]').isDisabled(),true);assert.match(await page.locator('#analysisSyncBody').innerText(),/本机尚未添加该股票/);assert.equal(await page.locator('#analysisSyncConfirm').isVisible(),false);
        assert.equal(await page.evaluate(()=>__zeroWrites===0&&__sharedFixture.inserts===__zeroBaseline.requests&&JSON.stringify(state)===__zeroBaseline.state&&localStorage.getItem(`universe-add-queue-${UNIVERSE_CLOUD_CONFIG.projectRef}`)===__zeroBaseline.ledger),true);
        await page.screenshot({path:path.join(output,`missing-stock-${viewport.width}.png`)});await page.locator('#analysisSyncCancel').click();
        await page.evaluate(async stock=>{persistCandidateSnapshot=__originalPersist;const candidate=createValidatedCandidateSnapshot({stocks:[stock],updatedAt:null});await persistCandidateSnapshot(candidate);state=candidate;renderStockDetail()},savedStock);
        const before=await page.evaluate(()=>state.stocks[0].longTermLogic.investmentThesis);
        await fetch.click();await page.locator('[data-analysis-update="0"]').click();assert.match(await page.locator('#analysisSyncBody').innerText(),/本机版本与云端修订 1/);
        await page.locator('#analysisSyncCancel').click();assert.equal(await page.evaluate(()=>state.stocks[0].longTermLogic.investmentThesis),before);
        await fetch.click();await page.locator('[data-analysis-update="0"]').click();await page.locator('#analysisSyncConfirm').click();await page.waitForFunction(()=>document.getElementById('analysisSyncMessage')?.textContent.includes('已同步到本机'));
        assert.match(await page.evaluate(()=>state.stocks[0].longTermLogic.investmentThesis),/云端发布/);assert.equal(await page.evaluate(()=>window.__analysisSyncMock.writes),0);
      }else{
        for(const badStatus of ['future_unknown_status','published']){
          await page.evaluate(value=>__analysisSyncMock.badStatus=value,badStatus);await publish.click();await page.locator('#analysisSyncConfirm').click();await page.waitForFunction(()=>document.getElementById('analysisSyncMessage').textContent.includes('同步结果校验失败'));
          assert.notEqual(await page.evaluate(()=>ManualAnalysisSyncCloud.statusFor('long_term_logic','1810.HK').state),'synced');assert.equal(await page.locator('#analysisSyncConfirm').isVisible(),false);await page.locator('#analysisSyncCancel').click();
        }
        await page.evaluate(()=>delete __analysisSyncMock.badStatus);
        await publish.click();assert.match(await page.locator('#analysisSyncTitle').innerText(),/首次同步/);assert.equal(await page.evaluate(()=>window.__analysisSyncMock.writes),0);
        await page.locator('#analysisSyncConfirm').click();await page.waitForFunction(()=>document.getElementById('analysisSyncMessage')?.textContent.includes('已发布到云端'));
        assert.equal(await page.evaluate(()=>window.__analysisSyncMock.writes),1);await page.locator('#analysisSyncCancel').click();
      }
      if(await page.locator('#analysisSyncDialog').isVisible())await page.locator('#analysisSyncCancel').click();
      assert.equal(await page.evaluate(()=>UniverseAutoAdd.getClient()===ManualAnalysisSyncCloud.getClient()),true);
      assert.deepEqual(await page.evaluate(()=>[__sharedFixture.constructions,__sharedFixture.subscriptions]),[1,1]);
      for(const width of [500,1280,viewport.width]){await page.setViewportSize({width,height:viewport.height});assert.equal(await page.evaluate(()=>ManualAnalysisSyncCloud.role()),viewport.role)}
      await page.getByRole('button',{name:'自动同步设置',exact:true}).click();
      assert.equal(await page.locator('#universeSyncDialog .modal').evaluate(el=>el.scrollWidth>el.clientWidth+1),false);
      await page.screenshot({path:path.join(output,`analysis-role-${viewport.width}.png`)});await page.locator('#universeClose').click();
      await page.evaluate(()=>{openLongLogicModal();document.querySelectorAll('#longLogicBody details').forEach(node=>node.open=true)});assert.match(await page.locator('#longLogicBody').innerText(),/投资逻辑[\s\S]*核心驱动[\s\S]*关键风险[\s\S]*复核条件/);
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
      await page.screenshot({path:path.join(output,`manual-analysis-sync-${viewport.width}.png`),fullPage:true});
      await page.evaluate(()=>{window.__backup=JSON.stringify(alpha3ExportSnapshot(state));if(__backup.includes('analysis_sync_role'))throw new Error('role leaked to backup')});
      const backup=await page.evaluate(()=>__backup);page.on('dialog',d=>d.accept());
      const imported=page.waitForEvent('dialog',{predicate:d=>d.message().includes('导入成功')});
      await page.locator('#importFile').setInputFiles({name:'fixture.json',mimeType:'application/json',buffer:Buffer.from(backup)});
      await imported;await page.waitForFunction(role=>ManualAnalysisSyncCloud.role()===role,viewport.role);await page.reload();await page.waitForFunction(()=>UniverseAutoAdd.status().signedIn);
      assert.equal(await page.evaluate(()=>ManualAnalysisSyncCloud.role()),viewport.role);
      assert.deepEqual(errors,[]);results.push({viewport,publisherVisible:!mobile,fetchVisible:mobile,previewConfirm:true,cancelZeroWrite:true,missingStockZeroWrites:mobile,malformedRpcRejected:!mobile,roleResizeReloadBackup:true,oneClient:true,compactSections:true,noOverflow:true,pageErrors:errors});await context.close();
    }
  }finally{await browser.close()}
  fs.writeFileSync(path.join(output,'manual-analysis-sync-browser-results.json'),JSON.stringify(results,null,2));console.log(JSON.stringify(results));
})().catch(error=>{console.error(error);process.exitCode=1});
