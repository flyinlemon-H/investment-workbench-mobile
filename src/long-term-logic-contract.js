(function(root,factory){
  const identity=typeof module==='object'&&module.exports?require('./symbol-identity.js'):root&&root.SymbolIdentity;
  const strictAiJson=typeof module==='object'&&module.exports?require('./strict-ai-json.js'):root&&root.StrictAiJson;
  const api=factory(identity,strictAiJson);
  if(typeof module==='object'&&module.exports)module.exports=api;
  if(root)root.LongTermLogicContract=Object.freeze(api);
})(typeof globalThis!=='undefined'?globalThis:this,function(SymbolIdentity,StrictAiJson){
  'use strict';

  if(!SymbolIdentity||!StrictAiJson)throw new Error('Long-Term Logic contract dependencies are unavailable.');
  const CONTEXT_SCHEMA_VERSION='long-term-logic.context.v2';
  const MODULE_SCHEMA_VERSION='long-term-logic.v2';
  const SNAPSHOT_SCHEMA_VERSION='long-term-logic.snapshot.v1';
  const STORE_SCHEMA_VERSION='long-term-logic.store.v1';
  const HISTORY_LIMIT=20;
  const ROOT_FIELDS=Object.freeze(['binding','longTermLogic']);
  const BINDING_FIELDS=Object.freeze(['symbol','contextHash']);
  const AI_LOGIC_FIELDS=Object.freeze(['investmentThesis','coreDrivers','keyRisks','reviewTriggers','logicStatus','confidence','nextReviewDate']);
  const STORED_LOGIC_FIELDS=Object.freeze(['schemaVersion',...AI_LOGIC_FIELDS]);
  const LOGIC_FIELDS=AI_LOGIC_FIELDS;
  // Keep the accepted production enum. The UI renders `broken` as “逻辑失效”.
  const LOGIC_STATUSES=Object.freeze(['valid','weakening','broken','unclear']);
  const CONFIDENCE_LEVELS=Object.freeze(['high','medium','low']);
  const ARRAY_LIMITS=Object.freeze({coreDrivers:[1,5],keyRisks:[1,5],reviewTriggers:[1,5]});
  const SHORT_TERM_PATTERN=/(?:MA(?:5|10|20|60|120)|MACD|RSI|KDJ|分时|盘口|今日涨跌|主力资金|短线追涨)/i;

  function object(value){return Boolean(value&&typeof value==='object'&&!Array.isArray(value))}
  function clone(value){return value===undefined?undefined:JSON.parse(JSON.stringify(value))}
  function text(value){return String(value??'').trim()}
  function canonical(value){return SymbolIdentity.canonicalSymbol(value)}
  function exactFields(value,allowed,path){
    const keys=Object.keys(value),missing=allowed.filter(key=>!Object.prototype.hasOwnProperty.call(value,key)),extra=keys.filter(key=>!allowed.includes(key));
    if(missing.length)return `${path} 缺少字段：${missing.join(', ')}。`;
    if(extra.length)return `${path} 包含未知字段：${extra.join(', ')}。`;
    return '';
  }
  function stable(value){
    if(Array.isArray(value))return `[${value.map(stable).join(',')}]`;
    if(object(value))return `{${Object.keys(value).sort().map(key=>`${JSON.stringify(key)}:${stable(value[key])}`).join(',')}}`;
    return JSON.stringify(value===undefined?null:value);
  }
  function hash(value){
    const input=typeof value==='string'?value:stable(value);let result=2166136261;
    for(let index=0;index<input.length;index+=1){result^=input.charCodeAt(index);result=Math.imul(result,16777619)}
    return (result>>>0).toString(16).padStart(8,'0');
  }
  function validDate(value){
    if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value))return false;
    const [year,month,day]=value.split('-').map(Number),date=new Date(Date.UTC(year,month-1,day));
    return date.getUTCFullYear()===year&&date.getUTCMonth()===month-1&&date.getUTCDate()===day;
  }
  function invalid(code,message,input=null){return {ok:false,previewReady:false,writes:0,code,message,input,value:null,logic:null,context:null}}
  function canonicalInput(stock){
    return {
      stock:{id:text(stock&&stock.id),name:text(stock&&stock.name),symbol:canonical(stock&&(stock.code||stock.symbol)),type:text(stock&&stock.type),role:text(stock&&stock.role),theme:text(stock&&stock.theme)},
      existingLongTermLogic:clone(stock&&stock.longTermLogic||{}),
      financialData:clone(stock&&stock.financialData||{}),
      valuationData:clone(stock&&stock.valuationData||{}),
      allocationDecision:clone(stock&&stock.allocationDecision||{}),
      dataFreshness:clone(stock&&stock.dataFreshness||{})
    };
  }
  function sourceFingerprint(stock){return `ltsrc_${hash(canonicalInput(stock))}`}
  function prepareContext(stock,options={}){
    if(!object(stock))throw new Error('长期逻辑标的无效。');
    const symbol=canonical(stock.code||stock.symbol),stockId=text(stock.id),promptDate=text(options.promptDate||new Date().toISOString().slice(0,10));
    if(!symbol||!stockId||!validDate(promptDate))throw new Error('长期逻辑标的或日期无效。');
    const fingerprint=sourceFingerprint(stock),contextHash=`ltctx_${hash({schemaVersion:CONTEXT_SCHEMA_VERSION,stockId,symbol,promptDate,fingerprint})}`;
    return Object.freeze({schemaVersion:CONTEXT_SCHEMA_VERSION,stockId,symbol,promptDate,sourceFingerprint:fingerprint,contextHash,input:clone(options.input||canonicalInput(stock))});
  }
  function validateString(value,path,maxLength,minLength=1){
    if(typeof value!=='string'||text(value).length<minLength)return `${path} 必须是非空字符串。`;
    if([...value].length>maxLength)return `${path} 超过长度限制。`;
    if(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/.test(value))return `${path} 包含无效控制字符。`;
    return '';
  }
  function validateStringArray(value,path,min,max){
    if(!Array.isArray(value)||value.length<min||value.length>max)return `${path} 必须包含 ${min}-${max} 项。`;
    for(let index=0;index<value.length;index+=1){const error=validateString(value[index],`${path}[${index}]`,180);if(error)return error}
    if(new Set(value.map(item=>text(item))).size!==value.length)return `${path} 不得包含重复项。`;
    return '';
  }
  function validateJudgment(logic){
    if(!object(logic))return {ok:false,code:'invalid_logic',message:'longTermLogic 必须是对象。'};
    const shape=exactFields(logic,AI_LOGIC_FIELDS,'longTermLogic');if(shape)return {ok:false,code:'invalid_logic_shape',message:shape};
    const thesisError=validateString(logic.investmentThesis,'longTermLogic.investmentThesis',400,10);if(thesisError)return {ok:false,code:'invalid_text',message:thesisError};
    for(const [field,[min,max]] of Object.entries(ARRAY_LIMITS)){
      const error=validateStringArray(logic[field],`longTermLogic.${field}`,min,max);if(error)return {ok:false,code:'invalid_array',message:error};
    }
    if(!LOGIC_STATUSES.includes(logic.logicStatus))return {ok:false,code:'invalid_logic_status',message:`logicStatus 必须是 ${LOGIC_STATUSES.join(' / ')}。`};
    if(!CONFIDENCE_LEVELS.includes(logic.confidence))return {ok:false,code:'invalid_confidence',message:`confidence 必须是 ${CONFIDENCE_LEVELS.join(' / ')}。`};
    if(!validDate(logic.nextReviewDate))return {ok:false,code:'invalid_date',message:'longTermLogic.nextReviewDate 必须是有效的 YYYY-MM-DD 日期。'};
    const longHorizonText=[logic.investmentThesis,...logic.coreDrivers,...logic.keyRisks,...logic.reviewTriggers].join('\n');
    if(SHORT_TERM_PATTERN.test(longHorizonText))return {ok:false,code:'short_term_content',message:'长期逻辑包含短线技术或资金表述。'};
    return {ok:true,logic:clone(logic)};
  }
  function storedLogic(judgment){return {schemaVersion:MODULE_SCHEMA_VERSION,...clone(judgment)}}
  function validateStoredLogic(logic){
    if(!object(logic))return {ok:false,code:'invalid_logic',message:'长期逻辑必须是对象。'};
    const shape=exactFields(logic,STORED_LOGIC_FIELDS,'长期逻辑');if(shape)return {ok:false,code:'invalid_logic_shape',message:shape};
    if(logic.schemaVersion!==MODULE_SCHEMA_VERSION)return {ok:false,code:'unsupported_schema',message:'长期逻辑版本不受支持。'};
    const judgment={};for(const field of AI_LOGIC_FIELDS)judgment[field]=logic[field];
    const checked=validateJudgment(judgment);return checked.ok?{ok:true,logic:storedLogic(checked.logic)}:checked;
  }
  function isSlimLogic(value){return object(value)&&value.schemaVersion===MODULE_SCHEMA_VERSION}
  function validateLogic(logic){return isSlimLogic(logic)?validateStoredLogic(logic):validateJudgment(logic)}
  function validate(value,options={}){
    if(!object(value))return invalid('invalid_top_level','顶层必须是对象。');
    const rootShape=exactFields(value,ROOT_FIELDS,'顶层');if(rootShape)return invalid('invalid_top_level',rootShape);
    if(!object(value.binding))return invalid('invalid_binding','binding 必须是对象。');
    const bindingShape=exactFields(value.binding,BINDING_FIELDS,'binding');if(bindingShape)return invalid('invalid_binding',bindingShape);
    const context=options.context;
    if(!context||context.schemaVersion!==CONTEXT_SCHEMA_VERSION)return invalid('missing_context','缺少本次长期逻辑受保护上下文。');
    const symbol=canonical(value.binding.symbol);
    if(!symbol||symbol!==context.symbol)return invalid('symbol_mismatch',`binding.symbol 必须为 ${context.symbol}。`);
    if(value.binding.contextHash!==context.contextHash)return invalid('context_mismatch','长期逻辑响应不属于当前标的或当前上下文，请重新生成 Prompt。');
    const logicResult=validateJudgment(value.longTermLogic);
    if(!logicResult.ok)return invalid(logicResult.code,logicResult.message);
    if(logicResult.logic.nextReviewDate<context.promptDate)return invalid('invalid_review_date','nextReviewDate 不能早于本次判断日期。');
    const canonicalValue={binding:{symbol,contextHash:context.contextHash},longTermLogic:logicResult.logic};
    return {ok:true,previewReady:true,writes:0,code:'valid',message:'长期逻辑已通过严格校验，尚未写入。',input:null,value:canonicalValue,logic:clone(logicResult.logic),context};
  }
  function process(raw,options={}){
    const parsed=StrictAiJson.parseStrictAiJson(raw);
    if(!parsed.ok)return invalid('parse_error',parsed.userMessage,parsed.input);
    const result=validate(parsed.value,options);result.input=parsed.input;return result;
  }
  function responseHash(result){return `ltresp_${hash(result&&result.value||{})}`}
  function snapshot(result,context,_metadata={},options={}){
    const savedAt=text(options.savedAt)||new Date().toISOString(),digest=responseHash(result);
    return {snapshotId:`ltl_${hash(`${savedAt}|${context.contextHash}|${digest}`)}`,schemaVersion:SNAPSHOT_SCHEMA_VERSION,symbol:context.symbol,updatedAt:context.promptDate,savedAt,contextHash:context.contextHash,responseHash:digest,logic:storedLogic(result.logic)};
  }
  function legacySnapshot(logic,symbol,options={}){
    const savedAt=text(options.savedAt)||new Date().toISOString(),digest=`legacy_${hash(logic)}`;
    return {snapshotId:`ltl_${hash(`${savedAt}|${symbol}|${digest}`)}`,schemaVersion:SNAPSHOT_SCHEMA_VERSION,symbol,updatedAt:validDate(logic.updatedAt)?logic.updatedAt:'',savedAt,contextHash:'',responseHash:digest,logic:clone(logic)};
  }
  function hasMaterialLogic(logic){return object(logic)&&Boolean(text(logic.investmentThesis)||Array.isArray(logic.coreDrivers)&&logic.coreDrivers.length||Array.isArray(logic.keyRisks)&&logic.keyRisks.length||Array.isArray(logic.longTermRisks)&&logic.longTermRisks.length)}
  function validateSnapshot(value,{allowLegacy=false}={}){
    if(!object(value))return {ok:false,errors:['长期逻辑快照必须是对象。']};
    const allowed=['snapshotId','schemaVersion','symbol','updatedAt','savedAt','contextHash','responseHash','logic'],shape=exactFields(value,allowed,'长期逻辑快照'),errors=[];
    if(shape)errors.push(shape);
    if(value.schemaVersion!==SNAPSHOT_SCHEMA_VERSION||!text(value.snapshotId)||!canonical(value.symbol)||!text(value.savedAt))errors.push('长期逻辑快照元数据无效。');
    const legacy=String(value.responseHash||'').startsWith('legacy_')||!isSlimLogic(value.logic);
    if(legacy){if(!object(value.logic))errors.push('历史长期逻辑内容无效。')}else{
      if(!/^ltctx_[0-9a-f]{8}$/.test(String(value.contextHash||''))||!/^ltresp_[0-9a-f]{8}$/.test(String(value.responseHash||'')))errors.push('长期逻辑快照审计绑定无效。');
      const logicValidation=validateStoredLogic(value.logic);if(!logicValidation.ok)errors.push(logicValidation.message);
    }
    return {ok:errors.length===0,errors};
  }
  function emptyStore(){return {schemaVersion:STORE_SCHEMA_VERSION,current:null,history:[]}}
  function validateStore(value,currentLogic=null){
    if(!object(value))return {ok:false,errors:['长期逻辑审计存储必须是对象。']};
    const shape=exactFields(value,['schemaVersion','current','history'],'长期逻辑审计存储'),errors=[];if(shape)errors.push(shape);
    if(value.schemaVersion!==STORE_SCHEMA_VERSION)errors.push('长期逻辑审计存储版本无效。');
    if(value.current!==null){const current=validateSnapshot(value.current,{allowLegacy:true});errors.push(...current.errors)}
    if(!Array.isArray(value.history)||value.history.length>HISTORY_LIMIT)errors.push('长期逻辑历史必须是有界数组。');
    else value.history.forEach(item=>errors.push(...validateSnapshot(item,{allowLegacy:true}).errors));
    const ids=[value.current,...(Array.isArray(value.history)?value.history:[])].filter(Boolean).map(item=>item.snapshotId);if(new Set(ids).size!==ids.length)errors.push('长期逻辑审计编号重复。');
    if(currentLogic&&value.current&&stable(value.current.logic)!==stable(currentLogic))errors.push('当前长期逻辑与审计快照不一致。');
    return {ok:errors.length===0,errors};
  }
  function buildCandidate(currentState,result,options={}){
    if(!result||!result.ok||!result.previewReady)throw new Error(result&&result.message||'长期逻辑结果无效。');
    if(!object(currentState)||!Array.isArray(currentState.stocks))throw new Error('当前应用状态无效。');
    const context=options.context||result.context;if(!context)throw new Error('缺少长期逻辑受保护上下文。');
    const currentStock=currentState.stocks.find(stock=>text(stock&&stock.id)===context.stockId&&canonical(stock&&(stock.code||stock.symbol))===context.symbol);
    if(!currentStock)throw new Error('当前状态中找不到受保护标的。');
    if(sourceFingerprint(currentStock)!==context.sourceFingerprint)throw new Error('长期逻辑上下文已变化，请重新生成 Prompt。');
    const candidate=clone(currentState),target=candidate.stocks.find(stock=>text(stock&&stock.id)===context.stockId&&canonical(stock&&(stock.code||stock.symbol))===context.symbol);
    const existingStore=target.longTermLogicAudit===undefined?emptyStore():clone(target.longTermLogicAudit),storeValidation=validateStore(existingStore,target.longTermLogic);
    if(!storeValidation.ok)throw new Error(storeValidation.errors.join('；'));
    const nextSnapshot=snapshot(result,context,options.transport,options),history=clone(existingStore.history||[]);
    if(existingStore.current)history.push(clone(existingStore.current));
    else if(hasMaterialLogic(target.longTermLogic)&&stable(target.longTermLogic)!==stable(nextSnapshot.logic))history.push(legacySnapshot(target.longTermLogic,context.symbol,options));
    target.longTermLogic=clone(nextSnapshot.logic);
    target.longTermLogicAudit={schemaVersion:STORE_SCHEMA_VERSION,current:nextSnapshot,history:history.slice(-HISTORY_LIMIT)};
    target.dataFreshness={...(object(target.dataFreshness)?target.dataFreshness:{}),personalViewUpdatedAt:context.promptDate};
    const finalValidation=validateStore(target.longTermLogicAudit,target.longTermLogic);if(!finalValidation.ok)throw new Error(finalValidation.errors.join('；'));
    return {candidate,snapshot:nextSnapshot,stockId:context.stockId};
  }
  async function commit(result,currentState,deps={},options={}){
    if(!result||!result.ok||!result.previewReady)return {status:'invalid',writes:0,error:new Error(result&&result.message||'长期逻辑结果无效。')};
    if(typeof deps.saveCandidate!=='function')return {status:'failed',stage:'candidate',writes:0,error:new Error('长期逻辑持久化依赖不可用。')};
    let built;try{built=buildCandidate(currentState,result,options)}catch(error){return {status:'invalid',stage:'candidate',writes:0,error}}
    try{
      const saved=await deps.saveCandidate(built.candidate,{critical:true}),next=saved&&saved.state?saved.state:(saved&&Array.isArray(saved.stocks)?saved:built.candidate);
      if(saved===false||(saved&&saved.ok===false))throw new Error('critical save 返回失败。');
      if(typeof deps.adoptCandidate==='function')deps.adoptCandidate(next);
      if(typeof deps.render==='function')deps.render();
      return {status:'completed',writes:1,state:next,snapshot:built.snapshot};
    }catch(error){if(typeof deps.rollback==='function')deps.rollback(currentState);return {status:'failed',stage:'save',writes:1,error}}
  }

  return Object.freeze({CONTEXT_SCHEMA_VERSION,MODULE_SCHEMA_VERSION,SNAPSHOT_SCHEMA_VERSION,STORE_SCHEMA_VERSION,HISTORY_LIMIT,ROOT_FIELDS,BINDING_FIELDS,AI_LOGIC_FIELDS,STORED_LOGIC_FIELDS,LOGIC_FIELDS,LOGIC_STATUSES,CONFIDENCE_LEVELS,stable,hash,validDate,canonicalInput,sourceFingerprint,prepareContext,validateJudgment,validateStoredLogic,validateLogic,isSlimLogic,storedLogic,validate,process,responseHash,emptyStore,validateSnapshot,validateStore,buildCandidate,commit,clone});
});
