'use strict';

const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const test=require('node:test');
const Workbench=require('../src/discussion-workbench.js');
const Contract=require('../src/discussion-state-contract.js');

const root=path.join(__dirname,'..');
const day=index=>new Date(Date.UTC(2026,7,1+index)).toISOString().slice(0,10);
const bars=Array.from({length:30},(_,index)=>({date:day(index),close:50+index,adjustment:'qfq',price_basis:'adjusted',provider:'fixture',is_complete_bar:true}));
function stock(overrides={}){return {id:'fixture-stock',code:'601138.SS',name:'工业富联',type:'holding',role:'核心仓',shares:100,avgCost:42,currentPrice:79,priceHistory:bars,technicalData:{technicalDataStatus:'fresh',technicalAsOf:day(29)},technicalReview:{updatedAt:'2026-08-31T08:00:00Z',shortTermTechnical:{trendStatus:'recovery',cyclePosition:'high',technicalSummary:'中周期修复，短周期转弱。',confidence:'medium'}},plans:[],longTermLogic:{updatedAt:'2026-08-20T08:00:00Z',logicStatus:'valid',investmentThesis:'长期逻辑保持。'},...overrides}}
function decision(prepared,overrides={}){
  const base={symbol:prepared.context.symbol,sourceDiscussionVersion:prepared.sourceDiscussionVersion,actionAssessment:{category:'hold_watch',priority:'low',headline:'当前没有临近的仓位决策窗口，维持常规观察。',reasons:['趋势稳定且没有已确认的风险或机会结构。'],upgradeConditions:['关键结构确认后提高复核优先级。'],downgradeConditions:['当前结构判断被后续走势破坏。']},attentionLevel:'normal',trendAssessment:{overall:'sideways',timeframes:[{timeframe:'日线',status:'sideways',explanation:'方向稳定，尚未形成明确突破。'}]},structureAssessment:[],stage:'常规观察',focusPoints:['观察关键结构是否确认；确认后再提高复核级别。'],summary:'整体状态稳定，先前判断没有明显强化。关键结构仍待确认。',keyChanges:[],risks:[],watchPoints:['继续观察量价与关键位置的配合。'],planRelation:{status:'neutral',summary:'当前判断与计划没有需要立即处理的冲突；价格触发不等于完整条件满足。'},confidence:'medium'};
  return {currentState:{...base,...overrides,actionAssessment:{...base.actionAssessment,...(overrides.actionAssessment||{})},trendAssessment:{...base.trendAssessment,...(overrides.trendAssessment||{})},planRelation:{...base.planRelation,...(overrides.planRelation||{})}}};
}
function options(prepared,sourceStock,extra={}){return {expectedSymbol:prepared.context.symbol,sourceDiscussionVersion:prepared.sourceDiscussionVersion,holdingShares:sourceStock.shares,hasActivePlan:prepared.context.currentFacts.plans.length>0,technicalDataStatus:prepared.context.currentFacts.technical.dataStatus,programProvesFullPlanConditions:false,...extra}}
function process(sourceStock,overrides={},extra={}){const prepared=Workbench.buildDiscussionRequest(sourceStock),result=Contract.process(JSON.stringify(decision(prepared,overrides)),options(prepared,sourceStock,extra));return {prepared,result}}

test('new decision schema validates fixed enums and all list caps fail closed',()=>{
  const source=stock(),prepared=Workbench.buildDiscussionRequest(source),valid=Contract.process(JSON.stringify(decision(prepared)),options(prepared,source));
  assert.equal(valid.ok,true,valid.message);assert.equal(valid.writes,0);
  const cases=[
    {actionAssessment:{category:'buy_now'}},{actionAssessment:{priority:'urgent'}},{attentionLevel:'alarm'},
    {trendAssessment:{overall:'bullish'}},{trendAssessment:{timeframes:Array(4).fill({timeframe:'60分钟',status:'recovery',explanation:'修复。'})}},
    {structureAssessment:Array(4).fill({timeframe:'60分钟',type:'top',status:'forming',source:'ai_chart_judgment',sourceAsOf:'',shortReason:'形成中。'})},
    {focusPoints:Array(6).fill('观察条件与影响。')},{actionAssessment:{upgradeConditions:Array(4).fill('条件。')}},{actionAssessment:{downgradeConditions:Array(4).fill('条件。')}}
  ];
  cases.forEach(overrides=>{const result=Contract.process(JSON.stringify(decision(prepared,overrides)),options(prepared,source));assert.equal(result.ok,false);assert.equal(result.writes,0)});
});

