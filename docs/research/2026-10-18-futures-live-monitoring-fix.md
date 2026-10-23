> Cập nhật sau đó18/10: user đã cho phép tự phục hồi sau lỗi kỹ thuật; [bản mới đã vào lại rổ thật trong ngày](2026-10-18-futures-live-technical-recovery.md). Quy tắc nghỉ tới ngày19 trong biên bản dưới là trạng thái trước quyền mới.

# Sửa vòng giám sát worker Futures thật — 18/10/2026

**ĐÃ TRIỂN KHAI VÀ XÁC MINH lúc 08:23 ICT ngày 18/10/2026.** Worker thật đang chạy bản sửa; 139 kiểm thử PASS và scoped TypeScript PASS. Mẫu vận hành 185 giây ghi nhận nhịp quan sát trung vị 1,998 giây, dài nhất sau khởi động 2,715 giây. Ví đang flat và giữ nguyên khóa ngày; không tạo giao dịch mới để thử.

Người dùng yêu cầu sửa việc hai rổ tự đóng vì gián đoạn giám sát vượt 15 giây. Bản sửa giảm những việc chặn vòng theo dõi rủi ro và cải thiện nguồn giá; **giữ nguyên cơ chế đóng khi thật sự mất quan sát quá 15 giây trong lúc đang có vị thế**. Không tăng ngân sách lỗ để che lỗi vận hành.

## Sự cố và phạm vi kết luận

[Báo cáo đánh giá trước sửa](2026-10-18-futures-live-worker-review.md) đã đối soát hai rổ ngày 17 và 18/10: cả hai đóng bởi `live_monitoring_gap`, chưa chạm ngân sách tiền 15u hoặc ngưỡng đóng sớm −8,9u. Tổng PnL sau hai rổ là −0,277185u, gồm phí thực. Đây là số liệu lịch sử, không bị sửa bởi bản vá.

Mã cũ chờ thêm 7 giây sau khi một tick hoàn tất. Trong tick, lịch sử khớp/income, metadata, danh sách lệnh và việc theo dõi tài khoản có thể cùng nằm trên đường chờ. Khoảng cách quan sát vì thế bằng thời gian xử lý cộng thời gian nghỉ; chỉ một vài request chậm hoặc một lần lỗi giá cũng có thể ăn hết dư địa trước 15 giây. Giá REST B5 có lúc đã gần giới hạn tuổi 5 giây khi được nhận; một vòng thất bại làm lần quan sát thành công tiếp theo xa hơn nữa.

Đây là chuỗi nguyên nhân **được xác định từ cách mã hoạt động và lỗi đã ghi nhận**, chưa phải bằng chứng xác định riêng request nào hoặc sự kiện CPU nào gây hai incident lịch sử. Log cũ thiếu chi tiết để quy toàn bộ nguyên nhân cho mạng, REST, biên dịch hoặc tải VPS. Bản sửa bổ sung telemetry để phân biệt các trường hợp sau này.

## Các thay đổi

### 1. Giá công khai đi qua WebSocket riêng

`backend/src/portfolio/live-quotes.ts` nhận mark price mỗi giây và book ticker của BTC, ETH, BNB, SOL, XRP. Hai nhóm dùng hai kết nối đúng tuyến Binance hiện hành:

- Mark price: `wss://fstream.binance.com/market/stream`, các stream `<symbol>@markPrice@1s`.
- Bid/ask: `wss://fstream.binance.com/public/stream`, các stream `<symbol>@bookTicker`.

