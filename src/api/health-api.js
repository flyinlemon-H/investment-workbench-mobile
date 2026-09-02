(function(root){
  const namespace=root.InvestmentApi=root.InvestmentApi||{};

  async function check(options={}){
    const client=options.client||namespace.client;
    if(!client||typeof client.getJson!=='function'){
      throw namespace.errors.create('configuration_error','API client is unavailable.');
    }
    const permission=typeof client.localNetworkPermissionState==='function'?await client.localNetworkPermissionState(options):'unsupported';
    if(permission==='denied')throw namespace.errors.create('permission_error','Local network access permission was denied.');
    if(permission==='prompt'&&options.userInitiated!==true)throw namespace.errors.create('permission_error','Local network access permission is required.');
    const response=await client.getJson('/health',options);
    const services=new Set(['investment-analysis-backend','investment-ai-bridge']);
    const valid=response&&response.status==='ok'&&services.has(response.service)&&typeof response.environment==='string'&&response.environment.trim();
    if(!valid)throw namespace.errors.create('invalid_response','Backend health response is invalid.');
    const capabilities=response.capabilities&&typeof response.capabilities==='object'&&!Array.isArray(response.capabilities)?response.capabilities:{};
    return Object.freeze({status:'ok',service:response.service,version:typeof response.version==='string'?response.version:'',environment:response.environment,permission,capabilities:Object.freeze({aiRequest:capabilities.aiRequest===true})});
  }

  async function permissionState(options={}){
    const client=options.client||namespace.client;
    return client&&typeof client.localNetworkPermissionState==='function'?client.localNetworkPermissionState(options):'unsupported';
  }

  namespace.health=Object.freeze({check,permissionState});
})(window);
