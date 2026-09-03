const STORAGE_KEY='portfolio_manual_v502_network_price_20260610';
const OLD_KEYS=[];
const seedStocks=[];
const DEFAULT_CODES={zijin:'2899.HK',xiaomi:'1810.HK',meitu:'1357.HK',fii:'601138.SS',dp:'605499.SS',huaqin:'603296.SS'};
let state={stocks:[],updatedAt:null},currentTab='dashboard',editingId=null,detailStockId=null,detailSubView='',formType='holding',tempBuy=[],tempSell=[],planEditorOriginalPlans=[];
const ALPHA3_DATA_VERSION='v13.alpha3.sprint5';
const uid=()=>Math.random().toString(36).slice(2,10);
const fmt=(n,d=2)=>Number(n||0).toLocaleString('en-US',{minimumFractionDigits:d,maximumFractionDigits:d});
const fmtMaybe=(n,d=2)=>(n===null||n===undefined||n===''||isNaN(Number(n)))?'—':fmt(Number(n),d);
const fmtInt=n=>(n===null||n===undefined||n===''||isNaN(Number(n)))?'—':Number(n).toLocaleString('en-US',{maximumFractionDigits:2});
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const DEFAULT_HKD_CNY=0.92;
const ANALYSIS_MODULES=['macro','industry','company','financials','valuation','technical','capitalFlow','risks','conclusion'];
const ANALYSIS_WEIGHTS={macro:.10,industry:.15,company:.20,financials:.20,valuation:.10,technical:.05,capitalFlow:.05,risks:.05,conclusion:.10};
const INVESTMENT_STYLES=['growth','value','cyclical','resource','dividend','etf','watchOnly'];
const BUY_AGGRESSIVENESS=['conservative','normal','aggressive'];
function clampNumber(v,min,max,fallback=0){const n=Number(v);if(!isFinite(n))return fallback;return Math.max(min,Math.min(max,n))}
const DATA_FRESHNESS_FIELDS=['priceUpdatedAt','valuationUpdatedAt','newsUpdatedAt','socialUpdatedAt','financialUpdatedAt','technicalUpdatedAt','personalViewUpdatedAt','comprehensiveReviewUpdatedAt','etfAnalysisUpdatedAt'];
function todayDate(){return new Date().toISOString().slice(0,10)}
function normalizeDateOnly(value){const d=normalizePriceDate(value);return d||''}
function defaultDataFreshness(){return {priceUpdatedAt:'',valuationUpdatedAt:'',newsUpdatedAt:'',socialUpdatedAt:'',financialUpdatedAt:'',technicalUpdatedAt:'',personalViewUpdatedAt:'',comprehensiveReviewUpdatedAt:'',etfAnalysisUpdatedAt:''}}
function normalizeDataFreshness(v){
  const src=(v&&typeof v==='object')?v:{};
  const out=defaultDataFreshness();
  DATA_FRESHNESS_FIELDS.forEach(k=>out[k]=normalizeDateOnly(src[k]));
  return out;
}
function touchDataFreshness(stock,key,date=todayDate()){
  if(!stock||!DATA_FRESHNESS_FIELDS.includes(key))return;
  stock.dataFreshness=normalizeDataFreshness(stock.dataFreshness);
  stock.dataFreshness[key]=normalizeDateOnly(date)||todayDate();
}
function defaultCollectionInputs(){return {newsRawText:'',financialRawText:'',socialRawText:'',technicalRawText:'',generalRawText:''}}
function normalizeCollectionInputs(v){
  const src=(v&&typeof v==='object')?v:{};
  return {
    newsRawText:String(src.newsRawText||''),
    financialRawText:String(src.financialRawText||''),
    socialRawText:String(src.socialRawText||''),
    technicalRawText:String(src.technicalRawText||''),
    generalRawText:String(src.generalRawText||'')
  };
}
function defaultAiReviews(){return {newsReview:null,financialReview:null,socialReview:null,technicalReview:null,comprehensiveReview:null}}
function normalizeAiReviews(v){
  const src=(v&&typeof v==='object')?v:{};
  return {
    newsReview:src.newsReview||null,
    financialReview:src.financialReview||null,
    socialReview:src.socialReview||null,
    technicalReview:src.technicalReview||null,
    comprehensiveReview:src.comprehensiveReview||null
  };
}
function defaultStrategy(stock={}){
  const style=stock.type==='etf'?'etf':(stock.type==='watching'?'watchOnly':'growth');
  return {
    targetWeight:Number(stock.targetPct)||0,
    maxWeight:Number(stock.capPct)||0,
    minWeight:0,
    priority:5,
    investmentStyle:style,
    convictionLevel:5,
    capitalAllocationEnabled:stock.type!=='watching',
    targetShares:0,
    minTradeUnit:1,
    preferredBuyAmount:0,
    maxSingleBuyAmount:0,
    buyAggressiveness:'normal',
    notes:''
  };
}
function normalizeStrategy(v,stock={}){
  const d=defaultStrategy(stock);
  const src=(v&&typeof v==='object')?v:{};
  const style=INVESTMENT_STYLES.includes(src.investmentStyle)?src.investmentStyle:d.investmentStyle;
  return {
    targetWeight:clampNumber(src.targetWeight,0,100,d.targetWeight),
    maxWeight:clampNumber(src.maxWeight,0,100,d.maxWeight),
    minWeight:clampNumber(src.minWeight,0,100,d.minWeight),
    priority:clampNumber(src.priority,1,10,d.priority),
    investmentStyle:style,
    convictionLevel:clampNumber(src.convictionLevel,0,10,d.convictionLevel),
    capitalAllocationEnabled:src.capitalAllocationEnabled===undefined?d.capitalAllocationEnabled:Boolean(src.capitalAllocationEnabled),
    targetShares:clampNumber(src.targetShares,0,Number.MAX_SAFE_INTEGER,d.targetShares),
    minTradeUnit:Math.max(1,Math.floor(clampNumber(src.minTradeUnit,1,Number.MAX_SAFE_INTEGER,d.minTradeUnit))),
    preferredBuyAmount:clampNumber(src.preferredBuyAmount,0,Number.MAX_SAFE_INTEGER,d.preferredBuyAmount),
    maxSingleBuyAmount:clampNumber(src.maxSingleBuyAmount,0,Number.MAX_SAFE_INTEGER,d.maxSingleBuyAmount),
    buyAggressiveness:BUY_AGGRESSIVENESS.includes(src.buyAggressiveness)?src.buyAggressiveness:d.buyAggressiveness,
    notes:String(src.notes||'')
  };
}
function defaultAnalysisInputs(){return {financialReport:'',news:'',technicalObservation:'',capitalFlowObservation:'',personalView:'',valuationRawText:'',lastUpdated:''}}
function normalizeAnalysisInputs(v){
  const src=(v&&typeof v==='object')?v:{};
  return {
    financialReport:String(src.financialReport||''),
    news:String(src.news||''),
    technicalObservation:String(src.technicalObservation||''),
    capitalFlowObservation:String(src.capitalFlowObservation||''),
    personalView:String(src.personalView||''),
    valuationRawText:String(src.valuationRawText||''),
    lastUpdated:String(src.lastUpdated||'')
  };
}
function defaultTechnicalData(stock={}){
  return {
    symbol:String(stock.code||stock.symbol||''),
    price:null,
    priceUpdatedAt:'',
    latestCompleteBar:'',
    technicalAsOf:'',
    technicalDataStatus:'unavailable',
    technicalWarning:'',
    timeframe:'daily',
    ma5:null,
    ma10:null,
    ma20:0,
    ma60:0,
    ma120:0,
    macd:{dif:null,dea:null,histogram:null},
    volume:null,
    volumeAvg20:null,
    volumeChangePct:null,
    volumeStatus:'unavailable',
    volumeWarning:'',
    volumeProviderTransition:false,
    trendStatus:'',
    supportLevels:[],
    resistanceLevels:[],
    technicalSummary:'',
    riskFlags:[],
    actionHint:'',
    cyclePosition:'unclear',
    cycleSummary:'',
    pricePosition:{
      lookbackDays:null,
      high:null,
      low:null,
      currentPercentile:null,
      distanceToCycleHighPct:null,
      distanceToCycleLowPct:null
    },
    supportZones:[],
    holdHint:'',
    addHint:'',
    reduceHint:'',
    supportPrice:0,
    resistancePrice:0,
    trendNote:'',
    lastUpdated:''
  };
}
const TECHNICAL_CYCLE_POSITIONS=['low_base','early_uptrend','mid_uptrend','high_level_rebreakout','high_level_overextension','distribution_risk','downtrend','unclear'];
const TECHNICAL_TREND_STATUSES=['uptrend','downtrend','sideways','recovery','rebound','unclear'];
function normalizePricePosition(v){
  const src=(v&&typeof v==='object')?v:{};
  const nullableNumber=x=>{const n=Number(x);return isFinite(n)?n:null};
  const nullableNonNegative=x=>{const n=Number(x);return isFinite(n)&&n>=0?n:null};
  return {
    lookbackDays:nullableNonNegative(src.lookbackDays),
    high:nullableNonNegative(src.high),
    low:nullableNonNegative(src.low),
    currentPercentile:nullableNumber(src.currentPercentile),
    distanceToCycleHighPct:nullableNumber(src.distanceToCycleHighPct),
    distanceToCycleLowPct:nullableNumber(src.distanceToCycleLowPct)
  };
}
function normalizeSupportZones(v){
  const arr=Array.isArray(v)?v:[];
  return arr.map(item=>{
    const src=(item&&typeof item==='object')?item:{};
    const range=Array.isArray(src.range)?src.range.map(n=>Number(n)).filter(n=>isFinite(n)):[];
    return {
      range:range.slice(0,2),
      type:String(src.type||''),
      actionHint:String(src.actionHint||'')
    };
  }).filter(item=>item.range.length||item.type||item.actionHint);
}
function normalizeTechnicalLevelArray(x){
  const raw=Array.isArray(x)?x:String(x||'').split(/\n|,|，/);
  return raw.map(i=>{
    const t=String(i??'').trim();
    if(!t)return null;
    const n=Number(t.replace(/,/g,''));
    return isFinite(n)?n:t;
  }).filter(i=>i!==null&&i!==undefined&&i!=='');
}
function normalizeTechnicalData(v){
  const src=(v&&typeof v==='object')?v:{};
  const arr=x=>Array.isArray(x)?x.map(i=>String(i??'').trim()).filter(Boolean):String(x||'').split(/\n|,|，/).map(i=>String(i||'').trim()).filter(Boolean);
  const nullableNumber=x=>{const n=Number(x);return isFinite(n)&&n>=0?n:null};
  const fallbackSupport=clampNumber(src.supportPrice,0,Number.MAX_SAFE_INTEGER,0);
  const fallbackResistance=clampNumber(src.resistancePrice,0,Number.MAX_SAFE_INTEGER,0);
  const cyclePosition=TECHNICAL_CYCLE_POSITIONS.includes(String(src.cyclePosition||''))?String(src.cyclePosition):'unclear';
  const macdSrc=src.macd&&typeof src.macd==='object'?src.macd:{};
  const nullableSigned=x=>{const n=Number(x);return isFinite(n)?n:null};
  return {
    symbol:String(src.symbol||''),
    price:nullableNumber(src.price),
    priceUpdatedAt:normalizeDateOnly(src.priceUpdatedAt)||'',
    latestCompleteBar:normalizeDateOnly(src.latestCompleteBar)||'',
    technicalAsOf:normalizeDateOnly(src.technicalAsOf)||'',
    technicalDataStatus:['fresh','stale','unavailable','anomaly'].includes(String(src.technicalDataStatus||''))?String(src.technicalDataStatus):'unavailable',
    technicalWarning:String(src.technicalWarning||''),
    timeframe:String(src.timeframe||'daily'),
    ma5:nullableNumber(src.ma5),
    ma10:nullableNumber(src.ma10),
    ma20:clampNumber(src.ma20,0,Number.MAX_SAFE_INTEGER,0),
    ma60:clampNumber(src.ma60,0,Number.MAX_SAFE_INTEGER,0),
    ma120:clampNumber(src.ma120,0,Number.MAX_SAFE_INTEGER,0),
    macd:{dif:nullableSigned(macdSrc.dif),dea:nullableSigned(macdSrc.dea),histogram:nullableSigned(macdSrc.histogram??macdSrc.hist)},
    volume:nullableNumber(src.volume),
    volumeAvg20:nullableNumber(src.volumeAvg20),
    volumeChangePct:nullableSigned(src.volumeChangePct),
    volumeStatus:['comparable','unavailable'].includes(String(src.volumeStatus||''))?String(src.volumeStatus):'unavailable',
    volumeWarning:String(src.volumeWarning||''),
    volumeProviderTransition:Boolean(src.volumeProviderTransition),
    trendStatus:String(src.trendStatus||''),
    supportLevels:normalizeTechnicalLevelArray(src.supportLevels),
    resistanceLevels:normalizeTechnicalLevelArray(src.resistanceLevels),
    technicalSummary:String(src.technicalSummary||''),
    riskFlags:arr(src.riskFlags),
    actionHint:String(src.actionHint||''),
    cyclePosition,
    cycleSummary:String(src.cycleSummary||''),
    pricePosition:normalizePricePosition(src.pricePosition),
    supportZones:normalizeSupportZones(src.supportZones),
    holdHint:String(src.holdHint||''),
    addHint:String(src.addHint||''),
    reduceHint:String(src.reduceHint||''),
    supportPrice:fallbackSupport,
    resistancePrice:fallbackResistance,
    trendNote:String(src.trendNote||''),
    lastUpdated:String(src.lastUpdated||'')
  };
}
function defaultTechnicalReview(stock={}){
  const td=normalizeTechnicalData(stock.technicalData);
  return {
    updatedAt:'',
    inputCoverage:{
      hasRecentKline:false,
      hasCycleKline:false,
      cycleDataSource:'none',
      warning:''
    },
    shortTermTechnical:{
      lookbackDays:120,
      price:td.price,
      priceUpdatedAt:td.priceUpdatedAt||'',
      ma5:td.ma5,
      ma10:td.ma10,
      ma20:td.ma20||null,
      ma60:td.ma60||null,
      trendStatus:td.trendStatus||'',
      supportLevels:td.supportLevels||[],
      resistanceLevels:td.resistanceLevels||[],
      technicalSummary:td.technicalSummary||td.trendNote||'',
      riskFlags:td.riskFlags||[],
      actionHint:td.actionHint||'',
      confidence:'medium'
    },
    cycleTechnical:{
      lookbackDays:500,
      cyclePosition:td.cyclePosition||'unclear',
      cycleSummary:td.cycleSummary||'',
      cycleHigh:td.pricePosition&&td.pricePosition.high!==undefined?td.pricePosition.high:null,
      cycleLow:td.pricePosition&&td.pricePosition.low!==undefined?td.pricePosition.low:null,
      currentPercentile:td.pricePosition&&td.pricePosition.currentPercentile!==undefined?td.pricePosition.currentPercentile:null,
      distanceToCycleHighPct:td.pricePosition&&td.pricePosition.distanceToCycleHighPct!==undefined?td.pricePosition.distanceToCycleHighPct:null,
      distanceToCycleLowPct:td.pricePosition&&td.pricePosition.distanceToCycleLowPct!==undefined?td.pricePosition.distanceToCycleLowPct:null,
      lastCycleUpdatedAt:'',
      dataSource:'none',
      confidence:'medium'
    },
    priceActionEvent:{
      detected:false,
      type:'',
      changePct:null,
      volumeStatus:'',
      needsNewsExplanation:false,
      eventReason:''
    },
    finalTechnicalConclusion:td.technicalSummary||'',
    holdHint:td.holdHint||'',
    addHint:td.addHint||'',
    reduceHint:td.reduceHint||''
  };
}
function normalizeTechnicalReview(v,stock={}){
  const src=(v&&typeof v==='object')?v:{};
  const legacy=normalizeTechnicalData(stock.technicalData);
  const stSrc=(src.shortTermTechnical&&typeof src.shortTermTechnical==='object')?src.shortTermTechnical:{};
  const cySrc=(src.cycleTechnical&&typeof src.cycleTechnical==='object')?src.cycleTechnical:{};
  const covSrc=(src.inputCoverage&&typeof src.inputCoverage==='object')?src.inputCoverage:{};
  const eventSrc=(src.priceActionEvent&&typeof src.priceActionEvent==='object')?src.priceActionEvent:{};
  const nullableNumber=x=>{const n=Number(x);return isFinite(n)?n:null};
  const cyclePosition=TECHNICAL_CYCLE_POSITIONS.includes(String(cySrc.cyclePosition||src.cyclePosition||legacy.cyclePosition||''))?String(cySrc.cyclePosition||src.cyclePosition||legacy.cyclePosition):'unclear';
  return {
    updatedAt:String(src.updatedAt||legacy.lastUpdated||''),
    inputCoverage:{
      hasRecentKline:Boolean(covSrc.hasRecentKline||stSrc.price||legacy.price),
      hasCycleKline:Boolean(covSrc.hasCycleKline),
      cycleDataSource:String(covSrc.cycleDataSource||cySrc.dataSource||'none'),
      warning:String(covSrc.warning||'')
    },
    shortTermTechnical:{
      lookbackDays:nullableNumber(stSrc.lookbackDays)??120,
      price:nullableNumber(stSrc.price)??legacy.price,
      priceUpdatedAt:normalizeDateOnly(stSrc.priceUpdatedAt)||legacy.priceUpdatedAt||'',
      ma5:nullableNumber(stSrc.ma5)??legacy.ma5,
      ma10:nullableNumber(stSrc.ma10)??legacy.ma10,
      ma20:nullableNumber(stSrc.ma20)??(legacy.ma20>0?legacy.ma20:null),
      ma60:nullableNumber(stSrc.ma60)??(legacy.ma60>0?legacy.ma60:null),
      trendStatus:enumOr(stSrc.trendStatus||legacy.trendStatus,TECHNICAL_TREND_STATUSES,'unclear'),
      supportLevels:normalizeTechnicalLevelArray(stSrc.supportLevels&&stSrc.supportLevels.length?stSrc.supportLevels:legacy.supportLevels),
      resistanceLevels:normalizeTechnicalLevelArray(stSrc.resistanceLevels&&stSrc.resistanceLevels.length?stSrc.resistanceLevels:legacy.resistanceLevels),
      technicalSummary:String(stSrc.technicalSummary||legacy.technicalSummary||legacy.trendNote||''),
      riskFlags:normalizeStringArray(stSrc.riskFlags&&stSrc.riskFlags.length?stSrc.riskFlags:legacy.riskFlags),
      actionHint:String(stSrc.actionHint||legacy.actionHint||''),
      confidence:enumOr(stSrc.confidence,['high','medium','low'],'medium')
    },
    cycleTechnical:{
      lookbackDays:nullableNumber(cySrc.lookbackDays)??500,
      cyclePosition,
      cycleSummary:String(cySrc.cycleSummary||src.cycleSummary||legacy.cycleSummary||''),
      cycleHigh:nullableNumber(cySrc.cycleHigh)??(legacy.pricePosition&&legacy.pricePosition.high!==null?legacy.pricePosition.high:null),
      cycleLow:nullableNumber(cySrc.cycleLow)??(legacy.pricePosition&&legacy.pricePosition.low!==null?legacy.pricePosition.low:null),
      currentPercentile:nullableNumber(cySrc.currentPercentile)??(legacy.pricePosition&&legacy.pricePosition.currentPercentile!==null?legacy.pricePosition.currentPercentile:null),
      distanceToCycleHighPct:nullableNumber(cySrc.distanceToCycleHighPct)??(legacy.pricePosition&&legacy.pricePosition.distanceToCycleHighPct!==null?legacy.pricePosition.distanceToCycleHighPct:null),
      distanceToCycleLowPct:nullableNumber(cySrc.distanceToCycleLowPct)??(legacy.pricePosition&&legacy.pricePosition.distanceToCycleLowPct!==null?legacy.pricePosition.distanceToCycleLowPct:null),
      lastCycleUpdatedAt:normalizeDateOnly(cySrc.lastCycleUpdatedAt)||'',
      dataSource:String(cySrc.dataSource||covSrc.cycleDataSource||'none'),
      confidence:enumOr(cySrc.confidence,['high','medium','low'],'medium')
    },
    priceActionEvent:{
      detected:Boolean(eventSrc.detected),
      type:String(eventSrc.type||''),
      changePct:nullableNumber(eventSrc.changePct),
      volumeStatus:String(eventSrc.volumeStatus||''),
      needsNewsExplanation:Boolean(eventSrc.needsNewsExplanation),
      eventReason:String(eventSrc.eventReason||'')
    },
    finalTechnicalConclusion:String(src.finalTechnicalConclusion||legacy.technicalSummary||''),
    holdHint:String(src.holdHint||legacy.holdHint||''),
    addHint:String(src.addHint||legacy.addHint||''),
    reduceHint:String(src.reduceHint||legacy.reduceHint||'')
  };
}
function technicalDataFromReview(review,stock={}){
  const r=normalizeTechnicalReview(review,stock);
  const st=r.shortTermTechnical;
  const cy=r.cycleTechnical;
  return normalizeTechnicalData({
    ...(stock.technicalData||{}),
    symbol:String(stock.code||stock.symbol||''),
    timeframe:'daily',
    trendStatus:st.trendStatus,
    supportLevels:st.supportLevels,
    resistanceLevels:st.resistanceLevels,
    technicalSummary:st.technicalSummary||r.finalTechnicalConclusion,
    riskFlags:st.riskFlags,
    actionHint:st.actionHint,
    cyclePosition:cy.cyclePosition,
    cycleSummary:cy.cycleSummary,
    pricePosition:{
      lookbackDays:cy.lookbackDays,
      high:cy.cycleHigh,
      low:cy.cycleLow,
      currentPercentile:cy.currentPercentile,
      distanceToCycleHighPct:cy.distanceToCycleHighPct,
      distanceToCycleLowPct:cy.distanceToCycleLowPct
    },
    holdHint:r.holdHint,
    addHint:r.addHint,
    reduceHint:r.reduceHint,
    lastUpdated:r.updatedAt
  });
}
function applyTechnicalReviewToStock(stock,normalizedReview){
  if(!stock||typeof stock!=='object'||Array.isArray(stock))throw new Error('目标股票无效。');
  stock.technicalReview=normalizeTechnicalReview(normalizedReview,stock);
  stock.technicalData=technicalDataFromReview(stock.technicalReview,stock);
  if(!stock.technicalData.symbol)stock.technicalData.symbol=stock.code||stock.symbol||'';
  normalizeStockAnalysis(stock);
  return stock;
}
const VALUATION_FIELDS=['pe','pb','ps','dividendYield','revenueGrowth','profitGrowth','historicalPeLow','historicalPeMid','historicalPeHigh','historicalPbLow','historicalPbMid','historicalPbHigh','historicalPsLow','historicalPsMid','historicalPsHigh','marketCap','peTtm','forwardPe','evEbitda','historicalPercentile'];
function defaultValuationData(stock={}){
  return {
    symbol:String(stock.code||stock.symbol||''),
    updatedAt:'',
    currency:'',
    marketCap:null,
    peTtm:null,
    forwardPe:null,
    pe:null,pb:null,ps:null,dividendYield:null,revenueGrowth:0,profitGrowth:0,
    evEbitda:null,
    historicalPercentile:null,
    peerComparison:'',
    valuationConclusion:'',
    historicalPeLow:0,historicalPeMid:0,historicalPeHigh:0,
    historicalPbLow:0,historicalPbMid:0,historicalPbHigh:0,
    historicalPsLow:0,historicalPsMid:0,historicalPsHigh:0,
    valuationNote:'',
    lastUpdated:''
  };
}
function normalizeValuationData(v){
  const src=(v&&typeof v==='object')?v:{};
  const out=defaultValuationData();
  out.symbol=String(src.symbol||'');
  out.updatedAt=normalizeDateOnly(src.updatedAt)||String(src.updatedAt||'');
  out.currency=String(src.currency||'');
  ['marketCap','peTtm','forwardPe','evEbitda','historicalPercentile'].forEach(k=>{
    const n=Number(src[k]);
    out[k]=isFinite(n)&&n>=0?n:null;
  });
  ['pe','pb','ps','dividendYield'].forEach(k=>{
    if(src[k]===null||src[k]===undefined||src[k]==='')out[k]=null;
    else out[k]=clampNumber(src[k],0,Number.MAX_SAFE_INTEGER,0);
  });
  ['historicalPeLow','historicalPeMid','historicalPeHigh','historicalPbLow','historicalPbMid','historicalPbHigh','historicalPsLow','historicalPsMid','historicalPsHigh'].forEach(k=>out[k]=clampNumber(src[k],0,Number.MAX_SAFE_INTEGER,0));
  if(!(out.pe>0)&&out.peTtm>0)out.pe=out.peTtm;
  out.revenueGrowth=clampNumber(src.revenueGrowth,-Number.MAX_SAFE_INTEGER,Number.MAX_SAFE_INTEGER,0);
  out.profitGrowth=clampNumber(src.profitGrowth,-Number.MAX_SAFE_INTEGER,Number.MAX_SAFE_INTEGER,0);
  out.peerComparison=String(src.peerComparison||'');
  out.valuationConclusion=String(src.valuationConclusion||src.valuationSummary||'');
  out.valuationNote=String(src.valuationNote||'');
  out.lastUpdated=normalizeDateOnly(src.lastUpdated)||out.updatedAt||String(src.lastUpdated||'');
  if(!out.updatedAt&&out.lastUpdated)out.updatedAt=out.lastUpdated;
  return out;
}
function defaultValuationReview(){
  return {summary:'',positivePoints:[],negativePoints:[],riskFlags:[],actionHint:''};
}
function normalizeValuationReview(v){
  const src=(v&&typeof v==='object')?v:{};
  const arr=x=>Array.isArray(x)?x.map(i=>String(i??'').trim()).filter(Boolean):String(x||'').split(/\n|,|锛?/).map(i=>String(i||'').trim()).filter(Boolean);
  return {
    summary:String(src.summary||src.valuationSummary||''),
    positivePoints:arr(src.positivePoints||src.positives),
    negativePoints:arr(src.negativePoints||src.negatives),
    riskFlags:arr(src.riskFlags||src.risks||src.riskPoints),
    actionHint:String(src.actionHint||src.suggestedAction||'')
  };
}
function defaultSentimentReview(stock={}){
  return {
    symbol:String(stock.code||stock.symbol||''),
    updatedAt:'',
    importance:'medium',
    conclusion:'',
    newsSummary:'',
    marketMood:'',
    institutionalView:'',
    fundFlowView:'',
    sectorHeat:'',
    positivePoints:[],
    negativePoints:[],
    riskFlags:[],
    sourceQuality:'low',
    confidence:'low',
    actionHint:''
  };
}
function normalizeSentimentReview(v,stock={}){
  const src=(v&&typeof v==='object')?v:{};
  const arr=x=>Array.isArray(x)?x.map(i=>String(i??'').trim()).filter(Boolean):String(x||'').split(/\n|,|锛?|；/).map(i=>String(i||'').trim()).filter(Boolean);
  const enumValue=(value,allowed,fallback)=>allowed.includes(String(value||'').trim())?String(value||'').trim():fallback;
  return {
    symbol:String(src.symbol||stock.code||stock.symbol||''),
    updatedAt:normalizeDateOnly(src.updatedAt)||String(src.updatedAt||''),
    importance:enumValue(src.importance,['low','medium','high'],'medium'),
    conclusion:String(src.conclusion||src.summary||''),
    newsSummary:String(src.newsSummary||''),
    marketMood:String(src.marketMood||src.sentiment||''),
    institutionalView:String(src.institutionalView||''),
    fundFlowView:String(src.fundFlowView||''),
    sectorHeat:String(src.sectorHeat||''),
    positivePoints:arr(src.positivePoints||src.positives),
    negativePoints:arr(src.negativePoints||src.negatives),
    riskFlags:arr(src.riskFlags||src.risks||src.riskPoints),
    sourceQuality:enumValue(src.sourceQuality,['low','medium','high'],'low'),
    confidence:enumValue(src.confidence,['low','medium','high'],'low'),
    actionHint:String(src.actionHint||src.suggestedAction||'')
  };
}
function enumOr(value,allowed,fallback){
  const v=String(value||'').trim();
  return allowed.includes(v)?v:fallback;
}
function nullableNumberValue(value){
  if(value===null||value===undefined||value==='')return null;
  const n=Number(value);
  return isFinite(n)?n:null;
}
function defaultLongTermLogic(){
  return {
    updatedAt:'',
    validUntil:'',
    investmentThesis:'',
    coreDrivers:[],
    industryDrivers:[],
    companyDrivers:[],
    portfolioDrivers:[],
    fundamentalSupport:'',
    longTermRisks:[],
    logicStatus:'unclear',
    confidence:'low',
    nextReviewDate:'',
    sourceSummary:''
  };
}
function normalizeLongTermLogic(v,stock={}){
  const src=(v&&typeof v==='object')?v:{};
  const framework=(stock.analysisFramework&&typeof stock.analysisFramework==='object')?stock.analysisFramework:{};
  const conclusion=(framework.conclusion&&typeof framework.conclusion==='object')?framework.conclusion:{};
  const industryDrivers=normalizeStringArray(src.industryDrivers);
  const companyDrivers=normalizeStringArray(src.companyDrivers);
  const portfolioDrivers=normalizeStringArray(src.portfolioDrivers);
  const legacyCoreDrivers=normalizeStringArray(src.coreDrivers||conclusion.buyRules);
  const mergedCoreDrivers=normalizeStringArray(src.coreDrivers||[...industryDrivers,...companyDrivers,...portfolioDrivers]);
  return {
    updatedAt:normalizeDateOnly(src.updatedAt)||String(src.updatedAt||''),
    validUntil:normalizeDateOnly(src.validUntil)||String(src.validUntil||''),
    investmentThesis:String(src.investmentThesis||stock.thesis||stock.notes||conclusion.summary||''),
    coreDrivers:mergedCoreDrivers.length?mergedCoreDrivers:legacyCoreDrivers,
    industryDrivers:industryDrivers.length?industryDrivers:(companyDrivers.length||portfolioDrivers.length?[]:legacyCoreDrivers),
    companyDrivers,
    portfolioDrivers,
    fundamentalSupport:String(src.fundamentalSupport||''),
    longTermRisks:normalizeStringArray(src.longTermRisks||conclusion.invalidationConditions),
    logicStatus:enumOr(src.logicStatus,['valid','weakening','broken','unclear'],'unclear'),
    confidence:enumOr(src.confidence,['high','medium','low'],'low'),
    nextReviewDate:normalizeDateOnly(src.nextReviewDate)||String(src.nextReviewDate||''),
    sourceSummary:String(src.sourceSummary||'')
  };
}
function defaultPositionManagementReview(){
  return {
    updatedAt:'',
    currentWeight:0,
    targetWeight:0,
    weightStatus:'unknown',
    profitProtectionStatus:'unknown',
    reduceWatchStatus:'unknown',
    summary:'',
    actionHint:'',
    riskFlags:[],
    notes:''
  };
}
function normalizePositionManagementReview(v){
  const src=(v&&typeof v==='object')?v:{};
  const arr=x=>Array.isArray(x)?x.map(i=>String(i??'').trim()).filter(Boolean):String(x||'').split(/\n|,|锛?|閿?/).map(i=>String(i||'').trim()).filter(Boolean);
  return {
    updatedAt:normalizeDateOnly(src.updatedAt)||String(src.updatedAt||''),
    currentWeight:clampNumber(src.currentWeight,0,100,0),
    targetWeight:clampNumber(src.targetWeight,0,100,0),
    weightStatus:enumOr(src.weightStatus,['underweight','normal','overweight','heavily_overweight','unknown'],'unknown'),
    profitProtectionStatus:enumOr(src.profitProtectionStatus,['none','normal','watch','protect','unknown'],'unknown'),
    reduceWatchStatus:enumOr(src.reduceWatchStatus,['not_triggered','observe','reduce_watch','review_required','unknown'],'unknown'),
    summary:String(src.summary||''),
    actionHint:String(src.actionHint||''),
    riskFlags:arr(src.riskFlags),
    notes:String(src.notes||'')
  };
}
function defaultRecentCatalyst(){
  return {
    analysisDate:'',
    lookbackDays:7,
    monthlyLookbackDays:30,
    latestSourceDate:'',
    hasTodayNews:false,
    todayCatalyst:'',
    weeklyCatalysts:[],
    monthlyCatalysts:[],
    recentEvents:[],
    freshnessStatus:'unknown',
    freshnessDays:null,
    catalystCoverage:'unknown',
    missingData:[],
    confidence:'low',
    actionHint:''
  };
}
function normalizeRecentCatalyst(v,stock={}){
  const hasExplicitSnapshot=Boolean(v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).length);
  const src=(v&&typeof v==='object')?v:{};
  const ai=normalizeAiReviews(stock.aiReviews);
  const news=(ai.newsReview&&typeof ai.newsReview==='object')?ai.newsReview:{};
  const freshness=normalizeDataFreshness(stock.dataFreshness);
  const latest=normalizeDateOnly(src.latestSourceDate)||(hasExplicitSnapshot?'':(normalizeDateOnly(news.updatedAt)||freshness.newsUpdatedAt||''));
  let days=nullableNumberValue(src.freshnessDays);
  if(days===null&&latest){
    const t=new Date(todayDate()).getTime();
    const d=new Date(latest).getTime();
    if(isFinite(t)&&isFinite(d))days=Math.max(0,Math.floor((t-d)/86400000));
  }
  let freshnessStatus=enumOr(src.freshnessStatus,['fresh','acceptable','stale','unknown'],'unknown');
  if(!src.freshnessStatus&&days!==null)freshnessStatus=days<=3?'fresh':(days<=7?'acceptable':'stale');
  const weeklyCatalysts=normalizeStringArray(src.weeklyCatalysts);
  const monthlyCatalysts=normalizeStringArray(src.monthlyCatalysts);
  const rawEvents=Object.prototype.hasOwnProperty.call(src,'recentEvents')
    ?src.recentEvents
    :(hasExplicitSnapshot?[]:(news.attentionPoints||news.positivePoints));
  const recentEvents=Array.isArray(rawEvents)
    ?rawEvents.map(x=>(x&&typeof x==='object')?{...x}:String(x??'').trim()).filter(x=>typeof x==='object'||Boolean(x))
    :normalizeStringArray(rawEvents);
  const catalystCoverage=src.catalystCoverage?completenessLevel(src.catalystCoverage):(src.hasTodayNews&&weeklyCatalysts.length&&monthlyCatalysts.length?'high':(weeklyCatalysts.length||monthlyCatalysts.length||recentEvents.length?'medium':'low'));
  return {
    analysisDate:normalizeDateOnly(src.analysisDate)||String(src.analysisDate||''),
    lookbackDays:Math.max(1,Math.floor(clampNumber(src.lookbackDays,1,365,7))),
    monthlyLookbackDays:Math.max(1,Math.floor(clampNumber(src.monthlyLookbackDays,1,365,30))),
    latestSourceDate:latest,
    hasTodayNews:Boolean(src.hasTodayNews),
    todayCatalyst:String(src.todayCatalyst||''),
    weeklyCatalysts,
    monthlyCatalysts,
    recentEvents,
    freshnessStatus,
    freshnessDays:days,
    catalystCoverage,
    missingData:normalizeStringArray(src.missingData),
    confidence:enumOr(src.confidence,['high','medium','low'],'low'),
    actionHint:String(src.actionHint||'')
  };
}
function defaultEventExplanation(){
  return {
    priceActionDetected:false,
    priceActionType:'',
    explanationLevel:'unknown',
    canExplainTodayMove:false,
    explanationConfidence:'low',
    explanation:'',
    missingData:[],
    warning:''
  };
}
function normalizeEventExplanation(v,stock={}){
  const src=(v&&typeof v==='object')?v:{};
  const tech=normalizeTechnicalReview(stock.technicalReview,stock);
  const recent=normalizeRecentCatalyst(stock.recentCatalyst,stock);
  const pct=nullableNumberValue(stock.dailyChange??stock.changePct??tech.priceActionEvent.changePct);
  const eventType=String(src.priceActionType||tech.priceActionEvent.type||'');
  const volumeStatus=String(tech.priceActionEvent.volumeStatus||'');
  const detected=Boolean(src.priceActionDetected||eventType.trim()||tech.priceActionEvent.detected||(pct!==null&&Math.abs(pct)>=7)||tech.priceActionEvent.needsNewsExplanation||/放量|异动|突破|涨停|跌停/i.test(volumeStatus));
  const type=String(eventType||(pct!==null&&pct>=9.5?'涨停/大涨':(pct!==null&&pct<=-9.5?'跌停/大跌':(detected?'异常波动':''))));
  const rawLevel=enumOr(src.explanationLevel,['full','partial','none','unknown'],'unknown');
  const inferredLevel=rawLevel!=='unknown'?rawLevel:(detected?(recent.hasTodayNews&&recent.todayCatalyst?'full':((recent.weeklyCatalysts&&recent.weeklyCatalysts.length)||(recent.monthlyCatalysts&&recent.monthlyCatalysts.length)||(recent.recentEvents&&recent.recentEvents.length)?'partial':'none')):'unknown');
  const canExplain=src.canExplainTodayMove===undefined?(inferredLevel==='full'):Boolean(src.canExplainTodayMove);
  const missing=normalizeStringArray(src.missingData);
  if(detected&&!canExplain&&!missing.length)missing.push('当日新闻或公告','资金流/龙虎榜','板块异动原因');
  const warning=String(src.warning||(detected&&!canExplain?'现有新闻无法充分解释当日异动，新闻结论应降权，操作层避免追涨并等待确认。':''));
  return {
    priceActionDetected:detected,
    priceActionType:type,
    explanationLevel:inferredLevel,
    canExplainTodayMove:canExplain,
    explanationConfidence:enumOr(src.explanationConfidence,['high','medium','low'],'low'),
    explanation:String(src.explanation||''),
    missingData:missing,
    warning
  };
}
function defaultShortTermSentiment(stock={}){
  const old=defaultSentimentReview(stock);
  return {
    updatedAt:'',
    marketMood:'',
    fundFlowView:'',
    sectorHeat:'',
    institutionalView:'',
    riskFlags:[],
    confidence:'low',
    actionHint:'',
    _fallback:old
  };
}
function normalizeShortTermSentiment(v,stock={}){
  const hasExplicitSnapshot=Boolean(v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).length);
  const src=(v&&typeof v==='object')?v:{};
  const old=hasExplicitSnapshot?defaultSentimentReview(stock):normalizeSentimentReview(stock.sentimentReview,stock);
  const pick=(...keys)=>{
    for(const k of keys){
      if(Object.prototype.hasOwnProperty.call(src,k)&&src[k]!==undefined&&src[k]!==null&&src[k]!=='')return src[k];
    }
    return '';
  };
  const riskSource=pick('riskFlags','risks','riskPoints','negativePoints','warningFlags');
  return {
    updatedAt:normalizeDateOnly(pick('updatedAt','date','analysisDate'))||old.updatedAt||'',
    marketMood:String(pick('marketMood','marketSentiment','sentiment','mood')||old.marketMood||''),
    fundFlowView:String(pick('fundFlowView','fundFlow','fundFlowSummary','capitalFlow','moneyFlowView')||old.fundFlowView||''),
    sectorHeat:String(pick('sectorHeat','sectorMomentum','sectorHotness','themeHeat','industryHeat')||old.sectorHeat||''),
    institutionalView:String(pick('institutionalView','institutionalOpinion','institutionalViews','brokerView','analystView')||old.institutionalView||''),
    riskFlags:normalizeStringArray((Array.isArray(riskSource)&&riskSource.length)||typeof riskSource==='string'?riskSource:old.riskFlags),
    confidence:enumOr(pick('confidence','confidenceLevel')||old.confidence,['high','medium','low'],'low'),
    actionHint:String(pick('actionHint','operationHint','suggestion','note')||old.actionHint||'')
  };
}
function defaultInformationCompleteness(){
  return {news:'unknown',fundFlow:'unknown',technical:'unknown',valuation:'unknown',overall:'unknown',missingItems:[],warning:''};
}
function completenessLevel(v){return enumOr(v,['high','medium','low','unknown'],'unknown')}
function normalizeInformationCompleteness(v,stock={}){
  const src=(v&&typeof v==='object')?v:{};
  const rc=normalizeRecentCatalyst(stock.recentCatalyst,stock);
  const st=normalizeShortTermSentiment(stock.shortTermSentiment,stock);
  const tech=normalizeTechnicalReview(stock.technicalReview,stock);
  const vd=normalizeValuationData(stock.valuationData);
  const vr=normalizeValuationReview(stock.valuationReview);
  const missing=normalizeStringArray(src.missingItems);
  const news=src.news?completenessLevel(src.news):(rc.latestSourceDate||rc.recentEvents.length?'medium':'low');
  const fundFlow=src.fundFlow?completenessLevel(src.fundFlow):(st.fundFlowView?'medium':'low');
  const technical=src.technical?completenessLevel(src.technical):(tech.shortTermTechnical.price||tech.shortTermTechnical.trendStatus?'high':'low');
  const valuation=src.valuation?completenessLevel(src.valuation):((vd.valuationConclusion||vr.summary||vd.peTtm||vd.pe||vd.pb)?'medium':'low');
  if(news==='low'&&!missing.includes('新闻/公告'))missing.push('新闻/公告');
  if(fundFlow==='low'&&!missing.includes('资金流'))missing.push('资金流');
  if(technical==='low'&&!missing.includes('技术面'))missing.push('技术面');
  if(valuation==='low'&&!missing.includes('估值'))missing.push('估值');
  const lows=[news,fundFlow,technical,valuation].filter(x=>x==='low').length;
  const highs=[news,fundFlow,technical,valuation].filter(x=>x==='high').length;
  const overall=src.overall?completenessLevel(src.overall):(lows>=2?'low':(highs>=3?'high':'medium'));
  return {
    news,
    catalyst:completenessLevel(src.catalyst||src.catalystCoverage||rc.catalystCoverage),
    fundFlow,
    longTermLogic:completenessLevel(src.longTermLogic),
    fundamentals:completenessLevel(src.fundamentals||src.fundamental),
    technical,
    valuation,
    overall,
    missingItems:missing,
    warning:String(src.warning||'')
  };
}
function defaultEtfAnalysis(stock={}){
  return {
    symbol:String(stock.code||stock.symbol||''),
    updatedAt:'',
    indexName:'',
    indexValuationLevel:'',
    historicalPercentile:null,
    industryTrend:'',
    macroView:'',
    constituentQuality:'',
    liquidityView:'',
    trackingRisk:'',
    conclusion:'',
    keyPoints:[],
    riskFlags:[],
    actionHint:'',
    score:null,
    confidence:'low'
  };
}
function normalizeEtfScoreValue(x){
  if(x===null||x===undefined||x==='')return null;
  const n=Number(x);
  if(!isFinite(n)||n<0)return null;
  if(n>10&&n<=100)return Number((n/10).toFixed(1));
  return Math.min(n,10);
}
function normalizeEtfAnalysis(v,stock={}){
  const src=(v&&typeof v==='object')?v:{};
  const arr=x=>Array.isArray(x)?x.map(i=>String(i??'').trim()).filter(Boolean):String(x||'').split(/\n|,|，/).map(i=>String(i||'').trim()).filter(Boolean);
  const nullableNumber=x=>{const n=Number(x);return isFinite(n)&&n>=0?n:null};
  const confidence=String(src.confidence||'low').trim();
  return {
    symbol:String(src.symbol||stock.code||stock.symbol||''),
    updatedAt:normalizeDateOnly(src.updatedAt)||String(src.updatedAt||''),
    indexName:String(src.indexName||''),
    indexValuationLevel:String(src.indexValuationLevel||''),
    historicalPercentile:nullableNumber(src.historicalPercentile),
    industryTrend:String(src.industryTrend||''),
    macroView:String(src.macroView||''),
    constituentQuality:String(src.constituentQuality||''),
    liquidityView:String(src.liquidityView||''),
    trackingRisk:String(src.trackingRisk||''),
    conclusion:String(src.conclusion||''),
    keyPoints:arr(src.keyPoints),
    riskFlags:arr(src.riskFlags||src.risks),
    actionHint:String(src.actionHint||''),
    score:normalizeEtfScoreValue(src.score),
    confidence:['low','medium','high'].includes(confidence)?confidence:'low'
  };
}
function valuationMetricSignal(label,current,low,mid,high){
  const warnings=[];
  if(!(current>0)||!(low>0)||!(mid>0)||!(high>0)||!(low<=mid&&mid<=high)){
    warnings.push(`${label} 数据或历史区间不足，无法自动评分`);
    return {score:0,summary:'',signals:[],warnings};
  }
  if(current<=low)return {score:9,summary:`当前 ${label} 低于历史低位，估值处于低估区间`,signals:[`${label} ${current} <= 历史低位 ${low}`],warnings};
  if(current<=mid)return {score:8,summary:`当前 ${label} 低于历史中位数，估值处于合理偏低区间`,signals:[`${label} ${current} <= 历史中位数 ${mid}`],warnings};
  if(current<=high)return {score:6,summary:`当前 ${label} 低于历史高位，估值处于合理偏高区间`,signals:[`${label} ${current} <= 历史高位 ${high}`],warnings};
  return {score:4,summary:`当前 ${label} 高于历史高位，估值偏贵`,signals:[],warnings:[`${label} ${current} > 历史高位 ${high}`]};
}
function calculateValuationSignal(stock){
  const vd=normalizeValuationData(stock&&stock.valuationData);
  const allWarnings=[];
  let used='PE';
  let base=valuationMetricSignal('PE',vd.pe,vd.historicalPeLow,vd.historicalPeMid,vd.historicalPeHigh);
  allWarnings.push(...base.warnings);
  if(!base.score){
    used='PB';
    base=valuationMetricSignal('PB',vd.pb,vd.historicalPbLow,vd.historicalPbMid,vd.historicalPbHigh);
    allWarnings.push(...base.warnings);
  }
  if(!base.score){
    used='PS';
    base=valuationMetricSignal('PS',vd.ps,vd.historicalPsLow,vd.historicalPsMid,vd.historicalPsHigh);
    allWarnings.push(...base.warnings);
  }
  let valuationScore=base.score||0;
  const signals=[...base.signals];
  const warnings=base.score?[...base.warnings]:allWarnings;
  if(valuationScore>0){
    if(vd.profitGrowth>=30){valuationScore+=1;signals.push(`利润增速 ${vd.profitGrowth}% >= 30%，估值评分上调`)}
    if(vd.revenueGrowth>=30){valuationScore+=.5;signals.push(`收入增速 ${vd.revenueGrowth}% >= 30%，估值评分小幅上调`)}
    if(vd.profitGrowth<0){valuationScore-=1;warnings.push(`利润增速 ${vd.profitGrowth}% < 0，估值评分下调`)}
    if(vd.revenueGrowth<0){valuationScore-=.5;warnings.push(`收入增速 ${vd.revenueGrowth}% < 0，估值评分小幅下调`)}
    if(vd.dividendYield>0)signals.push(`股息率 ${vd.dividendYield}%`);
    if(vd.valuationNote)signals.push(`人工备注：${vd.valuationNote}`);
  }
  valuationScore=Number(normalizeAnalysisScoreValue(valuationScore).toFixed(1));
  const valuationStatus=valuationScore>=7.5?'positive':(valuationScore>=5?'neutral':'negative');
  const valuationSummary=valuationScore>0?base.summary:'缺少估值数据，无法自动判断。';
  if(!valuationScore&&!warnings.length)warnings.push('缺少估值数据，无法自动判断');
  return {valuationScore,valuationStatus,valuationSummary,signals,warnings,usedMetric:valuationScore>0?used:''};
}
function valuationMetricSignal(label,current,low,mid,high){
  const warnings=[];
  if(!(current>0)||!(low>0)||!(mid>0)||!(high>0)||!(low<=mid&&mid<=high)){
    warnings.push(`${label} 数据或历史区间不足，无法按历史区间评分`);
    return {score:0,summary:'',signals:[],warnings};
  }
  if(current<=low)return {score:9,summary:`当前 ${label} 低于历史低位，估值处于低估区间`,signals:[`${label} ${current} <= 历史低位 ${low}`],warnings};
  if(current<=mid)return {score:8,summary:`当前 ${label} 低于历史中位数，估值处于合理偏低区间`,signals:[`${label} ${current} <= 历史中位数 ${mid}`],warnings};
  if(current<=high)return {score:6,summary:`当前 ${label} 低于历史高位，估值处于合理偏高区间`,signals:[`${label} ${current} <= 历史高位 ${high}`],warnings};
  return {score:4,summary:`当前 ${label} 高于历史高位，估值偏贵`,signals:[],warnings:[`${label} ${current} > 历史高位 ${high}`]};
}
function valuationConclusionSignal(vd,vr){
  const text=[vd.valuationConclusion,vd.valuationNote,vr.summary,vr.actionHint,(vr.riskFlags||[]).join(' ')].map(x=>String(x||'')).join(' ');
  if(/无法判断|无法评估|资料不足|数据不足/.test(text))return {score:null,summary:'估值资料不足，无法根据结论评分',signals:[],warnings:['估值结论为无法判断']};
  const rules=[
    {re:/明显高估|严重高估/,score:2,summary:'估值结论显示明显高估'},
    {re:/高估/,score:3,summary:'估值结论显示高估'},
    {re:/合理偏贵|估值偏贵|偏贵|不属于低估/,score:4.5,summary:'估值结论显示合理偏贵'},
    {re:/合理偏低/,score:7,summary:'估值结论显示合理偏低'},
    {re:/明显低估|深度低估/,score:8.8,summary:'估值结论显示明显低估'},
    {re:/低估|估值偏低/,score:8,summary:'估值结论显示低估'},
    {re:/合理|中性|公允/,score:6,summary:'估值结论显示合理'}
  ];
  const hit=rules.find(x=>x.re.test(text));
  if(hit)return {score:hit.score,summary:hit.summary,signals:[`估值结论：${String(vd.valuationConclusion||vr.summary||'已导入估值结论').slice(0,80)}`],warnings:[]};
  if(vd.historicalPercentile!==null&&vd.historicalPercentile!==undefined&&isFinite(Number(vd.historicalPercentile))){
    const p=Number(vd.historicalPercentile);
    if(p<=20)return {score:8.5,summary:'历史估值分位较低，估值偏便宜',signals:[`历史估值分位 ${p}%`],warnings:[]};
    if(p<=40)return {score:7,summary:'历史估值分位处于偏低区间',signals:[`历史估值分位 ${p}%`],warnings:[]};
    if(p<=60)return {score:6,summary:'历史估值分位处于中性区间',signals:[`历史估值分位 ${p}%`],warnings:[]};
    if(p<=80)return {score:5,summary:'历史估值分位偏高',signals:[`历史估值分位 ${p}%`],warnings:['估值分位偏高']};
    if(p<=90)return {score:4.5,summary:'历史估值分位较高，估值合理偏贵',signals:[`历史估值分位 ${p}%`],warnings:['历史估值分位较高']};
    return {score:3.5,summary:'历史估值分位很高，估值偏贵',signals:[`历史估值分位 ${p}%`],warnings:['历史估值分位很高']};
  }
  return {score:null,summary:'未找到可直接映射的估值结论',signals:[],warnings:[]};
}
function calculateValuationSignal(stock){
  const vd=normalizeValuationData(stock&&stock.valuationData);
  const vr=normalizeValuationReview(stock&&stock.valuationReview);
  const allWarnings=[];
  let used='PE';
  let base=valuationMetricSignal('PE',vd.pe,vd.historicalPeLow,vd.historicalPeMid,vd.historicalPeHigh);
  allWarnings.push(...base.warnings);
  if(!base.score){
    used='PB';
    base=valuationMetricSignal('PB',vd.pb,vd.historicalPbLow,vd.historicalPbMid,vd.historicalPbHigh);
    allWarnings.push(...base.warnings);
  }
  if(!base.score){
    used='PS';
    base=valuationMetricSignal('PS',vd.ps,vd.historicalPsLow,vd.historicalPsMid,vd.historicalPsHigh);
    allWarnings.push(...base.warnings);
  }
  const mapped=valuationConclusionSignal(vd,vr);
  const hasMapped=mapped.score!==null&&mapped.score!==undefined;
  let valuationScore=hasMapped?mapped.score:(base.score||0);
  const signals=hasMapped?[...mapped.signals,...base.signals]:[...base.signals];
  const warnings=hasMapped?[...mapped.warnings,...allWarnings]:(base.score?[...base.warnings]:allWarnings);
  if(hasMapped)used='valuationConclusion';
  if(valuationScore>0){
    if(vd.profitGrowth>=30){valuationScore+=1;signals.push(`利润增速 ${vd.profitGrowth}% >= 30%，估值评分上调`)}
    if(vd.revenueGrowth>=30){valuationScore+=.5;signals.push(`收入增速 ${vd.revenueGrowth}% >= 30%，估值评分小幅上调`)}
    if(vd.profitGrowth<0){valuationScore-=1;warnings.push(`利润增速 ${vd.profitGrowth}% < 0，估值评分下调`)}
    if(vd.revenueGrowth<0){valuationScore-=.5;warnings.push(`收入增速 ${vd.revenueGrowth}% < 0，估值评分小幅下调`)}
    if(vd.dividendYield>0)signals.push(`股息率 ${vd.dividendYield}%`);
    if(vd.valuationNote)signals.push(`人工备注：${vd.valuationNote}`);
  }
  valuationScore=Number(normalizeAnalysisScoreValue(valuationScore).toFixed(1));
  const valuationStatus=valuationScore>=7.5?'positive':(valuationScore>=5?'neutral':'negative');
  const valuationSummary=valuationScore>0?(hasMapped?mapped.summary:base.summary):'缺少估值数据，无法自动判断。';
  if(!valuationScore&&!warnings.length)warnings.push('缺少估值数据，无法自动判断');
  return {valuationScore,valuationStatus,valuationSummary,signals,warnings,usedMetric:valuationScore>0?used:''};
}
const FINANCIAL_FIELDS=['revenue','revenueGrowth','netProfit','profitGrowth','grossMargin','netMargin','roe','operatingCashFlow','freeCashFlow','debtRatio','eps'];
function defaultFinancialData(stock={}){
  return {
    revenue:0,
    revenueGrowth:0,
    netProfit:0,
    profitGrowth:0,
    grossMargin:0,
    netMargin:0,
    roe:0,
    operatingCashFlow:0,
    freeCashFlow:0,
    debtRatio:0,
    eps:0,
    reportPeriod:'',
    currency:'',
    financialNote:'',
    lastUpdated:''
  };
}
function normalizeFinancialData(v){
  const src=(v&&typeof v==='object')?v:{};
  const out=defaultFinancialData();
  out.revenue=clampNumber(src.revenue,0,Number.MAX_SAFE_INTEGER,0);
  out.revenueGrowth=clampNumber(src.revenueGrowth,-Number.MAX_SAFE_INTEGER,Number.MAX_SAFE_INTEGER,0);
  out.netProfit=clampNumber(src.netProfit,-Number.MAX_SAFE_INTEGER,Number.MAX_SAFE_INTEGER,0);
  out.profitGrowth=clampNumber(src.profitGrowth,-Number.MAX_SAFE_INTEGER,Number.MAX_SAFE_INTEGER,0);
  out.grossMargin=clampNumber(src.grossMargin,-100,100,0);
  out.netMargin=clampNumber(src.netMargin,-100,100,0);
  out.roe=clampNumber(src.roe,-100,100,0);
  out.operatingCashFlow=clampNumber(src.operatingCashFlow,-Number.MAX_SAFE_INTEGER,Number.MAX_SAFE_INTEGER,0);
  out.freeCashFlow=clampNumber(src.freeCashFlow,-Number.MAX_SAFE_INTEGER,Number.MAX_SAFE_INTEGER,0);
  out.debtRatio=clampNumber(src.debtRatio,0,100,0);
  out.eps=clampNumber(src.eps,-Number.MAX_SAFE_INTEGER,Number.MAX_SAFE_INTEGER,0);
  out.reportPeriod=String(src.reportPeriod||'');
  out.currency=String(src.currency||'');
  out.financialNote=String(src.financialNote||'');
  out.lastUpdated=String(src.lastUpdated||'');
  return out;
}
function hasFinancialData(v){
  const fd=normalizeFinancialData(v);
  return FINANCIAL_FIELDS.some(k=>Number(fd[k])!==0)||Boolean(fd.reportPeriod||fd.currency||fd.financialNote);
}
function calculateFinancialSignal(stock){
  const fd=normalizeFinancialData(stock&&stock.financialData);
  const signals=[];
  const warnings=[];
  if(!hasFinancialData(fd)){
    return {
      financialScore:0,
      financialStatus:'negative',
      financialSummary:'缺少财务数据，无法自动判断。',
      signals,
      warnings:['缺少财务数据，无法自动判断']
    };
  }
  let score=5;
  if(fd.revenueGrowth>20){score+=1;signals.push(`收入增速 ${fd.revenueGrowth}% > 20%，成长性较好`)}
  else if(fd.revenueGrowth<0){score-=1;warnings.push(`收入增速 ${fd.revenueGrowth}% < 0，收入承压`)}
  if(fd.profitGrowth>20){score+=1.2;signals.push(`利润增速 ${fd.profitGrowth}% > 20%，盈利增长较好`)}
  else if(fd.profitGrowth<0){score-=1.2;warnings.push(`利润增速 ${fd.profitGrowth}% < 0，盈利承压`)}
  if(fd.grossMargin>=40){score+=.8;signals.push(`毛利率 ${fd.grossMargin}% 较高`)}
  else if(fd.grossMargin>0&&fd.grossMargin<15){score-=.5;warnings.push(`毛利率 ${fd.grossMargin}% 偏低`)}
  if(fd.netMargin>=15){score+=.8;signals.push(`净利率 ${fd.netMargin}% 较高`)}
  else if(fd.netMargin>0&&fd.netMargin<5){score-=.5;warnings.push(`净利率 ${fd.netMargin}% 偏低`)}
  if(fd.roe>15){score+=.8;signals.push(`ROE ${fd.roe}% > 15%，资本回报较好`)}
  else if(fd.roe<0){score-=.5;warnings.push(`ROE ${fd.roe}% 为负`)}
  if(fd.operatingCashFlow>0){score+=.6;signals.push('经营现金流为正')}
  else if(fd.operatingCashFlow<0){score-=.6;warnings.push('经营现金流为负')}
  if(fd.freeCashFlow>0){score+=.6;signals.push('自由现金流为正')}
  else if(fd.freeCashFlow<0){score-=.6;warnings.push('自由现金流为负')}
  if(fd.debtRatio>70){score-=1.2;warnings.push(`资产负债率 ${fd.debtRatio}% > 70%，杠杆偏高`)}
  else if(fd.debtRatio>0&&fd.debtRatio<=50){score+=.3;signals.push(`资产负债率 ${fd.debtRatio}% 相对可控`)}
  if(fd.reportPeriod)signals.push(`报告期 ${fd.reportPeriod}`);
  if(fd.financialNote)signals.push(`人工备注：${fd.financialNote}`);
  const financialScore=Number(normalizeAnalysisScoreValue(score).toFixed(1));
  const financialStatus=financialScore>=7.5?'positive':(financialScore>=5?'neutral':'negative');
  const financialSummary=financialScore>=7.5?'财务质量偏强，增长、盈利或现金流表现较好。':(financialScore>=5?'财务质量中性，需继续跟踪增长、利润率和现金流。':'财务质量偏弱，需重点复核增长、现金流或杠杆风险。');
  return {financialScore,financialStatus,financialSummary,signals,warnings};
}
function normalizePriceDate(value){
  const s=String(value||'').trim();
  if(!s)return '';
  let m=s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/);
  if(m){
    const d=new Date(Date.UTC(Number(m[1]),Number(m[2])-1,Number(m[3])));
    if(d.getUTCFullYear()===Number(m[1])&&d.getUTCMonth()===Number(m[2])-1&&d.getUTCDate()===Number(m[3]))return d.toISOString().slice(0,10);
  }
  m=s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if(m){
    const a=Number(m[1]),b=Number(m[2]),y=Number(m[3]);
    const month=a>12?b:a;
    const day=a>12?a:b;
    const d=new Date(Date.UTC(y,month-1,day));
    if(d.getUTCFullYear()===y&&d.getUTCMonth()===month-1&&d.getUTCDate()===day)return d.toISOString().slice(0,10);
  }
  m=s.match(/^([A-Za-z]{3,9})\s+(\d{1,2}),\s*(\d{4})$/);
  if(m){
    const months={jan:0,january:0,feb:1,february:1,mar:2,march:2,apr:3,april:3,may:4,jun:5,june:5,jul:6,july:6,aug:7,august:7,sep:8,sept:8,september:8,oct:9,october:9,nov:10,november:10,dec:11,december:11};
    const month=months[m[1].toLowerCase()];
    const day=Number(m[2]),y=Number(m[3]);
    if(month!==undefined){
      const d=new Date(Date.UTC(y,month,day));
      if(d.getUTCFullYear()===y&&d.getUTCMonth()===month&&d.getUTCDate()===day)return d.toISOString().slice(0,10);
    }
  }
  const t=Date.parse(s);
  if(isFinite(t))return new Date(t).toISOString().slice(0,10);
  return '';
}
function normalizeClosePrice(value){
  const n=Number(String(value??'').replace(/,/g,'').trim());
  return isFinite(n)&&n>0?n:0;
}
function normalizePriceHistory(stockOrHistory){
  const raw=Array.isArray(stockOrHistory)?stockOrHistory:(stockOrHistory&&Array.isArray(stockOrHistory.priceHistory)?stockOrHistory.priceHistory:[]);
  const byDate=new Map();
  raw.forEach(row=>{
    const date=normalizePriceDate(row&&row.date);
    const close=normalizeClosePrice(row&&row.close);
    if(!date||!(close>0))return;
    const numberOrNull=value=>{
      const number=Number(value);
      return isFinite(number)?number:null;
    };
    const normalized={...row,date,close};
    ['open','high','low','volume','amount'].forEach(key=>{
      const value=numberOrNull(row&&row[key]);
      if(value!==null)normalized[key]=value;
      else delete normalized[key];
    });
    normalized.adjustment=String(row&&row.adjustment||'unknown');
    normalized.price_basis=String(row&&row.price_basis||'unknown');
    normalized.provider=String(row&&row.provider||'manual');
    normalized.fetched_at=String(row&&row.fetched_at||'');
    normalized.is_complete_bar=row&&row.is_complete_bar!==undefined?Boolean(row.is_complete_bar):true;
    byDate.set(date,normalized);
  });
  return Array.from(byDate.values()).sort((a,b)=>a.date.localeCompare(b.date));
}
function calculateMovingAverage(priceHistory,window){
  const history=normalizePriceHistory(priceHistory);
  const n=Math.max(1,Math.floor(Number(window)||0));
  const warnings=[];
  if(history.length<n){
    warnings.push(`历史价格不足 ${n} 条，无法计算 MA${n}`);
    return {value:0,warnings};
  }
  const slice=history.slice(-n);
  const value=slice.reduce((sum,x)=>sum+x.close,0)/n;
  return {value:Number(value.toFixed(4)),warnings};
}
function calculateSupportResistance(priceHistory){
  const history=normalizePriceHistory(priceHistory);
  const warnings=[];
  if(history.length<20){
    warnings.push('历史价格不足 20 条，无法计算支撑位/压力位');
    return {supportPrice:0,resistancePrice:0,warnings};
  }
  const slice=history.slice(-60);
  const lows=slice.map(x=>x.close);
  return {supportPrice:Number(Math.min(...lows).toFixed(4)),resistancePrice:Number(Math.max(...lows).toFixed(4)),warnings};
}
function latestCompletePriceBar(stockOrHistory){
  const complete=normalizePriceHistory(stockOrHistory).filter(row=>row.is_complete_bar!==false);
  return complete.length?complete[complete.length-1]:null;
}
function calculateMacd(priceHistory){
  const closes=normalizePriceHistory(priceHistory).filter(row=>row.is_complete_bar!==false).map(row=>row.close);
  if(closes.length<26)return {dif:null,dea:null,histogram:null};
  const ema=(values,period)=>{
    const alpha=2/(period+1);let value=values[0];const out=[value];
    for(let index=1;index<values.length;index+=1){value=values[index]*alpha+value*(1-alpha);out.push(value)}
    return out;
  };
  const fast=ema(closes,12),slow=ema(closes,26);
  const dif=fast.map((value,index)=>value-slow[index]);
  const dea=ema(dif,9);
  const last=dif.length-1;
  return {dif:Number(dif[last].toFixed(6)),dea:Number(dea[last].toFixed(6)),histogram:Number(((dif[last]-dea[last])*2).toFixed(6))};
}
function technicalFreshnessStatus(technicalAsOf,referenceDate=todayDate(),marketFreshness={}){
  const asOf=normalizePriceDate(technicalAsOf),reference=normalizePriceDate(referenceDate);
  if(!asOf)return 'unavailable';
  if(!reference)return 'anomaly';
  const start=Date.parse(`${asOf}T00:00:00Z`),end=Date.parse(`${reference}T00:00:00Z`);
  if(!isFinite(start)||!isFinite(end)||start>end)return 'anomaly';
  if(String(marketFreshness&&marketFreshness.kline_status||'').toLowerCase()==='current')return 'fresh';
  let businessDays=0;
  for(let cursor=start+86400000;cursor<=end;cursor+=86400000){const day=new Date(cursor).getUTCDay();if(day!==0&&day!==6)businessDays+=1}
  return businessDays<=3?'fresh':'stale';
}
function volumeScaleForProvider(provider,symbol){
  const source=String(provider||'').trim().toLowerCase();
  const code=String(symbol||'').trim().toUpperCase();
  if(source==='yahoo')return 1;
  if(source==='eastmoney'){
    if(/\.(SS|SZ)$/.test(code))return 100;
    if(/\.HK$/.test(code))return 1;
  }
  return null;
}
function normalizeVolumeComparison(priceHistory,symbol){
  const rows=normalizePriceHistory(priceHistory).filter(row=>row.is_complete_bar!==false&&Number(row.volume)>0).slice(-20);
  if(rows.length<10)return {volume:null,volumeAvg20:null,recent5Average:null,previous5Average:null,volumeChangePct:null,volumeStatus:'unavailable',volumeWarning:'insufficient_volume_history',volumeProviderTransition:false};
  const providers=rows.map(row=>String(row.provider||'').trim().toLowerCase());
  const providerTransition=new Set(providers).size>1;
  const normalized=rows.map(row=>{
    const scale=volumeScaleForProvider(row.provider,symbol);
    return scale===null?null:Number(row.volume)*scale;
  });
  if(normalized.some(value=>!Number.isFinite(value)||value<=0))return {volume:null,volumeAvg20:null,recent5Average:null,previous5Average:null,volumeChangePct:null,volumeStatus:'unavailable',volumeWarning:providerTransition?'provider_scale_mismatch':'unknown_volume_scale',volumeProviderTransition:providerTransition};
  const average=values=>values.reduce((sum,value)=>sum+value,0)/values.length;
  const recent=average(normalized.slice(-5)),previous=average(normalized.slice(-10,-5));
  const volumeChangePct=previous>0?Number(((recent/previous-1)*100).toFixed(2)):null;
  return {volume:normalized[normalized.length-1],volumeAvg20:Number(average(normalized).toFixed(2)),recent5Average:Number(recent.toFixed(2)),previous5Average:Number(previous.toFixed(2)),volumeChangePct,volumeStatus:'comparable',volumeWarning:'',volumeProviderTransition:providerTransition};
}
function updateTechnicalDataFromPriceHistory(stock,options={}){
  if(!stock)return {updated:false,warnings:['标的不存在']};
  stock.priceHistory=normalizePriceHistory(stock);
  const completeHistory=stock.priceHistory.filter(row=>row.is_complete_bar!==false);
  const latest=latestCompletePriceBar(completeHistory);
  const td=normalizeTechnicalData(stock.technicalData);
  const supplied=stock.technicalIndicators&&typeof stock.technicalIndicators==='object'?stock.technicalIndicators:{};
  const suppliedAsOf=normalizePriceDate(supplied.last_trade_date);
  const useSupplied=Boolean(latest&&suppliedAsOf===latest.date);
  const numberOr=(value,fallback)=>{const n=Number(value);return isFinite(n)?n:fallback};
  const ma5=calculateMovingAverage(completeHistory,5),ma10=calculateMovingAverage(completeHistory,10),ma20=calculateMovingAverage(completeHistory,20),ma60=calculateMovingAverage(completeHistory,60),ma120=calculateMovingAverage(completeHistory,120);
  const derivedMacd=calculateMacd(completeHistory),suppliedMacd=supplied.macd&&typeof supplied.macd==='object'?supplied.macd:{};
  const sr=calculateSupportResistance(completeHistory);
  const technicalAsOf=latest?latest.date:'';
  const status=technicalFreshnessStatus(technicalAsOf,options.referenceDate||todayDate(),stock.marketDataFreshness);
  const volumeFacts=normalizeVolumeComparison(completeHistory,String(stock.code||stock.symbol||td.symbol||''));
  stock.technicalIndicators={...supplied,volume_change:{recent_5d_average:volumeFacts.recent5Average,previous_5d_average:volumeFacts.previous5Average,change_pct:volumeFacts.volumeChangePct,unit:'shares',status:volumeFacts.volumeStatus,warning:volumeFacts.volumeWarning,provider_transition:volumeFacts.volumeProviderTransition}};
  const warning=status==='stale'?'完整日线技术数据已过期，请降低结论置信度。':(status==='unavailable'?'缺少可用的完整日线技术数据。':(status==='anomaly'?'完整日线日期异常，请勿基于该数据作出量化判断。':''));
  stock.technicalData=normalizeTechnicalData({
    ...td,
    symbol:String(stock.code||stock.symbol||td.symbol||''),
    price:latest?latest.close:null,
    priceUpdatedAt:technicalAsOf,
    latestCompleteBar:technicalAsOf,
    technicalAsOf,
    technicalDataStatus:status,
    technicalWarning:warning,
    ma5:useSupplied?numberOr(supplied.ma5,ma5.value):ma5.value,
    ma10:useSupplied?numberOr(supplied.ma10,ma10.value):ma10.value,
    ma20:useSupplied?numberOr(supplied.ma20,ma20.value):ma20.value,
    ma60:useSupplied?numberOr(supplied.ma60,ma60.value):ma60.value,
    ma120:ma120.value,
    macd:{
      dif:useSupplied?numberOr(suppliedMacd.dif,derivedMacd.dif):derivedMacd.dif,
      dea:useSupplied?numberOr(suppliedMacd.dea,derivedMacd.dea):derivedMacd.dea,
      histogram:useSupplied?numberOr(suppliedMacd.histogram,derivedMacd.histogram):derivedMacd.histogram
    },
    volume:volumeFacts.volume,
    volumeAvg20:volumeFacts.volumeAvg20,
    volumeChangePct:volumeFacts.volumeChangePct,
    volumeStatus:volumeFacts.volumeStatus,
    volumeWarning:volumeFacts.volumeWarning,
    volumeProviderTransition:volumeFacts.volumeProviderTransition,
    supportPrice:sr.supportPrice,
    resistancePrice:sr.resistancePrice,
    trendNote:td.trendNote,
    lastUpdated:useSupplied?String(supplied.updated_at||technicalAsOf):technicalAsOf
  });
  if(technicalAsOf)touchDataFreshness(stock,'technicalUpdatedAt',technicalAsOf);
  return {updated:Boolean(latest),technicalAsOf,status,warnings:[...ma5.warnings,...ma10.warnings,...ma20.warnings,...ma60.warnings,...ma120.warnings,...sr.warnings]};
}
function daysSinceDate(value){
  if(!value)return null;
  const t=Date.parse(value);
  if(!isFinite(t))return null;
  return Math.max(0,Math.floor((Date.now()-t)/86400000));
}
function getAnalysisFreshness(stock){
  const inputs=normalizeAnalysisInputs(stock&&stock.analysisInputs);
  const days=daysSinceDate(inputs.lastUpdated);
  const freshnessWarnings=[];
  const freshnessSuggestions=[];
  let staleLevel='unknown';
  if(days===null){
    freshnessWarnings.push('分析资料没有更新时间');
    freshnessSuggestions.push('建议补充最新财报、新闻和技术观察后保存分析资料');
  }else if(days<=30){
    staleLevel='fresh';
  }else if(days<=90){
    staleLevel='stale';
    freshnessWarnings.push(`分析资料已 ${days} 天未更新`);
    freshnessSuggestions.push('建议复核最近财报、公告和价格趋势是否改变原判断');
  }else{
    staleLevel='veryStale';
    freshnessWarnings.push(`分析资料已 ${days} 天未更新，可能明显过期`);
    freshnessSuggestions.push('建议重新整理分析资料并复核九模块评分');
  }
  return {staleLevel,daysSinceUpdate:days,freshnessWarnings,freshnessSuggestions};
}
function nearWithinPct(price,level,pct=.05){
  return price>0&&level>0&&Math.abs(price-level)/level<=pct;
}
function calculateTechnicalSignal(stock){
  const s=stock||{};
  const td=normalizeTechnicalData(s.technicalData);
  const price=stockCurrentPrice(s);
  const signals=[];
  const warnings=[];
  let technicalScore=5;
  let technicalStatus='neutral';
  let technicalSummary='技术数据不足，暂按震荡中性处理。';
  if(price<=0){
    warnings.push('缺少当前价格，无法计算技术评分');
    return {technicalScore:0,technicalStatus:'neutral',technicalSummary:'缺少当前价格，无法计算技术评分。',signals,warnings};
  }
  const has20=td.ma20>0,has60=td.ma60>0,has120=td.ma120>0;
  if(has20&&has60&&price>td.ma20&&td.ma20>td.ma60){
    technicalScore=8;
    technicalStatus='positive';
    technicalSummary='价格站上20日线，且20日线高于60日线，短中期趋势偏强。';
    signals.push('currentPrice > ma20 > ma60，强势趋势');
  }else if(has60&&price>td.ma60&&(!has20||td.ma20>=td.ma60)){
    technicalScore=7;
    technicalStatus='positive';
    technicalSummary='价格在60日线上方，均线结构中性偏强。';
    signals.push('currentPrice > ma60 且 ma20 >= ma60，中性偏强');
  }else if(has20&&has60&&price<td.ma20&&price<td.ma60){
    technicalScore=4;
    technicalStatus='negative';
    technicalSummary='价格同时低于20日线和60日线，短中期趋势偏弱。';
    warnings.push('currentPrice < ma20 且 < ma60，趋势偏弱');
  }else{
    technicalScore=has20||has60||has120?6:5;
    technicalStatus='neutral';
    technicalSummary=has20||has60||has120?'均线信号不充分，整体偏震荡。':'均线数据不足，暂按震荡中性处理。';
    signals.push('趋势信号暂不明确');
  }
  if(has120&&price<td.ma120){
    technicalScore=Math.min(technicalScore,3);
    technicalStatus='negative';
    technicalSummary='价格低于120日线，中长期趋势转弱。';
    warnings.push('currentPrice < ma120，中长期转弱');
  }
  if(nearWithinPct(price,td.supportPrice)){
    signals.push('当前价格接近支撑位5%以内');
    if(technicalStatus==='negative')technicalScore=Math.max(technicalScore,4);
  }
  if(nearWithinPct(price,td.resistancePrice)){
    warnings.push('当前价格接近压力位5%以内');
  }
  if(td.trendNote)signals.push(`人工备注：${td.trendNote}`);
  technicalScore=normalizeAnalysisScoreValue(technicalScore);
  return {technicalScore,technicalStatus,technicalSummary,signals,warnings};
}
function defaultAnalysisModule(){return {summary:'',score:0,status:'neutral',keyPoints:[],watchItems:[]}}
function defaultConclusionModule(stock={}){
  return {...defaultAnalysisModule(),positionRole:stock.role||'',actionPlan:'',buyRules:[],sellRules:[],invalidationConditions:[]};
}
function defaultAnalysisFramework(stock={}){
  return {
    macro:defaultAnalysisModule(),
    industry:defaultAnalysisModule(),
    company:defaultAnalysisModule(),
    financials:defaultAnalysisModule(),
    valuation:defaultAnalysisModule(),
    technical:defaultAnalysisModule(),
    capitalFlow:defaultAnalysisModule(),
    risks:defaultAnalysisModule(),
    conclusion:defaultConclusionModule(stock)
  };
}
function makeTemplateFramework(role,profile){
  const fw=defaultAnalysisFramework({role});
  Object.keys(profile||{}).forEach(k=>{fw[k]={...fw[k],...profile[k]}});
  fw.conclusion.positionRole=role;
  return fw;
}
const ANALYSIS_TEMPLATES={
  growthStock:{
    label:'成长股',
    positionRole:'成长仓',
    analysisInputs:{
      financialReport:'重点补充：收入增速、毛利率趋势、研发/销售投入、现金流质量、管理层指引。',
      news:'重点补充：新品、订单、渠道扩张、政策催化、竞争格局变化。',
      technicalObservation:'重点补充：趋势是否仍在上升通道、关键均线、放量突破/跌破位置。',
      capitalFlowObservation:'重点补充：机构持仓变化、北向/南向资金、成交额是否持续放大。',
      personalView:'重点补充：成长逻辑是否仍成立，当前估值是否透支未来。'
    },
    watchItems:['收入增速是否放缓','毛利率是否被竞争压缩','估值与增长是否匹配'],
    risks:['高估值回撤','增长不及预期','竞争加剧'],
    analysisFramework:makeTemplateFramework('成长仓',{
      macro:{summary:'关注利率、流动性和风险偏好对成长股估值的影响。',score:5,status:'neutral'},
      industry:{summary:'确认行业空间、渗透率和竞争阶段是否仍支持成长。',score:5,status:'neutral'},
      company:{summary:'重点评估产品力、商业模式、管理层和增长兑现能力。',score:5,status:'neutral'},
      financials:{summary:'重点检查收入增长质量、毛利率、现金流和费用效率。',score:5,status:'neutral'},
      valuation:{summary:'用增长兑现概率约束估值，避免只看远期故事。',score:5,status:'neutral'},
      technical:{summary:'用趋势和关键支撑位辅助加仓节奏。',score:5,status:'neutral'},
      capitalFlow:{summary:'观察资金是否持续认可成长逻辑。',score:5,status:'neutral'},
      risks:{summary:'主要风险来自估值压缩、增速放缓和竞争恶化。',score:5,status:'neutral'},
      conclusion:{summary:'适合在逻辑清晰且估值回落时逐步配置。',score:5,status:'neutral',actionPlan:'结合业绩兑现和估值位置分批复核。'}
    })
  },
  cyclicalStock:{
    label:'周期股',
    positionRole:'卫星仓',
    analysisInputs:{financialReport:'重点补充：价格周期、产能利用率、库存、成本曲线、资本开支。',news:'重点补充：供需扰动、政策限产、库存数据、下游需求变化。',technicalObservation:'重点补充：周期拐点、平台突破、跌破成本线相关位置。',capitalFlowObservation:'重点补充：商品价格、期货持仓、机构配置变化。',personalView:'重点补充：当前处于周期上行、顶部还是下行阶段。'},
    watchItems:['行业库存变化','产品价格趋势','供给扩张节奏'],
    risks:['周期反转','产品价格下跌','高位追涨'],
    analysisFramework:makeTemplateFramework('卫星仓',{macro:{summary:'关注经济周期、需求弹性和政策刺激力度。',score:5,status:'neutral'},industry:{summary:'核心是判断供需位置和库存周期。',score:5,status:'neutral'},company:{summary:'优先看成本优势、产能弹性和资产负债表韧性。',score:5,status:'neutral'},financials:{summary:'利润弹性大，需区分周期利润和可持续利润。',score:5,status:'neutral'},valuation:{summary:'周期股低 PE 可能是高点，高 PE 也可能是低点。',score:5,status:'neutral'},technical:{summary:'趋势拐点和价格平台突破更重要。',score:5,status:'neutral'},capitalFlow:{summary:'观察商品资金和权益资金是否共振。',score:5,status:'neutral'},risks:{summary:'主要风险是周期顶部误判和商品价格回落。',score:5,status:'neutral'},conclusion:{summary:'适合作为周期机会仓位，严格控制节奏。',score:5,status:'neutral',actionPlan:'围绕供需拐点和价格趋势复核。'}})
  },
  resourceStock:{
    label:'资源股',
    positionRole:'卫星仓',
    analysisInputs:{financialReport:'重点补充：资源储量、品位、产量、现金成本、资本开支和负债。',news:'重点补充：金属价格、矿山投产、并购、地缘政治和环保约束。',technicalObservation:'重点补充：商品价格与股价是否同向确认。',capitalFlowObservation:'重点补充：黄金/有色 ETF、期货资金、南向资金变化。',personalView:'重点补充：资源价格处于趋势还是震荡，仓位是否过度集中。'},
    watchItems:['资源价格趋势','产量和成本兑现','地缘与政策风险'],
    risks:['商品价格回落','矿山项目不及预期','地缘政治风险'],
    analysisFramework:makeTemplateFramework('卫星仓',{macro:{summary:'关注美元、实际利率、通胀和地缘风险。',score:5,status:'neutral'},industry:{summary:'资源品核心看供需缺口和库存周期。',score:5,status:'neutral'},company:{summary:'重视储量、成本曲线、项目执行和安全边际。',score:5,status:'neutral'},financials:{summary:'看现金成本、自由现金流和扩产资本开支压力。',score:5,status:'neutral'},valuation:{summary:'结合资源价格中枢和储量价值估值。',score:5,status:'neutral'},technical:{summary:'股价需与商品价格趋势互相验证。',score:5,status:'neutral'},capitalFlow:{summary:'观察商品资金、ETF 和南向资金是否共振。',score:5,status:'neutral'},risks:{summary:'主要风险是资源价格反转、项目风险和政策风险。',score:5,status:'neutral'},conclusion:{summary:'适合控制仓位参与资源周期。',score:5,status:'neutral',actionPlan:'结合商品价格、成本和仓位上限复核。'}})
  },
  techStock:{
    label:'科技股',
    positionRole:'成长仓',
    analysisInputs:{financialReport:'重点补充：研发强度、订单、客户结构、毛利率、存货和应收。',news:'重点补充：AI、半导体、算力、客户验证、产品迭代和监管变化。',technicalObservation:'重点补充：主题行情强弱、成交额、关键均线和缺口。',capitalFlowObservation:'重点补充：主题 ETF、融资余额、机构调仓和北向/南向资金。',personalView:'重点补充：技术壁垒是否真实，是否只是题材驱动。'},
    watchItems:['技术路线变化','客户订单兑现','估值和景气度匹配'],
    risks:['技术迭代失败','客户集中','题材退潮'],
    analysisFramework:makeTemplateFramework('成长仓',{macro:{summary:'关注流动性、科技政策和全球科技周期。',score:5,status:'neutral'},industry:{summary:'判断赛道景气度、技术路线和国产替代空间。',score:5,status:'neutral'},company:{summary:'核心看技术壁垒、客户验证和产品迭代能力。',score:5,status:'neutral'},financials:{summary:'关注研发投入效率、毛利率、存货和应收质量。',score:5,status:'neutral'},valuation:{summary:'科技估值需与景气度和兑现节奏匹配。',score:5,status:'neutral'},technical:{summary:'主题行情中技术趋势和成交额确认很关键。',score:5,status:'neutral'},capitalFlow:{summary:'观察主题资金是否持续流入而非短炒。',score:5,status:'neutral'},risks:{summary:'主要风险是技术路线变化、估值回撤和客户不及预期。',score:5,status:'neutral'},conclusion:{summary:'适合在产业趋势清晰时分批配置。',score:5,status:'neutral',actionPlan:'结合订单、技术验证和价格走势复核。'}})
  },
  dividendStock:{
    label:'高股息股',
    positionRole:'核心仓',
    analysisInputs:{financialReport:'重点补充：分红率、自由现金流、负债率、盈利稳定性。',news:'重点补充：分红政策、监管变化、利率变化、行业价格机制。',technicalObservation:'重点补充：股息率区间、长期支撑和除权后走势。',capitalFlowObservation:'重点补充：险资、公募、南向资金和红利策略资金。',personalView:'重点补充：是收息配置还是估值修复交易。'},
    watchItems:['分红可持续性','现金流稳定性','利率变化'],
    risks:['分红下降','盈利周期下行','利率上行压制估值'],
    analysisFramework:makeTemplateFramework('核心仓',{macro:{summary:'关注利率、避险偏好和红利资产配置需求。',score:5,status:'neutral'},industry:{summary:'行业需具备稳定现金流和较强分红能力。',score:5,status:'neutral'},company:{summary:'看经营稳定性、分红纪律和治理质量。',score:5,status:'neutral'},financials:{summary:'自由现金流、负债率和分红覆盖倍数是核心。',score:5,status:'neutral'},valuation:{summary:'以股息率、现金流收益率和历史区间衡量。',score:5,status:'neutral'},technical:{summary:'关注长期支撑和股息率吸引区间。',score:5,status:'neutral'},capitalFlow:{summary:'观察红利策略资金和长期资金配置。',score:5,status:'neutral'},risks:{summary:'主要风险是盈利下滑导致分红不可持续。',score:5,status:'neutral'},conclusion:{summary:'适合作为稳定收益或防御配置。',score:5,status:'neutral',actionPlan:'结合股息率、安全边际和现金流复核。'}})
  },
  etf:{
    label:'ETF',
    positionRole:'核心仓',
    analysisInputs:{financialReport:'重点补充：跟踪指数估值、盈利预期、成分权重和费率。',news:'重点补充：指数政策、行业权重变化、宏观和资金面事件。',technicalObservation:'重点补充：指数趋势、估值分位、定投/再平衡位置。',capitalFlowObservation:'重点补充：ETF 份额变化、成交额、资金净流入。',personalView:'重点补充：配置目的、目标仓位和再平衡纪律。'},
    watchItems:['指数估值分位','跟踪误差和费率','资金流入流出'],
    risks:['指数系统性回撤','行业集中度过高','流动性不足'],
    analysisFramework:makeTemplateFramework('核心仓',{macro:{summary:'ETF 重点看宏观环境和资产类别风险溢价。',score:5,status:'neutral'},industry:{summary:'若为行业 ETF，需评估行业景气度和集中度。',score:5,status:'neutral'},company:{summary:'ETF 不评估单公司，重点看指数编制和成分结构。',score:5,status:'neutral'},financials:{summary:'关注指数整体盈利质量和基金费率。',score:5,status:'neutral'},valuation:{summary:'用指数估值分位和风险溢价判断配置价值。',score:5,status:'neutral'},technical:{summary:'用趋势、回撤和再平衡规则辅助配置。',score:5,status:'neutral'},capitalFlow:{summary:'观察 ETF 份额、成交额和资金净流入。',score:5,status:'neutral'},risks:{summary:'主要风险是系统性回撤和成分集中。',score:5,status:'neutral'},conclusion:{summary:'适合作为规则化配置工具。',score:5,status:'neutral',actionPlan:'按目标仓位、估值分位和再平衡纪律执行复核。'}})
  },
  watchOnly:{
    label:'观察仓',
    positionRole:'观察仓',
    analysisInputs:{financialReport:'重点补充：尚未买入前需要验证的财务指标。',news:'重点补充：触发纳入或排除观察的关键事件。',technicalObservation:'重点补充：观察买点、支撑位、趋势是否形成。',capitalFlowObservation:'重点补充：资金是否开始持续关注。',personalView:'重点补充：为什么观察，还缺哪些证据。'},
    watchItems:['买入触发条件','需要排除的风险','验证时间窗口'],
    risks:['证据不足','过早买入','观察逻辑失效'],
    analysisFramework:makeTemplateFramework('观察仓',{macro:{summary:'先判断宏观环境是否适合该类资产。',score:0,status:'neutral'},industry:{summary:'等待行业景气或估值证据更清晰。',score:0,status:'neutral'},company:{summary:'继续验证公司竞争力和商业模式。',score:0,status:'neutral'},financials:{summary:'等待财务质量和增长质量确认。',score:0,status:'neutral'},valuation:{summary:'等待估值进入可接受区间。',score:0,status:'neutral'},technical:{summary:'观察趋势是否形成或回调是否到位。',score:0,status:'neutral'},capitalFlow:{summary:'观察资金是否开始持续流入。',score:0,status:'neutral'},risks:{summary:'主要风险是证据不足时过早买入。',score:0,status:'neutral'},conclusion:{summary:'仅观察，不急于形成仓位。',score:0,status:'neutral',actionPlan:'等待关键证据满足后再升级为可买入标的。'}})
  }
};
function normalizeAnalysisStatus(v){return ['positive','neutral','negative'].includes(v)?v:'neutral'}
function normalizeStringArray(v){return Array.isArray(v)?v.map(x=>String(x??'').trim()).filter(Boolean):[]}
function normalizeAnalysisScoreValue(v){const n=Number(v);return isFinite(n)?Math.max(0,Math.min(10,n)):0}
function normalizeAnalysisModule(v){
  const src=(v&&typeof v==='object')?v:{};
  return {
    summary:String(src.summary||''),
    score:normalizeAnalysisScoreValue(src.score),
    status:normalizeAnalysisStatus(src.status),
    keyPoints:normalizeStringArray(src.keyPoints),
    watchItems:normalizeStringArray(src.watchItems)
  };
}
function normalizeConclusionModule(v,stock={}){
  const src=(v&&typeof v==='object')?v:{};
  return {
    ...normalizeAnalysisModule(src),
    positionRole:String(src.positionRole||stock.role||''),
    actionPlan:String(src.actionPlan||''),
    buyRules:normalizeStringArray(src.buyRules),
    sellRules:normalizeStringArray(src.sellRules),
    invalidationConditions:normalizeStringArray(src.invalidationConditions)
  };
}
function normalizeAnalysisFramework(v,stock={}){
  const src=(v&&typeof v==='object')?v:{};
  return {
    macro:normalizeAnalysisModule(src.macro),
    industry:normalizeAnalysisModule(src.industry),
    company:normalizeAnalysisModule(src.company),
    financials:normalizeAnalysisModule(src.financials),
    valuation:normalizeAnalysisModule(src.valuation),
    technical:normalizeAnalysisModule(src.technical),
    capitalFlow:normalizeAnalysisModule(src.capitalFlow),
    risks:normalizeAnalysisModule(src.risks),
    conclusion:normalizeConclusionModule(src.conclusion,stock)
  };
}
const ALLOCATION_DIMENSIONS=['macro','industry','company','financials','valuation','sentiment','technical'];
function defaultAllocationDimension(){
  return {conclusion:'',keyPoints:[],risks:[],score:null};
}
function normalizeAllocationScore(v){
  if(v===null||v===undefined||v==='')return null;
  const n=Number(v);
  return isFinite(n)?Math.max(0,Math.min(10,n)):null;
}
function normalizeAllocationWeight(v){
  if(v===null||v===undefined||v==='')return null;
  const raw=typeof v==='string'?v.replace(/%/g,'').trim():v;
  const n=Number(raw);
  return isFinite(n)?Math.max(0,Math.min(100,n)):null;
}
function firstPresent(src,keys){
  for(const k of keys){
    if(Object.prototype.hasOwnProperty.call(src,k)&&src[k]!==undefined&&src[k]!==null&&src[k]!=='')return src[k];
  }
  return undefined;
}
function normalizeAllocationStringArray(v){
  if(Array.isArray(v))return normalizeStringArray(v);
  if(typeof v==='string')return v.split(/\n|；|;/).map(x=>String(x||'').trim()).filter(Boolean);
  return [];
}
function normalizeAllocationDimension(v){
  const src=(v&&typeof v==='object')?v:{};
  return {
    conclusion:String(firstPresent(src,['conclusion','summary','comment','view'])||''),
    keyPoints:normalizeAllocationStringArray(firstPresent(src,['keyPoints','reasons','points','positivePoints'])||[]),
    risks:normalizeAllocationStringArray(firstPresent(src,['risks','keyRisks','riskFlags','negativePoints'])||[]),
    score:normalizeAllocationScore(firstPresent(src,['score','rating']))
  };
}
function defaultAllocationDecision(stock={}){
  const code=String(stock.code||stock.symbol||'');
  return {
    symbol:code,
    updatedAt:'',
    conclusion:'',
    recommendedWeightRange:'',
    recommendedTargetWeight:null,
    recommendedMaxWeight:null,
    recommendedRole:'',
    targetAdjustment:'unknown',
    capitalAllocationView:'unknown',
    confidence:'low',
    dimensions:{
      macro:defaultAllocationDimension(),
      industry:defaultAllocationDimension(),
      company:defaultAllocationDimension(),
      financials:defaultAllocationDimension(),
      valuation:defaultAllocationDimension(),
      sentiment:defaultAllocationDimension(),
      technical:defaultAllocationDimension()
    },
    allocationReasons:[],
    keyRisks:[],
    suggestedActions:[],
    notes:''
  };
}
function normalizeAllocationChoice(value,allowed,fallback){
  const raw=String(value||'').trim();
  const lower=raw.toLowerCase();
  const aliases={
    '低':'low','中':'medium','中等':'medium','高':'high',
    '上调':'raise','提高':'raise','维持':'maintain','保持':'maintain','下调':'lower','降低':'lower','观察':'watch','观望':'watch','收缩':'reduce','减少':'reduce','未知':'unknown',
    '适合':'suitable','适合配置':'suitable','有条件适合':'conditional','条件适合':'conditional','不适合':'unsuitable','不适合配置':'unsuitable','暂不适合':'unsuitable'
  };
  const mapped=aliases[raw]||aliases[lower]||lower;
  return allowed.includes(mapped)?mapped:fallback;
}
function normalizeAllocationDecision(v,stock={}){
  const d=defaultAllocationDecision(stock);
  const src=(v&&typeof v==='object')?v:{};
  const dimsSrc=firstPresent(src,['dimensions','dimensionAnalysis','analysisDimensions']);
  const dims=(dimsSrc&&typeof dimsSrc==='object')?dimsSrc:{};
  const out={
    symbol:String(firstPresent(src,['symbol','code','ticker'])||d.symbol),
    updatedAt:String(firstPresent(src,['updatedAt','lastUpdated','date'])||''),
    conclusion:String(firstPresent(src,['conclusion','summary','mainConclusion','allocationConclusion'])||''),
    recommendedWeightRange:String(firstPresent(src,['recommendedWeightRange','weightRange','allocationRange','suggestedWeightRange'])||''),
    recommendedTargetWeight:normalizeAllocationWeight(firstPresent(src,['recommendedTargetWeight','targetWeight','suggestedTargetWeight','targetAllocation'])),
    recommendedMaxWeight:normalizeAllocationWeight(firstPresent(src,['recommendedMaxWeight','maxWeight','suggestedMaxWeight','maxAllocation'])),
    recommendedRole:String(firstPresent(src,['recommendedRole','role','allocationRole','suggestedRole'])||''),
    targetAdjustment:normalizeAllocationChoice(firstPresent(src,['targetAdjustment','targetAdjustmentView','targetAction']),['raise','maintain','lower','watch','reduce','unknown'],'unknown'),
    capitalAllocationView:normalizeAllocationChoice(firstPresent(src,['capitalAllocationView','capitalView','newCapitalView','capitalAllocation']),['suitable','conditional','unsuitable','watch','unknown'],'unknown'),
    confidence:normalizeAllocationChoice(firstPresent(src,['confidence','confidenceLevel']),['low','medium','high'],'low'),
    dimensions:{},
    allocationReasons:normalizeAllocationStringArray(firstPresent(src,['allocationReasons','reasons','keyPoints','mainReasons'])||[]),
    keyRisks:normalizeAllocationStringArray(firstPresent(src,['keyRisks','risks','riskFlags','mainRisks'])||[]),
    suggestedActions:normalizeAllocationStringArray(firstPresent(src,['suggestedActions','actions','actionItems','nextActions'])||[]),
    notes:String(firstPresent(src,['notes','note','comment','memo'])||'')
  };
  ALLOCATION_DIMENSIONS.forEach(k=>out.dimensions[k]=normalizeAllocationDimension(dims[k]));
  return out;
}
function calculateAnalysisScore(framework){
  const fw=normalizeAnalysisFramework(framework);
  const total=ANALYSIS_MODULES.reduce((sum,key)=>sum+normalizeAnalysisScoreValue(fw[key]&&fw[key].score)*(ANALYSIS_WEIGHTS[key]||0),0);
  return Number(total.toFixed(1));
}
function decisionActionLabel(action){
  return {strongBuy:'强烈买入/优先加仓',buy:'可以买入/分批加仓',observe:'观察等待',hold:'持有为主',reduce:'考虑减仓'}[action]||'观察等待';
}
function actionRank(action){return {reduce:0,hold:1,observe:2,buy:3,strongBuy:4}[action]??2}
function capDecisionAction(action,maxAction){return actionRank(action)>actionRank(maxAction)?maxAction:action}
function calculatePositionGapScore(targetWeight,positionGap){
  if(targetWeight<=0)return 5;
  if(positionGap>=targetWeight*.5)return 10;
  if(positionGap>0)return 7;
  if(positionGap>=-2)return 5;
  return 2;
}
function calculateDecision(stock,portfolioContext={}){
  const s=normalizeStockAnalysis(stock||{});
  const fw=normalizeAnalysisFramework(s.analysisFramework,s);
  const strategy=normalizeStrategy(s.strategy,s);
  const total=Number(portfolioContext.totalMarketValue)||0;
  const mv=Number(s.marketValue||s.currentValue)||((Number(s.currentPrice)>0&&Number(s.shares)>0)?Number(s.currentPrice)*Number(s.shares):0);
  const currentWeight=total>0?mv/total*100:0;
  const explicitTargetWeight=Number(strategy.targetWeight)||0;
  const targetSharesForWeight=Number(strategy.targetShares)||0;
  const derivedTargetWeight=(targetSharesForWeight>0&&stockCurrentPrice(s)>0&&total>0)?targetSharesForWeight*stockCurrentPrice(s)/total*100:0;
  const targetWeight=explicitTargetWeight>0?explicitTargetWeight:derivedTargetWeight;
  const maxWeight=Number(strategy.maxWeight)||0;
  const positionGap=targetWeight-currentWeight;
  const positionGapScore=calculatePositionGapScore(targetWeight,positionGap);
  const analysisScore=normalizeAnalysisScoreValue(s.analysisScore);
  const valuationScore=normalizeAnalysisScoreValue(fw.valuation.score);
  const technicalScore=normalizeAnalysisScoreValue(fw.technical.score);
  const risksScore=normalizeAnalysisScoreValue(fw.risks.score);
  const decisionScore=Number((analysisScore*.30+valuationScore*.20+positionGapScore*.20+technicalScore*.15+risksScore*.15).toFixed(1));
  let action=decisionScore>=8.5?'strongBuy':decisionScore>=7?'buy':decisionScore>=5?'observe':decisionScore>=3?'hold':'reduce';
  const warnings=[];
  if(risksScore<=3){warnings.push('风险评分过低');action=capDecisionAction(action,'observe')}
  if(valuationScore<=3)warnings.push('估值偏弱');
  if(technicalScore<=4)warnings.push('技术趋势偏弱');
  if(valuationScore<=3&&technicalScore<=4)action=capDecisionAction(action,'hold');
  if(maxWeight>0&&currentWeight>=maxWeight){warnings.push('仓位超过最大仓位');action=capDecisionAction(action,'hold')}
  if(targetWeight<=0)warnings.push('未设置目标仓位');
  if(!strategy.capitalAllocationEnabled){warnings.push('不参与资金分配');action=capDecisionAction(action,'observe')}
  const positionStatus=targetWeight<=0?'未设置目标仓位':positionGap>2?'低于目标仓位':positionGap>=-2?'接近目标仓位':(maxWeight>0&&currentWeight>=maxWeight?'超过最大仓位':'高于目标仓位');
  const reasons=[
    `分析评分 ${analysisScore.toFixed(1)}/10`,
    `估值评分 ${valuationScore.toFixed(1)}/10`,
    `技术评分 ${technicalScore.toFixed(1)}/10`,
    `风险评分 ${risksScore.toFixed(1)}/10`,
    `当前仓位 ${currentWeight.toFixed(1)}%，目标仓位 ${targetWeight.toFixed(1)}%，差距 ${positionGap.toFixed(1)}%`
  ];
  let suffix=positionGap>2?'当前仓位低于目标仓位，可考虑分批恢复仓位':(positionGap>=-2?'当前仓位接近目标仓位，暂不需要主动加仓':'当前仓位高于目标仓位，注意控制风险');
  if(maxWeight>0&&currentWeight>=maxWeight)suffix='当前仓位超过最大仓位，控制风险';
  return {decisionScore,action,positionGap:Number(positionGap.toFixed(1)),positionStatus,reasons,warnings,suggestedAction:`${decisionActionLabel(action)}：${suffix}`,currentWeight:Number(currentWeight.toFixed(1)),targetWeight,maxWeight,priority:strategy.priority};
}
function stockCurrentPrice(stock){
  if(!stock)return 0;
  const num=value=>{
    const n=Number(value);
    return isFinite(n)&&n>0?n:null;
  };
  if(stock.type==='etf'){
    const unit=num(stock.lastUnitPrice);
    if(unit!==null)return unit;
    const value=num(stock.currentValue);
    const shares=num(stock.shares);
    if(value!==null&&shares!==null)return value/shares;
  }
  return num(stock.currentPrice)??num(stock.price)??0;
}
function stockCurrentShares(stock){
  return Number(stock&&((stock.shares!==undefined&&stock.shares!=='')?stock.shares:(stock.quantity!==undefined?stock.quantity:stock.holdingShares)))||0;
}
function roundDownToUnit(shares,unit){
  const u=Math.max(1,Math.floor(Number(unit)||1));
  return Math.floor((Number(shares)||0)/u)*u;
}
function calculateExecutionPlan(stock,portfolioContext={}){
  const s=normalizeStockAnalysis(stock||{});
  const strategy=normalizeStrategy(s.strategy,s);
  const decision=calculateDecision(s,portfolioContext);
  const currentPrice=stockCurrentPrice(s);
  const currentShares=stockCurrentShares(s);
  const total=Number(portfolioContext.totalMarketValue)||0;
  const minTradeUnit=strategy.minTradeUnit;
  const targetShares=Number(strategy.targetShares)||0;
  let remainingTargetShares=0;
  let remainingTargetValue=0;
  if(targetShares>0){
    remainingTargetShares=Math.max(0,targetShares-currentShares);
    remainingTargetValue=currentPrice>0?remainingTargetShares*currentPrice:0;
  }else{
    const targetValue=total*(Number(strategy.targetWeight)||0)/100;
    const currentValue=currentPrice>0?currentShares*currentPrice:(Number(s.marketValue||s.currentValue)||0);
    remainingTargetValue=Math.max(0,targetValue-currentValue);
    remainingTargetShares=currentPrice>0?Math.max(0,Math.floor(remainingTargetValue/currentPrice)):0;
  }
  let suggestedBuyAmount=0;
  const canBuy=decision.action==='strongBuy'||decision.action==='buy';
  if(canBuy&&remainingTargetValue>0){
    suggestedBuyAmount=Number(strategy.preferredBuyAmount)||0;
    suggestedBuyAmount=suggestedBuyAmount>0?(decision.action==='strongBuy'?suggestedBuyAmount*1.5:suggestedBuyAmount):remainingTargetValue*.2;
    const mult={conservative:.6,normal:1,aggressive:1.3}[strategy.buyAggressiveness]||1;
    suggestedBuyAmount*=mult;
    if(strategy.maxSingleBuyAmount>0)suggestedBuyAmount=Math.min(suggestedBuyAmount,strategy.maxSingleBuyAmount);
    suggestedBuyAmount=Math.min(suggestedBuyAmount,remainingTargetValue);
  }
  let suggestedShares=0;
  if(currentPrice>0&&suggestedBuyAmount>0){
    suggestedShares=roundDownToUnit(suggestedBuyAmount/currentPrice,minTradeUnit);
    if(targetShares>0)suggestedShares=Math.min(suggestedShares,roundDownToUnit(remainingTargetShares,minTradeUnit));
    suggestedBuyAmount=suggestedShares*currentPrice;
  }
  let executionStatus='hold';
  let priceTiming='当前以持有为主，暂不主动加仓';
  if(currentPrice<=0){executionStatus='noData';priceTiming='缺少当前价格，无法计算买入股数'}
  else if(decision.action==='reduce'){executionStatus='reduceRisk';priceTiming='当前仓位或风险偏高，应优先控制风险'}
  else if(decision.action==='observe'){executionStatus='wait';priceTiming='当前更适合观察，等待更好的价格或趋势确认'}
  else if(decision.action==='hold'){executionStatus='hold';priceTiming='当前以持有为主，暂不主动加仓'}
  else if(canBuy&&suggestedShares>0){executionStatus='buyNow';priceTiming='当前决策支持买入，可按计划分批执行'}
  else if(canBuy){executionStatus='wait';priceTiming='决策支持买入，但金额不足最小交易单位，等待资金或价格变化'}
  const executionReasons=[
    `决策动作：${decisionActionLabel(decision.action)}`,
    `剩余目标市值 ${remainingTargetValue.toFixed(0)}`,
    `最小交易单位 ${minTradeUnit} 股`,
    targetShares>0?`目标股数 ${targetShares}，剩余 ${remainingTargetShares} 股`:`目标仓位 ${strategy.targetWeight}%`
  ];
  const executionWarnings=[];
  if(currentPrice<=0)executionWarnings.push('缺少当前价格');
  if(!canBuy)executionWarnings.push('当前决策不支持主动买入');
  if(canBuy&&suggestedShares===0)executionWarnings.push('建议金额不足最小交易单位');
  if(remainingTargetValue<=0)executionWarnings.push('已达到或超过目标仓位/股数');
  if(strategy.maxSingleBuyAmount>0&&suggestedBuyAmount>=strategy.maxSingleBuyAmount)executionWarnings.push('受单次最大买入金额限制');
  return {
    suggestedBuyAmount:Number(suggestedBuyAmount.toFixed(2)),
    suggestedShares:Number(suggestedShares)||0,
    remainingTargetShares:Number(remainingTargetShares.toFixed(2)),
    remainingTargetValue:Number(remainingTargetValue.toFixed(2)),
    executionStatus,
    priceTiming,
    executionReasons,
    executionWarnings
  };
}
function defaultRiskManagement(){
  return {
    status:'normal',
    riskLevel:0,
    summary:'',
    triggerReasons:[],
    protectiveActions:[],
    reviewConditions:[],
    invalidConditions:[],
    updatedAt:''
  };
}
function normalizeRiskManagement(v){
  const src=(v&&typeof v==='object'&&!Array.isArray(v))?v:{};
  const rawStatus=String(src.status||'');
  const status=rawStatus==='reduce_review'?'defensive_reduce_review':rawStatus;
  return {
    status:enumOr(status,['normal','observe','risk_review','defensive_reduce_review','profit_take_review','execute_plan'],'normal'),
    riskLevel:clampNumber(src.riskLevel,0,10,0),
    summary:String(src.summary||''),
    triggerReasons:normalizeStringArray(src.triggerReasons),
    protectiveActions:normalizeStringArray(src.protectiveActions),
    reviewConditions:normalizeStringArray(src.reviewConditions),
    invalidConditions:normalizeStringArray(src.invalidConditions),
    updatedAt:normalizeDateOnly(src.updatedAt)||String(src.updatedAt||'')
  };
}
function calculateRiskManagement(stock){
  const s=(stock&&typeof stock==='object')?stock:{};
  const strategy=normalizeStrategy(s.strategy,s);
  const technicalData=normalizeTechnicalData(s.technicalData);
  const technicalReview=normalizeTechnicalReview(s.technicalReview,s);
  const shortTerm=technicalReview.shortTermTechnical||{};
  const sentiment=normalizeShortTermSentiment(s.shortTermSentiment,s);
  const longTerm=normalizeLongTermLogic(s.longTermLogic,s);
  const triggerReasons=[];
  const protectiveActions=[];
  const reviewConditions=[];
  const invalidConditions=[];
  const addUnique=(arr,text)=>{const value=String(text||'').trim();if(value&&!arr.includes(value))arr.push(value)};
  const num=x=>{const n=Number(x);return isFinite(n)?n:null};
  const displayPrice=stockCurrentPrice(s);
  const currentPrice=displayPrice>0?displayPrice:null;
  const shares=num(s.shares)??num(s.currentShares)??0;
  const marketValue=num(s.currentValue)??num(s.marketValue)??(currentPrice&&shares?currentPrice*shares:0);
  let totalValue=0;
  if(typeof state==='object'&&state&&Array.isArray(state.stocks)){
    totalValue=state.stocks.reduce((sum,item)=>{
      const display=stockCurrentPrice(item);
      const price=display>0?display:null;
      const itemShares=num(item.shares)??0;
      return sum+(num(item.currentValue)??num(item.marketValue)??(price&&itemShares?price*itemShares:0));
    },0);
  }
  const currentWeight=num(s.currentWeight)??num(s.actualWeight)??num(s.weight)??(totalValue>0&&marketValue>0?marketValue/totalValue*100:0);
  const targetWeight=num(strategy.targetWeight)??num(s.targetPct)??num(s.targetWeight)??0;
  const overweight=targetWeight>0&&currentWeight>targetWeight+Math.max(0.5,targetWeight*0.1);
  if(overweight)addUnique(triggerReasons,`当前仓位 ${currentWeight.toFixed(1)}% 高于目标仓位 ${targetWeight.toFixed(1)}%`);
  const ma20=num(shortTerm.ma20)??num(technicalData.ma20);
  const ma60=num(shortTerm.ma60)??num(technicalData.ma60);
  const belowMa20=Boolean(currentPrice&&ma20&&currentPrice<ma20);
  const belowMa60=Boolean(currentPrice&&ma60&&currentPrice<ma60);
  if(belowMa20)addUnique(triggerReasons,`当前价格跌破 MA20（${ma20}）`);
  if(belowMa60)addUnique(triggerReasons,`当前价格跌破 MA60（${ma60}）`);
  const supportLevels=normalizeTechnicalLevelArray(shortTerm.supportLevels&&shortTerm.supportLevels.length?shortTerm.supportLevels:technicalData.supportLevels).map(num).filter(n=>n&&n>0);
  const resistanceLevels=normalizeTechnicalLevelArray(shortTerm.resistanceLevels&&shortTerm.resistanceLevels.length?shortTerm.resistanceLevels:technicalData.resistanceLevels).map(num).filter(n=>n&&n>0);
  const nearestSupport=currentPrice&&supportLevels.length?supportLevels.filter(n=>n<=currentPrice).sort((a,b)=>b-a)[0]||Math.max(...supportLevels):null;
  const nearestResistance=currentPrice&&resistanceLevels.length?resistanceLevels.filter(n=>n>=currentPrice).sort((a,b)=>a-b)[0]||Math.max(...resistanceLevels):null;
  const belowKeySupport=Boolean(currentPrice&&nearestSupport&&currentPrice<nearestSupport);
  const nearSupport=Boolean(currentPrice&&nearestSupport&&currentPrice>=nearestSupport&&((currentPrice-nearestSupport)/currentPrice*100)<=3);
  const nearResistance=Boolean(currentPrice&&nearestResistance&&currentPrice<=nearestResistance&&((nearestResistance-currentPrice)/currentPrice*100)<=3);
  if(belowKeySupport)addUnique(triggerReasons,`当前价格跌破关键支撑 ${nearestSupport}`);
  if(nearSupport)addUnique(reviewConditions,`当前价格接近关键支撑 ${nearestSupport}`);
  if(nearResistance)addUnique(reviewConditions,`当前价格接近压力位或前高 ${nearestResistance}`);
  const technicalText=[
    shortTerm.trendStatus,
    technicalData.trendStatus,
    technicalReview.finalTechnicalConclusion,
    shortTerm.technicalSummary,
    technicalData.technicalSummary,
    ...(shortTerm.riskFlags||[]),
    ...(technicalData.riskFlags||[])
  ].join(' ').toLowerCase();
  const technicalWeak=/downtrend|breakdown|support_breakdown|below_ma20|below_ma60|price_below_ma20|price_below_ma60|跌破ma20|跌破ma60|跌破关键支撑|破位|下降趋势/.test(technicalText);
  const upwardOrRebound=/uptrend|rebound|high_level_rebreakout|early_uptrend|mid_uptrend|上升趋势|反弹|高位二次上攻/.test(technicalText);
  if(technicalWeak)addUnique(triggerReasons,'短期技术面出现趋势走弱或支撑破坏信号');
  const sentimentText=[
    sentiment.marketMood,
    sentiment.fundFlowView,
    sentiment.sectorHeat,
    sentiment.institutionalView,
    sentiment.actionHint,
    ...(sentiment.riskFlags||[])
  ].join(' ').toLowerCase();
  const weakSentiment=/weak|outflow|negative|bearish|偏弱|走弱|净流出|流出|分歧|降温|低迷|板块偏弱|资金偏弱/.test(sentimentText);
  if(weakSentiment)addUnique(triggerReasons,'短期情绪或资金面偏弱');
  if(longTerm.logicStatus==='broken'){
    addUnique(invalidConditions,'长期逻辑破坏');
  }else if(longTerm.logicStatus&&longTerm.logicStatus!=='valid'){
    addUnique(reviewConditions,`长期逻辑状态为 ${longTerm.logicStatus}，需要复核`);
  }
  addUnique(protectiveActions,'复核仓位是否仍匹配目标仓位');
  if(belowMa20||nearSupport)addUnique(protectiveActions,'观察 MA20 与关键支撑能否修复');
  if(belowMa60||belowKeySupport||technicalWeak)addUnique(protectiveActions,'复核是否需要启动防守性减仓计划');
  if(weakSentiment)addUnique(protectiveActions,'复核资金流与板块强度是否继续走弱');
  const plans=Array.isArray(s.plans)?s.plans:[];
  const planTriggered=Boolean(currentPrice&&plans.some(p=>{
    if(p&&Object.prototype.hasOwnProperty.call(p,'planMode')&&p.planMode!=='legacy_price')return false;
    const price=num(p&&p.price);
    if(!price)return false;
    const action=String((p&&p.action)||'buy');
    const triggerOn=String((p&&p.triggerOn)||'');
    if((action==='sell'||triggerOn==='above')&&currentPrice>=price)return true;
    if((action==='buy'||triggerOn==='below')&&currentPrice<=price)return true;
    return false;
  }));
  if(planTriggered)addUnique(reviewConditions,'当前价格进入既定计划复核区，需要人工确认');
  let riskLevel=0;
  if(overweight)riskLevel+=2;
  if(belowMa20)riskLevel+=2;
  if(belowMa60)riskLevel+=3;
  if(belowKeySupport)riskLevel+=3;
  if(technicalWeak)riskLevel+=2;
  if(weakSentiment)riskLevel+=2;
  if(longTerm.logicStatus==='broken')riskLevel+=3;
  riskLevel=Math.min(10,riskLevel);
  let status='normal';
  if(planTriggered)status='execute_plan';
  else if(overweight&&(belowMa60||belowKeySupport||technicalWeak)&&weakSentiment)status='defensive_reduce_review';
  else if(overweight&&(nearResistance||upwardOrRebound))status='profit_take_review';
  else if(belowKeySupport||belowMa20||technicalWeak||longTerm.logicStatus==='broken')status='risk_review';
  else if(nearSupport||weakSentiment||overweight)status='observe';
  const summaryMap={
    normal:'风险状态正常，继续按既有计划观察。',
    observe:'存在轻度风险或接近关键位置，建议继续观察并复核触发条件。',
    risk_review:'出现趋势或支撑风险，需要进行风险复核。',
    defensive_reduce_review:'仓位、趋势与情绪资金同时触发防守条件，需要复核防守性减仓计划。',
    profit_take_review:'上升或反弹阶段接近压力位且仓位偏高，需要复核盈利兑现计划。',
    execute_plan:'当前价格进入既定计划区，需要进行既定计划复核。'
  };
  return {
    ...defaultRiskManagement(),
    status,
    riskLevel,
    summary:summaryMap[status],
    triggerReasons,
    protectiveActions,
    reviewConditions,
    invalidConditions,
    updatedAt:todayDate()
  };
}
function v13DerivedStockId(stock){
  return String((stock&&stock.id)||(stock&&stock.code)||(stock&&stock.symbol)||'');
}
function v13DerivedPlanId(stock,plan,index){
  return String((plan&&plan.id)||`legacy-plan-${v13DerivedStockId(stock)}-${index}`);
}
function v13DerivedCurrentPrice(stock){
  if(stock&&stock.type==='etf'){
    const unit=Number(stock.lastUnitPrice);
    if(Number.isFinite(unit)&&unit>0)return unit;
    const value=Number(stock.currentValue);
    const shares=Number(stock.shares);
    if(Number.isFinite(value)&&value>0&&Number.isFinite(shares)&&shares>0)return value/shares;
  }
  const candidates=[
    stock&&stock.currentPrice,
    stock&&stock.price
  ];
  for(const raw of candidates){
    const value=Number(raw);
    if(Number.isFinite(value)&&value>0)return value;
  }
  return null;
}
function v13DerivedTriggerOn(stock,plan){
  if(plan&&Object.prototype.hasOwnProperty.call(plan,'planMode')&&plan.planMode!=='legacy_price')return null;
  const explicit=String(plan&&plan.triggerOn||plan&&plan.triggerDirection||'').toLowerCase();
  if(['above','below'].includes(explicit))return explicit;
  const action=String(plan&&plan.action||'buy').toLowerCase();
  if(action==='sell'||action==='reduce')return 'above';
  return 'below';
}
function v13DerivedPlanTriggered(stock,plan){
  const price=v13DerivedCurrentPrice(stock);
  const trigger=Number(plan&&plan.price!==undefined?plan.price:plan&&plan.triggerPrice);
  if(!Number.isFinite(price)||price<=0||!Number.isFinite(trigger)||trigger<=0)return false;
  const triggerOn=v13DerivedTriggerOn(stock,plan);
  if(triggerOn==='above')return price>=trigger;
  if(triggerOn==='below')return price<=trigger;
  return false;
}
function v13DerivedIsCashRow(stock){
  const type=String(stock&&stock.type||'').toLowerCase();
  const name=String(stock&&stock.name||'');
  const code=String(stock&&stock.code||stock&&stock.symbol||'');
  return type==='cash'||(!code&&/现金/.test(name));
}
function buildV13DerivedPlans(stock){
  return (Array.isArray(stock&&stock.plans)?stock.plans:[]).map((plan,index)=>({
    ...plan,
    id:v13DerivedPlanId(stock,plan,index),
    stockId:v13DerivedStockId(stock),
    source:'legacy-plans'
  }));
}
function buildV13DerivedRiskState(stock){
  const rm=normalizeRiskManagement(stock&&stock.riskManagement);
  const risks=[];
  const add=(riskType,phase,summary)=>{
    risks.push({
      riskType,
      active:true,
      phase,
      summary,
      sourceObjectId:'riskManagement',
      createdAt:rm.updatedAt||todayDate(),
      updatedAt:rm.updatedAt||todayDate()
    });
  };
  if(rm.status==='defensive_reduce_review')add('trend_defense','decision',rm.summary||'趋势风险进入防守性减仓复核。');
  else if(rm.status==='profit_take_review')add('profit_take','decision',rm.summary||'上涨或超配进入盈利兑现复核。');
  else if(rm.status==='execute_plan')add('position_control','decision',rm.summary||'既定计划进入人工复核。');
  else if(rm.status==='risk_review')add('trend_defense','prepare',rm.summary||'趋势风险进入复核观察。');
  else if(rm.status==='observe')add('trend_defense','info',rm.summary||'趋势风险继续观察。');
  return {
    objectType:'RiskState',
    stockId:v13DerivedStockId(stock),
    risks,
    updatedAt:rm.updatedAt||todayDate(),
    legacy:{source:'derived-risk-management'}
  };
}
function buildV13DerivedEvents(stock){
  const stockId=v13DerivedStockId(stock);
  const events=[];
  const now=todayDate();
  const addEvent=(event)=>{
    events.push({
      objectType:'Event',
      stockId,
      status:'pending',
      priority:0,
      createdAt:now,
      updatedAt:now,
      legacy:{derived:true,...(event.legacy||{})},
      ...event
    });
  };
  const triggeredPlanGroups=new Map();
  buildV13DerivedPlans(stock).forEach((plan,index)=>{
    if(!v13DerivedPlanTriggered(stock,plan))return;
    const actionKey=String(plan.action||'buy').toLowerCase()==='sell'?'sell':'buy';
    const typeKey=plan.planType||((actionKey==='sell')?'profit_take':'add');
    const groupKey=`${typeKey}:${actionKey}`;
    const current=triggeredPlanGroups.get(groupKey);
    const currentPrice=Number(v13DerivedCurrentPrice(stock))||0;
    const triggerPrice=Number(plan.price||plan.triggerPrice)||0;
    const gap=triggerPrice>0?Math.abs(currentPrice-triggerPrice)/triggerPrice:999;
    if(!current||gap<current.gap)triggeredPlanGroups.set(groupKey,{plan,index,gap});
  });
  Array.from(triggeredPlanGroups.values()).forEach(({plan,index})=>{
    const action=String(plan.action||'buy').toLowerCase()==='sell'?'减仓':'加仓';
    addEvent({
      id:`derived-event-plan-${stockId}-${plan.id||index}`,
      businessObjectType:'Plan',
      businessObjectId:String(plan.id||index),
      phase:'decision',
      title:`价位计划进入人工复核：${action} ${plan.price||plan.triggerPrice||''}`,
      summary:'计划触发不代表已经执行，需要人工确认后再记录操作。',
      priority:80,
      legacy:{source:'legacy-triggered-plan'}
    });
  });
  const hasPlanDecisionEvent=events.some(event=>event.businessObjectType==='Plan'&&event.phase==='decision');
  const rm=normalizeRiskManagement(stock&&stock.riskManagement);
  if(['defensive_reduce_review','profit_take_review','execute_plan','risk_review','observe'].includes(rm.status)){
    const phase=rm.status==='observe'?'info':(rm.status==='risk_review'?'prepare':'decision');
    if(!(rm.status==='execute_plan'&&hasPlanDecisionEvent)){
      addEvent({
        id:`derived-event-risk-${stockId}-${rm.status}`,
        businessObjectType:'RiskState',
        businessObjectId:'riskManagement',
        phase,
        title:{
          defensive_reduce_review:'趋势风险进入防守性减仓复核',
          profit_take_review:'上涨或超配进入盈利兑现复核',
          execute_plan:'既定计划进入人工复核',
          risk_review:'趋势风险进入复核观察',
          observe:'风险状态继续观察'
        }[rm.status],
        summary:rm.summary||'风险事件仅提示人工复核，不构成自动交易。',
        priority:rm.status==='execute_plan'?60:90,
        legacy:{source:'riskManagement'}
      });
    }
  }
  const info=normalizeInformationCompleteness(stock&&stock.informationCompleteness,stock||{});
  const hasDecisionOrPrepareEvent=events.some(event=>event.phase==='decision'||event.phase==='prepare');
  if(info.overall==='low'&&!hasDecisionOrPrepareEvent&&!v13DerivedIsCashRow(stock)){
    addEvent({
      id:`derived-event-info-${stockId}-information-low`,
      businessObjectType:'ModuleSummary',
      businessObjectId:'informationCompleteness',
      phase:'info',
      title:'信息完整度较低',
      summary:info.warning||'资料覆盖不足，建议补充后再复核。',
      priority:10,
      legacy:{source:'informationCompleteness'}
    });
  }
  const logic=normalizeLongTermLogic(stock&&stock.longTermLogic,stock||{});
  if(logic.logicStatus==='weakening'||logic.logicStatus==='broken'){
    addEvent({
      id:`derived-event-logic-${stockId}-${logic.logicStatus}`,
      businessObjectType:'ModuleSummary',
      businessObjectId:'longTermLogic',
      phase:logic.logicStatus==='broken'?'decision':'prepare',
      title:logic.logicStatus==='broken'?'长期逻辑失效复核':'长期逻辑减弱复核',
      summary:'长期逻辑状态变化仅作为人工复核提醒，不自动触发交易。',
      priority:logic.logicStatus==='broken'?95:70,
      legacy:{source:'longTermLogic'}
    });
  }
  return events;
}
function buildV13DerivedCoreModel(stock,ruleConfig,options={}){
  const base=typeof normalizeV13Stock==='function'?normalizeV13Stock(stock):null;
  if(!base)return null;
  const derivedPlans=buildV13DerivedPlans(stock);
  const derivedRiskState=buildV13DerivedRiskState(stock);
  const derivedEvents=buildV13DerivedEvents(stock);
  const normalizedRuleConfig=typeof normalizeV13RuleConfig==='function'?normalizeV13RuleConfig(ruleConfig||(state&&state.ruleConfig)||{}):null;
  const currentPriceSnapshot=(base.priceSnapshots&&base.priceSnapshots[0])||normalizeV13PriceSnapshot({},stock);
  const mergedRiskState={
    ...base.riskState,
    risks:[...(base.riskState&&Array.isArray(base.riskState.risks)?base.riskState.risks:[]),...(derivedRiskState.risks||[])],
    updatedAt:derivedRiskState.updatedAt||base.riskState.updatedAt,
    legacy:{...(base.riskState&&base.riskState.legacy||{}),derivedRiskState}
  };
  const modelForRecommendations={
    ...base,
    priceSnapshot:currentPriceSnapshot,
    priceSnapshots:base.priceSnapshots&&base.priceSnapshots.length?base.priceSnapshots:[currentPriceSnapshot],
    plans:[...(base.plans||[])],
    events:[...(base.events||[]),...derivedEvents],
    riskState:mergedRiskState,
    ruleConfig:normalizedRuleConfig
  };
  const recommendations=typeof buildV13DerivedRecommendations==='function'?buildV13DerivedRecommendations(stock,modelForRecommendations,options):[];
  const recommendationAggregation=typeof aggregateV13Recommendations==='function'
    ? aggregateV13Recommendations(recommendations)
    : {primaryRecommendations:[],secondaryRecommendations:[]};
  return {
    ...base,
    priceSnapshots:base.priceSnapshots&&base.priceSnapshots.length?base.priceSnapshots:[currentPriceSnapshot],
    plans:[...(base.plans||[])],
    events:[...(base.events||[]),...derivedEvents],
    riskState:mergedRiskState,
    ruleConfig:normalizedRuleConfig,
    recommendations,
    primaryRecommendations:recommendationAggregation.primaryRecommendations,
    secondaryRecommendations:recommendationAggregation.secondaryRecommendations
  };
}
function buildV13CoreModelSnapshot(stock,ruleConfig,options={}){
  const normalized=typeof buildV13DerivedCoreModel==='function'?buildV13DerivedCoreModel(stock,ruleConfig,options):(typeof normalizeV13Stock==='function'?normalizeV13Stock(stock):null);
  if(!normalized)return null;
  return {
    stock:{
      objectType:normalized.objectType,
      id:normalized.id,
      symbol:normalized.symbol,
      name:normalized.name,
      type:normalized.type,
      legacy:normalized.legacy
    },
    position:normalized.position,
    priceSnapshot:normalized.priceSnapshots[0]||normalizeV13PriceSnapshot({},stock),
    plans:normalized.plans,
    events:normalized.events,
    recommendations:Array.isArray(normalized.recommendations)?normalized.recommendations:[],
    primaryRecommendations:Array.isArray(normalized.primaryRecommendations)?normalized.primaryRecommendations:[],
    secondaryRecommendations:Array.isArray(normalized.secondaryRecommendations)?normalized.secondaryRecommendations:[],
    trades:normalized.trades,
    riskState:normalized.riskState,
    moduleSummary:normalized.moduleSummary,
    ruleConfig:typeof normalizeV13RuleConfig==='function'?normalizeV13RuleConfig(ruleConfig||(state&&state.ruleConfig)||{}):null
  };
}
function normalizeStockAnalysis(stock,context={}){
  const hasExplicitInformationCompleteness=stock.informationCompleteness&&typeof stock.informationCompleteness==='object'&&Object.keys(stock.informationCompleteness).length>0;
  stock.strategy=normalizeStrategy(stock.strategy,stock);
  stock.dataFreshness=normalizeDataFreshness(stock.dataFreshness);
  stock.collectionInputs=normalizeCollectionInputs(stock.collectionInputs);
  stock.aiReviews=normalizeAiReviews(stock.aiReviews);
  stock.analysisInputs=normalizeAnalysisInputs(stock.analysisInputs);
  stock.valuationData=normalizeValuationData(stock.valuationData);
  if(!stock.valuationData.symbol)stock.valuationData.symbol=String(stock.code||stock.symbol||'');
  stock.valuationReview=normalizeValuationReview(stock.valuationReview);
  stock.sentimentReview=normalizeSentimentReview(stock.sentimentReview,stock);
  stock.longTermLogic=normalizeLongTermLogic(stock.longTermLogic,stock);
  stock.positionManagementReview=normalizePositionManagementReview(stock.positionManagementReview);
  stock.recentCatalyst=normalizeRecentCatalyst(stock.recentCatalyst,stock);
  stock.eventExplanation=normalizeEventExplanation(stock.eventExplanation,stock);
  stock.shortTermSentiment=normalizeShortTermSentiment(stock.shortTermSentiment,stock);
  stock.informationCompleteness=normalizeInformationCompleteness(stock.informationCompleteness,stock);
  stock.financialData=normalizeFinancialData(stock.financialData);
  stock.priceHistory=normalizePriceHistory(stock);
  stock.technicalData=normalizeTechnicalData(stock.technicalData);
  if(!stock.technicalData.symbol)stock.technicalData.symbol=String(stock.code||stock.symbol||'');
  updateTechnicalDataFromPriceHistory(stock);
  stock.technicalReview=normalizeTechnicalReview(stock.technicalReview,stock);
  stock.technicalData=technicalDataFromReview(stock.technicalReview,stock);
  if(typeof DiscussionWorkbench!=='undefined'&&typeof DiscussionWorkbench.normalizeStore==='function')stock.discussionState=DiscussionWorkbench.normalizeStore(stock.discussionState);
  stock.riskManagement=normalizeRiskManagement(stock.riskManagement);
  stock.riskManagement=calculateRiskManagement(stock);
  stock.etfAnalysis=normalizeEtfAnalysis(stock.etfAnalysis,stock);
  stock.analysisFramework=normalizeAnalysisFramework(stock.analysisFramework,stock);
  stock.allocationDecision=normalizeAllocationDecision(stock.allocationDecision,stock);
  stock.analysisScore=calculateAnalysisScore(stock.analysisFramework);
  stock.coreModel=buildV13CoreModelSnapshot(stock,context.ruleConfig,{hasExplicitInformationCompleteness});
  return stock;
}
function getCurrency(s){if(s&&(s.currency==='HKD'||s.currency==='CNY'))return s.currency;const c=String((s&&s.code)||'').trim().toUpperCase();return c.endsWith('.HK')?'HKD':'CNY'}
function fxHKD(){const r=(state&&state.fx)?Number(state.fx.hkdcny):NaN;return (r>0&&isFinite(r))?r:DEFAULT_HKD_CNY}
function toCNY(v,s){if(v===null||v===undefined||isNaN(v))return v;return getCurrency(s)==='HKD'?v*fxHKD():v}
function fxLabel(){const f=(state&&state.fx)||{};const base=`HKD→CNY ${fxHKD().toFixed(4)}`;return f.updatedAt?`${base} · ${f.updatedAt}`:`${base} · 默认值`}
function normalizeAlpha3Compatibility(s){s=(s&&typeof s==='object'&&!Array.isArray(s))?s:{};if(!Array.isArray(s.decisionRecords))s.decisionRecords=[];if(!Array.isArray(s.decisionStates))s.decisionStates=[];s.alpha3DataVersion=ALPHA3_DATA_VERSION;return s}
function normalize(s){s=normalizeAlpha3Compatibility(s);if(typeof normalizeV13RuleConfig==='function')s.ruleConfig=normalizeV13RuleConfig(s.ruleConfig||s.rules||s.config||{});if(typeof PlanReview!=='undefined'&&typeof PlanReview.normalizeStore==='function')s.planReviews=PlanReview.normalizeStore(s.planReviews);if(!s.fx||!(Number(s.fx.hkdcny)>0))s.fx={hkdcny:DEFAULT_HKD_CNY,updatedAt:'',source:'默认'};s.stocks=(s.stocks||[]).map(x=>{if(x.currency===undefined)x.currency='';if(x.currentPrice===undefined)x.currentPrice='';if(x.currentValue===undefined)x.currentValue='';if(x.priceUpdatedAt===undefined)x.priceUpdatedAt='';if(x.valueUpdatedAt===undefined)x.valueUpdatedAt='';if(x.code===undefined)x.code=DEFAULT_CODES[x.id]||'';if(x.priceSource===undefined)x.priceSource='';if(x.trimPct===undefined)x.trimPct='';if(x.trimToPct===undefined)x.trimToPct='';if(x.capPct===undefined)x.capPct='';if(x.syncStatus===undefined)x.syncStatus='';if(x.tradePlan!==undefined&&(!x.tradePlan||typeof x.tradePlan!=='object'||Array.isArray(x.tradePlan)))x.tradePlan=null;if(!x.id)x.id=uid();if(!x.type)x.type='holding';if(!x.role)x.role=x.type==='watching'?'观察仓':'核心仓';if(!x.theme)x.theme='其他';if(!Array.isArray(x.plans))x.plans=[];const refPrice=x.type==='etf'?(Number(x.lastUnitPrice)||((Number(x.currentValue)>0&&Number(x.shares)>0)?Number(x.currentValue)/Number(x.shares):null)):(Number(x.currentPrice)||null);x.plans=x.plans.map(p=>typeof PlanV2!=='undefined'?PlanV2.normalizePlan(p,{currentPrice:refPrice}):p);if(!x.thesis)x.thesis=x.notes||'';if(!x.buyRule){const buys=x.plans.filter(p=>(!Object.prototype.hasOwnProperty.call(p,'planMode')||p.planMode==='legacy_price')&&['buy','add'].includes(p.action));x.buyRule=buys.map(p=>`${p.triggerPrice??p.price??'价格待定'}：${p.note||'加仓'}`).join('；')||'低于目标仓位且逻辑未变时再考虑。'}if(!x.sellRule){const sells=x.plans.filter(p=>(!Object.prototype.hasOwnProperty.call(p,'planMode')||p.planMode==='legacy_price')&&['sell','reduce'].includes(p.action));x.sellRule=sells.map(p=>`${p.triggerPrice??p.price??'价格待定'}：${p.note||'减仓'}`).join('；')||(x.type==='etf'?'不设机械止损，只按目标仓位再平衡。':'逻辑破坏、估值过热或仓位超标时处理。')}return normalizeStockAnalysis(x,{ruleConfig:s.ruleConfig})});return s}
async function loadState(){
  const raw=await StorageManager.loadState();
  if(typeof createValidatedCandidateSnapshot!=='function')throw {type:'validation_failed',message:'State candidate validation is unavailable.'};
  const candidate=createValidatedCandidateSnapshot(raw===null?{stocks:[],updatedAt:null}:raw,{touchUpdatedAt:false});
  state=candidate;
  if(typeof MultiTabProtection!=='undefined'){
    if(raw===null)await MultiTabProtection.observeEmptyLoadedState();
    else MultiTabProtection.observeLoadedState(candidate);
  }
  return state;
}
function saveState(nextState=state,options={}){
  state=normalize(nextState);
  state.updatedAt=Math.max(Date.now(),(Number(state.updatedAt)||0)+1);
  const snapshot=typeof structuredClone==='function'?structuredClone(state):JSON.parse(JSON.stringify(state));
  const persist=value=>StorageManager.saveState(value,options);
  const pending=typeof MultiTabProtection!=='undefined'
    ?MultiTabProtection.runProtectedSave(snapshot,persist,{critical:options.critical===true})
    :persist(snapshot);
  void pending.catch(()=>{});
  return pending;
}
