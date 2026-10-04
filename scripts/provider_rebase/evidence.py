"""Versioned, field-bound evidence rules. No network, approval or write side effects."""
from decimal import Decimal, InvalidOperation
import math
import re
from urllib.parse import urlsplit

PROFILE = 'empirical-exchange-v1'
LEVELS = ('CONFIRMED_CONTRACT', 'EMPIRICALLY_VALIDATED', 'STRONG_EVIDENCE', 'UNKNOWN')
EXCHANGES = {'HK': {'www.hkex.com.hk', 'www1.hkexnews.hk'},
             'CN': {'www.sse.com.cn', 'www.szse.cn'}}
FIELDS = {'yahoo': {'volume': 'indicators.quote[0].volume', 'price': 'indicators.quote[0].ohlc'},
          'eastmoney': {'volume': 'klines.f56', 'price': 'klines.f51_f54'}}
WRITE_PATHS = ('worker', 'manual', 'batch', 'pc_direct', 'legacy_json', 'legacy_csv', 'bridge_publish', 'browser_result')

def sha(value):
    return isinstance(value, str) and re.fullmatch('[a-f0-9]{64}', value) is not None

def finite(value):
    return not isinstance(value, bool) and isinstance(value, (int, float)) and math.isfinite(value)

def equal(a, b):
    try:
        return a is not None and b is not None and not isinstance(a, bool) and not isinstance(b, bool) and Decimal(str(a)).is_finite() and Decimal(str(a)) == Decimal(str(b))
    except (InvalidOperation, ValueError, TypeError):
        return False

def official(sample, market):
    return (urlsplit(sample.get('sourceUrl', '')).scheme == 'https'
            and urlsplit(sample.get('sourceUrl', '')).hostname in EXCHANGES.get(market, set())
            and sha(sample.get('sourceHash')) and bool(re.fullmatch(r'\d{4}-\d{2}-\d{2}', sample.get('date', ''))))

def accepted(unit):
    """Legacy confirmed contracts retain their historical reconstruction semantics."""
    if not unit.get('evidenceLevel'):
        return bool(unit.get('confirmed'))
    if unit.get('evidenceLevel') == 'CONFIRMED_CONTRACT':
        return bool(unit.get('evidence')) and sha(unit.get('contractDocumentHash'))
    if unit.get('evidenceLevel') != 'EMPIRICALLY_VALIDATED':
        return False
    p = unit.get('validation', {})
    samples = p.get('samples', [])
    if (p.get('profile') != PROFILE or not sha(p.get('parserReplayHash'))
            or not sha(p.get('rawHash')) or len({s.get('date') for s in samples}) < 2
            or not finite(unit.get('scale')) or unit['scale'] <= 0):
        return False
    for s in samples:
        if not official(s, p.get('market')) or s.get('symbol') != p.get('symbol'):
            return False
        if p.get('field') == 'volume':
            if s.get('exchangeUnit') != 'shares' or not finite(s.get('providerValue')) or s['providerValue'] < 0 or not equal(s['providerValue'] * unit['scale'], s.get('exchangeValue')):
                return False
        elif p.get('field') == 'price':
            if unit.get('unit') != unit.get('currency', '') + '/share' or s.get('exchangeUnit') != unit['unit'] or s.get('providerUnit') != unit['unit']:
                return False
        else:
            return False
    return True

