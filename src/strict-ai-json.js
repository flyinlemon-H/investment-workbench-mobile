(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  if(root)root.StrictAiJson=Object.freeze(api);
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';

  const REPAIRS=Object.freeze({
    MARKDOWN_FENCE:'markdown_fence',
    STRUCTURAL_SMART_QUOTES:'structural_smart_quotes',
    BOUNDARY_BOM:'boundary_bom',
    BOUNDARY_INVISIBLE:'boundary_invisible'
  });
  const REASONS=Object.freeze({
    EMPTY:'empty_input',
    AMBIGUOUS_SMART_QUOTES:'ambiguous_smart_quotes',
    MALFORMED:'malformed_json',
    TRUNCATED:'truncated_json',
    UNSUPPORTED_WRAPPER:'unsupported_wrapper'
  });
  const USER_MESSAGES=Object.freeze({
    [REASONS.EMPTY]:'JSON 格式无法识别，请重新复制完整结果',
    [REASONS.AMBIGUOUS_SMART_QUOTES]:'检测到非标准 JSON 引号，自动修复失败',
    [REASONS.MALFORMED]:'JSON 格式无法识别，请重新复制完整结果',
    [REASONS.TRUNCATED]:'JSON 内容可能不完整，请重新复制完整结果',
    [REASONS.UNSUPPORTED_WRAPPER]:'JSON 格式无法识别，请重新复制完整结果'
  });
  const jsonWhitespace=char=>char===' '||char==='\t'||char==='\r'||char==='\n';
  const invisible=char=>char==='\u200B'||char==='\u200C'||char==='\u200D'||char==='\u2060';

  function boundaryCleanup(source){
    let start=0,end=source.length,sawBom=false,sawInvisible=false;
    while(start<end){
      const char=source[start];
      if(jsonWhitespace(char)){start+=1;continue}
      if(char==='\uFEFF'){sawBom=true;start+=1;continue}
      if(invisible(char)){sawInvisible=true;start+=1;continue}
      break;
    }
    while(end>start){
      const char=source[end-1];
      if(jsonWhitespace(char)){end-=1;continue}
      if(char==='\uFEFF'){sawBom=true;end-=1;continue}
      if(invisible(char)){sawInvisible=true;end-=1;continue}
      break;
    }
    const repairs=[];
    if(sawBom)repairs.push(REPAIRS.BOUNDARY_BOM);
    if(sawInvisible)repairs.push(REPAIRS.BOUNDARY_INVISIBLE);
    return {text:source.slice(start,end),repairs};
  }

  function wrappingFence(text){
    const match=text.match(/^```(?:json)?[ \t]*\r?\n([\s\S]*?)\r?\n```[ \t]*$/i);
    return match?{matched:true,text:match[1]}:{matched:false,text};
  }

  function nextNonWhitespace(text,start){
    for(let index=start;index<text.length;index+=1)if(!jsonWhitespace(text[index]))return text[index];
    return '';
  }

  function recoverStructuralSmartQuotes(text){
    const stack=[];
    let rootState='value',mode='syntax',stringRole='',escaped=false,nestedSmartQuotes=0,output='',replacements=0;
    const top=()=>stack[stack.length-1]||null;
    const canStartKey=()=>{const current=top();return Boolean(current&&current.type==='object'&&current.state==='keyOrEnd')};
    const canStartValue=()=>{const current=top();return current?((current.type==='object'&&current.state==='value')||(current.type==='array'&&current.state==='valueOrEnd')):rootState==='value'};
    const markValue=()=>{const current=top();if(!current)rootState='end';else current.state='commaOrEnd'};
    const finishString=()=>{
      const current=top();
      if(stringRole==='key'&&current&&current.type==='object')current.state='colon';
      else markValue();
      stringRole='';
    };
    const smartQuoteCanClose=index=>{
      const next=nextNonWhitespace(text,index+1),current=top();
      if(stringRole==='key')return next===':';
      if(!current)return next==='';
      return current.type==='object'?(next===','||next==='}'):(next===','||next===']');
    };

    for(let index=0;index<text.length;index+=1){
      const char=text[index];
      if(mode==='asciiString'){
        output+=char;
        if(escaped){escaped=false;continue}
        if(char==='\\'){escaped=true;continue}
        if(char==='"'){mode='syntax';finishString()}
        continue;
      }
      if(mode==='smartString'){
        if(escaped){output+=char;escaped=false;continue}
        if(char==='\\'){output+=char;escaped=true;continue}
        if(char==='“'){nestedSmartQuotes+=1;output+=char;continue}
        if(char==='”'&&nestedSmartQuotes>0){nestedSmartQuotes-=1;output+=char;continue}
        if(char==='”'&&smartQuoteCanClose(index)){
          output+='"';replacements+=1;mode='syntax';finishString();continue;
        }
        output+=char;
        continue;
      }
      if(char==='"'){
        stringRole=canStartKey()?'key':(canStartValue()?'value':'');
        mode='asciiString';output+=char;continue;
      }
      if(char==='“'&&(canStartKey()||canStartValue())){
        stringRole=canStartKey()?'key':'value';
        mode='smartString';nestedSmartQuotes=0;output+='"';replacements+=1;continue;
      }
      if(char==='“'||char==='”')return {ok:false,text:output+text.slice(index),replacements,ambiguous:true};
      output+=char;
      if(jsonWhitespace(char))continue;
      const current=top();
      if(char==='{'){
        if(canStartValue())markValue();
        stack.push({type:'object',state:'keyOrEnd'});
      }else if(char==='['){
        if(canStartValue())markValue();
        stack.push({type:'array',state:'valueOrEnd'});
      }else if(char==='}'||char===']'){
        stack.pop();
      }else if(char===':'&&current&&current.type==='object'&&current.state==='colon'){
        current.state='value';
      }else if(char===','&&current&&current.state==='commaOrEnd'){
        current.state=current.type==='object'?'keyOrEnd':'valueOrEnd';
      }else if(canStartValue()){
        markValue();
      }
    }
    if(mode==='smartString'||nestedSmartQuotes!==0)return {ok:false,text:output,replacements,ambiguous:true};
    return {ok:true,text:output,replacements,ambiguous:false};
  }

  function failureClass(text){
    let start=0;
    while(start<text.length&&jsonWhitespace(text[start]))start+=1;
    if(start>=text.length)return REASONS.EMPTY;
    if(text[start]!=='{'&&text[start]!=='[')return REASONS.UNSUPPORTED_WRAPPER;
    const stack=[],opening={'}':'{',']':'['};
    let inString=false,escaped=false,rootEndedAt=-1;
    for(let index=start;index<text.length;index+=1){
      const char=text[index];
      if(inString){
        if(escaped){escaped=false;continue}
        if(char==='\\'){escaped=true;continue}
        if(char==='"')inString=false;
        continue;
      }
      if(char==='"'){inString=true;continue}
      if(char==='{'||char==='[')stack.push(char);
      else if(char==='}'||char===']'){
        if(!stack.length||stack[stack.length-1]!==opening[char])return REASONS.MALFORMED;
        stack.pop();
        if(!stack.length){rootEndedAt=index;break}
      }
    }
    if(inString||escaped||stack.length)return REASONS.TRUNCATED;
    if(rootEndedAt<0)return REASONS.TRUNCATED;
    if(text.slice(rootEndedAt+1).split('').some(char=>!jsonWhitespace(char)))return REASONS.UNSUPPORTED_WRAPPER;
    return REASONS.MALFORMED;
  }

  function legacyInput(source,repairs,diagnostics){
    return {
      fenceRemoved:repairs.includes(REPAIRS.MARKDOWN_FENCE),
      smartQuotesDetected:/[“”]/.test(source),
      smartQuoteRecoveryAttempted:Boolean(diagnostics.smartQuoteRecoveryAttempted),
      smartQuotesRecovered:repairs.includes(REPAIRS.STRUCTURAL_SMART_QUOTES),
      boundaryArtifactsRemoved:repairs.includes(REPAIRS.BOUNDARY_BOM)||repairs.includes(REPAIRS.BOUNDARY_INVISIBLE),
      normalizations:repairs.map(repair=>repair===REPAIRS.STRUCTURAL_SMART_QUOTES?'smart_quotes':repair),
      repairs:repairs.slice(),
      diagnostics:{...diagnostics}
    };
  }

  function failed(source,reason,repairs,diagnostics){
    const userMessage=USER_MESSAGES[reason]||USER_MESSAGES[REASONS.MALFORMED],input=legacyInput(source,repairs,{...diagnostics,finalParseFailureClass:reason});
    return {ok:false,normalizedText:null,repairs:repairs.slice(),reason,userMessage,diagnostics:input.diagnostics,input};
  }

  function preprocessStrictAiJson(raw){
    const source=typeof raw==='string'?raw:String(raw??''),diagnostics={originalParseFailed:false,smartQuoteRecoveryAttempted:false,finalParseFailureClass:null};
    if(!source)return failed(source,REASONS.EMPTY,[],diagnostics);
    try{
      JSON.parse(source);
      return {ok:true,normalizedText:source,repairs:[],reason:null,userMessage:'',diagnostics,input:legacyInput(source,[],diagnostics)};
    }catch(_error){diagnostics.originalParseFailed=true}

    const boundary=boundaryCleanup(source),repairs=boundary.repairs.slice();
    let candidate=boundary.text;
    if(!candidate)return failed(source,REASONS.EMPTY,repairs,diagnostics);
    if(boundary.repairs.length){
      try{
        JSON.parse(candidate);
        return {ok:true,normalizedText:candidate,repairs,reason:null,userMessage:'',diagnostics,input:legacyInput(source,repairs,diagnostics)};
      }catch(_error){}
    }

    const fence=wrappingFence(candidate);
    if(fence.matched){candidate=fence.text;repairs.push(REPAIRS.MARKDOWN_FENCE)}
    else if(candidate.includes('```'))return failed(source,REASONS.UNSUPPORTED_WRAPPER,repairs,diagnostics);
    try{
      JSON.parse(candidate);
      return {ok:true,normalizedText:candidate,repairs,reason:null,userMessage:'',diagnostics,input:legacyInput(source,repairs,diagnostics)};
    }catch(_error){}

    if(failureClass(candidate)===REASONS.UNSUPPORTED_WRAPPER)return failed(source,REASONS.UNSUPPORTED_WRAPPER,repairs,diagnostics);
    if(/[“”]/.test(candidate)){
      diagnostics.smartQuoteRecoveryAttempted=true;
      const recovered=recoverStructuralSmartQuotes(candidate);
      if(!recovered.ok)return failed(source,REASONS.AMBIGUOUS_SMART_QUOTES,repairs,diagnostics);
      if(recovered.replacements>0){
        try{
          JSON.parse(recovered.text);
          repairs.push(REPAIRS.STRUCTURAL_SMART_QUOTES);
          return {ok:true,normalizedText:recovered.text,repairs,reason:null,userMessage:'',diagnostics,input:legacyInput(source,repairs,diagnostics)};
        }catch(_error){
          const reason=failureClass(recovered.text);
          return failed(source,reason,repairs,diagnostics);
        }
      }
      return failed(source,failureClass(candidate),repairs,diagnostics);
    }
    return failed(source,failureClass(candidate),repairs,diagnostics);
  }

  function parseStrictAiJson(raw){
    const prepared=preprocessStrictAiJson(raw);
    if(!prepared.ok)return {...prepared,value:null,error:{code:'parse_error',type:'PARSE_ERROR',reason:prepared.userMessage,detailReason:prepared.reason}};
    const value=JSON.parse(prepared.normalizedText);
    return {...prepared,value,error:null};
  }

  function contractMessage(detail){
    return `JSON 已解析，但字段不符合导入要求：${String(detail||'字段校验失败').replace(/^字段校验错误：/,'')}`;
  }

  return {REPAIRS,REASONS,USER_MESSAGES,preprocessStrictAiJson,parseStrictAiJson,contractMessage};
});
