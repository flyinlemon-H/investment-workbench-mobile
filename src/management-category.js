(function(root,factory){
  const api=factory(typeof module==='object'&&module.exports?require('./symbol-identity'):root.SymbolIdentity);if(typeof module==='object'&&module.exports)module.exports=api;root.ManagementCategory=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(identity){
  'use strict';
  const labels=Object.freeze({core:'核心仓',watch:'观察仓',candidate:'候选仓',etf:'ETF'});
  const values=Object.freeze(Object.keys(labels));
  const valid=value=>typeof value==='string'&&values.includes(value);
  // Malformed market records remain in the domain so validation can block them.
  const isManagementCategoryTarget=stock=>Boolean(stock&&!identity.isLegacyCashRow(stock)&&!identity.isExemptIdentityRow(stock));
  const targets=stocks=>stocks.filter(isManagementCategoryTarget);
  const needsAssignment=stock=>isManagementCategoryTarget(stock)&&!valid(stock.managementCategory);
  const isETF=stock=>String(stock.assetType||stock.type||'').toLowerCase()==='etf';
  const allowed=stock=>Number(stock.shares)===0?['candidate']:isETF(stock)?['etf']:['core','watch'];
  const needsRepair=stock=>isManagementCategoryTarget(stock)&&valid(stock.managementCategory)&&Boolean(compatibility(stock.managementCategory,stock.shares,stock));
  const pending=stocks=>targets(stocks).filter(stock=>needsAssignment(stock)||needsRepair(stock));
  const session=value=>valid(value)?value:'core';
  const matches=(stock,value)=>isManagementCategoryTarget(stock)&&valid(value)&&stock.managementCategory===value;
  function compatibility(category,shares,stock){
    if(!valid(category))return '请明确选择一个管理分类。';
    if(shares===null||shares===undefined||shares===''||!Number.isFinite(Number(shares))||Number(shares)<0)return '请填写有效的非负持仓数量。';
    if(category==='candidate'&&Number(shares)>0)return '候选仓应为无持仓标的，请核对持仓数量或选择其他分类。';
    if(category!=='candidate'&&Number(shares)===0)return '当前无持仓，应选择候选仓；核心仓、观察仓和 ETF 分类用于有持仓标的。';
    if(stock&&Number(shares)>0&&!allowed({...stock,shares}).includes(category))return isETF(stock)?'ETF 有持仓时应选择 ETF 分类。':'普通标的有持仓时请选择核心仓或观察仓。';
    return '';
  }
  function validateState(state){
    for(const stock of targets(state.stocks||[]))if(valid(stock.managementCategory)){
      const error=compatibility(stock.managementCategory,stock.shares,stock);
      if(error)throw new Error(`${stock.name||stock.code}：需要修复管理分类。${error}`);
    }
    return state;
  }
  function transition(before,after,choice){
    if(!isManagementCategoryTarget(after))return {kind:'none',category:after.managementCategory};
    const old=Number(before?.shares),next=Number(after.shares);
    const kind=before&&old>0&&next===0?'clear':before&&old===0&&next>0?'build':'none';
    let category=after.managementCategory;
    if(kind==='clear')category='candidate';
    if(kind==='build')category=isETF(after)?'etf':choice;
    if(kind==='none'&&!valid(category))return {kind,category};
    const error=compatibility(category,after.shares,after);
    if(error)throw new Error(error);
    return {kind,category};
  }
  function inventory(stocks){
    return targets(stocks).map(stock=>({id:stock.id,symbol:stock.code||stock.symbol||'',name:stock.name||'',shares:stock.shares??null,assetType:stock.assetType||stock.type||'',legacyRole:stock.role||'',oldWatchFlags:{type:stock.type||'',watchlist:stock.watchlist??null},oldMemberships:['all',...(Number(stock.shares)>0?['holding']:[]),...(stock.type==='watching'?['watching']:[]),...(stock.type==='etf'?['etf']:[]),...(Number(stock.shares)===0?['zero']:[])],confidence:valid(stock.managementCategory)?'exact':stock.role||stock.type||stock.watchlist?'ambiguous':'missing',managementCategory:valid(stock.managementCategory)?stock.managementCategory:null,needsConfirmation:needsAssignment(stock)||needsRepair(stock)})).sort((a,b)=>a.symbol<b.symbol?-1:a.symbol>b.symbol?1:0);
  }
  function buildCandidate(state,assignments,canonical){
    if(!Array.isArray(assignments)||!assignments.length)throw new Error('请先选择需要保存的分类。');
    if(typeof canonical!=='function')throw new Error('标的身份校验不可用。');
    const ids=new Set(),symbols=new Set(),resolved=[];
    for(const assignment of assignments){
      if(!assignment||!valid(assignment.managementCategory))throw new Error('请明确选择一个有效管理分类。');
      const found=state.stocks.filter(stock=>stock.id===assignment.id);
      if(found.length!==1||!assignment.id||ids.has(assignment.id))throw new Error('分类目标不存在或重复。');
      const stock=found[0],symbol=canonical(stock.code||stock.symbol);
      if(!isManagementCategoryTarget(stock))throw new Error('现金或特殊记录不参与管理分类。');
      if(!symbol)throw new Error(`发现无效标的代码：${stock.code||stock.symbol||'（空）'}（${stock.name||stock.id}）`);
      if(symbol!==assignment.symbol)throw new Error(`${assignment.symbol||stock.name} 在整理期间发生变化，请重新打开分类整理。`);
      if(symbols.has(symbol)||targets(state.stocks).filter(s=>canonical(s.code||s.symbol)===symbol).length!==1)throw new Error(`发现重复标的代码：${symbol}`);
      const error=compatibility(assignment.managementCategory,stock.shares,stock);if(error)throw new Error(`${stock.name||symbol}：${error}`);
      ids.add(stock.id);symbols.add(symbol);resolved.push(assignment);
    }
    const candidate=JSON.parse(JSON.stringify(state));
    for(const assignment of resolved)candidate.stocks.find(stock=>stock.id===assignment.id).managementCategory=assignment.managementCategory;
    return candidate;
  }
  function assignmentSession(stocks,canonical){
    return targets(stocks).map(stock=>({id:stock.id,symbol:canonical(stock.code||stock.symbol),pending:needsAssignment(stock)||needsRepair(stock)}));
  }
  function buildAssignmentCandidate(state,assignments,canonical,expected){
    const current=assignmentSession(state.stocks,canonical),ids=new Set(),symbols=new Set();
    for(const row of current){
      const stock=state.stocks.find(s=>s.id===row.id);
      if(!row.id||ids.has(row.id))throw new Error('分类目标身份缺失或重复，请重新打开分类整理。');
      if(!row.symbol)throw new Error(`发现无效标的代码：${stock.code||stock.symbol||'（空）'}（${stock.name||row.id}）`);
      if(symbols.has(row.symbol))throw new Error(`发现重复标的代码：${row.symbol}`);
      ids.add(row.id);symbols.add(row.symbol);
    }
    if(!Array.isArray(expected))throw new Error('分类整理会话无效，请重新打开分类整理。');
    for(const row of expected){
      const found=current.find(s=>s.id===row.id);
      if(!found||found.symbol!==row.symbol)throw new Error(`${row.symbol||row.id} 在整理期间发生变化或被移除，请重新打开分类整理。`);
    }
    if(current.length!==expected.length||current.some(row=>row.pending!==expected.find(s=>s.id===row.id)?.pending))throw new Error('待分类标的集合已变化，请重新打开分类整理。');
    const pendingIds=pending(state.stocks).map(stock=>stock.id);
    if(!Array.isArray(assignments)||assignments.length!==pendingIds.length||new Set(assignments.map(a=>a?.id)).size!==pendingIds.length||assignments.some(a=>!pendingIds.includes(a?.id)))throw new Error('请为每个待分类标的选择管理分类后再预览。');
    return buildCandidate(state,assignments,canonical);
  }
  return Object.freeze({labels,values,valid,isManagementCategoryTarget,targets,pending,needsAssignment,needsRepair,isETF,allowed,validateState,transition,session,matches,compatibility,inventory,buildCandidate,assignmentSession,buildAssignmentCandidate});
});
