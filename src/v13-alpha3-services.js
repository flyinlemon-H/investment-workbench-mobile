const V13_PROCESSING_RESULT_TYPES=['modify_plan','record_operation_result'];
const V13_PROCESSING_RESULT_LABELS={
  modify_plan:'调整计划',
  record_operation_result:'记录操作结果'
};

const V13ProcessingResultSession={
  current:null
};

function v13Alpha3Object(value){
  return value&&typeof value==='object'&&!Array.isArray(value)?value:{};
}
function v13Alpha3Array(value){
  return Array.isArray(value)?value:[];
}
function v13Alpha3String(value){
  return value===null||value===undefined?'':String(value);
}
function v13Alpha3Clone(value){
  if(value===null||value===undefined)return value;
  try{return JSON.parse(JSON.stringify(value))}catch(_err){return value}
}

const RecommendationQueryService={
  getRecommendations(stock){
    const cm=v13Alpha3Object(stock&&stock.coreModel);
    return v13Alpha3Array(cm.recommendations).map(v13Alpha3Clone);
  },
  getPrimaryRecommendations(stock){
    const cm=v13Alpha3Object(stock&&stock.coreModel);
    return v13Alpha3Array(cm.primaryRecommendations).map(v13Alpha3Clone);
  },
  getSecondaryRecommendations(stock){
    const cm=v13Alpha3Object(stock&&stock.coreModel);
    return v13Alpha3Array(cm.secondaryRecommendations).map(v13Alpha3Clone);
  },
  getRecommendationById(stock,recommendationId){
    const id=v13Alpha3String(recommendationId);
    const all=[
      ...this.getPrimaryRecommendations(stock),
      ...this.getSecondaryRecommendations(stock),
      ...this.getRecommendations(stock)
    ];
    return all.find(item=>v13Alpha3String(item&&item.id)===id)||null;
  }
};

const PlanQueryService={
  getPlanSnapshot(stock,recommendation){
    const rec=v13Alpha3Object(recommendation);
    const linkedPlanId=v13Alpha3String(rec.linkedPlanId);
    if(!linkedPlanId)return null;
    const cm=v13Alpha3Object(stock&&stock.coreModel);
    const plan=v13Alpha3Array(cm.plans).find(item=>v13Alpha3String(item&&item.id)===linkedPlanId);
    return plan?v13Alpha3Clone(plan):null;
  },
  getPlanSnapshots(stock){
    const cm=v13Alpha3Object(stock&&stock.coreModel);
    return v13Alpha3Array(cm.plans).map(v13Alpha3Clone);
  }
};

const RiskQueryService={
  getRiskSnapshot(stock){
    const cm=v13Alpha3Object(stock&&stock.coreModel);
    return v13Alpha3Clone(cm.riskState||stock&&stock.riskManagement||null);
  }
};

const TechnicalFactsQueryService={
  getTechnicalFactsSnapshot(stock){
    const technicalReview=v13Alpha3Object(stock&&stock.technicalReview);
    const technicalData=v13Alpha3Object(stock&&stock.technicalData);
    const facts=[];
    const add=value=>{
      const text=v13Alpha3String(value).trim();
      if(text&&!facts.includes(text))facts.push(text);
    };
    add(technicalReview.finalTechnicalConclusion);
    add(technicalReview.shortTermTechnical&&technicalReview.shortTermTechnical.trendStatus);
    add(technicalData.trendStatus);
    v13Alpha3Array(technicalReview.shortTermTechnical&&technicalReview.shortTermTechnical.riskFlags).forEach(add);
    v13Alpha3Array(technicalData.riskFlags).forEach(add);
    return {
      facts,
      technicalReview:v13Alpha3Clone(technicalReview),
      technicalData:v13Alpha3Clone(technicalData)
    };
  }
};

const DecisionReviewService={
  buildContext(stock,recommendationId){
    const recommendation=RecommendationQueryService.getRecommendationById(stock,recommendationId);
    if(!stock||!recommendation)return null;
    const cm=v13Alpha3Object(stock.coreModel);
    return {
      stock:{
        id:v13Alpha3String(stock.id),
        code:v13Alpha3String(stock.code||stock.symbol),
        name:v13Alpha3String(stock.name),
        type:v13Alpha3String(stock.type)
      },
      recommendation:v13Alpha3Clone(recommendation),
      primaryRecommendations:RecommendationQueryService.getPrimaryRecommendations(stock),
      secondaryRecommendations:RecommendationQueryService.getSecondaryRecommendations(stock),
      plan:PlanQueryService.getPlanSnapshot(stock,recommendation),
      plans:PlanQueryService.getPlanSnapshots(stock),
      risk:RiskQueryService.getRiskSnapshot(stock),
      technicalFacts:TechnicalFactsQueryService.getTechnicalFactsSnapshot(stock),
      positionFacts:v13Alpha3Clone(cm.position||null),
      informationCompleteness:v13Alpha3Clone(stock.informationCompleteness||null),
      priceSnapshot:v13Alpha3Clone(cm.priceSnapshot||null)
    };
  }
};

