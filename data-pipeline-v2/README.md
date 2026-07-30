# NQ28 data pipeline v2

Mục tiêu của nhánh này là thử nghiệm lớp đọc dữ liệu mới mà không ảnh hưởng ứng dụng đang chạy trên `main`.

## Nguyên tắc

- File `.doc` gốc được giữ nguyên.
- LibreOffice chỉ dùng để chuyển tạm sang HTML có cấu trúc bảng.
- Dữ liệu chính được trích theo `table -> row -> cell`, không đọc thành một khối TXT.
- Xuống dòng trong cùng một ô được giữ ở `raw_text` và hiển thị bằng ký hiệu `⏎` trong file xem nhanh.
- Mỗi hàng bảng nguồn luôn nằm trên đúng một dòng của `raw-table-rows-preview.txt`.
- `rowspan` và `colspan` được bung thành ma trận logic nhưng vẫn giữ tọa độ ô gốc.

## Kết quả sinh tự động

Workflow ghi dữ liệu vào:

```text
generated/nq28/
├─ index.json
├─ extraction-report.json
├─ raw-table-rows-preview.txt
└─ raw-table-rows-0001.jsonl ...
```

Đây mới là lớp RAW để kiểm tra khả năng đọc bảng. Chưa thay thế dữ liệu runtime của app.
