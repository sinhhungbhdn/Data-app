/* Dữ liệu thử nghiệm đầy đủ Phụ lục I.1 - Bảng 1 - Phường Biên Hòa. */
(() => {
  const manifest = {"datasetId":"QD03-2026-I1-B1-BIENHOA","datasetVersion":"0.4.0","documentNumber":"03/2026/QĐ-UBND","documentDate":"2026-05-11","appendix":"Phụ lục I.1","table":"Bảng 1","commune":"Phường Biên Hòa","pdfFile":"QD 03.2026-1-1500_compressed.pdf","pdfPages":[11,21],"rowCount":107,"standardSegmentCount":15,"specialRowCount":2,"validation":{"ttSequential":true,"factorColumnsPresent":true,"status":"extracted-and-checked"},"statePriceData":{"status":"missing-source","rowCount":0,"message":"Chưa có file Bảng giá đất Nhà nước trong kho dữ liệu hiện tại."}};
  const segments = [{"baseTt":1,"road":"Đường Bùi Hữu Nghĩa","start":"Giáp ranh giới thành phố Hồ Chí Minh","end":"Đường Nguyễn Tri Phương","factors":{"residential":1.26,"commercial":1.26,"production":1.26}},{"baseTt":8,"road":"Đường Bùi Hữu Nghĩa","start":"Đường Nguyễn Tri Phương","end":"Công an phường Bửu Hòa (cũ)","factors":{"residential":1.26,"commercial":1.26,"production":1.26}},{"baseTt":15,"road":"Đường Bùi Hữu Nghĩa","start":"Công an phường Bửu Hòa (cũ)","end":"Đường Nguyễn Thị Tồn","factors":{"residential":1.26,"commercial":1.26,"production":1.26}},{"baseTt":22,"road":"Đường Bùi Hữu Nghĩa","start":"Đường Nguyễn Thị Tồn","end":"Đường Huỳnh Mẫn Đạt","factors":{"residential":1.26,"commercial":1.26,"production":1.26}},{"baseTt":29,"road":"Đường Bùi Hữu Nghĩa","start":"Đường Huỳnh Mẫn Đạt","end":"Cầu Rạch Sỏi","factors":{"residential":1.26,"commercial":1.26,"production":1.26}},{"baseTt":36,"road":"Đường Bùi Hữu Nghĩa","start":"Cầu Rạch Sỏi","end":"Cầu Ông Tiếp","factors":{"residential":1.26,"commercial":1.26,"production":1.26}},{"baseTt":43,"road":"Đường Nguyễn Tri Phương","start":"Cầu Ghềnh","end":"Đường Nguyễn Ái Quốc","factors":{"residential":1.22,"commercial":1.22,"production":1.22}},{"baseTt":50,"road":"Đường Nguyễn Văn Lung","start":"Đường Nguyễn Ái Quốc","end":"Mỏ đá Hóa An","factors":{"residential":1.3,"commercial":1.3,"production":1.3}},{"baseTt":57,"road":"Đường Trần Văn Ơn","start":"Đường Bùi Hữu Nghĩa","end":"Chạm tới giữa ranh thửa đất số 9, tờ BĐĐC số 124 và thửa đất số 8, tờ BĐĐC số 124)","factors":{"residential":1.19,"commercial":1.19,"production":1.19}},{"baseTt":64,"road":"Đường Nguyễn Ái Quốc","start":"Giáp ranh giới thành phố Hồ Chí Minh","end":"Cầu Hóa An","factors":{"residential":1.19,"commercial":1.19,"production":1.19}},{"baseTt":71,"road":"Đường Hoàng Minh Chánh","start":"Đường Nguyễn Ái Quốc","end":"Đường Bùi Hữu Nghĩa","factors":{"residential":1.2,"commercial":1.2,"production":1.2}},{"baseTt":78,"road":"Đường Hoàng Minh Chánh","start":"Đường Nguyễn Ái Quốc","end":"Nghĩa trang Sùng Chính Phước Kiến (dự án đường Hoàng Minh Chánh nối dài)","factors":{"residential":1.2,"commercial":1.2,"production":1.2}},{"baseTt":85,"road":"Đường Huỳnh Mẫn Đạt","start":"Đường Bùi Hữu Nghĩa","end":"Giáp ranh mỏ đá BBCC cũ","factors":{"residential":1.31,"commercial":1.31,"production":1.31}},{"baseTt":92,"road":"Đường Phạm Văn Diêu","start":"Đường Bùi Hữu Nghĩa","end":"Giáp ranh giới thành phố Hồ Chí Minh","factors":{"residential":1.28,"commercial":1.28,"production":1.28}},{"baseTt":99,"road":"Đường Nguyễn Thị Tồn","start":"Đường Nguyễn Ái Quốc","end":"Đường Bùi Hữu Nghĩa","factors":{"residential":1.28,"commercial":1.28,"production":1.28}}];
  const pages = [11,11,11,11,11,11,11,11,11,12,12,12,12,12,12,12,12,12,12,12,13,13,13,13,13,13,13,13,13,13,13,14,14,14,14,14,14,14,14,14,14,14,15,15,15,15,15,15,15,15,15,15,15,15,16,16,16,16,16,16,16,16,16,17,17,17,17,17,17,17,17,17,17,17,18,18,18,18,18,18,18,18,18,19,19,19,19,19,19,19,19,19,19,19,20,20,20,20,20,20,20,20,20,20,20,21,21];
  const specials = [{"tt":106,"name":"Các tuyến đường tại Cù Lao Tân Vạn (đường D1, D4, D9, N2, N4)","factors":{"residential":1.19,"commercial":1.19,"production":1.19}},{"tt":107,"name":"Các tuyến đường tại Cù Lao Tân Vạn (các đường còn lại)","factors":{"residential":1.19,"commercial":1.19,"production":1.19}}];
  const factorsFor = segment => ({ ...segment.factors });
  const descriptions = {
    main: segment => `${segment.road}, đoạn từ ${segment.start} đến ${segment.end}`,
    directA: segment => `Các tuyến đường giao thông đấu nối trực tiếp ra ${segment.road}, đoạn từ ${segment.start} đến ${segment.end}, hiện trạng đường nhựa/bê tông xi măng; nhóm A`,
    directB: segment => `Các tuyến đường giao thông đấu nối trực tiếp ra ${segment.road}, đoạn từ ${segment.start} đến ${segment.end}, hiện trạng đường nhựa/bê tông xi măng; nhóm B`,
    directC: segment => `Các tuyến đường giao thông đấu nối trực tiếp ra ${segment.road}, đoạn từ ${segment.start} đến ${segment.end}, hiện trạng đường nhựa/bê tông xi măng; nhóm C`,
    indirectA: segment => `Các tuyến đường giao thông không đấu nối trực tiếp và thông ra ${segment.road}, đoạn từ ${segment.start} đến ${segment.end}, hiện trạng đường nhựa/bê tông xi măng; nhóm A`,
    indirectB: segment => `Các tuyến đường giao thông không đấu nối trực tiếp và thông ra ${segment.road}, đoạn từ ${segment.start} đến ${segment.end}, hiện trạng đường nhựa/bê tông xi măng; nhóm B`,
    indirectC: segment => `Các tuyến đường giao thông không đấu nối trực tiếp và thông ra ${segment.road}, đoạn từ ${segment.start} đến ${segment.end}, hiện trạng đường nhựa/bê tông xi măng; nhóm C`
  };
  const rows = [];
  segments.forEach(segment => {
    const specs = [
      ['main', null, 0], ['direct', 'A', 1], ['direct', 'B', 2], ['direct', 'C', 3],
      ['indirect', 'A', 4], ['indirect', 'B', 5], ['indirect', 'C', 6]
    ];
    specs.forEach(([relation, bucket, offset]) => {
      const tt = segment.baseTt + offset;
      const key = relation === 'main' ? 'main' : `${relation}${bucket}`;
      rows.push({
        tt, baseTt: segment.baseTt, road: segment.road, segmentStart: segment.start, segmentEnd: segment.end,
        relation, bucket, factors: factorsFor(segment), pdfPage: pages[tt - 1], description: descriptions[key](segment)
      });
    });
  });
  specials.forEach(item => rows.push({
    tt: item.tt, baseTt: item.tt, road: item.name, segmentStart: '', segmentEnd: '', relation: 'special', bucket: null,
    factors: { ...item.factors }, pdfPage: pages[item.tt - 1], description: item.name
  }));
  rows.sort((a, b) => a.tt - b.tt);
  window.BAO_TIN_QD03_DATA = { manifest, rows };
})();
