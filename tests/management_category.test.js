'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const M=require('../src/management-category'),Identity=require('../src/symbol-identity'),D=require('../src/discussion-workbench');
const canonical=Identity.canonicalMarketSymbol;
const stock=(id,managementCategory,extra={})=>({id,code:`60000${id}.SS`,name:`测试${id}`,shares:managementCategory==='candidate'?0:100,type:'holding',role:'成长仓',plans:[],...(managementCategory?{managementCategory}:{}),...extra});
const fixtures=()=>[stock('1','core',{type:'watching',watchlist:true}),stock('2','watch'),stock('3','candidate',{type:'etf'}),stock('4','etf',{type:'etf'}),stock('5',null),stock('6',null,{role:'卫星仓'}),stock('7',null,{role:'',type:''})];
const assignment=(s,category)=>({id:s.id,symbol:s.code,managementCategory:category});
test('four unique memberships ignore overlapping held/watch and ETF asset facts',()=>{
  const stocks=fixtures();assert.deepEqual(M.values,['core','watch','candidate','etf']);
  for(const s of stocks)assert.equal(M.values.filter(key=>M.matches(s,key)).length,M.needsAssignment(s)?0:1);
  assert.equal(M.matches(stocks[0],'watch'),false);assert.equal(M.matches(stocks[2],'candidate'),true);assert.equal(stocks[2].type,'etf');
  assert.deepEqual(M.values.map(key=>stocks.filter(s=>M.matches(s,key)).length),[1,1,1,1]);
});
for(const value of [null,undefined,'','all','holding','watching','zero','needs_assignment','CORE',[],['core','watch'],{},1])test(`invalid enum ${JSON.stringify(value)} cannot be assigned`,()=>{const s=stock('1','core');assert.equal(M.valid(value),false);assert.throws(()=>M.buildCandidate({stocks:[s]},[assignment(s,value)],canonical),/管理分类/)});
test('legacy roles cannot prove user intent because baseline normalization synthesizes them',()=>{
  const stocks=['成长仓','卫星仓','核心仓','观察仓',''].map((role,i)=>stock(String(i),null,{role,type:i===4?'':'holding'})),before=JSON.stringify(stocks);
  assert.ok(stocks.every(M.needsAssignment));assert.deepEqual(M.inventory(stocks).map(r=>r.confidence),['ambiguous','ambiguous','ambiguous','ambiguous','missing']);assert.equal(JSON.stringify(stocks),before);
});
test('category compatibility blocks contradictory manual assignment without changing shares',()=>{
  for(const category of M.values){assert.equal(Boolean(M.compatibility(category,0)),category!=='candidate');assert.equal(Boolean(M.compatibility(category,100)),category==='candidate')}
  for(const shares of [-1,NaN,Infinity,null,undefined,''])assert.ok(M.compatibility('core',shares));
});
test('one detached batch preserves every unrelated field and leaves original untouched',()=>{
  const state={stocks:fixtures(),planRuntimeStates:{preserve:1},currentState:{preserve:2},executionLog:[{keep:true}],universeHandoff:{pending:[]}},before=JSON.stringify(state);
  const next=M.buildCandidate(state,[assignment(state.stocks[0],'watch'),assignment(state.stocks[4],'core')],canonical);
  assert.equal(JSON.stringify(state),before);assert.equal(next.stocks[0].managementCategory,'watch');assert.equal(next.stocks[4].managementCategory,'core');
  next.stocks[0].managementCategory='core';delete next.stocks[4].managementCategory;assert.deepEqual(next,state);
});
test('invalid last member never leaves partial batch state',()=>{const state={stocks:fixtures()},before=JSON.stringify(state);assert.throws(()=>M.buildCandidate(state,[assignment(state.stocks[0],'watch'),assignment(state.stocks[1],'candidate')],canonical),/候选仓/);assert.equal(JSON.stringify(state),before)});
test('identity is validated for missing, duplicate, stale or noncanonical targets',()=>{
  const s=stock('1','core'),state={stocks:[s]};for(const a of [{...assignment(s,'watch'),id:'missing'},{...assignment(s,'watch'),symbol:'600099.SS'}])assert.throws(()=>M.buildCandidate(state,[a],canonical));
  assert.throws(()=>M.buildCandidate(state,[assignment(s,'watch'),assignment(s,'watch')],canonical));
  assert.throws(()=>M.buildCandidate({stocks:[s,{...s,id:'other'}]},[assignment(s,'watch')],canonical));
  assert.throws(()=>M.buildCandidate({stocks:[s,{...s,code:'600002.SS'}]},[assignment(s,'watch')],canonical));
});
test('obsolete session states cannot resurrect mixed filters',()=>{for(const value of ['all','holding','watching','zero','zero-position',null])assert.equal(M.session(value),'core');for(const value of M.values)assert.equal(M.session(value),value)});
test('category alone changes no Discussion binding, holding facts, references or protected hash',()=>{
  const s=stock('1','core'),a=D.buildContext(s,{state:{stocks:[s]}}),next={...s,managementCategory:'watch'},b=D.buildContext(next,{state:{stocks:[next]}});assert.deepEqual(b,a);
  const zero={...s,shares:0,managementCategory:'core'};assert.equal(D.buildContext(zero,{state:{stocks:[zero]}}).context.currentFacts.holding.shares,0);
});
test('real normalization and backup compatibility preserve category with no inference',()=>{
  const context={console,window:null,globalThis:null};context.window=context;context.globalThis=context;vm.createContext(context);
  for(const file of ['src/plan-v2.js','src/strict-ai-json.js','src/state.js','src/import-export.js'])vm.runInContext(fs.readFileSync(file,'utf8'),context,{filename:file});
  context.fixture={stocks:fixtures(),updatedAt:1};
  const result=vm.runInContext('createValidatedCandidateSnapshot(alpha3ExportSnapshot(createValidatedCandidateSnapshot(fixture,{touchUpdatedAt:false})),{touchUpdatedAt:false})',context);
  assert.deepEqual(JSON.parse(JSON.stringify(result.stocks.map(s=>s.managementCategory))),['core','watch','candidate','etf',null,null,null]);
  assert.equal(result.stocks[2].type,'etf');assert.equal(result.stocks[2].shares,0);assert.equal(result.stocks[4].role,'成长仓');
});
test('category-only commit does not enqueue existing Universe membership or expose category',async()=>{
  const {createQueue,projection}=require('../src/universe-auto-add'),data=new Map(),inserts=[];
  const queue=createQueue({storage:{getItem:key=>data.get(key)??null,setItem:(key,value)=>data.set(key,value)},key:'category-fixture',online:()=>true,insert:async row=>inserts.push(row)});
  const state={stocks:[stock('1','core')]};await queue.initialize(state);await queue.setUser('aa000000-0000-4000-8000-000000000001');
  await queue.committed(M.buildCandidate(state,[assignment(state.stocks[0],'watch')],canonical));await queue.pump();assert.deepEqual(inserts,[]);
  assert.deepEqual(projection(state),[{symbol:'600001.SS',displayName:'测试1'}]);
});
