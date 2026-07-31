#!/usr/bin/env python3
"""Parse coordinate-preserving NQ28 area bundles into auditable legal rows.

This is a conservative parser. It identifies a source row only when a left-side TT
anchor and at least one price word are vertically aligned. It preserves all source
coordinates and original text, groups explicit direct/indirect condition rows under
the preceding main row, and sends uncertain structures to review instead of
inferring legal meaning.
"""

from __future__ import annotations

import argparse
import gzip
import hashlib
import io
import json
import re
import unicodedata
from collections import Counter, defaultdict
from pathlib import Path
from typing import Any, Iterable


TT_RE = re.compile(r"^\s*(\d{1,4})(?=\s|$|[.)-])")
MONEY_RE = re.compile(r"^\d{1,3}(?:[.]\d{3})+$|^\d+$")
SPACE_RE = re.compile(r"\s+")
HEADER_TERMS = (
    "phu luc",
    "bang gia cac loai dat",
    "ban hanh kem theo",
    "don vi tinh",
    "tt ten duong",
    "gia dat o",
    "gia thuong mai",
    "gia dat co so",
    "diem dau",
    "diem cuoi",
)


def normalize(value: str) -> str:
    text = unicodedata.normalize("NFD", value or "")
    text = "".join(ch for ch in text if unicodedata.category(ch) != "Mn")
    text = text.replace("đ", "d").replace("Đ", "D").lower()
    text = re.sub(r"[^a-z0-9]+", " ", text)
    return SPACE_RE.sub(" ", text).strip()


def parse_money(value: str) -> int | None:
    text = value.strip()
    if not MONEY_RE.fullmatch(text):
        return None
    try:
        # Source unit is 1,000 VND/m2. Preserve the printed integer as source value.
        return int(text.replace(".", ""))
    except ValueError:
        return None


def stable_json_bytes(data: Any) -> bytes:
    return (json.dumps(data, ensure_ascii=False, sort_keys=True, separators=(",", ":")) + "\n").encode("utf-8")


