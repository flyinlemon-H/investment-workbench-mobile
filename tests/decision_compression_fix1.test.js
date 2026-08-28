'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const PortfolioContext=require('../src/portfolio-review-context.js');
const DecisionContext=require('../src/decision-compression-context.js');
const Contract=require('../src/decision-compression-contract.js');

const reviewDate='2026-08-28';
const ui=fs.readFileSync(path.join(__dirname,'../src/portfolio-review-ui.js'),'utf8');

function mockContext(entries){
  const symbols=entries.map((_,index)=>`600${String(index+1).padStart(3,'0')}.SS`);
  return {
    schemaVersion:DecisionContext.SCHEMA_VERSION,
    reviewDate,
    portfolio:{selectedSymbols:symbols},
    stocks:entries.map((entry,index)=>{
      const facts=entry.facts||[],eligible=Object.fromEntries(Contract.BLOCKERS.map(code=>[code,facts.includes(code)]));
      return {symbol:symbols[index],eligibleBlockers:eligible,blockerFacts:DecisionContext.BLOCKER_PRECEDENCE.filter(code=>facts.includes(code)),allowedPlanStates:[entry.planState||'no_current_plan'],highAttentionEligible:Boolean(entry.high),technical:{todayUse:entry.technical||'current'},plans:entry.plans||[]};
    })
  };
}

function item(symbol,index=0,overrides={}){return {symbol,priority:'medium',actionCategory:'watch',reason:`第${index+1}只股票保持观察并等待进一步确认。`,blockerPriority:[],planState:'no_current_plan',confidence:'medium',...overrides}}
function envelope(context,items,noActionSymbols){return {decisionCompression:{reviewDate,overallSummary:'今天优先处理关键事实，其余股票保持观察。',items,noActionSymbols,confidence:'medium',limitations:['当前没有权威市场环境判断。']}}}

