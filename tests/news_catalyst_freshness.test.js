'use strict';

const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const test=require('node:test');
const vm=require('node:vm');

const root=path.resolve(__dirname,'..');
const read=file=>fs.readFileSync(path.join(root,file),'utf8');
const clone=value=>structuredClone(value);

function oldFii(){
  return {
    id:'fii',code:'601138.SS',name:'工业富联',type:'holding',
    sentimentReview:{updatedAt:'2026-07-02',marketMood:'7月2日急跌，风险偏好下降',fundFlowView:'7月1日主力资金净流出'},
    shortTermSentiment:{updatedAt:'2026-07-02',marketMood:'7月2日急跌，风险偏好下降',fundFlowView:'7月1日主力资金净流出',sectorHeat:'六月/七月板块走弱'},
    recentCatalyst:{analysisDate:'2026-07-02',todayCatalyst:'七月旧催化'},
    eventExplanation:{priceActionDetected:true,explanationLevel:'partial',explanation:'七月旧解释'},
    informationCompleteness:{news:'medium',fundFlow:'medium',overall:'medium'},
    aiReviews:{newsReview:{updatedAt:'2026-07-02',attentionPoints:['七月 legacy 新闻事件']}},
    dataFreshness:{newsUpdatedAt:'2026-07-02',socialUpdatedAt:'2026-07-02'}
  };
}

function runtime(saveBehavior=async()=>({ok:true})){
  const context={console,window:{},globalThis:null,setTimeout:()=>0,clearTimeout:()=>{},structuredClone,alert:()=>{}};
  context.globalThis=context;
  context.fixture=oldFii();
  context.saveBehavior=saveBehavior;
  vm.createContext(context);
  vm.runInContext(read('src/state.js'),context,{filename:'state.js'});
  vm.runInContext(read('src/ui-render.js'),context,{filename:'ui-render.js'});
  vm.runInContext(`
    state={stocks:[fixture]};
    detailStockId='fii';
    this.alerts=[];
    this.saveCalls=[];
    alert=message=>alerts.push(String(message));
    saveState=async(value,options)=>{saveCalls.push({value:structuredClone(value),options:structuredClone(options||{})});return saveBehavior(value,options);};
    markV13DecisionReviewDirty=()=>{};
    closeSentimentImportModal=()=>{};
    refreshLongLogicModalIfOpen=()=>{};
    render=()=>{};
    this.audit={
      importText:text=>importSentimentPayloadFromText(text),
      stock:()=>structuredClone(state.stocks[0]),
      html:()=>newsWorkspacePanel(state.stocks[0]),
      recentPrompt:()=>recentCatalystPromptText(state.stocks[0]),
      shortPrompt:()=>shortTermSentimentPromptText(state.stocks[0]),
      calls:()=>structuredClone(saveCalls),
      alerts:()=>structuredClone(alerts)
    };
  `,context);
  return context.audit;
}

function augustRecent(extra={}){
  return JSON.stringify({
    recentCatalyst:{
      analysisDate:'2026-08-17T13:55',latestSourceDate:'2026-08-17',hasTodayNews:false,
      todayCatalyst:'今日未发现重大公司公告、订单或业绩事件',
      missingData:['盘中完整资金流、陆股通、龙虎榜及盘后公告尚不能确认'],confidence:'low',
      ...extra
    },
    informationCompleteness:{news:'medium',fundFlow:'low',overall:'low',missingItems:['盘中完整资金数据尚不能确认']}
  });
}

test('601138.SS fresh catalyst import clears omitted July sentiment and fund flow before one critical save',async()=>{
  const app=runtime();
  await app.importText(augustRecent());
  const stock=app.stock();
  const html=app.html();
  const calls=app.calls();
  assert.equal(stock.recentCatalyst.analysisDate,'2026-08-17');
  assert.equal(stock.shortTermSentiment.updatedAt,'2026-08-17');
  assert.equal(stock.shortTermSentiment.marketMood,'');
  assert.equal(stock.shortTermSentiment.fundFlowView,'');
  assert.deepEqual(stock.recentCatalyst.recentEvents,[]);
  assert.doesNotMatch(html,/7月2日急跌|7月1日主力资金净流出|七月 legacy 新闻事件/);
  assert.match(html,/截至 2026-08-17/);
  assert.match(html,/情绪 当前未确认/);
  assert.match(html,/资金 当前未确认/);
  assert.equal(calls.length,1);
  assert.equal(calls[0].options.critical,true);
  assert.equal(calls[0].value.stocks[0].shortTermSentiment.fundFlowView,'');
});

