#!/usr/bin/env python3
"""Inventory the real table structure of the embedded NQ28 `Bang gia.doc`.

This stage is diagnostic only. It does not create runtime prices and it never
infers land-purpose semantics from split PDF filenames. The goal is to map every
source table to Appendix I..VIII and preserve row/cell evidence before building
the canonical online dataset.
"""

from __future__ import annotations

import argparse
import hashlib
import io
import json
import re
import shutil
import subprocess
import unicodedata
import zipfile
from collections import Counter, defaultdict
from pathlib import Path
from typing import Any

import olefile
from bs4 import BeautifulSoup, Tag


ROMANS = ("VIII", "VII", "VI", "V", "IV", "III", "II", "I")
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
SPACE_RE = re.compile(r"\s+")


def normalize(text: str) -> str:
    value = unicodedata.normalize("NFD", text or "")
    value = "".join(ch for ch in value if unicodedata.category(ch) != "Mn")
    value = value.replace("đ", "d").replace("Đ", "D").lower()
    value = re.sub(r"[^a-z0-9]+", " ", value)
    return SPACE_RE.sub(" ", value).strip()


NORMALIZED_TITLES = {key: normalize(value) for key, value in APPENDIX_TITLES.items()}


def sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def run(cmd: list[str]) -> subprocess.CompletedProcess[str]:
    result = subprocess.run(cmd, text=True, capture_output=True, check=False)
    if result.returncode != 0:
        raise RuntimeError(
            f"Command failed ({result.returncode}): {' '.join(cmd)}\n"
            f"stdout:\n{result.stdout}\nstderr:\n{result.stderr}"
        )
    return result


def extract_embedded_bang_gia(source: Path, work: Path) -> tuple[Path, dict[str, Any]]:
    if not olefile.isOleFile(str(source)):
        raise RuntimeError(f"Not an OLE DOC: {source}")
    candidates: list[tuple[int, str, bytes]] = []
    with olefile.OleFileIO(str(source)) as ole:
        for parts in ole.listdir(streams=True, storages=False):
            name = "/".join(parts)
            data = ole.openstream(parts).read()
            if not name.lower().endswith("ole10native"):
                continue
            offset = data.find(b"PK\x03\x04")
            if offset >= 0:
                payload = data[offset:]
                candidates.append((len(payload), name, payload))
    if not candidates:
        raise RuntimeError("No embedded ZIP payload found in Ole10Native streams")
    payload_size, stream_name, payload = max(candidates, key=lambda item: item[0])
    embedded_root = work / "embedded"
    embedded_root.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(io.BytesIO(payload)) as archive:
        archive.extractall(embedded_root)
    docs = [p for p in embedded_root.rglob("*.doc") if p.is_file()]
    if not docs:
        raise RuntimeError("Embedded ZIP contains no .doc file")
    docs.sort(key=lambda p: ("bang gia" not in normalize(p.stem), -p.stat().st_size, str(p)))
    selected = docs[0]
    return selected, {
        "selectedOleStream": stream_name,
        "embeddedZipBytes": payload_size,
        "embeddedZipSha256": sha256_bytes(payload),
        "embeddedDoc": selected.name,
        "embeddedDocBytes": selected.stat().st_size,
        "embeddedDocSha256": sha256_file(selected),
    }


def convert_to_html(source: Path, work: Path) -> Path:
    exe = shutil.which("libreoffice") or shutil.which("soffice")
    if not exe:
        raise RuntimeError("LibreOffice/soffice not installed")
    out = work / "html"
    out.mkdir(parents=True, exist_ok=True)
    profile = (work / "lo-profile").resolve().as_uri()
    run([
        exe,
        f"-env:UserInstallation={profile}",
        "--headless",
        "--convert-to",
        "html:HTML (StarWriter)",
        "--outdir",
        str(out),
        str(source),
    ])
    files = sorted(list(out.glob("*.html")) + list(out.glob("*.htm")), key=lambda p: -p.stat().st_size)
    if not files:
        raise RuntimeError("LibreOffice produced no HTML")
    return files[0]


