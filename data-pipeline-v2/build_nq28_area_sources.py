#!/usr/bin/env python3
"""Build reproducible, area-scoped NQ28 source bundles from the embedded price table.

The outer NQ28 DOC is only a wrapper. The actual price table is stored as an
embedded ZIP/OLE package containing ``Bang gia.doc``. This pipeline extracts the
embedded document, converts it to PDF once, reads word coordinates with
``pdftotext -tsv``, detects legal area headings, and writes compact source bundles
for later row parsing.

This stage deliberately does not infer road relationships or modify app runtime
records. It preserves page, line and word geometry so later parsing can rebuild
columns without relying on fragile plain-text line wrapping.
"""

from __future__ import annotations

import argparse
import csv
import gzip
import hashlib
import io
import json
import re
import shutil
import subprocess
import sys
import unicodedata
import zipfile
from collections import defaultdict
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Iterable

import olefile


AREAS: list[str] = [
    "Phường Biên Hòa",
    "Phường Trấn Biên",
    "Phường Tam Hiệp",
    "Phường Long Bình",
    "Phường Trảng Dài",
    "Phường Hố Nai",
    "Phường Long Hưng",
    "Phường Tân Triều",
    "Phường Phước Tân",
    "Phường Tam Phước",
    "Phường Long Thành",
    "Xã Bình An",
    "Xã An Phước",
    "Xã Long Phước",
    "Xã Phước Thái",
    "Phường Nhơn Trạch",
    "Xã Đại Phước",
    "Xã Phước An",
    "Phường Long Khánh",
    "Phường Bảo Vinh",
    "Phường Xuân Lập",
    "Phường Hàng Gòn",
    "Phường Bình Lộc",
    "Phường Xuân Lộc",
    "Xã Xuân Hòa",
    "Xã Xuân Thành",
    "Xã Xuân Bắc",
    "Xã Xuân Phú",
    "Xã Xuân Định",
    "Xã Cẩm Mỹ",
    "Xã Xuân Quế",
    "Xã Xuân Đường",
    "Xã Sông Ray",
    "Xã Xuân Đông",
    "Phường Trảng Bom",
    "Xã An Viễn",
    "Xã Bàu Hàm",
    "Xã Bình Minh",
    "Xã Hưng Thịnh",
    "Phường Dầu Giây",
    "Xã Gia Kiệm",
    "Xã Thống Nhất",
    "Xã Định Quán",
    "Xã Phú Vinh",
    "Xã La Ngà",
    "Xã Phú Hòa",
    "Xã Thanh Sơn",
    "Phường Tân Phú",
    "Xã Tà Lài",
    "Xã Nam Cát Tiên",
    "Xã Phú Lâm",
    "Xã Đắk Lua",
    "Phường Trị An",
    "Xã Tân An",
    "Xã Phú Lý",
    "Phường Bình Phước",
    "Phường Đồng Xoài",
    "Phường Minh Hưng",
    "Phường Chơn Thành",
    "Xã Nha Bích",
    "Phường Bình Long",
    "Phường An Lộc",
    "Phường Phước Bình",
    "Phường Phước Long",
    "Xã Thuận Lợi",
    "Xã Tân Lợi",
    "Xã Đồng Tâm",
    "Phường Đồng Phú",
    "Phường Lộc Ninh",
    "Xã Lộc Thành",
    "Xã Lộc Hưng",
    "Xã Lộc Tấn",
    "Xã Lộc Thạnh",
    "Xã Lộc Quang",
    "Phường Tân Khai",
    "Xã Tân Hưng",
    "Xã Tân Quan",
    "Xã Minh Đức",
    "Xã Phước Sơn",
    "Xã Nghĩa Trung",
    "Xã Bù Đăng",
    "Xã Thọ Sơn",
    "Xã Đắk Nhau",
    "Xã Bom Bo",
    "Xã Thiện Hưng",
    "Xã Tân Tiến",
    "Xã Hưng Phước",
    "Xã Đắk Ơ",
    "Xã Phú Nghĩa",
    "Xã Đa Kia",
    "Xã Bù Gia Mập",
    "Xã Phú Riềng",
    "Xã Phú Trung",
    "Xã Long Hà",
    "Xã Bình Tân",
]


