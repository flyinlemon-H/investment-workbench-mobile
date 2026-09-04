(function(root,factory){
  const node=typeof module==='object'&&module.exports;
  const api=factory(
    node?require('./plan-v2.js'):root.PlanV2,
    node?require('./plan-review.js'):root.PlanReview,
    node?require('./discussion-workbench.js'):root.DiscussionWorkbench,
    node?require('./strict-ai-json.js'):root.StrictAiJson
  );
  if(node)module.exports=api;
  root.PlanRuntime=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(Plan,PlanReview,Discussion,StrictJson){
  'use strict';

  const SCHEMA_VERSION='plan-runtime.v1';
  const STORE_SCHEMA_VERSION='plan-runtime.store.v1';
  const HISTORY_LIMIT=30;
  const PHASES=Object.freeze(['inactive','watch_zone','forming','confirmed','action_review','resolved','downgraded','invalidated']);
  const PHASE_LABELS=Object.freeze({inactive:'未激活',watch_zone:'观察区',forming:'形成中',confirmed:'已确认',action_review:'操作复核',resolved:'已处理',downgraded:'已降级',invalidated:'已失效'});
  const ASSESSMENTS=Object.freeze(['advance','hold','downgrade','invalidate','resolve','unclear']);
  const ASSESSMENT_LABELS=Object.freeze({advance:'推进',hold:'维持',downgrade:'降级',invalidate:'失效',resolve:'处理完成',unclear:'暂不明确'});
  const CONFIDENCE_LEVELS=Object.freeze(['high','medium','low']);
  const CONFIDENCE_LABELS=Object.freeze({high:'高',medium:'中',low:'低'});
  const BINDING_STATUSES=Object.freeze(['current','definition_changed','current_state_changed','missing_plan','no_runtime']);
  const RECORD_FIELDS=Object.freeze(['schemaVersion','planId','phase','runtimeRevision','sourcePlanVersion','sourcePlanSnapshotHash','sourceCurrentStateId','sourceDiscussionVersion','summary','evidence','watchPoints','risks','confidence','updatedAt','history']);
  const HISTORY_FIELDS=Object.freeze(['fromPhase','toPhase','runtimeRevision','sourcePlanVersion','sourcePlanSnapshotHash','sourceCurrentStateId','sourceDiscussionVersion','summary','evidence','watchPoints','risks','confidence','committedAt','acknowledgedAt']);
  const REVIEW_FIELDS=Object.freeze(['suggestedPhase','transitionAssessment','summary','evidence','watchPoints','risks','confidence']);
  const TOP_FIELDS=Object.freeze(['planRuntimeReview']);
  const sessions=new WeakMap(),previews=new WeakMap(),latest=new Map(),pending=new WeakSet();
  const object=value=>value&&typeof value==='object'&&!Array.isArray(value)?value:{};
  const array=value=>Array.isArray(value)?value:[];
  const text=value=>String(value??'').trim();
  const clone=value=>value===undefined?undefined:JSON.parse(JSON.stringify(value));
  const stable=value=>Plan.stable(value);
  const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const fail=message=>({ok:false,previewReady:false,confirmReady:false,writes:0,message,errors:[message]});
  function freeze(value){if(value&&typeof value==='object'){Object.values(value).forEach(freeze);Object.freeze(value)}return value}
  function exact(value,fields,label,errors){
    if(!value||typeof value!=='object'||Array.isArray(value)){errors.push(`${label} 必须是对象`);return}
    const keys=Object.keys(value),extra=keys.filter(key=>!fields.includes(key)),missing=fields.filter(key=>!Object.prototype.hasOwnProperty.call(value,key));
    if(extra.length)errors.push(`${label} 包含未知字段：${extra.join('、')}`);
    if(missing.length)errors.push(`${label} 缺少字段：${missing.join('、')}`);
  }
  function validDateTime(value){const raw=text(value);if(!raw)return '';const parsed=new Date(raw);return Number.isFinite(parsed.getTime())?parsed.toISOString():''}
  function validStringList(source,key,errors,limit=10,itemLimit=240){
    if(!Array.isArray(source[key])){errors.push(`${key} 必须是数组`);return []}
    if(source[key].length>limit)errors.push(`${key} 最多 ${limit} 项`);
    const result=source[key].map(item=>text(item));
    if(result.some((item,index)=>typeof source[key][index]!=='string'||!item||item.length>itemLimit))errors.push(`${key} 项必须是 1 至 ${itemLimit} 字的文字`);
    return result;
  }
  function defaultStore(){return {schemaVersion:STORE_SCHEMA_VERSION,byPlanId:{}}}
  function normalizeHistory(value){
    const source=object(value);
    return {fromPhase:source.fromPhase===null?null:text(source.fromPhase),toPhase:text(source.toPhase),runtimeRevision:Number(source.runtimeRevision),sourcePlanVersion:Number(source.sourcePlanVersion),sourcePlanSnapshotHash:text(source.sourcePlanSnapshotHash),sourceCurrentStateId:text(source.sourceCurrentStateId),sourceDiscussionVersion:text(source.sourceDiscussionVersion),summary:text(source.summary),evidence:array(source.evidence).map(text),watchPoints:array(source.watchPoints).map(text),risks:array(source.risks).map(text),confidence:text(source.confidence),committedAt:validDateTime(source.committedAt)||text(source.committedAt),acknowledgedAt:source.acknowledgedAt===null?null:(validDateTime(source.acknowledgedAt)||text(source.acknowledgedAt))};
  }
  function normalizeRecord(value){
    const source=object(value);
    return {schemaVersion:SCHEMA_VERSION,planId:text(source.planId),phase:text(source.phase),runtimeRevision:Number(source.runtimeRevision),sourcePlanVersion:Number(source.sourcePlanVersion),sourcePlanSnapshotHash:text(source.sourcePlanSnapshotHash),sourceCurrentStateId:text(source.sourceCurrentStateId),sourceDiscussionVersion:text(source.sourceDiscussionVersion),summary:text(source.summary),evidence:array(source.evidence).map(text),watchPoints:array(source.watchPoints).map(text),risks:array(source.risks).map(text),confidence:text(source.confidence),updatedAt:validDateTime(source.updatedAt)||text(source.updatedAt),history:array(source.history).map(normalizeHistory).slice(-HISTORY_LIMIT)};
  }
  function validateBinding(source,label,errors){
    if(typeof source.planId==='string'&&(!text(source.planId)||text(source.planId).length>200))errors.push(`${label} planId 无效`);
    if(!Number.isInteger(source.sourcePlanVersion)||source.sourcePlanVersion<1)errors.push(`${label} sourcePlanVersion 无效`);
    for(const key of ['sourcePlanSnapshotHash','sourceCurrentStateId','sourceDiscussionVersion'])if(typeof source[key]!=='string'||!text(source[key])||text(source[key]).length>200)errors.push(`${label} ${key} 无效`);
  }
  function validateHistory(value,index=0){
    const source=object(value),errors=[],label=`Runtime history ${index+1}`;
    exact(value,HISTORY_FIELDS,label,errors);
    if(source.fromPhase!==null&&!PHASES.includes(source.fromPhase))errors.push(`${label} fromPhase 无效`);
    if(!PHASES.includes(source.toPhase))errors.push(`${label} toPhase 无效`);
    if(!Number.isInteger(source.runtimeRevision)||source.runtimeRevision<1)errors.push(`${label} runtimeRevision 无效`);
    validateBinding(source,label,errors);
    if(typeof source.summary!=='string'||!text(source.summary)||text(source.summary).length>800)errors.push(`${label} summary 无效`);
    for(const key of ['evidence','watchPoints','risks'])validStringList(source,key,errors);
    if(!CONFIDENCE_LEVELS.includes(source.confidence))errors.push(`${label} confidence 无效`);
    if(!validDateTime(source.committedAt))errors.push(`${label} committedAt 无效`);
    if(source.acknowledgedAt!==null&&!validDateTime(source.acknowledgedAt))errors.push(`${label} acknowledgedAt 无效`);
    if(source.toPhase==='action_review'&&!validDateTime(source.acknowledgedAt))errors.push(`${label} action_review 缺少人工确认时间`);
    if(source.toPhase!=='action_review'&&source.acknowledgedAt!==null)errors.push(`${label} acknowledgement 仅用于 action_review`);
    return {ok:errors.length===0,errors,history:normalizeHistory(source)};
  }
  function validateRecord(value){
    const source=object(value),errors=[];
    exact(value,RECORD_FIELDS,'Plan Runtime',errors);
    if(source.schemaVersion!==SCHEMA_VERSION)errors.push('Plan Runtime schemaVersion 无效');
    if(typeof source.planId!=='string'||!text(source.planId)||text(source.planId).length>200)errors.push('Plan Runtime planId 无效');
    if(!PHASES.includes(source.phase))errors.push('Plan Runtime phase 无效');
    if(!Number.isInteger(source.runtimeRevision)||source.runtimeRevision<1)errors.push('Plan Runtime runtimeRevision 无效');
    validateBinding(source,'Plan Runtime',errors);
    if(typeof source.summary!=='string'||!text(source.summary)||text(source.summary).length>800)errors.push('Plan Runtime summary 无效');
    for(const key of ['evidence','watchPoints','risks'])validStringList(source,key,errors);
    if(!CONFIDENCE_LEVELS.includes(source.confidence))errors.push('Plan Runtime confidence 无效');
    if(!validDateTime(source.updatedAt))errors.push('Plan Runtime updatedAt 无效');
    if(!Array.isArray(source.history)||!source.history.length||source.history.length>HISTORY_LIMIT)errors.push(`Plan Runtime history 必须为 1 至 ${HISTORY_LIMIT} 条`);
    const checked=array(source.history).map((item,index)=>validateHistory(item,index));checked.forEach(item=>errors.push(...item.errors));
    const revisions=array(source.history).map(item=>item&&item.runtimeRevision);
    for(let index=1;index<revisions.length;index++)if(!(revisions[index]>revisions[index-1]))errors.push('Plan Runtime history revision 必须递增');
    const last=array(source.history).at(-1);
    if(last){
      for(const [recordKey,historyKey] of [['phase','toPhase'],['runtimeRevision','runtimeRevision'],['sourcePlanVersion','sourcePlanVersion'],['sourcePlanSnapshotHash','sourcePlanSnapshotHash'],['sourceCurrentStateId','sourceCurrentStateId'],['sourceDiscussionVersion','sourceDiscussionVersion'],['summary','summary'],['confidence','confidence'],['updatedAt','committedAt']])if(source[recordKey]!==last[historyKey])errors.push(`Plan Runtime 当前值与最新 history 的 ${recordKey} 不一致`);
      for(const key of ['evidence','watchPoints','risks'])if(stable(source[key])!==stable(last[key]))errors.push(`Plan Runtime 当前值与最新 history 的 ${key} 不一致`);
    }
    return {ok:errors.length===0,errors,record:normalizeRecord(source)};
  }
  function normalizeStore(value){
    if(value===undefined||value===null)return defaultStore();
    const source=object(value),byPlanId={};
    Object.entries(object(source.byPlanId)).forEach(([key,raw])=>{byPlanId[key]=normalizeRecord(raw)});
    return {schemaVersion:STORE_SCHEMA_VERSION,byPlanId};
  }
  function validateStore(value){
    const source=object(value),errors=[];
    exact(value,['schemaVersion','byPlanId'],'Plan Runtime store',errors);
    if(source.schemaVersion!==STORE_SCHEMA_VERSION)errors.push('Plan Runtime store schemaVersion 无效');
    if(!source.byPlanId||typeof source.byPlanId!=='object'||Array.isArray(source.byPlanId))errors.push('Plan Runtime byPlanId 必须是对象');
    const seen=new Set();
    for(const [key,raw] of Object.entries(object(source.byPlanId))){
      const result=validateRecord(raw);errors.push(...result.errors);
      if(result.ok&&key!==result.record.planId)errors.push('Plan Runtime key 与 planId 不一致');
      if(result.ok&&seen.has(result.record.planId))errors.push('Plan Runtime planId 重复');
      if(result.ok)seen.add(result.record.planId);
    }
    return {ok:errors.length===0,errors,store:normalizeStore(source)};
  }
  function runtimeFor(state,planId){return object(state&&state.planRuntimeStates&&state.planRuntimeStates.byPlanId)[planId]||null}
  function findPlan(state,planId){
    for(const stock of array(state&&state.stocks)){const plan=array(stock&&stock.plans).find(item=>item&&item.id===planId);if(plan)return {stock,plan}}
    return null;
  }
  function usableCurrentState(stock){
    const current=stock&&stock.discussionState&&stock.discussionState.current;if(!current)return null;
    const result=Discussion.validateState(current);return result.ok?result.state:null;
  }
  function planBinding(plan){return {planId:plan.id,planVersion:plan.planVersion,snapshotHash:PlanReview.planSnapshotHash(plan)}}
  function currentBinding(current){return {stateId:current.stateId,sourceDiscussionVersion:current.sourceDiscussionVersion}}
  function bindingStatus(state,planId){
    const runtime=runtimeFor(state,planId);if(!runtime)return 'no_runtime';
    const found=findPlan(state,planId);if(!found||!Plan.hasWatchDefinition(found.plan))return 'missing_plan';
    const binding=planBinding(found.plan);
    if(runtime.sourcePlanVersion!==binding.planVersion||runtime.sourcePlanSnapshotHash!==binding.snapshotHash)return 'definition_changed';
    const current=usableCurrentState(found.stock);
    if(!current||runtime.sourceCurrentStateId!==current.stateId||runtime.sourceDiscussionVersion!==current.sourceDiscussionVersion)return 'current_state_changed';
    return 'current';
  }
  function compactCurrentState(current){
    return {stateId:current.stateId,sourceDiscussionVersion:current.sourceDiscussionVersion,stage:current.stage,attentionLevel:current.attentionLevel||'',trendAssessment:clone(current.trendAssessment||null),structureAssessment:clone(current.structureAssessment||[]),focusPoints:clone(current.focusPoints||[]),summary:current.summary,watchPoints:clone(current.watchPoints||[]),risks:clone(current.risks||[]),planRelation:clone(current.planRelation||null),confidence:current.confidence};
  }
  function contextFor(state,stock,plan,current,runtime){
    const binding=planBinding(plan),currentState=currentBinding(current);
    return {schemaVersion:'plan-runtime.context.v1',symbol:Discussion.canonical(stock),stockId:stock.id,planBinding:binding,planDefinition:Plan.watchDefinition(plan),currentState:compactCurrentState(current),currentStateBinding:currentState,existingRuntime:runtime?{phase:runtime.phase,runtimeRevision:runtime.runtimeRevision,summary:runtime.summary,watchPoints:clone(runtime.watchPoints),confidence:runtime.confidence,lastTransition:clone(runtime.history.at(-1)||null),bindingStatus:bindingStatus(state,plan.id)}:null};
  }
  function prepare(state,stockId,planId){
    const stock=array(state&&state.stocks).find(item=>item&&item.id===stockId);if(!stock)throw new Error('找不到需要复核的标的。');
    const plan=array(stock.plans).find(item=>item&&item.id===planId);if(!plan||!Plan.hasWatchDefinition(plan)||plan.planMode!=='state_watch')throw new Error('旧版价格计划暂不支持状态跟踪。');
    const current=usableCurrentState(stock);if(!current)throw new Error('当前没有可用于计划状态复核的最新结论，请先完成一次个股讨论并整理结论。');
    const runtime=runtimeFor(state,planId),context=contextFor(state,stock,plan,current,runtime);
    const prepared=freeze({stockId,planId,context:clone(context)}),fingerprint=stable(context);
    sessions.set(prepared,{fingerprint,used:false});latest.set(planId,prepared);return prepared;
  }
  function release(prepared){if(prepared){sessions.delete(prepared);if(latest.get(prepared.planId)===prepared)latest.delete(prepared.planId)}}
  function liveContext(state,prepared){
    const stock=array(state&&state.stocks).find(item=>item&&item.id===prepared.stockId),plan=stock&&array(stock.plans).find(item=>item&&item.id===prepared.planId),current=usableCurrentState(stock);
    if(!stock||!plan||!Plan.hasWatchDefinition(plan))return null;
    if(!current)return null;
    return contextFor(state,stock,plan,current,runtimeFor(state,prepared.planId));
  }
  function validateReview(value,currentPhase){
    const source=object(value),errors=[];exact(value,REVIEW_FIELDS,'planRuntimeReview',errors);
    if(!PHASES.includes(source.suggestedPhase))errors.push('suggestedPhase 无效');
    if(!ASSESSMENTS.includes(source.transitionAssessment))errors.push('transitionAssessment 无效');
    if(typeof source.summary!=='string'||!text(source.summary)||text(source.summary).length>800)errors.push('summary 必须是 1 至 800 字的文字');
    const review={suggestedPhase:source.suggestedPhase,transitionAssessment:source.transitionAssessment,summary:text(source.summary),evidence:validStringList(source,'evidence',errors),watchPoints:validStringList(source,'watchPoints',errors),risks:validStringList(source,'risks',errors),confidence:source.confidence};
    if(!CONFIDENCE_LEVELS.includes(source.confidence))errors.push('confidence 无效');
    const phase=source.suggestedPhase,assessment=source.transitionAssessment;
    if(assessment==='hold'&&currentPhase&&phase!==currentPhase)errors.push('hold 必须维持当前阶段');
    if(assessment==='invalidate'&&phase!=='invalidated')errors.push('invalidate 必须建议 invalidated');
    if(assessment==='resolve'&&phase!=='resolved')errors.push('resolve 必须建议 resolved');
    if(assessment==='downgrade'&&phase!=='downgraded'&&currentPhase){
      const rank={inactive:0,watch_zone:1,forming:2,confirmed:3,action_review:4};
      if(rank[phase]===undefined||rank[currentPhase]===undefined||rank[phase]>=rank[currentPhase])errors.push('downgrade 必须进入 downgraded 或更低关注阶段');
    }
    if(currentPhase&&phase===currentPhase&&!['hold','unclear'].includes(assessment))errors.push('阶段不变时应使用 hold 或 unclear');
    if(currentPhase&&phase!==currentPhase&&['hold','unclear'].includes(assessment))errors.push('阶段变化不能使用 hold 或 unclear');
    if(!currentPhase&&assessment==='hold')errors.push('首次建立 Runtime 不能使用 hold');
    if(!currentPhase&&((phase==='invalidated')!==(assessment==='invalidate')||(phase==='resolved')!==(assessment==='resolve')||(phase==='downgraded')!==(assessment==='downgrade')))errors.push('首次 Runtime 的阶段与变化方向不一致');
    if(currentPhase&&phase!==currentPhase&&!transitionAllowed(currentPhase,phase,assessment))errors.push(`不允许从 ${currentPhase} 直接变化为 ${phase}`);
    return {ok:errors.length===0,errors,review};
  }
  function transitionAllowed(from,to,assessment){
    if(assessment==='invalidate')return to==='invalidated';if(assessment==='resolve')return to==='resolved';
    const allowed={inactive:['watch_zone','forming','downgraded'],watch_zone:['inactive','forming','confirmed','downgraded'],forming:['inactive','watch_zone','confirmed','action_review','downgraded'],confirmed:['watch_zone','forming','action_review','downgraded'],action_review:['forming','confirmed','downgraded'],resolved:['inactive','watch_zone','forming'],downgraded:['inactive','watch_zone','forming'],invalidated:['inactive','watch_zone','forming']};
    if(!array(allowed[from]).includes(to))return false;
    if(assessment==='advance')return !['inactive','downgraded'].includes(to)||['resolved','downgraded','invalidated'].includes(from);
    if(assessment==='downgrade')return to==='downgraded'||['inactive','watch_zone','forming'].includes(to);
    return false;
  }
  function sameJudgment(runtime,review){return Boolean(runtime&&runtime.phase===review.suggestedPhase&&runtime.summary===review.summary&&runtime.confidence===review.confidence&&stable(runtime.evidence)===stable(review.evidence)&&stable(runtime.watchPoints)===stable(review.watchPoints)&&stable(runtime.risks)===stable(review.risks))}
  function process(raw,{state,prepared}={}){
    const parsed=StrictJson.parseStrictAiJson(raw);if(!parsed.ok)return fail(parsed.userMessage||'Runtime JSON 无法解析');
    try{
      const registered=sessions.get(prepared);if(!registered||registered.used||latest.get(prepared.planId)!==prepared)throw new Error('复核会话已失效，请重新发起。');
      const context=liveContext(state,prepared);if(!context)throw new Error('计划定义或当前结论已经变化，请重新复核状态。');
      if(stable(context)!==registered.fingerprint)throw new Error(context.planBinding.planVersion!==prepared.context.planBinding.planVersion||context.planBinding.snapshotHash!==prepared.context.planBinding.snapshotHash?'计划定义已经变化，请重新复核状态。':'当前结论已经变化，请重新复核状态。');
      const envelope=parsed.value,errors=[];exact(envelope,TOP_FIELDS,'Runtime 输出',errors);if(errors.length)throw new Error(errors.join('；'));
      const runtime=runtimeFor(state,prepared.planId),checked=validateReview(envelope.planRuntimeReview,runtime&&runtime.phase);if(!checked.ok)throw new Error(checked.errors.join('；'));
      const noChange=bindingStatus(state,prepared.planId)==='current'&&sameJudgment(runtime,checked.review),result=freeze({ok:true,previewReady:true,confirmReady:!noChange,writes:0,outcome:noChange?'no_change':(runtime?'change':'first'),currentPhase:runtime&&runtime.phase||null,review:clone(checked.review),message:noChange?'当前计划状态维持不变，不写入，也不增加 Runtime 版本。':'Runtime 判断已通过校验，请核对后确认。'});
      previews.set(result,{raw:JSON.stringify(envelope),prepared});return result;
    }catch(error){return fail(error.message)}
  }
  function request(prepared){
    const example={planRuntimeReview:{suggestedPhase:'forming',transitionAssessment:'advance',summary:'已经进入观察窗口，相关结构正在形成，但确认条件尚未完成。',evidence:['当前结论显示相关结构正在发展'],watchPoints:['观察确认条件是否完成'],risks:['若失效条件出现，应降级或判定失效'],confidence:'medium'}};
    return ['你正在复核一个精确绑定的状态观察计划（Plan Runtime Review）。只判断这个计划当前走到哪一步，不改写计划定义，也不重做个股 Current State。',
      '只能使用下方程序提供的 Plan Definition、最新 Current State 与既有 Runtime。不得发明市场、新闻、基本面、价格、日期、版本、持仓或配置事实。',
      '价格进入参考区不等于确认条件完成。action_review 只表示需要人工复核操作方向，不是买卖信号，不得给出交易执行、订单、数量或自动操作。保留不确定性。',
      `suggestedPhase 只能是：${PHASES.join(' / ')}。transitionAssessment 只能是：${ASSESSMENTS.join(' / ')}。阶段不变用 hold（不确定但维持可用 unclear）；失效用 invalidate + invalidated；处理完成用 resolve + resolved。`,
      'summary 1–800 字；evidence、watchPoints、risks 各最多 10 条，每条 1–240 字；confidence 只能 high / medium / low。不得增减字段。',
      '仅输出一个 json 代码围栏，围栏内是下列结构；不要输出任何说明文字：',`\`\`\`json\n${JSON.stringify(example,null,2)}\n\`\`\``,
      '程序保护上下文（只读，不得复制进输出）：',JSON.stringify(prepared.context,null,2)].join('\n\n');
  }
  function renderPreview(result){
    if(!result||!result.ok)return `<div class="alert">${esc(result&&result.message||'请先导入 Runtime JSON')}。未写入任何数据。</div>`;
    if(result.outcome==='no_change')return `<section class="runtime-preview"><h3>当前计划状态维持不变</h3><p>${esc(result.message)}</p><p class="card-note">Plan Definition 未改变；0 次正式写入。</p></section>`;
    const review=result.review,first=result.outcome==='first';
    return `<section class="runtime-preview"><h3>${first?'首次建立运行状态':'计划状态变化'}</h3><div class="runtime-preview-grid"><div><span>当前阶段</span><b>${esc(result.currentPhase?PHASE_LABELS[result.currentPhase]:'尚未建立')}</b></div><div><span>建议阶段</span><b>${esc(PHASE_LABELS[review.suggestedPhase])}</b></div><div><span>变化方向</span><b>${esc(ASSESSMENT_LABELS[review.transitionAssessment])}</b></div><div><span>置信度</span><b>${esc(CONFIDENCE_LABELS[review.confidence])}</b></div></div><h4>判断摘要</h4><p>${esc(review.summary)}</p>${listHtml('主要依据',review.evidence)}${listHtml('当前观察',review.watchPoints)}${listHtml('风险',review.risks)}${review.suggestedPhase==='action_review'?'<div class="alert">确认进入“操作复核”只表示确认这项判断状态。请人工决定下一步，不会执行交易。</div>':''}<p class="card-note">本次只更新 Plan Runtime State。Plan Definition、持仓、配置与执行记录均保持不变。</p></section>`;
  }
  function listHtml(label,items){return `<h4>${esc(label)}</h4>${items.length?`<ul>${items.map(item=>`<li>${esc(item)}</li>`).join('')}</ul>`:'<p class="card-note">未列出。</p>'}`}
  function nowIso(value){const candidate=typeof value==='function'?value():value,parsed=new Date(candidate||Date.now());return parsed.toISOString()}
  function buildRecord(existing,review,binding,committedAt){
    const revision=(existing&&existing.runtimeRevision||0)+1,acknowledgedAt=review.suggestedPhase==='action_review'?committedAt:null;
    const entry={fromPhase:existing&&existing.phase||null,toPhase:review.suggestedPhase,runtimeRevision:revision,sourcePlanVersion:binding.planVersion,sourcePlanSnapshotHash:binding.snapshotHash,sourceCurrentStateId:binding.stateId,sourceDiscussionVersion:binding.sourceDiscussionVersion,summary:review.summary,evidence:clone(review.evidence),watchPoints:clone(review.watchPoints),risks:clone(review.risks),confidence:review.confidence,committedAt,acknowledgedAt};
    return {schemaVersion:SCHEMA_VERSION,planId:binding.planId,phase:entry.toPhase,runtimeRevision:revision,sourcePlanVersion:entry.sourcePlanVersion,sourcePlanSnapshotHash:entry.sourcePlanSnapshotHash,sourceCurrentStateId:entry.sourceCurrentStateId,sourceDiscussionVersion:entry.sourceDiscussionVersion,summary:entry.summary,evidence:clone(entry.evidence),watchPoints:clone(entry.watchPoints),risks:clone(entry.risks),confidence:entry.confidence,updatedAt:committedAt,history:[...array(existing&&existing.history),entry].slice(-HISTORY_LIMIT)};
  }
  async function commit(result,state,deps={},options={}){
    const verified=previews.get(result);if(!verified||!result.ok)return {status:'invalid',writes:0,error:new Error('必须先完成有效的 Runtime 预览')};
    if(pending.has(verified.prepared))return {status:'busy',writes:0};
    const fresh=process(verified.raw,{state,prepared:verified.prepared});if(!fresh.ok)return {status:'stale',writes:0,error:new Error(fresh.message)};
    if(fresh.outcome==='no_change')return {status:'no_change',writes:0,state};if(options.confirmed!==true)return {status:'confirmation_required',writes:0};
    pending.add(verified.prepared);
    try{
      const committedAt=nowIso(options.now),binding={planId:verified.prepared.planId,planVersion:verified.prepared.context.planBinding.planVersion,snapshotHash:verified.prepared.context.planBinding.snapshotHash,stateId:verified.prepared.context.currentStateBinding.stateId,sourceDiscussionVersion:verified.prepared.context.currentStateBinding.sourceDiscussionVersion};
      const committed=await Plan.commitCandidate(state,candidate=>{
        candidate.planRuntimeStates=normalizeStore(candidate.planRuntimeStates);
        const existing=runtimeFor(candidate,binding.planId),record=buildRecord(existing,fresh.review,binding,committedAt),checked=validateRecord(record);if(!checked.ok)throw new Error(checked.errors.join('；'));
        candidate.planRuntimeStates.byPlanId[binding.planId]=checked.record;candidate.updatedAt=Math.max(Date.now(),(Number(state.updatedAt)||0)+1);return candidate;
      },{save:deps.saveCandidate,adopt:deps.adoptCandidate});
      if(committed.status==='completed'){sessions.get(verified.prepared).used=true;return committed}
      return {...committed,attemptedWrites:committed.writes,writes:0};
    }catch(error){return {status:'failed',writes:0,error}}
    finally{pending.delete(verified.prepared)}
  }
  return Object.freeze({SCHEMA_VERSION,STORE_SCHEMA_VERSION,HISTORY_LIMIT,PHASES,PHASE_LABELS,ASSESSMENTS,ASSESSMENT_LABELS,CONFIDENCE_LEVELS,CONFIDENCE_LABELS,BINDING_STATUSES,defaultStore,normalizeRecord,validateRecord,normalizeStore,validateStore,runtimeFor,findPlan,usableCurrentState,planBinding,currentBinding,bindingStatus,prepare,release,validateReview,transitionAllowed,process,request,renderPreview,buildRecord,commit,clone,stable,escapeHtml:esc});
});
