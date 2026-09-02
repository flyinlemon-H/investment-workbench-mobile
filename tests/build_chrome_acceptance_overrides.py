"""Build a local-only Chrome Overrides bundle; never edits publication assets."""
import argparse
import hashlib
import json
from pathlib import Path
import re
from urllib.parse import urlsplit

ROOT = Path(__file__).resolve().parents[1]
PREFIX = "__pc_ai_acceptance_20260902__"
NAMES = (
    "portfolio_manual_v502_network_price_20260610",
    "v13_plan_update_drafts_v1", "v13_operation_entry_drafts_v1",
    "investment-workbench-mobile", "investment-workbench-multitab-v1",
    "investment-workbench-main-state-write-v1", "investment-workbench-draft-write-v1",
    "v13_detail_workspace_tab_v1",
)
SCRIPT = re.compile(r'<script\s+src="([^"]+)"\s*>\s*</script>')


def isolate_names(source):
    # Only exact string literals change. Business/storage algorithms are untouched.
    for name in NAMES:
        for quote in ("'", '"'):
            source = source.replace(quote + name + quote, quote + PREFIX + name + quote)
    return source


def inline_script(source):
    if re.search(r"</script", source, re.I):
        raise ValueError("Unexpected HTML script terminator in JavaScript")
    return "<script>\n" + source + "\n</script>"


def build_bundle():
    index = (ROOT / "index.html").read_text(encoding="utf-8")
    sources = []

    def replace_script(match):
        url = urlsplit(match[1])
        path = (ROOT / url.path).resolve()
        if url.scheme or url.netloc or not path.is_relative_to(ROOT):
            raise ValueError("Only repository static scripts may be bundled")
        if path.suffix != ".js" or path.relative_to(ROOT).parts[0] not in {"src", "data"}:
            raise ValueError("Non-browser source in index")
        data = path.read_bytes()
        sources.append({"path": path.relative_to(ROOT).as_posix(),
                        "sha256": hashlib.sha256(data).hexdigest()})
        return inline_script(isolate_names(data.decode("utf-8")))

    index = SCRIPT.sub(replace_script, index)
    if re.search(r"<script\b[^>]*\bsrc=", index):
        raise ValueError("Unbundled script would load remote production code")
    harness = (ROOT / "tests/fixtures/chrome-overrides-harness.js").read_text(encoding="utf-8")
    # The guard/seed runs before every application script, including app bootstrap.
    index = index.replace("<head>", "<head>\n" + inline_script(harness), 1)
    if "<head>" not in index or "</head>" not in index:
        raise ValueError("Unexpected document structure")
    return index, {"purpose": "Local-only production-Origin acceptance; not a release artifact",
                   "namespace": PREFIX, "sourceScripts": sources,
                   "indexSha256": hashlib.sha256((ROOT / "index.html").read_bytes()).hexdigest(),
                   "bundleSha256": hashlib.sha256(index.encode("utf-8")).hexdigest(),
                   "modifications": ["Inline current static scripts in original order",
                                     "Prefix storage/database/channel/lock names",
                                     "Test-only storage guard, synthetic seed, write counter and paste probe"],
                   "unchanged": ["fetch", "permissions", "clipboard", "StrictAiJson",
                                 "Long-Term Logic contract/workflow", "atomic save algorithms"]}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    output = args.output.resolve()
    if output.is_relative_to(ROOT) or ROOT.is_relative_to(output):
        raise ValueError("Overrides must be outside the repository")
    if output.exists() and any(output.iterdir()):
        raise ValueError("Refusing to overwrite a non-empty Overrides directory")
    html, manifest = build_bundle()
    site = output / "flyinlemon-h.github.io/investment-workbench-mobile"
    site.mkdir(parents=True, exist_ok=True)
    (site / "index.html").write_text(html, encoding="utf-8", newline="\n")
    (output / "acceptance-manifest.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"overridesFolder": str(output), "document": str(site / "index.html"),
                      "scripts": len(manifest["sourceScripts"]),
                      "bundleSha256": manifest["bundleSha256"]}, ensure_ascii=False))


if __name__ == "__main__":
    main()
