/* Acceptance-only prelude. Never include in production index or publish manifest. */
(function productionOriginAcceptanceHarness(global){
  'use strict';
  const prefix='__pc_ai_acceptance_20260902__';
  const mainKey=prefix+'portfolio_manual_v502_network_price_20260610';
  const marker='chrome-local-overrides-long-term-v1';
  const allowed=location.origin==='https://flyinlemon-h.github.io'
    ||location.origin==='http://127.0.0.1:8768';
  if(!allowed)throw new Error('Acceptance bundle is not allowed on this Origin.');
  const originalGet=Storage.prototype.getItem;
  const originalSet=Storage.prototype.setItem;
  const originalRemove=Storage.prototype.removeItem;
  let writes=0,blocked=0,baseline=null,pasteProof=null;
  function requireTestName(name){
    if(!String(name).startsWith(prefix)){
      blocked++;throw new Error('Acceptance guard blocked non-test storage access.');
    }
  }
  // Forward only namespaced operations to real browser storage. Never clear/enumerate
  // production storage; counters increment only after native setItem succeeds.
  Storage.prototype.getItem=function(key){requireTestName(key);return originalGet.call(this,key)};
  Storage.prototype.setItem=function(key,value){
    requireTestName(key);originalSet.call(this,key,value);
    if(this===global.localStorage&&key===mainKey)writes++;
  };
  Storage.prototype.removeItem=function(key){requireTestName(key);return originalRemove.call(this,key)};
  Storage.prototype.clear=function(){blocked++;throw new Error('Acceptance guard forbids clear().')};
  Storage.prototype.key=function(){blocked++;throw new Error('Acceptance guard forbids enumeration.')};
  for(const method of ['open','deleteDatabase']){
    const original=global.indexedDB[method].bind(global.indexedDB);
    global.indexedDB[method]=function(name,...args){requireTestName(name);return original(name,...args)};
  }
  function read(){
    const value=JSON.parse(global.localStorage.getItem(mainKey));
    if(!value||value.acceptanceFixture!==marker)throw new Error('Unknown test data; refusing to continue.');
    return value;
  }
  if(global.localStorage.getItem(mainKey)===null){
    global.localStorage.setItem(mainKey,JSON.stringify({
      acceptanceFixture:marker,updatedAt:Date.now(),stocks:[{
        id:'long-term-browser-fixture',name:'长期逻辑验收样例',code:'601138.SS',symbol:'601138.SS',
        type:'watching',role:'观察仓',theme:'验收样例',shares:0,avgCost:0,plans:[],
        longTermLogic:{updatedAt:'2026-06-01',validUntil:'2026-12-01',
          investmentThesis:'原有行业长期需求与公司竞争力共同支持组合观察角色。',
          coreDrivers:['原有长期需求'],industryDrivers:['原有行业需求'],
          companyDrivers:['原有公司竞争力'],portfolioDrivers:['原有组合观察角色'],
          fundamentalSupport:'原有资料仅作辅助验证。',longTermRisks:['原有行业长期风险'],
          logicStatus:'valid',confidence:'medium',nextReviewDate:'2026-09-01',
          sourceSummary:'隔离的非生产验收样例。'}
      }]
    }));
  }
  read();
  global.addEventListener('DOMContentLoaded',()=>{
    const panel=document.createElement('details');panel.id='pcAiAcceptance';panel.open=true;
    panel.style.cssText='margin:8px;padding:12px;border:3px solid #a44d00;background:#fff7d6;color:#302500;position:relative;z-index:9000';
    panel.innerHTML='<summary><strong>本机 Local Overrides 验收 · 独立测试存储 · 非正式资产</strong></summary>'
      +'<p>真实 fetch / LNA / 剪贴板未替换。只操作合成样例；业务校验和保存使用待发布代码。</p>'
      +'<button type="button" id="pcAiCheckpoint">记录验收检查点</button> '
      +'<button type="button" id="pcAiInspect">比较验收存储</button> '
      +'<button type="button" id="pcAiPermission">读取 LNA 权限状态</button>'
      +'<pre id="pcAiReport" style="white-space:pre-wrap;overflow-wrap:anywhere;max-height:300px;overflow:auto"></pre>'
      +'<label>原生剪贴板验收：点应用的“复制给AI”，再亲自按 Ctrl+V 粘贴到这里。'
      +'<textarea id="pcAiNativePaste" aria-label="原生剪贴板验收粘贴区" style="width:100%;height:80px"></textarea></label>'
      +'<button type="button" id="pcAiCheckPaste">核对原生粘贴内容</button>'
      +'<pre id="pcAiPasteReport" style="white-space:pre-wrap;overflow-wrap:anywhere"></pre>';
    document.body.prepend(panel);
    function report(){
      const value=read(),stock=value.stocks.find(item=>item.id==='long-term-browser-fixture');
      document.getElementById('pcAiReport').textContent=JSON.stringify({
        origin:location.origin,namespace:prefix,mainStorageWritesSinceCheckpoint:writes,
        unchangedSinceCheckpoint:baseline===null?null:baseline===global.localStorage.getItem(mainKey),
        blockedNonTestStorageAccess:blocked,updatedAt:value.updatedAt,
        shares:stock.shares,plans:stock.plans,logic:stock.longTermLogic,audit:stock.longTermLogicAudit
      },null,2);
    }
    document.getElementById('pcAiCheckpoint').onclick=()=>{baseline=global.localStorage.getItem(mainKey);writes=0;report()};
    document.getElementById('pcAiInspect').onclick=report;
    document.getElementById('pcAiPermission').onclick=async()=>{
      const values={};
      for(const name of ['loopback-network','local-network','local-network-access']){
        try{values[name]=(await navigator.permissions.query({name})).state}catch(error){values[name]=error.name}
      }
      document.getElementById('pcAiPasteReport').textContent=JSON.stringify(values,null,2);
    };
    const textarea=document.getElementById('pcAiNativePaste');
    textarea.addEventListener('paste',event=>{
      pasteProof={trusted:event.isTrusted,text:event.clipboardData&&event.clipboardData.getData('text/plain')};
    });
    document.getElementById('pcAiCheckPaste').onclick=()=>{
      const stock=read().stocks.find(item=>item.id==='long-term-browser-fixture');
      const expected=prepareLongTermLogic(stock).prompt;
      document.getElementById('pcAiPasteReport').textContent=JSON.stringify({
        trustedPasteEvent:!!(pasteProof&&pasteProof.trusted),
        eventTextMatchesVisibleText:!!(pasteProof&&pasteProof.text===textarea.value),
        matchesCurrentSharedPrompt:textarea.value===expected,
        visibleCharacters:textarea.value.length,
        note:'Also record whether the paste was user/native input; automation virtual clipboard alone is not native proof.'
      },null,2);
    };
    report();
  });
})(window);
