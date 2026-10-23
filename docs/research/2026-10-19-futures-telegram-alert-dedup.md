# Giảm cảnh báo Telegram lặp lại — 19/10/2026

Đã triển khai phần thông báo vào worker thật lúc **09:40:28–09:40:47 ICT**, PID mới `2625541`; PM2 đã lưu. Chỉ thay ba module Telegram, không restart API. Trần lỗ vẫn **12u/ngày**, dự phòng6,1u, ngưỡng bảo vệ sớm−5,9u; guard mất giám sát15giây và cơ chế đối soát/tự phục hồi giao dịch giữ nguyên.

## Vì sao tin “bot đang gặp sự cố” quá nhiều

Bằng chứng tại09:16 cho thấy từ08:52 có **9 tin lỗi và4 tin phục hồi đã được Telegram xác nhận**. Nhóm này gồm lỗi đọc metadata, danh sách lệnh/lịch sử, giá BNB chưa có, lỗi GET tài khoản và lần dừng để cập nhật trước đó. Chuỗi lỗi đọc dữ liệu phụ chưa được nhận diện trong bộ lọc60giây nên đi thẳng vào thông báo khẩn; khi các nhóm lỗi thay nhau xuất hiện, mỗi chuỗi lại có dấu nhận dạng khác và tạo thêm tin.

Hai cảnh báo metadata có tin phục hồi sau44,6 và63,9giây; thời gian đó gồm cả30giây chờ khỏe của bản cũ. Không thể suy chính xác thời lượng mất dữ liệu vì outbox không lưu mọi callback. “Unavailable” ở bộ đọc nền đã bỏ nguyên nhân gốc, nên không quy tất cả thành mất mạng. Đây cũng không phải bằng chứng có9 lần đóng vị thế: snapshot và log chuyển trạng thái giới hạn32KiB cho thấy91khớp/79intents/4vịthế, chưa có chuyển trạng thái giao dịch/bảo vệ mới sau08:43:54 trong bằng chứng đã đọc. Không suy thành giám sát liên tục hoàn hảo.

## Cách thông báo mới

- Lỗi kỹ thuật được nhận diện rõ và có ngữ cảnh ví an toàn: chờ60giây, sau đó gửi **một cảnh báo cho cả đợt dữ liệu chập chờn**, dù metadata, lịch sử và giá thay nhau báo lỗi.
- Tiêu đề nhẹ là **“DỮ LIỆU TỪ SÀN CHƯA ỔN ĐỊNH”**; giải thích một số dữ liệu đang chậm hoặc chưa lấy được, bot đang kiểm tra lại. Vẫn ghi các vị thế và lãi/lỗ theo dữ liệu thật hiện có.
- Đợt kỹ thuật chỉ kết thúc sau **120giây khỏe liên tục**. Nếu cảnh báo đã gửi, phải có xác nhận Telegram trước khi gửi một tin phục hồi. Lỗi quay lại trong thời gian chờ được gộp vào cùng đợt. Thời gian này chỉ điều khiển thông báo; tự phục hồi giao dịch vẫn dùng30giây khỏe và các gate tài chính có sẵn.
- Tiền không khớp, thiếu mốc ngày, vị thế không thuộc bot, lệnh UNKNOWN hoặc chưa đối soát, lỗi dữ liệu và lỗi chưa nhận diện vẫn báo khẩn ngay. Thông báo dừng do bảo vệ rủi ro vẫn độc lập. Nếu cùng một chuỗi lỗi đọc dữ liệu chuyển sang trạng thái có lệnh UNKNOWN, dấu nhận dạng khẩn riêng bảo đảm không bị chống trùng của tin nhẹ chặn lại.
- Sửa thêm lỗi chống trùng có thể làm một đợt tái lỗi kéo dài bị im mãi: không đánh dấu lỗi là đang báo khi nó chỉ đang bị trì hoãn bởi cửa sổ5phút. Giữ nguyên outbox, ACK và nội dung lịch sử.

Bổ sung nhận diện GET `request_failed` thuộc danh sách đường dẫn đọc cụ thể, lỗi giá B5 missing/stale/disconnected và chuỗi metadata/orders/history unavailable chính xác; vẫn giữ các mẫu lỗi mạng, chuẩn bị nguồn và support pending đã có. Không áp dụng chung cho POST/DELETE, truy vấn kết quả order, mã lỗi sàn, dữ liệu sai hoặc mọi chuỗi có chữ “failed”. Nhóm đọc nền metadata/orders/history chỉ được trì hoãn khi có ví đã đối soát, delta0, không lệnh chưa rõ và không khóa tiền; thiếu ngữ cảnh ví thì nhóm này báo khẩn. Các lỗi GET/giá/mạng đã nhận diện vẫn có thể chờ khi chưa có ví, nhưng không tạo số PnL giả; có ngữ cảnh tài chính không an toàn thì chuyển báo khẩn.

