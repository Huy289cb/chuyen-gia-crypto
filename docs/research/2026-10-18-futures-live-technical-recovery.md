# Tự phục hồi giao dịch sau lỗi kỹ thuật — 18/10/2026

**ĐÃ TRIỂN KHAI; ĐÃ TỰ PHỤC HỒI RỔ THẬT TRONG NGÀY18/10.** Người dùng đã yêu cầu lỗi kỹ thuật phục hồi xong phải đối soát, kiểm tra rủi ro và tự chạy lại; giữ các ngưỡng bảo vệ lỗ và trần15u/ngày. Quyền mới này thay quy tắc giữ khóa kỹ thuật cả ngày trong [bản sửa giám sát trước](2026-10-18-futures-live-monitoring-fix.md).

## Hành vi

Worker vẫn giám sát tài khoản24/24. Khi mất giám sát thật quá15 giây trong lúc giữ vị thế, bot vẫn khóa kỹ thuật và đóng inventory thuộc bot. Sau đó chỉ tự vào lại khi đồng thời thỏa các điều kiện:

- Đã flat; không còn regular/algo order, intent chưa rõ hoặc fill chưa đối soát. Không tự gửi lại POST chưa xác định kết quả.
- Số dư và income thật khớp chính xác; phí, realized và funding được ghi từ nguồn xác thực. Không tạo fill hoặc coi tiền chưa giải thích là lợi nhuận.
- Setup/phí/filters, danh sách lệnh và lịch sử đã được lấy lại sau incident và fill cuối. Giá B5 WebSocket hiện tại vẫn trong giới hạn5 giây.
- Có ít nhất30 giây quan sát tốt liên tục, khoảng cách tối đa5 giây giữa các lần; một lần lỗi hoặc restart phải bắt đầu lại chuỗi kiểm tra sức khỏe.
- Nguồn B5 là nguồn nhân quả mới nhất của ngàyUTC hiện tại, dùng dữ liệu ngày đã đóng; tính lại khối lượng và dự phòng từ giá, bid/ask, equity, margin và anchor ngày hiện tại.

Mỗi incident có ID và journal riêng. Plan phục hồi cùng quyền gỡ khóa kỹ thuật được lưu trong một lần ghi nguyên tử, dùng executionID riêng; không quay lại cursor nguồn, không sửa timestamp của nguồn hoặc tái gửi intent cũ. Mỗi tick gửi tối đa một leg; phần chưa gửi hết hạn sau60 giây, còn các leg đã gửi thì tiếp tục đợi đối soát dù ledger công bố muộn. SourceUTC mới thay thế plan cũ. Khởi động lại giữa rổ tiếp tục plan đã lưu, không tạo một lượt phục hồi thứ hai cho cùng incident.

Khóa kỹ thuật khi đang flat có thể đi qua nửa đêmICT: ghi ngày cũ đầy đủ, giữ anchor mới hợp lệ và kiểm tra lại30 giây. Không suy ra một anchor đã bị mất khi có vị thế; `missing_authenticated_ict_boundary` vẫn chặn tự phục hồi.

## Bảo vệ tiền giữ nguyên

Vốn đầu31,47744546u; ngân sách15u/ngàyICT, soft−8,9u/buffer6,1u; gross8, leverage10/cross/one-way, sourceB5 vol90 scalar6 và band20%. Không nạp/chuyển/reset ví, không đặt lại anchor, PnL, worst PnL hoặc phí để làm mới ngân sách trong ngày.

Mọi lý do dừng được ghi bền vững trong `currentDay.stopReasons`. Nếu một observation đồng thời có gap và chạm ngưỡng tiền, lý do tiền được ưu tiên; về flat hoặc hồi giá không xóa lý do đó. Ngưỡng lỗ ngày, close reserve, equity không dương, maintenance margin và thiếu anchor không được coi là lỗi kết nối để tự gỡ. Legacy latch kỹ thuật được kiểm thêm worst loss/breach đã lưu trước khi nhập vào quy trình mới; không tuyên bố khôi phục được các quan sát lịch sử chưa từng được ghi.

## Telegram

Outbox gửi một thông báo đang khôi phục theo incident sau khi plan đã được chấp nhận, và một thông báo đã tiếp tục giao dịch khi toàn bộ fill/cash thực đã đối soát. Khóa do tiền hoặc ACK chưa có fill không được báo là phục hồi hoàn tất. Mở/đóng lệnh, PnL, lỗi và báo cáo ngày tiếp tục dựa trên sổ thật.

