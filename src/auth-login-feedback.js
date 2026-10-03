(function(root,factory){
  const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.AuthLoginFeedback=api;
})(typeof window!=='undefined'?window:globalThis,function(){
  'use strict';
  const messages=Object.freeze({invalid_credentials:'邮箱或密码不正确。',email_unconfirmed:'该账户的邮箱尚未完成确认，请先完成邮箱确认。',rate_limited:'尝试次数过多，请稍后再试。',network:'无法连接登录服务，请检查网络后重试。',service:'登录服务暂时不可用，请稍后再试。',unknown:'登录未完成，请重试。'});
  const codes=new Set(['invalid_credentials','email_not_confirmed','over_request_rate_limit','over_email_send_rate_limit','request_timeout','unexpected_failure']);
  let diagnostic=null;
  function validate(email,password){
    if(typeof email!=='string'||!email.trim())return '请输入邮箱。';
    if(typeof password!=='string'||!password.length)return '请输入密码。';
    return '';
  }
  function classify(error){
    const code=codes.has(error?.code)?error.code:null;
    const status=Number.isInteger(error?.status)&&error.status>=0&&error.status<=599?error.status:null;
    let category='unknown';
    if(code==='invalid_credentials')category='invalid_credentials';
    else if(code==='email_not_confirmed')category='email_unconfirmed';
    else if(status===429||code==='over_request_rate_limit'||code==='over_email_send_rate_limit')category='rate_limited';
    else if(status>=500||code==='unexpected_failure')category='service';
    else if(status===0||status===408||code==='request_timeout'||['AuthRetryableFetchError','AbortError','TimeoutError'].includes(error?.name)
      ||error?.name==='TypeError'&&['Failed to fetch','Load failed','Network request failed','fetch failed'].includes(error?.message))category='network';
    return {category,message:messages[category],code,status};
  }
  function capture(error){
    const result=classify(error);
    // One in-memory allowlisted diagnostic; never retain the error object or credentials.
    diagnostic=Object.freeze({timestamp:new Date().toISOString(),operation:'sign_in',code:result.code,status:result.status,category:result.category});
    return result;
  }
  return Object.freeze({validate,classify,capture,clear(){diagnostic=null},getDiagnostic(){return diagnostic?{...diagnostic}:null}});
});