SPACE_RE = re.compile(r"\s+")
NON_ALNUM_RE = re.compile(r"[^a-z0-9 ]+")


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def normalize(value: str) -> str:
    text = unicodedata.normalize("NFD", value)
    text = "".join(ch for ch in text if unicodedata.category(ch) != "Mn")
    text = text.replace("đ", "d").replace("Đ", "D").lower()
    text = NON_ALNUM_RE.sub(" ", text)
    return SPACE_RE.sub(" ", text).strip()


def run(command: list[str], *, cwd: Path | None = None) -> subprocess.CompletedProcess[str]:
    completed = subprocess.run(
        command,
        cwd=str(cwd) if cwd else None,
        text=True,
        capture_output=True,
        check=False,
    )
    if completed.returncode != 0:
        raise RuntimeError(
            "Command failed\n"
            f"command: {' '.join(command)}\n"
            f"stdout: {completed.stdout}\n"
            f"stderr: {completed.stderr}"
        )
    return completed


def extract_embedded_document(source: Path, workdir: Path) -> tuple[Path, dict[str, Any]]:
    if not olefile.isOleFile(str(source)):
        raise RuntimeError(f"Outer source is not an OLE DOC: {source}")

    candidates: list[tuple[int, str, bytes]] = []
    stream_report: list[dict[str, Any]] = []
    with olefile.OleFileIO(str(source)) as ole:
        for parts in ole.listdir(streams=True, storages=False):
            name = "/".join(parts)
            data = ole.openstream(parts).read()
            stream_report.append({"name": name, "bytes": len(data)})
            if name.lower().endswith("ole10native"):
                offset = data.find(b"PK\x03\x04")
                if offset >= 0:
                    payload = data[offset:]
                    candidates.append((len(payload), name, payload))

    if not candidates:
        raise RuntimeError("No embedded ZIP payload found in Ole10Native streams")

    _, stream_name, payload = max(candidates, key=lambda item: item[0])
    embedded_dir = workdir / "embedded"
    embedded_dir.mkdir(parents=True, exist_ok=True)
    zip_path = embedded_dir / "bang-gia-embedded.zip"
    zip_path.write_bytes(payload)

    with zipfile.ZipFile(io.BytesIO(payload)) as archive:
        archive.extractall(embedded_dir / "full-price")

    doc_candidates = sorted(
        (path for path in (embedded_dir / "full-price").rglob("*") if path.is_file() and path.suffix.lower() == ".doc"),
        key=lambda path: ("bang gia" not in normalize(path.stem), -path.stat().st_size, str(path)),
    )
    if not doc_candidates:
        raise RuntimeError("Embedded package contains no .doc price-table file")
    embedded_doc = doc_candidates[0]

    report = {
        "ole_stream_count": len(stream_report),
        "ole_streams": stream_report,
        "selected_stream": stream_name,
        "embedded_zip_bytes": len(payload),
        "embedded_zip_sha256": hashlib.sha256(payload).hexdigest(),
        "embedded_doc": embedded_doc.name,
        "embedded_doc_bytes": embedded_doc.stat().st_size,
        "embedded_doc_sha256": sha256_file(embedded_doc),
    }
    return embedded_doc, report


def convert_to_pdf(embedded_doc: Path, workdir: Path) -> Path:
    libreoffice = shutil.which("libreoffice") or shutil.which("soffice")
    if not libreoffice:
        raise RuntimeError("LibreOffice/soffice is not installed")
    pdf_dir = workdir / "pdf"
    pdf_dir.mkdir(parents=True, exist_ok=True)
    user_profile = (workdir / "lo-profile").resolve().as_uri()
    run(
        [
            libreoffice,
            f"-env:UserInstallation={user_profile}",
            "--headless",
            "--convert-to",
            "pdf",
            "--outdir",
            str(pdf_dir),
            str(embedded_doc),
        ]
    )
    pdf_candidates = sorted(pdf_dir.glob("*.pdf"), key=lambda path: -path.stat().st_size)
    if not pdf_candidates:
        raise RuntimeError("LibreOffice produced no PDF from embedded Bang gia.doc")
    return pdf_candidates[0]


