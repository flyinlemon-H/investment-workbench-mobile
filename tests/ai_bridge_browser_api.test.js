'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

const root=path.resolve(__dirname,'..');
const read=file=>fs.readFileSync(path.join(root,file),'utf8');

function runtime(overrides={}){
  const context={
    console,URL,AbortController,setTimeout,clearTimeout,
    BACKEND_CONFIG:{baseUrl:'http://127.0.0.1:18765'},
    crypto:{randomUUID:()=> 'request-fixed'},
    navigator:{permissions:{query:async()=>({state:'granted'})}},
    ...overrides
  };
  context.window=context;context.globalThis=context;
  vm.createContext(context);
  for(const file of ['src/api/api-errors.js','src/api/api-client.js','src/api/health-api.js','src/api/ai-api.js'])vm.runInContext(read(file),context,{filename:file});
  return context;
}

function response(status,payload){return {ok:status>=200&&status<300,status,text:async()=>typeof payload==='string'?payload:JSON.stringify(payload)}}

test('AI browser transport posts the exact V1 envelope with matching loopback address-space metadata',async()=>{
  let call;
  const app=runtime({fetch:async(url,init)=>{call={url,init};return response(200,{requestId:'request-fixed',provider:'deepseek',model:'deepseek-v4-flash',content:'{"raw":true}',elapsedMs:41})}});
  const result=await app.InvestmentApi.ai.request({taskType:'long_term_logic',prompt:'prompt body',responseFormat:'text'});
  assert.equal(call.url,'http://127.0.0.1:18765/ai/request');
  assert.equal(call.init.method,'POST');assert.equal(call.init.credentials,'omit');assert.equal(call.init.cache,'no-store');assert.equal(call.init.targetAddressSpace,'loopback');
  assert.deepEqual(JSON.parse(call.init.body),{requestId:'request-fixed',taskType:'long_term_logic',prompt:'prompt body',responseFormat:'text'});
  assert.equal(call.init.headers.Accept,'application/json');assert.equal(call.init.headers['Content-Type'],'application/json');
  assert.equal(app.InvestmentApi.client.aiTimeoutMs,75000);assert.equal(result.response.content,'{"raw":true}');
});

test('permission query prefers loopback-network and falls back only when unsupported',async()=>{
  const queried=[];
  const modern=runtime({navigator:{permissions:{query:async({name})=>{queried.push(name);return {state:'granted'}}}}});
  assert.equal(await modern.InvestmentApi.client.localNetworkPermissionState(),'granted');
  assert.deepEqual(queried,['loopback-network']);
  queried.length=0;
  const legacy=runtime({navigator:{permissions:{query:async({name})=>{queried.push(name);if(name==='loopback-network')throw new TypeError('unsupported');return {state:'denied'}}}}});
  assert.equal(await legacy.InvestmentApi.client.localNetworkPermissionState(),'denied');
  assert.deepEqual(queried,['loopback-network','local-network-access']);
  const unsupported=runtime({navigator:{permissions:{query:async()=>{throw new TypeError('unsupported')}}}});
  assert.equal(await unsupported.InvestmentApi.client.localNetworkPermissionState(),'unsupported');
});

test('AI browser transport rejects unsupported requests and non-exact bridge responses',async()=>{
  let calls=0;
  const app=runtime({fetch:async()=>{calls++;return response(200,{requestId:'request-fixed',provider:'deepseek',model:'deepseek-v4-flash',content:'{}',elapsedMs:1,unexpected:true})}});
  await assert.rejects(()=>app.InvestmentApi.ai.request({taskType:'portfolio_review',prompt:'x'}),error=>error.type==='invalid_response');
  assert.equal(calls,0);
  await assert.rejects(()=>app.InvestmentApi.ai.request({taskType:'long_term_logic',prompt:'x'}),error=>error.type==='invalid_response');
  assert.equal(calls,1);
});

test('browser client classifies HTTP, invalid JSON, network, permission, and timeout failures',async()=>{
  const http=runtime({fetch:async()=>response(503,{error:'provider_unavailable'})});
  await assert.rejects(()=>http.InvestmentApi.client.getJson('/health'),error=>error.type==='http_error'&&error.status===503&&error.retryable===true);
  const invalid=runtime({fetch:async()=>response(200,'not-json')});
  await assert.rejects(()=>invalid.InvestmentApi.client.getJson('/health'),error=>error.type==='invalid_response');
  const network=runtime({fetch:async()=>{throw new TypeError('failed')}});
  await assert.rejects(()=>network.InvestmentApi.client.getJson('/health'),error=>error.type==='network_error');
  const denied=runtime({navigator:{permissions:{query:async()=>({state:'denied'})}},fetch:async()=>{throw new TypeError('failed')}});
  await assert.rejects(()=>denied.InvestmentApi.client.getJson('/health'),error=>error.type==='permission_error');
  const timeout=runtime({fetch:(_url,init)=>new Promise((_resolve,reject)=>init.signal.addEventListener('abort',()=>reject(new Error('aborted'))))});
  await assert.rejects(()=>timeout.InvestmentApi.client.getJson('/health',{timeoutMs:5}),error=>error.type==='timeout_error');
});

test('health exposes aiRequest capability and never probes while permission is only prompt without a user action',async()=>{
  let calls=0;
  const client={
    localNetworkPermissionState:async()=> 'prompt',
    getJson:async()=>{calls++;return {status:'ok',service:'investment-ai-bridge',version:'1.0.0',environment:'local',capabilities:{aiRequest:true}}}
  };
  const app=runtime();
  await assert.rejects(()=>app.InvestmentApi.health.check({client}),error=>error.type==='permission_error');
  assert.equal(calls,0);
  const result=await app.InvestmentApi.health.check({client,userInitiated:true});
  assert.equal(calls,1);assert.equal(result.permission,'prompt');assert.equal(result.capabilities.aiRequest,true);
  assert.doesNotMatch(read('src/app.js'),/void\s+checkBackendHealth\s*\(/);
});

test('browser client refuses non-loopback, credentialed, and path-confused backend configuration',()=>{
  for(const baseUrl of ['https://127.0.0.1:18765','http://192.168.1.10:18765','http://user:pass@127.0.0.1:18765','http://127.0.0.1:18765/base']){
    const app=runtime({BACKEND_CONFIG:{baseUrl}});
    assert.throws(()=>app.InvestmentApi.client.requestUrl('/health'),error=>error.type==='configuration_error');
  }
});
