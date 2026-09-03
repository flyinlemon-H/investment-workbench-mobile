"""Read-only PC Universe capability. No service key, browser session or market logic."""
from __future__ import annotations

import argparse
import ctypes
from ctypes import wintypes
from datetime import datetime, timezone
import getpass
import json
import os
from pathlib import Path
import re
import tempfile
from urllib.error import HTTPError, URLError
from urllib.request import Request, build_opener, HTTPRedirectHandler

try:
    from .market_symbol_contract import canonical_symbol
except ImportError:
    from market_symbol_contract import canonical_symbol

PRODUCTION_REF = "fntslvdxnupmdljnadec"
PROJECTS = {
    PRODUCTION_REF: "sb_publishable_GrV_SJuVDjMbIyo_zeTr0g_u4MpXvlm",
    "lblyapnsngqnjimgskkp": "sb_publishable_6bk0BQjpjcfNuUZKxdoy7w_Vhws9KSx",
}
MAX_BYTES = 2 * 1024 * 1024
UUID = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$", re.I)


class CloudUniverseError(Exception):
    def __init__(self, code):
        super().__init__(code)
        self.code = code


def validate_credential(value):
    fields = {"schemaVersion", "projectRef", "userId", "token", "expiresAt"}
    if not isinstance(value, dict) or set(value) != fields or type(value.get("schemaVersion")) is not int or value["schemaVersion"] != 1:
        raise CloudUniverseError("credential_invalid")
    if value["projectRef"] not in PROJECTS or not isinstance(value["userId"], str) or not UUID.fullmatch(value["userId"]):
        raise CloudUniverseError("credential_invalid")
    if not isinstance(value["token"], str) or not re.fullmatch(r"[0-9a-f]{64}", value["token"]):
        raise CloudUniverseError("credential_invalid")
    try:
        expiry = datetime.fromisoformat(value["expiresAt"].replace("Z", "+00:00"))
        if expiry.tzinfo is None:
            raise ValueError
    except (ValueError, TypeError, AttributeError):
        raise CloudUniverseError("credential_invalid") from None
    return value


def validate_payload(value, owner):
    if not isinstance(value, dict) or set(value) != {"schemaVersion", "userId", "credentialExpiresAt", "symbols"}:
        raise CloudUniverseError("response_invalid")
    if type(value["schemaVersion"]) is not int or value["schemaVersion"] != 1:
        raise CloudUniverseError("schema_unsupported")
    if value["userId"] != owner:
        raise CloudUniverseError("owner_mismatch")
    try:
        expiry = datetime.fromisoformat(value["credentialExpiresAt"].replace("Z", "+00:00"))
        if expiry.tzinfo is None or expiry <= datetime.now(timezone.utc):
            raise ValueError
    except (ValueError, TypeError, AttributeError):
        raise CloudUniverseError("response_invalid") from None
    rows = value["symbols"]
    if not isinstance(rows, list) or len(rows) > 10000:
        raise CloudUniverseError("response_invalid")
    seen = set()
    normalized = []
    for row in rows:
        if not isinstance(row, dict) or set(row) != {"symbol", "displayName"}:
            raise CloudUniverseError("response_invalid")
        symbol = canonical_symbol(row["symbol"])
        if not symbol or symbol != row["symbol"] or symbol in seen or not isinstance(row["displayName"], str) or len(row["displayName"]) > 120:
            raise CloudUniverseError("response_invalid")
        seen.add(symbol)
        normalized.append({"symbol": symbol, "active": True, "displayName": row["displayName"]})
    return sorted(normalized, key=lambda row: row["symbol"])


class _Blob(ctypes.Structure):
    _fields_ = [("cbData", wintypes.DWORD), ("pbData", ctypes.POINTER(ctypes.c_ubyte))]


def protect(data, decrypt=False):
    if os.name != "nt":
        raise CloudUniverseError("windows_dpapi_required")
    source_buffer = ctypes.create_string_buffer(data)
    source = _Blob(len(data), ctypes.cast(source_buffer, ctypes.POINTER(ctypes.c_ubyte)))
    target = _Blob()
    crypt32 = ctypes.WinDLL("crypt32", use_last_error=True)
    kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
    kernel32.LocalFree.argtypes = [ctypes.c_void_p]
    kernel32.LocalFree.restype = ctypes.c_void_p
    if decrypt:
        ok = crypt32.CryptUnprotectData(ctypes.byref(source), None, None, None, None, 1, ctypes.byref(target))
    else:
        ok = crypt32.CryptProtectData(ctypes.byref(source), "InvestmentWorkbench Universe reader", None, None, None, 1, ctypes.byref(target))
    if not ok:
        raise CloudUniverseError("credential_protection_failed")
    try:
        return ctypes.string_at(target.pbData, target.cbData)
    finally:
        kernel32.LocalFree(target.pbData)


