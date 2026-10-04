"""Full retained-window revision engine. Pure functions; never approves or applies.

The v1 rebase constructor remains frozen for stored candidates. Schema 2 uses
the same Store, binding semantic content separately from the review package.
"""
import copy
from decimal import Decimal
from . import core as C
from . import evidence as E

VERSION = 'provider-revision-engine-v1'
NORMALIZATION = 'python-round-6-v1'
PRICE = ('open', 'high', 'low', 'close')
VALUES = PRICE + ('volume', 'amount')
SAFE_ERRORS = frozenset({'PROVIDER_REBASE_REQUIRED', 'PROVIDER_SWITCH',
    'SAME_PROVIDER_REVISION', 'SOURCE_CONTRACT_MISMATCH', 'REVISION_SUSPECTED',
    'REVISION_REVIEW_REQUIRED', 'UNKNOWN_CONTINUITY_RISK',
    'UNIT_CONTRACT_INCOMPLETE', 'VOLUME_DIFFERENCE_UNEXPLAINED',
    'UNSAFE_WRITE_PATH_BLOCKED', 'REVISION_PROBE_FAILED', 'VERSION_CONFLICT'})
REGISTRY = {p: {**copy.deepcopy(value), 'mutableHistory': True,
    'revisionProbeSupport': True, 'revisionProbeMode': 'entire_retained_window',
    'normalizationVersion': NORMALIZATION,
    'eventEvidenceSupport': 'optional_observed' if p == 'yahoo' else 'unavailable'}
    for p, value in C.REGISTRY.items()}


def canonical(raw):
    if raw in REGISTRY:
        return raw
    matches = [p for p, v in REGISTRY.items() if raw in v['aliases']]
    if len(matches) != 1:
        raise ValueError('UNKNOWN_CONTINUITY_RISK')
    return matches[0]


def number(value, field):
    if value is None:
        return None
    # Match the existing Python provider precision, including its round mode.
    result = round(float(value), 6) if field in PRICE else value
    if result==0:return '0'
    return format(Decimal(str(result)).normalize(), 'f')


def semantic_rows(rows):
    return [dict(date=r['date'], **{k: number(r.get(k), k) for k in VALUES},
        provider=canonical(r.get('provider')), adjustment=r.get('adjustment'),
        priceBasis=r.get('price_basis'), complete=r.get('is_complete_bar')) for r in rows]


def source_contract(ticker, provider, rows, provider_version, units=None):
    C.symbol(ticker)
    p = canonical(provider)
    return dict(symbol=ticker, canonicalProvider=p, rawProviderId=provider,
        providerVersion=provider_version, adjustment='qfq', priceBasis='adjusted',
        market='HK' if ticker.endswith('.HK') else 'CN', interval='daily',
        normalizationVersion=NORMALIZATION,
        historyWindow=dict(start=rows[0]['date'], end=rows[-1]['date']),
        units=copy.deepcopy(units or {}))


def valid_contract(contract):
    try:
        C.symbol(contract['symbol'])
        return (canonical(contract['rawProviderId']) == contract['canonicalProvider']
            and bool(contract['providerVersion']) and contract['adjustment'] == 'qfq'
            and contract['priceBasis'] == 'adjusted' and contract['interval'] == 'daily'
            and contract['normalizationVersion'] == NORMALIZATION
            and contract['market'] == ('HK' if contract['symbol'].endswith('.HK') else 'CN')
            and bool(contract['historyWindow']['start']) and bool(contract['historyWindow']['end']))
    except (KeyError, TypeError, ValueError):
        return False


def content_hash(rows, contract):
    semantics = {k: contract.get(k) for k in ('symbol', 'canonicalProvider',
        'providerVersion', 'adjustment', 'priceBasis', 'market', 'interval',
        'historyWindow', 'normalizationVersion')}
    semantics['units'] = {p: {field: {k: u.get(k) for k in ('unit', 'currency', 'scale')}
        for field, u in fields.items()} for p, fields in contract.get('units', {}).items()}
    return C.digest(dict(bars=semantic_rows(rows), contract=semantics))


