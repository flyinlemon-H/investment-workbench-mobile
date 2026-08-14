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
roleByPath.set('src/batch-technical-review.js','M05B strict judgment-only batch review runtime');
roleByPath.set('src/multi-stock-analysis.js','M05B stable daily multi-stock analysis runtime');

const paths=[...new Set([
  ...existing.files.map(entry=>entry.path),
  'src/batch-technical-review.js',
  'src/multi-stock-analysis.js'
])].sort((a,b)=>a.localeCompare(b,'en'));

const files=paths.map(relativePath=>{
  const absolutePath=path.join(root,relativePath);
  const normalized=fs.readFileSync(absolutePath,'utf8').replace(/\r\n/g,'\n');
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
  assetVersion:'m05b-workbench-mobile-20260814',
  dataMode:'delivered daily market bridge + browser localStorage + IndexedDB cutover recovery',
  files
};
fs.writeFileSync(manifestPath,`${JSON.stringify(manifest,null,2)}\n`,'utf8');
console.log(`Updated ${manifestPath} with ${files.length} published files from ${sourceCommit}.`);
