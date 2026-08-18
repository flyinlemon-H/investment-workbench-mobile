'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
const read=file=>fs.readFileSync(path.join(root,file),'utf8');

test('M05C scripts load after parser and before UI workflow without changing eight detail tabs',()=>{
  const index=read('index.html'),ui=read('src/ui-render.js');
  const batch=index.indexOf('src/batch-technical-review.js'),context=index.indexOf('src/portfolio-review-context.js'),contract=index.indexOf('src/portfolio-review-contract.js'),multi=index.indexOf('src/multi-stock-analysis.js'),portfolioUi=index.indexOf('src/portfolio-review-ui.js');
  assert.ok(batch<context&&context<contract&&contract<multi&&multi<portfolioUi);
  assert.match(ui,/DETAIL_WORKSPACE_TABS=Object\.freeze\(\['ai','plan','operation','technical','news','fundamental','valuation','longterm'\]\)/);
});

test('M05C mobile workflow exposes short Chinese labels, preview-before-save, and no screenshot or Direct AI UI',()=>{
  const ui=read('src/portfolio-review-ui.js'),multi=read('src/multi-stock-analysis.js');
  for(const label of ['今日组合','技术复核','生成组合复核','查看今日结果','返回选股','复制给 AI','粘贴 AI 结果','预览结果','保存复核','优先关注','风险关注','计划接近','候选观察','数据限制'])assert.match(ui,new RegExp(label));
  assert.match(multi,/今日分析/);assert.match(multi,/multiStockPortfolioBtn/);
  assert.ok(ui.indexOf('m05cPreviewBtn')<ui.indexOf('m05cSaveBtn'));
  assert.doesNotMatch(ui,/截图上传|OpenAI API|DeepSeek|apiKey/i);
  assert.doesNotMatch(ui,/m05c-mode-tabs|>生成复核<|>今日结果</);
});

test('M05C 390x844 modal is full-screen, touch-safe, single-column, and prevents horizontal card overflow',()=>{
  const ui=read('src/portfolio-review-ui.js');
  assert.match(ui,/@media\(max-width:640px\)/);assert.match(ui,/height:100dvh/);assert.match(ui,/#portfolioReviewModal button\{min-height:44px\}/);assert.match(ui,/#portfolioReviewModal textarea\{font-size:16px\}/);assert.match(ui,/\.m05c-stock-grid\{grid-template-columns:1fr\}/);
  assert.match(ui,/width:100%/);assert.doesNotMatch(ui,/min-width:\s*[4-9]\d\dpx/);
});

test('M05C result hierarchy hides empty sections and links known symbols to existing detail navigation',()=>{
  const ui=read('src/portfolio-review-ui.js');
  assert.match(ui,/items&&items\.length/);assert.match(ui,/openStockDetail\(stock\.id\)/);assert.match(ui,/currentSnapshot\(\)\?'result':'generate'/);
});
