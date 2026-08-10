(function(){
  const STORAGE_KEY='v13_operation_entry_drafts_v1';
  const DRAFT_KIND='operation_entry';
  const obj=value=>value&&typeof value==='object'&&!Array.isArray(value)?value:{};
  const arr=value=>Array.isArray(value)?value:[];
  const symbol=value=>String(value||'').trim().toUpperCase();
  const text=value=>String(value===undefined||value===null?'':value).trim();
  const integer=value=>typeof value==='number'&&Number.isInteger(value)?value:null;
  const stableStringify=value=>Array.isArray(value)?'['+value.map(stableStringify).join(',')+']':(value&&typeof value==='object'?'{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+stableStringify(value[key])).join(',')+'}':JSON.stringify(value));
  const dateValid=value=>/^\d{4}-\d{2}-\d{2}$/.test(String(value||''))&&!isNaN(Date.parse(value+'T00:00:00'));
  function manager(){if(!window.StorageManager)throw new Error('StorageManager is unavailable.');return window.StorageManager}
  async function persist(key,value){
    const previous=saved(key),write=()=>manager().saveDraft(DRAFT_KIND,key,value);
    if(window.MultiTabProtection&&typeof window.MultiTabProtection.runProtectedDraftSave==='function')await window.MultiTabProtection.runProtectedDraftSave(DRAFT_KIND,key,previous,value,write);
    else await write();
    return value;
  }
  function canonicalPositionValue(value){if(value===null||value===undefined||value==='')return value;const number=Number(value);return Number.isFinite(number)?number:value}
  function positionPayload(stock){return {symbol:symbol(stock&& (stock.code||stock.symbol)),shares:canonicalPositionValue(stock&&stock.shares),avgCost:canonicalPositionValue(stock&&stock.avgCost),positionUpdatedAt:stock&& (stock.positionUpdatedAt||stock.updatedAt)||''}}
  async function snapshotHash(stock){const bytes=new TextEncoder().encode(stableStringify(positionPayload(stock))),hash=await crypto.subtle.digest('SHA-256',bytes);return Array.from(new Uint8Array(hash)).map(value=>value.toString(16).padStart(2,'0')).join('')}
  function context(reviewId,stock){const raw=window.AiDecisionReviewReader&&window.AiDecisionReviewReader.operationContextForReview?window.AiDecisionReviewReader.operationContextForReview(reviewId):null;return raw?{...raw,stock,source_type:'operation_request'}:null}
  function manualContext(stock){const code=symbol(stock&&(stock.code||stock.symbol));return {source_type:'manual_operation',stock,record:null,outcome:{},request:{request_id:null,source_decision_id:null,source_review_id:null,symbol:code,task_type:'manual_operation',operation_type:'record_operation_result'}}}
  function sourceType(ctx){return ctx&&ctx.source_type==='operation_request'?'operation_request':'manual_operation'}
  function contextKey(ctx){return sourceType(ctx)==='operation_request'?text(ctx&&ctx.request&&ctx.request.request_id):'manual_operation:'+symbol(ctx&&ctx.stock&&(ctx.stock.code||ctx.stock.symbol))}
  function eligible(ctx){
    const request=obj(ctx&&ctx.request),outcome=obj(ctx&&ctx.outcome),stock=ctx&&ctx.stock,record=ctx&&ctx.record;
    if(sourceType(ctx)==='manual_operation')return Boolean(stock&&symbol(stock.code||stock.symbol));
    return Boolean(stock&&record&&!record.resolved&&outcome.outcome_type==='operation_request'&&request.operation_type==='record_operation_result'&&request.request_id&&request.source_decision_id===outcome.decision_id&&symbol(request.symbol)===symbol(stock.code||stock.symbol));
  }
  function latestContext(stock){
    if(!window.AiDecisionReviewReader||typeof window.AiDecisionReviewReader.recordsForStock!=='function')return manualContext(stock);
    const rows=window.AiDecisionReviewReader.recordsForStock(stock).filter(record=>record.outcomeType==='operation_request');
    const record=rows.find(item=>item.isCurrent&&!item.resolved)||rows.find(item=>!item.resolved)||rows[0];
    const linked=record?context(record.reviewId,stock):null;
    return eligible(linked)?linked:manualContext(stock);
  }
  function saved(key){return manager().getDraft(DRAFT_KIND,key)}
  function defaultDraft(ctx){
    const now=new Date().toISOString(),stock=ctx.stock,linked=sourceType(ctx)==='operation_request';
    return {draft_id:uuid(),source_type:sourceType(ctx),source_request_id:linked?ctx.request.request_id:null,source_decision_id:linked?ctx.outcome.decision_id:null,source_review_id:linked?ctx.record.reviewId:null,symbol:ctx.request.symbol,previous_shares:stock.shares,new_shares:stock.shares,previous_avg_cost:stock.avgCost,new_avg_cost:stock.avgCost,operation_date:now.slice(0,10),note:'',draft_status:'draft',created_at:now,updated_at:now};
  }
  function normalizeCost(value){if(value===null||value===undefined||value==='')return value;const number=Number(value);return Number.isFinite(number)?number:value}
  function validate(draft,ctx,today){
    const d=obj(draft),stock=ctx&&ctx.stock||{},request=obj(ctx&&ctx.request),outcome=obj(ctx&&ctx.outcome),errors=[],warnings=[];
    ['draft_id','source_type','source_request_id','source_decision_id','source_review_id','symbol','previous_shares','new_shares','previous_avg_cost','new_avg_cost','operation_date','note','draft_status','created_at','updated_at'].forEach(key=>{if(!(key in d))errors.push('缺少字段：'+key)});
    if(d.draft_status!=='draft')errors.push('草案状态必须为 draft');
    if(d.source_type!==sourceType(ctx))errors.push('来源模式与当前录入上下文不一致');
    if(sourceType(ctx)==='operation_request'){
      if(d.source_request_id!==request.request_id)errors.push('来源请求与当前操作请求不一致');
      if(d.source_decision_id!==outcome.decision_id)errors.push('来源决策与当前决策不一致');
      if(d.source_review_id!==(ctx&&ctx.record&&ctx.record.reviewId))errors.push('来源复核任务不一致');
    }else if(d.source_request_id!==null||d.source_decision_id!==null||d.source_review_id!==null)errors.push('用户主动录入不得关联 AI 来源任务');
    if(symbol(d.symbol)!==symbol(request.symbol)||symbol(d.symbol)!==symbol(stock.code||stock.symbol))errors.push('标的代码不一致');
    if(!Number.isInteger(d.previous_shares)||d.previous_shares<0)errors.push('原持仓数量必须是非负整数');
    if(!Number.isInteger(d.new_shares)||d.new_shares<0)errors.push('最新持仓数量必须是非负整数');
    if(d.previous_shares!==stock.shares)errors.push('原持仓数量与当前正式数据不一致');
    if(!valueEqual(d.previous_avg_cost,stock.avgCost))errors.push('原券商成本与当前正式数据不一致');
    let normalizedCost=normalizeCost(d.new_avg_cost);
    if(Number.isInteger(d.new_shares)&&d.new_shares>0&&(!(Number(normalizedCost)>0)||!Number.isFinite(Number(normalizedCost))))errors.push('持仓大于0时，最新券商成本必须为正数');
    if(d.new_shares===0&&!zeroCostAllowed(stock.avgCost,normalizedCost))errors.push('清仓后的成本必须遵循当前正式数据的零仓位口径');
    if(!dateValid(d.operation_date))errors.push('操作日期格式无效');
    else if(d.operation_date>(today||new Date().toISOString().slice(0,10)))errors.push('操作日期不得晚于今天');
    if(Number.isInteger(d.new_shares)&&Number.isInteger(d.previous_shares)){
      const sameShares=d.new_shares===d.previous_shares,sameCost=valueEqual(normalizedCost,d.previous_avg_cost);
      if(sameShares&&sameCost)warnings.push('持仓数量和券商成本均未变化');
      if(!sameShares&&sameCost)warnings.push('持仓数量已变化，但券商成本未变化，请核对券商数据');
      if(sameShares&&!sameCost)warnings.push('持仓数量未变化，但券商成本发生变化，需要再次确认');
    }
    return {schema_valid:errors.filter(item=>item.indexOf('缺少字段')===0).length===0,business_valid:errors.length===0,warnings,errors,normalized_new_avg_cost:normalizedCost,position_change:positionChange(d.previous_shares,d.new_shares)};
  }
  async function saveDraft(ctx,draft,validation,snapshot){
    const now=new Date().toISOString(),key=contextKey(ctx),value={draft:{...draft,new_avg_cost:validation.normalized_new_avg_cost,updated_at:now},validation,current_position_snapshot_hash:snapshot,status:validation.business_valid?'pending_confirmation':'draft',saved_at:now};
    return persist(key,value);
  }
  async function markApplicationRequest(requestId,application){const item=saved(requestId)||{},value={...item,status:'application_request_generated',application_request:application,application_request_generated_at:new Date().toISOString()};return persist(requestId,value)}
  async function abandon(requestId){
    const previous=saved(requestId),write=()=>manager().deleteDraft(DRAFT_KIND,requestId);
    if(window.MultiTabProtection&&typeof window.MultiTabProtection.runProtectedDraftSave==='function')await window.MultiTabProtection.runProtectedDraftSave(DRAFT_KIND,requestId,previous,null,write);
    else await write();
  }
  async function createApplicationRequest(ctx,savedItem){
    if(!eligible(ctx))throw new Error('当前标的无法录入操作结果。');
    if(!savedItem||savedItem.status!=='pending_confirmation')throw new Error('录入草案尚未通过校验。');
    const currentHash=await snapshotHash(ctx.stock);
    if(currentHash!==savedItem.current_position_snapshot_hash)throw new Error('当前持仓已变化，请重新录入操作结果。');
    const validation=validate(savedItem.draft,ctx);
    if(!validation.business_valid)throw new Error(validation.errors.join('；'));
    const now=new Date().toISOString(),draft=savedItem.draft;
    return {application_id:uuid(),draft_id:draft.draft_id,source_type:draft.source_type,source_request_id:draft.source_request_id,source_decision_id:draft.source_decision_id,source_review_id:draft.source_review_id,symbol:draft.symbol,task_type:sourceType(ctx)==='operation_request'?ctx.record.taskType:'manual_operation',current_position_snapshot_hash:currentHash,previous_shares:draft.previous_shares,new_shares:draft.new_shares,previous_avg_cost:draft.previous_avg_cost,new_avg_cost:validation.normalized_new_avg_cost,operation_date:draft.operation_date,note:draft.note,user_confirmed_at:now,status:'confirmed_pending_application',created_at:now,schema_version:'1.0'};
  }
  function clone(value){return typeof structuredClone==='function'?structuredClone(value):JSON.parse(JSON.stringify(value))}
  function restore(target,snapshot){Object.keys(target).forEach(key=>delete target[key]);Object.assign(target,clone(snapshot))}
  function stateStock(appState,ctx){
    const stocks=arr(appState&&appState.stocks),id=text(ctx&&ctx.stock&&ctx.stock.id),code=symbol(ctx&&ctx.stock&&(ctx.stock.code||ctx.stock.symbol));
    const matches=stocks.filter(stock=>(id&&text(stock&&stock.id)===id)||symbol(stock&&(stock.code||stock.symbol))===code);
    const unique=matches.filter((stock,index)=>matches.indexOf(stock)===index);
    if(unique.length!==1)throw new Error('标的数据异常，无法安全更新正式持仓。');
    return unique[0];
  }
  function directApplyAudit(application,appliedAt){
    return {audit_id:'operation_direct_'+application.application_id,application_id:application.application_id,draft_id:application.draft_id,source_type:application.source_type,source_request_id:application.source_request_id,source_decision_id:application.source_decision_id,source_review_id:application.source_review_id,symbol:application.symbol,result:'applied',status:'applied',previous_shares:application.previous_shares,new_shares:application.new_shares,previous_avg_cost:application.previous_avg_cost,new_avg_cost:application.new_avg_cost,operation_date:application.operation_date,note:application.note,record_source:'manual_operation_entry',createdAt:application.created_at,updatedAt:appliedAt,created_at:application.created_at,updated_at:appliedAt,applied_at:appliedAt};
  }
  async function applyDirectResult(appState,ctx,savedItem,persistState,appliedAt){
    if(!appState||typeof appState!=='object'||Array.isArray(appState))throw new Error('正式数据状态无效。');
    if(typeof persistState!=='function')throw new Error('正式保存接口不可用。');
    const before=clone(appState),application=await createApplicationRequest(ctx,savedItem),target=stateStock(appState,ctx);
    if(target.shares!==application.previous_shares||!valueEqual(target.avgCost,application.previous_avg_cost))throw new Error('当前持仓已变化，请重新加载最新数据后再试。');
    const timestamp=appliedAt||new Date().toISOString(),audit=directApplyAudit(application,timestamp);
    target.shares=application.new_shares;
    target.avgCost=application.new_avg_cost;
    target.updatedAt=timestamp;
    appState.operationApplicationAudits=arr(appState.operationApplicationAudits).filter(item=>item&&item.application_id!==application.application_id).concat([audit]);
    try{await persistState(appState)}catch(error){restore(appState,before);throw error}
    return {application,audit};
  }
  function appliedStatus(ctx,appState){
    const audit=obj(ctx&&ctx.record&&ctx.record.raw&&ctx.record.raw.operationApplicationAudit);
    if(audit.result==='applied')return {source:'audit',...audit};
    const localAudits=arr(appState&&appState.operationApplicationAudits).filter(item=>item&&item.result==='applied'&&symbol(item.symbol)===symbol(ctx&&ctx.stock&&(ctx.stock.code||ctx.stock.symbol))).sort((left,right)=>text(right.applied_at||right.updated_at).localeCompare(text(left.applied_at||left.updated_at)));
    if(localAudits.length)return {source:'state',...localAudits[0]};
    const rows=arr(window.OPERATION_APPLICATION_STATUS&&window.OPERATION_APPLICATION_STATUS.applications),bridge=rows.find(item=>symbol(item&&item.symbol)===symbol(ctx&&ctx.stock&&(ctx.stock.code||ctx.stock.symbol))&&item.status==='applied');
    if(bridge)return {source:'bridge',...bridge};
    const local=saved(contextKey(ctx));
    return local&&local.status==='application_request_generated'?{source:'local',status:'application_request_generated',application_id:local.application_request&&local.application_request.application_id}:null;
  }
  function positionChange(previous,current){if(!Number.isInteger(previous)||!Number.isInteger(current))return 'unknown';if(previous===current)return 'unchanged';if(current===0)return 'cleared';return current>previous?'increased':'decreased'}
  function valueEqual(left,right){const ln=left===''||left===null||left===undefined?null:Number(left),rn=right===''||right===null||right===undefined?null:Number(right);return Number.isFinite(ln)&&Number.isFinite(rn)?ln===rn:left===right}
  function zeroCostAllowed(formal,value){if(typeof formal==='string')return value===''||value===null||Number(value)===0;if(formal===null)return value===null||value===''||Number(value)===0;return value===''||value===null||Number(value)===0}
  function uuid(){if(crypto.randomUUID)return crypto.randomUUID();const values=new Uint8Array(16);crypto.getRandomValues(values);values[6]=(values[6]&15)|64;values[8]=(values[8]&63)|128;const hex=Array.from(values).map(v=>v.toString(16).padStart(2,'0')).join('');return hex.slice(0,8)+'-'+hex.slice(8,12)+'-'+hex.slice(12,16)+'-'+hex.slice(16,20)+'-'+hex.slice(20)}
  window.OperationEntry={context,manualContext,latestContext,eligible,contextKey,defaultDraft,validate,saveDraft,saved,abandon,snapshotHash,createApplicationRequest,markApplicationRequest,applyDirectResult,directApplyAudit,appliedStatus,positionPayload,positionChange,storageKey:STORAGE_KEY,draftKind:DRAFT_KIND};
})();
