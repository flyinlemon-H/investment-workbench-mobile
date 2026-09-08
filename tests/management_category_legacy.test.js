'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const M=require('../src/management-category'),I=require('../src/symbol-identity'),F=require('./fixtures/management-category-legacy');
const canonical=I.canonicalMarketSymbol,session=state=>M.assignmentSession(state.stocks,canonical);
test('observed legacy ETF cash shape is outside category domain and has no memberships',()=>{
  const cash=F.mixed().stocks.at(-1);
  assert.equal(I.isLegacyCashRow(cash),true);assert.equal(M.needsAssignment(cash),false);
  assert.equal(M.isManagementCategoryTarget(cash),false);
  for(const managementCategory of M.values)assert.equal(M.matches({...cash,managementCategory},managementCategory),false);
});
test('mixed legacy batch counts, inventory and expected assignments agree; only category fields change',()=>{
  const state=F.mixed(),before=JSON.stringify(state),expected=session(state),assignments=F.choices(state);
  assert.equal(M.targets(state.stocks).length,23);assert.equal(M.pending(state.stocks).length,23);
  assert.deepEqual(new Set(M.inventory(state.stocks).map(s=>s.id)),new Set(expected.filter(s=>s.pending).map(s=>s.id)));
  const candidate=M.buildAssignmentCandidate(state,assignments,canonical,expected);
  assert.equal(JSON.stringify(state),before);assert.equal(M.pending(candidate.stocks).length,0);
  assert.equal(M.values.reduce((n,key)=>n+candidate.stocks.filter(s=>M.matches(s,key)).length,0),23);
  assert.equal(JSON.stringify(candidate.stocks.at(-1)),JSON.stringify(state.stocks.at(-1)));
  candidate.stocks.forEach(s=>delete s.managementCategory);assert.deepEqual(candidate,state);
});
test('ordinary malformed or empty market symbol still blocks, never silently excluded',()=>{
  for(const code of ['BAD','', '603296','603296.US']){
    const state=F.mixed(2);state.stocks[0].code=code;
    assert.equal(M.needsAssignment(state.stocks[0]),true);
    assert.throws(()=>M.buildAssignmentCandidate(state,F.choices(state),canonical,session(state)),/发现无效标的代码/);
  }
});
test('canonical real duplicate blocks with symbol in diagnostic',()=>{
  const state=F.mixed(2);state.stocks[1].code='600000.sh';
  assert.throws(()=>M.buildAssignmentCandidate(state,F.choices(state),canonical,session(state)),/发现重复标的代码：600000.SS/);
  assert.deepEqual(M.inventory(state.stocks).map(s=>s.id).sort(),['legacy-0','legacy-1']);
});
for(const change of ['symbol','remove','add','category','special','duplicate'])test(`assignment session blocks concurrent ${change} without any mutation`,()=>{
  const state=F.mixed(3),expected=session(state),assignments=F.choices(state);
  if(change==='symbol')state.stocks[0].code='603296.SS';
  if(change==='remove')state.stocks.splice(0,1);
  if(change==='add')state.stocks.push({...state.stocks[0],id:'extra',code:'603296.SS'});
  if(change==='category')state.stocks[0].managementCategory='core';
  if(change==='special')state.stocks[0].isSystem=true;
  if(change==='duplicate')state.stocks.push({...state.stocks[0],id:'extra'});
  const before=JSON.stringify(state);assert.throws(()=>M.buildAssignmentCandidate(state,assignments,canonical,expected),/变化|移除|重复/);assert.equal(JSON.stringify(state),before);
});
test('reordering the array never remaps choices to another record',()=>{
  const state=F.mixed(),expected=session(state),assignments=F.choices(state);state.stocks.reverse();
  const candidate=M.buildAssignmentCandidate(state,assignments,canonical,expected);
  for(const a of assignments)assert.equal(candidate.stocks.find(s=>s.id===a.id).managementCategory,a.managementCategory);
});
test('multiple blank special identities and special symbol collision do not enter category validator',()=>{
  const state=F.mixed(3),assignments=F.choices(state);
  state.stocks.push({id:'system-a',type:'system',code:''},{id:'system-b',systemRow:true},{id:'cash-other',objectType:'cash',code:state.stocks[0].code});
  const before=JSON.stringify(state.stocks.slice(3));
  const candidate=M.buildAssignmentCandidate(state,assignments,canonical,session(state));
  assert.equal(JSON.stringify(candidate.stocks.slice(3)),before);assert.equal(M.pending(candidate.stocks).length,0);
  assert.throws(()=>M.buildCandidate(state,[{id:'cash',symbol:'',managementCategory:'candidate'}],canonical),/特殊记录/);
});
test('all established special type markers are excluded, blank name alone is not proof',()=>{
  for(const marker of [{role:'现金'},{theme:'现金'},{id:'cash'},{type:'cash'},{type:'system'},{objectType:'cash'},{objectType:'system'},{isCash:true},{isSystem:true},{systemRow:true}])assert.equal(M.isManagementCategoryTarget({id:'special',...marker}),false);
  assert.equal(M.isManagementCategoryTarget({id:'real',name:'现金流公司',code:''}),true);
});
test('exact pending set, enum and compatibility guard preserve atomicity',()=>{
  const state=F.mixed(3),assignments=F.choices(state),expected=session(state),before=JSON.stringify(state);
  for(const bad of [assignments.slice(1),[...assignments,assignments[0]],[assignments[0],assignments[0],assignments[2]],assignments.map((a,i)=>i===2?{...a,managementCategory:'invalid'}:a),assignments.map((a,i)=>i===2?{...a,managementCategory:'core'}:a)])assert.throws(()=>M.buildAssignmentCandidate(state,bad,canonical,expected));
  assert.equal(JSON.stringify(state),before);
});
test('old backup with cash loads without a synthesized category and roundtrips classification',()=>{
  const context={console};context.window=context;context.globalThis=context;vm.createContext(context);
  for(const file of ['src/plan-v2.js','src/strict-ai-json.js','src/state.js','src/import-export.js'])vm.runInContext(fs.readFileSync(file,'utf8'),context);
  context.fixture=F.mixed(4);
  const legacy=JSON.parse(JSON.stringify(vm.runInContext('createValidatedCandidateSnapshot(fixture,{touchUpdatedAt:false})',context)));
  assert.equal(Object.hasOwn(legacy.stocks.at(-1),'managementCategory'),false);assert.equal(M.pending(legacy.stocks).length,4);
  context.fixture=M.buildAssignmentCandidate(legacy,F.choices(legacy),canonical,session(legacy));
  const restored=JSON.parse(JSON.stringify(vm.runInContext('createValidatedCandidateSnapshot(alpha3ExportSnapshot(fixture),{touchUpdatedAt:false})',context)));
  assert.equal(M.pending(restored.stocks).length,0);assert.equal(Object.hasOwn(restored.stocks.at(-1),'managementCategory'),false);
});
