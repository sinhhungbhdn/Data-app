(() => {
  'use strict';

  const segments = window.BAO_TIN_SEGMENTS || [];
  const $ = id => document.getElementById(id);
  const STORAGE_KEY = 'baoTinLand.savedLocations.v0.3.2';
  const SLOT_COUNT = 3;

  const ROAD_ALIASES = {
    'Đường Bùi Hữu Nghĩa': ['ĐT16', 'ĐT 16', 'Tỉnh lộ 16', 'Tỉnh lộ 16B'],
    'Đường Nguyễn Ái Quốc': ['QL1K', 'Quốc lộ 1K'],
    'Đường Nguyễn Tri Phương': [],
    'Đường Nguyễn Văn Lung': [],
    'Đường Trần Văn Ơn': [],
    'Đường Hoàng Minh Chánh': []
  };

  let rawInput = '';
  let coordinate = null;
  let addressText = '';
  let mapLoaded = false;
  let routeSlots = Array.from({ length: SLOT_COUNT }, () => ({ road: '', segmentId: '', distance: '' }));
  let savedLocations = loadSavedLocations();

  const fmt = value => Number(value).toLocaleString('vi-VN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });

  const escapeHtml = value => String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');

  const normalize = value => String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  function uniqueRoads() {
    return [...new Set(segments.map(item => item.road))].sort((a, b) => a.localeCompare(b, 'vi'));
  }

  function segmentsForRoad(road) {
    return segments.filter(item => item.road === road);
  }

  function segmentById(id) {
    return segments.find(item => item.id === id) || null;
  }

  function extractCoordinate(raw) {
    let text = String(raw || '').trim();
    try { text = decodeURIComponent(text); } catch (_) {}
    const patterns = [
      /@(-?\d{1,3}(?:\.\d+)?),\s*(-?\d{1,3}(?:\.\d+)?)/i,
      /[?&](?:q|query|ll|center|destination)=(-?\d{1,3}(?:\.\d+)?)(?:,|%2C|\s)(-?\d{1,3}(?:\.\d+)?)/i,
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

  function extractAddress(raw) {
    const original = String(raw || '').trim();
    if (!original) return '';
    const withoutCoordinate = original
      .replace(/@-?\d{1,3}(?:\.\d+)?,\s*-?\d{1,3}(?:\.\d+)?[^\s]*/gi, ' ')
      .replace(/\(?-?\d{1,3}\.\d{4,}\s*[,;]\s*-?\d{1,3}\.\d{4,}\)?/gi, ' ')
      .trim();

    try {
      const url = new URL(original);
      const query = url.searchParams.get('q') || url.searchParams.get('query') ||
        url.searchParams.get('destination') || url.searchParams.get('daddr');
      if (query && !extractCoordinate(query)) return decodeURIComponent(query.replace(/\+/g, ' '));
      const placeMatch = url.pathname.match(/\/place\/([^/]+)/i);
      if (placeMatch) return decodeURIComponent(placeMatch[1].replace(/\+/g, ' '));
    } catch (_) {}

    if (/^https?:\/\//i.test(withoutCoordinate)) return '';
    return withoutCoordinate.replace(/\s+/g, ' ').trim();
  }

  function locationQuery() {
    if (coordinate) return `${coordinate[0]},${coordinate[1]}`;
    return addressText || rawInput;
  }

  function setMessage(text, type = 'info') {
    $('searchMessage').textContent = text;
    $('searchMessage').dataset.type = type;
  }

  function resetMap() {
    mapLoaded = false;
    $('mapFrame').src = '';
    $('mapFrame').classList.add('hidden');
    $('mapPlaceholder').classList.remove('hidden');
    $('mapPlaceholder').querySelector('strong').textContent = 'Chưa tải bản đồ';
    $('mapPlaceholder').querySelector('span').textContent = 'Bấm “Hiện bản đồ” khi cần xem.';
    $('toggleMapBtn').textContent = 'Hiện bản đồ';
  }

  function updateLocationView() {
    const hasLocation = Boolean(locationQuery());
    $('toggleMapBtn').disabled = !hasLocation;
    $('openGoogleBtn').disabled = !hasLocation;
    $('saveLocationBtn').disabled = !hasLocation;
    $('resultInput').textContent = rawInput || '—';
    $('resultCoordinate').textContent = coordinate
      ? `${coordinate[0].toFixed(6)}, ${coordinate[1].toFixed(6)}`
      : 'Không có trong nội dung dán';
    $('resultAddress').textContent = addressText || 'Không có trong nội dung dán';
    $('mapQueryText').textContent = hasLocation ? `Vị trí: ${locationQuery()}` : 'Vị trí: —';
    $('locationStatus').className = `status-pill ${hasLocation ? 'high' : 'low'}`;
    $('locationStatus').textContent = hasLocation ? 'Đã nạp' : 'Chưa nạp';
  }

  function suggestedRoadsFromInput(raw) {
    const text = normalize(raw);
    if (!text) return [];
    return uniqueRoads().filter(road => {
      const names = [road, road.replace(/^Đường\s+/i, ''), ...(ROAD_ALIASES[road] || [])];
      return names.some(name => {
        const token = normalize(name);
        return token.length >= 4 && text.includes(token);
      });
    });
  }

  function loadLocation(value = $('googlePasteInput').value) {
    rawInput = String(value || '').trim();
    coordinate = extractCoordinate(rawInput);
    addressText = extractAddress(rawInput);
    resetMap();

    if (!rawInput) {
      setMessage('Hãy dán tọa độ, địa chỉ hoặc link Google Maps.', 'error');
      updateLocationView();
      return;
    }

    const suggestions = suggestedRoadsFromInput(rawInput);
    suggestions.slice(0, SLOT_COUNT).forEach((road, index) => {
      const first = segmentsForRoad(road)[0];
      routeSlots[index] = { road, segmentId: first?.id || '', distance: routeSlots[index].distance || '' };
    });

    if (coordinate && addressText) setMessage('Đã nạp tọa độ và địa chỉ. Không gọi dịch vụ dò đường.', 'success');
    else if (coordinate) setMessage('Đã nạp tọa độ. Mở bản đồ rồi chọn 2–3 tuyến cần so sánh.', 'success');
    else setMessage('Đã nạp địa chỉ/tên điểm. Bản đồ sẽ tìm theo nội dung này; không cần tọa độ.', 'success');

    updateLocationView();
    renderRouteSlots();
  }

  function showMap() {
    const query = locationQuery();
    if (!query) return;
    if (!mapLoaded) {
      $('mapFrame').src = `https://maps.google.com/maps?q=${encodeURIComponent(query)}&z=17&output=embed`;
      mapLoaded = true;
    }
    $('mapFrame').classList.remove('hidden');
    $('mapPlaceholder').classList.add('hidden');
    $('toggleMapBtn').textContent = 'Ẩn bản đồ';
  }

  function hideMap() {
    $('mapFrame').classList.add('hidden');
    $('mapPlaceholder').classList.remove('hidden');
    $('mapPlaceholder').querySelector('strong').textContent = 'Bản đồ đang ẩn';
    $('mapPlaceholder').querySelector('span').textContent = 'Bấm “Hiện bản đồ” khi cần xem.';
    $('toggleMapBtn').textContent = 'Hiện bản đồ';
  }

  function routeOptions(selectedRoad) {
    return ['<option value="">— Chọn tuyến —</option>', ...uniqueRoads().map(road =>
      `<option value="${escapeHtml(road)}"${road === selectedRoad ? ' selected' : ''}>${escapeHtml(road)}</option>`
    )].join('');
  }

  function segmentOptions(road, selectedId) {
    if (!road) return '<option value="">— Chọn tuyến trước —</option>';
    return segmentsForRoad(road).map(segment =>
      `<option value="${escapeHtml(segment.id)}"${segment.id === selectedId ? ' selected' : ''}>${escapeHtml(segment.start)} → ${escapeHtml(segment.end)}</option>`
    ).join('');
  }

  function routeCard(slot, index) {
    const segment = segmentById(slot.segmentId);
    const aliases = slot.road && (ROAD_ALIASES[slot.road] || []).length
      ? (ROAD_ALIASES[slot.road] || []).join(' · ')
      : '—';
    const source = segment
      ? `${segment.source.appendix}, ${segment.source.table}, trang ${segment.source.pdfPage}, ${segment.source.record}`
      : '—';
    return `<article class="manual-route-card${segment ? ' active' : ''}" data-slot="${index}">
      <div class="manual-route-head"><span class="route-number">${index + 1}</span><strong>Phương án tuyến ${index + 1}</strong><button class="text-button clear-route-btn" type="button" data-slot="${index}">Xóa tuyến</button></div>
      <div class="manual-route-fields">
        <div><label>Tuyến trong Quyết định</label><select class="road-select" data-slot="${index}">${routeOptions(slot.road)}</select></div>
        <div><label>Đoạn đường</label><select class="segment-select" data-slot="${index}">${segmentOptions(slot.road, slot.segmentId)}</select></div>
        <div><label>Khoảng cách đo trên Google Maps (m)</label><input class="distance-input" data-slot="${index}" type="number" min="0" step="1" inputmode="numeric" value="${escapeHtml(slot.distance)}" placeholder="Ví dụ: 197"></div>
      </div>
      <div class="manual-route-meta"><span><b>Tên khác:</b> ${escapeHtml(aliases)}</span><span><b>Nguồn:</b> ${escapeHtml(source)}</span></div>
      <div class="manual-factor-grid">
        <div><span>HS đất ở</span><strong>${segment ? fmt(segment.factors.residential) : '—'}</strong></div>
        <div><span>HS TMDV</span><strong>${segment ? fmt(segment.factors.commercial) : '—'}</strong></div>
        <div><span>HS SXPNN</span><strong>${segment ? fmt(segment.factors.production) : '—'}</strong></div>
        <div><span>Khoảng cách</span><strong>${slot.distance !== '' ? `${Number(slot.distance).toLocaleString('vi-VN')} m` : 'Chưa nhập'}</strong></div>
      </div>
    </article>`;
  }

  function renderRouteSlots() {
    $('manualRouteGrid').innerHTML = routeSlots.map(routeCard).join('');
    const count = routeSlots.filter(slot => segmentById(slot.segmentId)).length;
    $('selectedCount').textContent = `${count} tuyến`;
  }

  function selectedRoutes() {
    return routeSlots.map(slot => ({ slot, segment: segmentById(slot.segmentId) })).filter(item => item.segment);
  }

  function copyResult() {
    if (!locationQuery()) {
      $('copyMessage').textContent = 'Chưa nạp vị trí.';
      return;
    }
    const routes = selectedRoutes();
    const lines = [
      'BẢO TÍN – KẾT QUẢ SO SÁNH TUYẾN NHÁP',
      `Vị trí: ${locationQuery()}`,
      coordinate ? `Tọa độ: ${coordinate[0].toFixed(6)}, ${coordinate[1].toFixed(6)}` : '',
      addressText ? `Địa chỉ/tên điểm: ${addressText}` : '',
      '',
      ...(routes.length ? routes.map((item, index) => {
        const { slot, segment } = item;
        return `${index + 1}. ${segment.road}\n` +
          `   Đoạn: ${segment.start} – ${segment.end}\n` +
          `   Khoảng cách đo: ${slot.distance !== '' ? `${Number(slot.distance).toLocaleString('vi-VN')} m` : 'Chưa nhập'}\n` +
          `   Hệ số: đất ở ${fmt(segment.factors.residential)}; TMDV ${fmt(segment.factors.commercial)}; SXPNN ${fmt(segment.factors.production)}\n` +
          `   Nguồn: ${segment.source.appendix}, ${segment.source.table}, trang ${segment.source.pdfPage}, ${segment.source.record}`;
      }) : ['Chưa chọn tuyến.']),
      '',
      'Lưu ý: khoảng cách do người dùng đo trên Google Maps; app không tự dò mạng đường.'
    ].filter(Boolean);
    navigator.clipboard?.writeText(lines.join('\n'))
      .then(() => $('copyMessage').textContent = 'Đã sao chép kết quả.')
      .catch(() => $('copyMessage').textContent = 'Không thể sao chép tự động; hãy dùng Ctrl+C.');
  }

  function loadSavedLocations() {
    try {
      const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
      return Array.isArray(parsed) ? parsed : [];
    } catch (_) { return []; }
  }

  function persistSavedLocations() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(savedLocations));
  }

  function saveCurrentLocation() {
    if (!locationQuery()) {
      $('savedMessage').textContent = 'Chưa nạp vị trí.';
      return;
    }
    const now = new Date();
    const record = {
      schema_version: '1.2',
      id: globalThis.crypto?.randomUUID?.() || `loc-${Date.now()}`,
      label: $('locationLabelInput').value.trim() || `Điểm ${now.toLocaleString('vi-VN')}`,
      note: $('locationNoteInput').value.trim(),
      saved_at: now.toISOString(),
      raw_input: rawInput,
      latitude: coordinate?.[0] ?? null,
      longitude: coordinate?.[1] ?? null,
      address: addressText || null,
      routes: selectedRoutes().map(({ slot, segment }) => ({
        road: segment.road,
        segment_id: segment.id,
        start: segment.start,
        end: segment.end,
        measured_distance_m: slot.distance === '' ? null : Number(slot.distance),
        factors: { ...segment.factors },
        source: { ...segment.source }
      })),
      market_data_status: 'empty',
      market_samples: []
    };
    savedLocations.unshift(record);
    persistSavedLocations();
    renderSavedLocations();
    $('savedMessage').textContent = `Đã lưu “${record.label}”.`;
    $('locationLabelInput').value = '';
    $('locationNoteInput').value = '';
    $('savedCard').open = true;
  }

  function renderSavedLocations() {
    $('savedCount').textContent = `${savedLocations.length} điểm`;
    const body = $('savedTableBody');
    if (!savedLocations.length) {
      body.innerHTML = '<tr><td colspan="5" class="empty-cell">Chưa có điểm đã lưu.</td></tr>';
      return;
    }
    body.innerHTML = savedLocations.map(item => {
      const location = item.latitude != null && item.longitude != null
        ? `${Number(item.latitude).toFixed(6)}, ${Number(item.longitude).toFixed(6)}`
        : (item.address || item.raw_input || '—');
      return `<tr>
        <td><strong>${escapeHtml(item.label)}</strong>${item.note ? `<div class="route-alias">${escapeHtml(item.note)}</div>` : ''}</td>
        <td>${escapeHtml(location)}</td>
        <td>${Array.isArray(item.routes) ? item.routes.length : 0}</td>
        <td>${escapeHtml(new Date(item.saved_at).toLocaleString('vi-VN'))}</td>
        <td class="saved-actions-cell"><button class="table-button load-saved-btn" type="button" data-id="${escapeHtml(item.id)}">Nạp lại</button><button class="table-button danger-button delete-saved-btn" type="button" data-id="${escapeHtml(item.id)}">Xóa</button></td>
      </tr>`;
    }).join('');
  }

  function loadSavedLocation(id) {
    const item = savedLocations.find(record => record.id === id);
    if (!item) return;
    $('googlePasteInput').value = item.raw_input || item.address || '';
    loadLocation($('googlePasteInput').value);
    routeSlots = Array.from({ length: SLOT_COUNT }, (_, index) => {
      const saved = item.routes?.[index];
      return saved
        ? { road: saved.road, segmentId: saved.segment_id, distance: saved.measured_distance_m ?? '' }
        : { road: '', segmentId: '', distance: '' };
    });
    renderRouteSlots();
    $('savedMessage').textContent = `Đã nạp lại “${item.label}”.`;
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function exportSavedLocations() {
    const payload = { exported_at: new Date().toISOString(), app_version: 'V0.3.2', records: savedLocations };
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
    window.setTimeout(() => loadLocation(text), 20);
  });

  $('loadLocationBtn').addEventListener('click', () => loadLocation());
  $('gpsBtn').addEventListener('click', () => {
    if (!navigator.geolocation) return setMessage('Trình duyệt không hỗ trợ lấy vị trí hiện tại.', 'error');
    navigator.geolocation.getCurrentPosition(position => {
      const text = `${position.coords.latitude.toFixed(6)}, ${position.coords.longitude.toFixed(6)}`;
      $('googlePasteInput').value = text;
      loadLocation(text);
    }, () => setMessage('Không lấy được vị trí hiện tại.', 'error'), {
      enableHighAccuracy: false,
      timeout: 8000,
      maximumAge: 60000
    });
  });

  $('clearBtn').addEventListener('click', () => {
    $('googlePasteInput').value = '';
    rawInput = '';
    coordinate = null;
    addressText = '';
    routeSlots = Array.from({ length: SLOT_COUNT }, () => ({ road: '', segmentId: '', distance: '' }));
    resetMap();
    updateLocationView();
    renderRouteSlots();
    setMessage('Đã xóa dữ liệu tra cứu.', 'info');
  });

  $('toggleMapBtn').addEventListener('click', () => {
    if ($('mapFrame').classList.contains('hidden')) showMap(); else hideMap();
  });

  $('openGoogleBtn').addEventListener('click', () => {
    const query = locationQuery();
    if (query) window.open(`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`, '_blank', 'noopener');
  });

  $('manualRouteGrid').addEventListener('change', event => {
    const slotIndex = Number(event.target.dataset.slot);
    if (!Number.isInteger(slotIndex) || !routeSlots[slotIndex]) return;
    if (event.target.classList.contains('road-select')) {
      const road = event.target.value;
      const first = segmentsForRoad(road)[0];
      routeSlots[slotIndex] = { road, segmentId: first?.id || '', distance: routeSlots[slotIndex].distance };
      renderRouteSlots();
    }
    if (event.target.classList.contains('segment-select')) {
      routeSlots[slotIndex].segmentId = event.target.value;
      renderRouteSlots();
    }
  });

  $('manualRouteGrid').addEventListener('input', event => {
    if (!event.target.classList.contains('distance-input')) return;
    const slotIndex = Number(event.target.dataset.slot);
    if (!Number.isInteger(slotIndex) || !routeSlots[slotIndex]) return;
    routeSlots[slotIndex].distance = event.target.value;
    const card = event.target.closest('.manual-route-card');
    const strong = card?.querySelector('.manual-factor-grid>div:last-child strong');
    if (strong) strong.textContent = event.target.value === '' ? 'Chưa nhập' : `${Number(event.target.value).toLocaleString('vi-VN')} m`;
  });

  $('manualRouteGrid').addEventListener('click', event => {
    const button = event.target.closest('.clear-route-btn');
    if (!button) return;
    const slotIndex = Number(button.dataset.slot);
    routeSlots[slotIndex] = { road: '', segmentId: '', distance: '' };
    renderRouteSlots();
  });

  $('copyBtn').addEventListener('click', copyResult);
  $('printBtn').addEventListener('click', () => window.print());
  $('saveLocationBtn').addEventListener('click', saveCurrentLocation);
  $('exportSavedBtn').addEventListener('click', exportSavedLocations);
  $('clearSavedBtn').addEventListener('click', () => {
    if (!savedLocations.length || !window.confirm('Xóa toàn bộ điểm đã lưu trên máy này?')) return;
    savedLocations = [];
    persistSavedLocations();
    renderSavedLocations();
    $('savedMessage').textContent = 'Đã xóa toàn bộ điểm đã lưu.';
  });

  $('savedTableBody').addEventListener('click', event => {
    const loadButton = event.target.closest('.load-saved-btn');
    const deleteButton = event.target.closest('.delete-saved-btn');
    if (loadButton) loadSavedLocation(loadButton.dataset.id);
    if (deleteButton) {
      savedLocations = savedLocations.filter(item => item.id !== deleteButton.dataset.id);
      persistSavedLocations();
      renderSavedLocations();
      $('savedMessage').textContent = 'Đã xóa điểm đã lưu.';
    }
  });

  const modal = $('legalModal');
  $('legalTab').addEventListener('click', () => modal.classList.remove('hidden'));
  modal.querySelector('[data-close-modal]').addEventListener('click', () => modal.classList.add('hidden'));
  modal.addEventListener('click', event => { if (event.target === modal) modal.classList.add('hidden'); });

  resetMap();
  updateLocationView();
  renderRouteSlots();
  renderSavedLocations();
})();
