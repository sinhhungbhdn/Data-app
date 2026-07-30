#!/usr/bin/env python3
"""Convert the original NQ28 .doc file to HTML and extract table rows.

Primary rule: preserve table-row and table-cell boundaries. Internal line breaks are
stored in raw_text and rendered as the visible token " ⏎ " in view_text so a
source row stays on one physical line in preview files.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import shutil
import subprocess
import sys
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable

from bs4 import BeautifulSoup, Tag


WHITESPACE_RE = re.compile(r"[ \t\r\f\v]+")
NEWLINE_RE = re.compile(r"\n+")
NUMERIC_TT_RE = re.compile(r"^\s*\d+[\.)]?\s*$")


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def normalize_raw_text(cell: Tag) -> str:
    # Keep semantic line breaks from BR/P/DIV, then normalize excess whitespace.
    text = cell.get_text("\n", strip=False).replace("\xa0", " ")
    lines: list[str] = []
    for line in text.splitlines():
        clean = WHITESPACE_RE.sub(" ", line).strip()
        if clean:
            lines.append(clean)
    return "\n".join(lines)


def to_view_text(raw_text: str) -> str:
    return NEWLINE_RE.sub(" ⏎ ", raw_text).strip()


def direct_cells(row: Tag) -> list[Tag]:
    return [c for c in row.find_all(["td", "th"], recursive=False)]


def direct_rows(table: Tag) -> list[Tag]:
    rows: list[Tag] = []
    for child in table.children:
        if not isinstance(child, Tag):
            continue
        if child.name == "tr":
            rows.append(child)
        elif child.name in {"thead", "tbody", "tfoot"}:
            rows.extend(child.find_all("tr", recursive=False))
    return rows


@dataclass
class PendingSpan:
    remaining_rows: int
    value: dict[str, Any]


def expand_table(table: Tag, table_index: int) -> list[dict[str, Any]]:
    """Expand rowspan/colspan into a rectangular logical matrix.

    Original cell metadata is retained. Cells copied from row/column spans include
    inherited=True and origin coordinates.
    """
    pending: dict[int, PendingSpan] = {}
    output: list[dict[str, Any]] = []

    for row_index, row in enumerate(direct_rows(table), start=1):
        logical: list[dict[str, Any] | None] = []

        def ensure_size(index: int) -> None:
            while len(logical) <= index:
                logical.append(None)

        # Materialize rowspans carried from previous rows.
        for col_index in sorted(list(pending.keys())):
            span = pending[col_index]
            ensure_size(col_index)
            inherited = dict(span.value)
            inherited["inherited"] = True
            logical[col_index] = inherited
            span.remaining_rows -= 1
            if span.remaining_rows <= 0:
                pending.pop(col_index, None)

        cursor = 0
        source_cells: list[dict[str, Any]] = []
        for source_cell_index, cell in enumerate(direct_cells(row), start=1):
            while cursor < len(logical) and logical[cursor] is not None:
                cursor += 1

            raw_text = normalize_raw_text(cell)
            view_text = to_view_text(raw_text)
            try:
                rowspan = max(1, int(cell.get("rowspan", 1)))
            except (TypeError, ValueError):
                rowspan = 1
            try:
                colspan = max(1, int(cell.get("colspan", 1)))
            except (TypeError, ValueError):
                colspan = 1

            source_meta = {
                "source_cell_index": source_cell_index,
                "raw_text": raw_text,
                "view_text": view_text,
                "rowspan": rowspan,
                "colspan": colspan,
                "tag": cell.name,
            }
            source_cells.append(source_meta)

            for offset in range(colspan):
                col_index = cursor + offset
                ensure_size(col_index)
                value = {
                    "raw_text": raw_text,
                    "view_text": view_text,
                    "inherited": offset > 0,
                    "origin": {
                        "table": table_index,
                        "row": row_index,
                        "source_cell": source_cell_index,
                        "column_offset": offset,
                    },
                }
                logical[col_index] = value
                if rowspan > 1:
                    pending[col_index] = PendingSpan(rowspan - 1, value)
            cursor += colspan

        cells = [cell if cell is not None else {"raw_text": "", "view_text": "", "inherited": False, "origin": None} for cell in logical]
        visible_values = [cell["view_text"] for cell in cells]
        first_nonempty = next((value for value in visible_values if value), "")

        output.append(
            {
                "table_index": table_index,
                "row_index": row_index,
                "logical_column_count": len(cells),
                "source_cell_count": len(source_cells),
                "source_cells": source_cells,
                "cells": cells,
                "flat_view": " | ".join(f"[{idx + 1}]={value}" for idx, value in enumerate(visible_values)),
                "candidate_tt_row": bool(NUMERIC_TT_RE.match(first_nonempty)),
            }
        )

    return output


def run_libreoffice(source: Path, workdir: Path) -> Path:
    executable = shutil.which("libreoffice") or shutil.which("soffice")
    if not executable:
        raise RuntimeError("LibreOffice/soffice not found")

    workdir.mkdir(parents=True, exist_ok=True)
    command = [
        executable,
        "--headless",
        "--convert-to",
        "html:HTML (StarWriter)",
        "--outdir",
        str(workdir),
        str(source),
    ]
    completed = subprocess.run(command, check=False, text=True, capture_output=True)
    if completed.returncode != 0:
        raise RuntimeError(
            "LibreOffice conversion failed\n"
            f"command: {' '.join(command)}\n"
            f"stdout: {completed.stdout}\n"
            f"stderr: {completed.stderr}"
        )

    html_candidates = sorted(workdir.glob("*.html")) + sorted(workdir.glob("*.htm"))
    if not html_candidates:
        raise RuntimeError(
            "LibreOffice reported success but produced no HTML file\n"
            f"stdout: {completed.stdout}\n"
            f"stderr: {completed.stderr}"
        )
    return html_candidates[0]


def write_chunks(rows: list[dict[str, Any]], output_dir: Path, chunk_size: int) -> list[dict[str, Any]]:
    chunks: list[dict[str, Any]] = []
    for chunk_index, start in enumerate(range(0, len(rows), chunk_size), start=1):
        part = rows[start : start + chunk_size]
        filename = f"raw-table-rows-{chunk_index:04d}.jsonl"
        path = output_dir / filename
        with path.open("w", encoding="utf-8", newline="\n") as handle:
            for row in part:
                handle.write(json.dumps(row, ensure_ascii=False, separators=(",", ":")) + "\n")
        chunks.append(
            {
                "file": filename,
                "first_global_row": start + 1,
                "last_global_row": start + len(part),
                "row_count": len(part),
                "sha256": sha256_file(path),
                "bytes": path.stat().st_size,
            }
        )
    return chunks


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--work", required=True, type=Path)
    parser.add_argument("--chunk-size", type=int, default=5000)
    parser.add_argument("--preview-rows", type=int, default=1000)
    args = parser.parse_args()

    source = args.source.resolve()
    output_dir = args.output.resolve()
    workdir = args.work.resolve()

    if not source.is_file():
        raise FileNotFoundError(source)

    if output_dir.exists():
        shutil.rmtree(output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)

    html_path = run_libreoffice(source, workdir)
    html_bytes = html_path.read_bytes()
    soup = BeautifulSoup(html_bytes, "lxml")
    tables = soup.find_all("table")

    all_rows: list[dict[str, Any]] = []
    table_reports: list[dict[str, Any]] = []
    for table_index, table in enumerate(tables, start=1):
        rows = expand_table(table, table_index)
        for row in rows:
            row["global_row_index"] = len(all_rows) + 1
            all_rows.append(row)
        table_reports.append(
            {
                "table_index": table_index,
                "row_count": len(rows),
                "max_logical_columns": max((r["logical_column_count"] for r in rows), default=0),
                "candidate_tt_rows": sum(1 for r in rows if r["candidate_tt_row"]),
            }
        )

    chunks = write_chunks(all_rows, output_dir, max(1, args.chunk_size))

    preview_path = output_dir / "raw-table-rows-preview.txt"
    with preview_path.open("w", encoding="utf-8", newline="\n") as handle:
        for row in all_rows[: max(0, args.preview_rows)]:
            handle.write(
                f"TABLE={row['table_index']:04d} | ROW={row['row_index']:06d} | GLOBAL={row['global_row_index']:06d} | "
                f"{row['flat_view']}\n"
            )

    report = {
        "pipeline_version": "0.1.0",
        "generated_at_utc": datetime.now(timezone.utc).isoformat(),
        "source": {
            "file": source.name,
            "bytes": source.stat().st_size,
            "sha256": sha256_file(source),
        },
        "conversion": {
            "format": "LibreOffice HTML (StarWriter)",
            "html_bytes": len(html_bytes),
            "html_sha256": hashlib.sha256(html_bytes).hexdigest(),
            "html_committed": False,
        },
        "extraction": {
            "table_count": len(tables),
            "row_count": len(all_rows),
            "candidate_tt_row_count": sum(1 for row in all_rows if row["candidate_tt_row"]),
            "chunk_size": args.chunk_size,
            "chunks": chunks,
            "tables": table_reports,
        },
        "text_policy": {
            "source_cell_line_breaks_preserved_in": "raw_text",
            "preview_line_break_token": " ⏎ ",
            "one_source_table_row_per_preview_line": True,
        },
    }
    (output_dir / "extraction-report.json").write_text(
        json.dumps(report, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )

    index = {
        "source": report["source"],
        "report": "extraction-report.json",
        "preview": "raw-table-rows-preview.txt",
        "chunks": chunks,
    }
    (output_dir / "index.json").write_text(
        json.dumps(index, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )

    print(json.dumps(report["extraction"], ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:  # noqa: BLE001
        print(f"ERROR: {exc}", file=sys.stderr)
        raise
