#!/usr/bin/env python3
"""Build NQ28 area bundles from the user-named split PDFs.

The file name is the authoritative data group. Page-number suffixes are only
bookmarks of the original document split and never participate in lookup logic.

This script deliberately handles only the two large area tables:
- file 1: agricultural land;
- file 2: non-agricultural land (the island table is handled separately).

Boundary headings are used only to trim the overlapping cut page so content from
an adjacent named file cannot leak into the selected group.
"""
from __future__ import annotations

import argparse
import importlib.util
import json
import shutil
import sys
import unicodedata
import re
from collections import defaultdict
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
V2_BUILDER = ROOT / "data-pipeline-v2" / "build_nq28_area_sources.py"


def load_v2():
    spec = importlib.util.spec_from_file_location("nq28_v2_builder", V2_BUILDER)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"Cannot load {V2_BUILDER}")
    mod = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = mod
    spec.loader.exec_module(mod)
    return mod


v2 = load_v2()
AREAS = v2.AREAS


def normalize(value: str) -> str:
    text = unicodedata.normalize("NFD", value or "")
    text = "".join(ch for ch in text if unicodedata.category(ch) != "Mn")
    text = text.replace("đ", "d").replace("Đ", "D").lower()
    text = re.sub(r"[^a-z0-9]+", " ", text)
    return re.sub(r"\s+", " ", text).strip()


def abs_pos(line: Any) -> float:
    return float(line.page) * 1000.0 + float(line.top)


def find_exact_heading(lines: list[Any], roman: str, *, start_at: int = 0) -> int:
    needle = f"phu luc {roman.lower()}"
    for i in range(start_at, len(lines)):
        if normalize(lines[i].text) == needle:
            return i
    raise RuntimeError(f"Cannot find exact legal heading Phụ lục {roman}")


def trim_named_group(lines: list[Any], mode: str) -> tuple[list[Any], dict[str, Any]]:
    # Markers are only cut-boundary guards. The mode/file name defines semantics.
    if mode == "agricultural":
        start = find_exact_heading(lines, "I")
        end = find_exact_heading(lines, "II", start_at=start + 1)
        expected = "file-1-dat-nn"
    elif mode == "non-agricultural":
        start = find_exact_heading(lines, "III")
        end = find_exact_heading(lines, "IV", start_at=start + 1)
        expected = "file-2-phi-nn"
    else:
        raise ValueError(mode)

    selected = lines[start:end]
    if not selected:
        raise RuntimeError(f"Empty trimmed group for {mode}")
    return selected, {
        "mode": mode,
        "namedGroup": expected,
        "start": {"page": lines[start].page, "top": lines[start].top, "text": lines[start].text},
        "endExclusive": {"page": lines[end].page, "top": lines[end].top, "text": lines[end].text},
        "selectedLineCount": len(selected),
    }


def detect_candidates_scoped(lines: list[Any]) -> tuple[dict[int, int], list[dict[str, Any]]]:
    """Detect area headings only inside the already-trimmed named group."""
    by_page: dict[int, list[Any]] = defaultdict(list)
    for line in lines:
        by_page[int(line.page)].append(line)
    normalized_areas = [(i + 1, area, normalize(area)) for i, area in enumerate(AREAS)]
    normalized_areas.sort(key=lambda item: len(item[2]), reverse=True)
    candidates: dict[int, int] = {}
    diagnostics: list[dict[str, Any]] = []

    for page in sorted(by_page):
        page_lines = sorted(by_page[page], key=lambda item: (item.top, item.left))
        top_lines = [line for line in page_lines if float(line.top) <= 240][:60]
        top_text = " ".join(line.text for line in top_lines)
        norm = normalize(top_text)
        matches = [(no, area) for no, area, needle in normalized_areas if needle and needle in norm]
        if not matches:
            continue
        matches.sort(key=lambda item: len(normalize(item[1])), reverse=True)
        no, area = matches[0]
        candidates[page] = no
        diagnostics.append({
            "page": page,
            "selectedTableNo": no,
            "selectedArea": area,
            "allMatches": [{"tableNo": n, "area": a} for n, a in matches],
            "topText": top_text[:1000],
        })
    return candidates, diagnostics


