(() => {
  'use strict';

  const segments = window.BAO_TIN_SEGMENTS || [];
  const $ = id => document.getElementById(id);
  const STORAGE_KEY = 'baoTinLand.savedLocations.v0.3.1';
  const ACCESS_LIMIT = 3;
  const LEGAL_LIMIT = 3;
  const ACCESS_RADIUS_M = 350;
  const LEGAL_RADIUS_M = 3500;
  const OVERPASS_ENDPOINTS = [
    'https://overpass-api.de/api/interpreter',
    'https://overpass.kumi.systems/api/interpreter'
  ];
  const OSRM_ENDPOINT = 'https://router.project-osrm.org/route/v1/driving';

  const ROAD_ALIASES = {
    'Đường Bùi Hữu Nghĩa': ['ĐT16', 'ĐT 16', 'Tỉnh lộ 16', 'Tỉnh lộ 16B'],
    'Đường Nguyễn Ái Quốc': ['QL1K', 'Quốc lộ 1K'],
    'Đường Nguyễn Tri Phương': [],
    'Đường Nguyễn Văn Lung': [],
    'Đường Trần Văn Ơn': [],
    'Đường Hoàng Minh Chánh': []
  };

  let currentPoint = null;
  let currentRaw = '';
  let accessRoads = [];
  let legalRoutes = [];
  let selectedRoute = null;
  let mapLoaded = false;
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
    try { text = decodeURIComponent(text); } catch (_) {}
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

  function projectPointToSegment(point, a, b) {
    const refLat = point[0] * Math.PI / 180;
    const scaleX = 111320 * Math.cos(refLat);
    const scaleY = 111320;
    const px = point[1] * scaleX, py = point[0] * scaleY;
    const ax = a[1] * scaleX, ay = a[0] * scaleY;
    const bx = b[1] * scaleX, by = b[0] * scaleY;
    const dx = bx - ax, dy = by - ay;
    const den = dx * dx + dy * dy || 1;
    const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / den));
    const x = ax + t * dx, y = ay + t * dy;
    return {
      distance: Math.hypot(px - x, py - y),
      point: [y / scaleY, x / scaleX]
    };
  }

  function nearestOnGeometry(point, geometry) {
    let best = { distance: Infinity, point: null };
    for (let i = 0; i < geometry.length - 1; i += 1) {
      const projected = projectPointToSegment(point, geometry[i], geometry[i + 1]);
      if (projected.distance < best.distance) best = projected;
    }
    return best;
  }

  function wayGeometry(element) {
    return Array.isArray(element.geometry)
      ? element.geometry.map(node => [Number(node.lat), Number(node.lon)]).filter(p => Number.isFinite(p[0]) && Number.isFinite(p[1]))
      : [];
  }

  function wayNames(tags = {}) {
    return [
      tags.name, tags.ref, tags.alt_name, tags.official_name,
      tags.old_name, tags.short_name, tags['name:vi']
    ].filter(Boolean).flatMap(value => String(value).split(';')).map(value => value.trim()).filter(Boolean);
  }

  function displayWayName(element) {
    const tags = element.tags || {};
    return tags.name || tags.ref || tags.official_name || tags.alt_name ||
      `Đường/hẻm không tên (${tags.highway || 'road'} #${element.id})`;
  }

  function legalCatalog() {
    const grouped = new Map();
    segments.forEach(segment => {
      if (!grouped.has(segment.road)) {
        grouped.set(segment.road, {
          road: segment.road,
          aliases: ROAD_ALIASES[segment.road] || [],
          segments: [],
          factors: { residential: new Set(), commercial: new Set(), production: new Set() },
          pages: new Set(),
          records: new Set()
        });
      }
      const item = grouped.get(segment.road);
      item.segments.push(segment);
      item.factors.residential.add(Number(segment.factors.residential));
      item.factors.commercial.add(Number(segment.factors.commercial));
      item.factors.production.add(Number(segment.factors.production));
      item.pages.add(segment.source.pdfPage);
      item.records.add(segment.source.record);
    });
    return [...grouped.values()];
  }

  function roadMatchesCatalog(names, legalRoad) {
    const tokens = [legalRoad.road, legalRoad.road.replace(/^Đường\s+/i, ''), ...legalRoad.aliases]
      .map(normalize).filter(Boolean);
    const actual = names.map(normalize).filter(Boolean);
    return actual.some(name => tokens.some(token =>
      name === token || name.includes(token) || token.includes(name)
    ));
  }

  async function fetchOverpass(query) {
    let lastError = null;
    for (const endpoint of OVERPASS_ENDPOINTS) {
      try {
        const response = await fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' },
          body: `data=${encodeURIComponent(query)}`
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return await response.json();
      } catch (error) {
        lastError = error;
      }
    }
    throw lastError || new Error('Không tải được dữ liệu mạng đường.');
  }

  async function fetchAccessWays(point) {
    const [lat, lon] = point;
    const query = `[out:json][timeout:20];way(around:${ACCESS_RADIUS_M},${lat},${lon})["highway"];out tags geom;`;
    const data = await fetchOverpass(query);
    return Array.isArray(data.elements) ? data.elements.filter(e => e.type === 'way' && wayGeometry(e).length >= 2) : [];
  }

  async function fetchLegalWays(point) {
    const [lat, lon] = point;
    const query = `[out:json][timeout:25];(way(around:${LEGAL_RADIUS_M},${lat},${lon})["highway"]["name"];way(around:${LEGAL_RADIUS_M},${lat},${lon})["highway"]["ref"];);out tags geom;`;
    const data = await fetchOverpass(query);
    return Array.isArray(data.elements) ? data.elements.filter(e => e.type === 'way' && wayGeometry(e).length >= 2) : [];
  }

  function buildAccessRoads(point, ways) {
    const grouped = new Map();
    ways.forEach(way => {
      const geometry = wayGeometry(way);
      const nearest = nearestOnGeometry(point, geometry);
      const names = wayNames(way.tags);
      const label = displayWayName(way);
      const key = names.length ? normalize(names[0]) : `unnamed-${way.id}`;
      const candidate = {
        wayId: way.id,
        label,
        names,
        tags: way.tags || {},
        nearestPoint: nearest.point,
        distance: nearest.distance
      };
      const existing = grouped.get(key);
      if (!existing || candidate.distance < existing.distance) grouped.set(key, candidate);
    });
    return [...grouped.values()].sort((a, b) => a.distance - b.distance).slice(0, ACCESS_LIMIT);
  }

  function buildLegalAxisTargets(point, ways) {
    const catalog = legalCatalog();
    return catalog.map(legalRoad => {
      const matchedWays = ways.filter(way => roadMatchesCatalog(wayNames(way.tags), legalRoad));
      let nearest = { distance: Infinity, point: null, names: [] };
      matchedWays.forEach(way => {
        const projected = nearestOnGeometry(point, wayGeometry(way));
        if (projected.distance < nearest.distance) {
          nearest = { ...projected, names: wayNames(way.tags), wayId: way.id };
        }
      });
      if (!nearest.point) return null;
      return { ...legalRoad, mapNames: nearest.names, targetPoint: nearest.point, straightDistance: nearest.distance };
    }).filter(Boolean);
  }

  function directDistance(a, b) {
    const refLat = ((a[0] + b[0]) / 2) * Math.PI / 180;
    const dy = (a[0] - b[0]) * 111320;
    const dx = (a[1] - b[1]) * 111320 * Math.cos(refLat);
    return Math.hypot(dx, dy);
  }

  async function routeDistance(point, target) {
    const url = `${OSRM_ENDPOINT}/${point[1]},${point[0]};${target[1]},${target[0]}?overview=false&steps=false&alternatives=false`;
    try {
      const response = await fetch(url);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json();
      const distance = Number(data?.routes?.[0]?.distance);
      if (!Number.isFinite(distance)) throw new Error('Không có tuyến.');
      return { distance, method: 'Định tuyến theo mạng đường' };
    } catch (_) {
      return { distance: directDistance(point, target), method: 'Khoảng cách thẳng dự phòng' };
    }
  }

  function factorValue(set) {
    const values = [...set].filter(Number.isFinite);
    if (!values.length) return '—';
    if (values.length === 1) return fmt(values[0]);
    return `${Math.min(...values).toLocaleString('vi-VN', { minimumFractionDigits: 2 })}–${Math.max(...values).toLocaleString('vi-VN', { minimumFractionDigits: 2 })}`;
  }

  async function buildLegalRoutes(point, legalWays) {
    const targets = buildLegalAxisTargets(point, legalWays)
      .sort((a, b) => a.straightDistance - b.straightDistance)
      .slice(0, Math.max(LEGAL_LIMIT * 2, LEGAL_LIMIT));
    const routed = [];
    for (const target of targets) {
      const route = await routeDistance(point, target.targetPoint);
      routed.push({ ...target, routeDistance: route.distance, routeMethod: route.method });
    }
    return routed.sort((a, b) => a.routeDistance - b.routeDistance).slice(0, LEGAL_LIMIT);
  }

  function resetMap() {
    mapLoaded = false;
    $('mapFrame').src = '';
    $('mapFrame').classList.add('hidden');
    $('mapPlaceholder').classList.remove('hidden');
    $('mapPlaceholder').querySelector('strong').textContent = 'Chưa tải bản đồ';
    $('mapPlaceholder').querySelector('span').textContent = 'Bấm “Hiện bản đồ” khi cần kiểm tra.';
    $('toggleMapBtn').textContent = 'Hiện bản đồ';
  }

  function updateMapPreview() {
    const hasPoint = Array.isArray(currentPoint);
    $('toggleMapBtn').disabled = !hasPoint;
    $('openGoogleBtn').disabled = !hasPoint;
    $('saveLocationBtn').disabled = !hasPoint || !accessRoads.length;
    $('mapCoordinate').textContent = hasPoint
      ? `Tọa độ: ${currentPoint[0].toFixed(6)}, ${currentPoint[1].toFixed(6)}`
      : 'Tọa độ: —';
  }

  function showMap() {
    if (!currentPoint) return;
    if (!mapLoaded) {
      $('mapFrame').src = `https://maps.google.com/maps?q=${currentPoint[0]},${currentPoint[1]}&z=17&output=embed`;
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
    $('mapPlaceholder').querySelector('span').textContent = 'Bấm “Hiện bản đồ” khi cần kiểm tra.';
    $('toggleMapBtn').textContent = 'Hiện bản đồ';
  }

  function renderAccessRoads() {
    $('resultCoordinate').textContent = currentPoint
      ? `${currentPoint[0].toFixed(6)}, ${currentPoint[1].toFixed(6)}`
      : '—';

    if (!accessRoads.length) {
      $('assumptionBanner').innerHTML = '<strong>Chưa nhận diện được đường/hẻm thực tế.</strong>';
      $('resultAccessRoad').textContent = '—';
      $('resultAccessAliases').textContent = '—';
      $('resultAccessDistance').textContent = '—';
      $('resultNearbyRoads').textContent = '—';
      $('resultLegalStatus').textContent = '—';
      return;
    }

    const primary = accessRoads[0];
    const directLegal = legalCatalog().find(item => roadMatchesCatalog(primary.names, item));
    $('assumptionBanner').innerHTML =
      `<strong>Đường tiếp cận gần nhất: ${escapeHtml(primary.label)}.</strong> ` +
      `App sẽ dò tiếp các trục có trong Quyết định theo mạng đường.`;
    $('resultAccessRoad').textContent = primary.label;
    $('resultAccessAliases').textContent = primary.names.length ? primary.names.join(' · ') : 'Không có tên/mã trên dữ liệu bản đồ';
    $('resultAccessDistance').textContent = `${fmtMeters(primary.distance)} (tới tim đường)`;
    $('resultNearbyRoads').textContent = accessRoads.slice(1).length
      ? accessRoads.slice(1).map(item => `${item.label} (${fmtMeters(item.distance)})`).join('; ')
      : 'Không có đường khác trong phạm vi dò';
    $('resultLegalStatus').textContent = directLegal
      ? `Có tên tương ứng trong dữ liệu QĐ: ${directLegal.road}`
      : 'Đường/hẻm tiếp cận chưa có tên riêng trong dữ liệu QĐ; cần truy ra trục pháp lý';
  }

  function renderSelectedRoute() {
    $('factorRouteCount').textContent = String(legalRoutes.length);
    if (!selectedRoute) {
      $('selectedLegalRoad').textContent = 'Chưa có trục pháp lý.';
      $('selectedRouteDistance').textContent = 'Khoảng cách đường đi: —';
      $('selectedRouteMethod').textContent = 'Phương pháp: —';
      $('factorResidential').textContent = '—';
      $('factorCommercial').textContent = '—';
      $('factorProduction').textContent = '—';
      $('legalSourceText').textContent = 'Chưa có kết quả.';
      $('sourcePage').textContent = 'Trang PDF: —';
      $('sourceRecord').textContent = 'Dữ liệu: —';
      return;
    }
    $('selectedLegalRoad').textContent =
      `${selectedRoute.road}${selectedRoute.mapNames.length ? ` (${selectedRoute.mapNames.join(' · ')})` : ''}`;
    $('selectedRouteDistance').textContent = `Khoảng cách đường đi: ${fmtMeters(selectedRoute.routeDistance)}`;
    $('selectedRouteMethod').textContent = `Phương pháp: ${selectedRoute.routeMethod}`;
    $('factorResidential').textContent = factorValue(selectedRoute.factors.residential);
    $('factorCommercial').textContent = factorValue(selectedRoute.factors.commercial);
    $('factorProduction').textContent = factorValue(selectedRoute.factors.production);
    $('legalSourceText').textContent = `Quyết định 03/2026/QĐ-UBND – dữ liệu ${selectedRoute.segments[0]?.source?.appendix || '—'}, ${selectedRoute.segments[0]?.source?.table || '—'}.`;
    $('sourcePage').textContent = `Trang PDF: ${[...selectedRoute.pages].sort((a, b) => a - b).join(', ')}`;
    $('sourceRecord').textContent = `Dòng: ${[...selectedRoute.records].join(', ')}`;
  }

  function renderRouteTable() {
    $('routeCount').textContent = `${legalRoutes.length} tuyến`;
    const body = $('routeTableBody');
    if (!legalRoutes.length) {
      body.innerHTML = '<tr><td colspan="10" class="empty-cell">Chưa tìm được trục có trong dữ liệu Quyết định quanh vị trí.</td></tr>';
      return;
    }
    const access = accessRoads[0]?.label || 'Vị trí';
    body.innerHTML = legalRoutes.map((route, index) => {
      const selected = selectedRoute?.road === route.road ? ' selected-row' : '';
      const mapName = route.mapNames.length ? route.mapNames.join(' · ') : 'Tên khớp dữ liệu QĐ';
      const pages = [...route.pages].sort((a, b) => a - b).join(', ');
      return `<tr class="${selected}">
        <td>${index + 1}</td>
        <td><strong>${escapeHtml(route.road)}</strong><div class="route-alias">${escapeHtml((route.aliases || []).join(' · '))}</div></td>
        <td>${escapeHtml(mapName)}</td>
        <td>${escapeHtml(access)}<br><span class="muted-arrow">→ ${escapeHtml(route.road)}</span></td>
        <td><strong>${escapeHtml(fmtMeters(route.routeDistance))}</strong><div class="route-alias">${escapeHtml(route.routeMethod)}</div></td>
        <td>${escapeHtml(factorValue(route.factors.residential))}</td>
        <td>${escapeHtml(factorValue(route.factors.commercial))}</td>
        <td>${escapeHtml(factorValue(route.factors.production))}</td>
        <td>Trang ${escapeHtml(pages)}</td>
        <td><button class="table-button choose-route-btn" type="button" data-road="${escapeHtml(route.road)}">Xem tuyến</button></td>
      </tr>`;
    }).join('');
  }

  function selectRoute(road) {
    selectedRoute = legalRoutes.find(item => item.road === road) || null;
    renderSelectedRoute();
    renderRouteTable();
  }

  async function analyze(rawInput = $('googlePasteInput').value) {
    const raw = String(rawInput || '').trim();
    currentRaw = raw;
    currentPoint = extractCoordinate(raw);
    accessRoads = [];
    legalRoutes = [];
    selectedRoute = null;
    resetMap();

    if (!raw) {
      setMessage('Hãy dán tọa độ hoặc đường dẫn Google Maps.', 'error');
      $('confidenceText').className = 'status-pill low';
      $('confidenceText').textContent = 'Chưa tra cứu';
      renderAccessRoads(); renderSelectedRoute(); renderRouteTable(); updateMapPreview();
      return;
    }
    if (!currentPoint) {
      setMessage('Không bóc được tọa độ. Hãy sao chép dòng tọa độ màu xanh trên Google Maps.', 'error');
      $('confidenceText').className = 'status-pill low';
      $('confidenceText').textContent = 'Thiếu tọa độ';
      renderAccessRoads(); renderSelectedRoute(); renderRouteTable(); updateMapPreview();
      return;
    }

    $('analyzeBtn').disabled = true;
    $('analyzeBtn').textContent = 'Đang dò mạng đường…';
    setMessage('Đang tải mạng đường thực tế và đối chiếu dữ liệu Quyết định…', 'info');
    $('confidenceText').className = 'status-pill medium';
    $('confidenceText').textContent = 'Đang xử lý';
    updateMapPreview();

    try {
      const [accessWays, legalWays] = await Promise.all([
        fetchAccessWays(currentPoint),
        fetchLegalWays(currentPoint)
      ]);
      accessRoads = buildAccessRoads(currentPoint, accessWays);
      legalRoutes = await buildLegalRoutes(currentPoint, legalWays);
      selectedRoute = legalRoutes[0] || null;

      if (!accessRoads.length) {
        setMessage('Không nhận diện được đường/hẻm thực tế trong phạm vi dò. Có thể dữ liệu bản đồ chưa có đường nhỏ này.', 'warning');
        $('confidenceText').className = 'status-pill medium';
        $('confidenceText').textContent = 'Thiếu đường tiếp cận';
      } else if (!legalRoutes.length) {
        setMessage(`Đã nhận diện ${accessRoads[0].label}, nhưng chưa tìm thấy trục đã có dữ liệu hệ số trong phạm vi ${LEGAL_RADIUS_M.toLocaleString('vi-VN')} m.`, 'warning');
        $('confidenceText').className = 'status-pill medium';
        $('confidenceText').textContent = 'Chưa có trục QĐ';
      } else {
        setMessage(`Đã nhận diện đường tiếp cận và lập ${legalRoutes.length} phương án trục trong Quyết định theo mạng đường thực tế.`, 'success');
        $('confidenceText').className = 'status-pill high';
        $('confidenceText').textContent = 'Đã dò tự động';
      }
    } catch (error) {
      setMessage(`Không tải được dữ liệu mạng đường trực tuyến: ${error.message || 'lỗi kết nối'}.`, 'error');
      $('confidenceText').className = 'status-pill low';
      $('confidenceText').textContent = 'Lỗi dữ liệu bản đồ';
    } finally {
      $('analyzeBtn').disabled = false;
      $('analyzeBtn').textContent = 'Dò đường & hệ số';
      renderAccessRoads();
      renderSelectedRoute();
      renderRouteTable();
      updateMapPreview();
    }
  }

  function copyResult() {
    if (!currentPoint) {
      $('copyMessage').textContent = 'Chưa có kết quả để sao chép.';
      return;
    }
    const lines = [
      'BẢO TÍN – TRA CỨU ĐƯỜNG TIẾP CẬN VÀ TRỤC PHÁP LÝ',
      `Tọa độ: ${currentPoint[0].toFixed(6)}, ${currentPoint[1].toFixed(6)}`,
      `Đường tiếp cận gần nhất: ${accessRoads[0]?.label || 'Chưa xác định'}`,
      '',
      ...legalRoutes.map((route, index) =>
        `${index + 1}. ${route.road}\n` +
        `   Khoảng cách đường đi: ${fmtMeters(route.routeDistance)} (${route.routeMethod})\n` +
        `   Hệ số đất ở: ${factorValue(route.factors.residential)}; TMDV: ${factorValue(route.factors.commercial)}; SXPNN: ${factorValue(route.factors.production)}\n` +
        `   Trang PDF: ${[...route.pages].sort((a, b) => a - b).join(', ')}`
      ),
      '',
      'Lưu ý: kết quả phụ thuộc dữ liệu mạng đường trực tuyến và dữ liệu Quyết định đã nhập trong app.'
    ];
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

  function buildSavedSnapshot() {
    const now = new Date();
    return {
      schema_version: '1.1',
      id: globalThis.crypto?.randomUUID?.() || `loc-${Date.now()}`,
      location_id: `LOC-${Date.now()}`,
      label: $('locationLabelInput').value.trim() || `Điểm ${now.toLocaleString('vi-VN')}`,
      note: $('locationNoteInput').value.trim(),
      saved_at: now.toISOString(),
      raw_input: currentRaw,
      latitude: currentPoint[0],
      longitude: currentPoint[1],
      access_roads: accessRoads.map(item => ({
        label: item.label, names: item.names, distance_to_centerline_m: Math.round(item.distance)
      })),
      selected_legal_road: selectedRoute?.road || null,
      legal_routes: legalRoutes.map(route => ({
        road: route.road,
        map_names: route.mapNames,
        route_distance_m: Math.round(route.routeDistance),
        route_method: route.routeMethod,
        factors: {
          residential: [...route.factors.residential],
          commercial: [...route.factors.commercial],
          production: [...route.factors.production]
        },
        pages: [...route.pages],
        records: [...route.records]
      })),
      legal_status: 'draft',
      market_data_status: 'empty',
      market_samples: []
    };
  }

  function saveCurrentLocation() {
    if (!currentPoint || !accessRoads.length) {
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
        <td>${escapeHtml(item.access_roads?.[0]?.label || '—')}</td>
        <td>${escapeHtml(item.selected_legal_road || '—')}</td>
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
    $('savedMessage').textContent = `Đang nạp lại “${item.label}”.`;
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
      app_version: 'V0.3.1',
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
    setMessage('Đã nhận nội dung dán, đang dò tự động…', 'info');
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
      enableHighAccuracy: false, timeout: 8000, maximumAge: 60000
    });
  });
  $('clearBtn').addEventListener('click', () => {
    $('googlePasteInput').value = '';
    currentPoint = null; currentRaw = ''; accessRoads = []; legalRoutes = []; selectedRoute = null;
    resetMap();
    setMessage('Đã xóa dữ liệu tra cứu.', 'info');
    $('confidenceText').className = 'status-pill low';
    $('confidenceText').textContent = 'Chưa tra cứu';
    renderAccessRoads(); renderSelectedRoute(); renderRouteTable(); updateMapPreview();
  });
  $('routeTableBody').addEventListener('click', event => {
    const button = event.target.closest('.choose-route-btn');
    if (button) selectRoute(button.dataset.road);
  });
  $('toggleMapBtn').addEventListener('click', () => {
    if ($('mapFrame').classList.contains('hidden')) showMap(); else hideMap();
  });
  $('openGoogleBtn').addEventListener('click', () => {
    if (currentPoint) window.open(`https://www.google.com/maps?q=${currentPoint[0]},${currentPoint[1]}`, '_blank', 'noopener');
  });
  $('copyBtn').addEventListener('click', copyResult);
  $('printBtn').addEventListener('click', () => window.print());
  $('saveLocationBtn').addEventListener('click', saveCurrentLocation);
  $('exportSavedBtn').addEventListener('click', exportSavedLocations);
  $('clearSavedBtn').addEventListener('click', () => {
    if (!savedLocations.length || !window.confirm('Xóa toàn bộ điểm tra cứu đã lưu trên máy này?')) return;
    savedLocations = []; persistSavedLocations(); renderSavedLocations();
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

  resetMap();
  updateMapPreview();
  renderAccessRoads();
  renderSelectedRoute();
  renderRouteTable();
  renderSavedLocations();
})();
