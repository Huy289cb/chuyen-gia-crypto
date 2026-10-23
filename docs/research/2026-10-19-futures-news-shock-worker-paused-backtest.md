> **Kết quả mới nhất 20/10:** Đã hoàn tất sáu ca và kiểm toán độc lập6/6PASS sau khi user cho phép tạm dừng worker lúc ví flat. CảH1/H2 chưa đạt tăngROI ở cảbase/stress; worker cũ đã khôi phục active, giữcap12. Xem [báo cáo kết quả](2026-10-20-futures-news-shock-backtest-results.md). Các trạng thái chưa cóPnL/chưahoàntất bên dưới là lịch sử.

# Backtest tin/sốc với worker tạm dừng — 19/10/2026

Trạng thái: RUNNING, chưa có kết quả đủ kỳ.

Người dùng yêu cầu tiếp tục backtest và cho phép tạm dừng worker trong lúc test. Bản này ghi thay đổi vận hành để phép thử hoàn tất; không thay chiến lược, sizing, ngân sách hoặc ngưỡng bảo vệ thật.

## Tạm dừng an toàn

- Trước dừng: ví đã flat, đối soát đủ, delta0, không intent chưa giải quyết hoặc pending plan;216khớp/198intents, vốn chiến lược30,28485845u, net từ vốn cấp−1,19258701u. Đây là snapshotlive, không phải kết quả candidate.
- Đã dừng riêng crypto-portfolio-live; lệnh điều khiển timeout nhưng đã xác minh PID2838462 hết và PM2stopped/PID0. Không suy timeout là chưa dừng.
- GET sàn16:49:18UTC:0vịthế/0lệnh thường/0algo, cash/equity30,28485845u. Không có giao dịch đóng tay do lần tạm dừng này.
- API vẫn online. Legacy/paper/postexit giữ stopped. Bản khởi động máy được giữ trạng thái online trước test: nếu reboot, replay chết và worker cũ được khôi phục.

## Phép so sánh

Dùng đúng registrationSHA256c89496372e48db0e62b89ab97c62097f5e82c78efedd8e6564d8b346dad099db, không đổi source hoặc ngưỡng theoPnL.21đầu vào/92,13MB được hash trước mỗi ca. Cùng một ví31,47744546u mỗi ca,128ngày liên tục07/06/2026 17:00UTC→13/10/2026 17:00UTC; không reset ở64ngày. Trần12u/ngàyICT, soft−5,9u/dự phòng6,1u.

| Thứ tự | Ca | Chính sách | Chi phí |
|---|---|---|---|
|1|H0_BASELINE_base|Bản cơ sở, không guard mới|Phí0,05% + trượt2bps/khớp|
|2|H0_BASELINE_stress|Bản cơ sở|Phí0,07% + trượt5bps/khớp|
|3|H1_CALENDAR_base|Thoát trước lịch tin; chờ nguồn ngày kế tiếp|Cơ sở|
|4|H1_CALENDAR_stress|NhưH1|Stress|
|5|H2_CALENDAR_SHOCK_base|H1 + phát hiện sốc, thoát giảm mạnh phút kế tiếp|Cơ sở|
|6|H2_CALENDAR_SHOCK_stress|NhưH2|Stress|

Mỗi ca bắt đầu từ phút0 vì checkpoint các lượt trước không có đủ trạng thái funding/risk/policy/auditor/hash để resume. Chạy đúng một tiến trình tài chính tại một thời điểm. Không dùng watchdog nhịp worker vì worker đã dừng chủ đích. Supervisor hủy replay nếu phát hiện worker bật lại, có cutoff40phút/ca. Replay không cóAPI hoặc credential giao dịch; script kiểmflat riêng chỉ gọiGET.

## Bảo toàn và khôi phục

Supervisor lưu hash .env, moduleJSportfolio, handoff, sourcebridge và wallet; không lưu nội dung credential vào báo cáo. Trước tự bật lại phải giữ nguyên các hash, walletflat/đối soát đủ/khôngpending/cap12 và GET sàn xác nhậnflat. Sau restart worker cũ phải tự đối soát, kiểmtra rủi ro; không reset anchor/cursor/latch hoặc tự nângcap. Lịch quan sát trống lúc không giữvịthế được ghi đúng, không làm giả giám sát liên tục. Việc quá nửađêm dùng logic hiện hữu: flat không cần giả mốc vốn khi không có vịthế, history/flow vẫn phải đốisoát.

Cần hậu kiểm worker sau phép thử; khởi động tiến trình thành công chưa đồng nghĩa giao dịchđãactive. Nếu điều kiện khôi phục không đạt, trạng tháiBLOCKED_REQUIRES_REVIEW phải được xử lý trước khi coi đã hoàn tất vận hành.

## Kết quả và quyết định

Chỉ kết luận sau đủ184.320phút/1.920funding mỗi ca, ledgerDecimal50 và auditartifact độclập. So net/ROI/mean, ngàyxấu nhất, drawdown, sốkhớp/phí giữaH1/H2 vớiH0 cùngcost. Chỉ gọi tăngROI nếu net tăng ở cảbasevàstress, auditPASS và khôngbreach12 trongmôhình. Nếu giảm ngàyxấu nhưng giảmnet, ghi là đánhđổi bảo vệ. TrườnglegacymaxDrawdown5mCloseUsd thựcđược cậpnhật mỗi phútđóng; mô tả đúng tần suất, không đổi số/hash.

Dữ liệu128ngày đã xem, không phảiOOS. Lịch lịch sử có thểđãrevision; thiếuas-knownfeed, BBO vàsubminute. Exit phút kếtiếp/slip cốđịnh không chứngnhận chốnggap, tinđộtngột, sànngắt hoặc trần12tuyệtđối. SLsàn/spreadguard chưa được môphỏng hay triểnkhai trongđợtnày.

## Bằng chứng

- [Gói đăng ký và các lượt cũ](../audits/futures-quick-win/news-shock-backtest-20261019/README.md).
- Thư mục thực thi: /home/ubuntu/futures-news-shock-worker-paused-20261019.
- execution.json ghi từngca/tiếntrình/khôi phục; logs riêng và outputs bênattempt/cases.
- Kết quảaudit/so sánh được sinh vàoattempt/results sau sáuca; chưa được báoPASS trước khi đủ.
