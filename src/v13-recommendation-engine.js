const V13_RECOMMENDATION_PRIORITIES=['P1','P2','P3','P4'];
const V13_RECOMMENDATION_PRIORITY_RANK={P4:4,P3:3,P2:2,P1:1};
const V13_RECOMMENDATION_TYPES=[
  'risk_management',
  'profit_management',
  'plan_review',
  'observe',
  'information_update'
];

function v13RecommendationObject(v){
  return v&&typeof v==='object'&&!Array.isArray(v)?v:{};
}
function v13RecommendationArray(v){
  return Array.isArray(v)?v:[];
}
function v13RecommendationString(v){
  return v===null||v===undefined?'':String(v);
}
function v13RecommendationPriority(v,fallback='P1'){
  const s=v13RecommendationString(v).toUpperCase();
  return V13_RECOMMENDATION_PRIORITIES.includes(s)?s:fallback;
}
function v13RecommendationType(v,fallback='observe'){
  const s=v13RecommendationString(v);
  return V13_RECOMMENDATION_TYPES.includes(s)?s:fallback;
}
function v13RecommendationIsCashStock(stock={}){
  const type=v13RecommendationString(stock.type).toLowerCase();
  const id=v13RecommendationString(stock.id||stock.code||stock.symbol).toLowerCase();
  const role=v13RecommendationString(stock.role);
  const name=v13RecommendationString(stock.name);
  return type==='cash'||id==='cash'||/现金/.test(role)||/现金/.test(name);
}
function v13RecommendationId(stockId,type,sourceId=''){
  const safeStock=v13RecommendationString(stockId)||'stock';
  const safeType=v13RecommendationString(type)||'recommendation';
  const safeSource=v13RecommendationString(sourceId)||'derived';
  return `rec-${safeStock}-${safeType}-${safeSource}`.replace(/\s+/g,'-');
}
function normalizeRecommendation(v={},stock={}){
  const src=v13RecommendationObject(v);
  const stockId=v13RecommendationString(src.stockId||stock.id||stock.code||stock.symbol);
  const type=v13RecommendationType(src.type);
  const source=v13RecommendationObject(src.source);
  const sourceObjectId=v13RecommendationString(source.objectId||src.linkedPlanId||src.sourceId);
  return {
    id:v13RecommendationString(src.id)||v13RecommendationId(stockId,type,sourceObjectId),
    stockId,
    type,
    priority:v13RecommendationPriority(src.priority),
    reason:v13RecommendationString(src.reason),
    reviewGuide:v13RecommendationString(src.reviewGuide),
    source:{
      objectType:v13RecommendationString(source.objectType||src.sourceObjectType),
      objectId:sourceObjectId
    },
    linkedPlanId:v13RecommendationString(src.linkedPlanId),
    legacy:v13RecommendationObject(src.legacy)
  };
}
function normalizeRecommendationList(recommendations,stock={}){
  return v13RecommendationArray(recommendations)
    .map(item=>normalizeRecommendation(item,stock))
    .filter(item=>item.reason||item.reviewGuide);
}
function getRecommendationPriorityRank(recommendation){
  const rec=normalizeRecommendation(recommendation);
  return V13_RECOMMENDATION_PRIORITY_RANK[rec.priority]||0;
}
function sortRecommendationsByPriority(recommendations){
  return normalizeRecommendationList(recommendations).slice().sort((a,b)=>{
    const priorityDiff=getRecommendationPriorityRank(b)-getRecommendationPriorityRank(a);
    if(priorityDiff)return priorityDiff;
    return String(a.id).localeCompare(String(b.id));
  });
}
function v13RecommendationPlanKey(recommendation){
  const rec=normalizeRecommendation(recommendation);
  const legacy=v13RecommendationObject(rec.legacy);
  const planType=v13RecommendationString(legacy.planType||legacy.plan&&legacy.plan.planType||rec.type);
  const direction=v13RecommendationString(legacy.triggerDirection||legacy.plan&&legacy.plan.triggerDirection||'');
  return `${planType}|${direction||'unknown'}`;
}
function v13RecommendationIsExecutePlanRisk(recommendation){
  const rec=normalizeRecommendation(recommendation);
  return rec.type==='plan_review'
    && rec.source.objectType==='RiskState'
    && /既定计划|execute_plan|计划区/.test(`${rec.reason} ${rec.reviewGuide}`);
}
function compareV13RecommendationForPrimary(a,b){
  const priorityDiff=getRecommendationPriorityRank(b)-getRecommendationPriorityRank(a);
  if(priorityDiff)return priorityDiff;
  const aPlan=a&&a.source&&a.source.objectType==='Plan';
  const bPlan=b&&b.source&&b.source.objectType==='Plan';
  if(aPlan!==bPlan)return bPlan?1:-1;
  const aExecute=v13RecommendationIsExecutePlanRisk(a);
  const bExecute=v13RecommendationIsExecutePlanRisk(b);
  if(aExecute!==bExecute)return aExecute?1:-1;
  return String(a.id).localeCompare(String(b.id));
}
function aggregateV13Recommendations(recommendations){
  const sorted=sortRecommendationsByPriority(recommendations);
  const planGroups=new Map();
  const nonPlan=[];
  sorted.forEach(rec=>{
    if(rec.type==='plan_review'&&rec.source.objectType==='Plan'){
      const key=v13RecommendationPlanKey(rec);
      const existing=planGroups.get(key);
      if(!existing||compareV13RecommendationForPrimary(existing,rec)>0)planGroups.set(key,rec);
    }else{
      nonPlan.push(rec);
    }
  });
  const groupedPlanPrimaries=Array.from(planGroups.values());
  const primary=[...groupedPlanPrimaries,...nonPlan].slice().sort(compareV13RecommendationForPrimary)[0]||null;
  const primaryRecommendations=primary?[primary]:[];
  const secondaryRecommendations=sortRecommendationsByPriority(sorted.filter(rec=>!primary||rec.id!==primary.id));
  return {primaryRecommendations,secondaryRecommendations};
}
function v13RecommendationTechnicalFacts(stock={}){
  const review=v13RecommendationObject(stock.technicalReview);
  const shortTerm=v13RecommendationObject(review.shortTermTechnical);
  const technicalData=v13RecommendationObject(stock.technicalData);
  const facts=[];
  const add=text=>{const value=v13RecommendationString(text).trim();if(value&&!facts.includes(value))facts.push(value)};
  [shortTerm.trendStatus,technicalData.trendStatus,review.finalTechnicalConclusion].forEach(add);
  v13RecommendationArray(shortTerm.riskFlags).forEach(add);
  v13RecommendationArray(technicalData.riskFlags).forEach(add);
  if(shortTerm.actionHint)add(`技术面提示：${shortTerm.actionHint}`);
  else if(technicalData.actionHint)add(`技术面提示：${technicalData.actionHint}`);
  return facts;
}
function v13RecommendationFromRiskManagement(stock={}){
  if(v13RecommendationIsCashStock(stock))return null;
  const risk=v13RecommendationObject(stock.riskManagement);
  const status=v13RecommendationString(risk.status);
  const facts=v13RecommendationTechnicalFacts(stock).slice(0,3);
  const reasonParts=[risk.summary,...v13RecommendationArray(risk.triggerReasons),...facts].filter(Boolean);
  const reason=reasonParts.join('；');
  const guideParts=[
    ...v13RecommendationArray(risk.reviewConditions),
    ...v13RecommendationArray(risk.protectiveActions),
    ...v13RecommendationArray(risk.invalidConditions)
  ].filter(Boolean);
  const reviewGuide=guideParts.join('；')||'复核风险状态、技术事实、仓位是否偏离目标，以及是否需要进入人工决策。';
  if(!reason)return null;
  const base={reason,reviewGuide,source:{objectType:'RiskState',objectId:'riskManagement'}};
  if(status==='defensive_reduce_review')return normalizeRecommendation({...base,type:'risk_management',priority:'P4'},stock);
  if(status==='risk_review')return normalizeRecommendation({...base,type:'risk_management',priority:'P3'},stock);
  if(status==='profit_take_review')return normalizeRecommendation({...base,type:'profit_management',priority:'P3'},stock);
  if(status==='execute_plan')return normalizeRecommendation({...base,type:'plan_review',priority:'P4'},stock);
  if(status==='observe'&&(facts.length||guideParts.length))return normalizeRecommendation({...base,type:'observe',priority:'P2'},stock);
  return null;
}
function v13RecommendationPlanReason(plan,level){
  const trigger=plan&&plan.triggerPrice!==null&&plan.triggerPrice!==undefined?`计划价 ${plan.triggerPrice}`:'计划价缺失';
  const summary=plan&&plan.summary?`，${plan.summary}`:'';
  if(level==='triggered')return `${trigger} 已进入正式触发复核区${summary}`;
  if(level==='level2')return `${trigger} 已进入二级提醒区${summary}`;
  if(level==='level1')return `${trigger} 已进入一级提醒区${summary}`;
  return '';
}
function v13RecommendationFromPlan(stock={},plan={},priceSnapshot={},ruleConfig={}){
  if(!plan||plan.versionStatus==='archived')return null;
  const level=typeof checkPlanTriggerLevel==='function'?checkPlanTriggerLevel(plan,priceSnapshot,ruleConfig):plan.stage;
  if(!['triggered','level2','level1'].includes(level))return null;
  const priority=level==='triggered'?'P4':(level==='level2'?'P3':'P2');
  const reason=v13RecommendationPlanReason(plan,level);
  if(!reason)return null;
  return normalizeRecommendation({
    type:'plan_review',
    priority,
    reason,
    reviewGuide:'复核计划生成依据、当前价格、技术事实、仓位状态和是否需要人工决策。计划触发不代表已经执行。',
    source:{objectType:'Plan',objectId:plan.id},
    linkedPlanId:plan.id,
    legacy:{planType:plan.planType,triggerDirection:plan.triggerDirection,stage:level}
  },stock);
}
function v13RecommendationFromInformationCompleteness(stock={},existingRecommendations=[],options={}){
  const hasHigher=normalizeRecommendationList(existingRecommendations,stock).some(item=>['P4','P3','P2'].includes(item.priority));
  if(hasHigher)return null;
  if(v13RecommendationIsCashStock(stock))return null;
  if(!options.hasExplicitInformationCompleteness)return null;
  if(!stock.informationCompleteness||typeof stock.informationCompleteness!=='object')return null;
  const completeness=v13RecommendationObject(stock.informationCompleteness);
  if(v13RecommendationString(completeness.overall)!=='low')return null;
  const missing=v13RecommendationArray(completeness.missingItems||completeness.missingData).filter(Boolean).slice(0,5);
  const reason=missing.length?`信息完整度偏低，缺失：${missing.join('、')}`:'信息完整度偏低，需要补充关键资料。';
  return normalizeRecommendation({
    type:'information_update',
    priority:'P1',
    reason,
    reviewGuide:'优先补充缺失资料；该提示只表示资料不足，不构成操作建议。',
    source:{objectType:'InformationCompleteness',objectId:'informationCompleteness'}
  },stock);
}
function buildV13DerivedRecommendations(stock={},coreModel={},options={}){
  if(v13RecommendationIsCashStock(stock))return [];
  const recommendations=[];
  const riskRecommendation=v13RecommendationFromRiskManagement(stock);
  if(riskRecommendation)recommendations.push(riskRecommendation);
  const priceSnapshot=coreModel.priceSnapshot||(coreModel.priceSnapshots&&coreModel.priceSnapshots[0])||{};
  const ruleConfig=coreModel.ruleConfig||{};
  v13RecommendationArray(coreModel.plans).forEach(plan=>{
    const rec=v13RecommendationFromPlan(stock,plan,priceSnapshot,ruleConfig);
    if(rec)recommendations.push(rec);
  });
  const infoRecommendation=v13RecommendationFromInformationCompleteness(stock,recommendations,options);
  if(infoRecommendation)recommendations.push(infoRecommendation);
  const byKey=new Map();
  sortRecommendationsByPriority(recommendations).forEach(rec=>{
    const key=[rec.type,rec.source.objectType,rec.source.objectId,rec.linkedPlanId].join('|');
    if(!byKey.has(key))byKey.set(key,rec);
  });
  return sortRecommendationsByPriority(Array.from(byKey.values()));
}
