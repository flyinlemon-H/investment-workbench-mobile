'use strict';
// Opt-in supplement: only disposable accounts created for this test project.
const fs=require('node:fs'),cp=require('node:child_process'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const {createClient}=require('@supabase/supabase-js');
const TARGET='lblyapnsngqnjimgskkp',KEY='sb_publishable_6bk0BQjpjcfNuUZKxdoy7w_Vhws9KSx',URL=`https://${TARGET}.supabase.co`;
if(process.env.MARKET_REMOTE_ACCEPTANCE!==TARGET)throw Error('Explicit test project opt-in required');
const accounts=JSON.parse(cp.execFileSync('python',['-B','-c',"from pathlib import Path;from scripts.fetch_cloud_universe import protect;print(protect(Path('test-results/market-remote/accounts.bin').read_bytes(),decrypt=True).decode())"],{encoding:'utf8',windowsHide:true}));
const client=createClient(URL,KEY,{auth:{persistSession:false,autoRefreshToken:false}}),checks=[];
const check=(name,value)=>{assert(value,name);checks.push({name,passed:true});console.log(JSON.stringify({name,passed:true}))};
async function account(action,input){const {data,error}=await client.rpc('market_data_account',{p_action:action,p_input:input});if(error)throw Error(error.message);return data}
const token=crypto.randomBytes(32).toString('hex');
async function worker(action,input){const r=await fetch(`${URL}/rest/v1/rpc/market_data_worker`,{method:'POST',headers:{apikey:KEY,'Content-Type':'application/json'},body:JSON.stringify({p_token:token,p_action:action,p_input:input}),signal:AbortSignal.timeout(20000)});return {status:r.status,data:await r.json()}}
(async()=>{let status='failed';try{
 const a=accounts.find(a=>a.label==='owner'),login=await client.auth.signInWithPassword({email:a.email,password:a.password});assert(!login.error,'real login');
 const previous=await account('read',{symbol:'601869.SS'});assert.equal(previous.status,'succeeded');const before=JSON.stringify(previous.result);
 await account('register_worker',{token});const task=await account('request',{symbol:'601869.SS',taskType:'UPDATE_DAILY_MARKET_DATA'});assert.equal((await worker('claim',{})).data.taskId,task.taskId);
 const bad=structuredClone(previous.result);bad.taskId=bad.resultVersion=task.taskId;bad.stock.priceHistory.at(-1).is_complete_bar=false;
 const rejected=await worker('finish',{taskId:task.taskId,result:bad});check('incomplete_result_rejected',rejected.status>=400&&rejected.data.message==='invalid_bar');
 check('rejected_finish_remains_running',(await account('read',{taskId:task.taskId})).status==='running');
 check('rejected_finish_preserves_previous',JSON.stringify((await account('read',{taskId:previous.taskId})).result)===before);
 const rotation=await client.rpc('market_data_account',{p_action:'register_worker',p_input:{token:crypto.randomBytes(32).toString('hex')}});check('rotation_while_running_denied',rotation.error?.message==='worker_busy');
 await account('revoke_worker',{});const revoked=await account('read',{taskId:task.taskId});check('revoke_running_marks_failed',revoked.status==='failed'&&revoked.error==='worker_revoked');
 check('revoked_capability_cannot_finish',(await worker('finish',{taskId:task.taskId,error:'late'})).status>=400);
 check('revocation_preserves_valid_result',JSON.stringify((await account('read',{taskId:previous.taskId})).result)===before);
 status='passed';
}catch(error){console.error(String(error.message));process.exitCode=1}finally{
 await account('revoke_worker',{}).catch(()=>{});await client.auth.signOut({scope:'global'});
 fs.writeFileSync('test-results/market-remote/security-results.json',JSON.stringify({projectId:TARGET,status,checks,completedAt:new Date().toISOString()},null,2));
}})();
