# Bảo Tín - Thử nghiệm dữ liệu giá đất V0.4.0

Bản này chuyển trọng tâm sang kiểm thử dữ liệu pháp lý trước khi mở rộng ứng dụng.

## Dữ liệu đã nhập

- Quyết định 03/2026/QĐ-UBND.
- Phụ lục I.1 - Bảng 1 - Phường Biên Hòa.
- Đầy đủ TT 1 đến TT 107.
- 15 đoạn đường chính chuẩn và 2 dòng đặc thù Cù Lao Tân Vạn.
- 3 cột hệ số: đất ở, thương mại dịch vụ, sản xuất phi nông nghiệp/khoáng sản.
- Nguồn PDF trang 11 đến 21 của file `QD 03.2026-1-1500_compressed.pdf`.

## Luồng thử nghiệm

1. Dán tọa độ, địa chỉ, tên điểm hoặc link Google Maps.
2. Chọn tuyến và đoạn đường trong Quyết định.
3. Chọn tiếp giáp đường chính, đấu nối trực tiếp hoặc không trực tiếp.
4. Nếu là đường nhánh, nhập bề rộng và khoảng cách.
5. App tự xác định đúng TT, hệ số và trang PDF nguồn.
6. Có thể thêm tối đa 3 phương án để so sánh.

## Bảng giá đất Nhà nước

Hai file hiện có trên GitHub là Quyết định 03/2026 về hệ số điều chỉnh. Chưa có file chứa bảng giá đất Nhà nước, vì vậy V0.4.0 không tự tạo hoặc đoán đơn giá pháp lý. Mục giá kiểm thử chỉ dùng để kiểm tra công thức.

## Chạy ứng dụng

Giải nén và bấm `CHAY_UNG_DUNG.bat`. Phần dữ liệu pháp lý hoạt động offline; nút mở Google Maps cần Internet.
