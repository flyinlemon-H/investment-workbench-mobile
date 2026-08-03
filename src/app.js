function ensureExecutionLogTab(){
  const tabs=document.querySelector('.tabs');
  if(!tabs||tabs.querySelector('[data-tab="logs"]'))return;
  const btn=document.createElement('button');
  btn.className='tab';
  btn.dataset.tab='logs';
  btn.textContent='操作记录';
  tabs.appendChild(btn);
}
function ensureAnalysisOverviewTab(){
  const tabs=document.querySelector('.tabs');
  if(!tabs||tabs.querySelector('[data-tab="analysis"]'))return;
  const btn=document.createElement('button');
  btn.className='tab';
  btn.dataset.tab='analysis';
  btn.textContent='分析总览';
  tabs.appendChild(btn);
}

function ensureEditCenterTab(){
  const tabs=document.querySelector('.tabs');
  if(!tabs||tabs.querySelector('[data-tab="edit"]'))return;
  const btn=document.createElement('button');
  btn.className='tab';
  btn.dataset.tab='edit';
  btn.textContent='编辑';
  tabs.appendChild(btn);
}

function ensureToolsTab(){
  const tabs=document.querySelector('.tabs');
  if(!tabs||tabs.querySelector('[data-tab="tools"]'))return;
  const btn=document.createElement('button');
  btn.className='tab';
  btn.dataset.tab='tools';
  btn.textContent='工具';
  tabs.appendChild(btn);
}

const backendHealthState={status:'unknown',checkedAt:'',environment:'',errorType:''};
async function checkBackendHealth(){
  backendHealthState.status='checking';
  if(typeof renderSyncHint==='function')renderSyncHint();
  try{
    if(!window.InvestmentApi||!window.InvestmentApi.health){
      const errors=window.InvestmentApi&&window.InvestmentApi.errors;
      throw errors&&typeof errors.create==='function'?errors.create('configuration_error','Health API is unavailable.'):{type:'configuration_error'};
    }
    const result=await window.InvestmentApi.health.check();
    backendHealthState.status='available';
    backendHealthState.environment=result.environment;
    backendHealthState.errorType='';
  }catch(error){
    const normalized=window.InvestmentApi&&window.InvestmentApi.errors?window.InvestmentApi.errors.normalize(error):{type:'unknown_error'};
    backendHealthState.status=normalized.type==='configuration_error'?'unconfigured':'unavailable';
    backendHealthState.environment='';
    backendHealthState.errorType=normalized.type;
  }finally{
    backendHealthState.checkedAt=new Date().toISOString();
    if(typeof renderSyncHint==='function')renderSyncHint();
  }
  return backendHealthState.status;
}
window.BackendHealth=Object.freeze({state:backendHealthState,check:checkBackendHealth});

