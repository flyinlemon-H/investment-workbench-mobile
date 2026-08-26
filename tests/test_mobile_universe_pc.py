from __future__ import annotations

import json
import tempfile
import unittest
from datetime import datetime, timezone
from pathlib import Path

from scripts import update_market_universe as universe


def signed_manifest(symbols: list[dict], revision: int = 1) -> dict:
    unsigned = {
        "schemaVersion": 1,
        "generatedAt": "2026-08-26T09:00:00.000Z",
        "revision": revision,
        "symbols": symbols,
    }
    return {**unsigned, "checksum": {"algorithm": "SHA-256", "value": universe.manifest_checksum(unsigned)}}


def fake_update(state: dict, *, symbols=None) -> list[dict]:
    results = []
    for stock in state["stocks"]:
        symbol = stock["code"]
        stock["priceHistory"] = [{
            "date": "2026-08-25", "open": 10.0, "high": 11.0, "low": 9.0, "close": 10.5,
            "volume": 1000.0, "adjustment": "qfq", "price_basis": "adjusted", "provider": "fixture",
            "fetched_at": "2026-08-26T09:00:00Z", "is_complete_bar": True,
        }]
        stock["marketDataFreshness"] = {
            "last_trade_date": "2026-08-25", "fetched_at": "2026-08-26T09:00:00Z", "provider": "fixture",
            "is_complete_bar": True, "kline_status": "current", "technical_analysis_updated_at": "",
            "technical_analysis_stale": True, "provider_errors": [],
        }
        stock["technicalIndicators"] = {
            "updated_at": "2026-08-26T09:00:00Z", "last_trade_date": "2026-08-25", "ma5": 10.5,
            "ma10": None, "ma20": None, "ma60": None,
            "macd": {"dif": None, "dea": None, "histogram": None},
            "volume_change": {"recent_5d_average": None, "previous_5d_average": None, "change_pct": None},
        }
        results.append({
            "symbol": symbol, "success": True, "added": 1, "provider": "fixture", "current_last_date": "",
            "latest_trade_date": "2026-08-25", "error": "", "technical_analysis_stale": True,
        })
    return results


