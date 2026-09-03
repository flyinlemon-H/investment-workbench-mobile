(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  root.PlanV2=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';

  const SCHEMA_VERSION='plan.v2';
  const PLAN_MODES=Object.freeze(['legacy_price','state_watch']);
  const PLAN_STATUSES=Object.freeze(['active','completed','cancelled','replaced']);
  const VALIDITY_STATUSES=Object.freeze(['active','needs_review','invalid','completed']);
  const PRICE_TRIGGER_STATUSES=Object.freeze(['not_triggered','near','triggered','unavailable']);
  const FULL_CONDITION_STATUSES=Object.freeze(['unproven','confirmed']);
  const CONDITION_CATEGORIES=Object.freeze(['technical','fundamental','catalyst','allocation','market','invalidation','other']);
  const CONDITION_STATUSES=Object.freeze(['unconfirmed','confirmed','not_applicable']);
  const SOURCES=Object.freeze(['manual','ai_refresh','tradeplan_import','migrated_legacy']);
  const EDITABLE_FIELDS=Object.freeze(['action','triggerPrice','triggerDirection','quantity','conditions','allocationConstraint','invalidationReason','validUntil','nextReviewDate','fullConditionStatus','note']);
  const WATCH_FIELDS=Object.freeze(['planMode','name','applicableConditions','entryConditions','confirmationConditions','invalidationConditions','reviewAction','priceReferences','allocationConstraint','note','validUntil','nextReviewDate']);
  const WATCH_REQUIRED=Object.freeze(['planMode','name','entryConditions','confirmationConditions','invalidationConditions','reviewAction']);
  const WATCH_RULE_FIELDS=Object.freeze(['applicableConditions','entryConditions','confirmationConditions','invalidationConditions']);
  const REVIEW_ACTION_LABELS=Object.freeze({reduce_review:'减仓复核',add_review:'加仓复核',hold_watch:'持有观察',risk_control:'风险控制复核'});
  const WATCH_LABELS=Object.freeze({name:'计划主题',applicableConditions:'适用背景',entryConditions:'进入观察',confirmationConditions:'进一步确认',invalidationConditions:'失效条件',reviewAction:'复核方向',priceReferences:'价格参考',allocationConstraint:'配置约束',note:'纪律备注',validUntil:'有效至',nextReviewDate:'下次复核'});

  function object(value){return value&&typeof value==='object'&&!Array.isArray(value)?value:{}}
  function clone(value){return value===undefined?undefined:JSON.parse(JSON.stringify(value))}
  function text(value){return String(value??'').trim()}
  function nullableText(value){const result=text(value);return result||null}
  function positive(value){const number=Number(value);return Number.isFinite(number)&&number>0?number:null}
  function nonNegative(value){const number=Number(value);return Number.isFinite(number)&&number>=0?number:null}
  function integer(value,fallback=1){const number=Number(value);return Number.isInteger(number)&&number>=1?number:fallback}
  function dateValue(value){const result=text(value);return result&&Number.isFinite(Date.parse(result))?result:null}
  function dateOnly(value){const parsed=dateValue(value);return parsed?parsed.slice(0,10):null}
  function nowIso(options={}){const value=typeof options.now==='function'?options.now():options.now;return dateValue(value)||new Date().toISOString()}
  function stable(value){
    if(Array.isArray(value))return `[${value.map(stable).join(',')}]`;
    if(value&&typeof value==='object')return `{${Object.keys(value).sort().map(key=>`${JSON.stringify(key)}:${stable(value[key])}`).join(',')}}`;
    return JSON.stringify(value);
  }
  function hash(value){let result=2166136261;const input=typeof value==='string'?value:stable(value);for(let i=0;i<input.length;i++){result^=input.charCodeAt(i);result=Math.imul(result,16777619)}return (result>>>0).toString(16).padStart(8,'0')}
  function generatedId(seed){
    if(seed!==undefined)return `legacy_${hash(seed)}`;
    if(typeof crypto!=='undefined'&&typeof crypto.randomUUID==='function')return `plan_${crypto.randomUUID()}`;
    return `plan_${Date.now().toString(36)}_${Math.random().toString(36).slice(2,10)}`;
  }
  // Absence is legacy compatibility; explicit invalid modes never fall back.
  function isLegacyPricePlan(plan){return !Object.prototype.hasOwnProperty.call(object(plan),'planMode')||plan.planMode==='legacy_price'}
  function normalizeMode(plan){if(!Object.prototype.hasOwnProperty.call(plan,'planMode'))return 'legacy_price';if(!PLAN_MODES.includes(plan.planMode))throw new Error('planMode 无效。');return plan.planMode}
  function assertLegacyPricePlan(plan){if(!isLegacyPricePlan(plan))throw new Error('状态观察计划暂不支持在此处编辑或执行。')}
  function normalizeDirection(value){const raw=text(value).toLowerCase();if(['above','gte','>=','up','sell_above'].includes(raw))return 'above';if(['below','lte','<=','down','buy_below'].includes(raw))return 'below';return null}
  function normalizeAction(value){const raw=text(value).toLowerCase();if(['buy','add','build','increase','加仓','建仓'].includes(raw))return raw==='buy'?'buy':'add';if(['sell','reduce','trim','profit_take','position_control','减仓','卖出'].includes(raw))return raw==='sell'?'sell':'reduce';if(['observe','watch','trend_defense','risk','观察','防守'].includes(raw))return 'observe';return raw||'observe'}
  function normalizeStatus(value){const raw=text(value).toLowerCase();if(['completed','done','closed','executed'].includes(raw))return 'completed';if(['cancelled','canceled','archived','expired'].includes(raw))return 'cancelled';if(raw==='replaced')return 'replaced';return 'active'}
  function normalizeValidity(value,status,isLegacy){const raw=text(value).toLowerCase();if(status==='completed')return 'completed';if(status==='cancelled'||status==='replaced')return 'invalid';if(VALIDITY_STATUSES.includes(raw))return raw;return isLegacy?'needs_review':'active'}
  function normalizeSource(value,isLegacy){const raw=text(value).toLowerCase().replace(/[-\s]+/g,'_');if(['ai_refresh','ai_plan_refresh','v13_ai_refresh'].includes(raw))return 'ai_refresh';if(['tradeplan_import','gpt/manual_import','tradeplan'].includes(raw))return 'tradeplan_import';if(raw==='manual')return 'manual';if(raw==='migrated_legacy')return raw;return isLegacy?'migrated_legacy':'manual'}
  function normalizeCondition(value){
    if(typeof value==='string'){const condition=text(value);return condition?{text:condition,status:'unconfirmed'}:null}
    const source=object(value),condition=text(source.text||source.description||source.condition||source.value);if(!condition)return null;
    const status=CONDITION_STATUSES.includes(text(source.status).toLowerCase())?text(source.status).toLowerCase():'unconfirmed';
    return {text:condition,status};
  }
  function normalizeConditions(value,legacySource={}){
    const source=object(value),result={};
    CONDITION_CATEGORIES.forEach(category=>{result[category]=(Array.isArray(source[category])?source[category]:source[category]?[source[category]]:[]).map(normalizeCondition).filter(Boolean)});
    const append=(category,entry)=>{const condition=normalizeCondition(entry);if(condition&&!result[category].some(item=>item.text===condition.text))result[category].push(condition)};
    append('technical',legacySource.technicalCondition);append('fundamental',legacySource.fundamentalCondition);append('catalyst',legacySource.catalystCondition);append('allocation',legacySource.allocationCondition);append('market',legacySource.marketCondition);append('invalidation',legacySource.invalidationCondition);
    [legacySource.condition,legacySource.volumeCondition,legacySource.riskControl].forEach(item=>append('other',item));
    const requirement=object(legacySource.reviewRequirement);(Array.isArray(requirement.conditions)?requirement.conditions:[]).forEach(item=>append('other',item));
    return result;
  }
  function normalizeAllocation(value,legacySource={}){
    const source=object(value),maxPositionPct=positive(source.maxPositionPct??source.maxWeight??legacySource.maxPositionPct??legacySource.maxWeight),targetWeightRange=nullableText(source.targetWeightRange??legacySource.targetWeightRange);
    return {maxPositionPct,targetWeightRange};
  }
  function hasAllocationPremise(plan){const action=normalizeAction(plan&&plan.action);if(!['buy','add'].includes(action))return true;const allocation=object(plan&&plan.allocationConstraint);return positive(allocation.maxPositionPct)!==null||Boolean(text(allocation.targetWeightRange))}
  function legacyUnknownFields(source){
    const known=new Set(['id','schemaVersion','planMode','planVersion','action','type','planType','triggerPrice','price','triggerDirection','triggerOn','status','versionStatus','validityStatus','createdAt','updatedAt','lastReviewedAt','nextReviewDate','validUntil','priceTriggerStatus','priceCondition','triggeredAt','fullConditionStatus','conditions','reviewRequirement','invalidationReason','terminatedAt','archivedAt','source','note','summary','planSummary','actionHint','description','quantity','shares','allocationConstraint','maxPositionPct','maxWeight','targetWeightRange','legacy','stage','stockId','objectType']);
    const unknown={};Object.keys(source).forEach(key=>{if(!known.has(key))unknown[key]=clone(source[key])});return unknown;
  }
  function normalizeLegacyArea(source,isLegacy){
    const existing=clone(object(source.legacy));if(!isLegacy)return existing;
    const unknown=legacyUnknownFields(source),timestamps={createdAt:source.createdAt??null,updatedAt:source.updatedAt??null,lastReviewedAt:source.lastReviewedAt??null,triggeredAt:source.triggeredAt??null};return {...existing,migratedFrom:text(source.schemaVersion)||'legacy',originalTimestamps:{...object(existing.originalTimestamps),...timestamps},originalFields:{...object(existing.originalFields),...unknown}};
  }
  function defaultPlan(){return {id:'',schemaVersion:SCHEMA_VERSION,planMode:'legacy_price',planVersion:1,action:'observe',triggerPrice:null,triggerDirection:null,status:'active',validityStatus:'active',createdAt:null,updatedAt:null,lastReviewedAt:null,nextReviewDate:null,validUntil:null,priceTriggerStatus:'unavailable',triggeredAt:null,fullConditionStatus:'unproven',conditions:normalizeConditions({}),allocationConstraint:{maxPositionPct:null,targetWeightRange:null},invalidationReason:null,terminatedAt:null,source:'manual',note:'',quantity:null,legacy:{}}}
  function hasWatchDefinition(plan){return plan&&plan.planMode==='state_watch'&&['name',...WATCH_RULE_FIELDS,'reviewAction','priceReferences'].some(key=>Object.prototype.hasOwnProperty.call(plan,key))}
  function watchDefinition(plan){return Object.fromEntries(WATCH_FIELDS.filter(key=>Object.prototype.hasOwnProperty.call(object(plan),key)).map(key=>[key,clone(plan[key])]))}
  function exactWatchFields(value,allowed,required,label,errors){
    if(!value||typeof value!=='object'||Array.isArray(value)){errors.push(`${label} 必须是对象`);return false}
    const extra=Object.keys(value).filter(key=>!allowed.includes(key)),missing=required.filter(key=>!Object.prototype.hasOwnProperty.call(value,key));
    if(extra.length)errors.push(`${label} 包含未知字段：${extra.join('、')}`);
    if(missing.length)errors.push(`${label} 缺少字段：${missing.join('、')}`);
    return !extra.length&&!missing.length;
  }
  // Focused guard against storing today's judgments as enduring rules, not an NLP classifier.
  function runtimeStatement(value){return /当前(?:已经|已|阶段(?:为|是))|今天(?:已经|已)?(?:触发|确认|失守)|(?:支撑|趋势|结构)今天(?:已)?(?:失守|确认|破坏)|已进入\s*(?:action_review|watch_zone|forming|confirmed)|当前已?进入.*阶段/i.test(value)}
  function validateWatchDefinition(value){
    const source=object(value),errors=[],result={};
    exactWatchFields(value,WATCH_FIELDS,WATCH_REQUIRED,'观察计划 Definition',errors);
    if(source.planMode!=='state_watch')errors.push('planMode 必须是 state_watch');
    result.planMode='state_watch';
    const string=(raw,label,limit,required=false)=>{if(typeof raw!=='string'||raw.trim().length>limit||(required&&!raw.trim())){errors.push(`${label} 必须是${required?'非空、':''}${limit} 字以内的文字`);return ''}const normalized=raw.trim();if(runtimeStatement(normalized))errors.push(`${label} 应描述条件规则，不能保存当前阶段或今日判断`);return normalized};
    result.name=string(source.name,'计划主题',80,true);
    for(const key of WATCH_RULE_FIELDS){
      const rows=source[key]===undefined&&key==='applicableConditions'?[]:source[key];
      if(!Array.isArray(rows)){errors.push(`${WATCH_LABELS[key]} 必须是字符串数组`);result[key]=[];continue}
      if(rows.length>12||key!=='applicableConditions'&&!rows.length)errors.push(`${WATCH_LABELS[key]} 需要 ${key==='applicableConditions'?'0':'1'} 至 12 项`);
      result[key]=rows.map(row=>string(row,WATCH_LABELS[key],240,true));
    }
    if(!Object.prototype.hasOwnProperty.call(REVIEW_ACTION_LABELS,source.reviewAction))errors.push('复核方向无效');
    result.reviewAction=source.reviewAction;
    const refs=source.priceReferences===undefined?[]:source.priceReferences;
    result.priceReferences=[];
    if(!Array.isArray(refs)||refs.length>8)errors.push('价格参考必须是最多 8 项的数组');
    else result.priceReferences=refs.map(ref=>{
      const r=object(ref),range=r.type==='watch_zone',fields=range?['type','from','to','meaning']:['type','price','meaning'];
      exactWatchFields(ref,fields,fields,'价格参考',errors);
      if(!['watch_zone','reference'].includes(r.type))errors.push('价格参考类型无效');
      for(const key of range?['from','to']:['price'])if(typeof r[key]!=='number'||!Number.isFinite(r[key])||r[key]<=0)errors.push('参考价格必须是有限正数');
      if(range&&r.from>r.to)errors.push('价格区间必须从低到高');
      const meaning=string(r.meaning,'参考含义',120,true);
      return range?{type:r.type,from:r.from,to:r.to,meaning}:{type:r.type,price:r.price,meaning};
    });
    const allocation=source.allocationConstraint===undefined?{}:source.allocationConstraint;
    exactWatchFields(allocation,['maxPositionPct','targetWeightRange'],[],'配置约束',errors);
    const max=(allocation&&allocation.maxPositionPct)??null,range=(allocation&&allocation.targetWeightRange)??null;
    if(max!==null&&(typeof max!=='number'||!Number.isFinite(max)||max<=0||max>100))errors.push('配置上限必须是 0 至 100 之间的正数或空');
    if(range!==null&&(typeof range!=='string'||!range.trim()||range.trim().length>80))errors.push('配置范围必须是 1 至 80 字的文字或空');
    result.allocationConstraint={maxPositionPct:max,targetWeightRange:typeof range==='string'?range.trim():range};
    result.note=string(source.note===undefined?'':source.note,'纪律备注',1000);
    for(const key of ['validUntil','nextReviewDate']){
      const raw=source[key]??null;
      if(raw!==null&&(typeof raw!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(raw)||!dateValue(raw)||new Date(raw).toISOString().slice(0,10)!==raw))errors.push(`${WATCH_LABELS[key]} 日期无效`);
      result[key]=raw;
    }
    return {ok:!errors.length,errors,definition:result};
  }
  function validateWatchCanonical(source,{requireDefinition=false}={}){
    const errors=[];
    exactWatchFields(source,[...Object.keys(defaultPlan()),...WATCH_FIELDS],[],'观察计划',errors);
    if(requireDefinition||hasWatchDefinition(source)){
      exactWatchFields(source,[...Object.keys(defaultPlan()),...WATCH_FIELDS],[...Object.keys(defaultPlan()),...WATCH_REQUIRED],'正式观察计划',errors);
      if(source.schemaVersion!==SCHEMA_VERSION||typeof source.id!=='string'||!source.id.trim()||!Number.isInteger(source.planVersion)||source.planVersion<1)errors.push('观察计划身份或版本无效');
      if(!PLAN_STATUSES.includes(source.status)||!VALIDITY_STATUSES.includes(source.validityStatus)||!SOURCES.includes(source.source))errors.push('观察计划生命周期无效');
      for(const key of ['createdAt','updatedAt','lastReviewedAt','terminatedAt'])if(source[key]!==null&&!dateValue(source[key]))errors.push('观察计划时间无效');
      errors.push(...validateWatchDefinition(Object.fromEntries(WATCH_FIELDS.filter(key=>Object.prototype.hasOwnProperty.call(source,key)).map(key=>[key,source[key]]))).errors);
      for(const key of ['action','triggerPrice','triggerDirection','quantity','triggeredAt'])if(source[key]!==undefined&&source[key]!==null)errors.push(`观察计划 ${key} 必须为空`);
      if(source.priceTriggerStatus!==undefined&&source.priceTriggerStatus!=='unavailable')errors.push('观察计划不能保存价格触发状态');
      if(source.fullConditionStatus!==undefined&&source.fullConditionStatus!=='unproven')errors.push('观察计划不能保存条件确认状态');
      if(source.conditions!==undefined&&(!source.conditions||Array.isArray(source.conditions)||Object.entries(source.conditions).some(([key,rows])=>!CONDITION_CATEGORIES.includes(key)||!Array.isArray(rows)||rows.length)))errors.push('观察计划规则必须使用 Definition 字符串数组');
    }
    return {ok:!errors.length,errors};
  }
  function createWatchPlan(input,options={}){
    const checked=validateWatchDefinition(input);if(!checked.ok)throw new Error(checked.errors.join('；'));
    const now=nowIso(options);
    return {...defaultPlan(),...checked.definition,id:generatedId(),action:null,createdAt:now,updatedAt:now,source:normalizeSource(options.source,false)};
  }
  function editWatchPlan(existing,input,options={}){
    if(!hasWatchDefinition(existing))throw new Error('目标不是可编辑的观察计划 Definition');
    const current=normalizePlan(existing);if(current.status!=='active')throw new Error('已结束的观察计划不能编辑');
    const checked=validateWatchDefinition(input);if(!checked.ok)throw new Error(checked.errors.join('；'));
    if(stable(watchDefinition(current))===stable(checked.definition))return current;
    return {...current,...checked.definition,planVersion:current.planVersion+1,updatedAt:nowIso(options)};
  }
  function terminateWatchPlan(existing,status,options={}){
    if(!hasWatchDefinition(existing)||!['cancelled','completed'].includes(status))throw new Error('观察计划生命周期操作无效');
    const current=normalizePlan(existing);if(current.status!=='active')throw new Error('计划已经结束');
    const now=nowIso(options);
    // Lifecycle changes retain the canonical revision convention; no market judgment can call this automatically.
    return {...current,status,validityStatus:status==='completed'?'completed':'invalid',planVersion:current.planVersion+1,updatedAt:now,terminatedAt:now,invalidationReason:text(options.reason)||null};
  }
  function normalizePlan(value={},options={}){
    const source=object(value),planMode=normalizeMode(source),isLegacy=source.schemaVersion!==SCHEMA_VERSION;
    if(planMode==='state_watch'){const checked=validateWatchCanonical(source);if(!checked.ok)throw new Error(checked.errors.join('；'));}
    const status=normalizeStatus(source.status||source.versionStatus),action=normalizeAction(source.action||source.type||source.planType),triggerDirection=normalizeDirection(source.triggerDirection||source.triggerOn),triggerPrice=positive(source.triggerPrice??source.price),allocationConstraint=normalizeAllocation(source.allocationConstraint,source),normalizedSource=normalizeSource(source.source,isLegacy),untrustedLegacyAi=isLegacy&&normalizedSource==='ai_refresh';
    let validityStatus=normalizeValidity(source.validityStatus,status,isLegacy);
    if(isLegacy&&(!triggerDirection||(['buy','add'].includes(action)&&!hasAllocationPremise({action,allocationConstraint}))))validityStatus='needs_review';
    const plan={...defaultPlan(),planMode,id:text(source.id)||generatedId(stable(source)),planVersion:integer(source.planVersion),action,triggerPrice,triggerDirection,status,validityStatus,createdAt:untrustedLegacyAi?null:dateValue(source.createdAt),updatedAt:untrustedLegacyAi?null:dateValue(source.updatedAt),lastReviewedAt:untrustedLegacyAi?null:dateValue(source.lastReviewedAt),nextReviewDate:dateOnly(source.nextReviewDate),validUntil:dateOnly(source.validUntil),priceTriggerStatus:PRICE_TRIGGER_STATUSES.includes(text(source.priceTriggerStatus).toLowerCase())?text(source.priceTriggerStatus).toLowerCase():'unavailable',triggeredAt:untrustedLegacyAi?null:dateValue(source.triggeredAt),fullConditionStatus:untrustedLegacyAi?'unproven':(FULL_CONDITION_STATUSES.includes(text(source.fullConditionStatus).toLowerCase())?text(source.fullConditionStatus).toLowerCase():'unproven'),conditions:normalizeConditions(source.conditions,source),allocationConstraint,invalidationReason:nullableText(source.invalidationReason),terminatedAt:dateValue(source.terminatedAt||source.archivedAt),source:normalizedSource,note:text(source.note||source.summary||source.planSummary||source.actionHint||source.description),quantity:positive(source.quantity??source.shares),legacy:normalizeLegacyArea(source,isLegacy)};
    if(status!=='active'&&!plan.terminatedAt)plan.terminatedAt=null;
    if(hasWatchDefinition(source))Object.assign(plan,validateWatchDefinition(watchDefinition(source)).definition,{action:null,triggerPrice:null,triggerDirection:null,quantity:null});
    if(planMode==='legacy_price'&&options.currentPrice!==undefined){const evaluation=evaluatePriceTrigger(plan,options.currentPrice,options);plan.priceTriggerStatus=evaluation.status;if(evaluation.status==='triggered'&&!plan.triggeredAt&&options.observePrice===true&&!isLegacy&&['not_triggered','near'].includes(text(source.priceTriggerStatus).toLowerCase()))plan.triggeredAt=nowIso(options)}
    return plan;
  }
  function createPlan(input={},options={}){
    if(input.planMode==='state_watch')return createWatchPlan(input,options);
    const now=nowIso(options),source={...object(input),schemaVersion:SCHEMA_VERSION,id:text(input.id)||generatedId(),planVersion:1,status:'active',validityStatus:text(input.validityStatus)||'active',createdAt:now,updatedAt:now,lastReviewedAt:null,triggeredAt:null,terminatedAt:null,source:normalizeSource(options.source||input.source,false)};
    delete source.legacy;
    const plan=normalizePlan(source);
    if(['buy','add'].includes(plan.action)&&!hasAllocationPremise(plan))plan.validityStatus='needs_review';
    const validation=validatePlan(plan);if(!validation.ok)throw new Error(validation.errors.join('；'));return plan;
  }
  function authoritativeContent(plan){const source=normalizePlan(plan);return Object.fromEntries(EDITABLE_FIELDS.map(key=>[key,source[key]]))}
  function applyAuthoritativeEdit(existing,patch={},options={}){
    assertLegacyPricePlan(existing);
    const current=normalizePlan(existing),changes=object(patch),unsupported=Object.keys(changes).filter(key=>!EDITABLE_FIELDS.includes(key));if(unsupported.length)throw new Error(`不可编辑的计划字段：${unsupported.join('、')}`);
    const merged=normalizePlan({...current,...clone(changes),schemaVersion:SCHEMA_VERSION});
    if(stable(authoritativeContent(current))===stable(authoritativeContent(merged)))return current;
    merged.id=current.id;merged.planVersion=current.planVersion+1;merged.createdAt=current.createdAt;merged.updatedAt=nowIso(options);merged.lastReviewedAt=current.lastReviewedAt;merged.triggeredAt=current.triggeredAt;merged.terminatedAt=current.terminatedAt;merged.source=current.source;merged.legacy=clone(current.legacy);
    if(['buy','add'].includes(merged.action)&&!hasAllocationPremise(merged))merged.validityStatus='needs_review';
    const validation=validatePlan(merged);if(!validation.ok)throw new Error(validation.errors.join('；'));return merged;
  }
  function hasConfirmedInvalidation(plan){return Boolean(nullableText(plan&&plan.invalidationReason))||normalizeConditions(plan&&plan.conditions).invalidation.some(item=>item.status==='confirmed')}
  function reconfirmPlan(existing,options={}){
    assertLegacyPricePlan(existing);
    const plan=normalizePlan(existing);if(plan.status!=='active')throw new Error('只有进行中的计划可以确认继续有效。');if(hasConfirmedInvalidation(plan))throw new Error('计划存在尚未解除的失效证据，需要先完成明确复核。');
    const now=nowIso(options);plan.validityStatus='active';plan.lastReviewedAt=now;plan.updatedAt=now;plan.planVersion+=1;if(options.nextReviewDate!==undefined)plan.nextReviewDate=dateOnly(options.nextReviewDate);
    return plan;
  }
  function terminatePlan(existing,status,options={}){
    assertLegacyPricePlan(existing);
    const terminal=normalizeStatus(status);if(!['completed','cancelled','replaced'].includes(terminal))throw new Error('计划终止状态无效。');const plan=normalizePlan(existing),now=nowIso(options);plan.status=terminal;plan.validityStatus=terminal==='completed'?'completed':'invalid';plan.terminatedAt=now;plan.updatedAt=now;plan.planVersion+=1;if(options.reason)plan.invalidationReason=text(options.reason);return plan;
  }
  function evaluatePriceTrigger(plan,currentPrice,options={}){
    if(!isLegacyPricePlan(plan))return {status:'unavailable',distancePct:null,direction:null,triggerPrice:null,currentPrice:positive(currentPrice)};
    const normalized=normalizePlan(plan),price=positive(currentPrice),trigger=positive(normalized.triggerPrice),direction=normalizeDirection(normalized.triggerDirection);if(price===null||trigger===null||!direction)return {status:'unavailable',distancePct:null,direction,triggerPrice:trigger,currentPrice:price};
    const triggered=(direction==='above'&&price>=trigger)||(direction==='below'&&price<=trigger),distancePct=Math.abs(price-trigger)/trigger*100,nearPct=Number.isFinite(Number(options.nearPct))?Number(options.nearPct):5;
    return {status:triggered?'triggered':(distancePct<=nearPct?'near':'not_triggered'),distancePct,direction,triggerPrice:trigger,currentPrice:price};
  }
  function observePriceTrigger(existing,currentPrice,options={}){
    if(!isLegacyPricePlan(existing))return normalizePlan(existing);
    const before=normalizePlan(existing),result=normalizePlan(existing,{...options,currentPrice,observePrice:true});result.priceTriggerStatus=evaluatePriceTrigger(result,currentPrice,options).status;if(before.triggeredAt)result.triggeredAt=before.triggeredAt;return result;
  }
  function freshness(plan,reviewDate){
    const normalized=normalizePlan(plan),today=dateOnly(reviewDate)||new Date().toISOString().slice(0,10);
    if(normalized.status!=='active'||['invalid','completed'].includes(normalized.validityStatus))return 'inactive';
    if(normalized.validUntil&&normalized.validUntil<today)return 'inactive';
    if(normalized.validityStatus==='needs_review')return normalized.source==='migrated_legacy'?'historical_only':'needs_review';
    if(normalized.nextReviewDate&&normalized.nextReviewDate<today)return 'needs_review';
    if(normalized.source==='migrated_legacy'&&!normalized.lastReviewedAt)return 'historical_only';
    return 'current';
  }
  function compactForPortfolio(plan,currentPrice,reviewDate){
    const normalized=normalizePlan(plan),price=evaluatePriceTrigger(normalized,currentPrice),conditionCategories={};CONDITION_CATEGORIES.forEach(category=>{const rows=normalized.conditions[category];if(rows.length)conditionCategories[category]=clone(rows)});
    if(!isLegacyPricePlan(normalized))return {id:normalized.id,planVersion:normalized.planVersion,planMode:'state_watch',readOnly:true,...(hasWatchDefinition(normalized)?watchDefinition(normalized):{}),definitionSummary:hasWatchDefinition(normalized)?`${normalized.name} · 复核方向：${REVIEW_ACTION_LABELS[normalized.reviewAction]} · 进入观察：${normalized.entryConditions.join('；')}`:'状态观察计划（只读）',action:'observe',triggerPrice:null,triggerDirection:null,priceTriggerStatus:'unavailable',triggeredAt:null,fullConditionStatus:'unproven',validityStatus:normalized.validityStatus,freshness:freshness(normalized,reviewDate),conditions:conditionCategories,note:normalized.note,userMeaning:'状态观察计划，暂不支持在此处编辑或执行'};
    return {id:normalized.id,planVersion:normalized.planVersion,action:normalized.action,triggerPrice:normalized.triggerPrice,triggerDirection:normalized.triggerDirection,priceTriggerStatus:price.status,triggeredAt:normalized.triggeredAt,fullConditionStatus:normalized.fullConditionStatus,validityStatus:normalized.validityStatus,freshness:freshness(normalized,reviewDate),createdAt:normalized.createdAt,updatedAt:normalized.updatedAt,lastReviewedAt:normalized.lastReviewedAt,nextReviewDate:normalized.nextReviewDate,validUntil:normalized.validUntil,conditions:conditionCategories,allocationConstraint:clone(normalized.allocationConstraint),source:normalized.source,userMeaning:price.status==='triggered'?'价格已触发，待确认其他条件':(price.status==='near'?'接近计划价格，完整条件仍待确认':(price.status==='unavailable'?'触发方向或价格不明确，需复核':'尚未达到计划价格')),note:normalized.note};
  }
  function buildContextReference(stockContexts,reviewDate){
    const references=(Array.isArray(stockContexts)?stockContexts:[]).map(item=>({symbol:text(item&&item.stock&&item.stock.symbol||item&&item.symbol),plans:(Array.isArray(item&&item.plans)?item.plans:[]).map(plan=>({id:text(plan.id),planVersion:integer(plan.planVersion),action:text(plan.action),triggerPrice:positive(plan.triggerPrice),triggerDirection:normalizeDirection(plan.triggerDirection),priceTriggerStatus:text(plan.priceTriggerStatus),fullConditionStatus:text(plan.fullConditionStatus),validityStatus:text(plan.validityStatus),lastReviewedAt:dateValue(plan.lastReviewedAt)}))}));
    const compact={reviewDate:dateOnly(reviewDate),stocks:references};return {...compact,contextHash:`planctx_${hash(compact)}`};
  }
  function validatePlan(plan){
    const errors=[],source=object(plan);if(source.planMode==='state_watch')errors.push(...validateWatchCanonical(source).errors);if(Object.prototype.hasOwnProperty.call(source,'planMode')&&!PLAN_MODES.includes(source.planMode))errors.push('planMode 无效');if(source.schemaVersion!==SCHEMA_VERSION)errors.push('schemaVersion 必须是 plan.v2');if(!text(source.id))errors.push('计划缺少 id');if(!Number.isInteger(source.planVersion)||source.planVersion<1)errors.push('planVersion 必须是正整数');if(!PLAN_STATUSES.includes(source.status))errors.push('计划状态无效');if(!VALIDITY_STATUSES.includes(source.validityStatus))errors.push('计划有效性状态无效');if(!PRICE_TRIGGER_STATUSES.includes(source.priceTriggerStatus))errors.push('价格触发状态无效');if(!FULL_CONDITION_STATUSES.includes(source.fullConditionStatus))errors.push('完整条件状态无效');if(source.triggerPrice!==null&&positive(source.triggerPrice)===null)errors.push('触发价格必须为正数或空');if(source.triggerDirection!==null&&!['above','below'].includes(source.triggerDirection))errors.push('触发方向无效');if(source.createdAt!==null&&!dateValue(source.createdAt))errors.push('创建时间无效');if(source.updatedAt!==null&&!dateValue(source.updatedAt))errors.push('更新时间无效');if(!SOURCES.includes(source.source))errors.push('计划来源无效');return {ok:errors.length===0,errors};
  }
  function validatePlanCollection(plans){const errors=[];(Array.isArray(plans)?plans:[]).forEach((plan,index)=>{const result=validatePlan(plan);result.errors.forEach(error=>errors.push(`计划 ${index+1}：${error}`))});const ids=(Array.isArray(plans)?plans:[]).map(plan=>text(plan&&plan.id)).filter(Boolean);if(new Set(ids).size!==ids.length)errors.push('计划 ID 重复');return {ok:errors.length===0,errors}}
  async function commitCandidate(currentState,buildCandidate,deps={}){
    if(typeof buildCandidate!=='function'||typeof deps.save!=='function')throw new Error('计划候选保存依赖不完整。');const candidate=clone(currentState);let next;try{next=buildCandidate(candidate)}catch(error){return {status:'invalid',writes:0,error}};
    try{const originalModes=new Map((currentState.stocks||[]).flatMap(stock=>(stock.plans||[]).map(plan=>[plan.id,normalizeMode(object(plan))])));const stocks=Array.isArray(next&&next.stocks)?next.stocks:[];for(const stock of stocks){if(stock.plans!==undefined&&!Array.isArray(stock.plans))return {status:'invalid',writes:0,error:new Error('计划集合格式无效。')};if((stock.plans||[]).some(plan=>!plan||typeof plan!=='object'||Array.isArray(plan)))return {status:'invalid',writes:0,error:new Error('计划候选包含畸形数据。')};stock.plans=(stock.plans||[]).map(plan=>{const normalized=normalizePlan(plan);if(originalModes.has(normalized.id)&&originalModes.get(normalized.id)!==normalized.planMode)throw new Error('不支持通过普通计划保存更改 planMode。');return normalized})}
    const allPlans=stocks.flatMap(stock=>stock.plans||[]),validation=validatePlanCollection(allPlans);if(!validation.ok)return {status:'invalid',writes:0,error:new Error(validation.errors.join('；'))};}catch(error){return {status:'invalid',writes:0,error}}
    try{const saved=await deps.save(next,{critical:true});if(saved===false||(saved&&saved.ok===false))throw new Error('critical save 返回失败。');if(typeof deps.adopt==='function')deps.adopt(saved&&saved.state?saved.state:next);return {status:'completed',writes:1,state:saved&&saved.state?saved.state:next}}catch(error){if(typeof deps.rollback==='function')deps.rollback(currentState);return {status:'failed',writes:1,error}}
  }

  return Object.freeze({SCHEMA_VERSION,PLAN_MODES,WATCH_FIELDS,WATCH_REQUIRED,WATCH_RULE_FIELDS,WATCH_LABELS,REVIEW_ACTION_LABELS,hasWatchDefinition,watchDefinition,validateWatchDefinition,validateWatchCanonical,createWatchPlan,editWatchPlan,terminateWatchPlan,isLegacyPricePlan,assertLegacyPricePlan,PLAN_STATUSES,VALIDITY_STATUSES,PRICE_TRIGGER_STATUSES,FULL_CONDITION_STATUSES,CONDITION_CATEGORIES,SOURCES,defaultPlan,normalizeDirection,normalizeAction,normalizeConditions,normalizePlan,createPlan,applyAuthoritativeEdit,reconfirmPlan,terminatePlan,evaluatePriceTrigger,observePriceTrigger,freshness,compactForPortfolio,buildContextReference,hasAllocationPremise,validatePlan,validatePlanCollection,commitCandidate,stable,hash,clone});
});
