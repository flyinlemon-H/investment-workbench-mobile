"""Opt-in daily receipt protocol. A policy verdict alone never authorizes a write."""
import copy
from datetime import datetime, timezone
import hashlib
import uuid
from . import canonical as K, daily_policy as P, evidence as E, revision as R, precision_audit as A

VERSION = 'bounded-daily-revision-v1'
BAR_FIELDS = ('date','open','high','low','close','volume','amount','provider','adjustment','price_basis','is_complete_bar')
TECH_FIELDS = ('price','technicalAsOf','ma5','ma10','ma20','ma60','ma120','macd','supportPrice','resistancePrice','volume','volumeAvg20','volumeChangePct')

class ReviewRequired(ValueError):
    def __init__(self, reason, evidence):
        super().__init__(reason)
        self.review_evidence=evidence

def bars(rows):
    return [{k:r.get(k) for k in BAR_FIELDS} for r in rows]

def identity(bundle):
    m=bundle['marketDataFreshness']
    return K.digest(dict(bars=bars(bundle['priceHistory']),sourceContract=m['sourceContract'],
        contentVersion=m.get('dataContentVersion'),technicalVersion=m.get('technicalVersion'),
        technical={k:bundle['technicalData'].get(k) for k in TECH_FIELDS}))

def observation(raw, asof):
    return dict(id=str(uuid.uuid4()),asOf=asof,raw=raw,rawHash=hashlib.sha256(raw.encode()).hexdigest())

def rows_from(o):
    t=A.trace(o['raw'].encode(),o['asOf'])
    if t['symbol']!='2899.HK' or t['rawHash']!=o['rawHash']:raise ValueError('RAW_OUTPUT_MISMATCH')
    return [dict(date=day,**{k:float(v['fields'][k]['production']) for k in A.PRICE},
        volume=None if v['volume'] is None else int(v['volume']),amount=None,provider='yahoo',
        adjustment='qfq',price_basis='adjusted',is_complete_bar=True) for day,v in t['rows'].items()]

def build(context, task, first, repeat):
    if context.get('protocol')!=VERSION or context.get('symbol')!='2899.HK' or not context.get('enabled'):
        raise ValueError('DAILY_POLICY_DISABLED')
    old=context['bundle']; old_contract=old['marketDataFreshness']['sourceContract']
    if K.facts_hash(old)!=context['bundleHash'] or identity(old)!=context['identityHash']:
        raise ValueError('DAILY_BASELINE_INVALID')
    new=rows_from(first); contract=copy.deepcopy(old_contract)
    contract['historyWindow']=dict(start=new[0]['date'],end=new[-1]['date'])
    _,blockers=E.units_gate(contract,old['priceHistory'],{},R.inspect(old['priceHistory'],new,contract,old_contract)['comparison'],new)
    if blockers:raise ValueError('UNIT_CONTRACT_INCOMPLETE')
    prior=context['observation']
    decision=P.evaluate(old['priceHistory'],new,old_contract,contract,old_raw=prior['raw'].encode(),new_raw=first['raw'].encode(),
        old_asof=prior['asOf'],new_asof=first['asOf'],repeat_raw=repeat['raw'].encode(),repeat_asof=repeat['asOf'],
        expected_version=context['versionId'],current_version=context['versionId'])
    if decision['tier']=='REVIEW_REQUIRED':raise ValueError(decision['reason'])
    preview=R.technical_preview(new,contract)
    content=K.digest(dict(bars=bars(new),sourceContract=contract))
    technical=K.digest(dict(contentHash=content,technical=preview))
    versions=dict(dataVersion=content,dataContentVersion=content,technicalVersion=technical,latestCompleteBar=new[-1]['date'])
    ind={**preview['indicators'],**versions, 'updated_at':first['asOf']}
    td={**preview['technicalData'],**versions,'technicalDataStatus':'fresh','dataQuality':'validated'}
    meta=dict(provider='yahoo',sourceContract=contract,fetched_at=first['asOf'],last_trade_date=new[-1]['date'],
        kline_status='current',is_complete_bar=True,technical_analysis_stale=False,revisionStatus='audited_daily',
        dailyProtocol=VERSION,resultVersion=task['taskId'],**versions)
    if old['marketDataFreshness'].get('sourceMigration'):
        meta['sourceMigration']=copy.deepcopy(old['marketDataFreshness']['sourceMigration'])
    bundle=dict(priceHistory=new,technicalIndicators=ind,technicalData=td,marketDataFreshness=meta)
    return dict(protocol=VERSION,policyVersion=P.VERSION,taskId=task['taskId'],expectedVersion=context['versionId'],
        expectedGeneration=context['generation'],expectedHash=context['bundleHash'],observation=first,
        repeat=repeat,bundle=bundle,bundleHash=K.facts_hash(bundle))

def collect(context, task):
    from .fetch import fetch
    from zoneinfo import ZoneInfo
    start=context['bundle']['priceHistory'][0]['date'];end=datetime.now(ZoneInfo('Asia/Hong_Kong')).date().isoformat()
    observed=[]
    for _ in range(2):
        captured=[]
        _,evidence,_=fetch('yahoo','2899.HK',start,end,audit_sink=captured.append)
        if not evidence['adjustmentConfirmed']:raise ValueError('SOURCE_CONTRACT_MISMATCH')
        observed.append(observation(captured[0].decode('utf-8'),evidence['fetchedAt']))
    try:return build(context,task,*observed)
    except ValueError as error:
        raise ReviewRequired(str(error),dict(protocol=VERSION,taskId=task['taskId'],symbol='2899.HK',
            expectedVersion=context['versionId'],expectedHash=context['bundleHash'],
            observations=observed,status='review_required',automaticApproval=False)) from None
