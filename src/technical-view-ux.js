(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  if(root)root.TechnicalViewUx=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';

  const TREND_LABELS=Object.freeze({
    uptrend:'上升趋势',
    downtrend:'下降趋势',
    sideways:'震荡',
    recovery:'修复',
    rebound:'反弹',
    unclear:'不明确'
  });
  const RISK_LEVEL_LABELS=Object.freeze(['正常','轻度','中等','较高']);
  const PROVIDER_LABELS=Object.freeze({eastmoney:'东方财富',yahoo:'雅虎财经'});

  function text(value){return String(value??'').trim()}
  function dateOnly(value){
    const match=text(value).match(/^(\d{4}-\d{2}-\d{2})/);
    return match?match[1]:'';
  }
  function timestampMs(value){
    const raw=text(value);
    if(!raw)return NaN;
    const normalized=raw.replace(/(\.\d{3})\d+(?=(?:Z|[+-]\d{2}:\d{2})$)/,'$1');
    return Date.parse(normalized);
  }
  function taskStatusPresentation(task,{now=Date.now(),maxAgeHours=96,overdueGraceHours=12}={}){
    if(!task||typeof task!=='object'||task.task_exists!==true||task.enabled!==true){
      return {kind:'unknown',label:'暂无可靠任务状态',result:'暂无可靠记录',current:false};
    }
    const run=task.latest_run&&typeof task.latest_run==='object'?task.latest_run:{};
    const nowMs=now instanceof Date?now.getTime():Number(now);
    const evidenceMs=timestampMs(run.finished_at||task.last_run_time||task.generated_at);
    const snapshotMs=timestampMs(task.generated_at);
    const nextRunMs=timestampMs(task.next_run_time);
    const maximumAge=maxAgeHours*60*60*1000;
    const overdueGrace=overdueGraceHours*60*60*1000;
    const recent=Number.isFinite(nowMs)&&Number.isFinite(evidenceMs)&&nowMs>=evidenceMs&&nowMs-evidenceMs<=maximumAge
      &&(!Number.isFinite(snapshotMs)||(nowMs>=snapshotMs&&nowMs-snapshotMs<=maximumAge))
      &&(!Number.isFinite(nextRunMs)||nowMs<=nextRunMs+overdueGrace);
    const taskResult=task.last_task_result;
    const failed=run.status==='failed'||(taskResult!==null&&taskResult!==undefined&&Number(taskResult)!==0&&Number(taskResult)!==267009);
    const succeeded=run.status==='success'&&(taskResult===null||taskResult===undefined||Number(taskResult)===0);
    if(failed&&recent)return {kind:'failed',label:'最近更新失败',result:'最近运行失败',current:true};
    if(!recent&&failed)return {kind:'old',label:'自动更新状态较旧',result:'历史记录为失败',current:false};
    if(succeeded&&recent)return {kind:'normal',label:'自动更新正常',result:'最近运行成功',current:true};
    if(succeeded)return {kind:'old',label:'自动更新状态较旧',result:'历史记录为成功',current:false};
    return {kind:'unknown',label:'暂无可靠任务状态',result:'暂无可靠记录',current:false};
  }
  function technicalReviewBasisNotice(review,technicalDate){
    const reviewDate=dateOnly(review&&review.updatedAt);
    const factsDate=dateOnly(technicalDate);
    if(!reviewDate||!factsDate||reviewDate<=factsDate)return '';
    return `AI 判断基于截至 ${factsDate.slice(5)} 的技术数据`;
  }
  function localDate(value){
    if(typeof value==='string')return dateOnly(value);
    const date=value instanceof Date?value:new Date(value);
    if(Number.isNaN(date.getTime()))return '';
    const part=number=>String(number).padStart(2,'0');
    return `${date.getFullYear()}-${part(date.getMonth()+1)}-${part(date.getDate())}`;
  }
  function businessDaysSince(startDate,endDate){
    const start=Date.parse(`${startDate}T00:00:00Z`),end=Date.parse(`${endDate}T00:00:00Z`);
    if(!Number.isFinite(start)||!Number.isFinite(end)||start>end)return NaN;
    let days=0;
    for(let cursor=start+86400000;cursor<=end;cursor+=86400000){
      const weekday=new Date(cursor).getUTCDay();
      if(weekday!==0&&weekday!==6)days+=1;
    }
    return days;
  }
  function lastCompleteBarDate(history){
    return (Array.isArray(history)?history:[])
      .filter(row=>row&&row.is_complete_bar!==false&&dateOnly(row.date))
      .map(row=>dateOnly(row.date))
      .sort()
      .at(-1)||'';
  }
  function localizeTrend(value){return TREND_LABELS[text(value)]||'不明确'}
  function riskLevelNumber(score){
    const value=Number(score)||0;
    if(value>=7)return 3;
    if(value>=4)return 2;
    if(value>=2)return 1;
    return 0;
  }
  function localizeRiskLevel(value,{score=false}={}){
    const level=score?riskLevelNumber(value):Math.max(0,Math.min(3,Number(value)||0));
    return RISK_LEVEL_LABELS[level];
  }
  function localizeProvider(value){
    const raw=text(value);
    return PROVIDER_LABELS[raw.toLowerCase()]||raw||'未知';
  }
  function localizeMachineSignal(value){
    const raw=text(value);
    if(!raw)return '';
    if(!/[A-Za-z]/.test(raw))return raw;
    const compact=raw.replace(/\s+/g,' ').toLowerCase();
    if(compact.includes('currentprice > ma20 > ma60'))return '现价位于 MA20、MA60 上方，且 MA20 高于 MA60，中期结构偏强';
    if(compact.includes('currentprice > ma60')&&compact.includes('ma20 >= ma60'))return '现价位于 MA60 上方，且 MA20 不低于 MA60，均线结构中性偏强';
    if(compact.includes('currentprice < ma20')&&compact.includes('< ma60'))return '现价同时低于 MA20、MA60，短中期结构偏弱';
    if(compact.includes('currentprice < ma120'))return '现价位于 MA120 下方，中长期结构偏弱';
    return '技术信号已记录，请结合均线与关键位置复核';
  }
  function localizeUserText(value){
    const raw=text(value);
    if(!raw)return '';
    if(/currentPrice\s*[<>]/i.test(raw))return localizeMachineSignal(raw);
    const level=value=>localizeRiskLevel(Number(value));
    return raw
      .replace(/Batch Contract V2/gi,'技术分析')
      .replace(/\binvalid_schema\b/gi,'数据格式异常')
      .replace(/\buptrend\b/gi,TREND_LABELS.uptrend)
      .replace(/\bdowntrend\b/gi,TREND_LABELS.downtrend)
      .replace(/\bsideways\b/gi,TREND_LABELS.sideways)
      .replace(/\brecovery\b/gi,TREND_LABELS.recovery)
      .replace(/\brebound\b/gi,TREND_LABELS.rebound)
      .replace(/\bunclear\b/gi,TREND_LABELS.unclear)
      .replace(/\bLevel\s*([0-3])\b/gi,(_,value)=>level(value))
      .replace(/\beastmoney\b/gi,PROVIDER_LABELS.eastmoney)
      .replace(/\bvalid\b/gi,'有效')
      .replace(/\bcurrentPrice\b/g,'现价')
      .replace(/\bma(5|10|20|60|120)\b/gi,(_,period)=>`MA${period}`);
  }
  function canonicalTechnicalDate({technicalData={},priceHistory=[],referenceDate=new Date()}={}){
    const technicalAsOf=dateOnly(technicalData.technicalAsOf);
    const latestCompleteBar=dateOnly(technicalData.latestCompleteBar);
    const historyLastDate=lastCompleteBarDate(priceHistory);
    const comparisons=[latestCompleteBar,historyLastDate].filter(Boolean);
    const conflict=Boolean(technicalAsOf&&comparisons.some(value=>value!==technicalAsOf));
    const incomplete=!technicalAsOf||!latestCompleteBar||!historyLastDate;
    const rawStatus=text(technicalData.technicalDataStatus)||'unavailable';
    const reference=localDate(referenceDate);
    const ageInBusinessDays=technicalAsOf&&reference?businessDaysSince(technicalAsOf,reference):NaN;
    const futureDate=Boolean(technicalAsOf&&reference&&technicalAsOf>reference);
    const staleByAge=Number.isFinite(ageInBusinessDays)&&ageInBusinessDays>3;
    const stale=rawStatus==='stale'||staleByAge;
    const anomaly=rawStatus==='anomaly'||futureDate||conflict||incomplete;
    const fresh=rawStatus==='fresh'&&!anomaly&&!staleByAge;
    let label='技术数据日期待确认',date='',warning='缺少完整的技术数据日期，请先更新日K与技术数据';
    if(conflict||futureDate){warning='技术数据日期不一致，请先更新技术数据';}
    else if(!incomplete&&stale){label='技术数据截至';date=technicalAsOf;warning='技术数据可能已过期';}
    else if(!incomplete&&fresh){label='技术数据最新至';date=technicalAsOf;warning='';}
    else if(!incomplete){label='技术数据截至';date=technicalAsOf;warning=text(technicalData.technicalWarning)||'技术数据状态异常，请谨慎使用';}
    return {date,label,warning,status:fresh?'fresh':(stale&&!anomaly?'stale':'anomaly'),fresh,stale:stale&&!anomaly,conflict,incomplete,technicalAsOf,latestCompleteBar,historyLastDate,ageInBusinessDays};
  }

  return Object.freeze({
    TREND_LABELS,RISK_LEVEL_LABELS,PROVIDER_LABELS,dateOnly,lastCompleteBarDate,
    taskStatusPresentation,technicalReviewBasisNotice,
    localizeTrend,riskLevelNumber,localizeRiskLevel,localizeProvider,
    localizeMachineSignal,localizeUserText,canonicalTechnicalDate
  });
});
