const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {artifactPlan,permittedPath,digest}=require('../scripts/prepare_pages_artifact.js');
const sha='a'.repeat(40),version='test-release-20260902';

function fixture(){
  const source={
    'index.html':`<meta name="app-asset-version" content="${version}"><script>window.APP_ASSET_VERSION='${version}'</script><script src="src/app.js?v=${version}"></script>`,
    'src/app.js':'window.ready=true;'
  };
  const manifest={manifestVersion:1,sourceCommit:sha,assetVersion:version,files:Object.entries(source).map(([file,text])=>({path:file,role:'test',bytes:Buffer.byteLength(text),sha256:digest(text)}))};
  return {source,manifest,run:()=>artifactPlan(manifest,file=>source[file],sha,{validateMarket:false})};
}

test('Pages path allowlist excludes Bridge, secrets, tests and path traversal',()=>{
  for(const file of ['.nojekyll','pc-ai-bridge/bridge.py','pc-ai-bridge/.env','.env','tests/private-fixture.js','scripts/prepare_pages_artifact.js','src/../pc-ai-bridge/bridge.py','src/.env','src\\app.js','data/secret.js'])assert.equal(permittedPath(file),false,file);
  for(const file of ['index.html','src/api/ai-api.js','src/long-term-logic-contract.js','data/backend_config.js'])assert.equal(permittedPath(file),true,file);
});

test('Pages artifact verifies source hashes and delivers an exact effective manifest',()=>{
  const fixtureData=fixture(),result=fixtureData.run();
  assert.deepEqual([...result.assets.keys()],['index.html','src/app.js','publish-manifest.json']);
  assert.equal(JSON.parse(result.assets.get('publish-manifest.json')).deploymentCommit,sha);
  fixtureData.source['src/app.js']+='changed';assert.throws(fixtureData.run,/integrity mismatch/);
});

test('Pages artifact rejects credential markers even if a manifest hash matches',()=>{
  const value=fixture();value.source['src/app.js']='DEEPSEEK_API_KEY';
  Object.assign(value.manifest.files[1],{bytes:Buffer.byteLength(value.source['src/app.js']),sha256:digest(value.source['src/app.js'])});
  assert.throws(value.run,/Credential marker/);
});

test('Pages artifact rejects missing scripts and inconsistent cache versions',()=>{
  const missing=fixture();missing.manifest.files.pop();assert.throws(missing.run,/Missing browser dependency/);
  const stale=fixture();stale.manifest.assetVersion='other-version';assert.throws(stale.run,/Asset version mismatch/);
});

test('Pages workflow uploads only staged assets with read-only source credentials',()=>{
  const workflow=fs.readFileSync(path.join(__dirname,'../.github/workflows/pages.yml'),'utf8');
  assert.match(workflow,/prepare_pages_artifact\.js/);assert.match(workflow,/path: _site/);
  assert.match(workflow,/persist-credentials: false/);assert.doesNotMatch(workflow,/contents: write/);
  assert.match(workflow,/pages: write/);assert.match(workflow,/id-token: write/);
  assert.doesNotMatch(workflow,/include-hidden-files/,'upload-pages-artifact has no such input');
});

test('independent market-only updates retain source hashes and refresh delivered market hashes',()=>{
  const value=fixture();
  for(const file of ['data/market_data_bridge.js','data/market_task_status_bridge.js']){
    value.source[file]=fs.readFileSync(path.join(__dirname,'..',file),'utf8').replace(/\r\n/g,'\n');
    value.manifest.files.push({path:file,role:'market',bytes:0,sha256:'0'.repeat(64)});
  }
  const result=artifactPlan(value.manifest,file=>value.source[file],sha);
  assert.equal(result.manifest.files[1].sha256,value.manifest.files[1].sha256);
  for(const entry of result.manifest.files.slice(2)){
    assert.equal(entry.sha256,digest(value.source[entry.path]));assert.ok(entry.bytes>0);
  }
  assert.equal(value.manifest.files[2].bytes,0,'repository manifest is not mutated');
});
