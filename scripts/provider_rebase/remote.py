"""Operator-only transport for frozen candidates. Never approves or applies.

Canonical strings preserve the reviewed Python byte hashes across JSONB transport.
The server rehashes all strings and checks their structural/fact bindings.
"""
import copy
from . import core as C
from . import revision as R

RPC_VERSION = 'approved-provider-migration-v1'


def capsule(candidate, request):
    c = C.verify(copy.deepcopy(candidate))
    if c['requestId'] != request['requestId'] or C.digest(request['base']) != c['baseHash']:
        raise ValueError('request_binding_mismatch')
    if c['blockers'] or c.get('evidence', {}).get('migrationDeployment', {}).get('rpcVersion') != RPC_VERSION:
        raise ValueError('migration_guard_incompatible')
    contract = c['sourceContract']
    rebuilt=R.candidate(request,contract['rawProviderId'],c['stock']['priceHistory'],contract['providerVersion'],c['generatedAt'],c['evidence'])
    if rebuilt['candidateHash'] != c['candidateHash']:
        raise ValueError('candidate_validation_outdated')
    semantics = {k: contract.get(k) for k in ('symbol', 'canonicalProvider', 'providerVersion',
        'adjustment', 'priceBasis', 'market', 'interval', 'historyWindow', 'normalizationVersion')}
    semantics['units'] = {p: {f: {k: u.get(k) for k in ('unit', 'currency', 'scale')}
        for f, u in fields.items()} for p, fields in contract.get('units', {}).items()}
    body = {k: v for k, v in c.items() if k not in ('candidateId', 'candidateHash')}
    values = dict(candidate=body, package={k: v for k, v in body.items() if k != 'approvalPackageHash'},
        content=dict(bars=R.semantic_rows(c['stock']['priceHistory']), contract=semantics),
        technical=dict(contentHash=c['contentHash'], technical=c['technicalPreview']), base=request['base'])
    result = {k: C.encoded(v).decode('utf-8') for k, v in values.items()}
    return result


def worker_baseline(context, owner, symbol):
    """Only called on the dedicated capability RPC response, never task input."""
    if context is None:
        return None
    if context.get('protocol') != RPC_VERSION or context.get('owner') != owner or context.get('symbol') != symbol:
        raise ValueError('VERSION_CONFLICT')
    if context.get('dailyAdvanced') or not context.get('bundle'):
        return None
    if context.get('status') not in ('applied', 'rolled_back') or not context.get('approvalId') or not context.get('previousVersion'):
        raise ValueError('VERSION_CONFLICT')
    stock = copy.deepcopy(context['bundle'])
    if set(stock) != set(C.FIELDS):
        raise ValueError('VERSION_CONFLICT')
    return stock
