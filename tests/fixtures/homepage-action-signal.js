'use strict';
const F=require('./homepage-attention.js');
const section=(status,summary)=>({status,summary});
function shapes(){
  const a=F.state({id:'shape-a',code:'600101.SS',name:'持有样本甲'},{userDecision:{positionDirection:section('hold_no_add','目前不需要主动减仓。'),addAssessment:section('wait','加仓条件尚未成熟。'),takeProfit:section('watch','目前尚未进入明显止盈复核阶段。')}}).stocks[0];
  const b=F.state({id:'shape-b',code:'600102.SS',name:'风险样本乙'},{attentionLevel:'focused',userDecision:{holding:section('caution','短期风险需要观察。'),positionDirection:section('hold_no_add','暂不需要主动减仓。'),takeProfit:section('watch','止盈目前不是优先事项。'),riskSource:'stock'}}).stocks[0];
  const c=F.state({id:'shape-c',code:'600103.SS',name:'减仓样本丙'},{attentionLevel:'focused',userDecision:{holding:section('caution','当前宜保持防守。'),positionDirection:section('reduce_review','当前可以考虑减少仓位。'),addAssessment:section('avoid','当前不宜增加仓位。'),takeProfit:section('review','当前需要保护已有利润。'),riskSource:'stock'}}).stocks[0];
  return {...F.state(),stocks:[a,b,c]};
}
module.exports={...F,section,shapes};
