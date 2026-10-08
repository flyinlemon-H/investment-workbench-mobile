"""Lossless, versioned market facts encoding. Legacy digest is intentionally unchanged."""
import hashlib
import json
import math
import re
from datetime import date
from decimal import Decimal

VERSION = 'MARKET_DATA_CANONICAL_SERIALIZATION_V1'
SAFE = 9007199254740991
FIELDS = ('priceHistory', 'technicalIndicators', 'technicalData', 'marketDataFreshness')


def number(text):
    if len(text) > 2048 or not re.fullmatch(r'-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?', text):
        raise ValueError('canonical_invalid_number')
    d = Decimal(text)
    sign, digits, exponent = d.as_tuple()
    if abs(exponent) > 10000 or len(digits) > 1024:
        raise ValueError('canonical_number_limit')
    coefficient = ''.join(map(str, digits)).lstrip('0')
    if not coefficient:
        return 'd0e0'
    while coefficient.endswith('0'):
        coefficient = coefficient[:-1]
        exponent += 1
    return 'd' + ('-' if sign else '') + coefficient + 'e' + str(exponent)


def _pairs(pairs):
    result = {}
    for k, v in pairs:
        if k in result:
            raise ValueError('canonical_duplicate_key')
        result[k] = v
    return result


def loads(text):
    if len(text) > 12000000:
        raise ValueError('canonical_size_limit')
    return json.loads(text, parse_int=Decimal, parse_float=Decimal,
                      parse_constant=lambda _: (_ for _ in ()).throw(ValueError('canonical_nonfinite')),
                      object_pairs_hook=_pairs)


def encode(value, depth=0):
    if depth > 64:
        raise ValueError('canonical_depth_limit')
    if value is None:
        return 'n'
    if isinstance(value, bool):
        return 't' if value else 'f'
    if isinstance(value, Decimal):
        return number(str(value))
    if isinstance(value, (int, float)):
        if (isinstance(value, float) and not math.isfinite(value)):
            raise ValueError('canonical_nonfinite')
        if abs(value) > SAFE and (isinstance(value, int) or value.is_integer()):
            raise ValueError('canonical_unsafe_number_use_lossless_json')
        return number(str(value))
    if isinstance(value, str):
        return 's' + value.encode('utf-8', errors='strict').hex()
    if isinstance(value, list):
        return '[' + ','.join(encode(x, depth+1) for x in value) + ']'
    if isinstance(value, dict) and all(isinstance(k, str) for k in value):
        return '{' + ','.join(encode(k) + ':' + encode(value[k], depth+1)
                              for k in sorted(value, key=lambda s: s.encode('utf-8'))) + '}'
    raise ValueError('canonical_unsupported_type')


def digest(value):
    return hashlib.sha256((VERSION + '\n' + encode(value)).encode('ascii')).hexdigest()


def load_native(text):
    """Accept native-number delivery only if parsing loses no decimal information."""
    exact = loads(text)
    native = json.loads(text, object_pairs_hook=_pairs)
    if digest(exact) != digest(native):
        raise ValueError('canonical_lossy_numeric_transport')
    return native


def facts(stock):
    if not isinstance(stock, dict) or set(stock) != set(FIELDS):
        raise ValueError('canonical_fact_fields')
    rows = stock['priceHistory']
    if not isinstance(rows, list) or not rows or len(rows) > 3000:
        raise ValueError('canonical_bars')
    previous = ''
    for row in rows:
        day = row.get('date')
        if not isinstance(day, str) or not re.fullmatch(r'[0-9]{4}-[0-9]{2}-[0-9]{2}', day) or date.fromisoformat(day).isoformat() != day or day <= previous:
            raise ValueError('canonical_bar_order_or_date')
        previous = day
    return stock


def facts_hash(stock):
    return digest(facts(stock))


def binding(base, legacy_hash):
    return dict(canonicalSerializationVersion=VERSION, canonicalContentHash=facts_hash(base),
                legacyBaseHash=legacy_hash, expectedCurrentVersion=legacy_hash,
                sourceContractHash=digest({'present': 'sourceContract' in base['marketDataFreshness'],
                    'value': base['marketDataFreshness'].get('sourceContract')}))


def verify_binding(candidate, base):
    expected = binding(base, candidate['baseHash'])
    if candidate.get('baselineBinding') != expected:
        raise ValueError('canonical_baseline_binding_mismatch')
    return expected
