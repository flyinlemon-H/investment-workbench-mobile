const V13_RISK_PHASE_RANK={decision:3,prepare:2,info:1};
const V13_RISK_TYPE_RANK={trend_defense:3,profit_take:2,position_control:1};

function normalizeRiskState(riskState){
  const src=riskState&&typeof riskState==='object'?riskState:{};
  const base=typeof normalizeV13RiskState==='function'?normalizeV13RiskState(src):{
    objectType:'RiskState',
    stockId:String(src.stockId||''),
    risks:Array.isArray(src.risks)?src.risks:[],
    updatedAt:String(src.updatedAt||''),
    legacy:src.legacy&&typeof src.legacy==='object'?src.legacy:{}
  };
  const original=Array.isArray(src.risks)?src.risks:[];
  return {
    ...base,
    risks:(Array.isArray(base.risks)?base.risks:[]).map((risk,index)=>{
      const raw=original[index]&&typeof original[index]==='object'?original[index]:{};
      return {
        ...risk,
        status:raw.status,
        versionStatus:raw.versionStatus,
        archivedAt:raw.archivedAt,
        triggerPrice:raw.triggerPrice??raw.thresholdPrice??raw.price??raw.level,
        thresholdWeight:raw.thresholdWeight,
        targetWeight:raw.targetWeight,
        currentWeight:raw.currentWeight
      };
    })
  };
}

function v13RiskObject(risk){
  return risk&&typeof risk==='object'?{...risk}:{};
}

function v13RiskType(risk){
  const type=String(risk&&risk.riskType||'');
  return ['trend_defense','profit_take','position_control'].includes(type)?type:'trend_defense';
}

function v13RiskIsArchived(risk){
  const status=String(risk&&risk.status||risk&&risk.versionStatus||'').toLowerCase();
  return status==='archived'||risk&&risk.archivedAt;
}

function getActiveRisks(riskState){
  return normalizeRiskState(riskState).risks
    .map(v13RiskObject)
    .filter(risk=>!v13RiskIsArchived(risk)&&risk.active===true);
}

function getRiskDecisionStage(risk){
  const r=v13RiskObject(risk);
  if(r.phase)return ['decision','prepare','info'].includes(r.phase)?r.phase:'info';
  if(v13RiskType(r)==='position_control')return r.active?'prepare':'info';
  if(['trend_defense','profit_take'].includes(v13RiskType(r)))return r.active?'decision':'info';
  return 'info';
}

function sortRisksByDecisionPriority(risks){
  return (Array.isArray(risks)?risks:[]).map(v13RiskObject).sort((a,b)=>{
    const phaseDiff=(V13_RISK_PHASE_RANK[getRiskDecisionStage(b)]||0)-(V13_RISK_PHASE_RANK[getRiskDecisionStage(a)]||0);
    if(phaseDiff)return phaseDiff;
    const typeDiff=(V13_RISK_TYPE_RANK[v13RiskType(b)]||0)-(V13_RISK_TYPE_RANK[v13RiskType(a)]||0);
    if(typeDiff)return typeDiff;
    return String(b.updatedAt||b.createdAt||'').localeCompare(String(a.updatedAt||a.createdAt||''));
  });
}

function v13RiskNumber(...values){
  for(const raw of values){
    const value=Number(raw);
    if(Number.isFinite(value))return value;
  }
  return null;
}

function v13RiskPrice(priceSnapshot){
  if(!priceSnapshot||typeof priceSnapshot!=='object')return null;
  return v13RiskNumber(priceSnapshot.price,priceSnapshot.currentPrice,priceSnapshot.close,priceSnapshot.lastPrice);
}

function v13RiskCloseConfirmed(priceSnapshot){
  if(!priceSnapshot||typeof priceSnapshot!=='object')return false;
  return priceSnapshot.closeConfirmed===true
    ||priceSnapshot.isCloseConfirmed===true
    ||String(priceSnapshot.priceType||'').toLowerCase()==='close'
    ||String(priceSnapshot.marketStatus||'').toLowerCase()==='closed';
}

function v13RiskTriggerPrice(risk){
  const legacy=risk&&risk.legacy&&typeof risk.legacy==='object'?risk.legacy:{};
  return v13RiskNumber(risk&&risk.triggerPrice,risk&&risk.thresholdPrice,risk&&risk.price,risk&&risk.level,legacy.triggerPrice,legacy.thresholdPrice,legacy.price);
}

function v13RiskKeepActive(risk,phase){
  return {
    ...v13RiskObject(risk),
    riskType:v13RiskType(risk),
    active:true,
    phase,
    updatedAt:(typeof v13NowIso==='function'?v13NowIso():new Date().toISOString())
  };
}

function checkTrendRisk(risk,priceSnapshot){
  const r=v13RiskObject(risk);
  if(r.active===true)return v13RiskKeepActive(r,'decision');
  const price=v13RiskPrice(priceSnapshot);
  const trigger=v13RiskTriggerPrice(r);
  if(price===null||trigger===null||!v13RiskCloseConfirmed(priceSnapshot))return r;
  if(price<=trigger)return v13RiskKeepActive(r,'decision');
  return r;
}

function checkProfitTakeRisk(risk,priceSnapshot){
  const r=v13RiskObject(risk);
  if(r.active===true)return v13RiskKeepActive(r,'decision');
  const price=v13RiskPrice(priceSnapshot);
  const trigger=v13RiskTriggerPrice(r);
  if(price===null||trigger===null)return r;
  if(price>=trigger)return v13RiskKeepActive(r,'decision');
  return r;
}

function checkPositionRisk(risk,position){
  const r=v13RiskObject(risk);
  if(r.active===true)return v13RiskKeepActive(r,'prepare');
  const legacy=r.legacy&&typeof r.legacy==='object'?r.legacy:{};
  const current=v13RiskNumber(position&&position.currentWeight,position&&position.weight,r.currentWeight,legacy.currentWeight);
  const target=v13RiskNumber(r.thresholdWeight,r.targetWeight,legacy.thresholdWeight,legacy.targetWeight,position&&position.targetWeight,position&&position.maxWeight);
  if(current===null||target===null)return r;
  if(current>=target)return v13RiskKeepActive(r,'prepare');
  return r;
}

function archiveRisk(risk,reason){
  const r=v13RiskObject(risk);
  return {
    ...r,
    active:false,
    phase:r.phase||getRiskDecisionStage(r),
    archivedAt:r.archivedAt||(typeof v13NowIso==='function'?v13NowIso():new Date().toISOString()),
    legacy:{
      ...(r.legacy&&typeof r.legacy==='object'?r.legacy:{}),
      archiveReason:String(reason||'')
    }
  };
}
