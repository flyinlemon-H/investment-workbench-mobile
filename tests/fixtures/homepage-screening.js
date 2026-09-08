'use strict';
const F=require('./homepage-attention.js'),Plan=require('../../src/plan-v2.js');
function state({held=true,risk=false,current=false,action=null}={}){
  const app=F.state({shares:held?100:0,managementCategory:held?'core':'candidate',technicalIndicators:{last_trade_date:F.DAY,ma20:risk?52:48,ma60:risk?54:46,macd:{dif:risk?-2:2,dea:0,histogram:risk?-4:4}}});
  if(action)app.stocks[0].plans=[plan(action)];
  if(!current)delete app.stocks[0].discussionState;
  return app;
}
function plan(action,patch={}){return Plan.createPlan({id:'screen-'+action,action,triggerPrice:50,triggerDirection:['sell','reduce'].includes(action)?'above':'below',allocationConstraint:{maxPositionPct:15,targetWeightRange:null},...patch},{source:'manual',now:'2026-09-04T08:00:00.000Z'})}
module.exports={...F,state,plan};
