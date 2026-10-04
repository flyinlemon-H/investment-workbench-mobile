"""Pure validation, comparisons and candidate construction. No I/O."""
from __future__ import annotations
import copy
from datetime import date
from decimal import Decimal
import hashlib
import json
import math
import re

VERSION = 'provider-continuity-rebase-v1'
FIELDS = ('priceHistory','technicalIndicators','technicalData','marketDataFreshness')
REGISTRY = {p: dict(providerId=p,canonicalProviderId=p,displayName=label,marketSupport=['CN','HK'],
    dailyHistorySupport=True,adjustmentSupport=['qfq'],priceBasisSupport=['adjusted'],
    rebaseSupported=True,incrementalSupported=True,fallbackRole='diagnostics_only',aliases=[])
    for p,label in [('eastmoney','东方财富'),('yahoo','Yahoo')]}

def encoded(value):
    return json.dumps(value,sort_keys=True,separators=(',',':'),ensure_ascii=False,allow_nan=False).encode('utf-8')

def digest(value): return hashlib.sha256(encoded(value)).hexdigest()

def symbol(value):
    if not isinstance(value,str) or not re.fullmatch(r'(?:\d{6}\.(?:SS|SZ)|\d{4,5}\.HK)',value):
        raise ValueError('invalid_symbol')
    return value

def facts(stock):
    return {k:copy.deepcopy(stock.get(k,[] if k=='priceHistory' else {})) for k in FIELDS}

def analyze(rows):
    counts,segments={},[]
    for row in rows:
        p=row.get('rawProviderId',row.get('provider'))
        counts[p or 'MISSING']=counts.get(p or 'MISSING',0)+1
        if not segments or segments[-1]['provider']!=p:
            segments.append(dict(provider=p,start=row.get('date'),end=row.get('date'),count=1))
        else:segments[-1]['end']=row.get('date');segments[-1]['count']+=1
    switches=max(len(segments)-1,0);dates=[r.get('date') for r in rows]
    if 'MISSING' in counts:category='PROVIDER_METADATA_MISSING'
    elif len(dates)!=len(set(dates)):category='MIXED_WITHIN_SAME_PERIOD'
    elif len(counts)==1:category={'eastmoney':'PURE_EASTMONEY','yahoo':'PURE_YAHOO'}.get(next(iter(counts)),'OTHER')
    elif switches>1:category='MULTIPLE_PROVIDER_SWITCHES'
    elif segments and segments[0]['provider']=='eastmoney':category='EASTMONEY_TO_YAHOO'
    else:category='YAHOO_TO_EASTMONEY' if rows else 'OTHER'
    return dict(barCount=len(rows),providerCounts=counts,providerSequence=segments,switchCount=switches,
        classification=category,firstDate=min(dates) if dates else None,lastDate=max(dates) if dates else None)

def validate_bars(rows,provider=None):
    if not isinstance(rows,list) or not 1<=len(rows)<=3000:raise ValueError('invalid_history')
    prior=''
    for b in rows:
        day=b.get('date','')
        if date.fromisoformat(day).isoformat()!=day or day<=prior:raise ValueError('invalid_bar_order')
        prior=day
        if b.get('adjustment')!='qfq' or b.get('price_basis')!='adjusted':raise ValueError('adjustment_mismatch')
        if b.get('is_complete_bar') is not True:raise ValueError('incomplete_bar')
        vals=[b.get(k) for k in ('open','high','low','close')]
        if any(isinstance(x,bool) or not isinstance(x,(int,float)) or not math.isfinite(x) or x<=0 for x in vals):raise ValueError('invalid_ohlc')
        if b['high']<max(vals) or b['low']>min(vals):raise ValueError('invalid_ohlc')
        for k in ('volume','amount'):
            x=b.get(k)
            if x is not None and (isinstance(x,bool) or not isinstance(x,(int,float)) or not math.isfinite(x) or x<0):raise ValueError('invalid_'+k)
        if provider and (b.get('provider')!=provider or b.get('rawProviderId',provider)!=provider
                         or b.get('canonicalProviderId',provider)!=provider):raise ValueError('provider_mismatch')

def incremental_guard(existing,incoming,selected,contract=None):
    from .revision import require_stable
    return require_stable(existing,incoming,selected,contract)

def request(stock,ticker,end,now):
    symbol(ticker);rows=stock.get('priceHistory',[]);validate_bars(rows)
    if date.fromisoformat(end)<date.fromisoformat(rows[-1]['date']):raise ValueError('window_truncation')
    value=dict(schemaVersion=1,toolVersion=VERSION,symbol=ticker,requestedAt=now,
        requestedHistoryStart=rows[0]['date'],requestedHistoryEnd=end,
        retentionReason='entire_existing_retained_window; no 550-day truncation',
        baseHash=digest(facts(stock)),base=facts(stock),oldSummary=analyze(rows))
    value['requestId']=digest(value)
    return value

