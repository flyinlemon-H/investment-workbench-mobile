(function(root){
  'use strict';
  function renderUniverseCloudStatus(){
    const el=document.getElementById('universeCloudStatus');if(!el||!root.UniverseAutoAdd)return;
    const status=root.UniverseAutoAdd.status();
    const messages={auth_required:'本地数据可正常使用，登录后自动同步新增股票',pending:`股票已保存在本机，${status.pending}只等待同步`,offline:'股票已保存在本机，等待联网同步',error:'股票已保存在本机，清单同步需重试',synced:status.synced?'新增股票清单已同步':'当前没有待同步的新增股票'};
    let text=messages[status.state]||messages.pending;
    const bridge=root.MARKET_DATA_BRIDGE;
    const rows=typeof state!=='undefined'?root.UniverseHandoff.universeRows(state.stocks):[];
    if(status.state==='synced'&&rows.length){
      const confirmed=root.UniverseHandoff.acknowledgedSymbols(bridge);
      const waiting=rows.filter(row=>!confirmed.has(row.symbol)).length;
      if(waiting)text+=`，${waiting}只等待 PC 更新行情`;
      else{
        const dates=(bridge&&bridge.stocks||[]).filter(row=>rows.some(item=>item.symbol===row.symbol)).map(row=>row.marketDataFreshness&&row.marketDataFreshness.last_trade_date).filter(Boolean).sort();
        if(dates.length)text+=` · 行情已就绪，日K截至 ${dates[0]}`;
      }
    }
    el.textContent=text;
    const login=document.getElementById('universeLoginFields'),account=document.getElementById('universeAccountActions');
    if(login)login.hidden=status.signedIn;if(account)account.hidden=!status.signedIn;
  }
  function dialog(){
    let modal=document.getElementById('universeSyncDialog');if(modal)return modal;
    modal=document.createElement('div');modal.id='universeSyncDialog';modal.className='modal-bg';
    modal.innerHTML='<div class="modal universe-sync-modal"><h2>新增股票自动同步</h2><p>只同步股票代码和首次名称。持仓、计划和分析仍保存在本机。</p><div id="universeLoginFields"><label>邮箱<input id="universeEmail" type="email" autocomplete="username"></label><label>密码<input id="universePassword" type="password" autocomplete="current-password" minlength="8"></label><div class="modal-actions"><button class="btn ghost" id="universeSignup">注册</button><button class="btn" id="universeLogin">登录</button></div><p class="hint">首次注册需确认邮件，之后可在手机保持登录。</p></div><div id="universeAccountActions" hidden><button class="btn ghost" id="universeSignout">退出此设备登录</button><details><summary>连接 PC 行情任务</summary><p>首次连接时生成仅能读取股票清单的配置，有效期 180 天。到期前可重新生成并更新 PC；可随时撤销。</p><button class="btn ghost" id="universeIssueReader">生成 PC 只读配置</button><textarea id="universeReaderConfig" readonly hidden aria-label="PC 只读配置" spellcheck="false"></textarea><p id="universeReaderHelp" hidden>请在 PC 项目目录运行 python scripts/fetch_cloud_universe.py --configure，粘贴此配置。不要保存到 Git 或分享给他人；关闭窗口后这里会清除配置。</p><button class="btn ghost" id="universeListReaders">查看已连接 PC</button><div id="universeReaders"></div></details></div><p id="universeAuthMessage" role="status"></p><div class="modal-actions"><button class="btn ghost" id="universeFileFallback">导出文件交接</button><button class="btn" id="universeRetry">立即同步</button><button class="btn ghost" id="universeClose">关闭</button></div></div>';
    document.body.appendChild(modal);
    const message=document.getElementById('universeAuthMessage');
    async function action(button,work){button.disabled=true;message.textContent='处理中…';try{message.textContent=await work()||''}catch(_error){message.textContent='操作未完成，请检查邮箱、密码或网络后重试。本地股票数据不受影响。'}finally{button.disabled=false;renderUniverseCloudStatus()}}
    for(const [id,register] of [['universeLogin',false],['universeSignup',true]])document.getElementById(id).onclick=event=>action(event.target,async()=>{
      const email=document.getElementById('universeEmail').value.trim(),password=document.getElementById('universePassword').value;
      if(!email||password.length<8)return '请填写有效邮箱及至少 8 位密码。';
      try{if(register){const logged=await root.UniverseAutoAdd.signUp(email,password);return logged?'已登录，待同步项目将自动重试。':'请在邮件中确认邮箱，再回到这里登录。'}await root.UniverseAutoAdd.signIn(email,password);return '已登录，待同步项目将自动重试。'}finally{document.getElementById('universePassword').value=''}
    });
    document.getElementById('universeSignout').onclick=event=>action(event.target,async()=>{await root.UniverseAutoAdd.signOut();return '已退出此设备登录，本地数据保留。'});
    document.getElementById('universeRetry').onclick=event=>action(event.target,async()=>{await root.UniverseAutoAdd.retry();return '同步状态已更新。'});
    document.getElementById('universeIssueReader').onclick=event=>action(event.target,async()=>{
      const config=await root.UniverseAutoAdd.issueReader(),box=document.getElementById('universeReaderConfig');
      box.value=JSON.stringify(config);box.hidden=false;document.getElementById('universeReaderHelp').hidden=false;return 'PC 配置已生成，仅用于读取你的股票清单。';
    });
    document.getElementById('universeListReaders').onclick=event=>action(event.target,async()=>{
      const rows=await root.UniverseAutoAdd.readers(),list=document.getElementById('universeReaders');list.replaceChildren();
      for(const row of rows){const line=document.createElement('p'),text=document.createElement('span'),button=document.createElement('button');text.textContent=`${row.label} · 到期 ${String(row.expiresAt).slice(0,10)} `;button.className='btn ghost small';button.textContent='撤销';button.onclick=event=>action(event.target,async()=>{await root.UniverseAutoAdd.revokeReader(row.id);line.remove();return '该 PC 凭据已撤销，股票清单未改变。'});line.append(text,button);list.appendChild(line)}
      return rows.length?'':'尚未连接 PC。';
    });
    function close(){modal.classList.remove('show');document.getElementById('universeReaderConfig').value='';document.getElementById('universeReaderConfig').hidden=true;document.getElementById('universeReaderHelp').hidden=true;document.getElementById('universePassword').value=''}
    document.getElementById('universeClose').onclick=close;
    document.getElementById('universeFileFallback').onclick=()=>{close();if(typeof handoffUniverseToPc==='function')void handoffUniverseToPc()};
    return modal;
  }
  root.renderUniverseCloudStatus=renderUniverseCloudStatus;
  root.openUniverseSyncSettings=()=>{dialog().classList.add('show');renderUniverseCloudStatus()};
})(window);
