import unittest

from serve_browser_acceptance import allowed_asset


class BrowserAcceptanceAssetTests(unittest.TestCase):
    def test_only_browser_assets_are_served(self):
        for path in ["/", "/index.html", "/src/api/api-client.js?acceptance=1", "/data/backend_config.js", "/tests/fixtures/long-term-logic-browser-acceptance.html"]:
            self.assertTrue(allowed_asset(path), path)

    def test_secrets_git_bridge_and_traversal_are_not_served(self):
        for path in ["/.env", "/.git/config", "/pc-ai-bridge/.env", "/pc-ai-bridge/bridge.py", "/tests/run_pc_ai_bridge_acceptance.py", "/src/../.env", "/src/%2e%2e/.env", "/src/secret.env", "/src/..%5c.env"]:
            self.assertFalse(allowed_asset(path), path)

if __name__ == "__main__":
    unittest.main()
