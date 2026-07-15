# Bảo Tín – Tra cứu giá đất V0.3.1

## Luồng tra cứu mới

1. Dán tọa độ Google Maps.
2. Ứng dụng tải mạng đường thực tế quanh vị trí.
3. Xác định tối đa 3 đường/hẻm gần nhất, trong đó đường gần nhất được dùng làm đường tiếp cận.
4. Đối chiếu tên và mã đường với dữ liệu tuyến trong Quyết định.
5. Nếu đường tiếp cận chưa có tên riêng trong dữ liệu Quyết định, ứng dụng tìm tối đa 3 trục pháp lý gần nhất.
6. Khoảng cách đến trục pháp lý được tính theo mạng đường bằng dịch vụ định tuyến; nếu dịch vụ không trả kết quả thì ghi rõ khoảng cách thẳng dự phòng.
7. Hiển thị hệ số đất ở, thương mại dịch vụ, sản xuất phi nông nghiệp và trang PDF nguồn.

## Dịch vụ bản đồ

- OpenStreetMap/Overpass: mạng đường và tên/mã đường.
- OSRM: khoảng cách đi theo mạng đường.
- Google Maps nhúng: kiểm tra trực quan.

Bản này cần Internet để dò mạng đường. Kết quả phụ thuộc độ đầy đủ của dữ liệu bản đồ và dữ liệu Quyết định đã nhập trong app.

## Dữ liệu pháp lý

Hiện mới tích hợp một phần Phụ lục I.1, Bảng 1 – Phường Biên Hòa. Khi bổ sung toàn bộ dữ liệu, thuật toán không cần thay đổi cấu trúc.
