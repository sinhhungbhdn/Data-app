#!/usr/bin/env python3
"""Inventory Appendix I..VIII boundaries from the six split NQ28 PDFs.

The split filenames are transport boundaries only. Appendix identity is detected
from legal headings inside page text. An explicit initial appendix is used only
for the overlapping first pages that start mid-appendix; all later transitions
must be supported by an in-document appendix heading.
"""

from __future__ import annotations

import argparse
import json
import re
import shutil
import subprocess
import unicodedata
from collections import Counter
from pathlib import Path
from typing import Any


SOURCES = [
    ("1. Đất NN 1-2140.pdf", "I"),
    ("2 Đất Đảo, Phi Nông Nghiệp -2140-4285.pdf", "I"),
    ("3 Đất KCN - Cụm Công Nghiệp-4285-4289.pdf", "III"),
    ("4. Đất Khu C.NGhệ - Tái Định Cư-4289-4304.pdf", "IV"),
    ("5. Các tuyến đường chính-4304-4390.pdf", "VI"),
    ("6. Đất NN tối thiểu- tối đa-4390-4396.pdf", "VII"),
]
APPENDIX_TITLES = {
    "I": "BẢNG GIÁ CÁC LOẠI ĐẤT NÔNG NGHIỆP",
    "II": "BẢNG GIÁ CÁC LOẠI ĐẤT TẠI CÁC ĐẢO, CÙ LAO",
    "III": "BẢNG GIÁ CÁC LOẠI ĐẤT PHI NÔNG NGHIỆP",
    "IV": "BẢNG GIÁ ĐẤT CÁC KHU CÔNG NGHIỆP, CỤM CÔNG NGHIỆP",
    "V": "BẢNG GIÁ ĐẤT TRONG KHU CÔNG NGHỆ CAO CÔNG NGHỆ SINH HỌC ĐỒNG NAI",
    "VI": "BẢNG GIÁ ĐẤT CÁC KHU TÁI ĐỊNH CƯ",
    "VII": "CÁC TUYẾN ĐƯỜNG GIAO THÔNG CHÍNH",
    "VIII": "GIÁ ĐẤT NÔNG NGHIỆP TỐI THIỂU VÀ TỐI ĐA",
}
ROMAN_ORDER = ["I", "II", "III", "IV", "V", "VI", "VII", "VIII"]
SPACE_RE = re.compile(r"\s+")


def normalize(text: str) -> str:
    value = unicodedata.normalize("NFD", text or "")
    value = "".join(ch for ch in value if unicodedata.category(ch) != "Mn")
    value = value.replace("đ", "d").replace("Đ", "D").lower()
    value = re.sub(r"[^a-z0-9]+", " ", value)
    return SPACE_RE.sub(" ", value).strip()


NORMALIZED_TITLES = {key: normalize(value) for key, value in APPENDIX_TITLES.items()}


def run_pdftotext(pdf: Path, txt: Path) -> None:
    exe = shutil.which("pdftotext")
    if not exe:
        raise RuntimeError("pdftotext is not installed")
    result = subprocess.run([exe, "-layout", str(pdf), str(txt)], text=True, capture_output=True, check=False)
    if result.returncode != 0:
        raise RuntimeError(f"pdftotext failed for {pdf.name}: {result.stderr}")


def detect_headings(page_text: str) -> list[str]:
    norm = normalize(page_text)
    found: list[str] = []
    # Legal title is the strongest signal and avoids TOC-style bare appendix names.
    for appendix in ROMAN_ORDER:
        title = NORMALIZED_TITLES[appendix]
        if title and title in norm:
            found.append(appendix)
    # On a split boundary the heading may be line-broken oddly; accept 'Phụ lục X'
    # only when the page also contains a price-table/title keyword.
    if any(token in norm for token in ("bang gia", "cac tuyen duong giao thong chinh", "gia dat nong nghiep toi thieu")):
        for appendix in ROMAN_ORDER:
            if re.search(rf"\bphu luc {appendix.lower()}\b", norm) and appendix not in found:
                found.append(appendix)
    return sorted(found, key=ROMAN_ORDER.index)


