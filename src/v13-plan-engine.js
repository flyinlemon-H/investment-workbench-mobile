const V13_PLAN_STAGE_RANK={triggered:4,near:3,not_triggered:2,unavailable:1};
const V13_PLAN_TYPE_RANK={observe:5,sell:4,reduce:3,add:2,buy:1};

function normalizePlanList(plans){
  return (Array.isArray(plans)?plans:[])
    .map(plan=>typeof normalizeV13Plan==='function'?normalizeV13Plan(plan):plan)
    .filter(plan=>plan&&typeof plan==='object');
}

function getActivePlans(plans){
  return normalizePlanList(plans).filter(plan=>plan.status==='active'&&!['invalid','completed'].includes(plan.validityStatus));
}

function getArchivedPlans(plans){
  return normalizePlanList(plans).filter(plan=>plan.status!=='active'||['invalid','completed'].includes(plan.validityStatus));
}

function getActivePlanByType(plans,planType){
  return sortPlansByPriority(getActivePlans(plans).filter(plan=>(!Object.prototype.hasOwnProperty.call(plan,'planMode')||plan.planMode==='legacy_price')&&plan.action===planType))[0]||null;
}

function getDisplayActivePlans(plans){
  const grouped=new Map();
  sortPlansByPriority(getActivePlans(plans)).forEach(plan=>{
    if(Object.prototype.hasOwnProperty.call(plan,'planMode')&&plan.planMode!=='legacy_price')return;
    if(!grouped.has(plan.action))grouped.set(plan.action,plan);
  });
  return Array.from(grouped.values());
}

function sortPlansByPriority(plans){
  return normalizePlanList(plans).slice().sort((a,b)=>{
    const stageDiff=(V13_PLAN_STAGE_RANK[b.priceTriggerStatus]||0)-(V13_PLAN_STAGE_RANK[a.priceTriggerStatus]||0);
    if(stageDiff)return stageDiff;
    const typeDiff=(V13_PLAN_TYPE_RANK[b.action]||0)-(V13_PLAN_TYPE_RANK[a.action]||0);
    if(typeDiff)return typeDiff;
    const priceDiff=(Number(b.triggerPrice)||0)-(Number(a.triggerPrice)||0);
    if(priceDiff)return priceDiff;
    return String(b.createdAt||'').localeCompare(String(a.createdAt||''));
  });
}

function v13PlanCurrentPrice(priceSnapshot){
  if(!priceSnapshot||typeof priceSnapshot!=='object')return null;
  const raw=priceSnapshot.price??priceSnapshot.currentPrice??priceSnapshot.close??priceSnapshot.lastPrice;
  const value=Number(raw);
  return Number.isFinite(value)&&value>0?value:null;
}

function v13PlanTriggerPrice(plan){
  if(plan&&Object.prototype.hasOwnProperty.call(plan,'planMode')&&plan.planMode!=='legacy_price')return null;
  const value=Number(plan&&plan.triggerPrice);
  return Number.isFinite(value)&&value>0?value:null;
}

function v13PlanTriggerDirection(plan){
  if(plan&&Object.prototype.hasOwnProperty.call(plan,'planMode')&&plan.planMode!=='legacy_price')return '';
  const explicit=String(plan&&plan.triggerDirection||'').toLowerCase();
  if(['above','gte','up','sell_above'].includes(explicit))return 'above';
  if(['below','lte','down','buy_below'].includes(explicit))return 'below';
  return '';
}

function checkPlanTriggerLevel(plan,priceSnapshot,ruleConfig){
  if(plan&&Object.prototype.hasOwnProperty.call(plan,'planMode')&&plan.planMode!=='legacy_price')return 'none';
  const normalized=typeof normalizeV13Plan==='function'?normalizeV13Plan(plan):plan;
  const current=v13PlanCurrentPrice(priceSnapshot);
  const trigger=v13PlanTriggerPrice(normalized);
  if(!current||!trigger)return 'none';
  const direction=v13PlanTriggerDirection(normalized);
  if(direction==='above'&&current>=trigger)return 'triggered';
  if(direction==='below'&&current<=trigger)return 'triggered';
  const level1=Number(ruleConfig&&ruleConfig.planLevel1Pct);
  const level2=Number(ruleConfig&&ruleConfig.planLevel2Pct);
  const level1Pct=Number.isFinite(level1)?level1:10;
  const level2Pct=Number.isFinite(level2)?level2:5;
  const distancePct=Math.abs(current-trigger)/trigger*100;
  if(distancePct<=level2Pct)return 'level2';
  if(distancePct<=level1Pct)return 'level1';
  return 'none';
}

function archivePlan(plan,reason){
  if(plan&&Object.prototype.hasOwnProperty.call(plan,'planMode')&&plan.planMode!=='legacy_price')throw new Error('状态观察计划暂不支持旧价格计划归档。');
  if(typeof PlanV2!=='undefined')return PlanV2.terminatePlan(plan,'replaced',{reason});
  return {...plan,status:'replaced'};
}
