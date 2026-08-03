function getRebalanceAction(s,info,total){
  if(!info||info.deviation===null||info.status==='balanced'||info.status==='no-price'||info.status==='no-total')return null;
  const unitPrice=getComparablePrice(s);
  if(!unitPrice||unitPrice<=0)return null;
  const unitCny=toCNY(unitPrice,s);
  const targetMv=total*info.target/100;
  const deltaMv=info.mv-targetMv;
  const rawShares=deltaMv/unitCny;
  const rounded=Math.round(rawShares/100)*100;
  if(Math.abs(rounded)<100)return null;
  return {shares:Math.abs(rounded),money:Math.abs(rounded*unitCny),direction:rounded>0?'sell':'buy',unitPrice,currency:getCurrency(s)};
}
function inferTriggerOn(currentPrice,targetPrice,action){
  const cp=Number(currentPrice),tp=Number(targetPrice);
  if(isNaN(cp)||cp<=0||isNaN(tp)||tp<=0){
    // 没有当前价信息时按传统默认
    return action==='sell'?'above':'below';
  }
  // 目标价 > 当前价 → 等涨上去触发；反之等跌下来触发
  return tp>cp?'above':'below';
}
function planGap(cp,tp,action,triggerOn){
  if(cp==null)return null;
  const t=Number(tp);
  if(isNaN(t)||t<=0)return null;
  const isBuy=(action||'buy')==='buy';
  // 优先用显式 triggerOn；没有则按当前价 vs 目标价自动推断（兜底）
  const direction=triggerOn||(t>cp?'above':'below');
  const triggered=direction==='below'?cp<=t:cp>=t;
  const pct=direction==='below'?(cp-t)/cp*100:(t-cp)/cp*100;
  return {triggered,pct,absPct:Math.abs(pct),isBuy,direction};
}
function stockUrgency(s){const cp=getComparablePrice(s);if(cp==null)return {score:Infinity,triggered:0,nearest:null};let minAbs=Infinity,triggered=0,nearest=null;for(const p of (s.plans||[])){const g=planGap(cp,p.price,p.action,p.triggerOn);if(!g)continue;if(g.triggered)triggered++;if(g.absPct<minAbs){minAbs=g.absPct;nearest=g}}if(minAbs===Infinity)return {score:Infinity,triggered:0,nearest:null};return {score:triggered>0?-1000+minAbs:minAbs,triggered,nearest}}
function executePlan(stockId,planId){const s=state.stocks.find(x=>x.id===stockId);if(!s)return;const p=(s.plans||[]).find(x=>x.id===planId);if(!p)return;const isBuy=(p.action||'buy')==='buy';const verb=isBuy?'加仓':'减仓';const total=getEstimatedTotalAssets();let warn='';if(total>0){const mvNow=getMarketValue(s)||0;const amt=toCNY(p.price*p.shares,s);const pctAfter=(mvNow+(isBuy?amt:-amt))/total*100;if(isBuy){const cap=Number(s.capPct),trim=Number(s.trimPct);if(cap>0&&pctAfter>=cap)warn+=`\n✖ 买入后「${s.name}」约 ${pctAfter.toFixed(1)}%，已达冻结线 ${cap}% —— 按手册规则不应执行！`;else if(trim>0&&pctAfter>=trim)warn+=`\n⚠ 买入后「${s.name}」约 ${pctAfter.toFixed(1)}%，已达削减线 ${trim}%`;const lim=((state.portfolioStrategy||{}).themeLimits||{})[s.theme];if(lim){const themeMv=state.stocks.filter(x=>!isCashRow(x)&&(x.theme||'其他')===s.theme).reduce((a,x)=>a+(getMarketValue(x)||0),0)+amt;const tp=themeMv/total*100;const soft=Number(lim.softLimitPct),hard=Number(lim.hardLimitPct);if(hard>0&&tp>=hard)warn+=`\n✖ 买入后「${s.theme}」主题约 ${tp.toFixed(1)}%，已达硬上限 ${hard}%`;else if(soft>0&&tp>=soft)warn+=`\n⚠ 买入后「${s.theme}」主题约 ${tp.toFixed(1)}%，已达软上限 ${soft}%`}if(hasCashRow()){const minCash=Number(((state.portfolioStrategy||{}).minimumCashPct)||(((state.portfolioStrategy||{}).cashRule||{}).minimumCashPct)||0);const cashAfter=(getCashMv()-amt)/total*100;if(minCash>0&&cashAfter<minCash)warn+=`\n⚠ 买入后现金约 ${cashAfter.toFixed(1)}%，低于 ${minCash}% 底线（手册：仅多标的同时进入战略买点可短期至10%）`}}else{const trim=Number(s.trimPct);if(trim>0&&pctAfter>=trim)warn+=`\n提示：卖出后「${s.name}」仍约 ${pctAfter.toFixed(1)}%（≥削减线 ${trim}%），可考虑加大卖出数量`}}const msg=`确认已执行「${s.name}」的${verb}计划？\n\n  目标价 ${p.price} × ${p.shares} 股${p.note?'\n  备注：'+p.note:''}${warn?'\n\n—— 纪律检查 ——'+warn:''}\n\n执行后这条计划将从列表中删除。`;if(!confirm(msg))return;const sh0=Number(s.shares)||0;const newShares=isBuy?sh0+p.shares:Math.max(0,sh0-p.shares);const auto=confirm(`是否自动更新持仓与现金台账？\n\n  股数/份额：${fmtInt(sh0)} → ${fmtInt(newShares)}${isBuy?'\n  成本价：按 '+p.price+' 加权摊入':'\n  成本价：保持不变'}${s.type==='etf'?'\n  当前市值：按 价格×数量 同步调整':''}${hasCashRow()?'\n  现金台账：'+(isBuy?'扣减':'增加')+' 约 '+fmtMoney(toCNY(p.price*p.shares,s)):''}\n\n点「取消」则仅删除计划，持仓需自行到「编辑」更新。`);const today=new Date().toISOString().slice(0,10);if(auto){const oc=Number(s.avgCost);if(isBuy){if(sh0>0&&!isNaN(oc)&&oc>0)s.avgCost=Number((((oc*sh0)+(p.price*p.shares))/newShares).toFixed(4));else s.avgCost=p.price}s.shares=newShares;if(s.type==='etf'){const cv=Number(s.currentValue)||0;s.currentValue=Number(Math.max(0,cv+(isBuy?1:-1)*p.price*p.shares).toFixed(2));s.valueUpdatedAt=today}const cashRow=state.stocks.find(isCashRow);if(cashRow){const amt2=toCNY(p.price*p.shares,s);const cv2=Number(cashRow.currentValue)||0;cashRow.currentValue=Number((cv2+(isBuy?-amt2:amt2)).toFixed(2));cashRow.valueUpdatedAt=today;cashRow.updatedAt=Date.now()}}(state.executionLog=state.executionLog||[]).push({t:Date.now(),stock:s.name,action:isBuy?'buy':'sell',price:p.price,shares:p.shares,autoUpdated:!!auto,note:p.note||''});s.plans=(s.plans||[]).filter(x=>x.id!==planId);s.updatedAt=Date.now();saveState();render()}
