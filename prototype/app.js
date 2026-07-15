(() => {
  'use strict';
  const segments = window.BAO_TIN_SEGMENTS || [];
  const $ = id => document.getElementById(id);
  const KEY = 'baoTinLand.savedLocations.v0.3.3';
  const ALIASES = {
    'Đường Bùi Hữu Nghĩa': ['ĐT16','ĐT 16','Tỉnh lộ 16','Tỉnh lộ 16B'],
    'Đường Nguyễn Ái Quốc': ['QL1K','Quốc lộ 1K'],
    'Đường Nguyễn Tri Phương': [], 'Đường Nguyễn Văn Lung': [],
    'Đường Trần Văn Ơn': [], 'Đường Hoàng Minh Chánh': []
  };
  let raw='', coord=null, address='', mapLoaded=false;
  let slots=Array.from({length:3},()=>({road:'',segmentId:''}));
  let saved=loadSaved();
  const esc=v=>String(v??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#039;');
  const norm=v=>String(v||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/đ/g,'d').replace(/Đ/g,'D').toLowerCase().replace(/[^a-z0-9\s]/g,' ').replace(/\s+/g,' ').trim();
  const fmt=v=>Number(v).toLocaleString('vi-VN',{minimumFractionDigits:2,maximumFractionDigits:2});
  const roads=()=>[...new Set(segments.map(s=>s.road))].sort((a,b)=>a.localeCompare(b,'vi'));
  const segs=r=>segments.filter(s=>s.road===r);
  const seg=id=>segments.find(s=>s.id===id)||null;
  function extractCoord(text){
    let t=String(text||''); try{t=decodeURIComponent(t)}catch(_){ }
    for(const p of [/@(-?\d{1,3}(?:\.\d+)?),\s*(-?\d{1,3}(?:\.\d+)?)/i,/[?&](?:q|query|ll|center|destination)=(-?\d{1,3}(?:\.\d+)?)(?:,|%2C|\s)(-?\d{1,3}(?:\.\d+)?)/i,/\((-?\d{1,3}(?:\.\d+)?),\s*(-?\d{1,3}(?:\.\d+)?)\)/i,/(-?\d{1,3}\.\d{4,})\s*[,;\s]\s*(-?\d{1,3}\.\d{4,})/i]){
      const m=t.match(p); if(!m)continue; let a=Number(m[1]),b=Number(m[2]); if(Math.abs(a)>90&&Math.abs(b)<=90)[a,b]=[b,a]; if(Math.abs(a)<=90&&Math.abs(b)<=180)return[a,b];
    } return null;
  }
  function extractAddress(text){
    const o=String(text||'').trim(); if(!o)return'';
    try{const u=new URL(o); const q=u.searchParams.get('q')||u.searchParams.get('query')||u.searchParams.get('destination')||u.searchParams.get('daddr'); if(q&&!extractCoord(q))return decodeURIComponent(q.replace(/\+/g,' ')); const m=u.pathname.match(/\/place\/([^/]+)/i); if(m)return decodeURIComponent(m[1].replace(/\+/g,' '));}catch(_){ }
    const s=o.replace(/@-?\d{1,3}(?:\.\d+)?,\s*-?\d{1,3}(?:\.\d+)?[^\s]*/gi,' ').replace(/\(?-?\d{1,3}\.\d{4,}\s*[,;]\s*-?\d{1,3}\.\d{4,}\)?/gi,' ').trim();
    return /^https?:\/\//i.test(s)?'':s.replace(/\s+/g,' ');
  }
  const query=()=>coord?`${coord[0]},${coord[1]}`:(address||raw);
  function msg(t,type='info'){$('searchMessage').textContent=t;$('searchMessage').dataset.type=type}
  function resetMap(){mapLoaded=false;$('mapFrame').src='';$('mapFrame').classList.add('hidden');$('mapPlaceholder').classList.remove('hidden');$('mapPlaceholder').querySelector('strong').textContent='Chưa tải bản đồ';$('mapPlaceholder').querySelector('span').textContent='Bấm “Hiện bản đồ” khi cần xem.';$('toggleMapBtn').textContent='Hiện bản đồ'}
  function updateLocation(){const ok=!!query();$('toggleMapBtn').disabled=!ok;$('openGoogleBtn').disabled=!ok;$('saveLocationBtn').disabled=!ok;$('resultInput').textContent=raw||'—';$('resultCoordinate').textContent=coord?`${coord[0].toFixed(6)}, ${coord[1].toFixed(6)}`:'Không có trong nội dung dán';$('resultAddress').textContent=address||'Không có trong nội dung dán';$('mapQueryText').textContent=ok?`Vị trí: ${query()}`:'Vị trí: —';$('locationStatus').className=`status-pill ${ok?'high':'low'}`;$('locationStatus').textContent=ok?'Đã nạp':'Chưa nạp'}
  function suggest(text){const n=norm(text);return roads().filter(r=>[r,r.replace(/^Đường\s+/i,''),...(ALIASES[r]||[])].some(x=>{const z=norm(x);return z.length>=4&&n.includes(z)}))}
  function loadLocation(value=$('googlePasteInput').value){raw=String(value||'').trim();coord=extractCoord(raw);address=extractAddress(raw);resetMap();if(!raw){msg('Hãy dán tọa độ, địa chỉ hoặc link Google Maps.','error');updateLocation();return}suggest(raw).slice(0,3).forEach((r,i)=>{const f=segs(r)[0];slots[i]={road:r,segmentId:f?.id||''}});msg(coord?'Đã nạp vị trí. Mở bản đồ rồi chọn 2–3 tuyến cần so sánh.':'Đã nạp địa chỉ/tên điểm. Bản đồ sẽ tìm theo nội dung này.','success');updateLocation();renderSlots()}
  function showMap(){if(!query())return;if(!mapLoaded){$('mapFrame').src=`https://maps.google.com/maps?q=${encodeURIComponent(query())}&z=17&output=embed`;mapLoaded=true}$('mapFrame').classList.remove('hidden');$('mapPlaceholder').classList.add('hidden');$('toggleMapBtn').textContent='Ẩn bản đồ'}
  function hideMap(){$('mapFrame').classList.add('hidden');$('mapPlaceholder').classList.remove('hidden');$('toggleMapBtn').textContent='Hiện bản đồ'}
  function roadOptions(v){return ['<option value="">— Chọn tuyến —</option>',...roads().map(r=>`<option value="${esc(r)}"${r===v?' selected':''}>${esc(r)}</option>`)].join('')}
  function segOptions(r,id){if(!r)return'<option value="">— Chọn tuyến trước —</option>';return segs(r).map(s=>`<option value="${esc(s.id)}"${s.id===id?' selected':''}>${esc(s.start)} → ${esc(s.end)}</option>`).join('')}
  function card(s,i){const x=seg(s.segmentId),als=s.road&&(ALIASES[s.road]||[]).length?(ALIASES[s.road]||[]).join(' · '):'—',src=x?`${x.source.appendix}, ${x.source.table}, trang ${x.source.pdfPage}, ${x.source.record}`:'—';return `<article class="manual-route-card${x?' active':''}" data-slot="${i}"><div class="manual-route-head"><span class="route-number">${i+1}</span><strong>Phương án tuyến ${i+1}</strong><button class="text-button clear-route-btn" type="button" data-slot="${i}">Xóa tuyến</button></div><div class="manual-route-fields"><div><label>Tuyến trong Quyết định</label><select class="road-select" data-slot="${i}">${roadOptions(s.road)}</select></div><div><label>Đoạn đường</label><select class="segment-select" data-slot="${i}">${segOptions(s.road,s.segmentId)}</select></div></div><div class="manual-route-meta"><span><b>Tên khác:</b> ${esc(als)}</span><span><b>Nguồn:</b> ${esc(src)}</span></div><div class="manual-factor-grid"><div><span>HS biến động thị trường – đất ở</span><strong>${x?fmt(x.factors.residential):'—'}</strong></div><div><span>HS biến động thị trường – TMDV</span><strong>${x?fmt(x.factors.commercial):'—'}</strong></div><div><span>HS biến động thị trường – SXPNN</span><strong>${x?fmt(x.factors.production):'—'}</strong></div></div></article>`}
  function renderSlots(){$('manualRouteGrid').innerHTML=slots.map(card).join('');$('selectedCount').textContent=`${slots.filter(s=>seg(s.segmentId)).length} tuyến`}
  const chosen=()=>slots.map(s=>({slot:s,segment:seg(s.segmentId)})).filter(x=>x.segment);
  function copy(){if(!query())return $('copyMessage').textContent='Chưa nạp vị trí.';const lines=['BẢO TÍN – KẾT QUẢ SO SÁNH TUYẾN NHÁP',`Vị trí: ${query()}`,...chosen().map((x,i)=>`${i+1}. ${x.segment.road}\n   Đoạn: ${x.segment.start} – ${x.segment.end}\n   Hệ số biến động thị trường: đất ở ${fmt(x.segment.factors.residential)}; TMDV ${fmt(x.segment.factors.commercial)}; SXPNN ${fmt(x.segment.factors.production)}\n   Nguồn: trang ${x.segment.source.pdfPage}, ${x.segment.source.record}`),'','Lưu ý: app chỉ đối chiếu tuyến/đoạn và hệ số đã nhập từ Quyết định; không tự đo khoảng cách.'];navigator.clipboard?.writeText(lines.join('\n')).then(()=>$('copyMessage').textContent='Đã sao chép kết quả.').catch(()=>$('copyMessage').textContent='Không thể sao chép tự động.')}
  function loadSaved(){try{const x=JSON.parse(localStorage.getItem(KEY)||'[]');return Array.isArray(x)?x:[]}catch(_){return[]}}
  const persist=()=>localStorage.setItem(KEY,JSON.stringify(saved));
  function saveCurrent(){if(!query())return $('savedMessage').textContent='Chưa nạp vị trí.';const now=new Date(),rec={schema_version:'1.2',id:crypto?.randomUUID?.()||`loc-${Date.now()}`,label:$('locationLabelInput').value.trim()||`Điểm ${now.toLocaleString('vi-VN')}`,note:$('locationNoteInput').value.trim(),saved_at:now.toISOString(),raw_input:raw,latitude:coord?.[0]??null,longitude:coord?.[1]??null,address:address||null,routes:chosen().map(x=>({road:x.segment.road,segment_id:x.segment.id,start:x.segment.start,end:x.segment.end,factors:{...x.segment.factors},source:{...x.segment.source}})),market_data_status:'empty',market_samples:[]};saved.unshift(rec);persist();renderSaved();$('savedMessage').textContent=`Đã lưu “${rec.label}”.`;$('savedCard').open=true}
  function renderSaved(){$('savedCount').textContent=`${saved.length} điểm`;$('savedTableBody').innerHTML=saved.length?saved.map(x=>`<tr><td><strong>${esc(x.label)}</strong></td><td>${esc(x.latitude!=null?`${Number(x.latitude).toFixed(6)}, ${Number(x.longitude).toFixed(6)}`:(x.address||x.raw_input||'—'))}</td><td>${x.routes?.length||0}</td><td>${esc(new Date(x.saved_at).toLocaleString('vi-VN'))}</td><td><button class="table-button load-saved-btn" data-id="${esc(x.id)}">Nạp lại</button><button class="table-button danger-button delete-saved-btn" data-id="${esc(x.id)}">Xóa</button></td></tr>`).join(''):'<tr><td colspan="5" class="empty-cell">Chưa có điểm đã lưu.</td></tr>'}
  function reload(id){const x=saved.find(v=>v.id===id);if(!x)return;$('googlePasteInput').value=x.raw_input||x.address||'';loadLocation($('googlePasteInput').value);slots=Array.from({length:3},(_,i)=>x.routes?.[i]?{road:x.routes[i].road,segmentId:x.routes[i].segment_id}:{road:'',segmentId:''});renderSlots()}
  function exportSaved(){const b=new Blob([JSON.stringify({exported_at:new Date().toISOString(),app_version:'V0.3.3',records:saved},null,2)],{type:'application/json;charset=utf-8'}),u=URL.createObjectURL(b),a=document.createElement('a');a.href=u;a.download=`Bao_Tin_Diem_Tra_Cuu_${new Date().toISOString().slice(0,10)}.json`;a.click();URL.revokeObjectURL(u)}
  $('googlePasteInput').addEventListener('paste',e=>{const t=e.clipboardData?.getData('text')||'';if(!t)return;e.preventDefault();$('googlePasteInput').value=t.trim().slice(0,2000);setTimeout(()=>loadLocation(t),20)});
  $('loadLocationBtn').onclick=()=>loadLocation(); $('gpsBtn').onclick=()=>navigator.geolocation?.getCurrentPosition(p=>{const t=`${p.coords.latitude.toFixed(6)}, ${p.coords.longitude.toFixed(6)}`;$('googlePasteInput').value=t;loadLocation(t)},()=>msg('Không lấy được vị trí hiện tại.','error'));
  $('clearBtn').onclick=()=>{$('googlePasteInput').value='';raw='';coord=null;address='';slots=Array.from({length:3},()=>({road:'',segmentId:''}));resetMap();updateLocation();renderSlots();msg('Đã xóa dữ liệu tra cứu.')};
  $('toggleMapBtn').onclick=()=>$('mapFrame').classList.contains('hidden')?showMap():hideMap(); $('openGoogleBtn').onclick=()=>query()&&window.open(`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query())}`,'_blank','noopener');
  $('manualRouteGrid').addEventListener('change',e=>{const i=Number(e.target.dataset.slot);if(!Number.isInteger(i)||!slots[i])return;if(e.target.classList.contains('road-select')){const r=e.target.value,f=segs(r)[0];slots[i]={road:r,segmentId:f?.id||''};renderSlots()}else if(e.target.classList.contains('segment-select')){slots[i].segmentId=e.target.value;renderSlots()}});
  $('manualRouteGrid').addEventListener('click',e=>{const b=e.target.closest('.clear-route-btn');if(!b)return;slots[Number(b.dataset.slot)]={road:'',segmentId:''};renderSlots()});
  $('copyBtn').onclick=copy; $('printBtn').onclick=()=>print(); $('saveLocationBtn').onclick=saveCurrent; $('exportSavedBtn').onclick=exportSaved; $('clearSavedBtn').onclick=()=>{if(saved.length&&confirm('Xóa toàn bộ điểm đã lưu?')){saved=[];persist();renderSaved()}};
  $('savedTableBody').addEventListener('click',e=>{const l=e.target.closest('.load-saved-btn'),d=e.target.closest('.delete-saved-btn');if(l)reload(l.dataset.id);if(d){saved=saved.filter(x=>x.id!==d.dataset.id);persist();renderSaved()}});
  const modal=$('legalModal');$('legalTab').onclick=()=>modal.classList.remove('hidden');modal.querySelector('[data-close-modal]').onclick=()=>modal.classList.add('hidden');modal.onclick=e=>{if(e.target===modal)modal.classList.add('hidden')};
  resetMap();updateLocation();renderSlots();renderSaved();
})();