const ProcessingResultService={
  createSessionResult(input={}){
    const resultType=v13Alpha3String(input.resultType);
    if(!V13_PROCESSING_RESULT_TYPES.includes(resultType)){
      throw new Error('Unsupported ProcessingResult type');
    }
    return {
      objectType:'ProcessingResult',
      lifecycle:'session',
      resultType,
      resultLabel:V13_PROCESSING_RESULT_LABELS[resultType]||resultType,
      note:v13Alpha3String(input.note),
      stockId:v13Alpha3String(input.stockId),
      recommendationId:v13Alpha3String(input.recommendationId),
      createdAt:(typeof v13NowIso==='function'?v13NowIso():new Date().toISOString())
    };
  },
  setCurrent(result){
    V13ProcessingResultSession.current=v13Alpha3Clone(result);
    return V13ProcessingResultSession.current;
  },
  getCurrent(){
    return v13Alpha3Clone(V13ProcessingResultSession.current);
  },
  clearCurrent(){
    V13ProcessingResultSession.current=null;
  }
};

const V13_DECISION_RECORD_VERSION='v13.alpha3.sprint3';

function v13DecisionRecordId(){
  return `decision-record-${Date.now().toString(36)}-${Math.random().toString(36).slice(2,8)}`;
}
function v13ProcessingResultIsValid(result){
  return Boolean(result&&typeof result==='object'&&V13_PROCESSING_RESULT_TYPES.includes(v13Alpha3String(result.resultType)));
}
function v13DecisionRecordList(targetState){
  const stateRef=targetState||(typeof state==='object'?state:null);
  if(!stateRef)return [];
  if(!Array.isArray(stateRef.decisionRecords))stateRef.decisionRecords=[];
  return stateRef.decisionRecords;
}
function v13DecisionRecordText(value,fallback='暂无完整依据'){
  const text=v13Alpha3String(value).trim();
  return text||fallback;
}
function v13DecisionRecordTechnicalCheck(context){
  const facts=context&&context.technicalFacts;
  const list=v13Alpha3Array(facts&&facts.facts);
  return {
    summary:list.length?list.join('；'):'暂无完整依据',
    facts:list
  };
}
function v13DecisionRecordPriceCheck(context){
  const price=context&&context.priceSnapshot;
  return {
    price:price&&price.price!==undefined?price.price:null,
    updatedAt:v13Alpha3String(price&&price.updatedAt),
    summary:price&&price.price!==undefined&&price.price!==null?`当前价格 ${price.price}`:'暂无完整依据'
  };
}
function v13DecisionRecordPlanCheck(context){
  const plan=context&&context.plan;
  return {
    planId:v13Alpha3String(plan&&plan.id),
    planType:v13Alpha3String(plan&&plan.planType),
    action:v13Alpha3String(plan&&plan.action),
    triggerPrice:plan&&plan.triggerPrice!==undefined?plan.triggerPrice:(plan&&plan.price!==undefined?plan.price:null),
    summary:plan?v13DecisionRecordText(plan.name||plan.title||plan.note||plan.id):'暂无关联计划'
  };
}
function v13DecisionRecordPositionCheck(context){
  const position=context&&context.positionFacts;
  return {
    summary:position?'持仓快照已纳入复核上下文':'暂无完整依据',
    position:v13Alpha3Clone(position||null)
  };
}

const DecisionRecordService={
  createFromProcessingResult(processingResult,reviewContext){
    if(!v13ProcessingResultIsValid(processingResult))return null;
    const rec=v13Alpha3Object(reviewContext&&reviewContext.recommendation);
    const now=typeof v13NowIso==='function'?v13NowIso():new Date().toISOString();
    return {
      id:v13DecisionRecordId(),
      recommendationId:v13Alpha3String(processingResult.recommendationId||rec.id),
      recommendationType:v13Alpha3String(rec.type),
      recommendationPriority:v13Alpha3String(rec.priority),
      processingLevel:v13Alpha3String(processingResult.resultType),
      reviewSummary:v13DecisionRecordText(processingResult.note||rec.reason),
      technicalCheck:v13DecisionRecordTechnicalCheck(reviewContext),
      priceCheck:v13DecisionRecordPriceCheck(reviewContext),
      planCheck:v13DecisionRecordPlanCheck(reviewContext),
      positionCheck:v13DecisionRecordPositionCheck(reviewContext),
      processingResult:v13Alpha3Clone(processingResult),
      createdAt:now,
      createdBy:'user',
      version:V13_DECISION_RECORD_VERSION
    };
  },
  append(record,targetState){
    if(!record||!record.id)return null;
    const records=v13DecisionRecordList(targetState);
    records.push(v13Alpha3Clone(record));
    if(typeof saveState==='function')saveState();
    return v13Alpha3Clone(record);
  },
  appendFromProcessingResult(processingResult,reviewContext,targetState){
    const record=this.createFromProcessingResult(processingResult,reviewContext);
    if(!record)return null;
    return this.append(record,targetState);
  },
  getAll(targetState){
    return v13DecisionRecordList(targetState).map(v13Alpha3Clone);
  },
  getByRecommendation(recommendationId,targetState){
    const id=v13Alpha3String(recommendationId);
    return this.getAll(targetState)
      .filter(record=>v13Alpha3String(record&&record.recommendationId)===id)
      .sort((a,b)=>v13Alpha3String(b.createdAt).localeCompare(v13Alpha3String(a.createdAt)));
  },
  getLatestByRecommendation(recommendationId,targetState){
    return this.getByRecommendation(recommendationId,targetState)[0]||null;
  }
};

