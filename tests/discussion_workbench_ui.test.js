'use strict';

const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const test=require('node:test');

const root=path.join(__dirname,'..');
const ui=fs.readFileSync(path.join(root,'src','ui-render.js'),'utf8');
const app=fs.readFileSync(path.join(root,'src','app.js'),'utf8');
const workbench=fs.readFileSync(path.join(root,'src','discussion-workbench.js'),'utf8');
const contract=fs.readFileSync(path.join(root,'src','discussion-state-contract.js'),'utf8');
const html=fs.readFileSync(path.join(root,'index.html'),'utf8');
const fixture=fs.readFileSync(path.join(root,'tests','fixtures','discussion-workbench-mobile-acceptance.html'),'utf8');

test('existing AI discussion tab is renamed without adding a ninth workspace tab',()=>{
  const meta=ui.match(/const DETAIL_WORKSPACE_META=Object\.freeze\(\[([\s\S]*?)\]\);/);
  assert.ok(meta);assert.equal((meta[1].match(/\{key:/g)||[]).length,8);assert.match(meta[1],/\{key:'ai',label:'讨论'\}/);assert.doesNotMatch(meta[1],/AI讨论/);
});

test('workbench keeps Current State actions and one Plan Center shortcut without duplicate Plan controls',()=>{
  const panel=ui.match(/function aiDiscussionWorkspacePanel\(stock\)\{([\s\S]*?)\n\}/)?.[1]||'';
  for(const label of ['开始讨论','整理结论','导入结论','查看历史','转到计划中心']){assert.match(panel,new RegExp(label));assert.equal((panel.match(new RegExp(`>${label}<`,'g'))||[]).length,1,label)}
  for(const label of ['整理计划','导入计划'])assert.doesNotMatch(panel,new RegExp(`>${label}<`));
  for(const label of ['AI刷新','生成分析','刷新计划'])assert.doesNotMatch(panel,new RegExp(label));
  assert.match(ui,/预览结果/);assert.match(ui,/确认保存/);assert.match(ui,/保存后将成为下次讨论的起点/);
  assert.doesNotMatch(panel,/\bCurrent\b|Current State|needs_review|superseded|Discussion State/);
  assert.match(panel,/当前状态/);assert.match(panel,/当前结论/);assert.match(ui,/历史结论/);
});

test('compact status and controls always precede the latest conclusion and evidence/history',()=>{
  const panel=ui.match(/function aiDiscussionWorkspacePanel\(stock\)\{([\s\S]*?)\n\}/)?.[1]||'';
  assert.match(panel,/discussion-status-strip/);assert.match(panel,/discussion-status-warning/);assert.match(panel,/assessTechnicalAnchorReadiness/);
  assert.match(panel,/return `<div class="discussion-workbench">\$\{hero\}\$\{decision\}\$\{discussionHistoryPanel/);
  assert.doesNotMatch(panel,/decision\+hero/);
  const start=panel.indexOf('>开始讨论<'),archive=panel.indexOf('>整理结论<'),importState=panel.indexOf('>导入结论<');assert.ok(start>=0&&archive>start&&importState>archive);
  assert.match(panel,/开始讨论<\/button><button class="btn small"[^>]*>整理结论/);
  const card=ui.slice(ui.indexOf('function discussionStateCard'),ui.indexOf('function discussionHistoryPanel'));assert.match(card,/discussion-user-headline/);assert.match(card,/discussion-evidence/);assert.match(card,/<summary>判断依据<\/summary>/);
});

test('first-use actions are enabled and archive/import prepare protected context directly',()=>{
  const panel=ui.match(/function aiDiscussionWorkspacePanel\(stock\)\{([\s\S]*?)\n\}/)?.[1]||'';
  assert.doesNotMatch(panel,/data-detail-action="prepare-discussion-archive"[^>]*disabled/);
  assert.doesNotMatch(panel,/data-detail-action="import-discussion-state"[^>]*disabled/);
  assert.match(ui,/function ensureDiscussionArchiveContext\(stock\)/);
  assert.match(ui,/if\(!prepared\)prepared=window\.DiscussionWorkbench\.buildDiscussionRequest\(stock,discussionOptions\(\)\)/);
  assert.match(ui,/if\(!prepared\.archive\)prepared\.archive=window\.DiscussionWorkbench\.buildArchiveRequest\(prepared\)/);
  assert.match(ui,/本次结论的受保护上下文已准备/);
});

test('first-use empty state is compact and not duplicated',()=>{
  const panel=ui.match(/function aiDiscussionWorkspacePanel\(stock\)\{([\s\S]*?)\n\}/)?.[1]||'';
  assert.match(ui,/尚无讨论结论/);assert.match(ui,/首次保存结论后，程序将从这里继续跟踪后续变化/);
  assert.doesNotMatch(panel,/尚无已确认讨论结论|首次讨论将建立后续连续分析的起点/);
  assert.doesNotMatch(panel,/current\?discussionStateCard\(current,'当前结论'\):'<div class="card"/);
});

test('normal Discussion UI and messages do not leak internal English labels',()=>{
  const rendered=ui.slice(ui.indexOf('function discussionStatusPresentation'),ui.indexOf('const DETAIL_WORKSPACE_META'));
  for(const label of ['Current State','superseded','Discussion State'])assert.doesNotMatch(rendered,new RegExp(label));
  assert.doesNotMatch(workbench,/Current State/);
  assert.doesNotMatch(contract,/sourceDiscussionVersion 已过期或不一致/);
  assert.match(contract,/结论来源版本已过期或不一致/);
});

test('storage maintenance is mounted only inside Tools with compact abnormal warning',()=>{
  assert.match(ui,/id="storageMaintenanceSection"/);assert.match(ui,/数据维护/);assert.match(ui,/导出备份/);assert.match(ui,/数据恢复/);assert.match(ui,/存储状态/);assert.match(ui,/高级存储信息/);
  assert.match(app,/document\.getElementById\('storageMaintenancePanelMount'\)/);
  assert.doesNotMatch(app,/main\.parentNode\.insertBefore\(panel,main\)/);
  assert.match(app,/本地数据状态异常，请检查数据维护/);
  assert.match(app,/storageMaintenanceNeedsAttention\(record\).*record\.status==='failed'/);
  assert.match(ui,/showDiagnostics=currentTab==='tools'/);
  assert.match(ui,/id="backendToolStatus"/);
});

test('storage safety controls and recovery capabilities remain wired',()=>{
  for(const capability of ['exportShadowVerificationBackup','runShadowMigration','clearMigrationStaging','executeActiveCutover','getMigrationStatus','getShadowMigrationPreflight'])assert.match(app,new RegExp(capability));
  assert.match(app,/recoverUsingLegacy/);assert.match(app,/从最新 JSON 备份恢复/);assert.match(app,/Semantic checksum/);
});

test('prepared prompt remains selectable in the focused modal and shared clipboard helper is reused',()=>{
  assert.match(ui,/id="discussionPreparedPrompt" readonly/);assert.match(ui,/copyText\(payload\.request/);assert.match(ui,/selectableElement:field,detailsElement:details,manualCopy:false,notify:false/);
  assert.doesNotMatch(ui,/function copyDiscussionPrepared[\s\S]{0,900}navigator\.clipboard/);
  assert.match(ui,/discussionPreparedPrompt'\)\.value=payload\.request/);
});

test('Current State and Plan imports ask for the complete JSON code block and keep transport errors distinct',()=>{
  assert.ok((ui.match(/请完整复制 AI 返回的 JSON 代码块/g)||[]).length>=2);
  assert.match(ui,/placeholder='\\`\\`\\`json\\n\{"currentState":\{\.\.\.\}\}\\n\\`\\`\\`'/);
  assert.match(ui,/placeholder='\\`\\`\\`json\\n\{"schemaVersion":"discussion-plan-draft\.v1",\.\.\.\}\\n\\`\\`\\`'/);
  assert.match(fs.readFileSync(path.join(root,'src','strict-ai-json.js'),'utf8'),/复制的 JSON 内容发生格式异常，请重新完整复制 AI 的 JSON 代码块/);
  assert.match(contract,/StrictAiJson\.contractMessage/);
});

test('discussion import modal exposes anchor-blocker copy and uses explicit status region at preview/save error path',()=>{
  const imported=ui.slice(ui.indexOf('function ensureDiscussionImportDialog'),ui.indexOf('function ensureDiscussionPlanImportDialog'));
  assert.match(imported,/discussionImportMessage\" class=\"card-note\" role=\"status\" aria-live=\"polite\" tabindex=\"-1\"/);
  assert.match(imported,/缺少完整日K技术锚点，当前讨论可以继续，但暂不能保存为连续结论/);
  assert.match(imported,/translateDiscussionImportFailureMessage/);
  assert.match(imported,/confirmButton\.disabled=!result\.previewReady/);
  assert.match(imported,/region\.scrollIntoView/);
  assert.match(imported,/translateDiscussionImportFailureMessage\(result\.error\)/);
});

test('开始讨论 prepares the current request and opens its modal immediately without rendering or scrolling the page',()=>{
  const action=ui.slice(ui.indexOf('function startStockDiscussion'),ui.indexOf('function prepareDiscussionArchive'));
  assert.match(action,/buildDiscussionRequest\(stock,discussionOptions\(\)\)/);assert.match(action,/discussionPreparedContexts\.set/);assert.match(action,/openDiscussionPromptDialog\(stock,'discussion'\)/);
  assert.doesNotMatch(action,/renderStockDetail|scrollIntoView|scrollTo|saveState/);
});

test('整理结论 directly prepares protected archive context and opens the archive modal',()=>{
  const action=ui.slice(ui.indexOf('function prepareDiscussionArchive'),ui.indexOf('function ensureDiscussionArchiveContext'));
  assert.match(action,/ensureDiscussionArchiveContext\(stock\)/);assert.match(action,/openDiscussionPromptDialog\(stock,'archive'\)/);assert.doesNotMatch(action,/renderStockDetail|scrollIntoView|saveState/);
  assert.match(ui,/整理结论已准备/);assert.match(ui,/用于把刚才的讨论整理成可导入结论，不会修改计划或持仓/);assert.match(ui,/保存前仍需回到程序导入并确认/);
});

test('outbound prompt modal is compact by default with visible copy and close actions plus expandable complete text',()=>{
  const modal=ui.slice(ui.indexOf('function ensureDiscussionPromptDialog'),ui.indexOf('function openDiscussionPromptDialog'));
  assert.match(modal,/role','dialog'/);assert.match(modal,/aria-modal','true'/);assert.match(modal,/讨论上下文|discussionPromptTitle/);
  assert.match(modal,/>关闭<\/button>/);assert.match(modal,/>复制给AI<\/button>/);assert.match(modal,/<summary>查看完整 Prompt<\/summary>/);assert.match(modal,/textarea id="discussionPreparedPrompt" readonly/);
  const open=ui.slice(ui.indexOf('function openDiscussionPromptDialog'),ui.indexOf('function closeDiscussionPromptDialog'));
  assert.match(open,/details\.open=false/);assert.match(open,/discussionPromptCopyBtn[^\n]+focus/);assert.match(open,/discussion-prompt-open/);
});

test('discussion modal summary covers first use, incremental bars, zero new bars, and included facts without internal identifiers',()=>{
  const summary=ui.slice(ui.indexOf('function discussionPromptSummary'),ui.indexOf('function ensureDiscussionPromptDialog'));
  for(const wording of ['技术数据截至','新增日K：','自上次确认后暂无新的完整日K','首次讨论基线：','已带入：','当前结论','持仓','计划状态'])assert.match(summary,new RegExp(wording));
  for(const internal of ['sourceDiscussionVersion','protectedHash','schemaVersion','tokens','context hash'])assert.doesNotMatch(summary,new RegExp(internal));
});

test('copy result feedback stays inside modal and failure immediately exposes selectable full Prompt',()=>{
  const copy=ui.slice(ui.indexOf('async function copyDiscussionPrepared'),ui.indexOf('function toggleDiscussionHistory'));
  assert.match(copy,/已复制，可以前往 AI 继续讨论/);assert.match(copy,/复制失败，请长按复制/);assert.match(copy,/details\.open=true/);assert.match(copy,/field\.select\(\)/);assert.match(copy,/feedback\.textContent/);
  assert.doesNotMatch(copy,/alert\(/);assert.match(ui,/const notify=options\.notify!==false/);
});

test('closing and reopening preserves the in-memory prepared request and restores focus safely',()=>{
  const close=ui.slice(ui.indexOf('function closeDiscussionPromptDialog'),ui.indexOf('async function copyDiscussionPrepared'));
  assert.doesNotMatch(close,/discussionPreparedContexts\.(delete|clear)/);assert.match(close,/discussionPromptReturnFocus/);assert.match(close,/target\.isConnected/);assert.match(close,/focus\(\{preventScroll:true\}\)/);
  const importSave=ui.slice(ui.indexOf('async function confirmDiscussionImport'),ui.indexOf('function aiDiscussionWorkspacePanel'));
  assert.match(importSave,/discussionPreparedContexts\.delete/);
});

test('normal page no longer renders a duplicate generated Prompt block',()=>{
  const panel=ui.match(/function aiDiscussionWorkspacePanel\(stock\)\{([\s\S]*?)\n\}/)?.[1]||'';
  assert.doesNotMatch(panel,/discussionPreparedPanel|discussionPreparedPrompt|字符 .*tokens|连续讨论 Prompt/);
  assert.doesNotMatch(ui,/function discussionPreparedPanel/);
});

test('outbound modal presentation is write-free and import remains the only confirmed Discussion State write path',()=>{
  const outbound=ui.slice(ui.indexOf('function startStockDiscussion'),ui.indexOf('function toggleDiscussionHistory'));
  for(const write of ['saveState','DiscussionStateContract.commit','PlanReview.commit','allocationDecision','longTermLogic=','stock.shares='])assert.doesNotMatch(outbound,new RegExp(write.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')));
  const imported=ui.slice(ui.indexOf('function ensureDiscussionImportDialog'),ui.indexOf('function aiDiscussionWorkspacePanel'));
  assert.match(imported,/DiscussionStateContract\.commit/);assert.match(imported,/确认保存/);assert.match(imported,/discussionImportDialog/);
});

test('state normalization and storage validation include optional discussionState',()=>{
  const stateSource=fs.readFileSync(path.join(root,'src','state.js'),'utf8'),validation=fs.readFileSync(path.join(root,'src','storage','storage-validation.js'),'utf8');
  assert.match(stateSource,/stock\.discussionState=DiscussionWorkbench\.normalizeStore/);assert.match(validation,/DiscussionWorkbench\.validateStore\(stock\.discussionState\)/);
  assert.match(html,/src\/discussion-workbench\.js/);assert.match(html,/src\/discussion-state-contract\.js/);
});

test('390px layout keeps 4x2 tabs, 2x2 primary actions and touch-size controls',()=>{
  assert.match(html,/@media\(max-width:768px\)\{\.workspace-tablist\{display:grid;grid-template-columns:repeat\(4,minmax\(0,1fr\)\)/);
  assert.match(html,/\.discussion-actions\{display:grid;grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/);
  assert.match(html,/button,.btn,.btn\.small[\s\S]*?min-height:44px/);
  assert.match(fixture,/max-width:390px/);assert.match(fixture,/min-height:844px/);assert.match(fixture,/grid-template-columns:repeat\(4,minmax\(0,1fr\)\)/);assert.match(fixture,/min-height:44px/);
  assert.match(ui,/discussionImportConfirmBtn[^\n]+disabled/);assert.match(ui,/confirmButton\.disabled=true/);assert.match(ui,/import-json-status/);assert.doesNotMatch(ui,/JSON\.parse 错误|Unrecognized token|Unable to parse JSON string/);
});

test('390x844 prompt modal fits the viewport, locks the page, and keeps full Prompt scrolling internal',()=>{
  assert.match(html,/body\.discussion-prompt-open\{overflow:hidden\}/);assert.match(html,/discussion-prompt-modal[^}]*max-height:min\(92dvh,780px\)[^}]*overflow:hidden[^}]*display:flex/);
  assert.match(html,/discussion-prompt-details textarea[^}]*max-height:34vh[^}]*overflow:auto/);assert.match(html,/discussion-prompt-actions \.btn,.discussion-prompt-details>summary\{min-height:44px\}/);
  assert.match(html,/@media\(max-width:768px\)[\s\S]*?discussion-prompt-modal\{padding:17px;max-height:calc\(100dvh - 24px\)/);
  assert.match(fixture,/body\.prompt-open\{overflow:hidden\}/);assert.match(fixture,/max-height:calc\(100dvh - 24px\)/);assert.match(fixture,/prompt-details textarea[^}]*height:32vh[^}]*overflow:auto/);
});

test('isolated mobile fixture includes deterministic scenarios A-F and no inline Prompt hunting',()=>{
  assert.match(fixture,/params\.has\('first'\)/);assert.match(fixture,/params\.has\('zero'\)/);assert.match(fixture,/params\.has\('copyfail'\)/);assert.match(fixture,/establishPrior\(!params\.has\('zero'\)\)/);
  assert.match(fixture,/params\.has\('stale'\)/);assert.match(fixture,/params\.has\('high'\)/);assert.match(fixture,/params\.has\('protected'\)/);assert.match(fixture,/technicalDataStatus:stock\.technicalData\.technicalDataStatus/);assert.match(fixture,/受保护|outcome\.error\.message/);
  assert.match(fixture,/showPrompt\(prepared,'discussion'\)/);assert.match(fixture,/showPrompt\(context\.archive,'archive'\)/);assert.match(fixture,/复制失败，请长按复制/);assert.match(fixture,/已复制，可以前往 AI 继续讨论/);
  assert.doesNotMatch(fixture,/id="prepared"|id="request" class="prompt"/);
});

test('isolated acceptance fixture contains prior conclusion, anchor, four new bars, preview and history',()=>{
  assert.match(fixture,/首次结论：修复观察/);assert.match(fixture,/2026-08-25/);
  for(const date of ['2026-08-26','2026-08-27','2026-08-28','2026-08-31'])assert.match(fixture,new RegExp(date));
  assert.match(fixture,/预览结果/);assert.match(fixture,/当前结论/);assert.match(fixture,/历史结论/);
  assert.doesNotMatch(fixture,/Current State|\bCurrent\b|needs_review|superseded/);
  assert.match(fixture,/src\/strict-ai-json\.js/);
  assert.doesNotMatch(fixture,/localStorage|indexedDB|fetch\(/);
});
