from __future__ import annotations

import http.client
import importlib.util
import json
import socket
import sys
import threading
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location("pc_ai_bridge", ROOT / "pc-ai-bridge" / "bridge.py")
assert SPEC and SPEC.loader
bridge = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = bridge
SPEC.loader.exec_module(bridge)

ALLOWED_ORIGIN = "https://flyinlemon-h.github.io"


class StubProvider:
    name = "stub"
    model = "stub-v1"
    available = True

    def __init__(self, failure=None):
        self.failure = failure
        self.calls = 0

    def complete(self, prompt):
        self.calls += 1
        if self.failure:
            raise self.failure
        return bridge.ProviderResult(provider=self.name, model=self.model, content='{"raw":true}')


class RunningBridge:
    def __init__(self, provider):
        config = bridge.BridgeConfig(port=0, allowed_origins=frozenset({ALLOWED_ORIGIN}))
        self.server = bridge.create_server(config, provider)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)

    def __enter__(self):
        self.thread.start()
        return self

    def __exit__(self, *_args):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join(timeout=2)

    @property
    def address(self):
        return self.server.server_address

    def request(self, method, path, *, payload=None, headers=None, raw=None):
        connection = http.client.HTTPConnection(*self.address, timeout=3)
        body = raw if raw is not None else (json.dumps(payload).encode("utf-8") if payload is not None else None)
        request_headers = dict(headers or {})
        if payload is not None:
            request_headers.setdefault("Content-Type", "application/json")
        connection.request(method, path, body=body, headers=request_headers)
        response = connection.getresponse()
        data = response.read()
        result = response.status, dict(response.getheaders()), data
        connection.close()
        return result


def valid_request(**overrides):
    value = {
        "requestId": "request-1",
        "taskType": "long_term_logic",
        "prompt": "test prompt",
        "responseFormat": "text",
    }
    value.update(overrides)
    return value


