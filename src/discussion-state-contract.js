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
  const FULL_CONDITION_SATISFIED_PATTERN=/(?:完整执行条件|(?:完整)?(?:计划)?条件)(?:已经|已)(?:全部)?满足/g;
  const LOCAL_NEGATION_SUFFIX_PATTERN=/(?:不等于|不代表|不意味着|并非|尚未|未确认|尚不能(?:确认)?|不能(?:确认)?|无法确认|没有确认|暂未确认)$/;
  function locallyNegatedFullConditionClaim(source,index){
    const clauseStart=Math.max(source.lastIndexOf('\n',index-1),source.lastIndexOf('。',index-1),source.lastIndexOf('！',index-1),source.lastIndexOf('？',index-1),source.lastIndexOf('；',index-1),source.lastIndexOf(';',index-1))+1;
    return LOCAL_NEGATION_SUFFIX_PATTERN.test(source.slice(clauseStart,index).trimEnd());
  }
  function hasAffirmativeFullConditionClaim(source){
    FULL_CONDITION_SATISFIED_PATTERN.lastIndex=0;
    let match;
    while((match=FULL_CONDITION_SATISFIED_PATTERN.exec(source))){
      if(!locallyNegatedFullConditionClaim(source,match.index))return true;
    }
    return /(?:达到|进入|触发).{0,12}(?:可以|可).{0,4}直接执行|(?:所有|全部)(?:确认)?条件(?:都)?(?:已经|已)(?:完成|成立)/.test(source);
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
    const primary=[userDecision.headline,userDecision.holding.summary,userDecision.positionDirection.summary,userDecision.addAssessment.summary,userDecision.warning.summary,...userDecision.warning.items,userDecision.takeProfit.summary,userDecision.stopLoss.summary].map(text),primaryText=primary.join('\n');
    if(/\b(?:recovery|pullback|forming|sourceDiscussionVersion|snapshotHash|technical anchor)\b/i.test(primaryText)||/(?:日线修复|60分钟结构|完整条件|价格触发|技术锚点)/.test(primaryText))errors.push('userDecision 第一层文字包含技术或系统术语');
    if(/(?:不等于|不代表|不能说明|尚不能证明)/.test(primaryText))errors.push('userDecision 第一层文字应直接表达判断，不使用系统免责声明');
    if(/[0-9０-９]|[零〇一二两三四五六七八九十百千万]+\s*(?:元|块|股|成|百分之)/.test(primaryText))errors.push('userDecision 不得包含由 AI 重述或发明的精确价格、比例、股数或日期');
    const meaningful=primary.filter(Boolean),seen=new Set();if(meaningful.some(item=>seen.has(item)||!seen.add(item)))errors.push('userDecision 各区块不得逐字重复同一判断');
    const held=Number(expected.holdingShares)>0,holdingKnown=expected.holdingShares!==undefined&&expected.holdingShares!==null;
    if(holdingKnown&&!held){
      if(userDecision.holding.status!=='not_applicable'||userDecision.takeProfit.status!=='not_applicable'||userDecision.stopLoss.status!=='not_applicable')errors.push('零持仓时 holding、takeProfit、stopLoss 必须为 not_applicable');
      if(/继续持有|加仓|减仓|止盈|止损/.test(primaryText))errors.push('零持仓结论不得假设已有持仓');
    }
    if(holdingKnown&&held&&userDecision.holding.status==='not_applicable')errors.push('已有持仓时必须回答持有风险');
    if(['market','both'].includes(userDecision.riskSource)&&!expected.marketRiskAvailable)errors.push('没有明确市场风险输入时不得归因于大盘');
    return userDecision;
  }
  function validateJudgment(value,expected={}){
    const source=object(value),errors=[],requiresDecision=text(expected.sourceDiscussionVersion).startsWith('discussion_v3_'),fields=requiresDecision?RESULT_FIELDS:RESULT_FIELDS.filter(key=>key!=='userDecision'),keys=Object.keys(source),extra=keys.filter(key=>!fields.includes(key)&&!(key==='userDecision'&&!requiresDecision)),missing=fields.filter(key=>!Object.prototype.hasOwnProperty.call(source,key));
    if(extra.length)errors.push(`currentState contains unknown fields: ${extra.join(', ')}`);
    if(missing.length)errors.push(`currentState missing fields: ${missing.join(', ')}`);
    const symbol=Workbench.canonical(source.symbol),sourceDiscussionVersion=text(source.sourceDiscussionVersion),stage=text(source.stage),summary=text(source.summary),confidence=text(source.confidence),actionSource=object(source.actionAssessment),trendSource=object(source.trendAssessment),relationSource=object(source.planRelation),userDecision=source.userDecision?validateUserDecision(source.userDecision,expected,errors):null;
    if(!symbol||symbol!==Workbench.canonical(expected.symbol))errors.push('symbol 与本次讨论不一致');
    if(!sourceDiscussionVersion||sourceDiscussionVersion!==text(expected.sourceDiscussionVersion))errors.push('结论来源版本已过期或不一致');
    if(!stage||stage.length>40||/[\r\n]/.test(stage))errors.push('stage 必须是不超过40字的单行文字');
    if(!summary||summary.length>500)errors.push('summary 必须为1至500字');
    exactFields(source.actionAssessment,['category','priority','headline','reasons','upgradeConditions','downgradeConditions'],'actionAssessment',errors);
    const actionAssessment={category:text(actionSource.category),priority:text(actionSource.priority),headline:text(actionSource.headline),reasons:stringList(actionSource,'reasons',5,200,errors),upgradeConditions:stringList(actionSource,'upgradeConditions',3,200,errors),downgradeConditions:stringList(actionSource,'downgradeConditions',3,200,errors)};
    if(!Workbench.ACTION_CATEGORIES.includes(actionAssessment.category))errors.push('category 为未知固定值');
    if(!Workbench.ACTION_PRIORITIES.includes(actionAssessment.priority))errors.push('priority 为未知固定值');
    if(!actionAssessment.headline||actionAssessment.headline.length>140||/[\r\n]/.test(actionAssessment.headline))errors.push('headline 必须为1至140字的单行文字');
    if(!actionAssessment.reasons.length)errors.push('reasons 至少需要1项因果依据');
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
    const held=Number(expected.holdingShares)>0,holdingKnown=expected.holdingShares!==undefined&&expected.holdingShares!==null;
    if(holdingKnown&&!held&& !['entry_review','wait_confirmation','no_action'].includes(actionAssessment.category))errors.push('零持仓候选的操作倾向与持仓事实冲突');
    if(holdingKnown&&held&&actionAssessment.category==='entry_review')errors.push('已有持仓不能显示建仓复核');
    if(userDecision&&actionAssessment.category==='risk_control'&&userDecision.holding.status==='safe'&&userDecision.positionDirection.status!=='risk_control'&&userDecision.stopLoss.status==='none')errors.push('风险控制判断与 userDecision 全部安全的表达冲突');
    if(expected.hasActivePlan===false&&['aligned','conflict'].includes(planRelation.status))errors.push('没有有效计划时不能标记计划一致或冲突');
    if(expected.hasActivePlan===true&&planRelation.status==='no_matching_plan')errors.push('存在有效计划时不能标记为没有对应计划');
    if(expected.technicalDataStatus&&expected.technicalDataStatus!=='fresh'&&confidence==='high')errors.push('技术资料未标记为较新时 confidence 不能为 high');
    const prose=allNaturalText(source),internalTokens=['actionAssessment','attentionLevel','trendAssessment','structureAssessment','validityStatus','planReview','sourceDiscussionVersion','superseded','needs_review','risk_control','reduce_review','hold_watch','wait_confirmation','add_review','entry_review','no_action','uptrend','downtrend','sideways','recovery','rebound','unclear'];
    if(internalTokens.some(token=>new RegExp(`(^|[^A-Za-z_])${token.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')}([^A-Za-z_]|$)`,'i').test(prose)))errors.push('中文正文字段包含内部英文枚举或字段名');
    if(/(?:立即|今天必须|必须).{0,12}(?:买入|卖出|加仓|减仓)|买入\s*\d+\s*股|减仓至\s*\d+(?:\.\d+)?%/.test(prose))errors.push('结论包含确定性交易命令或新仓位数值');
    if(!expected.programProvesFullPlanConditions&&hasAffirmativeFullConditionClaim(prose))errors.push('价格触发不能被表述为完整计划条件已满足');
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
  const validation=validateJudgment(top.currentState,{symbol:options.expectedSymbol,sourceDiscussionVersion:options.sourceDiscussionVersion,holdingShares:options.holdingShares,hasActivePlan:options.hasActivePlan,technicalDataStatus:options.technicalDataStatus,programProvesFullPlanConditions:options.programProvesFullPlanConditions,marketRiskAvailable:options.marketRiskAvailable===true});
  if(!validation.ok)return invalid('validation_error',StrictAiJson.contractMessage(validation.errors.join('；')),parsed.input);
  const anchorReadiness=options.prepared?assessTechnicalAnchorReadiness(options.prepared):null;
  if(anchorReadiness&&!anchorReadiness.ready)return {ok:true,previewReady:false,writes:0,code:anchorReadiness.code,reason:anchorReadiness.reason,message:anchorReadiness.message,input:parsed.input,currentState:validation.judgment};
  return {ok:true,previewReady:true,writes:0,code:'valid',message:'结论已通过严格校验，尚未写入。',input:parsed.input,currentState:validation.judgment};
}
  function findStock(state,symbol){const target=Workbench.canonical(symbol),stocks=array(state&&state.stocks),index=stocks.findIndex(stock=>Workbench.canonical(stock)===target);return {stocks,index,stock:index>=0?stocks[index]:null}}
  function buildCandidate(state,result,options={}){
    if(!result||!result.ok||!result.previewReady)throw new Error('必须先完成有效预览。');
    const prepared=options.prepared;
    if(!prepared||prepared.sourceDiscussionVersion!==result.currentState.sourceDiscussionVersion)throw new Error('讨论上下文缺失或已过期，请重新开始讨论。');
    const candidate=clone(state),found=findStock(candidate,result.currentState.symbol);
    if(!found.stock)throw new Error('找不到本次讨论对应的股票。');
    const rebuilt=Workbench.buildContext(found.stock,{state:candidate,allStocks:candidate.stocks,planReviewStore:candidate.planReviews,planReviewApi:options.planReviewApi,timeZone:options.timeZone,now:options.now});
    if(rebuilt.sourceDiscussionVersion!==prepared.sourceDiscussionVersion||rebuilt.protectedHash!==prepared.protectedHash)throw new Error('受保护的持仓、技术锚点、计划或长期逻辑已经变化，请重新开始讨论。');
  const confirmedAt=(()=>{const raw=options.now instanceof Date?options.now:new Date(options.now||Date.now());if(!Number.isFinite(raw.getTime()))throw new Error('确认时间无效。');return raw.toISOString()})();
    const confirmedDate=Workbench.localCalendarDate(confirmedAt,{timeZone:options.timeZone||'Asia/Shanghai'}),judgment=result.currentState,store=Workbench.normalizeStore(found.stock.discussionState);
    const anchorReadiness=assessTechnicalAnchorReadiness({technicalSnapshot:prepared&&prepared.technicalSnapshot,references:prepared&&prepared.references});
    if(!anchorReadiness.ready)throw Object.assign(new Error(anchorReadiness.message),{code:anchorReadiness.code,reason:anchorReadiness.reason});
    const next=Workbench.normalizeState({
      schemaVersion:judgment.userDecision?Workbench.STATE_SCHEMA_VERSION:Workbench.V2_STATE_SCHEMA_VERSION,
      stateId:`discussionstate_${Workbench.hash(`${judgment.symbol}|${judgment.sourceDiscussionVersion}|${confirmedAt}`)}`,
      symbol:judgment.symbol,sourceDiscussionVersion:judgment.sourceDiscussionVersion,...(judgment.userDecision?{userDecision:judgment.userDecision}:{}),actionAssessment:judgment.actionAssessment,attentionLevel:judgment.attentionLevel,trendAssessment:judgment.trendAssessment,structureAssessment:judgment.structureAssessment,stage:judgment.stage,focusPoints:judgment.focusPoints,summary:judgment.summary,keyChanges:judgment.keyChanges,risks:judgment.risks,watchPoints:judgment.watchPoints,planRelation:judgment.planRelation,confidence:judgment.confidence,
      technicalAsOf:prepared.technicalSnapshot.anchorBar.date,confirmedAt,confirmedDate,technicalSnapshot:prepared.technicalSnapshot,references:prepared.references
    });
    const validation=Workbench.validateState(next);if(!validation.ok)throw new Error(validation.errors.join('；'));
    if(store.current)store.history.push(store.current);
    store.current=validation.state;store.history=store.history.slice(-Workbench.HISTORY_LIMIT);
    const storeValidation=Workbench.validateStore(store);if(!storeValidation.ok)throw new Error(storeValidation.errors.join('；'));
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
  function renderPreview(result,program={}){
    if(!result||!result.ok)return `<div class="discussion-import-error">${escapeHtml(result&&result.message||'预览不可用')}</div>`;
    const item=result.currentState,decision=item.userDecision,technicalAsOf=text(program.technicalAsOf)||'待程序确认',confirmedDate=text(program.confirmedDate)||'保存时由程序生成',actionLabels={risk_control:'风险控制',reduce_review:'减仓复核',hold_watch:'持有观察',wait_confirmation:'等待确认',add_review:'加仓复核',entry_review:'建仓复核',no_action:'暂不操作'},priorityLabels={high:'高优先级',medium:'中优先级',low:'低优先级'},attentionLabels={normal:'普通观察',focused:'重点观察',window:'临近窗口'},trendLabels={uptrend:'上升',downtrend:'下降',sideways:'震荡',recovery:'修复',rebound:'反弹',unclear:'不明确'},typeLabels={top:'顶部结构',bottom:'底部结构',breakout:'突破结构',pullback:'回踩结构',recovery:'修复结构',consolidation:'整理结构',none:'暂无明确结构',unclear:'结构不明确'},statusLabels={forming:'形成中',confirmed:'已确认',valid:'仍有效',broken:'已破坏',unclear:'不明确'};
    const trends=[`整体：${trendLabels[item.trendAssessment.overall]}`,...item.trendAssessment.timeframes.map(row=>`${row.timeframe}：${trendLabels[row.status]}｜${row.explanation}`)],structures=item.structureAssessment.map(row=>`${row.timeframe}：${typeLabels[row.type]}${statusLabels[row.status]}｜${row.shortReason}`);
    if(!decision)return `<div class="discussion-import-preview"><div class="discussion-preview-anchor"><b>程序锚点</b><span>技术日 ${escapeHtml(technicalAsOf)}</span><span>确认日 ${escapeHtml(confirmedDate)}</span></div><div class="discussion-preview-decision"><b>历史格式结论</b><strong>操作倾向：${escapeHtml(actionLabels[item.actionAssessment.category])}</strong><p>${escapeHtml(item.actionAssessment.headline)}</p></div><dl><dt>趋势</dt><dd>${list(trends)}</dd><dt>结构</dt><dd>${list(structures)}</dd><dt>核心结论</dt><dd>${escapeHtml(item.summary)}</dd></dl></div>`;
    return `<div class="discussion-import-preview"><div class="discussion-preview-anchor"><b>程序锚点</b><span>技术日 ${escapeHtml(technicalAsOf)}</span><span>确认日 ${escapeHtml(confirmedDate)}</span></div><div class="discussion-preview-decision"><b>当前结论</b><strong>${escapeHtml(decision.headline)}</strong><p><b>仓位方向：</b>${escapeHtml(decision.positionDirection.summary)}</p><p><b>${decision.holding.status==='not_applicable'?'如果想建仓':'如果想加仓'}：</b>${escapeHtml(decision.addAssessment.summary)}</p><p><b>需要警惕：</b>${escapeHtml(decision.warning.summary)}</p></div><details><summary>判断依据</summary><dl><dt>操作复核</dt><dd>${escapeHtml(actionLabels[item.actionAssessment.category])} · ${escapeHtml(attentionLabels[item.attentionLevel])} · ${escapeHtml(priorityLabels[item.actionAssessment.priority])}</dd><dt>趋势</dt><dd>${list(trends)}</dd><dt>结构</dt><dd>${list(structures)}</dd><dt>当前重点</dt><dd>${list(item.focusPoints)}</dd><dt>与计划关系</dt><dd>${escapeHtml(item.planRelation.summary)}</dd><dt>核心结论</dt><dd>${escapeHtml(item.summary)}</dd><dt>置信度</dt><dd>${escapeHtml(item.confidence)}</dd></dl></details></div>`;
  }
  function list(items){return items.length?`<ul>${items.map(item=>`<li>${escapeHtml(item)}</li>`).join('')}</ul>`:'无'}
  function escapeHtml(value){return String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]))}

  return Object.freeze({RESULT_FIELDS,parse,validateJudgment,assessTechnicalAnchorReadiness:assessTechnicalAnchorReadiness,process,findStock,buildCandidate,commit,renderPreview,escapeHtml,clone});
});
