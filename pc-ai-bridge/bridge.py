from __future__ import annotations

import json
import os
import re
import socket
import time
import urllib.error
import urllib.request
from dataclasses import dataclass
from datetime import date, timedelta
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any, Protocol


BRIDGE_VERSION = "1.0.0"
DEFAULT_HOST = "127.0.0.1"
DEFAULT_PORT = 18765
DEFAULT_ORIGIN = "https://flyinlemon-h.github.io"
DEFAULT_MODEL = "deepseek-v4-flash"
DEFAULT_PROVIDER_TIMEOUT_SECONDS = 60
DEFAULT_BODY_LIMIT_BYTES = 256 * 1024
TASK_TYPES = frozenset({"long_term_logic"})
REQUEST_FIELDS = frozenset({"requestId", "taskType", "prompt", "responseFormat"})
REQUEST_ID = re.compile(r"^[A-Za-z0-9._:-]{1,128}$")


class ProviderFailure(Exception):
    def __init__(self, code: str, status: int):
        super().__init__(code)
        self.code = code
        self.status = status


@dataclass(frozen=True)
class ProviderResult:
    provider: str
    model: str
    content: str


class Provider(Protocol):
    name: str
    model: str

    @property
    def available(self) -> bool: ...

    def complete(self, prompt: str) -> ProviderResult: ...


def load_local_env(path: Path | None = None) -> bool:
    env_path = path or Path(__file__).resolve().parent / ".env"
    if not env_path.is_file():
        return False
    for raw_line in env_path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        value = value.strip().strip('"').strip("'")
        if key and key not in os.environ:
            os.environ[key] = value
    return True


class DeepSeekProvider:
    name = "deepseek"

    def __init__(
        self,
        *,
        api_key: str | None = None,
        model: str = DEFAULT_MODEL,
        timeout_seconds: int = DEFAULT_PROVIDER_TIMEOUT_SECONDS,
        url: str = "https://api.deepseek.com/chat/completions",
        opener: Any = None,
    ) -> None:
        self.api_key = api_key if api_key is not None else os.getenv("DEEPSEEK_API_KEY", "")
        self.model = model
        self.timeout_seconds = int(timeout_seconds)
        self.url = url
        self.opener = opener or urllib.request.urlopen

    @property
    def available(self) -> bool:
        return bool(self.api_key.strip())

    def complete(self, prompt: str) -> ProviderResult:
        if not self.available:
            raise ProviderFailure("provider_unavailable", 503)
        payload = json.dumps(
            {
                "model": self.model,
                "messages": [
                    {"role": "system", "content": "Return only the requested JSON object."},
                    {"role": "user", "content": prompt},
                ],
                "response_format": {"type": "json_object"},
                "stream": False,
            },
            ensure_ascii=False,
        ).encode("utf-8")
        request = urllib.request.Request(
            self.url,
            data=payload,
            method="POST",
            headers={
                "Authorization": f"Bearer {self.api_key}",
                "Content-Type": "application/json",
                "Accept": "application/json",
            },
        )
        try:
            with self.opener(request, timeout=self.timeout_seconds) as response:
                raw = response.read(2 * 1024 * 1024 + 1)
        except urllib.error.HTTPError as exc:
            raise ProviderFailure("provider_http_error", 502) from exc
        except (urllib.error.URLError, TimeoutError, socket.timeout) as exc:
            reason = getattr(exc, "reason", None)
            if isinstance(reason, (TimeoutError, socket.timeout)) or isinstance(exc, (TimeoutError, socket.timeout)):
                raise ProviderFailure("provider_timeout", 504) from exc
            raise ProviderFailure("provider_network_error", 502) from exc
        except Exception as exc:
            raise ProviderFailure("provider_failure", 502) from exc
        if len(raw) > 2 * 1024 * 1024:
            raise ProviderFailure("provider_response_too_large", 502)
        try:
            data = json.loads(raw.decode("utf-8"))
            choices = data.get("choices") if isinstance(data, dict) else None
            message = choices[0].get("message") if isinstance(choices, list) and choices and isinstance(choices[0], dict) else None
            content = message.get("content") if isinstance(message, dict) else None
        except (UnicodeDecodeError, json.JSONDecodeError, AttributeError, IndexError, TypeError) as exc:
            raise ProviderFailure("provider_invalid_response", 502) from exc
        if not isinstance(content, str) or not content.strip():
            raise ProviderFailure("provider_invalid_response", 502)
        return ProviderResult(provider=self.name, model=self.model, content=content)


