(() => {
  'use strict';

  const segments = window.BAO_TIN_SEGMENTS || [];
  const $ = id => document.getElementById(id);
  const landLabels = {
    residential: 'Đất ở',
    commercial: 'Đất thương mại, dịch vụ',
    production: 'Đất cơ sở sản xuất phi nông nghiệp / khoáng sản'
  };
  const accessLabels = {
    main: 'Tiếp giáp đường chính',
    direct: 'Đường nhánh đấu nối trực tiếp',
    indirect: 'Đường nhánh không đấu nối trực tiếp nhưng thông ra'
  };

  let selected = null;
  let currentPoint = null;
  let currentRaw = '';
  let currentDistance = null;
  let mapLoaded = false;

  const fmt = value => Number(value).toLocaleString('vi-VN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });

  const normalize = value => String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  const insidePrototypeArea = point => point[0] >= 10.80 && point[0] <= 11.10 && point[1] >= 106.65 && point[1] <= 107.00;

  function setMessage(text, type = 'info') {
    $('searchMessage').textContent = text;
    $('searchMessage').dataset.type = type;
  }

  function extractCoordinate(raw) {
    let text = String(raw || '').trim();
    try { text = decodeURIComponent(text); } catch (_) { /* không phải URL mã hóa */ }

    const patterns = [
      /@(-?\d{1,3}(?:\.\d+)?),\s*(-?\d{1,3}(?:\.\d+)?)/i,
      /[?&](?:q|query|ll|center)=(-?\d{1,3}(?:\.\d+)?)(?:,|%2C|\s)(-?\d{1,3}(?:\.\d+)?)/i,
      /\((-?\d{1,3}(?:\.\d+)?),\s*(-?\d{1,3}(?:\.\d+)?)\)/i,
      /(-?\d{1,3}\.\d{4,})\s*[,;\s]\s*(-?\d{1,3}\.\d{4,})/i
    ];

    for (const pattern of patterns) {
      const match = text.match(pattern);
      if (!match) continue;
      let first = Number(match[1]);
      let second = Number(match[2]);
      if (!Number.isFinite(first) || !Number.isFinite(second)) continue;

      if (Math.abs(first) > 90 && Math.abs(second) <= 90) [first, second] = [second, first];
      if (Math.abs(first) <= 90 && Math.abs(second) <= 180) return [first, second];
    }
    return null;
  }

  function roadMatches(raw) {
    const text = normalize(raw);
    if (!text) return [];
    return segments.filter(segment => {
      const full = normalize(segment.road);
      const short = full.replace(/^duong\s+/, '');
      return (full.length >= 5 && text.includes(full)) || (short.length >= 5 && text.includes(short));
    });
  }

  function pointSegmentDistance(point, a, b) {
    const x = point[1], y = point[0];
    const x1 = a[1], y1 = a[0], x2 = b[1], y2 = b[0];
    const dx = x2 - x1, dy = y2 - y1;
    const denominator = dx * dx + dy * dy || 1;
    const t = Math.max(0, Math.min(1, ((x - x1) * dx + (y - y1) * dy) / denominator));
    const lat = y1 + t * dy, lon = x1 + t * dx;
    const dLat = (y - lat) * 111320;
    const dLon = (x - lon) * 111320 * Math.cos(y * Math.PI / 180);
    return Math.sqrt(dLat * dLat + dLon * dLon);
  }

  function nearest(point, candidates) {
    let best = null;
    candidates.forEach(segment => {
      let distance = Infinity;
      for (let i = 0; i < segment.geometry.length - 1; i += 1) {
        distance = Math.min(distance, pointSegmentDistance(point, segment.geometry[i], segment.geometry[i + 1]));
      }
      if (!best || distance < best.distance) best = { segment, distance };
    });
    return best;
  }

  function planningFactor() {
    if ($('projectModeSelect').value !== 'far') return 1;
    const far = Number($('farInput').value);
    if (!Number.isFinite(far) || far < 0 || $('farInput').value === '') return 1;
    if (far < 4) return 1;
    if (far < 8) return 1.05;
    if (far < 12.8) return 1.10;
    return 1.15;
  }

  function branchNote() {
    const access = $('accessTypeSelect').value;
    if (access === 'main') return accessLabels.main;
    const surface = $('surfaceSelect').value === 'paved' ? 'nhựa/bê tông xi măng' : 'đất/đá/sỏi/cấp phối';
    const width = { gte5: 'từ 5 m trở lên', '3to5': 'từ 3 m đến dưới 5 m', lt3: 'dưới 3 m' }[$('widthSelect').value];
    const distance = Number($('distanceInput').value || 0).toLocaleString('vi-VN');
    return `${accessLabels[access]}; mặt đường ${surface}; bề rộng ${width}; cách đường chính ${distance} m`;
  }

  function assumptionsText() {
    const type = landLabels[$('landTypeSelect').value];
    const access = accessLabels[$('accessTypeSelect').value];
    const planning = fmt(planningFactor());
    const other = fmt(Number($('otherConditionSelect').value));
    return `Đang áp dụng: ${type} · ${access} · Hệ số quy hoạch ${planning} · Yếu tố khác ${other}.`;
  }

  function updateMapPreview() {
    const hasPoint = Array.isArray(currentPoint);
    $('toggleMapBtn').disabled = !hasPoint;
    $('openGoogleBtn').disabled = !hasPoint;
    $('mapCoordinate').textContent = hasPoint
      ? `Tọa độ: ${currentPoint[0].toFixed(6)}, ${currentPoint[1].toFixed(6)}`
      : 'Tọa độ: —';

    if (!hasPoint) {
      mapLoaded = false;
      $('mapFrame').src = '';
      $('mapFrame').classList.add('hidden');
      $('mapPlaceholder').classList.remove('hidden');
      $('toggleMapBtn').textContent = 'Hiện bản đồ';
    }
  }

  function showMap() {
    if (!currentPoint) return;
    const frame = $('mapFrame');
    const placeholder = $('mapPlaceholder');
    if (!mapLoaded) {
      frame.src = `https://maps.google.com/maps?q=${currentPoint[0]},${currentPoint[1]}&z=17&output=embed`;
      mapLoaded = true;
    }
    frame.classList.remove('hidden');
    placeholder.classList.add('hidden');
    $('toggleMapBtn').textContent = 'Ẩn bản đồ';
  }

  function hideMap() {
    $('mapFrame').classList.add('hidden');
    $('mapPlaceholder').classList.remove('hidden');
    $('mapPlaceholder').querySelector('strong').textContent = 'Bản đồ đang ẩn';
    $('mapPlaceholder').querySelector('span').textContent = 'Bấm “Hiện bản đồ” khi cần kiểm tra.';
    $('toggleMapBtn').textContent = 'Hiện bản đồ';
  }

  function renderResult() {
    const type = $('landTypeSelect').value;
    const market = selected ? Number(selected.factors[type]) : NaN;
    const planning = planningFactor();
    const other = Number($('otherConditionSelect').value);
    const total = Number.isFinite(market) ? market * planning * other : NaN;

    $('assumptionBanner').innerHTML = assumptionsText();
    $('resultCoordinate').textContent = currentPoint ? `${currentPoint[0].toFixed(6)}, ${currentPoint[1].toFixed(6)}` : 'Không bóc được tọa độ';
    $('resultCommune').textContent = selected?.commune || '—';
    $('resultRoad').textContent = selected?.road || '—';
    $('resultSegment').textContent = selected ? `${selected.start} – ${selected.end}` : '—';
    $('resultLandType').textContent = landLabels[type];
    $('resultAccess').textContent = branchNote();

    $('marketFactor').textContent = Number.isFinite(market) ? fmt(market) : '—';
    $('planningFactorResult').textContent = fmt(planning);
    $('otherFactorResult').textContent = fmt(other);
    $('totalFactor').textContent = Number.isFinite(total) ? fmt(total) : '—';
    $('formulaMarket').textContent = Number.isFinite(market) ? fmt(market) : '—';
    $('formulaPlanning').textContent = fmt(planning);
    $('formulaOther').textContent = fmt(other);

    if (selected) {
      $('legalSourceText').textContent = `Quyết định 03/2026/QĐ-UBND – ${selected.source.appendix}, ${selected.source.table}.`;
      $('sourcePage').textContent = `Trang PDF: ${selected.source.pdfPage}`;
      $('sourceRecord').textContent = `Mã: ${selected.id} / ${selected.source.record}`;
    } else {
      $('legalSourceText').textContent = 'Chưa xác định được dòng dữ liệu nguồn.';
      $('sourcePage').textContent = 'Trang PDF: —';
      $('sourceRecord').textContent = 'Mã dữ liệu: —';
    }
  }

  function setConfidence(level, text) {
    const pill = $('confidenceText');
    pill.className = `status-pill ${level}`;
    pill.textContent = text;
  }

  function analyze(rawInput = $('googlePasteInput').value) {
    const raw = String(rawInput || '').trim();
    currentRaw = raw;
    selected = null;
    currentDistance = null;
    mapLoaded = false;
    $('mapFrame').src = '';
    $('mapFrame').classList.add('hidden');
    $('mapPlaceholder').classList.remove('hidden');
    $('mapPlaceholder').querySelector('strong').textContent = 'Chưa tải bản đồ';
    $('mapPlaceholder').querySelector('span').textContent = 'Bấm “Hiện bản đồ” khi cần kiểm tra.';
    $('toggleMapBtn').textContent = 'Hiện bản đồ';
    currentPoint = extractCoordinate(raw);
    const roadCandidates = roadMatches(raw);

    if (!raw) {
      setMessage('Hãy dán tọa độ, đường dẫn hoặc thông tin ghim Google Maps.', 'error');
      setConfidence('low', 'Chưa tra cứu');
      updateMapPreview();
      renderResult();
      return;
    }

    if (currentPoint && !insidePrototypeArea(currentPoint)) {
      setMessage('Tọa độ nằm ngoài vùng dữ liệu mẫu Phường Biên Hòa. Ứng dụng không tự chọn đoạn để tránh trả sai.', 'error');
      setConfidence('low', 'Ngoài vùng mẫu');
      updateMapPreview();
      renderResult();
      return;
    }

    if (currentPoint) {
      const candidates = roadCandidates.length ? roadCandidates : segments;
      const result = nearest(currentPoint, candidates);
      if (result) {
        selected = result.segment;
        currentDistance = result.distance;
        const roadMessage = roadCandidates.length
          ? 'Đã nhận diện tên đường và lọc đoạn gần nhất trong cùng tuyến.'
          : 'Không nhận diện được tên đường; đã chọn đoạn hình học gần nhất trong dữ liệu mẫu.';
        setMessage(`${roadMessage} Khoảng cách hình học ước tính ${Math.round(result.distance).toLocaleString('vi-VN')} m.`, roadCandidates.length ? 'success' : 'warning');
        setConfidence(roadCandidates.length ? 'high' : 'medium', roadCandidates.length ? 'Khá cao · nháp' : 'Cần xác nhận');
      }
    } else if (roadCandidates.length) {
      selected = roadCandidates[0];
      setMessage(`Đã lọc được ${roadCandidates.length} đoạn theo tên đường, nhưng chưa có tọa độ để chốt đúng đoạn.`, 'warning');
      setConfidence('medium', 'Thiếu tọa độ');
    } else {
      setMessage('Không bóc được tọa độ hoặc tên đường khớp dữ liệu mẫu. Hãy sao chép dòng tọa độ màu xanh trên Google Maps.', 'error');
      setConfidence('low', 'Không xác định');
    }

    updateMapPreview();
    renderResult();
  }

  function copyResult() {
    const lines = [
      'BẢO TÍN – KẾT QUẢ TRA CỨU NHÁP',
      `Tọa độ: ${$('resultCoordinate').textContent}`,
      `Địa bàn: ${$('resultCommune').textContent}`,
      `Tuyến đường: ${$('resultRoad').textContent}`,
      `Đoạn đường: ${$('resultSegment').textContent}`,
      `Loại đất: ${$('resultLandType').textContent}`,
      `Quan hệ vị trí: ${$('resultAccess').textContent}`,
      `Hệ số biến động thị trường: ${$('marketFactor').textContent}`,
      `Hệ số quy hoạch: ${$('planningFactorResult').textContent}`,
      `Yếu tố khác: ${$('otherFactorResult').textContent}`,
      `Hệ số tổng hợp: ${$('totalFactor').textContent}`,
      `${$('legalSourceText').textContent} ${$('sourcePage').textContent}`,
      'Lưu ý: dữ liệu hình học và kết quả đang ở trạng thái nháp.'
    ];
    navigator.clipboard?.writeText(lines.join('\n'))
      .then(() => $('copyMessage').textContent = 'Đã sao chép kết quả.')
      .catch(() => $('copyMessage').textContent = 'Không thể sao chép tự động; hãy dùng Ctrl+C.');
  }

  $('googlePasteInput').addEventListener('paste', event => {
    const text = event.clipboardData?.getData('text') || '';
    if (!text) return;
    event.preventDefault();
    $('googlePasteInput').value = text.trim().slice(0, 2000);
    setMessage('Đã nhận nội dung dán, đang phân tích tự động…', 'info');
    window.setTimeout(() => analyze(text), 20);
  });

  $('analyzeBtn').addEventListener('click', () => analyze());
  $('gpsBtn').addEventListener('click', () => {
    if (!navigator.geolocation) return setMessage('Trình duyệt không hỗ trợ lấy vị trí hiện tại.', 'error');
    navigator.geolocation.getCurrentPosition(position => {
      const pointText = `${position.coords.latitude.toFixed(6)}, ${position.coords.longitude.toFixed(6)}`;
      $('googlePasteInput').value = pointText;
      analyze(pointText);
    }, () => setMessage('Không lấy được vị trí hiện tại.', 'error'), {
      enableHighAccuracy: false,
      timeout: 8000,
      maximumAge: 60000
    });
  });

  $('clearBtn').addEventListener('click', () => {
    $('googlePasteInput').value = '';
    currentRaw = '';
    currentPoint = null;
    selected = null;
    setMessage('Đã xóa dữ liệu tra cứu.', 'info');
    setConfidence('low', 'Chưa tra cứu');
    updateMapPreview();
    renderResult();
  });

  $('toggleMapBtn').addEventListener('click', () => {
    if ($('mapFrame').classList.contains('hidden')) showMap();
    else hideMap();
  });

  $('openGoogleBtn').addEventListener('click', () => {
    if (!currentPoint) return;
    window.open(`https://www.google.com/maps?q=${currentPoint[0]},${currentPoint[1]}`, '_blank', 'noopener');
  });

  $('landTypeSelect').addEventListener('change', renderResult);
  $('accessTypeSelect').addEventListener('change', () => {
    $('branchWrap').classList.toggle('hidden', $('accessTypeSelect').value === 'main');
    renderResult();
  });
  $('projectModeSelect').addEventListener('change', () => {
    $('farWrap').classList.toggle('hidden', $('projectModeSelect').value !== 'far');
    renderResult();
  });
  ['farInput', 'otherConditionSelect', 'surfaceSelect', 'widthSelect', 'distanceInput'].forEach(id => {
    $(id).addEventListener(id === 'farInput' || id === 'distanceInput' ? 'input' : 'change', renderResult);
  });

  $('copyBtn').addEventListener('click', copyResult);
  $('printBtn').addEventListener('click', () => window.print());

  const modal = $('legalModal');
  $('legalTab').addEventListener('click', () => modal.classList.remove('hidden'));
  modal.querySelector('[data-close-modal]').addEventListener('click', () => modal.classList.add('hidden'));
  modal.addEventListener('click', event => { if (event.target === modal) modal.classList.add('hidden'); });

  updateMapPreview();
  renderResult();
})();
