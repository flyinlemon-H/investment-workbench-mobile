import unittest

from serve_browser_acceptance import allowed_asset
from build_chrome_acceptance_overrides import build_bundle, isolate_names, NAMES, PREFIX, ROOT, SCRIPT


class BrowserAcceptanceAssetTests(unittest.TestCase):
    def test_only_browser_assets_are_served(self):
        for path in ["/", "/index.html", "/src/api/api-client.js?acceptance=1", "/data/backend_config.js", "/tests/fixtures/long-term-logic-browser-acceptance.html"]:
            self.assertTrue(allowed_asset(path), path)

    def test_secrets_git_bridge_and_traversal_are_not_served(self):
        for path in ["/.env", "/.git/config", "/pc-ai-bridge/.env", "/pc-ai-bridge/bridge.py", "/tests/run_pc_ai_bridge_acceptance.py", "/src/../.env", "/src/%2e%2e/.env", "/src/secret.env", "/src/..%5c.env"]:
            self.assertFalse(allowed_asset(path), path)


class ChromeOverridesBundleTests(unittest.TestCase):
    def test_names_are_isolated_only_at_exact_string_literals(self):
        for name in NAMES:
            self.assertEqual(isolate_names(repr(name)), repr(PREFIX + name))
            self.assertEqual(isolate_names(name + "-suffix"), name + "-suffix")

    def test_bundle_contains_current_scripts_in_order_without_remote_script_loads(self):
        html, manifest = build_bundle()
        expected = [url.split("?")[0] for url in SCRIPT.findall((ROOT / "index.html").read_text(encoding="utf-8"))]
        self.assertEqual([item["path"] for item in manifest["sourceScripts"]], expected)
        self.assertGreater(len(expected), 50)
        self.assertNotIn('<script src=', html)
        self.assertLess(html.index('function productionOriginAcceptanceHarness'), html.index('window.APP_ASSET_VERSION='))
        for path in ["src/api/api-client.js", "src/clipboard.js", "src/strict-ai-json.js",
                     "src/long-term-logic-contract.js", "src/long-term-logic-workflow.js"]:
            self.assertTrue((ROOT / path).read_bytes().decode("utf-8") in html, path)
        for name in NAMES:
            self.assertNotIn("'" + name + "'", isolate_names(html))

    def test_build_does_not_change_repository_sources(self):
        import hashlib
        paths = [ROOT / "index.html", *ROOT.glob("src/**/*.js"), *ROOT.glob("data/*.js")]
        before = {path: hashlib.sha256(path.read_bytes()).hexdigest() for path in paths}
        build_bundle()
        self.assertEqual(before, {path: hashlib.sha256(path.read_bytes()).hexdigest() for path in paths})


if __name__ == "__main__":
    unittest.main()
