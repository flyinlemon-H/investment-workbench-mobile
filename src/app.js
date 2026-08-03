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
loadState();
if(typeof applyMarketDataBridge==='function')applyMarketDataBridge();
render();
if(window.AiDecisionReviewReader&&typeof window.AiDecisionReviewReader.refreshBridge==='function'){
  void window.AiDecisionReviewReader.refreshBridge().then(refreshed=>{if(refreshed)render()});
}
void checkBackendHealth();
if(typeof updateSocialDataStatus==='function')updateSocialDataStatus();
if(typeof loadSocialPosts==='function')loadSocialPosts().then(()=>{render();updateSocialDataStatus()});
