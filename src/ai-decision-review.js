(function(){
  const BRIDGE_URL='data/ai_decision_review_data.js';

  function arr(value){
    return Array.isArray(value)?value:[];
  }

  function obj(value){
    return value&&typeof value==='object'&&!Array.isArray(value)?value:{};
  }

  function text(value,fallback){
    const s=String(value===undefined||value===null?'':value).trim();
    return s||fallback||'';
  }

  function concatRecords(...sources){
    return sources.reduce((output,source)=>output.concat(arr(source)),[]);
  }

  function sourceData(){
    const bridged=obj(window.AI_DECISION_REVIEW_DATA);
    const appState=typeof state==='object'&&state?state:{};
    const nested=obj(appState.aiDecisionReview);
    return {
      aiDrafts:concatRecords(bridged.aiDrafts,appState.aiDrafts,nested.aiDrafts),
      reviewTasks:concatRecords(bridged.reviewTasks,appState.reviewTasks,nested.reviewTasks),
      decisionOutcomes:concatRecords(bridged.decisionOutcomes,appState.decisionOutcomes,nested.decisionOutcomes),
      discussionRecords:concatRecords(bridged.discussionRecords,appState.discussionRecords,nested.discussionRecords),
      planUpdateRequests:concatRecords(bridged.planUpdateRequests,appState.planUpdateRequests,nested.planUpdateRequests),
      operationRequests:concatRecords(bridged.operationRequests,appState.operationRequests,nested.operationRequests),
      operationApplicationAudits:concatRecords(bridged.operationApplicationAudits,appState.operationApplicationAudits,nested.operationApplicationAudits),
      taskResolutions:concatRecords(bridged.taskResolutions,appState.taskResolutions,nested.taskResolutions),
      taskProjections:concatRecords(bridged.taskProjections,appState.taskProjections,nested.taskProjections),
      homeTaskProjections:arr(bridged.homeTaskProjections),
      historyProjections:arr(bridged.historyProjections),
      systemIssues:arr(bridged.systemIssues)
    };
  }

  function resultOf(draft,task){
    const d=obj(draft);
    const payload=obj(task&&task.payload);
    return obj(d.result&&Object.keys(obj(d.result)).length?d.result:(d.draft&&Object.keys(obj(d.draft)).length?d.draft:(payload.result||{})));
  }

  function dateValue(record){
    return text(record&&(
      record.created_at||
      record.createdAt||
      record.generated_at||
      record.generatedAt||
      record.resolved_at||
      record.updated_at||
      record.updatedAt
    ),'');
  }

  function stockKey(value){
    return text(value,'').toUpperCase();
  }

  function matchesStock(stock,symbol){
    const key=stockKey(symbol);
    if(!key)return false;
    return [stock&&stock.code,stock&&stock.symbol,stock&&stock.id,stock&&stock.name]
      .map(stockKey)
      .some(v=>v&&v===key);
  }

  function outcomeMessage(type){
    return {
      no_change:'当前策略无需调整',
      plan_update:'需要更新计划',
      operation_request:'进入操作流程'
    }[text(type,'')]||'等待讨论确认';
  }

  function taskTypeLabel(type){
    return {
      long_term_logic_review:'长期逻辑复核'
    }[text(type,'')]||text(type,'AI复核');
  }

  function businessStatusLabel(status){
    return {
      valid:'长期逻辑有效',
      weakened:'长期逻辑转弱',
      invalid:'长期逻辑失效',
      insufficient_information:'信息不足',
      needs_review:'需要复核'
    }[text(status,'')]||text(status,'未形成业务状态');
  }

  function reviewStatusLabel(status){
    return {
      pending:'待复核',
      pending_review:'待复核',
      reviewing:'复核中',
      approved:'已批准',
      rejected:'已拒绝',
      deferred:'已暂缓'
    }[text(status,'')]||text(status,'待复核');
  }

  function normalizeRecordFromDraft(draft,tasksByDraft,outcomesByReview){
    const d=obj(draft);
    const modernDraftId=text(d.draft_id||d.id,'');
    const providerRequestId=text(d.request_id||d.requestId,'');
    const draftId=modernDraftId||providerRequestId;
    const task=obj(tasksByDraft[modernDraftId]||tasksByDraft[draftId]);
    const reviewId=text(task.review_id||d.source_review_id,'');
    const outcome=obj(outcomesByReview[reviewId]);
    const result=resultOf(d,task);
    const outcomeType=text(outcome.outcome_type,'');
    return {
      source:'ai_draft',
      draftId,
      reviewId,
      providerRequestId,
      legacy:!modernDraftId,
      symbol:text(d.symbol||result.symbol||task.symbol,''),
      taskType:text(d.task_type||d.taskName||task.task_type,''),
      taskTypeLabel:taskTypeLabel(d.task_type||d.taskName||task.task_type),
      aiConclusion:text(result.summary||d.summary||task.summary,'暂无 AI 结论'),
      businessStatus:text(result.logic_status||d.logic_status,''),
      businessStatusLabel:businessStatusLabel(result.logic_status||d.logic_status),
      reviewStatus:text(task.status||d.review_status||'pending','pending'),
      reviewStatusLabel:reviewStatusLabel(task.status||d.review_status||'pending'),
      outcomeType,
      outcomeLabel:outcomeMessage(outcomeType),
      outcomeConclusion:text(outcome.conclusion,''),
      provider:text(d.provider,''),
      model:text(d.model,''),
      createdAt:dateValue(task)||dateValue(d)||dateValue(outcome),
      result,
      raw:{draft:d,reviewTask:task,decisionOutcome:outcome}
    };
  }

  function normalizeRecordFromTask(task,outcomesByReview){
    const t=obj(task);
    const reviewId=text(t.review_id,'');
    const outcome=obj(outcomesByReview[reviewId]);
    const result=resultOf({},t);
    const outcomeType=text(outcome.outcome_type,'');
    return {
      source:'review_task',
      draftId:text(t.source_input_id,''),
      reviewId,
      providerRequestId:text(t.request_id||t.requestId||obj(t.payload).request_id||obj(t.payload).requestId,''),
      legacy:false,
      symbol:text(t.symbol||result.symbol,''),
      taskType:text(t.task_type,''),
      taskTypeLabel:taskTypeLabel(t.task_type),
      aiConclusion:text(result.summary||t.summary,'暂无 AI 结论'),
      businessStatus:text(result.logic_status,''),
      businessStatusLabel:businessStatusLabel(result.logic_status),
      reviewStatus:text(t.status,'pending'),
      reviewStatusLabel:reviewStatusLabel(t.status),
      outcomeType,
      outcomeLabel:outcomeMessage(outcomeType),
      outcomeConclusion:text(outcome.conclusion,''),
      provider:'',
      model:'',
      createdAt:dateValue(t)||dateValue(outcome),
      result,
      raw:{draft:{},reviewTask:t,decisionOutcome:outcome}
    };
  }

  function normalizeRecordFromResolution(resolution){
    const r=obj(resolution);
    const reviewId=text(r.source_review_id||r.review_id,'');
    const draftId=text(r.source_draft_id||r.draft_id,'');
    const resolutionId=text(r.resolution_id||r.id,'');
    const taskType=text(r.task_type||r.taskType,'');
    const businessStatus=text(r.business_status||r.logic_status,'');
    return {
      source:'task_resolution',
      draftId,
      reviewId,
      resolutionId,
      providerRequestId:'',
      legacy:false,
      symbol:text(r.symbol,''),
      taskType,
      taskTypeLabel:taskTypeLabel(taskType),
      aiConclusion:text(r.summary,'暂无 AI 结论'),
      businessStatus,
      businessStatusLabel:businessStatusLabel(businessStatus),
      reviewStatus:'approved',
      reviewStatusLabel:reviewStatusLabel('approved'),
      outcomeType:'',
      outcomeLabel:outcomeMessage(''),
      outcomeConclusion:'',
      provider:'',
      model:'',
      createdAt:dateValue(r),
      result:{},
      resolved:true,
      resolutionType:text(r.resolution_type||r.resolutionType,''),
      resolvedAt:text(r.resolved_at||r.resolvedAt,''),
      raw:{draft:{},reviewTask:{},decisionOutcome:{},taskResolution:r}
    };
  }

  function attachDiscussion(record,discussionsByReview){
    const discussion=obj(discussionsByReview[record.reviewId]);
    record.discussionId=text(discussion.discussion_id,'');
    record.discussionPrompt=text(discussion.prompt,'');
    record.raw.discussionRecord=discussion;
    return record;
  }

  function isAiDecisionRecord(record){
    const raw=obj(record&&record.raw);
    const reviewTask=obj(raw.reviewTask);
    const payload=obj(reviewTask.payload);
    const taskType=text(record&&record.taskType,'');
    const draftId=text(record&&record.draftId,'');
    return record&&record.source==='ai_draft'
      || taskType==='long_term_logic_review'
      || draftId.indexOf('draft_')===0
      || Boolean(payload.draft_id);
  }

  function isHistoryRecordValid(record){
    if(!record||!record.symbol||!record.taskType||!(record.draftId||record.reviewId||record.resolutionId))return false;
    const raw=obj(record.raw);
    const draft=obj(raw.draft);
    const task=obj(raw.reviewTask);
    const payload=obj(task.payload);
    const validationStatus=text(draft.validation_status||draft.validationStatus||payload.validation_status,'').toLowerCase();
    if(validationStatus&&validationStatus!=='passed')return false;
    const validation=obj(draft.validation);
    if(validation.schemaValid===false||validation.businessValid===false)return false;
    return true;
  }

  function canonicalEntityKey(record){
    const r=obj(record);
    const reviewId=text(r.reviewId,'');
    if(reviewId)return 'review|'+reviewId;
    const raw=obj(r.raw);
    const draft=obj(raw.draft);
    const resolution=obj(raw.taskResolution);
    const modernDraftId=text(draft.draft_id||draft.id,'');
    if(modernDraftId)return 'draft|'+modernDraftId;
    const resolutionReviewId=text(resolution.source_review_id||resolution.review_id,'');
    if(resolutionReviewId)return 'review|'+resolutionReviewId;
    const resolutionDraftId=text(resolution.source_draft_id||resolution.draft_id,'');
    if(resolutionDraftId)return 'draft|'+resolutionDraftId;
    const resolutionId=text(r.resolutionId||resolution.resolution_id||resolution.id,'');
    if(resolutionId)return 'resolution|'+resolutionId;
    const providerRequestId=text(r.providerRequestId||draft.request_id||draft.requestId,'');
    const rawTimestamp=text(r.createdAt||dateValue(draft),'');
    const parsedTimestamp=Date.parse(rawTimestamp);
    const canonicalTimestamp=Number.isFinite(parsedTimestamp)?new Date(parsedTimestamp).toISOString():rawTimestamp;
    const legacyParts=[
      stockKey(r.symbol),
      text(r.taskType,''),
      canonicalTimestamp,
      text(r.businessStatus,''),
      providerRequestId
    ];
    if(!legacyParts[0]||!legacyParts[1]||!legacyParts[2])return '';
    return 'legacy|'+legacyParts.map(part=>encodeURIComponent(part)).join('|');
  }

  function deduplicateNormalizedRecords(records){
    const seen=new Set();
    return records.filter(record=>{
      const key=text(record&&record.canonicalEntityKey,'')||canonicalEntityKey(record);
      record.canonicalEntityKey=key;
      if(!key||seen.has(key))return false;
      seen.add(key);
      return true;
    });
  }

  function stableRecordId(record){
    return text(record&&record.canonicalEntityKey,'')||canonicalEntityKey(record);
  }

  function compareRecordsNewestFirst(left,right){
    const leftText=text(left&&left.createdAt,'');
    const rightText=text(right&&right.createdAt,'');
    const leftTime=Date.parse(leftText);
    const rightTime=Date.parse(rightText);
    if(Number.isFinite(leftTime)&&Number.isFinite(rightTime)&&leftTime!==rightTime)return rightTime-leftTime;
    if(Number.isFinite(leftTime)!==Number.isFinite(rightTime))return Number.isFinite(rightTime)?1:-1;
    if(leftText!==rightText)return rightText.localeCompare(leftText);
    return stableRecordId(right).localeCompare(stableRecordId(left));
  }

  function refreshBridge(){
    return new Promise(resolve=>{
      const doc=typeof document==='object'&&document?document:null;
      const parent=doc&&(doc.head||doc.documentElement);
      if(!doc||!parent||typeof doc.createElement!=='function'||typeof parent.appendChild!=='function'){
        resolve(false);
        return;
      }
      const script=doc.createElement('script');
      script.src=BRIDGE_URL+'?refresh='+Date.now().toString(36);
      script.async=true;
      script.setAttribute('data-ai-decision-bridge-refresh','true');
      const finish=result=>{
        if(typeof script.remove==='function')script.remove();
        resolve(result);
      };
      script.onload=()=>finish(true);
      script.onerror=()=>finish(false);
      parent.appendChild(script);
    });
  }

  function records(){
    const data=sourceData();
    const tasksByDraft={};
    const outcomesByReview={};
    const discussionsByReview={};
    const planRequestsByDecision={};
    const operationRequestsByDecision={};
    const operationAuditsByDecision={};
    const projectionsByReview={};
    const resolutionsByReview={};
    const resolutionsByDraft={};
    data.taskProjections.forEach(projection=>{
      const p=obj(projection);
      const reviewId=text(p.reviewId||p.source_review_id,'');
      if(reviewId&&!projectionsByReview[reviewId])projectionsByReview[reviewId]=p;
    });
    data.reviewTasks.forEach(task=>{
      const t=obj(task);
      const sourceId=text(t.source_input_id,'');
      if(sourceId&&!tasksByDraft[sourceId])tasksByDraft[sourceId]=t;
    });
    data.decisionOutcomes.forEach(outcome=>{
      const o=obj(outcome);
      const reviewId=text(o.source_review_id,'');
      if(reviewId&&!outcomesByReview[reviewId])outcomesByReview[reviewId]=o;
    });
    data.discussionRecords.forEach(discussion=>{
      const d=obj(discussion);
      const reviewId=text(d.source_review_id,'');
      if(reviewId&&!discussionsByReview[reviewId])discussionsByReview[reviewId]=d;
    });
    data.planUpdateRequests.forEach(request=>{
      const r=obj(request);
      const decisionId=text(r.source_decision_id,'');
      if(decisionId&&!planRequestsByDecision[decisionId])planRequestsByDecision[decisionId]=r;
    });
    data.operationRequests.forEach(request=>{
      const r=obj(request);
      const decisionId=text(r.source_decision_id,'');
      if(decisionId&&!operationRequestsByDecision[decisionId])operationRequestsByDecision[decisionId]=r;
    });
    data.operationApplicationAudits.forEach(audit=>{
      const a=obj(audit);
      const decisionId=text(a.source_decision_id,'');
      if(decisionId&&!operationAuditsByDecision[decisionId])operationAuditsByDecision[decisionId]=a;
    });
    data.taskResolutions.forEach(resolution=>{
      const r=obj(resolution);
      const reviewId=text(r.source_review_id||r.review_id,'');
      const draftId=text(r.source_draft_id||r.draft_id,'');
      if(reviewId&&!resolutionsByReview[reviewId])resolutionsByReview[reviewId]=r;
      if(draftId&&!resolutionsByDraft[draftId])resolutionsByDraft[draftId]=r;
    });
    const output=data.aiDrafts.map(draft=>{
      const rec=normalizeRecordFromDraft(draft,tasksByDraft,outcomesByReview);
      const decisionId=rec.raw.decisionOutcome&&rec.raw.decisionOutcome.decision_id;
      rec.raw.planUpdateRequest=obj(planRequestsByDecision[decisionId]);
      rec.raw.operationRequest=obj(operationRequestsByDecision[decisionId]);
      rec.raw.operationApplicationAudit=obj(operationAuditsByDecision[decisionId]);
      return attachDiscussion(rec,discussionsByReview);
    });
    data.reviewTasks.forEach(task=>{
      const rec=normalizeRecordFromTask(task,outcomesByReview);
      const decisionId=rec.raw.decisionOutcome&&rec.raw.decisionOutcome.decision_id;
      rec.raw.planUpdateRequest=obj(planRequestsByDecision[decisionId]);
      rec.raw.operationRequest=obj(operationRequestsByDecision[decisionId]);
      rec.raw.operationApplicationAudit=obj(operationAuditsByDecision[decisionId]);
      output.push(attachDiscussion(rec,discussionsByReview));
    });
    data.taskResolutions.forEach(resolution=>{
      output.push(attachDiscussion(normalizeRecordFromResolution(resolution),discussionsByReview));
    });
    output.forEach(record=>{
      const projection=obj(projectionsByReview[record.reviewId]);
      const resolution=obj(resolutionsByReview[record.reviewId]||resolutionsByDraft[record.draftId]||record.raw.taskResolution);
      record.actionable=projection.actionable===true;
      record.resolved=projection.resolved===true||record.resolved===true||Boolean(resolution.resolution_id||resolution.id);
      record.resolutionType=text(projection.resolutionType||record.resolutionType||resolution.resolution_type||resolution.resolutionType,'');
      record.resolutionId=text(projection.resolutionId||record.resolutionId||resolution.resolution_id||resolution.id,'');
      record.resolvedAt=text(projection.resolvedAt||record.resolvedAt||resolution.resolved_at||resolution.resolvedAt,'');
      record.isCurrent=projection.isCurrent===true;
      record.priority=text(projection.priority,'normal');
      record.userSummary=text(projection.userSummary,record.aiConclusion);
      record.lastReviewedAt=text(projection.lastReviewedAt,record.createdAt);
      record.nextReviewDue=text(projection.nextReviewDue,'');
      record.reviewDueStatus=text(projection.reviewDueStatus,'unknown');
      record.reviewIntervalDays=projection.reviewIntervalDays===null?null:Number(projection.reviewIntervalDays||0)||null;
      record.sourceApplicationId=text(projection.sourceApplicationId,'');
      record.applicationAppliedAt=text(projection.applicationAppliedAt,'');
      record.archivedPlanCount=Number(projection.archivedPlanCount||0);
      record.createdPlanCount=Number(projection.createdPlanCount||0);
      record.applicationAuditId=text(projection.applicationAuditId,'');
      record.operationDate=text(projection.operationDate,'');
      record.previousShares=projection.previousShares;
      record.newShares=projection.newShares;
      record.previousAvgCost=projection.previousAvgCost;
      record.newAvgCost=projection.newAvgCost;
      record.operationAuditId=text(projection.operationAuditId,'');
      record.raw.taskProjection=projection;
      record.raw.taskResolution=resolution;
    });
    return deduplicateNormalizedRecords(output
      .map(record=>{
        record.canonicalEntityKey=canonicalEntityKey(record);
        return record;
      })
      .filter(record=>record.symbol||record.reviewId||record.draftId)
      .filter(isAiDecisionRecord)
      .filter(isHistoryRecordValid))
      .sort(compareRecordsNewestFirst);
  }

  function pendingRecords(){
    return records().filter(record=>!record.resolved&&!['approved','rejected'].includes(record.reviewStatus));
  }

  function isValidHomeRecord(record){
    const draft=obj(record&&record.raw&&record.raw.draft);
    const provider=text(record&&record.provider||draft.provider,'').toLowerCase();
    const model=text(record&&record.model||draft.model,'').toLowerCase();
    const validation=text(draft.validation_status||draft.validationStatus||record&&record.raw&&record.raw.reviewTask&&record.raw.reviewTask.payload&&record.raw.reviewTask.payload.validation_status,'').toLowerCase();
    const conclusion=text(record&&record.aiConclusion,'');
    return record&&record.source==='ai_draft'
      && record.symbol
      && record.taskType
      && validation==='passed'
      && conclusion
      && conclusion!=='暂无 AI 结论'
      && provider!=='mock'
      && model!=='mock-model'
      && provider.indexOf('mock')<0
      && model.indexOf('mock')<0;
  }

  function homePendingRecords(){
    const byKey={};
    pendingRecords().filter(isValidHomeRecord).filter(record=>record.actionable&&record.isCurrent).forEach(record=>{
      const key=stockKey(record.symbol)+'|'+text(record.taskType,'');
      const current=byKey[key];
      if(!current||String(record.createdAt||'').localeCompare(String(current.createdAt||''))>0)byKey[key]=record;
    });
    return Object.values(byKey).sort((a,b)=>String(b.createdAt||'').localeCompare(String(a.createdAt||'')));
  }

  function recordsForStock(stock){
    return records().filter(record=>matchesStock(stock,record.symbol));
  }

  window.AiDecisionReviewReader={
    refreshBridge,
    canonicalEntityKey,
    records,
    pendingRecords,
    homePendingRecords,
    recordsForStock,
    outcomeMessage,
    businessStatusLabel,
    reviewStatusLabel,
    taskTypeLabel,
    resolutionLabel:function(type){
      return {
        no_action_required:'本次复核已完成，无需调整',
        plan_applied:'计划更新已应用',
        operation_recorded:'实际操作结果已记录',
        dismissed:'本次任务已结束',
        superseded:'已有更新的复核结果，本记录转入历史'
      }[text(type,'')]||'';
    },
    discussionPromptForReview:function(reviewId){
      const match=records().find(record=>record.reviewId===reviewId);
      return match?match.discussionPrompt:'';
    },
    planUpdateContextForReview:function(reviewId){
      const match=records().find(record=>record.reviewId===reviewId);
      if(!match)return null;
      return {record:match,request:obj(match.raw&&match.raw.planUpdateRequest),outcome:obj(match.raw&&match.raw.decisionOutcome),discussion:obj(match.raw&&match.raw.discussionRecord)};
    },
    operationContextForReview:function(reviewId){
      const match=records().find(record=>record.reviewId===reviewId);
      if(!match)return null;
      return {record:match,request:obj(match.raw&&match.raw.operationRequest),outcome:obj(match.raw&&match.raw.decisionOutcome),audit:obj(match.raw&&match.raw.operationApplicationAudit)};
    }
  };
})();
