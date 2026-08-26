'use strict';

const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const test=require('node:test');
const Ux=require('../src/technical-view-ux.js');

const root=path.resolve(__dirname,'..');
const read=file=>fs.readFileSync(path.join(root,file),'utf8');

function completeHistory(lastDate='2026-08-14'){
  return [{date:'2026-08-13',close:34,is_complete_bar:true},{date:lastDate,close:35,is_complete_bar:true}];
}

test('canonical technical date is the AI facts date when all complete-bar sources agree',()=>{
  const result=Ux.canonicalTechnicalDate({
    technicalData:{technicalAsOf:'2026-08-14',latestCompleteBar:'2026-08-14',technicalDataStatus:'fresh'},
    priceHistory:completeHistory(),referenceDate:'2026-08-17'
  });
  assert.equal(result.date,'2026-08-14');
  assert.equal(result.label,'技术数据最新至');
  assert.equal(result.status,'fresh');
  assert.equal(result.warning,'');
});

test('date conflict fails safe without presenting either source as latest',()=>{
  const result=Ux.canonicalTechnicalDate({
    technicalData:{technicalAsOf:'2026-08-13',latestCompleteBar:'2026-08-13',technicalDataStatus:'fresh'},
    priceHistory:completeHistory('2026-08-14'),referenceDate:'2026-08-17'
  });
  assert.equal(result.date,'');
  assert.equal(result.status,'anomaly');
  assert.equal(result.conflict,true);
  assert.match(result.warning,/日期不一致/);
  assert.doesNotMatch(`${result.label}${result.warning}`,/最新至/);
});

test('stale technical facts show an explicit warning and never claim latest',()=>{
  const result=Ux.canonicalTechnicalDate({
    technicalData:{technicalAsOf:'2026-08-14',latestCompleteBar:'2026-08-14',technicalDataStatus:'stale'},
    priceHistory:completeHistory(),referenceDate:'2026-08-17'
  });
  assert.equal(result.date,'2026-08-14');
  assert.equal(result.label,'技术数据截至');
  assert.equal(result.warning,'技术数据可能已过期');
  assert.equal(result.status,'stale');
  assert.doesNotMatch(result.label,/最新/);
});

test('an old persisted fresh flag cannot make old technical facts render as latest indefinitely',()=>{
  const result=Ux.canonicalTechnicalDate({
    technicalData:{technicalAsOf:'2026-08-14',latestCompleteBar:'2026-08-14',technicalDataStatus:'fresh'},
    priceHistory:completeHistory(),referenceDate:'2026-08-26'
  });
  assert.equal(result.status,'stale');
  assert.equal(result.label,'技术数据截至');
  assert.equal(result.warning,'技术数据可能已过期');
  assert.equal(result.ageInBusinessDays,8);
});

test('a future technical date is an anomaly even when the persisted flag says fresh',()=>{
  const result=Ux.canonicalTechnicalDate({
    technicalData:{technicalAsOf:'2026-08-27',latestCompleteBar:'2026-08-27',technicalDataStatus:'fresh'},
    priceHistory:completeHistory('2026-08-27'),referenceDate:'2026-08-26'
  });
  assert.equal(result.status,'anomaly');
  assert.equal(result.date,'');
  assert.match(result.warning,/日期不一致/);
});

test('recent successful task status is presented as currently normal',()=>{
  const result=Ux.taskStatusPresentation({
    generated_at:'2026-08-26T08:00:00+08:00',task_exists:true,enabled:true,
    next_run_time:'2026-08-26T16:30:00+08:00',last_run_time:'2026-08-25T16:30:00.0000000+08:00',last_task_result:0,
    latest_run:{status:'success',finished_at:'2026-08-25T16:35:00.0000000+08:00'}
  },{now:Date.parse('2026-08-26T10:00:00+08:00')});
  assert.deepEqual(result,{kind:'normal',label:'自动更新正常',result:'最近运行成功',current:true});
});

test('old successful task status is qualified as historical rather than current success',()=>{
  const result=Ux.taskStatusPresentation({
    generated_at:'2026-08-14T17:38:34.7716835+08:00',task_exists:true,enabled:true,
    next_run_time:'2026-08-17T16:30:00.0000000+08:00',last_run_time:'2026-08-14T17:38:26.0000000+08:00',last_task_result:0,
    latest_run:{status:'success',finished_at:'2026-08-14T17:38:32.9195356+08:00'}
  },{now:Date.parse('2026-08-26T10:00:00+08:00')});
  assert.equal(result.label,'自动更新状态较旧');
  assert.equal(result.result,'历史记录为成功');
  assert.equal(result.current,false);
});

