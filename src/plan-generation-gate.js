(function(root){
  'use strict';
  const STATUS=Object.freeze({READY:'ready',WARNING:'warning',BLOCKED:'blocked'});
  const DAY_MS=86400000;
  const object=value=>value&&typeof value==='object'&&!Array.isArray(value)?value:{};
  const array=value=>Array.isArray(value)?value:[];
  const number=value=>{const n=Number(value);return Number.isFinite(n)?n:null};
  const dateOnly=value=>{
    const text=String(value||'').trim();
    if(!text)return '';
    const match=text.match(/^(\d{4}-\d{2}-\d{2})/);
    if(!match)return '';
    const time=Date.parse(match[1]+'T00:00:00Z');
    return Number.isFinite(time)?match[1]:'';
  };
  const daysBetween=(from,to)=>{
    const a=dateOnly(from),b=dateOnly(to);
    if(!a||!b)return null;
    return Math.floor((Date.parse(b+'T00:00:00Z')-Date.parse(a+'T00:00:00Z'))/DAY_MS);
  };
  const validSymbol=value=>/^(?:\d{6}\.(?:SS|SZ)|\d{4,5}\.HK|[A-Z][A-Z0-9.-]{0,14})$/i.test(String(value||'').trim());
  const latestHistoryDate=history=>array(history).map(item=>dateOnly(item&&item.date)).filter(Boolean).sort().pop()||'';
  const hasRecentCatalyst=value=>{
    const source=object(value);
    return Boolean(String(source.summary||source.todayCatalyst||source.newsSummary||source.conclusion||'').trim()||array(source.items).length||array(source.catalysts).length||array(source.news).length);
  };
  const validPlans=plans=>Array.isArray(plans)&&plans.every(plan=>{
    if(!plan||typeof plan!=='object'||Array.isArray(plan))return false;
    const price=plan.triggerPrice??plan.price;
    const quantity=plan.quantity??plan.shares;
    if(price!==undefined&&price!==null&&price!==''&&!(number(price)>0))return false;
    if(quantity!==undefined&&quantity!==null&&quantity!==''&&!(number(quantity)>=0))return false;
    return true;
  });
  function technicalSnapshot(context){
    const stock=object(context.stock),technicalData=object(context.technicalData||stock.technicalData);
    const technicalAnalysis=object(context.technicalAnalysis||stock.technicalAnalysis);
    const review=object(context.technicalReview||stock.technicalReview);
    const shortTerm=object(review.shortTermTechnical);
    const coverage=object(review.inputCoverage);
    const market=object(context.marketDataFreshness||stock.marketDataFreshness);
    const freshness=object(context.dataFreshness||stock.dataFreshness);
    const latestTradeDate=dateOnly(context.latestTradingDate||market.last_trade_date||latestHistoryDate(context.priceHistory||stock.priceHistory));
    const updatedAt=[technicalData.date,technicalAnalysis.updatedAt,shortTerm.priceUpdatedAt,review.updatedAt,market.technical_analysis_updated_at,freshness.technicalUpdatedAt,technicalData.lastUpdated].map(dateOnly).filter(Boolean).sort().pop()||'';
    const price=number(shortTerm.price??technicalData.price);
    const trend=String(shortTerm.trendStatus||technicalData.trendStatus||'').trim();
    const summary=String(review.finalTechnicalConclusion||shortTerm.technicalSummary||technicalData.technicalSummary||technicalData.trendNote||'').trim();
    const movingAverages=[shortTerm.ma5,shortTerm.ma10,shortTerm.ma20,shortTerm.ma60,technicalData.ma5,technicalData.ma10,technicalData.ma20,technicalData.ma60].map(number).filter(value=>value>0);
    const hasRecentKline=coverage.hasRecentKline===true||price>0;
    const failed=market.kline_status==='failed'||technicalAnalysis.status==='failed'||review.status==='failed';
    const stale=market.kline_status==='stale'||market.technical_analysis_stale===true||technicalAnalysis.stale===true||review.stale===true;
    return {latestTradeDate,updatedAt,price,trend,summary,hasRecentKline,hasMovingAverage:movingAverages.length>0,failed,stale};
  }
  function evaluatePlanGenerationReadiness(context={}){
    const source=object(context),stock=object(source.stock),blockingReasons=[],warnings=[],requiredActions=[];
    const symbol=String(source.symbol||stock.code||stock.symbol||'').trim();
    const currentPrice=number(source.currentPrice??stock.currentPrice??stock.lastUnitPrice);
    const priceUpdatedAt=dateOnly(source.priceUpdatedAt||stock.priceUpdatedAt||stock.valueUpdatedAt||object(stock.dataFreshness).priceUpdatedAt);
    const plans=source.existingPlans!==undefined?source.existingPlans:stock.plans;
    const technical=technicalSnapshot(source);
    const today=dateOnly(source.today)||new Date().toISOString().slice(0,10);

    if(!Object.keys(stock).length||!validSymbol(symbol)){
      blockingReasons.push('标的数据异常：symbol 无效或标的不存在。');
      requiredActions.push('检查标的代码和基础数据');
    }
    if(!(currentPrice>0)||!priceUpdatedAt){
      blockingReasons.push('缺少有效当前价格或价格日期。');
      requiredActions.push('刷新或补充当前价格');
    }
    if(!validPlans(plans)){
      blockingReasons.push('计划数据结构异常。');
      requiredActions.push('检查现有计划数据');
    }
    if(!technical.latestTradeDate){
      blockingReasons.push('无法确认最新完整交易日。');
      requiredActions.push('更新日K');
    }
    if(!technical.updatedAt||!technical.hasRecentKline||!(technical.price>0)||!technical.trend||!technical.hasMovingAverage||!technical.summary){
      blockingReasons.push('缺少完整技术分析数据。');
      requiredActions.push('更新技术面');
    }else if(technical.failed){
      blockingReasons.push('技术面更新失败。');
      requiredActions.push('重新更新技术面');
    }else if(technical.stale||technical.updatedAt!==technical.latestTradeDate){
      blockingReasons.push(`技术面不是最新交易日（技术面 ${technical.updatedAt||'未更新'}；最新交易日 ${technical.latestTradeDate||'未知'}）。`);
      requiredActions.push('先更新日K，再更新技术面');
    }

    const freshness=object(source.dataFreshness||stock.dataFreshness);
    const fundamental=object(source.fundamentalSummary||source.fundamentalReview||stock.fundamentalReview||stock.financialReview);
    const fundamentalDate=dateOnly(source.fundamentalUpdatedAt||fundamental.updatedAt||fundamental.lastUpdated||freshness.financialUpdatedAt);
    const fundamentalAge=daysBetween(fundamentalDate,today);
    if(!fundamentalDate||fundamentalAge===null||fundamentalAge>30)warnings.push('基本面资料超过有效周期或尚未更新。');

    const longTerm=object(source.longTermLogic||stock.longTermLogic);
    const longTermDate=dateOnly(source.longTermUpdatedAt||longTerm.updatedAt||freshness.personalViewUpdatedAt);
    const nextReviewDate=dateOnly(longTerm.nextReviewDate||longTerm.validUntil);
    const daysToReview=daysBetween(today,nextReviewDate);
    const longTermAge=daysBetween(longTermDate,today);
    if(!longTermDate||(daysToReview!==null&&daysToReview<=14)||(longTermAge!==null&&longTermAge>90))warnings.push('长期逻辑已接近或超过建议复核周期。');

    const catalyst=source.recentCatalyst||stock.shortTermCatalyst||stock.recentCatalyst||stock.newsReview;
    if(!hasRecentCatalyst(catalyst))warnings.push('缺少近期催化信息。');

    const allocation=object(source.allocationDecision||stock.allocationDecision);
    const allocationDate=dateOnly(source.allocationUpdatedAt||allocation.updatedAt);
    if(!allocationDate)warnings.push('配置决策尚未更新。');

    const unique=value=>Array.from(new Set(value));
    const blocked=blockingReasons.length>0;
    const status=blocked?STATUS.BLOCKED:(warnings.length?STATUS.WARNING:STATUS.READY);
    return Object.freeze({
      status,
      blockingReasons:Object.freeze(unique(blockingReasons)),
      warnings:Object.freeze(unique(warnings)),
      canGenerate:!blocked,
      requiredActions:Object.freeze(unique(requiredActions)),
      dates:Object.freeze({price:priceUpdatedAt,latestTrading:technical.latestTradeDate,technical:technical.updatedAt,allocation:allocationDate}),
      technical:Object.freeze({...technical})
    });
  }
  function warningHeader(result){
    return result&&result.status===STATUS.WARNING&&array(result.warnings).length?['数据提醒：',...result.warnings.map(item=>`- ${item}`),''].join('\n'):'';
  }
  root.PlanGenerationGate=Object.freeze({STATUS,evaluatePlanGenerationReadiness,warningHeader,dateOnly,validSymbol});
})(typeof window!=='undefined'?window:globalThis);
