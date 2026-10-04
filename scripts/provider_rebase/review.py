"""Offline review artifact. Buttons never approve or mutate a candidate."""
from html import escape
import json
from pathlib import Path
from .core import verify

def summary(c):
    verify(c)
    return dict(symbol=c['symbol'],provider=c['sourceContract']['canonicalProvider'],
        oldProviders=c['oldSummary'].get('providers', c['oldSummary'].get('providerCounts')),
        newHistory='single-source',firstDate=c['stock']['priceHistory'][0]['date'],lastDate=c['stock']['priceHistory'][-1]['date'],
        barCount=c['barCount'],migrationType=c['type'],revisionCategories=c.get('revisionCategories',[]),
        priceEvidence=c.get('corporateActionEvidence',[]),volumeEvidence=c.get('volumeValidation',{}),
        technicalDiff=c['technicalDiffSummary'],warnings=c['warnings'],blockers=c['blockers'],
        candidateHash=c['candidateHash'],contentHash=c['contentHash'],approvalPackageHash=c['approvalPackageHash'],
        approvalStatus=c['approvalStatus'],readyForApproval=not c['blockers'],applyExecuted=False,
        rollback='versioned archive and atomic pointer rollback; isolated simulation required before release')

def export_review(c, output):
    data=summary(c);output=Path(output);output.mkdir(parents=True,exist_ok=True)
    (output/'approval-summary.json').write_text(json.dumps(data,ensure_ascii=False,indent=2),encoding='utf-8')
    e=lambda x:escape(str(x),quote=True)
    labels={'writer_deployment_not_confirmed':'生产 Web 写入守卫待发布：JSON 导入、CSV 导入、行情桥接读入、远端结果读入。', 'old_AI_judgments_need_review':'旧 AI 判断保留，迁移后需要用户重新评审。', 'history_source_changed':'本候选将历史来源改为单一来源。', 'no_automatic_approval':'不会自动审批或 Apply。', 'amount_not_comparable':'成交额不可比；Yahoo chart 不提供该字段。', 'mixed_baseline_requires_provider_selection':'旧历史存在混源；目标来源已由用户确认。', 'KNOWN_PROVIDER_INCONSISTENCY':'未使用的 provider meta 成交量与历史 K 不一致；历史 K 已经 HKEX 对照。'}
    blockers=''.join('<li>'+e(labels.get(x,x))+'</li>' for x in c['blockers']) or '<li>无数据验证阻塞；仍需要用户明确批准。</li>'
    warnings=''.join('<li>'+e(labels.get(x,x))+'</li>' for x in c['warnings'])
    def display(value):
        if isinstance(value,dict) and 'dif' in value:return '\n'.join(k+': '+str(value[v]) for k,v in [('DIF','dif'),('DEA','dea'),('柱','histogram')])
        if isinstance(value,list):return '\n'.join({'price_below_ma20':'价格低于 MA20','ma5_below_ma20':'MA5 低于 MA20','macd_below_signal':'MACD 低于信号线'}.get(v,str(v)) for v in value)
        return str(value)
    old_label=' + '.join(p.title()+' '+str(n)+' 根' for p,n in (data['oldProviders'] or {}).items())
    rows=''.join('<tr><th>'+e(k)+'</th><td>'+e(display(v['before'].get(k2)))+'</td><td>'+e(display(v['after'].get(k2)))+'</td></tr>'
        for k,k2 in [('MA5','ma5'),('MA10','ma10'),('MA20','ma20'),('MA60','ma60'),('MA120','ma120'),('MACD','macd'),('支撑','supportPrice'),('阻力','resistancePrice'),('成交量','volume'),('20日均量','volumeAvg20'),('量变化%','volumeChangePct'),('风险事实','programRiskFlags')]
        for v in [c['technicalDiffSummary']['technicalData']])
    hashes=''.join('<p><strong>'+e(k)+'</strong><code>'+e(c[k])+'</code></p>' for k in ('candidateHash','contentHash','approvalPackageHash'))
    phrase='Approve candidate '+c['candidateHash']
    disabled=' disabled' if c['blockers'] else ''
    document='''<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>行情候选审阅</title>
<style>body{margin:0;background:#f2f4f8;color:#17212e;font:16px/1.6 system-ui,sans-serif}main{max-width:1000px;margin:auto;padding:20px}section{background:white;border-radius:12px;padding:18px;margin:16px 0}h1{font-size:24px}h2{font-size:19px}code,td,li{overflow-wrap:anywhere}td{white-space:pre-line}code{display:block;font-size:12px}table{width:100%;border-collapse:collapse;table-layout:fixed}td,th{padding:8px;text-align:left;border-bottom:1px solid #ddd;font-size:13px}button{padding:12px;margin:6px 0;max-width:100%;font-size:15px}button:disabled{opacity:.5}textarea{box-sizing:border-box;width:100%;min-height:100px}strong{color:#244b77}@media(max-width:420px){main{padding:10px}section{padding:12px}td,th{padding:5px;font-size:12px}}</style>
<main><h1>'''+e(c['symbol'])+''' · 行情候选审阅</h1><p>目标来源：'''+e(data['provider'].title())+'''。当前历史 '''+e(old_label)+'''；新历史为单一来源。</p>
<section><h2>候选范围</h2><p>'''+e(data['firstDate'])+' → '+e(data['lastDate'])+'，'+e(c['barCount'])+''' 根完整日K。</p><p>价格修订：股息再调整证据已附；成交量：以历史K字段和交易所对照为准。供应商meta差异单独保留。</p><p>正式数据尚未修改。AI判断 needs_review；历史Discussion保持。</p></section>
<section><h2>旧基线重算与新候选</h2><p>旧基线为 mixed 来源，以下仅为确定性数值比较。</p><table><thead><tr><th>事实</th><th>旧</th><th>新</th></tr></thead><tbody>'''+rows+'''</tbody></table></section>
<section><h2>阻塞项</h2><ul>'''+blockers+'''</ul><h2>已知限制</h2><ul>'''+warnings+'''</ul><p>未实现的价格行为/量价分类器保持 NOT_AVAILABLE，不补造判断。回滚使用旧版本归档与原子指针；生产交付有独立门禁。</p></section>
<section><h2>审批绑定</h2>'''+hashes+'''<p>这是离线审阅包。按钮只显示需用户明确执行的审批短语，不会创建审批或执行Apply。</p><button id="approve"'''+disabled+'''>Approve · 显示审批短语</button> <button id="keep">Reject / Keep Current · 保持现状</button><textarea id="instruction" readonly aria-label="用户操作说明"></textarea></section></main>
<script>const phrase='''+json.dumps(phrase)+''';document.getElementById('approve').onclick=()=>{document.getElementById('instruction').value=phrase+'\\n仍需独立的显式Apply授权；此页面不会修改任何数据。'};document.getElementById('keep').onclick=()=>{document.getElementById('instruction').value='保持当前正式历史；未创建审批、未执行Apply。'};</script></html>'''
    (output/'index.html').write_text(document,encoding='utf-8')
    return dict(path=str((output/'index.html').resolve()),readyForApproval=data['readyForApproval'],candidateHash=c['candidateHash'])
