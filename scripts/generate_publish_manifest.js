'use strict';

const crypto=require('node:crypto');
const fs=require('node:fs');
const path=require('node:path');
const {execFileSync}=require('node:child_process');

const root=path.resolve(__dirname,'..');
const manifestPath=path.join(root,'publish-manifest.json');
const existing=JSON.parse(fs.readFileSync(manifestPath,'utf8'));
const roleByPath=new Map(existing.files.map(entry=>[entry.path,entry.role]));
roleByPath.set('data/supabase_config.js','public Supabase URL and publishable key only');
roleByPath.set('src/vendor/supabase-client.js','pinned Supabase SDK with MIT license; browser Auth and add-only inserts');
roleByPath.set('src/universe-auto-add.js','durable local-first canonical stock addition queue and standard Auth');
roleByPath.set('src/universe-sync-ui.js','local/cloud/market status, login and scoped PC reader setup');
roleByPath.set('src/api/ai-api.js','PC AI Bridge raw request/response transport envelope');
roleByPath.set('src/api/api-client.js','loopback-only GET/POST transport with timeouts and Local Network Access handling');
roleByPath.set('src/api/health-api.js','user-initiated Bridge health and AI capability checks');
roleByPath.set('src/long-term-logic-contract.js','exact Long-Term Logic binding, validation, bounded audit and atomic candidate commit');
roleByPath.set('src/long-term-logic-workflow.js','shared Manual/API Long-Term Logic Prompt and strict response processor');
roleByPath.set('data/market_data_bridge.js','delivered daily market data bridge');
roleByPath.set('data/market_task_status_bridge.js','delivered daily market task status bridge');
roleByPath.set('src/strict-ai-json.js','shared strict AI JSON fenced transport preprocessor, parser, and post-repair diagnostics runtime');
roleByPath.set('src/batch-technical-review.js','Batch Technical Review contract and shared strict AI JSON consumer runtime');
roleByPath.set('src/multi-stock-analysis.js','M05C_1 Real Trial Fix 1 two-module navigation runtime');
roleByPath.set('src/symbol-identity.js','M05B Hotfix 1 canonical symbol identity runtime');
roleByPath.set('src/universe-handoff.js','REAL MOBILE TRIAL V3 PC sync status and Phase 1 handoff runtime');
roleByPath.set('src/technical-view-ux.js','REAL MOBILE TRIAL V3 technical and scheduler freshness presentation runtime');
roleByPath.set('src/state.js','Single Stock Discussion State normalization plus existing Workbench state runtime');
roleByPath.set('src/ui-render.js','Discussion User Decision V3 mobile-first controls, position-centric conclusion, supporting evidence and preserved Workbench interfaces');
roleByPath.set('src/app.js','browser bootstrap, user-initiated Bridge availability and preserved storage recovery runtime');
roleByPath.set('src/portfolio-review-context.js','Portfolio Review local-calendar context with non-authoritative PlanReview judgment and freshness runtime');
roleByPath.set('src/portfolio-review-contract.js','M05C_1 Real Trial Fix 1 localized contract and atomic snapshot runtime');
roleByPath.set('src/decision-compression-context.js','Decision Compression compact context with program-owned blocker facts and audit references');
roleByPath.set('src/decision-compression-contract.js','Decision Compression AI emphasis-only contract and atomic snapshot runtime');
roleByPath.set('src/portfolio-review-ui.js','Decision Compression scope, freshness, first layer, and preserved Portfolio Review drill-down workflow');
roleByPath.set('src/state-watch-workflow.js','State-watch Definition strict session and target binding, readable preview/diff and confirmed same-ID candidate commit');
roleByPath.set('src/state-watch-ui.js','Dedicated mobile state-watch Definition editor, manual and AI Draft preview/confirm and non-executable cards');
roleByPath.set('src/plan-runtime.js','Plan Runtime v1 strict lifecycle, protected Plan and Current State binding, bounded history, and atomic candidate commit');
roleByPath.set('src/plan-runtime-ui.js','Dedicated mobile Runtime Review manual transport, preview, explicit confirmation, status, and compact history UI');
roleByPath.set('src/plan-v2.js','Plan V2 canonical schema, lifecycle, migration, freshness, and candidate-save runtime');
roleByPath.set('src/plan-review.js','Batch Plan Review schema, strict contract/parser, atomic review snapshots, and confirmed Plan mutation runtime');
roleByPath.set('src/plan-review-ui.js','Batch Plan Review mobile selection, preview, review history, and explicit Plan action workflow');
roleByPath.set('src/plan-update-draft.js','Plan V2 confirmed browser-side draft application runtime');
roleByPath.set('src/clipboard.js','shared verified mobile clipboard runtime with explicit manual-copy fallback');
roleByPath.set('src/discussion-workbench.js','Single Stock Current State v3 position-centric User Decision schema, V1/V2 compatibility, continuity context, and protected Runtime/market inputs');
roleByPath.set('src/discussion-state-contract.js','Single Stock Current State V3 fail-closed User Decision archive contract with position, language, price-ownership and semantic guards');
roleByPath.set('src/discussion-plan-workflow.js','Standalone single-target fenced JSON Plan Draft prompt, readable business labels, strict session and target binding, preview, and confirmed replacement lifecycle runtime');
roleByPath.set('src/price-refresh.js','Plan V2 program-owned price trigger observation and candidate-save runtime');
roleByPath.set('src/rebalance.js','Plan V2 trigger evaluation, lifecycle retention, and execution audit runtime');
roleByPath.set('src/storage/storage-validation.js','candidate storage validation including Long-Term Logic audit consistency and preserved Plan safeguards');
roleByPath.set('src/v13-core-model.js','Plan V2 canonical normalization compatibility runtime');
roleByPath.set('src/v13-plan-engine.js','Plan V2 lifecycle-aware plan orchestration runtime');
roleByPath.set('src/v13-recommendation-engine.js','Plan V2 lifecycle-aware recommendation compatibility runtime');

const paths=[...new Set([
  // Custom Pages workflows do not run Jekyll; upload-pages-artifact excludes dotfiles.
  'data/supabase_config.js',
  'src/vendor/supabase-client.js',
  'src/universe-auto-add.js',
  'src/universe-sync-ui.js',
  ...existing.files.map(entry=>entry.path).filter(file=>file!=='.nojekyll'),
  'src/api/ai-api.js',
  'src/long-term-logic-contract.js',
  'src/long-term-logic-workflow.js',
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
  'src/state-watch-workflow.js',
  'src/state-watch-ui.js',
  'src/plan-runtime.js',
  'src/plan-runtime-ui.js',
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
  assetVersion:'discussion-user-decision-v3-20260904',
  dataMode:'Discussion User Decision V3 position-centric conclusion above preserved technical evidence, with compact mobile-first controls, V1/V2 Current State fallback, strict fact ownership and no execution; Plan V2 Phase 2 Runtime and Stock Universe V1A contracts remain unchanged; only manifest-allowlisted public browser assets are delivered',
  files
};
fs.writeFileSync(manifestPath,`${JSON.stringify(manifest,null,2)}\n`,'utf8');
console.log(`Updated ${manifestPath} with ${files.length} published files from ${sourceCommit}.`);