Việc tách `/market` và `/public` theo [thông báo chuyển tuyến chính thức của Binance](https://developers.binance.com/en/docs/products/derivatives-trading-usds-futures/websocket-market-streams/Important-WebSocket-Change-Notice). Trường thời gian sự kiện và bid/ask dựa trên [schema book ticker chính thức](https://developers.binance.com/en/docs/catalog/core-trading-derivatives-trading-usd-s-m-futures/api/ws-streams/public); mark price theo [tài liệu market streams](https://developers.binance.com/en/docs/catalog/core-trading-derivatives-trading-usd-s-m-futures/api/ws-streams/market).

Feed giữ nguyên thời gian sự kiện `E` của sàn và thời gian máy nhận. Cache chỉ được dùng khi cả tuổi sự kiện lẫn tuổi nhận đều không quá 5 giây. Đọc cache, heartbeat, bản tin lặp hoặc reconnect không làm mới giả tuổi giá. Dữ liệu tương lai quá mức, sai symbol/loại hợp đồng, giá không hợp lệ hoặc bid lớn hơn ask bị bỏ qua. Mất kết nối xóa cache nhóm tương ứng; không coi giá cuối là vẫn mới.

Ticker giữ midpoint bằng Decimal40 và bid/ask gốc. Kiểm tra dự phòng từng lệnh dùng ask cho BUY, bid cho SELL, cùng phí và dự phòng trượt giá; không coi midpoint là giá khớp chắc chắn. Giá khớp và PnL vẫn lấy từ giao dịch thật được xác nhận.

Feed có ping/pong, phát hiện stream im lặng, reconnect với thời gian chờ tăng từ 500ms đến tối đa 15 giây và thay kết nối trước giới hạn thời gian dài của sàn. Đây là dữ liệu công khai; feed không có credentials hoặc quyền đặt lệnh.

**Smoke công khai trước triển khai:** feed nhận đủ hai nhóm cho cả năm coin và chuyển `ready` trong khoảng 2 giây; tuổi sự kiện trong mẫu kiểm tra dưới 600ms. Đây là kiểm tra kết nối tại một thời điểm, không phải bằng chứng uptime dài hạn.

### 2. Vòng giám sát nhanh, công việc phụ chạy riêng

`backend/src/portfolio/live-worker.ts` dùng chu kỳ mục tiêu **2 giây tính từ lúc bắt đầu tick này tới lúc bắt đầu tick tiếp theo**. Thời gian xử lý được trừ khỏi thời gian nghỉ. Tick không chạy chồng và không chạy dồn để bù những lần trễ; vẫn giữ căn chỉnh quan sát sát hai bên nửa đêm giờ Việt Nam.

Broker giới hạn mỗi request ở **3 giây**, tắt retry GET trong worker này. Lỗi được quan sát và vòng sau kiểm tra lại; không giữ một tick chờ qua nhiều lần retry. Các quy tắc không tự gửi lại POST khi kết quả đặt lệnh chưa rõ vẫn giữ nguyên.

`backend/src/portfolio/live-background.ts` chia các công việc thành những nhóm riêng: metadata/setup/phí, danh sách lệnh đang mở, lịch sử giao dịch/income, đối soát intent. Các nhóm chỉ fetch dữ liệu; live service áp dụng kết quả vào sổ dưới khóa ví. Mỗi nhóm chỉ có một lần fetch đang chạy, và lỗi một request không cho phép mở nhóm trùng khi các request còn lại chưa xong.

Metadata khỏe refresh mỗi 60 giây, danh sách lệnh/lịch sử mỗi 30 giây; metadata/orders lỗi hoặc chưa có cache thử lại mỗi 10 giây. Không retry các nhóm nặng mỗi 2 giây vì có thể tiêu hết quota của vòng rủi ro. Lịch sử cần đối soát gấp thử mỗi 10 giây, intent chưa rõ kiểm tra mỗi 2 giây. Thời điểm snapshot là lúc bắt đầu request, không phải lúc phản hồi chậm kết thúc.

Vòng nhanh tiếp tục đọc tài khoản, vị thế thật và giá mới, thay vì đợi lịch sử chậm. Chênh lệch cash chưa đối soát không bị bỏ qua: khoản giảm chưa rõ được tính bảo thủ vào rủi ro; thiếu coverage hoặc còn intent chưa rõ chặn lệnh tăng vị thế.

Metadata và danh sách lệnh B5 đã kiểm tra được lưu cùng checkpoint để một lần restart không phải đợi toàn bộ công việc phụ trước khi có thể theo dõi và giảm rủi ro. Cache này **không tự cấp quyền mở mới**. Lệnh nguồn mới đòi hỏi metadata, danh sách lệnh và lịch sử còn đủ độ mới; tại cửa sổ nguồn cần refresh từ mốc nguồn đó. Vị thế thực, giá hiện tại, ownership và journal vẫn phải khớp trước khi hành động.

### 3. Không giữ một tick để chạy hết rổ nguồn

Trong chế độ mới, kế hoạch nguồn được lưu bền vững và thực hiện **tối đa một leg nguồn trong mỗi tick**. Trước leg tiếp theo, bot kiểm tra lại vị thế, khớp thật, phí/cashflow, giá và dự phòng rủi ro. Kế hoạch hết hạn sau cửa sổ 60 giây tính từ mốc nguồn; phần chưa gửi bị bỏ khi hết hạn hoặc khi đã khóa rủi ro.

Con trỏ leg được ghi xuống đĩa trước intent/POST. Nếu crash đúng khoảng giữa hai bước, bot chấp nhận bỏ leg đó thay vì tự gửi lại và có nguy cơ nhân đôi vị thế. Intent đã có tiếp tục được tra cứu theo client order ID bền vững; ACK đặt lệnh không được biến thành fill giả. Không replay nguồn đã tiêu thụ hoặc tái vào rổ bị đóng để cải thiện kết quả hiển thị.

### 4. Telemetry

Worker status có trạng thái từng kết nối giá, `ready`, symbol đang thiếu/cũ, số reconnect và lỗi đã làm sạch; cùng `observationGapMs`, `tickDurationMs`, trạng thái các nhóm background và thời điểm coverage. Cảnh báo/lịch sử Telegram tiếp tục chạy riêng, dựa trên sổ khớp thật; gửi thông báo không giữ vòng giám sát.

## Các giới hạn được giữ nguyên

- Vốn phân bổ đầu: **31,47744546 USDT**; không nạp, chuyển hoặc reset ví. Số dư hiện tại tiếp tục từ PnL thực đã phát sinh.
- Ngân sách ngày: **15u**; ngưỡng đóng sớm **−8,9u**, buffer 6,1u.
- Nguồn constant-direction B5 vol90 scalar6, gross cap 8, leverage 10, band 20%, cross/one-way giữ nguyên.
- Guard mất quan sát khi đang có vị thế: **15 giây**, không nới và không bỏ.
- Không reset latch của ngày 18/10, source cursor, intent, lịch sử khớp hoặc PnL để tự vào lại rổ đã bị đóng.

Nếu VPS thực sự bị treo, mất mạng lâu hoặc sàn không cung cấp dữ liệu đủ mới, bot vẫn có thể phải đóng vị thế khi nối lại và xác minh được inventory. WebSocket và background không bảo đảm giữ khoảng quan sát dưới 15 giây trong mọi tình huống. Ngân sách phần mềm 15u vẫn có thể bị vượt do gap hoặc trượt giá; không có cam kết lợi nhuận mới từ bản sửa hạ tầng này.

## Kiểm thử chuẩn bị

**139/139 kiểm thử khác nhau PASS:** 24 service, 20 broker, 8 HTTP/income, 4 route, 47 Telegram, 11 quote feed, 17 background và 8 monitoring. Sau sửa trạng thái warmup đã chạy lại riêng toàn bộ 24 service + 8 monitoring, đều PASS. Scoped TypeScript PASS; kiểm tra cú pháp 7 module xuất bản PASS.

Quote tests kiểm tra timestamp thật/giá Decimal, không làm mới cache bằng sự kiện lặp, giới hạn 5 giây, bản tin lỗi/future/crossed book, xóa cache khi disconnect, backoff không chồng retry, stream treo, ping/pong và stop/restart. Kiểm tra VM worker xác nhận broker 3 giây/không retry, binding Proxy đúng, feed thay giá REST, chế độ giám sát mới, ví dụ 450ms xử lý + 1550ms nghỉ = chu kỳ 2 giây, telemetry và shutdown.

Các ca monitoring dùng đồng hồ mô phỏng và ghi đĩa thật: history treo 56 giây, metadata/orders treo 110 giây vẫn quan sát vị thế; outage thật 20 giây vẫn latch và giảm hết vị thế thuộc bot; cash funding −10u chưa có history vẫn thoát bằng ACK inventory, không tạo fill giả; tiếp tục đủ 5 leg qua restart trong cửa sổ 60 giây, không lặp POST; giữ latch/cursor; history sai ownership chặn entry nhưng không cản quan sát inventory hợp lệ; restart dùng cache đã xác thực khi metadata/orders treo. Trạng thái warmup được thay bằng trạng thái latch đúng khi quan sát thành công. Đây là kiểm thử chức năng, không phải replay PnL hoặc xác nhận lợi nhuận.

## Xác minh triển khai thực

Bản cuối restart lúc khoảng **08:20 ICT18/10**, worker PID **2211701**; API PID **2209995** online. Ba worker cũ `crypto-worker`, `crypto-post-exit`, `crypto-portfolio-paper` vẫn stopped; PM2 đã save. Đã sao lưu riêng checkpoint, môi trường và các module cũ trước thay đổi; chỉ chép 7 module cùng source map, không build/triển khai frontend hoặc thay config tài chính.

**Mẫu 08:20:13–08:23:19 ICT, 185 giây/94 trạng thái**:

- WebSocket đủ B5 trong 94/94 mẫu; một mẫu đầu warmup blocked, 93 mẫu còn lại running. PID không đổi trong mẫu.
- Nhịp quan sát sau khởi động: trung vị **1.998ms**, lớn nhất **2.715ms**. Khoảng quan sát thành công đầu tiên tính qua lần restart là **8.801ms**, được báo riêng; không che bằng heartbeat. Không thấy khoảng vượt15 giây trong mẫu.
- Thời gian xử lý tick trung vị **222ms**, lớn nhất **1.729ms**. Mẫu cuối observation age83ms; max6.119ms xảy ra lúc warmup trước lần quan sát thành công đầu tiên.
- Không ghi nhận lỗi background trong mẫu cuối. Đã lấy **4 phiên bản metadata và 7 phiên bản orders/history mới** sau warmup. Cả hai socket connected, reconnect0 tại cuối mẫu.
- Trạng thái cuối đúng là **risk_latched / live_monitoring_gap** của ngày18, thay cho lỗi warming cũ còn lưu trên màn hình. Sửa này chỉ phục hồi trạng thái hiển thị sau một quan sát thành công; không gỡ latch.

Đối soát sàn sau triển khai: wallet/equity/available **31,20026046u**, unrealized0, không có vị thế, regular order hoặc algo order. So checkpoint trước/sau lần cuối xác nhận nguyên vẹn config, vốn đầu, mọi số tiền, PnL, cashflow, vị thế,18 khớp lệnh/16intents, IDs đã xử lý, lịch sử ngày, currentDay/latch, owner receipt và source cursor. **Net vẫn−0,277185u**, không có lệnh thật mới. Endpoint qua nginx và API trảHTTP200; cache monitoringSupport không bị trả ra read model công khai.

Giữ khóa ngày18/10 và cursor **1792281600000**; không tự mở lại rổ hôm nay. Mốc nguồn kế tiếp là **07:00ICT19/10**, chỉ gửi khi dữ liệu và dự phòng rủi ro đủ điều kiện. Đây là kiểm chứng vận hành ngắn khi tài khoản flat; khả năng giữ vị thế trong sự cố được kiểm bằng fault tests, chưa có thêm rổ thật sau bản vá và không phải bằng chứng lợi nhuận.

[Bằng chứng nghiệm thu và manifest](../audits/futures-quick-win/live-monitoring-fix-20261018/manifest.json) gồm các báo cáo test, hash mã/build, chuỗi mẫu runtime, đối soát tiền và trạng thái tiến trình. Bản sao đầy đủ có dữ liệu riêng tư nằm ở `/home/ubuntu/futures-live-monitoring-fix-20261018`, không đưa credentials, raw wallet hoặc Telegram recipients vào docs.

## Rollback

Bản module trước sửa ở `/home/ubuntu/futures-live-monitoring-fix-20261018/backup/dist`; receipt hash trong `backup-manifest.json`. Nếu cần rollback, khôi phục module đã sao lưu rồi restart worker live; nếu thay module API/read model thì restart API tương ứng. Giữ nguyên checkpoint hiện hành, owner và ngân sách; không phục hồi raw wallet cũ, không xóa latch/cursor, không khởi động bot cũ. Giữ bộ lọc cache khỏi API khi checkpoint vẫn chứa monitoringSupport. Bản cũ có đường chờ giám sát đã nêu, nên rollback không được coi là xử lý triệt để sự cố này. Dừng process không tự đóng vị thế sàn; nếu đang giữ vị thế phải có giám sát/đối soát tiếp.
