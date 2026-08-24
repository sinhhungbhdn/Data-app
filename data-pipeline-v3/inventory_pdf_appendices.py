#!/usr/bin/env python3
"""Inventory Appendix I..VIII boundaries from the six split NQ28 PDFs.

The split filenames are transport boundaries only. Appendix identity changes only
at a legal appendix heading in source content. A heading is accepted only when the
current source line itself is a short standalone ``Phụ lục X`` line and the
following lines contain the matching legal title plus the promulgation marker.
This rejects TOC rows and prose such as ``Phụ lục I (hoặc Phụ lục III)``.
Boundaries are line-level because one split-PDF page can contain two appendices.
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
    # Initial appendix is only a carry-in for a split file that starts mid-appendix.
    ("1. Đất NN 1-2140.pdf", "I"),
    ("2 Đất Đảo, Phi Nông Nghiệp -2140-4285.pdf", "II"),
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
ROMAN_RE = "|".join(reversed(ROMAN_ORDER))
SPACE_RE = re.compile(r"\s+")


def normalize(text: str) -> str:
    value = unicodedata.normalize("NFD", text or "")
    value = "".join(ch for ch in value if unicodedata.category(ch) != "Mn")
    value = value.replace("đ", "d").replace("Đ", "D").lower()
    value = re.sub(r"[^a-z0-9]+", " ", value)
    return SPACE_RE.sub(" ", value).strip()


def clean(text: str) -> str:
    return SPACE_RE.sub(" ", (text or "").replace("\xa0", " ")).strip()


def run_pdftotext(pdf: Path, txt: Path) -> None:
    exe = shutil.which("pdftotext")
    if not exe:
        raise RuntimeError("pdftotext is not installed")
    result = subprocess.run([exe, "-layout", str(pdf), str(txt)], text=True, capture_output=True, check=False)
    if result.returncode != 0:
        raise RuntimeError(f"pdftotext failed for {pdf.name}: {result.stderr}")


def flatten_pages(raw: str) -> tuple[list[dict[str, Any]], int]:
    pages = raw.split("\f")
    if pages and not pages[-1].strip():
        pages.pop()
    refs: list[dict[str, Any]] = []
    for page_no, page in enumerate(pages, start=1):
        for line_no, line in enumerate(page.splitlines(), start=1):
            text = clean(line)
            if text:
                refs.append({"page": page_no, "line": line_no, "text": text, "norm": normalize(text)})
    return refs, len(pages)


def detect_legal_heading(refs: list[dict[str, Any]], index: int) -> tuple[str, str] | None:
    """Return a legal appendix heading only for an actual standalone heading line."""
    current = refs[index]
    line_norm = current["norm"]

    # Critical guard: do not search across multiple lines for the marker. The current
    # line itself must be exactly "Phụ lục X" (punctuation is removed by normalize).
    match = re.fullmatch(rf"phu luc\s+({ROMAN_RE.lower()})", line_norm)
    if not match:
        return None
    appendix = match.group(1).upper()

    # A genuine heading is followed very closely by its title and promulgation line.
    # Eight non-empty source lines is enough for wrapped titles but too tight for TOC
    # contamination elsewhere on the page.
    nearby_refs = refs[index : min(len(refs), index + 8)]
    nearby = " ".join(ref["text"] for ref in nearby_refs)
    nearby_norm = normalize(nearby)
    if "ban hanh kem theo nghi quyet" not in nearby_norm:
        return None

    expected_title = normalize(APPENDIX_TITLES[appendix])
    strong = {
        "I": "bang gia cac loai dat nong nghiep",
        "II": "bang gia cac loai dat tai cac dao cu lao",
        "III": "bang gia cac loai dat phi nong nghiep",
        "IV": "khu cong nghiep cum cong nghiep",
        "V": "cong nghe cao cong nghe sinh hoc dong nai",
        "VI": "bang gia dat cac khu tai dinh cu",
        "VII": "cac tuyen duong giao thong chinh",
        "VIII": "gia dat nong nghiep toi thieu va toi da",
    }[appendix]
    if expected_title not in nearby_norm and strong not in nearby_norm:
        return None
    return appendix, nearby


def ref_label(ref: dict[str, Any] | None) -> dict[str, Any] | None:
    if not ref:
        return None
    return {"page": ref["page"], "line": ref["line"], "text": ref["text"]}


def excerpt(refs: list[dict[str, Any]], start: int, count: int = 8) -> str:
    return " | ".join(refs[j]["text"] for j in range(start, min(len(refs), start + count)))[:1200]


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
    global_line_counts: Counter[str] = Counter()
    global_heading_counts: Counter[str] = Counter()
    problems: list[dict[str, Any]] = []

    for filename, initial_appendix in SOURCES:
        pdf = source_dir / filename
        if not pdf.is_file():
            raise FileNotFoundError(pdf)
        txt = work / (pdf.stem + ".txt")
        run_pdftotext(pdf, txt)
        refs, page_count = flatten_pages(txt.read_text(encoding="utf-8", errors="replace"))
        if not refs:
            problems.append({"code": "empty_pdf_text", "file": filename})
            continue

        heading_events: list[dict[str, Any]] = []
        detected_at: dict[int, tuple[str, str]] = {}
        for idx in range(len(refs)):
            found = detect_legal_heading(refs, idx)
            if found:
                detected_at[idx] = found

        current = initial_appendix
        counts: Counter[str] = Counter()
        previous_order = ROMAN_ORDER.index(current)
        segment_start = 0
        segments: list[dict[str, Any]] = []

        def close_segment(end_index: int, trigger: str) -> None:
            nonlocal segment_start
            if end_index < segment_start:
                return
            segments.append({
                "appendix": current,
                "start": ref_label(refs[segment_start]),
                "end": ref_label(refs[end_index]),
                "nonemptyLineCount": end_index - segment_start + 1,
                "trigger": trigger,
                "excerpt": excerpt(refs, segment_start),
            })

        for idx, ref in enumerate(refs):
            if idx in detected_at:
                appendix, heading_text = detected_at[idx]
                if appendix != current:
                    close_segment(idx - 1, "before_legal_heading")
                    new_order = ROMAN_ORDER.index(appendix)
                    if new_order < previous_order:
                        problems.append({
                            "code": "appendix_order_regression",
                            "file": filename,
                            "from": current,
                            "to": appendix,
                            "at": ref_label(ref),
                        })
                    heading_events.append({
                        "from": current,
                        "to": appendix,
                        "at": ref_label(ref),
                        "headingText": heading_text,
                        "nearby": excerpt(refs, idx, 12),
                    })
                    current = appendix
                    previous_order = new_order
                    segment_start = idx
                global_heading_counts[appendix] += 1
            counts[current] += 1
            global_line_counts[current] += 1

        close_segment(len(refs) - 1, "end_of_file")
        files.append({
            "file": filename,
            "initialAppendix": initial_appendix,
            "pageCount": page_count,
            "nonemptyLineCount": len(refs),
            "lineCountsByAppendix": dict(counts),
            "headingEvents": heading_events,
            "segments": segments,
        })

    covered = [appendix for appendix in ROMAN_ORDER if global_line_counts[appendix] > 0]
    missing = [appendix for appendix in ROMAN_ORDER if global_line_counts[appendix] == 0]
    if missing:
        problems.append({"code": "missing_appendices", "appendices": missing})

    result = {
        "schema": "nq28-pdf-appendix-line-inventory-v3",
        "principles": [
            "split filename is not land-purpose semantics",
            "TOC and prose cross-references cannot change appendix identity",
            "appendix boundaries are line-level, not page-level",
            "overlap between split files remains explicit for later row deduplication",
        ],
        "appendixTitles": APPENDIX_TITLES,
        "coveredAppendices": covered,
        "missingAppendices": missing,
        "nonemptyLineCountsByAppendix": dict(global_line_counts),
        "legalHeadingCounts": dict(global_heading_counts),
        "problems": problems,
        "files": files,
    }
    (output / "pdf-appendix-inventory.json").write_text(
        json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    preview_path = output / "pdf-appendix-inventory.preview.txt"
    with preview_path.open("w", encoding="utf-8", newline="\n") as f:
        f.write(
            f"COVERED={covered} | MISSING={missing} | PROBLEMS={len(problems)} | "
            f"HEADING_COUNTS={dict(global_heading_counts)}\n"
        )
        for item in files:
            f.write(
                f"FILE={item['file']} | PAGES={item['pageCount']} | INITIAL={item['initialAppendix']} | "
                f"LINES={item['lineCountsByAppendix']}\n"
            )
            for event in item["headingEvents"]:
                f.write(
                    f"  LEGAL_HEADING {event['from']} -> {event['to']} @ "
                    f"P{event['at']['page']}:L{event['at']['line']} | {event['nearby']}\n"
                )
            for segment in item["segments"]:
                f.write(
                    f"  SEG APP={segment['appendix']} | P{segment['start']['page']}:L{segment['start']['line']} -> "
                    f"P{segment['end']['page']}:L{segment['end']['line']} | LINES={segment['nonemptyLineCount']}\n"
                )
        for problem in problems:
            f.write(f"PROBLEM={json.dumps(problem, ensure_ascii=False)}\n")

    print(json.dumps({
        "coveredAppendices": covered,
        "missingAppendices": missing,
        "legalHeadingCounts": dict(global_heading_counts),
        "problemCount": len(problems),
    }, ensure_ascii=False, indent=2))
    return 2 if missing or problems else 0


if __name__ == "__main__":
    raise SystemExit(main())
