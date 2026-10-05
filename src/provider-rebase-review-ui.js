(function(root){
 'use strict';
 const doc=root.document;let current=null;
 const element=(tag,text)=>{const e=doc.createElement(tag);if(text!==undefined)e.textContent=String(text);return e};
 const format=value=>value==null?'不可用':typeof value==='object'?JSON.stringify(value):String(value);
 function render(c){
  if(!c||c.schemaVersion<3||typeof c.symbol!=='string'||!Array.isArray(c.stock?.priceHistory)||!c.stock.priceHistory.length||!Array.isArray(c.blockers)||!Array.isArray(c.warnings)||!c.sourceContract||!c.technicalBefore||!c.technicalPreview||['candidateHash','contentHash','approvalPackageHash'].some(k=>!/^[a-f0-9]{64}$/.test(c[k])))throw Error('候选格式或必需字段不完整；未载入。');
  const container=doc.getElementById('review-content');container.replaceChildren();
  const section=title=>{const s=element('section');s.append(element('h2',title));container.append(s);return s};
  const rows=c.stock.priceHistory,overview=section(c.symbol+' · '+c.sourceContract.canonicalProvider+' 单一来源');
  overview.append(element('p','当前历史：'+Object.entries(c.oldSummary.providerCounts).map(([p,n])=>p+' '+n+' 根').join(' + ')),element('p',rows[0].date+' → '+rows.at(-1).date+'，'+rows.length+' 根完整日 K。'),element('p','迁移原因：旧历史存在混源或同源历史修订，需用一致来源完整重建。'));
  const price=section('价格修订与成交量证据');
  for(const e of c.eventFactors||[])price.append(element('p','股息日期 '+e.event.date+'；预期系数 '+e.expectedFactor+'；观测系数 '+e.observedFactor+'。这是历史再调整的支持证据。'));
  price.append(element('p','成交量验证：'+c.volumeValidation?.status+'；未验证变更日期 '+(c.volumeValidation?.unvalidatedDates||[]).length+'。'));
  for(const r of c.evidence?.volumeValidation?.records||[])price.append(element('p',r.date+'：候选 '+r.candidateValue+' 股；交易所 '+r.exchangeValue+' 股。'));
  const technical=section('旧基线重算 → 新候选'),table=element('table');
  const header=element('tr');for(const t of ['技术事实','旧','新'])header.append(element('th',t));table.append(header);
  for(const [key,label] of [['ma5','MA5'],['ma10','MA10'],['ma20','MA20'],['ma60','MA60'],['ma120','MA120'],['macd','MACD'],['volume','成交量'],['volumeAvg20','20日均量'],['volumeChangePct','量变化%'],['supportPrice','支撑'],['resistancePrice','阻力'],['programRiskFlags','风险事实']]){
   const tr=element('tr');tr.append(element('th',label),element('td',format(c.technicalBefore.technicalData[key])),element('td',format(c.technicalPreview.technicalData[key])));table.append(tr);
  }
  technical.append(table,element('p','AI 判断 needs_review；历史 Discussion 正文不变；正式 freshness 不随候选前移。'));
  const warnings=section('门禁与限制');warnings.append(element('p',c.blockers.length?'阻塞：'+c.blockers.join('；'):'无候选硬阻塞；仍需用户明确批准具体 hash。'),element('p','已知限制：'+c.warnings.join('；')),element('p','未实现指标：'+(c.technicalValidation?.unsupported||[]).join('；')),element('p','回滚：使用完整旧版本归档和原子指针；审批包附隔离验证结果。'));
  const hashes=section('审批绑定');for(const k of ['candidateHash','contentHash','approvalPackageHash'])hashes.append(element('strong',k),element('code',c[k]));
  const deployment=c.evidence?.productionDeployment;if(deployment)hashes.append(element('p','生产守卫部署：'+deployment.commit+' / '+deployment.assetVersion));
  current=c;root.ProviderMigrationReviewActions?.loaded(c);doc.getElementById('review-approve').disabled=c.blockers.length>0;doc.getElementById('review-message').textContent='已载入本地候选。摘要不替代执行端的 hash 与审批校验。';
 }
 doc.getElementById('candidate-file').addEventListener('change',async event=>{
  current=null;doc.getElementById('review-approve').disabled=true;doc.getElementById('review-content').replaceChildren();doc.getElementById('review-instruction').value='';
  try{const file=event.target.files?.[0];if(!file)return;if(file.size>8*1024*1024)throw Error('候选文件过大。');render(JSON.parse(await file.text()))}catch(error){doc.getElementById('review-message').textContent=error.message||'候选读取失败。'}
 });
 doc.getElementById('review-approve').addEventListener('click',()=>{if(!current||current.blockers.length)return;doc.getElementById('review-instruction').value='Approve candidate '+current.candidateHash+'\napprovalPackageHash '+current.approvalPackageHash+'\n此页面未保存审批，也未执行 Apply。'});
 doc.getElementById('review-keep').addEventListener('click',()=>{doc.getElementById('review-instruction').value='保持当前正式历史；未创建审批，未执行 Apply。'});
 root.ProviderRebaseReview={render};
})(window);
