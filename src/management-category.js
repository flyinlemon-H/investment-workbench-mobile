(function(root,factory){
  const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;root.ManagementCategory=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  const labels=Object.freeze({core:'核心仓',watch:'观察仓',candidate:'候选仓',etf:'ETF'});
  const values=Object.freeze(Object.keys(labels));
  const valid=value=>typeof value==='string'&&values.includes(value);
  const needsAssignment=stock=>!valid(stock&&stock.managementCategory);
  const session=value=>valid(value)?value:'core';
  const matches=(stock,value)=>valid(value)&&stock.managementCategory===value;
  function compatibility(category,shares){
    if(!valid(category))return '请明确选择一个管理分类。';
    if(shares===null||shares===undefined||shares===''||!Number.isFinite(Number(shares))||Number(shares)<0)return '请填写有效的非负持仓数量。';
    if(category==='candidate'&&Number(shares)>0)return '候选仓应为无持仓标的，请核对持仓数量或选择其他分类。';
    if(category!=='candidate'&&Number(shares)===0)return '当前无持仓，应选择候选仓；核心仓、观察仓和 ETF 分类用于有持仓标的。';
    return '';
  }
  function inventory(stocks){
    return stocks.map(stock=>({symbol:stock.code||stock.symbol||'',name:stock.name||'',shares:stock.shares??null,assetType:stock.assetType||stock.type||'',legacyRole:stock.role||'',oldWatchFlags:{type:stock.type||'',watchlist:stock.watchlist??null},oldMemberships:['all',...(Number(stock.shares)>0?['holding']:[]),...(stock.type==='watching'?['watching']:[]),...(stock.type==='etf'?['etf']:[]),...(Number(stock.shares)===0?['zero']:[])],confidence:valid(stock.managementCategory)?'exact':stock.role||stock.type||stock.watchlist?'ambiguous':'missing',managementCategory:valid(stock.managementCategory)?stock.managementCategory:null,needsConfirmation:needsAssignment(stock)})).sort((a,b)=>a.symbol<b.symbol?-1:a.symbol>b.symbol?1:0);
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
      if(!symbol||symbol!==assignment.symbol||symbols.has(symbol)||state.stocks.filter(s=>canonical(s.code||s.symbol)===symbol).length!==1)throw new Error('标的代码无效、已变化或重复，请重新整理。');
      const error=compatibility(assignment.managementCategory,stock.shares);if(error)throw new Error(`${stock.name||symbol}：${error}`);
      ids.add(stock.id);symbols.add(symbol);resolved.push(assignment);
    }
    const candidate=JSON.parse(JSON.stringify(state));
    for(const assignment of resolved)candidate.stocks.find(stock=>stock.id===assignment.id).managementCategory=assignment.managementCategory;
    return candidate;
  }
  return Object.freeze({labels,values,valid,needsAssignment,session,matches,compatibility,inventory,buildCandidate});
});
