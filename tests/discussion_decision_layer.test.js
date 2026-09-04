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
  const base={symbol:prepared.context.symbol,sourceDiscussionVersion:prepared.sourceDiscussionVersion,userDecision:{headline:'可以继续持有，暂时没有明显减仓风险。',holding:{status:'safe',summary:'当前持有判断仍然稳定。'},positionDirection:{status:'hold_no_add',summary:'持有为主，暂不增加仓位。'},addAssessment:{status:'wait',summary:'等待更合适的机会，不追当前位置。'},warning:{summary:'若关键风险明显增强，需要重新复核当前判断。',items:[]},takeProfit:{status:'none',summary:'暂时没有明显止盈压力。'},stopLoss:{status:'none',summary:'关键支撑仍有效，暂时没有明显止损风险。'},riskSource:'none'},actionAssessment:{category:'hold_watch',priority:'low',headline:'当前没有临近的仓位决策窗口，维持常规观察。',reasons:['趋势稳定且没有已确认的风险或机会结构。'],upgradeConditions:['关键结构确认后提高复核优先级。'],downgradeConditions:['当前结构判断被后续走势破坏。']},attentionLevel:'normal',trendAssessment:{overall:'sideways',timeframes:[{timeframe:'日线',status:'sideways',explanation:'方向稳定，尚未形成明确突破。'}]},structureAssessment:[],stage:'常规观察',focusPoints:['观察关键结构是否确认；确认后再提高复核级别。'],summary:'整体状态稳定，先前判断没有明显强化。关键结构仍待确认。',keyChanges:[],risks:[],watchPoints:['继续观察量价与关键位置的配合。'],planRelation:{status:'neutral',summary:'当前判断与计划没有需要立即处理的冲突；价格触发不等于完整条件满足。'},confidence:'medium'};
  return {currentState:{...base,...overrides,userDecision:{...base.userDecision,...(overrides.userDecision||{})},actionAssessment:{...base.actionAssessment,...(overrides.actionAssessment||{})},trendAssessment:{...base.trendAssessment,...(overrides.trendAssessment||{})},planRelation:{...base.planRelation,...(overrides.planRelation||{})}}};
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
  const zeroStock=stock({type:'candidate',shares:0,avgCost:0}),zeroDecision={headline:'已经进入值得关注的建仓区域。',holding:{status:'not_applicable',summary:'当前没有持仓。'},positionDirection:{status:'add_review',summary:'保持观察，可以进入建仓复核。'},addAssessment:{status:'add_review',summary:'条件已经成熟，可以复核建仓机会。'},warning:{summary:'若重新走弱，应继续等待。',items:[]},takeProfit:{status:'not_applicable',summary:'当前无持仓，不适用。'},stopLoss:{status:'not_applicable',summary:'尚未持有，不适用。'},riskSource:'none'},zero=process(zeroStock,{userDecision:zeroDecision,actionAssessment:{category:'entry_review',priority:'high',headline:'底部结构确认且趋势修复，进入建仓复核窗口。',reasons:['60分钟底部结构已确认。'],upgradeConditions:['趋势延续后复核完整建仓条件。'],downgradeConditions:['底部结构破坏后取消机会复核。']},attentionLevel:'window',structureAssessment:[{timeframe:'60分钟',type:'bottom',status:'confirmed',source:'external_software',sourceAsOf:'2026-09-01',shortReason:'底部结构已确认。'}],planRelation:{status:'no_matching_plan',summary:'当前没有对应的有效建仓计划，需要单独复核，不自动创建计划。'}});assert.equal(zero.result.ok,true,zero.result.message);
  const contradiction=process(zeroStock,{actionAssessment:{category:'hold_watch'}});assert.equal(contradiction.result.ok,false);assert.equal(contradiction.result.writes,0);
});

