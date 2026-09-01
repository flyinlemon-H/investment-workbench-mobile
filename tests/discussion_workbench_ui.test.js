'use strict';

const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const test=require('node:test');

const root=path.join(__dirname,'..');
const ui=fs.readFileSync(path.join(root,'src','ui-render.js'),'utf8');
const html=fs.readFileSync(path.join(root,'index.html'),'utf8');
const fixture=fs.readFileSync(path.join(root,'tests','fixtures','discussion-workbench-mobile-acceptance.html'),'utf8');

test('existing AI discussion tab is renamed without adding a ninth workspace tab',()=>{
  const meta=ui.match(/const DETAIL_WORKSPACE_META=Object\.freeze\(\[([\s\S]*?)\]\);/);
  assert.ok(meta);assert.equal((meta[1].match(/\{key:/g)||[]).length,8);assert.match(meta[1],/\{key:'ai',label:'讨论'\}/);assert.doesNotMatch(meta[1],/AI讨论/);
});

test('workbench exposes the concise four-action Chinese workflow and no prohibited action names',()=>{
  const panel=ui.match(/function aiDiscussionWorkspacePanel\(stock\)\{([\s\S]*?)\n\}/)?.[1]||'';
  for(const label of ['开始讨论','整理结论','导入结论','查看历史'])assert.match(panel,new RegExp(label));
  for(const label of ['AI刷新','生成分析','刷新计划'])assert.doesNotMatch(panel,new RegExp(label));
  assert.match(ui,/预览结果/);assert.match(ui,/确认保存/);assert.match(ui,/保存后将成为下次讨论的起点/);
});

test('prepared prompt remains selectable and shared clipboard helper is reused',()=>{
  assert.match(ui,/id="discussionPreparedPrompt" readonly/);assert.match(ui,/copyText\(payload\.request/);assert.match(ui,/sourceElement:document\.getElementById\('discussionPreparedPrompt'\)/);
  assert.doesNotMatch(ui,/function copyDiscussionPrepared[\s\S]{0,900}navigator\.clipboard/);
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

test('isolated acceptance fixture contains prior conclusion, anchor, four new bars, preview and history',()=>{
  assert.match(fixture,/首次结论：修复观察/);assert.match(fixture,/2026-08-25/);
  for(const date of ['2026-08-26','2026-08-27','2026-08-28','2026-08-31'])assert.match(fixture,new RegExp(date));
  assert.match(fixture,/预览结果/);assert.match(fixture,/Current State/);assert.match(fixture,/已被替代/);
  assert.doesNotMatch(fixture,/localStorage|indexedDB|fetch\(/);
});
