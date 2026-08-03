const V13_EVENT_STAGE_RANK={decision:3,prepare:2,info:1};
const V13_EVENT_STATUS_RANK={pending:3,cooldown:2,archived:0};

function normalizeEventList(events){
  return (Array.isArray(events)?events:[])
    .map(event=>typeof normalizeV13Event==='function'?normalizeV13Event(event):event)
    .filter(event=>event&&typeof event==='object');
}

function getEventStageRank(event){
  const e=typeof normalizeV13Event==='function'?normalizeV13Event(event):event;
  return V13_EVENT_STAGE_RANK[e&&e.phase]||0;
}

function getEventStatusRank(event){
  const e=typeof normalizeV13Event==='function'?normalizeV13Event(event):event;
  return V13_EVENT_STATUS_RANK[e&&e.status]||0;
}

function getEventPriorityRank(event){
  const e=typeof normalizeV13Event==='function'?normalizeV13Event(event):event;
  const priority=Number(e&&e.priority);
  return Number.isFinite(priority)?priority:0;
}

function sortEventsByDecisionPriority(events){
  return normalizeEventList(events).slice().sort((a,b)=>{
    const stageDiff=getEventStageRank(b)-getEventStageRank(a);
    if(stageDiff)return stageDiff;
    const statusDiff=getEventStatusRank(b)-getEventStatusRank(a);
    if(statusDiff)return statusDiff;
    const priorityDiff=getEventPriorityRank(b)-getEventPriorityRank(a);
    if(priorityDiff)return priorityDiff;
    return String(b.updatedAt||b.createdAt||'').localeCompare(String(a.updatedAt||a.createdAt||''));
  });
}

function getActiveEvents(events){
  return sortEventsByDecisionPriority(events).filter(event=>event.status!=='archived');
}

function v13StockEvents(stock){
  if(!stock||typeof stock!=='object')return [];
  if(stock.coreModel&&Array.isArray(stock.coreModel.events))return stock.coreModel.events;
  if(Array.isArray(stock.events))return stock.events;
  return [];
}

function getHomeVisibleEventsByStock(stocks){
  const result=[];
  (Array.isArray(stocks)?stocks:[]).forEach(stock=>{
    const active=getActiveEvents(v13StockEvents(stock));
    if(active.length)result.push(active[0]);
  });
  return sortEventsByDecisionPriority(result);
}

function getStockVisibleEvents(stock){
  return getActiveEvents(v13StockEvents(stock));
}
