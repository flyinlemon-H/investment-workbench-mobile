(function(root){
 'use strict';
 const doc=root.document,$=id=>doc.getElementById(id);let candidate=null,remote=null,busy=false;
 const client=root.ApprovedMarketMigration.create({
  rpc:async(action,input)=>{const {data,error}=await root.SupabaseBrowserClient.getClient().rpc('market_data_migration',{p_action:action,p_input:input});if(error)throw Error(error.message||'远端请求失败');return data},
  user:async()=>(await root.SupabaseBrowserClient.getUser())?.id||null
 });
 const disable=()=>{for(const name of ['approve','apply','rollback'])$('migration-'+name).disabled=true};
 function loaded(c){candidate=c;remote=null;disable();$('migration-read').disabled=!!c.blockers.length;$('migration-status').textContent='待核对服务端记录；尚未批准或 Apply。';$('migration-resolutions').replaceChildren();$('migration-phrase').value=''}
 function show(v){
  remote=v;disable();
  if(!v){$('migration-status').textContent='没有当前账户可访问的迁移记录。请勿使用本地 approval 代替远端审批。';return}
  const labels={staged:'待用户批准',approved:v.readyToApply?'已批准 · Ready to apply':'已批准 · Apply blocked（版本或活动任务冲突）',applied:'远端已切换 · 返回个股页接收版本',rolled_back:'已恢复旧版本',superseded:'旧审批已失效 · 需要批准新的审批包'};
  $('migration-status').textContent=labels[v.status]+'；版本代数 '+v.generation;
  $('migration-approve').disabled=v.status!=='staged';$('migration-apply').disabled=!v.readyToApply;$('migration-rollback').disabled=v.status!=='applied'||v.dailyAdvanced;
  const box=$('migration-resolutions');box.replaceChildren();
  if(v.status==='staged')for(const key of v.candidate.reviewItems){const label=doc.createElement('label');label.textContent='审阅项：'+key;const input=doc.createElement('textarea');input.dataset.reviewItem=key;input.setAttribute('aria-label',key);box.append(label,input)}
  $('migration-phrase').placeholder=v.status==='applied'?`Rollback ${v.currentVersion} to ${v.previousVersion}`:'Approve candidate '+v.candidateHash;
 }
 async function run(action){
  if(busy||!candidate)return;busy=true;disable();
  try{
   if(action==='read'){
    const v=await client.read(candidate.symbol,'read');
    if(v&&['candidateHash','contentHash','approvalPackageHash'].some(k=>v[k]!==candidate[k]))throw Error('远端与文件的审批包不一致，请载入最终审批包。');
    // Review authoritative staged data, not claims in the uploaded local file.
    if(v)root.ProviderRebaseReview.render(v.candidate);
    show(v);return;
   }
   if(!remote)throw Error('请先核对远端记录');
   const extra={};
   if(action==='approve'){
    extra.phrase=$('migration-phrase').value;extra.provider=remote.targetSourceContract.canonicalProvider;
    extra.resolutions=Object.fromEntries([...doc.querySelectorAll('[data-review-item]')].map(e=>[e.dataset.reviewItem,e.value.trim()]));
   }else if(action==='apply'){
    if(!remote.readyToApply)throw Error('当前不允许 Apply');
    if(!root.confirm('确认对 '+remote.symbol+' 切换已批准的完整行情版本？不会自动执行交易或 AI。'))return;
   }else if(action==='rollback'){
    extra.expectedCurrentVersion=remote.currentVersion;extra.expectedGeneration=remote.generation;
    extra.phrase=$('migration-phrase').value;extra.reason=$('migration-reason').value.trim();
   }
   show(await client.command(action,remote,extra));$('migration-phrase').value='';
  }catch(error){remote=null;disable();$('migration-status').textContent='未完成：'+String(error.message||'连接失败')+'。请重新核对远端状态。'}finally{busy=false}
 }
 for(const action of ['read','approve','apply','rollback'])$('migration-'+action).addEventListener('click',()=>run(action));
 root.SupabaseBrowserClient.onAuthStateChange(()=>{remote=null;disable();$('migration-status').textContent='账户状态已变化，请重新核对远端记录。'});
 root.ProviderMigrationReviewActions={loaded};
})(window);
