# Điều tra ổn định giám sát — 19/10/2026

Phạm vi chỉ đọc, không sửa bot hoặc đặt lệnh. Bằng chứng gồm `host-runtime-31s.json`, `host-runtime-summary.json`, `bounded-log-tail.json` và `findings.json` trong gói audit `daily12-telegram-20261019/monitoring/`. Mẫu lấy khoảng 08:24–08:25 ICT; ngưỡng bảo vệ 15 giây giữ nguyên. Việc đổi ngân sách thành 12u/ngày do luồng triển khai riêng xử lý.

## Điều đã xác nhận

- Log đuôi tối đa 32KB ghi sự cố lúc 08:20:42 ICT: khoảng cách quan sát 25,395 giây, tick 11,710 giây, đóng bảo vệ vì `live_monitoring_gap`; bot active lại lúc 08:22:00. Chưa có thời gian từng phần để kết luận nguyên nhân chính xác.
- Mẫu 30,573 giây, 29 lần đọc không có khoảng gián đoạn 15 giây: khoảng cách lớn nhất 4,299 giây, giá không cũ, không khóa. CPU steal 59,143%, iowait 17,741%; luồng chính đợi CPU 7,804 giây; swap vào 14.535 pages/ra 10.022 pages, 14.612 major faults. MemAvailable thấp nhất 393.764 KB nhưng PSI IO `some` vẫn khoảng 68–72%, memory `some` khoảng 31–37%. Không thể coi RAM available là bằng chứng hết áp lực.
- Mã đang có WebSocket riêng, REST tối đa 3 giây/không tự thử lại lệnh đọc, metadata/history chạy nền, nhịp 2 giây tính từ đầu tick. Đây là những cơ chế đã có, không đề xuất lại như tính năng mới.
- Tick vẫn đợi `recordLiveWorkerStatus`, và hàm ghi trạng thái dùng fsync file + thư mục. Trạng thái chỉ khoảng 2,2KB; ví khoảng 323KB/outbox khoảng 274KB ở mốc đọc. Tách trạng thái khỏi đường chờ là ứng viên sửa hẹp; chưa có bằng chứng fsync trạng thái gây sự cố.
- Snapshot giá lấy cùng lúc với REST account/position, rồi kiểm tra độ mới khi REST xong. Nếu WebSocket có giá mới trong khi chờ, snapshot cũ vẫn bị kiểm: có khả năng báo giá cũ do thứ tự đọc. Cần kiểm thử có kiểm soát trước khi sửa.

## Ưu tiên cụ thể

1. Đo thời gian trễ lịch, REST account/position, ghi ví, xuất trạng thái và tuổi giá; ghi tổng hợp mỗi 60 giây với hàng đợi giới hạn. Dùng `monitorEventLoopDelay` ở tần suất thấp và `eventLoopUtilization`; không gửi từng mẫu sang Telegram. Tách việc build/backtest/batch khỏi máy giữ lệnh.
2. Thử bộ xuất trạng thái chỉ giữ một bản mới nhất, hàng đợi giới hạn, atomic rename, vòng rủi ro không phải chờ. Giữ nguyên fsync của ví, intents, nguồn và ACK Telegram; không sửa chung `writeJsonAtomic`. Kiểm thử trường hợp đĩa ghi trạng thái bị chậm mà nhịp quan sát vẫn tiếp tục.
3. Thử đọc giá WebSocket mới nhất sau khi REST account/position hoàn tất, vẫn giữ kiểm tra độ mới 5 giây. Kiểm thử REST chậm có giá WebSocket mới; giá cũ, kết nối đứt và bản tin phát lại vẫn phải chặn.
4. Nếu khi không có tác vụ nền mà steal/swap/IO vẫn cao, chuyển execution sang máy cách ly theo cơ chế bàn giao một chủ đặt lệnh; không chạy hai bot cùng đặt lệnh. Giữ nguyên sổ tiền, anchor, cursor và intents; đối soát trước khi vào. Chưa tự di chuyển hoặc thay dịch vụ trả phí.

Không tăng guard 15 giây để che mất quan sát. Không tắt fsync sổ tiền, không swapoff/drop cache/đổi sysctl thiếu bằng chứng. Không gọi bot ổn định 24 giờ chỉ vì mẫu 31 giây sạch. Giảm gián đoạn có thể giảm phí đóng/mở lại; chưa chứng minh PnL ròng sẽ dương hoặc mọi khoản lỗ trước đều do kỹ thuật.

## Nguồn kỹ thuật chính thức

[Linux PSI](https://www.kernel.org/doc/html/latest/accounting/psi.html) giải thích thời gian tác vụ bị đình trệ do CPU, bộ nhớ hoặc IO, cùng cách giảm tải/di chuyển việc. [Linux proc](https://www.kernel.org/doc/html/latest/filesystems/proc.html) định nghĩa thống kê tài nguyên và steal. [Node perf_hooks](https://nodejs.org/api/perf_hooks.html#perf_hooksmonitoreventloopdelayoptions) hỗ trợ đo độ trễ vòng sự kiện. Những nguồn này hỗ trợ phương pháp đo; chúng không tự chứng minh nguyên nhân sự cố cụ thể trên máy hiện tại.

## Lộ trình kiểm chứng giới hạn

- Mốc1: bổ sung đo từng giai đoạn ở tần suất thấp, kiểm thử rằng phần đo không tạo thêm chờ trên đường đặt/đóng lệnh; dùng dữ liệu để phân biệt chờCPU, REST và ghiđĩa. Không chạy build/backtest nặng cùng lúc giữlệnh trên máy hiện tại.
- Mốc2: đúng một candidate xuất trạng thái không chặn; thử giả lập ghi status chậm >15s và xác nhận nhịp quan sát vẫn tiến, hàng đợi không tăng vô hạn, không ghi đè snapshot mới bằng snapshot cũ. Sổ tiền/intents/ACK vẫn fsync, stop thật vẫn giữ15s.
- Mốc3: đúng một candidate lấy snapshot WS sau REST; thử REST chậm khi WS vẫn cập nhật, cùng với giá stale thật, mất một coin, timestamp tương lai/replay và quote bất nhất. Chỉ sửa thứ tự lấy quan sát khi đủ test, không giảm chuẩn freshness.
- Mốc4: đối chiếu cửa sổ vận hành có/không batch và số lần đóng/phí kỹ thuật; nếu áp lực host vẫn cao khi nghỉ thì chuẩn bị bàn giao máy mộtchủđặtlệnh. Đây là điều kiện cần phân tích, chưa tự mua/move host hoặc hứa loại hết gap.

Lượt user này đã triển khai hạ trần ngày và Telegram theo biên bản riêng; nghiên cứu này chưa thay đổi cơ chế giám sát. Ngân sách12u/ngày, dựphòng6,1u/ngưỡngmềm−5,9u, guard15giây giữ trong mọi candidate. Trần phần mềm không bảo đảm chống vượt mức khi thị trường/mạng/máy chủ gián đoạn; không đổi mô phỏng15u thành chứng nhận12u.
