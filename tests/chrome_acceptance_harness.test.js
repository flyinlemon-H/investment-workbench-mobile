const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'fixtures/chrome-overrides-harness.js'),'utf8');
const prefix='__pc_ai_acceptance_20260902__';
const productionKey='portfolio_manual_v502_network_price_20260610';

function setup(origin='https://flyinlemon-h.github.io'){
  const nativeCalls=[],databaseCalls=[];
  function Storage(){this.data=new Map([[productionKey,'production sentinel']])}
  Storage.prototype.getItem=function(key){nativeCalls.push(['get',key]);return this.data.get(key)??null};
  Storage.prototype.setItem=function(key,value){nativeCalls.push(['set',key]);this.data.set(key,value)};
  Storage.prototype.removeItem=function(key){nativeCalls.push(['remove',key]);this.data.delete(key)};
  const fetch=()=>{},clipboard={writeText:()=>{}},permissions={query:()=>{}};
  const context={Storage,localStorage:new Storage(),sessionStorage:new Storage(),
    indexedDB:{open:(...args)=>databaseCalls.push(['open',...args]),deleteDatabase:(...args)=>databaseCalls.push(['delete',...args])},
    location:{origin},addEventListener:()=>{},fetch,navigator:{clipboard,permissions}};
  context.window=context;
  vm.createContext(context);
  return {context,nativeCalls,databaseCalls,fetch,clipboard,permissions,run:()=>vm.runInContext(source,context)};
}

test('Overrides harness seeds and accesses test storage only, retaining native persistence',()=>{
  const env=setup();env.run();
  assert.equal(env.context.localStorage.data.get(productionKey),'production sentinel');
  assert.ok(env.nativeCalls.every(([,key])=>key.startsWith(prefix)));
  const sample=JSON.parse(env.context.localStorage.getItem(prefix+productionKey));
  assert.equal(sample.stocks[0].shares,0);
  assert.deepEqual(sample.stocks[0].plans,[]);
  assert.throws(()=>env.context.localStorage.getItem(productionKey),/non-test/);
  assert.throws(()=>env.context.localStorage.setItem(productionKey,'bad'),/non-test/);
  assert.throws(()=>env.context.localStorage.removeItem(productionKey),/non-test/);
  assert.throws(()=>env.context.localStorage.clear(),/forbids/);
  assert.throws(()=>env.context.localStorage.key(0),/forbids/);
  assert.equal(env.context.localStorage.data.get(productionKey),'production sentinel');
});

test('Overrides harness guards IndexedDB without mocking network, permission or clipboard APIs',()=>{
  const env=setup();env.run();
  env.context.indexedDB.open(prefix+'investment-workbench-mobile',1);
  assert.deepEqual(env.databaseCalls,[['open',prefix+'investment-workbench-mobile',1]]);
  assert.throws(()=>env.context.indexedDB.open('investment-workbench-mobile'),/non-test/);
  assert.throws(()=>env.context.indexedDB.deleteDatabase('investment-workbench-mobile'),/non-test/);
  assert.equal(env.context.fetch,env.fetch);
  assert.equal(env.context.navigator.clipboard,env.clipboard);
  assert.equal(env.context.navigator.permissions,env.permissions);
});

test('Overrides harness rejects an unexpected Origin before storage access',()=>{
  const env=setup('https://example.com');
  assert.throws(env.run,/not allowed/);
  assert.equal(env.nativeCalls.length,0);
});
