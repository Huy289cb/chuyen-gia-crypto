# Cập nhật xác nhận64ngày — 14/10/2026

[Report64](../research/2026-10-14-futures-momentum-64-day-test.md) đã complete/audit: base−5,256284u/stress−6,492374u, net/64−0,082129/−0,101443u. Cấu hình hiện tại **không đạt điều kiện mean dương trướcápdụng**, không promote. Sameengine/config100/10; budget no modeledbreach/latch0,2.142.656moneychecksPASS. Bước kếtiếp pairednative/executable same64ICTwindow trước sửaalpha/projection, chưađăngký/chạy. Các phầnimplementation14 bên dưới vẫn là kết quả lịch sử giữ nguyên.

# Cập nhật vận hành paper — 14/10/2026

[Patch vận hành](../audits/futures-quick-win/momentum-paper-watchdog-20261014T092700Z/report.md) đã thêm watchdog180s, UI nhận biết giá chậm, own-origin cho trang VPS và funding theo held inventory/latest-page có coverage. Browser public POSTtestbed PASS, không financial rerun. Provider public còn thỉnh thoảng403: báo degraded/tự retry, không giả thiếu phí/funding là0. 26 unit tests + watchdog/Chromium checks PASS. Engine tính tiền và source signals không đổi; frozen14day PnL vẫn base−1,138224/stress−1,694410u. Paper implementation đã có, expectation0,2/1u chưa xác nhận; không order thật hoặc reset wallet. Nội dung dưới là bàn giao trước patch.

# Cập nhật hoàn tất theo yêu cầu triển khai ngay — 14/10/2026

Đã implement vào backend hiện tại, deploy paper worker/API/trang backend và hoàn thành replay14ngày thay chờ calendar. [Report/code/receipts](../research/2026-10-14-futures-momentum-paper-implementation.md): source parity0/60.000 weights, 22 tests và 464.966 checks tiền PASS; net base−1,138224/stress−1,694410u, không modeled10u breach. Cửa sổ này âm, chưa xác nhận thu nhập0,2u/ngày.

Người dùng đã cho phép implement trực tiếp paper, thay phase gating “chỉ khi account replay có ích mới xây route” phía dưới. Paper feature được triển khai để kiểm hệ thống; kết quả âm không đổi thành lời hứa ROI+. Không private orders. Phase1–3 engineering/workflow đã thực hiện; prospective dài và cải thiện economic còn chưa đạt. Lịch cũ dưới đây giữ làm lịch sử kế hoạch, không trạng thái hiện hành.

# Đưa source momentum vào paper của hệ thống

14/10/2026. **RESEARCH_CANDIDATE; IMPLEMENTATION_NOT_REGISTERED_NOT_RUN.** [Audit tin cậy](../research/2026-10-14-futures-source-trust-and-costs.md) đã xong: phép tính source kiểm được,0,206u/hàng không là kỳ vọng net executable100u/ngày. Người dùng chấp nhận mức khoảng0,2u đáng thử; không dùng mean1u cũ làm lý do cấm paper ứng viên thấp hơn. Vốn100u, chung10u cố định/ngày ICT và không cap số lệnh vẫn giữ.

## Phần giữ nguyên

40source signals, momentum14/sample volatility30, average ranks/demean/gross2, đúng lag và dailyUTC targets. Không cho source đi qua ICT/SMC/grade/RR/SL-distance filters cũ. Source fractional benchmark giữ nguyên. Broker execution/risk thay đổi holdings phải có version và báo khác biệt; không gọi là exact replica.

## Giai đoạn1: adapter offline và lot feasibility

Khung tối đa4 giờ chủ động dự kiến14–15/10, chưa tác vụ tự chạy. Đầu ra là code/offline fixtures có thể review và verdict READY_FOR_ACCOUNT_REGISTRATION hoặc INCOMPLETE với thiếu sót cụ thể.

