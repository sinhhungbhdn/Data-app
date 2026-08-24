(() => {
  'use strict';

  if (window.__BAO_TIN_PATCH_011_LOADED__) return;
  window.__BAO_TIN_PATCH_011_LOADED__ = true;

  const $ = id => document.getElementById(id);
  const versionBadge = document.querySelector('.version-badge');
  const footerVersion = document.querySelector('.app-footer span:last-child');
  if (versionBadge) versionBadge.textContent = 'V0.1.1';
  if (footerVersion) footerVersion.textContent = 'Phát triển bởi Nguyễn Mạnh Cường · Version: V0.1.1';

  const planningSelect = $('planningFactor');
  const otherSelect = $('otherFactor');
  const locateButton = $('locateBtn');
  const coordinateInput = $('coordinateInput');
  const coordinateMessage = $('coordinateMessage');

  if (!planningSelect || !otherSelect) return;

  const legacyGroup = planningSelect.closest('.two-column-fields');
  if (legacyGroup) legacyGroup.classList.add('legacy-factor-controls');

  const panel = document.createElement('div');
  panel.className = 'automatic-factors';
  panel.innerHTML = `
    <section class="auto-factor-card">
      <div class="auto-factor-head">
        <div>
          <strong>Hệ số quy hoạch</strong>
          <span>Tự tính theo hệ số sử dụng đất của dự án</span>
        </div>
        <output id="autoPlanningBadge">1,00</output>
      </div>
      <label class="checkbox-row">
        <input id="projectHasFar" type="checkbox">
        <span>Thửa đất thuộc dự án có hệ số sử dụng đất được phê duyệt</span>
      </label>
      <div id="farInputWrap" class="hidden">
        <label class="field-label" for="farInput">Hệ số sử dụng đất của dự án (lần)</label>
        <input id="farInput" type="number" min="0" step="0.01" inputmode="decimal" placeholder="Ví dụ: 6.5">
      </div>
      <div class="auto-factor-note" id="planningNote">Không khai báo dự án có HSSD: tự áp dụng 1,00.</div>
    </section>

    <section class="auto-factor-card">
      <div class="auto-factor-head">
        <div>
          <strong>Yếu tố khác ảnh hưởng đến giá đất</strong>
          <span>Chọn điều kiện, ứng dụng tự quy đổi hệ số</span>
        </div>
        <output id="autoOtherBadge">1,00</output>
      </div>
      <select id="otherConditionSelect">
        <option value="1">Không có hoặc chưa xác định yếu tố khác</option>
        <option value="1.05">Trong 200 m từ TTTM, trung tâm hành chính hoặc siêu thị</option>
        <option value="0.95">Trong 100 m từ nghĩa trang, nhà tang lễ hoặc nhà hỏa táng</option>
        <option value="0.95">Trong 50 m từ hành lang đường sắt, cao tốc hoặc hầm chui</option>
      </select>
      <div class="auto-factor-note" id="otherNote">Tự áp dụng 1,00.</div>
      <div class="auto-limit-note">Bản nháp chưa có lớp ranh GIS của các công trình này. Hiện app tự quy đổi hệ số sau khi người dùng xác nhận điều kiện; khi có dữ liệu GIS sẽ tự phát hiện theo tọa độ.</div>
    </section>
  `;

  if (legacyGroup) legacyGroup.insertAdjacentElement('afterend', panel);

  const projectHasFar = $('projectHasFar');
  const farInputWrap = $('farInputWrap');
  const farInput = $('farInput');
  const planningBadge = $('autoPlanningBadge');
  const planningNote = $('planningNote');
  const otherCondition = $('otherConditionSelect');
  const otherBadge = $('autoOtherBadge');
  const otherNote = $('otherNote');

  const format = value => Number(value).toLocaleString('vi-VN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });

  function applyPlanningFactor() {
    farInputWrap.classList.toggle('hidden', !projectHasFar.checked);
    let factor = 1;
    let note = 'Không khai báo dự án có HSSD: tự áp dụng 1,00.';

    if (projectHasFar.checked) {
      const far = Number(farInput.value);
      if (!Number.isFinite(far) || far < 0 || farInput.value === '') {
        note = 'Chưa nhập HSSD hợp lệ; tạm áp dụng 1,00.';
      } else if (far < 4) {
        factor = 1;
        note = `HSSD ${far.toLocaleString('vi-VN')} lần: dưới 4 lần.`;
      } else if (far < 8) {
        factor = 1.05;
        note = `HSSD ${far.toLocaleString('vi-VN')} lần: từ 4 đến dưới 8 lần.`;
      } else if (far < 12.8) {
        factor = 1.1;
        note = `HSSD ${far.toLocaleString('vi-VN')} lần: từ 8 đến dưới 12,8 lần.`;
      } else {
        factor = 1.15;
        note = `HSSD ${far.toLocaleString('vi-VN')} lần: từ 12,8 lần trở lên.`;
      }
    }

    planningSelect.value = String(factor);
    planningBadge.textContent = format(factor);
    planningNote.textContent = note;
    planningSelect.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function applyOtherFactor() {
    const factor = Number(otherCondition.value);
    otherSelect.value = String(factor);
    otherBadge.textContent = format(factor);
    otherNote.textContent = otherCondition.options[otherCondition.selectedIndex].textContent;
    otherSelect.dispatchEvent(new Event('change', { bubbles: true }));
  }

  projectHasFar.addEventListener('change', applyPlanningFactor);
  farInput.addEventListener('input', applyPlanningFactor);
  otherCondition.addEventListener('change', applyOtherFactor);

  function parseCoordinate(value) {
    const numbers = String(value).trim().replace(/[()]/g, '').split(/[;,\s]+/).filter(Boolean).map(Number);
    if (numbers.length < 2 || !Number.isFinite(numbers[0]) || !Number.isFinite(numbers[1])) return null;
    return [numbers[0], numbers[1]];
  }

  if (locateButton) {
    locateButton.addEventListener('click', event => {
      const point = parseCoordinate(coordinateInput.value);
      if (!point) return;
      const [lat, lon] = point;
      const insidePrototypeArea = lat >= 10.70 && lat <= 11.20 && lon >= 106.55 && lon <= 107.20;
      if (!insidePrototypeArea) {
        event.preventDefault();
        event.stopImmediatePropagation();
        coordinateMessage.textContent = 'Tọa độ nằm ngoài vùng dữ liệu mẫu Phường Biên Hòa. Bản nháp không tải sang khu vực khác để tránh giật và nhận nhầm đoạn.';
      }
    }, true);
  }

  applyPlanningFactor();
  applyOtherFactor();

  window.setTimeout(() => window.dispatchEvent(new Event('resize')), 100);
})();
