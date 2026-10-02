'use strict';
function resultFor(task,date='2026-09-30'){
 const stock={symbol:task.symbol,priceHistory:[{date,open:10,high:12,low:9,close:11,volume:1000,provider:'fixture',adjustment:'qfq',price_basis:'adjusted',is_complete_bar:true}],technicalIndicators:{last_trade_date:date},marketDataFreshness:{last_trade_date:date,is_complete_bar:true,kline_status:'current',provider:'fixture',fetched_at:'2026-10-01T08:00:00Z'}};
 return {schemaVersion:1,taskId:task.taskId,resultVersion:task.taskId,symbol:task.symbol,provider:'fixture',requestedAt:task.requestedAt,completedAt:'2026-10-01T08:00:00Z',latestCompleteBar:date,technicalAsOf:date,dataUpdated:true,warnings:[],fingerprint:'a'.repeat(64),stock};
}
module.exports={resultFor};
