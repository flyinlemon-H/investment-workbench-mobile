'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const Clipboard=require('../src/clipboard.js');

function field(value=''){
  return {
    value,readOnly:false,style:{},attributes:{},parentNode:null,isConnected:false,
    focusCalls:0,selectCalls:0,range:null,removed:false,
    setAttribute(name,next){this.attributes[name]=next},
    focus(){this.focusCalls++},select(){this.selectCalls++},setSelectionRange(start,end){this.range=[start,end]},
    remove(){this.removed=true;if(this.parentNode){const index=this.parentNode.children.indexOf(this);if(index>=0)this.parentNode.children.splice(index,1)}this.parentNode=null;this.isConnected=false},
    scrollIntoView(){}
  };
}

function fakeDocument(execCommand){
  const body={children:[],appendChild(element){this.children.push(element);element.parentNode=this;element.isConnected=true;return element},removeChild(element){const index=this.children.indexOf(element);if(index>=0)this.children.splice(index,1);element.parentNode=null;element.isConnected=false}};
  return {body,documentElement:{contains:element=>Boolean(element&&element.isConnected)},createElement:()=>field(),execCommand};
}

test('modern Clipboard success is confirmed without invoking fallback',async()=>{
  let fallbackCalls=0,written='';
  const result=await Clipboard.copyTextWithFallback('latest',{navigator:{clipboard:{writeText:async text=>{written=text}}},document:fakeDocument(()=>{fallbackCalls++;return true}),manualCopy:false});
  assert.deepEqual(result,{ok:true,method:'clipboard'});assert.equal(written,'latest');assert.equal(fallbackCalls,0);
});

test('modern Clipboard unavailable falls back and accepts only true',async()=>{
  const doc=fakeDocument(()=>true),result=await Clipboard.copyTextWithFallback('request',{navigator:{},document:doc,manualCopy:false});
  assert.equal(result.ok,true);assert.equal(result.method,'execCommand');assert.equal(result.diagnostics[0].code,'unavailable');
});

test('modern Clipboard rejection preserves diagnostics and falls back',async()=>{
  const rejection=new Error('denied'),result=await Clipboard.copyTextWithFallback('request',{navigator:{clipboard:{writeText:async()=>{throw rejection}}},document:fakeDocument(()=>true),manualCopy:false});
  assert.equal(result.ok,true);assert.equal(result.method,'execCommand');assert.equal(result.diagnostics[0].error,rejection);
});

test('execCommand false is an explicit failure, never success',async()=>{
  const result=await Clipboard.copyTextWithFallback('request',{navigator:{},document:fakeDocument(()=>false),manualCopy:false});
  assert.equal(result.ok,false);assert.equal(result.method,undefined);assert.equal(result.diagnostics.at(-1).code,'returned_false');
});

test('execCommand exception is an explicit failure',async()=>{
  const failure=new Error('copy blocked'),result=await Clipboard.copyTextWithFallback('request',{navigator:{},document:fakeDocument(()=>{throw failure}),manualCopy:false});
  assert.equal(result.ok,false);assert.equal(result.error,failure);assert.equal(result.diagnostics.at(-1).code,'threw');
});

test('both methods failing returns ok false',async()=>{
  const result=await Clipboard.copyTextWithFallback('request',{navigator:{clipboard:{writeText:async()=>{throw new Error('denied')}}},document:fakeDocument(()=>false),manualCopy:false});
  assert.equal(result.ok,false);assert.deepEqual(result.diagnostics.map(item=>item.code),['rejected','returned_false']);
});

test('temporary textarea fallback attaches, selects, and removes',async()=>{
  let observed=null;const doc=fakeDocument(()=>{observed=doc.body.children[0];return true});
  const result=await Clipboard.copyTextWithFallback('prepared request',{navigator:{},document:doc,manualCopy:false});
  assert.equal(result.ok,true);assert.equal(observed.value,'prepared request');assert.ok(observed.focusCalls>0);assert.ok(observed.selectCalls>0);assert.deepEqual(observed.range,[0,16]);assert.equal(observed.removed,true);assert.equal(doc.body.children.length,0);
});

test('existing textarea stays reachable and selected after failure',async()=>{
  const doc=fakeDocument(()=>false),existing=field('old'),details={open:false};doc.body.appendChild(existing);
  const result=await Clipboard.copyTextWithFallback('current visible request',{navigator:{},document:doc,selectableElement:existing,detailsElement:details,manualCopy:false});
  assert.equal(result.ok,false);assert.equal(existing.value,'current visible request');assert.equal(details.open,true);assert.equal(existing.removed,false);assert.ok(existing.selectCalls>=2);
});

