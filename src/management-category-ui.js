// Explicit user assignment only. No normalization, AI import, or lifecycle hooks.
let categoryFormOriginal='',categoryFormState='',categorySaveBusy=false;
function categoryOptions(value=''){return '<option value="">请选择管理分类</option>'+ManagementCategory.values.map(key=>`<option value="${key}"${key===value?' selected':''}>${ManagementCategory.labels[key]}</option>`).join('')}
function categoryFormSnapshot(){return JSON.stringify({fields:[...document.querySelectorAll('#modal input,#modal select,#modal textarea')].filter(node=>node.id!=='fManagementCategory').map(node=>[node.id||node.dataset.field,node.value]),formType,tempBuy,tempSell})}
function initializeCategoryForm(stock){
  const select=document.getElementById('fManagementCategory');select.innerHTML=categoryOptions(stock?.managementCategory);select.value=ManagementCategory.valid(stock?.managementCategory)?stock.managementCategory:'';
  const message=document.getElementById('fManagementCategoryError');message.textContent='';select.setAttribute('aria-invalid','false');
  const warn=()=>{const error=select.value?ManagementCategory.compatibility(select.value,document.getElementById('fShares').value):'';message.textContent=error;select.setAttribute('aria-invalid',String(Boolean(error)))};
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
function openCategoryAssignment(){
  document.getElementById('categoryAssignmentDialog')?.remove();
  const records=ManagementCategory.inventory(state.stocks).filter(row=>row.needsConfirmation);
  const dialog=document.createElement('dialog');dialog.id='categoryAssignmentDialog';dialog.className='category-dialog';
  dialog.innerHTML=`<h2>整理标的分类</h2><p class="card-note">逐项选择后预览，确认保存才会生效。旧角色仅供参考。</p><div>${records.map((row,i)=>{const stock=state.stocks.find(s=>(s.code||s.symbol||'')===row.symbol);return `<div class="category-assignment-row"><label for="categoryAssignment${i}">${esc(row.name)} · ${esc(row.symbol)}</label><div class="card-note">当前旧角色：${esc(row.legacyRole||'未记录')} · 持仓 ${esc(row.shares??'未知')} · 旧类型 ${esc(row.assetType==='etf'?'ETF':row.assetType==='watching'?'观察':row.assetType==='holding'?'个股':row.assetType||'未记录')}</div><select id="categoryAssignment${i}" data-category-id="${esc(stock?.id||'')}" data-category-symbol="${esc(SymbolIdentity.canonicalMarketSymbol(row.symbol)||row.symbol)}">${categoryOptions()}</select></div>`}).join('')}</div><p id="categoryAssignmentError" role="alert"></p><div id="categoryAssignmentPreview" aria-live="polite"></div><div class="actions"><button class="btn ghost" id="categoryAssignmentCancel" type="button">取消</button><button class="btn ghost" id="categoryAssignmentReview" type="button">预览</button><button class="btn" id="categoryAssignmentConfirm" type="button" disabled>确认保存</button></div>`;
  document.body.appendChild(dialog);let preview=null,busy=false;
  const error=dialog.querySelector('#categoryAssignmentError'),confirmButton=dialog.querySelector('#categoryAssignmentConfirm');
  const selections=()=>[...dialog.querySelectorAll('select')].filter(node=>node.value).map(node=>({id:node.dataset.categoryId,symbol:node.dataset.categorySymbol,managementCategory:node.value}));
  const invalidate=()=>{preview=null;confirmButton.disabled=true;dialog.querySelector('#categoryAssignmentPreview').textContent='';error.textContent=''};
  dialog.onchange=invalidate;dialog.oncancel=event=>{if(busy)event.preventDefault()};dialog.onclose=()=>dialog.remove();
  dialog.querySelector('#categoryAssignmentCancel').onclick=()=>dialog.close();
  dialog.querySelector('#categoryAssignmentReview').onclick=()=>{invalidate();try{const assignments=selections();ManagementCategory.buildCandidate(state,assignments,SymbolIdentity.canonicalMarketSymbol);preview={assignments,selectionBinding:JSON.stringify(assignments),stateBinding:JSON.stringify(state)};dialog.querySelector('#categoryAssignmentPreview').innerHTML=`<p>将保存 ${assignments.length} 项分类，其余标的保留原状：</p><ul>${assignments.map(a=>`<li>${esc(state.stocks.find(s=>s.id===a.id).name)} · ${esc(a.symbol)} → ${ManagementCategory.labels[a.managementCategory]}</li>`).join('')}</ul>`;confirmButton.disabled=false}catch(e){error.textContent=e.message}};
  confirmButton.onclick=async()=>{
    if(busy||!preview)return;
    if(preview.selectionBinding!==JSON.stringify(selections())||preview.stateBinding!==JSON.stringify(state)){invalidate();error.textContent='数据或选择已变化，请重新预览。';return}
    busy=true;dialog.querySelectorAll('button,select').forEach(node=>node.disabled=true);
    try{const candidate=ManagementCategory.buildCandidate(state,preview.assignments,SymbolIdentity.canonicalMarketSymbol);await persistManagementCategory(candidate);dialog.close();render()}
    catch(e){error.textContent=`分类未保存，原数据保留。${e.message||'请重试。'}`}
    finally{busy=false;dialog.querySelectorAll('button,select').forEach(node=>node.disabled=false)}
  };
  dialog.showModal();dialog.querySelector('select,button')?.focus();
}