## Kiểm chứng và triển khai

**173 kiểm thử khác nhau PASS, không có ca lỗi còn mở**: 139 ca cũ, 22 ca phục hồi, 8 ca chuẩn bị nguồn worker và4 ca Telegram bổ sung. Báo cáo hồi quy150 ca có phần giao với các báo cáo khác; tổng173 được đếm theo tên test và file, không cộng trùng. Scoped TypeScript PASS, kiểm tra cú pháp3 module PASS. Bản cuối chỉ cập nhật live-service/live-worker/live-telegram và source map; không thay env, broker, quota, source alpha hoặc cấu hình tiền.

Worker mới PID **2286749** đã chạy; API online, các worker cũ/paper/post-exit vẫn stopped và PM2 đã save. Incident được nhập vào quy trình lúc **12:49:41 ICT**, bắt đầu chuỗi khỏe từ12:49:45;17 quan sát tốt qua gần32 giây, sau đó tạo plan phục hồi. **12:50:57 ICT** đã đối soát đủ rổ và chuyển sang `resumed/active`.

Rổ thật đã khớp:

| Coin | Vị thế long |
|---|---:|
| BNBUSDT | 0,04 |
| ETHUSDT | 0,009 |
| SOLUSDT | 0,16 |
| XRPUSDT | 10,4 |

Đối soát xác thực **12:52:18 ICT**:4 lệnh mới đều FILLED, executedQty bằng observedFillQty; tổng22fills/20intents. Cash **31,16003998u**, equity sàn **31,17188150u**, available **23,12536682u**, unrealized **+0,01184152u** tại snapshot. Tổng phí **0,20139548u**, trong đó phí4fills phục hồi **0,04022048u**. Tổng actual income cộng bootstrap khớp cash chính xác; phí, trade IDs và quantities đều đối chiếu khớp. Không có regular/algo order còn treo. Floating PnL của worker và account được chụp ở các tick khác nhau; không coi chênh mark ngắn hạn là sai số cash. Các số equity/PnL tiếp tục thay đổi sau snapshot.

Checkpoint giữ nguyên config, owner/handoff, bootstrap, lịch sử ngày, anchor ngày **31,28582681u**, cashflow và cursor nguồn **1792281600000**, cùng toàn bộ18fills/16intents cũ. Chỉ gỡ khóa kỹ thuật sau kiểm tra; không xóa thua lỗ hoặc làm mới15u. Hai thông báo Telegram theo incident (`resuming`, `resumed`) đã nhận ACK gửi thành công.

Mẫu vận hành105,69 giây/54 trạng thái đi qua stabilizing→resuming→resumed, PID không đổi. Nhịp quan sát trung vị **2,0105 giây**, lớn nhất **3,118 giây**; cuối mẫu WebSocket đủB5, metadata/orders/history không lỗi và worker active. Đây là xác minh thực một lần phục hồi, không phải chứng nhận uptime hay lợi nhuận dài hạn.

[Bằng chứng và hash](../audits/futures-quick-win/live-technical-recovery-20261018/manifest.json) khóa các báo cáo test, manifest triển khai, runtime, đối soát sàn, checkpoint và Telegram đã làm sạch thông tin người nhận. Bản sao trước triển khai có dữ liệu riêng tư ở `/home/ubuntu/futures-live-technical-recovery-20261018/backup`. Khi rollback phải giữ checkpoint mới có22fills/20intents và4 vị thế thật, không phục hồi raw wallet trước triển khai. Khôi phục code không tự đóng các vị thế sàn.

Các ca chuẩn bị gồm: tái vào ngoài giờ07, chuỗi khỏe bị gián đoạn/restart, trùng gap với hard/soft/margin stop, unknownPOST, tiền/lệnh ngoài bot, nguồn sai thời gian, incident tiếp theo, qua ngày và ledger công bố muộn. Một lượt edge test ban đầu hết30 giây dưới tải biên dịch/hồi quy đồng thời; giữ kết quả thất bại, tăng riêng timeout test ghi đĩa lên90 giây và chạy lại. Timeout production/guard không đổi.

Tái vào sau sự cố làm thay đổi đường thực thi so với backtest chỉ mở một lần/ngày. Kiểm thử này chứng minh cơ chế và kế toán/rủi ro, không chứng minh kỳ vọng lợi nhuận mới. Mạng/sàn/VPS gián đoạn vẫn có thể gây đóng rổ và trượt giá vượt dự phòng.