@dataclass(frozen=True)
class Word:
    page: int
    block: int
    paragraph: int
    line: int
    number: int
    left: float
    top: float
    width: float
    height: float
    text: str


@dataclass
class SourceLine:
    page: int
    block: int
    paragraph: int
    line: int
    left: float
    top: float
    right: float
    bottom: float
    text: str
    words: list[Word]


def parse_words(pdf_path: Path, workdir: Path) -> tuple[list[SourceLine], int, Path]:
    pdftotext = shutil.which("pdftotext")
    if not pdftotext:
        raise RuntimeError("pdftotext is not installed")
    tsv_path = workdir / "bang-gia-words.tsv"
    run([pdftotext, "-tsv", str(pdf_path), str(tsv_path)])

    groups: dict[tuple[int, int, int, int], list[Word]] = defaultdict(list)
    max_page = 0
    with tsv_path.open("r", encoding="utf-8", errors="replace", newline="") as handle:
        reader = csv.DictReader(handle, delimiter="\t")
        required = {"level", "page_num", "block_num", "par_num", "line_num", "word_num", "left", "top", "width", "height", "text"}
        if not reader.fieldnames or not required.issubset(set(reader.fieldnames)):
            raise RuntimeError(f"Unexpected pdftotext TSV columns: {reader.fieldnames}")
        for row in reader:
            if row.get("level") != "5":
                continue
            text = (row.get("text") or "").strip()
            if not text:
                continue
            word = Word(
                page=int(row["page_num"]),
                block=int(row["block_num"]),
                paragraph=int(row["par_num"]),
                line=int(row["line_num"]),
                number=int(row["word_num"]),
                left=float(row["left"]),
                top=float(row["top"]),
                width=float(row["width"]),
                height=float(row["height"]),
                text=text,
            )
            max_page = max(max_page, word.page)
            groups[(word.page, word.block, word.paragraph, word.line)].append(word)

    lines: list[SourceLine] = []
    for key, words in groups.items():
        ordered = sorted(words, key=lambda item: (item.left, item.number))
        page, block, paragraph, line_no = key
        left = min(item.left for item in ordered)
        top = min(item.top for item in ordered)
        right = max(item.left + item.width for item in ordered)
        bottom = max(item.top + item.height for item in ordered)
        lines.append(
            SourceLine(
                page=page,
                block=block,
                paragraph=paragraph,
                line=line_no,
                left=left,
                top=top,
                right=right,
                bottom=bottom,
                text=" ".join(item.text for item in ordered),
                words=ordered,
            )
        )
    lines.sort(key=lambda item: (item.page, item.top, item.left, item.block, item.paragraph, item.line))
    return lines, max_page, tsv_path


def infer_section(text: str) -> str | None:
    normalized = normalize(text)
    if "phi nong nghiep" in normalized:
        return "non-agricultural"
    if "nong nghiep" in normalized:
        return "agricultural"
    return None