class DeterministicMockProvider:
    """Non-paid acceptance provider. It simulates model output; production defaults to DeepSeek."""

    name = "mock"
    model = "deterministic-long-term-v1"

    @property
    def available(self) -> bool:
        return True

    def complete(self, prompt: str) -> ProviderResult:
        marker = "【受保护绑定】"
        try:
            binding_text = prompt.split(marker, 1)[1].split("\n\n", 1)[0].strip()
            binding = json.loads(binding_text)
            prompt_date = date.fromisoformat(binding["promptDate"])
            output = {
                "binding": {
                    "symbol": binding["symbol"],
                    "contextHash": binding["contextHash"],
                },
                "longTermLogic": {
                    "updatedAt": prompt_date.isoformat(),
                    "validUntil": (prompt_date + timedelta(days=180)).isoformat(),
                    "investmentThesis": "行业长期需求、公司执行能力与当前组合角色共同支持继续跟踪长期逻辑。",
                    "coreDrivers": ["行业需求延续", "公司竞争力保持", "组合角色清晰"],
                    "industryDrivers": ["行业长期需求仍有结构性支撑"],
                    "companyDrivers": ["公司具备可持续的交付与竞争能力"],
                    "portfolioDrivers": ["在当前组合中承担长期成长观察角色"],
                    "fundamentalSupport": "现有基本面资料对长期逻辑提供辅助验证，但仍需按期复核。",
                    "longTermRisks": ["行业需求不及预期", "公司竞争优势减弱"],
                    "logicStatus": "valid",
                    "confidence": "medium",
                    "nextReviewDate": (prompt_date + timedelta(days=90)).isoformat(),
                    "sourceSummary": "基于程序提供的当前长期逻辑、基本面、估值与数据新鲜度上下文。",
                },
            }
        except Exception as exc:
            raise ProviderFailure("mock_prompt_invalid", 502) from exc
        return ProviderResult(provider=self.name, model=self.model, content=json.dumps(output, ensure_ascii=False))


@dataclass(frozen=True)
class BridgeConfig:
    host: str = DEFAULT_HOST
    port: int = DEFAULT_PORT
    allowed_origins: frozenset[str] = frozenset({DEFAULT_ORIGIN})
    body_limit_bytes: int = DEFAULT_BODY_LIMIT_BYTES

    @classmethod
    def from_env(cls) -> "BridgeConfig":
        origins = frozenset(
            item.strip()
            for item in os.getenv("PC_AI_BRIDGE_ALLOWED_ORIGINS", DEFAULT_ORIGIN).split(",")
            if item.strip()
        )
        port = int(os.getenv("PC_AI_BRIDGE_PORT", str(DEFAULT_PORT)))
        if not (1 <= port <= 65535):
            raise ValueError("PC_AI_BRIDGE_PORT is invalid")
        return cls(host=DEFAULT_HOST, port=port, allowed_origins=origins or frozenset({DEFAULT_ORIGIN}))


