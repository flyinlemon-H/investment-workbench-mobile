'use strict';
const Discussion=require('../../src/discussion-workbench.js'),Plan=require('../../src/plan-v2.js'),Runtime=require('../../src/plan-runtime.js');
const NOW='2026-09-06T04:00:00.000Z',DAY='2026-09-04';
const definition={planMode:'state_watch',name:'结构观察',applicableConditions:['趋势保持稳定'],entryConditions:['进入观察区域'],confirmationConditions:['结构得到确认'],invalidationConditions:['关键结构失效'],reviewAction:'hold_watch',priceReferences:[],allocationConstraint:{maxPositionPct:15,targetWeightRange:null},note:'人工复核',validUntil:null,nextReviewDate:null};
function stock(patch={}){
  return {id:'home-stock',code:'601138.SS',name:'工业富联',type:'holding',shares:100,avgCost:40,currentPrice:50,plans:[],priceHistory:[{date:DAY,close:50,is_complete_bar:true,adjustment:'qfq',price_basis:'adjusted',provider:'fixture'}],technicalData:{technicalDataStatus:'fresh',technicalAsOf:DAY,latestCompleteBar:DAY,price:50},...patch};
}
function accept(stock,patch={}){
  const held=stock.shares>0,section=(status,summary)=>({status,summary});
  const userDecision={headline:held?'当前可以继续观察持仓。':'当前继续等待建仓机会。',holding:section(held?'safe':'not_applicable','当前状态稳定。'),positionDirection:section(held?'hold':'not_applicable','维持当前状态。'),addAssessment:section('wait','等待条件。'),warning:{summary:'观察条件变化。',items:[]},takeProfit:section(held?'none':'not_applicable','当前无需复核。'),stopLoss:section(held?'none':'not_applicable','当前无需复核。'),riskSource:'none',...(patch.userDecision||{})};
  const current=Discussion.normalizeState({schemaVersion:Discussion.STATE_SCHEMA_VERSION,stateId:'home-current',symbol:Discussion.canonical(stock),sourceDiscussionVersion:'home-discussion',technicalAsOf:DAY,technicalSnapshot:Discussion.technicalSnapshot(stock),references:Discussion.references(stock),confirmedAt:'2026-09-04T09:00:00.000Z',confirmedDate:DAY,stage:'常规观察',summary:'当前趋势保持稳定，没有需要优先复核的变化。',keyChanges:[],risks:[],watchPoints:['观察条件变化'],confidence:'medium',actionAssessment:{category:held?'hold_watch':'no_action',priority:'low',headline:'当前继续观察。',reasons:['当前条件稳定'],upgradeConditions:['结构发生变化'],downgradeConditions:['结构恢复稳定']},attentionLevel:'normal',trendAssessment:{overall:'sideways',timeframes:[]},structureAssessment:[],focusPoints:['观察变化'],planRelation:{status:'neutral',summary:'当前没有计划冲突。'},...patch,userDecision});
  const checked=Discussion.validateState(current);if(!checked.ok)throw new Error(checked.errors.join('; '));
  stock.discussionState={schemaVersion:Discussion.STORE_SCHEMA_VERSION,current,history:[]};return stock;
}
function state(stockPatch={},decisionPatch={}){return {stocks:[accept(stock(stockPatch),decisionPatch)],planRuntimeStates:Runtime.defaultStore(),executionLog:[],updatedAt:null}}
async function runtime(phase='watch_zone',decisionPatch={},stockPatch={}){
  const plan=Plan.createWatchPlan(definition,{now:'2026-09-04T08:00:00.000Z'}),app=state({...stockPatch,plans:[plan]},decisionPatch),prepared=Runtime.prepare(app,'home-stock',plan.id);
  const assessment={invalidated:'invalidate',downgraded:'downgrade',resolved:'resolve'}[phase]||'advance';
  const preview=Runtime.process(JSON.stringify({planRuntimeReview:{suggestedPhase:phase,transitionAssessment:assessment,summary:'计划进入新的关注状态。',evidence:['当前已保存结论支持该状态'],watchPoints:['观察下一步变化'],risks:['条件可能失效'],confidence:'medium'}}),{state:app,prepared});
  let resultState=app;const result=await Runtime.commit(preview,app,{saveCandidate:async()=>{},adoptCandidate:value=>{resultState=value}},{confirmed:true,now:'2026-09-04T10:00:00.000Z',acknowledgeActionReview:true});
  if(result.status!=='completed')throw new Error(JSON.stringify(result));return resultState;
}
function failedTask(patch={}){return {task_exists:true,enabled:true,generated_at:'2026-09-04T08:30:00.000Z',last_run_time:'2026-09-04T08:30:00.000Z',next_run_time:'2026-09-07T08:30:00.000Z',last_task_result:1,latest_run:{status:'failed',success:0,failed:20,finished_at:'2026-09-04T08:30:00.000Z'},...patch}}
module.exports={NOW,DAY,definition,stock,accept,state,runtime,failedTask};
