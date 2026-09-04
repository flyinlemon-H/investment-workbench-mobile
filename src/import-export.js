function pad2(n){return String(n).padStart(2,'0')}
function dateStamp(d=new Date()){return `${d.getFullYear()}${pad2(d.getMonth()+1)}${pad2(d.getDate())}`}
function timeStamp(d=new Date()){return `${dateStamp(d)}-${pad2(d.getHours())}${pad2(d.getMinutes())}`}
function appVersion(){return 'V13.0 Manual Analysis Sync LTL V1'}
function backupFilename(prefix='投资作战手册',d=new Date()){return `${prefix}-${appVersion()}-${timeStamp(d)}.json`}
function downloadJson(data,filename){
  const blob=new Blob([JSON.stringify(data,null,2)],{type:'application/json'});
  const url=URL.createObjectURL(blob);
  const a=document.createElement('a');
  a.href=url;
  a.download=filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
function alpha3ExportSnapshot(data){
  const source=data&&typeof data==='object'?data:{};
  const snapshot=JSON.parse(JSON.stringify(source));
  const normalized=typeof normalize==='function'?normalize(snapshot):snapshot;
  if(!Array.isArray(normalized.decisionRecords))normalized.decisionRecords=[];
  if(!Array.isArray(normalized.decisionStates))normalized.decisionStates=[];
  if(typeof ALPHA3_DATA_VERSION==='string')normalized.alpha3DataVersion=ALPHA3_DATA_VERSION;
  return normalized;
}
function markBackupExported(){
  state.lastBackupAt=Date.now();
  saveState();
}
function exportData(){
  markBackupExported();
  downloadJson(alpha3ExportSnapshot(state),backupFilename('投资作战手册'));
  render();
}
function exportShadowVerificationBackup(){
  downloadJson(alpha3ExportSnapshot(state),backupFilename('存储升级验证前备份'));
}
function autoBackupBeforeImport(){
  if(!state||!Array.isArray(state.stocks))return;
  const snapshot=alpha3ExportSnapshot(state);
  snapshot.lastBackupAt=Date.now();
  downloadJson(snapshot,backupFilename('导入前自动备份'));
}
function csvCell(v){const s=String(v??'');return /[",\r\n]/.test(s)?'"'+s.replace(/"/g,'""')+'"':s}
function exportExecutionLogCsv(){const rows=typeof getExecutionLogRows==='function'?getExecutionLogRows():((state.executionLog||[]).slice().sort((a,b)=>(Number(b.t)||0)-(Number(a.t)||0)));const header=['时间','标的','买/卖','价格','数量','金额','备注','是否自动更新'];const body=rows.map(x=>{const amount=typeof executionLogAmount==='function'?executionLogAmount(x):(Number(x.amount)||Number(x.price)*Number(x.shares)||'');const time=typeof executionLogTime==='function'?executionLogTime(x):(x.t?new Date(Number(x.t)).toLocaleString('zh-CN'):'');const action=typeof executionLogAction==='function'?executionLogAction(x):(x.action==='sell'?'卖出':'买入');return [time,x.stock||'',action,x.price??'',x.shares??'',amount??'',x.note||'',x.autoUpdated?'是':'否'].map(csvCell).join(',')});const csv='\uFEFF'+[header.map(csvCell).join(','),...body].join('\r\n');const blob=new Blob([csv],{type:'text/csv;charset=utf-8'});const url=URL.createObjectURL(blob);const a=document.createElement('a');const d=new Date();a.href=url;a.download=`操作记录-${dateStamp(d)}-${pad2(d.getHours())}${pad2(d.getMinutes())}.csv`;document.body.appendChild(a);a.click();a.remove();URL.revokeObjectURL(url)}
function importResetClone(value){return typeof structuredClone==='function'?structuredClone(value):JSON.parse(JSON.stringify(value))}
function importResetValidation(){return globalThis.InvestmentStorage&&globalThis.InvestmentStorage.validation}
function validateRawImportShape(value){
  const source=Array.isArray(value)?{stocks:value,updatedAt:null}:value;
  const validation=importResetValidation();
  const plain=validation&&typeof validation.isPlainObject==='function'
    ?validation.isPlainObject(source)
    :Boolean(source&&typeof source==='object'&&!Array.isArray(source));
  if(!plain||!Array.isArray(source.stocks)||source.stocks.some(stock=>!stock||typeof stock!=='object'||Array.isArray(stock)))throw new Error('文件格式不正确：请导入包含 stocks 对象数组的 JSON，或直接导入股票数组 JSON。');
  return source;
}
function createValidatedCandidateSnapshot(value,options={}){
  const source=validateRawImportShape(value);
  if(options.requireWatchDefinition===true)for(const stock of source.stocks)for(const plan of stock.plans||[]){if(plan&&plan.planMode==='state_watch'){const checked=PlanV2.validateWatchCanonical(plan,{requireDefinition:true});if(!checked.ok)throw new Error(checked.errors.join('；'));}}
  if(Object.prototype.hasOwnProperty.call(source,'planRuntimeStates')){
    if(!globalThis.PlanRuntime||typeof globalThis.PlanRuntime.validateStore!=='function')throw new Error('Plan Runtime 校验器不可用。');
    const runtimeValidation=globalThis.PlanRuntime.validateStore(source.planRuntimeStates);if(!runtimeValidation.ok)throw new Error(runtimeValidation.errors.join('；'));
  }
  const candidate=normalize(importResetClone(source));
  const validation=importResetValidation();
  if(validation&&typeof validation.validateState==='function')validation.validateState(candidate);
  else validateRawImportShape(candidate);
  if(options.touchUpdatedAt!==false)candidate.updatedAt=Date.now();
  return importResetClone(candidate);
}
async function persistCandidateSnapshot(candidate){
  if(!globalThis.StorageManager||typeof globalThis.StorageManager.saveState!=='function')throw new Error('存储服务不可用，未修改当前数据。');
  const persist=value=>globalThis.StorageManager.saveState(value,{critical:true});
  const main=globalThis.document&&document.getElementById('main');
  const recovery=Boolean(main&&main.dataset&&main.dataset.storageState==='error');
  if(globalThis.MultiTabProtection&&typeof globalThis.MultiTabProtection.runProtectedSave==='function')await globalThis.MultiTabProtection.runProtectedSave(candidate,persist,{critical:true,allowUninitialized:recovery});
  else await persist(candidate);
  return candidate;
}
function importData(){document.getElementById('importFile').click()}
function handleImport(e){const file=e.target.files[0];if(!file)return;const r=new FileReader();r.onload=async ev=>{let candidate;try{candidate=createValidatedCandidateSnapshot(JSON.parse(ev.target.result),{requireWatchDefinition:true});if(globalThis.UniverseHandoff)globalThis.UniverseHandoff.reconcileState(candidate,globalThis.MARKET_DATA_BRIDGE)}catch(err){alert('导入失败：'+(err&&err.message?err.message:'文件校验失败。'));return}if(!confirm(`导入会覆盖当前本地数据，确认继续？\n\n当前：${state.stocks.length} 只\n导入：${candidate.stocks.length} 只\n\n确认后会先自动下载一份当前数据备份。`))return;let backupOk=true;try{autoBackupBeforeImport()}catch(backupErr){console.warn('导入前自动备份失败，继续导入。');backupOk=false}try{await persistCandidateSnapshot(candidate)}catch(err){alert('导入失败：数据尚未确认保存，原数据仍保留，请重试。');return}state=candidate;if(typeof resumeApplicationAfterRecovery==='function'&&document.getElementById('main')&&document.getElementById('main').dataset.storageState==='error')resumeApplicationAfterRecovery();else render();alert(backupOk?'导入成功，已在导入前自动下载当前数据备份。':'导入成功。注意：手机浏览器可能拦截了导入前自动备份下载，请导入后手动点一次「导出」备份。')};r.onerror=()=>alert('导入失败：文件读取失败，请确认浏览器有权限读取该文件。');r.readAsText(file);e.target.value=''}
async function resetSeed(){
  if(!confirm('确认清空当前浏览器里的本地数据？清空后需要重新导入 JSON。'))return;
  const candidate=createValidatedCandidateSnapshot({stocks:[],updatedAt:null});
  try{await persistCandidateSnapshot(candidate)}catch(error){
    alert('清空失败：原数据仍保留，尚未确认任何清空操作。请重试。');
    return;
  }
  state=candidate;
  currentTab='dashboard';
  render();
  alert('本地数据已清空并确认保存。');
}