def create_handler(config: BridgeConfig, provider: Provider) -> type[BaseHTTPRequestHandler]:
    class BridgeHandler(BaseHTTPRequestHandler):
        server_version = "InvestmentAIBridge/1.0"
        sys_version = ""

        def log_message(self, _format: str, *_args: Any) -> None:
            return

        def _origin(self) -> str:
            return str(self.headers.get("Origin") or "").strip()

        def _origin_allowed(self) -> bool:
            origin = self._origin()
            return not origin or origin in config.allowed_origins

        def _cors_headers(self) -> dict[str, str]:
            origin = self._origin()
            if not origin or origin not in config.allowed_origins:
                return {}
            return {
                "Access-Control-Allow-Origin": origin,
                "Vary": "Origin",
            }

        def _send_json(self, status: int, payload: dict[str, Any], extra_headers: dict[str, str] | None = None) -> None:
            raw = json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
            self.send_response(status)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(raw)))
            self.send_header("Cache-Control", "no-store")
            for key, value in {**self._cors_headers(), **(extra_headers or {})}.items():
                self.send_header(key, value)
            self.end_headers()
            self.wfile.write(raw)

        def _reject_origin(self) -> bool:
            if self._origin_allowed():
                return False
            self._send_json(403, {"error": "origin_not_allowed"})
            return True

        def do_OPTIONS(self) -> None:
            if self.path not in {"/health", "/ai/request"}:
                self._send_json(404, {"error": "not_found"})
                return
            if self._reject_origin():
                return
            requested_method = str(self.headers.get("Access-Control-Request-Method") or "").upper()
            if requested_method not in {"GET", "POST"}:
                self._send_json(405, {"error": "method_not_allowed"})
                return
            requested_headers = {
                item.strip().lower()
                for item in str(self.headers.get("Access-Control-Request-Headers") or "").split(",")
                if item.strip()
            }
            if not requested_headers.issubset({"content-type", "accept"}):
                self._send_json(400, {"error": "headers_not_allowed"})
                return
            headers = {
                "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
                "Access-Control-Allow-Headers": "Content-Type, Accept",
                "Access-Control-Max-Age": "600",
            }
            if str(self.headers.get("Access-Control-Request-Private-Network") or "").lower() == "true":
                headers["Access-Control-Allow-Private-Network"] = "true"
            self.send_response(204)
            self.send_header("Content-Length", "0")
            for key, value in {**self._cors_headers(), **headers}.items():
                self.send_header(key, value)
            self.end_headers()

        def do_GET(self) -> None:
            if self.path != "/health":
                self._send_json(404, {"error": "not_found"})
                return
            if self._reject_origin():
                return
            self._send_json(
                200,
                {
                    "status": "ok",
                    "service": "investment-ai-bridge",
                    "version": BRIDGE_VERSION,
                    "environment": "local",
                    "capabilities": {"aiRequest": provider.available},
                },
            )

        def do_POST(self) -> None:
            if self.path != "/ai/request":
                self._send_json(404, {"error": "not_found"})
                return
            if self._reject_origin():
                return
            try:
                length = int(self.headers.get("Content-Length") or "0")
            except ValueError:
                self._send_json(400, {"error": "invalid_content_length"})
                return
            if length <= 0:
                self._send_json(400, {"error": "empty_body"})
                return
            if length > config.body_limit_bytes:
                self._send_json(413, {"error": "body_too_large"})
                return
            if not str(self.headers.get("Content-Type") or "").lower().startswith("application/json"):
                self._send_json(415, {"error": "content_type_not_supported"})
                return
            try:
                payload = json.loads(self.rfile.read(length).decode("utf-8"))
            except (UnicodeDecodeError, json.JSONDecodeError):
                self._send_json(400, {"error": "invalid_json"})
                return
            if not isinstance(payload, dict) or set(payload) != REQUEST_FIELDS:
                self._send_json(400, {"error": "invalid_request"})
                return
            request_id = payload.get("requestId")
            task_type = payload.get("taskType")
            prompt = payload.get("prompt")
            response_format = payload.get("responseFormat")
            if not isinstance(request_id, str) or not REQUEST_ID.fullmatch(request_id):
                self._send_json(400, {"error": "invalid_request_id"})
                return
            if task_type not in TASK_TYPES:
                self._send_json(400, {"error": "unsupported_task_type"})
                return
            if not isinstance(prompt, str) or not prompt.strip():
                self._send_json(400, {"error": "invalid_prompt"})
                return
            if response_format != "text":
                self._send_json(400, {"error": "unsupported_response_format"})
                return
            started = time.monotonic()
            try:
                result = provider.complete(prompt)
            except ProviderFailure as exc:
                self._send_json(exc.status, {"error": exc.code, "requestId": request_id})
                return
            elapsed_ms = max(0, round((time.monotonic() - started) * 1000))
            self._send_json(
                200,
                {
                    "requestId": request_id,
                    "provider": result.provider,
                    "model": result.model,
                    "content": result.content,
                    "elapsedMs": elapsed_ms,
                },
            )

    return BridgeHandler


def create_server(config: BridgeConfig, provider: Provider) -> ThreadingHTTPServer:
    if config.host != DEFAULT_HOST:
        raise ValueError("Bridge must bind to 127.0.0.1")
    return ThreadingHTTPServer((config.host, config.port), create_handler(config, provider))


def provider_from_env() -> Provider:
    mode = os.getenv("PC_AI_BRIDGE_MODE", "deepseek").strip().lower()
    if mode == "mock":
        return DeterministicMockProvider()
    if mode != "deepseek":
        raise ValueError("PC_AI_BRIDGE_MODE must be deepseek or mock")
    return DeepSeekProvider(model=DEFAULT_MODEL, timeout_seconds=DEFAULT_PROVIDER_TIMEOUT_SECONDS)
