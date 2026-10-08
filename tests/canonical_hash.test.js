'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),{execFileSync}=require('node:child_process');
const K=require('../src/market-data-canonical.js');
const cases=JSON.parse(fs.readFileSync(__dirname+'/fixtures/canonical-hash-v1.json','utf8'));
const py=JSON.parse(execFileSync('python',['-c',`import json;from scripts.provider_rebase import canonical as K
cases=json.load(open('tests/fixtures/canonical-hash-v1.json',encoding='utf-8'))
out=[]
for c in cases:
 try:
  a=K.loads(c['left']);b=K.loads(c.get('right',c['left']))
  if c.get('facts'):K.facts(a);K.facts(b)
  out.append([K.digest(a),K.digest(b)])
 except (ValueError,TypeError,OverflowError):out.append('reject')
print(json.dumps(out))`],{encoding:'utf8'}));
for(const [i,c] of cases.entries())test('canonical golden: '+c.name,async()=>{
 if(c.reject){assert.equal(py[i],'reject');await assert.rejects(async()=>{const v=K.parse(c.left);if(c.facts)K.facts(v);await K.hash(v)});return}
 const a=K.parse(c.left),b=K.parse(c.right||c.left);if(c.facts){K.facts(a);K.facts(b)}
 const hashes=[await K.hash(a),await K.hash(b)];assert.deepEqual(hashes,py[i]);assert.equal(hashes[0]===hashes[1],c.equal!==false);
});
test('native unsafe numbers, nonfinite, sparse arrays and unsupported values reject',async()=>{
 for(const x of [9007199254740992,NaN,Infinity,-Infinity,undefined,()=>0,new Date(),Array(2)])assert.throws(()=>K.encode(x));
 assert.equal(await K.hash(1),await K.hash(K.parse('1.0')));assert.equal(await K.hash(-0),await K.hash(0));
});
test('migration facts adapter preserves explicit null',()=>{
 const M=require('../src/approved-market-migration.js');assert.equal(M.facts({technicalData:null}).technicalData,null);assert.deepEqual(M.facts({}).technicalData,{});
});
