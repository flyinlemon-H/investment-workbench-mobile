(function(root){
  'use strict';
  const namespace=root.InvestmentApi=root.InvestmentApi||{};
  const TASK_TYPES=new Set(['long_term_logic']);
  const RESPONSE_FORMAT='text';

  function invalid(message){
    if(namespace.errors&&typeof namespace.errors.create==='function')return namespace.errors.create('invalid_response',message);
    return new Error(message);
  }

  function requestId(){
    if(root.crypto&&typeof root.crypto.randomUUID==='function')return root.crypto.randomUUID();
    return `req_${Date.now()}_${Math.random().toString(36).slice(2,12)}`;
  }

  async function request(input,options={}){
    const client=options.client||namespace.client;
    if(!client||typeof client.postJson!=='function')throw invalid('AI transport is unavailable.');
    const envelope={
      requestId:String(input&&input.requestId||requestId()),
      taskType:String(input&&input.taskType||''),
      prompt:String(input&&input.prompt||''),
      responseFormat:String(input&&input.responseFormat||RESPONSE_FORMAT)
    };
    if(!TASK_TYPES.has(envelope.taskType)||!envelope.prompt.trim()||envelope.responseFormat!==RESPONSE_FORMAT){
      throw invalid('AI request envelope is invalid.');
    }
    const response=await client.postJson('/ai/request',envelope,{...options,timeoutMs:Number.isFinite(options.timeoutMs)?options.timeoutMs:client.aiTimeoutMs});
    const valid=response&&typeof response==='object'&&!Array.isArray(response)&&
      Object.keys(response).every(key=>['requestId','provider','model','content','elapsedMs'].includes(key))&&
      response.requestId===envelope.requestId&&typeof response.provider==='string'&&response.provider.trim()&&
      typeof response.model==='string'&&response.model.trim()&&typeof response.content==='string'&&response.content.trim()&&
      Number.isFinite(response.elapsedMs)&&response.elapsedMs>=0;
    if(!valid)throw invalid('Bridge AI response is invalid.');
    return Object.freeze({request:Object.freeze(envelope),response:Object.freeze({requestId:response.requestId,provider:response.provider,model:response.model,content:response.content,elapsedMs:response.elapsedMs})});
  }

  namespace.ai=Object.freeze({TASK_TYPES:Object.freeze(Array.from(TASK_TYPES)),request,requestId});
})(window);
