'use strict';

const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const test=require('node:test');
const Strict=require('../src/strict-ai-json.js');
const Discussion=require('../src/discussion-state-contract.js');
const Workflow=require('../src/discussion-plan-workflow.js');

const fixturePath=path.join(__dirname,'fixtures','production-current-state-transport-failure-2026-09-02.json.txt');
const productionRaw=fs.readFileSync(fixturePath,'utf8').replace(/\r?\n$/,'');
const discussionOptions={expectedSymbol:'2899.HK',sourceDiscussionVersion:'discussion_v2_fa77d62f',holdingShares:100,hasActivePlan:true,technicalDataStatus:'fresh',programProvesFullPlanConditions:false};

function smartStructure(value){
  let inString=false,escaped=false;
  return JSON.stringify(value).split('').map(character=>{
    if(escaped){escaped=false;return character}
    if(character==='\\'){if(inString)escaped=true;return character}
    if(character==='"'){inString=!inString;return inString?'“':'”'}
    return character;
  }).join('');
}

function planFixture(){
  const stock={id:'transport-plan-stock',name:'工业富联',code:'601138.SS',symbol:'601138.SS',shares:500,capPct:20,strategy:{maxWeight:20,minTradeUnit:100,minTradeUnitConfirmed:true},plans:[]};
  const prepared=Workflow.prepare(stock,{sessionId:'transport-plan-session',now:'2026-09-02T08:00:00Z'});
  const envelope={schemaVersion:Workflow.SCHEMA_VERSION,operation:'no_change',symbol:prepared.symbol,...prepared.binding,targetPlan:null,plan:null,reason:'当前对话未形成需要保存的具体计划结论。',risks:[],unresolvedItems:[]};
  return {stock,prepared,envelope};
}

test('real production fixture reproduces raw failure, existing safe fallback, and the Current State business layer',()=>{
  assert.equal(productionRaw.length,2367);
  assert.throws(()=>JSON.parse(productionRaw),/position 74|column 75|JSON/);
  const parsed=Strict.parseStrictAiJson(productionRaw),diagnostics=parsed.diagnostics;
  assert.equal(parsed.ok,true);
  assert.deepEqual(parsed.repairs,[Strict.REPAIRS.MARKDOWN_UNDERSCORE_ESCAPE]);
  assert.equal(diagnostics.rawInputLength,2367);
  assert.deepEqual(diagnostics.rawCharacterCounts,{asciiQuote:234,leftSmartQuote:0,rightSmartQuote:0,fullwidthQuote:0,underscoreEscape:7,fullwidthColon:0,fullwidthComma:43});
  assert.equal(diagnostics.originalParseFailed,true);
  assert.match(diagnostics.originalParseError,/position 74|column 75/);
  assert.deepEqual({...diagnostics.originalParseErrorDetail,context:undefined},{message:diagnostics.originalParseError,index:74,line:1,column:75,character:'_',codePoint:'U+005F',context:undefined,contextStart:0,contextEnd:175});
  assert.ok(diagnostics.originalParseErrorDetail.context.length>=170);
  assert.equal(diagnostics.boundaryCleanupAttempted,true);assert.equal(diagnostics.boundaryCleanupChanged,false);
  assert.equal(diagnostics.fenceDetectionAttempted,true);assert.equal(diagnostics.fenceDetected,false);assert.equal(diagnostics.fenceRemoved,false);
  assert.equal(diagnostics.smartQuoteRecoveryAttempted,false);assert.equal(diagnostics.repairedSmartQuoteCount,0);assert.deepEqual(diagnostics.structuralQuoteRepairPositions,[]);
  assert.equal(diagnostics.underscoreEscapeRecoveryAttempted,true);assert.equal(diagnostics.repairedUnderscoreEscapeCount,7);assert.deepEqual(diagnostics.underscoreEscapeRepairPositions,[73,77,125,1232,1239,1384,1391]);
  assert.equal(diagnostics.otherIllegalEscapeCount,0);assert.deepEqual(diagnostics.otherIllegalEscapes,[]);
  assert.equal(diagnostics.finalParseSucceeded,true);assert.equal(diagnostics.finalParseError,null);assert.equal(diagnostics.finalFailureIndex,null);
  assert.equal(diagnostics.finalCandidateText,parsed.normalizedText);assert.equal(diagnostics.repairedCandidateText,parsed.normalizedText);assert.doesNotMatch(parsed.normalizedText,/\\_/);
  assert.equal(parsed.value.currentState.sourceDiscussionVersion,'discussion_v2_fa77d62f');assert.equal(parsed.value.currentState.actionAssessment.category,'risk_control');assert.equal(parsed.value.currentState.structureAssessment[1].source,'ai_chart_judgment');
  const business=Discussion.process(productionRaw,discussionOptions);
  assert.equal(business.ok,true,business.message);assert.equal(business.previewReady,true);assert.equal(business.writes,0);assert.equal(business.code,'valid');assert.equal(business.input.repairedUnderscoreEscapes,7);
});

test('T1 Current State standard full json fence reaches schema and Preview',()=>{
  const value=Strict.parseStrictAiJson(productionRaw).value,raw=`\`\`\`json\n${JSON.stringify(value)}\n\`\`\``,result=Discussion.process(raw,discussionOptions);
  assert.equal(result.ok,true,result.message);assert.equal(result.previewReady,true);assert.equal(result.writes,0);assert.equal(result.input.fenceRemoved,true);assert.equal(result.input.repairedUnderscoreEscapes,0);
});

