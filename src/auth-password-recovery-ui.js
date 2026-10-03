(function(root){
  'use strict';
  const recovery=root.SupabaseBrowserClient.recovery;if(!recovery)return;
  let modal=null,mode='idle',returnFocus=null,revision=0;
  const copy={checking:'正在验证密码重置链接……',ready:'请设置新密码，无需输入旧密码。',updating:'正在更新密码……',expired:'密码重置链接已失效，请重新发送。',success:'密码已更新。你可以继续使用账户及执行端设置。'};
  function clearPasswords(){if(modal)modal.querySelectorAll('input[type=password]').forEach(input=>input.value='')}
  function close(){revision++;clearPasswords();if(modal)modal.classList.remove('show');if(returnFocus?.isConnected)returnFocus.focus()}
  function mount(){
    if(modal)return;
    modal=document.createElement('div');modal.id='passwordRecoveryDialog';modal.className='modal-bg';
    modal.innerHTML='<section class="modal" role="dialog" aria-modal="true" aria-labelledby="passwordRecoveryTitle" style="width:min(100%,440px);box-sizing:border-box;overflow-wrap:anywhere"><h2 id="passwordRecoveryTitle" tabindex="-1"></h2><p id="passwordRecoveryMessage" role="status" aria-live="polite"></p><form id="passwordRecoveryEmailForm" novalidate><label for="passwordRecoveryEmail">恢复邮箱</label><input id="passwordRecoveryEmail" type="email" autocomplete="email" inputmode="email" required style="width:100%;box-sizing:border-box"><div class="modal-actions"><button class="btn" type="submit" id="passwordRecoverySend">发送重置邮件</button></div></form><form id="passwordRecoveryUpdateForm" novalidate><label for="passwordRecoveryNew">新密码</label><input id="passwordRecoveryNew" type="password" autocomplete="new-password" required minlength="8" style="width:100%;box-sizing:border-box"><label for="passwordRecoveryConfirm">确认新密码</label><input id="passwordRecoveryConfirm" type="password" autocomplete="new-password" required minlength="8" style="width:100%;box-sizing:border-box"><p class="hint">至少 8 位；如账户有更高的安全要求，请按提示调整。</p><div class="modal-actions"><button class="btn" type="submit" id="passwordRecoveryUpdate">更新密码</button></div></form><div class="modal-actions" style="flex-wrap:wrap"><button class="btn" id="passwordRecoveryResend" type="button">重新发送重置邮件</button><button class="btn ghost" id="passwordRecoveryClose" type="button">关闭</button></div></section>';
    document.body.appendChild(modal);
    const byId=id=>modal.querySelector('#'+id);
    byId('passwordRecoveryEmailForm').onsubmit=async event=>{
      event.preventDefault();const button=byId('passwordRecoverySend');if(button.disabled)return;const requestRevision=revision;button.disabled=true;message('正在发送请求……');
      try{const text=await recovery.request(byId('passwordRecoveryEmail').value);if(requestRevision===revision){show('sent');message(text)}}catch(error){if(requestRevision===revision)message(error.message)}finally{button.disabled=false}
    };
    byId('passwordRecoveryUpdateForm').onsubmit=async event=>{
      event.preventDefault();const button=byId('passwordRecoveryUpdate');if(button.disabled)return;
      button.disabled=true;
      try{await recovery.update(byId('passwordRecoveryNew').value,byId('passwordRecoveryConfirm').value)}catch(error){message(error.message)}finally{clearPasswords();button.disabled=false}
    };
    byId('passwordRecoveryResend').onclick=()=>openRequest(byId('passwordRecoveryEmail').value);
    byId('passwordRecoveryClose').onclick=async()=>{const button=byId('passwordRecoveryClose');button.disabled=true;try{await recovery.cancel();close()}catch(_error){message('暂时无法退出登录，请联网后重试。')}finally{button.disabled=false}};
    modal.addEventListener('keydown',event=>{
      if(event.key!=='Tab')return;
      const items=[...modal.querySelectorAll('input,button')].filter(el=>!el.disabled&&el.getClientRects().length);
      if(!items.length)return;
      if(event.shiftKey&&(document.activeElement===items[0]||!items.includes(document.activeElement))){event.preventDefault();items.at(-1).focus()}
      else if(!event.shiftKey&&document.activeElement===items.at(-1)){event.preventDefault();items[0].focus()}
    });
  }
  function message(value){modal.querySelector('#passwordRecoveryMessage').textContent=value}
  function show(next){
    mount();const wasOpen=modal.classList.contains('show');if(!wasOpen)returnFocus=document.activeElement;
    revision++;clearPasswords();mode=next;
    const request=next==='request',password=['ready','updating'].includes(next);
    modal.querySelector('#passwordRecoveryTitle').textContent=request||next==='sent'?'找回密码':next==='success'?'密码已更新':next==='expired'?'重置链接已失效':'设置新密码';
    modal.querySelector('#passwordRecoveryEmailForm').hidden=!request;
    modal.querySelector('#passwordRecoveryUpdateForm').hidden=!password;
    modal.querySelector('#passwordRecoveryUpdate').disabled=next==='updating';
    modal.querySelector('#passwordRecoveryResend').hidden=!['expired','sent'].includes(next);
    const cancel=modal.querySelector('#passwordRecoveryClose');cancel.hidden=['checking','updating'].includes(next);cancel.textContent=next==='ready'?'取消并退出登录':next==='success'?'返回应用':'关闭';
    message(copy[next]||(request?'输入注册时使用的邮箱，我们会发送密码重置邮件。':''));
    modal.classList.add('show');
    if(!wasOpen)modal.querySelector('#passwordRecoveryTitle').focus();
  }
  function openRequest(email=''){recovery.reset();show('request');modal.querySelector('#passwordRecoveryEmail').value=email;modal.querySelector('#passwordRecoveryEmail').focus()}
  recovery.subscribe(value=>{if(value.status==='idle'){if(mode!=='idle')close();mode='idle'}else show(value.status)});
  root.addEventListener('pagehide',clearPasswords);
  root.AuthPasswordRecoveryUI=Object.freeze({openRequest});
  void recovery.start();
})(window);