def page_excerpt(page_text: str, limit: int = 1000) -> str:
    lines = [SPACE_RE.sub(" ", line).strip() for line in page_text.splitlines() if line.strip()]
    return " | ".join(lines[:18])[:limit]


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--source-dir", type=Path, required=True)
    parser.add_argument("--work", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()

    source_dir = args.source_dir.resolve()
    work = args.work.resolve()
    output = args.output.resolve()
    work.mkdir(parents=True, exist_ok=True)
    output.mkdir(parents=True, exist_ok=True)

    files: list[dict[str, Any]] = []
    total_counts: Counter[str] = Counter()
    all_headings: list[dict[str, Any]] = []

    for filename, initial_appendix in SOURCES:
        pdf = source_dir / filename
        if not pdf.is_file():
            raise FileNotFoundError(pdf)
        txt = work / (pdf.stem + ".txt")
        run_pdftotext(pdf, txt)
        raw = txt.read_text(encoding="utf-8", errors="replace")
        pages = raw.split("\f")
        if pages and not pages[-1].strip():
            pages.pop()

        current = initial_appendix
        counts: Counter[str] = Counter()
        transitions: list[dict[str, Any]] = []
        page_assignments: list[dict[str, Any]] = []
        for page_no, page_text in enumerate(pages, start=1):
            headings = detect_headings(page_text)
            previous = current
            if headings:
                # The last appendix heading on a page controls following content.
                current = headings[-1]
                event = {
                    "file": filename,
                    "page": page_no,
                    "from": previous,
                    "to": current,
                    "headings": headings,
                    "excerpt": page_excerpt(page_text),
                }
                transitions.append(event)
                all_headings.append(event)
            counts[current] += 1
            total_counts[current] += 1
            page_assignments.append({
                "page": page_no,
                "appendix": current,
                "headingAppendices": headings,
                "mixedBoundaryPage": bool(headings and previous != current),
            })

        files.append({
            "file": filename,
            "initialAppendix": initial_appendix,
            "pageCount": len(pages),
            "appendixPageCounts": dict(counts),
            "transitions": transitions,
            "pages": page_assignments,
        })

    covered = [appendix for appendix in ROMAN_ORDER if total_counts[appendix] > 0]
    missing = [appendix for appendix in ROMAN_ORDER if total_counts[appendix] == 0]
    result = {
        "schema": "nq28-pdf-appendix-inventory-v1",
        "principle": "appendix identity comes from legal headings; split filename is not land-purpose semantics",
        "appendixTitles": APPENDIX_TITLES,
        "coveredAppendices": covered,
        "missingAppendices": missing,
        "pageCountsByAppendix": dict(total_counts),
        "headingEvents": all_headings,
        "files": files,
    }
    json_path = output / "pdf-appendix-inventory.json"
    preview_path = output / "pdf-appendix-inventory.preview.txt"
    json_path.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    with preview_path.open("w", encoding="utf-8", newline="\n") as f:
        f.write(f"COVERED={covered} | MISSING={missing} | PAGE_COUNTS={dict(total_counts)}\n")
        for item in files:
            f.write(
                f"FILE={item['file']} | PAGES={item['pageCount']} | INITIAL={item['initialAppendix']} | "
                f"COUNTS={item['appendixPageCounts']}\n"
            )
            for event in item["transitions"]:
                f.write(
                    f"  PAGE={event['page']} | {event['from']} -> {event['to']} | "
                    f"HEADINGS={event['headings']} | {event['excerpt']}\n"
                )
    print(json.dumps({
        "coveredAppendices": covered,
        "missingAppendices": missing,
        "pageCountsByAppendix": dict(total_counts),
        "headingEventCount": len(all_headings),
    }, ensure_ascii=False, indent=2))
    return 2 if missing else 0


if __name__ == "__main__":
    raise SystemExit(main())
