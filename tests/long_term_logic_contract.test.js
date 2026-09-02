'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const Contract=require('../src/long-term-logic-contract.js');
const Workflow=require('../src/long-term-logic-workflow.js');

const promptDate='2026-09-02';
function stock(overrides={}){return {id:'stock-1',code:'601138.SS',symbol:'601138.SS',name:'工业富联',type:'holding',role:'成长仓',theme:'AI算力',shares:100,avgCost:40,plans:[{id:'plan-1'}],allocationDecision:{recommendedTargetWeight:12},financialData:{reportPeriod:'2026Q2'},valuationData:{pe:20},dataFreshness:{personalViewUpdatedAt:'2026-08-01'},longTermLogic:{updatedAt:'2026-06-01',validUntil:'2026-12-01',investmentThesis:'原有行业与公司逻辑支持组合中的成长角色。',coreDrivers:['原驱动'],industryDrivers:['原行业驱动'],companyDrivers:['原公司驱动'],portfolioDrivers:['原组合驱动'],fundamentalSupport:'原基本面资料提供辅助验证。',longTermRisks:['原长期风险'],logicStatus:'valid',confidence:'medium',nextReviewDate:'2026-09-01',sourceSummary:'原资料摘要。'},...overrides}}
function prepared(target=stock()){return Workflow.prepare(target,{promptDate})}
function logic(overrides={}){return {updatedAt:promptDate,validUntil:'2027-03-01',investmentThesis:'行业长期需求、公司交付护城河和组合成长角色共同支持继续跟踪。',coreDrivers:['行业长期需求','公司交付能力','组合成长角色'],industryDrivers:['行业未来多年仍有结构性需求'],companyDrivers:['公司交付与供应链能力形成护城河'],portfolioDrivers:['在组合中承担长期成长观察角色'],fundamentalSupport:'现有基本面资料对长期逻辑提供辅助验证。',longTermRisks:['行业需求不及预期','公司竞争优势减弱'],logicStatus:'valid',confidence:'medium',nextReviewDate:'2026-12-01',sourceSummary:'基于本次受保护上下文中的长期逻辑、基本面和估值资料。',...overrides}}
function envelope(context,overrides={}){return {binding:{symbol:context.symbol,contextHash:context.contextHash},longTermLogic:logic(),...overrides}}
function processed(target=stock()){const p=prepared(target);return {prepared:p,result:Contract.process(JSON.stringify(envelope(p.context)),{context:p.context})}}
function smartStructure(value){return JSON.stringify(value).replace(/"([^"\\]*(?:\\.[^"\\]*)*)"(?=\s*:)/g,'“$1”')}

test('Long-Term Prompt is single-source, bound, and uses the canonical current enums',()=>{
  const p=prepared();
  assert.equal(Workflow.buildPrompt(stock(),p.context),p.prompt);
  assert.match(p.prompt,/【受保护绑定】/);assert.match(p.prompt,new RegExp(p.context.contextHash));assert.match(p.prompt,/valid \/ weakening \/ broken \/ unclear/);
  assert.doesNotMatch(p.prompt,/weakened|insufficient_information|run_ai_task\.py/);
});

test('exact valid, fenced, and shared smart-quote transport produce the same canonical result',()=>{
  const p=prepared(),value=envelope(p.context),raws=[JSON.stringify(value),`\`\`\`json\n${JSON.stringify(value)}\n\`\`\``,smartStructure(value)];
  const results=raws.map(raw=>Contract.process(raw,{context:p.context}));
  results.forEach(result=>{assert.equal(result.ok,true,result.message);assert.equal(result.writes,0)});
  assert.deepEqual(results.map(result=>result.logic),[logic(),logic(),logic()]);
});

test('exact contract rejects unknown, missing, enum, type, date, and business-content violations with zero writes',async()=>{
  const p=prepared(),base=envelope(p.context),cases=[];
  cases.push({...base,unknown:true});
  const missing=structuredClone(base);delete missing.longTermLogic.sourceSummary;cases.push(missing);
  const badEnum=structuredClone(base);badEnum.longTermLogic.logicStatus='weakened';cases.push(badEnum);
  const wrongType=structuredClone(base);wrongType.longTermLogic.longTermRisks='none';cases.push(wrongType);
  const badDate=structuredClone(base);badDate.longTermLogic.validUntil='2026-02-30';cases.push(badDate);
  const dateOrder=structuredClone(base);dateOrder.longTermLogic.validUntil='2026-10-01';cases.push(dateOrder);
  const shortTerm=structuredClone(base);shortTerm.longTermLogic.longTermRisks=['跌破MA20'];cases.push(shortTerm);
  let writes=0;
  for(const value of cases){const result=Contract.process(JSON.stringify(value),{context:p.context});assert.equal(result.ok,false);assert.equal(result.writes,0);const committed=await Contract.commit(result,{stocks:[stock()]},{saveCandidate:async()=>{writes++}});assert.equal(committed.writes,0)}
  assert.equal(writes,0);
});

test('wrong stock, stale context, malformed JSON, and unsupported wrappers fail closed',()=>{
  const p=prepared(),value=envelope(p.context),wrong=structuredClone(value);wrong.binding.symbol='000001.SZ';
  for(const [raw,code] of [[JSON.stringify(wrong),'symbol_mismatch'],[JSON.stringify({...value,binding:{...value.binding,contextHash:'ltctx_deadbeef'}}),'context_mismatch'],['{"binding":','parse_error'],[`说明\n${JSON.stringify(value)}`,'parse_error']]){
    const result=Contract.process(raw,{context:p.context});assert.equal(result.ok,false);assert.equal(result.code,code);assert.equal(result.writes,0);
  }
});

test('successful candidate commits once, preserves protected domains, and creates current plus legacy history',async()=>{
  const target=stock(),state={stocks:[target],planReviews:{currentByPlan:{}},portfolioReview:{current:{id:'p'}},decisionCompression:{current:{id:'d'},history:[]},updatedAt:1},before=structuredClone({shares:target.shares,avgCost:target.avgCost,plans:target.plans,allocationDecision:target.allocationDecision,planReviews:state.planReviews,portfolioReview:state.portfolioReview,decisionCompression:state.decisionCompression});
  const {prepared:p,result}=processed(target);let writes=0,adopted=null;
  const committed=await Contract.commit(result,state,{saveCandidate:async(candidate,options)=>{writes++;assert.equal(options.critical,true);return candidate},adoptCandidate:candidate=>{adopted=candidate},render:()=>{}},{context:p.context,savedAt:'2026-09-02T10:00:00.000Z',transport:{kind:'manual'}});
  assert.equal(committed.status,'completed');assert.equal(committed.writes,1);assert.equal(writes,1);
  const next=adopted.stocks[0];assert.deepEqual(next.longTermLogic,logic());assert.equal(next.longTermLogicAudit.current.responseHash,Contract.responseHash(result));assert.equal(next.longTermLogicAudit.history.length,1);assert.match(next.longTermLogicAudit.history[0].responseHash,/^legacy_/);
  assert.deepEqual({shares:next.shares,avgCost:next.avgCost,plans:next.plans,allocationDecision:next.allocationDecision,planReviews:adopted.planReviews,portfolioReview:adopted.portfolioReview,decisionCompression:adopted.decisionCompression},before);
  assert.equal(Contract.validateStore(next.longTermLogicAudit,next.longTermLogic).ok,true);
});

test('failed save preserves the previous canonical state and audit store',async()=>{
  const target=stock(),state={stocks:[target],updatedAt:1},before=JSON.stringify(state),{prepared:p,result}=processed(target);let adopted=false,rolledBack=false;
  const committed=await Contract.commit(result,state,{saveCandidate:async()=>{throw new Error('injected save failure')},adoptCandidate:()=>{adopted=true},rollback:previous=>{rolledBack=previous===state}},{context:p.context});
  assert.equal(committed.status,'failed');assert.equal(committed.stage,'save');assert.equal(committed.writes,1);assert.equal(adopted,false);assert.equal(rolledBack,true);assert.equal(JSON.stringify(state),before);
});

test('subsequent save moves the former current snapshot into bounded history consistently',async()=>{
  const first=processed(),firstCandidate=Contract.buildCandidate({stocks:[stock()]},first.result,{context:first.prepared.context,savedAt:'2026-09-02T10:00:00.000Z'}).candidate;
  const nextStock=firstCandidate.stocks[0],secondPrepared=Workflow.prepare(nextStock,{promptDate:'2026-09-03'}),secondValue=envelope(secondPrepared.context);secondValue.longTermLogic={...logic(),updatedAt:'2026-09-03',nextReviewDate:'2026-12-02',validUntil:'2027-03-02',investmentThesis:'新的行业长期需求、公司护城河和组合角色判断已经形成。'};
  const secondResult=Contract.process(JSON.stringify(secondValue),{context:secondPrepared.context}),secondCandidate=Contract.buildCandidate(firstCandidate,secondResult,{context:secondPrepared.context,savedAt:'2026-09-03T10:00:00.000Z'}).candidate,store=secondCandidate.stocks[0].longTermLogicAudit;
  assert.equal(store.current.updatedAt,'2026-09-03');assert.equal(store.history.length,2);assert.equal(store.history.at(-1).updatedAt,'2026-09-02');assert.equal(Contract.validateStore(store,secondCandidate.stocks[0].longTermLogic).ok,true);
});

test('manual and API transports yield the same validation result, candidate, and canonical save',()=>{
  const target=stock(),p=prepared(target),raw=JSON.stringify(envelope(p.context)),manual=Workflow.processLongTermLogicResponse(raw,p.context),api=Workflow.processPrepared(raw,p);
  assert.deepEqual(manual.value,api.value);assert.deepEqual(manual.logic,api.logic);
  const options={context:p.context,savedAt:'2026-09-02T10:00:00.000Z'},manualCandidate=Contract.buildCandidate({stocks:[structuredClone(target)]},manual,{...options,transport:{kind:'manual'}}).candidate,apiCandidate=Contract.buildCandidate({stocks:[structuredClone(target)]},api,{...options,transport:{kind:'api',requestId:'r',provider:'mock',model:'m'}}).candidate;
  assert.deepEqual(manualCandidate,apiCandidate);assert.deepEqual(manualCandidate.stocks[0].longTermLogic,apiCandidate.stocks[0].longTermLogic);
});
