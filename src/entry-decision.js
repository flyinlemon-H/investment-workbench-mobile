(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.EntryDecision=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  const STATES=Object.freeze({wait_setup:'尚未形成建仓结构',setup_forming:'建仓条件正在形成',entry_ready:'建仓条件已满足',entry_extended:'已明显延伸，建仓位置优势下降',setup_failed:'本轮建仓结构已失败'});
  const PATHS=Object.freeze({pullback_confirmation:'回踩确认',breakout_confirmation:'突破确认',platform_breakout:'平台整理后二次突破',none:'暂无明确路径'});
  const NEGATIVES=['structure_weakening','breakout_failure','support_failure','short_term_weakening','momentum_exhaustion','structure_invalidated','other'];
  const own=(v,k)=>Object.prototype.hasOwnProperty.call(v||{},k);
  function validate(value){
    const errors=[],record=v=>v&&typeof v==='object'&&!Array.isArray(v);
    const exact=(v,keys,label)=>{if(!record(v)){errors.push(`${label} must be an object`);return false}if(Object.keys(v).some(k=>!keys.includes(k))||keys.some(k=>!own(v,k)))errors.push(`${label} fields invalid`);return true};
    const str=v=>typeof v==='string'&&v.trim().length>0&&v.length<=200;
    const list=(v,label,check,limit=5)=>{if(!Array.isArray(v)||v.length>limit||v.some(x=>!check(x)))errors.push(`${label} invalid`)};
    if(!exact(value,['state','path','directionConfirmed','confirmationSatisfied','position','completedConditions','pendingConditions','negativeEvidence','previousConditions','transitionReason'],'entryDecision'))return {ok:false,errors};
    if(!own(STATES,value.state)||!own(PATHS,value.path))errors.push('entry state/path invalid');
    for(const k of ['directionConfirmed','confirmationSatisfied'])if(typeof value[k]!=='boolean')errors.push(`${k} must be boolean`);
    if(!['acceptable','extended','unclear'].includes(value.position))errors.push('entry position invalid');
    for(const k of ['completedConditions','pendingConditions'])list(value[k],k,str);
    list(value.negativeEvidence,'negativeEvidence',v=>exact(v,['type','detail','isNew'],'negative evidence')&&NEGATIVES.includes(v.type)&&str(v.detail)&&typeof v.isNew==='boolean');
    list(value.previousConditions,'previousConditions',v=>exact(v,['condition','status','evidence'],'previous condition')&&str(v.condition)&&['satisfied','pending','invalidated','unknown'].includes(v.status)&&str(v.evidence),3);
    if(typeof value.transitionReason!=='string'||value.transitionReason.length>200)errors.push('transitionReason invalid');
    return {ok:errors.length===0,errors};
  }
  function example(){return {state:'wait_setup',path:'none',directionConfirmed:false,confirmationSatisfied:false,position:'unclear',completedConditions:[],pendingConditions:[],negativeEvidence:[],previousConditions:[],transitionReason:''}}
  // Checks AI assertions for consistency; never infers a market judgment or changes a saved record.
  function evaluate(current,previous,shares){
    if(shares!==0)return {applicable:false,expectedState:null,diagnostics:[]};
    const entry=current?.actionAssessment?.entryDecision;
    if(!entry||!validate(entry).ok)return {applicable:true,expectedState:null,diagnostics:previous?.references?.holding?.shares===0&&previous?.actionAssessment?.entryDecision?[{code:'entry_review_missing',severity:'warning',title:'建仓判断核对',message:'上一轮已有建仓路径，本轮未提供路径及条件核对；旧格式仍已保存。'}]:[]};
    const diagnostics=[],warn=(code,message)=>diagnostics.push({code,severity:'warning',title:'建仓判断核对',message});
    const prior=previous?.references?.holding?.shares===0?previous:null;
    const conditions=prior?.actionAssessment?.upgradeConditions||[],priorEntry=prior?.actionAssessment?.entryDecision;
    const newNegative=entry.negativeEvidence.some(e=>e.isNew),negative=entry.negativeEvidence.length>0;
    for(const condition of conditions)if(!entry.previousConditions.some(c=>c.condition===condition))warn('entry_commitment_missing',`上一轮条件尚未逐项核对：${condition}`);
    const satisfied=entry.previousConditions.some(c=>conditions.includes(c.condition)&&c.status==='satisfied');
    // A completed parallel path may supersede an untriggered old path without negative evidence.
    // Keep this narrow: it cannot excuse an unconfirmed path, new waiting requirements or a downgrade.
    const completedMigration=priorEntry&&priorEntry.path!==entry.path&&entry.path!=='none'&&entry.transitionReason.trim()&&entry.state==='entry_ready'&&entry.directionConfirmed&&entry.confirmationSatisfied&&entry.position==='acceptable'&&!negative&&!entry.pendingConditions.length&&satisfied;
    if(entry.previousConditions.some(c=>conditions.includes(c.condition)&&c.status==='invalidated')&&!newNegative&&!completedMigration)warn('entry_invalidation_unexplained','旧条件被否定，但未说明新增负面证据或结构变化。');
    const confirmed=entry.directionConfirmed&&entry.confirmationSatisfied&&entry.path!=='none';
    let expectedState=null;
    if(confirmed&&!negative)expectedState=entry.position==='acceptable'?'entry_ready':entry.position==='extended'?'entry_extended':null;
    if(expectedState&&entry.state!==expectedState)warn('entry_upgrade_not_acknowledged',`所列路径条件已满足，应复核为「${STATES[expectedState]}」，不可任意追加等待条件。`);
    if(satisfied&&!newNegative&&['wait_setup','setup_forming'].includes(entry.state)&&entry.position==='acceptable')warn('entry_goalpost_moved','原升级条件已满足；应先承认条件成立，不能无新增负面证据继续提高门槛。');
    const explainedExtension=expectedState==='entry_extended'&&entry.state==='entry_extended'&&entry.transitionReason.trim();
    if(satisfied&&!newNegative&&entry.pendingConditions.length&&!explainedExtension)warn('entry_new_requirement','原升级条件已满足，但仍列出待确认条件；新增要求必须说明新增负面证据或结构变化。');
    if(entry.state==='entry_ready'&&(!confirmed||negative||entry.position!=='acceptable'||entry.pendingConditions.length))warn('entry_ready_conflict','建仓条件已满足与所列方向、确认事件、位置或风险证据不一致。');
    if(entry.state==='entry_ready'&&[current.userDecision?.headline,current.userDecision?.addAssessment?.summary,current.actionAssessment.headline].some(s=>/^(?:当前|仍需|还需)?(?:继续等待|等待进一步确认|再等一次回踩)/.test(s||'')))warn('entry_ready_wording_conflict','状态为建仓条件已满足，但结论仍要求等待确认，请核对原判断。');
    if(entry.state==='setup_failed'&&!negative)warn('entry_failure_unsupported','结构失败缺少明确负面证据；涨幅大或位置延伸不能单独否决建仓。');
    if(entry.state==='entry_extended'&&entry.position!=='extended')warn('entry_extension_unsupported','位置延伸状态需要说明当前位置已明显偏离合理结构。');
    if(priorEntry?.state==='entry_ready'&&['wait_setup','setup_forming','setup_failed'].includes(entry.state)&&!newNegative)warn('entry_downgrade_unexplained','从建仓条件已满足降级，需要说明新增的实质负面证据。');
    if(priorEntry&&priorEntry.path!==entry.path&&!entry.transitionReason.trim())warn('entry_path_change_unexplained','建仓路径已迁移，请说明新增事实及当前主要路径。');
    if(entry.position==='extended'&&!negative&&(entry.state==='setup_failed'||current.userDecision?.addAssessment?.status==='avoid'))warn('entry_extension_not_failure','位置延伸只能降低位置优势，不能单独推导结构失败或回避。');
    const categories={wait_setup:['no_action','wait_confirmation'],setup_forming:['wait_confirmation'],entry_ready:['entry_review'],entry_extended:['wait_confirmation','entry_review'],setup_failed:['no_action']};
    const directions={wait_setup:['not_applicable','add_watch'],setup_forming:['add_review'],entry_ready:['add_review'],entry_extended:['add_watch','add_review'],setup_failed:['not_applicable','add_watch']};
    if(!categories[entry.state].includes(current.actionAssessment.category)||current.userDecision&&!directions[entry.state].includes(current.userDecision.positionDirection.status)||entry.state==='entry_ready'&&current.userDecision?.addAssessment?.status!=='add_review')warn('entry_mapping_conflict','建仓状态与操作复核或仓位方向不一致，请核对 AI 结论。');
    if(current.userDecision&&Object.entries({holding:'当前无持仓。',takeProfit:'当前无持仓，不适用。',stopLoss:'尚未持有，无需处理。'}).some(([key,summary])=>current.userDecision[key]?.status!=='not_applicable'||current.userDecision[key]?.summary!==summary))warn('entry_zero_position_contract','零持仓的持仓、止盈和止损区块应保持不适用，请核对 AI 原文。');
    return {applicable:true,expectedState,diagnostics};
  }
  function rules(context){
    if(context?.currentFacts?.holding?.shares!==0)return '';
    const previous=context.currentState?.holdingShares===0?context.currentState:null;
    return [
      'ENTRY_DECISION_PATH_ENGINE_V1：仅当前 canonical holding.shares === 0 适用。建仓判断由 AI 负责，程序不依据价格自动推断、改 Plan 或修改持仓。',
      '本轮零持仓讨论应输出 actionAssessment.entryDecision（schema 可选仅为兼容旧 JSON）。结构含 state、path、directionConfirmed（布尔）、confirmationSatisfied（布尔）、position、completedConditions、pendingConditions、negativeEvidence、previousConditions、transitionReason。',
      'state：wait_setup 尚未形成；setup_forming 正在形成；entry_ready 预定义条件已满足；entry_extended 逻辑仍成立但位置明显延伸、本轮有利窗口可能错过；setup_failed 结构明确破坏。',
      'path：pullback_confirmation 回落→稳定承接→不再恶化→重新转强；breakout_confirmation 突破关键压力→稳定保持→未快速跌回且短周期强势；platform_breakout 首次上涨后高位平台波动收敛、承接稳定、结构修复→再次突破；none 无明确路径。三条平行路径，不得要求所有股票必须回踩。',
      '路径可依据新增事实迁移：pullback_confirmation → breakout_confirmation；breakout_confirmation → platform_breakout，也可按新证据选择其他路径。transitionReason 说明变化及证据，路径不永久绑定。',
      '方向成立、路径核心事件发生、位置可接受、没有明确否决证据：必须升级 entry_ready，不得因为还可以更完美继续等待。突破快速跌回用 setup_forming 或 setup_failed；逻辑仍成立而价格脱离合理位置用 entry_extended。',
      'position 为 acceptable/extended/unclear。position_extended 不等于 structure_weakening、breakout_failure、momentum_exhaustion。仅涨幅大不能自动 setup_failed 或 avoid。entry_ready 降为 setup_forming 必须新增负面证据；结构明确破坏才用 setup_failed。',
      'Previous upgrade conditions are commitments for evaluation. If an explicitly stated upgrade condition becomes satisfied, the next discussion must acknowledge that satisfaction before adding any new requirement. New requirements may only be introduced when supported by new negative evidence or a clearly changed market structure.',
      'previousConditions 按上一轮 upgradeConditions 原文逐项填写 condition、status（satisfied/pending/invalidated/unknown）、evidence（具体新增证据或证据不足说明）。满足任意一条完整合法路径即可，不能把平行路径当作必须全部满足。旧数据无 entryDecision 也必须核对旧 upgradeConditions。先承认满足，再解释变化；不得任意再等一天、再等回踩、再等更高价或第二次确认。',
      'condition 必须逐字复制上一轮 upgradeConditions 的完整数组项，包括标点、价格及复合条件；不得缩写、改写、拆分或合并。上一轮有 N 条，就按原顺序核对 N 条。复合条件的各部分进度写在 evidence 中；条件含位置要求而当前位置已延伸时，应承认突破部分已满足并说明位置变化，不改写旧条件。只是改走其他已确认路径、原路径尚未触发时用 pending 并解释路径替代，不把未发生当成结构失败。',
      'negativeEvidence 最多5项，每项 type 为 structure_weakening/breakout_failure/support_failure/short_term_weakening/momentum_exhaustion/structure_invalidated/other，detail 说明证据，isNew 布尔表示相对上一轮是否新增。结构变更必须说明原条件为何不再适用。completedConditions/pendingConditions 最多5条；previousConditions 最多3项；各正文最多200字，transitionReason 可为空，其余正文非空。证据未知不能编造成已满足。',
      'negativeEvidence 只记录已经发生、实质否定建仓条件的证据；单纯涨幅较大、位置偏高及“如果以后跌破”的假设风险放在 userDecision.warning / risks，不得放进 negativeEvidence.other。没有实际否决证据时 negativeEvidence=[]。方向、核心事件和位置满足时，不因一般风险提示否定 entry_ready。',
      '零持仓以下三个区块必须原样复制，summary 不得追加说明或改写；未来建仓后的条件性风险写在 warning 或 risks。固定输出：holding={status:"not_applicable",summary:"当前无持仓。"}；takeProfit={status:"not_applicable",summary:"当前无持仓，不适用。"}；stopLoss={status:"not_applicable",summary:"尚未持有，无需处理。"}。',
      '映射：wait_setup → positionDirection not_applicable/add_watch，category no_action/wait_confirmation；setup_forming → add_review，wait_confirmation；entry_ready → add_review，entry_review，addAssessment.status=add_review，headline/summary 明确“建仓条件已经满足”，pendingConditions 应为空；entry_extended → add_watch/add_review，wait_confirmation/entry_review（仍有有效窗口才用 entry_review）；setup_failed → not_applicable/add_watch，no_action。addAssessment 保持已有 wait/watch/add_review/avoid/not_applicable 枚举。',
      '既有 Plan、Plan validity、Runtime 是程序事实；当前路径及判断价位是 AI JUDGMENT，不得写回 Plan，也不把旧 Plan 当成唯一合法建仓条件。',
      `上一轮判断（只作承诺核对；以当前 canonical 持仓为准）：${JSON.stringify(previous?{entryDecision:previous.actionAssessment?.entryDecision||null,upgradeConditions:previous.actionAssessment?.upgradeConditions||[]}:null)}`
    ].join('\n');
  }
  function render(current,shares,escape){
    const entry=current?.actionAssessment?.entryDecision;
    if(shares!==0||!entry||!validate(entry).ok)return '';
    const rows=(label,items)=>items.length?`<div><b>${label}：</b><ul>${items.map(s=>`<li>${escape(s)}</li>`).join('')}</ul></div>`:'';
    return `<section class="discussion-entry-decision" style="padding:12px;border:1px solid var(--teal,#1f5c5b);border-radius:8px;overflow-wrap:anywhere" aria-label="当前建仓判断"><b>当前建仓状态：${escape(STATES[entry.state])}</b><div>当前路径：${escape(PATHS[entry.path])} · AI 判断</div>${entry.state==='entry_ready'?'<p>当前已经满足首次建仓复核条件。</p>':''}${rows('已完成',entry.completedConditions)}${rows('尚待确认',entry.pendingConditions)}${entry.transitionReason?`<div>路径变化：${escape(entry.transitionReason)}</div>`:''}</section>`;
  }
  return Object.freeze({STATES,PATHS,validate,example,evaluate,rules,render});
});
