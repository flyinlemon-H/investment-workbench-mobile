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
const discussionValue=(overrides={})=>({currentState:{symbol:'601138.SS',sourceDiscussionVersion:discussionVersion,stage:'修复观察',summary:'市场仍处于“修复观察”阶段。',keyChanges:['继续观察“行业长期逻辑”'],risks:[],watchPoints:['等待“量价确认”'],planRelation:'与“原计划”保持观察关系。',confidence:'medium',...overrides}});
const discussionOptions={expectedSymbol:'601138.SS',sourceDiscussionVersion:discussionVersion};
const smartStructure=value=>{
  const source=JSON.stringify(value);let inString=false,escaped=false;
  return source.split('').map(char=>{
    if(escaped){escaped=false;return char}
    if(char==='\\'){if(inString)escaped=true;return char}
    if(char==='"'){inString=!inString;return inString?'“':'”'}
    return char;
  }).join('');
};

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

test('fenced structural smart quotes recover and ambiguous content quotes fail closed',()=>{
  const recovered=Strict.parseStrictAiJson('```json\n{“x”:“正文“引用”结束”}\n```');
  assert.equal(recovered.ok,true);assert.deepEqual(recovered.repairs,[Strict.REPAIRS.MARKDOWN_FENCE,Strict.REPAIRS.STRUCTURAL_SMART_QUOTES]);assert.equal(recovered.value.x,'正文“引用”结束');
  const ambiguous=Strict.parseStrictAiJson('{“x”:“正文“引用未闭合”}');
  assert.equal(ambiguous.ok,false);assert.equal(ambiguous.reason,Strict.REASONS.AMBIGUOUS_SMART_QUOTES);assert.equal(ambiguous.userMessage,'检测到非标准 JSON 引号，自动修复失败');
});

test('only document-boundary BOM and zero-width artifacts are removed',()=>{
  const bom=Strict.parseStrictAiJson('\uFEFF{"x":1}');assert.equal(bom.ok,true);assert.deepEqual(bom.repairs,[Strict.REPAIRS.BOUNDARY_BOM]);
  const zeroWidth=Strict.parseStrictAiJson('\u200B {"x":1} \u2060');assert.equal(zeroWidth.ok,true);assert.deepEqual(zeroWidth.repairs,[Strict.REPAIRS.BOUNDARY_INVISIBLE]);
  const inside='{"x":"a\u200Bb","nbsp":"a\u00A0b"}',insideResult=Strict.parseStrictAiJson(inside);assert.equal(insideResult.ok,true);assert.equal(insideResult.normalizedText,inside);assert.equal(insideResult.value.x,'a\u200Bb');assert.equal(insideResult.value.nbsp,'a\u00A0b');
});

test('malformed and truncated JSON are classified without inventing syntax',()=>{
  const cases=[
    ['{"x":',Strict.REASONS.TRUNCATED],['{"x":"unterminated',Strict.REASONS.TRUNCATED],['{"x":[1,2',Strict.REASONS.TRUNCATED],
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
