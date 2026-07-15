(() => {
  'use strict';

  const segments = window.BAO_TIN_SEGMENTS || [];
  const $ = id => document.getElementById(id);
  const STORAGE_KEY = 'baoTinLand.savedLocations.v0.3.0';
  const ROUTE_LIMIT = 5;
  const ROAD_ALIASES = {
    'Đường Bùi Hữu Nghĩa': ['ĐT16', 'ĐT 16', 'Tỉnh lộ 16'],
    'Đường Nguyễn Ái Quốc': ['QL1K', 'Quốc lộ 1K'],
    'Đường Nguyễn Tri Phương': [],
    'Đường Nguyễn Văn Lung': [],
    'Đường Trần Văn Ơn': [],
    'Đường Hoàng Minh Chánh': []
  };

  let currentPoint = null;
  let currentRaw = '';
  let routeCandidates = [];
  let selectedCandidate = null;
  let mapLoaded = false;
  let routeDistanceOverrides = {};
  let savedLocations = loadSavedLocations();

  const fmt = value => Number(value).toLocaleString('vi-VN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });

  const fmtMeters = value => Number.isFinite(value)
    ? `${Math.round(value).toLocaleString('vi-VN')} m`
    : '—';

  const normalize = value => String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  const escapeHtml = value => String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');

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

  function aliasesForRoad(road) {
    return ROAD_ALIASES[road] || [];
  }

  function roadIsMentioned(raw, road) {
    const text = normalize(raw);
    if (!text) return false;
    const names = [road, road.replace(/^Đường\s+/i, ''), ...aliasesForRoad(road)];
    return names.some(name => {
      const normalizedName = normalize(name);
      return normalizedName.length >= 4 && text.includes(normalizedName);
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

  function distanceToSegment(point, segment) {
    let distance = Infinity;
    for (let i = 0; i < segment.geometry.length - 1; i += 1) {
      distance = Math.min(distance, pointSegmentDistance(point, segment.geometry[i], segment.geometry[i + 1]));
    }
    return distance;
  }

  function buildRouteCandidates(point, raw) {
    const grouped = new Map();
    segments.forEach(segment => {
      const distance = distanceToSegment(point, segment);
      const existing = grouped.get(segment.road);
      if (!existing || distance < existing.straightDistance) {
        grouped.set(segment.road, {
          road: segment.road,
          aliases: aliasesForRoad(segment.road),
          segment,
          straightDistance: distance,
          mentioned: roadIsMentioned(raw, segment.road)
        });
      }
    });
    return [...grouped.values()]
      .sort((a, b) => {
        if (a.mentioned !== b.mentioned) return a.mentioned ? -1 : 1;
        return a.straightDistance - b.straightDistance;
      })
      .slice(0, ROUTE_LIMIT);
  }

  function updateMapPreview() {
    const hasPoint = Array.isArray(currentPoint);
    $('toggleMapBtn').disabled = !hasPoint;
    $('openGoogleBtn').disabled = !hasPoint;
    $('saveLocationBtn').disabled = !hasPoint || routeCandidates.length === 0;
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

  function renderSelectedCandidate() {
    $('resultCoordinate').textContent = currentPoint
      ? `${currentPoint[0].toFixed(6)}, ${currentPoint[1].toFixed(6)}`
      : '—';

    if (!selectedCandidate) {
      $('assumptionBanner').innerHTML = '<strong>Chưa có tuyến để xem.</strong>';
      $('resultCommune').textContent = '—';
      $('resultRoad').textContent = '—';
      $('resultAliases').textContent = '—';
      $('resultSegment').textContent = '—';
      $('resultRoadDistance').textContent = '—';
      $('factorResidential').textContent = '—';
      $('factorCommercial').textContent = '—';
      $('factorProduction').textContent = '—';
      $('factorDistance').textContent = '—';
      $('legalSourceText').textContent = 'Chưa có kết quả.';
      $('sourcePage').textContent = 'Trang PDF: —';
      $('sourceRecord').textContent = 'Mã dữ liệu: —';
      return;
    }

    const s = selectedCandidate.segment;
    const aliases = selectedCandidate.aliases.length ? selectedCandidate.aliases.join(', ') : 'Không có tên khác trong dữ liệu mẫu';
    const manualDistance = routeDistanceOverrides[s.id];
    $('assumptionBanner').innerHTML =
      `<strong>Đang xem ${escapeHtml(selectedCandidate.road)}.</strong> ` +
      `Khoảng cách thẳng ${escapeHtml(fmtMeters(selectedCandidate.straightDistance))}` +
      `${manualDistance ? `; khoảng cách đường đi đã nhập ${escapeHtml(Number(manualDistance).toLocaleString('vi-VN'))} m` : ''}.`;
    $('resultCommune').textContent = s.commune;
    $('resultRoad').textContent = selectedCandidate.road;
    $('resultAliases').textContent = aliases;
    $('resultSegment').textContent = `${s.start} – ${s.end}`;
    $('resultRoadDistance').textContent = `${fmtMeters(selectedCandidate.straightDistance)} (ước tính)`;
    $('factorResidential').textContent = fmt(s.factors.residential);
    $('factorCommercial').textContent = fmt(s.factors.commercial);
    $('factorProduction').textContent = fmt(s.factors.production);
    $('factorDistance').textContent = fmtMeters(selectedCandidate.straightDistance);
    $('legalSourceText').textContent = `Quyết định 03/2026/QĐ-UBND – ${s.source.appendix}, ${s.source.table}.`;
    $('sourcePage').textContent = `Trang PDF: ${s.source.pdfPage}`;
    $('sourceRecord').textContent = `Mã: ${s.id} / ${s.source.record}`;
  }

  function renderRouteTable() {
    const body = $('routeTableBody');
    $('routeCount').textContent = `${routeCandidates.length} tuyến`;
    if (!routeCandidates.length) {
      body.innerHTML = '<tr><td colspan="10" class="empty-cell">Chưa có tọa độ để so sánh.</td></tr>';
      return;
    }

    body.innerHTML = routeCandidates.map((candidate, index) => {
      const s = candidate.segment;
      const aliases = candidate.aliases.length
        ? `<div class="route-alias">${escapeHtml(candidate.aliases.join(' · '))}</div>`
        : '';
      const routeDistance = routeDistanceOverrides[s.id] ?? '';
      const selectedClass = selectedCandidate?.segment.id === s.id ? ' selected-row' : '';
      return `<tr class="${selectedClass}">
        <td>${index + 1}</td>
        <td><strong>${escapeHtml(candidate.road)}</strong>${aliases}</td>
        <td>${escapeHtml(s.start)}<br><span class="muted-arrow">→ ${escapeHtml(s.end)}</span></td>
        <td><strong>${escapeHtml(fmtMeters(candidate.straightDistance))}</strong></td>
        <td><input class="route-distance-input" data-segment-id="${escapeHtml(s.id)}" type="number" min="0" step="1" inputmode="numeric" value="${escapeHtml(routeDistance)}" placeholder="Nhập mét"></td>
        <td>${escapeHtml(fmt(s.factors.residential))}</td>
        <td>${escapeHtml(fmt(s.factors.commercial))}</td>
        <td>${escapeHtml(fmt(s.factors.production))}</td>
        <td>Trang ${escapeHtml(s.source.pdfPage)}<br>${escapeHtml(s.source.record)}</td>
        <td><button class="table-button choose-route-btn" type="button" data-segment-id="${escapeHtml(s.id)}">Xem tuyến</button></td>
      </tr>`;
    }).join('');
  }

  function selectCandidate(segmentId) {
    const found = routeCandidates.find(candidate => candidate.segment.id === segmentId);
    if (!found) return;
    selectedCandidate = found;
    renderSelectedCandidate();
    renderRouteTable();
  }

  function analyze(rawInput = $('googlePasteInput').value) {
    const raw = String(rawInput || '').trim();
    currentRaw = raw;
    currentPoint = extractCoordinate(raw);
    routeCandidates = [];
    selectedCandidate = null;
    routeDistanceOverrides = {};
    mapLoaded = false;
    $('mapFrame').src = '';
    $('mapFrame').classList.add('hidden');
    $('mapPlaceholder').classList.remove('hidden');
    $('mapPlaceholder').querySelector('strong').textContent = 'Chưa tải bản đồ';
    $('mapPlaceholder').querySelector('span').textContent = 'Bấm “Hiện bản đồ” khi cần kiểm tra.';
    $('toggleMapBtn').textContent = 'Hiện bản đồ';

    if (!raw) {
      setMessage('Hãy dán tọa độ hoặc đường dẫn Google Maps.', 'error');
      $('confidenceText').className = 'status-pill low';
      $('confidenceText').textContent = 'Chưa tra cứu';
      updateMapPreview();
      renderSelectedCandidate();
      renderRouteTable();
      return;
    }

    if (!currentPoint) {
      setMessage('Không bóc được tọa độ. Hãy sao chép dòng tọa độ màu xanh trên Google Maps.', 'error');
      $('confidenceText').className = 'status-pill low';
      $('confidenceText').textContent = 'Thiếu tọa độ';
      updateMapPreview();
      renderSelectedCandidate();
      renderRouteTable();
      return;
    }

    routeCandidates = buildRouteCandidates(currentPoint, raw);
    selectedCandidate = routeCandidates[0] || null;
    const mentioned = routeCandidates.find(candidate => candidate.mentioned);
    if (mentioned) selectedCandidate = mentioned;

    if (routeCandidates.length) {
      setMessage(`Đã lập bảng so sánh ${routeCandidates.length} tuyến gần nhất trong dữ liệu hiện có. Khoảng cách đang hiển thị là khoảng cách thẳng ước tính.`, 'success');
      $('confidenceText').className = 'status-pill medium';
      $('confidenceText').textContent = 'So sánh nháp';
    } else {
      setMessage('Không có tuyến phù hợp trong dữ liệu mẫu.', 'error');
      $('confidenceText').className = 'status-pill low';
      $('confidenceText').textContent = 'Không có dữ liệu';
    }

    updateMapPreview();
    renderSelectedCandidate();
    renderRouteTable();
  }

  function copyResult() {
    if (!currentPoint || !routeCandidates.length) {
      $('copyMessage').textContent = 'Chưa có kết quả để sao chép.';
      return;
    }
    const lines = [
      'BẢO TÍN – SO SÁNH TUYẾN ĐƯỜNG NHÁP',
      `Tọa độ: ${currentPoint[0].toFixed(6)}, ${currentPoint[1].toFixed(6)}`,
      '',
      ...routeCandidates.map((candidate, index) => {
        const s = candidate.segment;
        const manual = routeDistanceOverrides[s.id];
        return `${index + 1}. ${candidate.road}${candidate.aliases.length ? ` (${candidate.aliases.join(', ')})` : ''}\n` +
          `   Đoạn: ${s.start} – ${s.end}\n` +
          `   Khoảng cách thẳng: ${fmtMeters(candidate.straightDistance)}${manual ? `; đường đi: ${Number(manual).toLocaleString('vi-VN')} m` : ''}\n` +
          `   Hệ số: đất ở ${fmt(s.factors.residential)}; TMDV ${fmt(s.factors.commercial)}; SXPNN ${fmt(s.factors.production)}\n` +
          `   Nguồn: ${s.source.appendix}, ${s.source.table}, trang ${s.source.pdfPage}, ${s.source.record}`;
      }),
      '',
      'Lưu ý: chưa kết luận vị trí pháp lý; hình học tuyến đang ở trạng thái dữ liệu mẫu.'
    ];
    navigator.clipboard?.writeText(lines.join('\n'))
      .then(() => $('copyMessage').textContent = 'Đã sao chép bảng so sánh.')
      .catch(() => $('copyMessage').textContent = 'Không thể sao chép tự động; hãy dùng Ctrl+C.');
  }

  function loadSavedLocations() {
    try {
      const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
      return Array.isArray(parsed) ? parsed : [];
    } catch (_) {
      return [];
    }
  }

  function persistSavedLocations() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(savedLocations));
  }

  function buildSavedSnapshot() {
    const now = new Date();
    const label = $('locationLabelInput').value.trim() || `Điểm ${now.toLocaleString('vi-VN')}`;
    return {
      schema_version: '1.0',
      id: globalThis.crypto?.randomUUID?.() || `loc-${Date.now()}`,
      location_id: `LOC-${Date.now()}`,
      label,
      note: $('locationNoteInput').value.trim(),
      saved_at: now.toISOString(),
      raw_input: currentRaw,
      latitude: currentPoint[0],
      longitude: currentPoint[1],
      selected_segment_id: selectedCandidate?.segment.id || null,
      selected_road: selectedCandidate?.road || null,
      legal_status: 'draft',
      market_data_status: 'empty',
      market_samples: [],
      routes: routeCandidates.map(candidate => ({
        segment_id: candidate.segment.id,
        commune: candidate.segment.commune,
        road: candidate.road,
        aliases: candidate.aliases,
        start: candidate.segment.start,
        end: candidate.segment.end,
        straight_distance_m: Math.round(candidate.straightDistance),
        route_distance_m: routeDistanceOverrides[candidate.segment.id]
          ? Number(routeDistanceOverrides[candidate.segment.id])
          : null,
        factors: { ...candidate.segment.factors },
        source: { ...candidate.segment.source }
      }))
    };
  }

  function saveCurrentLocation() {
    if (!currentPoint || !routeCandidates.length) {
      $('savedMessage').textContent = 'Chưa có kết quả để lưu.';
      return;
    }
    const snapshot = buildSavedSnapshot();
    savedLocations.unshift(snapshot);
    persistSavedLocations();
    renderSavedLocations();
    $('savedMessage').textContent = `Đã lưu “${snapshot.label}”.`;
    $('locationLabelInput').value = '';
    $('locationNoteInput').value = '';
    $('savedCard').open = true;
  }

  function renderSavedLocations() {
    $('savedCount').textContent = `${savedLocations.length} điểm`;
    const body = $('savedTableBody');
    if (!savedLocations.length) {
      body.innerHTML = '<tr><td colspan="6" class="empty-cell">Chưa có điểm đã lưu.</td></tr>';
      return;
    }
    body.innerHTML = savedLocations.map(item => `
      <tr>
        <td><strong>${escapeHtml(item.label)}</strong>${item.note ? `<div class="route-alias">${escapeHtml(item.note)}</div>` : ''}</td>
        <td>${Number(item.latitude).toFixed(6)}, ${Number(item.longitude).toFixed(6)}</td>
        <td>${escapeHtml(item.selected_road || '—')}</td>
        <td>${Array.isArray(item.routes) ? item.routes.length : 0}</td>
        <td>${escapeHtml(new Date(item.saved_at).toLocaleString('vi-VN'))}</td>
        <td class="saved-actions-cell">
          <button class="table-button load-saved-btn" type="button" data-id="${escapeHtml(item.id)}">Nạp lại</button>
          <button class="table-button danger-button delete-saved-btn" type="button" data-id="${escapeHtml(item.id)}">Xóa</button>
        </td>
      </tr>`).join('');
  }

  function loadSavedLocation(id) {
    const item = savedLocations.find(record => record.id === id);
    if (!item) return;
    const coordinate = `${Number(item.latitude).toFixed(6)}, ${Number(item.longitude).toFixed(6)}`;
    $('googlePasteInput').value = coordinate;
    analyze(coordinate);
    routeDistanceOverrides = {};
    (item.routes || []).forEach(route => {
      if (route.route_distance_m != null) routeDistanceOverrides[route.segment_id] = route.route_distance_m;
    });
    if (item.selected_segment_id) selectCandidate(item.selected_segment_id);
    renderRouteTable();
    renderSelectedCandidate();
    $('savedMessage').textContent = `Đã nạp lại “${item.label}”.`;
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function deleteSavedLocation(id) {
    savedLocations = savedLocations.filter(item => item.id !== id);
    persistSavedLocations();
    renderSavedLocations();
    $('savedMessage').textContent = 'Đã xóa điểm đã lưu.';
  }

  function exportSavedLocations() {
    const payload = {
      exported_at: new Date().toISOString(),
      app_version: 'V0.3.0',
      records: savedLocations
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `Bao_Tin_Diem_Tra_Cuu_${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
    $('savedMessage').textContent = `Đã xuất ${savedLocations.length} điểm.`;
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
      const text = `${position.coords.latitude.toFixed(6)}, ${position.coords.longitude.toFixed(6)}`;
      $('googlePasteInput').value = text;
      analyze(text);
    }, () => setMessage('Không lấy được vị trí hiện tại.', 'error'), {
      enableHighAccuracy: false,
      timeout: 8000,
      maximumAge: 60000
    });
  });

  $('clearBtn').addEventListener('click', () => {
    $('googlePasteInput').value = '';
    currentPoint = null;
    currentRaw = '';
    routeCandidates = [];
    selectedCandidate = null;
    routeDistanceOverrides = {};
    setMessage('Đã xóa dữ liệu tra cứu.', 'info');
    $('confidenceText').className = 'status-pill low';
    $('confidenceText').textContent = 'Chưa tra cứu';
    updateMapPreview();
    renderSelectedCandidate();
    renderRouteTable();
  });

  $('routeTableBody').addEventListener('click', event => {
    const button = event.target.closest('.choose-route-btn');
    if (button) selectCandidate(button.dataset.segmentId);
  });

  $('routeTableBody').addEventListener('input', event => {
    const input = event.target.closest('.route-distance-input');
    if (!input) return;
    const value = input.value.trim();
    if (value === '') delete routeDistanceOverrides[input.dataset.segmentId];
    else routeDistanceOverrides[input.dataset.segmentId] = Number(value);
    renderSelectedCandidate();
  });

  $('toggleMapBtn').addEventListener('click', () => {
    if ($('mapFrame').classList.contains('hidden')) showMap();
    else hideMap();
  });

  $('openGoogleBtn').addEventListener('click', () => {
    if (!currentPoint) return;
    window.open(`https://www.google.com/maps?q=${currentPoint[0]},${currentPoint[1]}`, '_blank', 'noopener');
  });

  $('copyBtn').addEventListener('click', copyResult);
  $('printBtn').addEventListener('click', () => window.print());
  $('saveLocationBtn').addEventListener('click', saveCurrentLocation);
  $('exportSavedBtn').addEventListener('click', exportSavedLocations);
  $('clearSavedBtn').addEventListener('click', () => {
    if (!savedLocations.length) return;
    if (!window.confirm('Xóa toàn bộ điểm tra cứu đã lưu trên máy này?')) return;
    savedLocations = [];
    persistSavedLocations();
    renderSavedLocations();
    $('savedMessage').textContent = 'Đã xóa toàn bộ điểm đã lưu.';
  });

  $('savedTableBody').addEventListener('click', event => {
    const loadButton = event.target.closest('.load-saved-btn');
    const deleteButton = event.target.closest('.delete-saved-btn');
    if (loadButton) loadSavedLocation(loadButton.dataset.id);
    if (deleteButton) deleteSavedLocation(deleteButton.dataset.id);
  });

  const modal = $('legalModal');
  $('legalTab').addEventListener('click', () => modal.classList.remove('hidden'));
  modal.querySelector('[data-close-modal]').addEventListener('click', () => modal.classList.add('hidden'));
  modal.addEventListener('click', event => { if (event.target === modal) modal.classList.add('hidden'); });

  updateMapPreview();
  renderSelectedCandidate();
  renderRouteTable();
  renderSavedLocations();
})();
