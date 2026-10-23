# Cấu hình theo yêu cầu người dùng — 08/09/2026

Đã áp dụng lúc **20:58:10 ICT** và lưu PM2:

- Cooldown giao dịch **1 giờ**: sau đóng lệnh, sau lỗ, các tầng chuỗi thua, cooldown expectancy và re-entry sau hủy lệnh.
- Giới hạn lỗ/ngân sách rủi ro ngày **10%** theo equity đầu ngày.
- Trần mỗi lệnh **3% số dư hiện tại**, gồm rủi ro SL và dự phòng phí/trượt giá. Gỡ ưu tiên trần USD cố định bằng cách đặt biến đó rỗng; trần cũ 1 USDT được thay thế.

Với ví 33,59964603 USDT, trần mỗi lệnh là 1,0079893809 USDT. Đây là mức tối đa, không phải yêu cầu mỗi lần phải dùng hết 3%; target sizing0,5% và giới hạn exposure hiện có vẫn áp dụng.

Preflight chạy trên module dist hiện hành xác minh fallback phần trăm, cooldown đúng1h ở nhiều mức chuỗi thua và qua nửa đêm, trần giảm theo ví, tính cả phí/trượt giá và từ chối lot vượt trần. Đọc /proc xác minh toàn bộ biến mới của cả API và worker; API health OK. Không cần đổi hoặc biên dịch code; hash177 module JS giữ nguyên. Cooldown đã lưu trong tài khoản trước triển khai là null, không cần sửa lịch sử.

Đây là thay đổi do người dùng chỉ định, thay thế cấu hình ngày3%/lệnh1USDT ở các báo cáo nghiên cứu trước. Các nghiên cứu trước không được trình bày như bằng chứng ROI+ cho chính sách mới này.

Bằng chứng: `plan.json`, `preflight.json`, `deployment-manifest.json`, `verification.json`, `exchange-after.json`, `admission-after.json`. Bản sao cấu hình cũ lưu riêng với quyền0600.
