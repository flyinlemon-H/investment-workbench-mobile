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
roleByPath.set('src/batch-technical-review.js','M05B Hotfix 3 authoritative batch contract, validation, and parser runtime');
roleByPath.set('src/multi-stock-analysis.js','M05C_1 Real Trial Fix 1 two-module navigation runtime');
roleByPath.set('src/symbol-identity.js','M05B Hotfix 1 canonical symbol identity runtime');
roleByPath.set('src/universe-handoff.js','REAL MOBILE TRIAL V3 PC sync status and Phase 1 handoff runtime');
roleByPath.set('src/technical-view-ux.js','REAL MOBILE TRIAL V3 technical and scheduler freshness presentation runtime');
roleByPath.set('src/state.js','M05B News Catalyst freshness normalization runtime');
roleByPath.set('src/ui-render.js','REAL MOBILE TRIAL V3 mobile PC sync status and technical freshness rendering runtime');
roleByPath.set('src/portfolio-review-context.js','M05C_1 Real Trial Fix 1 relevance, fact precedence, and fail-safe prompt runtime');
roleByPath.set('src/portfolio-review-contract.js','M05C_1 Real Trial Fix 1 localized contract and atomic snapshot runtime');
roleByPath.set('src/portfolio-review-ui.js','M05C_1 Real Trial Fix 1 mobile workflow and defensive display runtime');
roleByPath.set('src/plan-v2.js','Plan V2 canonical schema, lifecycle, migration, freshness, and candidate-save runtime');
roleByPath.set('src/plan-update-draft.js','Plan V2 confirmed browser-side draft application runtime');
roleByPath.set('src/price-refresh.js','Plan V2 program-owned price trigger observation and candidate-save runtime');
roleByPath.set('src/rebalance.js','Plan V2 trigger evaluation, lifecycle retention, and execution audit runtime');
roleByPath.set('src/storage/storage-validation.js','Plan V2 candidate storage validation runtime');
roleByPath.set('src/v13-core-model.js','Plan V2 canonical normalization compatibility runtime');
roleByPath.set('src/v13-plan-engine.js','Plan V2 lifecycle-aware plan orchestration runtime');
roleByPath.set('src/v13-recommendation-engine.js','Plan V2 lifecycle-aware recommendation compatibility runtime');

const paths=[...new Set([
  ...existing.files.map(entry=>entry.path),
  'src/batch-technical-review.js',
  'src/multi-stock-analysis.js',
  'src/symbol-identity.js',
  'src/universe-handoff.js',
  'src/technical-view-ux.js',
  'src/portfolio-review-context.js',
  'src/portfolio-review-contract.js',
  'src/portfolio-review-ui.js',
  'src/plan-v2.js'
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
  assetVersion:'plan-v2-foundation-20260827',
  dataMode:'add-only mobile universe handoff + delivered daily market bridge + browser local persistence',
  files
};
fs.writeFileSync(manifestPath,`${JSON.stringify(manifest,null,2)}\n`,'utf8');
console.log(`Updated ${manifestPath} with ${files.length} published files from ${sourceCommit}.`);