test('recent failed task state uses natural Chinese',()=>{
  const result=Ux.taskStatusPresentation({
    generated_at:'2026-08-26T09:00:00+08:00',task_exists:true,enabled:true,
    next_run_time:'2026-08-26T16:30:00+08:00',last_run_time:'2026-08-25T16:30:00+08:00',last_task_result:1,
    latest_run:{status:'failed',finished_at:'2026-08-25T16:31:00+08:00'}
  },{now:Date.parse('2026-08-26T10:00:00+08:00')});
  assert.deepEqual(result,{kind:'failed',label:'最近更新失败',result:'最近运行失败',current:true});
  assert.doesNotMatch(`${result.label}${result.result}`,/fresh|stale|failed|taskStatus/);
});

test('newer AI review names the older authoritative technical-data basis',()=>{
  assert.equal(Ux.technicalReviewBasisNotice({updatedAt:'2026-08-18T09:00:00+08:00'},'2026-08-14'),'AI 判断基于截至 08-14 的技术数据');
  assert.equal(Ux.technicalReviewBasisNotice({updatedAt:'2026-08-14'},'2026-08-14'),'');
  assert.equal(Ux.technicalReviewBasisNotice({updatedAt:'2026-08-13'},'2026-08-14'),'');
});

test('technical view localization maps enums without rewriting stored contract values',()=>{
  const stored={trendStatus:'uptrend',cyclePosition:'unclear',provider:'eastmoney'};
  assert.equal(Ux.localizeTrend(stored.trendStatus),'上升趋势');
  assert.equal(Ux.localizeTrend('sideways'),'震荡');
  assert.equal(Ux.localizeTrend(stored.cyclePosition),'不明确');
  assert.equal(Ux.localizeRiskLevel(1),'轻度');
  assert.equal(Ux.localizeProvider(stored.provider),'东方财富');
  assert.equal(Ux.localizeUserText('长期逻辑状态为 unclear，需要复核'),'长期逻辑状态为 不明确，需要复核');
  assert.equal(Ux.localizeUserText('风险 Level 1 · eastmoney'),'风险 轻度 · 东方财富');
  assert.deepEqual(stored,{trendStatus:'uptrend',cyclePosition:'unclear',provider:'eastmoney'});
});

test('machine signals are rendered as user-facing Chinese facts',()=>{
  const raw='currentPrice > ma20 > ma60，强势趋势';
  const localized=Ux.localizeMachineSignal(raw);
  assert.equal(localized,'现价位于 MA20、MA60 上方，且 MA20 高于 MA60，中期结构偏强');
  assert.doesNotMatch(localized,/currentPrice|ma20|ma60/);
});

test('technical workspace source enforces conclusion, evidence, status, and collapsed maintenance hierarchy',()=>{
  const source=read('src/ui-render.js');
  const start=source.indexOf('function technicalWorkspacePanel');
  const end=source.indexOf('\nfunction newsWorkspacePanel',start);
  const workspace=source.slice(start,end);
  assert(start>=0&&end>start);
  assert.match(workspace,/technicalConclusionLayer/);
  assert.match(workspace,/technicalEvidenceLayer/);
  assert.match(workspace,/technicalDataStatusLayer/);
  assert.match(workspace,/technicalMaintenanceLayer/);
  assert(workspace.indexOf('technicalConclusionLayer')<workspace.indexOf('technicalEvidenceLayer'));
  assert(workspace.indexOf('technicalEvidenceLayer')<workspace.indexOf('technicalDataStatusLayer'));
  assert.doesNotMatch(workspace,/technicalSignalPanel|trendRiskManagementPanel|marketDataFreshnessPanel/);

  const renderStart=source.indexOf('function technicalConclusionLayer');
  const renderEnd=source.indexOf('\nfunction technicalAnalysisPromptText',renderStart);
  const renderers=source.slice(renderStart,renderEnd);
  for(const copy of ['Batch Contract V2','invalid_schema'])assert.doesNotMatch(renderers,new RegExp(copy));
  assert.match(renderers,/>技术结论</);
  assert.match(renderers,/>查看技术依据</);
  assert.match(renderers,/>数据状态</);
  assert.match(renderers,/>数据维护</);
  assert.match(renderers,/data-technical-review-basis/);
  assert.match(renderers,/data-technical-layer="maintenance"/);
  assert.doesNotMatch(renderers,/data-technical-layer="maintenance"[^>]*open/);
});

test('mobile detail tabs remain a 4 by 2 grid without horizontal scrolling',()=>{
  const html=read('index.html');
  assert.match(html,/@media\(max-width:768px\)\{\.workspace-tablist\{display:grid;grid-template-columns:repeat\(4,minmax\(0,1fr\)\)/);
  assert.match(html,/\.workspace-tablist\{[^}]*overflow:visible/);
  const labels=['AI讨论','计划','操作记录','技术面','新闻催化','基本面','估值/配置','长期逻辑'];
  const source=read('src/ui-render.js');
  labels.forEach(label=>assert.match(source,new RegExp(`label:'${label}'`)));
});
