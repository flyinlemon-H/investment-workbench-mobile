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
  const RESULT_FIELDS=Object.freeze(['symbol','sourceDiscussionVersion','stage','summary','keyChanges','risks','watchPoints','planRelation','confidence']);
  const object=value=>value&&typeof value==='object'&&!Array.isArray(value)?value:{};
  const array=value=>Array.isArray(value)?value:[];
  const text=value=>String(value??'').trim();
  const clone=value=>JSON.parse(JSON.stringify(value));
  function invalid(code,message,input=null){return {ok:false,previewReady:false,writes:0,code,message,input,currentState:null}}
  function parse(raw){
    const result=StrictAiJson.parseStrictAiJson(raw);
    return result.ok?result:{ok:false,error:result.userMessage,input:result.input,reason:result.reason};
  }
  function validateJudgment(value,expected={}){
    const source=object(value),errors=[],keys=Object.keys(source),extra=keys.filter(key=>!RESULT_FIELDS.includes(key)),missing=RESULT_FIELDS.filter(key=>!Object.prototype.hasOwnProperty.call(source,key));
    if(extra.length)errors.push(`currentState contains unknown fields: ${extra.join(', ')}`);
    if(missing.length)errors.push(`currentState missing fields: ${missing.join(', ')}`);
    const symbol=Workbench.canonical(source.symbol),sourceDiscussionVersion=text(source.sourceDiscussionVersion),stage=text(source.stage),summary=text(source.summary),planRelation=text(source.planRelation),confidence=text(source.confidence);
    if(!symbol||symbol!==Workbench.canonical(expected.symbol))errors.push('symbol 与本次讨论不一致');
    if(!sourceDiscussionVersion||sourceDiscussionVersion!==text(expected.sourceDiscussionVersion))errors.push('sourceDiscussionVersion 已过期或不一致');
    if(!stage||stage.length>40||/[\r\n]/.test(stage))errors.push('stage 必须是不超过40字的单行文字');
    if(!summary||summary.length>800)errors.push('summary 必须为1至800字');
    if(planRelation.length>500)errors.push('planRelation 不得超过500字');
    for(const key of ['keyChanges','risks','watchPoints']){
      if(!Array.isArray(source[key]))errors.push(`${key} 必须是字符串数组`);
      else if(source[key].length>12||source[key].some(item=>typeof item!=='string'||!item.trim()||item.trim().length>240))errors.push(`${key} 最多12项且每项为1至240字`);
    }
    if(!Workbench.CONFIDENCE_LEVELS.includes(confidence))errors.push('confidence 只能为 high、medium、low');
    return {ok:errors.length===0,errors,judgment:{symbol,sourceDiscussionVersion,stage,summary,keyChanges:array(source.keyChanges).map(text),risks:array(source.risks).map(text),watchPoints:array(source.watchPoints).map(text),planRelation,confidence}};
  }
  function process(raw,options={}){
    const parsed=parse(raw);if(!parsed.ok)return invalid('parse_error',parsed.error);
    const top=object(parsed.value),topKeys=Object.keys(top);
    if(topKeys.length!==1||topKeys[0]!=='currentState')return invalid('schema_error',StrictAiJson.contractMessage('顶层只能包含 currentState。'),parsed.input);
    const validation=validateJudgment(top.currentState,{symbol:options.expectedSymbol,sourceDiscussionVersion:options.sourceDiscussionVersion});
    if(!validation.ok)return invalid('validation_error',StrictAiJson.contractMessage(validation.errors.join('；')),parsed.input);
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
    const next=Workbench.normalizeState({
      schemaVersion:Workbench.STATE_SCHEMA_VERSION,
      stateId:`discussionstate_${Workbench.hash(`${judgment.symbol}|${judgment.sourceDiscussionVersion}|${confirmedAt}`)}`,
      symbol:judgment.symbol,sourceDiscussionVersion:judgment.sourceDiscussionVersion,stage:judgment.stage,summary:judgment.summary,keyChanges:judgment.keyChanges,risks:judgment.risks,watchPoints:judgment.watchPoints,planRelation:judgment.planRelation,confidence:judgment.confidence,
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
      if(saved===false||(saved&&saved.ok===false))throw new Error('critical save failed');
      if(typeof deps.adoptCandidate==='function')deps.adoptCandidate(next);
      if(typeof deps.render==='function')deps.render();
      return {status:'completed',writes:1,state:next,currentState:built.currentState};
    }catch(error){if(typeof deps.rollback==='function')deps.rollback(state);return {status:'failed',writes:1,error}}
  }
  function renderPreview(result,program={}){
    if(!result||!result.ok)return `<div class="discussion-import-error">${escapeHtml(result&&result.message||'预览不可用')}</div>`;
    const item=result.currentState,technicalAsOf=text(program.technicalAsOf)||'待程序确认',confirmedDate=text(program.confirmedDate)||'保存时由程序生成';
    return `<div class="discussion-import-preview"><div class="discussion-preview-anchor"><b>程序锚点</b><span>技术日 ${escapeHtml(technicalAsOf)}</span><span>确认日 ${escapeHtml(confirmedDate)}</span></div><h4>${escapeHtml(item.stage)}</h4><p>${escapeHtml(item.summary)}</p><dl><dt>关键变化</dt><dd>${list(item.keyChanges)}</dd><dt>风险</dt><dd>${list(item.risks)}</dd><dt>观察点</dt><dd>${list(item.watchPoints)}</dd><dt>与计划关系</dt><dd>${escapeHtml(item.planRelation||'未说明')}</dd><dt>置信度</dt><dd>${escapeHtml(item.confidence)}</dd></dl></div>`;
  }
  function list(items){return items.length?`<ul>${items.map(item=>`<li>${escapeHtml(item)}</li>`).join('')}</ul>`:'无'}
  function escapeHtml(value){return String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]))}

  return Object.freeze({RESULT_FIELDS,parse,validateJudgment,process,findStock,buildCandidate,commit,renderPreview,escapeHtml,clone});
});
