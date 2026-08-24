#!/usr/bin/env python3
import json
import re
import unicodedata
from pathlib import Path

SRC_DIR = Path('extracted_text')
OUT_DIR = Path('structured_data')
OUT_DIR.mkdir(parents=True, exist_ok=True)

FILES = {
    'data1_dat_nn.txt': '1. Đất NN 1-2140.pdf',
    'data2_dat_dao_phi_nn.txt': '2 Đất Đảo, Phi Nông Nghiệp -2140-4285.pdf',
    'data3_kcn_ccn.txt': '3 Đất KCN - Cụm Công Nghiệp-4285-4289.pdf',
    'data4_khu_cn_tdc.txt': '4. Đất Khu C.NGhệ - Tái Định Cư-4289-4304.pdf',
    'data5_tuyen_duong.txt': '5. Các tuyến đường chính-4304-4390.pdf',
    'data6_nn_min_max.txt': '6. Đất NN tối thiểu- tối đa-4390-4396.pdf',
}

PURPOSE_PATTERNS = [
    ('dat_o', r'\bđất\s+ở\b'),
    ('thuong_mai_dich_vu', r'thương\s+mại|dịch\s+vụ'),
    ('sxkd_phi_nn', r'sản\s+xuất|kinh\s+doanh\s+phi\s+nông\s+nghiệp|sxkd'),
    ('kcn', r'khu\s+công\s+nghiệp|\bkcn\b'),
    ('ccn', r'cụm\s+công\s+nghiệp|\bccn\b'),
    ('nong_nghiep', r'nông\s+nghiệp|đất\s+trồng|đất\s+rừng|nuôi\s+trồng\s+thủy\s+sản'),
    ('tai_dinh_cu', r'tái\s+định\s+cư'),
    ('khu_cong_nghe', r'khu\s+công\s+nghệ|công\s+nghệ\s+cao'),
]

NUMBER_RE = re.compile(r'(?<!\w)(\d{1,3}(?:[\.\s,]\d{3})+(?:[,.]\d+)?|\d{4,})(?!\w)')

def clean(s: str) -> str:
    s = unicodedata.normalize('NFC', s)
    return re.sub(r'\s+', ' ', s).strip()

def parse_number(token: str):
    t = token.replace(' ', '')
    # Land tables normally use . or , as thousands separators.
    if re.fullmatch(r'\d{1,3}(?:[\.,]\d{3})+', t):
        return int(re.sub(r'[\.,]', '', t))
    try:
        return int(t)
    except ValueError:
        return None

def purpose_candidates(text: str):
    low = text.lower()
    return [key for key, pat in PURPOSE_PATTERNS if re.search(pat, low, flags=re.I)]

records = []
manifest = []
for txt_name, source_pdf in FILES.items():
    p = SRC_DIR / txt_name
    if not p.exists():
        manifest.append({'source_pdf': source_pdf, 'text_file': txt_name, 'status': 'missing'})
        continue
    raw = p.read_text(encoding='utf-8', errors='replace')
    pages = raw.split('\f')
    count = 0
    for page_no, page in enumerate(pages, start=1):
        for line_no, line in enumerate(page.splitlines(), start=1):
            text = clean(line)
            if not text:
                continue
            nums = []
            for m in NUMBER_RE.finditer(text):
                val = parse_number(m.group(1))
                if val is not None:
                    nums.append({'raw': m.group(1), 'value': val})
            rec = {
                'source_pdf': source_pdf,
                'source_page': page_no,
                'source_line': line_no,
                'text': text,
                'numbers': nums,
                'purpose_candidates': purpose_candidates(text),
            }
            records.append(rec)
            count += 1
    manifest.append({'source_pdf': source_pdf, 'text_file': txt_name, 'status': 'ok', 'pages': len(pages), 'nonempty_lines': count})

with (OUT_DIR / 'land_raw_index.jsonl').open('w', encoding='utf-8') as f:
    for rec in records:
        f.write(json.dumps(rec, ensure_ascii=False) + '\n')

(OUT_DIR / 'land_raw_manifest.json').write_text(
    json.dumps(manifest, ensure_ascii=False, indent=2), encoding='utf-8'
)

print(f'Wrote {len(records)} records to structured_data/land_raw_index.jsonl')
