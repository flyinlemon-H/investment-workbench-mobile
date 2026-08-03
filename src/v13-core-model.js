const V13_OBJECT_TYPES=[
  'Stock',
  'Position',
  'PriceSnapshot',
  'Plan',
  'Event',
  'Trade',
  'RiskState',
  'ModuleSummary',
  'RuleConfig'
];

function v13NowIso(){
  return new Date().toISOString();
}
function v13Id(prefix='v13'){
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2,8)}`;
}
function v13Object(v){
  return v&&typeof v==='object'&&!Array.isArray(v)?v:{};
}
function v13Array(v){
  return Array.isArray(v)?v:[];
}
function v13String(v){
  return v===null||v===undefined?'':String(v);
}
function v13NumberOrNull(v){
  const n=Number(v);
  return Number.isFinite(n)?n:null;
}
function v13Bool(v){
  return Boolean(v);
}
function v13Enum(v,allowed,fallback){
  const s=v13String(v);
  return allowed.includes(s)?s:fallback;
}
function v13KeepLegacy(src,knownKeys){
  const legacy={};
  Object.keys(src||{}).forEach(k=>{
    if(!knownKeys.includes(k))legacy[k]=src[k];
  });
  return legacy;
}

function defaultV13Position(){
  return {
    objectType:'Position',
    stockId:'',
    shares:0,
    avgCost:null,
    marketValue:null,
    currentWeight:null,
    targetWeight:null,
    updatedAt:'',
    legacy:{}
  };
}
function normalizeV13Position(v={},stock={}){
  const src=v13Object(v);
  const known=['objectType','stockId','shares','avgCost','marketValue','currentWeight','targetWeight','updatedAt','legacy'];
  return {
    ...defaultV13Position(),
    stockId:v13String(src.stockId||stock.id||stock.code||stock.symbol),
    shares:v13NumberOrNull(src.shares??stock.shares)??0,
    avgCost:v13NumberOrNull(src.avgCost??stock.avgCost),
    marketValue:v13NumberOrNull(src.marketValue??stock.currentValue??stock.marketValue),
    currentWeight:v13NumberOrNull(src.currentWeight??stock.currentWeight??stock.actualWeight),
    targetWeight:v13NumberOrNull(src.targetWeight??(stock.strategy&&stock.strategy.targetWeight)??stock.targetPct),
    updatedAt:v13String(src.updatedAt||stock.updatedAt||''),
    legacy:{...v13Object(src.legacy),...v13KeepLegacy(src,known)}
  };
}

function defaultV13PriceSnapshot(){
  return {
    objectType:'PriceSnapshot',
    id:'',
    stockId:'',
    price:null,
    currency:'',
    source:'',
    capturedAt:'',
    legacy:{}
  };
}
function v13LatestUnitPrice(stock={}){
  const s=v13Object(stock);
  const isEtf=String(s.type||'').toLowerCase()==='etf';
  const numberOrNull=value=>{
    const n=Number(value);
    return Number.isFinite(n)&&n>0?n:null;
  };
  if(isEtf){
    const unit=numberOrNull(s.lastUnitPrice);
    if(unit!==null)return unit;
    const value=numberOrNull(s.currentValue);
    const shares=numberOrNull(s.shares);
    if(value!==null&&shares!==null)return value/shares;
  }
  return numberOrNull(s.currentPrice)??numberOrNull(s.price);
}
function normalizeV13PriceSnapshot(v={},stock={}){
  const src=v13Object(v);
  const known=['objectType','id','stockId','price','currency','source','capturedAt','legacy'];
  const price=v13NumberOrNull(src.price)??v13LatestUnitPrice(stock);
  return {
    ...defaultV13PriceSnapshot(),
    id:v13String(src.id)||v13Id('price'),
    stockId:v13String(src.stockId||stock.id||stock.code||stock.symbol),
    price,
    currency:v13String(src.currency||stock.currency),
    source:v13String(src.source||stock.priceSource),
    capturedAt:v13String(src.capturedAt||stock.priceUpdatedAt||stock.valueUpdatedAt||''),
    legacy:{...v13Object(src.legacy),...v13KeepLegacy(src,known)}
  };
}

const V13_PLAN_TYPES=['build','add','position_control','profit_take','trend_defense'];
const V13_VERSION_STATUS=['active','archived'];
function defaultV13Plan(){
  return {
    objectType:'Plan',
    id:'',
    stockId:'',
    planType:'add',
    versionStatus:'active',
    triggerPrice:null,
    triggerDirection:'',
    stage:'none',
    summary:'',
    createdAt:'',
    archivedAt:'',
    source:'',
    legacy:{}
  };
}
function normalizeV13Plan(v={},stock={}){
  const src=v13Object(v);
  const known=['objectType','id','stockId','planType','versionStatus','triggerPrice','triggerDirection','stage','summary','createdAt','archivedAt','source','legacy'];
  const legacyAction=v13String(src.action);
  const inferredType=legacyAction==='sell'?'profit_take':(legacyAction==='buy'?'add':src.planType);
  return {
    ...defaultV13Plan(),
    id:v13String(src.id)||v13Id('plan'),
    stockId:v13String(src.stockId||stock.id||stock.code||stock.symbol),
    planType:v13Enum(inferredType,V13_PLAN_TYPES,'add'),
    versionStatus:v13Enum(src.versionStatus||src.status,V13_VERSION_STATUS,'active'),
    triggerPrice:v13NumberOrNull(src.triggerPrice??src.price),
    triggerDirection:v13String(src.triggerDirection||src.triggerOn),
    stage:v13Enum(src.stage,['none','level1','level2','triggered'],'none'),
    summary:v13String(src.summary||src.planSummary||src.note),
    createdAt:v13String(src.createdAt||src.updatedAt||''),
    archivedAt:v13String(src.archivedAt||''),
    source:v13String(src.source||'legacy'),
    legacy:{...v13Object(src.legacy),...v13KeepLegacy(src,known)}
  };
}

const V13_EVENT_PHASES=['info','prepare','decision'];
const V13_EVENT_STATUSES=['pending','cooldown','archived'];
function defaultV13Event(){
  return {
    objectType:'Event',
    id:'',
    stockId:'',
    businessObjectType:'',
    businessObjectId:'',
    phase:'info',
    status:'pending',
    title:'',
    summary:'',
    priority:0,
    createdAt:'',
    updatedAt:'',
    archivedAt:'',
    legacy:{}
  };
}
function normalizeV13Event(v={},stock={}){
  const src=v13Object(v);
  const known=['objectType','id','stockId','businessObjectType','businessObjectId','phase','status','title','summary','priority','createdAt','updatedAt','archivedAt','legacy'];
  const status=v13String(src.status)==='closed'?'archived':src.status;
  return {
    ...defaultV13Event(),
    id:v13String(src.id)||v13Id('event'),
    stockId:v13String(src.stockId||stock.id||stock.code||stock.symbol),
    businessObjectType:v13String(src.businessObjectType),
    businessObjectId:v13String(src.businessObjectId),
    phase:v13Enum(src.phase,V13_EVENT_PHASES,'info'),
    status:v13Enum(status,V13_EVENT_STATUSES,'pending'),
    title:v13String(src.title),
    summary:v13String(src.summary),
    priority:v13NumberOrNull(src.priority)??0,
    createdAt:v13String(src.createdAt||''),
    updatedAt:v13String(src.updatedAt||''),
    archivedAt:v13String(src.archivedAt||''),
    legacy:{...v13Object(src.legacy),...v13KeepLegacy(src,known)}
  };
}

function defaultV13Trade(){
  return {
    objectType:'Trade',
    id:'',
    stockId:'',
    action:'',
    shares:null,
    price:null,
    amount:null,
    tradeDate:'',
    relatedPlanId:'',
    source:'',
    legacy:{}
  };
}
function normalizeV13Trade(v={},stock={}){
  const src=v13Object(v);
  const known=['objectType','id','stockId','action','shares','price','amount','tradeDate','relatedPlanId','source','legacy'];
  return {
    ...defaultV13Trade(),
    id:v13String(src.id)||v13Id('trade'),
    stockId:v13String(src.stockId||stock.id||stock.code||stock.symbol),
    action:v13String(src.action),
    shares:v13NumberOrNull(src.shares),
    price:v13NumberOrNull(src.price),
    amount:v13NumberOrNull(src.amount),
    tradeDate:v13String(src.tradeDate||src.date||''),
    relatedPlanId:v13String(src.relatedPlanId||src.planId),
    source:v13String(src.source||'manual'),
    legacy:{...v13Object(src.legacy),...v13KeepLegacy(src,known)}
  };
}

const V13_RISK_TYPES=['trend_defense','profit_take','position_control'];
function defaultV13RiskState(){
  return {
    objectType:'RiskState',
    stockId:'',
    risks:[],
    updatedAt:'',
    legacy:{}
  };
}
function normalizeV13RiskState(v={},stock={}){
  const src=v13Object(v);
  const known=['objectType','stockId','risks','updatedAt','legacy'];
  const risks=v13Array(src.risks).map(r=>{
    const item=v13Object(r);
    return {
      riskType:v13Enum(item.riskType,V13_RISK_TYPES,'trend_defense'),
      active:v13Bool(item.active),
      phase:v13Enum(item.phase,V13_EVENT_PHASES,'info'),
      summary:v13String(item.summary),
      sourceObjectId:v13String(item.sourceObjectId),
      createdAt:v13String(item.createdAt),
      updatedAt:v13String(item.updatedAt)
    };
  });
  return {
    ...defaultV13RiskState(),
    stockId:v13String(src.stockId||stock.id||stock.code||stock.symbol),
    risks,
    updatedAt:v13String(src.updatedAt||''),
    legacy:{...v13Object(src.legacy),...v13KeepLegacy(src,known)}
  };
}

function defaultV13ModuleSummary(){
  return {
    objectType:'ModuleSummary',
    stockId:'',
    modules:{},
    updatedAt:'',
    legacy:{}
  };
}
function normalizeV13ModuleSummary(v={},stock={}){
  const src=v13Object(v);
  const known=['objectType','stockId','modules','updatedAt','legacy'];
  return {
    ...defaultV13ModuleSummary(),
    stockId:v13String(src.stockId||stock.id||stock.code||stock.symbol),
    modules:v13Object(src.modules),
    updatedAt:v13String(src.updatedAt||''),
    legacy:{...v13Object(src.legacy),...v13KeepLegacy(src,known)}
  };
}

function defaultV13RuleConfig(){
  return {
    objectType:'RuleConfig',
    planLevel1Pct:10,
    planLevel2Pct:5,
    updatedAt:'',
    legacy:{}
  };
}
function normalizeV13RuleConfig(v={}){
  const src=v13Object(v);
  const known=['objectType','planLevel1Pct','planLevel2Pct','updatedAt','legacy'];
  const legacy=v13Object(src.legacy);
  const level1=src.planLevel1Pct??src.level1Pct??src.planWarningLevel1Pct??src.planNearPct??legacy.planLevel1Pct??legacy.level1Pct;
  const level2=src.planLevel2Pct??src.level2Pct??src.planWarningLevel2Pct??src.planClosePct??legacy.planLevel2Pct??legacy.level2Pct;
  return {
    ...defaultV13RuleConfig(),
    planLevel1Pct:v13NumberOrNull(level1)??10,
    planLevel2Pct:v13NumberOrNull(level2)??5,
    updatedAt:v13String(src.updatedAt||''),
    legacy:{...v13Object(src.legacy),...v13KeepLegacy(src,known)}
  };
}

function defaultV13Stock(){
  return {
    objectType:'Stock',
    id:'',
    symbol:'',
    name:'',
    type:'holding',
    position:defaultV13Position(),
    priceSnapshots:[],
    plans:[],
    events:[],
    trades:[],
    riskState:defaultV13RiskState(),
    moduleSummary:defaultV13ModuleSummary(),
    legacy:{}
  };
}
function normalizeV13Stock(v={}){
  const src=v13Object(v);
  const known=['objectType','id','symbol','code','name','type','position','priceSnapshots','plans','events','trades','riskState','moduleSummary','coreModel','legacy'];
  const stockId=v13String(src.id||src.code||src.symbol)||v13Id('stock');
  const base={id:stockId,code:src.code,symbol:src.symbol,name:src.name,type:src.type,currentPrice:src.currentPrice,currentValue:src.currentValue,lastUnitPrice:src.lastUnitPrice,shares:src.shares,price:src.price,priceUpdatedAt:src.priceUpdatedAt,valueUpdatedAt:src.valueUpdatedAt,priceSource:src.priceSource,currency:src.currency};
  return {
    ...defaultV13Stock(),
    id:stockId,
    symbol:v13String(src.symbol||src.code),
    name:v13String(src.name),
    type:v13String(src.type||'holding'),
    position:normalizeV13Position(src.position,src),
    priceSnapshots:v13Array(src.priceSnapshots).map(p=>normalizeV13PriceSnapshot(p,base)),
    plans:v13Array(src.v13Plans||src.plans).map(p=>normalizeV13Plan(p,base)),
    events:v13Array(src.events).map(e=>normalizeV13Event(e,base)),
    trades:v13Array(src.trades).map(t=>normalizeV13Trade(t,base)),
    riskState:normalizeV13RiskState(src.riskState,base),
    moduleSummary:normalizeV13ModuleSummary(src.moduleSummary,base),
    legacy:{...v13Object(src.legacy),...v13KeepLegacy(src,known)}
  };
}
