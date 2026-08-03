function targetSum(filter){return state.stocks.filter(filter).reduce((a,b)=>a+(Number(b.targetPct)||0),0)}
function plansCount(type){return state.stocks.reduce((a,s)=>a+(s.plans||[]).filter(p=>type==='buy'?(p.action||'buy')==='buy':p.action==='sell').length,0)}
function daysSince(dateStr){if(!dateStr)return null;const t=new Date(dateStr+'T00:00:00').getTime();if(isNaN(t))return null;return Math.floor((Date.now()-t)/86400000)}
function freshnessLabel(dateStr){const d=daysSince(dateStr);if(d===null)return '未记录更新';if(d<=7)return '新';if(d<=30)return '可参考';return '已过期'}
function freshnessText(dateStr){const d=daysSince(dateStr);if(d===null)return '未记录更新';return `更新 ${esc(dateStr)} · ${freshnessLabel(dateStr)}${d>30?' · 建议更新':''}`}
function getCurrentPrice(s){if(s.type==='etf')return null;const v=s.currentPrice;if(v===''||v===null||v===undefined)return null;const n=Number(v);return (isNaN(n)||n<=0)?null:n}
function getComparablePrice(s){
  if(!s)return null;
  if(s.type==='etf'){
    const unit=Number(s.lastUnitPrice);
    if(unit>0&&isFinite(unit))return unit;
    const value=Number(s.currentValue),shares=Number(s.shares);
    if(value>0&&shares>0&&isFinite(value)&&isFinite(shares))return value/shares;
    return null;
  }
  return getCurrentPrice(s);
}
function getMarketValue(s){if(s.type==='etf'){const v=Number(s.currentValue);return (isNaN(v)||v<=0)?null:toCNY(v,s)}const shares=Number(s.shares),cp=Number(s.currentPrice);if(isNaN(shares)||isNaN(cp)||shares<=0||cp<=0)return null;return toCNY(shares*cp,s)}
function getTotalInvested(){return state.stocks.reduce((sum,s)=>sum+(getMarketValue(s)||0),0)}
function isCashRow(s){return s.id==='cash'||s.theme==='现金'||s.role==='现金'}
function getCashMv(){return state.stocks.filter(isCashRow).reduce((a,s)=>a+(getMarketValue(s)||0),0)}
function hasCashRow(){return state.stocks.some(isCashRow)}
function getTrimAction(s,info,total){if(!info||info.actualPct===null||!total)return null;const trim=Number(s.trimPct);if(!(trim>0)||info.actualPct<trim)return null;const to=Number(s.trimToPct);const tgt=(to>0?to:(Number(s.targetPct)||trim));const unitPrice=getComparablePrice(s);const deltaMv=info.mv-total*tgt/100;let sharesTxt='';if(unitPrice>0&&deltaMv>0){const raw=deltaMv/toCNY(unitPrice,s);const rounded=Math.max(100,Math.round(raw/100)*100);sharesTxt=`≈卖 ${fmtInt(rounded)} 股/份`}return {trim,toPct:tgt,deltaMv,sharesTxt}}
function themeBreaches(total){const lim=((state.portfolioStrategy||{}).themeLimits)||{};if(!total)return[];const act={};state.stocks.forEach(s=>{if(isCashRow(s))return;const mv=getMarketValue(s)||0;const t=s.theme||'其他';act[t]=(act[t]||0)+mv});const out=[];Object.keys(lim).forEach(name=>{const l=lim[name]||{};const a=(act[name]||0)/total*100;const soft=Number(l.softLimitPct),hard=Number(l.hardLimitPct);if(hard>0&&a>=hard)out.push({name,a,soft,hard,level:'hard'});else if(soft>0&&a>=soft)out.push({name,a,soft,hard,level:'soft'})});return out}
function getEstimatedTotalAssets(){const invested=getTotalInvested();if(invested<=0)return 0;if(hasCashRow())return invested;const sumTargets=state.stocks.reduce((sum,s)=>sum+(Number(s.targetPct)||0),0);const reservePct=Math.max(0,100-sumTargets);if(reservePct<=0||reservePct>=100)return invested;return invested/(1-reservePct/100)}
function getPositionInfo(s,total){const target=Number(s.targetPct);const mv=getMarketValue(s);if(isNaN(target)||target<=0)return null;if(mv===null)return {target,actualPct:null,deviation:null,mv:null,status:'no-price'};if(!total||total<=0)return {target,actualPct:null,deviation:null,mv,status:'no-total'};const actualPct=mv/total*100;const deviation=actualPct-target;let status='balanced';if(deviation>5)status='overweight';else if(deviation<-5)status='underweight';return {target,actualPct,deviation,mv,status}}
function fmtMoney(n){if(n===null||n===undefined||isNaN(n))return '—';const v=Math.abs(n);if(v>=100000000)return (n/100000000).toFixed(2)+'亿';if(v>=10000)return (n/10000).toFixed(1)+'万';return Math.round(n).toLocaleString('en-US')}
