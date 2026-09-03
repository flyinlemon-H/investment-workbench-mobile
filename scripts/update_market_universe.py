from __future__ import annotations

import argparse
import copy
import hashlib
import importlib
import json
import os
import re
import shutil
import sys
import tempfile
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable

SCHEMA_VERSION = 1
REGISTRY_SCHEMA_VERSION = 1
CHECKSUM_ALGORITHM = "SHA-256"
SYMBOL_PATTERN = re.compile(r"^(?:\d{6}\.(?:SS|SZ)|\d{4,5}\.HK)$")
MARKET_FACT_FIELDS = ("priceHistory", "marketDataFreshness", "technicalIndicators")


try:
    from .market_symbol_contract import canonical_symbol
except ImportError:
    from market_symbol_contract import canonical_symbol


def canonical_json(value: object) -> str:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def manifest_checksum(payload_without_checksum: dict[str, Any]) -> str:
    return hashlib.sha256(canonical_json(payload_without_checksum).encode("utf-8")).hexdigest()


@dataclass(frozen=True)
class ManifestValidation:
    accepted: bool
    payload: dict[str, Any] | None
    revision: int
    symbol_count: int
    invalid_symbol_count: int
    error: str


def validate_manifest(payload: object) -> ManifestValidation:
    if not isinstance(payload, dict):
        return ManifestValidation(False, None, 0, 0, 0, "manifest must be an object")
    if payload.get("schemaVersion") != SCHEMA_VERSION:
        return ManifestValidation(False, None, 0, 0, 0, "unsupported schemaVersion")
    revision = payload.get("revision")
    if not isinstance(revision, int) or isinstance(revision, bool) or revision < 1:
        return ManifestValidation(False, None, 0, 0, 0, "revision must be a positive integer")
    generated_at = payload.get("generatedAt")
    try:
        if not isinstance(generated_at, str) or not generated_at.endswith("Z"):
            raise ValueError
        datetime.fromisoformat(generated_at.replace("Z", "+00:00"))
    except ValueError:
        return ManifestValidation(False, None, revision, 0, 0, "generatedAt must be an ISO UTC timestamp")
    symbols = payload.get("symbols")
    if not isinstance(symbols, list):
        return ManifestValidation(False, None, revision, 0, 0, "symbols must be an array")
    if set(payload) - {"schemaVersion", "generatedAt", "revision", "symbols", "checksum"}:
        return ManifestValidation(False, None, revision, 0, 0, "manifest contains unsupported fields")
    checksum = payload.get("checksum")
    if not isinstance(checksum, dict) or checksum.get("algorithm") != CHECKSUM_ALGORITHM:
        return ManifestValidation(False, None, revision, 0, 0, "checksum metadata is invalid")
    checksum_value = str(checksum.get("value") or "").lower()
    raw_unsigned = {"schemaVersion": SCHEMA_VERSION, "generatedAt": generated_at, "revision": revision, "symbols": symbols}
    if not re.fullmatch(r"[0-9a-f]{64}", checksum_value) or checksum_value != manifest_checksum(raw_unsigned):
        return ManifestValidation(False, None, revision, 0, 0, "checksum mismatch")
    normalized: list[dict[str, Any]] = []
    invalid = 0
    seen: set[str] = set()
    for record in symbols:
        if not isinstance(record, dict) or set(record) - {"symbol", "active", "displayName", "market", "type"}:
            invalid += 1
            continue
        symbol = canonical_symbol(record.get("symbol"))
        if not symbol or not SYMBOL_PATTERN.fullmatch(symbol) or record.get("active") is not True or symbol in seen:
            invalid += 1
            continue
        seen.add(symbol)
        row: dict[str, Any] = {"symbol": symbol, "active": True}
        display_name = str(record.get("displayName") or "").strip()
        if display_name:
            row["displayName"] = display_name[:120]
        normalized.append(row)
    if invalid:
        return ManifestValidation(False, None, revision, len(normalized), invalid, "manifest contains invalid or duplicate symbols")
    normalized.sort(key=lambda row: row["symbol"])
    unsigned = {
        "schemaVersion": SCHEMA_VERSION,
        "generatedAt": generated_at,
        "revision": revision,
        "symbols": normalized,
    }
    return ManifestValidation(True, {**unsigned, "checksum": {"algorithm": CHECKSUM_ALGORITHM, "value": checksum_value}}, revision, len(normalized), 0, "")


