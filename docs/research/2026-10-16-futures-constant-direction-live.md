> Cập nhật18/10: hai rổ đã đóng vì monitoring gap, net−0,277185u, đang flat/latch. Xem [đánh giá chạy thật](2026-10-18-futures-live-worker-review.md); trạng thái và ACK Telegram mới nhất nằm ở báo cáo18/10. Nội dung triển khai16/10 bên dưới giữ để đối chiếu lịch sử.

# Constant-direction cơ sở — triển khai Futures thật 16/10/2026

Trạng thái: **LIVE_ENABLED — RUNNING_FLAT_WAITING_NEXT_UTC_SOURCE**, xác minh cuối22:39ICT16/10/2026. Đã sửa lỗi tải REST sau lần bật đầu; worker thật đang chạy, chưa có order/fill thật và chờ tín hiệu mới.

Người dùng đã yêu cầu áp dụng dòng cơ sở vào giao dịch thật, sửa ngân sách từ10u thành **15u/ngày**, và cho phép dùng **số dư hiện có31,47744546USDT**, không cần nạp lên100u. Quyền này thay lựa chọn paper/10u trước đó. Không xin lại quyền triển khai, không khôi phục ICT/SMC/cooldown/cap mỗi lệnh/exposure100u cũ. Không chuyển/nạp/rút tiền.

## Cấu hình

Policy `CONSTANT_DIRECTION_B5_S6_DAILY15_V1`; source `constant-direction-b5-vol90-s6-v1`: BTC/ETH/BNB/SOL/XRP, constant long, vol90, scalar6, lịch nhận tín hiệu UTC00:00, band20%, gross cap8x, leverage10x, cross/one-way. Đây là tham số dòng cơ sở, không phải ràng buộc cố định mới của người dùng.

Vốn phân bổ ban đầu31,47744546u; phí lấy từ tài khoản thật, fills/commission/funding/income lấy từ Binance. Sizing theo NAV thực, tuân thủ minQty/stepSize/minNotional hiện hành; coin không đủ minimum có thể được projector chọn0. Không tự tăng vốn để đạt minimum. Tiền nạp/rút ngoài được tách khỏi lợi nhuận và không tự tăng sizing.

Ngân sách cố định15u/ngày ICT, không compounding ngân sách. Giữ ngưỡng đóng sớm−8,9u: buffer6,1u với15u thay buffer1,1u với10u. Kiểm tra gồm phí/slippage và chênh mark/reference theo phép tính Decimal40 của projector. Ngưỡng là phần mềm giám sát, không bảo đảm mức lỗ tuyệt đối trong gap/mất kết nối/slippage/liquidation. Không có native stop toàn danh mục trên sàn. Ghi đầy đủ overshoot nếu xảy ra.

## Mã và vận hành

- `backend/src/portfolio/source-constant-direction.ts`: source độc lập, causal, đối chiếu nguồn đã khóa.
- `live-broker.ts`: mainnet thật, decimal strings/int64 nguyên vẹn; POST không tự retry khi chưa biết kết quả.
- `live-service.ts`, `live-store.ts`: một writer, journal fsync trước POST, clientOrderId/query/recovery, actual ledger; partial/unknown chặn tăng vị thế. Đóng giảm vị thế sở hữu được phép trong lúc income công bố chậm; không tạo fill/phí giả.
- `live-worker.ts`: tick tuần tự7s, watchdog60s; source fetch bất đồng bộ không chặn theo dõi rủi ro; cửa sổ nhận source60s. Bootstrap giữa ngày giữ flat tới tín hiệu UTC kế tiếp; không replay tín hiệu cũ hoặc tái vào sau reset ICT.
- `live-runtime.ts`, `live-dashboard.ts`: GET `/api/portfolio-paper/live` và `/api/portfolio-paper/live/view` chỉ đọc; không có nút hoặc HTTP route gửi lệnh thật.
- `backend/ecosystem.portfolio-live.config.cjs`: PM2 `crypto-portfolio-live`. Data riêng `backend/data/portfolio-live/CONSTANT_DIRECTION_B5_S6_DAILY15_V1/`; giữ nguyên mọi ví paper.
- `backend/scripts/portfolio-live-preflight.cjs`: kiểm tra sạch tài khoản, filters/fees, preview31,47744546u; `setup-and-test` đặt leverage10 và gọi **order/test**, không gửi order thật.

