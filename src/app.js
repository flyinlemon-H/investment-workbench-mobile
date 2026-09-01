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
document.getElementById('syncPcBtn')?.addEventListener('click',handoffUniverseToPc);
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

async function handoffUniverseToPc(){
  const button=document.getElementById('syncPcBtn');
  if(!window.UniverseHandoff||!button)return;
  const original=button.textContent;
  button.disabled=true;button.textContent='正在生成';
  try{
    const manifest=await window.UniverseHandoff.buildManifest(state);
    const result=await window.UniverseHandoff.shareOrDownloadManifest(manifest);
    if(result.method==='cancelled')return;
    state.universeSync.manifest.lastHandoffAt=new Date().toISOString();
    await saveState(state,{critical:true});
    alert(result.method==='share'?'已打开分享。请保存到 OneDrive 同步收件夹，并等待 PC 更新。':'已下载同步文件。请将它保存到 OneDrive 同步收件夹。');
  }catch(error){alert(`同步文件生成失败：${error&&error.message||'未知错误'}`)}
  finally{button.disabled=false;button.textContent=original;if(typeof renderPcSyncStatus==='function')renderPcSyncStatus()}
}
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
    const guidance=document.createElement('p');
    guidance.textContent='请先重试加载；如仍失败，可从已导出的 JSON 备份恢复。恢复文件会先校验并保存，成功前不会覆盖现有数据。';
    const retryButton=document.createElement('button');
    retryButton.type='button';retryButton.className='btn ghost';retryButton.textContent='重试加载';
    retryButton.addEventListener('click',()=>{void retryStorageRecovery()});
    const restoreButton=document.createElement('button');
    restoreButton.type='button';restoreButton.className='btn';restoreButton.textContent='从 JSON 备份恢复';
    restoreButton.addEventListener('click',()=>{if(typeof importData==='function')importData()});
    main.appendChild(guidance);main.appendChild(retryButton);main.appendChild(restoreButton);
  }
}
let cutoverRetryInFlight=false;
let cutoverReloadTimer=null;
function safeCutoverDiagnostic(value,fallback){
  const text=typeof value==='string'?value:'';
  return text&&text.length<=120&&/^[A-Za-z0-9_.:-]+$/.test(text)?text:fallback;
}
function cutoverDiagnostic(error){
  const type=safeCutoverDiagnostic(error&&error.type,'unknown_storage_error');
  const operation=safeCutoverDiagnostic(error&&error.operation,'cutover.retry');
  const errorCode=safeCutoverDiagnostic(error&&error.errorCode,type.toUpperCase());
  return Object.freeze({type,operation,errorCode});
}
function showCutoverRecovery(options={}){
  const main=document.getElementById('main');
  if(!main)return;
  const phase=options.phase||'idle';
  const busy=phase==='retrying'||phase==='waiting';
  document.querySelectorAll('.tabs button,.toolbar button,#saveBtn').forEach(control=>{control.disabled=true});
  if(document.body)document.body.dataset.storageRecoveryRequired='true';
  main.dataset.storageState='recovery_required';
  main.textContent='本地存储切换未完成。业务页面已锁定，未覆盖或删除 legacy localStorage。';
  const guidance=document.createElement('p');
  guidance.textContent='可检查状态后重试激活、明确选择继续使用 legacy 数据，或从最新 JSON 备份恢复。系统不会自动切换数据源。';
  const status=document.createElement('p');status.id='cutoverRecoveryStatus';status.setAttribute('role','status');status.setAttribute('aria-live','assertive');
  if(phase==='retrying')status.textContent='正在重试 IndexedDB 激活，请勿关闭页面……';
  else if(phase==='waiting')status.textContent='正在等待独占存储锁，请关闭其它业务标签页后保持当前页面打开……';
  else if(phase==='success')status.textContent='IndexedDB 已激活。';
  else if(phase==='failed')status.textContent='IndexedDB 激活失败，数据仍保留在 legacy localStorage。';
  else status.textContent='尚未重试 IndexedDB 激活。';
  const diagnostic=document.createElement('p');diagnostic.id='cutoverRecoveryDiagnostic';
  if(phase==='failed'){
    const safe=cutoverDiagnostic(options.error);
    diagnostic.textContent=`type=${safe.type}; operation=${safe.operation}; errorCode=${safe.errorCode}`;
  }else diagnostic.hidden=true;
  const retry=document.createElement('button');retry.id='cutoverRecoveryRetryBtn';retry.type='button';retry.className='btn';retry.textContent='重试 IndexedDB 激活';
  retry.disabled=Boolean(busy||phase==='success'||cutoverRetryInFlight);
  retry.setAttribute('aria-busy',busy?'true':'false');
  retry.addEventListener('click',()=>{void retryIndexedDbActivation()});
  const legacy=document.createElement('button');legacy.type='button';legacy.className='btn ghost';legacy.textContent='继续使用 legacy localStorage';
  legacy.disabled=Boolean(busy||phase==='success');
  legacy.addEventListener('click',async()=>{if(typeof confirm==='function'&&!confirm('确认继续使用保留的 legacy localStorage？不会删除 IndexedDB staging。'))return;try{await StorageManager.recoverUsingLegacy();location.reload()}catch(error){showCutoverRecovery({phase:'failed',error})}});
  const restore=document.createElement('button');restore.type='button';restore.className='btn ghost';restore.textContent='从最新 JSON 备份恢复';
  restore.disabled=Boolean(busy||phase==='success');
  restore.addEventListener('click',()=>{if(typeof importData==='function')importData()});
  main.appendChild(guidance);main.appendChild(status);main.appendChild(diagnostic);main.appendChild(retry);main.appendChild(legacy);main.appendChild(restore);
}
async function retryIndexedDbActivation(){
  if(cutoverRetryInFlight)return Object.freeze({status:'ignored',reason:'retry_in_flight'});
  cutoverRetryInFlight=true;
  showCutoverRecovery({phase:'retrying'});
  try{
    const lockUi={
      timeoutMs:8000,
      onWaiting:()=>showCutoverRecovery({phase:'waiting'}),
      onAcquired:()=>showCutoverRecovery({phase:'retrying'})
    };
    const result=await StorageManager.retryActiveCutover({withExclusiveLock:task=>MultiTabProtection.runExclusiveCutover(task,lockUi)});
    showCutoverRecovery({phase:'success'});
    if(cutoverReloadTimer!==null&&typeof clearTimeout==='function')clearTimeout(cutoverReloadTimer);
    if(typeof setTimeout==='function')cutoverReloadTimer=setTimeout(()=>{if(location&&typeof location.reload==='function')location.reload()},700);
    else if(location&&typeof location.reload==='function')location.reload();
    return result;
  }catch(error){
    cutoverRetryInFlight=false;
    showCutoverRecovery({phase:'failed',error});
    return Object.freeze({status:'failed',errorType:cutoverDiagnostic(error).type,errorCode:cutoverDiagnostic(error).errorCode});
  }
}
async function refreshCutoverRecoveryAfterResume(){
  if(!document.body||document.body.dataset.storageRecoveryRequired!=='true'||cutoverRetryInFlight)return;
  try{
    const status=await StorageManager.getCutoverStatus();
    if(status&&status.status==='indexeddb_active')showCutoverRecovery({phase:'success'});
    else showCutoverRecovery({phase:'idle'});
  }catch(error){showCutoverRecovery({phase:'failed',error})}
}
function migrationStatusText(record){
  const status=record&&record.status||'not_started';
  if(status==='copying')return '正在安全复制旧本地数据。当前数据源：localStorage。';
  if(status==='validating')return '正在校验 IndexedDB staging。当前数据源：localStorage。';
  if(status==='ready')return '已完成安全复制与校验，但尚未切换存储。当前数据源：localStorage。';
  if(status==='completed')return 'IndexedDB 已成为当前数据源；legacy localStorage 已保留为只读回退副本。';
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
function canStartShadowMigration(backupConfirmed,capacity,record,preflight){
  const alreadyCurrent=record&&record.status==='ready'&&(!preflight||isCurrentShadowReady(record,preflight));
  return Boolean(backupConfirmed&&capacity&&capacity.sufficient&&record&&!alreadyCurrent&&record.sourceKeysPresent&&record.sourceKeysPresent.length);
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
function cutoverCompletedText(record){
  return [
    '状态：正式存储切换完成',
    '当前数据源：IndexedDB',
    `切换时间：${record&&record.completedAt||'—'}`,
    `Semantic checksum 摘要：${truncatedChecksum(record&&record.semanticChecksum)||'—'}`,
    'legacy localStorage 已保留为只读回退副本，请勿删除。'
  ].join('\n');
}
function isCurrentShadowReady(record,preflight){
  return Boolean(record&&record.status==='ready'&&preflight&&preflight.sourceChecksumPrefix&&record.sourceChecksum&&preflight.sourceChecksumPrefix===record.sourceChecksum.slice(0,10));
}
function ensureShadowMigrationPanel(){
  let panel=document.getElementById('shadowMigrationPanel');
  if(panel)return panel;
  const mount=document.getElementById('storageMaintenancePanelMount');
  if(!mount||typeof mount.appendChild!=='function')return null;
  panel=document.createElement('section');
  panel.id='shadowMigrationPanel';
  panel.className='storage-maintenance-advanced';
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
  const cutoverButton=document.createElement('button');
  cutoverButton.id='activeStorageCutoverBtn';cutoverButton.type='button';cutoverButton.className='btn';cutoverButton.textContent='切换到 IndexedDB';
  panel.appendChild(guidance);
  panel.appendChild(status);
  panel.appendChild(summary);
  panel.appendChild(exportButton);
  panel.appendChild(backupLabel);
  panel.appendChild(button);
  panel.appendChild(cancelButton);
  panel.appendChild(clearButton);
  panel.appendChild(cutoverButton);
  mount.appendChild(panel);
  exportButton.addEventListener('click',()=>{if(typeof exportShadowVerificationBackup==='function')exportShadowVerificationBackup()});
  backupCheckbox.addEventListener('change',()=>{shadowMigrationUiState.backupConfirmed=backupCheckbox.checked===true;updateShadowMigrationPanel(shadowMigrationUiState.record)});
  cancelButton.addEventListener('click',()=>{shadowMigrationUiState.backupConfirmed=false;backupCheckbox.checked=false;updateShadowMigrationPanel(shadowMigrationUiState.record)});
  button.addEventListener('click',async()=>{
    await refreshShadowMigrationPreflight();
    if(!canStartShadowMigration(shadowMigrationUiState.backupConfirmed,shadowMigrationUiState.capacity,shadowMigrationUiState.record,shadowMigrationUiState.preflight))return;
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
  cutoverButton.addEventListener('click',async()=>{
    if(!shadowMigrationUiState.backupConfirmed||!shadowMigrationUiState.record||shadowMigrationUiState.record.status!=='ready')return;
    if(typeof confirm==='function'&&!confirm('确认将已校验 staging 原子激活为 IndexedDB 正式数据源？legacy localStorage 将保留且不会删除。'))return;
    cutoverButton.disabled=true;setShadowMigrationEditLock(true);let completed=false;
    try{
      const result=await StorageManager.executeActiveCutover({withExclusiveLock:task=>MultiTabProtection.runExclusiveCutover(task)});
      updateShadowMigrationPanel({status:'completed',completedAt:result.marker&&result.marker.cutoverAt,validationSummary:result.validationSummary||{},semanticChecksum:result.marker&&result.marker.semanticChecksum});
      completed=true;render();
    }catch(error){showCutoverRecovery({phase:'failed',error})}
    finally{if(completed)setShadowMigrationEditLock(false)}
  });
  return panel;
}
function setShadowMigrationEditLock(locked){
  ['addBtn','saveBtn','resetBtn','importBtn','refreshAllBtn','fxBtn','syncPcBtn'].forEach(id=>{
    const control=document.getElementById(id);
    if(control)control.disabled=Boolean(locked);
  });
  if(document.body)document.body.dataset.shadowMigrationLocked=locked?'true':'false';
}
function updateShadowMigrationPanel(record){
  shadowMigrationUiState.record=record||null;
  renderStorageMaintenanceWarning(record);
  const panel=ensureShadowMigrationPanel();
  if(!panel)return;
  const status=panel.querySelector?panel.querySelector('#shadowMigrationStatus'):document.getElementById('shadowMigrationStatus');
  const button=panel.querySelector?panel.querySelector('#shadowMigrationBtn'):document.getElementById('shadowMigrationBtn');
  const summary=panel.querySelector?panel.querySelector('#shadowMigrationSummary'):document.getElementById('shadowMigrationSummary');
  const clearButton=panel.querySelector?panel.querySelector('#shadowMigrationClearBtn'):document.getElementById('shadowMigrationClearBtn');
  const cutoverButton=panel.querySelector?panel.querySelector('#activeStorageCutoverBtn'):document.getElementById('activeStorageCutoverBtn');
  panel.dataset.migrationStatus=record&&record.status||'not_started';
  if(status)status.textContent=migrationStatusText(record);
  const currentReady=isCurrentShadowReady(record,shadowMigrationUiState.preflight);
  if(summary)summary.textContent=record&&record.status==='completed'?cutoverCompletedText(record):(currentReady?shadowReadyText(record):(record&&record.status==='ready'?'staging 已过期，请重新执行安全复制验证。\n'+shadowPreflightText(shadowMigrationUiState.preflight,shadowMigrationUiState.capacity):shadowPreflightText(shadowMigrationUiState.preflight,shadowMigrationUiState.capacity)));
  const running=Boolean(record&&['copying','validating'].includes(record.status));
  setShadowMigrationEditLock(running);
  if(button){
    button.disabled=Boolean(running||!canStartShadowMigration(shadowMigrationUiState.backupConfirmed,shadowMigrationUiState.capacity,record,shadowMigrationUiState.preflight));
  }
  if(clearButton)clearButton.disabled=Boolean(running||!(record&&['ready','failed'].includes(record.status)));
  if(cutoverButton){
    const sourceInfo=StorageManager&&typeof StorageManager.getActiveSourceInfo==='function'?StorageManager.getActiveSourceInfo():{};
    cutoverButton.hidden=!sourceInfo.indexedDbActivationEnabled||sourceInfo.activeSource==='indexeddb';
    cutoverButton.disabled=Boolean(running||!shadowMigrationUiState.backupConfirmed||!currentReady);
  }
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
  if(!StorageManager||typeof StorageManager.getMigrationStatus!=='function')return;
  try{
    updateShadowMigrationPanel(await StorageManager.getMigrationStatus());
    if(document.getElementById('storageMaintenancePanelMount'))await refreshShadowMigrationPreflight();
  }
  catch(_error){updateShadowMigrationPanel({status:'failed',sourceKeysPresent:[]})}
}
function storageMaintenanceNeedsAttention(record){return Boolean(record&&record.status==='failed')}
function renderStorageMaintenanceWarning(record=shadowMigrationUiState.record){
  let warning=document.getElementById('storageMaintenanceWarning');
  const shouldShow=storageMaintenanceNeedsAttention(record)&&currentTab!=='tools'&&!(document.body&&document.body.dataset.storageRecoveryRequired==='true');
  if(!shouldShow){if(warning)warning.remove();return}
  if(warning)return;
  const main=document.getElementById('main');if(!main||!main.parentNode)return;
  warning=document.createElement('div');warning.id='storageMaintenanceWarning';warning.className='alert';warning.setAttribute('role','alert');
  const text=document.createElement('span');text.textContent='本地数据状态异常，请检查数据维护。';
  const action=document.createElement('button');action.type='button';action.className='btn ghost small';action.textContent='检查数据维护';
  action.addEventListener('click',()=>{detailStockId=null;detailSubView='';currentTab='tools';render()});
  warning.appendChild(text);warning.appendChild(action);main.parentNode.insertBefore(warning,main);
}
function syncStorageMaintenanceUi(){
  renderStorageMaintenanceWarning(shadowMigrationUiState.record);
  if(document.getElementById('storageMaintenancePanelMount'))updateShadowMigrationPanel(shadowMigrationUiState.record);
}
let applicationServicesStarted=false;
async function activateLoadedApplication(){
  if(typeof applyMarketDataBridge==='function')await applyMarketDataBridge();
  if(window.UniverseHandoff){
    const reconciliation=window.UniverseHandoff.reconcileState(state,window.MARKET_DATA_BRIDGE);
    if(reconciliation.changed)await saveState(state,{critical:true});
  }
  const main=document.getElementById('main');
  if(main)main.dataset.storageState='ready';
  render();
  if(applicationServicesStarted)return Object.freeze({status:'ready'});
  applicationServicesStarted=true;
  void refreshShadowMigrationPanel();
  if(window.AiDecisionReviewReader&&typeof window.AiDecisionReviewReader.refreshBridge==='function'){
    void window.AiDecisionReviewReader.refreshBridge().then(refreshed=>{if(refreshed)render()});
  }
  void checkBackendHealth();
  if(typeof updateSocialDataStatus==='function')updateSocialDataStatus();
  if(typeof loadSocialPosts==='function')loadSocialPosts().then(()=>{render();updateSocialDataStatus()});
  return Object.freeze({status:'ready'});
}
async function retryStorageRecovery(){
  showStorageLoadingShell();
  try{const initialized=await StorageManager.initialize();if(initialized.storageState==='recovery_required'){showCutoverRecovery();return Object.freeze({status:'recovery_required'})}await loadState()}
  catch(error){showStorageInitializationError(error);return Object.freeze({status:'error',errorType:error&&error.type||'unknown_storage_error'})}
  try{return await activateLoadedApplication()}catch(error){showStorageInitializationError(error);return Object.freeze({status:'error',errorType:error&&error.type||'write_failed'})}
}
async function resumeApplicationAfterRecovery(){return activateLoadedApplication()}
if(typeof window!=='undefined'&&typeof window.addEventListener==='function'){
  window.addEventListener('pagehide',()=>{if(document.body&&document.body.dataset.storageRecoveryRequired==='true')document.body.dataset.cutoverPageHidden='true'});
  window.addEventListener('pageshow',()=>{if(document.body)document.body.dataset.cutoverPageHidden='false';void refreshCutoverRecoveryAfterResume()});
}
if(typeof document!=='undefined'&&typeof document.addEventListener==='function'){
  document.addEventListener('visibilitychange',()=>{
    if(document.visibilityState==='hidden'){
      if(document.body&&document.body.dataset.storageRecoveryRequired==='true')document.body.dataset.cutoverPageHidden='true';
      return;
    }
    if(document.body)document.body.dataset.cutoverPageHidden='false';
    void refreshCutoverRecoveryAfterResume();
  });
}
async function bootstrapApplication(){
  showStorageLoadingShell();
  try{
    const initialized=await StorageManager.initialize();
    if(initialized.storageState==='recovery_required'){showCutoverRecovery();return Object.freeze({status:'recovery_required'})}
    await loadState();
  }catch(error){
    showStorageInitializationError(error);
    return Object.freeze({status:'error',errorType:error&&error.type||'unknown_storage_error'});
  }
  try{return await activateLoadedApplication()}catch(error){showStorageInitializationError(error);return Object.freeze({status:'error',errorType:error&&error.type||'write_failed'})}
}
const applicationReady=bootstrapApplication();
window.ApplicationBootstrap=Object.freeze({ready:applicationReady});
window.StorageRecovery=Object.freeze({retry:retryStorageRecovery,resumeAfterBackup:resumeApplicationAfterRecovery});
window.ShadowMigrationUi=Object.freeze({
  formatStorageBytes,truncatedChecksum,evaluateShadowCapacity,canStartShadowMigration,isCurrentShadowReady,shadowPreflightText,shadowReadyText,cutoverCompletedText,
  showCutoverRecovery,retryIndexedDbActivation,refreshCutoverRecoveryAfterResume,cutoverDiagnostic,refresh:refreshShadowMigrationPanel
});