def clean_text(tag: Tag) -> str:
    text = tag.get_text(" ", strip=True).replace("\xa0", " ")
    return SPACE_RE.sub(" ", text).strip()


def direct_rows(table: Tag) -> list[Tag]:
    rows: list[Tag] = []
    for child in table.children:
        if not isinstance(child, Tag):
            continue
        if child.name == "tr":
            rows.append(child)
        elif child.name in {"thead", "tbody", "tfoot"}:
            rows.extend(child.find_all("tr", recursive=False))
    if not rows:
        rows = table.find_all("tr")
    return rows


def row_cells(row: Tag) -> list[str]:
    cells = row.find_all(["td", "th"], recursive=False)
    if not cells:
        cells = row.find_all(["td", "th"])
    return [clean_text(cell) for cell in cells]


def detect_appendix(text: str) -> str | None:
    norm = normalize(text)
    if not norm:
        return None
    # Prefer exact legal titles; they are less ambiguous than a bare Roman numeral.
    for appendix in ROMANS:
        title = NORMALIZED_TITLES[appendix]
        if title and title in norm:
            return appendix
    for appendix in ROMANS:
        if re.search(rf"\bphu luc {appendix.lower()}\b", norm):
            return appendix
    return None


def is_price_header(cells: list[str]) -> bool:
    joined = normalize(" | ".join(cells))
    return "gia dat" in joined or "gia thuong mai" in joined


def summarize_table(table: Tag, table_index: int, context: list[str], inherited_appendix: str | None) -> dict[str, Any]:
    rows = direct_rows(table)
    matrix = [row_cells(row) for row in rows]
    table_text = " ".join(" ".join(row) for row in matrix[:12])
    inside_appendix = detect_appendix(table_text)
    context_appendix = None
    for text in reversed(context[-24:]):
        context_appendix = detect_appendix(text)
        if context_appendix:
            break
    appendix = inside_appendix or context_appendix or inherited_appendix
    max_columns = max((len(row) for row in matrix), default=0)
    nonempty_rows = [row for row in matrix if any(cell.strip() for cell in row)]
    header_rows = [
        {"rowIndex": idx + 1, "cells": row}
        for idx, row in enumerate(matrix)
        if is_price_header(row)
    ][:12]
    return {
        "tableIndex": table_index,
        "appendix": appendix,
        "rowCount": len(matrix),
        "nonemptyRowCount": len(nonempty_rows),
        "maxColumns": max_columns,
        "firstRows": nonempty_rows[:6],
        "lastRows": nonempty_rows[-4:] if nonempty_rows else [],
        "priceHeaderRows": header_rows,
        "contextBefore": context[-10:],
        "insideAppendixMarker": inside_appendix,
        "contextAppendixMarker": context_appendix,
    }


