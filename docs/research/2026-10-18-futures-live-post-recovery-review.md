# Đánh giá worker sau phục hồi — 13:17:24 ICT18/10/2026

**Đợt kiểm tra chỉ đọc, không đổi code/config, restart hay đặt lệnh.** Worker active và4long BNB/ETH/SOL/XRP tiếp tục được quản lý; chưa có incident/đóng rổ kỹ thuật mới kể từ phục hồi12:50:57ICT. Tuy vậy, rà mã phát hiện2 lỗi tiềm ẩnP2 và1 vấn đề phân loại cảnh báoP3 cần xử lý. Kết quả vận hành tốt hiện tại không chứng minh các nhánh chưa xảy ra đều đúng.

## Kết quả tiền thật

Snapshot sàn lúc **13:17:24 ICT18/10/2026**, cùng một account response cho các số equity/PnL:

| Chỉ tiêu | USDT |
|---|---:|
| Vốn ban đầu | 31.47744546 |
| Cash hiện tại | 31.16003998 |
| Equity gồm lãi/lỗ đang mở | 31.28502266 |
| Net so với trước phục hồi | +0.084762 |
| Net của ngày18/10 | -0.000804 |
| Net toàn bộ từ lúc bật live | -0.192423 |
| Tổng phí thực đã trả | 0.20139548 |
| Funding thực đã ghi nhận | 0 |

Rổ mới đang dương sau phí mở0,04022048u; vị thế vẫn mở nên phần lời còn biến động và chưa trả phí đóng/trượt giá tương lai. Kết quả toàn bộ vẫn âm; khoảng thời gian sau triển khai còn ngắn, không suy thành mean0,2u/ngày hoặc kỳ vọng đã chứng minh.

Đối soát riêng13:13:25ICT:8/8 kiểm tra khớp — cash/income, commission, realized, funding, tradeIDs, quantities, không có open regular/algo order và mọi intent đã hoàn tất đối soát.22fills/20intents, không tăng thêm từ khi hoàn tất4lệnh phục hồi. Ngưỡng15u/ngày, soft−8,9u/buffer6,1u giữ nguyên; worst ngày−0,18733953u, breach0.

## Vận hành

PM2 worker2286749 không restart từ lần deploy12:49; bot cũ/paper/post-exit vẫn stopped. Log sau deploy chỉ có5transition của rổ phục hồi, không có structured error/watchdog hoặc incident mới. Không có telemetry cho mọi tick của toàn bộ thời gian, nên không chứng nhận max gap toàn khoảng từ12:49 chỉ bằng log này.

Mẫu hiện tại **120giây/61trạng thái**: WebSocket đủB5 trong61/61mẫu; blocked0, background error0, PID không đổi. Nhịp quan sát trung vị2003ms, lớn nhất2992ms; reconnect0 ở cả hai socket cuối mẫu.

Telegram snapshot13:13ICT:59ACK/pending0/failed0;22/22 fill thật có sự kiện thông báo tương ứng.4cờ uncertain đều thuộc cảnh báo dừng worker trong các lượt triển khai, đã gửi lại và nhậnACK; cờ không mang nghĩa4tin đang mất. Không có trade/recovery event uncertain. Không đủ bằng chứng để loại trừ người nhận từng nhận trùng lần gửi đầu không cóACK.

## Các phát hiện cần sửa

### P2 — điều kiện sẵn sàng có thể dùng dữ liệu mới chưa được kiểm tra

[refresh:475](/home/ubuntu/chuyen-gia-crypto/backend/src/portfolio/live-service.ts:475) chụp auxiliaryA rồi chờ account/positions và kiểm tra metadata/orders củaA. [supportReady:536](/home/ubuntu/chuyen-gia-crypto/backend/src/portfolio/live-service.ts:536) đọc lại cache nềnB. NếuB xuất hiện trong lúc chờ, nó có thể thỏa độ mới và cấp quyền giao dịch trong khi observation vẫn dùngA.

Đã tái hiện ngoại tuyến trên các hàm compiled đang triển khai, với broker giả và không network/POST: observationA dùng danh sách lệnh rỗng cũ nên qua ownership; snapshotB vừa publish chứa foreign order, nếu kiểm tra thì phải chặn; supportReady vẫn trảtrue nhờ timestamp củaB. Đây là tái hiện lỗi nhất quán snapshot, chưa phải bằng chứng có lệnh ngoài bot hoặc sự cố tiền thật trên tài khoản hiện tại.

Cần gắn readiness vào đúng snapshot/revision đã được kiểm tra và áp dụng; snapshot mới chỉ được cấp quyền sau khi được validate. Ưu tiên sửa trước.

### P2 — lỗi tải nguồn thông thường lúc07 có thể bỏ cả lượt cân đối ngày

[live-worker:13](/home/ubuntu/chuyen-gia-crypto/backend/src/portfolio/live-worker.ts:13) chỉ cho retry cùng ngày khi đang technical recovery. Khi job thông thường thất bại, pending=false và không có target; [live-service:669](/home/ubuntu/chuyen-gia-crypto/backend/src/portfolio/live-service.ts:669) tiêu thụ cursor ngay, dù cửa sổ60giây chưa hết. Kết nối hồi phục sau đó cũng không thử nguồn ngày đó nữa.

Không ảnh hưởng việc giám sát vị thế đang giữ, nhưng có thể bỏ lỡ cân đối hoặc mở rổ theo lịch. Chưa xảy ra trên lượt07 tiếp theo của bản mới. Đây là khoảng thiếu của chính sách phục hồi; test hiện tại còn xác nhận một lần thử cho source thông thường, nên việc173test PASS không loại trừ vấn đề. Cần retry có giới hạn trong cửa sổ và chỉ chốt cursor khi đã xử lý hoặc hết hạn; không tự tạo lệnh trùng.

### P3 — chờ công bố fill/phí bị báo thành lỗi nghiêm trọng

[live-telegram:212](/home/ubuntu/chuyen-gia-crypto/backend/src/portfolio/live-telegram.ts:212) phân loại mọi reconciliation_required thành lỗi. Thực tế12:50:18 gửi “unresolved_or_partial_order” trong lúc ACK đã có và đang đợi history bất đồng bộ; sau đó đối soát bình thường, hoàn tất rổ12:50:57.

Cần tách chờ userTrades/commission của ACK đãFILLED khỏi UNKNOWN/PARTIALLY_FILLED thật. Trạng thái chờ bình thường dùng thông báo tiến độ; lỗi chưa rõ và quá hạn vẫn phải cảnh báo. Chưa thấy điểm này gây đặt trùng hoặc sai tiền.

## Kết luận và phạm vi

Đối soát tiền và lượt phục hồi đang chạy đúng trên dữ liệu đã quan sát. Hai lỗiP2 phía trên là nhánh tiềm ẩn đã xác định bằng mã/đối chiếu ngoại tuyến, cần sửa trước khi coi cơ chế phục hồi bao phủ đầy đủ. Các giới hạn mạng/VPS, anchorICT nghiêm ngặt và lãi chưa chốt là giới hạn đã biết, không tự gọi là bug mới. Không chạy build hoặc bộ test nặng trên máy đang giữ vị thế trong lượt review này.

Bằng chứng riêng: `/home/ubuntu/futures-live-evaluation-20261018T0611Z`. Bao gồm authenticated-check, latest-account-snapshot, runtime120giây, logsummary và snapshot-race-reproduction; không chứa API key/secret hoặc Telegram recipients trong bản báo cáo này.