def compare(old, new):
    a, b = ({r['date']: r for r in rows} for rows in (old, new))
    common = sorted(a.keys() & b.keys())
    fields = {}
    for field in VALUES:
        changed = [dict(date=d, old=a[d].get(field), new=b[d].get(field)) for d in common
            if number(a[d].get(field), field) != number(b[d].get(field), field)]
        missing = sum(a[d].get(field) is None and b[d].get(field) is None for d in common)
        fields[field] = dict(differences=changed, differenceCount=len(changed),
            status='NOT_COMPARABLE' if missing == len(common) else 'NORMALIZED_COMPARISON',
            bothMissingCount=missing)
    ratios = [dict(date=d, **{k: b[d][k] / a[d][k] for k in PRICE}) for d in common]
    # Boundaries use the already declared six-place ratio representation. This
    # grouping is descriptive only; classification never tolerates price drift.
    regimes = []
    for row in ratios:
        key = tuple(number(row[k], 'close') for k in PRICE)
        if not regimes or regimes[-1]['key'] != key:
            regimes.append(dict(key=key, start=row['date'], end=row['date'], count=1))
        else:
            regimes[-1].update(end=row['date'], count=regimes[-1]['count'] + 1)
    return dict(fields=fields, oldOnlyDates=sorted(a.keys() - b.keys()),
        newOnlyDates=sorted(b.keys() - a.keys()), ratioSeries=ratios,
        ratioSummary={k: C.distribution([r[k] for r in ratios]) for k in PRICE},
        ratioRegimes=regimes, ratioGroupingPrecision=6,
        ratioBoundaries=[r['start'] for r in regimes[1:]])


def inspect(existing, incoming, contract, previous_contract=None):
    """The shared Market History Write Guard. Only STABLE permits a merge."""
    if not valid_contract(contract):
        return dict(classification='SOURCE_CONTRACT_MISMATCH', allowed=False)
    try:
        C.validate_bars(incoming)
        if existing:
            C.validate_bars(existing)
        selected = contract['canonicalProvider']
        if any(canonical(r.get('provider')) != selected for r in incoming):
            return dict(classification='SOURCE_CONTRACT_MISMATCH', allowed=False)
        if any(canonical(r.get('rawProviderId',r['provider']))!=canonical(r['provider']) or
               r.get('canonicalProviderId',canonical(r['provider']))!=canonical(r['provider']) for r in existing+incoming):
            return dict(classification='SOURCE_CONTRACT_MISMATCH',allowed=False)
        old_providers = {canonical(r.get('provider')) for r in existing}
    except (ValueError, KeyError, TypeError):
        return dict(classification='UNKNOWN_CONTINUITY_RISK', allowed=False)
    if (contract['historyWindow']['start'] != incoming[0]['date'] or
            contract['historyWindow']['end'] != incoming[-1]['date']):
        return dict(classification='SOURCE_CONTRACT_MISMATCH', allowed=False)
    if previous_contract:
        keys = ('symbol', 'adjustment', 'priceBasis', 'market')
        if any(previous_contract.get(k) != contract[k] for k in keys):
            return dict(classification='SOURCE_CONTRACT_MISMATCH', allowed=False)
        if previous_contract.get('normalizationVersion', NORMALIZATION) != NORMALIZATION:
            return dict(classification='SOURCE_CONTRACT_MISMATCH', allowed=False)
        def unit_semantics(c):
            return {p:{k:{f:v.get(f) for f in ('unit','currency','scale')} for k,v in u.items()} for p,u in c.get('units',{}).items()}
        same_provider=previous_contract.get('canonicalProvider')==selected
        if same_provider and (previous_contract.get('providerVersion')!=contract['providerVersion'] or unit_semantics(previous_contract)!=unit_semantics(contract)):
            return dict(classification='SOURCE_CONTRACT_MISMATCH',allowed=False)
    same = [r for r in existing if canonical(r['provider']) == selected]
    evidence = compare(same, incoming)
    baseline_dates={r['date'] for r in existing}
    evidence['historicalAddedDates']=[d for d in evidence['newOnlyDates'] if existing and d<=existing[-1]['date'] and d not in baseline_dates]
    revised = any(v['differenceCount'] for v in evidence['fields'].values()) or bool(evidence['historicalAddedDates'])
    if len(old_providers) > 1:
        kind = 'PROVIDER_REBASE_REQUIRED'
    elif old_providers and selected not in old_providers:
        kind = 'PROVIDER_SWITCH'
    elif evidence['oldOnlyDates']:
        kind = 'REVISION_SUSPECTED'
    elif revised:
        kind = 'SAME_PROVIDER_REVISION'
    else:
        kind = 'STABLE'
    return dict(classification=kind, allowed=kind == 'STABLE', comparison=evidence,
        sameProviderRevisionDetected=revised,
        probeWindow=dict(start=existing[0]['date'] if existing else incoming[0]['date'], end=incoming[-1]['date']))


