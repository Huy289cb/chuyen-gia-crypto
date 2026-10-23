# Sửa bỏ lỡ lịch quét BTC — 08/09/2026

Đã triển khai lúc **15:40:38 ICT**. MarketScan và LLMDispatch bật phục hồi lượt cron bị trễ. Khi CPU/event loop bị chậm, bot chạy bù bằng dữ liệu hiện tại. Bộ chặn theo giây lịch ngăn node-cron 3 phát lại cùng một mốc; bộ chặn đang chạy và durable claim tiếp tục ngăn xử lý lệnh trùng.

Kiểm thử tích hợp với node-cron thực và đồng hồ giả mô phỏng trễ 4, 7 và 610 giây, xác minh chỉ quét một lần với nến đã đóng mới nhất, kể cả tick trùng do phần mili giây. **23 kiểm thử/3 file đạt; full TypeScript build đạt.**

Chỉ thay hai module scheduler trong 177 file JS đang triển khai. Đối chiếu hash xác nhận các module chiến lược, executor và kế toán giữ nguyên. API khỏe; worker đã thực hiện lượt LLM tự động 15:41 và giữ cooldown đang có.

Đối soát Binance sau triển khai: không vị thế, không lệnh chờ/lệnh bảo vệ; ví **33,59964603 USDT**. Cấu hình thực của cả hai tiến trình giữ trần **1 USDT/lệnh**, **3%/ngày**, range live RR1,5.

Máy 956 MB RAM có swap và hai mẫu vmstat một giây ghi nhận CPU steal 54%, I/O wait 29–35% lúc build. Đây là quan sát ngắn, chưa phải trung bình dài hạn. Chạy tác vụ nghiên cứu lần lượt, ưu tiên CPU/I/O thấp và giới hạn heap để giảm tranh chấp tài nguyên với bot.

Bằng chứng: `deployment-manifest.json`, `verification.json`, `exchange-after.json`, `final-tests.log`, `build-final.log`, `resource-observation.json`.
