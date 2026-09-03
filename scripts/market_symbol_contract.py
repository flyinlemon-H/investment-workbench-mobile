"""Canonical contract moved from the existing Universe adapter; no provider logic."""
import re


def canonical_symbol(value: object) -> str:
    symbol = str(value or "").strip().translate(str.maketrans('abcdefghijklmnopqrstuvwxyz', 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'))
    match = re.fullmatch(r"(\d{6})\.(SS|SH|SZ)", symbol, flags=re.ASCII)
    if match:
        return f"{match.group(1)}.{('SS' if match.group(2) == 'SH' else match.group(2))}"
    match = re.fullmatch(r"(\d{1,5})\.HK", symbol, flags=re.ASCII)
    if match:
        return f"{match.group(1).zfill(4)}.HK"
    return ""
