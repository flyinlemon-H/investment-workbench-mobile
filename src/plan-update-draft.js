(function(){
  const STORAGE_KEY='v13_plan_update_drafts_v1';
  const DRAFT_KIND='plan_update';
  const ACTIONS=new Set(['add_review','add','buy','reduce_review','reduce','sell','take_profit','hold_review','hold','observe','risk_review','stop_loss','risk']);
  const STATUSES=new Set(['active','draft','pending_review']);
  const required=['draft_id','source_request_id','source_decision_id','symbol','draft_status','summary','plan_strategy','proposed_plans','plans_to_archive','risk_flags','notes','created_at'];
  const planRequired=['action_type','trigger_price','quantity','status','priority','reason','conditions','invalidation_conditions','source','valid_until'];
  const obj=value=>value&&typeof value==='object'&&!Array.isArray(value)?value:{};
  const arr=value=>Array.isArray(value)?value:[];
  const symbol=value=>String(value||'').trim().toUpperCase();
  const planId=plan=>String(plan&& (plan.plan_id||plan.id)||'');
  const dateValid=value=>typeof value==='string'&&value.trim()&&!isNaN(Date.parse(value.length<=10?value+'T00:00:00':value));
  const number=value=>{const n=Number(value);return isFinite(n)?n:null};
  function resolveUnit(stock){const strategy=typeof normalizeStrategy==='function'?normalizeStrategy(stock.strategy,stock):obj(stock.strategy),configured=Number(strategy.minTradeUnit),explicit=Boolean(strategy.minTradeUnitConfirmed===true||String(strategy.minTradeUnitSource||'').trim()),code=symbol(stock.code||stock.symbol);if((configured>1||explicit&&configured>=1))return {value:configured,source:'stock_config',reliable:true};if(code.endsWith('.SS')||code.endsWith('.SZ')||code.endsWith('.SH'))return {value:100,source:'cn_market_default',reliable:true};if(code.endsWith('.HK'))return {value:null,source:'unknown_hk_board_lot',reliable:false};return {value:null,source:'unknown',reliable:false}}
  function stableStringify(value){if(Array.isArray(value))return '['+value.map(stableStringify).join(',')+']';if(value&&typeof value==='object'){return '{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+stableStringify(value[key])).join(',')+'}'}return JSON.stringify(value)}
  async function snapshotHash(plans){const bytes=new TextEncoder().encode(stableStringify(arr(plans))),hash=await crypto.subtle.digest('SHA-256',bytes);return Array.from(new Uint8Array(hash)).map(v=>v.toString(16).padStart(2,'0')).join('')}
  function manager(){if(!window.StorageManager)throw new Error('StorageManager is unavailable.');return window.StorageManager}
  async function persist(requestId,value){
    const previous=saved(requestId),write=()=>manager().saveDraft(DRAFT_KIND,requestId,value);
    if(window.MultiTabProtection&&typeof window.MultiTabProtection.runProtectedDraftSave==='function')await window.MultiTabProtection.runProtectedDraftSave(DRAFT_KIND,requestId,previous,value,write);
    else await write();
    return value;
  }
  async function savePromptMeta(requestId,decisionId,snapshot){const previous=saved(requestId)||{},value={...previous,status:previous.draft?'pending_confirmation':'prompt_generated',prompt_generated_at:new Date().toISOString(),prompt_plan_snapshot_hash:snapshot,source_decision_id:decisionId};return persist(requestId,value)}
  async function saveRequestDraft(requestId,draft,validation,currentPlanSnapshotHash){const previous=saved(requestId)||{},now=new Date().toISOString(),snapshot=previous.prompt_plan_snapshot_hash||currentPlanSnapshotHash,value={...previous,draft,validation,current_plan_snapshot_hash:snapshot,status:validation.business_valid?'pending_confirmation':'draft_imported',draft_imported_at:now,validation_status:validation.business_valid?'validated':'failed',saved_at:now};return persist(requestId,value)}
  async function markApplicationRequest(requestId,application){const previous=saved(requestId)||{},applied=application&&application.status==='applied_in_browser',value={...previous,status:applied?'applied':'application_request_generated',application_request:application,application_request_generated_at:new Date().toISOString()};return persist(requestId,value)}
  async function abandon(requestId){
    const previous=saved(requestId),write=()=>manager().deleteDraft(DRAFT_KIND,requestId);
    if(window.MultiTabProtection&&typeof window.MultiTabProtection.runProtectedDraftSave==='function')await window.MultiTabProtection.runProtectedDraftSave(DRAFT_KIND,requestId,previous,null,write);
    else await write();
  }
  function saved(requestId){return manager().getDraft(DRAFT_KIND,requestId)}
  function context(reviewId,stock){
    const raw=window.AiDecisionReviewReader&&window.AiDecisionReviewReader.planUpdateContextForReview?window.AiDecisionReviewReader.planUpdateContextForReview(reviewId):null;
    if(!raw)return null;
    return {...raw,stock};
  }
  function eligible(ctx){
    const request=obj(ctx&&ctx.request),outcome=obj(ctx&&ctx.outcome),stock=ctx&&ctx.stock;
    return Boolean(stock&&outcome.outcome_type==='plan_update'&&request.request_type==='plan_update'&&request.request_id&&symbol(request.symbol)===symbol(stock.code||stock.symbol)&&obj(request.current_plan_reference)&&Object.keys(obj(request.current_plan_reference)).length);
  }
  function formalPlan(plan){
    return {plan_id:planId(plan),action_type:String(plan.type||plan.action||''),trigger_price:plan.triggerPrice??plan.price??null,quantity:plan.quantity??plan.shares??null,status:String(plan.status||'active'),priority:Number(plan.priority||0)||null,reason:String(plan.reason||plan.summary||plan.note||''),created_at:plan.createdAt||plan.created_at||'',updated_at:plan.updatedAt||plan.updated_at||''};
  }
  function prompt(reviewId,stock){
    const ctx=context(reviewId,stock);
    if(!eligible(ctx))throw new Error('尚未形成有效的计划更新请求。');
    const s=stock,strategy=typeof normalizeStrategy==='function'?normalizeStrategy(s.strategy,s):obj(s.strategy);
    const position=typeof getPositionInfo==='function'?getPositionInfo(s,typeof getEstimatedTotalAssets==='function'?getEstimatedTotalAssets():0):null;
    const currentPrice=typeof getComparablePrice==='function'?getComparablePrice(s):(s.currentPrice||s.lastUnitPrice||null);
    const readiness=window.PlanGenerationGate&&window.PlanGenerationGate.evaluatePlanGenerationReadiness?window.PlanGenerationGate.evaluatePlanGenerationReadiness({stock:s,currentPrice,existingPlans:s.plans}):null;
    if(readiness&&!readiness.canGenerate)throw new Error('无法生成新版计划：'+readiness.blockingReasons.join('；'));
    const payload={
      generated_at:new Date().toISOString(),source_decision_id:ctx.outcome.decision_id,
      stock:{name:s.name,symbol:s.code||s.symbol,marketType:String(s.code||'').endsWith('.HK')?'HK':(s.type==='etf'?'CN_ETF':'CN'),role:s.role,theme:s.theme,investmentStyle:strategy.investmentStyle},
      position:{shares:s.shares,avgCost:s.avgCost,currentPrice,currentWeight:position&&position.actualPct,targetWeight:strategy.targetWeight,maxWeight:strategy.maxWeight,minTradeUnit:resolveUnit(s).value,minTradeUnitSource:resolveUnit(s).source,minTradeUnitReliable:resolveUnit(s).reliable},
      active_plans:(typeof v13DisplayActivePlans==='function'?v13DisplayActivePlans(s.plans):arr(s.plans)).map(formalPlan),
      analysis:{longTermLogic:obj(s.longTermLogic),technicalReview:obj(s.technicalReview),fundamentalReview:obj(s.fundamentalReview),valuationReview:obj(s.valuationReview),allocationDecision:obj(s.allocationDecision),dataFreshness:obj(s.dataFreshness),marketDataFreshness:obj(s.marketDataFreshness),riskState:obj(s.riskState||s.riskManagement)},
      decision_outcome:ctx.outcome,discussion_result:ctx.discussion,user_constraints:arr(ctx.discussion.user_constraints),requested_changes:arr(ctx.request.requested_changes),plan_update_request:ctx.request
    };
    const schema={draft_id:'',source_request_id:ctx.request.request_id,source_decision_id:ctx.request.source_decision_id,symbol:ctx.request.symbol,draft_status:'draft',summary:'',plan_strategy:'',proposed_plans:[{plan_id:null,action_type:'add_review',trigger_price:null,quantity:null,status:'active',priority:1,reason:'',conditions:[],invalidation_conditions:[],source:'ai_plan_update_draft',valid_until:'YYYY-MM-DD'}],plans_to_archive:[],plans_to_delete:[],risk_flags:[],notes:[],created_at:new Date().toISOString()};
    const body=['你是一名谨慎的投资计划草案助手。','只生成计划草案，不输出确定性买卖命令，不自动执行交易，不修改持仓。','quantity不确定时填null；trigger_price无明确依据时填null；必须尊重minTradeUnit。','避免距离现价过远且无实际复核价值的计划；优先保留4～6条真正有效的active plans。','所有JSON引号使用英文双引号。严格输出可解析JSON，不要Markdown或代码块。','','当前上下文：',JSON.stringify(payload,null,2),'','严格输出结构：',JSON.stringify(schema,null,2)].join('\n');
    const warning=readiness&&window.PlanGenerationGate.warningHeader?window.PlanGenerationGate.warningHeader(readiness):'';
    return warning?warning+'\n'+body:body;
  }
  function validate(draft,ctx){
    const errors=[],warnings=[],d=obj(draft),request=obj(ctx&&ctx.request),stock=ctx&&ctx.stock||{};
    required.filter(key=>!(key in d)).forEach(key=>errors.push(`缺少字段：${key}`));
    if(d.draft_status!=='draft')errors.push('draft_status 必须为 draft');
    if(d.source_request_id!==request.request_id)errors.push('source_request_id 与计划更新请求不一致');
    if(d.source_decision_id!==request.source_decision_id)errors.push('source_decision_id 与决策结果不一致');
    if(symbol(d.symbol)!==symbol(request.symbol))errors.push('symbol 与计划更新请求不一致');
    const plans=arr(d.proposed_plans);if(!plans.length)errors.push('proposed_plans 不得为空');
    if(!Array.isArray(d.plans_to_archive))errors.push('plans_to_archive 必须为数组');
    if(d.plans_to_delete!==undefined&&!Array.isArray(d.plans_to_delete))errors.push('plans_to_delete 必须为数组');
    if(!Array.isArray(d.risk_flags))errors.push('risk_flags 必须为数组');
    if(!Array.isArray(d.notes))errors.push('notes 必须为数组');
    const unitInfo=resolveUnit(stock),unit=unitInfo.value;
    const cp=typeof getComparablePrice==='function'?Number(getComparablePrice(stock)):Number(stock.currentPrice||stock.lastUnitPrice||0),seen=new Set();
    plans.forEach((plan,index)=>{
      const p=obj(plan),prefix=`第 ${index+1} 条计划`;
      planRequired.filter(key=>!(key in p)).forEach(key=>errors.push(`${prefix}缺少字段：${key}`));
      if(!ACTIONS.has(String(p.action_type||'')))errors.push(`${prefix}动作类型无效`);
      if(!STATUSES.has(String(p.status||'')))errors.push(`${prefix}状态无效`);
      const price=p.trigger_price===null?null:number(p.trigger_price);if(p.trigger_price!==null&&(!(price>0)))errors.push(`${prefix}触发价必须为正数或 null`);
      const qty=p.quantity===null?null:number(p.quantity);if(p.quantity!==null&&(!(qty>0)||!Number.isInteger(qty)))errors.push(`${prefix}数量必须为正整数或 null`);else if(qty!==null&&unit&&qty%unit)errors.push(`${prefix}数量不符合最小交易单位 ${unit}`);else if(qty!==null&&!unit)warnings.push(`${prefix}交易单位未知，数量合规性需要用户再次确认`);
      if(!dateValid(p.valid_until))errors.push(`${prefix}有效期日期无效`);
      if(!Array.isArray(p.conditions)||!Array.isArray(p.invalidation_conditions))errors.push(`${prefix}条件字段必须为数组`);
      const key=`${p.action_type}|${price}`;if(seen.has(key))errors.push(`${prefix}与其他计划动作及触发价重复`);seen.add(key);
      if(cp&&price&&['add_review','add','buy'].includes(p.action_type)&&price>cp*1.1)warnings.push(`${prefix}加仓价明显高于现价`);
      if(cp&&price&&['reduce_review','reduce','sell','take_profit'].includes(p.action_type)&&price<cp*.9)warnings.push(`${prefix}减仓价明显低于现价`);
    });
    const active=plans.filter(p=>p&&p.status==='active').length;if(plans.length&&(active<4||active>6))warnings.push('active计划数量建议保持4～6条');
    const ids=new Set(arr(stock.plans).map(planId));arr(d.plans_to_archive).forEach(id=>{if(!ids.has(String(id)))errors.push(`归档计划不存在：${id}`)});arr(d.plans_to_delete).forEach(id=>{if(!ids.has(String(id)))errors.push(`删除建议引用的计划不存在：${id}`)});
    return {schema_valid:required.every(key=>key in d)&&planRequired.every(key=>plans.every(p=>p&&key in p)),business_valid:errors.length===0,warnings,errors};
  }
  function comparable(plan){return {action:plan&& (plan.action_type||plan.type||plan.action),price:plan&& (plan.trigger_price??plan.triggerPrice??plan.price),quantity:plan&& (plan.quantity??plan.shares),status:plan&& (plan.status||'active'),reason:plan&& (plan.reason||plan.summary||plan.note||'')}}
  function diff(currentPlans,draft){
    const current=new Map(arr(currentPlans).map(p=>[planId(p),p])),rows=[],used=new Set(),archives=new Set(arr(draft&&draft.plans_to_archive).map(String)),deletes=new Set(arr(draft&&draft.plans_to_delete).map(String));
    arr(draft&&draft.proposed_plans).forEach(p=>{const id=planId(p);if(id&&current.has(id)){used.add(id);rows.push({change:JSON.stringify(comparable(current.get(id)))===JSON.stringify(comparable(p))?'保留':'修改',plan_id:id,current:current.get(id),proposed:p})}else rows.push({change:'新增',plan_id:id,current:null,proposed:p})});
    current.forEach((p,id)=>{if(deletes.has(id))rows.push({change:'删除建议',plan_id:id,current:p,proposed:null});else if(archives.has(id))rows.push({change:'归档',plan_id:id,current:p,proposed:null});else if(!used.has(id))rows.push({change:'保留',plan_id:id,current:p,proposed:p})});return rows;
  }
  window.PlanUpdateDraft={context,eligible,prompt,validate,savePromptMeta,saveRequestDraft,markApplicationRequest,abandon,saved,diff,formalPlan,snapshotHash,stableStringify,resolveUnit,storageKey:STORAGE_KEY,draftKind:DRAFT_KIND};
})();