def build_assignments(lines: list[Any], candidates: dict[int, int], section: str) -> tuple[dict[int, dict[str, Any]], list[dict[str, Any]]]:
    by_page: dict[int, list[Any]] = defaultdict(list)
    for line in lines:
        by_page[int(line.page)].append(line)
    pages = sorted(by_page)
    assignments: dict[int, dict[str, Any]] = {}
    review: list[dict[str, Any]] = []
    current: int | None = None

    for page in pages:
        candidate = candidates.get(page)
        if candidate is not None:
            if current is None:
                current = candidate
                if current != 1:
                    review.append({"code": "FIRST_AREA_NOT_1", "page": page, "tableNo": current})
            elif candidate == current:
                pass
            elif candidate == current + 1:
                current = candidate
            elif candidate > current + 1:
                review.append({"code": "AREA_JUMP", "page": page, "from": current, "to": candidate})
                current = candidate
            elif candidate < current:
                # A road/end-point may contain another administrative-unit name.
                # Never move backwards based on that incidental text.
                review.append({"code": "BACKWARD_CANDIDATE_IGNORED", "page": page, "current": current, "candidate": candidate})

        if current is not None:
            assignments[page] = {
                "sequence": 1,
                "section": section,
                "tableNo": current,
                "area": AREAS[current - 1],
            }
    return assignments, review


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--source", type=Path, required=True)
    ap.add_argument("--mode", choices=["agricultural", "non-agricultural"], required=True)
    ap.add_argument("--work", type=Path, required=True)
    ap.add_argument("--output", type=Path, required=True)
    args = ap.parse_args()

    source = args.source.resolve()
    work = args.work.resolve()
    output = args.output.resolve()
    if work.exists():
        shutil.rmtree(work)
    work.mkdir(parents=True, exist_ok=True)
    output.mkdir(parents=True, exist_ok=True)

    lines, page_count, tsv_path = v2.parse_words(source, work)
    selected, boundary = trim_named_group(lines, args.mode)
    candidates, candidate_diag = detect_candidates_scoped(selected)
    assignments, review = build_assignments(selected, candidates, args.mode)

    reports = v2.write_area_bundles(selected, assignments, output, 1, len(AREAS))
    missing = [r["tableNo"] for r in reports if r["segmentCount"] == 0]
    manifest = {
        "schema": "nq28-named-area-source-v3",
        "sourceFile": source.name,
        "sourcePageCount": page_count,
        "sourceTsvSha256": v2.sha256_file(tsv_path),
        "classificationAuthority": "user-assigned split filename",
        "pageSuffixRole": "bookmark_only",
        "boundary": boundary,
        "areaCount": len(AREAS),
        "areasWithSource": len(AREAS) - len(missing),
        "missingAreas": missing,
        "candidateCount": len(candidates),
        "candidateDiagnostics": candidate_diag,
        "review": review,
        "areas": reports,
        "safety": {
            "crossNamedFileFallback": False,
            "ttUsedAsLookupKey": False,
            "runtimeModified": False,
        },
    }
    (output / "source-manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    (output / "summary.txt").write_text(
        f"MODE={args.mode}\nSOURCE={source.name}\nAREAS={len(AREAS)}\nWITH_SOURCE={len(AREAS)-len(missing)}\nMISSING={missing}\nREVIEW={len(review)}\nBOUNDARY={boundary}\n",
        encoding="utf-8",
    )
    print(json.dumps({
        "mode": args.mode,
        "source": source.name,
        "areasWithSource": len(AREAS) - len(missing),
        "missingAreas": missing,
        "reviewCount": len(review),
        "boundary": boundary,
    }, ensure_ascii=False, indent=2))
    return 2 if missing else 0


if __name__ == "__main__":
    raise SystemExit(main())
