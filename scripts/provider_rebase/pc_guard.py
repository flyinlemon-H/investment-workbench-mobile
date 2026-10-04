"""Standalone companion for the PC engine; installed only in a reviewed release.

Keep this dependency-free so the legacy direct CLI cannot bypass continuity by
omitting the workbench adapter. No import-time I/O, network, or schema changes.
"""
from .revision import require_stable
from .evidence import accepted as unit_accepted

def check(existing,bars,selected):
    return require_stable(existing,[b.to_dict() for b in bars if b.is_complete_bar],selected)

def update_contract(stock,selected):
    contract=(stock.get('marketDataFreshness') or {}).get('sourceContract')
    if contract and (contract.get('canonicalProvider')!=selected or contract.get('adjustment')!='qfq' or contract.get('priceBasis')!='adjusted'):
        raise ValueError('provider_mismatch')

def indicator_rows(stock,rows,selected):
    contract=(stock.get('marketDataFreshness') or {}).get('sourceContract')
    if not contract:return rows
    unit=contract.get('units',{}).get(selected,{}).get('volume',{})
    scale=unit.get('scale')
    if not unit_accepted(unit) or unit.get('unit')!='shares' or not isinstance(scale,(int,float)) or not 0<scale<float('inf'):
        raise ValueError('volume_units_unconfirmed')
    return [{**r,'volume':r['volume']*scale if r.get('volume') is not None else None} for r in rows]
