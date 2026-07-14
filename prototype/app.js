(() => {
  'use strict';
  const segments = window.BAO_TIN_SEGMENTS || [];
  const $ = id => document.getElementById(id);
  const landLabels = { residential: 'Đất ở', commercial: 'Đất thương mại, dịch vụ', production: 'Đất cơ sở sản xuất phi nông nghiệp / khoáng sản' };
  const accessLabels = { main: 'Tiếp giáp đường chính', direct: 'Đường nhánh đấu nối trực tiếp', indirect: 'Đường nhánh không đấu nối trực tiếp nhưng thông ra' };
  let selected = segments[0], marker = null, selectedLine = null, autoSuggested = false, clipboardText = '';

  const renderer = L.canvas({ padding: 0.1 });
  const map = L.map('map', {
    zoomControl: true, zoomAnimation: false, fadeAnimation: false,
    markerZoomAnimation: false, preferCanvas: true,
    maxBounds: [[10.60, 106.40], [11.30, 107.30]], maxBoundsViscosity: 0.85
  }).setView([10.9562, 106.8310], 13);

  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    minZoom: 10, maxZoom: 17, maxNativeZoom: 17, detectRetina: false,
    updateWhenIdle: true, updateWhenZooming: false, keepBuffer: 0,
    crossOrigin: true, attribution: '© OpenStreetMap'
  }).addTo(map);

  const lines = new Map();
  segments.forEach(s => {
    const line = L.polyline(s.geometry, { renderer, color: '#0b2b6d', weight: 4, opacity: .65, dashArray: '8 7', smoothFactor: 2 }).addTo(map);
    line.bindTooltip(`${s.road}<br>${s.start} – ${s.end}`);
    line.on('click', () => selectSegment(s, false));
    lines.set(s.id, line);
  });

  const fmt = n => Number(n).toLocaleString('vi-VN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const normalize = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D').toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
  const insideArea = p => p[0] >= 10.70 && p[0] <= 11.20 && p[1] >= 106.55 && p[1] <= 107.20;
  const setMessage = (text, type = 'info') => { $('coordinateMessage').textContent = text; $('coordinateMessage').dataset.type = type; };

  function fillRoads() {
    $('roadSelect').innerHTML = '';
    segments.forEach(s => {
      const option = document.createElement('option');
      option.value = s.id;
      option.textContent = `${s.road}: ${s.start} → ${s.end}`;
      $('roadSelect').appendChild(option);
    });
  }

  function extractCoordinate(raw) {
    let text = String(raw || '').trim();
    try { text = decodeURIComponent(text); } catch (_) { /* không phải URL mã hóa */ }
    const patterns = [
      /@(-?\d{1,2}(?:\.\d+)?),\s*(-?\d{1,3}(?:\.\d+)?)/i,
      /[?&](?:q|query|ll|center)=(-?\d{1,2}(?:\.\d+)?)(?:,|\s)(-?\d{1,3}(?:\.\d+)?)/i,
      /\((-?\d{1,2}(?:\.\d+)?),\s*(-?\d{1,3}(?:\.\d+)?)\)/i,
      /(-?\d{1,2}\.\d{4,})\s*[,;\s]\s*(-?\d{1,3}\.\d{4,})/i
    ];
    for (const pattern of patterns) {
      const match = text.match(pattern);
      if (!match) continue;
      const p = [Number(match[1]), Number(match[2])];
      if (Number.isFinite(p[0]) && Number.isFinite(p[1]) && Math.abs(p[0]) <= 90 && Math.abs(p[1]) <= 180) return p;
    }
    return null;
  }

  function roadMatches(raw) {
    const text = normalize(raw);
    return segments.filter(s => {
      const full = normalize(s.road), short = full.replace(/^duong\s+/, '');
      return (full.length >= 5 && text.includes(full)) || (short.length >= 5 && text.includes(short));
    });
  }

  function pointSegmentDistance(p, a, b) {
    const x = p[1], y = p[0], x1 = a[1], y1 = a[0], x2 = b[1], y2 = b[0], dx = x2 - x1, dy = y2 - y1;
    const t = Math.max(0, Math.min(1, ((x - x1) * dx + (y - y1) * dy) / (dx * dx + dy * dy || 1)));
    const lat = y1 + t * dy, lon = x1 + t * dx;
    const dLat = (y - lat) * 111320, dLon = (x - lon) * 111320 * Math.cos(y * Math.PI / 180);
    return Math.sqrt(dLat * dLat + dLon * dLon);
  }

  function nearest(p, candidates = segments) {
    let best = null;
    candidates.forEach(s => {
      let d = Infinity;
      for (let i = 0; i < s.geometry.length - 1; i++) d = Math.min(d, pointSegmentDistance(p, s.geometry[i], s.geometry[i + 1]));
      if (!best || d < best.d) best = { s, d };
    });
    return best;
  }

  function suggest(raw, point) {
    const matches = roadMatches(raw), candidates = matches.length ? matches : segments;
    if (point) {
      const n = nearest(point, candidates);
      if (!n) return;
      selectSegment(n.s, true);
      setMessage(`${matches.length ? 'Đã nhận diện tên đường và lọc đoạn.' : 'Đã chọn đoạn hình học gần nhất.'} Khoảng cách ước tính ${Math.round(n.d)} m; cần xác nhận mốc pháp lý.`, matches.length ? 'success' : 'warning');
    } else if (matches.length) {
      selectSegment(matches[0], true);
      setMessage(`Đã lọc được ${matches.length} đoạn theo tên đường. Cần thêm tọa độ để chốt đúng đoạn.`, 'warning');
    } else {
      setMessage('Chưa tìm thấy tọa độ hoặc tên đường khớp dữ liệu mẫu. Hãy sao chép dòng tọa độ màu xanh trên Google Maps.', 'error');
    }
  }

  function putPin(latlng, raw = '') {
    if (marker) marker.remove();
    marker = L.circleMarker(latlng, { renderer, radius: 8, color: '#071b4b', weight: 3, fillColor: '#d6a323', fillOpacity: 1 }).addTo(map).bindPopup('Vị trí tra cứu').openPopup();
    map.panTo(latlng, { animate: false });
    $('coordinateInput').value = raw ? raw.replace(/\s+/g, ' ').trim().slice(0, 500) : `${latlng[0].toFixed(6)}, ${latlng[1].toFixed(6)}`;
    $('selectedCoordinate').textContent = `Tọa độ: ${latlng[0].toFixed(6)}, ${latlng[1].toFixed(6)}`;
    $('googleMapsLink').href = `https://www.google.com/maps?q=${latlng[0]},${latlng[1]}`;
    suggest(raw, latlng);
  }

  function selectSegment(s, fromMap) {
    if (!s) return;
    selected = s; autoSuggested = !!fromMap; $('roadSelect').value = s.id;
    if (selectedLine) selectedLine.setStyle({ color: '#0b2b6d', weight: 4, opacity: .65, dashArray: '8 7' });
    selectedLine = lines.get(s.id);
    if (selectedLine) { selectedLine.setStyle({ color: '#d6a323', weight: 7, opacity: 1, dashArray: null }); selectedLine.bringToFront(); }
    render();
  }

  function branchNote() {
    if ($('accessTypeSelect').value === 'main') return '';
    const surface = $('surfaceSelect').value === 'paved' ? 'nhựa/bê tông' : 'đất/đá/sỏi/cấp phối';
    const width = { gte5: '≥ 5 m', '3to5': 'từ 3 m đến dưới 5 m', lt3: '< 3 m' }[$('widthSelect').value];
    return `; mặt đường ${surface}, bề rộng ${width}, cách đường chính ${Number($('distanceInput').value || 0)} m`;
  }

  function render() {
    if (!selected) return;
    const type = $('landTypeSelect').value, market = selected.factors[type], planning = Number($('planningFactor').value), other = Number($('otherFactor').value), total = market * planning * other;
    $('resultCommune').textContent = selected.commune; $('resultRoad').textContent = selected.road; $('resultSegment').textContent = `${selected.start} – ${selected.end}`;
    $('resultAccess').textContent = accessLabels[$('accessTypeSelect').value] + branchNote(); $('resultLandType').textContent = landLabels[type];
    $('marketFactor').textContent = fmt(market); $('planningFactorResult').textContent = fmt(planning); $('otherFactorResult').textContent = fmt(other); $('totalFactor').textContent = fmt(total);
    $('formulaMarket').textContent = fmt(market); $('formulaPlanning').textContent = fmt(planning); $('formulaOther').textContent = fmt(other);
    $('legalSourceText').textContent = `Quyết định 03/2026/QĐ-UBND – ${selected.source.appendix}, ${selected.source.table}.`;
    $('sourcePage').textContent = `Trang PDF: ${selected.source.pdfPage}`; $('sourceRecord').textContent = `Mã: ${selected.id} / ${selected.source.record}`;
    $('confidenceText').textContent = autoSuggested ? 'Cần xác nhận' : 'Đã chọn thủ công';
  }

  function toggleBranch() { $('branchConditions').classList.toggle('hidden', $('accessTypeSelect').value === 'main'); render(); }
  function copyResult() {
    const text = ['BẢO TÍN – KẾT QUẢ TRA CỨU NHÁP', `Địa bàn: ${$('resultCommune').textContent}`, `Tuyến đường: ${$('resultRoad').textContent}`, `Đoạn: ${$('resultSegment').textContent}`, `Vị trí: ${$('resultAccess').textContent}`, `Loại đất: ${$('resultLandType').textContent}`, `Hệ số biến động: ${$('marketFactor').textContent}`, `Hệ số quy hoạch: ${$('planningFactorResult').textContent}`, `Yếu tố khác: ${$('otherFactorResult').textContent}`, `Hệ số tổng hợp: ${$('totalFactor').textContent}`, `${$('legalSourceText').textContent} ${$('sourcePage').textContent}`, 'Lưu ý: dữ liệu hình học chưa kiểm duyệt.'].join('\n');
    navigator.clipboard?.writeText(text).then(() => $('copyMessage').textContent = 'Đã sao chép kết quả.').catch(() => $('copyMessage').textContent = 'Không thể sao chép tự động.');
  }

  const input = $('coordinateInput');
  document.querySelector('label[for="coordinateInput"]').textContent = 'Tọa độ hoặc thông tin ghim Google Maps';
  input.placeholder = 'Dán tọa độ, đường dẫn hoặc thông tin ghim Google Maps';
  $('locateBtn').textContent = 'Tự lọc';
  $('mapHint').textContent = 'Chế độ nhẹ: ưu tiên dán tọa độ, bản đồ dùng để kiểm tra.';
  document.querySelector('.version-badge').textContent = 'V0.1.2';
  const footer = document.querySelectorAll('.app-footer span'); if (footer[1]) footer[1].textContent = 'Phát triển bởi Nguyễn Mạnh Cường · Version: V0.1.2';

  input.addEventListener('paste', e => {
    const text = e.clipboardData?.getData('text') || '';
    if (!text) return;
    e.preventDefault(); clipboardText = text; input.value = text.replace(/\s+/g, ' ').trim().slice(0, 500);
    setMessage(extractCoordinate(text) ? 'Đã bóc được tọa độ. Bấm “Tự lọc”.' : roadMatches(text).length ? 'Đã nhận diện tên đường. Bấm “Tự lọc”; nên bổ sung tọa độ.' : 'Đã nhận nội dung dán. Bấm “Tự lọc” để kiểm tra.', extractCoordinate(text) ? 'success' : 'info');
  });

  fillRoads(); putPin([10.9562, 106.8310], '10.9562, 106.8310');
  map.on('click', e => putPin([e.latlng.lat, e.latlng.lng], ''));
  $('locateBtn').onclick = () => {
    const raw = clipboardText || input.value, point = extractCoordinate(raw);
    if (point) {
      if (!insideArea(point)) return setMessage('Tọa độ nằm ngoài vùng dữ liệu mẫu Phường Biên Hòa.', 'error');
      putPin(point, raw); map.setView(point, 16, { animate: false });
    } else suggest(raw, null);
  };
  $('gpsBtn').onclick = () => navigator.geolocation ? navigator.geolocation.getCurrentPosition(p => putPin([p.coords.latitude, p.coords.longitude], ''), () => setMessage('Không lấy được vị trí hiện tại.', 'error'), { enableHighAccuracy: false, timeout: 8000, maximumAge: 60000 }) : setMessage('Trình duyệt không hỗ trợ GPS.', 'error');
  $('clearPinBtn').onclick = () => { if (marker) marker.remove(); marker = null; clipboardText = ''; input.value = ''; setMessage('Đã xóa ghim và nội dung dán.', 'info'); };
  $('roadSelect').onchange = () => selectSegment(segments.find(s => s.id === $('roadSelect').value), false);
  ['landTypeSelect', 'planningFactor', 'otherFactor', 'surfaceSelect', 'widthSelect', 'distanceInput'].forEach(id => $(id).addEventListener('change', render));
  $('accessTypeSelect').onchange = toggleBranch;
  $('confirmBtn').onclick = () => { autoSuggested = false; render(); $('confidenceText').textContent = 'Đã xác nhận'; setMessage('Đã xác nhận đoạn và điều kiện. Dữ liệu vẫn ở trạng thái nháp.', 'success'); };
  $('copyBtn').onclick = copyResult; $('printBtn').onclick = () => window.print(); $('resetBtn').onclick = () => location.reload();
  $('manualTab').onclick = () => document.querySelector('.search-panel').scrollIntoView({ behavior: 'smooth' });
  const modal = $('legalModal'); $('legalTab').onclick = () => modal.classList.remove('hidden'); modal.querySelector('[data-close-modal]').onclick = () => modal.classList.add('hidden'); modal.onclick = e => { if (e.target === modal) modal.classList.add('hidden'); };
  setTimeout(() => map.invalidateSize({ animate: false }), 120);
})();
