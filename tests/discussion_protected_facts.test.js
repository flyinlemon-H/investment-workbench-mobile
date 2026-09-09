'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const W=require('../src/discussion-workbench'),C=require('../src/discussion-state-contract'),F=require('./fixtures/discussion-protected-facts');
for(const shares of [0,100])test(`both prompts explicitly forbid context fact echo (${shares})`,()=>{
  const p=W.buildDiscussionRequest(F.stock('none',shares)),archive=W.buildArchiveRequest(p).request;
  for(const request of [p.request,archive])for(const rule of ['PROGRAM OWNS FACTS / AI OWNS JUDGMENTS','AI 只返回判断，不返回或重述程序事实','精确股票价格','计划价格','支撑/压力位','shares','quantity','percentage','dates','即使这些数值来自程序输入上下文（program context），也不得回显','必须改用定性表达（qualitative wording）'])assert.ok(request.includes(rule),rule);
  assert.match(archive,/userDecision.headline、holding.summary、positionDirection.summary、addAssessment.summary、warning.summary\/items、takeProfit.summary、stopLoss.summary.*即使来自 program context 也不得回显/);
  const tail=archive.slice(archive.indexOf('以下 JSON contract'));
  for(const field of ['actionAssessment 全部正文','trendAssessment 各 explanation','structureAssessment 各 shortReason','stage','summary','risks','watchPoints','keyChanges','focusPoints','planRelation.summary'])assert.ok(tail.includes(field),field);
  assert.match(tail,/不得回显上下文中的精确价格、股数、数量、百分比、成本、日期或内部引用/);
  assert.match(tail,/保护字段仍由程序补齐，不要求 AI 输出/);assert.match(tail,/symbol\/sourceDiscussionVersion.*原样返回/);assert.match(tail,/timeframe\/source\/sourceAsOf 按既有 schema/);
  for(const bad of ['跌破 50 元','建议减仓 20%','当前持有 100 股','9 月 9 日','在 50 元建仓'])assert.ok(tail.includes(bad));
  const raw=JSON.parse(archive.slice(archive.lastIndexOf('\n{')+1));assert.deepEqual(Object.keys(raw.currentState).sort(),[...C.RESULT_FIELDS].sort());assert.equal(C.process(JSON.stringify(raw),F.options(p)).ok,true);
});
for(const field of F.fields)for(const [kind,wording] of Object.entries(F.cases))test(`${field} ${kind} remains strict BLOCK and zero writes`,async()=>{
  const stock=F.stock('none',100),state={stocks:[stock],trades:[],orders:[]},before=JSON.stringify(state),p=W.buildDiscussionRequest(stock),raw=JSON.stringify(F.output(p,wording,field));
  assert.equal(C.parse(raw).ok,true);const result=C.process(raw,F.options(p));assert.equal(result.ok,false);assert.equal(result.previewReady,false);assert.equal(result.writes,0);assert.match(result.message,/userDecision 不得包含由 AI 重述或发明的精确价格、比例、股数或日期/);
  let writes=0;const commit=await C.commit(result,state,{saveCandidate:()=>{writes++}},{prepared:p});assert.notEqual(commit.status,'completed');assert.equal(writes,0);assert.equal(JSON.stringify(state),before);
});
for(const shares of [0,100])test(`qualitative V3 import preserves other authority (${shares})`,async()=>{
  const stock=F.stock('none',shares),state={stocks:[stock],trades:[],orders:[]},before=JSON.stringify(state),p=W.buildDiscussionRequest(stock),raw=F.output(p),result=C.process(JSON.stringify(raw),F.options(p));
  assert.equal(result.ok,true,result.message);assert.equal(result.previewReady,true);let writes=0,saved;
  const commit=await C.commit(result,state,{saveCandidate:c=>{writes++;saved=c}},{prepared:p});assert.equal(commit.status,'completed',commit.error?.message);assert.equal(writes,1);assert.equal(JSON.stringify(state),before);
  assert.equal(saved.stocks[0].discussionState.current.schemaVersion,W.STATE_SCHEMA_VERSION);assert.equal(saved.stocks[0].discussionState.current.userDecision.warning.summary,F.qualitative);assert.equal(saved.stocks[0].discussionState.current.references.holding.shares,shares);
  assert.deepEqual(saved.discussionDecisionsV4.decisions,{});assert.equal(Object.keys(saved.discussionDecisionsV4.discussions).length,1);
  const stripped=structuredClone(saved);delete stripped.discussionDecisionsV4;delete stripped.stocks[0].discussionState;delete stripped.stocks[0].updatedAt;const original=structuredClone(state);delete original.stocks[0].discussionState;delete original.stocks[0].updatedAt;assert.deepEqual(stripped,original);
});
test('existing numeric boundaries remain unchanged',()=>{
  const p=W.buildDiscussionRequest(F.stock('none',100));
  assert.equal(C.process(JSON.stringify(F.output(p,'首先观察关键结构')),F.options(p)).ok,true);
  assert.equal(C.process(JSON.stringify(F.output(p,'第1项观察重点')),F.options(p)).ok,false);
  const raw=F.output(p);raw.currentState.summary='分2步复核结构。保留不确定性。';assert.equal(C.process(JSON.stringify(raw),F.options(p)).ok,true);
});
test('protected rejection retains diagnostic and gives manual retry guidance',()=>{
  const source=fs.readFileSync(require.resolve('../src/ui-render'),'utf8'),sandbox={};vm.createContext(sandbox);vm.runInContext(source.slice(source.indexOf('function translateDiscussionImportFailureMessage'),source.indexOf('function showDiscussionImportFailure')),sandbox);
  const message='userDecision 不得包含由 AI 重述或发明的精确价格、比例、股数或日期',guidance=sandbox.translateDiscussionImportFailureMessage({message,code:'validation_error'});
  for(const text of [message,'返回讨论','只保留定性判断','即使来自上下文也不要回显','重新输出完整严格 JSON 并预览'])assert.ok(guidance.includes(text));
});
