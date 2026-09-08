// Discussion-Centric UI Simplification V1A: presentation only; no persisted contracts.
let targetFilter='core';
let targetSearch='';
let comparisonSearch='';
let comparisonRisk='';
const maintenanceControlIds=['fxBtn','batchTechnicalReviewBtn','importBtn','exportBtn','socialImportBtn','resetBtn','refreshAllBtn','addBtn','planReviewBatchBtn','analysisFetchBtn','pcSyncControl','syncHint','socialDataStatus','multiStockAnalysisQuickBtn','multiStockAnalysisBtn'];
function primaryTabFor(tab){return ['holding','etf','watching','targets'].includes(tab)?'targets':['tools','analysis','edit','more'].includes(tab)?'more':tab}
function navigateWorkbench(tab){if(tab==='targets'){targetFilter='core';targetSearch=''}detailStockId=null;detailSubView='';currentTab=tab;render()}
function initializeWorkbenchNavigation(){
  const tabs=document.querySelector('.tabs');
  tabs.querySelectorAll('[data-tab]').forEach(button=>{button.hidden=true;button.dataset.uiDisposition='hide'});
  [['dashboard','今日'],['targets','标的'],['plans','计划'],['logs','记录'],['more','更多']].forEach(([key,label])=>{
    let button=tabs.querySelector(`[data-tab="${key}"]`);
    if(!button){button=document.createElement('button');button.className='tab';button.dataset.tab=key;tabs.appendChild(button)}
    tabs.appendChild(button);button.textContent=label;button.hidden=false;button.dataset.uiDisposition='keep_primary';
  });
  // Keep existing count nodes and all legacy navigation handlers available.
  for(const id of ['countHolding','countEtf','countWatching'])if(!document.getElementById(id)){const span=document.createElement('span');span.id=id;span.hidden=true;tabs.appendChild(span)}
  const parking=document.createElement('div');parking.id='maintenanceControlParking';parking.hidden=true;document.body.appendChild(parking);
  parkMaintenanceControls();
}
function parkMaintenanceControls(){
  const parking=document.getElementById('maintenanceControlParking');if(!parking)return;
  maintenanceControlIds.forEach(id=>{const node=document.getElementById(id);if(node)parking.appendChild(node)});
  const cloud=document.querySelector('.universe-cloud-bar');if(cloud)parking.appendChild(cloud);
}
function mountMaintenanceControl(id,mount){const node=document.getElementById(id),target=document.getElementById(mount);if(node&&target)target.appendChild(node)}
function targetMatches(stock,filter){return ManagementCategory.matches(stock,filter)}
function targetSummaryCard(stock,planMode=false){
  const status=discussionStatusPresentation(stock),current=status.current,plans=v13DisplayActivePlans(stock.plans);
  return `<article class="card target-card"><button class="link-btn detail-name" data-target-stock="${esc(stock.id)}" type="button">${esc(stock.name||stock.code)}</button><div class="card-note">${esc(stock.code)} · ${Number(stock.shares)>0?'持仓':'无持仓'}${stock.type==='etf'?' · ETF':''}</div><p class="text">${esc(planMode?`${plans.length} 条当前计划`:current?.userDecision?.headline||current?.actionAssessment?.headline||current?.summary||'尚无讨论结论')}</p><div class="card-note">${esc(status.label)} · ${plans.length} 条当前计划</div><button class="btn ghost small" data-target-stock="${esc(stock.id)}" type="button">${planMode?'查看计划与运行状态':'进入当前判断'}</button>${planMode?'':` <button class="btn ghost small" data-target-edit="${esc(stock.id)}" type="button">编辑标的</button>`}</article>`;
}
function renderTargets(planMode=false){
  targetFilter=ManagementCategory.session(targetFilter);
  const unassigned=ManagementCategory.pending(state.stocks).length;
  const rows=state.stocks.filter(stock=>(planMode||targetMatches(stock,targetFilter))&&`${stock.name} ${stock.code}`.toLowerCase().includes(targetSearch.toLowerCase()));
  document.getElementById('summary').textContent=planMode?'计划中心':'标的';
  document.getElementById('main').innerHTML=`<div class="toolbar"><label class="target-search">搜索标的<input id="targetSearch" type="search" value="${esc(targetSearch)}" placeholder="名称或代码"></label>${planMode?'<button class="btn ghost small" id="openPlanReview" type="button">计划批量复核</button>':'<button class="btn ghost small" id="targetAdd" type="button">新增标的</button>'}</div>${planMode?'<p class="card-note">查看正式计划、状态观察与运行状态，按需进行复核。</p>':`<div class="target-filters" aria-label="标的筛选">${Object.entries(ManagementCategory.labels).map(([key,label])=>`<button class="btn ghost small" data-target-filter="${key}" aria-pressed="${targetFilter===key}" type="button">${label}</button>`).join('')}</div>`}${!planMode&&unassigned?`<div class="card category-maintenance"><span>有 ${unassigned} 个历史标的尚未完成管理分类</span> <button class="btn ghost small" id="targetAssign" type="button">整理分类</button></div>`:''}<div class="target-grid">${rows.map(stock=>targetSummaryCard(stock,planMode)).join('')||(planMode?'<div class="empty">暂无匹配标的</div>':'<div class="empty">当前分类中没有匹配标的。</div>')}</div>`;
  document.getElementById('targetSearch').addEventListener('input',event=>{targetSearch=event.target.value;const start=event.target.selectionStart;renderTargets(planMode);const input=document.getElementById('targetSearch');input.focus();try{input.setSelectionRange(start,start)}catch(_){}});
  document.querySelectorAll('[data-target-filter]').forEach(button=>button.onclick=()=>{targetFilter=button.dataset.targetFilter;renderTargets()});
  document.querySelectorAll('[data-target-stock]').forEach(button=>button.onclick=()=>openStockDetail(button.dataset.targetStock,planMode?'plan':'ai'));
  document.querySelectorAll('[data-target-edit]').forEach(button=>button.onclick=()=>openModal(button.dataset.targetEdit));
  document.getElementById('targetAssign')?.addEventListener('click',openCategoryAssignment);
  document.getElementById('targetAdd')?.addEventListener('click',()=>openModal(null));
  document.getElementById('openPlanReview')?.addEventListener('click',()=>window.PlanReviewUI?.open());
}
function renderMore(){
  document.getElementById('summary').textContent='更多';
  document.getElementById('main').innerHTML=`<div class="more-list"><button class="card more-entry" data-more-page="analysis" type="button"><strong>分析总览</strong><span>高级比较 · 当前判断、计划与资料状态</span></button><button class="card more-entry" id="morePortfolio" type="button"><strong>组合比较</strong><span>多标的复核与配置分析</span></button><button class="card more-entry" data-more-page="tools" type="button"><strong>工具</strong><span>行情与数据、同步、账户、维护</span></button><button class="card more-entry" id="moreBackup" type="button"><strong>备份与恢复</strong><span>导出备份或恢复已有数据</span></button><button class="card more-entry" data-more-page="edit" type="button"><strong>标的维护</strong><span>基础信息与策略设置</span></button></div>`;
  document.querySelectorAll('[data-more-page]').forEach(button=>button.onclick=()=>navigateWorkbench(button.dataset.morePage));
  document.getElementById('morePortfolio').onclick=()=>window.PortfolioReviewUI?.open();
  document.getElementById('moreBackup').onclick=()=>{navigateWorkbench('tools');const section=document.getElementById('backupRecoverySection');section.open=true;section.scrollIntoView({block:'start'})};
}
function renderSimplifiedTools(){
  document.getElementById('summary').textContent='工具';
  const section=(id,title,body)=>`<details class="card tool-section" id="${id}"><summary>${title}</summary>${body}</details>`;
  document.getElementById('main').innerHTML=`<button class="link-btn" onclick="navigateWorkbench('more')" type="button">返回更多</button>${section('marketToolsSection','行情与数据','<div class="actions" id="marketToolsMount"></div>')}${section('syncToolsSection','同步','<div id="syncToolsMount"></div>')}${section('backupRecoverySection','备份与恢复','<div class="actions" id="backupToolsMount"></div>')}${section('accountToolsSection','账户','<button class="btn ghost small" onclick="openUniverseSyncSettings()" type="button">账户与同步设置</button>')}${section('storageMaintenanceSection','高级维护','<div class="actions" id="advancedToolsMount"></div><details id="storageAdvancedDetails"><summary>高级存储信息</summary><div id="storageMaintenancePanelMount"></div></details><details><summary>系统连接状态</summary><div id="backendToolStatus" class="card-note"></div><div id="diagnosticToolsMount"></div></details><details><summary>关于</summary><div class="card-note">投资工作台 · '+esc(window.APP_ASSET_VERSION||'')+'</div></details>')}${section('dangerToolsSection','危险操作','<p class="card-note">清空前请先导出备份。</p><div class="actions" id="dangerToolsMount"></div>')}`;
  ['fxBtn','refreshAllBtn','batchTechnicalReviewBtn','socialImportBtn','multiStockAnalysisBtn'].forEach(id=>mountMaintenanceControl(id,'marketToolsMount'));
  ['importBtn','exportBtn'].forEach(id=>mountMaintenanceControl(id,'backupToolsMount'));
  document.getElementById('importBtn').textContent='从 JSON 恢复';document.getElementById('exportBtn').textContent='导出备份';
  mountMaintenanceControl('analysisFetchBtn','syncToolsMount');
  const cloud=document.querySelector('.universe-cloud-bar');if(cloud){document.getElementById('syncToolsMount').appendChild(cloud);cloud.style.display=''}
  ['pcSyncControl','syncHint','socialDataStatus'].forEach(id=>mountMaintenanceControl(id,'diagnosticToolsMount'));
  mountMaintenanceControl('addBtn','advancedToolsMount');mountMaintenanceControl('resetBtn','dangerToolsMount');
  renderSyncHint();renderPcSyncStatus();
}
function renderAnalysisOverview(){
  const rows=state.stocks.filter(stock=>`${stock.name} ${stock.code}`.toLowerCase().includes(comparisonSearch.toLowerCase())).map(stock=>{
    const status=discussionStatusPresentation(stock),decision=status.current?.userDecision;
    const readiness=window.DiscussionWorkbench.buildContext(stock,discussionOptions()).context.dataReadiness;
    const risk=status.label==='当前'?(decision?.warning?.summary||'尚无风险判断'):status.label;
    return {stock,status,decision,readiness,risk};
  }).filter(row=>!comparisonRisk||(comparisonRisk==='review'?row.status.label!=='当前':row.status.label==='当前'&&row.decision?.riskSource&&row.decision.riskSource!=='none'));
  document.getElementById('summary').textContent=`分析总览 · 高级比较 · ${rows.length} 只`;
  document.getElementById('main').innerHTML=`<button class="link-btn" onclick="navigateWorkbench('more')" type="button">返回更多</button><div class="comparison-filters"><label>搜索<input id="comparisonSearch" type="search" value="${esc(comparisonSearch)}" placeholder="名称或代码"></label><label>风险<select id="comparisonRisk"><option value="">全部</option><option value="risk"${comparisonRisk==='risk'?' selected':''}>当前有风险来源</option><option value="review"${comparisonRisk==='review'?' selected':''}>判断待建立或复核</option></select></label></div><div class="table-wrap comparison-table"><table><thead><tr><th>标的</th><th>风险</th><th>当前结论</th><th>Plan 状态</th><th>资料状态</th><th>下一步</th></tr></thead><tbody>${rows.map(({stock,status,decision,readiness,risk})=>`<tr><td data-label="标的"><button class="link-btn" data-comparison-stock="${esc(stock.id)}" type="button">${esc(stock.name)}<br>${esc(stock.code)}</button></td><td data-label="风险">${esc(risk)}</td><td data-label="当前结论">${esc(decision?.headline||status.current?.actionAssessment?.headline||status.current?.summary||'尚无讨论结论')}<div class="card-note">${esc(status.label)}</div></td><td data-label="Plan 状态">${v13DisplayActivePlans(stock.plans).length} 条当前计划</td><td data-label="资料状态">${esc(readiness?.technical?.label||'待检查')}<div class="card-note">其他资料按讨论需要补充</div></td><td data-label="下一步"><button class="btn ghost small" data-comparison-stock="${esc(stock.id)}" type="button">进入当前判断</button></td></tr>`).join('')||'<tr><td colspan="6">暂无匹配标的</td></tr>'}</tbody></table></div><details class="card" id="advancedComparisonDetails"><summary>更多筛选与列</summary><div class="card-note">旧评分与细分指标用于高级比较。</div><div id="advancedComparisonMount"></div></details>`;
  document.getElementById('comparisonSearch').oninput=event=>{comparisonSearch=event.target.value;renderAnalysisOverview();document.getElementById('comparisonSearch').focus()};
  document.getElementById('comparisonRisk').onchange=event=>{comparisonRisk=event.target.value;renderAnalysisOverview()};
  document.querySelectorAll('[data-comparison-stock]').forEach(button=>button.onclick=()=>openStockDetail(button.dataset.comparisonStock));
  document.getElementById('advancedComparisonDetails').addEventListener('toggle',event=>{if(event.target.open&&!document.getElementById('advancedComparisonMount').hasChildNodes())renderAdvancedAnalysisOverview('advancedComparisonMount')});
}
