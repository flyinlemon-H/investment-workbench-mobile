"""Isolated calibration policy. Not installed in any production write path.

Eligibility is not permission to write. Production needs a separately approved
server receipt/CAS contract and receiver integration. Never changes revision.py.
"""
from decimal import Decimal
import struct
from . import revision as R, precision_audit as A, evidence as E

VERSION = 'yahoo-hk-adjclose-ulp-pilot-v1'
CALIBRATION = {
    'symbol': '2899.HK', 'overlapBars': 430, 'changedDates': 140,
    'oldRawHash': '17828a59327d0d260187a4d278d871d997dad84caeb6b4048c380736990b870d',
    'observedRawHash': 'b7f83b638ae6dfa3a7e510beee0be7a29d910acbdb5daee4c873d64d446372d9',
    'repeatRawHash': 'a5de09a97052cc8d9b65cf3d7f8f604d615add322092175c1aecd15aa2b7a43d',
    'maxAdjcloseFloat32Steps': 2, 'maxAdjustedPriceDelta': '0.000004',
    'scope': 'single-symbol isolated pilot; not an approval or production policy',
}


def evaluate(old, new, old_contract, contract, *, old_raw=None, new_raw=None,
             old_asof=None, new_asof=None, repeat_raw=None, repeat_asof=None,
             expected_version=None, current_version=None):
    def verdict(tier, reason, **extra):
        return dict(policyVersion=VERSION, tier=tier, reason=reason,
            productionWriteAuthorized=False, **extra)
    if not expected_version or expected_version != current_version:
        return verdict('REVIEW_REQUIRED', 'VERSION_CONFLICT')
    try:
        report = R.inspect(old, new, contract, old_contract)
    except (ValueError, KeyError, TypeError, IndexError, ArithmeticError):
        return verdict('REVIEW_REQUIRED', 'INVALID_HISTORY')
    if report['classification'] == 'STABLE':
        return verdict('NORMAL_UPDATE', 'STABLE_APPEND' if report['comparison']['newOnlyDates'] else 'NO_CHANGE_REQUIRES_CALENDAR_PROOF')
    if report['classification'] != 'SAME_PROVIDER_REVISION':
        return verdict('REVIEW_REQUIRED', report['classification'])
    if contract.get('symbol') != CALIBRATION['symbol'] or contract.get('canonicalProvider') != 'yahoo':
        return verdict('REVIEW_REQUIRED', 'UNCALIBRATED_SCOPE')
    units = contract.get('units', {}).get('yahoo', {})
    if (units.get('price', {}).get('currency') != 'HKD' or units.get('price', {}).get('unit') != 'HKD/share'
            or units.get('volume', {}).get('unit') != 'shares' or any(units.get(k, {}).get('scale') != 1 for k in ('price','volume'))
            or any(not E.accepted(units.get(k, {})) for k in ('price','volume'))):
        return verdict('REVIEW_REQUIRED', 'SOURCE_CONTRACT_MISMATCH')
    if any(report['comparison']['fields'][k]['differenceCount'] for k in ('volume','amount')):
        return verdict('REVIEW_REQUIRED', 'QUANTITY_REVISION')
    if report['comparison']['historicalAddedDates'] or report['comparison']['oldOnlyDates']:
        return verdict('REVIEW_REQUIRED', 'HISTORY_DATE_SET_CHANGED')
    if not old_raw or not new_raw or not old_asof or not new_asof:
        return verdict('REVIEW_REQUIRED', 'RAW_PROVENANCE_REQUIRED')
    if not repeat_raw or not repeat_asof:
        return verdict('REVIEW_REQUIRED', 'REPEAT_OBSERVATION_REQUIRED')
    try:
        left, right = A.trace(old_raw, old_asof), A.trace(new_raw, new_asof)
        repeated=A.trace(repeat_raw, repeat_asof)
        if any(x['symbol']!=contract['symbol'] for x in (left,right,repeated)):
            raise ValueError('RAW_SYMBOL_MISMATCH')
        repeat_diff=A.compare_raw(new_raw,repeat_raw,new_asof,repeat_asof)
        if repeat_diff['rawQuoteChanges'] or repeat_diff['adjcloseChangedDates'] or repeat_diff['summary']['oldOnlyDates'] or repeat_diff['summary']['newOnlyDates']:
            raise ValueError('UNSTABLE_PROVIDER_OBSERVATION')
        for rows, raw in ((old,left),(new,right)):
            if set(raw['rows']) != {b['date'] for b in rows}:raise ValueError('RAW_WINDOW_MISMATCH')
            for bar in rows:
                traced=raw['rows'][bar['date']]
                if any(Decimal(str(bar[k])) != Decimal(str(traced['fields'][k]['production'])) for k in A.PRICE):raise ValueError('RAW_OUTPUT_MISMATCH')
                if (bar.get('volume') is None)!=(traced['volume'] is None) or bar.get('volume') is not None and Decimal(str(bar['volume']))!=Decimal(traced['volume']):raise ValueError('RAW_OUTPUT_MISMATCH')
        diff=A.compare_raw(old_raw,new_raw,old_asof,new_asof)
        if diff['rawQuoteChanges'] or diff['unexplained']:raise ValueError('RAW_QUOTE_CHANGED')
        # Calibrated range is deliberately bounded; more data needs recalibration.
        changed=len(diff['summary']['union'])
        if len(old)<CALIBRATION['overlapBars'] or changed>CALIBRATION['changedDates'] or changed*430>140*len(old):raise ValueError('UNCALIBRATED_REVISION_RANGE')
        for day in diff['adjcloseChangedDates']:
            a,b=(float(x['rows'][day]['adjclose']) for x in (left,right))
            if any(struct.unpack('!f',struct.pack('!f',v))[0]!=v for v in (a,b)):raise ValueError('NON_FLOAT32_ADJCLOSE_CHANGE')
            steps=abs(struct.unpack('!I',struct.pack('!f',a))[0]-struct.unpack('!I',struct.pack('!f',b))[0])
            if steps>CALIBRATION['maxAdjcloseFloat32Steps']:raise ValueError('ADJCLOSE_STEP_EXCEEDED')
        if any(Decimal(x['absoluteDifference'])>Decimal(CALIBRATION['maxAdjustedPriceDelta']) for x in diff['differences']):raise ValueError('PRICE_DELTA_EXCEEDED')
        # Compare on the same dates: new daily bars must not mask revision impact.
        revised=[r for r in new if r['date']<=old[-1]['date']]
        before,after=R.technical_preview(old,old_contract),R.technical_preview(revised,old_contract)
        if before['relationships']!=after['relationships'] or before['crossovers']!=after['crossovers']:
            raise ValueError('TECHNICAL_DECISION_BOUNDARY_CHANGED')
        if before['technicalData']['programRiskFlags']!=after['technicalData']['programRiskFlags']:
            raise ValueError('TECHNICAL_DECISION_BOUNDARY_CHANGED')
        # Convex MA/EMA kernels bound numeric propagation, including one round6
        # quantum for comparing two rounded outputs. Never an equality epsilon.
        d=Decimal(CALIBRATION['maxAdjustedPriceDelta']); q=Decimal('0.000001')
        impact={}
        for key in ('ma5','ma10','ma20','ma60','ma120'):
            impact[key]=str(abs(Decimal(str(before['indicators'][key]))-Decimal(str(after['indicators'][key]))))
            if Decimal(impact[key])>d+q:raise ValueError('TECHNICAL_NUMERIC_BOUND_EXCEEDED')
        for key,multiplier in (('dif',2),('dea',2),('histogram',8)):
            impact[key]=str(abs(Decimal(str(before['indicators']['macd'][key]))-Decimal(str(after['indicators']['macd'][key]))))
            if Decimal(impact[key])>d*multiplier+q:raise ValueError('TECHNICAL_NUMERIC_BOUND_EXCEEDED')
    except (ValueError,KeyError,TypeError,OverflowError) as error:
        allowed={'RAW_SYMBOL_MISMATCH','UNSTABLE_PROVIDER_OBSERVATION','RAW_WINDOW_MISMATCH','RAW_OUTPUT_MISMATCH','RAW_QUOTE_CHANGED','UNCALIBRATED_REVISION_RANGE','NON_FLOAT32_ADJCLOSE_CHANGE','ADJCLOSE_STEP_EXCEEDED','PRICE_DELTA_EXCEEDED','TECHNICAL_DECISION_BOUNDARY_CHANGED','TECHNICAL_NUMERIC_BOUND_EXCEEDED'}
        return verdict('REVIEW_REQUIRED',str(error) if str(error) in allowed else 'PROVENANCE_INVALID')
    return verdict('AUDITED_REVISION', 'CALIBRATED_ADJCLOSE_REVISION',
        changedDates=len(diff['summary']['union']), maxPriceDelta=diff['summary']['absoluteDifference']['max'],
        technicalDecisionImpact='unchanged_on_overlap', retainedRawHashes=[left['rawHash'],right['rawHash'],repeated['rawHash']],
        technicalNumericImpact=impact,
        requiredWriteControls=['server_policy_version','owner_capability','expected_version_cas','immutable_previous_result','audit_receipt','receiver_cas'])
