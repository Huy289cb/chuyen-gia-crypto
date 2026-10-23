# Đánh giá worker Futures thật — 18/10/2026

Kết luận tại **07:40:57ICT18/10**: đã giao dịch thật, nhưng **chưa đạt lợi nhuận trung bình dương**. Hai rổ ngày17 và18/10 đều tự đóng vì `live_monitoring_gap`; chưa phải một phép đo vận hành ổn định của chiến lược giữ rổ theo nguồn. Vốn thực31,47744546u; ngân sách cố định15u/ngày ICT vẫn giữ nguyên.

## Kết quả đã đối soát trực tiếp với Binance

| Chỉ tiêu | USDT |
|---|---:|
| Vốn ban đầu |31,47744546|
| Số dư ví/equity sau khi đóng hết |31,20026046|
| PnL đã chốt gộp |−0,11601000|
| Phí giao dịch thực |−0,16117500|
| Funding thực |0|
| Lãi/lỗ thả nổi |0|
| **Lãi/lỗ ròng** |**−0,27718500**|
| **Lợi suất trên vốn đầu** |**−0,880583%**|

18 lần khớp thuộc16 lệnh market (XRP lần đóng ngày18 được khớp thành3 phần). Tất cả intents FILLED và số lượng khớp đã đối soát đủ; không có chuyển tiền. Kiểm độc lập Decimal40: realized−fees+funding+unrealized bằng equity−vốn đầu, **sai số0**. Hiện không còn vị thế mở. Không trừ slippage ước lượng thêm vào PnL vì giá khớp thật đã phản ánh nó.

| Ngày ICT | PnL ròng | Diễn biến |
|---|---:|---|
|16/10, chỉ từ22:26 |0|Khởi tạo giữa ngày, chờ lịch nguồn|
|17/10 |−0,19161865|Mở4 long07:00:14–15, đóng08:24:39|
|18/10, đến07:40 |−0,08556635|Mở4 long07:00:13–14, đóng07:38:47–51|

Không coi18/10 là một ngày24 giờ hoàn tất. Nếu chỉ chia hai rổ đã đóng thì mean−0,1385925u/rổ, không phải ước lượng kỳ vọng dài hạn. Mục tiêu0,2%/ngày trên vốn đầu31,47744546u tương đương khoảng+0,06295489u/ngày; cả kết quả theo ngày và tổng hiện đều chưa đạt. Kết quả backtest0,288328u/ngày trên100u/10u không chuyển thành cam kết cho ví31u/15u.

Ngày17: BNB net−0,09564420; ETH−0,03097349; SOL+0,00409041; XRP−0,06909137. Ngày18: BNB−0,04673860; ETH−0,01522759; SOL−0,03093840; XRP+0,00733824. Các net theo coin đã trừ phí mở/đóng thực; funding0. Phí chiếm khoảng58,15% khoản lỗ ròng hiện tại; cả biến động giá lẫn chi phí đều góp phần, không quy toàn bộ thua lỗ cho phí.

## Vấn đề vận hành

1. **Hai ngày cùng chạm cơ chế gián đoạn giám sát**, không chạm ngưỡng lỗ tiền15u hoặc đóng sớm−8,9u. Worst quan sát ngày17 khoảng−0,28999022u; ngày18 khoảng−0,18733953u. Không có breach15u được ghi nhận.
2. Worker chờ7s sau khi toàn bộ vòng REST/history hoàn tất; guard so sánh khoảng cách giữa các quan sát thành công với15s. Mẫu kiểm tra trước sự cố18/10 là7,594/7,804/9,806/10,190s, nên dư địa khi mạng/máy chậm còn ít. Các lỗi `Stale venue quote BTCUSDT/XRPUSDT` cũng xuất hiện, làm worker chuyển sang reconciliation_required. BTC không được đặt vì projector/minimum nhưng nguồn giá B5 vẫn phải hợp lệ theo bản đang chạy.
3. **Chưa có log lịch sử đủ để xác định nguyên nhân chính xác của gap.** PM2 không restart ngày17; sự kiện đó diễn ra trong cùng tiến trình. Trong đợt đánh giá18/10 có biên dịch scoped TypeScript trên cùng VPS, ưu tiên CPU thấp; chưa có telemetry để tách ảnh hưởng tải máy khỏi độ trễ REST. Không khẳng định hoạt động kiểm tra không ảnh hưởng độ trễ, cũng không kết luận chắc đó là nguyên nhân.
4. Một SOL intent ngày17 còn lastError cũ “Order not found…” dù đã FILLED/fullauthenticated; đây là trường thông báo còn sót, không phải một lệnh thật còn treo.