def write_gzip_json(path: Path, data: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    raw = stable_json_bytes(data)
    with path.open("wb") as handle:
        with gzip.GzipFile(filename="", mode="wb", fileobj=handle, compresslevel=9, mtime=0) as zipped:
            zipped.write(raw)


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def load_gzip_json(path: Path) -> dict[str, Any]:
    with gzip.open(path, "rt", encoding="utf-8") as handle:
        return json.load(handle)


def abs_y(page: int, y: float) -> float:
    # Source pages are approximately 792 points high. A 1000-point stride keeps
    # ordering stable and leaves enough room for page-boundary midpoint splits.
    return page * 1000.0 + y


def line_center(line: dict[str, Any]) -> float:
    return abs_y(int(line["p"]), (float(line["y0"]) + float(line["y1"])) / 2.0)


def word_objects(line: dict[str, Any]) -> list[dict[str, Any]]:
    output: list[dict[str, Any]] = []
    for word in line.get("w", []):
        left, top, width, height, text = word
        output.append(
            {
                "p": int(line["p"]),
                "x0": float(left),
                "y0": float(top),
                "x1": float(left) + float(width),
                "y1": float(top) + float(height),
                "t": str(text),
            }
        )
    return output


def is_header_text(text: str) -> bool:
    normalized = normalize(text)
    return any(term in normalized for term in HEADER_TERMS)


def find_price_words(lines: list[dict[str, Any]]) -> list[dict[str, Any]]:
    prices: list[dict[str, Any]] = []
    for line in lines:
        for word in word_objects(line):
            value = parse_money(word["t"])
            if value is None or word["x0"] < 395:
                continue
            prices.append({**word, "value": value})
    return prices


def find_anchors(lines: list[dict[str, Any]]) -> list[dict[str, Any]]:
    price_words = find_price_words(lines)
    anchors: list[dict[str, Any]] = []
    for index, line in enumerate(lines):
        if float(line["x0"]) > 130:
            continue
        match = TT_RE.match(str(line.get("t", "")))
        if not match:
            continue
        tt = int(match.group(1))
        center = line_center(line)
        aligned = [
            item
            for item in price_words
            if item["p"] == int(line["p"])
            and abs(abs_y(item["p"], (item["y0"] + item["y1"]) / 2.0) - center) <= 18.5
        ]
        if not aligned:
            continue
        anchors.append(
            {
                "index": index,
                "tt": tt,
                "p": int(line["p"]),
                "center": center,
                "line": line,
                "alignedPriceWords": aligned,
            }
        )
    anchors.sort(key=lambda item: (item["center"], float(item["line"]["x0"])))
    return anchors


def record_bounds(anchors: list[dict[str, Any]], index: int, segment_start: float, segment_end: float) -> tuple[float, float]:
    current = anchors[index]["center"]
    lower = segment_start if index == 0 else (anchors[index - 1]["center"] + current) / 2.0
    upper = segment_end if index + 1 == len(anchors) else (current + anchors[index + 1]["center"]) / 2.0
    return lower, upper


def joined_lines(lines: Iterable[dict[str, Any]], *, strip_tt: int | None = None) -> str:
    parts: list[str] = []
    for line in sorted(lines, key=lambda item: (int(item["p"]), float(item["y0"]), float(item["x0"]))):
        text = str(line.get("t", "")).strip()
        if not text or is_header_text(text):
            continue
        if strip_tt is not None:
            text = re.sub(rf"^\s*{strip_tt}(?=\s|$|[.)-])\s*[.)-]?\s*", "", text, count=1).strip()
        if text:
            parts.append(text)
    return SPACE_RE.sub(" ", " ".join(parts)).strip()


def zone_text(lines: list[dict[str, Any]], x_min: float, x_max: float, tt: int) -> str:
    zone: list[dict[str, Any]] = []
    for line in lines:
        if float(line["x0"]) >= x_max or float(line["x1"]) <= x_min:
            continue
        words = [word for word in word_objects(line) if x_min <= word["x0"] < x_max]
        if not words:
            continue
        text = " ".join(word["t"] for word in sorted(words, key=lambda item: item["x0"]))
        if x_min < 130:
            text = re.sub(rf"^\s*{tt}(?=\s|$|[.)-])\s*[.)-]?\s*", "", text, count=1).strip()
        if text:
            zone.append({**line, "t": text})
    return joined_lines(zone)


def classify_relation(text: str) -> str:
    normalized = normalize(text)
    if "khong dau noi truc tiep" in normalized:
        return "indirect"
    if "dau noi truc tiep" in normalized:
        return "direct"
    return "main"


def price_payload(price_words: list[dict[str, Any]], section: str) -> dict[str, Any]:
    ordered = sorted(price_words, key=lambda item: (item["x0"], item["y0"], item["t"]))
    unique: list[dict[str, Any]] = []
    seen: set[tuple[int, int, int]] = set()
    for item in ordered:
        key = (round(item["x0"]), round(item["y0"]), int(item["value"]))
        if key in seen:
            continue
        seen.add(key)
        unique.append(
            {
                "printed": item["t"],
                "sourceValueThousandVndPerM2": int(item["value"]),
                "x": round(item["x0"], 3),
                "page": int(item["p"]),
            }
        )

    payload: dict[str, Any] = {"sourceColumns": unique}
    if section == "non-agricultural" and len(unique) == 3:
        payload["residential"] = unique[0]["sourceValueThousandVndPerM2"]
        payload["commercialService"] = unique[1]["sourceValueThousandVndPerM2"]
        payload["productionNonAgricultural"] = unique[2]["sourceValueThousandVndPerM2"]
    elif section == "agricultural":
        payload["agriculturalValues"] = [item["sourceValueThousandVndPerM2"] for item in unique]
    return payload


def source_excerpt(lines: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return [
        {
            "p": int(line["p"]),
            "x0": float(line["x0"]),
            "y0": float(line["y0"]),
            "x1": float(line["x1"]),
            "y1": float(line["y1"]),
            "t": str(line["t"]),
            "w": line.get("w", []),
        }
        for line in lines
        if str(line.get("t", "")).strip()
    ]


def parse_segment(
    table_no: int,
    area: str,
    segment: dict[str, Any],
    segment_lines: list[dict[str, Any]],
) -> tuple[list[dict[str, Any]], list[dict[str, Any]], dict[str, Any]]:
    sequence = int(segment["sequence"])
    section = str(segment["section"])
    anchors = find_anchors(segment_lines)
    reviews: list[dict[str, Any]] = []
    records: list[dict[str, Any]] = []

    if not anchors:
        reviews.append(
            {
                "code": "NO_TT_PRICE_ANCHORS",
                "tableNo": table_no,
                "area": area,
                "sequence": sequence,
                "section": section,
                "pages": [segment["pageStart"], segment["pageEnd"]],
            }
        )
        return records, reviews, {"anchorCount": 0, "recordCount": 0}

    segment_start = abs_y(int(segment["pageStart"]), 0.0)
    segment_end = abs_y(int(segment["pageEnd"]), 999.0)
    occurrences: Counter[int] = Counter()

    for anchor_index, anchor in enumerate(anchors):
        lower, upper = record_bounds(anchors, anchor_index, segment_start, segment_end)
        row_lines = [line for line in segment_lines if lower <= line_center(line) < upper and not is_header_text(str(line.get("t", "")))]
        raw_text = joined_lines(row_lines, strip_tt=anchor["tt"])
        relation = classify_relation(raw_text)
        price_words = [
            item
            for item in find_price_words(row_lines)
            if abs(abs_y(item["p"], (item["y0"] + item["y1"]) / 2.0) - anchor["center"]) <= 22.0
        ]
        prices = price_payload(price_words, section)
        occurrences[anchor["tt"]] += 1
        occurrence = occurrences[anchor["tt"]]
        record_id = f"NQ28-{table_no:03d}-S{sequence:02d}-TT{anchor['tt']:04d}-{occurrence:02d}"

        record: dict[str, Any] = {
            "id": record_id,
            "tableNo": table_no,
            "area": area,
            "sequence": sequence,
            "section": section,
            "tt": int(anchor["tt"]),
            "ttOccurrence": occurrence,
            "relation": relation,
            "rawText": raw_text,
            "prices": prices,
            "source": {
                "pageStart": min(int(line["p"]) for line in row_lines),
                "pageEnd": max(int(line["p"]) for line in row_lines),
                "anchorPage": anchor["p"],
                "anchorY": round(float(anchor["center"] - anchor["p"] * 1000.0), 3),
                "lines": source_excerpt(row_lines),
            },
            "review": [],
        }

        if relation == "main":
            record["road"] = zone_text(row_lines, 90.0, 222.0, anchor["tt"])
            record["start"] = zone_text(row_lines, 222.0, 311.0, anchor["tt"])
            record["end"] = zone_text(row_lines, 311.0, 405.0, anchor["tt"])
            if not record["road"]:
                record["review"].append("MAIN_ROAD_EMPTY")
        else:
            record["conditionText"] = raw_text

        price_count = len(prices["sourceColumns"])
        if price_count == 0:
            record["review"].append("PRICE_MISSING")
        if section == "non-agricultural" and price_count != 3:
            record["review"].append(f"NON_AGRICULTURAL_PRICE_COLUMN_COUNT_{price_count}")
        if section == "agricultural" and price_count < 1:
            record["review"].append("AGRICULTURAL_PRICE_COLUMN_MISSING")
        if occurrence > 1:
            record["review"].append("DUPLICATE_TT_IN_SEGMENT")

        if record["review"]:
            reviews.append(
                {
                    "code": "ROW_REVIEW",
                    "recordId": record_id,
                    "tableNo": table_no,
                    "area": area,
                    "sequence": sequence,
                    "section": section,
                    "tt": anchor["tt"],
                    "flags": record["review"],
                    "rawText": raw_text,
                }
            )
        records.append(record)

    tt_values = [record["tt"] for record in records]
    duplicate_tts = sorted(tt for tt, count in Counter(tt_values).items() if count > 1)
    gaps: list[list[int]] = []
    unique_tts = sorted(set(tt_values))
    for left, right in zip(unique_tts, unique_tts[1:]):
        if right > left + 1:
            gaps.append([left + 1, right - 1])
    stats = {
        "anchorCount": len(anchors),
        "recordCount": len(records),
        "minTt": min(tt_values) if tt_values else None,
        "maxTt": max(tt_values) if tt_values else None,
        "duplicateTts": duplicate_tts,
        "ttGaps": gaps,
    }
    return records, reviews, stats


def group_records(records: list[dict[str, Any]], reviews: list[dict[str, Any]]) -> list[dict[str, Any]]:
    groups: list[dict[str, Any]] = []
    current: dict[str, Any] | None = None
    for record in records:
        if record["relation"] == "main":
            current = {
                "groupId": record["id"],
                "mainRecordId": record["id"],
                "road": record.get("road", ""),
                "start": record.get("start", ""),
                "end": record.get("end", ""),
                "recordIds": [record["id"]],
                "directRecordIds": [],
                "indirectRecordIds": [],
            }
            groups.append(current)
            record["groupId"] = current["groupId"]
            continue
        if current is None:
            record["groupId"] = None
            record["review"].append("CHILD_WITHOUT_PRECEDING_MAIN")
            reviews.append(
                {
                    "code": "CHILD_WITHOUT_PRECEDING_MAIN",
                    "recordId": record["id"],
                    "tableNo": record["tableNo"],
                    "area": record["area"],
                    "sequence": record["sequence"],
                    "section": record["section"],
                    "tt": record["tt"],
                }
            )
            continue
        record["groupId"] = current["groupId"]
        current["recordIds"].append(record["id"])
        current[f"{record['relation']}RecordIds"].append(record["id"])
    return groups


def parse_area(source_path: Path, output_dir: Path) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    source = load_gzip_json(source_path)
    table_no = int(source["tableNo"])
    area = str(source["area"])
    all_lines = source.get("lines", [])
    all_records: list[dict[str, Any]] = []
    all_reviews: list[dict[str, Any]] = []
    segment_stats: list[dict[str, Any]] = []

    for segment in source.get("segments", []):
        start = int(segment["lineStart"])
        end = start + int(segment["lineCount"])
        records, reviews, stats = parse_segment(table_no, area, segment, all_lines[start:end])
        all_records.extend(records)
        all_reviews.extend(reviews)
        segment_stats.append({**segment, **stats})

    groups: list[dict[str, Any]] = []
    by_segment: dict[tuple[int, str], list[dict[str, Any]]] = defaultdict(list)
    for record in all_records:
        by_segment[(int(record["sequence"]), str(record["section"]))].append(record)
    for key in sorted(by_segment):
        groups.extend(group_records(by_segment[key], all_reviews))

    parsed = {
        "schema": "nq28-area-parsed-v1",
        "tableNo": table_no,
        "area": area,
        "sourceFile": source_path.name,
        "records": all_records,
        "groups": groups,
        "segmentStats": segment_stats,
        "validation": {
            "recordCount": len(all_records),
            "groupCount": len(groups),
            "reviewCount": len(all_reviews),
            "nonAgriculturalRecordCount": sum(1 for row in all_records if row["section"] == "non-agricultural"),
            "agriculturalRecordCount": sum(1 for row in all_records if row["section"] == "agricultural"),
            "directRecordCount": sum(1 for row in all_records if row["relation"] == "direct"),
            "indirectRecordCount": sum(1 for row in all_records if row["relation"] == "indirect"),
            "mainRecordCount": sum(1 for row in all_records if row["relation"] == "main"),
        },
        "safety": {
            "sourceCoordinatesPreserved": True,
            "legalRelationDerivedOnlyFromExplicitPhrases": True,
            "roadNamesMerged": False,
            "ttRenumbered": False,
            "appRuntimeModified": False,
        },
    }

    parsed_path = output_dir / "areas" / f"area-{table_no:03d}.parsed.json.gz"
    write_gzip_json(parsed_path, parsed)
    preview_path = output_dir / "areas" / f"area-{table_no:03d}.parsed.preview.txt"
    preview_path.parent.mkdir(parents=True, exist_ok=True)
    with preview_path.open("w", encoding="utf-8", newline="\n") as handle:
        handle.write(f"TABLE={table_no:03d} | AREA={area} | RECORDS={len(all_records)} | GROUPS={len(groups)} | REVIEW={len(all_reviews)}\n")
        for record in all_records:
            prices = ",".join(str(item["sourceValueThousandVndPerM2"]) for item in record["prices"]["sourceColumns"])
            main = ""
            if record["relation"] == "main":
                main = f" | ROAD={record.get('road','')} | START={record.get('start','')} | END={record.get('end','')}"
            handle.write(
                f"ID={record['id']} | SEC={record['section']} | TT={record['tt']} | REL={record['relation']} | PRICES={prices}{main} | FLAGS={','.join(record['review'])}\n"
            )

    report = {
        "tableNo": table_no,
        "area": area,
        "recordCount": len(all_records),
        "groupCount": len(groups),
        "reviewCount": len(all_reviews),
        "parsedFile": str(parsed_path.relative_to(output_dir)),
        "parsedBytes": parsed_path.stat().st_size,
        "parsedSha256": sha256_file(parsed_path),
        "previewFile": str(preview_path.relative_to(output_dir)),
        "previewBytes": preview_path.stat().st_size,
        "segmentStats": segment_stats,
    }
    return report, all_reviews


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--source-dir", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--area-start", type=int, default=1)
    parser.add_argument("--area-end", type=int, default=95)
    args = parser.parse_args()

    if not 1 <= args.area_start <= args.area_end <= 95:
        raise ValueError("Area range must be within 1..95")

    source_dir = args.source_dir.resolve()
    output_dir = args.output.resolve()
    areas_output = output_dir / "areas"
    areas_output.mkdir(parents=True, exist_ok=True)

    reports: list[dict[str, Any]] = []
    reviews: list[dict[str, Any]] = []
    missing: list[int] = []
    for table_no in range(args.area_start, args.area_end + 1):
        path = source_dir / "areas" / f"area-{table_no:03d}.source.json.gz"
        if not path.is_file():
            missing.append(table_no)
            continue
        report, area_reviews = parse_area(path, output_dir)
        reports.append(report)
        reviews.extend(area_reviews)

    summary = {
        "schema": "nq28-parse-summary-v1",
        "requestedRange": {"start": args.area_start, "end": args.area_end},
        "areaCount": len(reports),
        "missingAreas": missing,
        "recordCount": sum(item["recordCount"] for item in reports),
        "groupCount": sum(item["groupCount"] for item in reports),
        "reviewCount": len(reviews),
        "areas": reports,
        "validation": {
            "allRequestedAreasParsed": not missing and len(reports) == args.area_end - args.area_start + 1,
            "sourceRowsPreservedAsCoordinateExcerpts": True,
            "status": "pass-with-review" if not missing else "blocked",
        },
        "safety": {
            "appRuntimeModified": False,
            "mainBranchModified": False,
            "legalRelationsInferredBeyondExplicitText": False,
            "recordIdsGeneratedOnlyForNewIndependentDataset": True,
        },
    }
    (output_dir / "parse-summary.json").write_text(json.dumps(summary, ensure_ascii=False, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    review_dir = output_dir.parent / "review"
    review_dir.mkdir(parents=True, exist_ok=True)
    (review_dir / "needs-review.json").write_text(
        json.dumps({"schema": "nq28-review-v1", "count": len(reviews), "items": reviews}, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )

    print(json.dumps({
        "areaCount": len(reports),
        "missingAreas": missing,
        "recordCount": summary["recordCount"],
        "groupCount": summary["groupCount"],
        "reviewCount": len(reviews),
        "validation": summary["validation"],
    }, ensure_ascii=False, indent=2))
    return 2 if missing else 0


if __name__ == "__main__":
    raise SystemExit(main())
