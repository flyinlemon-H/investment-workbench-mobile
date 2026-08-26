'use strict';

const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const test=require('node:test');
const {spawnSync}=require('node:child_process');
const Universe=require('../src/universe-handoff.js');

function write(file,content){fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,content,'utf8')}
function bridgePayload(file){return JSON.parse(fs.readFileSync(file,'utf8').split(' = ',2)[1].replace(/;\s*$/,''))}

test('isolated mobile -> inbox -> PC registry/update/bridge -> mobile acknowledgement is add-only and replay-safe',async()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'mobile-universe-e2e-'));
  try{
    const source=path.join(root,'source');
    const workbench=path.join(root,'workbench');
    const inbox=path.join(root,'investment-workbench-mobile-sync','inbox');
    const formal=path.join(source,'data','latest_export.json');
    const registry=path.join(root,'investment-workbench-mobile-sync','market_universe.json');
    const bridge=path.join(workbench,'data','market_data_bridge.js');
    const existing=Array.from({length:19},(_,index)=>({id:`held-${index}`,code:`${600000+index}.SS`,shares:index+1,avgCost:index+8,plans:[{price:index+7}]}));
    write(formal,`${JSON.stringify({stocks:existing},null,2)}\n`);
    write(path.join(source,'src','__init__.py'),'');
    write(path.join(source,'src','market_data','__init__.py'),'');
    write(path.join(source,'src','market_data','updater.py'),[
      'def update_market_data(state, *, symbols=None):',
      '    rows=[]',
      '    for stock in state["stocks"]:',
      '        symbol=stock["code"]',
      '        stock["priceHistory"]=[{"date":"2026-08-25","open":10.0,"high":11.0,"low":9.0,"close":10.5,"volume":1000.0,"adjustment":"qfq","price_basis":"adjusted","provider":"fixture","fetched_at":"2026-08-26T09:00:00Z","is_complete_bar":True}]',
      '        stock["marketDataFreshness"]={"last_trade_date":"2026-08-25","fetched_at":"2026-08-26T09:00:00Z","provider":"fixture","is_complete_bar":True,"kline_status":"current","technical_analysis_updated_at":"","technical_analysis_stale":True,"provider_errors":[]}',
      '        stock["technicalIndicators"]={"updated_at":"2026-08-26T09:00:00Z","last_trade_date":"2026-08-25","ma5":10.5,"ma10":None,"ma20":None,"ma60":None,"macd":{"dif":None,"dea":None,"histogram":None},"volume_change":{"recent_5d_average":None,"previous_5d_average":None,"change_pct":None}}',
      '        rows.append({"symbol":symbol,"success":True,"added":1,"provider":"fixture","current_last_date":"","latest_trade_date":"2026-08-25","error":"","technical_analysis_stale":True})',
      '    return rows',
      ''
    ].join('\n'));

    const mobile={stocks:[{id:'mobile-new',name:'腾讯',code:'700.hk',shares:0,avgCost:'',plans:[]}]};
    Universe.reconcileState(mobile,{stocks:[]},{now:'2026-08-26T09:00:00.000Z'});
    assert.deepEqual(mobile.universeSync.pendingSymbols,['0700.HK']);
    const manifest=await Universe.buildManifest(mobile,{now:'2026-08-26T09:00:00.000Z'});
    write(path.join(inbox,Universe.manifestFilename(manifest)),`${JSON.stringify(manifest,null,2)}\n`);

    const args=['scripts/update_market_universe.py','--source-root',source,'--workbench-root',workbench,'--inbox',inbox];
    const first=spawnSync('python',args,{cwd:path.resolve(__dirname,'..'),encoding:'utf8'});
    assert.equal(first.status,0,`${first.stdout}\n${first.stderr}`);
    assert.match(first.stdout,/manifestStatus: accepted/);
    assert.match(first.stdout,/newlyAdded: 1/);
    assert.match(first.stdout,/symbols: 20/);
    const stored=JSON.parse(fs.readFileSync(registry,'utf8'));
    assert.equal(stored.symbols.length,1);
    assert.equal(stored.symbols[0].symbol,'0700.HK');
    for(const field of ['shares','avgCost','plans','allocation','aiReviews'])assert.equal(field in stored.symbols[0],false);
    const delivered=bridgePayload(bridge);
    assert.equal(delivered.stocks.length,20);
    assert(delivered.stocks.some(stock=>stock.symbol==='0700.HK'));
    assert.equal(JSON.parse(fs.readFileSync(formal,'utf8')).stocks.length,19);

    Universe.reconcileState(mobile,delivered,{now:'2026-08-26T10:00:00.000Z'});
    assert.deepEqual(mobile.universeSync.pendingSymbols,[]);

    const replay=spawnSync('python',args,{cwd:path.resolve(__dirname,'..'),encoding:'utf8'});
    assert.equal(replay.status,0,`${replay.stdout}\n${replay.stderr}`);
    assert.match(replay.stdout,/newlyAdded: 0/);
    assert.match(replay.stdout,/alreadyKnown: 1/);
    assert.equal(JSON.parse(fs.readFileSync(registry,'utf8')).symbols.length,1);
    assert.equal(bridgePayload(bridge).stocks.length,20);
  }finally{fs.rmSync(root,{recursive:true,force:true})}
});