const V13_DECISION_STATE_VERSION='v13.alpha3.sprint4';
const V13_DECISION_STATE_VALUES=['pending_review','reviewing','result_formed','cooling','closed','retriggered'];

function v13DecisionStateId(recommendationId){
  return `decision-state-${v13Alpha3String(recommendationId)||Date.now().toString(36)}`;
}
function v13DecisionStateList(targetState){
  const stateRef=targetState||(typeof state==='object'?state:null);
  if(!stateRef)return [];
  if(!Array.isArray(stateRef.decisionStates))stateRef.decisionStates=[];
  return stateRef.decisionStates;
}
function v13DecisionStateIsAllowed(value){
  return V13_DECISION_STATE_VALUES.includes(v13Alpha3String(value));
}
function v13DecisionStateNow(){
  return typeof v13NowIso==='function'?v13NowIso():new Date().toISOString();
}

const DecisionStateService={
  create(input={}){
    const recommendationId=v13Alpha3String(input.recommendationId);
    if(!recommendationId)return null;
    const currentState=v13DecisionStateIsAllowed(input.currentState)?v13Alpha3String(input.currentState):'pending_review';
    return {
      id:v13Alpha3String(input.id)||v13DecisionStateId(recommendationId),
      recommendationId,
      currentState,
      processingLevel:v13Alpha3String(input.processingLevel),
      lastDecisionRecordId:v13Alpha3String(input.lastDecisionRecordId),
      coolingUntil:v13Alpha3String(input.coolingUntil),
      retriggerReason:v13Alpha3String(input.retriggerReason),
      updatedAt:v13Alpha3String(input.updatedAt)||v13DecisionStateNow(),
      version:V13_DECISION_STATE_VERSION
    };
  },
  upsert(input={},targetState){
    const next=this.create(input);
    if(!next)return null;
    const states=v13DecisionStateList(targetState);
    const index=states.findIndex(item=>v13Alpha3String(item&&item.recommendationId)===next.recommendationId);
    if(index>=0){
      states[index]={
        ...states[index],
        ...next,
        id:v13Alpha3String(states[index].id)||next.id,
        updatedAt:v13DecisionStateNow(),
        version:V13_DECISION_STATE_VERSION
      };
    }else{
      states.push(next);
    }
    if(typeof saveState==='function')saveState();
    return this.getByRecommendation(next.recommendationId,targetState);
  },
  markReviewing(recommendationId,targetState){
    const current=this.getByRecommendation(recommendationId,targetState);
    if(current&&['result_formed','cooling','closed'].includes(current.currentState))return current;
    const latestRecord=typeof DecisionRecordService==='object'&&DecisionRecordService&&typeof DecisionRecordService.getLatestByRecommendation==='function'
      ? DecisionRecordService.getLatestByRecommendation(recommendationId,targetState)
      : null;
    return this.upsert({
      ...(current||{}),
      recommendationId,
      currentState:'reviewing',
      lastDecisionRecordId:v13Alpha3String(latestRecord&&latestRecord.id)||v13Alpha3String(current&&current.lastDecisionRecordId)
    },targetState);
  },
  markResultFormed(record,targetState){
    if(!record||!record.id||!record.recommendationId)return null;
    return this.upsert({
      recommendationId:record.recommendationId,
      currentState:'result_formed',
      processingLevel:record.processingLevel,
      lastDecisionRecordId:record.id
    },targetState);
  },
  getAll(targetState){
    return v13DecisionStateList(targetState).map(v13Alpha3Clone);
  },
  getByRecommendation(recommendationId,targetState){
    const id=v13Alpha3String(recommendationId);
    return this.getAll(targetState).find(item=>v13Alpha3String(item&&item.recommendationId)===id)||null;
  }
};