Độc quyền sàn: dừng `crypto-worker` cũ; API dùng owner guard mới, chặn mọi mutation của legacy thiếu đúng executionOwner; `crypto-portfolio-paper` và `crypto-post-exit` cũ tạm dừng để dành quota REST cho owner thật. Receipt handoff gắn account fingerprint, setup cross/one-way/10x và allocated capital; thay receipt sau khi tạo ví sẽ bị từ chối. Không tự bật lại bot cũ khi bot mới còn vị thế.

Nếu bỏ lỡ mốc ICT trong khi giữ vị thế hoặc có monitoring gap quá15s, worker latch và giảm vị thế sở hữu thay vì gán giả PnL chính xác tại mốc bị thiếu. Giao dịch giữa nhiều coin không atomic; tái kiểm kê, quote tuổi≤5s và reserve trước từng chân. Kiểm tra lại timestamp gốc **sau** durable SUBMITTING write, ngay trước POST.

## Bằng chứng và giới hạn lợi nhuận

[Nghiên cứu gốc](2026-10-16-futures-constant-direction-control.md) trên100u/10u,128 ngày: base net36,905960u, mean0,288328u/ngày; ngày xấu nhất−11,102854u,2 ngày vượt10u. Ca base đã được kiểm toán độc lập; stress mean0,148828u/ngày, worst−14,371738u nhưng kiểm toán stress chưa xong. Giữ nguyên archive và verdict cũ theo ngân sách cũ.

**Không gán0,288328u/ngày cho vốn31,47744546u/ngân sách15u hoặc gọi lợi nhuận live đã chứng nhận.** Chưa replay tài chính riêng cho vốn/risk phiên bản này, chưa có fresh OOS; current lot filters và vận hành thật thay đổi khả năng bám rổ. Các kiểm thử triển khai xác nhận hành vi kỹ thuật, không bảo đảm mục tiêu0,2u/ngày. Quyết định live dựa trên chấp nhận rủi ro mới của người dùng.

## Kiểm tra sàn trước triển khai

15:18UTC16/10 (22:18ICT): số dư/free31,47744546u, one-way, không vị thế/open regular/algo orders; taker fee0,0005. Preview source00:00UTC16/10 khả thi, gross khoảng81,379u: BNB0,04; ETH0,009; SOL0,16; XRP10,3; BTC0 do minimum/projector. Đây chỉ là preview, không phải lệnh đã gửi; tín hiệu tiếp theo có thể cho số lượng khác.

Biên bản private không chứa khóa nằm ở `/home/ubuntu/futures-live-20261016/`; backup `.env` chỉ lưu file0600 trong thư mục0700, không đưa vào docs/archive công khai. Sau bật, kiểm worker khỏe, mode live, allocated/account equity thực và positions/orders thực; không ép lệnh để chứng minh kết nối.

## Bàn giao và quay lui

Trước deploy: backup `.env` và các file dist sẽ thay; kiểm flat thật, dừng legacy worker, bật owner guard, thiết lập10x và order/test; ghi receipt sau xác minh; start worker mới, restart API với env mới và xác minh read API/UI. Tín hiệu sớm nhất theo lịch hiện tại là **07:00ICT17/10/2026**.

Nếu lỗi trước có lệnh: dừng worker mới, giữ guard để không hai bot cùng giao dịch, xem actual account rồi mới quyết định rollback. Nếu đã có vị thế: dừng tiến trình không đồng nghĩa đã đóng; phải tiếp tục giám sát hoặc đóng reduce-only theo actual quantity và đối soát intents/trades/income trước khi trả owner. Khôi phục dist và env từ backup chỉ khi đã xác minh không còn vị thế/order của owner mới. Không khởi động legacy worker tự động.

## Biên bản kích hoạt

Lần bật đầu22:26ICT, sau sửa rate-limit đã bật lại22:37ICT và xác minh cuối22:39ICT16/10/2026.46 tests cuối PASS (service24/broker15/read-only route4/owner3), gồm regression REST weight/cooldown; scoped backend TypeScript PASS. Đã dừng `crypto-worker`; `crypto-api` PID1575433 chạy guard/env mới; guard legacy mutation đã xác minh từ chối. Tài khoản flat/no regular/algo orders, B5 cross/one-way/leverage10 được kiểm lại;4 order/test BNB0,04/ETH0,009/SOL0,16/XRP10,4 được sàn chấp nhận, không có order thật từ preflight.

