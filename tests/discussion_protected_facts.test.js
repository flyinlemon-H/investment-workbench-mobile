'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const W=require('../src/discussion-workbench'),C=require('../src/discussion-state-contract'),F=require('./fixtures/discussion-protected-facts');
for(const shares of [0,100])test(`both prompts allow explicit judgment and numeric proposals (${shares})`,()=>{
  const p=W.buildDiscussionRequest(F.stock('none',shares)),archive=W.buildArchiveRequest(p).request;
  for(const request of [p.request,archive])for(const rule of ['PROGRAM OWNS FACTS / AI OWNS JUDGMENTS','允许明确持有、建仓、加仓、减仓、等待判断','允许精确价格、价格区间、仓位比例、股数、数量、成本和日期','AI Strategy Proposal','不得声称','保存原文'])assert.ok(request.includes(rule),rule);
  assert.doesNotMatch(archive,/只写定性判断|禁止精确价格|不得回显|不能由 AI 输出或修正/);
  const raw=JSON.parse(archive.slice(archive.lastIndexOf('\n{')+1));assert.deepEqual(Object.keys(raw.currentState).sort(),[...C.RESULT_FIELDS].sort());assert.equal(C.process(JSON.stringify(raw),F.options(p)).ok,true);
});
for(const field of F.fields)for(const [kind,wording] of Object.entries(F.cases))test(`${field} ${kind} ACCEPT, original content and authority preserved`,async()=>{
  const stock=F.stock('none',100),state={stocks:[stock],trades:[],orders:[],executionLog:[]},before=structuredClone(state),p=W.buildDiscussionRequest(stock),raw=F.output(p,wording,field);
  const result=C.process(JSON.stringify(raw),F.options(p));assert.equal(result.ok,true,result.message);assert.equal(result.previewReady,true);assert.equal(result.writes,0);
  const built=C.buildCandidate(state,result,{prepared:p});assert.deepEqual(built.currentState.userDecision,raw.currentState.userDecision);assert.deepEqual(state,before);
  const stripped=structuredClone(built.candidate);delete stripped.discussionDecisionsV4;for(const key of ['discussionState','updatedAt']){delete stripped.stocks[0][key];delete before.stocks[0][key]}assert.deepEqual(stripped,before);assert.deepEqual(built.candidate.discussionDecisionsV4.decisions,{});
});
for(const shares of [0,100])test(`qualitative V3 import preserves other authority (${shares})`,async()=>{
  const stock=F.stock('none',shares),state={stocks:[stock],trades:[],orders:[]},before=JSON.stringify(state),p=W.buildDiscussionRequest(stock),raw=F.output(p),result=C.process(JSON.stringify(raw),F.options(p));
  assert.equal(result.ok,true,result.message);assert.equal(result.previewReady,true);let writes=0,saved;
  const commit=await C.commit(result,state,{saveCandidate:c=>{writes++;saved=c}},{prepared:p});assert.equal(commit.status,'completed',commit.error?.message);assert.equal(writes,1);assert.equal(JSON.stringify(state),before);
  assert.equal(saved.stocks[0].discussionState.current.schemaVersion,W.STATE_SCHEMA_VERSION);assert.equal(saved.stocks[0].discussionState.current.userDecision.warning.summary,F.qualitative);assert.equal(saved.stocks[0].discussionState.current.references.holding.shares,shares);
  assert.deepEqual(saved.discussionDecisionsV4.decisions,{});assert.equal(Object.keys(saved.discussionDecisionsV4.discussions).length,1);
  const stripped=structuredClone(saved);delete stripped.discussionDecisionsV4;delete stripped.stocks[0].discussionState;delete stripped.stocks[0].updatedAt;const original=structuredClone(state);delete original.stocks[0].discussionState;delete original.stocks[0].updatedAt;assert.deepEqual(stripped,original);
});
test('numeric wording is accepted without a quality gate',()=>{
  const p=W.buildDiscussionRequest(F.stock('none',100));
  assert.equal(C.process(JSON.stringify(F.output(p,'首先观察关键结构')),F.options(p)).ok,true);
  assert.equal(C.process(JSON.stringify(F.output(p,'第1项观察重点')),F.options(p)).ok,true);
  const raw=F.output(p);raw.currentState.summary='分2步复核结构。保留不确定性。';assert.equal(C.process(JSON.stringify(raw),F.options(p)).ok,true);
});
test('obsolete content retry directions are removed',()=>{
  const source=fs.readFileSync(require.resolve('../src/ui-render'),'utf8');
  assert.doesNotMatch(source,/只保留定性判断/);
});
