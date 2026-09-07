'use strict';
const W=require('../../src/discussion-workbench.js'),F=require('./homepage-attention.js');
function stock(kind='v3',shares=100){
  const value=F.accept(F.stock({id:'reliability-stock',name:'讨论验收标的',shares}));
  if(kind==='none')value.discussionState=W.defaultStore();
  if(kind==='v2'){value.discussionState.current.schemaVersion=W.V2_STATE_SCHEMA_VERSION;delete value.discussionState.current.userDecision}
  if(kind==='v1')value.discussionState.current=W.normalizeState({...value.discussionState.current,schemaVersion:W.LEGACY_STATE_SCHEMA_VERSION,planRelation:'旧结论仍可读取。'});
  if(kind==='historical'){value.discussionState=stock('v1',100).discussionState;value.shares=0}
  if(kind==='pending'){value.priceHistory=[];value.technicalData={technicalDataStatus:'unavailable'}}
  return value;
}
function judgment(prepared){
  // Fixed deterministic output, independent of the business prompt under test.
  const held=prepared.context.currentFacts.holding.shares>0,current=F.accept(F.stock({shares:held?100:0})).discussionState.current;
  current.userDecision.stopLoss.summary=held?'当前本金风险可控。':'尚未持有，无需处理。';
  const keys=['userDecision','actionAssessment','attentionLevel','trendAssessment','structureAssessment','stage','focusPoints','summary','keyChanges','risks','watchPoints','planRelation','confidence'];
  return {currentState:{symbol:prepared.context.symbol,sourceDiscussionVersion:prepared.sourceDiscussionVersion,...Object.fromEntries(keys.map(key=>[key,current[key]]))}};
}
function options(prepared){const f=prepared.context.currentFacts;return {prepared,expectedSymbol:prepared.context.symbol,sourceDiscussionVersion:prepared.sourceDiscussionVersion,holdingShares:f.holding.shares,technicalDataStatus:f.technical.dataStatus,hasActivePlan:f.plans.length>0}}
module.exports={stock,judgment,options};
