"""Build, never install, the companion patch against an explicitly read PC file."""
import difflib
import hashlib
from pathlib import Path

def build(source_root):
    path=Path(source_root)/'src/market_data/updater.py';before=path.read_text(encoding='utf-8')
    after=before
    edits=[
        ('"technicalIndicators": stock.get("technicalIndicators") or {}})', '"technicalIndicators": stock.get("technicalIndicators") or {}, "technicalData": stock.get("technicalData") or {}})'),
        ('from .provider import DailyBar, ProviderChain','from .provider import DailyBar, ProviderChain, EastMoneyDailyProvider, YahooDailyProvider'),
        ('from .symbols import normalize_symbol','from .symbols import normalize_symbol\nfrom .continuity_guard import check as continuity_check, update_contract, indicator_rows'),
        ('            merged, added = merge_price_history(existing, bars)','            update_contract(stock, provider)\n            merged, added = merge_price_history(existing, bars)'),
        ('            bars, provider, provider_errors = chain.fetch_daily(info, fetch_start, fetch_end)',
         '            selected_chain = chain\n            contract = (stock.get("marketDataFreshness") or {}).get("sourceContract")\n            if contract and provider_chain is None:\n                classes = {"eastmoney": EastMoneyDailyProvider, "yahoo": YahooDailyProvider}\n                pinned = contract.get("canonicalProvider")\n                if pinned not in classes:\n                    raise ValueError("provider_mismatch")\n                selected_chain = ProviderChain([classes[pinned]()])\n            bars, provider, provider_errors = selected_chain.fetch_daily(info, fetch_start, fetch_end)'),
        ('    by_date = {str(row.get("date")):', '    if bars:\n        continuity_check(existing, bars, bars[0].provider)\n    by_date = {str(row.get("date")):'),
        ('            indicators = calculate_indicators(complete)',
         '            indicators = calculate_indicators(indicator_rows(stock, complete, provider))\n            if (stock.get("marketDataFreshness") or {}).get("sourceContract"):\n                indicators["dataVersion"] = stock["marketDataFreshness"].get("dataVersion")\n                indicators["ma120"] = round(sum(r["close"] for r in complete[-120:]) / 120, 6) if len(complete) >= 120 else None'),
        ('            stock["marketDataFreshness"] = freshness','            for key in ("sourceContract", "sourceMigration", "dataVersion"):\n                if key in (stock.get("marketDataFreshness") or {}):\n                    freshness[key] = stock["marketDataFreshness"][key]\n            stock["marketDataFreshness"] = freshness'),
    ]
    for old,new in edits:
        if after.count(old)!=1:raise ValueError('pc_source_baseline_changed')
        after=after.replace(old,new,1)
    # A failed task reports failure; it must not mutate the last valid freshness.
    lines=after.splitlines(keepends=True)
    lines=[line for line in lines if not ('stock["marketDataFreshness"] = {**' in line and '"kline_status": "failed"' in line)]
    after=''.join(lines)
    after+='\nfrom . import provider as _revision_provider\nfrom .provider_rebase.integration import guarded_updater as _guarded_updater\nupdate_market_data = _guarded_updater(update_market_data, _revision_provider)\n'
    guard=Path(__file__).with_name('pc_guard.py').read_text(encoding='utf-8').replace('from .revision import require_stable','from .provider_rebase.revision import require_stable').replace('from .evidence import accepted','from .provider_rebase.evidence import accepted')
    patch=''.join(difflib.unified_diff(before.splitlines(True),after.splitlines(True),fromfile='a/src/market_data/updater.py',tofile='b/src/market_data/updater.py'))
    patch+=''.join(difflib.unified_diff([],guard.splitlines(True),fromfile='/dev/null',tofile='b/src/market_data/continuity_guard.py'))
    shared={name:Path(__file__).with_name(name).read_text(encoding='utf-8') for name in ('__init__.py','core.py','revision.py','store.py','integration.py','fetch.py','evidence.py','deployment.py','remote.py','canonical.py')}
    for name,text in shared.items():
        patch+=''.join(difflib.unified_diff([],text.splitlines(True),fromfile='/dev/null',tofile='b/src/market_data/provider_rebase/'+name))
    return dict(baseSha256=hashlib.sha256(path.read_bytes()).hexdigest(),updatedSource=after,guardSource=guard,sharedSources=shared,patch=patch)
