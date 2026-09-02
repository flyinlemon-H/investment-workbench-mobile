"""Loopback-only local acceptance server; does not change release asset versions."""
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
import argparse
import hashlib
import json
from pathlib import Path
import re
import time
from urllib.parse import unquote, urlsplit

ROOT = Path(__file__).resolve().parents[1]
OVERRIDE_DOCUMENT = None


def allowed_asset(url):
    path = unquote(urlsplit(url).path).lstrip("/")
    parts = path.split("/")
    if any(part.startswith(".") for part in parts) or "\\" in path:
        return False
    if path in {"", "index.html", "social_posts.json", "social_summary.json", "favicon.ico"}:
        return True
    return parts[0] in {"src", "data", "assets", "tests"} and Path(path).suffix in {".js", ".css", ".html", ".json", ".svg", ".png"}


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def do_GET(self):
        if not allowed_asset(self.path):
            self.send_error(404)
            return
        if urlsplit(self.path).path not in {"/", "/index.html"}:
            return super().do_GET()
        html = (OVERRIDE_DOCUMENT or ROOT / "index.html").read_text(encoding="utf-8")
        nonce = str(time.time_ns())
        html = re.sub(
            r'(<script\b[^>]*\bsrc=")([^"]+)(")',
            lambda match: match[1] + match[2] + ("&" if "?" in match[2] else "?")
            + "acceptance=" + nonce + match[3], html,
        )
        content = html.encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(content)))
        self.end_headers()
        self.wfile.write(content)

    def do_HEAD(self):
        if not allowed_asset(self.path):
            self.send_error(404)
            return
        super().do_HEAD()


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--overrides-directory", type=Path)
    args = parser.parse_args()
    if args.overrides_directory:
        manifest = json.loads((args.overrides_directory / "acceptance-manifest.json").read_text(encoding="utf-8"))
        OVERRIDE_DOCUMENT = args.overrides_directory / "flyinlemon-h.github.io/investment-workbench-mobile/index.html"
        if manifest["namespace"] != "__pc_ai_acceptance_20260902__" or hashlib.sha256(OVERRIDE_DOCUMENT.read_bytes()).hexdigest() != manifest["bundleSha256"]:
            raise ValueError("Acceptance bundle integrity check failed")
    print("Acceptance server: http://127.0.0.1:8768", flush=True)
    ThreadingHTTPServer(("127.0.0.1", 8768), Handler).serve_forever()
