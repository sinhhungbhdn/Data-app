# Kiểm tra dữ liệu V0.5.0

- Tổng số trang nguồn: 3.307.
- Phụ lục I.1: 17.156 dòng.
- Phụ lục I.2: 16.853 dòng.
- Tổng cộng: 34.009 dòng.
- Số địa bàn: 95.
- Số bảng dữ liệu: 190.
- Dòng điều kiện có cấu trúc số hoàn chỉnh để dò tự động: 17.743.
- Dòng điều kiện chỉ phân tích được một phần: 1.917.
- Dòng điều kiện phức tạp phải chọn nguyên văn: 80.
- Các TT trùng hoặc đánh lại số trong chính PDF được giữ nguyên và phân biệt bằng trang PDF + mã dòng.
- Một ô hệ số tại Phụ lục I.2, Bảng 29, TT 201 bị watermark chồng chữ. Dữ liệu đánh dấu hiệu chỉnh 1,19 dựa trên các dòng cùng nhóm điều kiện liền kề; kết quả luôn hiện cảnh báo khi chọn dòng này.

## Nguyên tắc an toàn

Ứng dụng chỉ tự kết luận khi điều kiện bề rộng và khoảng cách được phân tích đầy đủ và chỉ có một dòng khớp. Khi dữ liệu nguồn có phạm vi chồng lấn, diễn đạt phức tạp hoặc thiếu điều kiện cấu trúc, ứng dụng đưa ra danh sách ứng viên để người dùng chọn và kiểm tra trang PDF.
