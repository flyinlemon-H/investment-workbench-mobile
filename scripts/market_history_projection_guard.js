'use strict';

// Files are projections of full-window engine results. This never approves a
// migration; rewritten historical facts must use the explicit Rebase delivery.
function assertProjection(stock,previous){
  const meta=stock.marketDataFreshness||{},contract=meta.sourceContract,receipt=meta.historyWriteGuard;
  const rows=stock.priceHistory||[],fail=code=>{throw Error(code)};
  if(!contract||!receipt||receipt.version!=='provider-revision-engine-v1'||receipt.classification!=='STABLE'||!meta.dataContentVersion||receipt.contentHash!==meta.dataContentVersion)fail('UNSAFE_WRITE_PATH_BLOCKED');
  if(contract.symbol!==stock.symbol||contract.normalizationVersion!=='python-round-6-v1'||contract.adjustment!=='qfq'||contract.priceBasis!=='adjusted'||!contract.providerVersion)fail('SOURCE_CONTRACT_MISMATCH');
  if(!rows.length||rows.some(r=>r.provider!==contract.canonicalProvider||r.adjustment!=='qfq'||r.price_basis!=='adjusted'||r.is_complete_bar!==true))fail('SOURCE_CONTRACT_MISMATCH');
  if(contract.historyWindow?.start!==rows[0].date||contract.historyWindow?.end!==rows.at(-1).date)fail('SOURCE_CONTRACT_MISMATCH');
  if(!meta.technicalVersion||[stock.technicalData,stock.technicalIndicators].some(x=>x?.dataContentVersion!==meta.dataContentVersion||x?.technicalVersion!==meta.technicalVersion))fail('VERSION_CONFLICT');
  if(stock.technicalData.technicalAsOf!==rows.at(-1).date||stock.technicalData.latestCompleteBar!==rows.at(-1).date)fail('VERSION_CONFLICT');
  if(!previous)return;
  const old=previous.priceHistory||[],prior=previous.marketDataFreshness?.sourceContract;
  if(prior&&['canonicalProvider','providerVersion','adjustment','priceBasis','normalizationVersion'].some(k=>prior[k]!==contract[k]))fail('SOURCE_CONTRACT_MISMATCH');
  if(new Set(old.map(r=>r.provider)).size>1)fail('PROVIDER_REBASE_REQUIRED');
  if(old.some(r=>r.provider!==contract.canonicalProvider))fail('PROVIDER_SWITCH');
  const oldDates=new Set(old.map(r=>r.date)),oldLast=old.map(r=>r.date).sort().at(-1);
  if(rows.some(r=>oldLast&&r.date<=oldLast&&!oldDates.has(r.date)))fail('SAME_PROVIDER_REVISION');
  const index=new Map(rows.map(r=>[r.date,r])),fields=['open','high','low','close','volume','amount','provider','adjustment','price_basis','is_complete_bar'];
  if(old.some(r=>!index.has(r.date)||fields.some(k=>(r[k]??null)!==(index.get(r.date)[k]??null))))fail('SAME_PROVIDER_REVISION');
  if(Number(previous.marketDataFreshness?.sourceMigration?.generation||0)>Number(meta.sourceMigration?.generation||0))fail('VERSION_CONFLICT');
}
module.exports={assertProjection};
