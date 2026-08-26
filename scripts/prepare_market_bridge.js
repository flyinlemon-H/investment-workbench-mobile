'use strict';

const fs=require('node:fs');
const path=require('node:path');
const {readAssignment}=require('./publish_market_bridges');

function fail(message){throw new Error(message);}

function prepareMarketBridge(content){
  const bridge=readAssignment(content,'MARKET_DATA_BRIDGE');
  if(!Array.isArray(bridge.stocks)||!bridge.stocks.length)fail('Market bridge has no stocks.');
  let removedBars=0;
  const stocks=bridge.stocks.map(stock=>{
    const symbol=String(stock&&stock.symbol||'').trim()||'<unknown>';
    const history=Array.isArray(stock&&stock.priceHistory)?stock.priceHistory:[];
    const complete=history.filter(bar=>bar&&bar.is_complete_bar===true);
    removedBars+=history.length-complete.length;
    if(!complete.length)fail(`${symbol} has no complete daily bars.`);
    const latestDate=String(complete.at(-1).date||'');
    if(stock.marketDataFreshness?.last_trade_date!==latestDate){
      fail(`${symbol} freshness date conflicts with the latest complete bar.`);
    }
    if(stock.technicalIndicators?.last_trade_date!==latestDate){
      fail(`${symbol} indicator date conflicts with the latest complete bar.`);
    }
    return {...stock,priceHistory:complete};
  });
  return {content:`window.MARKET_DATA_BRIDGE = ${JSON.stringify({...bridge,stocks})};\n`,removedBars,latestDate:stocks.map(stock=>stock.priceHistory.at(-1).date).sort().at(-1),symbolCount:stocks.length};
}

function writePreparedBridge(bridgePath){
  const fullPath=path.resolve(bridgePath);
  const prepared=prepareMarketBridge(fs.readFileSync(fullPath,'utf8'));
  const temporary=`${fullPath}.${process.pid}.tmp`;
  try{
    fs.writeFileSync(temporary,prepared.content,'utf8');
    fs.renameSync(temporary,fullPath);
  }finally{
    if(fs.existsSync(temporary))fs.rmSync(temporary,{force:true});
  }
  return {bridgePath:fullPath,removedBars:prepared.removedBars,latestDate:prepared.latestDate,symbolCount:prepared.symbolCount};
}

function parseArgs(argv){
  const index=argv.indexOf('--bridge-path');
  if(index<0||!argv[index+1])fail('Missing --bridge-path.');
  return {bridgePath:argv[index+1]};
}

if(require.main===module){
  try{process.stdout.write(`${JSON.stringify(writePreparedBridge(parseArgs(process.argv.slice(2)).bridgePath))}\n`);}
  catch(error){process.stderr.write(`marketBridgePreparationStatus: failed\nmarketBridgePreparationError: ${error.message}\n`);process.exitCode=1;}
}

module.exports={prepareMarketBridge,writePreparedBridge};
