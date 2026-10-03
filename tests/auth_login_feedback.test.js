'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const feedback=require('../src/auth-login-feedback.js');
test('login requires email and password independently',()=>{
  assert.equal(feedback.validate('  ','present'),'请输入邮箱。');
  assert.equal(feedback.validate('fixture@example.invalid',''),'请输入密码。');
});
for(const size of [1,6,7,8])test(`existing ${size}-character login password is not a creation-policy check`,()=>assert.equal(feedback.validate('fixture@example.invalid','x'.repeat(size)),''));
const cases=[
  [{code:'invalid_credentials',status:400},'invalid_credentials','邮箱或密码不正确。'],
  [{code:'email_not_confirmed',status:400},'email_unconfirmed','该账户的邮箱尚未完成确认，请先完成邮箱确认。'],
  [{status:429},'rate_limited','尝试次数过多，请稍后再试。'],
  [{code:'over_request_rate_limit'},'rate_limited','尝试次数过多，请稍后再试。'],
  [{code:'over_email_send_rate_limit'},'rate_limited','尝试次数过多，请稍后再试。'],
  [{name:'AuthRetryableFetchError',status:0},'network','无法连接登录服务，请检查网络后重试。'],
  [{name:'TypeError',message:'Load failed'},'network','无法连接登录服务，请检查网络后重试。'],
  [{name:'TypeError',message:'Failed to fetch'},'network','无法连接登录服务，请检查网络后重试。'],
  [{name:'AbortError'},'network','无法连接登录服务，请检查网络后重试。'],
  [{name:'TimeoutError'},'network','无法连接登录服务，请检查网络后重试。'],
  [{code:'request_timeout'},'network','无法连接登录服务，请检查网络后重试。'],
  [{name:'AuthRetryableFetchError',status:503},'service','登录服务暂时不可用，请稍后再试。'],
  [{status:500},'service','登录服务暂时不可用，请稍后再试。'],
  [{code:'unexpected_failure'},'service','登录服务暂时不可用，请稍后再试。'],
  [{name:'TypeError',message:'unexpected client state'},'unknown','登录未完成，请重试。'],
  [{code:'user_not_found',status:400},'unknown','登录未完成，请重试。'],
  [null,'unknown','登录未完成，请重试。']
];
for(const [error,category,message] of cases)test(`safe category ${category}: ${JSON.stringify(error)}`,()=>assert.deepEqual(feedback.classify(error),{category,message,code:['invalid_credentials','email_not_confirmed','over_request_rate_limit','over_email_send_rate_limit','request_timeout','unexpected_failure'].includes(error?.code)?error.code:null,status:Number.isInteger(error?.status)?error.status:null}));
test('diagnostics allowlist fields and values, never retain or log raw payloads',()=>{
  const secret='PRIVATE_FIXTURE_PAYLOAD',error={code:secret,name:secret,status:secret,message:secret,stack:secret,email:secret,password:secret,access_token:secret,refresh_token:secret,session:{secret}};
  const result=feedback.capture(error),diagnostic=feedback.getDiagnostic();
  assert.deepEqual(Object.keys(diagnostic).sort(),['category','code','operation','status','timestamp']);
  assert.equal(diagnostic.operation,'sign_in');assert.equal(diagnostic.category,'unknown');assert.equal(diagnostic.code,null);assert.equal(diagnostic.status,null);
  assert(!JSON.stringify({result,diagnostic}).includes(secret));assert(Number.isFinite(Date.parse(diagnostic.timestamp)));
  diagnostic.category=secret;assert.equal(feedback.getDiagnostic().category,'unknown');feedback.clear();assert.equal(feedback.getDiagnostic(),null);
});
