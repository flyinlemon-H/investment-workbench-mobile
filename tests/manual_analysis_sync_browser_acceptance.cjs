'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const output=path.resolve(process.argv[2]||path.join('test-results','manual-analysis-sync-v1')),url='http://127.0.0.1:8768/';

(async()=>{
  fs.mkdirSync(output,{recursive:true});const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_EXECUTABLE||undefined}),results=[];
  try{
    for(const viewport of [{width:1280,height:900},{width:390,height:844}]){
      const context=await browser.newContext({viewport}),page=await context.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));
      await context.route('**/*',route=>new URL(route.request().url()).origin===new URL(url).origin?route.continue():route.abort());
      await page.goto(url);await page.waitForFunction(()=>document.getElementById('main')?.dataset.storageState==='ready');
      const mobile=viewport.width<=768,fetch=page.locator('#analysisFetchBtn'),fetchDiag=await page.evaluate(()=>{const el=document.getElementById('analysisFetchBtn');return {hidden:el.hidden,display:getComputedStyle(el).display,parent:getComputedStyle(el.parentElement).display,role:ManualAnalysisSyncCloud.mobileUi(),width:innerWidth}});assert.equal(await fetch.isVisible(),mobile,`${viewport.width}px fetch visibility ${JSON.stringify(fetchDiag)}`);
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
        window.UniverseSupabaseSdk={createClient:()=>({auth:{getSession:async()=>({data:{session:{user:{id:'acceptance-owner'}}},error:null})},rpc:async(name,args)=>{
          const mock=window.__analysisSyncMock;
          if(name==='get_analysis_module')return {data:mock.row,error:null};
          if(name==='list_analysis_modules')return {data:mock.row?[structuredClone(mock.row)]:[],error:null};
          if(name==='publish_analysis_module'){
            const revision=mock.row?mock.row.revision+1:1;mock.writes+=1;mock.row={moduleType:args.p_module_type,entityKey:args.p_entity_key,moduleSchemaVersion:args.p_module_schema_version,revision,payloadHash:args.p_payload_hash,publishedAt:'2026-09-04T02:35:00.000Z',payload:structuredClone(args.p_payload)};
            return {data:{status:'published',module:structuredClone(mock.row)},error:null};
          }
          return {data:null,error:{status:404}};
        }})};
      },mobile);
      if(mobile){
        const before=await page.evaluate(()=>state.stocks[0].longTermLogic.investmentThesis);
        await fetch.click();await page.locator('[data-analysis-update="0"]').click();assert.match(await page.locator('#analysisSyncBody').innerText(),/本机版本与云端修订 1/);
        await page.locator('#analysisSyncCancel').click();assert.equal(await page.evaluate(()=>state.stocks[0].longTermLogic.investmentThesis),before);
        await fetch.click();await page.locator('[data-analysis-update="0"]').click();await page.locator('#analysisSyncConfirm').click();await page.waitForFunction(()=>document.getElementById('analysisSyncMessage')?.textContent.includes('已同步到本机'));
        assert.match(await page.evaluate(()=>state.stocks[0].longTermLogic.investmentThesis),/云端发布/);assert.equal(await page.evaluate(()=>window.__analysisSyncMock.writes),0);
      }else{
        await publish.click();assert.match(await page.locator('#analysisSyncTitle').innerText(),/首次同步/);assert.equal(await page.evaluate(()=>window.__analysisSyncMock.writes),0);
        await page.locator('#analysisSyncConfirm').click();await page.waitForFunction(()=>document.getElementById('analysisSyncMessage')?.textContent.includes('已发布到云端'));
        assert.equal(await page.evaluate(()=>window.__analysisSyncMock.writes),1);await page.locator('#analysisSyncCancel').click();
      }
      await page.evaluate(()=>{openLongLogicModal();document.querySelectorAll('#longLogicBody details').forEach(node=>node.open=true)});assert.match(await page.locator('#longLogicBody').innerText(),/投资逻辑[\s\S]*核心驱动[\s\S]*关键风险[\s\S]*复核条件/);
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
      await page.screenshot({path:path.join(output,`manual-analysis-sync-${viewport.width}.png`),fullPage:true});
      assert.deepEqual(errors,[]);results.push({viewport,publisherVisible:!mobile,fetchVisible:mobile,previewConfirm:true,cancelZeroWrite:true,compactSections:true,noOverflow:true,pageErrors:errors});await context.close();
    }
  }finally{await browser.close()}
  fs.writeFileSync(path.join(output,'manual-analysis-sync-browser-results.json'),JSON.stringify(results,null,2));console.log(JSON.stringify(results));
})().catch(error=>{console.error(error);process.exitCode=1});