test('T2 Plan Draft standard full json fence reaches Preview',()=>{
  const {stock,prepared,envelope}=planFixture(),result=Workflow.process(`\`\`\`json\n${JSON.stringify(envelope)}\n\`\`\``,{stock,prepared});
  assert.equal(result.ok,true,result.message);assert.equal(result.previewReady,true);assert.equal(result.writes,0);assert.equal(result.code,'no_change');
});

test('T3 fenced Chinese content quotes remain unchanged',()=>{
  const value=structuredClone(Strict.parseStrictAiJson(productionRaw).value);value.currentState.summary='当前进入“高位回撤”观察窗口。';
  const result=Discussion.process(`\`\`\`json\n${JSON.stringify(value)}\n\`\`\``,discussionOptions);
  assert.equal(result.ok,true,result.message);assert.equal(result.currentState.summary,'当前进入“高位回撤”观察窗口。');assert.equal(result.input.smartQuoteRecoveryAttempted,false);
});

test('T4 fenced underscore enums stay literal underscores',()=>{
  const value=Strict.parseStrictAiJson(productionRaw).value,result=Strict.parseStrictAiJson(`\`\`\`json\n${JSON.stringify(value)}\n\`\`\``);
  assert.equal(result.ok,true);assert.equal(result.value.currentState.actionAssessment.category,'risk_control');assert.equal(result.value.currentState.structureAssessment[1].source,'ai_chart_judgment');assert.equal(result.input.repairedUnderscoreEscapes,0);
});

test('T5 fenced safe legacy underscore pollution still uses the narrow fallback',()=>{
  const result=Discussion.process(`\`\`\`json\n${productionRaw}\n\`\`\``,discussionOptions);
  assert.equal(result.ok,true,result.message);assert.equal(result.previewReady,true);assert.deepEqual(result.input.repairs,[Strict.REPAIRS.MARKDOWN_FENCE,Strict.REPAIRS.MARKDOWN_UNDERSCORE_ESCAPE]);assert.equal(result.input.repairedUnderscoreEscapes,7);
});

test('T6 fenced structural U+201C and U+201D still use context-aware fallback',()=>{
  const value=Strict.parseStrictAiJson(productionRaw).value,result=Discussion.process(`\`\`\`json\n${smartStructure(value)}\n\`\`\``,discussionOptions);
  assert.equal(result.ok,true,result.message);assert.equal(result.previewReady,true);assert.equal(result.input.smartQuotesRecovered,true);assert.ok(result.input.repairedStructuralQuotes>100);assert.equal(result.currentState.summary,value.currentState.summary);
});

test('T7 fenced structural U+FF02 still uses context-aware fallback',()=>{
  const value=Strict.parseStrictAiJson(productionRaw).value,fullwidth=JSON.stringify(value).replace(/"/g,'＂'),result=Discussion.process(`\`\`\`json\n${fullwidth}\n\`\`\``,discussionOptions);
  assert.equal(result.ok,true,result.message);assert.equal(result.previewReady,true);assert.deepEqual(result.input.quoteTypesEncountered,['U+FF02']);assert.ok(result.input.repairedStructuralQuotes>100);
});

test('T8 prose outside a fence is rejected as an unsupported wrapper',()=>{
  const result=Strict.parseStrictAiJson('这是结果：\n```json\n{"x":1}\n```');
  assert.equal(result.ok,false);assert.equal(result.reason,Strict.REASONS.UNSUPPORTED_WRAPPER);assert.equal(result.userMessage,'复制的 JSON 内容发生格式异常，请重新完整复制 AI 的 JSON 代码块。');
});

test('T9 multiple fences are rejected',()=>{
  const result=Strict.parseStrictAiJson('```json\n{"x":1}\n```\n```json\n{"y":2}\n```');
  assert.equal(result.ok,false);assert.equal(result.reason,Strict.REASONS.UNSUPPORTED_WRAPPER);
});

test('T10 partial fences are rejected',()=>{
  for(const raw of ['```json\n{"x":1}','{"x":1}\n```']){const result=Strict.parseStrictAiJson(raw);assert.equal(result.ok,false);assert.equal(result.reason,Strict.REASONS.UNSUPPORTED_WRAPPER)}
});

test('post-repair diagnostics identify the final blocker instead of the first raw suspicious quote',()=>{
  const result=Strict.parseStrictAiJson('{“x”:“ok”,}');
  assert.equal(result.ok,false);assert.equal(result.reason,Strict.REASONS.MALFORMED);assert.equal(result.diagnostics.firstRawSuspiciousCharacter.character,'“');assert.equal(result.diagnostics.firstRawSuspiciousCharacter.index,1);
  assert.equal(result.diagnostics.repairedSmartQuoteCount,4);assert.deepEqual(result.diagnostics.structuralQuoteRepairPositions,[1,3,5,8]);
  assert.match(result.diagnostics.finalParseError,/JSON/);assert.equal(result.diagnostics.finalFailureIndex,10);assert.equal(result.diagnostics.finalFailureCharacter,'}');assert.equal(result.diagnostics.finalFailureCodePoint,'U+007D');assert.match(result.diagnostics.finalFailureContext,/\{"x":"ok",\}/);
  assert.equal(result.userMessage,'复制的 JSON 内容发生格式异常，请重新完整复制 AI 的 JSON 代码块。');
});

test('unknown escapes remain diagnostics-only and are never repaired',()=>{
  const result=Strict.parseStrictAiJson('{"value":"abc\\qdef"}');
  assert.equal(result.ok,false);assert.equal(result.input.repairedUnderscoreEscapes,0);assert.equal(result.diagnostics.otherIllegalEscapeCount,1);assert.equal(result.diagnostics.otherIllegalEscapes[0].sequence,'\\q');assert.doesNotMatch(result.diagnostics.finalCandidateText,/abcdef/);
});
