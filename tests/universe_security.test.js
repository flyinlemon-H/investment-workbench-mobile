'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {containsCredential,permittedPath}=require('../scripts/prepare_pages_artifact.js');
test('Auth source is allowed while literal credentials remain blocked',()=>{
  for(const value of ["headers.Authorization='Bearer '+access_token;",'window.config={publishableKey:"sb_publishable_public"}'])assert.equal(containsCredential(value),false);
  const jwt=role=>Buffer.from('{}').toString('base64url')+'.'+Buffer.from(JSON.stringify({role})).toString('base64url')+'.'+'s'.repeat(24);
  for(const value of ['sb_secret_'+'a'.repeat(30),'sk-'+'a'.repeat(30),'access_token="'+'a'.repeat(30)+'"',
    'p_token: "'+'a'.repeat(64)+'"','"token":"'+'b'.repeat(64)+'"','"Bearer '+'a'.repeat(32)+'"',
    '-----BEGIN PRIVATE KEY-----',jwt('service_role').replace('e30.','eyJhbGciOiJIUzI1NiJ9.'),
    jwt('authenticated').replace('e30.','eyJhbGciOiJIUzI1NiJ9.')])assert.equal(containsCredential(value),true,value.slice(0,25));
});
test('new public assets contain no credentials and only public production config',()=>{
  for(const file of ['src/universe-auto-add.js','src/universe-sync-ui.js','src/vendor/supabase-client.js','data/supabase_config.js']){
    assert.equal(permittedPath(file),true);assert.equal(containsCredential(fs.readFileSync(path.join(__dirname,'..',file),'utf8')),false,file);
  }
  assert.equal(permittedPath('scripts/fetch_cloud_universe.py'),false);
  assert.match(fs.readFileSync(path.join(__dirname,'../data/supabase_config.js'),'utf8'),/fntslvdxnupmdljnadec/);
});
