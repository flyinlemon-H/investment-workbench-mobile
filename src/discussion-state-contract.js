(function(root,factory){
  const workbench=typeof module==='object'&&module.exports?require('./discussion-workbench.js'):root&&root.DiscussionWorkbench;
  const strictAiJson=typeof module==='object'&&module.exports?require('./strict-ai-json.js'):root&&root.StrictAiJson;
  const api=factory(workbench,strictAiJson);
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.DiscussionStateContract=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(Workbench,StrictAiJson){
  'use strict';

  if(!Workbench)throw new Error('DiscussionWorkbench is required.');
  if(!StrictAiJson||typeof StrictAiJson.parseStrictAiJson!=='function')throw new Error('StrictAiJson is required.');
  const RESULT_FIELDS=Object.freeze(['symbol','sourceDiscussionVersion','userDecision','actionAssessment','attentionLevel','trendAssessment','structureAssessment','stage','focusPoints','summary','keyChanges','risks','watchPoints','planRelation','confidence']);
  const object=value=>value&&typeof value==='object'&&!Array.isArray(value)?value:{};
  const array=value=>Array.isArray(value)?value:[];
  const text=value=>String(value??'').trim();
  const clone=value=>JSON.parse(JSON.stringify(value));
  function invalid(code,message,input=null){return {ok:false,previewReady:false,writes:0,code,message,input,currentState:null}}
  function parse(raw){
    const result=StrictAiJson.parseStrictAiJson(raw);
    return result.ok?result:{ok:false,error:result.userMessage,input:result.input,reason:result.reason};
  }
  function exactFields(source,allowed,label,errors){
    if(!source||typeof source!=='object'||Array.isArray(source)){errors.push(`${label} 必须是对象`);return false}
    const keys=Object.keys(source),extra=keys.filter(key=>!allowed.includes(key)),missing=allowed.filter(key=>!Object.prototype.hasOwnProperty.call(source,key));
    if(extra.length)errors.push(`${label} 包含未知字段：${extra.join(', ')}`);
    if(missing.length)errors.push(`${label} 缺少字段：${missing.join(', ')}`);
    return !extra.length&&!missing.length;
  }
  function stringList(source,key,limit,itemLimit,errors){
    const value=source&&source[key];
    if(!Array.isArray(value)){errors.push(`${key} 必须是字符串数组`);return []}
    if(value.length>limit||value.some(item=>typeof item!=='string'||!item.trim()||item.trim().length>itemLimit))errors.push(`${key} 最多${limit}项且每项为1至${itemLimit}字`);
    return value.map(text);
  }
  function allNaturalText(judgment){
    const action=object(judgment.actionAssessment),trend=object(judgment.trendAssessment),relation=object(judgment.planRelation),decision=object(judgment.userDecision);
    return [decision.headline,object(decision.holding).summary,object(decision.positionDirection).summary,object(decision.addAssessment).summary,object(decision.warning).summary,...array(object(decision.warning).items),object(decision.takeProfit).summary,object(decision.stopLoss).summary,action.headline,...array(action.reasons),...array(action.upgradeConditions),...array(action.downgradeConditions),...array(trend.timeframes).map(item=>item&&item.explanation),...array(judgment.structureAssessment).map(item=>item&&item.shortReason),judgment.stage,...array(judgment.focusPoints),judgment.summary,...array(judgment.keyChanges),...array(judgment.risks),...array(judgment.watchPoints),relation.summary].map(text).join('\n');
  }
  function validateDecisionSection(decision,key,statuses,errors){
    const source=object(decision[key]),normalized={status:text(source.status),summary:text(source.summary)};
    exactFields(decision[key],['status','summary'],`userDecision.${key}`,errors);
    if(!statuses.includes(normalized.status))errors.push(`userDecision.${key}.status 为未知固定值`);
    if(!normalized.summary||normalized.summary.length>160)errors.push(`userDecision.${key}.summary 必须为1至160字`);
    return normalized;
  }
  function validateUserDecision(value,expected,errors){
    const source=object(value);exactFields(value,['headline','holding','positionDirection','addAssessment','warning','takeProfit','stopLoss','riskSource'],'userDecision',errors);
    const userDecision={headline:text(source.headline),holding:validateDecisionSection(source,'holding',Workbench.HOLDING_STATUSES,errors),positionDirection:validateDecisionSection(source,'positionDirection',Workbench.POSITION_DIRECTION_STATUSES,errors),addAssessment:validateDecisionSection(source,'addAssessment',Workbench.ADD_ASSESSMENT_STATUSES,errors),warning:{summary:text(source.warning&&source.warning.summary),items:stringList(object(source.warning),'items',3,160,errors)},takeProfit:validateDecisionSection(source,'takeProfit',Workbench.TAKE_PROFIT_STATUSES,errors),stopLoss:validateDecisionSection(source,'stopLoss',Workbench.STOP_LOSS_STATUSES,errors),riskSource:text(source.riskSource)};
    exactFields(source.warning,['summary','items'],'userDecision.warning',errors);
    if(!userDecision.headline||userDecision.headline.length>120||/[\r\n]/.test(userDecision.headline))errors.push('userDecision.headline 必须为1至120字的单行文字');
    if(!userDecision.warning.summary||userDecision.warning.summary.length>160)errors.push('userDecision.warning.summary 必须为1至160字');
    if(!Workbench.RISK_SOURCES.includes(userDecision.riskSource))errors.push('userDecision.riskSource 为未知固定值');
    return userDecision;
  }
  const STRING_FIELDS=new Set(['symbol','sourceDiscussionVersion','headline','summary','status','riskSource','category','priority','attentionLevel','overall','timeframe','explanation','type','source','sourceAsOf','shortReason','stage','confidence']);
  function validateStringTypes(value,errors,path='currentState'){
    if(!value||typeof value!=='object')return;
    for(const [key,item] of Object.entries(value)){
      const at=path+'.'+key;
      if(STRING_FIELDS.has(key)&&typeof item!=='string'){errors.push(at+' 必须是字符串');continue}
      if(item&&typeof item==='object'){
        if(Array.isArray(item))item.forEach((row,i)=>{if(row&&typeof row==='object'&&!Array.isArray(row))validateStringTypes(row,errors,at+'['+i+']');else if(typeof row!=='string')errors.push(at+' 必须包含字符串或指定对象')});
        else validateStringTypes(item,errors,at);
      }else if(typeof item!=='string')errors.push(at+' 必须是字符串');
    }
  }
  function validateJudgment(value,expected={}){
    const source=object(value),errors=[],requiresDecision=text(expected.sourceDiscussionVersion).startsWith('discussion_v3_'),fields=requiresDecision?RESULT_FIELDS:RESULT_FIELDS.filter(key=>key!=='userDecision'),keys=Object.keys(source),extra=keys.filter(key=>!fields.includes(key)&&!(key==='userDecision'&&!requiresDecision)),missing=fields.filter(key=>!Object.prototype.hasOwnProperty.call(source,key));
    validateStringTypes(value,errors);
    if(extra.length)errors.push(`currentState contains unknown fields: ${extra.join(', ')}`);
    if(missing.length)errors.push(`currentState missing fields: ${missing.join(', ')}`);
    const symbol=Workbench.canonical(source.symbol),sourceDiscussionVersion=text(source.sourceDiscussionVersion),stage=text(source.stage),summary=text(source.summary),confidence=text(source.confidence),actionSource=object(source.actionAssessment),trendSource=object(source.trendAssessment),relationSource=object(source.planRelation),userDecision=Object.prototype.hasOwnProperty.call(source,'userDecision')?validateUserDecision(source.userDecision,expected,errors):null;
    if(!symbol||symbol!==Workbench.canonical(expected.symbol))errors.push('symbol 与本次讨论不一致');
    if(!sourceDiscussionVersion||sourceDiscussionVersion!==text(expected.sourceDiscussionVersion))errors.push('结论来源版本已过期或不一致');
    if(!stage||stage.length>40||/[\r\n]/.test(stage))errors.push('stage 必须是不超过40字的单行文字');
    if(!summary||summary.length>500)errors.push('summary 必须为1至500字');
    exactFields(source.actionAssessment,['category','priority','headline','reasons','upgradeConditions','downgradeConditions'],'actionAssessment',errors);
    const actionAssessment={category:text(actionSource.category),priority:text(actionSource.priority),headline:text(actionSource.headline),reasons:stringList(actionSource,'reasons',5,200,errors),upgradeConditions:stringList(actionSource,'upgradeConditions',3,200,errors),downgradeConditions:stringList(actionSource,'downgradeConditions',3,200,errors)};
    if(!Workbench.ACTION_CATEGORIES.includes(actionAssessment.category))errors.push('category 为未知固定值');
    if(!Workbench.ACTION_PRIORITIES.includes(actionAssessment.priority))errors.push('priority 为未知固定值');
    if(!actionAssessment.headline||actionAssessment.headline.length>140||/[\r\n]/.test(actionAssessment.headline))errors.push('headline 必须为1至140字的单行文字');
    const attentionLevel=text(source.attentionLevel);if(!Workbench.ATTENTION_LEVELS.includes(attentionLevel))errors.push('attentionLevel 为未知固定值');
    exactFields(source.trendAssessment,['overall','timeframes'],'trendAssessment',errors);
    const trendAssessment={overall:text(trendSource.overall),timeframes:[]};
    if(!Workbench.TREND_STATUSES.includes(trendAssessment.overall))errors.push('overall 为未知趋势值');
    if(!Array.isArray(trendSource.timeframes)||trendSource.timeframes.length>3)errors.push('timeframes 最多3项');
    else trendAssessment.timeframes=trendSource.timeframes.map((item,index)=>{const raw=object(item),normalized={timeframe:text(raw.timeframe),status:text(raw.status),explanation:text(raw.explanation)};exactFields(item,['timeframe','status','explanation'],`timeframes[${index}]`,errors);if(!normalized.timeframe||normalized.timeframe.length>20||!Workbench.TREND_STATUSES.includes(normalized.status)||!normalized.explanation||normalized.explanation.length>100)errors.push(`timeframes[${index}] 无效`);return normalized});
    let structureAssessment=[];
    if(!Array.isArray(source.structureAssessment)||source.structureAssessment.length>3)errors.push('structureAssessment 最多3项');
    else structureAssessment=source.structureAssessment.map((item,index)=>{const raw=object(item),normalized={timeframe:text(raw.timeframe),type:text(raw.type),status:text(raw.status),source:text(raw.source),sourceAsOf:text(raw.sourceAsOf),shortReason:text(raw.shortReason)};exactFields(item,['timeframe','type','status','source','sourceAsOf','shortReason'],`structureAssessment[${index}]`,errors);if(!normalized.timeframe||normalized.timeframe.length>20||!Workbench.STRUCTURE_TYPES.includes(normalized.type)||!Workbench.STRUCTURE_STATUSES.includes(normalized.status)||!Workbench.STRUCTURE_SOURCES.includes(normalized.source)||normalized.sourceAsOf.length>40||!normalized.shortReason||normalized.shortReason.length>140)errors.push(`structureAssessment[${index}] 无效`);return normalized});
    const focusPoints=stringList(source,'focusPoints',5,240,errors),keyChanges=stringList(source,'keyChanges',5,240,errors),risks=stringList(source,'risks',5,240,errors),watchPoints=stringList(source,'watchPoints',5,240,errors);
    exactFields(source.planRelation,['status','summary'],'planRelation',errors);
    const planRelation={status:text(relationSource.status),summary:text(relationSource.summary)};
    if(!Workbench.PLAN_RELATION_STATUSES.includes(planRelation.status)||!planRelation.summary||planRelation.summary.length>300)errors.push('planRelation 无效');
    if(!Workbench.CONFIDENCE_LEVELS.includes(confidence))errors.push('confidence 只能为 high、medium、low');
    return {ok:errors.length===0,errors,judgment:{symbol,sourceDiscussionVersion,...(userDecision?{userDecision}:{}),actionAssessment,attentionLevel,trendAssessment,structureAssessment,stage,focusPoints,summary,keyChanges,risks,watchPoints,planRelation,confidence}};
  }
  function assessTechnicalAnchorReadiness(prepared){
    const snapshot=object(prepared&&prepared.technicalSnapshot),anchor=object(snapshot.anchorBar);
    const reference=object(object(prepared&&prepared.references).technical),facts=object(object(object(prepared&&prepared.context).currentFacts).technical);
    const date=Workbench.validDate(anchor.date),close=Number(anchor.close);
    let reason='anchor_ready';
    if(!date)reason='anchor_date_invalid';
    else if(anchor.is_complete_bar===false)reason='anchor_incomplete';
    else if(!Number.isFinite(close)||close<=0)reason='anchor_close_invalid';
    else if(Workbench.validDate(reference.technicalAsOf)!==date)reason='anchor_date_mismatch';
    else if([snapshot.technicalAsOf,facts.technicalAsOf,prepared&&prepared.technicalAsOf].some(value=>value!==undefined&&Workbench.validDate(value)!==date))reason='anchor_date_mismatch';
    const ready=reason==='anchor_ready';
    return {ready,code:ready?'anchor_ready':'anchor_not_ready',reason,message:ready?'技术锚点可用于连续结论保存。':'缺少完整日K技术锚点，当前讨论可以继续，但暂不能保存为连续结论。请先刷新或补齐该标的的完整日K技术数据，再重新开始讨论并整理结论。'};
  }
function process(raw,options={}){
  const parsed=parse(raw);if(!parsed.ok)return invalid('parse_error',parsed.error);
  const top=object(parsed.value),topKeys=Object.keys(top);
  if(topKeys.length!==1||topKeys[0]!=='currentState')return invalid('schema_error',StrictAiJson.contractMessage('顶层只能包含 currentState。'),parsed.input);
  const validation=validateJudgment(top.currentState,{symbol:options.expectedSymbol,sourceDiscussionVersion:options.sourceDiscussionVersion,holdingShares:options.holdingShares,hasActivePlan:options.hasActivePlan,technicalDataStatus:options.prepared&&options.prepared.context&&options.prepared.context.dataReadiness&&!options.prepared.context.dataReadiness.technical.ready?'unavailable':options.technicalDataStatus,programProvesFullPlanConditions:options.programProvesFullPlanConditions,marketRiskAvailable:options.marketRiskAvailable===true});
  if(!validation.ok)return invalid('validation_error',StrictAiJson.contractMessage(validation.errors.join('；')),parsed.input);
  const anchorReadiness=options.prepared?assessTechnicalAnchorReadiness(options.prepared):null;
  if(anchorReadiness&&!anchorReadiness.ready)return {ok:true,previewReady:false,writes:0,code:anchorReadiness.code,reason:anchorReadiness.reason,message:anchorReadiness.message,input:parsed.input,currentState:validation.judgment};
  return {ok:true,previewReady:true,writes:0,code:'valid',message:'结论结构可导入，尚未写入。保存后显示核对提示。',input:parsed.input,currentState:validation.judgment};
}
  function findStock(state,symbol){const target=Workbench.canonical(symbol),stocks=array(state&&state.stocks),index=stocks.findIndex(stock=>Workbench.canonical(stock)===target);return {stocks,index,stock:index>=0?stocks[index]:null}}
  function previewBinding(prepared){return Workbench.stable({sourceDiscussionVersion:prepared.sourceDiscussionVersion,protectedHash:prepared.protectedHash,evidenceHash:prepared.evidenceHash,technicalSnapshot:prepared.technicalSnapshot,references:prepared.references})}
  // Session-only proof: retain the complete version preimage, and erase exactly shares.
  // Unknown/missing preimages and every other field remain hard protected.
  function reconcileContext(prepared,current,options={}){
    const blocked=(changes=['other_protected_change'])=>({status:'hard_block',changes,message:'受保护的持仓、技术锚点、计划或长期逻辑已经变化，请重新开始讨论。'});
    if(!prepared||!current)return blocked();
    if(!text(prepared.protectedHash)||!text(prepared.sourceDiscussionVersion)||!current.context?.currentFacts)return blocked();
    if(prepared.protectedHash===current.protectedHash&&prepared.sourceDiscussionVersion===current.sourceDiscussionVersion&&prepared.evidenceHash===current.evidenceHash)return {status:'no_change',changes:[]};
    const before=object(prepared.protectedSnapshot),after=object(current.protectedSnapshot),changes=[];
    const names={symbol:'symbol_changed',technicalAnchor:'technical_anchor_changed',plans:'plan_changed',planReviews:'plan_changed',planRuntime:'runtime_changed',longTermLogic:'long_term_logic_changed'};
    for(const key of new Set([...Object.keys(before),...Object.keys(after)]))if(key!=='holding'&&Workbench.stable(before[key])!==Workbench.stable(after[key]))changes.push(names[key]||'other_protected_change');
    for(const key of new Set([...Object.keys(object(before.holding)),...Object.keys(object(after.holding))]))if(key!=='shares'&&Workbench.stable(before.holding?.[key])!==Workbench.stable(after.holding?.[key]))changes.push('other_protected_change');
    if(prepared.evidenceHash!==current.evidenceHash||prepared.sourceBinding?.currentStateId!==current.sourceBinding?.currentStateId)changes.push('other_protected_change');
    const oldShares=before.holding?.shares,newShares=after.holding?.shares;
    if(!Number.isFinite(oldShares)||oldShares<0||!Number.isFinite(newShares)||newShares<0||oldShares===newShares)return blocked(changes.length?changes:undefined);
    const statusChanged=(oldShares>0)!==(newShares>0);
    changes.push(statusChanged?'holding_status_changed':'holding_quantity_changed');
    const validBinding=p=>p.sourceBinding&&Workbench.stable(p.sourceBinding.protectedSnapshot)===Workbench.stable(p.protectedSnapshot)&&p.protectedHash===`discussionctx_${Workbench.hash(p.protectedSnapshot)}`&&p.sourceDiscussionVersion===`discussion_v3_${Workbench.hash(p.sourceBinding)}`;
    if(options.transport!=='manual'||!validBinding(prepared)||!validBinding(current))return blocked(changes);
    const oldBinding=clone(prepared.sourceBinding),newBinding=clone(current.sourceBinding);
    delete oldBinding.protectedSnapshot.holding.shares;delete newBinding.protectedSnapshot.holding.shares;
    if(Workbench.stable(oldBinding)!==Workbench.stable(newBinding)||prepared.evidenceHash!==current.evidenceHash||Workbench.stable(prepared.technicalSnapshot)!==Workbench.stable(current.technicalSnapshot))return blocked(changes);
    for(const p of [prepared,current])if(!p.references?.holding||p.references.holding.shares!==p.protectedSnapshot.holding.shares||p.context?.currentFacts?.holding?.shares!==p.protectedSnapshot.holding.shares)return blocked(changes);
    const oldRefs=clone(prepared.references),newRefs=clone(current.references);
    for(const refs of [oldRefs,newRefs]){delete refs.holding.shares;delete refs.holding.hash}
    if(Workbench.stable(oldRefs)!==Workbench.stable(newRefs))return blocked(changes);
    const title=statusChanged?'持仓状态在本次讨论期间发生变化':'持仓信息已变化';
    const transition=statusChanged?`当前已由“${oldShares>0?'有持仓':'零持仓'}”变为“${newShares>0?'有持仓':'零持仓'}”。`:'';
    return {status:'warning_reconcilable',changes,oldShares,newShares,statusChanged,title,message:`讨论开始：${oldShares.toLocaleString('zh-CN')} 股；当前记录：${newShares.toLocaleString('zh-CN')} 股。${transition}保存将绑定当前持仓快照；AI 原判断保持不变，差异将在保存后提示。`,acknowledgment:Workbench.stable({original:previewBinding(prepared),current:previewBinding(current)})};
  }
  function processImport(raw,prepared,current,options={}){
    const parsed=parse(raw);if(!parsed.ok)return invalid('parse_error',parsed.error);
    if(current){const anchor=assessTechnicalAnchorReadiness(current);if(!anchor.ready)return {...invalid(anchor.code,anchor.message,parsed.input),reason:anchor.reason}}
    const reconciliation=reconcileContext(prepared,current,options);
    if(reconciliation.status==='hard_block')return invalid('context_changed',reconciliation.message,parsed.input);
    const needsAck=reconciliation.status==='warning_reconcilable'&&options.acknowledgment!==reconciliation.acknowledgment,facts=current.context.currentFacts;
    const result=process(raw,{prepared:current,expectedSymbol:current.context.symbol,sourceDiscussionVersion:prepared.sourceDiscussionVersion,holdingShares:needsAck?undefined:facts.holding.shares,hasActivePlan:facts.plans.length>0,technicalDataStatus:facts.technical.dataStatus,marketRiskAvailable:Boolean(facts.marketRisk.status&&facts.marketRisk.status!=='unavailable'),programProvesFullPlanConditions:false});
    if(!result.ok||!result.previewReady)return result;
    if(needsAck)return {...invalid('holding_acknowledgment_required',reconciliation.message,parsed.input),reconciliation};
    return {...result,previewBinding:previewBinding(current),reconciliation,acknowledgment:reconciliation.status==='warning_reconcilable'?reconciliation.acknowledgment:null};
  }
  function buildCandidate(state,result,options={}){
    if(!result||!result.ok||!result.previewReady)throw new Error('必须先完成有效预览。');
    const prepared=options.prepared;
    if(!prepared||prepared.sourceDiscussionVersion!==result.currentState.sourceDiscussionVersion)throw new Error('讨论上下文缺失或已过期，请重新开始讨论。');
    const candidate=clone(state),found=findStock(candidate,result.currentState.symbol);
    if(!found.stock)throw new Error('找不到本次讨论对应的股票。');
    const rebuilt=Workbench.buildContext(found.stock,{state:candidate,allStocks:candidate.stocks,planReviewStore:candidate.planReviews,planReviewApi:options.planReviewApi,timeZone:options.timeZone,now:options.now});
    const reconciliation=reconcileContext(prepared,rebuilt,options);
    if(reconciliation.status==='hard_block')throw new Error(reconciliation.message);
    if(result.previewBinding&&result.previewBinding!==previewBinding(rebuilt))throw new Error('预览后当前事实已变化，请重新预览并确认持仓信息。');
    if(reconciliation.status==='warning_reconcilable'&&(!result.previewBinding||result.acknowledgment!==reconciliation.acknowledgment))throw new Error('持仓信息已变化，请重新预览并确认 AI 已知晓最新仓位。');
    if(prepared.evidenceHash&&rebuilt.evidenceHash!==prepared.evidenceHash)throw new Error('资料已更新，请重新生成本次讨论上下文。');
    const facts=rebuilt.context.currentFacts;
    const checked=process(JSON.stringify({currentState:result.currentState}),{expectedSymbol:rebuilt.context.symbol,sourceDiscussionVersion:prepared.sourceDiscussionVersion,holdingShares:facts.holding.shares,hasActivePlan:facts.plans.length>0,technicalDataStatus:facts.technical.dataStatus,marketRiskAvailable:Boolean(facts.marketRisk.status&&facts.marketRisk.status!=='unavailable'),programProvesFullPlanConditions:false,prepared:rebuilt});
    if(!checked.ok||!checked.previewReady)throw new Error(checked.message);
  const confirmedAt=(()=>{const raw=options.now instanceof Date?options.now:new Date(options.now||Date.now());if(!Number.isFinite(raw.getTime()))throw new Error('确认时间无效。');return raw.toISOString()})();
    const confirmedDate=Workbench.localCalendarDate(confirmedAt,{timeZone:options.timeZone||'Asia/Shanghai'}),judgment=result.currentState,store=Workbench.normalizeStore(found.stock.discussionState);
    const anchorReadiness=assessTechnicalAnchorReadiness({technicalSnapshot:prepared&&prepared.technicalSnapshot,references:prepared&&prepared.references});
    if(!anchorReadiness.ready)throw Object.assign(new Error(anchorReadiness.message),{code:anchorReadiness.code,reason:anchorReadiness.reason});
    const next=Workbench.normalizeState({
      schemaVersion:judgment.userDecision?Workbench.STATE_SCHEMA_VERSION:Workbench.V2_STATE_SCHEMA_VERSION,
      stateId:`discussionstate_${Workbench.hash(`${judgment.symbol}|${judgment.sourceDiscussionVersion}|${confirmedAt}`)}`,
      symbol:judgment.symbol,sourceDiscussionVersion:judgment.sourceDiscussionVersion,...(judgment.userDecision?{userDecision:judgment.userDecision}:{}),actionAssessment:judgment.actionAssessment,attentionLevel:judgment.attentionLevel,trendAssessment:judgment.trendAssessment,structureAssessment:judgment.structureAssessment,stage:judgment.stage,focusPoints:judgment.focusPoints,summary:judgment.summary,keyChanges:judgment.keyChanges,risks:judgment.risks,watchPoints:judgment.watchPoints,planRelation:judgment.planRelation,confidence:judgment.confidence,
      technicalAsOf:rebuilt.technicalSnapshot.anchorBar.date,confirmedAt,confirmedDate,technicalSnapshot:rebuilt.technicalSnapshot,references:rebuilt.references
    });
    const validation=Workbench.validateState(next);if(!validation.ok)throw new Error(validation.errors.join('；'));
    if(store.current)store.history.push(store.current);
    store.current=validation.state;store.history=store.history.slice(-Workbench.HISTORY_LIMIT);
    const storeValidation=Workbench.validateStore(store);if(!storeValidation.ok)throw new Error(storeValidation.errors.join('；'));
    const v4=typeof module==='object'&&module.exports?require('./discussion-v4'):globalThis.DiscussionV4;if(v4)v4.recordJudgment(candidate,found.stock.id,validation.state,options.sourceContext||null);
    found.stock.discussionState=store;found.stock.updatedAt=Math.max(Number(found.stock.updatedAt)||0,Date.parse(confirmedAt));
    return {candidate,currentState:validation.state,previous:store.history[store.history.length-1]||null};
  }
  async function commit(result,state,deps={},options={}){
    if(!result||!result.ok||!result.previewReady)return {status:'preview_required',writes:0};
    if(typeof deps.saveCandidate!=='function')return {status:'failed',writes:0,error:new Error('saveCandidate unavailable')};
    let built;try{built=buildCandidate(state,result,options)}catch(error){return {status:'invalid',writes:0,error}}
    try{
      const saved=await deps.saveCandidate(built.candidate,{critical:true}),next=saved&&saved.state?saved.state:(saved&&Array.isArray(saved.stocks)?saved:built.candidate);
      if(saved===false||(saved&&saved.ok===false))throw Object.assign(new Error('critical save failed'),{code:saved&&saved.type||'save_failed',cause:saved&&saved.error});
      if(typeof deps.adoptCandidate==='function')deps.adoptCandidate(next);
      if(typeof deps.render==='function')deps.render();
      return {status:'completed',writes:1,state:next,currentState:built.currentState};
    }catch(error){if(typeof deps.rollback==='function')deps.rollback(state);return {status:'failed',writes:1,error}}
  }
  // Program-derived diagnostics, based only on the immutable import-time snapshot.
  // Never call this from import validation; unknown natural language is left alone.
  function postImportDiagnostics(saved){
    const shares=saved?.references?.holding?.shares;
    if(!Number.isFinite(shares)||shares<0)return [];
    const prose=allNaturalText(saved),clauses=prose.split(/[\n。！？；;]/).map(text),diagnostics=[];
    const currentClaims=clauses.flatMap(clause=>{
      // Anchored current-fact declarations only: proposals, quotes, history and conditions do not qualify.
      const m=clause.match(/^(?:当前|目前|现在)\s*(?:实际)?(?:持有|持仓(?:数量)?(?:为|是)?|持股(?:数量)?(?:为|是)?)\s*((?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?)\s*股(?:[，,：:、\s]|$)/);
      return m?[Number(m[1].replace(/,/g,''))]:[];
    });
    if(currentClaims.some(value=>value!==shares))diagnostics.push({code:'holding_fact_mismatch',severity:'warning',title:'持仓核对',message:'AI 判断中的持仓数量与导入时程序记录不一致，请核对。投资事实仍以程序记录为准，程序持仓事实未被修改。'});
    const d=saved.userDecision,positionText=clauses.some(clause=>/^(?:(?:当前|目前|现在)\s*)?(?:建议)?(?:继续持有|减仓|保护已有利润|持仓止盈|持仓继续观察)/.test(clause));
    const zeroText=clauses.some(clause=>/^(?:当前|目前|现在)\s*(?:并)?(?:没有持仓|无持仓|未持仓|空仓)/.test(clause));
    const heldStatus=d&&(['safe','caution','reduce_review','risk_control'].includes(d.holding?.status)||['hold','hold_no_add','reduce_review','risk_control'].includes(d.positionDirection?.status)||['watch','review'].includes(d.takeProfit?.status)||['watch','risk_control'].includes(d.stopLoss?.status));
    if(shares===0&&(positionText||heldStatus||['hold_watch','reduce_review','add_review','risk_control'].includes(saved.actionAssessment?.category)))diagnostics.push({code:'position_semantic_mismatch',severity:'warning',title:'仓位语义核对',message:'导入时程序记录为零持仓，但 AI 判断使用了持仓语义，请核对该判断。'});
    else if(shares>0&&(zeroText||d?.holding?.status==='not_applicable'||saved.actionAssessment?.category==='entry_review'))diagnostics.push({code:'position_semantic_mismatch',severity:'warning',title:'仓位语义核对',message:'导入时程序记录为有持仓，但 AI 判断使用了零持仓语义，请核对该判断。'});
    return diagnostics;
  }
  function renderDiagnostics(saved){
    const rows=postImportDiagnostics(saved);
    return rows.length?`<section class="discussion-post-import-diagnostics" aria-label="核对提示" style="margin:12px 0;padding:12px;border-left:3px solid #b88728;background:rgba(184,135,40,.08);overflow-wrap:anywhere"><b>核对提示</b>${rows.map(row=>`<div data-diagnostic="${escapeHtml(row.code)}"><strong>${escapeHtml(row.title)}</strong><p>${escapeHtml(row.message)}</p></div>`).join('')}</section>`:'';
  }
  function renderPreview(result,program={}){
    if(!result||!result.ok)return `<div class="discussion-import-error">${escapeHtml(result&&result.message||'预览不可用')}</div>`;
    const item=result.currentState,decision=item.userDecision,technicalAsOf=text(program.technicalAsOf)||'待程序确认',confirmedDate=text(program.confirmedDate)||'保存时由程序生成',actionLabels={risk_control:'风险控制',reduce_review:'减仓复核',hold_watch:'持有观察',wait_confirmation:'等待确认',add_review:'加仓复核',entry_review:'建仓复核',no_action:'暂不操作'},priorityLabels={high:'高优先级',medium:'中优先级',low:'低优先级'},attentionLabels={normal:'普通观察',focused:'重点观察',window:'临近窗口'},trendLabels={uptrend:'上升',downtrend:'下降',sideways:'震荡',recovery:'修复',rebound:'反弹',unclear:'不明确'},typeLabels={top:'顶部结构',bottom:'底部结构',breakout:'突破结构',pullback:'回踩结构',recovery:'修复结构',consolidation:'整理结构',none:'暂无明确结构',unclear:'结构不明确'},statusLabels={forming:'形成中',confirmed:'已确认',valid:'仍有效',broken:'已破坏',unclear:'不明确'};
    const trends=[`整体：${trendLabels[item.trendAssessment.overall]}`,...item.trendAssessment.timeframes.map(row=>`${row.timeframe}：${trendLabels[row.status]}｜${row.explanation}`)],structures=item.structureAssessment.map(row=>`${row.timeframe}：${typeLabels[row.type]}${statusLabels[row.status]}｜${row.shortReason}`);
    if(!decision)return `<div class="discussion-import-preview"><div class="discussion-preview-anchor"><b>程序锚点</b><span>技术日 ${escapeHtml(technicalAsOf)}</span><span>确认日 ${escapeHtml(confirmedDate)}</span></div><div class="discussion-preview-decision"><b>历史格式结论</b><strong>操作倾向：${escapeHtml(actionLabels[item.actionAssessment.category])}</strong><p>${escapeHtml(item.actionAssessment.headline)}</p></div><dl><dt>趋势</dt><dd>${list(trends)}</dd><dt>结构</dt><dd>${list(structures)}</dd><dt>核心结论</dt><dd>${escapeHtml(item.summary)}</dd></dl></div>`;
    return `<div class="discussion-import-preview"><div class="discussion-preview-anchor"><b>程序锚点</b><span>技术日 ${escapeHtml(technicalAsOf)}</span><span>确认日 ${escapeHtml(confirmedDate)}</span></div><div class="discussion-preview-decision"><b>当前结论</b><strong>${escapeHtml(decision.headline)}</strong><p><b>仓位方向：</b>${escapeHtml(decision.positionDirection.summary)}</p><p><b>${decision.holding.status==='not_applicable'?'如果想建仓':'如果想加仓'}：</b>${escapeHtml(decision.addAssessment.summary)}</p><p><b>需要警惕：</b>${escapeHtml(decision.warning.summary)}</p></div><details><summary>判断依据</summary><dl><dt>操作复核</dt><dd>${escapeHtml(actionLabels[item.actionAssessment.category])} · ${escapeHtml(attentionLabels[item.attentionLevel])} · ${escapeHtml(priorityLabels[item.actionAssessment.priority])}</dd><dt>趋势</dt><dd>${list(trends)}</dd><dt>结构</dt><dd>${list(structures)}</dd><dt>当前重点</dt><dd>${list(item.focusPoints)}</dd><dt>与计划关系</dt><dd>${escapeHtml(item.planRelation.summary)}</dd><dt>核心结论</dt><dd>${escapeHtml(item.summary)}</dd><dt>置信度</dt><dd>${escapeHtml(item.confidence)}</dd></dl></details></div>`;
  }
  function list(items){return items.length?`<ul>${items.map(item=>`<li>${escapeHtml(item)}</li>`).join('')}</ul>`:'无'}
  function escapeHtml(value){return String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]))}

  return Object.freeze({RESULT_FIELDS,parse,validateJudgment,postImportDiagnostics,renderDiagnostics,assessTechnicalAnchorReadiness:assessTechnicalAnchorReadiness,process,reconcileContext,processImport,findStock,buildCandidate,commit,renderPreview,escapeHtml,clone});
});
