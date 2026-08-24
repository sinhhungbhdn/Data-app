(() => {
  'use strict';

  const manifest = window.BAO_TIN_QD03_MANIFEST || {};
  const appendixRules = window.BAO_TIN_QD03_APPENDIX_RULES || { appendixII: [], appendixIII: [] };
  const chunks = window.BAO_TIN_QD03_CHUNKS = window.BAO_TIN_QD03_CHUNKS || {};
  const packs = window.BAO_TIN_QD03_PACKS = window.BAO_TIN_QD03_PACKS || {};
  const packParts = window.BAO_TIN_QD03_PACK_PARTS = window.BAO_TIN_QD03_PACK_PARTS || [];
  const $ = id => document.getElementById(id);
  const loadedScripts = new Map();
  const relationLabels = {
    main: 'Thuộc trực tiếp dòng tuyến/đoạn đã chọn',
    direct: 'Đường đấu nối trực tiếp ra tuyến/đoạn đã chọn',
    indirect: 'Đường không đấu nối trực tiếp nhưng thông ra tuyến/đoạn đã chọn'
  };
  const surfaceLabels = { p: 'Đường nhựa / bê tông xi măng', n: 'Đường đất / đá / cấp phối / chưa đầu tư', x: 'Hiện trạng không xác định' };
  const landLabels = {
    residential: 'Đất ở', commercial: 'Đất thương mại, dịch vụ', production: 'Đất cơ sở sản xuất phi nông nghiệp / khoáng sản', agriculture: 'Đất nông nghiệp'
  };

  let currentArea = null;
  let currentGroups = [];
  let filteredGroups = [];
  let selectedResult = null;
  let locationQuery = '';
  let locationRaw = '';

  function normalize(value) {
    return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D').toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
  }

  function fmtFactor(value) {
    return Number(value).toLocaleString('vi-VN', { minimumFractionDigits: 2, maximumFractionDigits: 4 });
  }

  function fmtMoney(value) {
    return Number(value).toLocaleString('vi-VN', { maximumFractionDigits: 0 }) + ' đồng/m²';
  }

  function escapeHtml(value) {
    return String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
  }

  function setMessage(text, type = '') {
    $('formMessage').textContent = text;
    $('formMessage').className = `form-message ${type}`;
  }

  function initStats() {
    const v = manifest.validationSummary || {};
    $('rowCount').textContent = Number(manifest.rowCount || 0).toLocaleString('vi-VN');
    $('areaCount').textContent = `${manifest.areaCount || 0} địa bàn`;
    $('tableCount').textContent = `${manifest.tableCount || 0} bảng dữ liệu`;
    $('autoCount').textContent = Number(v.branch_complete || 0).toLocaleString('vi-VN') + ' dòng';
    $('i1Count').textContent = Number(manifest.sections?.I1 || 0).toLocaleString('vi-VN');
    $('i2Count').textContent = Number(manifest.sections?.I2 || 0).toLocaleString('vi-VN');
    $('completeCount').textContent = Number(v.branch_complete || 0).toLocaleString('vi-VN');
    $('manualCount').textContent = Number((v.branch_partial || 0) + (v.branch_manual || 0)).toLocaleString('vi-VN');
  }

  function initAreas() {
    $('areaSelect').innerHTML = (manifest.areas || []).map(item => `<option value="${item.tableNo}">Bảng ${item.tableNo} · ${escapeHtml(item.area)}</option>`).join('');
  }

  function loadScript(src) {
    if (loadedScripts.has(src)) return loadedScripts.get(src);
    const promise = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = `data/v0.5/${src}`;
      script.onload = resolve;
      script.onerror = () => reject(new Error(`Không tải được ${src}`));
      document.head.appendChild(script);
    });
    loadedScripts.set(src, promise);
    return promise;
  }

  async function unpackChunk(file) {
    if (!packs[file]) return;
    if (typeof DecompressionStream !== 'function') throw new Error('Trình duyệt quá cũ, không hỗ trợ giải nén dữ liệu. Hãy mở bằng Microsoft Edge hoặc Google Chrome mới.');
    const binary = atob(packs[file]);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
    const text = await new Response(stream).text();
    Object.assign(chunks, JSON.parse(text));
    delete packs[file];
  }

  async function loadArea() {
    const tableNo = Number($('areaSelect').value);
    const file = manifest.chunkMap?.[String(tableNo)];
    if (!file) return setMessage('Không tìm thấy tệp dữ liệu của địa bàn.', 'error');
    $('loadedAreaBadge').textContent = 'Đang tải...';
    try {
      if (!chunks[String(tableNo)]) {
        if (Array.isArray(manifest.packParts) && manifest.packParts.length) {
          for (const part of manifest.packParts) await loadScript(part);
          packs[file] = packParts.join('');
        } else {
          await loadScript(file);
        }
        await unpackChunk(file);
      }
      currentArea = chunks[String(tableNo)] || null;
      if (!currentArea) throw new Error('Tệp đã tải nhưng không có địa bàn được chọn.');
      $('loadedAreaBadge').textContent = `${currentArea.area} · đã tải`;
      refreshSection();
      setMessage(`Đã tải Bảng ${tableNo} – ${currentArea.area}. Dữ liệu hoạt động ngoại tuyến.`, 'success');
    } catch (error) {
      $('loadedAreaBadge').textContent = 'Lỗi tải';
      setMessage(error.message, 'error');
    }
  }

  function refreshSection() {
    if (!currentArea) return;
    const section = $('sectionSelect').value;
    currentGroups = currentArea[section] || [];
    $('landTypeField').classList.toggle('hidden', section === 'I2');
    $('fsiInput').disabled = section === 'I2';
    if (section === 'I2') $('fsiInput').value = '';
    fillInfluenceOptions();
    filterGroups();
  }

  function baseLabel(group) {
    const b = group.base;
    const road = b.road || '(Không có tên tuyến riêng)';
    const range = [b.start, b.end].filter(Boolean).join(' → ');
    return `TT ${b.tt} · ${road}${range ? ' · ' + range : ''}${b.dup ? ' · TT trùng trong nguồn' : ''}`;
  }

  function filterGroups() {
    const query = normalize($('routeSearch').value);
    filteredGroups = currentGroups.filter(group => {
      if (!query) return true;
      const b = group.base;
      return normalize([b.road, b.start, b.end, b.tt].join(' ')).includes(query);
    });
    const previous = $('baseSelect').value;
    $('baseSelect').innerHTML = filteredGroups.map((group, index) => `<option value="${index}">${escapeHtml(baseLabel(group))}</option>`).join('');
    if (!filteredGroups.length) {
      $('baseSelect').innerHTML = '<option value="">Không tìm thấy tuyến/đoạn phù hợp</option>';
      $('baseCountText').textContent = '0 dòng tuyến/đoạn.';
    } else {
      $('baseCountText').textContent = `${filteredGroups.length.toLocaleString('vi-VN')} dòng tuyến/đoạn gốc; chọn đúng đoạn theo mốc đầu – cuối.`;
      if (previous && Number(previous) < filteredGroups.length) $('baseSelect').value = previous;
    }
    refreshRelations();
    clearCandidates();
  }

  function selectedGroup() {
    const index = Number($('baseSelect').value);
    return Number.isInteger(index) && filteredGroups[index] ? filteredGroups[index] : null;
  }

  function refreshRelations() {
    const group = selectedGroup();
    const relation = $('relationSelect');
    const hasDirect = group?.branches?.some(item => item.r === 'd');
    const hasIndirect = group?.branches?.some(item => item.r === 'i');
    relation.querySelector('option[value="direct"]').disabled = !hasDirect;
    relation.querySelector('option[value="indirect"]').disabled = !hasIndirect;
    if (relation.selectedOptions[0]?.disabled) relation.value = 'main';
    toggleBranchFields();
  }

  function toggleBranchFields() {
    const branch = $('relationSelect').value !== 'main';
    document.querySelectorAll('.branch-only').forEach(node => node.classList.toggle('hidden', !branch));
  }

  function parseCoordinate(raw) {
    let text = String(raw || '').trim();
    try { text = decodeURIComponent(text); } catch (_) {}
    const patterns = [/@(-?\d{1,3}(?:\.\d+)?),\s*(-?\d{1,3}(?:\.\d+)?)/, /(?:q|query|ll|center|destination)=(-?\d{1,3}(?:\.\d+)?)(?:,|%2C|\s)(-?\d{1,3}(?:\.\d+)?)/i, /(-?\d{1,3}\.\d{4,})\s*[,;\s]\s*(-?\d{1,3}\.\d{4,})/];
    for (const pattern of patterns) {
      const m = text.match(pattern);
      if (!m) continue;
      let a = Number(m[1]), b = Number(m[2]);
      if (Math.abs(a) > 90 && Math.abs(b) <= 90) [a, b] = [b, a];
      if (Math.abs(a) <= 90 && Math.abs(b) <= 180) return [a, b];
    }
    return null;
  }

  function loadLocation() {
    locationRaw = $('mapInput').value.trim();
    if (!locationRaw) {
      locationQuery = '';
      $('openMapBtn').disabled = true;
      $('locationSummary').textContent = 'Hãy dán tọa độ, địa chỉ, tên điểm hoặc liên kết Google Maps.';
      return;
    }
    const point = parseCoordinate(locationRaw);
    locationQuery = point ? `${point[0]},${point[1]}` : locationRaw;
    $('openMapBtn').disabled = false;
    const n = normalize(locationRaw);
    const hints = [];
    if (/nghia trang|nghia dia|nha tang le|hoa tang/.test(n)) hints.push('Có mốc nghĩa trang/mai táng: cần xác nhận thửa đất có nằm trong phạm vi 100 m để áp dụng Phụ lục III hay không.');
    if (!point && locationRaw.length < 200 && !/^https?:/i.test(locationRaw)) {
      $('routeSearch').value = locationRaw;
      filterGroups();
    }
    $('locationSummary').textContent = `${point ? `Đã nhận tọa độ ${point[0].toFixed(6)}, ${point[1].toFixed(6)}` : 'Đã nhận địa chỉ/tên điểm/liên kết'}. App không tự đo tuyến và khoảng cách.${hints.length ? ' ' + hints.join(' ') : ''}`;
  }

  function openMap() {
    if (!locationRaw) return;
    if (/^https?:\/\/(?:www\.)?(?:google\.[^/]+\/maps|maps\.app\.goo\.gl)/i.test(locationRaw)) window.open(locationRaw, '_blank', 'noopener');
    else window.open(`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(locationQuery)}`, '_blank', 'noopener');
  }

  function clearLocation() {
    $('mapInput').value = '';
    locationRaw = locationQuery = '';
    $('openMapBtn').disabled = true;
    $('locationSummary').textContent = 'Chưa nạp vị trí.';
  }

  function fillInfluenceOptions() {
    const section = $('sectionSelect').value;
    const allowed = (appendixRules.appendixIII || []).filter(item => {
      if (item.code === 'none') return true;
      return section === 'I1' ? item.code !== 'agri_unpaved_access' : item.code === 'agri_unpaved_access';
    });
    $('influenceSelect').innerHTML = allowed.map(item => `<option value="${item.code}" data-factor="${item.factor}">${escapeHtml(item.description)} · HS ${fmtFactor(item.factor)}</option>`).join('');
  }

  function valueInside(value, min, minInclusive, max, maxInclusive) {
    if (min != null && (minInclusive === false ? value <= min : value < min)) return false;
    if (max != null && (maxInclusive === false ? value >= max : value > max)) return false;
    return true;
  }

  function ruleMatches(rule, width, distance) {
    return valueInside(width, rule.widthMin, rule.widthMinInclusive, rule.widthMax, rule.widthMaxInclusive) && valueInside(distance, rule.distanceMin, rule.distanceMinInclusive, rule.distanceMax, rule.distanceMaxInclusive);
  }

  function ruleCompatible(rule, width, distance) {
    const widthKnown = rule.widthMin != null || rule.widthMax != null;
    const distanceKnown = rule.distanceMin != null || rule.distanceMax != null;
    return (!widthKnown || valueInside(width, rule.widthMin, rule.widthMinInclusive, rule.widthMax, rule.widthMaxInclusive)) && (!distanceKnown || valueInside(distance, rule.distanceMin, rule.distanceMinInclusive, rule.distanceMax, rule.distanceMaxInclusive));
  }

  function formatBound(min, minInclusive, max, maxInclusive, unit) {
    if (min != null && max != null) return `${minInclusive === false ? '>' : '≥'}${Number(min).toLocaleString('vi-VN')} ${unit} đến ${maxInclusive === false ? '<' : '≤'}${Number(max).toLocaleString('vi-VN')} ${unit}`;
    if (min != null) return `${minInclusive === false ? '>' : '≥'}${Number(min).toLocaleString('vi-VN')} ${unit}`;
    if (max != null) return `${maxInclusive === false ? '<' : '≤'}${Number(max).toLocaleString('vi-VN')} ${unit}`;
    return 'không nêu';
  }

  function formatRule(rule) {
    return `Bề rộng ${formatBound(rule.widthMin, rule.widthMinInclusive, rule.widthMax, rule.widthMaxInclusive, 'm')}; khoảng cách ${formatBound(rule.distanceMin, rule.distanceMinInclusive, rule.distanceMax, rule.distanceMaxInclusive, 'm')}`;
  }

  function factorFor(row) {
    const section = $('sectionSelect').value;
    if (section === 'I2') return Number(row.f);
    const index = { residential: 0, commercial: 1, production: 2 }[$('landTypeSelect').value] ?? 0;
    return Number(row.f[index]);
  }

  function planningFactor() {
    if ($('sectionSelect').value === 'I2') return { factor: 1, description: 'Không nhập hệ số sử dụng đất cho đất nông nghiệp' };
    const raw = $('fsiInput').value.trim();
    if (!raw) return { factor: 1, description: 'Không nhập – dùng 1,00' };
    const fsi = Number(raw);
    if (!Number.isFinite(fsi) || fsi < 0) return null;
    const item = (appendixRules.appendixII || []).find(rule => valueInside(fsi, rule.minFsi, rule.minInclusive, rule.maxFsi, rule.maxInclusive));
    return item ? { factor: Number(item.factor), description: item.description, fsi } : { factor: 1, description: 'Không xác định được nhóm FSI' };
  }

  function influenceFactor() {
    const code = $('influenceSelect').value;
    const item = (appendixRules.appendixIII || []).find(rule => rule.code === code) || { factor: 1, description: 'Trường hợp khác' };
    return { factor: Number(item.factor), description: item.description, code };
  }

  function candidateCondition(branch) {
    const relation = branch.r === 'd' ? relationLabels.direct : relationLabels.indirect;
    const surface = surfaceLabels[branch.s] || surfaceLabels.x;
    if (branch.q?.length) return `${relation}; ${surface}; ${branch.q.map(formatRule).join(' HOẶC ')}`;
    return `${relation}; ${surface}; cần xem nguyên văn dòng nguồn.`;
  }

  function clearCandidates() {
    $('candidateCard').classList.add('hidden');
    $('candidateList').innerHTML = '';
    $('candidateCount').textContent = '0 dòng';
  }

  function matchData() {
    selectedResult = null;
    resetResultView();
    clearCandidates();
    const group = selectedGroup();
    if (!group) return setMessage('Chưa chọn tuyến/đoạn gốc.', 'error');
    const relation = $('relationSelect').value;
    if (relation === 'main') {
      chooseRow(group.base, group, 'main', 'exact');
      setMessage('Đã chọn đúng dòng tuyến/đoạn gốc trong Quyết định.', 'success');
      return;
    }
    const width = Number($('widthInput').value);
    const distance = Number($('distanceInput').value);
    if (!Number.isFinite(width) || width < 0) return setMessage('Nhập bề rộng đường hợp lệ.', 'error');
    if (!Number.isFinite(distance) || distance < 0) return setMessage('Nhập khoảng cách hợp lệ.', 'error');
    const code = relation === 'direct' ? 'd' : 'i';
    const surface = $('surfaceSelect').value;
    const branches = (group.branches || []).filter(row => row.r === code && (surface === 'x' || row.s === surface || row.s === 'x'));
    if (!branches.length) return setMessage('Đoạn đã chọn không có dòng điều kiện tương ứng với quan hệ/hiện trạng này.', 'error');

    const exact = branches.filter(row => row.x === 'complete' && row.q.some(rule => ruleMatches(rule, width, distance)));
    const review = branches.filter(row => row.x !== 'complete' && (!row.q.length || row.q.some(rule => ruleCompatible(rule, width, distance))));
    if (exact.length === 1 && review.length === 0) {
      chooseRow(exact[0], group, relation, 'exact');
      setMessage(`Đã dò đúng TT ${exact[0].tt} theo bề rộng và khoảng cách.`, 'success');
      return;
    }
    const candidates = [...exact.map(row => ({ row, quality: 'exact' })), ...review.map(row => ({ row, quality: 'review' }))];
    if (!candidates.length) {
      renderCandidates(branches.map(row => ({ row, quality: 'review' })), group, relation, 'Không có dòng tự động khớp hoàn toàn. Danh sách dưới đây là các dòng cùng tuyến/quan hệ để đối chiếu nguyên văn.');
      setMessage('Không có điều kiện tự động khớp; cần chọn dòng nguyên văn và kiểm tra trang PDF.', 'warn');
      return;
    }
    const note = exact.length > 1 ? 'Có nhiều dòng cùng khớp điều kiện trong chính dữ liệu nguồn. Chọn đúng dòng sau khi kiểm tra phạm vi/mốc tuyến.' : 'Có dòng điều kiện phức tạp hoặc chưa đủ cấu trúc để kết luận tự động. Chọn đúng dòng nguyên văn.';
    renderCandidates(candidates, group, relation, note);
    setMessage(`${candidates.length} dòng có khả năng áp dụng; chưa tự kết luận.`, 'warn');
  }

  function renderCandidates(candidates, group, relation, note) {
    $('candidateCard').classList.remove('hidden');
    $('candidateCount').textContent = `${candidates.length} dòng`;
    $('candidateNote').textContent = note;
    $('candidateList').innerHTML = candidates.map((item, index) => {
      const row = item.row;
      const condition = candidateCondition(row);
      const raw = row.raw ? `<p><strong>Nguyên văn trích xuất:</strong> ${escapeHtml(row.raw)}</p>` : '';
      return `<article class="candidate-item ${item.quality}">
        <div><h3>TT ${row.tt} · HS ${fmtFactor(factorFor(row))}${row.dup ? ' · TT trùng trong nguồn' : ''}</h3><p>${escapeHtml(condition)}</p>${raw}<div class="candidate-meta"><span>PDF trang ${(row.p || []).join(', ')}</span><span>${item.quality === 'exact' ? 'Khớp số liệu đã nhập' : 'Cần xác nhận nguyên văn'}</span></div></div>
        <button class="choose-candidate" type="button" data-candidate="${index}">Chọn dòng này</button>
      </article>`;
    }).join('');
    $('candidateList').onclick = event => {
      const button = event.target.closest('[data-candidate]');
      if (!button) return;
      const item = candidates[Number(button.dataset.candidate)];
      if (!item) return;
      chooseRow(item.row, group, relation, item.quality);
      setMessage(`Đã chọn TT ${item.row.tt}.`, 'success');
      document.querySelector('.result-card')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    };
  }

  function chooseRow(row, group, relation, quality) {
    const planning = planningFactor();
    if (!planning) return setMessage('Hệ số sử dụng đất phải là số từ 0 trở lên.', 'error');
    const influence = influenceFactor();
    const market = factorFor(row);
    const combined = market * planning.factor * influence.factor;
    const manualPrice = Number($('statePriceInput').value);
    const base = group.base;
    selectedResult = { row, group, relation, quality, market, planning, influence, combined, manualPrice: Number.isFinite(manualPrice) && manualPrice > 0 ? manualPrice : null };
    renderResult();
  }

  function renderResult() {
    if (!selectedResult) return;
    const { row, group, relation, quality, market, planning, influence, combined, manualPrice } = selectedResult;
    const base = group.base;
    const section = $('sectionSelect').value;
    const landKey = section === 'I2' ? 'agriculture' : $('landTypeSelect').value;
    $('resultStatus').textContent = quality === 'exact' ? 'Đã đối chiếu' : 'Đã chọn – cần kiểm tra';
    $('resultArea').textContent = `Bảng ${currentArea.tableNo} · ${currentArea.area}`;
    $('resultLand').textContent = `${section === 'I1' ? 'Phụ lục I.1' : 'Phụ lục I.2'} · ${landLabels[landKey]}`;
    $('resultRoad').textContent = base.road || 'Không có tên tuyến riêng';
    $('resultSegment').textContent = [base.start, base.end].filter(Boolean).join(' → ') || 'Toàn tuyến / xem dòng nguồn';
    $('resultCondition').textContent = relation === 'main' ? relationLabels.main : candidateCondition(row);
    $('resultTt').textContent = `TT ${row.tt}${row.dup ? ' · TT bị trùng/đánh lại trong PDF' : ''}`;
    $('marketFactor').textContent = fmtFactor(market);
    $('planningFactor').textContent = `${fmtFactor(planning.factor)} · ${planning.description}`;
    $('influenceFactor').textContent = `${fmtFactor(influence.factor)} · ${influence.description}`;
    $('combinedFactor').textContent = fmtFactor(combined);
    $('resultSource').textContent = `QĐ 03/2026/QĐ-UBND · ${section === 'I1' ? 'Phụ lục I.1' : 'Phụ lục I.2'} · Bảng ${currentArea.tableNo} · PDF trang ${(row.p || []).join(', ')}`;
    $('statePriceStatus').textContent = manualPrice ? `Đơn giá nhập thủ công: ${fmtMoney(manualPrice)}` : 'Chưa có bộ dữ liệu NQ 28';
    $('adjustedPrice').textContent = manualPrice ? `${fmtMoney(manualPrice)} × ${fmtFactor(combined)} = ${fmtMoney(manualPrice * combined)}` : 'Chưa nhập đơn giá NQ 28 để tính thử';
    const warnings = [];
    if (quality !== 'exact') warnings.push('Dòng này được người dùng chọn từ nhóm cần xác nhận; app không khẳng định tự động điều kiện đã đủ.');
    if (row.dup) warnings.push('TT này bị trùng hoặc được đánh lại trong chính PDF; nguồn được phân biệt bằng trang PDF và mã dòng nội bộ.');
    if (row.patch) warnings.push(row.patch);
    if (influence.code === 'cemetery_100') warnings.push('Hệ số 0,95 chỉ áp dụng khi đã xác nhận đất phi nông nghiệp nằm trong phạm vi 100 m từ nghĩa trang, nghĩa địa, nhà tang lễ hoặc cơ sở hỏa táng.');
    warnings.push('Chưa có dữ liệu bảng giá đất theo Nghị quyết 28/2025/NQ-HĐND; số tiền chỉ được tính khi người dùng tự nhập đơn giá gốc.');
    $('resultWarning').textContent = warnings.join(' ');
    $('resultWarning').className = `result-warning ${warnings.length > 1 ? 'warn' : ''}`;
  }

  function resetResultView() {
    ['resultArea','resultLand','resultRoad','resultSegment','resultCondition','resultTt','marketFactor','planningFactor','influenceFactor','combinedFactor','resultSource','adjustedPrice'].forEach(id => $(id).textContent = '—');
    $('statePriceStatus').textContent = 'Chưa có bộ dữ liệu NQ 28';
    $('resultStatus').textContent = 'Chưa có kết quả';
    $('resultWarning').textContent = '';
    $('resultWarning').className = 'result-warning';
  }

  function resetCondition() {
    $('relationSelect').value = 'main';
    $('surfaceSelect').value = 'p';
    $('widthInput').value = '';
    $('distanceInput').value = '';
    $('fsiInput').value = '';
    $('statePriceInput').value = '';
    fillInfluenceOptions();
    toggleBranchFields();
    clearCandidates();
    resetResultView();
    setMessage('Đã xóa điều kiện.', '');
  }

  function initEvents() {
    $('areaSelect').addEventListener('change', loadArea);
    $('sectionSelect').addEventListener('change', refreshSection);
    $('routeSearch').addEventListener('input', filterGroups);
    $('baseSelect').addEventListener('change', () => { refreshRelations(); clearCandidates(); resetResultView(); });
    $('relationSelect').addEventListener('change', () => { toggleBranchFields(); clearCandidates(); resetResultView(); });
    $('loadLocationBtn').addEventListener('click', loadLocation);
    $('openMapBtn').addEventListener('click', openMap);
    $('clearLocationBtn').addEventListener('click', clearLocation);
    $('matchBtn').addEventListener('click', matchData);
    $('resetConditionBtn').addEventListener('click', resetCondition);
  }

  async function init() {
    initStats();
    initAreas();
    fillInfluenceOptions();
    initEvents();
    resetResultView();
    await loadArea();
  }

  init();
})();