def units_gate(contract, old, evidence, comparison, new):
    statuses, blockers = {}, []
    providers = {r['provider'] for r in old} | {contract['canonicalProvider']}
    for provider in sorted(providers):
        statuses[provider] = {}
        for field in ('price', 'volume', 'amount'):
            u = contract.get('units', {}).get(provider, {}).get(field, {})
            level = u.get('evidenceLevel', 'UNKNOWN')
            statuses[provider][field] = level
            if field == 'amount' and not evidence.get('amountRequired', False):
                continue
            proof = u.get('validation', {})
            good = accepted(u) and finite(u.get('scale')) and u['scale'] > 0
            if field == 'price':
                good = good and u.get('currency') == ('HKD' if contract['market'] == 'HK' else 'CNY') and u.get('unit') == u.get('currency', '') + '/share'
            if field == 'volume':
                good = good and u.get('unit') == 'shares'
            if level == 'EMPIRICALLY_VALIDATED':
                good = good and all(proof.get(k) == v for k, v in dict(symbol=contract['symbol'], provider=provider,
                    market=contract['market'], field=field, canonicalField=FIELDS.get(provider, {}).get(field),
                    providerVersion=contract['providerVersion'], normalizationVersion=contract['normalizationVersion']).items())
                observed = {r['date']: r for r in (new if provider == contract['canonicalProvider'] else old) if r['provider'] == provider}
                if field == 'volume':
                    good = good and all(s['date'] in observed and equal(observed[s['date']].get('volume'), s.get('providerValue')) for s in proof.get('samples', []))
            if not good:
                blockers.append('UNIT_CONTRACT_INCOMPLETE')
    return statuses, sorted(set(blockers))

def volume_review(old, new, contract, evidence):
    a, b = ({r['date']: r for r in rows} for rows in (old, new))
    changed = [d for d in sorted(a.keys() & b.keys()) if not equal(a[d].get('volume'), b[d].get('volume')) and a[d].get('volume') != b[d].get('volume')]
    entries = evidence.get('volumeValidation', {}).get('records', [])
    pending = []
    for day in changed:
        records = [x for x in entries if x.get('date') == day]
        valid = len(records) == 1
        if valid:
            x = records[0]
            valid = (x.get('symbol') == contract['symbol'] and x.get('provider') == contract['canonicalProvider']
                and x.get('canonicalField') == FIELDS.get(contract['canonicalProvider'], {}).get('volume')
                and official(x, contract['market']) and sha(x.get('rawHash'))
                and x.get('unit') == 'shares' and x.get('scale') == 1
                and equal(x.get('oldValue'), a[day].get('volume'))
                and equal(x.get('candidateValue'), b[day].get('volume'))
                and equal(x.get('exchangeValue'), b[day].get('volume'))
                and x.get('scopeUnchanged') is True)
        if not valid:
            pending.append(day)
    return dict(changedDates=changed, unvalidatedDates=pending,
                status='EXCHANGE_VALIDATED_REVIEW_REQUIRED' if changed and not pending else ('BLOCKED' if pending else 'UNCHANGED'))

def guard_gate(evidence):
    delivery = evidence.get('guardDelivery', {})
    paths = delivery.get('paths', {})
    missing = [p for p in WRITE_PATHS if paths.get(p, {}).get('status') != 'delivered'
        or not sha(paths.get(p, {}).get('implementationHash')) or not sha(paths.get(p, {}).get('testHash'))]
    return dict(version=PROFILE, scope=delivery.get('scope', 'unspecified'), paths=paths, missingPaths=missing)

def technical_complete(preview, n):
    td, ind = preview.get('technicalData', {}), preview.get('indicators', {})
    keys = ['supportPrice', 'resistancePrice', 'technicalAsOf', 'latestCompleteBar', 'volume', 'volumeAvg20', 'volumeChangePct']
    if n >= 120:
        keys += ['ma5', 'ma10', 'ma20', 'ma60', 'ma120']
    return (all(td.get(k) is not None for k in keys) and td.get('volumeStatus') == 'comparable'
        and all(ind.get('macd', {}).get(k) is not None for k in ('dif', 'dea', 'histogram'))
        and bool(td.get('priceActionEvent')) and isinstance(td.get('programRiskFlags'), list))


def implementation_hash():
    """Bind approval to code, normalized across Windows line endings."""
    import hashlib, json
    from pathlib import Path
    root = Path(__file__).parent
    names = ('core.py', 'revision.py', 'evidence.py', 'integration.py', 'fetch.py', 'store.py')
    items = {n: hashlib.sha256((root/n).read_text(encoding='utf-8-sig').encode()).hexdigest() for n in names}
    return hashlib.sha256(json.dumps(items, sort_keys=True, separators=(',', ':')).encode()).hexdigest()
