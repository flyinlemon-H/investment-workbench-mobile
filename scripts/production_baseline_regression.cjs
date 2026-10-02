'use strict';
// Local/CI gate only. It never fetches, pushes, deploys, or connects to Supabase.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),{execFileSync,spawnSync}=require('node:child_process');
const root=path.resolve(__dirname,'..');
const baseline=JSON.parse(fs.readFileSync(path.join(root,'production-baseline.json'),'utf8'));
const git=args=>execFileSync('git',args,{cwd:root,encoding:'utf8',stdio:['ignore','pipe','pipe']});
try{
  git(['merge-base','--is-ancestor',baseline.commit,'HEAD']);
  // checkout@v6 with fetch-depth:0 supplies current origin/main in the release workflow.
  git(['rev-parse','--verify','origin/main']);
  git(['merge-base','--is-ancestor','origin/main','HEAD']);
  for(const entry of baseline.requiredTests){
    const source=fs.readFileSync(path.join(root,entry.path),'utf8').replace(/\r\n/g,'\n');
    if(crypto.createHash('sha256').update(source).digest('hex')!==entry.sha256)throw Error('Production gate changed: '+entry.path+'; review and update the baseline explicitly.');
  }
}catch(error){console.error('PRODUCTION_BASELINE_REGRESSION failed: candidate must retain the reviewed production tests and include current origin/main. '+error.message);process.exit(1)}
const result=spawnSync(process.execPath,['--test',...baseline.requiredTests.map(t=>t.path),
  'tests/entry_decision.test.js','tests/homepage_attention.test.js','tests/homepage_screening.test.js',
  'tests/plan_runtime.test.js','tests/plan_context_contract.test.js','tests/discussion_workbench.test.js',
  'tests/market_data_orchestrator.test.js','tests/market_data_registry.cjs',
  'tests/technical_freshness.test.js','tests/market_production_review.cjs'],{cwd:root,stdio:'inherit'});
if(result.error)console.error(result.error.message);
process.exit(result.status??1);