def build_inventory(html_path: Path) -> dict[str, Any]:
    soup = BeautifulSoup(html_path.read_bytes(), "lxml")
    body = soup.body or soup
    context: list[str] = []
    tables: list[dict[str, Any]] = []
    current_appendix: str | None = None
    table_index = 0

    # Walk top-level document blocks in source order. LibreOffice Writer HTML normally
    # emits paragraphs/headings and tables as direct BODY children.
    blocks = [node for node in body.children if isinstance(node, Tag)]
    if not blocks:
        blocks = body.find_all(["p", "h1", "h2", "h3", "h4", "table"], recursive=True)

    for block in blocks:
        if block.name == "table":
            table_index += 1
            info = summarize_table(block, table_index, context, current_appendix)
            if info["appendix"]:
                current_appendix = info["appendix"]
            tables.append(info)
            continue
        text = clean_text(block)
        if not text:
            continue
        context.append(text)
        appendix = detect_appendix(text)
        if appendix:
            current_appendix = appendix

    # Fallback if nested tables were skipped by BODY-level traversal.
    all_tables = body.find_all("table")
    if len(tables) != len(all_tables):
        tables = []
        context = []
        current_appendix = None
        for table_index, table in enumerate(all_tables, start=1):
            # Use preceding textual siblings/elements as a local context approximation.
            local_context: list[str] = []
            prev = table.find_previous()
            hops = 0
            while isinstance(prev, Tag) and hops < 30:
                if prev.name in {"p", "h1", "h2", "h3", "h4", "div"}:
                    txt = clean_text(prev)
                    if txt:
                        local_context.append(txt)
                prev = prev.find_previous()
                hops += 1
            local_context.reverse()
            info = summarize_table(table, table_index, local_context, current_appendix)
            if info["appendix"]:
                current_appendix = info["appendix"]
            tables.append(info)

    counts = Counter(item["appendix"] or "UNRESOLVED" for item in tables)
    appendix_tables = defaultdict(list)
    for item in tables:
        appendix_tables[item["appendix"] or "UNRESOLVED"].append(item["tableIndex"])
    missing = [appendix for appendix in APPENDIX_TITLES if not appendix_tables.get(appendix)]
    unresolved = [item["tableIndex"] for item in tables if not item["appendix"]]
    return {
        "schema": "nq28-appendix-table-inventory-v1",
        "tableCount": len(tables),
        "appendixTableCounts": dict(sorted(counts.items())),
        "appendixTables": {key: value for key, value in sorted(appendix_tables.items())},
        "missingAppendices": missing,
        "unresolvedTables": unresolved,
        "tables": tables,
    }


def write_preview(inventory: dict[str, Any], path: Path) -> None:
    with path.open("w", encoding="utf-8", newline="\n") as f:
        f.write(
            f"TABLES={inventory['tableCount']} | MISSING={inventory['missingAppendices']} | "
            f"UNRESOLVED={inventory['unresolvedTables']}\n"
        )
        f.write(f"APPENDIX_COUNTS={inventory['appendixTableCounts']}\n")
        for table in inventory["tables"]:
            f.write(
                f"TABLE={table['tableIndex']:04d} | APP={table['appendix'] or 'UNRESOLVED'} | "
                f"ROWS={table['rowCount']} | COLS={table['maxColumns']}\n"
            )
            for header in table["priceHeaderRows"][:3]:
                f.write(f"  HEADER R{header['rowIndex']}: {' | '.join(header['cells'])}\n")
            for row in table["firstRows"][:2]:
                f.write(f"  FIRST: {' | '.join(row)}\n")
            for row in table["lastRows"][-1:]:
                f.write(f"  LAST: {' | '.join(row)}\n")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", type=Path, required=True)
    parser.add_argument("--work", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()

    source = args.source.resolve()
    work = args.work.resolve()
    output = args.output.resolve()
    if not source.is_file():
        raise FileNotFoundError(source)
    if work.exists():
        shutil.rmtree(work)
    work.mkdir(parents=True, exist_ok=True)
    output.mkdir(parents=True, exist_ok=True)

    bang_gia, embedded = extract_embedded_bang_gia(source, work)
    html = convert_to_html(bang_gia, work)
    inventory = build_inventory(html)
    inventory["source"] = {
        "outerDoc": source.name,
        "outerDocSha256": sha256_file(source),
        **embedded,
        "htmlBytes": html.stat().st_size,
        "htmlSha256": sha256_file(html),
    }
    json_path = output / "appendix-table-inventory.json"
    preview_path = output / "appendix-table-inventory.preview.txt"
    json_path.write_text(json.dumps(inventory, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    write_preview(inventory, preview_path)

    print(json.dumps({
        "tableCount": inventory["tableCount"],
        "appendixTableCounts": inventory["appendixTableCounts"],
        "missingAppendices": inventory["missingAppendices"],
        "unresolvedTables": inventory["unresolvedTables"],
    }, ensure_ascii=False, indent=2))

    # Diagnostic gate: we need all eight appendices identifiable before parsing prices.
    return 2 if inventory["missingAppendices"] else 0


if __name__ == "__main__":
    raise SystemExit(main())
