#!/usr/bin/env python3
"""Fail closed when generated NQ28 area output is structurally unsafe for app use."""

from __future__ import annotations

import argparse
import json
from pathlib import Path


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--summary", required=True)
    parser.add_argument("--review", required=True)
    parser.add_argument("--report", required=True)
    parser.add_argument("--expected-areas", type=int, default=95)
    parser.add_argument("--max-area-records", type=int, default=1200)
    args = parser.parse_args()

    summary_path = Path(args.summary)
    review_path = Path(args.review)
    report_path = Path(args.report)

    problems: list[dict[str, object]] = []
    if not summary_path.is_file() or summary_path.stat().st_size == 0:
        problems.append({"code": "missing_or_empty_summary", "path": str(summary_path)})
        summary = {}
    else:
        summary = json.loads(summary_path.read_text(encoding="utf-8"))

    if not review_path.is_file() or review_path.stat().st_size == 0:
        problems.append({"code": "missing_or_empty_review", "path": str(review_path)})
        review = {}
    else:
        review = json.loads(review_path.read_text(encoding="utf-8"))

    areas = summary.get("areas", []) if isinstance(summary, dict) else []
    if summary.get("areaCount") != args.expected_areas or len(areas) != args.expected_areas:
        problems.append({
            "code": "area_count_mismatch",
            "expected": args.expected_areas,
            "reported": summary.get("areaCount"),
            "actual": len(areas),
        })

    seen_names: set[str] = set()
    for index, area in enumerate(areas, start=1):
        name = str(area.get("area", "")).strip()
        record_count = int(area.get("recordCount") or 0)
        if not name:
            problems.append({"code": "blank_area_name", "sequence": index})
        elif name in seen_names:
            problems.append({"code": "duplicate_area_name", "sequence": index, "area": name})
        seen_names.add(name)

        if record_count <= 0:
            problems.append({"code": "zero_records", "sequence": index, "area": name})
        if record_count > args.max_area_records:
            problems.append({
                "code": "record_count_outlier",
                "sequence": index,
                "area": name,
                "recordCount": record_count,
                "threshold": args.max_area_records,
            })

        segments = area.get("segmentStats", []) or []
        if not segments:
            problems.append({"code": "missing_segment_stats", "sequence": index, "area": name})
        for segment in segments:
            section = segment.get("section")
            anchors = int(segment.get("anchorCount") or 0)
            records = int(segment.get("recordCount") or 0)
            if anchors != records:
                problems.append({
                    "code": "anchor_record_mismatch",
                    "sequence": index,
                    "area": name,
                    "section": section,
                    "anchors": anchors,
                    "records": records,
                })

    review_count = review.get("count") if isinstance(review, dict) else None
    review_items = review.get("items") if isinstance(review, dict) else None
    if not isinstance(review_count, int) or not isinstance(review_items, list):
        problems.append({"code": "invalid_review_schema"})
    elif review_count != len(review_items):
        problems.append({
            "code": "review_count_mismatch",
            "reported": review_count,
            "actual": len(review_items),
        })

    report = {
        "status": "pass" if not problems else "blocked",
        "expectedAreaCount": args.expected_areas,
        "actualAreaCount": len(areas),
        "problemCount": len(problems),
        "problems": problems,
    }
    report_path.parent.mkdir(parents=True, exist_ok=True)
    report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(report, ensure_ascii=False, indent=2))
    return 0 if not problems else 2


if __name__ == "__main__":
    raise SystemExit(main())