test('saved and compression UI always expose program-owned scope and immediate adjustment',()=>{
  for(const phrase of ['本次复核范围：${symbols.length}只','查看全部股票与代码','调整股票','未纳入本次复核的股票未参与本次分析','最多5项详细处理','已选但暂不处理 · ${noAction.length}只'])assert.match(ui,new RegExp(phrase.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')));
  assert.match(ui,/function enterAdjustment\(\).*availableSnapshotSymbols\(currentSnapshot\(\)\)/);
  assert.match(ui,/initial=snapshot\?availableSnapshotSymbols\(snapshot\):root\.MultiStockAnalysis\.initialSelection/);
});

test('Portfolio Review keeps exact 1-12 selection support and local calendar dates',()=>{
  const fixture=JSON.parse(fs.readFileSync(path.join(__dirname,'fixtures/m05c-mixed-portfolio.json'),'utf8'));
  assert.equal(PortfolioContext.buildPortfolioContext(fixture.stocks.slice(0,1),{reviewDate}).stocks.length,1);
  assert.equal(PortfolioContext.buildPortfolioContext(fixture.stocks.slice(0,12),{reviewDate}).stocks.length,12);
  assert.throws(()=>PortfolioContext.buildPortfolioContext([],{reviewDate}),/至少选择一只/);
  assert.throws(()=>PortfolioContext.buildPortfolioContext(fixture.stocks.concat({...fixture.stocks[0],id:'thirteen',code:'999999.SS'}),{reviewDate}),/最多选择 12/);
  assert.equal(PortfolioContext.localCalendarDate('2026-08-27T23:30:00.000Z',{timeZone:'Asia/Shanghai'}),'2026-08-28');
  assert.equal(PortfolioContext.buildPortfolioContext(fixture.stocks.slice(0,1),{now:'2026-08-27T23:30:00.000Z',timeZone:'Asia/Shanghai'}).reviewDate,'2026-08-28');
});

test('12 selected symbols support five detailed plus seven explicitly compressed with exact coverage',()=>{
  const context=mockContext(Array.from({length:12},()=>({facts:['insufficient_market_context']}))),symbols=context.portfolio.selectedSymbols,decision=envelope(context,symbols.slice(0,5).map((symbol,index)=>item(symbol,index)),symbols.slice(5)),result=Contract.validate(decision,{context});
  assert.equal(result.ok,true,result.message);assert.equal(result.decision.items.length,5);assert.equal(result.decision.noActionSymbols.length,7);assert.deepEqual(new Set([...result.decision.items.map(value=>value.symbol),...result.decision.noActionSymbols]),new Set(symbols));
});

test('more than five high-attention stocks fail before an AI request is generated',()=>{
  const fixture=JSON.parse(fs.readFileSync(path.join(__dirname,'fixtures/m05c-mixed-portfolio.json'),'utf8')),stocks=fixture.stocks.slice(0,6),symbols=stocks.map(stock=>stock.code),base=PortfolioContext.buildPortfolioContext(stocks,{allStocks:fixture.stocks,reviewDate,generatedAt:fixture.generatedAt}),review={reviewDate,summary:'六只股票都有高关注事实，需要先缩小详细复核范围。',marketContext:'未提供。',portfolioRiskLevel:'high',priorityStocks:symbols.map(symbol=>({symbol,priority:'high',reason:'存在需要优先人工复核的结构化事实。',focus:'确认事实。',planRelation:'只作复核。'})),riskAttention:[],planWatch:[],candidateReview:[],portfolioRisks:[],todayFocus:['缩小范围。'],dataLimitations:[],confidence:'medium'},snapshot={reviewDate,generatedAt:fixture.generatedAt,savedAt:fixture.generatedAt,selectedSymbols:symbols,planReferences:base.planReferences,review};
  assert.throws(()=>DecisionContext.buildRequest(snapshot,fixture.stocks,{allStocks:fixture.stocks,reviewDate,generatedAt:fixture.generatedAt}),/6 只股票具备高关注事实.*超过 5 项详细处理上限/);
});

test('program retains all blocker facts while AI ranking controls emphasis only',()=>{
  const cases=[
    {facts:['plan_needs_review','full_conditions_unproven','missing_news'],priority:['plan_needs_review','missing_news'],display:['full_conditions_unproven','plan_needs_review']},
    {facts:['allocation_conflict','full_conditions_unproven','stale_plan_review'],priority:['stale_plan_review'],display:['full_conditions_unproven','allocation_conflict']},
    {facts:['stale_technical_data','missing_news','insufficient_market_context'],priority:['missing_news','insufficient_market_context'],display:['missing_news','insufficient_market_context']}
  ];
  for(const entry of cases){
    const context=mockContext([{facts:entry.facts,high:true}]),symbol=context.portfolio.selectedSymbols[0],decision=envelope(context,[item(symbol,0,{priority:'high',actionCategory:'review_now',blockerPriority:entry.priority})],[]),result=Contract.validate(decision,{context});
    assert.equal(result.ok,true,result.message);assert.deepEqual(new Set(result.decision.items[0].blockerFacts),new Set(entry.facts));assert.deepEqual(Contract.displayBlockers(result.decision.items[0]),entry.display);assert.equal(Contract.displayBlockers(result.decision.items[0]).length,2);
  }
});

test('AI cannot invent blocker facts and omission cannot delete them',()=>{
  const context=mockContext([{facts:['full_conditions_unproven','missing_news'],high:true}]),symbol=context.portfolio.selectedSymbols[0],invented=envelope(context,[item(symbol,0,{priority:'high',actionCategory:'review_now',blockerPriority:['allocation_conflict']})],[]),omitted=envelope(context,[item(symbol,0,{priority:'high',actionCategory:'review_now',blockerPriority:[]})],[]);
  assert.equal(Contract.validate(invented,{context}).code,'unsupported_blocker');const result=Contract.validate(omitted,{context});assert.equal(result.ok,true);assert.deepEqual(result.decision.items[0].blockerFacts,['full_conditions_unproven','missing_news']);
});

test('legacy AI blockers are accepted as emphasis without owning final blocker truth',()=>{
  const context=mockContext([{facts:['plan_needs_review','full_conditions_unproven','missing_news'],high:true}]),symbol=context.portfolio.selectedSymbols[0],legacy=envelope(context,[{symbol,priority:'high',actionCategory:'review_now',reason:'计划与资料仍需复核。',blockers:['plan_needs_review','missing_news'],planState:'no_current_plan',confidence:'medium'}],[]),result=Contract.validate(legacy,{context});
  assert.equal(result.ok,true,result.message);assert.deepEqual(result.decision.items[0].blockerPriority,['plan_needs_review','missing_news']);assert.deepEqual(result.decision.items[0].blockerFacts,['full_conditions_unproven','plan_needs_review','missing_news']);
});

test('603296 real-trial legacy response imports and preserves the unproven-condition fact',()=>{
  const fixture=JSON.parse(fs.readFileSync(path.join(__dirname,'fixtures/m05c-real-trial-2026-08-18.json'),'utf8')),stock=fixture.stocks.find(value=>value.code==='603296.SS'),base=PortfolioContext.buildPortfolioContext([stock],{allStocks:fixture.stocks,reviewDate:'2026-08-18',generatedAt:fixture.generatedAt}),review={reviewDate:'2026-08-18',summary:'今天先复核计划条件。',marketContext:'未提供。',portfolioRiskLevel:'moderate',priorityStocks:[{symbol:stock.code,priority:'high',reason:'计划条件需要复核。',focus:'确认完整条件。',planRelation:'价格已触发。'}],riskAttention:[{symbol:stock.code,reason:'缺少最新新闻。'}],planWatch:[{symbol:stock.code,status:'triggered',reason:'价格已触发，仍需确认其他条件。'}],candidateReview:[],portfolioRisks:[],todayFocus:['确认计划条件。'],dataLimitations:['缺少最新新闻。'],confidence:'low'},snapshot={reviewDate:review.reviewDate,generatedAt:fixture.generatedAt,savedAt:fixture.generatedAt,selectedSymbols:[stock.code],planReferences:base.planReferences,review},context=DecisionContext.buildDecisionContext(snapshot,fixture.stocks,{allStocks:fixture.stocks,reviewDate:review.reviewDate,generatedAt:fixture.generatedAt}),legacy={decisionCompression:{reviewDate:review.reviewDate,overallSummary:'今天先复核计划有效性与资料缺口。',items:[{symbol:stock.code,priority:'high',actionCategory:'review_now',reason:'历史计划价格已触发且缺少最新新闻，先人工复核。',blockers:['plan_needs_review','missing_news'],planState:'historical_only',confidence:'medium'}],noActionSymbols:[],confidence:'medium',limitations:['当前没有权威市场环境判断。']}},result=Contract.process(JSON.stringify(legacy),{context});
  assert.equal(result.ok,true,result.message);assert.ok(result.decision.items[0].blockerFacts.includes('full_conditions_unproven'));assert.deepEqual(Contract.displayBlockers(result.decision.items[0]),['full_conditions_unproven','plan_needs_review']);assert.equal(result.writes,0);
});

test('scope wording is program-owned and no longer assigned to AI limitations',()=>{
  const fixture=JSON.parse(fs.readFileSync(path.join(__dirname,'fixtures/m05c-mixed-portfolio.json'),'utf8')),request=PortfolioContext.buildRequest(fixture.stocks.slice(0,3),{allStocks:fixture.stocks,reviewDate:fixture.reviewDate,generatedAt:fixture.generatedAt});
  assert.doesNotMatch(request,/本次只覆盖所选股票/);assert.match(request,/范围.*由程序显示/);assert.doesNotMatch(JSON.stringify(PortfolioContext.buildPortfolioContext(fixture.stocks.slice(0,3),{reviewDate:fixture.reviewDate}).coordinationLimitations),/覆盖所选股票/);
});

test('historical review remains visible but current-day compression controls are gated in UI',()=>{
  for(const phrase of ['当前组合复核基于','历史复核仍可查看，但不能生成今天的处理清单','重新生成组合复核','组合复核 · ${shortDate(review.reviewDate)}','if(!isCurrentReview(snapshot))'])assert.match(ui,new RegExp(phrase.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')));
});

test('malformed and truncated revised responses remain zero-write failures',()=>{
  const context=mockContext([{facts:[]}]);for(const raw of ['not json','{"decisionCompression":']){const result=Contract.process(raw,{context});assert.equal(result.ok,false);assert.equal(result.writes,0);assert.equal(result.previewReady,false)}
});

test('legacy saved Decision Compression remains hash and display compatible',()=>{
  const fixture=JSON.parse(fs.readFileSync(path.join(__dirname,'fixtures/m05c-real-trial-2026-08-18.json'),'utf8')),stock=fixture.stocks[0],base=PortfolioContext.buildPortfolioContext([stock],{allStocks:fixture.stocks,reviewDate:'2026-08-18',generatedAt:fixture.generatedAt}),review={reviewDate:'2026-08-18',summary:'历史组合复核。',marketContext:'未提供。',portfolioRiskLevel:'moderate',priorityStocks:[],riskAttention:[],planWatch:[],candidateReview:[],portfolioRisks:[],todayFocus:[],dataLimitations:[],confidence:'medium'},snapshot={reviewDate:'2026-08-18',generatedAt:fixture.generatedAt,savedAt:fixture.generatedAt,selectedSymbols:[stock.code],planReferences:base.planReferences,review},context=DecisionContext.buildDecisionContext(snapshot,fixture.stocks,{allStocks:fixture.stocks,reviewDate:'2026-08-18',generatedAt:fixture.generatedAt}),legacyContext=JSON.parse(JSON.stringify(context));
  legacyContext.stocks.forEach(value=>delete value.blockerFacts);
  assert.equal(Contract.auditHash(legacyContext),Contract.auditHash(context));
  assert.deepEqual(Contract.displayBlockers({blockers:['missing_news','plan_needs_review']}),['plan_needs_review','missing_news']);
});
