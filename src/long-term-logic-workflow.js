(function(root,factory){
  const contract=typeof module==='object'&&module.exports?require('./long-term-logic-contract.js'):root&&root.LongTermLogicContract;
  const api=factory(contract);
  if(typeof module==='object'&&module.exports)module.exports=api;
  if(root)root.LongTermLogicWorkflow=Object.freeze(api);
})(typeof globalThis!=='undefined'?globalThis:this,function(LongTermLogicContract){
  'use strict';
  if(!LongTermLogicContract)throw new Error('Long-Term Logic workflow dependency is unavailable.');

  function addDays(dateText,days){const date=new Date(`${dateText}T00:00:00Z`);date.setUTCDate(date.getUTCDate()+days);return date.toISOString().slice(0,10)}
  function buildPrompt(stock,context){
    const name=String(stock&&stock.name||'标的名称'),symbol=context.symbol;
    const example={
      binding:{symbol,contextHash:context.contextHash},
      longTermLogic:{
        investmentThesis:'汽车业务进入兑现期，核心观察销量、毛利改善和高端化是否持续。',
        coreDrivers:['核心产品销量保持增长','毛利率改善能够持续','高端化形成稳定用户认知'],
        keyRisks:['竞争加剧导致利润改善中断','产品节奏失误削弱品牌势能'],
        reviewTriggers:['连续两个报告期毛利率恶化','核心产品销量显著偏离公司指引'],
        logicStatus:'valid',confidence:'medium',nextReviewDate:addDays(context.promptDate,90)
      }
    };
    const binding={symbol:context.symbol,contextHash:context.contextHash,promptDate:context.promptDate};
    return [
      '你是一名谨慎的长期投资逻辑整理助手。','',`请整理【${name}】（代码：【${symbol}】）的长期逻辑。`,'','本任务用于月度、季度或财报后低频更新，不关注单日涨跌。','',
      '【受保护绑定】',JSON.stringify(binding),'','必须原样返回 binding.symbol 与 binding.contextHash；不得修改、猜测或省略。','',
      '【当前系统已有信息】',JSON.stringify(context.input,null,2),'','请为投资手册写结论，不要写成券商研究报告。只保留未来做判断时值得重新看的信息。','',
      'investmentThesis 用 1–3 句概括为什么持有或观察，最多 400 个字符。','coreDrivers、keyRisks、reviewTriggers 各返回 1–5 项，每项只表达一个判断，不得重复。','reviewTriggers 必须写清什么发展会迫使重新审视或放弃逻辑。','禁止输出行业/公司/组合三套重叠驱动，禁止长篇基本面报告、通用背景、套话和免责声明。','keyRisks 与 reviewTriggers 禁止写 MA、MACD、RSI、KDJ、分时、盘口、主力资金或短线追涨。','',
      `nextReviewDate 不得早于 ${context.promptDate}，且必须是有效的 YYYY-MM-DD。判断日期由程序记录，AI 不得输出 updatedAt、validUntil 或其他时间戳。`,
      `logicStatus 只能为 ${LongTermLogicContract.LOGIC_STATUSES.join(' / ')}。`,`confidence 只能为 ${LongTermLogicContract.CONFIDENCE_LEVELS.join(' / ')}。`,'',
      '只输出一个严格 JSON 对象；顶层只能包含 binding 和 longTermLogic。','不得缺少字段，不得增加字段。','不要 Markdown 代码围栏，不要额外解释。','JSON 结构键和值必须使用英文半角双引号 "；字符串正文可以正常使用中文标点和中文引号。','',
      '【严格输出结构示例】',JSON.stringify(example,null,2)
    ].join('\n');
  }
  function prepare(stock,options={}){
    const context=LongTermLogicContract.prepareContext(stock,{promptDate:options.promptDate,input:options.input});
    return Object.freeze({context,prompt:buildPrompt(stock,context)});
  }
  function processLongTermLogicResponse(raw,context){return LongTermLogicContract.process(raw,{context})}
  function processPrepared(raw,prepared){return processLongTermLogicResponse(raw,prepared&&prepared.context)}
  return Object.freeze({buildPrompt,prepare,processLongTermLogicResponse,processPrepared});
});
