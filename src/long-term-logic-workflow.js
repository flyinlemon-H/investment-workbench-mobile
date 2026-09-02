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
        updatedAt:context.promptDate,validUntil:addDays(context.promptDate,180),investmentThesis:'必须同时概括行业长期逻辑、公司专属护城河和组合角色价值。',
        coreDrivers:['行业长期驱动','公司专属驱动','组合角色驱动'],industryDrivers:['行业未来 3-10 年的长期驱动'],companyDrivers:['公司优先受益的专属护城河'],portfolioDrivers:['当前组合角色的长期价值'],
        fundamentalSupport:'用 1-2 句话说明已有基本面资料如何辅助验证长期逻辑。',longTermRisks:['可能破坏长期逻辑的行业或公司风险'],logicStatus:'valid',confidence:'medium',nextReviewDate:addDays(context.promptDate,90),sourceSummary:'概括本次判断使用的资料范围。'
      }
    };
    const binding={symbol:context.symbol,contextHash:context.contextHash,promptDate:context.promptDate};
    return [
      '你是一名谨慎的长期投资逻辑整理助手。','',`请整理【${name}】（代码：【${symbol}】）的长期逻辑。`,'','本任务用于月度、季度或财报后低频更新，不关注单日涨跌。','',
      '【受保护绑定】',JSON.stringify(binding),'','必须原样返回 binding.symbol 与 binding.contextHash；不得修改、猜测或省略。','',
      '【当前系统已有信息】',JSON.stringify(context.input,null,2),'','长期逻辑只回答“为什么长期持有”，不要写成财报分析、估值分析或短线技术分析。','',
      '长期逻辑必须体现三层结构：','第一层：行业未来 3-10 年的长期价值。','第二层：公司专属护城河；无法确认时降低 confidence，禁止编造。','第三层：当前组合角色的长期价值。','',
      'investmentThesis 必须同时包含行业逻辑、公司护城河和组合价值。','industryDrivers、companyDrivers、portfolioDrivers、coreDrivers、longTermRisks 均至少返回一项非空内容。','fundamentalSupport 只用 1-2 句话概括基本面辅助验证，不展开财务或估值数字。','longTermRisks 只写长期失效风险，禁止写 MA、MACD、RSI、KDJ、分时、盘口、主力资金或短线追涨。','',
      `updatedAt 必须为 ${context.promptDate}。nextReviewDate 不得早于 updatedAt；validUntil 不得早于 nextReviewDate。所有日期必须是有效的 YYYY-MM-DD。`,
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
