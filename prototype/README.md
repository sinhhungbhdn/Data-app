# Bảo Tín – Tra cứu giá đất V0.2.0

Bản nháp V0.2.0 tập trung vào một luồng duy nhất:

1. Sao chép tọa độ, đường dẫn hoặc toàn bộ nội dung ghim Google Maps.
2. Dán vào ô tra cứu.
3. Ứng dụng tự bóc tọa độ, nhận diện tên đường, chọn đoạn gần nhất và trả hệ số.
4. Chỉ mở mục “Điều chỉnh trường hợp đặc biệt” khi giả định mặc định không phù hợp.

## Giả định mặc định

- Loại đất: đất ở.
- Vị trí: tiếp giáp đường chính.
- Hệ số quy hoạch: 1,00 khi không có HSSD dự án được phê duyệt.
- Yếu tố khác: 1,00 khi chưa có căn cứ xác định trường hợp đặc biệt.

## Bản đồ

Bản đồ không tải khi mở ứng dụng. Chỉ sau khi có tọa độ và người dùng bấm “Hiện bản đồ”, ứng dụng mới tải khung Google Maps để kiểm tra trực quan. Cách này tránh lag và không phụ thuộc Leaflet hoặc localhost.

## Phạm vi dữ liệu

Dữ liệu mẫu mới gồm một phần Phụ lục I.1, Bảng 1 – Phường Biên Hòa. Hình học tuyến là dữ liệu minh họa, chưa được kiểm duyệt địa lý.