def credential_path():
    base = os.environ.get("LOCALAPPDATA")
    if not base:
        raise CloudUniverseError("credential_location_unavailable")
    return Path(base) / "InvestmentWorkbench" / "credentials" / "universe-reader.bin"


def save_credential(value, path=None):
    validate_credential(value)
    path = Path(path) if path else credential_path()
    repo = Path(__file__).resolve().parents[1]
    if path.resolve().is_relative_to(repo):
        raise CloudUniverseError("credential_repository_path_denied")
    encrypted = protect(json.dumps(value).encode("utf-8"))
    path.parent.mkdir(parents=True, exist_ok=True)
    descriptor, filename = tempfile.mkstemp(prefix="universe-reader-", suffix=".tmp", dir=path.parent)
    try:
        with os.fdopen(descriptor, "wb") as handle:
            handle.write(encrypted)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(filename, path)
    finally:
        Path(filename).unlink(missing_ok=True)


def load_credential(path=None):
    path = Path(path) if path else credential_path()
    if not path.is_file():
        raise CloudUniverseError("not_configured")
    try:
        raw = path.read_bytes()
        if len(raw) > 16384:
            raise ValueError
        return validate_credential(json.loads(protect(raw, decrypt=True)))
    except CloudUniverseError:
        raise
    except Exception:
        raise CloudUniverseError("credential_invalid") from None


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise CloudUniverseError("redirect_rejected")


def request_payload(credential, timeout=12):
    ref = credential["projectRef"]
    request = Request(f"https://{ref}.supabase.co/rest/v1/rpc/read_stock_universe",
                      data=json.dumps({"p_token": credential["token"]}).encode("utf-8"),
                      headers={"apikey": PROJECTS[ref], "Content-Type": "application/json", "Accept": "application/json"}, method="POST")
    with build_opener(NoRedirect()).open(request, timeout=timeout) as response:
        content = response.read(MAX_BYTES + 1)
        if len(content) > MAX_BYTES:
            raise CloudUniverseError("response_too_large")
        try:
            return json.loads(content)
        except (ValueError, UnicodeError):
            raise CloudUniverseError("response_invalid") from None


def fetch_cloud_universe(*, credential_loader=load_credential, request=request_payload, expected_project=PRODUCTION_REF):
    try:
        credential = validate_credential(credential_loader())
        if credential["projectRef"] != expected_project:
            raise CloudUniverseError("project_mismatch")
        if datetime.fromisoformat(credential["expiresAt"].replace("Z", "+00:00")) <= datetime.now(timezone.utc):
            raise CloudUniverseError("auth_required")
        payload = request(credential)
        rows = validate_payload(payload, credential["userId"])
        return {"status": "success", "rows": rows, "code": "", "userId": credential["userId"]}
    except HTTPError as error:
        code = "auth_required" if error.code in (401, 403) else "cloud_http_error"
        error.close()
    except (URLError, TimeoutError, OSError):
        code = "offline"
    except CloudUniverseError as error:
        code = error.code
    except Exception:
        code = "cloud_error"
    status = code if code in ("auth_required", "offline", "not_configured") else "error"
    # Never return raw HTTP exceptions, response bodies, headers or credential values.
    return {"status": status, "rows": [], "code": code}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--configure", action="store_true", help="Paste a PC reader configuration once; DPAPI protects it outside Git.")
    args = parser.parse_args()
    if args.configure:
        try:
            value = json.loads(getpass.getpass("Paste PC reader JSON (hidden): "))
            if value.get("projectRef") != PRODUCTION_REF:
                raise CloudUniverseError("project_mismatch")
            save_credential(value)
            print("PC reader configured in Windows user-protected storage. Renew before expiry using a newly issued configuration.")
        except Exception:
            print("PC reader configuration failed; check the configuration and Windows account.")
            return 1
    result = fetch_cloud_universe()
    print(f"cloudUniverseStatus: {result['status']}")
    print(f"cloudUniverseCode: {result['code']}")
    print(f"cloudUniverseSymbols: {len(result['rows'])}")
    return 0 if result["status"] == "success" else 1


if __name__ == "__main__":
    raise SystemExit(main())