def detect_page_area_candidates(lines: list[SourceLine], max_page: int) -> tuple[dict[int, int], list[dict[str, Any]]]:
    by_page: dict[int, list[SourceLine]] = defaultdict(list)
    for line in lines:
        by_page[line.page].append(line)

    normalized_areas = [(index + 1, area, normalize(area)) for index, area in enumerate(AREAS)]
    normalized_areas.sort(key=lambda item: len(item[2]), reverse=True)
    page_candidates: dict[int, int] = {}
    diagnostics: list[dict[str, Any]] = []

    for page in range(1, max_page + 1):
        page_lines = sorted(by_page.get(page, []), key=lambda item: (item.top, item.left))
        top_lines = [line for line in page_lines if line.top <= 230][:45]
        top_text = " ".join(line.text for line in top_lines)
        normalized_top = normalize(top_text)
        matches = [(table_no, area) for table_no, area, needle in normalized_areas if needle and needle in normalized_top]
        if not matches:
            continue
        matches.sort(key=lambda item: len(normalize(item[1])), reverse=True)
        selected = matches[0]
        page_candidates[page] = selected[0]
        diagnostics.append(
            {
                "page": page,
                "selected_table_no": selected[0],
                "selected_area": selected[1],
                "all_matches": [{"tableNo": no, "area": area} for no, area in matches],
                "top_text": top_text[:1200],
            }
        )
    return page_candidates, diagnostics


def build_page_assignments(
    lines: list[SourceLine], max_page: int, page_candidates: dict[int, int]
) -> tuple[dict[int, dict[str, Any]], list[dict[str, Any]], list[dict[str, Any]]]:
    by_page: dict[int, list[SourceLine]] = defaultdict(list)
    for line in lines:
        by_page[line.page].append(line)

    assignments: dict[int, dict[str, Any]] = {}
    events: list[dict[str, Any]] = []
    review: list[dict[str, Any]] = []
    current_area: int | None = None
    current_sequence = 0
    current_section: str | None = None
    last_explicit_section_page = 0

    for page in range(1, max_page + 1):
        page_text = " ".join(line.text for line in by_page.get(page, [])[:120])
        explicit_section = infer_section(page_text)
        if explicit_section:
            current_section = explicit_section
            last_explicit_section_page = page

        candidate = page_candidates.get(page)
        if candidate is not None:
            if current_area is None:
                current_sequence = 1
                current_area = candidate
                events.append({"page": page, "sequence": current_sequence, "tableNo": candidate, "area": AREAS[candidate - 1], "kind": "start"})
            elif candidate == current_area:
                pass
            elif candidate > current_area:
                if candidate > current_area + 1:
                    review.append(
                        {
                            "code": "AREA_HEADING_JUMP",
                            "page": page,
                            "sequence": current_sequence,
                            "from_table_no": current_area,
                            "to_table_no": candidate,
                        }
                    )
                current_area = candidate
                events.append({"page": page, "sequence": current_sequence, "tableNo": candidate, "area": AREAS[candidate - 1], "kind": "advance"})
            elif candidate <= 5 and current_area >= 50:
                current_sequence += 1
                current_area = candidate
                events.append({"page": page, "sequence": current_sequence, "tableNo": candidate, "area": AREAS[candidate - 1], "kind": "sequence-reset"})
            else:
                review.append(
                    {
                        "code": "OUT_OF_ORDER_AREA_CANDIDATE",
                        "page": page,
                        "sequence": current_sequence,
                        "current_table_no": current_area,
                        "candidate_table_no": candidate,
                    }
                )

        if current_area is not None:
            assignments[page] = {
                "sequence": current_sequence,
                "section": current_section or f"sequence-{current_sequence:02d}",
                "section_last_explicit_page": last_explicit_section_page or None,
                "tableNo": current_area,
                "area": AREAS[current_area - 1],
            }
    return assignments, events, review


def compact_line(line: SourceLine) -> dict[str, Any]:
    return {
        "p": line.page,
        "b": line.block,
        "r": line.paragraph,
        "l": line.line,
        "x0": round(line.left, 3),
        "y0": round(line.top, 3),
        "x1": round(line.right, 3),
        "y1": round(line.bottom, 3),
        "t": line.text,
        "w": [
            [round(word.left, 3), round(word.top, 3), round(word.width, 3), round(word.height, 3), word.text]
            for word in line.words
        ],
    }


