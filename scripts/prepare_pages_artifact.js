'use strict';

const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const {execFileSync}=require('node:child_process');
const {ALLOWLIST:MARKET_PATHS,validateBridgeContent,validateStatusContent}=require('./publish_market_bridges.js');
const ROOT_FILES=new Set(['index.html','favicon.svg','social_posts.json','social_summary.json']);
const DATA_FILES=new Set(['data/backend_config.js','data/ai_decision_review_data.js',
  'data/supabase_config.js',
  'data/market_data_bridge.js','data/market_task_status_bridge.js',
  'data/operation_application_status_bridge.js','data/plan_application_status_bridge.js']);
const digest=data=>crypto.createHash('sha256').update(data).digest('hex');
const normalize=data=>Buffer.from(String(data).replace(/\r\n/g,'\n'),'utf8');

function containsCredential(content){
  if(/DEEPSEEK_API_KEY|-----BEGIN (?:[A-Z]+ )?PRIVATE KEY-----|\bsk-[A-Za-z0-9_-]{16,}|\bsb_secret_[A-Za-z0-9_-]+/i.test(content))return true;
  // Header names and token variable names are legitimate Auth code. Literal user/
  // service JWTs are not; public anon keys remain allowed only as public routing.
  for(const match of content.matchAll(/eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g)){
    try{const claims=JSON.parse(Buffer.from(match[0].split('.')[1],'base64url').toString());if(claims.role!=='anon'||claims.sub)return true}catch(_error){return true}
  }
  if(/(?:access_token|refresh_token|p_token|service_role_key|database_password)["']?\s*[:=]\s*["'][A-Za-z0-9_./+\-=]{24,}["']/i.test(content))return true;
  if(/["']Bearer\s+[A-Za-z0-9_./+\-=]{24,}["']/i.test(content))return true;
  if(/["']?token["']?\s*:\s*["'][0-9a-f]{64}["']/i.test(content))return true;
  return false;
}

function permittedPath(value){
  return typeof value==='string'&&(ROOT_FILES.has(value)||DATA_FILES.has(value)
    ||/^src\/(?:[a-z0-9-]+\/)*[a-z0-9-]+\.js$/.test(value));
}

function artifactPlan(manifest,readSource,deploymentCommit,{validateMarket=true}={}){
  if(manifest.manifestVersion!==1||!Array.isArray(manifest.files)||!manifest.files.length
    ||!/^[0-9a-f]{40}$/.test(manifest.sourceCommit)||!/^[0-9a-f]{40}$/.test(deploymentCommit)
    ||!/^[-a-z0-9]+$/.test(manifest.assetVersion))throw new Error('Invalid release manifest');
  const assets=new Map(),entries=[];
  for(const entry of manifest.files){
    if(!permittedPath(entry.path)||assets.has(entry.path))throw new Error(`Forbidden or duplicate Pages path: ${entry.path}`);
    const bytes=normalize(readSource(entry.path)),sha256=digest(bytes);
    // Market automation intentionally commits only these two files. Refresh their
    // delivered hashes in the artifact without mixing market changes into source commits.
    if(!MARKET_PATHS.includes(entry.path)&&(entry.bytes!==bytes.length||entry.sha256!==sha256)){
      throw new Error(`Published source integrity mismatch: ${entry.path}`);
    }
    if(containsCredential(bytes.toString('utf8'))){
      throw new Error(`Credential marker in Pages asset: ${entry.path}`);
    }
    assets.set(entry.path,bytes);entries.push({...entry,bytes:bytes.length,sha256});
  }
  const html=assets.get('index.html')?.toString('utf8')||'';
  if(!html.includes(`<meta name="app-asset-version" content="${manifest.assetVersion}">`)
    ||!html.includes(`window.APP_ASSET_VERSION='${manifest.assetVersion}'`))throw new Error('Asset version mismatch');
  for(const match of html.matchAll(/<script\b[^>]*\bsrc="([^"]+)"/g)){
    const [script,query]=match[1].split('?');
    if(!assets.has(script))throw new Error(`Missing browser dependency: ${script}`);
    if(new URLSearchParams(query).get('v')!==manifest.assetVersion)throw new Error(`Missing cache version: ${script}`);
  }
  if(validateMarket){
    const bridge=validateBridgeContent(assets.get(MARKET_PATHS[0])?.toString('utf8')||'');
    validateStatusContent(assets.get(MARKET_PATHS[1])?.toString('utf8')||'',bridge);
  }
  const effective={...manifest,deploymentCommit,files:entries};
  assets.set('publish-manifest.json',Buffer.from(JSON.stringify(effective,null,2)+'\n','utf8'));
  return {assets,manifest:effective};
}

function main(){
  const root=path.resolve(__dirname,'..'),output=path.join(root,'_site');
  if(fs.existsSync(output))throw new Error('Refusing to overwrite existing _site; choose a clean checkout');
  const git=args=>execFileSync('git',args,{cwd:root,encoding:'utf8',maxBuffer:16*1024*1024});
  const head=git(['rev-parse','HEAD']).trim();
  const manifest=JSON.parse(git(['show','HEAD:publish-manifest.json']));
  if(!/^[0-9a-f]{40}$/.test(manifest.sourceCommit))throw new Error('Invalid source commit');
  git(['merge-base','--is-ancestor',manifest.sourceCommit,'HEAD']);
  const {assets}=artifactPlan(manifest,file=>git(['show',`HEAD:${file}`]),head);
  fs.mkdirSync(output);
  for(const [file,bytes] of assets){
    const destination=path.join(output,file);
    fs.mkdirSync(path.dirname(destination),{recursive:true});fs.writeFileSync(destination,bytes);
  }
  console.log(JSON.stringify({deploymentCommit:head,assetVersion:manifest.assetVersion,files:assets.size,output}));
}

if(require.main===module)main();
module.exports={artifactPlan,permittedPath,digest,normalize,containsCredential};
