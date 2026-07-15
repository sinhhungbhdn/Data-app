(() => {
  'use strict';

  const data = window.BAO_TIN_QD03_DATA || { manifest: {}, rows: [] };
  const rows = data.rows || [];
  const baseRows = rows.filter(row => row.relation === 'main');
  const $ = id => document.getElementById(id);
  const relationLabels = {
    main: 'Tiếp giáp trực tiếp tuyến chính',
    direct: 'Đường đấu nối trực tiếp ra tuyến chính',
    indirect: 'Đường không đấu nối trực tiếp nhưng thông ra tuyến chính'
  };
  const landLabels = {
    residential: 'Đất ở',
    commercial: 'Đất thương mại, dịch vụ',
    production: 'Đất cơ sở sản xuất phi nông nghiệp / khoáng sản'
  };
  const offsetMap = {
    direct: { A: 1, B: 2, C: 3 },
    indirect: { A: 4, B: 5, C: 6 }
  };

  let locationQuery = '';
  let currentResult = null;
  let comparisons = [];

  const fmtFactor = value => Number(value).toLocaleString('vi-VN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const fmtMoney = value => Number(value).toLocaleString('vi-VN', { maximumFractionDigits: 0 }) + ' đồng/m²';
  const escapeHtml = value => String(value ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#039;');

  function uniqueRoads() {
    return [...new Set(baseRows.map(row => row.road))].sort((a,b) => a.localeCompare(b, 'vi'));
  }

  function baseByTt(tt) {
    return baseRows.find(row => row.tt === Number(tt)) || null;
  }

  function rowByTt(tt) {
    return rows.find(row => row.tt === Number(tt)) || null;
  }

  function roadOptions() {
    $('roadSelect').innerHTML = uniqueRoads().map(road => `<option value="${escapeHtml(road)}">${escapeHtml(road)}</option>`).join('');
  }

  function refreshSegments(preferredTt) {
    const road = $('roadSelect').value;
    const candidates = baseRows.filter(row => row.road === road);
    $('segmentSelect').innerHTML = candidates.map(row =>
      `<option value="${row.tt}"${Number(preferredTt) === row.tt ? ' selected' : ''}>TT ${row.tt}: ${escapeHtml(row.segmentStart)} → ${escapeHtml(row.segmentEnd)}</option>`
    ).join('');
  }

  function toggleBranchFields() {
    const branch = $('relationSelect').value !== 'main';
    document.querySelectorAll('.branch-only').forEach(node => node.classList.toggle('hidden', !branch));
  }

  function classifyBucket(width, distance) {
    const d = Number(distance);
    if (!width) return { ok: false, message: 'Chưa chọn bề rộng đường.' };
    if (!Number.isFinite(d) || d < 0) return { ok: false, message: 'Khoảng cách phải là số từ 0 trở lên.' };
    if (width === 'gte5') {
      return d <= 600
        ? { ok: true, bucket: 'A', condition: 'Bề rộng từ 5 m trở lên, khoảng cách không quá 600 m' }
        : { ok: true, bucket: 'B', condition: 'Bề rộng từ 5 m trở lên, khoảng cách trên 600 m' };
    }
    if (width === '3to5') {
      if (d <= 400) return { ok: true, bucket: 'A', condition: 'Bề rộng từ 3 m đến dưới 5 m, khoảng cách không quá 400 m' };
      if (d <= 600) return { ok: true, bucket: 'B', condition: 'Bề rộng từ 3 m đến dưới 5 m, khoảng cách trên 400 m đến 600 m' };
      return { ok: true, bucket: 'C', condition: 'Bề rộng từ 3 m đến dưới 5 m, khoảng cách trên 600 m' };
    }
    return d <= 200
      ? { ok: true, bucket: 'B', condition: 'Bề rộng dưới 3 m, khoảng cách không quá 200 m' }
      : { ok: true, bucket: 'C', condition: 'Bề rộng dưới 3 m, khoảng cách trên 200 m' };
  }

  function matchData() {
    const base = baseByTt($('segmentSelect').value);
    const relation = $('relationSelect').value;
    const landType = $('landTypeSelect').value;
    if (!base) return fail('Chưa chọn đoạn đường hợp lệ.');

    let matched = base;
    let condition = relationLabels.main;
    let bucket = null;
    let distance = null;
    let width = null;

    if (relation !== 'main') {
      width = $('widthSelect').value;
      distance = Number($('distanceInput').value);
      const classified = classifyBucket(width, distance);
      if (!classified.ok) return fail(classified.message);
      bucket = classified.bucket;
      condition = `${relationLabels[relation]}; mặt đường nhựa/bê tông xi măng; ${classified.condition}`;
      matched = rowByTt(base.tt + offsetMap[relation][bucket]);
      if (!matched) return fail('Không tìm thấy dòng dữ liệu tương ứng trong bộ dữ liệu.');
    }

    const factor = matched.factors[landType];
    const testPrice = Number($('testPriceInput').value);
    currentResult = {
      id: `${base.tt}-${relation}-${bucket || 'MAIN'}-${landType}`,
      road: base.road,
      start: base.segmentStart,
      end: base.segmentEnd,
      relation,
      relationLabel: relationLabels[relation],
      condition,
      width,
      distance: relation === 'main' ? null : distance,
      bucket,
      landType,
      landLabel: landLabels[landType],
      tt: matched.tt,
      factor,
      pdfPage: matched.pdfPage,
      description: matched.description,
      testPrice: Number.isFinite(testPrice) && testPrice > 0 ? testPrice : null,
      adjustedTestPrice: Number.isFinite(testPrice) && testPrice > 0 ? testPrice * factor : null
    };

    renderResult();
    $('addCompareBtn').disabled = false;
    message(`Đã đối chiếu TT ${matched.tt} từ 107 dòng dữ liệu Phường Biên Hòa.`, 'success');
  }

  function fail(text) {
    currentResult = null;
    $('addCompareBtn').disabled = true;
    $('resultStatus').textContent = 'Chưa đủ điều kiện';
    $('resultStatus').style.background = '#fff0f0';
    message(text, 'error');
  }

  function message(text, type='') {
    $('formMessage').textContent = text;
    $('formMessage').className = `form-message ${type}`;
  }

  function renderResult() {
    if (!currentResult) return;
    const r = currentResult;
    $('resultStatus').textContent = 'Đã đối chiếu';
    $('resultStatus').style.background = '#edf9f3';
    $('resultRoad').textContent = r.road;
    $('resultSegment').textContent = `${r.start} → ${r.end}`;
    $('resultCondition').textContent = `${r.landLabel}; ${r.condition}`;
    $('resultTt').textContent = `TT ${r.tt}`;
    $('resultFactor').textContent = fmtFactor(r.factor);
    $('resultSource').textContent = `QĐ 03/2026/QĐ-UBND - Phụ lục I.1 - Bảng 1 - PDF trang ${r.pdfPage}`;
    $('resultTestPrice').textContent = r.adjustedTestPrice == null
      ? 'Chưa nhập giá bảng kiểm thử'
      : `${fmtMoney(r.testPrice)} × ${fmtFactor(r.factor)} = ${fmtMoney(r.adjustedTestPrice)}`;
  }

  function addComparison() {
    if (!currentResult) return;
    if (comparisons.some(item => item.id === currentResult.id && item.tt === currentResult.tt)) {
      return message('Phương án này đã có trong bảng so sánh.', 'error');
    }
    if (comparisons.length >= 3) return message('Bảng so sánh chỉ nhận tối đa 3 phương án.', 'error');
    comparisons.push({ ...currentResult });
    renderComparisons();
    message('Đã thêm phương án vào bảng so sánh.', 'success');
  }

  function renderComparisons() {
    $('compareCount').textContent = `${comparisons.length}/3`;
    if (!comparisons.length) {
      $('compareBody').innerHTML = '<tr><td colspan="7" class="empty">Chưa có phương án so sánh.</td></tr>';
      return;
    }
    $('compareBody').innerHTML = comparisons.map((r,index) => `<tr>
      <td>${index+1}</td>
      <td><strong>${escapeHtml(r.road)}</strong><br>${escapeHtml(r.start)} → ${escapeHtml(r.end)}</td>
      <td>${escapeHtml(r.condition)}</td>
      <td>TT ${r.tt}</td>
      <td><strong>${fmtFactor(r.factor)}</strong></td>
      <td>PDF trang ${r.pdfPage}</td>
      <td><button class="remove-btn" type="button" data-remove="${index}">Xóa</button></td>
    </tr>`).join('');
  }

  function parseCoordinate(text) {
    const match = String(text).match(/(-?\d{1,3}\.\d{4,})\s*[,;\s]\s*(-?\d{1,3}\.\d{4,})/);
    if (!match) return null;
    let a=Number(match[1]), b=Number(match[2]);
    if (Math.abs(a)>90 && Math.abs(b)<=90) [a,b]=[b,a];
    return Math.abs(a)<=90 && Math.abs(b)<=180 ? [a,b] : null;
  }

  function loadLocation() {
    const raw = $('mapInput').value.trim();
    if (!raw) {
      locationQuery='';
      $('openMapBtn').disabled=true;
      $('locationSummary').textContent='Hãy dán tọa độ, địa chỉ, tên điểm hoặc link Google Maps.';
      return;
    }
    const point=parseCoordinate(raw);
    locationQuery = point ? `${point[0]},${point[1]}` : raw;
    $('openMapBtn').disabled=false;
    $('locationSummary').textContent = point
      ? `Đã nhận tọa độ: ${point[0].toFixed(6)}, ${point[1].toFixed(6)}. App không tự đo khoảng cách.`
      : `Đã nhận địa chỉ/tên điểm: ${raw}. App không tự đo khoảng cách.`;
  }

  function clearLocation() {
    $('mapInput').value=''; locationQuery=''; $('openMapBtn').disabled=true; $('locationSummary').textContent='Chưa nạp vị trí.';
  }

  function init() {
    $('factorDataCount').textContent = `${data.manifest.rowCount || rows.length} dòng`;
    $('segmentDataCount').textContent = `${data.manifest.standardSegmentCount || baseRows.length} đoạn`;
    roadOptions();
    refreshSegments();
    toggleBranchFields();
    renderComparisons();

    $('roadSelect').addEventListener('change', () => { refreshSegments(); currentResult=null; $('addCompareBtn').disabled=true; });
    $('relationSelect').addEventListener('change', () => { toggleBranchFields(); currentResult=null; $('addCompareBtn').disabled=true; });
    $('loadLocationBtn').addEventListener('click', loadLocation);
    $('openMapBtn').addEventListener('click', () => { if(locationQuery) window.open(`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(locationQuery)}`,'_blank','noopener'); });
    $('clearLocationBtn').addEventListener('click', clearLocation);
    $('matchBtn').addEventListener('click', matchData);
    $('addCompareBtn').addEventListener('click', addComparison);
    $('compareBody').addEventListener('click', event => {
      const button=event.target.closest('[data-remove]');
      if(!button) return;
      comparisons.splice(Number(button.dataset.remove),1);
      renderComparisons();
    });
  }

  init();
})();