def contiguous_ranges(pages: Iterable[int]) -> list[tuple[int, int]]:
    ordered = sorted(set(pages))
    if not ordered:
        return []
    ranges: list[tuple[int, int]] = []
    start = previous = ordered[0]
    for page in ordered[1:]:
        if page == previous + 1:
            previous = page
            continue
        ranges.append((start, previous))
        start = previous = page
    ranges.append((start, previous))
    return ranges


def write_area_bundles(
    lines: list[SourceLine],
    assignments: dict[int, dict[str, Any]],
    output_dir: Path,
    area_start: int,
    area_end: int,
) -> list[dict[str, Any]]:
    lines_by_page: dict[int, list[SourceLine]] = defaultdict(list)
    for line in lines:
        lines_by_page[line.page].append(line)

    area_reports: list[dict[str, Any]] = []
    areas_dir = output_dir / "areas"
    areas_dir.mkdir(parents=True, exist_ok=True)

    for table_no in range(area_start, area_end + 1):
        assigned_pages = [page for page, meta in assignments.items() if meta["tableNo"] == table_no]
        sequence_pages: dict[tuple[int, str], list[int]] = defaultdict(list)
        for page in assigned_pages:
            meta = assignments[page]
            sequence_pages[(int(meta["sequence"]), str(meta["section"]))].append(page)

        bundle_lines: list[dict[str, Any]] = []
        segments: list[dict[str, Any]] = []
        for (sequence, section), pages in sorted(sequence_pages.items()):
            ranges = contiguous_ranges(pages)
            for start, end in ranges:
                segment_lines = [line for page in range(start, end + 1) for line in lines_by_page.get(page, [])]
                first_index = len(bundle_lines)
                bundle_lines.extend(compact_line(line) for line in segment_lines)
                segments.append(
                    {
                        "sequence": sequence,
                        "section": section,
                        "pageStart": start,
                        "pageEnd": end,
                        "pageCount": end - start + 1,
                        "lineStart": first_index,
                        "lineCount": len(segment_lines),
                    }
                )

        area_slug = f"area-{table_no:03d}"
        bundle_path = areas_dir / f"{area_slug}.source.json.gz"
        bundle = {
            "schema": "nq28-area-source-v1",
            "tableNo": table_no,
            "area": AREAS[table_no - 1],
            "segments": segments,
            "lines": bundle_lines,
        }
        with gzip.open(bundle_path, "wt", encoding="utf-8", newline="\n", compresslevel=9) as handle:
            json.dump(bundle, handle, ensure_ascii=False, separators=(",", ":"), sort_keys=True)
            handle.write("\n")

        preview_path = areas_dir / f"{area_slug}.preview.txt"
        with preview_path.open("w", encoding="utf-8", newline="\n") as handle:
            handle.write(f"TABLE={table_no:03d} | AREA={AREAS[table_no - 1]}\n")
            for segment in segments:
                handle.write(
                    f"--- SEQUENCE={segment['sequence']} | SECTION={segment['section']} | "
                    f"PAGES={segment['pageStart']}-{segment['pageEnd']} | LINES={segment['lineCount']} ---\n"
                )
                start = int(segment["lineStart"])
                end = start + int(segment["lineCount"])
                for item in bundle_lines[start:end]:
                    handle.write(
                        f"P={item['p']:04d} | X={item['x0']:08.3f}-{item['x1']:08.3f} | "
                        f"Y={item['y0']:08.3f}-{item['y1']:08.3f} | {item['t']}\n"
                    )

        area_reports.append(
            {
                "tableNo": table_no,
                "area": AREAS[table_no - 1],
                "segmentCount": len(segments),
                "pageCount": len(set(assigned_pages)),
                "lineCount": len(bundle_lines),
                "sourceFile": str(bundle_path.relative_to(output_dir)),
                "sourceBytes": bundle_path.stat().st_size,
                "sourceSha256": sha256_file(bundle_path),
                "previewFile": str(preview_path.relative_to(output_dir)),
                "previewBytes": preview_path.stat().st_size,
            }
        )
    return area_reports


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", required=True, type=Path)
    parser.add_argument("--work", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--area-start", type=int, default=1)
    parser.add_argument("--area-end", type=int, default=10)
    args = parser.parse_args()

    if not 1 <= args.area_start <= args.area_end <= len(AREAS):
        raise ValueError(f"Area range must be within 1..{len(AREAS)}")

    source = args.source.resolve()
    workdir = args.work.resolve()
    output_dir = args.output.resolve()
    if not source.is_file():
        raise FileNotFoundError(source)

    if workdir.exists():
        shutil.rmtree(workdir)
    workdir.mkdir(parents=True, exist_ok=True)
    output_dir.mkdir(parents=True, exist_ok=True)

    embedded_doc, embedded_report = extract_embedded_document(source, workdir)
    pdf_path = convert_to_pdf(embedded_doc, workdir)
    lines, page_count, tsv_path = parse_words(pdf_path, workdir)
    page_candidates, candidate_diagnostics = detect_page_area_candidates(lines, page_count)
    assignments, heading_events, review = build_page_assignments(lines, page_count, page_candidates)
    area_reports = write_area_bundles(
        lines,
        assignments,
        output_dir,
        args.area_start,
        args.area_end,
    )

    requested_missing = [item for item in area_reports if item["segmentCount"] == 0]
    coverage_by_sequence: dict[str, list[int]] = defaultdict(list)
    for page, meta in assignments.items():
        del page
        key = f"{meta['sequence']}:{meta['section']}"
        coverage_by_sequence[key].append(int(meta["tableNo"]))

    manifest = {
        "schema": "nq28-source-manifest-v1",
        "pipeline": "embedded-doc -> PDF -> pdftotext TSV -> area source bundles",
        "source": {
            "file": source.name,
            "bytes": source.stat().st_size,
            "sha256": sha256_file(source),
        },
        "embedded": embedded_report,
        "pdf": {
            "file": pdf_path.name,
            "bytes": pdf_path.stat().st_size,
            "sha256": sha256_file(pdf_path),
            "pageCount": page_count,
        },
        "tsv": {
            "bytes": tsv_path.stat().st_size,
            "sha256": sha256_file(tsv_path),
            "lineCount": len(lines),
        },
        "areaCatalog": [{"tableNo": index + 1, "area": area} for index, area in enumerate(AREAS)],
        "requestedRange": {"start": args.area_start, "end": args.area_end},
        "headingEvents": heading_events,
        "candidateDiagnostics": candidate_diagnostics,
        "coverageBySequence": {
            key: {
                "minTableNo": min(values),
                "maxTableNo": max(values),
                "distinctAreaCount": len(set(values)),
            }
            for key, values in sorted(coverage_by_sequence.items())
            if values
        },
        "areas": area_reports,
        "validation": {
            "requestedAreaCount": args.area_end - args.area_start + 1,
            "requestedAreasWithSource": sum(1 for item in area_reports if item["segmentCount"] > 0),
            "requestedAreasMissingSource": [item["tableNo"] for item in requested_missing],
            "reviewItemCount": len(review),
            "status": "pass" if not requested_missing else "review",
        },
        "review": review,
        "safety": {
            "runtimeModified": False,
            "legalRelationsInferred": False,
            "recordIdsGenerated": False,
            "plainTextUsedAsPrimarySource": False,
            "wordCoordinatesPreserved": True,
        },
    }
    manifest_path = output_dir / "source-manifest.json"
    manifest_path.write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )

    print(json.dumps({
        "pageCount": page_count,
        "sourceLineCount": len(lines),
        "headingEventCount": len(heading_events),
        "requestedRange": manifest["requestedRange"],
        "validation": manifest["validation"],
        "coverageBySequence": manifest["coverageBySequence"],
        "areas": area_reports,
    }, ensure_ascii=False, indent=2))

    if requested_missing:
        return 2
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:  # noqa: BLE001
        print(f"ERROR: {exc}", file=sys.stderr)
        raise
