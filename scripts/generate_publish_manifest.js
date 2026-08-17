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
roleByPath.set('src/multi-stock-analysis.js','M05B Hotfix 3 contract-aligned multi-stock prompt runtime');
roleByPath.set('src/symbol-identity.js','M05B Hotfix 1 canonical symbol identity runtime');
roleByPath.set('src/technical-view-ux.js','M05B Technical View UX 1 localization and canonical freshness runtime');
roleByPath.set('src/state.js','M05B News Catalyst freshness normalization runtime');
roleByPath.set('src/ui-render.js','M05B News Catalyst prompt, import, and current-snapshot rendering runtime');
roleByPath.set('src/portfolio-review-context.js','M05C Daily Portfolio Review compact program-owned context and prompt runtime');
roleByPath.set('src/portfolio-review-contract.js','M05C Daily Portfolio Review strict contract and atomic snapshot runtime');
roleByPath.set('src/portfolio-review-ui.js','M05C Daily Portfolio Review mobile workflow and result runtime');

const paths=[...new Set([
  ...existing.files.map(entry=>entry.path),
  'src/batch-technical-review.js',
  'src/multi-stock-analysis.js',
  'src/symbol-identity.js',
  'src/technical-view-ux.js',
  'src/portfolio-review-context.js',
  'src/portfolio-review-contract.js',
  'src/portfolio-review-ui.js'
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
  assetVersion:'m05c1-daily-portfolio-review-foundation-workbench-mobile-20260817',
  dataMode:'delivered daily market bridge + browser localStorage + IndexedDB cutover recovery',
  files
};
fs.writeFileSync(manifestPath,`${JSON.stringify(manifest,null,2)}\n`,'utf8');
console.log(`Updated ${manifestPath} with ${files.length} published files from ${sourceCommit}.`);