def require_stable(existing, incoming, selected, previous_contract=None):
    ticker = (previous_contract or {}).get('symbol', '000001.SZ')
    contract = source_contract(ticker, selected, incoming,
        (previous_contract or {}).get('providerVersion', 'legacy-observed-v1'),
        (previous_contract or {}).get('units'))
    report = inspect(existing, incoming, contract, previous_contract)
    if not report['allowed']:
        raise ValueError(report['classification'])
    return report


def technical_preview(rows, contract):
    ind, td = C.technical(rows, contract, contract.get('units', {}))
    def sign(x):
        return None if x is None else (1 if x > 0 else -1 if x < 0 else 0)
    series = []
    # Complete history, never a gapped same-provider subset of a mixed baseline.
    for n in range(1, len(rows) + 1):
        tail = rows[:n]
        ma = lambda w: sum(r['close'] for r in tail[-w:]) / w if n >= w else None
        series.append(dict(date=tail[-1]['date'], priceVsMA20=sign(tail[-1]['close'] - ma(20)) if n >= 20 else None,
            ma5VsMA20=sign(ma(5) - ma(20)) if n >= 20 else None))
    ema12 = ema26 = rows[0]['close']; dea = 0
    for n, (r, point) in enumerate(zip(rows, series)):
        if n:
            ema12 += (r['close'] - ema12) * 2 / 13
            ema26 += (r['close'] - ema26) * 2 / 27
        dif = ema12 - ema26
        dea += (dif - dea) * 2 / 10
        point['macdSign'] = sign(dif - dea) if n >= 25 else None
    crossovers = []
    for before, after in zip(series, series[1:]):
        for key in ('priceVsMA20', 'ma5VsMA20', 'macdSign'):
            if before[key] is not None and after[key] is not None and before[key] != after[key]:
                crossovers.append(dict(date=after['date'], indicator=key, before=before[key], after=after[key]))
    td['priceActionEvent'] = dict(status='unavailable', reason='no_versioned_deterministic_classifier')
    last=series[-1]
    td['programRiskFlags']=[name for key,name in [('priceVsMA20','price_below_ma20'),('ma5VsMA20','ma5_below_ma20'),('macdSign','macd_below_signal')] if last[key]==-1]
    unit=contract.get('units',{}).get(contract['canonicalProvider'],{}).get('volume',{})
    volume=[r.get('volume') for r in rows[-20:]]
    comparable=E.accepted(unit) and unit.get('unit')=='shares' and all(v is not None for v in volume)
    td.update(volume=volume[-1]*unit.get('scale',1) if comparable else None,
        volumeAvg20=sum(volume)/len(volume)*unit.get('scale',1) if comparable else None,
        volumeChangePct=ind['volume_change']['change_pct'],volumeStatus='comparable' if comparable else 'unavailable')
    return dict(indicators=ind, technicalData=td, relationships=series, crossovers=crossovers)