PM2 `crypto-portfolio-live` PID1575420 online; API HTTP200 và nginx UI HTTP200. Actual wallet/equity31,47744546u, net0, trades0, intents0, worker `running`, wallet `flat`, blockedReason=null, sourceDisposition=`bootstrap_flat_until_next_utc`. Timestamp tick cuối đã xác minh `2026-10-16T15:39:14.750Z`. Source kế tiếp `2026-10-17T00:00:00.000Z` =07:00ICT17/10; chỉ đặt lệnh khi source/risk/quotes/margin/reconciliation hợp lệ, không hứa chắc sẽ có fill vào đúng giờ.

URL theo dõi: `http://132.226.2.93/api/portfolio-paper/live/view` (HTTP read-only); API cùng origin `/api/portfolio-paper/live`. Đã backup58 file dist/.env private, chỉ triển khai graph29JS+maps; không build lại Next hoặc sửa archive nghiên cứu. PM2 save được thực hiện để lưu owner mới và legacy stopped. Theo dõi live tiếp bằng số thực; nếu tick bị blocked, xem reason và actual inventory trước thay đổi cấu hình.

### Sửa rate-limit trong nghiệm thu thực

Lần bật22:26ICT đã tạo ví thật và vài tick thành công nhưng ngay sau đó gặp−1003/HTTP418; dừng worker thật, paper và observer trước khi có bất kỳ lệnh thật nào. Public probe xác nhận ban tới15:32:59UTC; không bỏ qua lỗi hoặc coi lần bật đầu là vận hành ổn định.

Bản sửa giữ account/positions/mark/reference thật ở mỗi tick7s; cache metadata/mode60s, danh sách open regular/algo orders toàn tài khoản30s, đọc mới trước bootstrap/source mới. History30s khi ví ổn định; đọc ngay khi số dư lệch journal hoặc có intent chưa đối soát. Quote hết hạn sau history thì fetch lại. Điều này có nghĩa phát hiện foreign orders chưa fill có thể chậm30s; không dùng cache positions hoặc quote để cấp phép lệnh. Chỉ căn chỉnh một tick trước/sau mốc ICT, không poll250ms suốt30s gây burst. Broker tôn trọng Retry-After/ban expiry trên cả GET và POST, không gửi thêm trong cooldown.

[Binance Trade API](https://developers.binance.com/en/docs/catalog/core-trading-derivatives-trading-usd-s-m-futures/api/rest-api/trade) và [Account API](https://developers.binance.com/en/docs/catalog/core-trading-derivatives-trading-usd-s-m-futures/api/rest-api/account) là tài liệu primary cho request weight/rate-limit. Kiểm thử mô phỏng56s giữ account/positions mới mỗi vòng với tổng weight dưới800; con số này không là chứng nhận tải khi phát sinh burst lệnh hoặc có client khác dùng cùng IP. Bản sửa đã typecheck và46 tests PASS; xác minh runtime cuối sẽ ghi riêng dưới đây.

### Xác minh bàn giao cuối22:39ICT

`activation-verified.json`: worker running, wallet flat, blockedReason=null; actual balance/free31,47744546u, actual positions0/orders0/algo orders0, trades0/intents0; source vẫn chờ07:00ICT17/10. Public UI HTTP200 đã kiểm trực tiếp qua địa chỉ VPS. Hai mẫu khỏe cách98,083s; used-weight1m lần lượt332 và286, venue HTTP200 cả hai. Đây là smoke test vận hành ngắn, không suy thành cam kết uptime hoặc kiểm chứng lợi nhuận.

PM2 đã save: API PID1575433 và live worker PID1575420 online; legacy worker/paper/post-exit stopped. Giữ các worker cũ dừng để dành quota cho live; không tự bật đồng thời. Ví được tạo ban đầu được tiếp tục, không reset PnL hoặc thay handoff receipt khi vá lỗi.46 tests cuối PASS, scoped TypeScript PASS;4 order/test trước đó đã được sàn chấp nhận.

Gói mã và bằng chứng triển khai đã khóa: [constant-direction-live-20261016T152600Z](../audits/futures-quick-win/constant-direction-live-20261016T152600Z/activation-verified.json). Manifest ghi SHA256 mọi file; không chứa `.env`, API key hoặc private backup.