Sau sự cố18/10 tài khoản đã flat. Bản worker thêm log sự kiện chuyển trạng thái/latch/lỗi/watchdog, cùng observationGapMs/tickDurationMs trong status để lần sau có bằng chứng. Không nới guard, không đổi sizing/leverage/source hoặc reset ví. Financial engine/broker/source/projector giữ nguyên hash khi triển khai Telegram.

## Telegram đã được yêu cầu ở lượt trước

Tại đầu kiểm tra18/10, mã Telegram đã có nhưng **chưa deploy**, env vẫn trades_only, không có outbox. Đây là phần triển khai trước bị dở, không coi có mã là đã có thông báo.

Đã kiểm3 suite mới **44/44 PASS** và scoped TypeScript PASS. Khi tài khoản đã flat sau sự cố07:38 mới triển khai10 file dist phụ thuộc notification/worker/config và chuyển notify level sangtrades_risk; không thay mã đặt lệnh/rủi ro. Dùng một POST/recipient với ACK message_id, outbox riêng bền vững, network gửi tách khỏi vòng giao dịch, retry/backoff/cooldown Telegram và recipient acknowledgements riêng. Bổ sung giao dịch khớp công bố muộn bằng thông báo đính chính; không tạo fill hoặc PnL giả từ ACK đặt lệnh.

Báo cáo ngày lúc21:00ICT theo cấu hình có sẵn, thêm báo cáo ngày đã qua khi wallet sang ngày. NAV ngày lưu được ghi rõ là điểm quan sát cuối, có thể xấp xỉ tại ranh giới hoặc chưa hồi tố luồng tiền công bố muộn; realized/fee/funding lấy từ rows thật theo timestamp ICT. Thông báo startup và gửi bù đều nêu thời gian khớp/quan sát, không trình bày giao dịch17/10 như vừa mở hôm nay.

Delivery đã được Telegram xác nhận cho các tin thực tế; phần cuối sẽ ghi snapshot ACK. Không cam kết exactly-once khi mất ACK/crash sau gửi: lần gửi chưa xác nhận được ghi uncertain và thông báo retry nói rõ có thể gửi lại. User đã cho phép gửi tới các chat Telegram đang cấu hình; không khởi động lại bot lệnh/polling cũ.

## Việc nên làm tiếp

Ưu tiên tách reconciliation/history chậm khỏi theo dõi rủi ro, xử lý chất lượng nguồn giá và quan sát đủ tick timing. Giữ kiểm soát rủi ro khi mất quan sát. Sau khi vận hành không còn thường xuyên cắt rổ vì hạ tầng, mới thu thập thêm chu kỳ thực để đánh giá edge/chi phí. Hiện mới có hai rổ, cùng bị sự cố vận hành; không có cơ sở xác nhận chiến lược có lãi hoặc kết luận mọi phương pháp đều không thể đạt mục tiêu.

Số liệu gốc private: `/home/ubuntu/futures-live-review-20261018/final-authenticated-exchange.json`, bản ví trước vá notification và JSON tests. Không lưu `.env`, bot token hoặc chat ID vào tài liệu/audit công khai.

## Nghiệm thu cuối Telegram và bàn giao

Phiên bản cuối **47/47 tests Telegram PASS**, scoped backend TypeScript PASS; gồm18 coordinator,10 formatter,19 transport. Đã thêm gộp stale-quote theo danh mục và debounce mỗi loại lỗi5 phút, giữ dedup sau recovery/restart và migrate outbox cũ. Telegram ACK cho **28** tin, pending0, failed0, uncertain1 ở snapshot `2026-10-18T00:47:51.886Z`; đã ACK **18/18** thông báo khớp thật. Có429 khi gửi bù lịch sử; outbox tôn trọng Retry-After và gửi lại tự động, không bỏ tin hoặc gọi lại gửi lệnh sàn.

PM2 đã save, live worker mới chạy leveltrades_risk; API online, các worker cũ stopped. Chỉ triển khai notification và telemetry; wallet identity, vốn, totals, trade history, handoff receipt được giữ nguyên qua deploy. Hiện không còn vị thế, ngày18 riskLatched=true do monitoringgap. Source/risk/sizing không đổi; không tái vào rổ đã đóng để làm đẹp kết quả.

[Bằng chứng và mã snapshot](../audits/futures-quick-win/live-worker-review-20261018/manifest.json). Archive không chứa env, token, chat IDs hoặc full outbox.