def unit_gate(contract, rows, evidence, comparison):
    blockers = []
    statuses = {}
    for p in {canonical(r['provider']) for r in rows} | {contract['canonicalProvider']}:
        statuses[p] = {}
        for field in ('price', 'volume', 'amount'):
            u = contract.get('units', {}).get(p, {}).get(field, {})
            status = u.get('status', 'confirmed' if u.get('confirmed') else 'unknown')
            if status not in ('confirmed','strong_evidence','unknown','not_applicable'):status='unknown'
            statuses[p][field] = status
            required = field != 'amount' or evidence.get('amountRequired', False)
            proven = status == 'confirmed' and u.get('confirmed') is True and bool(u.get('evidence')) and bool(u.get('unit'))
            scale = u.get('scale')
            proven = proven and not isinstance(scale, bool) and isinstance(scale, (int, float)) and 0 < scale < float('inf')
            if field=='price':proven=proven and u.get('currency')==('HKD' if contract['market']=='HK' else 'CNY')
            if field=='volume':proven=proven and u.get('unit')=='shares'
            if required and not proven:
                blockers.append('UNIT_CONTRACT_INCOMPLETE')
    changed = comparison['fields']['volume']['differenceCount']
    # V1 has no reviewed automatic rule that proves changed volume safe.
    # A free-text explanation, even marked confirmed, cannot clear this gate.
    if changed:
        blockers.append('VOLUME_DIFFERENCE_UNEXPLAINED')
    return statuses, sorted(set(blockers))