test('structure type, lifecycle and provenance are fixed while multi-timeframe structures coexist',()=>{
  const source=stock(),prepared=Workbench.buildDiscussionRequest(source),structures=[
    {timeframe:'60分钟',type:'top',status:'confirmed',source:'external_software',sourceAsOf:'2026-09-01 10:30',shortReason:'交易师已提示顶部结构。'},
    {timeframe:'120分钟',type:'recovery',status:'valid',source:'ai_chart_judgment',sourceAsOf:'',shortReason:'中周期修复仍未被破坏。'},
    {timeframe:'日线',type:'none',status:'unclear',source:'program',sourceAsOf:'2026-08-31',shortReason:'程序事实未提供明确日线顶部结构。'}
  ],result=Contract.process(JSON.stringify(decision(prepared,{structureAssessment:structures})),options(prepared,source));
  assert.equal(result.ok,true,result.message);assert.deepEqual(result.currentState.structureAssessment,structures);
  for(const patch of [{type:'double_top'},{status:'active'},{source:'ai'}]){const broken=structures.map((item,index)=>index?item:{...item,...patch}),invalid=Contract.process(JSON.stringify(decision(prepared,{structureAssessment:broken})),options(prepared,source));assert.equal(invalid.ok,false);assert.equal(invalid.writes,0)}
});

test('scenario A normal observation remains low-priority and non-executable',()=>{
  const {result}=process(stock());assert.equal(result.ok,true);assert.equal(result.currentState.actionAssessment.category,'hold_watch');assert.equal(result.currentState.actionAssessment.priority,'low');assert.equal(result.currentState.attentionLevel,'normal');assert.doesNotMatch(result.currentState.actionAssessment.headline,/买入|卖出/);
});

test('scenario B approaching top window waits for confirmation at medium priority',()=>{
  const {result}=process(stock(),{actionAssessment:{category:'wait_confirmation',priority:'medium',headline:'短周期顶部结构接近确认，先等待确认再复核仓位风险。',reasons:['当前处于相对高位且短周期转弱。'],upgradeConditions:['60分钟顶部结构确认后升级为减仓复核。'],downgradeConditions:['重新站回关键压力并确认后降低警戒。']},attentionLevel:'focused',trendAssessment:{overall:'recovery',timeframes:[{timeframe:'日线',status:'uptrend',explanation:'日线仍偏强。'},{timeframe:'60分钟',status:'downtrend',explanation:'短周期转弱。'}]},structureAssessment:[{timeframe:'60分钟',type:'top',status:'forming',source:'ai_chart_judgment',sourceAsOf:'',shortReason:'顶部结构形成中，尚未确认。'}]});
  assert.equal(result.ok,true,result.message);assert.equal(result.currentState.actionAssessment.category,'wait_confirmation');assert.equal(result.currentState.actionAssessment.priority,'medium');assert.equal(result.currentState.structureAssessment[0].status,'forming');
});

test('scenarios C and D confirmed multi-timeframe top risk support high-priority reduce review only',()=>{
  const {result}=process(stock(),{actionAssessment:{category:'reduce_review',priority:'high',headline:'短周期顶部结构已确认，当前应优先复核已有仓位风险。',reasons:['60分钟顶部结构已确认。','90分钟结构同步形成且支撑转弱。'],upgradeConditions:['关键支撑放量失守后升级风险控制复核。'],downgradeConditions:['顶部结构被突破破坏后降低警戒。']},attentionLevel:'window',structureAssessment:[{timeframe:'60分钟',type:'top',status:'confirmed',source:'external_software',sourceAsOf:'2026-09-01',shortReason:'交易师已提示顶部结构。'},{timeframe:'90分钟',type:'top',status:'forming',source:'ai_chart_judgment',sourceAsOf:'',shortReason:'更大周期风险正在形成。'}]});
  assert.equal(result.ok,true,result.message);assert.equal(result.currentState.actionAssessment.category,'reduce_review');assert.equal(result.currentState.actionAssessment.priority,'high');assert.doesNotMatch(JSON.stringify(result.currentState),/立即卖出|减仓至/);
});