test('technical freshness and confidence remain authoritative across fresh, stale, unavailable and anomaly states',()=>{
  const freshHigh=process(stock(),{confidence:'high'});assert.equal(freshHigh.result.ok,true,freshHigh.result.message);
  const staleSource=stock({technicalData:{technicalDataStatus:'stale'}}),staleHigh=process(staleSource,{confidence:'high'}),staleMedium=process(staleSource,{confidence:'medium',summary:'资料时效不足，当前只作条件性观察。'});assert.equal(staleHigh.result.ok,false);assert.equal(staleHigh.result.writes,0);assert.match(staleHigh.result.message,/技术资料未标记为较新时 confidence 不能为 high/);assert.doesNotMatch(staleHigh.result.message,/JSON 格式/);assert.equal(staleMedium.result.ok,true,staleMedium.result.message);
  for(const technicalDataStatus of ['unavailable','anomaly']){const high=process(stock({technicalData:{technicalDataStatus}}),{confidence:'high'});assert.equal(high.result.ok,false);assert.equal(high.result.writes,0);assert.match(high.result.message,/技术资料未标记为较新时 confidence 不能为 high/)}
});

test('production Current State fixture separates parser success from freshness and source-version diagnostics',()=>{
  const raw=fs.readFileSync(path.join(root,'tests','fixtures','production-current-state-risk-window.json.txt'),'utf8'),base={expectedSymbol:'2899.HK',sourceDiscussionVersion:'discussion_v2_fa77d62f',holdingShares:2000,hasActivePlan:true,technicalDataStatus:'fresh',programProvesFullPlanConditions:false},fresh=Contract.process(raw,base);
  assert.equal(fresh.ok,true,fresh.message);assert.equal(fresh.code,'valid');assert.equal(fresh.currentState.sourceDiscussionVersion,'discussion_v2_fa77d62f');assert.equal(fresh.currentState.actionAssessment.category,'risk_control');
  const stale=Contract.process(raw,{...base,technicalDataStatus:'stale'});assert.equal(stale.ok,false);assert.equal(stale.code,'validation_error');assert.match(stale.message,/技术资料未标记为较新时 confidence 不能为 high/);assert.doesNotMatch(stale.message,/JSON 格式/);
  const oldSource=Contract.process(raw,{...base,sourceDiscussionVersion:'discussion_v2_newer'});assert.equal(oldSource.ok,false);assert.equal(oldSource.code,'validation_error');assert.match(oldSource.message,/结论来源版本已过期或不一致/);assert.doesNotMatch(oldSource.message,/JSON 格式/);
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
  const legacy={...saved,schemaVersion:Workbench.LEGACY_STATE_SCHEMA_VERSION,planRelation:'保持观察。'};for(const key of ['userDecision','actionAssessment','attentionLevel','trendAssessment','structureAssessment','focusPoints'])delete legacy[key];
  const store=Workbench.normalizeStore({schemaVersion:Workbench.STORE_SCHEMA_VERSION,current:legacy,history:[legacy,saved]});assert.equal(store.current.schemaVersion,Workbench.LEGACY_STATE_SCHEMA_VERSION);assert.equal('actionAssessment' in store.current,false);assert.equal(store.history.length,2);assert.equal(Workbench.validateStore(store).ok,true);
});

test('next Discussion context carries the compact decision layer and asks lifecycle upgrade questions',()=>{
  const source=stock(),prepared=Workbench.buildDiscussionRequest(source),result=Contract.process(JSON.stringify(decision(prepared)),options(prepared,source)),built=Contract.buildCandidate({stocks:[source]},result,{prepared,now:'2026-09-01T08:00:00Z'}),next=Workbench.buildDiscussionRequest(built.candidate.stocks[0]);
  for(const key of ['userDecision','actionAssessment','attentionLevel','trendAssessment','structureAssessment','focusPoints','planRelation'])assert.ok(Object.prototype.hasOwnProperty.call(next.context.currentState,key),key);
  assert.match(next.request,/能否继续持有/);assert.match(next.request,/专业技术概念只作为判断依据/);assert.doesNotMatch(next.request,/stateId|reviewHash|snapshotHash/);assert.equal('technicalSnapshot' in next.context.currentState,false);
});

