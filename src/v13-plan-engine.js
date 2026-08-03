const V13_PLAN_STAGE_RANK={triggered:4,level2:3,level1:2,none:1};
const V13_PLAN_TYPE_RANK={trend_defense:5,profit_take:4,position_control:3,add:2,build:1};

function normalizePlanList(plans){
  return (Array.isArray(plans)?plans:[])
    .map(plan=>typeof normalizeV13Plan==='function'?normalizeV13Plan(plan):plan)
    .filter(plan=>plan&&typeof plan==='object');
}

function getActivePlans(plans){
  return normalizePlanList(plans).filter(plan=>plan.versionStatus==='active');
}

function getArchivedPlans(plans){
  return normalizePlanList(plans).filter(plan=>plan.versionStatus==='archived');
}

function getActivePlanByType(plans,planType){
  return sortPlansByPriority(getActivePlans(plans).filter(plan=>plan.planType===planType))[0]||null;
}

function getDisplayActivePlans(plans){
  const grouped=new Map();
  sortPlansByPriority(getActivePlans(plans)).forEach(plan=>{
    if(!grouped.has(plan.planType))grouped.set(plan.planType,plan);
  });
  return Array.from(grouped.values());
}

function sortPlansByPriority(plans){
  return normalizePlanList(plans).slice().sort((a,b)=>{
    const stageDiff=(V13_PLAN_STAGE_RANK[b.stage]||0)-(V13_PLAN_STAGE_RANK[a.stage]||0);
    if(stageDiff)return stageDiff;
    const typeDiff=(V13_PLAN_TYPE_RANK[b.planType]||0)-(V13_PLAN_TYPE_RANK[a.planType]||0);
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
  const value=Number(plan&&plan.triggerPrice);
  return Number.isFinite(value)&&value>0?value:null;
}

function v13PlanTriggerDirection(plan){
  const explicit=String(plan&&plan.triggerDirection||'').toLowerCase();
  if(['above','gte','up','sell_above'].includes(explicit))return 'above';
  if(['below','lte','down','buy_below'].includes(explicit))return 'below';
  if(['profit_take','position_control'].includes(plan&&plan.planType))return 'above';
  if(['build','add','trend_defense'].includes(plan&&plan.planType))return 'below';
  return '';
}

function checkPlanTriggerLevel(plan,priceSnapshot,ruleConfig){
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
  const normalized=typeof normalizeV13Plan==='function'?normalizeV13Plan(plan):{...(plan||{})};
  return {
    ...normalized,
    versionStatus:'archived',
    archivedAt:normalized.archivedAt||(typeof v13NowIso==='function'?v13NowIso():new Date().toISOString()),
    legacy:{
      ...(normalized.legacy||{}),
      archiveReason:String(reason||'')
    }
  };
}
