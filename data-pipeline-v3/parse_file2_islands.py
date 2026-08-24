#!/usr/bin/env python3
from __future__ import annotations

import argparse
import hashlib
import json
import re
import shutil
import subprocess
import unicodedata
from pathlib import Path

SPACE_RE = re.compile(r"\s+")
PRICE = r"(?:\d{1,3}(?:\.\d{3})+|\d{1,4})"


def clean(s: str) -> str:
    return SPACE_RE.sub(" ", (s or "").replace("\xa0", " ")).strip()


def norm(s: str) -> str:
    x = unicodedata.normalize("NFD", s or "")
    x = "".join(c for c in x if unicodedata.category(c) != "Mn")
    x = x.replace("đ", "d").replace("Đ", "D").lower()
    x = re.sub(r"[^a-z0-9]+", " ", x)
    return SPACE_RE.sub(" ", x).strip()


def money(s: str) -> int:
    return int(s.replace(".", ""))


def text_from_pdf(path: Path) -> list[str]:
    exe = shutil.which("pdftotext")
    if not exe:
        raise RuntimeError("pdftotext missing")
    p = subprocess.run([exe, "-layout", str(path), "-"], text=True, capture_output=True, check=False)
    if p.returncode:
        raise RuntimeError(p.stderr)
    return p.stdout.splitlines()


def exact_marker(lines: list[str], roman: str) -> int:
    needle = f"phu luc {roman.lower()}"
    for i, line in enumerate(lines):
        if norm(line) == needle:
            return i
    raise RuntimeError(f"Missing Phụ lục {roman}")


def record_hash(obj: dict) -> str:
    raw = json.dumps(obj, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")
    return hashlib.sha256(raw).hexdigest()


def parse(lines: list[str]) -> list[dict]:
    # Named file 2 starts on the overlapping island page. Stop at the real start of
    # the phi-nong-nghiep table. The file name, not the marker, defines this as file 2.
    end = exact_marker(lines, "III")
    lines = lines[:end]
    rows: list[dict] = []
    buffer: list[str] = []

    def flush() -> None:
        nonlocal buffer
        if not buffer:
            return
        joined = clean(" ".join(buffer))
        m = re.match(rf"^(\d+(?:\.\d+)?)\s+(.+?)\s+({PRICE})\s+({PRICE})\s+({PRICE})\s+({PRICE})$", joined)
        if m:
            body = clean(m.group(2))
            loc = re.search(r"\b(?:Phường|Xã)\s+.+$", body)
            name = clean(body[:loc.start()]) if loc else body
            location = clean(body[loc.start():]) if loc else ""
            if "đảo" in name.lower() or "cù lao" in name.lower() or "dao" in norm(name) or "cu lao" in norm(name):
                rec = {
                    "source_tt": m.group(1),
                    "name": name,
                    "location": location,
                    "prices": {
                        "NN": money(m.group(3)),
                        "DAT_O": money(m.group(4)),
                        "TMDV": money(m.group(5)),
                        "SXKD_PNN_KHONG_TMDV": money(m.group(6)),
                    },
                    "source_text": joined,
                }
                rec["record_hash"] = record_hash(rec)
                rows.append(rec)
        buffer = []

    for raw in lines:
        s = clean(raw)
        if not s:
            continue
        if re.match(r"^\d+(?:\.\d+)?\s+", s):
            flush(); buffer = [s]
        elif buffer:
            buffer.append(s)
    flush()
    return rows


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--source", type=Path, required=True)
    ap.add_argument("--output", type=Path, required=True)
    args = ap.parse_args()
    rows = parse(text_from_pdf(args.source.resolve()))
    result = {
        "schema": "named-file2-islands-v1",
        "classificationAuthority": "user-assigned split filename",
        "pageSuffixRole": "bookmark_only",
        "rows": rows,
        "count": len(rows),
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"count": len(rows), "sample": rows[:5]}, ensure_ascii=False, indent=2))
    return 0 if rows else 2


if __name__ == "__main__":
    raise SystemExit(main())
