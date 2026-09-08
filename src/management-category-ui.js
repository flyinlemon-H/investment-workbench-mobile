// User-owned classification and holding confirmation; never run on load or AI import.
function confirmHoldingLifecycle(before,after,{message='',label='确认修改'}={}){
  const boundary=ManagementCategory.isManagementCategoryTarget(after)&&before&&((Number(before.shares)>0&&Number(after.shares)===0)||(Number(before.shares)===0&&Number(after.shares)>0));
  if(!boundary)return Promise.resolve(after.managementCategory);
  const binding=JSON.stringify(state),build=Number(after.shares)>0,choices=ManagementCategory.allowed(after);
  return new Promise(resolve=>{
    const dialog=document.createElement('dialog');dialog.id='holdingLifecycleDialog';dialog.className='category-dialog';
    dialog.innerHTML=`<h2>持仓调整</h2><p>${esc(before.name||before.code)} · ${esc(before.shares)} → ${esc(after.shares)}</p><p>${build?(ManagementCategory.isETF(after)?'本次操作将建立 ETF 持仓，并将管理分类调整为「ETF」。':'建立持仓后，请选择管理分类。'):'本次操作将使持仓变为 0，并将该标的移入「候选仓」。'}</p><label for="holdingLifecycleCategory">管理分类：${esc(ManagementCategory.labels[before.managementCategory]||'未分类')} →</label><select id="holdingLifecycleCategory">${choices.length>1?'<option value="">请选择核心仓或观察仓</option>':''}${choices.map(key=>`<option value="${key}">${ManagementCategory.labels[key]}</option>`).join('')}</select><p>${esc(message)}</p><p id="holdingLifecycleError" role="alert"></p><div class="actions"><button class="btn ghost" id="holdingLifecycleCancel" type="button">取消</button><button class="btn" id="holdingLifecycleConfirm" type="button">${esc(label)}</button></div>`;
    document.body.appendChild(dialog);let settled=false;
    const finish=value=>{if(settled)return;settled=true;dialog.close();dialog.remove();resolve(value)};
    dialog.oncancel=event=>{event.preventDefault();finish(null)};
    dialog.querySelector('#holdingLifecycleCancel').onclick=()=>finish(null);
    dialog.querySelector('#holdingLifecycleConfirm').onclick=()=>{
      try{
        if(binding!==JSON.stringify(state))throw new Error('数据已变化，请取消并重新预览。');
        const result=ManagementCategory.transition(before,after,dialog.querySelector('select').value);
        finish(result.category);
      }catch(error){dialog.querySelector('#holdingLifecycleError').textContent=error.message}
    };
    dialog.showModal();dialog.querySelector('select').focus();
  });
}
let categoryFormOriginal='',categoryFormState='',categorySaveBusy=false;
function categoryOptions(value='',keys=ManagementCategory.values){return '<option value="">请选择管理分类</option>'+keys.map(key=>`<option value="${key}"${key===value?' selected':''}>${ManagementCategory.labels[key]}</option>`).join('')}
function categoryRepairOptions(stock){const keys=ManagementCategory.allowed(stock);return ManagementCategory.needsRepair(stock)&&keys.length===1?`<option value="${keys[0]}">${ManagementCategory.labels[keys[0]]}</option>`:categoryOptions('',keys)}
function categoryFormSnapshot(){return JSON.stringify({fields:[...document.querySelectorAll('#modal input,#modal select,#modal textarea')].filter(node=>node.id!=='fManagementCategory').map(node=>[node.id||node.dataset.field,node.value]),formType,tempBuy,tempSell})}
function initializeCategoryForm(stock){
  const select=document.getElementById('fManagementCategory');select.innerHTML=categoryOptions(stock?.managementCategory);select.value=ManagementCategory.valid(stock?.managementCategory)?stock.managementCategory:'';
  const message=document.getElementById('fManagementCategoryError');message.textContent='';select.setAttribute('aria-invalid','false');
  const warn=()=>{const error=select.value?ManagementCategory.compatibility(select.value,document.getElementById('fShares').value,{...stock,type:formType}):'';message.textContent=error;select.setAttribute('aria-invalid',String(Boolean(error)))};
  select.onchange=warn;document.getElementById('fShares').addEventListener('input',warn,{signal:categoryFormAbortSignal()});
  categoryFormOriginal=categoryFormSnapshot();categoryFormState=JSON.stringify(state);
}
let categoryFormAbort;
function categoryFormAbortSignal(){categoryFormAbort?.abort();categoryFormAbort=new AbortController();return categoryFormAbort.signal}
function setCategoryFormSaving(saving){document.querySelectorAll('#modal button,#modal input,#modal select,#modal textarea').forEach(node=>node.disabled=saving)}
function categoryFormError(message){const select=document.getElementById('fManagementCategory');document.getElementById('fManagementCategoryError').textContent=message;select.setAttribute('aria-invalid','true');select.focus()}
async function persistManagementCategory(candidate){
  // Existing detached critical persistence includes canonical storage and stale-tab guard.
  candidate.updatedAt=Math.max(Date.now(),(Number(state.updatedAt)||0)+1);
  const saved=await persistCandidateSnapshot(candidate);
  if(saved===false||(saved&&saved.ok===false))throw new Error('存储未确认成功，请重试。');
  state=candidate;
}
function openCategoryAssignment(restoreSource=null){
  if(!Array.isArray(restoreSource?.stocks))restoreSource=null;
  const source=()=>restoreSource||state;
  const canonicalBinding=JSON.stringify(state);
  document.getElementById('categoryAssignmentDialog')?.remove();
  const records=ManagementCategory.inventory(ManagementCategory.pending(source().stocks));
  const assignmentSession=ManagementCategory.assignmentSession(source().stocks,SymbolIdentity.canonicalMarketSymbol);
  const dialog=document.createElement('dialog');dialog.id='categoryAssignmentDialog';dialog.className='category-dialog';
  dialog.innerHTML=`<h2>${restoreSource?'备份需要修复管理分类':'整理标的分类'}</h2>${restoreSource?'<p>确认将采用此备份并替换当前本地数据。保存前会下载当前备份。</p>':''}<p class="card-note">逐项选择后预览，确认保存才会生效。旧角色仅供参考。</p><div>${records.map((row,i)=>{return `<div class="category-assignment-row"><label for="categoryAssignment${i}">${esc(row.name)} · ${esc(row.symbol)}</label><div class="card-note">当前旧角色：${esc(row.legacyRole||'未记录')} · 持仓 ${esc(row.shares??'未知')} · 旧类型 ${esc(row.assetType==='etf'?'ETF':row.assetType==='watching'?'观察':row.assetType==='holding'?'个股':row.assetType||'未记录')}</div><select id="categoryAssignment${i}" data-category-id="${esc(row.id||'')}" data-category-symbol="${esc(SymbolIdentity.canonicalMarketSymbol(row.symbol)||row.symbol)}">${categoryRepairOptions(source().stocks.find(s=>s.id===row.id))}</select></div>`}).join('')}</div><p id="categoryAssignmentError" role="alert"></p><div id="categoryAssignmentPreview" aria-live="polite"></div><div class="actions"><button class="btn ghost" id="categoryAssignmentCancel" type="button">取消</button><button class="btn ghost" id="categoryAssignmentReview" type="button" disabled>预览</button><button class="btn" id="categoryAssignmentConfirm" type="button" disabled>确认保存</button></div>`;
  document.body.appendChild(dialog);let preview=null,busy=false;
  const error=dialog.querySelector('#categoryAssignmentError'),confirmButton=dialog.querySelector('#categoryAssignmentConfirm'),reviewButton=dialog.querySelector('#categoryAssignmentReview');
  const selections=()=>[...dialog.querySelectorAll('select')].filter(node=>node.value).map(node=>({id:node.dataset.categoryId,symbol:node.dataset.categorySymbol,managementCategory:node.value}));
  const invalidate=()=>{preview=null;confirmButton.disabled=true;dialog.querySelector('#categoryAssignmentPreview').textContent='';error.textContent=''};
  const updateReview=()=>{reviewButton.disabled=busy||!records.length||selections().length!==records.length};
  dialog.onchange=()=>{invalidate();updateReview()};dialog.oncancel=event=>{if(busy)event.preventDefault()};dialog.onclose=()=>dialog.remove();
  dialog.querySelector('#categoryAssignmentCancel').onclick=()=>dialog.close();
  dialog.querySelector('#categoryAssignmentReview').onclick=()=>{invalidate();try{const assignments=selections();ManagementCategory.buildAssignmentCandidate(source(),assignments,SymbolIdentity.canonicalMarketSymbol,assignmentSession);preview={assignments,selectionBinding:JSON.stringify(assignments),stateBinding:JSON.stringify(source())};dialog.querySelector('#categoryAssignmentPreview').innerHTML=`<p>${restoreSource?'将采用此备份，修复以下分类；备份其余字段按原值采用：':`将保存 ${assignments.length} 项管理分类，其他字段保持原状：`}</p><ul>${assignments.map(a=>`<li>${esc(source().stocks.find(s=>s.id===a.id).name)} · ${esc(a.symbol)} ${ManagementCategory.labels[source().stocks.find(s=>s.id===a.id).managementCategory]||'未分类'} → ${ManagementCategory.labels[a.managementCategory]}</li>`).join('')}</ul>`;confirmButton.disabled=false}catch(e){error.textContent=e.message}};
  confirmButton.onclick=async()=>{
    if(busy||!preview)return;
    try{ManagementCategory.buildAssignmentCandidate(source(),preview.assignments,SymbolIdentity.canonicalMarketSymbol,assignmentSession)}catch(e){invalidate();error.textContent=e.message;return}
    if(preview.selectionBinding!==JSON.stringify(selections())||preview.stateBinding!==JSON.stringify(source())||(restoreSource&&canonicalBinding!==JSON.stringify(state))){invalidate();error.textContent='数据或选择已变化，请重新预览。';return}
    busy=true;dialog.querySelectorAll('button,select').forEach(node=>node.disabled=true);
    try{const candidate=ManagementCategory.buildAssignmentCandidate(source(),preview.assignments,SymbolIdentity.canonicalMarketSymbol,assignmentSession);if(restoreSource)autoBackupBeforeImport();await persistManagementCategory(candidate);dialog.close();if(restoreSource&&typeof resumeApplicationAfterRecovery==='function'&&document.getElementById('main')?.dataset.storageState==='error')resumeApplicationAfterRecovery();else render()}
    catch(e){error.textContent=`分类未保存，原数据保留。${e.message||'请重试。'}`}
    finally{busy=false;dialog.querySelectorAll('button,select').forEach(node=>node.disabled=false);updateReview();confirmButton.disabled=!preview}
  };
  updateReview();dialog.showModal();dialog.querySelector('select,button')?.focus();
}