test('candidate save mutates only cloned discussion state and preserves all protected domains',()=>{
  const source=stock({plans:[{schemaVersion:'plan.v2',id:'p1',planVersion:1,action:'add',status:'active',validityStatus:'active',source:'manual'}],allocationDecision:{recommendedTargetWeight:20}}),rootState={stocks:[source],planReviews:{currentByPlan:{}},allocation:{cash:10}},before=JSON.parse(JSON.stringify(rootState)),prepared=Workbench.buildDiscussionRequest(source,{state:rootState,planReviewStore:rootState.planReviews}),result=Contract.process(JSON.stringify(decision(prepared,{planRelation:{status:'aligned',summary:'当前方向与计划一致，但仍需复核完整条件。'}})),options(prepared,source)),built=Contract.buildCandidate(rootState,result,{prepared,now:'2026-09-01T08:00:00Z'});
  assert.deepEqual(rootState,before);const after=built.candidate;assert.deepEqual(after.planReviews,before.planReviews);assert.deepEqual(after.allocation,before.allocation);for(const key of ['plans','shares','avgCost','technicalData','technicalReview','allocationDecision','longTermLogic'])assert.deepEqual(after.stocks[0][key],before.stocks[0][key],key);assert.ok(after.stocks[0].discussionState.current);
});

test('import preview and Current State UI put decision, urgency, trend, structure and focus before details',()=>{
  const source=stock(),{prepared,result}=process(source,{structureAssessment:[{timeframe:'60分钟',type:'top',status:'forming',source:'ai_chart_judgment',sourceAsOf:'',shortReason:'顶部结构形成中。'}]}),preview=Contract.renderPreview(result,{technicalAsOf:prepared.technicalSnapshot.anchorBar.date,confirmedDate:'2026-09-01'}),ui=fs.readFileSync(path.join(root,'src','ui-render.js'),'utf8'),html=fs.readFileSync(path.join(root,'index.html'),'utf8');
  for(const label of ['当前结论','仓位方向','如果想加仓','需要警惕','判断依据','趋势','结构','当前重点','与计划关系'])assert.match(preview,new RegExp(label));assert.ok(preview.indexOf('当前结论')<preview.indexOf('判断依据'));
  const card=ui.slice(ui.indexOf('function discussionStateCard'),ui.indexOf('function discussionHistoryPanel'));for(const label of ['当前结论','仓位方向','如果想建仓','如果想加仓','需要警惕','止盈','止损','判断依据','趋势','结构','与计划关系'])assert.match(card,new RegExp(label));assert.ok(card.lastIndexOf('当前结论')<card.lastIndexOf('判断依据'));assert.match(html,/discussion-user-decision-card/);assert.match(html,/max-width:100%;overflow-wrap:anywhere/);
});

test('normal UI mappings contain Chinese labels and prose rejects internal English leakage',()=>{
  const ui=fs.readFileSync(path.join(root,'src','ui-render.js'),'utf8'),source=stock(),prepared=Workbench.buildDiscussionRequest(source);for(const label of ['风险控制','减仓复核','持有观察','等待确认','加仓复核','建仓复核','暂不操作','普通观察','重点观察','临近窗口'])assert.match(ui,new RegExp(label));
  const leaked=Contract.process(JSON.stringify(decision(prepared,{summary:'当前 actionAssessment 显示 recovery。'})),options(prepared,source));assert.equal(leaked.ok,false);assert.equal(leaked.writes,0);
});