def discover_manifest(inbox: Path) -> tuple[dict[str, Any] | None, dict[str, Any]]:
    diagnostics: dict[str, Any] = {
        "manifest_discovered": False,
        "manifest_revision": 0,
        "accepted": False,
        "symbol_count": 0,
        "invalid_symbol_count": 0,
        "rejected_count": 0,
        "error": "",
    }
    if not inbox.exists():
        return None, diagnostics
    candidates: list[tuple[int, str, str, dict[str, Any]]] = []
    for path in sorted(inbox.glob("*.json")):
        diagnostics["manifest_discovered"] = True
        try:
            payload = json.loads(path.read_text(encoding="utf-8-sig"))
            result = validate_manifest(payload)
        except Exception as exc:  # malformed input must not stop the market update.
            diagnostics["rejected_count"] += 1
            diagnostics["error"] = f"{path.name}: {exc}"
            continue
        diagnostics["invalid_symbol_count"] += result.invalid_symbol_count
        if not result.accepted or result.payload is None:
            diagnostics["rejected_count"] += 1
            diagnostics["error"] = f"{path.name}: {result.error}"
            continue
        candidates.append((result.revision, result.payload["generatedAt"], path.name, result.payload))
    if not candidates:
        return None, diagnostics
    revision, _generated_at, _name, payload = max(candidates, key=lambda row: (row[0], row[1], row[2]))
    diagnostics.update(manifest_revision=revision, accepted=True, symbol_count=len(payload["symbols"]), error="")
    return payload, diagnostics


def empty_registry() -> dict[str, Any]:
    return {"schemaVersion": REGISTRY_SCHEMA_VERSION, "updatedAt": "", "lastManifest": None, "symbols": []}


def load_registry(path: Path) -> dict[str, Any]:
    if not path.exists():
        return empty_registry()
    payload = json.loads(path.read_text(encoding="utf-8-sig"))
    if not isinstance(payload, dict) or payload.get("schemaVersion") != REGISTRY_SCHEMA_VERSION or not isinstance(payload.get("symbols"), list):
        raise ValueError("market universe registry is malformed")
    normalized = empty_registry()
    normalized["updatedAt"] = str(payload.get("updatedAt") or "")
    normalized["lastManifest"] = payload.get("lastManifest") if isinstance(payload.get("lastManifest"), dict) else None
    seen: set[str] = set()
    for record in payload["symbols"]:
        if not isinstance(record, dict):
            raise ValueError("market universe registry contains a malformed record")
        symbol = canonical_symbol(record.get("symbol"))
        if not symbol or symbol in seen:
            raise ValueError("market universe registry contains an invalid or duplicate symbol")
        seen.add(symbol)
        facts = record.get("marketFacts") if isinstance(record.get("marketFacts"), dict) else {}
        normalized["symbols"].append({
            "symbol": symbol,
            "active": True,
            "displayName": str(record.get("displayName") or "")[:120],
            "addedAt": str(record.get("addedAt") or ""),
            "marketFacts": {field: copy.deepcopy(facts.get(field) or ([] if field == "priceHistory" else {})) for field in MARKET_FACT_FIELDS},
        })
    normalized["symbols"].sort(key=lambda row: row["symbol"])
    return normalized


def merge_additions(registry: dict[str, Any], rows: list[dict[str, Any]], now: str) -> tuple[int, int]:
    known = {record["symbol"]: record for record in registry["symbols"]}
    added = 0
    already_known = 0
    for incoming in rows:
        symbol = incoming["symbol"]
        if symbol in known:
            already_known += 1
            if incoming.get("displayName") and not known[symbol].get("displayName"):
                known[symbol]["displayName"] = incoming["displayName"]
            continue
        known[symbol] = {
            "symbol": symbol, "active": True,
            "displayName": incoming.get("displayName", ""), "addedAt": now,
            "marketFacts": {"priceHistory": [], "marketDataFreshness": {}, "technicalIndicators": {}},
        }
        added += 1
    registry["symbols"] = [known[symbol] for symbol in sorted(known)]
    if rows:
        registry["updatedAt"] = now
    return added, already_known


def ingest_manifest(registry: dict[str, Any], manifest: dict[str, Any] | None, now: str) -> tuple[int, int]:
    if not manifest:
        return 0, 0
    result = merge_additions(registry, manifest["symbols"], now)
    registry["lastManifest"] = {
        "revision": manifest["revision"], "generatedAt": manifest["generatedAt"],
        "checksum": manifest["checksum"]["value"],
    }
    registry["updatedAt"] = now
    return result


def portfolio_symbol(stock: dict[str, Any]) -> str:
    return canonical_symbol(stock.get("code") or stock.get("symbol"))


