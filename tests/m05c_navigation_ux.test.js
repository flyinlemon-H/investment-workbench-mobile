'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const read=file=>fs.readFileSync(path.join(__dirname,'..',file),'utf8');

test('top module switch contains only technical review and today portfolio peers',()=>{
  const ui=read('src/portfolio-review-ui.js'),multi=read('src/multi-stock-analysis.js');
  assert.match(ui,/m05c-module-nav/);assert.match(ui,/技术复核/);assert.match(ui,/今日组合/);
  assert.doesNotMatch(ui,/m05c-mode-tabs/);assert.doesNotMatch(ui,/>生成复核</);assert.doesNotMatch(ui,/>今日结果</);
  assert.match(multi,/btn m05c-module-active[^>]*aria-current="page">技术复核/);
  assert.match(ui,/btn m05c-module-active[^>]*aria-current="page">今日组合/);
});

test('portfolio workflow uses explicit actions rather than peer tabs',()=>{
  const ui=read('src/portfolio-review-ui.js');
  for(const label of ['选择股票','生成组合复核','查看今日结果','返回选股','复制给 AI','粘贴 AI 结果','预览结果','保存复核'])assert.match(ui,new RegExp(label));
  assert.match(ui,/m05c-module-active\{background:var\(--seal\)/);
  assert.match(ui,/还没有今日组合复核/);
});

test('390px styling remains full-screen, single-column, and width-safe',()=>{
  const ui=read('src/portfolio-review-ui.js');
  assert.match(ui,/@media\(max-width:640px\)/);assert.match(ui,/height:100dvh/);assert.match(ui,/\.m05c-stock-grid\{grid-template-columns:1fr\}/);assert.doesNotMatch(ui,/min-width:\s*[4-9]\d\dpx/);
});
