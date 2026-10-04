(function(root,factory){
  const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;
  if(root)root.MarketDataOrchestrator=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  const TYPE='UPDATE_DAILY_MARKET_DATA',SYMBOL=/^(?:[0-9]{6}\.(?:SS|SZ)|[0-9]{4,5}\.HK)$/;
  function request(symbol){if(typeof symbol!=='string'||!SYMBOL.test(symbol))throw Error('invalid_symbol');return {taskType:TYPE,symbol}}
  function errorLabel(code){return ({PROVIDER_SWITCH:'本次行情来源与历史不同，需复核来源后更新。',PROVIDER_REBASE_REQUIRED:'历史行情含多个来源，需要先完成来源重建复核。',SAME_PROVIDER_REVISION:'检测到同一行情源的历史复权数据发生修订，需要复核后更新。',UNIT_CONTRACT_INCOMPLETE:'历史行情已发生修订，但数据单位尚未完成验证，暂不能应用。',REVISION_SUSPECTED:'历史行情完整性待复核，已保留原数据。',SOURCE_CONTRACT_MISMATCH:'行情来源契约不一致，已停止更新。',UNKNOWN_CONTINUITY_RISK:'无法确认历史行情连续性，已停止更新。',REVISION_PROBE_FAILED:'完整历史探测失败，已保留原数据。',UNSAFE_WRITE_PATH_BLOCKED:'此写入路径未通过历史修订校验，已阻止覆盖。',provider_or_pipeline_failure:'行情来源暂时不可用，请稍后重试',provider_mismatch:'本次行情来源与历史不同，已保留原数据；请在执行端检查数据来源',adjustment_mismatch:'复权口径不一致，已保留原数据',adjustment_revision_requires_full_rebuild:'历史复权价格发生变化，请在执行端重建一致历史后重试',worker_lease_expired:'执行端未在限定时间内完成，可重试',worker_revoked:'执行端授权已撤销',pipeline_failure:'行情处理失败，已保留原数据',invalid_ohlc:'行情价格校验失败，已保留原数据',unaligned_result:'行情与指标日期不一致，已保留原数据'})[code]||'行情更新未完成，请检查执行端后重试'}
  function presentation(task,applied=false){
    if(!task)return '尚未请求更新';
    if(task.status==='failed'&&['SAME_PROVIDER_REVISION','UNIT_CONTRACT_INCOMPLETE','REVISION_SUSPECTED','PROVIDER_REBASE_REQUIRED'].includes(task.error))return '历史行情待复核，原有效数据已保留';
    return {queued:'等待执行端',running:'正在更新行情',failed:'更新失败',succeeded:applied?`行情已更新至 ${task.result?.latestCompleteBar||task.latestCompleteBar||''}`:'结果已生成，正在同步'}[task.status]||'任务状态待确认';
  }
  function validateResult(task,result){
    if(task.status!=='succeeded'||!result||result.schemaVersion!==1||result.taskId!==task.taskId||result.resultVersion!==task.resultVersion||result.symbol!==task.symbol||!SYMBOL.test(result.symbol))throw Error('result_identity_mismatch');
    const stock=result.stock,rows=stock?.priceHistory;
    if(!stock||stock.symbol!==result.symbol||!Array.isArray(rows)||!rows.length||rows.length>3000)throw Error('invalid_result');
    let last='';
    for(const bar of rows){
      if(bar.is_complete_bar!==true||!/^\d{4}-\d{2}-\d{2}$/.test(bar.date)||bar.date<=last||bar.adjustment!=='qfq'||bar.price_basis!=='adjusted'||bar.provider!==result.provider||['open','high','low','close'].some(k=>typeof bar[k]!=='number'||!Number.isFinite(bar[k])||bar[k]<=0)||bar.high<Math.max(bar.open,bar.close,bar.low)||bar.low>Math.min(bar.open,bar.close))throw Error('invalid_complete_bar');
      last=bar.date;
    }
    if([result.latestCompleteBar,result.technicalAsOf,stock.marketDataFreshness?.last_trade_date,stock.technicalIndicators?.last_trade_date].some(d=>d!==last))throw Error('unaligned_result');
    return stock;
  }
  function createClient({rpc,user,apply,changed=()=>{}}){
    const views=new Map(),inflight=new Map();
    const key=(owner,symbol)=>owner+':'+symbol;
    async function call(action,input,owner){
      const response=await rpc(action,input);
      if(await user()!==owner)throw Error('account_changed');
      if(response&&response.requestedBy!==owner)throw Error('task_owner_mismatch');
      return response;
    }
    async function sync(symbol,create=false){
      request(symbol);const owner=await user();if(!owner)throw Error('请先在账户设置中登录');
      const id=key(owner,symbol),pending=inflight.get(id);
      if(pending){
        if(!create||pending.create)return pending.promise;
        // A status read must not swallow a user's explicit update request.
        try{await pending.promise}catch(_error){}
        if(await user()!==owner)throw Error('account_changed');
        return sync(symbol,true);
      }
      const operation=(async()=>{
        let task=await call(create?'request':'read',create?request(symbol):{symbol},owner);
        if(!task){views.delete(id);changed();return null}
        if(task.symbol!==symbol)throw Error('task_symbol_mismatch');
        let applied=false;
        if(task.status==='succeeded'){
          if(!task.result)task=await call('read',{taskId:task.taskId},owner);
          const snapshot=validateResult(task,task.result);
          await apply(snapshot,task.result,owner);applied=true;
        }
        views.set(id,{task,applied,error:''});changed();return task;
      })().catch(error=>{const old=views.get(id)||{};views.set(id,{...old,error:error.message||'连接失败，请重试'});changed();throw error}).finally(()=>inflight.delete(id));
      inflight.set(id,{promise:operation,create});return operation;
    }
    return {sync,view:(owner,symbol)=>views.get(key(owner,symbol))||null,clear:()=>{views.clear();changed()}};
  }
  return {TYPE,request,presentation,errorLabel,validateResult,createClient};
});