test('User Decision V3 keeps independent position, add, take-profit and stop-loss dimensions',()=>{
  const source=stock(),prepared=Workbench.buildDiscussionRequest(source),cases=[
    {headline:'可以继续持有，但高位风险正在增加。',holding:{status:'caution',summary:'仍可持有，但需要提高警惕。'},positionDirection:{status:'hold_no_add',summary:'维持现有仓位，暂不增加。'},addAssessment:{status:'avoid',summary:'当前位置不适合增加仓位。'},warning:{summary:'若高位继续转弱，应复核减仓方向。',items:['关注承接是否进一步减弱。']},takeProfit:{status:'watch',summary:'高位压力增加，开始关注止盈。'},stopLoss:{status:'none',summary:'暂时没有明显止损风险。'},riskSource:'stock'},
    {headline:'当前位置风险较高，需要进入减仓复核。',holding:{status:'reduce_review',summary:'持有风险已经明显增加。'},positionDirection:{status:'reduce_review',summary:'优先复核降低仓位风险。'},addAssessment:{status:'avoid',summary:'当前不适合增加仓位。'},warning:{summary:'若继续走弱，需要升级风险控制。',items:[]},takeProfit:{status:'review',summary:'进入止盈复核，保护已有利润。'},stopLoss:{status:'watch',summary:'关键支撑转弱，关注止损风险。'},riskSource:'stock'},
    {headline:'条件已经成熟，可以复核增加仓位。',holding:{status:'safe',summary:'当前持有判断仍然稳定。'},positionDirection:{status:'add_review',summary:'仓位仍有空间，可以进入增加仓位复核。'},addAssessment:{status:'add_review',summary:'机会已经成熟，可以开始复核。'},warning:{summary:'若重新走弱，应取消本次机会复核。',items:[]},takeProfit:{status:'none',summary:'暂时没有明显止盈压力。'},stopLoss:{status:'none',summary:'当前没有明显本金保护风险。'},riskSource:'none'},
    {headline:'关键风险已经出现，需要优先控制仓位风险。',holding:{status:'risk_control',summary:'继续持有的风险已经明显升高。'},positionDirection:{status:'risk_control',summary:'优先进入风险控制复核。'},addAssessment:{status:'avoid',summary:'当前不应增加仓位。'},warning:{summary:'关键支撑已经失效，风险可能继续扩大。',items:[]},takeProfit:{status:'review',summary:'优先保护已有利润。'},stopLoss:{status:'risk_control',summary:'进入本金风险控制复核。'},riskSource:'stock'}
  ];
  for(const [index,userDecision] of cases.entries()){
    const actionAssessment=index===1?{category:'reduce_review',priority:'high'}:(index===2?{category:'add_review',priority:'high'}:(index===3?{category:'risk_control',priority:'high'}:{})),result=Contract.process(JSON.stringify(decision(prepared,{userDecision,actionAssessment})),options(prepared,source));
    assert.equal(result.ok,true,result.message);assert.deepEqual(result.currentState.userDecision,userDecision);assert.doesNotMatch(JSON.stringify(result.currentState.userDecision),/自动卖出|自动买入/);
  }
});

test('market-risk override is allowed only with explicit supplied market context',()=>{
  const source=stock(),prepared=Workbench.buildDiscussionRequest(source),userDecision={headline:'个股本身仍然稳定，但大盘风险偏高，当前不宜继续增加仓位。',holding:{status:'safe',summary:'个股持有判断仍然稳定。'},positionDirection:{status:'hold_no_add',summary:'大盘风险偏高，暂不增加仓位。'},addAssessment:{status:'avoid',summary:'等待市场风险下降后再复核。'},warning:{summary:'若市场风险继续增强，应提高仓位防御。',items:[]},takeProfit:{status:'watch',summary:'开始关注利润保护。'},stopLoss:{status:'none',summary:'个股暂时没有明显止损风险。'},riskSource:'market'};
  const absent=Contract.process(JSON.stringify(decision(prepared,{userDecision})),options(prepared,source));assert.equal(absent.ok,false);assert.match(absent.message,/不得归因于大盘/);
  const explicit=Contract.process(JSON.stringify(decision(prepared,{userDecision})),options(prepared,source,{marketRiskAvailable:true}));assert.equal(explicit.ok,true,explicit.message);
  const context=Workbench.buildContext(source,{marketRiskContext:{status:'elevated',summary:'用户明确提供大盘风险偏高。',source:'user_provided'}});assert.equal(context.context.currentFacts.marketRisk.status,'elevated');assert.equal(Workbench.buildContext(source).context.currentFacts.marketRisk.status,'unavailable');
});