test('scenario E broken top structure downgrades prior reduce urgency',()=>{
  const {result}=process(stock(),{actionAssessment:{category:'hold_watch',priority:'low',headline:'此前顶部结构已被破坏，减仓复核紧迫性下降。',reasons:['价格重新站回关键压力并确认。'],upgradeConditions:['顶部风险重新形成并确认。'],downgradeConditions:['趋势继续恢复后回归常规观察。']},attentionLevel:'normal',structureAssessment:[{timeframe:'60分钟',type:'top',status:'broken',source:'external_software',sourceAsOf:'2026-09-01',shortReason:'原顶部结构已被突破破坏。'}]});
  assert.equal(result.ok,true,result.message);assert.equal(result.currentState.structureAssessment[0].status,'broken');assert.equal(result.currentState.actionAssessment.priority,'low');
});

test('scenario F forming bottom waits for confirmation',()=>{
  const {result}=process(stock(),{actionAssessment:{category:'wait_confirmation',priority:'medium',headline:'60分钟底部结构形成中，等待趋势同步修复。',reasons:['底部结构尚未确认。'],upgradeConditions:['底部结构确认且趋势修复后升级加仓复核。'],downgradeConditions:['底部结构形成失败后回到常规观察。']},attentionLevel:'focused',structureAssessment:[{timeframe:'60分钟',type:'bottom',status:'forming',source:'ai_chart_judgment',sourceAsOf:'',shortReason:'底部结构形成中。'}]});assert.equal(result.ok,true,result.message);assert.equal(result.currentState.actionAssessment.category,'wait_confirmation');
});

test('scenario G confirmed bottom uses add review for held and entry review for zero position',()=>{
  const held=process(stock(),{actionAssessment:{category:'add_review',priority:'high',headline:'底部结构确认且趋势修复，进入加仓复核窗口。',reasons:['60分钟底部结构已确认。'],upgradeConditions:['趋势继续恢复后复核完整计划条件。'],downgradeConditions:['底部结构破坏后取消机会复核。']},attentionLevel:'window',structureAssessment:[{timeframe:'60分钟',type:'bottom',status:'confirmed',source:'external_software',sourceAsOf:'2026-09-01',shortReason:'底部结构已确认。'}]});assert.equal(held.result.ok,true,held.result.message);
  const zeroStock=stock({type:'candidate',shares:0,avgCost:0}),zero=process(zeroStock,{actionAssessment:{category:'entry_review',priority:'high',headline:'底部结构确认且趋势修复，进入建仓复核窗口。',reasons:['60分钟底部结构已确认。'],upgradeConditions:['趋势延续后复核完整建仓条件。'],downgradeConditions:['底部结构破坏后取消机会复核。']},attentionLevel:'window',structureAssessment:[{timeframe:'60分钟',type:'bottom',status:'confirmed',source:'external_software',sourceAsOf:'2026-09-01',shortReason:'底部结构已确认。'}],planRelation:{status:'no_matching_plan',summary:'当前没有对应的有效建仓计划，需要单独复核，不自动创建计划。'}});assert.equal(zero.result.ok,true,zero.result.message);
  const contradiction=process(zeroStock,{actionAssessment:{category:'hold_watch'}});assert.equal(contradiction.result.ok,false);assert.equal(contradiction.result.writes,0);
});

test('scenario H stale evidence forces conditional confidence below high',()=>{
  const source=stock({technicalData:{technicalDataStatus:'stale'}}),high=process(source,{confidence:'high'}),medium=process(source,{confidence:'medium',summary:'资料时效不足，当前只作条件性观察。'});assert.equal(high.result.ok,false);assert.equal(high.result.writes,0);assert.equal(medium.result.ok,true,medium.result.message);
});

