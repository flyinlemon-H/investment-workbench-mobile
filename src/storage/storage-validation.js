(function storageValidationModule(global){
  'use strict';

  const root=global.InvestmentStorage=global.InvestmentStorage||{};

  function storageErrors(){
    if(!root.errors)throw new Error('InvestmentStorage.errors must load before storage-validation.js.');
    return root.errors;
  }

  function fail(operation){throw storageErrors().create('validation_failed',operation)}
  function isPlainObject(value){
    if(!value||typeof value!=='object'||Array.isArray(value))return false;
    const prototype=Object.getPrototypeOf(value);
    return prototype===Object.prototype||prototype===null;
  }
  function array(value){return Array.isArray(value)?value:[]}
  function countNested(rows,key){return rows.reduce((sum,row)=>sum+array(row&&row[key]).length,0)}
  function canonicalSymbol(stock){
    if(!global.SymbolIdentity||typeof global.SymbolIdentity.stockSymbol!=='function')throw new Error('SymbolIdentity must load before storage-validation.js.');
    return global.SymbolIdentity.stockSymbol(stock);
  }
  function isExemptIdentityRow(stock){
    const type=String(stock&&stock.type||'').trim().toLowerCase();
    const objectType=String(stock&&stock.objectType||'').trim().toLowerCase();
    return Boolean(stock&&(stock.isCash===true||stock.isSystem===true||stock.systemRow===true||type==='cash'||type==='system'||objectType==='cash'||objectType==='system'));
  }

  function validateDraftMap(value,kind){
    if(!isPlainObject(value))fail(`validation.${kind}.object`);
    const keys=Object.keys(value).sort();
    keys.forEach(key=>{
      if(!key||!isPlainObject(value[key]))fail(`validation.${kind}.record`);
    });
    return keys;
  }

  function validateState(state){
    if(!isPlainObject(state))fail('validation.state.object');
    if(!Array.isArray(state.stocks))fail('validation.state.stocks');
    const stocks=state.stocks;
    const symbols=new Set();
    stocks.forEach(stock=>{
      if(!isPlainObject(stock))fail('validation.state.stock');
      if(stock.plans!==undefined&&!Array.isArray(stock.plans))fail('validation.state.plans');
      array(stock.plans).forEach(plan=>{
        if(!isPlainObject(plan))fail('validation.state.plan');
        if(plan.schemaVersion==='plan.v2'&&global.PlanV2&&typeof global.PlanV2.validatePlan==='function'&&!global.PlanV2.validatePlan(plan).ok)fail('validation.state.planV2');
      });
      if(isExemptIdentityRow(stock))return;
      const symbol=canonicalSymbol(stock);
      if(!symbol)return;
      if(symbols.has(symbol))fail('validation.state.duplicateSymbol');
      symbols.add(symbol);
    });
    if(state.planReviews!==undefined){
      if(!isPlainObject(state.planReviews))fail('validation.state.planReviews');
      if(global.PlanReview&&typeof global.PlanReview.validateStore==='function'&&!global.PlanReview.validateStore(state.planReviews).ok)fail('validation.state.planReviewStore');
    }
    const holdingCount=stocks.filter(stock=>{
      if(isExemptIdentityRow(stock))return false;
      const type=String(stock.type||'').toLowerCase();
      return type!=='watching'&&type!=='watchlist';
    }).length;
    const positionCount=stocks.filter(stock=>!isExemptIdentityRow(stock)&&(
      Object.prototype.hasOwnProperty.call(stock,'shares')||
      Object.prototype.hasOwnProperty.call(stock,'avgCost')||
      Object.prototype.hasOwnProperty.call(stock,'cost')||
      String(stock.type||'').toLowerCase()==='holding'
    )).length;
    return Object.freeze({
      stocksCount:stocks.length,
      canonicalSymbolsCount:symbols.size,
      holdingCount,
      positionCount,
      plansCount:array(state.plans).length+countNested(stocks,'plans'),
      eventsCount:array(state.events).length+countNested(stocks,'events'),
      tradeHistoryCount:array(state.tradeHistory).length+countNested(stocks,'tradeHistory'),
      priceHistoryCount:array(state.priceHistory).length+countNested(stocks,'priceHistory'),
      decisionRecordsCount:array(state.decisionRecords).length+countNested(stocks,'decisionRecords'),
      decisionStatesCount:array(state.decisionStates).length+countNested(stocks,'decisionStates'),
      aiReviewCount:array(state.aiReviews).length+countNested(stocks,'aiReviews')
    });
  }

  function validateEnvelope(envelope){
    if(!isPlainObject(envelope)||!isPlainObject(envelope.drafts))fail('validation.envelope');
    const stateSummary=validateState(envelope.state);
    const planDraftRequestIds=validateDraftMap(envelope.drafts.plan_update,'planDrafts');
    const operationDraftContextKeys=validateDraftMap(envelope.drafts.operation_entry,'operationDrafts');
    return Object.freeze({
      ...stateSummary,
      planDraftsCount:planDraftRequestIds.length,
      planDraftRequestIds:Object.freeze(planDraftRequestIds),
      operationDraftsCount:operationDraftContextKeys.length,
      operationDraftContextKeys:Object.freeze(operationDraftContextKeys),
      normalizeSemanticStable:true
    });
  }

  function semanticEnvelope(state,planDrafts,operationDrafts){
    return Object.freeze({
      state,
      drafts:Object.freeze({plan_update:planDrafts,operation_entry:operationDrafts})
    });
  }

  root.validation=Object.freeze({
    isPlainObject,
    canonicalSymbol,
    isExemptIdentityRow,
    validateState,
    validateDraftMap,
    validateEnvelope,
    semanticEnvelope
  });
})(typeof window!=='undefined'?window:globalThis);
