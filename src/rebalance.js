function getRebalanceAction(s,info,total){
  if(!info||info.deviation===null||info.status==='balanced'||info.status==='no-price'||info.status==='no-total')return null;
  const unitPrice=getComparablePrice(s);if(!unitPrice||unitPrice<=0)return null;
  const unitCny=toCNY(unitPrice,s),targetMv=total*info.target/100,deltaMv=info.mv-targetMv,rawShares=deltaMv/unitCny,rounded=Math.round(rawShares/100)*100;
  if(Math.abs(rounded)<100)return null;
  return {shares:Math.abs(rounded),money:Math.abs(rounded*unitCny),direction:rounded>0?'sell':'buy',unitPrice,currency:getCurrency(s)};
}

// 旧计划缺少触发方向时不再根据当前价倒推意图。
function inferTriggerOn(){return null}

function planGap(cp,tp,action,triggerOn){
  if(typeof PlanV2!=='undefined'){
    const evaluation=PlanV2.evaluatePriceTrigger({schemaVersion:'plan.v2',id:'preview',planVersion:1,action,triggerPrice:tp,triggerDirection:triggerOn,status:'active',validityStatus:'active',priceTriggerStatus:'unavailable',fullConditionStatus:'unproven',source:'manual'},cp);
    if(evaluation.status==='unavailable')return null;
    return {triggered:evaluation.status==='triggered',near:evaluation.status==='near',pct:evaluation.distancePct,absPct:evaluation.distancePct,isBuy:['buy','add'].includes(action),direction:evaluation.direction,priceTriggerStatus:evaluation.status};
  }
  const current=Number(cp),target=Number(tp);if(!(current>0)||!(target>0)||!['above','below'].includes(triggerOn))return null;
  const triggered=triggerOn==='below'?current<=target:current>=target,pct=Math.abs(current-target)/target*100;
  return {triggered,pct,absPct:pct,isBuy:action==='buy',direction:triggerOn,priceTriggerStatus:triggered?'triggered':(pct<=5?'near':'not_triggered')};
}

function stockUrgency(s){
  const cp=getComparablePrice(s);if(cp==null)return {score:Infinity,triggered:0,nearest:null};let minAbs=Infinity,triggered=0,nearest=null;
  for(const raw of (s.plans||[])){
    const p=typeof PlanV2!=='undefined'?PlanV2.normalizePlan(raw):raw;
    if(typeof PlanV2!=='undefined'&&!['current','needs_review'].includes(PlanV2.freshness(p)))continue;
    const g=planGap(cp,p.triggerPrice??p.price,p.action,p.triggerDirection??p.triggerOn);if(!g)continue;if(g.triggered)triggered++;if(g.absPct<minAbs){minAbs=g.absPct;nearest=g}
  }
  if(minAbs===Infinity)return {score:Infinity,triggered:0,nearest:null};return {score:triggered>0?-1000+minAbs:minAbs,triggered,nearest};
}

