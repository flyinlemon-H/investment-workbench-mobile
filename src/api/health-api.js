(function(root){
  const namespace=root.InvestmentApi=root.InvestmentApi||{};

  async function check(options={}){
    const client=options.client||namespace.client;
    if(!client||typeof client.getJson!=='function'){
      throw namespace.errors.create('configuration_error','API client is unavailable.');
    }
    const response=await client.getJson('/health',options);
    const valid=response&&response.status==='ok'&&response.service==='investment-analysis-backend'&&typeof response.environment==='string'&&response.environment.trim();
    if(!valid)throw namespace.errors.create('invalid_response','Backend health response is invalid.');
    return Object.freeze({status:'ok',service:'investment-analysis-backend',environment:response.environment});
  }

  namespace.health=Object.freeze({check});
})(window);
