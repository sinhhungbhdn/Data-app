# Bảo Tín – Tra cứu giá đất & hệ số điều chỉnh

Bản nháp V0.1.2 dùng để kiểm thử luồng nghiệp vụ trước khi nhập toàn bộ dữ liệu của Quyết định 03/2026/QĐ-UBND.

## Thay đổi V0.1.2

- `CHAY_UNG_DUNG.bat` mở trực tiếp ứng dụng, không còn phụ thuộc localhost hay Python.
- Có `CHAY_LOCALHOST_TUY_CHON.bat` cho trường hợp cần chạy máy chủ cục bộ.
- Bản đồ chạy chế độ nhẹ: tắt hiệu ứng, giới hạn vùng/độ phóng đại và giảm số ô nền lưu đệm.
- Một ô duy nhất nhận tọa độ, đường dẫn Google Maps hoặc toàn bộ nội dung ghim đã sao chép.
- Ứng dụng tự bóc tọa độ, nhận diện tên đường nếu có, lọc các đoạn phù hợp rồi chọn đoạn gần nhất theo hình học mẫu.
- Nếu chỉ dán địa chỉ mà chưa có tọa độ, ứng dụng vẫn lọc theo tên đường và yêu cầu bổ sung tọa độ để chốt đoạn.

## Cách dùng khuyến nghị

1. Trên Google Maps, bấm vào vị trí cần tra cứu.
2. Sao chép dòng tọa độ màu xanh, ví dụ `10.926532, 106.798422`, hoặc sao chép đường dẫn Google Maps.
3. Dán vào ô “Tọa độ hoặc thông tin ghim Google Maps”.
4. Bấm “Tự lọc”.
5. Kiểm tra tuyến, đoạn và xác nhận điều kiện pháp lý.

## Phạm vi dữ liệu

Bản đầu chỉ nhập một số dòng tiêu biểu của Phụ lục I.1, Bảng 1 – Phường Biên Hòa. Hình học polyline trên bản đồ là dữ liệu minh họa, chưa được kiểm duyệt địa lý và không được dùng làm căn cứ nghiệp vụ.
