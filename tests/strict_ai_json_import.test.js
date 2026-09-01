'use strict';

const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const test=require('node:test');
const vm=require('node:vm');
const Strict=require('../src/strict-ai-json.js');
const Discussion=require('../src/discussion-state-contract.js');

const root=path.resolve(__dirname,'..');
const read=file=>fs.readFileSync(path.join(root,file),'utf8');
const discussionVersion='discussion_v1_fixture';
const discussionValue=(overrides={})=>({currentState:{symbol:'601138.SS',sourceDiscussionVersion:discussionVersion,actionAssessment:{category:'hold_watch',priority:'low',headline:'当前维持常规观察。',reasons:['趋势仍在修复，暂未出现仓位调整信号。'],upgradeConditions:['量价确认后提高复核优先级。'],downgradeConditions:['修复结构被破坏。']},attentionLevel:'normal',trendAssessment:{overall:'recovery',timeframes:[{timeframe:'日线',status:'recovery',explanation:'市场仍处于“修复观察”阶段。'}]},structureAssessment:[],stage:'修复观察',focusPoints:['等待“量价确认”。'],summary:'市场仍处于“修复观察”阶段。',keyChanges:['继续观察“行业长期逻辑”'],risks:[],watchPoints:['等待压力位确认。'],planRelation:{status:'neutral',summary:'与“原计划”保持观察关系；价格触发不等于完整条件满足。'},confidence:'medium',...overrides}});
const discussionOptions={expectedSymbol:'601138.SS',sourceDiscussionVersion:discussionVersion,holdingShares:100,hasActivePlan:true,technicalDataStatus:'fresh',programProvesFullPlanConditions:false};
const smartStructure=value=>{
  const source=JSON.stringify(value);let inString=false,escaped=false;
  return source.split('').map(char=>{
    if(escaped){escaped=false;return char}
    if(char==='\\'){if(inString)escaped=true;return char}
    if(char==='"'){inString=!inString;return inString?'“':'”'}
    return char;
  }).join('');
};
const fullwidthStructure=value=>JSON.stringify(value).replace(/"/g,'＂');

test('valid strict JSON is accepted unchanged before any presentation repair',()=>{
  const raw='  {"sourceSummary":"按“行业长期逻辑—公司专属护城河—组合角色价值”三层结构整理"}\n';
  const result=Strict.parseStrictAiJson(raw);
  assert.equal(result.ok,true);assert.equal(result.normalizedText,raw);assert.deepEqual(result.repairs,[]);
  assert.equal(result.value.sourceSummary,'按“行业长期逻辑—公司专属护城河—组合角色价值”三层结构整理');
  assert.equal(result.input.smartQuoteRecoveryAttempted,false);
});

test('one full labeled or unlabeled Markdown fence is recovered and wrappers stay fail-closed',()=>{
  for(const raw of ['```json\n{"x":1}\n```','```JSON\n{"x":1}\n```','```\n{"x":1}\n```']){
    const result=Strict.parseStrictAiJson(raw);assert.equal(result.ok,true);assert.deepEqual(result.value,{x:1});assert.deepEqual(result.repairs,[Strict.REPAIRS.MARKDOWN_FENCE]);
  }
  for(const raw of ['说明\n```json\n{"x":1}\n```','```json\n{"x":1}\n```\n说明','```json\n{"x":1}\n```\n```json\n{"y":2}\n```','```json\n{"x":1}','{"x":1}\n```']){
    const result=Strict.parseStrictAiJson(raw);assert.equal(result.ok,false);assert.equal(result.reason,Strict.REASONS.UNSUPPORTED_WRAPPER);
  }
});

test('structural smart quotes recover while nested Chinese content quotes remain untouched',()=>{
  const raw='{“summary”:“市场仍处于“修复观察”阶段”,“watchPoints”:[“等待“量价确认””]}';
  const result=Strict.parseStrictAiJson(raw);
  assert.equal(result.ok,true);assert.equal(result.value.summary,'市场仍处于“修复观察”阶段');assert.equal(result.value.watchPoints[0],'等待“量价确认”');
  assert.deepEqual(result.repairs,[Strict.REPAIRS.STRUCTURAL_SMART_QUOTES]);
});

test('required structural quote delimiters parse across compact objects and arrays',()=>{
  const standard='{"currentState":{"symbol":"2899.HK","summary":"测试"}}',standardResult=Strict.parseStrictAiJson(standard);
  assert.equal(standardResult.ok,true);assert.equal(standardResult.normalizedText,standard);assert.deepEqual(standardResult.repairs,[]);
  const curly=Strict.parseStrictAiJson('{“currentState”:{“symbol”:“2899.HK”,“summary”:“测试”,“risks”:[“风险一”,“风险二”]}}');
  assert.equal(curly.ok,true);assert.equal(curly.value.currentState.summary,'测试');assert.deepEqual(curly.value.currentState.risks,['风险一','风险二']);
  const fullwidth=Strict.parseStrictAiJson('{＂currentState＂:{＂symbol＂:＂2899.HK＂}}');
  assert.equal(fullwidth.ok,true);assert.equal(fullwidth.value.currentState.symbol,'2899.HK');assert.equal(fullwidth.input.repairedStructuralQuotes,6);assert.deepEqual(fullwidth.input.quoteTypesEncountered,['U+FF02']);
  assert.equal(fullwidth.diagnostics.originalParseFailed,true);assert.match(fullwidth.diagnostics.originalParseError,/JSON/);assert.equal(fullwidth.diagnostics.normalizedParseError,null);assert.equal(fullwidth.diagnostics.repairClassification,'structural_quotes_repaired');assert.equal(fullwidth.diagnostics.firstSuspiciousQuote.codePoint,'U+FF02');assert.equal(fullwidth.diagnostics.repairAttemptCount,1);assert.equal(fullwidth.diagnostics.structuralQuoteRepairCounts['U+FF02'],6);
  const standardArray='{"risks":["风险一","风险二"]}',standardArrayResult=Strict.parseStrictAiJson(standardArray);
  assert.equal(standardArrayResult.ok,true);assert.equal(standardArrayResult.normalizedText,standardArray);assert.deepEqual(standardArrayResult.repairs,[]);
});

test('valid content quotation and escape forms preserve exact values',()=>{
  const standard='{"summary":"当前进入“高位回撤”观察窗口。"}',standardResult=Strict.parseStrictAiJson(standard);
  assert.equal(standardResult.ok,true);assert.equal(standardResult.normalizedText,standard);assert.equal(standardResult.value.summary,'当前进入“高位回撤”观察窗口。');assert.deepEqual(standardResult.repairs,[]);
  const single=Strict.parseStrictAiJson('{“summary”:“当前进入‘高位回撤’观察窗口。”}');
  assert.equal(single.ok,true);assert.equal(single.value.summary,'当前进入‘高位回撤’观察窗口。');
  const double=Strict.parseStrictAiJson('{“summary”:“当前进入“高位回撤”观察窗口。”}');
  assert.equal(double.ok,true);assert.equal(double.value.summary,'当前进入“高位回撤”观察窗口。');
  const escaped='{"summary":"他说：\\"继续观察\\""}',escapedResult=Strict.parseStrictAiJson(escaped);
  assert.equal(escapedResult.ok,true);assert.equal(escapedResult.normalizedText,escaped);assert.equal(escapedResult.value.summary,'他说："继续观察"');
});

test('complete Current State v2 reaches existing schema validation after fullwidth structural repair',()=>{
  const sourceDiscussionVersion='discussion_v2_9a35cb46';
  const payload={currentState:{symbol:'2899.HK',sourceDiscussionVersion,actionAssessment:{category:'hold_watch',priority:'medium',headline:'中期趋势未确认破坏，短线弱势需要重点观察。',reasons:['日线仍在中期结构内，但短线修复尚未确认。'],upgradeConditions:['放量收复近期压力位。'],downgradeConditions:['跌破中期结构支撑且无法快速收回。']},attentionLevel:'focused',trendAssessment:{overall:'uptrend',timeframes:[{timeframe:'日线',status:'recovery',explanation:'短线仍处于“弱势修复”阶段。'},{timeframe:'周线',status:'uptrend',explanation:'中期上升趋势暂未确认破坏。'}]},structureAssessment:[{timeframe:'日线',type:'pullback',status:'forming',source:'ai_chart_judgment',sourceAsOf:'2026-08-31',shortReason:'回撤结构仍在形成，需要等待量价确认。'}],stage:'中期上升中的短线回撤',focusPoints:['关注“量价确认”与压力位收复。'],summary:'紫金矿业中期上升趋势暂未确认破坏，但短线弱势已经进一步确认。',keyChanges:['短线修复强度较上次讨论减弱。'],risks:['若中期支撑失守，回撤可能演变为趋势破坏。'],watchPoints:['观察日线压力位与成交量变化。'],planRelation:{status:'aligned',summary:'与现有观察计划方向一致，价格触发不代表完整条件满足。'},confidence:'medium'}};
  const parsed=Strict.parseStrictAiJson(fullwidthStructure(payload));
  assert.equal(parsed.ok,true);assert.equal(parsed.value.currentState.summary,payload.currentState.summary);assert.ok(parsed.input.repairedStructuralQuotes>40);
  const result=Discussion.process(fullwidthStructure(payload),{expectedSymbol:'2899.HK',sourceDiscussionVersion,holdingShares:100,hasActivePlan:true,technicalDataStatus:'fresh',programProvesFullPlanConditions:false});
  assert.equal(result.ok,true,result.message);assert.equal(result.previewReady,true);assert.equal(result.writes,0);assert.equal(result.currentState.trendAssessment.timeframes.length,2);assert.equal(result.currentState.structureAssessment[0].source,'ai_chart_judgment');
  const stale=Discussion.process(fullwidthStructure(payload),{expectedSymbol:'2899.HK',sourceDiscussionVersion:'discussion_v2_stale',holdingShares:100,hasActivePlan:true,technicalDataStatus:'fresh',programProvesFullPlanConditions:false});
  assert.equal(stale.ok,false);assert.equal(stale.code,'validation_error');assert.match(stale.message,/结论来源版本已过期或不一致/);
});

test('fenced structural smart quotes recover and ambiguous content quotes fail closed',()=>{
  const recovered=Strict.parseStrictAiJson('```json\n{“x”:“正文“引用”结束”}\n```');
  assert.equal(recovered.ok,true);assert.deepEqual(recovered.repairs,[Strict.REPAIRS.MARKDOWN_FENCE,Strict.REPAIRS.STRUCTURAL_SMART_QUOTES]);assert.equal(recovered.value.x,'正文“引用”结束');
  const ambiguous=Strict.parseStrictAiJson('{“x”:“正文“引用未闭合”}');
  assert.equal(ambiguous.ok,false);assert.equal(ambiguous.reason,Strict.REASONS.AMBIGUOUS_SMART_QUOTES);assert.equal(ambiguous.userMessage,'检测到非标准 JSON 引号，已尝试自动修复，但内容仍不是可解析的完整 JSON。 首个异常字符：“');
  assert.equal(ambiguous.diagnostics.repairClassification,'ambiguous_structural_quotes');assert.equal(ambiguous.diagnostics.firstSuspiciousQuote.codePoint,'U+201C');assert.equal(ambiguous.diagnostics.firstSuspiciousQuote.index,1);assert.match(ambiguous.diagnostics.firstSuspiciousQuote.context,/“x”/);
  const malformed=Strict.parseStrictAiJson('{＂x＂:[1,]}');
  assert.equal(malformed.ok,false);assert.equal(malformed.reason,Strict.REASONS.MALFORMED);assert.equal(malformed.diagnostics.repairClassification,'structural_quote_repair_parse_failed');assert.match(malformed.diagnostics.normalizedParseError,/JSON/);assert.equal(malformed.diagnostics.repairedStructuralQuotes,2);assert.match(malformed.userMessage,/已尝试自动修复/);
  const ambiguousFullwidth=Strict.parseStrictAiJson('{＂x＂:＂a＂ ＂y＂:＂b＂}');
  assert.equal(ambiguousFullwidth.ok,false);assert.equal(ambiguousFullwidth.reason,Strict.REASONS.AMBIGUOUS_SMART_QUOTES);assert.equal(ambiguousFullwidth.diagnostics.repairClassification,'ambiguous_structural_quotes');
});

test('only document-boundary BOM and zero-width artifacts are removed',()=>{
  const bom=Strict.parseStrictAiJson('\uFEFF{"x":1}');assert.equal(bom.ok,true);assert.deepEqual(bom.repairs,[Strict.REPAIRS.BOUNDARY_BOM]);
  const zeroWidth=Strict.parseStrictAiJson('\u200B {"x":1} \u2060');assert.equal(zeroWidth.ok,true);assert.deepEqual(zeroWidth.repairs,[Strict.REPAIRS.BOUNDARY_INVISIBLE]);
  const inside='{"x":"a\u200Bb","nbsp":"a\u00A0b"}',insideResult=Strict.parseStrictAiJson(inside);assert.equal(insideResult.ok,true);assert.equal(insideResult.normalizedText,inside);assert.equal(insideResult.value.x,'a\u200Bb');assert.equal(insideResult.value.nbsp,'a\u00A0b');
});

test('malformed and truncated JSON are classified without inventing syntax',()=>{
  const cases=[
    ['{"x":',Strict.REASONS.TRUNCATED],['{"x":"unterminated',Strict.REASONS.TRUNCATED],['{"x":[1,2',Strict.REASONS.TRUNCATED],
    ['{"x":1 "y":2}',Strict.REASONS.MALFORMED],
    ['{"x":"bad\\q"}',Strict.REASONS.MALFORMED],['{"x":[1,}',Strict.REASONS.MALFORMED],['{"x":1,}',Strict.REASONS.MALFORMED]
  ];
  for(const [raw,reason] of cases){const result=Strict.parseStrictAiJson(raw);assert.equal(result.ok,false,raw);assert.equal(result.reason,reason,raw)}
  assert.equal(Strict.parseStrictAiJson('{"x":').userMessage,'JSON 内容可能不完整，请重新复制完整结果');
  assert.equal(Strict.parseStrictAiJson('{"x":1,}').userMessage,'JSON 格式无法识别，请重新复制完整结果');
});

test('Discussion Archive accepts DA-A through DA-E and preserves quote-heavy long content',()=>{
  const value=discussionValue({summary:`${'长期说明。'.repeat(90)}“重点”`}),ascii=JSON.stringify(value);
  for(const raw of [ascii,smartStructure(value),`\n\`\`\`json\n${ascii}\n\`\`\`\n`,`\`\`\`json\n${smartStructure(value)}\n\`\`\``]){
    const result=Discussion.process(raw,discussionOptions);assert.equal(result.ok,true,result.message);assert.equal(result.writes,0);assert.equal(result.currentState.summary,value.currentState.summary);
  }
});

test('Discussion Archive parser and contract failures are distinct and always preview-only',()=>{
  const parseFailures=['{"currentState":','说明\n'+JSON.stringify(discussionValue()),JSON.stringify(discussionValue())+'\n说明'];
  for(const raw of parseFailures){const result=Discussion.process(raw,discussionOptions);assert.equal(result.ok,false);assert.equal(result.writes,0);assert.match(result.message,/JSON (?:内容可能不完整|格式无法识别)/)}
  for(const value of [discussionValue({symbol:'000001.SZ'}),discussionValue({sourceDiscussionVersion:'stale'}),{currentState:{...discussionValue().currentState,unknown:true}}]){
    const result=Discussion.process(JSON.stringify(value),discussionOptions);assert.equal(result.ok,false);assert.equal(result.writes,0);assert.match(result.message,/JSON 已解析，但字段不符合导入要求/);
  }
});

function legacyImportRuntime(){
  const context={console,window:{},globalThis:null,setTimeout:()=>0,clearTimeout:()=>{},structuredClone,alert:()=>{}};
  context.globalThis=context;
  vm.createContext(context);
  vm.runInContext(read('src/strict-ai-json.js'),context,{filename:'strict-ai-json.js'});
  vm.runInContext(read('src/state.js'),context,{filename:'state.js'});
  vm.runInContext(read('src/ui-render.js'),context,{filename:'ui-render.js'});
  vm.runInContext(`
    state={stocks:[{id:'fixture',code:'601138.SS',symbol:'601138.SS',name:'工业富联',type:'holding',longTermLogic:{investmentThesis:'原长期逻辑',sourceSummary:'原摘要'},recentCatalyst:{todayCatalyst:'原催化'},shortTermSentiment:{marketMood:'原情绪'},informationCompleteness:{overall:'medium'},dataFreshness:{}}]};
    detailStockId='fixture';this.alerts=[];this.saveCalls=[];alert=message=>alerts.push(String(message));
    this.statusClasses=new Set();this.testElements={longTermLogicImportStatus:{textContent:'',classList:{add:value=>statusClasses.add(value),remove:value=>statusClasses.delete(value)}},longTermLogicImportSaveBtn:{disabled:false},sentimentImportStatus:{textContent:'',classList:{add:value=>statusClasses.add(value),remove:value=>statusClasses.delete(value)}},sentimentImportSaveBtn:{disabled:false}};document={getElementById:id=>testElements[id]||null};
    saveState=async(value,options)=>{saveCalls.push({value:structuredClone(value),options:structuredClone(options||{})});return {ok:true,state:value}};
    markV13DecisionReviewDirty=()=>{};closeLongTermLogicImportModal=()=>{};closeSentimentImportModal=()=>{};refreshLongLogicModalIfOpen=()=>{};render=()=>{};
    this.audit={longTerm:text=>importSentimentPayloadFromText(text,{onlyLongTerm:true,closeLongTerm:true}),general:text=>importSentimentPayloadFromText(text),stock:()=>structuredClone(state.stocks[0]),calls:()=>structuredClone(saveCalls),alerts:()=>structuredClone(alerts),longPrompt:()=>longTermLogicPromptText(state.stocks[0]),ui:kind=>{const prefix=kind==='longTerm'?'longTermLogic':'sentiment';return {message:testElements[prefix+'ImportStatus'].textContent,disabled:testElements[prefix+'ImportSaveBtn'].disabled,alertClass:statusClasses.has('alert')}}};
  `,context);
  return context.audit;
}

test('Long-Term accepts strict, fenced, and structural-plus-content quote inputs without content corruption',async()=>{
  const payload={longTermLogic:{investmentThesis:'按“行业—公司—组合”三层整理',industryDrivers:['行业处于“长期修复”阶段'],companyDrivers:[],portfolioDrivers:[],longTermRisks:[],logicStatus:'valid',confidence:'medium',sourceSummary:'引用“财报原文”'}};
  for(const raw of [JSON.stringify(payload),`\`\`\`json\n${JSON.stringify(payload)}\n\`\`\``,smartStructure(payload)]){
    const app=legacyImportRuntime();await app.longTerm(raw);assert.equal(app.calls().length,1);assert.equal(app.stock().longTermLogic.investmentThesis,payload.longTermLogic.investmentThesis);assert.equal(app.stock().longTermLogic.sourceSummary,payload.longTermLogic.sourceSummary);
  }
});

test('Long-Term rejects commentary, earlier-object tails, ambiguity, and truncation with zero persistence',async()=>{
  const payload=JSON.stringify({longTermLogic:{investmentThesis:'有效逻辑',longTermRisks:[]}});
  for(const raw of [`说明\n${payload}`,`${payload}\nbroken/truncated trailing material...`,'{“longTermLogic”: {“investmentThesis”: “正文“引号未闭合”}}','{"longTermLogic":']){
    const app=legacyImportRuntime(),before=app.stock();await app.longTerm(raw);assert.equal(app.calls().length,0,raw);assert.deepEqual(app.stock(),before);assert.doesNotMatch(app.alerts().at(-1)||'',/JSON\.parse|Unrecognized token|Unable to parse/);
  }
});

test('Long-Term distinguishes parsed-but-unrecognized business content from formatting failures',async()=>{
  const app=legacyImportRuntime(),before=app.stock();await app.longTerm('{"unrelated":"value"}');assert.equal(app.calls().length,0);assert.deepEqual(app.stock(),before);const ui=app.ui('longTerm');assert.match(ui.message,/JSON 已解析，但字段不符合导入要求：未识别 longTermLogic/);assert.equal(ui.disabled,true);assert.equal(ui.alertClass,true);
  const wrongType=legacyImportRuntime();await wrongType.longTerm('{"longTermLogic":"not an object"}');assert.equal(wrongType.calls().length,0);assert.match(wrongType.ui('longTerm').message,/JSON 已解析，但字段不符合导入要求：longTermLogic 必须是对象/);
});

test('News/Sentiment shared path keeps one coherent save and rejects parser failures with zero writes',async()=>{
  const payload={recentCatalyst:{analysisDate:'2026-09-01',todayCatalyst:'处于“观察”阶段',recentEvents:[]},shortTermSentiment:{marketMood:'市场“中性”',fundFlowView:'当前未确认',sectorHeat:'温和',institutionalView:'当前未确认'},informationCompleteness:{news:'medium',fundFlow:'low',overall:'medium',missingItems:[]}};
  const app=legacyImportRuntime();await app.general(`\`\`\`json\n${smartStructure(payload)}\n\`\`\``);assert.equal(app.calls().length,1);assert.equal(app.stock().shortTermSentiment.marketMood,'市场“中性”');
  const failed=legacyImportRuntime(),before=failed.stock();await failed.general(JSON.stringify(payload)+' trailing');assert.equal(failed.calls().length,0);assert.deepEqual(failed.stock(),before);
});

test('strict prompt wording keeps ASCII JSON examples and explicitly permits Chinese prose quotes',()=>{
  const prompt=legacyImportRuntime().longPrompt();
  for(const wording of ['只输出一个严格 JSON 对象','不要 Markdown 代码围栏','不要额外解释','JSON 结构键和值必须使用英文半角双引号 "','字符串正文可以正常使用中文标点和中文引号'])assert.match(prompt,new RegExp(wording.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')));
  assert.match(prompt,/"longTermLogic"/);assert.doesNotMatch(prompt,/“longTermLogic”/);
});

test('scoped source no longer routes Long-Term or News/Sentiment through destructive preprocessing or first-object extraction',()=>{
  const ui=read('src/ui-render.js'),parserBody=ui.match(/function parseSentimentImportJson\(text\)\{([\s\S]*?)\n\}/)?.[1]||'';
  assert.match(parserBody,/parseStrictAiJson/);assert.doesNotMatch(parserBody,/normalizeJsonLikeText|stripJsonFence|extractFirstJsonObject/);
});

test('Batch, PlanReview, Portfolio Review, and Decision Compression share the neutral parser dependency',()=>{
  const batch=read('src/batch-technical-review.js');assert.match(batch,/StrictAiJson\.parseStrictAiJson/);assert.match(batch,/preprocessStrictAiJson:StrictAiJson\.preprocessStrictAiJson/);
  for(const file of ['src/plan-review.js','src/portfolio-review-contract.js','src/decision-compression-contract.js']){const source=read(file);assert.match(source,/require\('\.\/strict-ai-json\.js'\)/);assert.match(source,/StrictAiJson\.parseStrictAiJson/);assert.doesNotMatch(source,/parseAiBatchJsonInput/)}
  const html=read('index.html'),strictPosition=html.indexOf('src/strict-ai-json.js');assert.ok(strictPosition>=0);for(const consumer of ['src/discussion-state-contract.js','src/ui-render.js','src/batch-technical-review.js','src/plan-review.js','src/portfolio-review-contract.js','src/decision-compression-contract.js'])assert.ok(strictPosition<html.indexOf(consumer),consumer);
});