class PcAiBridgeTests(unittest.TestCase):
    def test_server_binds_only_loopback_and_health_reports_capability(self):
        with RunningBridge(StubProvider()) as running:
            self.assertEqual(running.address[0], "127.0.0.1")
            status, headers, raw = running.request("GET", "/health", headers={"Origin": ALLOWED_ORIGIN})
            self.assertEqual(status, 200)
            self.assertEqual(headers["Access-Control-Allow-Origin"], ALLOWED_ORIGIN)
            value = json.loads(raw)
            self.assertEqual(value["service"], "investment-ai-bridge")
            self.assertTrue(value["capabilities"]["aiRequest"])
        with self.assertRaises(ValueError):
            bridge.create_server(bridge.BridgeConfig(host="0.0.0.0", port=0), StubProvider())

    def test_exact_origin_cors_and_private_network_preflight(self):
        with RunningBridge(StubProvider()) as running:
            status, _, raw = running.request("GET", "/health", headers={"Origin": "https://evil.example"})
            self.assertEqual(status, 403)
            self.assertEqual(json.loads(raw)["error"], "origin_not_allowed")
            status, _, raw = running.request("GET", "/health", headers={"Origin": ALLOWED_ORIGIN + "/"})
            self.assertEqual(status, 403)
            self.assertEqual(json.loads(raw)["error"], "origin_not_allowed")
            status, headers, _ = running.request(
                "OPTIONS",
                "/ai/request",
                headers={
                    "Origin": ALLOWED_ORIGIN,
                    "Access-Control-Request-Method": "POST",
                    "Access-Control-Request-Headers": "content-type, accept",
                    "Access-Control-Request-Private-Network": "true",
                },
            )
            self.assertEqual(status, 204)
            self.assertEqual(headers["Access-Control-Allow-Origin"], ALLOWED_ORIGIN)
            self.assertEqual(headers["Access-Control-Allow-Private-Network"], "true")

    def test_ai_request_returns_raw_content_and_exact_transport_metadata(self):
        provider = StubProvider()
        with RunningBridge(provider) as running:
            status, headers, raw = running.request("POST", "/ai/request", payload=valid_request(), headers={"Origin": ALLOWED_ORIGIN})
            self.assertEqual(status, 200)
            self.assertEqual(headers["Cache-Control"], "no-store")
            value = json.loads(raw)
            self.assertEqual(set(value), {"requestId", "provider", "model", "content", "elapsedMs"})
            self.assertEqual(value["content"], '{"raw":true}')
            self.assertEqual(provider.calls, 1)

    def test_request_contract_rejects_unsupported_malformed_and_oversized_inputs_without_provider_calls(self):
        provider = StubProvider()
        with RunningBridge(provider) as running:
            cases = [
                (valid_request(taskType="portfolio_review"), 400, "unsupported_task_type"),
                ({**valid_request(), "extra": True}, 400, "invalid_request"),
                (valid_request(responseFormat="json"), 400, "unsupported_response_format"),
            ]
            for payload, expected_status, code in cases:
                status, _, raw = running.request("POST", "/ai/request", payload=payload, headers={"Origin": ALLOWED_ORIGIN})
                self.assertEqual(status, expected_status)
                self.assertEqual(json.loads(raw)["error"], code)
            status, _, raw = running.request(
                "POST",
                "/ai/request",
                raw=b"x" * (bridge.DEFAULT_BODY_LIMIT_BYTES + 1),
                headers={"Origin": ALLOWED_ORIGIN, "Content-Type": "application/json"},
            )
            self.assertEqual(status, 413)
            self.assertEqual(json.loads(raw)["error"], "body_too_large")
            self.assertEqual(provider.calls, 0)

    def test_missing_key_disables_capability_and_returns_safe_unavailable_error(self):
        provider = bridge.DeepSeekProvider(api_key="")
        with RunningBridge(provider) as running:
            status, _, raw = running.request("GET", "/health", headers={"Origin": ALLOWED_ORIGIN})
            self.assertEqual(status, 200)
            self.assertFalse(json.loads(raw)["capabilities"]["aiRequest"])
            status, _, raw = running.request("POST", "/ai/request", payload=valid_request(), headers={"Origin": ALLOWED_ORIGIN})
            self.assertEqual(status, 503)
            value = json.loads(raw)
            self.assertEqual(value["error"], "provider_unavailable")
            self.assertNotIn("Authorization", raw.decode("utf-8"))

    def test_provider_timeout_http_and_network_failures_are_safe_and_never_retried(self):
        for failure, expected in [
            (bridge.ProviderFailure("provider_timeout", 504), (504, "provider_timeout")),
            (bridge.ProviderFailure("provider_http_error", 502), (502, "provider_http_error")),
            (bridge.ProviderFailure("provider_network_error", 502), (502, "provider_network_error")),
        ]:
            provider = StubProvider(failure)
            with RunningBridge(provider) as running:
                status, _, raw = running.request("POST", "/ai/request", payload=valid_request(), headers={"Origin": ALLOWED_ORIGIN})
                value = json.loads(raw)
                self.assertEqual((status, value["error"]), expected)
                self.assertEqual(provider.calls, 1)

    def test_deepseek_adapter_uses_fixed_timeout_and_rejects_malformed_provider_content(self):
        calls = []

        class FakeResponse:
            def __enter__(self): return self
            def __exit__(self, *_args): return False
            def read(self, _limit): return b'{"model":"provider-changed-model","choices":[]}'

        def opener(request, timeout):
            calls.append((request, timeout))
            return FakeResponse()

        provider = bridge.DeepSeekProvider(api_key="secret-test-value", opener=opener)
        with self.assertRaises(bridge.ProviderFailure) as caught:
            provider.complete("prompt")
        self.assertEqual(caught.exception.code, "provider_invalid_response")
        self.assertEqual(len(calls), 1)
        self.assertEqual(calls[0][1], 60)
        self.assertEqual(provider.model, "deepseek-v4-flash")

        class ValidResponse(FakeResponse):
            def read(self, _limit):
                return b'{"model":"provider-changed-model","choices":[{"message":{"content":"{}"}}]}'

        fixed = bridge.DeepSeekProvider(api_key="secret-test-value", opener=lambda _request, timeout: ValidResponse())
        self.assertEqual(fixed.complete("prompt").model, "deepseek-v4-flash")

    def test_socket_is_not_reachable_on_wildcard_identity(self):
        with RunningBridge(StubProvider()) as running:
            self.assertEqual(running.server.socket.family, socket.AF_INET)
            self.assertNotEqual(running.address[0], "0.0.0.0")


if __name__ == "__main__":
    unittest.main()
