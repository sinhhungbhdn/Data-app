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
from typing import Any

SPACE_RE = re.compile(r"\s+")
PRICE_TOKEN = r"(?:\d{1,3}(?:\.\d{3})+|\d{1,4})"


def norm(s: str) -> str:
    x = unicodedata.normalize("NFD", s or "")
    x = "".join(c for c in x if unicodedata.category(c) != "Mn")
    x = x.replace("đ", "d").replace("Đ", "D").lower()
    x = re.sub(r"[^a-z0-9]+", " ", x)
    return SPACE_RE.sub(" ", x).strip()


def clean(s: str) -> str:
    return SPACE_RE.sub(" ", (s or "").replace("\xa0", " ")).strip()


def price(s: str) -> int:
    return int(s.replace(".", ""))


def text_from_pdf(pdf: Path) -> str:
    exe = shutil.which("pdftotext")
    if not exe:
        raise RuntimeError("pdftotext missing")
    result = subprocess.run([exe, "-layout", str(pdf), "-"], text=True, capture_output=True, check=False)
    if result.returncode != 0:
        raise RuntimeError(result.stderr)
    return result.stdout


def exact_marker(lines: list[str], roman: str, start: int = 0) -> int:
    needle = f"phu luc {roman.lower()}"
    for i in range(start, len(lines)):
        if norm(lines[i]) == needle:
            return i
    raise RuntimeError(f"Missing Phụ lục {roman}")


def slice_between(lines: list[str], start_roman: str, end_roman: str | None) -> list[str]:
    a = exact_marker(lines, start_roman)
    b = exact_marker(lines, end_roman, a + 1) if end_roman else len(lines)
    return lines[a:b]