ensureAnalysisOverviewTab();
ensureExecutionLogTab();
ensureEditCenterTab();
ensureToolsTab();
document.querySelectorAll('.tab').forEach(t=>t.addEventListener('click',()=>{detailStockId=null;detailSubView='';currentTab=t.dataset.tab;render()}));
document.getElementById('addBtn').addEventListener('click',()=>openModal(null));
document.getElementById('importBtn').addEventListener('click',importData);
document.getElementById('exportBtn').addEventListener('click',exportData);
document.getElementById('socialImportBtn').addEventListener('click',importSocialData);
document.getElementById('socialImportFile').addEventListener('change',handleSocialImport);
document.getElementById('resetBtn').addEventListener('click',resetSeed);
document.getElementById('refreshAllBtn').addEventListener('click',refreshAllPrices);
document.getElementById('fxBtn').addEventListener('click',onFxClick);
document.getElementById('importFile').addEventListener('change',handleImport);
document.getElementById('cancelBtn').addEventListener('click',closeModal);
document.getElementById('saveBtn').addEventListener('click',save);
document.getElementById('testCodeBtn').addEventListener('click',testQuoteCode);
document.getElementById('addBuy').addEventListener('click',()=>addPlan('buy'));
document.getElementById('addSell').addEventListener('click',()=>addPlan('sell'));
document.querySelectorAll('#typeToggle button').forEach(b=>b.addEventListener('click',()=>setType(b.dataset.type)));
document.getElementById('modal').addEventListener('click',e=>{if(e.target.id==='modal')closeModal()});
document.addEventListener('keydown',e=>{if(e.key==='Escape'){closeModal();if(typeof closeV13EventDetailModal==='function')closeV13EventDetailModal();if(typeof closeAnalysisModal==='function')closeAnalysisModal();if(typeof closeAiAnalysisPromptModal==='function')closeAiAnalysisPromptModal();if(typeof closeAiAnalysisImportModal==='function')closeAiAnalysisImportModal();if(typeof closeAiAssistantModal==='function')closeAiAssistantModal();if(typeof closeAnalysisInputsModal==='function')closeAnalysisInputsModal();if(typeof closeFinancialSourceModal==='function')closeFinancialSourceModal();if(typeof closeValuationSourceModal==='function')closeValuationSourceModal();if(typeof closeAnalysisTemplateModal==='function')closeAnalysisTemplateModal();if(typeof closeStrategyModal==='function')closeStrategyModal();if(typeof closeTechnicalDataModal==='function')closeTechnicalDataModal();if(typeof closeValuationDataModal==='function')closeValuationDataModal();if(typeof closeValuationImportModal==='function')closeValuationImportModal();if(typeof closeFinancialDataModal==='function')closeFinancialDataModal();if(typeof closeFinancialImportModal==='function')closeFinancialImportModal();if(typeof closeFundamentalImportModal==='function')closeFundamentalImportModal();if(typeof closeEtfAnalysisImportModal==='function')closeEtfAnalysisImportModal()}});
function showStorageLoadingShell(){
  const main=document.getElementById('main');
  if(main){main.dataset.storageState='loading';main.textContent='正在加载本地数据…'}
}
function showStorageInitializationError(error){
  const main=document.getElementById('main');
  const type=error&&typeof error.type==='string'?error.type:'unknown_storage_error';
  if(main){
    main.dataset.storageState='error';
    main.textContent=`本地数据加载失败（${type}）。未重置或清除任何数据。`;
  }
}
function migrationStatusText(record){
  const status=record&&record.status||'not_started';
  if(status==='copying')return '正在安全复制旧本地数据。当前数据源：localStorage。';
  if(status==='validating')return '正在校验 IndexedDB staging。当前数据源：localStorage。';
  if(status==='ready')return '已完成安全复制与校验，但尚未切换存储。当前数据源：localStorage。';
  if(status==='failed')return '安全复制或校验失败，旧 localStorage 数据仍在使用。';
  const detected=Boolean(record&&record.sourceKeysPresent&&record.sourceKeysPresent.length);
  return detected?'检测到旧数据，可以开始 Shadow Verification。当前数据源：localStorage。':'未检测到可供 Shadow Verification 的旧数据。当前数据源：localStorage。';
}
const shadowMigrationUiState={backupConfirmed:false,preflight:null,capacity:null,record:null};
function formatStorageBytes(value){
  const bytes=Number(value);
  if(!Number.isFinite(bytes)||bytes<0)return '不可用';
  if(bytes<1024)return `${Math.round(bytes)} B`;
  if(bytes<1024*1024)return `${(bytes/1024).toFixed(1)} KiB`;
  return `${(bytes/(1024*1024)).toFixed(2)} MiB`;
}
function truncatedChecksum(value){return typeof value==='string'?value.slice(0,10):''}
function evaluateShadowCapacity(preflight,estimate){
  const required=Number(preflight&&preflight.requiredAvailableBytes)||0;
  if(!estimate||estimate.usage===null||estimate.usage===undefined||estimate.quota===null||estimate.quota===undefined){
    return Object.freeze({available:false,usage:null,quota:null,free:null,required,sufficient:false});
  }
  const usage=Number(estimate&&estimate.usage);
  const quota=Number(estimate&&estimate.quota);
  if(!Number.isFinite(usage)||!Number.isFinite(quota)||usage<0||quota<usage){
    return Object.freeze({available:false,usage:null,quota:null,free:null,required,sufficient:false});
  }
  const free=quota-usage;
  return Object.freeze({available:true,usage,quota,free,required,sufficient:free>=required});
}
function canStartShadowMigration(backupConfirmed,capacity,record){
  return Boolean(backupConfirmed&&capacity&&capacity.sufficient&&record&&record.status!=='ready'&&record.sourceKeysPresent&&record.sourceKeysPresent.length);
}
async function readShadowStorageCapacity(preflight){
  if(!navigator.storage||typeof navigator.storage.estimate!=='function')return evaluateShadowCapacity(preflight,null);
  try{return evaluateShadowCapacity(preflight,await navigator.storage.estimate())}
  catch(_error){return evaluateShadowCapacity(preflight,null)}
}
function shadowPreflightText(preflight,capacity){
  if(!preflight)return '正在检查本地存储容量和数据摘要…';
  const lines=[
    '当前数据源：localStorage',
    `主 state 原始大小：${formatStorageBytes(preflight.mainStateBytes)}`,
    `标的数量：${Number(preflight.stocksCount)||0}`,
    `计划草稿：${Number(preflight.planDraftsCount)||0}`,
    `操作草稿：${Number(preflight.operationDraftsCount)||0}`,
    `Source checksum 摘要：${truncatedChecksum(preflight.sourceChecksumPrefix)||'—'}`,
    `预计 staging：${formatStorageBytes(preflight.estimatedStagingBytes)}`,
    `安全余量：${formatStorageBytes(preflight.safetyMarginBytes)}`
  ];
  if(capacity&&capacity.available){
    lines.push(`浏览器使用量：${formatStorageBytes(capacity.usage)}`);
    lines.push(`浏览器配额：${formatStorageBytes(capacity.quota)}`);
    lines.push(`预计可用：${formatStorageBytes(capacity.free)}`);
    lines.push(capacity.sufficient?'容量门禁：通过':'容量门禁：空间不足，禁止开始');
  }else lines.push('容量信息不可用，禁止开始验证');
  lines.push('本操作不会上传网络、不会切换存储、不会删除原数据。');
  return lines.join('\n');
}
function shadowReadyText(record){
  const summary=record&&record.validationSummary||{};
  const drafts=(Number(summary.planDraftsCount)||0)+(Number(summary.operationDraftsCount)||0);
  return [
    '状态：安全复制与校验完成',
    '当前数据源：仍为 localStorage',
    'staging 状态：ready',
    `校验时间：${record&&record.validatedAt||'—'}`,
    `标的数量：${Number(summary.stocksCount)||0}`,
    `草稿数量：${drafts}`,
    `Semantic checksum 摘要：${truncatedChecksum(record&&record.semanticChecksum)||'—'}`,
    '尚未切换存储。请勿删除旧本地数据。'
  ].join('\n');
}
function ensureShadowMigrationPanel(){
  let panel=document.getElementById('shadowMigrationPanel');
  if(panel)return panel;
  const main=document.getElementById('main');
  if(!main||!main.parentNode||typeof main.parentNode.insertBefore!=='function')return null;
  panel=document.createElement('section');
  panel.id='shadowMigrationPanel';
  panel.className='card';
  const guidance=document.createElement('div');
  guidance.id='shadowMigrationGuidance';
  guidance.textContent='建议先导出 JSON 备份，再进行本地存储升级验证。请使用普通 Safari / Chrome；不要使用私密浏览或 Lockdown Mode；验证过程中不要关闭页面，完成后普通刷新一次。';
  const status=document.createElement('div');
  status.id='shadowMigrationStatus';
  const summary=document.createElement('pre');
  summary.id='shadowMigrationSummary';
  summary.style.whiteSpace='pre-wrap';
  const exportButton=document.createElement('button');
  exportButton.id='shadowMigrationExportBtn';
  exportButton.type='button';
  exportButton.className='btn ghost';
  exportButton.textContent='导出 JSON';
  const backupLabel=document.createElement('label');
  const backupCheckbox=document.createElement('input');
  backupCheckbox.id='shadowMigrationBackupConfirmed';
  backupCheckbox.type='checkbox';
  backupLabel.appendChild(backupCheckbox);
  const backupText=document.createElement('span');
  backupText.textContent=' 我已完成 JSON 备份';
  backupLabel.appendChild(backupText);
  const button=document.createElement('button');
  button.id='shadowMigrationBtn';
  button.type='button';
  button.className='btn ghost';
  button.textContent='开始安全复制验证';
  const cancelButton=document.createElement('button');
  cancelButton.id='shadowMigrationCancelBtn';
  cancelButton.type='button';
  cancelButton.className='btn ghost';
  cancelButton.textContent='取消';
  const clearButton=document.createElement('button');
  clearButton.id='shadowMigrationClearBtn';
  clearButton.type='button';
  clearButton.className='btn ghost';
  clearButton.textContent='清理验证副本';
  panel.appendChild(guidance);
  panel.appendChild(status);
  panel.appendChild(summary);
  panel.appendChild(exportButton);
  panel.appendChild(backupLabel);
  panel.appendChild(button);
  panel.appendChild(cancelButton);
  panel.appendChild(clearButton);
  main.parentNode.insertBefore(panel,main);
  exportButton.addEventListener('click',()=>{if(typeof exportShadowVerificationBackup==='function')exportShadowVerificationBackup()});
  backupCheckbox.addEventListener('change',()=>{shadowMigrationUiState.backupConfirmed=backupCheckbox.checked===true;updateShadowMigrationPanel(shadowMigrationUiState.record)});
  cancelButton.addEventListener('click',()=>{shadowMigrationUiState.backupConfirmed=false;backupCheckbox.checked=false;updateShadowMigrationPanel(shadowMigrationUiState.record)});
  button.addEventListener('click',async()=>{
    await refreshShadowMigrationPreflight();
    if(!canStartShadowMigration(shadowMigrationUiState.backupConfirmed,shadowMigrationUiState.capacity,shadowMigrationUiState.record))return;
    button.disabled=true;
    try{
      const result=await StorageManager.runShadowMigration({onStatus:updateShadowMigrationPanel});
      updateShadowMigrationPanel(result);
    }catch(error){
      updateShadowMigrationPanel({status:'failed',errorCode:error&&error.type||'unknown_storage_error'});
      await refreshShadowMigrationPanel();
    }
  });
  clearButton.addEventListener('click',async()=>{
    if(typeof confirm==='function'&&!confirm('只清理 IndexedDB 验证副本和迁移状态，旧 localStorage 数据不会删除。确认继续？'))return;
    clearButton.disabled=true;
    try{
      const result=await StorageManager.clearMigrationStaging();
      shadowMigrationUiState.backupConfirmed=false;
      backupCheckbox.checked=false;
      updateShadowMigrationPanel(result);
      await refreshShadowMigrationPreflight();
    }catch(error){updateShadowMigrationPanel({status:'failed',errorCode:error&&error.type||'unknown_storage_error'})}
    finally{clearButton.disabled=false}
  });
  return panel;
}
function setShadowMigrationEditLock(locked){
  ['addBtn','saveBtn','resetBtn','importBtn','refreshAllBtn','fxBtn'].forEach(id=>{
    const control=document.getElementById(id);
    if(control)control.disabled=Boolean(locked);
  });
  if(document.body)document.body.dataset.shadowMigrationLocked=locked?'true':'false';
}
function updateShadowMigrationPanel(record){
  shadowMigrationUiState.record=record||null;
  const panel=ensureShadowMigrationPanel();
  if(!panel)return;
  const status=panel.querySelector?panel.querySelector('#shadowMigrationStatus'):document.getElementById('shadowMigrationStatus');
  const button=panel.querySelector?panel.querySelector('#shadowMigrationBtn'):document.getElementById('shadowMigrationBtn');
  const summary=panel.querySelector?panel.querySelector('#shadowMigrationSummary'):document.getElementById('shadowMigrationSummary');
  const clearButton=panel.querySelector?panel.querySelector('#shadowMigrationClearBtn'):document.getElementById('shadowMigrationClearBtn');
  panel.dataset.migrationStatus=record&&record.status||'not_started';
  if(status)status.textContent=migrationStatusText(record);
  if(summary)summary.textContent=record&&record.status==='ready'?shadowReadyText(record):shadowPreflightText(shadowMigrationUiState.preflight,shadowMigrationUiState.capacity);
  const running=Boolean(record&&['copying','validating'].includes(record.status));
  setShadowMigrationEditLock(running);
  if(button){
    button.disabled=Boolean(running||!canStartShadowMigration(shadowMigrationUiState.backupConfirmed,shadowMigrationUiState.capacity,record));
  }
  if(clearButton)clearButton.disabled=Boolean(running||!(record&&['ready','failed'].includes(record.status)));
}
async function refreshShadowMigrationPreflight(){
  if(!StorageManager||typeof StorageManager.getShadowMigrationPreflight!=='function')return;
  try{
    const preflight=await StorageManager.getShadowMigrationPreflight();
    shadowMigrationUiState.preflight=preflight;
    shadowMigrationUiState.capacity=await readShadowStorageCapacity(preflight);
  }catch(_error){
    shadowMigrationUiState.preflight=null;
    shadowMigrationUiState.capacity=evaluateShadowCapacity(null,null);
  }
  updateShadowMigrationPanel(shadowMigrationUiState.record);
}
async function refreshShadowMigrationPanel(){
  const panel=ensureShadowMigrationPanel();
  if(!panel||!StorageManager||typeof StorageManager.getMigrationStatus!=='function')return;
  try{
    updateShadowMigrationPanel(await StorageManager.getMigrationStatus());
    await refreshShadowMigrationPreflight();
  }
  catch(_error){updateShadowMigrationPanel({status:'failed',sourceKeysPresent:[]})}
}
async function bootstrapApplication(){
  showStorageLoadingShell();
  try{
    await StorageManager.initialize();
    await loadState();
  }catch(error){
    showStorageInitializationError(error);
    return Object.freeze({status:'error',errorType:error&&error.type||'unknown_storage_error'});
  }
  if(typeof applyMarketDataBridge==='function')applyMarketDataBridge();
  const main=document.getElementById('main');
  if(main)main.dataset.storageState='ready';
  render();
  void refreshShadowMigrationPanel();
  if(window.AiDecisionReviewReader&&typeof window.AiDecisionReviewReader.refreshBridge==='function'){
    void window.AiDecisionReviewReader.refreshBridge().then(refreshed=>{if(refreshed)render()});
  }
  void checkBackendHealth();
  if(typeof updateSocialDataStatus==='function')updateSocialDataStatus();
  if(typeof loadSocialPosts==='function')loadSocialPosts().then(()=>{render();updateSocialDataStatus()});
  return Object.freeze({status:'ready'});
}
const applicationReady=bootstrapApplication();
window.ApplicationBootstrap=Object.freeze({ready:applicationReady});
window.ShadowMigrationUi=Object.freeze({
  formatStorageBytes,truncatedChecksum,evaluateShadowCapacity,canStartShadowMigration,shadowPreflightText,shadowReadyText,refresh:refreshShadowMigrationPanel
});