async function executePlan(stockId,planId){
  const sourceStock=state.stocks.find(stock=>stock.id===stockId);if(!sourceStock)return;
  const sourcePlan=(sourceStock.plans||[]).find(plan=>plan.id===planId);if(!sourcePlan)return;
  const plan=typeof PlanV2!=='undefined'?PlanV2.normalizePlan(sourcePlan):sourcePlan,price=Number(plan.triggerPrice??plan.price),quantity=Number(plan.quantity??plan.shares),isBuy=['buy','add'].includes(plan.action),verb=isBuy?'加仓':'减仓';
  if(!(price>0)||!(quantity>0)){alert('该计划的价格或数量不完整，需先复核后再记录执行。');return}
  const total=getEstimatedTotalAssets();let warn='';
  if(total>0){
    const mvNow=getMarketValue(sourceStock)||0,amount=toCNY(price*quantity,sourceStock),pctAfter=(mvNow+(isBuy?amount:-amount))/total*100;
    if(isBuy){
      const cap=Number(sourceStock.capPct),trim=Number(sourceStock.trimPct);if(cap>0&&pctAfter>=cap)warn+=`\n✖ 买入后「${sourceStock.name}」约 ${pctAfter.toFixed(1)}%，已达冻结线 ${cap}% —— 按手册规则不应执行！`;else if(trim>0&&pctAfter>=trim)warn+=`\n⚠ 买入后「${sourceStock.name}」约 ${pctAfter.toFixed(1)}%，已达削减线 ${trim}%`;
      const limit=((state.portfolioStrategy||{}).themeLimits||{})[sourceStock.theme];if(limit){const themeMv=state.stocks.filter(stock=>!isCashRow(stock)&&(stock.theme||'其他')===sourceStock.theme).reduce((sum,stock)=>sum+(getMarketValue(stock)||0),0)+amount,themePct=themeMv/total*100,soft=Number(limit.softLimitPct),hard=Number(limit.hardLimitPct);if(hard>0&&themePct>=hard)warn+=`\n✖ 买入后「${sourceStock.theme}」主题约 ${themePct.toFixed(1)}%，已达硬上限 ${hard}%`;else if(soft>0&&themePct>=soft)warn+=`\n⚠ 买入后「${sourceStock.theme}」主题约 ${themePct.toFixed(1)}%，已达软上限 ${soft}%`}
      if(hasCashRow()){const minimum=Number(((state.portfolioStrategy||{}).minimumCashPct)||(((state.portfolioStrategy||{}).cashRule||{}).minimumCashPct)||0),cashAfter=(getCashMv()-amount)/total*100;if(minimum>0&&cashAfter<minimum)warn+=`\n⚠ 买入后现金约 ${cashAfter.toFixed(1)}%，低于 ${minimum}% 底线`}
    }else{const trim=Number(sourceStock.trimPct);if(trim>0&&pctAfter>=trim)warn+=`\n提示：卖出后「${sourceStock.name}」仍约 ${pctAfter.toFixed(1)}%（≥削减线 ${trim}%）`}
  }
  const message=`确认已执行「${sourceStock.name}」的${verb}计划？\n\n  目标价 ${price} × ${quantity} 股${plan.note?'\n  备注：'+plan.note:''}${warn?'\n\n—— 纪律检查 ——'+warn:''}\n\n执行后计划会保留在“已完成”历史中。`;
  if(!confirm(message))return;
  const oldShares=Number(sourceStock.shares)||0,newShares=isBuy?oldShares+quantity:Math.max(0,oldShares-quantity),auto=confirm(`是否自动更新持仓与现金台账？\n\n  股数/份额：${fmtInt(oldShares)} → ${fmtInt(newShares)}${isBuy?'\n  成本价：按 '+price+' 加权摊入':'\n  成本价：保持不变'}\n\n点「取消」则仅记录计划完成，持仓需自行到“编辑”更新。`),authoritativeState=state;
  const result=await PlanV2.commitCandidate(authoritativeState,candidate=>{
    const stock=candidate.stocks.find(item=>item.id===stockId),index=stock?(stock.plans||[]).findIndex(item=>item.id===planId):-1;if(!stock||index<0)throw new Error('计划候选不存在。');const completed=PlanV2.terminatePlan(stock.plans[index],'completed');stock.plans[index]=completed;
    const today=new Date().toISOString().slice(0,10);
    if(auto){const oldCost=Number(stock.avgCost);if(isBuy){stock.avgCost=oldShares>0&&oldCost>0?Number((((oldCost*oldShares)+(price*quantity))/newShares).toFixed(4)):price}stock.shares=newShares;if(stock.type==='etf'){const currentValue=Number(stock.currentValue)||0;stock.currentValue=Number(Math.max(0,currentValue+(isBuy?1:-1)*price*quantity).toFixed(2));stock.valueUpdatedAt=today}const cashRow=candidate.stocks.find(isCashRow);if(cashRow){const amount=toCNY(price*quantity,stock),cashValue=Number(cashRow.currentValue)||0;cashRow.currentValue=Number((cashValue+(isBuy?-amount:amount)).toFixed(2));cashRow.valueUpdatedAt=today;cashRow.updatedAt=Date.now()}}
    (candidate.executionLog=candidate.executionLog||[]).push({t:Date.now(),stock:stock.name,action:isBuy?'buy':'sell',price,shares:quantity,autoUpdated:Boolean(auto),note:plan.note||'',planId:completed.id,planVersion:completed.planVersion});stock.updatedAt=Date.now();return candidate;
  },{save:candidate=>saveState(candidate,{critical:true}),adopt:candidate=>{state=candidate},rollback:original=>{state=original}});
  if(result.status!=='completed'){if(typeof criticalWriteFailure==='function')criticalWriteFailure(result.error);else alert('保存失败\n\n数据尚未确认保存\n\n请重试');return}render();
}
