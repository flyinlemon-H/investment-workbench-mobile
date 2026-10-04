"""Explicit local delivery of an active bundle. Never called by generation.

One JSON target is replaced atomically; SQLite remains the version authority.
Each delivery requires expected input hash to prevent stale overwrites. External
writers must be paused/updated before this command (deployment gate in candidate).
"""
import copy
import hashlib
import json
import os
from pathlib import Path
import tempfile
from .core import encoded

def project(store,ticker,path,expected_file_hash,expected_generation):
    active=store.active(ticker)
    if not active or active['generation']!=expected_generation:raise ValueError('generation_conflict')
    path=Path(path);raw=path.read_bytes()
    if hashlib.sha256(raw).hexdigest()!=expected_file_hash:raise ValueError('target_changed')
    doc=json.loads(raw.decode('utf-8-sig'));stocks=doc.get('stocks')
    if not isinstance(stocks,list):raise ValueError('unsupported_projection')
    matches=[s for s in stocks if str(s.get('code') or s.get('symbol') or '').upper()==ticker]
    if len(matches)!=1:raise ValueError('symbol_not_unique_or_missing')
    current=active['bundle']['stock'];stock=matches[0]
    stock.update(copy.deepcopy(current))
    meta=stock.setdefault('marketDataFreshness',{})
    meta['sourceMigration']={**meta.get('sourceMigration',{}),'generation':active['generation'],
        'currentVersion':active['version'],'previousVersion':active['previousVersion'],'quality':active['bundle']['quality']}
    if active['bundle']['quality']!='certified_single_source':meta['continuityStatus']='migration_required'
    descriptor,temp=tempfile.mkstemp(prefix='.rebase-delivery-',suffix='.tmp',dir=path.parent)
    try:
        with os.fdopen(descriptor,'wb') as file:file.write(encoded(doc));file.flush();os.fsync(file.fileno())
        if hashlib.sha256(path.read_bytes()).hexdigest()!=expected_file_hash:raise ValueError('target_changed')
        if store.active(ticker)['generation']!=expected_generation:raise ValueError('generation_conflict')
        os.replace(temp,path)
    finally:
        if os.path.exists(temp):os.unlink(temp)
    return dict(symbol=ticker,version=active['version'],generation=active['generation'],targetHash=hashlib.sha256(path.read_bytes()).hexdigest())
