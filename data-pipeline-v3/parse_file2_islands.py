#!/usr/bin/env python3
from __future__ import annotations

import argparse
import hashlib
import importlib.util
import json
import re
import sys
import unicodedata
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
V2_BUILDER = ROOT / "data-pipeline-v2" / "build_nq28_area_sources.py"
SPACE_RE = re.compile(r"\s+")
TT_RE = re.compile(r"^\s*(\d+(?:\.\d+)?)(?=\s|$|[.)-])")
MONEY_RE = re.compile(r"^\d{1,3}(?:[.]\d{3})+$|^\d+$")


def load_v2():
    spec = importlib.util.spec_from_file_location("nq28_v2_builder_islands", V2_BUILDER)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"Cannot load {V2_BUILDER}")
    mod = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = mod
    spec.loader.exec_module(mod)
    return mod


v2 = load_v2()


def norm(s: str) -> str:
    x = unicodedata.normalize("NFD", s or "")
    x = "".join(c for c in x if unicodedata.category(c) != "Mn")
    x = x.replace("đ", "d").replace("Đ", "D").lower()
    x = re.sub(r"[^a-z0-9]+", " ", x)
    return SPACE_RE.sub(" ", x).strip()


def clean(s: str) -> str:
    return SPACE_RE.sub(" ", (s or "").replace("\xa0", " ")).strip()


def money(s: str) -> int | None:
    t = s.strip()
    if not MONEY_RE.fullmatch(t):
        return None
    try:
        return int(t.replace(".", ""))
    except ValueError:
        return None


def record_hash(obj: dict[str, Any]) -> str:
    raw = json.dumps(obj, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")
    return hashlib.sha256(raw).hexdigest()


def line_center(line: Any) -> float:
    return int(line.page) * 1000.0 + (float(line.top) + float(line.bottom)) / 2.0


def word_center(word: Any) -> float:
    return int(word.page) * 1000.0 + float(word.top) + float(word.height) / 2.0


def find_end(lines: list[Any]) -> int:
    for i, line in enumerate(lines):
        if norm(line.text) == "phu luc iii":
            return i
    raise RuntimeError("Cannot find Phụ lục III boundary in named file 2")


def parse(source: Path, work: Path) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    lines, page_count, tsv_path = v2.parse_words(source, work)
    end = find_end(lines)
    selected = lines[:end]

    price_words: list[Any] = []
    for line in selected:
        for word in line.words:
            val = money(word.text)
            if val is None or float(word.left) < 300:
                continue
            price_words.append((word, val))

    rows: list[dict[str, Any]] = []
    reviews: list[dict[str, Any]] = []
    anchor_count = 0
    for line in selected:
        if float(line.left) > 145:
            continue
        match = TT_RE.match(line.text)
        if not match:
            continue
        source_tt = match.group(1)
        center = line_center(line)
        aligned = [
            (word, val) for word, val in price_words
            if int(word.page) == int(line.page) and abs(word_center(word) - center) <= 18.5
        ]
        # Island/cù lao table has exactly four purpose-specific price columns.
        aligned.sort(key=lambda item: float(item[0].left))
        dedup: list[tuple[Any, int]] = []
        seen = set()
        for word, val in aligned:
            key = (round(float(word.left), 1), round(float(word.top), 1), val)
            if key in seen:
                continue
            seen.add(key); dedup.append((word, val))
        if len(dedup) != 4:
            continue
        anchor_count += 1
        first_price_x = min(float(word.left) for word, _ in dedup)
        core_words = []
        for other in selected:
            if int(other.page) != int(line.page):
                continue
            for word in other.words:
                if 108 <= float(word.left) < first_price_x - 4 and abs(word_center(word) - center) <= 26.0:
                    core_words.append(word)
        core_words.sort(key=lambda w: (float(w.top), float(w.left)))
        body = clean(" ".join(w.text for w in core_words))
        body = re.sub(rf"^\s*{re.escape(source_tt)}\s*[.)-]?\s*", "", body, count=1).strip()

        loc_match = re.search(r"\b(?:Phường|Xã)\s+.+$", body, flags=re.IGNORECASE)
        if loc_match:
            name = clean(body[:loc_match.start()])
            location = clean(body[loc_match.start():])
        else:
            name = body
            location = ""
        vals = [val for _, val in dedup]
        rec = {
            "source_tt": source_tt,
            "name": name,
            "location": location,
            "prices": {
                "NN": vals[0],
                "DAT_O": vals[1],
                "TMDV": vals[2],
                "SXKD_PNN_KHONG_TMDV": vals[3],
            },
            "source": {
                "page": int(line.page),
                "anchor_text": line.text,
                "anchor_y": round(center - int(line.page) * 1000.0, 3),
                "price_x": [round(float(word.left), 3) for word, _ in dedup],
                "core_text": body,
            },
            "review": [],
        }
        if not name:
            rec["review"].append("ISLAND_NAME_EMPTY")
        if not location:
            rec["review"].append("ISLAND_LOCATION_EMPTY")
        if "dao" not in norm(name) and "cu lao" not in norm(name):
            rec["review"].append("ISLAND_NAME_MARKER_NOT_FOUND")
        if rec["review"]:
            reviews.append({"source_tt": source_tt, "flags": rec["review"], "core_text": body})
        rec["record_hash"] = record_hash({k: v for k, v in rec.items() if k != "review"})
        rows.append(rec)

    # Prevent duplicate anchors if a cell is repeated by the PDF text layer.
    unique_rows = []
    seen_hash = set()
    for row in rows:
        if row["record_hash"] in seen_hash:
            continue
        seen_hash.add(row["record_hash"]); unique_rows.append(row)

    validation = {
        "sourcePageCount": page_count,
        "boundaryPage": int(selected[-1].page) if selected else None,
        "fourPriceAnchorCount": anchor_count,
        "recordCount": len(unique_rows),
        "reviewCount": len(reviews),
        "sourceTts": [row["source_tt"] for row in unique_rows],
        "tsvSha256": v2.sha256_file(tsv_path),
    }
    return unique_rows, {"validation": validation, "reviews": reviews}


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--source", type=Path, required=True)
    ap.add_argument("--output", type=Path, required=True)
    args = ap.parse_args()
    source = args.source.resolve()
    work = args.output.parent / ".island-work"
    work.mkdir(parents=True, exist_ok=True)
    rows, diag = parse(source, work)
    result = {
        "schema": "named-file2-islands-v2-coordinate",
        "classificationAuthority": "user-assigned split filename",
        "pageSuffixRole": "bookmark_only",
        "rows": rows,
        "count": len(rows),
        **diag,
        "acceptedForRuntime": bool(rows) and diag["validation"]["reviewCount"] == 0,
        "runtimeOrD1Modified": False,
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"count": len(rows), **diag["validation"]}, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
