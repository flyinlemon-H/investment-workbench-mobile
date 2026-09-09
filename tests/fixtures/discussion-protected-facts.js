'use strict';
// Synthetic regression values only; no user investment data or model calls.
const F=require('./discussion-reliability.js');
const cases=Object.freeze({price:'若跌破 50 元则重新复核风险',percentage:'建议减仓 20%',shares:'当前持有 100 股',quantity:'拟买卖数量为 200 股',date:'2026-09-09 技术结构恶化'});
const qualitative='若关键防守结构进一步失守，则重新复核风险';
const fields=['headline','holding.summary','positionDirection.summary','addAssessment.summary','warning.summary','warning.items','takeProfit.summary','stopLoss.summary'];
function output(prepared,wording=qualitative,field='warning.summary'){
  const raw=F.judgment(prepared),parts=field.split('.');let target=raw.currentState.userDecision;
  for(const part of parts.slice(0,-1))target=target[part];
  target[parts.at(-1)]=parts.at(-1)==='items'?[wording]:wording;
  return raw;
}
module.exports={...F,cases,qualitative,fields,output};