test('scenarios I and J classify Plan conflict and absence without creating or mutating Plan',()=>{
  const plan={schemaVersion:'plan.v2',id:'p-add',planVersion:1,action:'add',triggerPrice:78,status:'active',validityStatus:'active',fullConditionStatus:'unproven',source:'manual'},withPlan=stock({plans:[plan]}),conflict=process(withPlan,{actionAssessment:{category:'reduce_review',priority:'high',headline:'当前风险状态弱于原加仓计划环境，应优先复核计划。',reasons:['顶部风险与加仓方向冲突。'],upgradeConditions:['支撑失守后升级风险控制复核。'],downgradeConditions:['风险结构破坏后降低警戒。']},attentionLevel:'window',planRelation:{status:'conflict',summary:'当前技术状态弱于原计划环境，不能仅凭价格触发执行加仓计划。'}});assert.equal(conflict.result.ok,true,conflict.result.message);
  const noPlanStock=stock({plans:[]}),absent=process(noPlanStock,{actionAssessment:{category:'reduce_review',priority:'high',headline:'当前需要优先复核仓位风险。',reasons:['顶部风险已确认。'],upgradeConditions:['支撑失守后升级风险控制复核。'],downgradeConditions:['风险结构破坏后降低警戒。']},attentionLevel:'window',planRelation:{status:'no_matching_plan',summary:'当前没有对应的有效减仓计划，需要单独确认风险处理方式，不自动创建计划。'}});assert.equal(absent.result.ok,true,absent.result.message);
  const invalid=process(noPlanStock,{planRelation:{status:'aligned'}});assert.equal(invalid.result.ok,false);assert.equal(invalid.result.writes,0);assert.deepEqual(withPlan.plans,[plan]);assert.deepEqual(noPlanStock.plans,[]);
});

test('price trigger never proves full Plan conditions and deterministic order wording is rejected',()=>{
  const source=stock(),prepared=Workbench.buildDiscussionRequest(source);
  for(const overrides of [{planRelation:{summary:'当前计划完整条件已经满足。'}},{actionAssessment:{headline:'今天必须卖出并减仓至30%。'}}]){const result=Contract.process(JSON.stringify(decision(prepared,overrides)),options(prepared,source));assert.equal(result.ok,false);assert.equal(result.writes,0)}
});

test('full-condition semantic guard allows local negation but rejects every affirmative claim',()=>{
  const source=stock(),prepared=Workbench.buildDiscussionRequest(source),allowed=[
    '价格进入计划区域不等于完整条件已经满足。',
    '价格触发不代表完整条件已经满足。',
    '尚不能确认完整条件已经满足。',
    '目前未确认完整条件已满足。',
    '并非完整计划条件已经满足。',
    '无法确认完整执行条件已满足。'
  ],rejected=[
    '完整条件已经满足，可以执行。',
    '价格条件已触发，完整条件已满足。',
    '计划条件已经满足。',
    '价格触发不等于完整条件满足；目前完整条件已经满足。',
    '价格触发不代表完整条件已经满足；但目前完整计划条件已满足。'
  ];
  for(const summary of allowed){const result=Contract.process(JSON.stringify(decision(prepared,{summary})),options(prepared,source));assert.equal(result.ok,true,`${summary} ${result.message}`);assert.equal(result.writes,0)}
  for(const summary of rejected){const result=Contract.process(JSON.stringify(decision(prepared,{summary})),options(prepared,source));assert.equal(result.ok,false,summary);assert.equal(result.code,'validation_error');assert.match(result.message,/价格触发不能被表述为完整计划条件已满足/);assert.equal(result.writes,0)}
});

test('legacy v1 state and history remain readable without fabricated decision fields',()=>{
  const source=stock(),prepared=Workbench.buildDiscussionRequest(source),result=Contract.process(JSON.stringify(decision(prepared)),options(prepared,source)),built=Contract.buildCandidate({stocks:[source]},result,{prepared,now:'2026-09-01T08:00:00Z'}),saved=built.currentState;
  const legacy={...saved,schemaVersion:Workbench.LEGACY_STATE_SCHEMA_VERSION,planRelation:'保持观察。'};for(const key of ['actionAssessment','attentionLevel','trendAssessment','structureAssessment','focusPoints'])delete legacy[key];
  const store=Workbench.normalizeStore({schemaVersion:Workbench.STORE_SCHEMA_VERSION,current:legacy,history:[legacy,saved]});assert.equal(store.current.schemaVersion,Workbench.LEGACY_STATE_SCHEMA_VERSION);assert.equal('actionAssessment' in store.current,false);assert.equal(store.history.length,2);assert.equal(Workbench.validateStore(store).ok,true);
});

