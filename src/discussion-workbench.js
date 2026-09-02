(function(root,factory){
  const api=factory(
    typeof module==='object'&&module.exports?require('./symbol-identity.js'):root&&root.SymbolIdentity,
    typeof module==='object'&&module.exports?require('./plan-v2.js'):root&&root.PlanV2
  );
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.DiscussionWorkbench=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(SymbolIdentity,PlanV2){
  'use strict';

  const STORE_SCHEMA_VERSION='stock-discussion.store.v1';
  const LEGACY_STATE_SCHEMA_VERSION='stock-discussion.state.v1';
  const STATE_SCHEMA_VERSION='stock-discussion.state.v2';
  const CONTEXT_SCHEMA_VERSION='stock-discussion.context.v2';
  const HISTORY_LIMIT=30;
  const INCREMENTAL_LIMIT=120;
  const BOOTSTRAP_FRESH_LIMIT=30;
  const BOOTSTRAP_STALE_LIMIT=45;
  const CONFIDENCE_LEVELS=Object.freeze(['high','medium','low']);
  const ACTION_CATEGORIES=Object.freeze(['risk_control','reduce_review','hold_watch','wait_confirmation','add_review','entry_review','no_action']);
  const ACTION_PRIORITIES=Object.freeze(['high','medium','low']);
  const ATTENTION_LEVELS=Object.freeze(['normal','focused','window']);
  const TREND_STATUSES=Object.freeze(['uptrend','downtrend','sideways','recovery','rebound','unclear']);
  const STRUCTURE_TYPES=Object.freeze(['top','bottom','breakout','pullback','recovery','consolidation','none','unclear']);
  const STRUCTURE_STATUSES=Object.freeze(['forming','confirmed','valid','broken','unclear']);
  const STRUCTURE_SOURCES=Object.freeze(['program','external_software','ai_chart_judgment','user_provided']);
  const PLAN_RELATION_STATUSES=Object.freeze(['aligned','conflict','no_matching_plan','neutral']);

  const object=value=>value&&typeof value==='object'&&!Array.isArray(value)?value:{};
  const array=value=>Array.isArray(value)?value:[];
  const text=value=>String(value??'').trim();
  const number=value=>Number.isFinite(Number(value))?Number(value):null;
  const clone=value=>value===undefined?undefined:JSON.parse(JSON.stringify(value));
  const uniqueStrings=(value,limit=12)=>Array.from(new Set(array(value).map(text).filter(Boolean))).slice(0,limit);
  const stable=value=>PlanV2&&typeof PlanV2.stable==='function'?PlanV2.stable(value):JSON.stringify(value,Object.keys(object(value)).sort());
  const fallbackHash=value=>{let result=2166136261,input=typeof value==='string'?value:JSON.stringify(value);for(let i=0;i<input.length;i++){result^=input.charCodeAt(i);result=Math.imul(result,16777619)}return (result>>>0).toString(16).padStart(8,'0')};
  const hash=value=>PlanV2&&typeof PlanV2.hash==='function'?PlanV2.hash(value):fallbackHash(value);
  const canonical=value=>{
    if(SymbolIdentity&&typeof SymbolIdentity.stockSymbol==='function'&&value&&typeof value==='object')return text(SymbolIdentity.stockSymbol(value));
    if(SymbolIdentity&&typeof SymbolIdentity.canonicalSymbol==='function')return text(SymbolIdentity.canonicalSymbol(value));
    return text(value&&typeof value==='object'?(value.code||value.symbol):value).toUpperCase();
  };
  const validDate=value=>{
    const date=text(value);
    if(!/^\d{4}-\d{2}-\d{2}$/.test(date))return '';
    const parsed=new Date(`${date}T00:00:00Z`);
    return Number.isFinite(parsed.getTime())&&parsed.toISOString().slice(0,10)===date?date:'';
  };
  function localCalendarDate(value=new Date(),options={}){
    const date=value instanceof Date?value:new Date(value);
    if(!Number.isFinite(date.getTime()))return '';
    try{
      const parts=new Intl.DateTimeFormat('en-CA',{timeZone:options.timeZone||'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(date);
      const pick=type=>parts.find(part=>part.type===type)?.value||'';
      return `${pick('year')}-${pick('month')}-${pick('day')}`;
    }catch(_error){return date.toISOString().slice(0,10)}
  }
  function dateValue(value){const raw=text(value);if(!raw)return '';const parsed=new Date(raw);return Number.isFinite(parsed.getTime())?parsed.toISOString():''}
  function priceBar(row){
    const source=object(row),date=validDate(source.date),close=number(source.close);
    if(!date||!(close>0)||source.is_complete_bar===false)return null;
    return {date,close,adjustment:text(source.adjustment)||'unknown',priceBasis:text(source.price_basis||source.priceBasis)||'unknown',provider:text(source.provider)||'unknown'};
  }
  function normalizedBars(stock){
    const byDate=new Map();
    array(stock&&stock.priceHistory).forEach(row=>{const bar=priceBar(row);if(bar)byDate.set(bar.date,bar)});
    return Array.from(byDate.values()).sort((a,b)=>a.date.localeCompare(b.date));
  }
  function requestMetrics(request){
    const value=String(request??''),bytes=typeof TextEncoder==='function'?new TextEncoder().encode(value).length:Buffer.byteLength(value,'utf8');
    return {characters:value.length,bytes,kilobytes:Number((bytes/1024).toFixed(1)),approxTokens:Math.ceil(value.length/2.2)};
  }
  function defaultStore(){return {schemaVersion:STORE_SCHEMA_VERSION,current:null,history:[]}}
  function normalizeAnchor(value){
    const source=object(value),date=validDate(source.date),close=number(source.close);
    return {date,close:close>0?close:null,adjustment:text(source.adjustment)||'unknown',priceBasis:text(source.priceBasis||source.price_basis)||'unknown',provider:text(source.provider)||'unknown'};
  }
  function normalizeTechnicalSnapshot(value){
    const source=object(value),event=object(source.priceActionEvent);
    return {
      trendStatus:text(source.trendStatus),cyclePosition:text(source.cyclePosition),supportLevels:array(source.supportLevels).map(number).filter(value=>value!==null).slice(0,4),resistanceLevels:array(source.resistanceLevels).map(number).filter(value=>value!==null).slice(0,4),riskFlags:uniqueStrings(source.riskFlags,8),summary:text(source.summary),confidence:CONFIDENCE_LEVELS.includes(text(source.confidence))?text(source.confidence):'low',
      priceActionEvent:{detected:Boolean(event.detected),type:text(event.type),eventReason:text(event.eventReason)},anchorBar:normalizeAnchor(source.anchorBar),reviewUpdatedAt:dateValue(source.reviewUpdatedAt),reviewHash:text(source.reviewHash)
    };
  }
  function normalizeReferences(value){
    const source=object(value),technical=object(source.technical),holding=object(source.holding),logic=object(source.longTermLogic),modules=object(source.modules);
    return {
      technical:{technicalAsOf:validDate(technical.technicalAsOf),latestCompleteBar:validDate(technical.latestCompleteBar),reviewUpdatedAt:dateValue(technical.reviewUpdatedAt),reviewHash:text(technical.reviewHash),anchorBar:normalizeAnchor(technical.anchorBar)},
      plans:array(source.plans).map(item=>({id:text(item&&item.id),planVersion:Number(item&&item.planVersion)||1,snapshotHash:text(item&&item.snapshotHash),status:text(item&&item.status),validityStatus:text(item&&item.validityStatus)})).filter(item=>item.id).slice(0,12),
      planReviews:array(source.planReviews).map(item=>({reviewId:text(item&&item.reviewId),planId:text(item&&item.planId),planVersion:Number(item&&item.planVersion)||1,reviewedAt:dateValue(item&&item.reviewedAt),planSnapshotHash:text(item&&item.planSnapshotHash),freshness:text(item&&item.freshness)})).filter(item=>item.reviewId&&item.planId).slice(0,12),
      holding:{shares:number(holding.shares),avgCost:number(holding.avgCost),role:text(holding.role),type:text(holding.type),hash:text(holding.hash)},
      longTermLogic:{updatedAt:dateValue(source.longTermLogic&&source.longTermLogic.updatedAt),logicStatus:text(source.longTermLogic&&source.longTermLogic.logicStatus),hash:text(source.longTermLogic&&source.longTermLogic.hash)},
      allocation:{status:'unconfirmed'},
      modules:{news:{updatedAt:text(modules.news&&modules.news.updatedAt),hash:text(modules.news&&modules.news.hash)},fundamental:{updatedAt:text(modules.fundamental&&modules.fundamental.updatedAt),hash:text(modules.fundamental&&modules.fundamental.hash)},valuation:{updatedAt:text(modules.valuation&&modules.valuation.updatedAt),hash:text(modules.valuation&&modules.valuation.hash)}}
    };
  }
  function normalizeActionAssessment(value){
    const source=object(value);
    return {category:text(source.category),priority:text(source.priority),headline:text(source.headline),reasons:uniqueStrings(source.reasons,5),upgradeConditions:uniqueStrings(source.upgradeConditions,3),downgradeConditions:uniqueStrings(source.downgradeConditions,3)};
  }
  function normalizeTrendAssessment(value){
    const source=object(value);
    return {overall:text(source.overall),timeframes:array(source.timeframes).slice(0,3).map(item=>({timeframe:text(item&&item.timeframe),status:text(item&&item.status),explanation:text(item&&item.explanation)}))};
  }
  function normalizeStructureAssessment(value){
    return array(value).slice(0,3).map(item=>({timeframe:text(item&&item.timeframe),type:text(item&&item.type),status:text(item&&item.status),source:text(item&&item.source),sourceAsOf:text(item&&item.sourceAsOf),shortReason:text(item&&item.shortReason)}));
  }
  function normalizePlanRelation(value){const source=object(value);return {status:text(source.status),summary:text(source.summary)}}
  function normalizeLegacyState(value){
    const source=object(value);
    return {
      schemaVersion:LEGACY_STATE_SCHEMA_VERSION,stateId:text(source.stateId),symbol:canonical(source.symbol),sourceDiscussionVersion:text(source.sourceDiscussionVersion),stage:text(source.stage),summary:text(source.summary),keyChanges:uniqueStrings(source.keyChanges),risks:uniqueStrings(source.risks),watchPoints:uniqueStrings(source.watchPoints),planRelation:text(source.planRelation),confidence:CONFIDENCE_LEVELS.includes(text(source.confidence))?text(source.confidence):'low',technicalAsOf:validDate(source.technicalAsOf),confirmedAt:dateValue(source.confirmedAt),confirmedDate:validDate(source.confirmedDate),technicalSnapshot:normalizeTechnicalSnapshot(source.technicalSnapshot),references:normalizeReferences(source.references)
    };
  }
  function normalizeState(value){
    const source=object(value);
    if(source.schemaVersion===LEGACY_STATE_SCHEMA_VERSION)return normalizeLegacyState(source);
    return {
      schemaVersion:STATE_SCHEMA_VERSION,stateId:text(source.stateId),symbol:canonical(source.symbol),sourceDiscussionVersion:text(source.sourceDiscussionVersion),actionAssessment:normalizeActionAssessment(source.actionAssessment),attentionLevel:text(source.attentionLevel),trendAssessment:normalizeTrendAssessment(source.trendAssessment),structureAssessment:normalizeStructureAssessment(source.structureAssessment),stage:text(source.stage),focusPoints:uniqueStrings(source.focusPoints,5),summary:text(source.summary),keyChanges:uniqueStrings(source.keyChanges,5),risks:uniqueStrings(source.risks,5),watchPoints:uniqueStrings(source.watchPoints,5),planRelation:normalizePlanRelation(source.planRelation),confidence:CONFIDENCE_LEVELS.includes(text(source.confidence))?text(source.confidence):'low',technicalAsOf:validDate(source.technicalAsOf),confirmedAt:dateValue(source.confirmedAt),confirmedDate:validDate(source.confirmedDate),technicalSnapshot:normalizeTechnicalSnapshot(source.technicalSnapshot),references:normalizeReferences(source.references)
    };
  }
  function validateLegacyState(value){
    const source=object(value),state=normalizeState(source),errors=[];
    const allowed=['schemaVersion','stateId','symbol','sourceDiscussionVersion','stage','summary','keyChanges','risks','watchPoints','planRelation','confidence','technicalAsOf','confirmedAt','confirmedDate','technicalSnapshot','references'];
    const extra=Object.keys(source).filter(key=>!allowed.includes(key));
    if(extra.length)errors.push(`state contains unknown fields: ${extra.join(', ')}`);
    if(source.schemaVersion!==LEGACY_STATE_SCHEMA_VERSION)errors.push('legacy discussion state schema invalid');
    for(const key of ['stateId','symbol','sourceDiscussionVersion','stage','summary','confirmedAt','confirmedDate'])if(!state[key])errors.push(`${key} missing`);
    if(state.stage.length>40||/[\r\n]/.test(state.stage))errors.push('stage invalid');
    if(state.summary.length>800)errors.push('summary too long');
    if(state.planRelation.length>500)errors.push('planRelation too long');
    for(const key of ['keyChanges','risks','watchPoints']){
      if(!Array.isArray(source[key]))errors.push(`${key} must be an array`);
      if(state[key].length>12||state[key].some(item=>item.length>240))errors.push(`${key} invalid`);
    }
    if(!CONFIDENCE_LEVELS.includes(text(source.confidence)))errors.push('confidence invalid');
    if(!state.technicalAsOf||state.technicalAsOf!==state.references.technical.technicalAsOf)errors.push('technical anchor mismatch');
    const anchor=state.technicalSnapshot.anchorBar;
    if(!anchor.date||!(anchor.close>0)||anchor.date!==state.technicalAsOf)errors.push('technical anchor bar invalid');
    if(state.symbol!==canonical(source.symbol))errors.push('symbol invalid');
    return {ok:errors.length===0,errors,state};
  }
  function exactFields(source,allowed,label,errors){
    if(!source||typeof source!=='object'||Array.isArray(source)){errors.push(`${label} invalid`);return}
    const keys=Object.keys(source),extra=keys.filter(key=>!allowed.includes(key)),missing=allowed.filter(key=>!Object.prototype.hasOwnProperty.call(source,key));
    if(extra.length)errors.push(`${label} contains unknown fields: ${extra.join(', ')}`);
    if(missing.length)errors.push(`${label} missing fields: ${missing.join(', ')}`);
  }
  function validStringList(source,key,limit,itemLimit,errors){
    if(!Array.isArray(source[key])){errors.push(`${key} must be an array`);return}
    if(source[key].length>limit||source[key].some(item=>typeof item!=='string'||!item.trim()||item.trim().length>itemLimit))errors.push(`${key} invalid`);
  }
  function validateState(value){
    const source=object(value);
    if(source.schemaVersion===LEGACY_STATE_SCHEMA_VERSION)return validateLegacyState(source);
    const state=normalizeState(source),errors=[];
    const allowed=['schemaVersion','stateId','symbol','sourceDiscussionVersion','actionAssessment','attentionLevel','trendAssessment','structureAssessment','stage','focusPoints','summary','keyChanges','risks','watchPoints','planRelation','confidence','technicalAsOf','confirmedAt','confirmedDate','technicalSnapshot','references'];
    const extra=Object.keys(source).filter(key=>!allowed.includes(key));
    if(extra.length)errors.push(`state contains unknown fields: ${extra.join(', ')}`);
    if(source.schemaVersion!==STATE_SCHEMA_VERSION)errors.push('discussion state schema invalid');
    for(const key of ['stateId','symbol','sourceDiscussionVersion','stage','summary','confirmedAt','confirmedDate'])if(!state[key])errors.push(`${key} missing`);
    if(state.stage.length>40||/[\r\n]/.test(state.stage))errors.push('stage invalid');
    if(state.summary.length>500)errors.push('summary too long');
    for(const [key,limit] of [['focusPoints',5],['keyChanges',5],['risks',5],['watchPoints',5]])validStringList(source,key,limit,240,errors);
    exactFields(source.actionAssessment,['category','priority','headline','reasons','upgradeConditions','downgradeConditions'],'actionAssessment',errors);
    if(!ACTION_CATEGORIES.includes(state.actionAssessment.category))errors.push('action category invalid');
    if(!ACTION_PRIORITIES.includes(state.actionAssessment.priority))errors.push('action priority invalid');
    if(!state.actionAssessment.headline||state.actionAssessment.headline.length>140||/[\r\n]/.test(state.actionAssessment.headline))errors.push('action headline invalid');
    for(const [key,limit] of [['reasons',5],['upgradeConditions',3],['downgradeConditions',3]])validStringList(object(source.actionAssessment),key,limit,200,errors);
    if(!ATTENTION_LEVELS.includes(state.attentionLevel))errors.push('attention level invalid');
    exactFields(source.trendAssessment,['overall','timeframes'],'trendAssessment',errors);
    if(!TREND_STATUSES.includes(state.trendAssessment.overall))errors.push('overall trend invalid');
    if(!Array.isArray(source.trendAssessment&&source.trendAssessment.timeframes)||source.trendAssessment.timeframes.length>3)errors.push('timeframe trends invalid');
    else source.trendAssessment.timeframes.forEach((item,index)=>{exactFields(item,['timeframe','status','explanation'],`timeframe trend ${index+1}`,errors);const normalized=state.trendAssessment.timeframes[index]||{};if(!normalized.timeframe||normalized.timeframe.length>20||!TREND_STATUSES.includes(normalized.status)||!normalized.explanation||normalized.explanation.length>100)errors.push(`timeframe trend ${index+1} invalid`)});
    if(!Array.isArray(source.structureAssessment)||source.structureAssessment.length>3)errors.push('structure assessment invalid');
    else source.structureAssessment.forEach((item,index)=>{exactFields(item,['timeframe','type','status','source','sourceAsOf','shortReason'],`structure ${index+1}`,errors);const normalized=state.structureAssessment[index]||{};if(!normalized.timeframe||normalized.timeframe.length>20||!STRUCTURE_TYPES.includes(normalized.type)||!STRUCTURE_STATUSES.includes(normalized.status)||!STRUCTURE_SOURCES.includes(normalized.source)||normalized.sourceAsOf.length>40||!normalized.shortReason||normalized.shortReason.length>140)errors.push(`structure ${index+1} invalid`)});
    exactFields(source.planRelation,['status','summary'],'planRelation',errors);
    if(!PLAN_RELATION_STATUSES.includes(state.planRelation.status)||!state.planRelation.summary||state.planRelation.summary.length>300)errors.push('planRelation invalid');
    if(!CONFIDENCE_LEVELS.includes(text(source.confidence)))errors.push('confidence invalid');
    if(!state.technicalAsOf||state.technicalAsOf!==state.references.technical.technicalAsOf)errors.push('technical anchor mismatch');
    const anchor=state.technicalSnapshot.anchorBar;
    if(!anchor.date||!(anchor.close>0)||anchor.date!==state.technicalAsOf)errors.push('technical anchor bar invalid');
    if(state.symbol!==canonical(source.symbol))errors.push('symbol invalid');
    return {ok:errors.length===0,errors,state};
  }
  function normalizeStore(value={}){
    const source=object(value),currentValidation=source.current?validateState(source.current):null,current=currentValidation&&currentValidation.ok?currentValidation.state:null;
    const history=array(source.history).map(normalizeState).filter(item=>validateState(item).ok).slice(-HISTORY_LIMIT);
    return {schemaVersion:STORE_SCHEMA_VERSION,current,history};
  }
  function validateStore(value){
    const source=object(value),errors=[];
    if(source.schemaVersion!==STORE_SCHEMA_VERSION)errors.push('discussion store schema invalid');
    if(source.current!==null){const result=validateState(source.current);errors.push(...result.errors)}
    if(!Array.isArray(source.history))errors.push('discussion history must be an array');
    else source.history.forEach(item=>errors.push(...validateState(item).errors));
    if(array(source.history).length>HISTORY_LIMIT)errors.push('discussion history exceeds limit');
    return {ok:errors.length===0,errors};
  }
  function barsAfter(stock,anchor,options={}){
    const symbol=canonical(stock),expected=canonical(options.symbol||stock),anchorDate=validDate(anchor&&anchor.date||anchor),rows=normalizedBars(stock),warnings=[];
    if(!symbol||!expected||symbol!==expected)return {mode:'blocked',bars:[],warnings:['股票代码不一致，无法建立增量上下文。'],message:'股票代码不一致。'};
    if(!rows.length)return {mode:'blocked',bars:[],warnings:['没有可用的完整日线。'],message:'缺少完整日线。'};
    if(!anchorDate){
      const limit=text(stock&&stock.technicalData&&stock.technicalData.technicalDataStatus)==='fresh'?BOOTSTRAP_FRESH_LIMIT:BOOTSTRAP_STALE_LIMIT;
      return {mode:'bootstrap',bars:rows.slice(-limit),warnings:['没有已保存技术锚点，已提供有限历史窗口。'],message:'首次讨论使用有限历史窗口。'};
    }
    if(anchorDate>rows[rows.length-1].date)return {mode:'blocked',bars:[],warnings:['已保存技术日期晚于当前最新完整日线，请先核对数据。'],message:'技术锚点日期异常。'};
    const savedAnchor=normalizeAnchor(anchor),index=rows.findIndex(row=>row.date===anchorDate);
    if(index<0){
      const reason=anchorDate<rows[0].date?'已保存锚点早于当前历史窗口。':'当前历史中找不到已保存锚点，不能假装连续。';
      const limit=text(stock&&stock.technicalData&&stock.technicalData.technicalDataStatus)==='fresh'?BOOTSTRAP_FRESH_LIMIT:BOOTSTRAP_STALE_LIMIT;
      return {mode:'bootstrap',bars:rows.slice(-limit),warnings:[reason],message:'锚点不可验证，改用有限历史窗口。'};
    }
    const currentAnchor=rows[index];
    if(savedAnchor.close>0&&Math.abs(currentAnchor.close-savedAnchor.close)>Math.max(0.0001,savedAnchor.close*0.00001))warnings.push('已保存锚点价格与当前历史不一致，可能发生复权或历史修订。');
    if(savedAnchor.adjustment!=='unknown'&&currentAnchor.adjustment!==savedAnchor.adjustment)warnings.push('复权口径已变化。');
    if(savedAnchor.priceBasis!=='unknown'&&currentAnchor.priceBasis!==savedAnchor.priceBasis)warnings.push('价格口径已变化。');
    const incompatible=warnings.length>0;
    if(savedAnchor.provider!=='unknown'&&currentAnchor.provider!==savedAnchor.provider)warnings.push('锚点数据提供方已变化，但价格与口径仍需结合上述检查。');
    if(incompatible){
      const limit=text(stock&&stock.technicalData&&stock.technicalData.technicalDataStatus)==='fresh'?BOOTSTRAP_FRESH_LIMIT:BOOTSTRAP_STALE_LIMIT;
      return {mode:'bootstrap',bars:rows.slice(-limit),warnings,message:'锚点不再兼容，改用有限历史窗口。'};
    }
    const bars=rows.slice(index+1,index+1+INCREMENTAL_LIMIT);
    let prior=currentAnchor;
    for(const bar of bars){const gap=(Date.parse(`${bar.date}T00:00:00Z`)-Date.parse(`${prior.date}T00:00:00Z`))/86400000;if(gap>10)warnings.push(`${prior.date} 至 ${bar.date} 的日线间隔异常，请核对停牌或数据缺口。`);prior=bar}
    if(rows.length-index-1>INCREMENTAL_LIMIT)warnings.push(`锚点后的日线超过 ${INCREMENTAL_LIMIT} 根，已截断，请重新建立当前结论。`);
    return {mode:'incremental',bars,warnings:uniqueStrings(warnings,6),message:bars.length?`提供锚点后 ${bars.length} 根完整日线。`:'自上次确认后暂无新的完整日K'};
  }
  function technicalSnapshot(stock){
    const td=object(stock&&stock.technicalData),review=object(stock&&stock.technicalReview),short=object(review.shortTermTechnical),bars=normalizedBars(stock),latest=bars[bars.length-1]||null;
    const summary=text(short.technicalSummary||review.finalTechnicalConclusion||td.summary),riskFlags=uniqueStrings(short.riskFlags||td.riskFlags,8),event=object(short.priceActionEvent||review.priceActionEvent||td.priceActionEvent);
    const reviewUpdatedAt=dateValue(review.updatedAt||review.reviewedAt||review.analysisDate);
    return normalizeTechnicalSnapshot({trendStatus:short.trendStatus||td.trendStatus||td.trend,cyclePosition:short.cyclePosition||td.cyclePosition||object(td.pricePosition).cyclePosition,supportLevels:td.supportLevels,resistanceLevels:td.resistanceLevels,riskFlags,summary,confidence:short.confidence||review.confidence||'low',priceActionEvent:{detected:Boolean(event.detected),type:event.type,eventReason:event.eventReason||event.reason},anchorBar:latest,reviewUpdatedAt,reviewHash:`techreview_${hash({reviewUpdatedAt,trendStatus:short.trendStatus,cyclePosition:short.cyclePosition,summary,riskFlags})}`});
  }
  function activePlans(stock){return array(stock&&stock.plans).filter(plan=>text(plan&&plan.status)==='active'&&['active','needs_review'].includes(text(plan&&plan.validityStatus)||'active'))}
  function planReferences(stock,options={}){
    const reviewStore=object(options.planReviewStore||options.state&&options.state.planReviews),planReviewApi=options.planReviewApi||(typeof globalThis!=='undefined'?globalThis.PlanReview:null);
    const plans=activePlans(stock).map(plan=>{
      const normalized=PlanV2&&typeof PlanV2.normalizePlan==='function'?PlanV2.normalizePlan(plan):plan;
      const snapshotHash=planReviewApi&&typeof planReviewApi.planSnapshotHash==='function'?planReviewApi.planSnapshotHash(normalized):`plansnap_${hash(normalized)}`;
      return {id:text(normalized.id),planVersion:Number(normalized.planVersion)||1,snapshotHash,status:text(normalized.status),validityStatus:text(normalized.validityStatus)};
    });
    const planReviews=plans.map(plan=>{
      if(!planReviewApi||typeof planReviewApi.reviewStatusForPlan!=='function')return null;
      const sourcePlan=activePlans(stock).find(item=>text(item.id)===plan.id),status=planReviewApi.reviewStatusForPlan(reviewStore,canonical(stock),sourcePlan);
      return status&&status.review?{reviewId:status.review.reviewId,planId:plan.id,planVersion:status.review.planVersion,reviewedAt:status.review.reviewedAt,planSnapshotHash:status.review.planSnapshotHash,freshness:status.freshness.status}:null;
    }).filter(Boolean);
    return {plans,planReviews};
  }
  function moduleReference(value,dateFields){const source=object(value),updatedAt=text(dateFields.map(key=>source[key]).find(Boolean));return {updatedAt,hash:`module_${hash({updatedAt,source})}`}}
  function references(stock,options={}){
    const technical=technicalSnapshot(stock),plans=planReferences(stock,options),holdingCore={shares:number(stock&&stock.shares),avgCost:number(stock&&stock.avgCost||stock&&stock.cost),role:text(stock&&stock.role),type:text(stock&&stock.type)},logic=object(stock&&stock.longTermLogic),logicCore={updatedAt:dateValue(logic.updatedAt),logicStatus:text(logic.logicStatus),investmentThesis:text(logic.investmentThesis||stock&&stock.thesis),coreDrivers:uniqueStrings(logic.coreDrivers,8),longTermRisks:uniqueStrings(logic.longTermRisks,8)};
    const news=moduleReference(stock&&stock.recentCatalyst,['updatedAt','analysisDate','latestSourceDate']),fundamental=moduleReference(stock&&stock.financialReview||stock&&stock.financialData,['updatedAt','analysisDate','reportDate']),valuation=moduleReference(stock&&stock.valuationReview||stock&&stock.valuationData,['updatedAt','analysisDate','lastUpdated']);
    return normalizeReferences({technical:{technicalAsOf:technical.anchorBar.date,latestCompleteBar:technical.anchorBar.date,reviewUpdatedAt:technical.reviewUpdatedAt,reviewHash:technical.reviewHash,anchorBar:technical.anchorBar},plans:plans.plans,planReviews:plans.planReviews,holding:{...holdingCore,hash:`holding_${hash(holdingCore)}`},longTermLogic:{...logicCore,hash:`logic_${hash(logicCore)}`},allocation:{status:'unconfirmed'},modules:{news,fundamental,valuation}});
  }
  function compactPlan(plan){
    const source=PlanV2&&typeof PlanV2.normalizePlan==='function'?PlanV2.normalizePlan(plan):object(plan);
    return {id:text(source.id),planVersion:Number(source.planVersion)||1,action:text(source.action),triggerPrice:number(source.triggerPrice??source.price),triggerDirection:text(source.triggerDirection),status:text(source.status),validityStatus:text(source.validityStatus),note:text(source.note),nextReviewDate:validDate(source.nextReviewDate),validUntil:validDate(source.validUntil)};
  }
  function compactCurrentState(current,freshness){
    if(!current)return null;
    const base={schemaVersion:current.schemaVersion,confirmedDate:current.confirmedDate,technicalAsOf:current.technicalAsOf,stage:current.stage,summary:current.summary,keyChanges:clone(current.keyChanges),risks:clone(current.risks),watchPoints:clone(current.watchPoints),planRelation:clone(current.planRelation),confidence:current.confidence,continuity:{status:freshness.status,reason:freshness.reason}};
    if(current.schemaVersion===STATE_SCHEMA_VERSION)return {...base,actionAssessment:clone(current.actionAssessment),attentionLevel:current.attentionLevel,trendAssessment:clone(current.trendAssessment),structureAssessment:clone(current.structureAssessment),focusPoints:clone(current.focusPoints)};
    return base;
  }
  function changedModule(current,prior,key,content){const before=prior&&prior.modules&&prior.modules[key];return !prior||!before||before.hash!==current.modules[key].hash?content:null}
  function stateFreshness(stock,current,options={}){
    if(!current)return {status:'absent',reason:'尚未保存讨论结论。'};
    const now=references(stock,options),increment=barsAfter(stock,current.technicalSnapshot.anchorBar,{symbol:current.symbol}),reasons=[];
    if(canonical(stock)!==current.symbol)reasons.push('股票代码已变化');
    if(increment.mode!=='incremental')reasons.push(increment.message);
    if(now.holding.hash!==current.references.holding.hash)reasons.push('持仓数量、成本或角色已变化');
    if(stable(now.plans)!==stable(current.references.plans))reasons.push('当前计划版本或有效性已变化');
    if(stable(now.planReviews)!==stable(current.references.planReviews))reasons.push('计划复核已变化或过期');
    if(now.longTermLogic.hash!==current.references.longTermLogic.hash)reasons.push('长期逻辑资料已变化');
    return reasons.length?{status:'needs_review',reason:reasons[0],reasons}:{status:'current',reason:'锚点、持仓、计划与长期逻辑仍连续。',reasons:[]};
  }
  function buildContext(stock,options={}){
    const symbol=canonical(stock);if(!symbol)throw new Error('讨论股票缺少 canonical symbol。');
    const store=normalizeStore(stock&&stock.discussionState),current=store.current,currentRefs=references(stock,options),technical=technicalSnapshot(stock),increment=barsAfter(stock,current&&current.technicalSnapshot.anchorBar,{symbol}),freshness=stateFreshness(stock,current,options);
    const holding={shares:number(stock&&stock.shares),avgCost:number(stock&&stock.avgCost||stock&&stock.cost),currentPrice:number(stock&&stock.currentPrice||stock&&stock.lastUnitPrice),priceUpdatedAt:text(stock&&stock.priceUpdatedAt||stock&&stock.valueUpdatedAt),priceSource:text(stock&&stock.priceSource),role:text(stock&&stock.role),type:text(stock&&stock.type)};
    const modules={
      news:changedModule(currentRefs,current&&current.references,'news',{reference:currentRefs.modules.news,summary:text(stock&&stock.recentCatalyst&&stock.recentCatalyst.todayCatalyst),events:array(stock&&stock.recentCatalyst&&stock.recentCatalyst.recentEvents).slice(0,6)}),
      fundamental:changedModule(currentRefs,current&&current.references,'fundamental',{reference:currentRefs.modules.fundamental,summary:text(stock&&stock.financialReview&&stock.financialReview.summary||stock&&stock.financialData&&stock.financialData.summary)}),
      valuation:changedModule(currentRefs,current&&current.references,'valuation',{reference:currentRefs.modules.valuation,summary:text(stock&&stock.valuationReview&&stock.valuationReview.summary||stock&&stock.valuationData&&stock.valuationData.valuationConclusion),level:text(stock&&stock.valuationReview&&stock.valuationReview.valuationLevel||stock&&stock.valuationData&&stock.valuationData.valuationLevel)}),
      longTermLogic:{reference:currentRefs.longTermLogic,status:text(stock&&stock.longTermLogic&&stock.longTermLogic.logicStatus)||'unavailable',thesis:text(stock&&stock.longTermLogic&&stock.longTermLogic.investmentThesis||stock&&stock.thesis),drivers:uniqueStrings(stock&&stock.longTermLogic&&stock.longTermLogic.coreDrivers,6),risks:uniqueStrings(stock&&stock.longTermLogic&&stock.longTermLogic.longTermRisks,6)}
    };
    const changes=[];
    if(!current)changes.push('这是该股票第一次建立讨论基线。');
    else{
      if(increment.bars.length)changes.push(`技术锚点 ${current.technicalAsOf} 后新增 ${increment.bars.length} 根完整日线。`);
      if(currentRefs.holding.hash!==current.references.holding.hash)changes.push('应用内持仓数量、成本或角色与上次确认时不同。');
      if(stable(currentRefs.plans)!==stable(current.references.plans))changes.push('当前有效计划的版本或状态与上次确认时不同。');
      if(stable(currentRefs.planReviews)!==stable(current.references.planReviews))changes.push('计划复核记录与上次确认时不同。');
      if(currentRefs.longTermLogic.hash!==current.references.longTermLogic.hash)changes.push('长期逻辑资料与上次确认时不同。');
      if(!changes.length)changes.push('除正常价格与完整日线推进外，未发现受保护事实变化。');
    }
    const protectedSnapshot={symbol,technicalAnchor:technical.anchorBar,holding:{shares:holding.shares,avgCost:holding.avgCost,role:holding.role,type:holding.type},plans:currentRefs.plans,planReviews:currentRefs.planReviews,longTermLogic:currentRefs.longTermLogic};
    const protectedHash=`discussionctx_${hash(protectedSnapshot)}`,sourceDiscussionVersion=`discussion_v2_${hash({protectedSnapshot,currentStateId:current&&current.stateId||null})}`;
    const technicalStatus=text(stock&&stock.technicalData&&stock.technicalData.technicalDataStatus)||'unavailable',limitations=['实际券商持仓、成交和订单具有最终权威。','当前目标仓位尚未确认，不做精确仓位建议。'];
    if(technicalStatus!=='fresh')limitations.push('当前技术资料未标记为较新，只能在有限覆盖下谨慎讨论。');
    const context={schemaVersion:CONTEXT_SCHEMA_VERSION,symbol,name:text(stock&&stock.name),mode:current?'continuation':'bootstrap',sourceDiscussionVersion,currentState:compactCurrentState(current,freshness),continuity:{status:freshness.status,reason:freshness.reason,barMode:increment.mode,barMessage:increment.message,warnings:increment.warnings},changes,currentFacts:{holding,allocation:{status:'unconfirmed',message:'当前目标仓位尚未确认'},technical:{technicalAsOf:technical.anchorBar.date,latestCompleteBar:technical.anchorBar.date,dataStatus:technicalStatus,snapshot:technical,bars:increment.bars},plans:activePlans(stock).map(compactPlan),planReviews:currentRefs.planReviews.map(review=>({...review,statusText:review.freshness==='stale'?'计划变更后尚未重新复核':(review.freshness==='current'?'计划复核与当前计划一致':'尚未保存计划复核')})),modules},limitations:limitations.concat(increment.warnings).slice(0,8)};
    return {context,protectedSnapshot,protectedHash,sourceDiscussionVersion,references:currentRefs,technicalSnapshot:technical,metrics:null};
  }
  function buildDiscussionRequest(stock,options={}){
    const prepared=options.prepared||buildContext(stock,options),context=prepared.context;
    if(context.mode==='continuation'&&context.continuity.barMode==='blocked')throw new Error(context.continuity.barMessage||'技术锚点异常，无法生成连续讨论上下文。');
    const publicContext=clone(context);
    const stripInternal=value=>{if(Array.isArray(value)){value.forEach(stripInternal);return}if(!value||typeof value!=='object')return;for(const key of Object.keys(value)){if(['stateId','reviewId','reviewHash','snapshotHash','planSnapshotHash','hash','protectedHash','freshness'].includes(key))delete value[key];else stripInternal(value[key])}};
    stripInternal(publicContext);
    const request=[
      `请和我一起复盘 ${context.name||context.symbol}（${context.symbol}）。这是一场延续性的单股讨论，不是一次性从头分析。`,
      '',
      '请先用自然中文说明：从上次已确认结论到现在真正变化了什么，先前关注的判断窗口是否已经进入，既有结构是确认、仍有效还是已破坏，关注级别应升级还是降级，操作复核方向是否需要变化。若是首次讨论，请建立简洁基线。',
      '程序提供的持仓、完整日线、技术日期、计划版本和引用关系是受保护事实；不要重算或改写。价格触发不等于完整计划条件满足。不要发明新闻、财务、仓位或市场背景，也不要给确定性买卖指令。',
      `如需判断今天盘中强弱，请结合用户随后提供的分时截图；程序当前只提供截至 ${context.currentFacts.technical.technicalAsOf||'尚未确认日期'} 的完整日K事实。`,
      '基于上次已确认状态和之后新增事实，继续讨论这只股票。先识别哪些旧结论仍成立、哪些发生变化，再结合用户随后提供的分时/截图回答问题。不要自动生成正式存档，除非用户明确要求整理结论。',
      '',
      '程序生成的连续讨论上下文：',JSON.stringify(publicContext,null,2)
    ].join('\n');
    return {...prepared,request,metrics:requestMetrics(request)};
  }
  function buildArchiveRequest(prepared){
    if(!prepared||!prepared.context||!prepared.sourceDiscussionVersion)throw new Error('请先准备本次结论的存档上下文。');
    const symbol=prepared.context.symbol,sourceDiscussionVersion=prepared.sourceDiscussionVersion,held=Number(prepared.context.currentFacts&&prepared.context.currentFacts.holding&&prepared.context.currentFacts.holding.shares)>0,rawTechnicalDataStatus=text(prepared.context.currentFacts&&prepared.context.currentFacts.technical&&prepared.context.currentFacts.technical.dataStatus),technicalDataStatus=['fresh','stale','unavailable','anomaly'].includes(rawTechnicalDataStatus)?rawTechnicalDataStatus:'unavailable',confidenceRule=technicalDataStatus==='fresh'?'当前技术资料为 fresh；confidence 可根据证据使用 high、medium 或 low，但不得仅因为 fresh 自动使用 high。':`当前技术资料不是 fresh（实际为 ${technicalDataStatus}）；confidence 不得输出 high，只能根据证据使用 medium 或 low。`,example={currentState:{symbol,sourceDiscussionVersion,actionAssessment:{category:held?'hold_watch':'no_action',priority:'low',headline:'当前没有临近的仓位决策窗口，维持常规观察。',reasons:['趋势和关键结构尚未出现需要提高操作复核级别的变化。'],upgradeConditions:['关键结构确认并进入相关价格窗口。'],downgradeConditions:['当前结构判断被后续价格行为破坏。']},attentionLevel:'normal',trendAssessment:{overall:'sideways',timeframes:[{timeframe:'日线',status:'sideways',explanation:'方向尚未形成明确突破。'}]},structureAssessment:[],stage:'常规观察',focusPoints:['关键结构是否确认；确认后再提高复核优先级。'],summary:'整体状态暂未发生决定性变化。关键结构仍待确认。',keyChanges:[],risks:[],watchPoints:[],planRelation:{status:'neutral',summary:'当前判断与既有计划没有需要立即处理的冲突；价格触发不等于完整条件满足。'},confidence:'medium'}},structureItemExample={timeframe:'60分钟',type:'top',status:'forming',source:'ai_chart_judgment',sourceAsOf:'',shortReason:'高位回落后短周期弱势增强，但尚未形成正式外部软件确认信号。'};
    const request=[
      '根据本轮讨论形成一个可持续更新的当前状态，优先明确当前关注级别、操作复核方向、趋势、结构及其生命周期、最重要观察事项和升级/降级条件。',
      '只输出一个严格 JSON 对象，顶层只能有 currentState。',
      '不要 Markdown 代码围栏。',
      '不要额外解释。',
      'JSON 结构键和值必须使用英文半角双引号 "。',
      'JSON 只能使用标准定义的转义；下划线 _ 不需要也不得转义。不得把 Markdown 转义带进 JSON。正确：discussion_v2_9a35cb46、reduce_review、ai_chart_judgment；错误：discussion\\_v2\\_9a35cb46、reduce\\_review、ai\\_chart\\_judgment。',
      '字符串正文可以正常使用中文标点和中文引号。',
      `symbol 必须精确等于 ${symbol}；sourceDiscussionVersion 必须精确等于 ${sourceDiscussionVersion}。`,
      `程序当前 technicalDataStatus: ${technicalDataStatus}。这是程序提供的技术资料新鲜度事实。`,
      confidenceRule,
      '严格按此顺序判断并输出：actionAssessment、attentionLevel、trendAssessment、structureAssessment、stage、focusPoints、summary、keyChanges、risks、watchPoints、planRelation、confidence。',
      '固定值：category 只能为 risk_control/reduce_review/hold_watch/wait_confirmation/add_review/entry_review/no_action；priority 为 high/medium/low；attentionLevel 为 normal/focused/window；趋势 status 为 uptrend/downtrend/sideways/recovery/rebound/unclear；结构 type 为 top/bottom/breakout/pullback/recovery/consolidation/none/unclear，status 为 forming/confirmed/valid/broken/unclear，source 为 program/external_software/ai_chart_judgment/user_provided；planRelation.status 为 aligned/conflict/no_matching_plan/neutral；confidence 为 high/medium/low。',
      'trendAssessment.timeframes 的每项必须且只能包含 timeframe、status、explanation；explanation 只属于趋势周期项。',
      'structureAssessment 的每项必须且只能包含 timeframe、type、status、source、sourceAsOf、shortReason；不得在 structureAssessment 中使用 explanation，不得遗漏必填字段，不得增加未知字段。',
      `structureAssessment 单项形状示例：${JSON.stringify(structureItemExample)}`,
      'actionAssessment.reasons 最多5项，升级/降级条件最多3项；timeframes 与 structureAssessment 最多3项；focusPoints、keyChanges、risks、watchPoints 最多5项。summary 用2–4句，关键变化只写相对上次已确认结论的变化；focusPoints 写当前优先事项，watchPoints 写更广的持续监测，不要重复。',
      `当前${held?'有持仓':'为零持仓候选'}：${held?'不得使用 entry_review；可按证据使用持有、等待、加仓、减仓或风险复核方向。':'category 只能使用 entry_review、wait_confirmation 或 no_action，不得写继续持有、加仓复核或减仓复核。'}`,
      '结构来源必须保持真实：外部软件明确提供的信号用 external_software，图形推断用 ai_chart_judgment，用户陈述用 user_provided；sourceAsOf 有明确日期/时间就保留，否则为空字符串。不同来源冲突时并列说明，不得把 AI 推断冒充软件事实。资料陈旧或缺失时使用条件性判断并降低 confidence。',
      '不得发明结构的 timeframe 或 source。无法确认具体 timeframe 或没有足够证据形成结构项时，使用空的 structureAssessment 数组；有明确周期但结构不明确时，只能按证据使用允许的 none/unclear 表达，并仍完整输出六个必填字段。不得用 explanation 代替缺失字段。',
      '所有中文正文不得暴露英文枚举、字段名或实现术语。保留不确定性；价格触发不等于完整计划条件满足。不得修改或声称修改计划、计划复核、持仓、配置或长期逻辑；不得创建仓位数值、股数、订单或确定性买卖命令。高优先级只表示优先复核，不等于自动交易。',
      '不要输出日期、技术锚点、哈希、引用、stateId 或任何由程序补齐的字段。',
      JSON.stringify(example,null,2)
    ].join('\n');
    return {request,metrics:requestMetrics(request),symbol,sourceDiscussionVersion,technicalDataStatus};
  }

  return Object.freeze({STORE_SCHEMA_VERSION,LEGACY_STATE_SCHEMA_VERSION,STATE_SCHEMA_VERSION,CONTEXT_SCHEMA_VERSION,HISTORY_LIMIT,INCREMENTAL_LIMIT,BOOTSTRAP_FRESH_LIMIT,BOOTSTRAP_STALE_LIMIT,CONFIDENCE_LEVELS,ACTION_CATEGORIES,ACTION_PRIORITIES,ATTENTION_LEVELS,TREND_STATUSES,STRUCTURE_TYPES,STRUCTURE_STATUSES,STRUCTURE_SOURCES,PLAN_RELATION_STATUSES,canonical,validDate,localCalendarDate,requestMetrics,defaultStore,normalizeAnchor,normalizeTechnicalSnapshot,normalizeReferences,normalizeActionAssessment,normalizeTrendAssessment,normalizeStructureAssessment,normalizePlanRelation,normalizeState,validateState,normalizeStore,validateStore,normalizedBars,barsAfter,technicalSnapshot,references,stateFreshness,buildContext,buildDiscussionRequest,buildArchiveRequest,clone,hash,stable});
});
