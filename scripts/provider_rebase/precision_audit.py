"""Read-only Yahoo decimal provenance. Diagnostic, never an equality/approval gate.

The production parser is replayed without editing its arithmetic or precision.
Decimal and Fraction traces explain differences; only existing revision.inspect
decides whether a history is stable. Raw numbers are retained as JSON lexemes.
"""
import hashlib
import json
from collections import Counter
from datetime import datetime, time
from decimal import Decimal, localcontext
from fractions import Fraction
from zoneinfo import ZoneInfo

PRICE = ('open', 'high', 'low', 'close')


class Number(str):
    pass


def trace(raw, as_of=None):
    data = json.loads(raw, parse_float=Number, parse_int=Number)
    chart = data.get('chart') or {}
    if chart.get('error') or len(chart.get('result') or []) != 1:
        raise ValueError('provider_chart_error')
    result = chart['result'][0]
    if result.get('meta', {}).get('currency') != 'HKD':
        raise ValueError('SOURCE_CONTRACT_MISMATCH')
    quotes = result['indicators']['quote'][0]
    adjusted = result['indicators'].get('adjclose', [{}])[0].get('adjclose', [])
    rows = {}; excluded = []
    moment = datetime.fromisoformat(as_of.replace('Z','+00:00')).astimezone(ZoneInfo('Asia/Hong_Kong')) if as_of else None
    for i, ts in enumerate(result.get('timestamp', [])):
        day = datetime.fromtimestamp(int(ts), ZoneInfo('Asia/Hong_Kong')).date().isoformat()
        if moment and not (day < moment.date().isoformat() or (day == moment.date().isoformat() and moment.weekday()<5 and moment.time().replace(tzinfo=None)>=time(16,10))):
            excluded.append(day);continue
        if day in rows:
            raise ValueError('duplicate_date')
        values = {k: quotes.get(k, [])[i] for k in (*PRICE, 'volume')}
        if any(values[k] is None for k in PRICE):
            continue
        adj = adjusted[i] if i < len(adjusted) else None
        if adj is None:
            raise ValueError('missing_adjclose')
        if any(not isinstance(v, Number) for v in (*[values[k] for k in PRICE], adj)):
            raise ValueError('invalid_number')
        if any(not Decimal(v).is_finite() or Decimal(v) <= 0 for v in (*[values[k] for k in PRICE], adj)):
            raise ValueError('invalid_price')
        ratio = Fraction(Decimal(adj)) / Fraction(Decimal(values['close']))
        f = float(adj) / float(values['close'])
        with localcontext() as ctx:
            ctx.prec = 60
            factor = Decimal(adj) / Decimal(values['close'])
            fields = {}
            for k in PRICE:
                binary = float(values[k]) * f
                exact = Decimal(values[k]) * factor
                fields[k] = dict(raw=str(values[k]), normalized=str(Decimal(values[k]).normalize()),
                    beforeRound=repr(binary), binaryHex=binary.hex(), production=round(binary, 6),
                    decimalProduct=str(exact), decimalRound6=str(exact.quantize(Decimal('0.000001'))),
                    alternateOrder=round(float(values[k]) * float(adj) / float(values['close']), 6))
            rows[day] = dict(date=day, fields=fields, adjclose=str(adj), rawClose=str(values['close']),
                factorDecimal=str(factor), factorFraction=str(ratio), factorFloat=repr(f),
                factorHex=f.hex(), volume=values['volume'], amount=None)
    if not rows:
        raise ValueError('provider_empty')
    return dict(rawHash=hashlib.sha256(raw).hexdigest(), rows=rows,excludedIncomplete=excluded,asOf=as_of,
        currency='HKD', symbol=result.get('meta',{}).get('symbol'), algorithm='yahoo_adjclose_ratio_ohlc_round6')


def compare_raw(left_raw, right_raw, left_asof=None, right_asof=None):
    a, b = trace(left_raw,left_asof), trace(right_raw,right_asof)
    common = sorted(a['rows'].keys() & b['rows'].keys())
    changes, raw_changes, adj_changes, factor_changes = [], [], [], []
    changed_dates = {k: set() for k in PRICE}
    unexplained = []
    def equal(x, y):
        return x is None and y is None or x is not None and y is not None and Decimal(x) == Decimal(y)
    for day in common:
        x, y = a['rows'][day], b['rows'][day]
        drift = [k for k in PRICE if not equal(x['fields'][k]['raw'], y['fields'][k]['raw'])]
        if not equal(x['volume'], y['volume']):drift.append('volume')
        if drift:raw_changes.append(dict(date=day, fields=drift))
        adj_changed = not equal(x['adjclose'], y['adjclose'])
        factor_changed = x['factorFraction'] != y['factorFraction']
        if adj_changed:adj_changes.append(day)
        if factor_changed:factor_changes.append(day)
        for field in PRICE:
            old, new = x['fields'][field], y['fields'][field]
            delta = Decimal(str(new['production'])) - Decimal(str(old['production']))
            if not delta:continue
            changed_dates[field].add(day)
            if not drift and not adj_changed:unexplained.append(dict(date=day,field=field))
            changes.append(dict(date=day,field=field,old=old,new=new,oldAdjclose=x['adjclose'],newAdjclose=y['adjclose'],
                oldFactor=x['factorDecimal'],newFactor=y['factorDecimal'],absoluteDifference=str(abs(delta)),
                signedDifference=str(delta),relativeDifference=str(delta/Decimal(str(old['production'])))))
    union = sorted(set().union(*changed_dates.values()))
    intersection = sorted(set.intersection(*changed_dates.values()))
    samples = sorted(Decimal(x['absoluteDifference']) for x in changes)
    def quantile(p):return str(samples[round((len(samples)-1)*p)]) if samples else None
    summary = dict(commonDates=len(common),leftBars=len(a['rows']),rightBars=len(b['rows']),
        oldOnlyDates=sorted(a['rows'].keys()-b['rows'].keys()),newOnlyDates=sorted(b['rows'].keys()-a['rows'].keys()),
        changedCounts={k:len(v) for k,v in changed_dates.items()},union=union,intersection=intersection,
        rawQuoteDriftDates=len(raw_changes),rawAdjcloseDriftDates=len(adj_changes),factorDriftDates=len(factor_changes),
        unexplainedOutputDifferences=len(unexplained),byMonth=dict(Counter(d[:7] for d in union)),
        signs=dict(Counter('positive' if Decimal(x['signedDifference'])>0 else 'negative' for x in changes)),
        absoluteDifference=dict(min=quantile(0),p50=quantile(.5),p95=quantile(.95),max=quantile(1)),
        classification='PROVIDER_ADJUSTED_HISTORY_REVISION' if adj_changes or raw_changes else
            'INDETERMINATE' if unexplained else 'REPRESENTATION_ONLY')
    # Diagnostic classification never authorizes append/apply, even with zero deltas.
    return dict(summary=summary,leftHash=a['rawHash'],rightHash=b['rawHash'],differences=changes,
        rawQuoteChanges=raw_changes,adjcloseChangedDates=adj_changes,factorChangedDates=factor_changes,
        unexplained=unexplained,applyAllowed=False)