test('next Discussion context carries the compact decision layer and asks lifecycle upgrade questions',()=>{
  const source=stock(),prepared=Workbench.buildDiscussionRequest(source),result=Contract.process(JSON.stringify(decision(prepared)),options(prepared,source)),built=Contract.buildCandidate({stocks:[source]},result,{prepared,now:'2026-09-01T08:00:00Z'}),next=Workbench.buildDiscussionRequest(built.candidate.stocks[0]);
  for(const key of ['actionAssessment','attentionLevel','trendAssessment','structureAssessment','focusPoints','planRelation'])assert.ok(Object.prototype.hasOwnProperty.call(next.context.currentState,key),key);
  assert.match(next.request,/结构是确认、仍有效还是已破坏/);assert.match(next.request,/关注级别应升级还是降级/);assert.doesNotMatch(next.request,/stateId|reviewHash|snapshotHash/);assert.equal('technicalSnapshot' in next.context.currentState,false);
});

test('candidate save mutates only cloned discussion state and preserves all protected domains',()=>{
  const source=stock({plans:[{schemaVersion:'plan.v2',id:'p1',planVersion:1,action:'add',status:'active',validityStatus:'active',source:'manual'}],allocationDecision:{recommendedTargetWeight:20}}),rootState={stocks:[source],planReviews:{currentByPlan:{}},allocation:{cash:10}},before=JSON.parse(JSON.stringify(rootState)),prepared=Workbench.buildDiscussionRequest(source,{state:rootState,planReviewStore:rootState.planReviews}),result=Contract.process(JSON.stringify(decision(prepared,{planRelation:{status:'aligned',summary:'当前方向与计划一致，但仍需复核完整条件。'}})),options(prepared,source)),built=Contract.buildCandidate(rootState,result,{prepared,now:'2026-09-01T08:00:00Z'});
  assert.deepEqual(rootState,before);const after=built.candidate;assert.deepEqual(after.planReviews,before.planReviews);assert.deepEqual(after.allocation,before.allocation);for(const key of ['plans','shares','avgCost','technicalData','technicalReview','allocationDecision','longTermLogic'])assert.deepEqual(after.stocks[0][key],before.stocks[0][key],key);assert.ok(after.stocks[0].discussionState.current);
});

test('import preview and Current State UI put decision, urgency, trend, structure and focus before details',()=>{
  const source=stock(),{prepared,result}=process(source,{structureAssessment:[{timeframe:'60分钟',type:'top',status:'forming',source:'ai_chart_judgment',sourceAsOf:'',shortReason:'顶部结构形成中。'}]}),preview=Contract.renderPreview(result,{technicalAsOf:prepared.technicalSnapshot.anchorBar.date,confirmedDate:'2026-09-01'}),ui=fs.readFileSync(path.join(root,'src','ui-render.js'),'utf8'),html=fs.readFileSync(path.join(root,'index.html'),'utf8');
  for(const label of ['当前关注','操作倾向','趋势','结构','当前重点','与计划关系'])assert.match(preview,new RegExp(label));assert.ok(preview.indexOf('操作倾向')<preview.indexOf('核心结论'));
  const card=ui.slice(ui.indexOf('function discussionStateCard'),ui.indexOf('function discussionHistoryPanel'));for(const label of ['操作倾向','趋势','结构','当前重点','与计划关系','查看完整结论'])assert.match(card,new RegExp(label));assert.ok(card.indexOf('操作倾向')<card.indexOf('查看完整结论'));assert.match(html,/discussion-decision-card/);assert.match(html,/max-width:100%;overflow-wrap:anywhere/);
});

test('normal UI mappings contain Chinese labels and prose rejects internal English leakage',()=>{
  const ui=fs.readFileSync(path.join(root,'src','ui-render.js'),'utf8'),source=stock(),prepared=Workbench.buildDiscussionRequest(source);for(const label of ['风险控制','减仓复核','持有观察','等待确认','加仓复核','建仓复核','暂不操作','普通观察','重点观察','临近窗口'])assert.match(ui,new RegExp(label));
  const leaked=Contract.process(JSON.stringify(decision(prepared,{summary:'当前 actionAssessment 显示 recovery。'})),options(prepared,source));assert.equal(leaked.ok,false);assert.equal(leaked.writes,0);
});
