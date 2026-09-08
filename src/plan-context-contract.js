(function(root,factory){
  const node=typeof module==='object'&&module.exports;
  const api=factory(node?require('./plan-v2.js'):root.PlanV2,node?require('./discussion-workbench.js'):root.DiscussionWorkbench);
  if(node)module.exports=api;else root.PlanContextContract=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(Plan,Discussion){
  'use strict';
  const HASH_CONTRACT='plan-definition.sha256.v1';
  const clone=Plan.clone,stable=Plan.stable,array=value=>Array.isArray(value)?value:[];
  // Synchronous SHA-256 keeps all Preview/Confirm read guards deterministic in browser and Node.
  function sha256(text){
    const bytes=new TextEncoder().encode(text),length=Math.ceil((bytes.length+9)/64)*64,data=new Uint8Array(length);
    data.set(bytes);data[bytes.length]=128;const view=new DataView(data.buffer);
    view.setUint32(length-8,Math.floor(bytes.length/0x20000000));view.setUint32(length-4,(bytes.length*8)>>>0);
    const k=[0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2];
    const h=[0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19],w=new Uint32Array(64),rotr=(n,b)=>(n>>>b)|(n<<(32-b));
    for(let offset=0;offset<length;offset+=64){
      for(let i=0;i<16;i++)w[i]=view.getUint32(offset+i*4);
      for(let i=16;i<64;i++){const a=w[i-15],b=w[i-2];w[i]=(w[i-16]+(rotr(a,7)^rotr(a,18)^(a>>>3))+w[i-7]+(rotr(b,17)^rotr(b,19)^(b>>>10)))>>>0}
      let [a,b,c,d,e,f,g,j]=h;
      for(let i=0;i<64;i++){const t1=(j+(rotr(e,6)^rotr(e,11)^rotr(e,25))+((e&f)^(~e&g))+k[i]+w[i])>>>0,t2=((rotr(a,2)^rotr(a,13)^rotr(a,22))+((a&b)^(a&c)^(b&c)))>>>0;j=g;g=f;f=e;e=(d+t1)>>>0;d=c;c=b;b=a;a=(t1+t2)>>>0}
      [a,b,c,d,e,f,g,j].forEach((v,i)=>h[i]=(h[i]+v)>>>0);
    }
    return h.map(n=>n.toString(16).padStart(8,'0')).join('');
  }
  function definition(plan){
    const p=Plan.normalizePlan(plan);
    if(p.planMode==='state_watch'){
      if(!Plan.hasWatchDefinition(p))throw new Error('观察计划缺少完整长期定义');
      return clone(Plan.watchDefinition(p));
    }
    const conditions={};Plan.CONDITION_CATEGORIES.forEach(key=>conditions[key]=p.conditions[key].map(item=>item.text));
    return {planMode:p.planMode,action:p.action,triggerPrice:p.triggerPrice,triggerDirection:p.triggerDirection,quantity:p.quantity,conditions,allocationConstraint:clone(p.allocationConstraint),validUntil:p.validUntil,nextReviewDate:p.nextReviewDate,note:p.note};
  }
  function definitionRef(plan){return {planId:plan.id,definitionHash:`sha256:${sha256(stable(definition(plan)))}`,hashContractVersion:HASH_CONTRACT}}
  function readableDefinitionRef(plan){try{return definitionRef(plan)}catch(_error){return null}}
  const V4_HASH_CONTRACT='plan-v4-definition.sha256.v1';
  function definitionRefFor(state,plan){
    const record=state?.planDefinitionsV4?.byId?.[plan.id];if(!record)return readableDefinitionRef(plan);
    const revision=record.revisions?.at(-1);
    if(!revision||revision.hashContractVersion!==V4_HASH_CONTRACT||stable(revision.definition.rules)!==stable(definition(plan))||revision.definitionHash!=='sha256:'+sha256(stable(revision.definition)))throw new Error('V4 长期定义与兼容投影冲突');
    return {planId:plan.id,revisionId:revision.revisionId,definitionHash:revision.definitionHash,hashContractVersion:V4_HASH_CONTRACT};
  }
  function validDefinitionRef(ref,{allowUnknown=false}={}){
    if(!ref||typeof ref.planId!=='string'||!ref.planId)return false;
    const v4=ref.hashContractVersion===V4_HASH_CONTRACT,keys=v4?'definitionHash,hashContractVersion,planId,revisionId':'definitionHash,hashContractVersion,planId';
    return Object.keys(ref).sort().join(',')===keys&&(v4?typeof ref.revisionId==='string'&&!!ref.revisionId:ref.hashContractVersion===HASH_CONTRACT)&&(/^sha256:[0-9a-f]{64}$/.test(ref.definitionHash)||allowUnknown&&!v4&&ref.definitionHash===null);
  }
  function exactPlan(state,planId){const found=[];for(const stock of array(state&&state.stocks))for(const plan of array(stock.plans))if(plan.id===planId)found.push({stock,plan});return found.length===1?found[0]:null}
  function binding(state,historicalRef,legacy={},reviewApi){
    const planId=historicalRef?.planId||legacy.planId,found=exactPlan(state,planId);let currentRef=null;
    try{if(found)currentRef=definitionRefFor(state,found.plan)}catch(_error){}
    const result={planId,currentDefinitionRef:currentRef,historicalDefinitionRef:clone(historicalRef||null),hashContractVersion:currentRef?.hashContractVersion||historicalRef?.hashContractVersion||HASH_CONTRACT,legacyCompatibility:null,bindingStatus:'missing'};
    if(!found)return result;
    if(!currentRef)return {...result,bindingStatus:'legacy_unknown'};
    if(historicalRef){result.bindingStatus=!validDefinitionRef(historicalRef)?'legacy_unknown':stable(historicalRef)===stable(currentRef)?'current':'changed';return result}
    if(legacy.planVersion!==undefined||legacy.sourcePlanVersion!==undefined){
      const version=legacy.planVersion??legacy.sourcePlanVersion,hash=legacy.planSnapshotHash??legacy.sourcePlanSnapshotHash;
      const match=version===found.plan.planVersion&&(!hash||Boolean(reviewApi&&reviewApi.planSnapshotHash(found.plan)===hash));
      result.legacyCompatibility={planVersion:version,planSnapshotHash:hash||null,matches:match};
      // Old state-watch hashes omit rules; old price hashes include observation. Never silently rebind.
      result.bindingStatus=version!==found.plan.planVersion?'changed':'legacy_unknown';
    }else result.bindingStatus='legacy_unknown';
    return result;
  }
  function holding(stock){const raw=stock?.shares,shares=raw===null||raw===undefined||raw===''?null:Number(raw);return {shares:Number.isFinite(shares)&&shares>=0?shares:null,avgCost:stock?.avgCost??null}}
  function applicability(stock,plan,now=new Date()){
    const facts=holding(stock),reasons=[];let status='applicable';
    const p=Plan.normalizePlan(plan),held=facts.shares>0,today=Discussion.localCalendarDate(now);
    if(facts.shares===null)return {status:'unknown',reasons:['holding_unknown']};
    if(p.status!=='active'||['invalid','completed'].includes(p.validityStatus))reasons.push('plan_inactive');
    if(p.validUntil&&p.validUntil<today)reasons.push('plan_expired');
    const heldOnly=p.planMode==='state_watch'?['add_review','reduce_review','risk_control'].includes(p.reviewAction):['add','sell','reduce'].includes(p.action);
    if(heldOnly&&!held)reasons.push('holding_required');
    if(['sell','reduce'].includes(p.action)&&p.quantity!==null&&p.quantity>facts.shares)reasons.push('quantity_exceeds_holding');
    const cap=Number(p.allocationConstraint?.maxPositionPct),weight=Number(stock?.currentWeight);
    if(['buy','add'].includes(p.action)&&cap>0&&Number.isFinite(weight)&&weight>cap)reasons.push('allocation_exceeded');
    if(reasons.length)status='blocked';return {status,reasons};
  }
  function evidenceRef(stock,state,options={}){
    const snapshot=Discussion.technicalSnapshot(stock),refs=Discussion.references(stock,{...options,state});
    return {symbol:Discussion.canonical(stock),technicalAnchor:clone(snapshot.anchorBar),reviewHash:snapshot.reviewHash,holding:holding(stock),longTermLogic:clone(refs.longTermLogic),modules:clone(refs.modules)};
  }
  function applicabilityFor(state,stock,plan,now){
    const result=applicability(stock,plan,now),intent=state?.planDefinitionsV4?.byId?.[plan.id]?.revisions.at(-1)?.definition.actionIntent;
    if(intent==='entry'&&holding(stock).shares>0)return {status:'blocked',reasons:[...result.reasons,'entry_requires_zero_position']};
    return result;
  }
  function evidenceFreshness(stock,historical,state,options={}){
    if(!historical)return {status:'unknown',reasons:['legacy_evidence_unavailable']};
    const current=evidenceRef(stock,state,options),reasons=[];
    if(!current.technicalAnchor.date||!(current.technicalAnchor.close>0))return {status:'unknown',reasons:['technical_anchor_unavailable']};
    for(const key of ['symbol','technicalAnchor','reviewHash','longTermLogic','modules'])if(stable(current[key])!==stable(historical[key]))reasons.push(key+'_changed');
    if(historical.holding?.shares===null||historical.holding?.shares===undefined)reasons.push('holding_unknown');
    else if((historical.holding.shares>0)!==(current.holding.shares>0))reasons.push('holding_status_changed');
    if(stable(historical.holding?.avgCost)!==stable(current.holding.avgCost))reasons.push('holding_cost_changed');
    if(['stale','anomaly','unavailable'].includes(stock.technicalData?.technicalDataStatus))reasons.push('technical_not_current');
    for(const date of [stock.technicalData?.technicalAsOf,stock.technicalIndicators?.last_trade_date])if(date&&date!==current.technicalAnchor.date)reasons.push('technical_date_mismatch');
    if(['stale','failed'].includes(stock.marketDataFreshness?.kline_status))reasons.push('market_evidence_not_current');
    if(!reasons.length&&stock.technicalData?.technicalDataStatus!=='fresh')return {status:'unknown',reasons:['technical_status_unknown']};
    return {status:reasons.length?'stale':'current',reasons};
  }
  function currentStateEvidence(current){
    if(!current)return null;const refs=current.references;
    return {symbol:current.symbol,technicalAnchor:clone(current.technicalSnapshot.anchorBar),reviewHash:current.technicalSnapshot.reviewHash,holding:{shares:refs.holding.shares,avgCost:refs.holding.avgCost},longTermLogic:clone(refs.longTermLogic),modules:clone(refs.modules)};
  }
  function context(state,stockId,options={}){
    const stock=array(state.stocks).find(item=>item.id===stockId);if(!stock)throw new Error('找不到标的');
    const current=stock.discussionState?.current||null,evidence=evidenceRef(stock,state,options);
    return {schemaVersion:'plan-discussion.context.v1',stockId,symbol:Discussion.canonical(stock),holding:holding(stock),evidence,technicalAnchor:evidence.technicalAnchor,factsAsOf:evidence.technicalAnchor.date,plans:array(stock.plans).map(plan=>({planId:plan.id,definitionRef:definitionRefFor(state,plan),applicability:applicabilityFor(state,stock,plan,options.now),bindingStatus:definitionRefFor(state,plan)?'current':'legacy_unknown'})),assessmentRefs:Discussion.references(stock,{...options,state}).planReviews.map(review=>({...review,...assessmentStatus(state,'review:'+review.reviewId,review,options.planReviewApi)})),currentStateRef:current?{stateId:current.stateId,sourceDiscussionVersion:current.sourceDiscussionVersion}:null,sourceSignal:clone(options.sourceSignal||null)};
  }

  const ASSESSMENT_STORE='plan-assessment-bindings.v1';
  function assessmentStore(state){return state.planAssessmentBindings||{schemaVersion:ASSESSMENT_STORE,byId:{}}}
  function captureAssessment(state,id,plan,stock){
    const ref=definitionRefFor(state,plan);if(!ref)return false;
    if(!state.planAssessmentBindings)state.planAssessmentBindings={schemaVersion:ASSESSMENT_STORE,byId:{}};
    state.planAssessmentBindings.byId[id]={definitionRef:ref,evidenceRef:evidenceRef(stock,state)};return true;
  }
  function validateAssessmentStore(value){
    if(!value||value.schemaVersion!==ASSESSMENT_STORE||!value.byId||typeof value.byId!=='object'||Array.isArray(value.byId)||Object.keys(value).some(k=>!['schemaVersion','byId'].includes(k)))throw new Error('Plan assessment binding store 无效');
    for(const [id,item] of Object.entries(value.byId)){
      if(!id||!item||Object.keys(item).sort().join(',')!=='definitionRef,evidenceRef')throw new Error('Assessment binding 无效');
      const ref=item.definitionRef,e=item.evidenceRef;
      if(!validDefinitionRef(ref)||!e||!e.symbol||!e.technicalAnchor||!e.holding||!e.modules||!e.longTermLogic)throw new Error('Assessment evidence 无效');
      const keys=(v,expected)=>v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).sort().join(',')===expected.split(',').sort().join(',');
      if(!keys(e,'symbol,technicalAnchor,reviewHash,holding,longTermLogic,modules')||typeof e.symbol!=='string'||typeof e.reviewHash!=='string'||!keys(e.technicalAnchor,'date,close,adjustment,priceBasis,provider')||typeof e.technicalAnchor.date!=='string'||e.technicalAnchor.close!==null&&(!Number.isFinite(e.technicalAnchor.close)||e.technicalAnchor.close<=0)||!keys(e.holding,'shares,avgCost')||e.holding.shares!==null&&(!Number.isFinite(e.holding.shares)||e.holding.shares<0)||!keys(e.longTermLogic,'updatedAt,logicStatus,hash')||!keys(e.modules,'news,fundamental,valuation'))throw new Error('Assessment evidence 快照结构无效');
      for(const module of Object.values(e.modules))if(!keys(module,'updatedAt,hash')||typeof module.updatedAt!=='string'||typeof module.hash!=='string')throw new Error('Assessment 研究引用无效');
    }
    return true;
  }
  function assessmentStatus(state,id,legacy,reviewApi){
    const proof=assessmentStore(state).byId[id],bound=binding(state,proof?.definitionRef,legacy,reviewApi),found=exactPlan(state,bound.planId);
    return {...bound,evidenceFreshness:found?evidenceFreshness(found.stock,proof?.evidenceRef,state):{status:'unknown',reasons:['missing_plan']},applicability:found?applicabilityFor(state,found.stock,found.plan):{status:'unknown',reasons:['missing_plan']}};
  }
  function runtimeContext(state,stock,plan){
    const current=stock.discussionState?.current;
    if(!current||!Discussion.validateState(current).ok)throw new Error('请先完成一次个股讨论并整理结论。');
    const freshness=evidenceFreshness(stock,currentStateEvidence(current),state),applies=applicabilityFor(state,stock,plan);
    if(freshness.status!=='current'||applies.status!=='applicable')throw new Error('当前事实与结论不再适用，请先重新讨论：'+[...freshness.reasons,...applies.reasons].join('、'));
    const evidence=evidenceRef(stock,state);
    // A quantity change alone is not a conflict. Concrete quantity limits are checked above.
    return {definitionRef:definitionRefFor(state,plan),evidence:{...evidence,holding:{avgCost:evidence.holding.avgCost,held:evidence.holding.shares>0}},applicability:applies};
  }
  function assessmentLabel(result){const b={current:'定义一致',changed:'定义已变化',missing:'原计划缺失',legacy_unknown:'旧定义绑定待复核'},e={current:'证据仍适用',stale:'证据已变化',unknown:'证据来源待复核'},a={applicable:'当前适用',blocked:'当前不适用',unknown:'适用性待核对'};return [b[result.bindingStatus],e[result.evidenceFreshness.status],a[result.applicability.status]].join(' · ')}
  return Object.freeze({assessmentLabel,ASSESSMENT_STORE,assessmentStore,captureAssessment,validateAssessmentStore,assessmentStatus,runtimeContext,HASH_CONTRACT,sha256,definition,definitionRef,definitionRefFor,validDefinitionRef,V4_HASH_CONTRACT,readableDefinitionRef,exactPlan,binding,holding,applicability,applicabilityFor,evidenceRef,evidenceFreshness,currentStateEvidence,context,clone,stable});
});
