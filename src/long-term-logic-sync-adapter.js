(function(root,factory){
  const contract=typeof module==='object'&&module.exports?require('./long-term-logic-contract.js'):root&&root.LongTermLogicContract;
  const identity=typeof module==='object'&&module.exports?require('./symbol-identity.js'):root&&root.SymbolIdentity;
  const api=factory(contract,identity);
  if(typeof module==='object'&&module.exports)module.exports=api;
  if(root)root.LongTermLogicSyncAdapter=Object.freeze(api);
})(typeof globalThis!=='undefined'?globalThis:this,function(Contract,SymbolIdentity){
  'use strict';
  if(!Contract||!SymbolIdentity)throw new Error('Long-Term Logic sync dependencies are unavailable.');
  const moduleType='long_term_logic',moduleSchemaVersion=Contract.MODULE_SCHEMA_VERSION;
  const PAYLOAD_FIELDS=Object.freeze([...Contract.AI_LOGIC_FIELDS]);
  function object(value){return Boolean(value&&typeof value==='object'&&!Array.isArray(value))}
  function clone(value){return value===undefined?undefined:JSON.parse(JSON.stringify(value))}
  function canonical(value){return SymbolIdentity.canonicalSymbol(value)}
  function stockFor(state,entityKey){return state&&Array.isArray(state.stocks)?state.stocks.find(stock=>canonical(stock&&(stock.code||stock.symbol))===canonical(entityKey)):null}
  function checkApplyEligibility(state,envelope){return stockFor(state,envelope.entityKey)?{ok:true}:{ok:false,code:'missing_local_stock',message:'本机尚未添加该股票。请先添加该股票后再获取长期逻辑。'}}
  function serialize(state,entityKey){
    const stock=stockFor(state,entityKey),logic=stock&&stock.longTermLogic;
    if(!Contract.isSlimLogic(logic))return null;
    const payload={};for(const field of PAYLOAD_FIELDS)payload[field]=clone(logic[field]);
    return payload;
  }
  function validate(payload){
    if(!object(payload)||Object.keys(payload).length!==PAYLOAD_FIELDS.length||Object.keys(payload).some(key=>!PAYLOAD_FIELDS.includes(key)))return {ok:false,message:'长期逻辑同步内容包含缺失或越界字段。'};
    const checked=Contract.validateJudgment(payload);return checked.ok?{ok:true,payload:checked.logic}:{ok:false,message:checked.message};
  }
  function listDiff(before,after){
    const left=Array.isArray(before)?before:[],right=Array.isArray(after)?after:[];
    return {added:right.filter(item=>!left.includes(item)),removed:left.filter(item=>!right.includes(item)),changed:Contract.stable(left)!==Contract.stable(right)};
  }
  function diff(before,after){
    const old=object(before)?before:{},next=object(after)?after:{};
    return [
      {field:'investmentThesis',label:'投资逻辑',changed:String(old.investmentThesis||'')!==String(next.investmentThesis||''),before:String(old.investmentThesis||''),after:String(next.investmentThesis||'')},
      {field:'coreDrivers',label:'核心驱动',...listDiff(old.coreDrivers,next.coreDrivers)},
      {field:'keyRisks',label:'关键风险',...listDiff(old.keyRisks,next.keyRisks)},
      {field:'reviewTriggers',label:'复核条件',...listDiff(old.reviewTriggers,next.reviewTriggers)},
      {field:'logicStatus',label:'当前状态',changed:String(old.logicStatus||'')!==String(next.logicStatus||''),before:String(old.logicStatus||''),after:String(next.logicStatus||'')},
      {field:'confidence',label:'判断把握',changed:String(old.confidence||'')!==String(next.confidence||''),before:String(old.confidence||''),after:String(next.confidence||'')},
      {field:'nextReviewDate',label:'下次复核',changed:String(old.nextReviewDate||'')!==String(next.nextReviewDate||''),before:String(old.nextReviewDate||''),after:String(next.nextReviewDate||'')}
    ].filter(item=>item.changed);
  }
  function sourceFingerprint(state,entityKey){
    const stock=stockFor(state,entityKey);if(!stock)return `missing:${canonical(entityKey)}`;
    return `ltlsrc_${Contract.hash({id:stock.id,symbol:canonical(entityKey),logic:stock.longTermLogic,audit:stock.longTermLogicAudit&&stock.longTermLogicAudit.current&&stock.longTermLogicAudit.current.responseHash||''})}`;
  }
  function historicalSnapshot(logic,symbol,savedAt){
    const responseHash=`legacy_${Contract.hash(logic)}`;
    return {snapshotId:`ltl_${Contract.hash(`${savedAt}|${symbol}|${responseHash}`)}`,schemaVersion:Contract.SNAPSHOT_SCHEMA_VERSION,symbol,updatedAt:String(logic&&logic.updatedAt||''),savedAt,contextHash:'',responseHash,logic:clone(logic)};
  }
  function buildCandidate(currentState,envelope){
    const checked=validate(envelope&&envelope.payload);if(!checked.ok)throw new Error(checked.message);
    const currentStock=stockFor(currentState,envelope.entityKey);if(!currentStock)throw new Error('请先在本机建立该股票记录；同步长期逻辑不会自动创建持仓或股票清单。');
    const candidate=clone(currentState),target=stockFor(candidate,envelope.entityKey),savedAt=new Date().toISOString(),publishedDate=String(envelope.publishedAt||savedAt).slice(0,10),responseHash=`ltresp_${Contract.hash(envelope.payload)}`,contextHash=`ltctx_${Contract.hash({moduleType,entityKey:envelope.entityKey,revision:envelope.revision,payloadHash:envelope.payloadHash})}`;
    const previous=target.longTermLogicAudit&&object(target.longTermLogicAudit)?clone(target.longTermLogicAudit):Contract.emptyStore(),history=Array.isArray(previous.history)?clone(previous.history):[];
    if(previous.current)history.push(clone(previous.current));
    else if(target.longTermLogic&&object(target.longTermLogic)&&String(target.longTermLogic.investmentThesis||''))history.push(historicalSnapshot(target.longTermLogic,canonical(envelope.entityKey),savedAt));
    const logic=Contract.storedLogic(checked.payload),snapshot={snapshotId:`ltl_${Contract.hash(`${savedAt}|${contextHash}|${responseHash}`)}`,schemaVersion:Contract.SNAPSHOT_SCHEMA_VERSION,symbol:canonical(envelope.entityKey),updatedAt:publishedDate,savedAt,contextHash,responseHash,logic:clone(logic)};
    target.longTermLogic=logic;target.longTermLogicAudit={schemaVersion:Contract.STORE_SCHEMA_VERSION,current:snapshot,history:history.slice(-Contract.HISTORY_LIMIT)};
    target.dataFreshness={...(object(target.dataFreshness)?target.dataFreshness:{}),personalViewUpdatedAt:publishedDate};
    const final=Contract.validateStore(target.longTermLogicAudit,target.longTermLogic);if(!final.ok)throw new Error(final.errors.join('；'));
    return candidate;
  }
  function renderLabel(entityKey,state){const stock=stockFor(state,entityKey);return `${stock&&stock.name||entityKey} · 长期逻辑`}
  return Object.freeze({moduleType,moduleSchemaVersion,PAYLOAD_FIELDS,checkApplyEligibility,serialize,validate,diff,sourceFingerprint,buildCandidate,renderLabel});
});
