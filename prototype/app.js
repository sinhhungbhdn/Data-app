(() => {
  const segments = window.BAO_TIN_SEGMENTS || [];
  const $ = id => document.getElementById(id);
  const landLabels={residential:'Đất ở',commercial:'Đất thương mại, dịch vụ',production:'Đất cơ sở sản xuất phi nông nghiệp / khoáng sản'};
  const accessLabels={main:'Tiếp giáp đường chính',direct:'Đường nhánh đấu nối trực tiếp',indirect:'Đường nhánh không đấu nối trực tiếp nhưng thông ra'};
  let selected=segments[0], marker=null, selectedLine=null, autoSuggested=false;
  const map=L.map('map',{zoomControl:true}).setView([10.9562,106.8310],14);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,attribution:'© OpenStreetMap'}).addTo(map);
  const lines=new Map();
  segments.forEach(s=>{
    const line=L.polyline(s.geometry,{color:'#0b2b6d',weight:4,opacity:.65,dashArray:'8 7'}).addTo(map);
    line.bindTooltip(`${s.road}<br>${s.start} – ${s.end}`);
    line.on('click',()=>selectSegment(s,false));
    lines.set(s.id,line);
  });
  function fmt(n){return Number(n).toLocaleString('vi-VN',{minimumFractionDigits:2,maximumFractionDigits:2})}
  function fillRoads(){
    $('roadSelect').innerHTML='';
    segments.forEach(s=>{const o=document.createElement('option');o.value=s.id;o.textContent=`${s.road}: ${s.start} → ${s.end}`;$('roadSelect').appendChild(o)});
  }
  function parseCoord(v){const m=String(v).trim().replace(/[()]/g,'').split(/[;,\s]+/).filter(Boolean).map(Number);if(m.length<2||!Number.isFinite(m[0])||!Number.isFinite(m[1])||Math.abs(m[0])>90||Math.abs(m[1])>180)return null;return [m[0],m[1]]}
  function distPointSegment(p,a,b){
    const x=p[1],y=p[0],x1=a[1],y1=a[0],x2=b[1],y2=b[0],dx=x2-x1,dy=y2-y1;
    const t=Math.max(0,Math.min(1,((x-x1)*dx+(y-y1)*dy)/(dx*dx+dy*dy||1)));
    const lat=y1+t*dy,lon=x1+t*dx;
    const dLat=(y-lat)*111320,dLon=(x-lon)*111320*Math.cos(y*Math.PI/180);
    return Math.sqrt(dLat*dLat+dLon*dLon);
  }
  function nearest(p){let best=null;segments.forEach(s=>{let d=Infinity;for(let i=0;i<s.geometry.length-1;i++)d=Math.min(d,distPointSegment(p,s.geometry[i],s.geometry[i+1]));if(!best||d<best.d)best={s,d}});return best}
  function putPin(latlng,suggest=true){
    if(marker)marker.remove();
    marker=L.circleMarker(latlng,{radius:8,color:'#071b4b',weight:3,fillColor:'#d6a323',fillOpacity:1}).addTo(map).bindPopup('Vị trí tra cứu').openPopup();
    map.panTo(latlng);$('coordinateInput').value=`${latlng[0].toFixed(6)}, ${latlng[1].toFixed(6)}`;$('selectedCoordinate').textContent=`Tọa độ: ${latlng[0].toFixed(6)}, ${latlng[1].toFixed(6)}`;$('googleMapsLink').href=`https://www.google.com/maps?q=${latlng[0]},${latlng[1]}`;
    if(suggest){const n=nearest(latlng);if(n){selectSegment(n.s,true);$('coordinateMessage').textContent=`Gợi ý đoạn gần nhất khoảng ${Math.round(n.d)} m. Cần kiểm tra lại mốc pháp lý.`}}
  }
  function selectSegment(s,fromMap){
    selected=s;autoSuggested=!!fromMap;$('roadSelect').value=s.id;
    if(selectedLine)selectedLine.setStyle({color:'#0b2b6d',weight:4,opacity:.65,dashArray:'8 7'});
    selectedLine=lines.get(s.id);selectedLine.setStyle({color:'#d6a323',weight:7,opacity:1,dashArray:null});selectedLine.bringToFront();
    render();
  }
  function branchNote(){
    if($('accessTypeSelect').value==='main')return '';
    const surface=$('surfaceSelect').value==='paved'?'nhựa/bê tông':'đất/đá/sỏi/cấp phối';
    const width={gte5:'≥ 5 m','3to5':'từ 3 m đến dưới 5 m',lt3:'< 3 m'}[$('widthSelect').value];
    return `; mặt đường ${surface}, bề rộng ${width}, cách đường chính ${Number($('distanceInput').value||0)} m`;
  }
  function render(){
    if(!selected)return;
    const type=$('landTypeSelect').value,market=selected.factors[type],planning=Number($('planningFactor').value),other=Number($('otherFactor').value),total=market*planning*other;
    $('resultCommune').textContent=selected.commune;$('resultRoad').textContent=selected.road;$('resultSegment').textContent=`${selected.start} – ${selected.end}`;$('resultAccess').textContent=accessLabels[$('accessTypeSelect').value]+branchNote();$('resultLandType').textContent=landLabels[type];
    $('marketFactor').textContent=fmt(market);$('planningFactorResult').textContent=fmt(planning);$('otherFactorResult').textContent=fmt(other);$('totalFactor').textContent=fmt(total);$('formulaMarket').textContent=fmt(market);$('formulaPlanning').textContent=fmt(planning);$('formulaOther').textContent=fmt(other);
    $('legalSourceText').textContent=`Quyết định 03/2026/QĐ-UBND – ${selected.source.appendix}, ${selected.source.table}.`;$('sourcePage').textContent=`Trang PDF: ${selected.source.pdfPage}`;$('sourceRecord').textContent=`Mã: ${selected.id} / ${selected.source.record}`;
    $('confidenceText').textContent=autoSuggested?'Trung bình':'Đã chọn thủ công';
  }
  function toggleBranch(){const show=$('accessTypeSelect').value!=='main';$('branchConditions').classList.toggle('hidden',!show);render()}
  function copyResult(){
    const text=[`BẢO TÍN – KẾT QUẢ TRA CỨU NHÁP`,`Địa bàn: ${$('resultCommune').textContent}`,`Tuyến đường: ${$('resultRoad').textContent}`,`Đoạn: ${$('resultSegment').textContent}`,`Vị trí: ${$('resultAccess').textContent}`,`Loại đất: ${$('resultLandType').textContent}`,`Hệ số biến động: ${$('marketFactor').textContent}`,`Hệ số quy hoạch: ${$('planningFactorResult').textContent}`,`Yếu tố khác: ${$('otherFactorResult').textContent}`,`Hệ số tổng hợp: ${$('totalFactor').textContent}`,`${$('legalSourceText').textContent} ${$('sourcePage').textContent}`,`Lưu ý: dữ liệu hình học chưa kiểm duyệt.`].join('\n');
    navigator.clipboard?.writeText(text).then(()=>$('copyMessage').textContent='Đã sao chép kết quả.').catch(()=>$('copyMessage').textContent='Không thể sao chép tự động.');
  }
  fillRoads();putPin([10.9562,106.8310],true);
  map.on('click',e=>putPin([e.latlng.lat,e.latlng.lng],true));
  $('locateBtn').onclick=()=>{const p=parseCoord($('coordinateInput').value);if(!p){$('coordinateMessage').textContent='Tọa độ không hợp lệ.';return}$('coordinateMessage').textContent='';putPin(p,true);map.setView(p,16)};
  $('gpsBtn').onclick=()=>navigator.geolocation?navigator.geolocation.getCurrentPosition(p=>putPin([p.coords.latitude,p.coords.longitude],true),()=>$('coordinateMessage').textContent='Không lấy được vị trí hiện tại.'):$('coordinateMessage').textContent='Trình duyệt không hỗ trợ GPS.';
  $('clearPinBtn').onclick=()=>{if(marker){marker.remove();marker=null}$('coordinateMessage').textContent='Đã xóa ghim.'};
  $('roadSelect').onchange=()=>selectSegment(segments.find(s=>s.id===$('roadSelect').value),false);
  ['landTypeSelect','planningFactor','otherFactor','surfaceSelect','widthSelect','distanceInput'].forEach(id=>$(id).addEventListener('change',render));
  $('accessTypeSelect').onchange=toggleBranch;$('confirmBtn').onclick=()=>{autoSuggested=false;render();$('confidenceText').textContent='Đã xác nhận';$('coordinateMessage').textContent='Đã xác nhận đoạn và điều kiện. Dữ liệu vẫn ở trạng thái nháp.'};
  $('copyBtn').onclick=copyResult;$('printBtn').onclick=()=>window.print();$('resetBtn').onclick=()=>location.reload();
  $('manualTab').onclick=()=>document.querySelector('.search-panel').scrollIntoView({behavior:'smooth'});
  const modal=$('legalModal');$('legalTab').onclick=()=>modal.classList.remove('hidden');modal.querySelector('[data-close-modal]').onclick=()=>modal.classList.add('hidden');modal.onclick=e=>{if(e.target===modal)modal.classList.add('hidden')};
})();

(() => {
  const addStylesheet = href => {
    if (document.querySelector(`link[href="${href}"]`)) return;
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = href;
    document.head.appendChild(link);
  };

  addStylesheet('https://unpkg.com/leaflet@1.9.4/dist/leaflet.css');
  addStylesheet('patch-v0.1.1.css');

  const patch = document.createElement('script');
  patch.src = 'patch-v0.1.1.js';
  patch.defer = true;
  document.body.appendChild(patch);
})();
