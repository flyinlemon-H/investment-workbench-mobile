'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),crypto=require('node:crypto');
const K=require('../src/market-data-canonical.js'),{database,fixtures,approval,exact,OWNER,OTHER}=require('./helpers/migration-db.cjs');
const [capsule]=fixtures(),hash=x=>crypto.createHash('sha256').update(x).digest('hex');
function reseal(p,c){delete c.approvalPackageHash;p.package=JSON.stringify(c);c.approvalPackageHash=hash(p.package);p.candidate=JSON.stringify(c);return p}
test('server canonical hash and trusted baseline preflight',async t=>{
 const h=await database(),db=h.db;
 try{
  const cases=JSON.parse(fs.readFileSync(__dirname+'/fixtures/canonical-hash-v1.json','utf8'));
  await t.test('SQL matches lossless Python/JS golden hashes',async()=>{for(const c of cases){if(c.facts&&c.reject)continue;if(c.reject){await assert.rejects(db.query('select market_private.canonical_hash($1::json)',[c.left]),undefined,c.name);continue}for(const raw of [c.left,c.right||c.left]){const got=(await db.query('select market_private.canonical_hash($1::json) hash',[raw])).rows[0].hash;assert.equal(got,await K.hash(K.parse(raw)),c.name)}}});
  await t.test('private helpers have no browser or service role execute grants',async()=>{for(const role of ['anon','authenticated','service_role']){const r=await db.query("select has_function_privilege($1,'market_private.canonical_hash(json)','EXECUTE') granted",[role]);assert.equal(r.rows[0].granted,false)}});
  await t.test('resealed fake canonical hash or version cannot stage',async()=>{for(const [key,value] of [['canonicalContentHash','0'.repeat(64)],['canonicalSerializationVersion','unknown'],['sourceContractHash','0'.repeat(64)],['expectedCurrentVersion','0'.repeat(64)]]){const p=structuredClone(capsule),c=JSON.parse(p.candidate);c.baselineBinding[key]=value;await assert.rejects(h.stage(reseal(p,c)),/canonical_baseline_binding_mismatch/)}});
  await t.test('legacy package cannot silently acquire new approval semantics',async()=>{const p=structuredClone(capsule),c=JSON.parse(p.candidate);c.schemaVersion=3;delete c.baselineBinding;await assert.rejects(h.stage(reseal(p,c)),/legacy_approval_requires_refreeze/)});
  await t.test('numerically identical baseline representation passes, raw tiny value change fails',async()=>{
   // PostgreSQL receives original numeric lexemes, not already rounded JS values.
   const p=structuredClone(capsule),c=JSON.parse(p.candidate);p.base=p.base.replace(/"volume":(\d+)(?=[,}])/g,'"volume":$1.0');c.baseHash=hash(p.base);c.baselineBinding.legacyBaseHash=c.baseHash;c.baselineBinding.expectedCurrentVersion=c.baseHash;
   await h.stage(reseal(p,c));let v=await h.migration('read',{symbol:'9999.HK'});v=await h.migration('approve',approval({...v,capsule:p}));assert.equal(v.readyToApply,true);
   await assert.rejects(h.migration('apply',{...exact(v),expectedCurrentVersion:'0'.repeat(64)}),/version_conflict/);
   const applied=await h.migration('apply',exact(v));assert.equal(applied.status,'applied');assert.equal((await h.migration('apply',exact(v))).idempotent,true);
   await h.migration('rollback',{...exact(applied),expectedCurrentVersion:applied.currentVersion,expectedGeneration:applied.generation,phrase:`Rollback ${applied.currentVersion} to ${applied.previousVersion}`,reason:'isolated canonical test'});
   const q=structuredClone(p),changed=JSON.parse(q.candidate);q.base=q.base.replace(/"volume":\d+(?:\.\d+)?/,'"volume":1.00000000000000000001');changed.baseHash=hash(q.base);changed.baselineBinding.legacyBaseHash=changed.baseHash;changed.baselineBinding.expectedCurrentVersion=changed.baseHash;
   await assert.rejects(h.stage(reseal(q,changed),OTHER),/canonical_baseline_binding_mismatch/);
  });
 }finally{await db.close()}
});
