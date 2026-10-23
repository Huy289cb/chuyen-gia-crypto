# Phép thử kế tiếp: relative reversal đa coin

Ngày lập: 13/10/2026 ICT. **COMPLETE_SCREEN — NO_GO_COST_SCREEN.** Đã chạy đủ92rổ/184chân ngày13/10, audit độc lậpPASS; xem [report](../audits/futures-quick-win/cross-20261013T132038Z/report.md). Không chạy account replay cho cấu hình âm. Kế tiếp là [spillover](2026-10-13-futures-spillover-screen.md), chưa chạy; không có goal công cụ active. Nghiên cứu được tiếp tục theo yêu cầu người dùng; QW1 không mở lại. [Sàng lọc vừa hoàn tất](../audits/futures-quick-win/screen-20261013T124932Z/report.md) đã loại ba cấu hình SOL sau chi phí, P2 seed chỉ có một cụm sự kiện trong 92 ngày. Đổi cơ chế/universe có căn cứ; không nới threshold để cứu outcome cũ.

Chỉ giữ [policy](../runtime-risk-policy.md): ban đầu 100 USDT; chung cố định 10 USDT/ngày ICT; không giới hạn số lệnh; ngày âm/dương/không lệnh chấp nhận; mục tiêu khoảng 1 USDT ròng/ngày lịch. Các tham số nghiên cứu dưới đây không là rule người dùng.

## Giả thuyết và phạm vi

**Sửa nguồn trước PnL:** [Pure Momentum](https://cesare-fracassi.github.io/files/pdf/Research/Fracassi_Lee_Kogan_2025.pdf.pdf) dùng return của giờ cách24giờ, không phải cumulative return24giờ; paper nói chiến lược theo giờ âm saucommissions/impact. Cấu hình daily cumulative bên dưới là giả thuyết riêng, đã ghi đúng trong protocol trước khi chạy, không là replicationpaper. Bản kế hoạch trước sửa được lưu nguyênbytes ở prior-docs của package.

Universe cố định BTC, ETH, BNB, SOL, XRP, DOGE, ADA USDT perpetual: dùng lại nhóm so sánh đã có từ nghiên cứu trước, không chọn theo winner của screen SOL. Đây là sample hạn chế, có bias survivor; không đại diện toàn thị trường/top50 hoặc danh sách point-in-time. Chỉ thử một cấu hình, base/stress.

Candidate đề xuất cho registration sau feasibility: mỗi 00:00 ICT, rank return 24 giờ của nến đã đóng; long coin thấp nhất, short cao nhất, tie theo symbol; giữ 24 giờ; hai chân chia đều notional. Không size/rank theo return tương lai. Chốt quy tắc giữ coin trùng, turnover, next-executable entry/exit và terminal trước đo. Không thử đồng thời nhiều holding horizons rồi chọn winner.

## Thứ tự thực hiện và cutoff

1. **Feasibility public inputs, tối đa 60 phút chủ động:** official Futures hourly trade/funding của bảy coin, tháng 06–09/2026, checksum/gaps/listing/timestamp; kiểm min-ticket với vốn nhỏ bằng filters có provenance. Không đọc giá tương lai để chọn coin. Đầu ra data manifest, causal timing và financial protocol nếu đủ. Thiếu dữ liệu → INCOMPLETE, không bỏ coin/ngày xấu sau outcome.
2. **Một event-cost screen, tối đa 30 phút/run:** fractional paired-notional, entry sau signal, actual funding và hai chân cùng fee/slip base/stress như screen trước. Coverage 92 ngày ICT Jul–Sep; tail thiếu đủ horizon phải ghi rõ. Khóa source/config/data trước return, audit độc lập. Screen không chứng nhận account/day budget; không đổi gate theo outcome. Có mean stress dương nhưng uncertainty chưa đủ → UNRESOLVED, không promote. Không gate số fills live của rule cũ.
3. **Chỉ khi đủ ưu tiên:** đăng ký replay liên tục tài khoản 100 USDT, cùng governor fixed10 cho tổng hai chân; mark/minute, lot/margin, liquidation và closeout/restart. Chốt estimate bằng prefix trước run; tối đa 60 phút/case. Nhánh này chưa tự chạy và không được cấp mỗi chân 100 vốn/10 ngân sách. Mục tiêu1/day chỉ đo ở bước này với ledger/audit phù hợp, gồm ngày 0 lệnh.

Ngày 13/10: screen SOL DONE. Mốc tiếp theo dự kiến 14/10: input feasibility và registration; 15/10: cost screen nếu inputs đạt. Đây là lịch làm việc dự kiến, chưa tạo scheduler tự chạy và không hứa có lợi nhuận. Khi tiến độ/gate không đạt phải lưu nguyên nhân và terminal, không kéo dài bằng helper/polling hoặc đổi tham số liên tục.

Mọi run dùng folder mới, không sửa source/protocol/financial artifacts QW1 hoặc screen đã đóng băng. Không private API, paid LLM, orders, transfers hoặc runtime deployment. Khi tìm được hiệu quả, báo evidence và changelist strategy/governor/execution để xem xét cải thiện cả hệ thống; harness riêng chưa là migration production.

**Tiến độ chốt13/10:** feasibility và costscreen DONE sớm hơn mốc14–15/10; gross/net đều âm, stage3accountreplay NOT_RUN vì không qua gate. Không retune/flip/sweep để cứu kết quả. Các bước thiết kế ở trên giữ làm lịch sử; report và kế hoạch spillover là bàn giao hiện hành.
