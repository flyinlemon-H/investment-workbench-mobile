'use strict';
// Synthetic data follows the observed legacy cash shape, never real holdings.
function mixed(count=23){
  const stocks=Array.from({length:count},(_,i)=>({id:`legacy-${i}`,code:`${600000+i}.SS`,name:`隔离标的${i}`,shares:i%4===2?0:100,type:i%4===3?'etf':i%4===1?'watching':'holding',role:['成长仓','卫星仓','观察仓','核心仓'][i%4],watchlist:i%4===1,plans:[]}));
  stocks.push({id:'cash',name:'现金(手动维护)',code:'',type:'etf',role:'现金',theme:'现金',shares:0,currentValue:1234.56,notes:'保留现金台账',plans:[]});
  return {stocks,updatedAt:1,executionLog:[]};
}
function choices(state){return state.stocks.filter(s=>s.id!=='cash').map((s,i)=>({id:s.id,symbol:s.code,managementCategory:['core','watch','candidate','etf'][i%4]}))}
module.exports={mixed,choices};
