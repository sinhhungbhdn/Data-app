# Bảo Tín – Tra cứu giá đất V0.2.1

Bản nháp V0.2.1 giữ luồng dán thông tin Google Maps nhưng thay thuật toán vị trí theo Quyết định 03/2026/QĐ-UBND:

1. Bóc tọa độ và tên đường nếu có.
2. Tìm đường chính/đoạn đường gần nhất trong đúng dữ liệu mẫu.
3. Chỉ tự xác định “tiếp giáp đường chính” khi điểm nằm sát lớp hình học tuyến.
4. Nếu là đường nhánh, yêu cầu xác nhận đấu nối trực tiếp hay không trực tiếp, hiện trạng mặt đường, bề rộng và khoảng cách áp dụng.
5. Đối chiếu các ngưỡng 600 m, 400 m và 200 m để chọn đúng nhóm dòng trong Phụ lục I.1, Bảng 1.
6. Không trả hệ số khi chưa đủ căn cứ hoặc điểm quá xa lớp tuyến mà không nhận diện được tên đường.

## Quy tắc nguồn mẫu

- Đường chính: dòng TT gốc của đoạn.
- Đường nhánh đấu nối trực tiếp: 3 nhóm dòng kế tiếp.
- Đường nhánh không đấu nối trực tiếp nhưng thông ra: 3 nhóm dòng tiếp theo.
- Bề rộng ≥5 m: ngưỡng 600 m.
- Bề rộng từ ≥3 m đến <5 m: các ngưỡng 400 m và 600 m.
- Bề rộng <3 m: ngưỡng 200 m.

Khoảng cách hình học từ tọa độ đến lớp tuyến chỉ dùng để gợi ý. Khoảng cách áp dụng cho đường nhánh phải được kiểm tra theo hiện trạng thực tế.

## Bản đồ

Bản đồ không tải khi mở ứng dụng. Chỉ sau khi có tọa độ và người dùng bấm “Hiện bản đồ”, ứng dụng mới tải khung Google Maps để kiểm tra trực quan. Ứng dụng không phụ thuộc localhost hoặc Python.

## Phạm vi dữ liệu

Dữ liệu mẫu mới gồm một phần Phụ lục I.1, Bảng 1 – Phường Biên Hòa. Hình học tuyến là dữ liệu minh họa, chưa được kiểm duyệt địa lý.
