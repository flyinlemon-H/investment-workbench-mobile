// The original workspace renderers remain callable under their existing keys.
const PRIMARY_WORKSPACE_META=Object.freeze([{key:'ai',label:'当前判断'},{key:'plan',label:'计划'},{key:'research',label:'研究资料'},{key:'history',label:'历史'}]);
const RESEARCH_WORKSPACE_KEYS=Object.freeze(['technical','news','fundamental','valuation','longterm']);
function workspacePrimaryKey(key){return RESEARCH_WORKSPACE_KEYS.includes(key)?'research':key==='operation'?'history':key}
function researchWorkspacePanel(stock,active){
  const nav=`<nav class="research-navigation" aria-label="研究资料分类">${DETAIL_WORKSPACE_META.filter(item=>RESEARCH_WORKSPACE_KEYS.includes(item.key)).map(item=>`<button class="btn ghost small" data-workspace="${item.key}" aria-pressed="${active===item.key}" type="button">${esc(item.label)}</button>`).join('')}</nav>`;
  return `${nav}${RESEARCH_WORKSPACE_KEYS.includes(active)?activeWorkspacePanel(stock,active):'<div class="card"><div class="card-title">按需查看研究资料</div><p class="text">技术面、新闻、基本面、估值和长期逻辑为当前讨论提供依据。选择需要查看或更新的资料。</p></div>'}`;
}
function stockHistoryWorkspacePanel(stock,active){
  const status=discussionStatusPresentation(stock);
  return `${discussionHistoryPanel(stock,status)}${workspaceDetails('相关计划历史',v13PlanCenterHistory(stock))}${workspaceDetails('用户操作记录',stockExecutionRows(stock.name))}${workspaceDetails('既有 AI 处理历史',v13AiDecisionReviewDetailPanel(stock)||'<div class="empty">暂无记录</div>')}<details class="card"${active==='operation'?' open':''}><summary>录入实际操作结果</summary>${operationWorkspacePanel(stock)}</details>`;
}
function stockWorkspaceTabs(stock){
  const active=normalizeDetailWorkspace(detailWorkspace),primary=workspacePrimaryKey(active),anchor=`workspace-${active}`;
  const tabs=PRIMARY_WORKSPACE_META.map(item=>`<button class="workspace-tab${item.key===primary?' active':''}" id="workspace-tab-${item.key}" role="tab" type="button" data-workspace-tab="${item.key}" aria-selected="${item.key===primary}" aria-controls="workspace-panel" tabindex="${item.key===primary?'0':'-1'}">${item.label}</button>`).join('');
  const body=primary==='research'?researchWorkspacePanel(stock,active):primary==='history'?stockHistoryWorkspacePanel(stock,active):activeWorkspacePanel(stock,active);
  return `<div class="workspace-tabs-shell"><div class="workspace-tablist" role="tablist" aria-label="标的工作区">${tabs}</div><section class="workspace-tabpanel" id="workspace-panel" role="tabpanel" aria-labelledby="workspace-tab-${primary}" data-workspace-section="${esc(active)}" data-v13-detail-anchor="${esc(anchor)}">${v13TargetReviewReturnBanner(stock,anchor)}${discussionReturnBanner(stock,active)}${body}</section></div>`;
}
