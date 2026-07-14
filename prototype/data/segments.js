/*
 * Dữ liệu thử nghiệm V0.1.0.
 * Nội dung tuyến/đoạn/hệ số được nhập mẫu từ Phụ lục I.1, Bảng 1 – Phường Biên Hòa.
 * Hình học polyline chỉ phục vụ kiểm thử giao diện và thuật toán gần nhất; chưa kiểm duyệt địa lý.
 */
window.BAO_TIN_SEGMENTS = [
  {
    id: "BH-BHN-001",
    commune: "Phường Biên Hòa",
    road: "Đường Bùi Hữu Nghĩa",
    start: "Giáp ranh giới Thành phố Hồ Chí Minh",
    end: "Đường Nguyễn Tri Phương",
    factors: { residential: 1.26, commercial: 1.26, production: 1.26 },
    source: { appendix: "Phụ lục I.1", table: "Bảng 1", pdfPage: 11, record: "TT 1" },
    geometryStatus: "schematic",
    geometry: [[10.9503, 106.8182], [10.9521, 106.8218], [10.9541, 106.8250]]
  },
  {
    id: "BH-BHN-002",
    commune: "Phường Biên Hòa",
    road: "Đường Bùi Hữu Nghĩa",
    start: "Đường Nguyễn Tri Phương",
    end: "Công an phường Bửu Hòa (cũ)",
    factors: { residential: 1.26, commercial: 1.26, production: 1.26 },
    source: { appendix: "Phụ lục I.1", table: "Bảng 1", pdfPage: 12, record: "TT 8" },
    geometryStatus: "schematic",
    geometry: [[10.9541, 106.8250], [10.9562, 106.8277], [10.9581, 106.8300]]
  },
  {
    id: "BH-BHN-003",
    commune: "Phường Biên Hòa",
    road: "Đường Bùi Hữu Nghĩa",
    start: "Công an phường Bửu Hòa (cũ)",
    end: "Đường Nguyễn Thị Tồn",
    factors: { residential: 1.26, commercial: 1.26, production: 1.26 },
    source: { appendix: "Phụ lục I.1", table: "Bảng 1", pdfPage: 12, record: "TT 15" },
    geometryStatus: "schematic",
    geometry: [[10.9581, 106.8300], [10.9604, 106.8324], [10.9620, 106.8343]]
  },
  {
    id: "BH-BHN-004",
    commune: "Phường Biên Hòa",
    road: "Đường Bùi Hữu Nghĩa",
    start: "Đường Nguyễn Thị Tồn",
    end: "Đường Huỳnh Mẫn Đạt",
    factors: { residential: 1.26, commercial: 1.26, production: 1.26 },
    source: { appendix: "Phụ lục I.1", table: "Bảng 1", pdfPage: 13, record: "TT 22" },
    geometryStatus: "schematic",
    geometry: [[10.9620, 106.8343], [10.9642, 106.8360], [10.9662, 106.8375]]
  },
  {
    id: "BH-BHN-005",
    commune: "Phường Biên Hòa",
    road: "Đường Bùi Hữu Nghĩa",
    start: "Đường Huỳnh Mẫn Đạt",
    end: "Cầu Rạch Sỏi",
    factors: { residential: 1.26, commercial: 1.26, production: 1.26 },
    source: { appendix: "Phụ lục I.1", table: "Bảng 1", pdfPage: 13, record: "TT 29" },
    geometryStatus: "schematic",
    geometry: [[10.9662, 106.8375], [10.9685, 106.8390], [10.9704, 106.8404]]
  },
  {
    id: "BH-BHN-006",
    commune: "Phường Biên Hòa",
    road: "Đường Bùi Hữu Nghĩa",
    start: "Cầu Rạch Sỏi",
    end: "Cầu Ông Tiếp",
    factors: { residential: 1.26, commercial: 1.26, production: 1.26 },
    source: { appendix: "Phụ lục I.1", table: "Bảng 1", pdfPage: 14, record: "TT 36" },
    geometryStatus: "schematic",
    geometry: [[10.9704, 106.8404], [10.9730, 106.8421], [10.9751, 106.8436]]
  },
  {
    id: "BH-NTP-001",
    commune: "Phường Biên Hòa",
    road: "Đường Nguyễn Tri Phương",
    start: "Cầu Ghềnh",
    end: "Đường Nguyễn Ái Quốc",
    factors: { residential: 1.22, commercial: 1.22, production: 1.22 },
    source: { appendix: "Phụ lục I.1", table: "Bảng 1", pdfPage: 15, record: "TT 43" },
    geometryStatus: "schematic",
    geometry: [[10.9482, 106.8291], [10.9528, 106.8286], [10.9573, 106.8281]]
  },
  {
    id: "BH-NVL-001",
    commune: "Phường Biên Hòa",
    road: "Đường Nguyễn Văn Lung",
    start: "Đường Nguyễn Ái Quốc",
    end: "Mỏ đá Hóa An",
    factors: { residential: 1.30, commercial: 1.30, production: 1.30 },
    source: { appendix: "Phụ lục I.1", table: "Bảng 1", pdfPage: 15, record: "TT 50" },
    geometryStatus: "schematic",
    geometry: [[10.9573, 106.8281], [10.9587, 106.8248], [10.9601, 106.8213]]
  },
  {
    id: "BH-TVO-001",
    commune: "Phường Biên Hòa",
    road: "Đường Trần Văn Ơn",
    start: "Đường Bùi Hữu Nghĩa",
    end: "Giữa ranh thửa 9 và thửa 8, tờ BĐĐC 124",
    factors: { residential: 1.19, commercial: 1.19, production: 1.19 },
    source: { appendix: "Phụ lục I.1", table: "Bảng 1", pdfPage: 16, record: "TT 57" },
    geometryStatus: "schematic",
    geometry: [[10.9560, 106.8275], [10.9583, 106.8320], [10.9607, 106.8365]]
  },
  {
    id: "BH-NAQ-001",
    commune: "Phường Biên Hòa",
    road: "Đường Nguyễn Ái Quốc",
    start: "Giáp ranh giới Thành phố Hồ Chí Minh",
    end: "Cầu Hóa An",
    factors: { residential: 1.19, commercial: 1.19, production: 1.19 },
    source: { appendix: "Phụ lục I.1", table: "Bảng 1", pdfPage: 17, record: "TT 64" },
    geometryStatus: "schematic",
    geometry: [[10.9467, 106.8317], [10.9520, 106.8310], [10.9573, 106.8281]]
  },
  {
    id: "BH-HMC-001",
    commune: "Phường Biên Hòa",
    road: "Đường Hoàng Minh Chánh",
    start: "Đường Nguyễn Ái Quốc",
    end: "Đường Bùi Hữu Nghĩa",
    factors: { residential: 1.20, commercial: 1.20, production: 1.20 },
    source: { appendix: "Phụ lục I.1", table: "Bảng 1", pdfPage: 17, record: "TT 71" },
    geometryStatus: "schematic",
    geometry: [[10.9520, 106.8310], [10.9544, 106.8330], [10.9562, 106.8351]]
  },
  {
    id: "BH-HMC-002",
    commune: "Phường Biên Hòa",
    road: "Đường Hoàng Minh Chánh",
    start: "Đường Nguyễn Ái Quốc",
    end: "Nghĩa trang Sùng Chính Phước Kiến (đường nối dài)",
    factors: { residential: 1.20, commercial: 1.20, production: 1.20 },
    source: { appendix: "Phụ lục I.1", table: "Bảng 1", pdfPage: 18, record: "TT 78" },
    geometryStatus: "schematic",
    geometry: [[10.9520, 106.8310], [10.9498, 106.8353], [10.9483, 106.8392]]
  }
];