def sha(obj: Any) -> str:
    raw = json.dumps(obj, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")
    return hashlib.sha256(raw).hexdigest()


def parse_file3_kcn_ccn(lines: list[str]) -> dict[str, Any]:
    rows: list[dict[str, Any]] = []
    section = None
    buffer: list[str] = []

    def flush() -> None:
        nonlocal buffer
        if not buffer:
            return
        joined = clean(" ".join(buffer))
        m = re.match(rf"^(\d{{1,3}})\s+(.+?)\s+({PRICE_TOKEN})$", joined)
        if m and section:
            tt = int(m.group(1)); body = m.group(2); val = price(m.group(3))
            # Location usually begins at the first administrative-unit token.
            loc_match = re.search(r"\b(Phường|Xã)\s+.+$", body)
            if loc_match:
                name = clean(body[:loc_match.start()])
                location = clean(body[loc_match.start():])
            else:
                name, location = body, ""
            rec = {
                "group": "KCN" if section == "I" else "CCN",
                "source_tt": tt,
                "name": name,
                "location": location,
                "price_thousand_vnd_m2": val,
                "source_text": joined,
            }
            rec["record_hash"] = sha(rec)
            rows.append(rec)
        buffer = []

    for raw in lines:
        s = clean(raw)
        if not s:
            continue
        n = norm(s)
        if n in {"i khu cong nghiep", "i khu cong nghiep"} or re.fullmatch(r"i\s+khu cong nghiep", n):
            flush(); section = "I"; continue
        if re.fullmatch(r"ii\s+cum cong nghiep", n):
            flush(); section = "II"; continue
        if re.match(r"^\d{1,3}\s+", s):
            flush(); buffer = [s]
        elif buffer:
            buffer.append(s)
    flush()
    return {"schema": "named-file3-kcn-ccn-v1", "rows": rows, "count": len(rows)}


def parse_file4_hightech(lines: list[str]) -> dict[str, Any]:
    rows = []
    for raw in lines:
        s = clean(raw)
        m = re.match(rf"^(\d{{1,2}})\s+(.+?)\s+({PRICE_TOKEN})\s+({PRICE_TOKEN})\s+({PRICE_TOKEN})$", s)
        if not m:
            continue
        rec = {
            "source_tt": int(m.group(1)),
            "road": clean(m.group(2)),
            "prices": {
                "NN_KHAC": price(m.group(3)),
                "TMDV": price(m.group(4)),
                "SXKD_PNN_KHONG_TMDV": price(m.group(5)),
            },
            "source_text": s,
        }
        rec["record_hash"] = sha(rec)
        rows.append(rec)
    return {"schema": "named-file4-hightech-v1", "rows": rows, "count": len(rows)}


def looks_admin(s: str) -> bool:
    n = norm(s)
    return bool(re.fullmatch(r"(?:phuong|xa)\s+.+", n)) and not re.search(r"\d", s)


def parse_file4_tdc(lines: list[str]) -> dict[str, Any]:
    rows: list[dict[str, Any]] = []
    area = ""
    tdc_name = ""
    pending_name: list[str] = []

    for raw in lines:
        s = clean(raw)
        if not s:
            continue
        n = norm(s)
        if n.startswith("phu luc") or "bang gia dat cac khu tai dinh cu" in n or "ban hanh kem theo" in n or "don vi tinh" in n or n.startswith("tt ten khu tai dinh cu"):
            continue
        if looks_admin(s):
            area = s
            tdc_name = ""
            pending_name = []
            continue

        numbered = re.match(r"^(\d{1,3})\s+(.+)$", s)
        if numbered and not re.search(rf"\s{PRICE_TOKEN}$", s):
            tdc_name = clean(numbered.group(2))
            pending_name = [tdc_name]
            continue

        priced = re.match(rf"^(.+?)\s+({PRICE_TOKEN})$", s)
        if priced:
            route = clean(priced.group(1))
            val = price(priced.group(2))
            # If a wrapped TDC name was continued before the route, keep it.
            if pending_name and route and not any(k in norm(route) for k in ("duong", "cac duong", "cac tuyen", "quoc lo", "cac thua")):
                pending_name.append(route)
                tdc_name = clean(" ".join(pending_name))
                continue
            rec = {
                "admin_unit": area,
                "tdc_name": tdc_name,
                "route_or_scope": route,
                "price_thousand_vnd_m2": val,
                "source_text": s,
            }
            rec["record_hash"] = sha(rec)
            rows.append(rec)
            pending_name = []
            continue

        if tdc_name and not re.match(r"^\d+\s+", s):
            # Long wrapped TDC name or route description; append only until a priced line arrives.
            if pending_name:
                pending_name.append(s)
                tdc_name = clean(" ".join(pending_name))

    return {"schema": "named-file4-tdc-v1", "rows": rows, "count": len(rows)}


def parse_file5_reference(lines: list[str]) -> dict[str, Any]:
    # File 5 is reference-only. Preserve cleaned lines; do not invent a price.
    cleaned = []
    for raw in lines:
        s = clean(raw)
        n = norm(s)
        if not s or n.startswith("phu luc") or "ban hanh kem theo" in n:
            continue
        cleaned.append(s)
    return {"schema": "named-file5-main-roads-reference-v1", "has_price": False, "lines": cleaned, "line_count": len(cleaned)}


def parse_file6_bounds(lines: list[str]) -> dict[str, Any]:
    rows = []
    bound = None
    for raw in lines:
        s = clean(raw)
        n = norm(s)
        if "gia dat nong nghiep toi thieu" in n:
            bound = "MIN"; continue
        if "gia dat nong nghiep toi da" in n:
            bound = "MAX"; continue
        m = re.match(rf"^(\d{{1,3}})\s+((?:Phường|Xã)\s+.+?)\s+({PRICE_TOKEN})\s+({PRICE_TOKEN})\s+({PRICE_TOKEN})\s+({PRICE_TOKEN})$", s)
        if not m or not bound:
            continue
        rec = {
            "bound_type": bound,
            "source_tt": int(m.group(1)),
            "admin_unit": clean(m.group(2)),
            "prices": {
                "CLN": price(m.group(3)),
                "HNK": price(m.group(4)),
                "NTS": price(m.group(5)),
                "RSX": price(m.group(6)),
            },
            "source_text": s,
        }
        rec["record_hash"] = sha(rec)
        rows.append(rec)
    return {"schema": "named-file6-agri-bounds-v1", "rows": rows, "count": len(rows)}


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--source-dir", type=Path, required=True)
    ap.add_argument("--output", type=Path, required=True)
    args = ap.parse_args()
    src = args.source_dir.resolve(); out = args.output.resolve(); out.mkdir(parents=True, exist_ok=True)

    names = {
        "f3": "3 Đất KCN - Cụm Công Nghiệp-4285-4289.pdf",
        "f4": "4. Đất Khu C.NGhệ - Tái Định Cư-4289-4304.pdf",
        "f5": "5. Các tuyến đường chính-4304-4390.pdf",
        "f6": "6. Đất NN tối thiểu- tối đa-4390-4396.pdf",
    }
    texts = {k: text_from_pdf(src / v).splitlines() for k, v in names.items()}

    f3 = parse_file3_kcn_ccn(slice_between(texts["f3"], "IV", "V"))
    f4_high = parse_file4_hightech(slice_between(texts["f4"], "V", "VI"))
    f4_tdc = parse_file4_tdc(slice_between(texts["f4"], "VI", "VII"))
    f5 = parse_file5_reference(slice_between(texts["f5"], "VII", "VIII"))
    f6 = parse_file6_bounds(slice_between(texts["f6"], "VIII", None))

    outputs = {
        "file3_kcn_ccn.json": f3,
        "file4_hightech.json": f4_high,
        "file4_tdc.json": f4_tdc,
        "file5_main_roads_reference.json": f5,
        "file6_agri_bounds.json": f6,
    }
    for name, obj in outputs.items():
        (out / name).write_text(json.dumps(obj, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    summary = {
        "classificationAuthority": "user-assigned split filename",
        "pageSuffixRole": "bookmark_only",
        "file3": {"kcnCcnRows": f3["count"]},
        "file4": {"hightechRows": f4_high["count"], "tdcPriceRows": f4_tdc["count"]},
        "file5": {"referenceLineCount": f5["line_count"], "hasPrice": False},
        "file6": {"boundRows": f6["count"]},
        "runtimeOrD1Modified": False,
    }
    (out / "summary.json").write_text(json.dumps(summary, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(summary, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
