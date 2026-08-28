(function(root,factory){
  const api=factory(root||{});
  if(typeof module==='object'&&module.exports)module.exports=api;
  if(root)root.ClipboardUtils=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(root){
  'use strict';

  const FAILURE_MESSAGE='复制失败，请长按复制';

  function asElement(value,doc){
    if(typeof value==='function')return value()||null;
    if(typeof value==='string'&&doc&&typeof doc.querySelector==='function')return doc.querySelector(value);
    return value||null;
  }

  function reveal(element,details){
    if(details)details.open=true;
    if(!element)return;
    try{element.focus({preventScroll:true})}catch(_){try{element.focus()}catch(_error){}}
    try{element.select()}catch(_){}
    try{if(typeof element.setSelectionRange==='function')element.setSelectionRange(0,String(element.value||'').length)}catch(_){}
  }

  function remove(element){
    if(!element)return;
    if(typeof element.remove==='function')element.remove();
    else if(element.parentNode)element.parentNode.removeChild(element);
  }

  function createTemporaryTextarea(doc,text){
    const field=doc.createElement('textarea');
    field.value=text;
    field.readOnly=true;
    field.setAttribute('aria-hidden','true');
    field.setAttribute('tabindex','-1');
    const style=field.style||{};
    style.position='fixed';style.left='0';style.top='0';style.width='1px';style.height='1px';
    style.padding='0';style.border='0';style.opacity='0.01';style.pointerEvents='none';
    doc.body.appendChild(field);
    return field;
  }

  function showManualCopy(text,options={}){
    const doc=options.document||root.document;
    if(!doc||!doc.body||typeof doc.createElement!=='function')return null;
    let overlay=doc.getElementById&&doc.getElementById('clipboardManualCopyDialog');
    if(!overlay){
      overlay=doc.createElement('div');
      overlay.id='clipboardManualCopyDialog';
      overlay.className='modal-bg import-layer clipboard-manual-copy';
      overlay.setAttribute('role','dialog');
      overlay.setAttribute('aria-modal','true');
      overlay.setAttribute('aria-labelledby','clipboardManualCopyTitle');
      const modal=doc.createElement('div');modal.className='modal';
      const title=doc.createElement('h2');title.id='clipboardManualCopyTitle';title.textContent=FAILURE_MESSAGE;
      const note=doc.createElement('div');note.className='modal-sub';note.textContent='请在下方文本中长按选择并复制。';
      const row=doc.createElement('div');row.className='form-row';
      const field=doc.createElement('textarea');field.id='clipboardManualCopyText';field.readOnly=true;field.setAttribute('aria-label','待手动复制的文本');field.style.minHeight='180px';field.style.fontFamily='ui-monospace,SFMono-Regular,Menlo,Consolas,monospace';field.style.fontSize='12px';
      const actions=doc.createElement('div');actions.className='modal-actions';
      const close=doc.createElement('button');close.type='button';close.className='btn ghost';close.textContent='关闭';
      close.addEventListener('click',()=>overlay.classList.remove('show'));
      overlay.addEventListener('click',event=>{if(event.target===overlay)overlay.classList.remove('show')});
      row.appendChild(field);actions.appendChild(close);modal.appendChild(title);modal.appendChild(note);modal.appendChild(row);modal.appendChild(actions);overlay.appendChild(modal);doc.body.appendChild(overlay);
    }
    const field=doc.getElementById('clipboardManualCopyText');
    if(field)field.value=String(text??'');
    overlay.classList.add('show');
    reveal(field,null);
    try{if(field&&typeof field.scrollIntoView==='function')field.scrollIntoView({block:'center'})}catch(_){}
    return field;
  }

  async function copyTextWithFallback(text,options={}){
    const value=String(text??''),doc=options.document||root.document,nav=options.navigator||root.navigator;
    const diagnostics=[];
    let modernError=null;
    if(nav&&nav.clipboard&&typeof nav.clipboard.writeText==='function'){
      try{
        await nav.clipboard.writeText(value);
        return {ok:true,method:'clipboard'};
      }catch(error){modernError=error;diagnostics.push({stage:'clipboard',code:'rejected',error})}
    }else{
      modernError=new Error('Clipboard API unavailable');
      diagnostics.push({stage:'clipboard',code:'unavailable',error:modernError});
    }

    let field=asElement(options.selectableElement,doc),details=asElement(options.detailsElement,doc),temporary=false,fallbackError=null;
    try{
      if(!doc||!doc.body||typeof doc.execCommand!=='function')throw new Error('execCommand unavailable');
      if(!field){field=createTemporaryTextarea(doc,value);temporary=true}
      else{
        field.value=value;
        const connected=typeof field.isConnected==='boolean'?field.isConnected:(doc.documentElement&&typeof doc.documentElement.contains==='function'?doc.documentElement.contains(field):true);
        if(!connected)doc.body.appendChild(field);
      }
      reveal(field,details);
      if(doc.execCommand('copy')!==true)throw new Error('execCommand returned false');
      if(temporary)remove(field);
      return {ok:true,method:'execCommand',diagnostics};
    }catch(error){
      fallbackError=error;
      diagnostics.push({stage:'execCommand',code:/unavailable/i.test(String(error&&error.message))?'unavailable':/returned false/i.test(String(error&&error.message))?'returned_false':'threw',error});
      if(temporary)remove(field);
    }

    if(field&&!temporary){
      reveal(field,details);
      try{if(typeof field.scrollIntoView==='function')field.scrollIntoView({block:'center'})}catch(_){}
    }else if(options.manualCopy!==false)showManualCopy(value,{document:doc});
    return {ok:false,error:fallbackError||modernError,diagnostics};
  }

  return Object.freeze({copyTextWithFallback,showManualCopy,FAILURE_MESSAGE});
});
