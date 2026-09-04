'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const path=require('node:path');
const {spawnSync}=require('node:child_process');
const Workflow=require('../src/long-term-logic-workflow.js');

const root=path.resolve(__dirname,'..');
const python=[
  'import importlib.util, pathlib, sys',
  'path = pathlib.Path("pc-ai-bridge/bridge.py").resolve()',
  'spec = importlib.util.spec_from_file_location("pc_ai_bridge_contract_test", path)',
  'module = importlib.util.module_from_spec(spec)',
  'sys.modules[spec.name] = module',
  'spec.loader.exec_module(module)',
  'print(module.DeterministicMockProvider().complete(sys.stdin.read()).content)'
].join('; ');

test('Python deterministic mock is accepted by the browser Slim V2 contract',()=>{
  const stock={
    id:'fixture-stock',name:'工业富联',code:'601138.SS',symbol:'601138.SS',
    type:'holding',role:'成长仓',theme:'AI算力',plans:[],dataFreshness:{},
    longTermLogic:{investmentThesis:'旧逻辑',coreDrivers:['旧驱动'],longTermRisks:['旧风险'],logicStatus:'valid',confidence:'medium'}
  };
  const prepared=Workflow.prepare(stock,{promptDate:'2026-09-05'});
  const result=spawnSync('python',['-B','-c',python],{
    cwd:root,
    input:prepared.prompt,
    encoding:'utf8',
    env:{...process.env,PYTHONUTF8:'1',PYTHONIOENCODING:'utf-8'}
  });
  assert.equal(result.status,0,result.stderr);
  const parsed=JSON.parse(result.stdout);
  assert.deepEqual(Object.keys(parsed.longTermLogic).sort(),[
    'confidence','coreDrivers','investmentThesis','keyRisks','logicStatus','nextReviewDate','reviewTriggers'
  ]);
  const processed=Workflow.processPrepared(result.stdout,prepared);
  assert.equal(processed.ok,true,processed.message);
  assert.equal(processed.previewReady,true);
  assert.deepEqual(processed.logic,parsed.longTermLogic);
});
