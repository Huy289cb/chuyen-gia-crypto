# Sửa lỗi worker Futures thật — 18/10/2026

**Đã triển khai lúc 13:50 ICT; nghiệm thu vận hành đến 13:52 ICT.** Hai lỗi P2 và cảnh báo P3 trong [đánh giá sau phục hồi](2026-10-18-futures-live-post-recovery-review.md) đã được sửa. Worker mới PID `2303579` đang giữ nguyên bốn vị thế thật. Không thay chiến lược, vốn, trần lỗ 15u/ngày, soft −8,9u, buffer 6,1u hoặc guard giám sát 15 giây.

## Các lỗi đã sửa

| Lỗi | Hành vi sau sửa | Bằng chứng |
| --- | --- | --- |
| Dữ liệu nền mới được công bố trong lúc đọc tài khoản có thể cấp quyền vào lệnh trước khi được kiểm tra | Mỗi quan sát mang theo đúng snapshot metadata/orders/history/intents đã áp dụng và kiểm tra. Cấp nguồn, tiếp tục kế hoạch và phục hồi dùng snapshot đó; cache mới phải chờ lượt kiểm tra kế tiếp. | 5 kiểm thử thực thi service với sàn giả: lệnh thường/lệnh algo bên ngoài, cấu hình leverage khác, lịch sử không thuộc bot và tiếp tục kế hoạch bền vững. Không gửi POST trước khi đối soát; nguồn còn được xử lý nếu dữ liệu hợp lệ trở lại trong hạn. |
| Tải nguồn 07:00 thất bại một lần rồi tiêu thụ cursor, bỏ cả lượt ngày | Giữ cursor trong thời gian chờ thử lại. Thử lại cách nhau tối thiểu 10 giây, không chồng công việc, tái dùng target đã chuẩn bị; chỉ trong cửa sổ 60 giây ban đầu. Tối đa sáu lần bắt đầu trong một cửa sổ liên tục; sau restart vẫn phải tuân thủ deadline/cursor. | 16 ca nguồn worker cùng kiểm thử service về chờ nguồn, hết hạn và chống gửi trùng. Nhịp thử lại phục hồi kỹ thuật ngoài cửa sổ vẫn là 60 giây. |
| Tick bắt đầu trước 07:00 nhưng đọc tài khoản xong sau 07:00 có thể tiêu thụ nguồn ngày mới | Worker truyền UTC epoch đã đánh giá; service giữ lượt ngày mới cho tick kế tiếp nếu tick cũ vượt mốc UTC. Không kéo dài deadline. | 2 ca mới vượt mốc trong lúc đọc tài khoản và quá hạn 60 giây. |
| ACK `FILLED` đang đợi lịch sử khớp/phí bình thường bị báo lỗi nghiêm trọng | Telegram báo đang đối soát tối đa 30 giây kể từ lúc tạo lệnh, chỉ khi ACK khớp đủ có danh tính hợp lệ, quan sát mới, không lỗi nền/khóa tiền và mọi intent chờ đều đạt điều kiện. Lỗi ngoài, UNKNOWN/PARTIAL, quá hạn hoặc lỗi rủi ro vẫn cảnh báo ngay. | 43 ca Telegram, gồm 21 ca bổ sung cho chờ công bố, hết hạn, ACK không hợp lệ, lỗi ngoài và chống lặp thông báo. |

Thời gian chờ Telegram chỉ thay cách thông báo. Engine vẫn chặn lệnh mới khi chưa đối soát; ACK không được dùng để tự tạo fill, phí hay PnL. Chênh lệch số dư được ghi là chưa phân loại.

## Kiểm chứng mã

**166 kiểm thử khác nhau PASS, 0 fail**, đã loại ca trùng giữa các lượt chạy:

| Nhóm | Số ca |
| --- | ---: |
| Snapshot và cấp quyền | 5 |
| Nguồn worker | 16 |
| Telegram notifier | 43 |
| Service | 26 |
| Phục hồi kỹ thuật | 22 |
| Giám sát | 8 |
| Dữ liệu nền | 17 |
| Định dạng Telegram | 10 |
| Vận chuyển Telegram | 19 |

Biên dịch TypeScript phạm vi portfolio và kiểm tra cú pháp ba file triển khai đều PASS. Đây là bộ kiểm thử liên quan bản sửa, không phải toàn bộ backend.