- Signal adapter tạo vector desired weights, `known_at`, `execution_at` và source/data hashes. Giữ UTC alpha schedule; budget dùng ICT, không đổi lag để làm đẹp results. Dùng source fixtures đã audit làm kiểm parity.
- Target-delta planner lấy actual filled inventory, NAV, pending reservations, mark và filters; không autoceil mọi target tới minimum. Preview hiển thị quantity/target chưa thể đặt, long/short/gross/net và tracking error.
- Cold entry100u có lower bound tracking error35,29%source gross ở snapshot, nên phải nêu adaptation/tolerance trước PnL. Integer projection với neutrality/gross/risk cần công khai; không chọn coins theo winners đã biết. Nếu không đạt giả định đã đăng ký thì giữ tiền/báo không khả thi, không tạo fills giả. Tolerance là tham số nghiên cứu, không user rule.
- Nguồn desired targets vẫn40; actual executable inventory có thể khác. Source benchmark và executable book là hai phép đánh giá riêng, không cộng thành vốn200u.

## Giai đoạn2: account replay đúng100u/10u

Chỉ sau phase1 READY mới đăng ký source/config/inputs/event timing/cutoff trước PnL. Dự kiến15–16/10 nếu đủ điều kiện; không cam kết ngày khi data/margin/fill semantics còn thiếu.

- Một Decimal/fixed-point wallet có `wallet_id`, all-symbol positions, pending/reservations và actual fills. Không mở40balance100 hoặc40ngân sách10.
- Durable governor: cashflow-adjusted anchor00:00ICT, fixed10u, funding/fees charge-once, inventory MTM, reservation cho đóng/funding/slip, latch/restart không reset. Emergency cancel/close có confirm remaining exposure; lưu overshoot thật.
- Đúng actual delta turnover và funding settlement. Fee/slip lấy assumptions công khai; maker không mặc định khớp. Current filters/maintenance assumptions còn thiếu historical proof phải ghi rõ.
- Base/stress cùng source desired targets. Báo net USDT/đủ ngày lịch, gross/net exposure, tracking error, phí/funding/slip, margin và worstICTday/breach. Không sửa parameters sau outcome, không dùng CI chứa0 tự veto; mean dương vẫn chưa chứng minh future expectancy.
- Nếu executable net âm hoặc feasibility thiếu, không promote. Phân tích cost/rounding/risk cause trước derivative mới; không tune lại frozen source benchmark.

## Giai đoạn3: tích hợp paper, chưa gửi order thật

Sau account replay có ích mới xây route/feature flag paper riêng. Có thể tái sử dụng Binance transport, WS partial-fill/cancel-seal, signed income pagination/dedup, wallet reconcile và close plumbing. Source strategy cần entry point portfolio, không gọi V3 sizing theoSL như cũ.

Schema/ledger cần tách exchange wallet identity khỏi symbol/method attribution; thêm durable rebalance IDs/idempotency/checkpoint, position actual vs desired, shared budget. UI/API bổ sung portfolio NAV/cost/tracking/budget/data freshness và source benchmark riêng. Migration chỉ chuẩn bị local review; chưa apply DB/runtime.

Paper ban đầu7–14 ngày dùng kiểm scheduling, data timing, executable tickets, cost/funding và recovery; khoảng đó chưa xác nhận lãi kỳ vọng bền vững. Economic prospective cần mẫu dài hơn, báo cả ngày âm/dương/giữ tiền. Không yêu cầu mọi tháng dương hoặc lowerCI>0. Không tự đưa live khi chỉ thấy một tuần thắng.

## Giai đoạn4: cải thiện có kiểm soát

Giảm churn của delta nhỏ, execution theo spread/fee đo được, missed/partial fills và inventory persistence trước. Các no-trade bands/maker choices là execution derivatives được đăng ký riêng. Tăng gross, đổi universe hoặc entry/exit là hypothesis khác; không nhân0,206 để hứa lợi nhuận. Nếu cần đổi chính100u hoặc10u thì hỏi người dùng; không hồi sinh rule cũ.

Các mốc là kế hoạch, không scheduler/goal tự chạy. Lượt hiện tại đã hoàn tất audits, chưa implementation/account replay/prospective mới. Không private API, orders, transfers, paid LLM hoặc runtime deployment. [Mapping file/line](../audits/futures-quick-win/source-trust-20261014T040315Z/integration/report.md) là checklist kỹ thuật cụ thể.