def is_cash(stock: dict[str, Any]) -> bool:
    return str(stock.get("role") or "").strip() == "现金" or str(stock.get("theme") or "").strip() == "现金"


def build_update_state(portfolio: dict[str, Any], registry: dict[str, Any]) -> tuple[dict[str, Any], set[str], set[str]]:
    update_stocks: list[dict[str, Any]] = []
    portfolio_symbols: set[str] = set()
    for stock in portfolio.get("stocks") or []:
        if not isinstance(stock, dict) or is_cash(stock):
            continue
        symbol = portfolio_symbol(stock)
        if not symbol:
            continue
        clone = copy.deepcopy(stock)
        clone["code"] = symbol
        update_stocks.append(clone)
        portfolio_symbols.add(symbol)
    registry_only: set[str] = set()
    for record in registry["symbols"]:
        symbol = record["symbol"]
        if symbol in portfolio_symbols:
            continue
        facts = record.get("marketFacts") or {}
        update_stocks.append({
            "code": symbol,
            "name": record.get("displayName") or symbol,
            "marketOnly": True,
            **{field: copy.deepcopy(facts.get(field) or ([] if field == "priceHistory" else {})) for field in MARKET_FACT_FIELDS},
        })
        registry_only.add(symbol)
    update_stocks.sort(key=lambda stock: stock["code"])
    return {"stocks": update_stocks}, portfolio_symbols, registry_only


def apply_updated_facts(portfolio: dict[str, Any], registry: dict[str, Any], update_state: dict[str, Any]) -> None:
    updated = {portfolio_symbol(stock): stock for stock in update_state["stocks"] if portfolio_symbol(stock)}
    for stock in portfolio.get("stocks") or []:
        if not isinstance(stock, dict) or is_cash(stock):
            continue
        source = updated.get(portfolio_symbol(stock))
        if source:
            for field in MARKET_FACT_FIELDS:
                stock[field] = copy.deepcopy(source.get(field) or ([] if field == "priceHistory" else {}))
    for record in registry["symbols"]:
        source = updated.get(record["symbol"])
        if source:
            record["marketFacts"] = {field: copy.deepcopy(source.get(field) or ([] if field == "priceHistory" else {})) for field in MARKET_FACT_FIELDS}


def bridge_payload(update_state: dict[str, Any], generated_at: str) -> dict[str, Any]:
    rows = []
    seen: set[str] = set()
    for stock in update_state.get("stocks") or []:
        symbol = portfolio_symbol(stock)
        if not symbol or symbol in seen:
            continue
        seen.add(symbol)
        if stock.get("priceHistory") or stock.get("marketDataFreshness"):
            rows.append({"symbol": symbol, **{field: copy.deepcopy(stock.get(field) or ([] if field == "priceHistory" else {})) for field in MARKET_FACT_FIELDS}})
    rows.sort(key=lambda row: row["symbol"])
    return {"generatedAt": generated_at, "stocks": rows}


def _stage_json(path: Path, payload: dict[str, Any]) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    descriptor, name = tempfile.mkstemp(prefix=f".{path.name}.", suffix=".tmp", dir=path.parent)
    staged = Path(name)
    try:
        with os.fdopen(descriptor, "w", encoding="utf-8", newline="\n") as handle:
            json.dump(payload, handle, ensure_ascii=False, indent=2)
            handle.write("\n")
            handle.flush()
            os.fsync(handle.fileno())
        json.loads(staged.read_text(encoding="utf-8"))
        return staged
    except Exception:
        staged.unlink(missing_ok=True)
        raise


def transactional_write_json(targets: list[tuple[Path, dict[str, Any]]], timestamp: str) -> list[Path]:
    staged: list[tuple[Path, Path]] = []
    try:
        for path, payload in targets:
            staged.append((path, _stage_json(path, payload)))
    except Exception:
        for _path, temp in staged:
            temp.unlink(missing_ok=True)
        raise
    backups: list[tuple[Path, Path | None]] = []
    installed: list[Path] = []
    try:
        for path, _temp in staged:
            if path.exists():
                backup_dir = path.parent / "backups"
                backup_dir.mkdir(parents=True, exist_ok=True)
                backup = backup_dir / f"{path.stem}_before_market_update_{timestamp}{path.suffix}"
                shutil.copy2(path, backup)
                backups.append((path, backup))
            else:
                backups.append((path, None))
        for path, temp in staged:
            os.replace(temp, path)
            installed.append(path)
            json.loads(path.read_text(encoding="utf-8-sig"))
        return [backup for _path, backup in backups if backup]
    except Exception:
        for path, backup in reversed(backups):
            if backup and backup.exists():
                shutil.copy2(backup, path)
            elif path in installed:
                path.unlink(missing_ok=True)
        raise
    finally:
        for _path, temp in staged:
            temp.unlink(missing_ok=True)