def distribution(xs):
    if not xs:return dict(min=None,median=None,p95=None,max=None)
    xs=sorted(xs)
    return dict(min=xs[0],median=xs[len(xs)//2],p95=xs[min(len(xs)-1,math.ceil(len(xs)*.95)-1)],max=xs[-1])

def compare(old,new,units):
    a={r['date']:r for r in old};b={r['date']:r for r in new};common=sorted(a.keys()&b.keys())
    output=dict(oldOnlyDates=sorted(a.keys()-b.keys()),candidateOnlyDates=sorted(b.keys()-a.keys()),commonDates=common,fields={})
    for key in ('open','high','low','close','volume','amount'):
        diffs=[];exact=0;missing=0;unknown=0
        for day in common:
            x,y=a[day].get(key),b[day].get(key)
            if x is None or y is None:missing+=1;continue
            family='price' if key in ('open','high','low','close') else key
            px,py=a[day].get('provider'),b[day].get('provider')
            ux,uy=units.get(px,{}).get(family,{}),units.get(py,{}).get(family,{})
            if not (ux.get('confirmed') and uy.get('confirmed') and ux.get('unit')==uy.get('unit') and ux.get('currency')==uy.get('currency')):
                unknown+=1;continue
            dx=Decimal(str(x))*Decimal(str(ux.get('scale',1)));dy=Decimal(str(y))*Decimal(str(uy.get('scale',1)));delta=abs(dy-dx)
            if not delta:exact+=1
            else:diffs.append(dict(date=day,oldProvider=px,candidateProvider=py,old=float(dx),candidate=float(dy),absolute=float(delta),relative=float(delta/abs(dx)) if dx else None))
        absolute=[x['absolute'] for x in diffs];relative=[x['relative'] for x in diffs if x['relative'] is not None]
        output['fields'][key]=dict(status='UNITS_UNCONFIRMED' if unknown else ('NOT_COMPARABLE' if missing==len(common) else 'MEASURED'),
            exactMatchCount=exact,differenceCount=len(diffs),missingCount=missing,unconfirmedUnitCount=unknown,
            maxDifference=max(absolute,default=0) if exact or diffs else None,
            distributionSummary=dict(absolute=distribution(absolute),relative=distribution(relative)),differences=diffs)
    return output

def technical(rows,contract,units):
    closes=[r['close'] for r in rows];n=len(rows);latest=rows[-1]['date']
    def ma(w):return round(sum(closes[-w:])/w,6) if n>=w else None
    def ema(xs,w):
        out=[xs[0]]
        for x in xs[1:]:out.append(out[-1]+2/(w+1)*(x-out[-1]))
        return out
    macd=dict(dif=None,dea=None,histogram=None)
    if n>=26:
        dif=[a-b for a,b in zip(ema(closes,12),ema(closes,26))];dea=ema(dif,9)
        macd=dict(dif=round(dif[-1],6),dea=round(dea[-1],6),histogram=round(2*(dif[-1]-dea[-1]),6))
    vu=units.get(contract['canonicalProvider'],{}).get('volume',{});vs=[r.get('volume') for r in rows]
    usable=vu.get('confirmed') and vu.get('unit')=='shares' and all(v is not None for v in vs)
    vs=[v*vu.get('scale',1) for v in vs] if usable else []
    recent=sum(vs[-5:])/5 if len(vs)>=5 else None;prev=sum(vs[-10:-5])/5 if len(vs)>=10 else None
    volume=dict(recent_5d_average=round(recent,2) if recent is not None else None,previous_5d_average=round(prev,2) if prev is not None else None,
        change_pct=round((recent/prev-1)*100,2) if recent is not None and prev else None,unit='shares' if usable else None,status='comparable' if usable and len(vs)>=10 else 'unavailable')
    ind=dict(last_trade_date=latest,**{'ma'+str(w):ma(w) for w in (5,10,20,60,120)},macd=macd,volume_change=volume)
    td=dict(symbol=contract['symbol'],price=closes[-1],technicalAsOf=latest,latestCompleteBar=latest,
        **{k:v for k,v in ind.items() if k.startswith('ma')},supportPrice=round(min(closes[-60:]),4) if n>=20 else None,
        resistancePrice=round(max(closes[-60:]),4) if n>=20 else None,supportResistanceAsOf=latest,
        technicalDataStatus='candidate',dataQuality='candidate_only',
        priceActionEvent={'status':'needs_review','reason':'no_versioned_deterministic_classifier'},
        deterministicTrendInputs={k:v for k,v in ind.items() if k.startswith('ma')},programRiskFlags=[],aiJudgmentStatus='needs_review')
    return ind,td

def candidate(req,provider,rows,provider_version,now,evidence):
    if provider not in REGISTRY:raise ValueError('unsupported_provider')
    validate_bars(rows,provider);rows=copy.deepcopy(rows)
    if any(r['date']<req['requestedHistoryStart'] or r['date']>req['requestedHistoryEnd'] for r in rows):raise ValueError('out_of_requested_window')
    for r in rows:r.update(rawProviderId=provider,canonicalProviderId=provider)
    contract=dict(symbol=req['symbol'],canonicalProvider=provider,rawProviderId=provider,providerVersion=provider_version,
        providerSchemaVersion=1,interval='daily',adjustment='qfq',priceBasis='adjusted',market='HK' if req['symbol'].endswith('.HK') else 'CN',
        requestedHistoryStart=req['requestedHistoryStart'],requestedHistoryEnd=req['requestedHistoryEnd'],
        actualHistoryStart=rows[0]['date'],actualHistoryEnd=rows[-1]['date'],generatedAt=now,
        adjustmentAlgorithmVersion=evidence.get('adjustmentAlgorithmVersion','UNCONFIRMED'),units=copy.deepcopy(evidence.get('units',{})))
    overlap=compare(req['base']['priceHistory'],rows,contract['units']);blockers=[];reviews=[]
    unexpected_gaps=[]
    for left,right in zip(rows,rows[1:]):
        gap=(date.fromisoformat(right['date'])-date.fromisoformat(left['date'])).days
        # Report intervals; do not call weekends/holidays missing trading sessions.
        if gap>1:unexpected_gaps.append(dict(after=left['date'],before=right['date'],calendarDays=gap,explanation='calendar_or_suspension_evidence_required'))
    if overlap['oldOnlyDates']:reviews.append('missing_historical_dates')
    if rows[0]['date']>req['requestedHistoryStart'] or rows[-1]['date']<req['oldSummary']['lastDate']:blockers.append('truncated_history')
    if not evidence.get('adjustmentConfirmed'):blockers.append('adjustment_evidence_unconfirmed')
    if not evidence.get('writerGuardsConfirmed'):blockers.append('writer_deployment_not_confirmed')
    if not evidence.get('calendarConfirmed'):reviews.append('calendar_coverage_unconfirmed')
    for field,value in overlap['fields'].items():
        if value['unconfirmedUnitCount']:
            (reviews if field=='amount' else blockers).append(field+'_units_unconfirmed')
        if value['differenceCount']:reviews.append(field+'_differences_unassessed')
    if overlap['candidateOnlyDates']:reviews.append('candidate_only_dates')
    if len(rows)<120:reviews.append('short_indicator_history')
    ind,td=technical(rows,contract,contract['units'])
    warnings=['old_AI_judgments_need_review','history_source_changed','no_automatic_approval']
    if any(r.get('amount') is None for r in rows):warnings.append('amount_not_comparable')
    value=dict(schemaVersion=1,toolVersion=VERSION,requestId=req['requestId'],symbol=req['symbol'],baseHash=req['baseHash'],sourceContract=contract,
        generatedAt=now,barCount=len(rows),oldSummary=req['oldSummary'],newSummary=analyze(rows),validationStatus='invalid' if blockers else 'review_required',
        blockers=blockers,reviewItems=reviews,warnings=warnings,coverage={k:overlap[k] for k in ('oldOnlyDates','candidateOnlyDates','commonDates')},
        overlap=overlap,dateGaps=unexpected_gaps,evidence=copy.deepcopy(evidence),stock=dict(priceHistory=rows,technicalIndicators=ind,technicalData=td,
            marketDataFreshness=dict(last_trade_date=rows[-1]['date'],provider=provider,fetched_at=now,is_complete_bar=True,
                kline_status='candidate',technical_analysis_stale=True,sourceContract=contract)),
        aiJudgmentStatus='needs_review',discussionPolicy='preserve_history_warn_source_changed')
    value['candidateHash']=digest(value);value['candidateId']='rebase_'+value['candidateHash']
    return value

def verify(value):
    body={k:v for k,v in value.items() if k not in ('candidateHash','candidateId')}
    if digest(body)!=value.get('candidateHash') or value.get('candidateId')!='rebase_'+value['candidateHash']:raise ValueError('candidate_hash_mismatch')
    validate_bars(value['stock']['priceHistory'],None if value.get('schemaVersion')==2 else value['sourceContract']['canonicalProvider'])
    if value.get('schemaVersion') == 2:
        from .revision import verify as verify_revision
        verify_revision(value)
    return value

def recommend(outcomes):
    eligible=[x for x in outcomes if x.get('candidateHash') and not {'truncated_history','adjustment_evidence_unconfirmed'}.intersection(x.get('blockers',[]))]
    eligible.sort(key=lambda x:(len(x.get('reviewItems',[])),x['provider']!='eastmoney'))
    return dict(recommendedProvider=eligible[0]['provider'] if eligible else None,
        alternativeProviders=[x['provider'] for x in outcomes if not eligible or x['provider']!=eligible[0]['provider']],
        selectionReasons=['observed_fetch_and_coverage_not_old_bar_count','fewest_unresolved_review_items','existing_chain_order_tiebreak_only'],
        selectionStatus='USER_CONFIRMATION_REQUIRED',recommendationScope='candidate_review_only',knownRisks=['unit_and_deployment_gates_may_still_block_apply','single_probe_not_reliability_statistics','future_incremental_availability_unproven'],
        unsupportedCapabilities=['minute_bars','automatic_source_approval'],outcomes=outcomes)
