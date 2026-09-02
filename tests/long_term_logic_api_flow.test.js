'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

const root=path.resolve(__dirname,'..');
const read=file=>fs.readFileSync(path.join(root,file),'utf8');

function runtime(mode='valid'){
  const context={console,window:null,globalThis:null,setTimeout:()=>0,clearTimeout:()=>{},structuredClone,alert:()=>{},document:{getElementById:()=>null}};
  context.window=context;context.globalThis=context;
  vm.createContext(context);
  for(const file of ['src/symbol-identity.js','src/strict-ai-json.js','src/state.js','src/long-term-logic-contract.js','src/long-term-logic-workflow.js','src/ui-render.js'])vm.runInContext(read(file),context,{filename:file});
  vm.runInContext(`
    state={stocks:[{id:'fixture',code:'601138.SS',symbol:'601138.SS',name:'工业富联',type:'holding',role:'成长仓',theme:'AI算力',shares:100,avgCost:40,plans:[],longTermLogic:{updatedAt:'2026-06-01',validUntil:'2026-12-01',investmentThesis:'原有行业与公司逻辑支持组合中的成长角色。',coreDrivers:['原驱动'],industryDrivers:['原行业驱动'],companyDrivers:['原公司驱动'],portfolioDrivers:['原组合驱动'],fundamentalSupport:'原基本面资料提供辅助验证。',longTermRisks:['原长期风险'],logicStatus:'valid',confidence:'medium',nextReviewDate:'2026-09-01',sourceSummary:'原资料摘要。'},dataFreshness:{personalViewUpdatedAt:'2026-06-01'}}]};
    this.saves=[];this.renders=0;render=()=>{renders++};refreshLongLogicModalIfOpen=()=>{};
    saveState=async candidate=>{saves.push(structuredClone(candidate));return {ok:true,state:candidate}};
    BackendHealth={state:{status:'unknown',capabilities:{aiRequest:false},errorType:''},check:async()=>{BackendHealth.state.status='available';BackendHealth.state.capabilities.aiRequest=true;return 'available'}};
    function responseFromPrompt(prompt){const marker='【受保护绑定】',binding=JSON.parse(prompt.split(marker)[1].split('\\n\\n')[0].trim()),start=new Date(binding.promptDate+'T00:00:00Z'),date=days=>{const value=new Date(start);value.setUTCDate(value.getUTCDate()+days);return value.toISOString().slice(0,10)};return JSON.stringify({binding:{symbol:binding.symbol,contextHash:binding.contextHash},longTermLogic:{updatedAt:binding.promptDate,validUntil:date(180),investmentThesis:'行业长期需求、公司交付护城河和组合成长角色共同支持继续跟踪。',coreDrivers:['行业长期需求','公司交付能力','组合成长角色'],industryDrivers:['行业未来多年仍有结构性需求'],companyDrivers:['公司交付与供应链能力形成护城河'],portfolioDrivers:['在组合中承担长期成长观察角色'],fundamentalSupport:'现有基本面资料对长期逻辑提供辅助验证。',longTermRisks:['行业需求不及预期','公司竞争优势减弱'],logicStatus:'valid',confidence:'medium',nextReviewDate:date(90),sourceSummary:'基于受保护上下文中的长期逻辑、基本面和估值资料。'}})}
    InvestmentApi={ai:{request:async input=>{
      if(${JSON.stringify(mode)}==='network')throw Object.assign(new Error('offline'),{type:'network_error'});
      return {response:{requestId:'request-1',provider:'mock',model:'deterministic-long-term-v1',content:${JSON.stringify(mode)}==='invalid'?'{"bad":true}':responseFromPrompt(input.prompt),elapsedMs:2}};
    }}};
    this.audit={run:()=>callLongTermLogicAi(state.stocks[0]),stock:()=>structuredClone(state.stocks[0]),saveCount:()=>saves.length,status:()=>longTermAiStatusPanel(state.stocks[0]),prompt:()=>longTermLogicPromptText(state.stocks[0])};
  `,context);
  return context.audit;
}

test('user-triggered API response reaches the shared processor and one automatic protected save',async()=>{
  const app=runtime('valid');
  await app.run();
  assert.equal(app.saveCount(),1);
  const stock=app.stock();
  assert.equal(stock.longTermLogic.logicStatus,'valid');
  assert.equal(stock.longTermLogicAudit.current.responseHash.startsWith('ltresp_'),true);
  assert.equal(stock.longTermLogicAudit.history.length,1);
  assert.match(app.status(),/已更新/);
});

test('invalid provider content and unavailable Bridge keep canonical state with zero writes',async()=>{
  for(const mode of ['invalid','network']){
    const app=runtime(mode),before=app.stock();
    await app.run();
    assert.equal(app.saveCount(),0,mode);
    assert.deepEqual(app.stock(),before,mode);
    assert.match(app.status(),mode==='invalid'?/校验失败/:/API不可用/);
  }
});

test('Long-Term UI keeps manual fallback, adds one API action, and does not add device modes',()=>{
  const ui=read('src/ui-render.js'),html=read('index.html');
  assert.match(ui,/call-long-term-logic-ai/);assert.match(ui,/调用AI/);assert.match(ui,/copy-long-term-logic-prompt/);assert.match(ui,/复制给AI/);
  assert.doesNotMatch(ui,/API更新|run_ai_task\.py/);assert.doesNotMatch(ui+html,/PC模式|手机模式/);
  assert.match(ui,/LongTermLogicWorkflow\.processPrepared/);assert.match(ui,/commitProcessedLongTermLogic/);
});