class MobileUniversePcTest(unittest.TestCase):
    def fixture(self, stock_count: int = 1):
        temp = tempfile.TemporaryDirectory()
        root = Path(temp.name)
        formal = root / "source" / "data" / "latest_export.json"
        registry = root / "source" / "data" / "market_universe.json"
        inbox = root / "investment-workbench-mobile-sync" / "inbox"
        bridge = root / "workbench" / "data" / "market_data_bridge.js"
        formal.parent.mkdir(parents=True)
        inbox.mkdir(parents=True)
        stocks = [{"id": f"held-{index}", "code": f"{600000 + index:06d}.SS", "shares": index + 1, "avgCost": 8 + index, "plans": [{"price": 7}]} for index in range(stock_count)]
        formal.write_text(json.dumps({"stocks": stocks}, ensure_ascii=False), encoding="utf-8")
        return temp, formal, registry, inbox, bridge

    def run_fixture(self, formal, registry, inbox, bridge):
        return universe.run_update(
            formal_path=formal,
            registry_path=registry,
            inbox_path=inbox,
            bridge_path=bridge,
            update_function=fake_update,
            now=datetime(2026, 8, 26, 9, tzinfo=timezone.utc),
        )

    def test_valid_ingestion_registry_only_update_bridge_and_replay(self):
        temp, formal, registry, inbox, bridge = self.fixture()
        self.addCleanup(temp.cleanup)
        manifest = signed_manifest([{"symbol": "700.hk", "active": True, "displayName": "fixture"}])
        (inbox / "investment-workbench-universe-r000001.json").write_text(json.dumps(manifest, ensure_ascii=False), encoding="utf-8")

        first = self.run_fixture(formal, registry, inbox, bridge)
        self.assertEqual(first["diagnostics"]["newly_added"], 1)
        self.assertEqual(first["portfolio_symbol_count"], 1)
        self.assertEqual(first["registry_only_symbol_count"], 1)
        self.assertEqual(first["symbols"], 2)
        stored_registry = json.loads(registry.read_text(encoding="utf-8"))
        self.assertEqual([row["symbol"] for row in stored_registry["symbols"]], ["0700.HK"])
        market_only = stored_registry["symbols"][0]
        for forbidden in ("shares", "avgCost", "plans", "allocation", "aiReviews"):
            self.assertNotIn(forbidden, market_only)
        self.assertEqual(market_only["marketFacts"]["technicalIndicators"]["last_trade_date"], "2026-08-25")
        bridge_payload = json.loads(bridge.read_text(encoding="utf-8").split(" = ", 1)[1].rsplit(";", 1)[0])
        self.assertEqual([row["symbol"] for row in bridge_payload["stocks"]], ["0700.HK", "600000.SS"])
        held = json.loads(formal.read_text(encoding="utf-8"))["stocks"][0]
        self.assertEqual(held["shares"], 1)
        self.assertEqual(held["avgCost"], 8)
        self.assertEqual(held["plans"], [{"price": 7}])

        second = self.run_fixture(formal, registry, inbox, bridge)
        self.assertEqual(second["diagnostics"]["newly_added"], 0)
        self.assertEqual(second["diagnostics"]["already_known"], 1)
        self.assertEqual(len(second["registry"]["symbols"]), 1)

    def test_malformed_manifest_does_not_break_existing_update(self):
        temp, formal, registry, inbox, bridge = self.fixture()
        self.addCleanup(temp.cleanup)
        bad = signed_manifest([{"symbol": "NOT-A-SYMBOL", "active": True}])
        (inbox / "bad.json").write_text(json.dumps(bad), encoding="utf-8")
        summary = self.run_fixture(formal, registry, inbox, bridge)
        self.assertFalse(summary["diagnostics"]["accepted"])
        self.assertEqual(summary["diagnostics"]["invalid_symbol_count"], 1)
        self.assertEqual(summary["symbols"], 1)
        self.assertEqual(summary["success"], 1)

    def test_future_schema_manifest_is_rejected_without_shrinking_existing_update(self):
        temp, formal, registry, inbox, bridge = self.fixture()
        self.addCleanup(temp.cleanup)
        future = signed_manifest([{"symbol": "0700.HK", "active": True}])
        future["schemaVersion"] = 2
        (inbox / "future.json").write_text(json.dumps(future), encoding="utf-8")
        summary = self.run_fixture(formal, registry, inbox, bridge)
        self.assertFalse(summary["diagnostics"]["accepted"])
        self.assertEqual(summary["symbols"], 1)
        self.assertEqual(summary["success"], 1)

    def test_add_only_manifest_never_removes_registry_symbol(self):
        temp, formal, registry, inbox, bridge = self.fixture()
        self.addCleanup(temp.cleanup)
        registry.write_text(json.dumps({
            "schemaVersion": 1, "updatedAt": "", "lastManifest": None,
            "symbols": [{"symbol": "000858.SZ", "active": True, "displayName": "existing", "addedAt": "2026-08-01T00:00:00Z", "marketFacts": {}}],
        }), encoding="utf-8")
        manifest = signed_manifest([{"symbol": "0700.HK", "active": True}], revision=2)
        (inbox / "next.json").write_text(json.dumps(manifest), encoding="utf-8")
        summary = self.run_fixture(formal, registry, inbox, bridge)
        self.assertEqual([row["symbol"] for row in summary["registry"]["symbols"]], ["000858.SZ", "0700.HK"])

    def test_existing_nineteen_symbol_universe_remains_included(self):
        temp, formal, registry, inbox, bridge = self.fixture(stock_count=19)
        self.addCleanup(temp.cleanup)
        summary = self.run_fixture(formal, registry, inbox, bridge)
        self.assertEqual(summary["portfolio_symbol_count"], 19)
        self.assertEqual(summary["registry_only_symbol_count"], 0)
        self.assertEqual(summary["symbols"], 19)
        self.assertEqual(summary["success"], 19)
        self.assertEqual(summary["delivered_stock_count"], 19)
        self.assertEqual(len(json.loads(formal.read_text(encoding="utf-8"))["stocks"]), 19)


if __name__ == "__main__":
    unittest.main()
