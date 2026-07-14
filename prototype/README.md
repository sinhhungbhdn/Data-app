# Bảo Tín – Tra cứu giá đất & hệ số điều chỉnh

Bản nháp V0.1.1 dùng để kiểm thử luồng nghiệp vụ trước khi nhập toàn bộ dữ liệu của Quyết định 03/2026/QĐ-UBND.

## Phạm vi bản đầu

- Giao diện nhận diện Bảo Tín: xanh navy, vàng, slogan “Giá trị thực – Dựng niềm tin”.
- Nhập tọa độ hoặc bấm trực tiếp trên bản đồ.
- Gợi ý đoạn gần nhất theo lớp hình học mẫu.
- Tra cứu thủ công tuyến/đoạn đường.
- Chọn loại đất, quan hệ đường chính/đường nhánh, bề rộng, khoảng cách.
- Tự tính hệ số quy hoạch theo HSSD của dự án và tự quy đổi hệ số yếu tố khác theo điều kiện đã xác nhận.
- Sửa lỗi Leaflet CSS làm nền bản đồ vỡ ô, tải giật.
- Chặn tọa độ nằm ngoài vùng dữ liệu mẫu để tránh tải sai khu vực.
- Hiển thị căn cứ phụ lục, bảng, trang PDF và mã dữ liệu.
- Sao chép kết quả và in phiếu.

## Dữ liệu mẫu

Bản đầu chỉ nhập một số dòng tiêu biểu của Phụ lục I.1, Bảng 1 – Phường Biên Hòa. Hình học polyline trên bản đồ là dữ liệu minh họa, chưa được kiểm duyệt địa lý và không được dùng làm căn cứ nghiệp vụ.

## Chạy thử

Ưu tiên bấm `CHAY_UNG_DUNG.bat`; hoặc mở `index.html` bằng trình duyệt có kết nối Internet. Ứng dụng dùng Leaflet và nền bản đồ OpenStreetMap qua CDN.

## Nguyên tắc mở rộng

1. Chốt mô hình dữ liệu và quy trình xác nhận trên bản nháp.
2. Kiểm duyệt mốc đầu, mốc cuối và hình học từng đoạn.
3. Nhập dữ liệu theo xã/phường, có trạng thái nháp/đã duyệt.
4. Chỉ công bố kết quả nghiệp vụ khi có căn cứ nguồn và lịch sử kiểm duyệt.