test('complete August current snapshot replaces every time-sensitive child value',async()=>{
  const app=runtime();
  const payload=JSON.stringify({
    recentCatalyst:{analysisDate:'2026-08-17',latestSourceDate:'2026-08-17',hasTodayNews:true,todayCatalyst:'八月新公告',recentEvents:[]},
    shortTermSentiment:{updatedAt:'2026-08-17',marketMood:'八月情绪中性',fundFlowView:'八月资金流已确认',sectorHeat:'八月板块温和',institutionalView:'八月机构观点',riskFlags:[],confidence:'medium',actionHint:'等待确认'},
    eventExplanation:{priceActionDetected:false,explanationLevel:'none',canExplainTodayMove:false,explanation:'八月无异动'},
    informationCompleteness:{news:'high',fundFlow:'high',overall:'high',missingItems:[]}
  });
  await app.importText(payload);
  const stock=app.stock();
  assert.equal(stock.shortTermSentiment.marketMood,'八月情绪中性');
  assert.equal(stock.shortTermSentiment.fundFlowView,'八月资金流已确认');
  assert.equal(stock.shortTermSentiment.sectorHeat,'八月板块温和');
  assert.equal(stock.eventExplanation.explanation,'八月无异动');
  assert.equal(stock.informationCompleteness.fundFlow,'high');
});

test('explicit unavailable current values render as current, not as historical fallback',async()=>{
  const app=runtime();
  const payload=JSON.parse(augustRecent());
  payload.shortTermSentiment={updatedAt:'2026-08-17',marketMood:'当前未确认',fundFlowView:'盘中完整资金数据尚不能确认',sectorHeat:'当前未确认',institutionalView:'当前未确认',riskFlags:[],confidence:'low',actionHint:'等待收盘后数据'};
  await app.importText(JSON.stringify(payload));
  const html=app.html();
  assert.match(html,/盘中完整资金数据尚不能确认/);
  assert.doesNotMatch(html,/7月2日急跌|7月1日主力资金净流出/);
});

test('older ongoing catalyst context remains visible only under historical-reference labels',async()=>{
  const app=runtime();
  await app.importText(augustRecent({monthlyCatalysts:['2026-07-20 业绩催化仍在持续验证'],recentEvents:[{date:'2026-07-20',type:'earnings',summary:'旧业绩事件作为持续性背景'}]}));
  const html=app.html();
  assert.match(html,/最近30天催化（历史参考）/);
  assert.match(html,/近期事件（历史\/持续性背景）/);
  assert.match(html,/旧业绩事件作为持续性背景/);
});

test('prompts require full current fields and mark previous values as historical context only',()=>{
  const app=runtime();
  const recent=app.recentPrompt();
  const short=app.shortPrompt();
  assert.match(recent,/完整当前快照/);
  assert.match(recent,/previousAnalysisContext 只作历史参考/);
  assert.match(recent,/不得省略字段/);
  assert.match(recent,/"shortTermSentiment"/);
  assert.match(short,/旧值除非本次重新核验，否则不得复制为当前值/);
  assert.match(short,/必须返回 shortTermSentiment 的全部字段/);
});

test('failed current import restores existing News Catalyst snapshot and performs no successful adoption',async()=>{
  const app=runtime(async()=>{throw new Error('disk unavailable')});
  const before=app.stock();
  await app.importText(augustRecent());
  const after=app.stock();
  for(const key of ['sentimentReview','shortTermSentiment','recentCatalyst','eventExplanation','informationCompleteness','dataFreshness'])assert.deepEqual(after[key],before[key]);
  assert.equal(app.calls().length,1);
  assert.match(app.alerts().at(-1),/导入失败/);
});

test('invalid preview/import payload performs zero writes',async()=>{
  const app=runtime();
  await app.importText('{"recentCatalyst":');
  assert.equal(app.calls().length,0);
  assert.match(app.alerts().at(-1),/导入失败/);
});