def write_bridge(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    content = "window.MARKET_DATA_BRIDGE = " + json.dumps(payload, ensure_ascii=False, separators=(",", ":")) + ";\n"
    descriptor, name = tempfile.mkstemp(prefix=f".{path.name}.", suffix=".tmp", dir=path.parent)
    temp = Path(name)
    try:
        with os.fdopen(descriptor, "w", encoding="utf-8", newline="\n") as handle:
            handle.write(content)
            handle.flush()
            os.fsync(handle.fileno())
        if not temp.read_text(encoding="utf-8").startswith("window.MARKET_DATA_BRIDGE = {"):
            raise ValueError("bridge validation failed")
        os.replace(temp, path)
    finally:
        temp.unlink(missing_ok=True)


def load_portfolio(path: Path) -> dict[str, Any]:
    payload = json.loads(path.read_text(encoding="utf-8-sig"))
    if not isinstance(payload, dict) or not isinstance(payload.get("stocks"), list):
        raise ValueError("formal portfolio data is malformed")
    return payload


def load_source_updater(source_root: Path) -> Callable[..., list[dict[str, Any]]]:
    source_text = str(source_root)
    if source_text not in sys.path:
        sys.path.insert(0, source_text)
    module = importlib.import_module("src.market_data.updater")
    return module.update_market_data


def run_update(
    *,
    formal_path: Path,
    registry_path: Path,
    inbox_path: Path,
    bridge_path: Path,
    update_function: Callable[..., list[dict[str, Any]]],
    dry_run: bool = False,
    cloud_fetch: Callable[[], dict[str, Any]] | None = None,
    now: datetime | None = None,
) -> dict[str, Any]:
    moment = now or datetime.now(timezone.utc)
    now_iso = moment.isoformat().replace("+00:00", "Z")
    portfolio = load_portfolio(formal_path)
    registry = load_registry(registry_path)
    # Called by the PowerShell runner while its existing market_update.lock is held.
    # A cloud failure is a warning, never an empty replacement of the local set.
    cloud = {"status": "not_configured", "rows": [], "code": "not_configured"}
    if cloud_fetch:
        try:
            cloud = cloud_fetch()
        except Exception:
            cloud = {"status": "error", "rows": [], "code": "cloud_error"}
    cloud_added, cloud_known = merge_additions(registry, cloud["rows"], now_iso) if cloud["status"] == "success" else (0, 0)
    manifest, diagnostics = discover_manifest(inbox_path)
    newly_added, already_known = ingest_manifest(registry, manifest, now_iso)
    diagnostics.update(newly_added=newly_added, already_known=already_known,
                       cloud_status=cloud["status"], cloud_code=cloud["code"],
                       cloud_newly_added=cloud_added, cloud_already_known=cloud_known)
    ingestion_backups = []
    if not dry_run and (newly_added or cloud_added):
        # Membership acceptance survives a later market-provider exception.
        ingestion_backups = transactional_write_json(
            [(registry_path, registry)], moment.strftime("%Y%m%d_%H%M%S") + "_universe")
    update_state, portfolio_symbols, registry_only = build_update_state(portfolio, registry)
    results = update_function(update_state, symbols=None)
    apply_updated_facts(portfolio, registry, update_state)
    if results:
        registry["updatedAt"] = now_iso
    payload = bridge_payload(update_state, now_iso)
    backups: list[Path] = ingestion_backups
    if not dry_run and results:
        timestamp = moment.astimezone().strftime("%Y%m%d_%H%M%S")
        backups += transactional_write_json(
            [(formal_path, portfolio), (registry_path, registry)],
            timestamp,
        )
        write_bridge(bridge_path, payload)
    success = sum(1 for row in results if row.get("success"))
    failed = len(results) - success
    latest_dates = sorted(str(row.get("latest_trade_date") or "") for row in results if row.get("latest_trade_date"))
    return {
        "diagnostics": diagnostics,
        "registry_write_success": bool(not dry_run and (results or newly_added or cloud_added)),
        "portfolio_symbol_count": len(portfolio_symbols),
        "registry_only_symbol_count": len(registry_only),
        "symbols": len(results),
        "success": success,
        "failed": failed,
        "latest_trade_date": latest_dates[-1] if latest_dates else "",
        "write_status": "dry-run" if dry_run else ("success" if results else "skipped"),
        "bridge_status": "dry-run" if dry_run else ("success" if results else "skipped"),
        "generated_at": payload["generatedAt"],
        "delivered_stock_count": len(payload["stocks"]),
        "results": results,
        "backups": [str(path) for path in backups],
        "registry": registry,
        "portfolio": portfolio,
        "bridge": payload,
    }


def parser() -> argparse.ArgumentParser:
    result = argparse.ArgumentParser(description="Ingest the mobile add-only universe and update authoritative market facts.")
    result.add_argument("--source-root", required=True)
    result.add_argument("--workbench-root", required=True)
    result.add_argument("--inbox")
    result.add_argument("--registry")
    result.add_argument("--formal")
    result.add_argument("--bridge")
    result.add_argument("--dry-run", action="store_true")
    return result


def main(argv: list[str] | None = None) -> int:
    args = parser().parse_args(argv)
    source_root = Path(args.source_root).resolve()
    workbench_root = Path(args.workbench_root).resolve()
    inbox = Path(args.inbox).resolve() if args.inbox else source_root.parent / "investment-workbench-mobile-sync" / "inbox"
    registry = Path(args.registry).resolve() if args.registry else inbox.parent / "market_universe.json"
    formal = Path(args.formal).resolve() if args.formal else source_root / "data" / "latest_export.json"
    bridge = Path(args.bridge).resolve() if args.bridge else workbench_root / "data" / "market_data_bridge.js"
    inbox.mkdir(parents=True, exist_ok=True)
    try:
        try:
            from .fetch_cloud_universe import fetch_cloud_universe
        except ImportError:
            from fetch_cloud_universe import fetch_cloud_universe
        summary = run_update(
            formal_path=formal,
            registry_path=registry,
            inbox_path=inbox,
            bridge_path=bridge,
            update_function=load_source_updater(source_root),
            dry_run=args.dry_run,
            cloud_fetch=fetch_cloud_universe,
        )
    except Exception as exc:
        print(f"universeIngestionStatus: failed")
        print(f"universeIngestionError: {exc}")
        print("registryWriteSuccess: false")
        print("symbols: 0\nsuccess: 0\nfailed: 0")
        print("writeStatus: failed")
        print("bridgeStatus: skipped")
        return 1
    diagnostic = summary["diagnostics"]
    print(f"cloudUniverseStatus: {diagnostic['cloud_status']}")
    print(f"cloudUniverseCode: {diagnostic['cloud_code']}")
    print(f"cloudUniverseAdded: {diagnostic['cloud_newly_added']}")
    print(f"manifestDiscovered: {str(diagnostic['manifest_discovered']).lower()}")
    print(f"manifestRevision: {diagnostic['manifest_revision']}")
    print(f"manifestStatus: {'accepted' if diagnostic['accepted'] else ('rejected' if diagnostic['manifest_discovered'] else 'absent')}")
    print(f"manifestSymbols: {diagnostic['symbol_count']}")
    print(f"newlyAdded: {diagnostic['newly_added']}")
    print(f"alreadyKnown: {diagnostic['already_known']}")
    print(f"invalidSymbols: {diagnostic['invalid_symbol_count']}")
    print(f"rejectedManifests: {diagnostic['rejected_count']}")
    if diagnostic["error"]:
        print(f"manifestDiagnostic: {diagnostic['error']}")
    print(f"registryWriteSuccess: {str(summary['registry_write_success']).lower()}")
    print(f"portfolioSymbols: {summary['portfolio_symbol_count']}")
    print(f"registryOnlySymbols: {summary['registry_only_symbol_count']}")
    print(f"symbols: {summary['symbols']}")
    print(f"success: {summary['success']}")
    print(f"failed: {summary['failed']}")
    for row in summary["results"]:
        suffix = f"error={row.get('error')}" if row.get("error") else f"current={row.get('current_last_date') or '-'} projected={row.get('latest_trade_date') or '-'} added={row.get('added', 0)} provider={row.get('provider') or '-'} technical_stale={str(bool(row.get('technical_analysis_stale'))).lower()}"
        print(f"{canonical_symbol(row.get('symbol')) or '<invalid>'}: {suffix}")
    print(f"latestTradeDate: {summary['latest_trade_date']}")
    print(f"writeStatus: {summary['write_status']}")
    print(f"bridgeStatus: {summary['bridge_status']}")
    print(f"deliveredGeneratedAt: {summary['generated_at']}")
    print(f"deliveredStockCount: {summary['delivered_stock_count']}")
    if not summary["results"]:
        return 1
    return 0 if summary["failed"] == 0 else 2


if __name__ == "__main__":
    raise SystemExit(main())
