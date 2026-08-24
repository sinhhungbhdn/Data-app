#!/usr/bin/env python3
"""Build NQ28 area bundles from the user-named split PDFs.

Classification is fixed by the user's filenames. The page suffix is bookmark-only.
For the two large files, adjacent-table headings are used only to trim the overlap
at the cut boundary. Administrative areas are split only on explicit numbered
headings such as ``3. Phường Tam Hiệp``; road/end-point text cannot change area.
"""
from __future__ import annotations

import argparse
import gzip
import importlib.util
import json
import re
import shutil
import sys
import unicodedata
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


def find_exact_heading(lines: list[Any], roman: str, *, start_at: int = 0) -> int:
    needle = f"phu luc {roman.lower()}"
    for i in range(start_at, len(lines)):
        if normalize(lines[i].text) == needle:
            return i
    raise RuntimeError(f"Cannot find exact legal heading Phụ lục {roman}")


def trim_named_group(lines: list[Any], mode: str) -> tuple[list[Any], dict[str, Any]]:
    # These markers only remove cut-page bleed. They do not determine semantics.
    if mode == "agricultural":
        start = find_exact_heading(lines, "I")
        end = find_exact_heading(lines, "II", start_at=start + 1)
        named_group = "file-1-dat-nn"
    elif mode == "non-agricultural":
        start = find_exact_heading(lines, "III")
        end = find_exact_heading(lines, "IV", start_at=start + 1)
        named_group = "file-2-phi-nn"
    else:
        raise ValueError(mode)
    selected = lines[start:end]
    if not selected:
        raise RuntimeError(f"Empty trimmed group for {mode}")
    return selected, {
        "mode": mode,
        "namedGroup": named_group,
        "start": {"page": lines[start].page, "top": lines[start].top, "text": lines[start].text},
        "endExclusive": {"page": lines[end].page, "top": lines[end].top, "text": lines[end].text},
        "selectedLineCount": len(selected),
    }


def detect_area_headings(lines: list[Any]) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    expected = {i + 1: normalize(area) for i, area in enumerate(AREAS)}
    events: list[dict[str, Any]] = []
    review: list[dict[str, Any]] = []
    for idx, line in enumerate(lines):
        n = normalize(line.text)
        m = re.fullmatch(r"(\d{1,3})\s+(.+)", n)
        if not m:
            continue
        no = int(m.group(1))
        if no not in expected:
            continue
        if m.group(2) != expected[no]:
            continue
        events.append({
            "index": idx,
            "tableNo": no,
            "area": AREAS[no - 1],
            "page": int(line.page),
            "top": float(line.top),
            "text": line.text,
        })

    # Collapse duplicate identical headings if conversion repeats one at a page seam.
    collapsed: list[dict[str, Any]] = []
    for event in events:
        if collapsed and event["tableNo"] == collapsed[-1]["tableNo"]:
            review.append({"code": "REPEATED_AREA_HEADING", "area": event["area"], "page": event["page"]})
            continue
        collapsed.append(event)

    observed = [e["tableNo"] for e in collapsed]
    if observed != list(range(1, len(AREAS) + 1)):
        review.append({
            "code": "AREA_HEADING_SEQUENCE_NOT_EXACT_1_95",
            "observed": observed,
            "missing": [i for i in range(1, len(AREAS) + 1) if i not in observed],
        })
    return collapsed, review


