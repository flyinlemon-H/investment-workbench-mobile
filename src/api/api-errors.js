(function(root){
  const namespace=root.InvestmentApi=root.InvestmentApi||{};
  const TYPES=new Set([
    'configuration_error',
    'permission_error',
    'network_error',
    'timeout_error',
    'http_error',
    'invalid_response',
    'unknown_error'
  ]);
  const MESSAGES=Object.freeze({
    configuration_error:'Backend configuration is invalid.',
    permission_error:'Local network access permission is required.',
    network_error:'Backend is unreachable.',
    timeout_error:'Backend request timed out.',
    http_error:'Backend request failed.',
    invalid_response:'Backend returned an invalid response.',
    unknown_error:'API request failed.'
  });

  function create(type,_message,options={}){
    const safeType=TYPES.has(type)?type:'unknown_error';
    const status=Number.isInteger(options.status)?options.status:null;
    const retryable=typeof options.retryable==='boolean'
      ?options.retryable
      :['network_error','timeout_error'].includes(safeType)||(safeType==='http_error'&&status!==null&&status>=500);
    return Object.freeze({
      name:'InvestmentApiError',
      type:safeType,
      message:MESSAGES[safeType],
      status,
      retryable
    });
  }

  function isApiError(value){
    return Boolean(value&&value.name==='InvestmentApiError'&&TYPES.has(value.type));
  }

  function normalize(error){
    if(isApiError(error))return error;
    return create('unknown_error','API request failed.');
  }

  namespace.errors=Object.freeze({create,isApiError,normalize});
})(window);
