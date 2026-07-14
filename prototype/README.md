# Bảo Tín – Tra cứu giá đất & hệ số điều chỉnh

Bản nháp V0.1.0 dùng để kiểm thử luồng nghiệp vụ trước khi nhập toàn bộ dữ liệu của Quyết định 03/2026/QĐ-UBND.

## Phạm vi bản đầu

- Giao diện nhận diện Bảo Tín: xanh navy, vàng, slogan “Giá trị thực – Dựng niềm tin”.
- Nhập tọa độ hoặc bấm trực tiếp trên bản đồ.
- Gợi ý đoạn gần nhất theo lớp hình học mẫu.
- Tra cứu thủ công tuyến/đoạn đường.
- Chọn loại đất, quan hệ đường chính/đường nhánh, bề rộng, khoảng cách.
- Tính hệ số tổng hợp từ hệ số thị trường, quy hoạch và yếu tố khác.
- Hiển thị căn cứ phụ lục, bảng, trang PDF và mã dữ liệu.
- Sao chép kết quả và in phiếu.

## Dữ liệu mẫu

Bản đầu chỉ nhập một số dòng tiêu biểu của Phụ lục I.1, Bảng 1 – Phường Biên Hòa. Hình học polyline trên bản đồ là dữ liệu minh họa, chưa được kiểm duyệt địa lý và không được dùng làm căn cứ nghiệp vụ.

## Chạy thử

Mở `index.html` bằng trình duyệt có kết nối Internet. Ứng dụng dùng Leaflet và nền bản đồ OpenStreetMap qua CDN.

## Nguyên tắc mở rộng

1. Chốt mô hình dữ liệu và quy trình xác nhận trên bản nháp.
2. Kiểm duyệt mốc đầu, mốc cuối và hình học từng đoạn.
3. Nhập dữ liệu theo xã/phường, có trạng thái nháp/đã duyệt.
4. Chỉ công bố kết quả nghiệp vụ khi có căn cứ nguồn và lịch sử kiểm duyệt.
