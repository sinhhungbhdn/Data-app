#!/usr/bin/env python3
from __future__ import annotations

import argparse
import hashlib
import json
import re
import shutil
import subprocess
import unicodedata
from collections import Counter, defaultdict
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
    """Parse file 3 only. The filename fixes semantics as KCN/CCN.

    A wrapped location can be printed after the price on the next visual line, so
    price is selected as the last numeric token >=100 inside the complete TT block,
    not necessarily the last text token in the joined block.
    """
    rows: list[dict[str, Any]] = []
    reviews: list[dict[str, Any]] = []
    section: str | None = None
    buffer: list[str] = []
    expected_tts: dict[str, set[int]] = defaultdict(set)

    def flush() -> None:
        nonlocal buffer
        if not buffer or section is None:
            buffer = []
            return
        joined = clean(" ".join(buffer))
        head = re.match(r"^(\d{1,3})\s+(.+)$", joined)
        if not head:
            buffer = []
            return
        tt = int(head.group(1)); rest = head.group(2)
        numeric = []
        for m in re.finditer(rf"(?<!\d)({PRICE_TOKEN})(?!\d)", rest):
            try:
                value = price(m.group(1))
            except ValueError:
                continue
            if value >= 100:
                numeric.append((m, value))
        if not numeric:
            reviews.append({"code": "FILE3_PRICE_NOT_FOUND", "group": section, "source_tt": tt, "source_text": joined})
            buffer = []
            return
        price_match, val = numeric[-1]
        body = clean(rest[:price_match.start()] + " " + rest[price_match.end():])
        loc_match = re.search(r"\b(Phường|Xã)\s+.+$", body, flags=re.IGNORECASE)
        if loc_match:
            name = clean(body[:loc_match.start()])
            location = clean(body[loc_match.start():])
        else:
            name, location = body, ""
            reviews.append({"code": "FILE3_LOCATION_NOT_PARSED", "group": section, "source_tt": tt, "source_text": joined})
        rec = {
            "group": section,
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
        if re.fullmatch(r"i\s+khu cong nghiep", n):
            flush(); section = "KCN"; continue
        if re.fullmatch(r"ii\s+cum cong nghiep", n):
            flush(); section = "CCN"; continue
        row_start = re.match(r"^(\d{1,3})\s+", s)
        if row_start and section:
            flush()
            tt = int(row_start.group(1))
            expected_tts[section].add(tt)
            buffer = [s]
        elif buffer:
            buffer.append(s)
    flush()

    parsed_by_group: dict[str, set[int]] = defaultdict(set)
    for row in rows:
        parsed_by_group[row["group"]].add(int(row["source_tt"]))
    group_validation = {}
    for group in ("KCN", "CCN"):
        expected = sorted(expected_tts[group])
        parsed = sorted(parsed_by_group[group])
        group_validation[group] = {
            "sourceTtCount": len(expected),
            "parsedTtCount": len(parsed),
            "sourceTts": expected,
            "parsedTts": parsed,
            "missingParsedTts": sorted(set(expected) - set(parsed)),
            "unexpectedParsedTts": sorted(set(parsed) - set(expected)),
        }
    accepted = all(not v["missingParsedTts"] and not v["unexpectedParsedTts"] for v in group_validation.values()) and not any(r["code"] == "FILE3_PRICE_NOT_FOUND" for r in reviews)
    return {
        "schema": "named-file3-kcn-ccn-v2",
        "rows": rows,
        "count": len(rows),
        "groupValidation": group_validation,
        "reviews": reviews,
        "acceptedForRuntime": accepted,
    }


def parse_file4_hightech(lines: list[str]) -> dict[str, Any]:
    rows = []
    source_tts = []
    for raw in lines:
        s = clean(raw)
        if re.match(r"^\d{1,2}\s+", s):
            source_tts.append(int(re.match(r"^(\d{1,2})", s).group(1)))
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
    parsed = [r["source_tt"] for r in rows]
    missing = sorted(set(source_tts) - set(parsed))
    return {
        "schema": "named-file4-hightech-v2", "rows": rows, "count": len(rows),
        "validation": {"sourceTts": sorted(set(source_tts)), "parsedTts": sorted(set(parsed)), "missingParsedTts": missing},
        "acceptedForRuntime": not missing and bool(rows),
    }


def looks_admin(s: str) -> bool:
    n = norm(s)
    return bool(re.fullmatch(r"(?:phuong|xa)\s+.+", n)) and not re.search(r"\d", s)


def parse_file4_tdc(lines: list[str]) -> dict[str, Any]:
    """Legacy plain-layout TDC extraction kept only as evidence.

    It is NOT runtime-approved unless all structural checks are clean. A separate
    coordinate parser will replace this if wrapped name/route cells are ambiguous.
    """
    rows: list[dict[str, Any]] = []
    area = ""; tdc_name = ""; pending_name: list[str] = []
    for raw in lines:
        s = clean(raw)
        if not s:
            continue
        n = norm(s)
        if n.startswith("phu luc") or "bang gia dat cac khu tai dinh cu" in n or "ban hanh kem theo" in n or "don vi tinh" in n or n.startswith("tt ten khu tai dinh cu"):
            continue
        if looks_admin(s):
            area = s; tdc_name = ""; pending_name = []; continue
        numbered = re.match(r"^(\d{1,3})\s+(.+)$", s)
        if numbered and not re.search(rf"\s{PRICE_TOKEN}$", s):
            tdc_name = clean(numbered.group(2)); pending_name = [tdc_name]; continue
        priced = re.match(rf"^(.+?)\s+({PRICE_TOKEN})$", s)
        if priced:
            route = clean(priced.group(1)); val = price(priced.group(2))
            if pending_name and route and not any(k in norm(route) for k in ("duong", "cac duong", "cac tuyen", "quoc lo", "cac thua")):
                pending_name.append(route); tdc_name = clean(" ".join(pending_name)); continue
            rec = {
                "admin_unit": area, "tdc_name": tdc_name, "route_or_scope": route,
                "price_thousand_vnd_m2": val, "source_text": s,
            }
            rec["record_hash"] = sha(rec); rows.append(rec); pending_name = []; continue
        if tdc_name and not re.match(r"^\d+\s+", s) and pending_name:
            pending_name.append(s); tdc_name = clean(" ".join(pending_name))

    hashes = Counter(r["record_hash"] for r in rows)
    blank_name = [r for r in rows if not r["tdc_name"]]
    suspicious_name = [r for r in rows if re.search(r"\b\d{1,3}\.\d{3}\b", r["tdc_name"])]
    missing_area = [r for r in rows if not r["admin_unit"]]
    duplicates = sum(c - 1 for c in hashes.values() if c > 1)
    validation = {
        "blankTdcNameCount": len(blank_name),
        "suspiciousPriceInsideNameCount": len(suspicious_name),
        "missingAdminUnitCount": len(missing_area),
        "exactDuplicateRecordCount": duplicates,
    }
    accepted = all(v == 0 for v in validation.values()) and bool(rows)
    return {
        "schema": "named-file4-tdc-evidence-v2", "rows": rows, "count": len(rows),
        "validation": validation, "acceptedForRuntime": accepted,
    }


def parse_file5_reference(lines: list[str]) -> dict[str, Any]:
    cleaned = []
    for raw in lines:
        s = clean(raw); n = norm(s)
        if not s or n.startswith("phu luc") or "ban hanh kem theo" in n:
            continue
        cleaned.append(s)
    return {
        "schema": "named-file5-main-roads-reference-v2", "has_price": False,
        "lines": cleaned, "line_count": len(cleaned), "acceptedAsPriceDataset": False,
    }


def parse_file6_bounds(lines: list[str]) -> dict[str, Any]:
    rows = []; bound = None; source_tts: dict[str, set[int]] = defaultdict(set)
    for raw in lines:
        s = clean(raw); n = norm(s)
        if "gia dat nong nghiep toi thieu" in n:
            bound = "MIN"; continue
        if "gia dat nong nghiep toi da" in n:
            bound = "MAX"; continue
        raw_row = re.match(r"^(\d{1,3})\s+((?:Phường|Xã)\s+.+)", s)
        if raw_row and bound:
            source_tts[bound].add(int(raw_row.group(1)))
        m = re.match(rf"^(\d{{1,3}})\s+((?:Phường|Xã)\s+.+?)\s+({PRICE_TOKEN})\s+({PRICE_TOKEN})\s+({PRICE_TOKEN})\s+({PRICE_TOKEN})$", s)
        if not m or not bound:
            continue
        rec = {
            "bound_type": bound, "source_tt": int(m.group(1)), "admin_unit": clean(m.group(2)),
            "prices": {"CLN": price(m.group(3)), "HNK": price(m.group(4)), "NTS": price(m.group(5)), "RSX": price(m.group(6))},
            "source_text": s,
        }
        rec["record_hash"] = sha(rec); rows.append(rec)
    parsed_tts: dict[str, set[int]] = defaultdict(set)
    for r in rows:
        parsed_tts[r["bound_type"]].add(r["source_tt"])
    validation = {}
    for b in ("MIN", "MAX"):
        expected = source_tts[b]; parsed = parsed_tts[b]
        validation[b] = {
            "sourceTtCount": len(expected), "parsedTtCount": len(parsed),
            "minTt": min(expected) if expected else None, "maxTt": max(expected) if expected else None,
            "missingParsedTts": sorted(expected - parsed), "unexpectedParsedTts": sorted(parsed - expected),
        }
    accepted = all(not v["missingParsedTts"] and not v["unexpectedParsedTts"] for v in validation.values()) and bool(rows)
    return {
        "schema": "named-file6-agri-bounds-v2", "rows": rows, "count": len(rows),
        "validation": validation, "acceptedForRuntime": accepted,
    }


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
        "file3_kcn_ccn.json": f3, "file4_hightech.json": f4_high,
        "file4_tdc.json": f4_tdc, "file5_main_roads_reference.json": f5,
        "file6_agri_bounds.json": f6,
    }
    for name, obj in outputs.items():
        (out / name).write_text(json.dumps(obj, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    summary = {
        "classificationAuthority": "user-assigned split filename", "pageSuffixRole": "bookmark_only",
        "file3": {"rows": f3["count"], "validation": f3["groupValidation"], "acceptedForRuntime": f3["acceptedForRuntime"], "reviewCount": len(f3["reviews"])},
        "file4": {
            "hightechRows": f4_high["count"], "hightechAccepted": f4_high["acceptedForRuntime"],
            "tdcEvidenceRows": f4_tdc["count"], "tdcValidation": f4_tdc["validation"],
            "tdcAccepted": f4_tdc["acceptedForRuntime"],
        },
        "file5": {"referenceLineCount": f5["line_count"], "hasPrice": False},
        "file6": {"boundRows": f6["count"], "validation": f6["validation"], "acceptedForRuntime": f6["acceptedForRuntime"]},
        "runtimeOrD1Modified": False,
    }
    (out / "summary.json").write_text(json.dumps(summary, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(summary, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
