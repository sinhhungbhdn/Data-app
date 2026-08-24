#!/usr/bin/env python3
"""Build NQ28 area bundles from the user-named split PDFs.

Classification is fixed by the user's filenames. The page suffix is bookmark-only.
For the two large files, adjacent-table headings are used only to trim overlap at
cut boundaries. Administrative areas are split only on explicit numbered source
headings such as ``3. Phường Tam Hiệp``. The source-printed Xã/Phường label is
authoritative; the legacy 95-area catalog is not allowed to override it.

If the same numbered area is printed more than once, an occurrence is dropped only
when its complete normalized source text is byte-for-byte semantically identical
to an earlier occurrence. Non-identical repeats are preserved and flagged.
"""
from __future__ import annotations

import argparse
import gzip
import hashlib
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
AREA_COUNT = 95


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
    # Markers only cut off bleed from adjacent named files. Filename defines meaning.
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


def source_area_label(text: str) -> str:
    return re.sub(r"^\s*\d{1,3}\s*[.)-]?\s*", "", text or "", count=1).strip()


def detect_area_headings(lines: list[Any]) -> tuple[list[dict[str, Any]], list[dict[str, Any]], dict[int, str]]:
    events: list[dict[str, Any]] = []
    review: list[dict[str, Any]] = []
    labels: dict[int, str] = {}

    for idx, line in enumerate(lines):
        n = normalize(line.text)
        m = re.fullmatch(r"(\d{1,3})\s+((?:phuong|xa)\s+.+)", n)
        if not m:
            continue
        no = int(m.group(1))
        if not 1 <= no <= AREA_COUNT:
            continue
        # A real area heading is a short left-side heading, not a table row/end point.
        if float(line.x0) > 130 or float(line.x1) > 290:
            continue
        printed = source_area_label(line.text)
        if not re.match(r"^(?:Phường|Xã)\b", printed, flags=re.IGNORECASE):
            continue

        previous = labels.get(no)
        if previous is None:
            labels[no] = printed
        elif normalize(previous) != normalize(printed):
            review.append({
                "code": "AREA_LABEL_CHANGED_WITHIN_SOURCE",
                "tableNo": no,
                "first": previous,
                "later": printed,
                "page": int(line.page),
            })

        events.append({
            "index": idx,
            "tableNo": no,
            "area": printed,
            "page": int(line.page),
            "top": float(line.top),
            "text": line.text,
        })

    observed_unique = sorted(set(e["tableNo"] for e in events))
    missing = [i for i in range(1, AREA_COUNT + 1) if i not in observed_unique]
    if missing:
        review.append({
            "code": "AREA_HEADING_NUMBERS_MISSING",
            "observedUnique": observed_unique,
            "missing": missing,
        })

    # The source numbering should never go backward except where an exact duplicated
    # source block is present. Detailed duplicate handling happens after segmentation.
    return events, review, labels