def write_bundles(lines: list[Any], events: list[dict[str, Any]], section: str, output: Path) -> list[dict[str, Any]]:
    areas_dir = output / "areas"
    areas_dir.mkdir(parents=True, exist_ok=True)
    by_area: dict[int, list[tuple[list[Any], dict[str, Any]]]] = defaultdict(list)

    for i, event in enumerate(events):
        start = int(event["index"])
        end = int(events[i + 1]["index"]) if i + 1 < len(events) else len(lines)
        segment_lines = lines[start:end]
        if segment_lines:
            by_area[int(event["tableNo"])].append((segment_lines, event))

    reports: list[dict[str, Any]] = []
    for table_no in range(1, len(AREAS) + 1):
        compact: list[dict[str, Any]] = []
        segments: list[dict[str, Any]] = []
        for seg_lines, event in by_area.get(table_no, []):
            offset = len(compact)
            compact.extend(v2.compact_line(line) for line in seg_lines)
            segments.append({
                "sequence": 1,
                "section": section,
                "pageStart": min(int(line.page) for line in seg_lines),
                "pageEnd": max(int(line.page) for line in seg_lines),
                "pageCount": len({int(line.page) for line in seg_lines}),
                "lineStart": offset,
                "lineCount": len(seg_lines),
                "headingPage": event["page"],
                "headingText": event["text"],
            })

        bundle = {
            "schema": "nq28-area-source-v3-named-file",
            "tableNo": table_no,
            "area": AREAS[table_no - 1],
            "classificationAuthority": "user-assigned split filename",
            "section": section,
            "segments": segments,
            "lines": compact,
        }
        path = areas_dir / f"area-{table_no:03d}.source.json.gz"
        with gzip.open(path, "wt", encoding="utf-8", newline="\n", compresslevel=9) as f:
            json.dump(bundle, f, ensure_ascii=False, separators=(",", ":"), sort_keys=True)
            f.write("\n")
        preview = areas_dir / f"area-{table_no:03d}.preview.txt"
        with preview.open("w", encoding="utf-8", newline="\n") as f:
            f.write(f"TABLE={table_no:03d} | AREA={AREAS[table_no-1]} | SECTION={section} | SEGMENTS={len(segments)}\n")
            for seg in segments:
                f.write(f"--- PAGES={seg['pageStart']}-{seg['pageEnd']} | LINES={seg['lineCount']} | HEADING={seg['headingText']} ---\n")
                a = int(seg["lineStart"]); b = a + int(seg["lineCount"])
                for item in compact[a:b]:
                    f.write(f"P={item['p']:04d} | X={item['x0']:08.3f}-{item['x1']:08.3f} | Y={item['y0']:08.3f}-{item['y1']:08.3f} | {item['t']}\n")
        reports.append({
            "tableNo": table_no,
            "area": AREAS[table_no - 1],
            "segmentCount": len(segments),
            "lineCount": len(compact),
            "pageCount": len({item["p"] for item in compact}),
            "sourceFile": str(path.relative_to(output)),
            "sourceSha256": v2.sha256_file(path),
        })
    return reports


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--source", type=Path, required=True)
    ap.add_argument("--mode", choices=["agricultural", "non-agricultural"], required=True)
    ap.add_argument("--work", type=Path, required=True)
    ap.add_argument("--output", type=Path, required=True)
    args = ap.parse_args()

    source = args.source.resolve(); work = args.work.resolve(); output = args.output.resolve()
    if work.exists():
        shutil.rmtree(work)
    work.mkdir(parents=True, exist_ok=True); output.mkdir(parents=True, exist_ok=True)

    lines, page_count, tsv_path = v2.parse_words(source, work)
    selected, boundary = trim_named_group(lines, args.mode)
    events, review = detect_area_headings(selected)
    reports = write_bundles(selected, events, args.mode, output)
    missing = [r["tableNo"] for r in reports if r["segmentCount"] == 0]

    manifest = {
        "schema": "nq28-named-area-source-v3",
        "sourceFile": source.name,
        "sourcePageCount": page_count,
        "sourceTsvSha256": v2.sha256_file(tsv_path),
        "classificationAuthority": "user-assigned split filename",
        "pageSuffixRole": "bookmark_only",
        "boundary": boundary,
        "areaHeadingCount": len(events),
        "areasWithSource": len(AREAS) - len(missing),
        "missingAreas": missing,
        "headingEvents": events,
        "review": review,
        "areas": reports,
        "safety": {
            "crossNamedFileFallback": False,
            "incidentalAreaNameCanChangeArea": False,
            "ttUsedAsLookupKey": False,
            "runtimeModified": False,
        },
    }
    (output / "source-manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({
        "mode": args.mode,
        "source": source.name,
        "areaHeadingCount": len(events),
        "areasWithSource": len(AREAS)-len(missing),
        "missingAreas": missing,
        "reviewCount": len(review),
        "boundary": boundary,
    }, ensure_ascii=False, indent=2))
    return 2 if missing or len(events) != len(AREAS) else 0


if __name__ == "__main__":
    raise SystemExit(main())
