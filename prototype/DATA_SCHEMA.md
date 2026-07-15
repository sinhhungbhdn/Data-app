# Cấu trúc dữ liệu thử nghiệm

Mỗi dòng dữ liệu hệ số gồm:

- `tt`: số thứ tự trong phụ lục.
- `road`: tuyến đường chính quy chiếu.
- `segmentStart`, `segmentEnd`: điểm đầu và điểm cuối của đoạn.
- `relation`: `main`, `direct`, `indirect` hoặc `special`.
- `bucket`: nhóm A/B/C theo bề rộng và khoảng cách.
- `factors`: hệ số cho đất ở, thương mại dịch vụ, sản xuất phi nông nghiệp.
- `pdfPage`: trang PDF nguồn.
- `description`: nội dung mô tả điều kiện áp dụng.

Bảng giá đất Nhà nước sẽ được lưu trong bộ dữ liệu riêng và liên kết bằng địa bàn, tuyến, đoạn, loại đất, vị trí và thời gian hiệu lực. Không trộn đơn giá Nhà nước với hệ số điều chỉnh của Quyết định 03/2026/QĐ-UBND.
