'use strict';

const crypto=require('node:crypto');
const fs=require('node:fs');
const path=require('node:path');
const {execFileSync}=require('node:child_process');

const root=path.resolve(__dirname,'..');
const manifestPath=path.join(root,'publish-manifest.json');
const existing=JSON.parse(fs.readFileSync(manifestPath,'utf8'));
const roleByPath=new Map(existing.files.map(entry=>[entry.path,entry.role]));
roleByPath.set('data/market_data_bridge.js','delivered daily market data bridge');
roleByPath.set('data/market_task_status_bridge.js','delivered daily market task status bridge');
roleByPath.set('src/strict-ai-json.js','shared strict AI JSON presentation preprocessor and parser runtime');
roleByPath.set('src/batch-technical-review.js','Batch Technical Review contract and shared strict AI JSON consumer runtime');
roleByPath.set('src/multi-stock-analysis.js','M05C_1 Real Trial Fix 1 two-module navigation runtime');
roleByPath.set('src/symbol-identity.js','M05B Hotfix 1 canonical symbol identity runtime');
roleByPath.set('src/universe-handoff.js','REAL MOBILE TRIAL V3 PC sync status and Phase 1 handoff runtime');
roleByPath.set('src/technical-view-ux.js','REAL MOBILE TRIAL V3 technical and scheduler freshness presentation runtime');
roleByPath.set('src/state.js','Single Stock Discussion State normalization plus existing Workbench state runtime');
roleByPath.set('src/ui-render.js','mobile-first Current State decision hierarchy, import preview, legacy fallback, and existing Workbench UI runtime');
roleByPath.set('src/app.js','browser bootstrap, storage recovery, and Tools-only storage maintenance runtime');
roleByPath.set('src/portfolio-review-context.js','Portfolio Review local-calendar context with non-authoritative PlanReview judgment and freshness runtime');
roleByPath.set('src/portfolio-review-contract.js','M05C_1 Real Trial Fix 1 localized contract and atomic snapshot runtime');
roleByPath.set('src/decision-compression-context.js','Decision Compression compact context with program-owned blocker facts and audit references');
roleByPath.set('src/decision-compression-contract.js','Decision Compression AI emphasis-only contract and atomic snapshot runtime');
roleByPath.set('src/portfolio-review-ui.js','Decision Compression scope, freshness, first layer, and preserved Portfolio Review drill-down workflow');
roleByPath.set('src/plan-v2.js','Plan V2 canonical schema, lifecycle, migration, freshness, and candidate-save runtime');
roleByPath.set('src/plan-review.js','Batch Plan Review schema, strict contract/parser, atomic review snapshots, and confirmed Plan mutation runtime');
roleByPath.set('src/plan-review-ui.js','Batch Plan Review mobile selection, preview, review history, and explicit Plan action workflow');
roleByPath.set('src/plan-update-draft.js','Plan V2 confirmed browser-side draft application runtime');
roleByPath.set('src/clipboard.js','shared verified mobile clipboard runtime with explicit manual-copy fallback');
roleByPath.set('src/discussion-workbench.js','Single Stock Current State v2 decision schema, legacy compatibility, continuity context, and prompt runtime');
roleByPath.set('src/discussion-state-contract.js','Single Stock Current State fail-closed decision archive contract and protected atomic save runtime');
roleByPath.set('src/discussion-plan-workflow.js','Discussion-to-Plan same-conversation prompt, strict draft validation, preview, binding, and confirmed canonical Plan mutation runtime');
roleByPath.set('src/price-refresh.js','Plan V2 program-owned price trigger observation and candidate-save runtime');
roleByPath.set('src/rebalance.js','Plan V2 trigger evaluation, lifecycle retention, and execution audit runtime');
roleByPath.set('src/storage/storage-validation.js','Plan V2 and separate PlanReview candidate storage validation runtime');
roleByPath.set('src/v13-core-model.js','Plan V2 canonical normalization compatibility runtime');
roleByPath.set('src/v13-plan-engine.js','Plan V2 lifecycle-aware plan orchestration runtime');
roleByPath.set('src/v13-recommendation-engine.js','Plan V2 lifecycle-aware recommendation compatibility runtime');

const paths=[...new Set([
  ...existing.files.map(entry=>entry.path),
  'src/strict-ai-json.js',
  'src/batch-technical-review.js',
  'src/multi-stock-analysis.js',
  'src/symbol-identity.js',
  'src/universe-handoff.js',
  'src/technical-view-ux.js',
  'src/portfolio-review-context.js',
  'src/portfolio-review-contract.js',
  'src/decision-compression-context.js',
  'src/decision-compression-contract.js',
  'src/portfolio-review-ui.js',
  'src/plan-v2.js',
  'src/plan-review.js',
  'src/plan-review-ui.js',
  'src/clipboard.js',
  'src/discussion-workbench.js',
  'src/discussion-state-contract.js',
  'src/discussion-plan-workflow.js'
])].sort((a,b)=>a.localeCompare(b,'en'));

const files=paths.map(relativePath=>{
  const normalized=execFileSync('git',['show',`HEAD:${relativePath}`],{cwd:root,encoding:'utf8',maxBuffer:16*1024*1024}).replace(/\r\n/g,'\n');
  const bytes=Buffer.from(normalized,'utf8');
  return {
    path:relativePath,
    role:roleByPath.get(relativePath)||'browser runtime dependency',
    bytes:bytes.length,
    sha256:crypto.createHash('sha256').update(bytes).digest('hex')
  };
});

const sourceCommit=execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim();
const manifest={
  manifestVersion:1,
  sourceCommit,
  assetVersion:'shared-strict-ai-json-import-reliability-fix3-20260901',
  dataMode:'shared strict AI JSON reliability fix 3 with JSON-string-aware Markdown underscore escape recovery and hardened Current State v2 Archive Prompt; same-conversation Discussion-to-Plan V1, strict Current State and Plan schemas, preview-before-write, explicit confirmation, PlanReview, holdings, allocation, long-term logic, clipboard, market bridge, and storage runtime preserved',
  files
};
fs.writeFileSync(manifestPath,`${JSON.stringify(manifest,null,2)}\n`,'utf8');
console.log(`Updated ${manifestPath} with ${files.length} published files from ${sourceCommit}.`);
