#!/usr/bin/env python3
"""Parse the two large named NQ28 files after area scoping.

Key correction versus the legacy parser: a relation description printed before a
TT anchor belongs to that TT, not to the previous TT. Main-road fields are read
from a narrow coordinate band around the current TT/price row. This prevents a
child phrase such as "đấu nối trực tiếp" from being attached backwards to the
preceding main road.
"""
from __future__ import annotations

import argparse
import gzip
import hashlib
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
    "phu luc", "bang gia cac loai dat", "ban hanh kem theo", "don vi tinh",
    "tt ten duong", "gia dat o", "gia thuong mai", "gia dat co so",
    "diem dau", "diem cuoi", "gia dat trong", "gia dat rung",
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
        return int(text.replace(".", ""))
    except ValueError:
        return None


def stable_json_bytes(data: Any) -> bytes:
    return (json.dumps(data, ensure_ascii=False, sort_keys=True, separators=(",", ":")) + "\n").encode("utf-8")


def write_gzip_json(path: Path, data: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("wb") as handle:
        with gzip.GzipFile(filename="", mode="wb", fileobj=handle, compresslevel=9, mtime=0) as zipped:
            zipped.write(stable_json_bytes(data))


def load_gzip_json(path: Path) -> dict[str, Any]:
    with gzip.open(path, "rt", encoding="utf-8") as handle:
        return json.load(handle)


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def abs_y(page: int, y: float) -> float:
    return page * 1000.0 + y


def line_center(line: dict[str, Any]) -> float:
    return abs_y(int(line["p"]), (float(line["y0"]) + float(line["y1"])) / 2.0)


def word_objects(line: dict[str, Any]) -> list[dict[str, Any]]:
    result = []
    for word in line.get("w", []):
        left, top, width, height, text = word
        result.append({
            "p": int(line["p"]), "x0": float(left), "y0": float(top),
            "x1": float(left) + float(width), "y1": float(top) + float(height),
            "t": str(text),
        })
    return result


def is_header_text(text: str) -> bool:
    n = normalize(text)
    return any(term in n for term in HEADER_TERMS)


def find_price_words(lines: list[dict[str, Any]]) -> list[dict[str, Any]]:
    out = []
    for line in lines:
        for word in word_objects(line):
            val = parse_money(word["t"])
            if val is None or word["x0"] < 395:
                continue
            out.append({**word, "value": val})
    return out


def find_anchors(lines: list[dict[str, Any]]) -> list[dict[str, Any]]:
    price_words = find_price_words(lines)
    anchors = []
    for index, line in enumerate(lines):
        if float(line["x0"]) > 130:
            continue
        match = TT_RE.match(str(line.get("t", "")))
        if not match:
            continue
        tt = int(match.group(1))
        center = line_center(line)
        aligned = [
            item for item in price_words
            if item["p"] == int(line["p"])
            and abs(abs_y(item["p"], (item["y0"] + item["y1"]) / 2.0) - center) <= 18.5
        ]
        if aligned:
            anchors.append({"index": index, "tt": tt, "p": int(line["p"]), "center": center, "line": line})
    anchors.sort(key=lambda item: (item["center"], float(item["line"]["x0"])))
    return anchors


def joined_lines(lines: Iterable[dict[str, Any]], *, strip_tt: int | None = None) -> str:
    parts = []
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
    parts = []
    for line in sorted(lines, key=lambda item: (int(item["p"]), float(item["y0"]), float(item["x0"]))):
        words = [w for w in word_objects(line) if x_min <= w["x0"] < x_max]
        if not words:
            continue
        text = " ".join(w["t"] for w in sorted(words, key=lambda item: item["x0"]))
        if x_min < 130:
            text = re.sub(rf"^\s*{tt}(?=\s|$|[.)-])\s*[.)-]?\s*", "", text, count=1).strip()
        if text and not is_header_text(text):
            parts.append(text)
    return SPACE_RE.sub(" ", " ".join(parts)).strip()


def classify_relation(text: str) -> str:
    n = normalize(text)
    if "khong dau noi truc tiep" in n:
        return "indirect"
    if "dau noi truc tiep" in n:
        return "direct"
    return "main"


def relation_phrase_start(lines: list[dict[str, Any]], lower: float, upper: float) -> float | None:
    for line in sorted(lines, key=line_center):
        center = line_center(line)
        if not (lower < center <= upper):
            continue
        n = normalize(str(line.get("t", "")))
        if "cac tuyen duong giao thong khong dau noi truc tiep" in n or "cac tuyen duong giao thong dau noi truc tiep" in n:
            return center - 1.0
    return None


def source_excerpt(lines: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return [{
        "p": int(line["p"]), "x0": float(line["x0"]), "y0": float(line["y0"]),
        "x1": float(line["x1"]), "y1": float(line["y1"]), "t": str(line["t"]),
        "w": line.get("w", []),
    } for line in lines if str(line.get("t", "")).strip()]


def price_payload(price_words: list[dict[str, Any]], section: str) -> dict[str, Any]:
    ordered = sorted(price_words, key=lambda item: (item["x0"], item["y0"], item["t"]))
    unique = []
    seen = set()
    for item in ordered:
        key = (round(item["x0"]), round(item["y0"]), int(item["value"]))
        if key in seen:
            continue
        seen.add(key)
        unique.append({
            "printed": item["t"],
            "sourceValueThousandVndPerM2": int(item["value"]),
            "x": round(item["x0"], 3), "page": int(item["p"]),
        })
    payload: dict[str, Any] = {"sourceColumns": unique}
    if section == "non-agricultural" and len(unique) == 3:
        payload["residential"] = unique[0]["sourceValueThousandVndPerM2"]
        payload["commercialService"] = unique[1]["sourceValueThousandVndPerM2"]
        payload["productionNonAgricultural"] = unique[2]["sourceValueThousandVndPerM2"]
    elif section == "agricultural":
        payload["agriculturalValues"] = [item["sourceValueThousandVndPerM2"] for item in unique]
    return payload


def parse_segment(table_no: int, area: str, segment: dict[str, Any], lines: list[dict[str, Any]]):
    sequence = int(segment["sequence"])
    section = str(segment["section"])
    anchors = find_anchors(lines)
    reviews: list[dict[str, Any]] = []
    records: list[dict[str, Any]] = []
    if not anchors:
        reviews.append({"code": "NO_TT_PRICE_ANCHORS", "tableNo": table_no, "area": area, "sequence": sequence, "section": section})
        return records, reviews, {"anchorCount": 0, "recordCount": 0}

    segment_start = abs_y(int(segment["pageStart"]), 0.0)
    segment_end = abs_y(int(segment["pageEnd"]), 999.0)
    relation_starts: list[float | None] = []
    for i, anchor in enumerate(anchors):
        prev = anchors[i - 1]["center"] if i else segment_start
        relation_starts.append(relation_phrase_start(lines, prev + 5.0, anchor["center"] + 10.0))

    occurrences: Counter[int] = Counter()
    for i, anchor in enumerate(anchors):
        current = float(anchor["center"])
        next_center = float(anchors[i + 1]["center"]) if i + 1 < len(anchors) else segment_end
        start = relation_starts[i] if relation_starts[i] is not None else current - 28.0
        if i + 1 < len(anchors):
            next_start = relation_starts[i + 1]
            end = next_start if next_start is not None else next_center - 28.0
        else:
            end = segment_end
        if end <= start:
            end = (current + next_center) / 2.0

        row_lines = [line for line in lines if start <= line_center(line) < end and not is_header_text(str(line.get("t", "")))]
        core_lines = [line for line in lines if current - 22.0 <= line_center(line) <= current + 22.0 and not is_header_text(str(line.get("t", "")))]
        if not row_lines:
            row_lines = core_lines

        raw_text = joined_lines(row_lines, strip_tt=anchor["tt"])
        relation = classify_relation(raw_text)
        price_words = [
            item for item in find_price_words(core_lines)
            if abs(abs_y(item["p"], (item["y0"] + item["y1"]) / 2.0) - current) <= 22.0
        ]
        prices = price_payload(price_words, section)

        occurrences[anchor["tt"]] += 1
        occurrence = occurrences[anchor["tt"]]
        record_id = f"NQ28-{table_no:03d}-S{sequence:02d}-TT{anchor['tt']:04d}-{occurrence:02d}"
        record: dict[str, Any] = {
            "id": record_id, "tableNo": table_no, "area": area, "sequence": sequence,
            "section": section, "tt": int(anchor["tt"]), "ttOccurrence": occurrence,
            "relation": relation, "rawText": raw_text, "prices": prices,
            "source": {
                "pageStart": min(int(line["p"]) for line in row_lines),
                "pageEnd": max(int(line["p"]) for line in row_lines),
                "anchorPage": anchor["p"],
                "anchorY": round(current - anchor["p"] * 1000.0, 3),
                "lines": source_excerpt(row_lines),
                "coreLines": source_excerpt(core_lines),
            },
            "review": [],
        }

        if relation == "main":
            record["road"] = zone_text(core_lines, 90.0, 222.0, anchor["tt"])
            record["start"] = zone_text(core_lines, 222.0, 311.0, anchor["tt"])
            record["end"] = zone_text(core_lines, 311.0, 405.0, anchor["tt"])
            if not record["road"]:
                record["review"].append("MAIN_ROAD_EMPTY")
        else:
            record["conditionText"] = raw_text

        count = len(prices["sourceColumns"])
        if count == 0:
            record["review"].append("PRICE_MISSING")
        if section == "non-agricultural" and count != 3:
            record["review"].append(f"NON_AGRICULTURAL_PRICE_COLUMN_COUNT_{count}")
        if section == "agricultural" and count < 1:
            record["review"].append("AGRICULTURAL_PRICE_COLUMN_MISSING")
        if occurrence > 1:
            record["review"].append("DUPLICATE_TT_IN_SEGMENT")

        if record["review"]:
            reviews.append({
                "code": "ROW_REVIEW", "recordId": record_id, "tableNo": table_no,
                "area": area, "sequence": sequence, "section": section,
                "tt": anchor["tt"], "flags": record["review"], "rawText": raw_text,
            })
        records.append(record)

    tt_values = [r["tt"] for r in records]
    unique = sorted(set(tt_values))
    gaps = [[a + 1, b - 1] for a, b in zip(unique, unique[1:]) if b > a + 1]
    stats = {
        "anchorCount": len(anchors), "recordCount": len(records),
        "minTt": min(tt_values) if tt_values else None,
        "maxTt": max(tt_values) if tt_values else None,
        "duplicateTts": sorted(tt for tt, c in Counter(tt_values).items() if c > 1),
        "ttGaps": gaps,
    }
    return records, reviews, stats


def group_records(records: list[dict[str, Any]], reviews: list[dict[str, Any]]) -> list[dict[str, Any]]:
    groups = []
    current = None
    for record in records:
        if record["relation"] == "main":
            current = {
                "groupId": record["id"], "mainRecordId": record["id"],
                "road": record.get("road", ""), "start": record.get("start", ""), "end": record.get("end", ""),
                "recordIds": [record["id"]], "directRecordIds": [], "indirectRecordIds": [],
            }
            groups.append(current)
            record["groupId"] = current["groupId"]
        elif current is None:
            record["groupId"] = None
            record["review"].append("CHILD_WITHOUT_PRECEDING_MAIN")
            reviews.append({
                "code": "CHILD_WITHOUT_PRECEDING_MAIN", "recordId": record["id"],
                "tableNo": record["tableNo"], "area": record["area"], "sequence": record["sequence"],
                "section": record["section"], "tt": record["tt"],
            })
        else:
            record["groupId"] = current["groupId"]
            current["recordIds"].append(record["id"])
            current[f"{record['relation']}RecordIds"].append(record["id"])
    return groups


def parse_area(source_path: Path, output_dir: Path):
    source = load_gzip_json(source_path)
    table_no = int(source["tableNo"]); area = str(source["area"]); all_lines = source.get("lines", [])
    records = []; reviews = []; segment_stats = []
    for segment in source.get("segments", []):
        start = int(segment["lineStart"]); end = start + int(segment["lineCount"])
        rs, rv, stats = parse_segment(table_no, area, segment, all_lines[start:end])
        records.extend(rs); reviews.extend(rv); segment_stats.append({**segment, **stats})

    groups = []
    by_segment: dict[tuple[int, str], list[dict[str, Any]]] = defaultdict(list)
    for record in records:
        by_segment[(int(record["sequence"]), str(record["section"]))].append(record)
    for key in sorted(by_segment):
        groups.extend(group_records(by_segment[key], reviews))

    parsed = {
        "schema": "nq28-area-parsed-v3-forward-owned",
        "tableNo": table_no, "area": area, "sourceFile": source_path.name,
        "records": records, "groups": groups, "segmentStats": segment_stats,
        "validation": {
            "recordCount": len(records), "groupCount": len(groups), "reviewCount": len(reviews),
            "directRecordCount": sum(1 for r in records if r["relation"] == "direct"),
            "indirectRecordCount": sum(1 for r in records if r["relation"] == "indirect"),
            "mainRecordCount": sum(1 for r in records if r["relation"] == "main"),
        },
        "safety": {
            "sourceCoordinatesPreserved": True,
            "relationTextOwnedByFollowingTt": True,
            "mainFieldsReadFromAnchorBand": True,
            "ttUsedAsLookupKey": False,
            "runtimeModified": False,
        },
    }
    parsed_path = output_dir / "areas" / f"area-{table_no:03d}.parsed.json.gz"
    write_gzip_json(parsed_path, parsed)
    preview_path = output_dir / "areas" / f"area-{table_no:03d}.parsed.preview.txt"
    preview_path.parent.mkdir(parents=True, exist_ok=True)
    with preview_path.open("w", encoding="utf-8", newline="\n") as f:
        f.write(f"TABLE={table_no:03d} | AREA={area} | RECORDS={len(records)} | GROUPS={len(groups)} | REVIEW={len(reviews)}\n")
        for r in records:
            pv = ",".join(str(x["sourceValueThousandVndPerM2"]) for x in r["prices"]["sourceColumns"])
            main = ""
            if r["relation"] == "main":
                main = f" | ROAD={r.get('road','')} | START={r.get('start','')} | END={r.get('end','')}"
            f.write(f"ID={r['id']} | SEC={r['section']} | TT={r['tt']} | REL={r['relation']} | PRICES={pv}{main} | FLAGS={','.join(r['review'])}\n")
    report = {
        "tableNo": table_no, "area": area, "recordCount": len(records), "groupCount": len(groups),
        "reviewCount": len(reviews), "parsedFile": str(parsed_path.relative_to(output_dir)),
        "parsedSha256": sha256_file(parsed_path), "previewFile": str(preview_path.relative_to(output_dir)),
        "segmentStats": segment_stats,
    }
    return report, reviews


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--source-dir", required=True, type=Path)
    ap.add_argument("--output", required=True, type=Path)
    ap.add_argument("--area-start", type=int, default=1)
    ap.add_argument("--area-end", type=int, default=95)
    args = ap.parse_args()
    source_dir = args.source_dir.resolve(); output_dir = args.output.resolve(); (output_dir / "areas").mkdir(parents=True, exist_ok=True)

    reports = []; reviews = []; missing = []
    for table_no in range(args.area_start, args.area_end + 1):
        path = source_dir / "areas" / f"area-{table_no:03d}.source.json.gz"
        if not path.is_file():
            missing.append(table_no); continue
        report, rv = parse_area(path, output_dir); reports.append(report); reviews.extend(rv)

    summary = {
        "schema": "nq28-parse-summary-v3-forward-owned",
        "areaCount": len(reports), "recordCount": sum(r["recordCount"] for r in reports),
        "groupCount": sum(r["groupCount"] for r in reports), "reviewCount": len(reviews),
        "missingAreas": missing, "areas": reports,
        "safety": {"ttUsedAsLookupKey": False, "runtimeModified": False},
    }
    (output_dir / "parse-summary.json").write_text(json.dumps(summary, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    (output_dir / "review.json").write_text(json.dumps({"reviews": reviews}, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({k: summary[k] for k in ("areaCount", "recordCount", "groupCount", "reviewCount", "missingAreas")}, ensure_ascii=False, indent=2))
    return 2 if missing else 0


if __name__ == "__main__":
    raise SystemExit(main())