def semantic_segment_hash(seg_lines: list[Any]) -> str:
    payload = "\n".join(normalize(line.text) for line in seg_lines if normalize(line.text))
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def write_bundles(
    lines: list[Any],
    events: list[dict[str, Any]],
    labels: dict[int, str],
    section: str,
    output: Path,
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    areas_dir = output / "areas"
    areas_dir.mkdir(parents=True, exist_ok=True)
    by_area: dict[int, list[tuple[list[Any], dict[str, Any], str]]] = defaultdict(list)
    duplicate_review: list[dict[str, Any]] = []

    # Segment strictly from one explicit area heading to the next explicit heading.
    for i, event in enumerate(events):
        start = int(event["index"])
        end = int(events[i + 1]["index"]) if i + 1 < len(events) else len(lines)
        seg_lines = lines[start:end]
        if not seg_lines:
            continue
        fingerprint = semantic_segment_hash(seg_lines)
        by_area[int(event["tableNo"])].append((seg_lines, event, fingerprint))

    reports: list[dict[str, Any]] = []
    for table_no in range(1, AREA_COUNT + 1):
        compact: list[dict[str, Any]] = []
        segments: list[dict[str, Any]] = []
        seen_hashes: dict[str, dict[str, Any]] = {}
        exact_duplicates = 0
        nonidentical_repeat_count = 0

        candidates = by_area.get(table_no, [])
        if len(candidates) > 1:
            unique_hashes = {fp for _, _, fp in candidates}
            if len(unique_hashes) > 1:
                nonidentical_repeat_count = len(candidates)
                duplicate_review.append({
                    "code": "REPEATED_AREA_WITH_DIFFERENT_CONTENT",
                    "tableNo": table_no,
                    "area": labels.get(table_no, AREAS[table_no - 1]),
                    "occurrences": [
                        {"page": event["page"], "hash": fp}
                        for _, event, fp in candidates
                    ],
                })

        for seg_lines, event, fingerprint in candidates:
            if fingerprint in seen_hashes:
                exact_duplicates += 1
                duplicate_review.append({
                    "code": "EXACT_DUPLICATE_AREA_BLOCK_REMOVED",
                    "tableNo": table_no,
                    "area": labels.get(table_no, event["area"]),
                    "duplicatePage": event["page"],
                    "keptPage": seen_hashes[fingerprint]["page"],
                    "hash": fingerprint,
                })
                continue
            seen_hashes[fingerprint] = event

            offset = len(compact)
            compact.extend(v2.compact_line(line) for line in seg_lines)
            sequence = len(segments) + 1
            segments.append({
                "sequence": sequence,
                "section": section,
                "pageStart": min(int(line.page) for line in seg_lines),
                "pageEnd": max(int(line.page) for line in seg_lines),
                "pageCount": len({int(line.page) for line in seg_lines}),
                "lineStart": offset,
                "lineCount": len(seg_lines),
                "headingPage": event["page"],
                "headingText": event["text"],
                "semanticHash": fingerprint,
            })

        area_label = labels.get(table_no, AREAS[table_no - 1])
        bundle = {
            "schema": "nq28-area-source-v4-named-file",
            "tableNo": table_no,
            "area": area_label,
            "classificationAuthority": "user-assigned split filename",
            "areaLabelAuthority": "source-printed numbered heading",
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
            f.write(f"TABLE={table_no:03d} | AREA={area_label} | SECTION={section} | SEGMENTS={len(segments)}\n")
            for seg in segments:
                f.write(
                    f"--- SEQUENCE={seg['sequence']} | PAGES={seg['pageStart']}-{seg['pageEnd']} | "
                    f"LINES={seg['lineCount']} | HASH={seg['semanticHash']} | HEADING={seg['headingText']} ---\n"
                )
                a = int(seg["lineStart"]); b = a + int(seg["lineCount"])
                for item in compact[a:b]:
                    f.write(
                        f"P={item['p']:04d} | X={item['x0']:08.3f}-{item['x1']:08.3f} | "
                        f"Y={item['y0']:08.3f}-{item['y1']:08.3f} | {item['t']}\n"
                    )
        reports.append({
            "tableNo": table_no,
            "area": area_label,
            "segmentCount": len(segments),
            "exactDuplicateBlocksRemoved": exact_duplicates,
            "nonidenticalRepeatCount": nonidentical_repeat_count,
            "lineCount": len(compact),
            "pageCount": len({item["p"] for item in compact}),
            "sourceFile": str(path.relative_to(output)),
            "sourceSha256": v2.sha256_file(path),
        })
    return reports, duplicate_review


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
    events, review, labels = detect_area_headings(selected)
    reports, duplicate_review = write_bundles(selected, events, labels, args.mode, output)
    review.extend(duplicate_review)
    missing = [r["tableNo"] for r in reports if r["segmentCount"] == 0]

    manifest = {
        "schema": "nq28-named-area-source-v4",
        "sourceFile": source.name,
        "sourcePageCount": page_count,
        "sourceTsvSha256": v2.sha256_file(tsv_path),
        "classificationAuthority": "user-assigned split filename",
        "pageSuffixRole": "bookmark_only",
        "areaLabelAuthority": "source-printed numbered heading",
        "boundary": boundary,
        "areaHeadingOccurrenceCount": len(events),
        "areaHeadingUniqueCount": len(set(e["tableNo"] for e in events)),
        "areasWithSource": AREA_COUNT - len(missing),
        "missingAreas": missing,
        "sourceAreaLabels": {str(k): v for k, v in sorted(labels.items())},
        "headingEvents": events,
        "review": review,
        "areas": reports,
        "safety": {
            "crossNamedFileFallback": False,
            "legacyAreaPrefixCanOverrideSource": False,
            "incidentalAreaNameCanChangeArea": False,
            "ttUsedAsLookupKey": False,
            "runtimeModified": False,
        },
    }
    (output / "source-manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({
        "mode": args.mode,
        "source": source.name,
        "areaHeadingOccurrences": len(events),
        "areaHeadingUnique": len(set(e["tableNo"] for e in events)),
        "areasWithSource": AREA_COUNT-len(missing),
        "missingAreas": missing,
        "reviewCount": len(review),
        "boundary": boundary,
    }, ensure_ascii=False, indent=2))
    return 2 if missing else 0


if __name__ == "__main__":
    raise SystemExit(main())