def candidate(req, provider, rows, provider_version, now, evidence):
    """Append-only review candidate; old mixed histories remain provider_rebase."""
    selected=canonical(provider)
    canonical_rows=[{**r,'provider':selected,'rawProviderId':selected,'canonicalProviderId':selected} for r in rows]
    if any(canonical(r.get('provider'))!=selected or canonical(r.get('rawProviderId',r['provider']))!=selected for r in rows):raise ValueError('SOURCE_CONTRACT_MISMATCH')
    c = C.candidate(req, selected, canonical_rows, provider_version, now, evidence)
    for target,raw in zip(c['stock']['priceHistory'],rows):target['rawProviderId']=raw.get('rawProviderId',raw['provider'])
    c.pop('candidateHash'); c.pop('candidateId')
    contract = source_contract(req['symbol'], provider, rows, provider_version, evidence.get('units'))
    if evidence.get('validationProfile') == E.PROFILE:
        contract.update(canonicalProviderId=selected, priceCurrency='HKD' if contract['market']=='HK' else 'CNY',
            priceUnit=('HKD' if contract['market']=='HK' else 'CNY')+'/share', volumeUnit='shares',
            amountAvailability='NOT_AVAILABLE' if selected=='yahoo' else 'AVAILABLE', unitValidationProfile=E.PROFILE)
    report = inspect(req['base']['priceHistory'], rows, contract,
        req['base']['marketDataFreshness'].get('sourceContract'))
    mixed = len({canonical(r['provider']) for r in req['base']['priceHistory']}) > 1
    kind = 'provider_rebase' if mixed or report['classification'] == 'PROVIDER_SWITCH' else 'same_provider_revision'
    if report['classification'] == 'STABLE':
        raise ValueError('stable_candidate_not_required')
    old = req['base']['priceHistory']
    comparison = report.get('comparison') or compare(old, rows)
    statuses, blockers = unit_gate(contract, old, evidence, comparison)
    before, after = technical_preview(old, contract), technical_preview(rows, contract)
    if comparison['oldOnlyDates']:
        blockers.append('REVISION_PROBE_INCOMPLETE')
    if report['classification'] in ('SOURCE_CONTRACT_MISMATCH', 'UNKNOWN_CONTINUITY_RISK'):
        blockers.append(report['classification'])
    event_factors = []
    for event in evidence.get('events', []):
        previous = event.get('previousClose'); cash = event.get('cashDividend')
        expected = 1 - cash / previous if isinstance(previous, (int, float)) and previous > 0 and isinstance(cash, (int, float)) else None
        observed = [r['close'] for r in comparison['ratioSeries'] if r['date'] < event.get('date', '')]
        observed = C.distribution(observed)['median']
        event_factors.append(dict(event=event, expectedFactor=expected, observedFactor=observed,
            difference=observed-expected if observed is not None and expected is not None else None,
            conclusion='supporting_evidence_only'))
    c.update(schemaVersion=2, toolVersion=VERSION, type=kind, candidateKind=kind,
        classification='PROVIDER_REBASE_REQUIRED' if mixed else report['classification'],
        reviewMode='USER_REVIEW', approvalMode='USER_REVIEW', sourceContract=contract, revisionReport=report,
        unitStatuses=statuses, eventFactors=event_factors,
        rawEvidenceHash=C.digest(c['stock']['priceHistory']), contentHash=content_hash(rows, contract),
        technicalPreview=after, technicalBefore=before,
        technicalDiff={k: dict(before=before[k], after=after[k], changed=before[k] != after[k]) for k in before},
        originalAIJudgmentPolicy='preserve_original_needs_review',
        states=['revision_suspected', 'revision_candidate', 'revision_validated', 'revision_review_required'])
    c['blockers'] = sorted(set(c['blockers'] + blockers))
    c['unitContract']={p:dict(currency=u.get('price',{}).get('currency'),priceUnit=u.get('price',{}).get('unit'),
        volumeUnit=u.get('volume',{}).get('unit'),amountUnit=u.get('amount',{}).get('unit'),
        lotShareSemantics=dict(normalizedUnit=u.get('volume',{}).get('unit'),rawToNormalizedScale=u.get('volume',{}).get('scale')),
        statuses=statuses.get(p,{})) for p,u in contract['units'].items()}
    changed_dates=sorted({d['date'] for item in comparison['fields'].values() for d in item['differences']} |
        set(comparison['oldOnlyDates']) | set(comparison.get('historicalAddedDates',[])))
    price_revision=any(comparison['fields'][k]['differenceCount'] for k in PRICE)
    c.update(previousVersion=req['base']['marketDataFreshness'].get('dataContentVersion') or
        req['base']['marketDataFreshness'].get('dataVersion') or req['baseHash'],
        candidateVersion=c['contentHash'],sourceContractVersion=2,
        revisionType='historical_price_revision' if price_revision else 'historical_content_revision',
        triggerEvidence=dict(classification=report['classification'],probeWindow=report.get('probeWindow')),
        changedDates=changed_dates,fieldDiffSummary=comparison['fields'],ratioSummary=comparison['ratioSummary'],
        corporateActionEvidence=event_factors,unitEvidence=copy.deepcopy(evidence.get('units',{})),
        technicalDiffSummary={k:dict(before=before[k],after=after[k],changed=before[k]!=after[k]) for k in ('indicators','technicalData','crossovers')},
        revisionEvidence=dict(sameProviderRevisionDetected=report.get('sameProviderRevisionDetected',False),
            corporateActionEvidence=event_factors,causation='supporting_evidence_only; old raw data may be unavailable'),
        approvalStatus='pending_user_review')
    c['applyAllowed'] = False
    c['validationStatus'] = 'invalid' if c['blockers'] else 'review_required'
    c['state'] = 'revision_review_required'
    c['reviewItems'] = sorted(set(c['reviewItems'] + ['revision_evidence_review', 'technical_diff_review']))
    c['warnings'] += ['same_source_history_revision' if kind == 'same_provider_revision' else 'mixed_baseline_requires_provider_selection']
    c['stock']['technicalIndicators'] = copy.deepcopy(after['indicators'])
    c['stock']['technicalData'] = copy.deepcopy(after['technicalData'])
    c['stock']['marketDataFreshness']['sourceContract'] = contract
    technical_version = C.digest(dict(contentHash=c['contentHash'], technical=after))
    for target in (c['stock']['marketDataFreshness'], c['stock']['technicalIndicators'], c['stock']['technicalData']):
        target.update(dataContentVersion=c['contentHash'], technicalVersion=technical_version,
            latestCompleteBar=rows[-1]['date'])
    if evidence.get('validationProfile') == E.PROFILE:
        finalize_evidence(c, req, rows, contract, evidence)
    c['approvalPackageHash'] = C.digest(c)
    c['candidateHash'] = C.digest(c)
    c['candidateId'] = 'rebase_' + c['candidateHash']
    return c


