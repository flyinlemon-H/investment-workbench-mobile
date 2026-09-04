(function(root,factory){
  const node=typeof module==='object'&&module.exports;
  const api=factory(node?require('./plan-v2'):root.PlanV2,node?require('./discussion-plan-workflow'):root.DiscussionPlanWorkflow,node?require('./strict-ai-json'):root.StrictAiJson);
  if(node)module.exports=api;
  root.StateWatchWorkflow=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(Plan,Discussion,StrictJson){
  'use strict';
  const SCHEMA_VERSION='state-watch-draft.v1';
  const OPERATIONS=Object.freeze(['create','update','no_change','invalidate','complete']);
  const LABELS=Object.freeze({create:'新建观察计划',update:'编辑观察计划',no_change:'保持不变',invalidate:'取消计划',complete:'完成计划'});
  const TOP_FIELDS=['schemaVersion','operation','symbol','draftSessionId','draftSessionVersion','draftSessionHash','targetPlan','definition','reason'];
  const sessions=new WeakMap(),previews=new WeakMap(),latest=new Map(),pending=new WeakSet();
  const clone=Plan.clone,stable=Plan.stable;
  const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const fail=message=>({ok:false,previewReady:false,confirmReady:false,writes:0,message,errors:[message]});
  function freeze(value){if(value&&typeof value==='object'){Object.values(value).forEach(freeze);Object.freeze(value)}return value}
  function exact(value,fields,label){if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).length!==fields.length||fields.some(key=>!Object.prototype.hasOwnProperty.call(value,key)))throw new Error(`${label} 字段不完整或包含未知字段`)}
  function factsFor(stock){
    const facts=Discussion.protectedFacts(stock);
    // The existing snapshotHash stays unchanged. Also compare prepared rule content in memory,
    // so a malformed external same-version edit cannot bypass this session's stale check.
    return {facts,content:stable({facts:facts.snapshot,definitions:(stock.plans||[]).filter(Plan.hasWatchDefinition).map(Plan.watchDefinition)})};
  }
  function prepare(stock,{targetPlanId,now}={}){
    const {facts,content}=factsFor(stock);
    if(!stock.id)throw new Error('观察计划需要明确的标的 ID');
    let target=null,current=null;
    if(targetPlanId!==undefined){
      current=(stock.plans||[]).find(plan=>plan.id===targetPlanId);
      if(!current||!Plan.hasWatchDefinition(current)||current.status!=='active')throw new Error('目标不是当前可编辑的观察计划');
      target={id:current.id,planVersion:current.planVersion,snapshotHash:Discussion.planSnapshotHash(current)};
    }
    const session=Discussion.createDraftSession(facts,{now});
    const prepared=freeze({symbol:facts.symbol,stockId:stock.id,name:stock.name||facts.symbol,session:{...session,targetPlan:target},current:current?clone(current):null});
    sessions.set(prepared,{content,used:false});latest.set(stock.id,prepared);
    return prepared;
  }
  function release(prepared){if(prepared){sessions.delete(prepared);if(latest.get(prepared.stockId)===prepared)latest.delete(prepared.stockId)}}
  function envelope(prepared,operation,definition,reason){return {schemaVersion:SCHEMA_VERSION,operation,symbol:prepared.symbol,...Discussion.sessionBinding(prepared.session),targetPlan:clone(prepared.session.targetPlan),definition,reason}}
  function process(raw,{stock,prepared}={}){
    const parsed=StrictJson.parseStrictAiJson(raw);if(!parsed.ok)return fail(parsed.userMessage||'草案 JSON 无法解析');
    try{
      const registered=sessions.get(prepared);
      if(!registered||registered.used||latest.get(prepared.stockId)!==prepared)throw new Error('会话已失效，请重新打开观察计划');
      if(!stock||stock.id!==prepared.stockId||factsFor(stock).content!==registered.content)throw new Error('标的、持仓或计划已变化，请重新整理');
      const draft=parsed.value;exact(draft,TOP_FIELDS,'观察计划草案');
      if(draft.schemaVersion!==SCHEMA_VERSION||!OPERATIONS.includes(draft.operation))throw new Error('草案 schemaVersion 或 operation 无效');
      if(draft.symbol!==prepared.symbol)throw new Error('草案标的与当前标的不一致');
      if(draft.draftSessionId!==prepared.session.id||draft.draftSessionVersion!==prepared.session.version||draft.draftSessionHash!==prepared.session.hash)throw new Error('草案会话不匹配');
      const target=prepared.session.targetPlan;
      if(draft.operation==='create'){
        if(target||draft.targetPlan!==null)throw new Error('新建独立计划不能指向既有计划');
      }else{
        exact(draft.targetPlan,['id','planVersion','snapshotHash'],'目标计划');
        if(!target||stable(target)!==stable(draft.targetPlan))throw new Error('目标 ID、版本或快照不属于当前会话');
      }
      if(typeof draft.reason!=='string'||!draft.reason.trim()||draft.reason.trim().length>300)throw new Error('变更说明需要 1 至 300 字');
      let definition=null,operation=draft.operation;
      if(['create','update'].includes(operation)){
        const checked=Plan.validateWatchDefinition(draft.definition);if(!checked.ok)throw new Error(checked.errors.join('；'));
        definition=checked.definition;
        const cap=prepared.session&&Discussion.protectedFacts(stock).holding.maxPositionPct;
        if(cap&&definition.allocationConstraint.maxPositionPct!==null&&definition.allocationConstraint.maxPositionPct>cap)throw new Error('计划配置上限超过当前保护上限');
        if(operation==='update'&&stable(Plan.watchDefinition(prepared.current))===stable(definition))operation='no_change';
      }else if(draft.definition!==null)throw new Error('保持不变或生命周期操作的 definition 必须为空');
      const current=target?(stock.plans||[]).find(plan=>plan.id===target.id):null;
      if(target&&(!current||current.status!=='active'||current.planVersion!==target.planVersion||Discussion.planSnapshotHash(current)!==target.snapshotHash))throw new Error('目标计划已变化');
      const result=freeze({ok:true,previewReady:true,confirmReady:operation!=='no_change',writes:0,operation,draft:{...clone(draft),definition},current:current?clone(current):null,message:operation==='no_change'?'该计划没有纪律变化，不写入，也不增加版本。':'草案校验通过，请核对预览后确认。'});
      previews.set(result,{raw:JSON.stringify(draft),prepared});
      return result;
    }catch(error){return fail(error.message)}
  }
  function diff(current,definition){const before=Plan.watchDefinition(current);return Object.keys(Plan.WATCH_LABELS).filter(key=>stable(before[key])!==stable(definition[key])).map(key=>({field:key,label:Plan.WATCH_LABELS[key],before:clone(before[key]),after:clone(definition[key])}))}
  function valueText(key,value){
    if(value===null||value===undefined||value==='')return '未设置';
    if(key==='reviewAction')return Plan.REVIEW_ACTION_LABELS[value]||'待复核';
    if(key==='priceReferences')return value.map(ref=>`${ref.type==='watch_zone'?`${ref.from}–${ref.to}`:ref.price} · ${ref.meaning}`).join('；')||'未设置';
    if(key==='allocationConstraint')return [value.maxPositionPct?`仓位上限 ${value.maxPositionPct}%`:'',value.targetWeightRange||''].filter(Boolean).join('；')||'未设置';
    return Array.isArray(value)?value.join('；')||'未设置':String(value);
  }
  function summary(definition,{compact=false}={}){return `<dl class="watch-definition-summary">${(compact?['reviewAction','entryConditions','confirmationConditions','invalidationConditions','priceReferences','applicableConditions','allocationConstraint','note','validUntil','nextReviewDate'].map(key=>[key,Plan.WATCH_LABELS[key]]):Object.entries(Plan.WATCH_LABELS)).filter(([key])=>!compact||key!=='name'&&valueText(key,definition[key])!=='未设置').map(([key,label])=>`<div><dt>${esc(label)}</dt><dd>${esc(valueText(key,definition[key]))}</dd></div>`).join('')}</dl>`}
  function card(plan,stockId,{editable=true,runtimeHtml=''}={}){
    if(!Plan.hasWatchDefinition(plan))return `<div class="card-note">状态观察计划（只读） · 暂无完整 Definition · ${esc(plan.note||'')}</div>`;
    const labels={active:'进行中',cancelled:'已取消',completed:'已完成',replaced:'已替换'};
    return `<article class="card watch-definition-card" data-watch-plan="${esc(plan.id)}"><div class="card-title">${esc(plan.name)}</div><div class="card-note">计划定义 · ${esc(labels[plan.status])} · 版本 ${plan.planVersion}</div>${summary(Plan.watchDefinition(plan),{compact:true})}<p class="card-note">该计划为观察复核计划，需进一步形成执行决定。</p>${runtimeHtml}${editable&&plan.status==='active'?`<button class="btn small" type="button" data-watch-edit="${esc(plan.id)}" data-watch-stock="${esc(stockId)}">编辑计划</button>`:''}</article>`;
  }
  function renderPreview(result){
    if(!result||!result.ok)return `<div class="alert">${esc(result&&result.message||'请先生成草案')}。未写入任何数据。</div>`;
    const {operation,draft,current}=result;
    if(operation==='no_change')return `<section class="watch-preview"><h3>保持不变</h3><p>${esc(current.name)}：${esc(result.message)}</p></section>`;
    const changes=operation==='update'?diff(current,draft.definition):[];
    return `<section class="watch-preview"><h3>${esc(LABELS[operation])}</h3>${current?`<p>目标：${esc(current.name)} · 版本 ${current.planVersion}</p>`:''}${operation==='create'?summary(draft.definition):''}${changes.length?`<h4>纪律变化</h4>${changes.map(row=>`<div class="watch-diff-row"><b>${esc(row.label)}</b><div>原：${esc(valueText(row.field,row.before))}</div><div>新：${esc(valueText(row.field,row.after))}</div></div>`).join('')}<p>保留同一计划 ID，版本 ${current.planVersion} → ${current.planVersion+1}。</p>`:''}${['invalidate','complete'].includes(operation)?`<p>将“${esc(current.name)}”标记为${operation==='invalidate'?'已取消':'已完成'}。这是你确认的生命周期操作，不代表市场条件成立或发生交易。</p>`:''}<p>说明：${esc(draft.reason)}</p><p class="card-note">确认后保存观察纪律；不执行交易，不改变持仓或配置。</p></section>`;
  }
  function prompt(prepared){
    const shape=Plan.validateWatchDefinition({planMode:'state_watch',name:'观察主题',entryConditions:['当出现约定结构时开始观察'],confirmationConditions:['若出现进一步证据则加强复核'],invalidationConditions:['若原假设被破坏则重新审视规则'],reviewAction:'hold_watch'}).definition;
    return ['请整理一条稳定的观察／决策复核计划 Definition，不是交易指令。',
      'Definition 写规则，当前市场判断留在讨论中。错误：当前已经进入关键支撑验证阶段。正确：当高位回撤进入关键支撑区域时开始重点观察。',
      '价格匹配 ≠ 完整条件满足 ≠ 可执行交易。不得生成 Runtime、当前阶段、条件状态、买卖动作或数量。reduce_review 不等于 sell，add_review 不等于 buy。',
      'name 必填（80字以内）；进入、进一步确认、失效条件均必填，各1–12条字符串，每条240字以内；适用背景可空。失效条件是规则，不会自动取消计划。',
      'reviewAction 仅 reduce_review / add_review / hold_watch / risk_control；planType 与升级降级条件暂不支持。',
      'priceReferences 可为 []；最多8条，{type:"reference",price:35,meaning:"支撑参考"} 或 {type:"watch_zone",from:37,to:40,meaning:"压力区参考"}，正数、区间有序，不是触发价。',
      'allocationConstraint 可为空对象或包含 maxPositionPct（0到100的正数或null）、targetWeightRange（80字以内或null）；不得改动配置或计算交易数量。note最多1000字；日期可null或YYYY-MM-DD。',
      prepared.current?'这是对同一业务计划的编辑：update 保留 ID；没有变化用 no_change。明确取消用 invalidate，明确完成用 complete。后三者 definition 必须 null；精确复制 targetPlan，不能按主题名或列表位置定位。':'这是明确的新建独立计划：只用 create、targetPlan:null。编辑既有计划必须从对应卡片重新发起。',
      '一次只输出下列完整JSON信封，不增减字段；symbol、会话和目标绑定必须原样保留。变更仅在用户看过预览并点击确认后保存。',
      JSON.stringify(envelope(prepared,prepared.current?'update':'create',prepared.current?Plan.watchDefinition(prepared.current):shape,'说明本次纪律变化'),null,2),
      '以下程序事实只用于绑定及配置边界，不是 Definition：',JSON.stringify({holding:Discussion.protectedFacts?JSON.parse(sessions.get(prepared).content).facts.holding:{},currentDefinition:prepared.current?Plan.watchDefinition(prepared.current):null},null,2)].join('\n\n');
  }
  async function commit(result,state,deps={},options={}){
    const verified=previews.get(result);
    if(!verified||!result.ok)return {status:'invalid',writes:0,error:new Error('必须先完成有效预览')};
    if(pending.has(verified.prepared))return {status:'busy',writes:0};
    const stock=(state.stocks||[]).find(row=>row.id===verified.prepared.stockId);
    const fresh=process(verified.raw,{stock,prepared:verified.prepared});
    if(!fresh.ok)return {status:'stale',writes:0,error:new Error(fresh.message)};
    if(fresh.operation==='no_change')return {status:'no_change',writes:0,state};
    if(options.confirmed!==true)return {status:'confirmation_required',writes:0};
    pending.add(verified.prepared);
    try{
      const committed=await Plan.commitCandidate(state,candidate=>{
        const targetStock=candidate.stocks.find(row=>row.id===stock.id);
        if(fresh.operation==='create')targetStock.plans.push(Plan.createWatchPlan(fresh.draft.definition,{now:options.now}));
        else{
          const index=targetStock.plans.findIndex(plan=>plan.id===fresh.draft.targetPlan.id),current=targetStock.plans[index];
          targetStock.plans[index]=fresh.operation==='update'?Plan.editWatchPlan(current,fresh.draft.definition,{now:options.now}):Plan.terminateWatchPlan(current,fresh.operation==='invalidate'?'cancelled':'completed',{now:options.now,reason:fresh.draft.reason});
        }
        targetStock.updatedAt=Date.now();candidate.updatedAt=Math.max(Date.now(),(Number(state.updatedAt)||0)+1);return candidate;
      },{save:deps.saveCandidate,adopt:deps.adoptCandidate});
      if(committed.status==='completed'){sessions.get(verified.prepared).used=true;return committed}
      return {...committed,attemptedWrites:committed.writes,writes:0};
    }catch(error){return {status:'failed',writes:0,error}}
    finally{pending.delete(verified.prepared)}
  }
  return Object.freeze({SCHEMA_VERSION,OPERATIONS,LABELS,prepare,release,envelope,process,diff,valueText,summary,card,renderPreview,prompt,commit});
});
