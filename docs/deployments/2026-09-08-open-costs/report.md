Đã triển khai sửa lỗi kế toán lúc **09:51:45 ngày 08/09/2026 ICT**.

- Đồng bộ ví Binance chạy lúc worker khởi động và mỗi 5 phút, độc lập với cờ mô phỏng `WORKER_ENABLE_TESTNET_SYNC=false`. Cờ mô phỏng vẫn tắt.
- Phí vào vị thế được đối chiếu từ userTrades theo đúng order ID, chiều, khối lượng và USDT. Chỉ cập nhật metadata của vị thế đang mở, không trừ thêm số dư. Bỏ qua dữ liệu thiếu/không khớp; không ghi đè nếu vị thế đóng trong lúc đọc dữ liệu sàn.
- Lệnh range hiện tại đã được cập nhật entry_fee từ 0 thành **0,01583375 USDT**. Ví nội bộ **34,25772102 USDT** khớp Binance, bao gồm funding đã phát sinh. Net của các lệnh đã đóng vẫn −5,72285361 USDT; không gộp lợi nhuận chưa thực hiện vào số này.

24 kiểm thử / 5 files đạt và TypeScript build thành công. Đối chiếu 177 JS hashes, API health, PID/PM2 ownership, cờ risk1 và range live. Hai lệnh bảo vệ có cùng algo ID, giá trigger, số lượng và reduce-only trước/sau triển khai. Không sửa chiến lược hay SL/TP, không đặt thêm lệnh.

**Goal còn active**: vị thế range đầu tiên vẫn mở; chưa có net đóng lệnh để chứng minh ROI+. Snapshot exchange lúc 09:52:23 có unrealized −0,1509 USDT, là giá trị tại thời điểm đó và chưa gồm chi phí đã trả. Theo dõi kết quả đóng, xác minh toàn bộ phí/funding trước khi đánh giá ROI. Không nới thêm tín hiệu chỉ vì vị thế đang âm tạm thời.

Bằng chứng: [verification.json](verification.json), [db-after.json](db-after.json), [exchange-after.json](exchange-after.json), [tests.log](tests.log), [scheduler-tests.log](scheduler-tests.log), [deployment-manifest.json](deployment-manifest.json). Backup build: backend/dist-pre-open-costs-20260908. Chỉ thay 3 module kế toán/lập lịch đã review; không đưa các prototype chiến lược nghiên cứu vào runtime.