test('all production copy plumbing is centralized and false success is removed',()=>{
  const root=path.resolve(__dirname,'..'),files=['multi-stock-analysis.js','portfolio-review-ui.js','plan-review-ui.js','ui-render.js'],sources=files.map(name=>fs.readFileSync(path.join(root,'src',name),'utf8'));
  for(const source of sources){assert.doesNotMatch(source,/navigator\.clipboard/);assert.doesNotMatch(source,/execCommand\s*\(/)}
  assert.match(fs.readFileSync(path.join(root,'src/clipboard.js'),'utf8'),/execCommand\('copy'\)!==true/);
  assert.ok(sources.every(source=>source.includes('ClipboardUtils.copyTextWithFallback')||source.includes('copyText(')));
});

test('dedicated AI workflows use prepared visible requests and shared feedback semantics',()=>{
  const root=path.resolve(__dirname,'..'),portfolio=fs.readFileSync(path.join(root,'src/portfolio-review-ui.js'),'utf8'),plan=fs.readFileSync(path.join(root,'src/plan-review-ui.js'),'utf8'),technical=fs.readFileSync(path.join(root,'src/multi-stock-analysis.js'),'utf8');
  assert.match(portfolio,/copyCompressionRequest\(\).*m05cCompressionRequestText.*\.value\|\|''\)\|\|generateCompressionRequest\(\)/);
  assert.match(portfolio,/copyRequest\(\).*m05cRequestText.*\.value\|\|''\)\|\|generateRequest\(\)/);
  assert.match(plan,/copyRequest\(\).*planReviewRequestText.*\.value\|\|''\)\|\|generateRequest\(\)/);
  assert.match(technical,/copyRequest\(\)[\s\S]*multiStockRequestText[\s\S]*\.value\|\|''\)\|\|generateRequest\(\)/);
  for(const source of [portfolio,plan,technical]){assert.match(source,/复制失败，请长按复制/);assert.match(source,/已复制 ✓/)}
});

test('generic prompt modals and Plan refresh pass their visible textarea to the helper',()=>{
  const ui=fs.readFileSync(path.resolve(__dirname,'../src/ui-render.js'),'utf8');
  for(const id of ['aiAnalysisPromptText','aiAssistantPrompt','unifiedPromptPreview','reviewPackagePreview','v13PlanRefreshPromptText'])assert.match(ui,new RegExp(`selectableElement:[^}]*${id}|${id}[\\s\\S]{0,180}selectableElement`));
  assert.match(ui,/async function copyText[\s\S]*ClipboardUtils\.copyTextWithFallback/);
  assert.match(ui,/alert\(result\.ok\?okMsg:'复制失败，请长按复制'\)/);
});

test('Plan-update metadata is prepared before a separate direct copy action',()=>{
  const ui=fs.readFileSync(path.resolve(__dirname,'../src/ui-render.js'),'utf8'),prepare=ui.slice(ui.indexOf('async function generatePlanUpdatePromptForStock'),ui.indexOf('function ensurePlanUpdateDraftImportModal'));
  assert.match(ui,/准备计划更新Prompt/);assert.match(ui,/planUpdatePromptCopy.*copyPreparedPlanUpdatePrompt/);
  assert.match(prepare,/snapshotHash[\s\S]*savePromptMeta[\s\S]*planUpdatePromptText/);
  assert.doesNotMatch(prepare,/copyText\(/);
  assert.match(ui,/async function copyPreparedPlanUpdatePrompt\(\)[\s\S]*copyText\(field\.value[\s\S]*selectableElement:field/);
});

test('clipboard change does not introduce state writes or touch protected bridges',()=>{
  const root=path.resolve(__dirname,'..'),helper=fs.readFileSync(path.join(root,'src/clipboard.js'),'utf8');
  assert.doesNotMatch(helper,/saveState|PlanReview|portfolioReview|decisionCompression|holdings|market_data_bridge/);
  const html=fs.readFileSync(path.join(root,'index.html'),'utf8'),clipboardIndex=html.indexOf('src/clipboard.js'),uiIndex=html.indexOf('src/ui-render.js'),multiIndex=html.indexOf('src/multi-stock-analysis.js');
  assert.ok(clipboardIndex>0&&clipboardIndex<uiIndex&&clipboardIndex<multiIndex);
});