VPS có 2 CPU và khoảng 956 MB RAM. Lượt kiểm thử fork đầu và lượt biên dịch đầu được guard tự dừng khi tuổi quan sát vượt 7 giây; chỉ tiến trình kiểm tra bị dừng. Các lượt PASS chạy tuần tự, ưu tiên thấp trên CPU 1; khi biên dịch, worker tạm dùng CPU 0 rồi được trả affinity `0,1`. Không đổi ngưỡng giám sát 15 giây. Không có lệnh phát sinh hoặc đóng vị thế do các lượt kiểm tra này.

## Triển khai và đối soát thật

Chỉ thay `live-service`, `live-worker`, `live-telegram` cùng source map; đã sao lưu bản trước. Chỉ restart `crypto-portfolio-live`, PID `2286749 → 2303579`. Sau giai đoạn làm nóng dữ liệu nền, worker active trở lại lúc khoảng 13:50:19 ICT. `.env` không đổi; PM2 đã save. API online, legacy worker/post-exit/paper vẫn stopped.

Đối chiếu checkpoint trước/sau xác nhận nguyên vẹn config, định danh tài khoản/handoff, vốn ban đầu, toàn bộ trades/incomes/intents, số lượng và giá vốn vị thế, phí/PnL đã ghi nhận, cursor/source ID, lịch sử phục hồi, mốc tính lỗ ngày và các khóa tài chính. Không reset ví hay chuyển tiền.

Sàn xác nhận **13:50:39 ICT**:

- Vốn ban đầu `31,47744546u`; số dư tiền `31,16003998u`.
- Equity theo giá lúc chụp `31,31176685u`; PnL tổng gồm thả nổi `−0,16567861u`. Đây là snapshot biến động theo giá.
- Phí tổng `0,20139548u`; realized `−0,11601u`; funding `0`.
- **22 fills, 20 intents**, khớp ID với sổ và toàn bộ intent đã đối soát. Không có lệnh chờ thường/algo.
- Giữ long BNB `0,04`, ETH `0,009`, SOL `0,16`, XRP `10,4`; không phát sinh fill/intent do triển khai.
- Mốc vốn ngày `31,28582681u`, risk latch false, ngân sách ngày `15u`.

Quan sát tiếp từ **13:50:32–13:52:31 ICT**, 60 mẫu: toàn bộ active, không blocked/lỗi nền/khóa rủi ro hoặc quote chưa sẵn sàng; chênh lệch đối soát luôn 0. Khoảng quan sát median `1.990,5 ms`, lớn nhất `2.923 ms`; tick lâu nhất `1.503 ms`. Số fills/intents không đổi.

Telegram tại 13:51 ICT: **71 bản tin có ACK, pending 0, failed 0; đủ 22 thông báo cho 22 fills**. `uncertain=5` là những lần gửi trước từng thiếu xác nhận rồi được gửi lại và có ACK; không phải năm tin hiện còn chờ, cũng không bảo đảm không có tin trùng. Chưa có lệnh thật mới sau triển khai để kích hoạt nhánh chờ công bố; nhánh này được kiểm chứng ngoại tuyến.

## Phạm vi nghiệm thu và việc tiếp theo

Các lỗi đã có bằng chứng tái hiện và kiểm thử hồi quy; bản sửa đã chạy thật và đối soát đủ. Lượt nguồn 07:00 ICT kế tiếp và một ACK công bố chậm thật chưa xảy ra tại thời điểm nghiệm thu. Tiếp tục kiểm tra chúng qua status/journal/Telegram khi xảy ra; không tạo lệnh để thử hoặc tự mở lại nghiên cứu chiến lược.

Giữ cơ chế tự phục hồi kỹ thuật đã được người dùng cho phép: đối soát đủ, kiểm tra rủi ro và 30 giây khỏe trước khi tái vào; khóa do tiền hoặc thiếu mốc ngày không tự gỡ. Bản sửa vận hành này chưa chứng minh kỳ vọng lợi nhuận.

[Gói bằng chứng và checksum](../audits/futures-quick-win/live-bugfix-20261018/README.md). Bản sao lưu triển khai và checkpoint ví giữ riêng tại `/home/ubuntu/futures-live-bugfix-20261018/backup` và `wallet-deployment-checkpoint.private.json`. Nếu cần hoàn tác mã, dùng ba module cùng source map đã sao lưu rồi restart riêng worker khi đang có quan sát mới; **không khôi phục checkpoint ví cũ** vì sẽ xóa lịch sử thật phát sinh sau đó.
