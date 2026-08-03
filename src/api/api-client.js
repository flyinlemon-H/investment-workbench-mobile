(function(root){
  const namespace=root.InvestmentApi=root.InvestmentApi||{};
  const DEFAULT_TIMEOUT_MS=5000;

  function apiError(type,message,options){
    if(!namespace.errors||typeof namespace.errors.create!=='function'){
      return Object.freeze({name:'InvestmentApiError',type:'unknown_error',message:'API request failed.',status:null,retryable:false});
    }
    return namespace.errors.create(type,message,options);
  }

  function configuredBaseUrl(){
    const raw=root.BACKEND_CONFIG&&root.BACKEND_CONFIG.baseUrl;
    if(typeof raw!=='string'||!raw.trim())throw apiError('configuration_error','Backend is not configured.');
    let parsed;
    try{parsed=new URL(raw.trim())}catch(_){throw apiError('configuration_error','Backend configuration is invalid.');}
    const loopback=parsed.hostname==='127.0.0.1'||parsed.hostname==='localhost';
    if(parsed.protocol!=='http:'||!loopback||!parsed.port||parsed.username||parsed.password||parsed.search||parsed.hash||!['','/'].includes(parsed.pathname)){
      throw apiError('configuration_error','Backend configuration is invalid.');
    }
    return parsed.origin;
  }

  function requestUrl(path){
    if(typeof path!=='string'||!path.startsWith('/')||path.startsWith('//')){
      throw apiError('configuration_error','API path is invalid.');
    }
    return configuredBaseUrl()+path;
  }

  async function getJson(path,options={}){
    const url=requestUrl(path);
    const timeoutMs=Number.isFinite(options.timeoutMs)&&options.timeoutMs>0?Number(options.timeoutMs):DEFAULT_TIMEOUT_MS;
    const fetchImpl=typeof options.fetchImpl==='function'?options.fetchImpl:root.fetch;
    if(typeof fetchImpl!=='function'||typeof root.AbortController!=='function'){
      throw apiError('configuration_error','Browser HTTP support is unavailable.');
    }
    const controller=new root.AbortController();
    let timedOut=false;
    const timer=root.setTimeout(()=>{timedOut=true;controller.abort()},timeoutMs);
    try{
      let response;
      try{
        response=await fetchImpl(url,{method:'GET',headers:{Accept:'application/json'},credentials:'omit',cache:'no-store',signal:controller.signal});
      }catch(_){
        if(timedOut)throw apiError('timeout_error','Backend request timed out.');
        throw apiError('network_error','Backend is unreachable.');
      }
      if(!response||typeof response.ok!=='boolean'||!Number.isInteger(response.status)){
        throw apiError('invalid_response','Backend returned an invalid response.');
      }
      if(!response.ok)throw apiError('http_error','Backend request failed.',{status:response.status});
      let text;
      try{text=await response.text()}catch(_){
        if(timedOut)throw apiError('timeout_error','Backend request timed out.');
        throw apiError('invalid_response','Backend response could not be read.');
      }
      try{return JSON.parse(text)}catch(_){throw apiError('invalid_response','Backend returned invalid JSON.');}
    }catch(error){
      throw namespace.errors&&typeof namespace.errors.normalize==='function'?namespace.errors.normalize(error):error;
    }finally{
      root.clearTimeout(timer);
    }
  }

  namespace.client=Object.freeze({getJson,requestUrl,configuredBaseUrl,defaultTimeoutMs:DEFAULT_TIMEOUT_MS});
})(window);