test('zero-position perspective, price ownership and concise-language guards fail closed',()=>{
  const source=stock({type:'candidate',shares:0,avgCost:0}),prepared=Workbench.buildDiscussionRequest(source),base=decision(prepared,{userDecision:{headline:'当前位置不适合建仓，继续等待。',holding:{status:'not_applicable',summary:'当前没有持仓。'},positionDirection:{status:'not_applicable',summary:'保持空仓观察。'},addAssessment:{status:'wait',summary:'等待更合适的建仓机会。'},warning:{summary:'若风险继续增强，应延后建仓复核。',items:[]},takeProfit:{status:'not_applicable',summary:'当前无持仓，不适用。'},stopLoss:{status:'not_applicable',summary:'尚未持有，不适用。'},riskSource:'none'},actionAssessment:{category:'no_action'},planRelation:{status:'no_matching_plan'}});
  const valid=Contract.process(JSON.stringify(base),options(prepared,source));assert.equal(valid.ok,true,valid.message);
  for(const mutate of [
    value=>value.currentState.userDecision.headline='可以继续持有。',
    value=>value.currentState.userDecision.addAssessment.summary='等待回到六十元再建仓。',
    value=>value.currentState.userDecision.addAssessment.summary='等待回到 60 元再建仓。',
    value=>value.currentState.userDecision.headline='日线修复仍然有效。',
    value=>value.currentState.userDecision.warning.summary=value.currentState.userDecision.headline
  ]){const candidate=structuredClone(base);mutate(candidate);const result=Contract.process(JSON.stringify(candidate),options(prepared,source));assert.equal(result.ok,false);assert.equal(result.writes,0)}
});

test('semantic guard accepts negated legacy wording and rejects direct-execution implications',()=>{
  const source=stock(),prepared=Workbench.buildDiscussionRequest(source);
  for(const summary of ['已经到达观察区间，但条件还未成熟。','关键条件尚未确立。','价格进入计划范围不等于完整条件满足。']){const result=Contract.process(JSON.stringify(decision(prepared,{summary})),options(prepared,source));assert.equal(result.ok,true,result.message)}
  for(const summary of ['价格进入计划区，因此完整条件已经满足。','价格达到计划价，可以直接执行。','既然价格触发，所有确认条件都已完成。']){const result=Contract.process(JSON.stringify(decision(prepared,{summary})),options(prepared,source));assert.equal(result.ok,false,summary);assert.equal(result.writes,0)}
});

test('v2 records remain canonical without synthetic userDecision while v3 requires it',()=>{
  const source=stock(),prepared=Workbench.buildDiscussionRequest(source),v3=decision(prepared),result=Contract.process(JSON.stringify(v3),options(prepared,source)),saved=Contract.buildCandidate({stocks:[source]},result,{prepared,now:'2026-09-04T08:00:00Z'}).currentState,v2={...saved,schemaVersion:Workbench.V2_STATE_SCHEMA_VERSION};delete v2.userDecision;
  const normalized=Workbench.normalizeStore({schemaVersion:Workbench.STORE_SCHEMA_VERSION,current:v2,history:[v2]});assert.equal(normalized.current.schemaVersion,Workbench.V2_STATE_SCHEMA_VERSION);assert.equal('userDecision' in normalized.current,false);assert.equal(Workbench.validateStore(normalized).ok,true);
  const missing=structuredClone(v3);delete missing.currentState.userDecision;const rejected=Contract.process(JSON.stringify(missing),options(prepared,source));assert.equal(rejected.ok,false);assert.match(rejected.message,/userDecision/);
});

test('accepted pre-V3 allowlist strips userDecision on resave but preserves legacy Current State evidence',()=>{
  const source=stock(),prepared=Workbench.buildDiscussionRequest(source),result=Contract.process(JSON.stringify(decision(prepared)),options(prepared,source)),saved=Contract.buildCandidate({stocks:[source]},result,{prepared,now:'2026-09-04T08:00:00Z'}).currentState;
  // This is the exact non-V1 field projection used by accepted baseline f14821e.
  const baselineFields=['stateId','symbol','sourceDiscussionVersion','actionAssessment','attentionLevel','trendAssessment','structureAssessment','stage','focusPoints','summary','keyChanges','risks','watchPoints','planRelation','confidence','technicalAsOf','confirmedAt','confirmedDate','technicalSnapshot','references'];
  const oldClientResave={schemaVersion:Workbench.V2_STATE_SCHEMA_VERSION};for(const key of baselineFields)oldClientResave[key]=structuredClone(saved[key]);
  assert.equal('userDecision' in oldClientResave,false);
  assert.equal(Workbench.validateState(oldClientResave).ok,true);
  for(const key of baselineFields)assert.deepEqual(oldClientResave[key],saved[key],key);
});