Tin mở/đóng, lãi/lỗ từng coin, PnL ngày và báo cáo21giờ giữ như bản12u trước. Không thêm báo giá định kỳ, tạo giao dịch thử hoặc gửi tin Telegram giả. Một cảnh báo “worker stopped” của bản cũ trong lần restart để cập nhật được giữ nguyên; đó là sự kiện dừng thật, không xóa để làm đẹp số liệu.

## Kiểm chứng

**92 trường hợp mục tiêu PASS**, gồm26 trường hợp chính sách thông báo,25 formatter và41 trường hợp phân loại/an toàn. Có kiểm tra lỗi đổi nhóm trong cùng đợt, đợi60giây, khỏe120giây, ACK trước phục hồi, tái lỗi trong5phút, giữ cảnh báo tiền và hai đường nâng mức kỹ thuật→UNKNOWN. Kiểm tra ngoại tuyến không gọi mạng; các test body hiện hành chạy trên module đã emit bằng bộ nối matcher dùng `node:assert/strict`. Không gọi đây là full Vitest PASS hoặc semantic TypeScript PASS.

Emit ba module và cú pháp JavaScript đều PASS, source/artifact khóa SHA-256 trước deploy. Lượt92cases dùng heap64MB,51,54giây, tuổi quan sát cao nhất5.984,5ms; lượt emit thành công11,60giây, cao nhất3.999,1ms. Hai lượt emit trước phải dừng bảo vệ khi tuổi quan sát chạm khoảng9,1giây; giữ receipt thất bại, không bỏ khỏi gói. Lượt thành công giới hạn luồng compiler và ưu tiên I/O thấp nhưng tránh chế độ I/O idle bị đói trên máy đang chịu tải. Không nới guard giao dịch15giây hoặc ngưỡng dừng tác vụ9giây. Full Vitest và full semantic TypeScript chưa chạy trong lượt này vì tài nguyên máy đang giữ lệnh hạn chế.

Rà soát độc lập không còn blocker thông báo cụ thể sau khi bổ sung dấu nhận dạng theo mức độ và hai ca hồi quy. Chỉ thay `live-telegram`, `live-telegram-important-format`, thêm `live-telegram-error-policy`; mọi JavaScript production khác trong thư mục portfolio, bao gồm service12u, giữ nguyên hash. Không thay fileenv, ví, anchor, cursor hoặc sổ giao dịch bằng checkpoint cũ.

## Nghiệm thu sau cập nhật

Theo dõi từ **09:41:03 đến09:43:09 ICT**,59 mẫu trong khoảng2phút: tất cả active, đối soát đầy đủ/delta0, không khóa rủi ro hoặc lỗi nền trong mẫu. Tuổi quan sát lớn nhất6.803ms, khoảng cách tick được status ghi lớn nhất3.901ms; đây là hai số đo khác nhau, không dùng riêng số nhỏ hơn để khẳng định máy hoàn toàn ổn định.

**26 kiểm tra liên tục sổ/trạng thái đều PASS**: cấu hình/vốn đầu/anchor/ngày đã lưu, tiền và phí/funding đã chốt, cursor, lịch sử lệnh/khớp/thu nhập/sự kiện phục hồi, ACK Telegram và hash các module tài chính giữ nguyên. Trước/sau vẫn91khớp/79intents/4vịthế; không có lệnh do cập nhật. Không gọi GET kiểm toán độc lập mới trong lượt sửa thông báo này; đây là đối chiếu sổ thực đang được worker đối soát.

Telegram ready/important_only,0pending/0failed. Chỉ có thêm một tin dừng thật của bản cũ lúc09:40 và một tin phục hồi lúc09:41 trong cửa sổ checkpoint; cả hai đã ACK.5uncertain lịch sử vẫn đã ACK, không phải5tin mất. Không phát sinh đợt dữ liệu chậm đủ60giây trong cửa sổ sau cập nhật để chứng minh nhánh nhẹ bằng sự kiện thật; nhánh này đã được kiểm tra ngoại tuyến. PM2 đã lưu chỉ API/live online, legacyworker/paper/post-exit stopped.

## Bằng chứng và bước tiếp theo

Gói mới `docs/audits/futures-quick-win/telegram-alert-dedup-20261019` lưu source, test, module, kết quả và receipts đã loại định danh; các checkpoint đầy đủ giữ private ngoài repo. Các archive trước bất biến. Nếu phải rollback phần thông báo, chỉ khôi phục hai module Telegram từ bản sao lưu, giữ service12u và ví/outbox hiện hành; module phân loại mới có thể để nguyên vì bản cũ không import. Không rollback wallet hoặc service15u.

Bản sửa này giảm thông báo quá mức, chưa sửa nguyên nhân máy chủ hoặc chứng nhận giám sát24/24/PnL tốt hơn. Hướng tiếp theo vẫn là đo thời gian từng giai đoạn rồi thử ghi status không chặn và lấy giá WebSocket mới sau REST theo [nghiên cứu ổn định giám sát](2026-10-19-futures-monitoring-stability-research.md), kiểm chứng riêng trước khi áp dụng. Không tự mở goal hoặc chạy lại nghiên cứu chiến lược trong lượt này.