def verify(c):
    body = {k: v for k, v in c.items() if k not in ('candidateHash', 'candidateId', 'approvalPackageHash')}
    if C.digest(body) != c.get('approvalPackageHash'):
        raise ValueError('approval_package_hash_mismatch')
    if content_hash(c['stock']['priceHistory'], c['sourceContract']) != c.get('contentHash'):
        raise ValueError('content_hash_mismatch')
    if not valid_contract(c['sourceContract']):
        raise ValueError('SOURCE_CONTRACT_MISMATCH')
    if any(canonical(r['provider'])!=c['sourceContract']['canonicalProvider'] or canonical(r.get('rawProviderId',r['provider']))!=c['sourceContract']['canonicalProvider'] for r in c['stock']['priceHistory']):raise ValueError('SOURCE_CONTRACT_MISMATCH')
    return c


def finalize_evidence(c, req, rows, contract, evidence):
    old = req['base']['priceHistory']
    statuses, blocked = E.units_gate(contract, old, evidence, c['revisionReport'].get('comparison', {}), rows)
    volume = E.volume_review(old, rows, contract, evidence)
    guards = E.guard_gate(evidence)
    c['schemaVersion'] = 3
    c['validationProfile'] = E.PROFILE
    c['guardImplementationHash'] = evidence.get('guardImplementationHash')
    c['unitStatuses'] = statuses
    c['volumeValidation'] = volume
    c['guardDelivery'] = guards
    c['blockers'] = [b for b in c['blockers'] if b not in ('UNIT_CONTRACT_INCOMPLETE', 'VOLUME_DIFFERENCE_UNEXPLAINED', 'writer_deployment_not_confirmed')]
    if volume['unvalidatedDates']: blocked.append('VOLUME_DIFFERENCE_UNEXPLAINED')
    if guards['missingPaths']: blocked.append('writer_deployment_not_confirmed')
    if evidence.get('guardImplementationHash') != E.implementation_hash(): blocked.append('guard_implementation_changed')
    complete = E.technical_complete(c['technicalPreview'], len(rows))
    if not complete: blocked.append('TECHNICAL_PREVIEW_INCOMPLETE')
    c['technicalValidation'] = dict(complete=complete, unsupported=['price_action_classifier', 'volume_spike_classifier', 'price_volume_relationship_classifier', 'amount_facts'])
    c['blockers'] = sorted(set(c['blockers'] + blocked))
    changed_price = any(v['differenceCount'] for k,v in c['fieldDiffSummary'].items() if k in PRICE)
    changed_volume = bool(volume['changedDates'])
    c['revisionCategories'] = (['MULTI_FIELD_REVISION', 'PRICE_HISTORY_REVISION', 'VOLUME_HISTORY_REVISION'] if changed_price and changed_volume else ['PRICE_HISTORY_REVISION'] if changed_price else ['VOLUME_HISTORY_REVISION'] if changed_volume else [])
    meta = evidence.get('providerMetadata', {})
    if meta.get('canonicalField') == E.FIELDS.get(contract['canonicalProvider'], {}).get('volume') and meta.get('unusedField') and not E.equal(meta.get('canonicalValue'), meta.get('unusedValue')):
        c['revisionCategories'].append('PROVIDER_META_INCONSISTENCY')
        c['warnings'].append('KNOWN_PROVIDER_INCONSISTENCY')
    c['reviewItems'] = sorted(set(c['reviewItems'] + (['exchange_validated_volume_revision_review'] if changed_volume else [])))
    c['targetProviderConfirmation'] = evidence.get('providerConfirmation', {})
    if c['targetProviderConfirmation'].get('provider') != contract['canonicalProvider'] or c['targetProviderConfirmation'].get('symbol') != contract['symbol']:
        c['blockers'].append('provider_confirmation_required')
    c['validationStatus'] = 'invalid' if c['blockers'] else 'review_required'
    c['approvalReadiness'] = 'BLOCKED' if c['blockers'] else 'READY_FOR_USER_APPROVAL'
