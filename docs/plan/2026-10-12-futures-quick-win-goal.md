# Mục tiêu hiện hành —16/10/2026

Tiếp tục nghiên cứu để tìm ứng viên Futures có **tổng lãi ròng chia mọi ngày lịch ≥0,2u/ngày**, trên một ví ban đầu100u, ngân sách lỗ10u cố định/ngày ICT chung cho cả ví. Không giới hạn số lệnh; chấp nhận ngày/kỳ lỗ và giữ tiền mặt. Các rule ICT/SMC, cooldown, BTC-only, exposure100u, SL tối thiểu và cap mỗi lệnh cũ đã bỏ. Mốc1u/ngày và thời hạnP1 bên dưới là lịch sử của thử nghiệm12/10.

[Lộ trình hiện hành](2026-10-15-futures-average-02pct-improvement.md) · [Kết quả đầy đủ](../research/2026-10-15-futures-average-02pct-improvement.md) · [Tích hợp paper](../research/2026-10-16-futures-cct-paper-integration.md).

**Chưa đạt mục tiêu kinh tế.** CCT một ví128 ngày net+14,1381/+12,6672u, mean+0,11045/+0,09896u/ngày cơ sở/chi phí cao; không breach10u trong mô hình, audit6.063.198 kiểm tra PASS. Không lấy riêng64 ngày thắng hoặc cộng hai ví reset để thay toàn kỳ. Không yêu cầu từng kỳ64 ngày phải dương.

Đã thêm CCT vào mã engine/provider/service/API/UI và testbed. Các kiểm thử cùng TypeScript đã đạt; bản đối chiếu TS128 V3 đã hoàn tất sau sửa Money40:6.801.300 phép kiểm tiền, sai lệch0. Chưa chọn CCT mặc định, deploy hoặc gửi lệnh thật, vì điều kiện0,2u/ngày còn thiếu. Chuẩn bị mã không đồng nghĩa đủ bằng chứng để áp dụng chiến lược.

Bước nghiên cứu tiếp theo: chẩn đoán cơ hội tái vào sau reset, kiểm rổ theo quy tắc nguồn gốc và dữ liệu/lot, sàng lọc phương pháp có primary sources đủ tái hiện. Chỉ thử thiết kế đã ghi rõ; dùng lại128 ngày hiện là development. Không tăng ngân sách10u, tự hạ mục tiêu hoặc quét tham số đến khi ra bản thắng. Không tạo tool goal mới từ lệnh continue.

**Phần dưới giữ nguyên contract và kết quả P1 ngày12–13/10 để tra cứu; trạng thái COMPLETE_STUDY chỉ áp dụng cho P1 đó.**

# Goal quick win — Futures 100 USDT

**Trạng thái: COMPLETE_STUDY — NO_GO; gói nghiên cứu hoàn tất ngày13/10/2026, mục tiêu sinh lời chưa đạt.** [Run hiện hành](../audits/futures-quick-win/qw1-20261012T132319Z/goal-start.json). Ngày lập: 12/10/2026, giờ Việt Nam.

**Kết quả đã kiểm toán:** đủ92ngày/case; base net+0,04774456USDT, mean+0,00051896/ngày; stress−2,23619230, mean−0,02430644/ngày. AuditPASS cả hai; 0breach/0modeledliquidation; observed1USDT/ngày=false cả hai. [Báo cáo và giới hạn](../audits/futures-quick-win/qw1-20261012T132319Z/report.md), [terminal](../audits/futures-quick-win/qw1-20261012T132319Z/terminal.json). Protocol/source/data khóa trướcPnL, không sweep/tuning; không đổi runtime. P1 dừng, P2 cần goal/registration riêng. T0/deadline và thiết kế dưới đây giữ làm contract lịch sử của phép đo.

**Mục tiêu:** chốt một quyết định kinh tế có bằng chứng cho ứng viên P1 EMA averaging trên vốn giả lập 100 USDT, trong tối đa **16 giờ làm việc và 48 giờ kể từ lúc bắt đầu**. Kết quả phải có PnL ròng, ngân sách lỗ ngày và kết luận đi tiếp hoặc dừng; không kết thúc ở docs, scaffold hoặc tests.

Quick win ưu tiên tìm một ứng viên có lãi sau chi phí để chuyển sang paper prospective. Mục tiêu hệ thống vẫn là khoảng **1 USDT ròng/ngày lịch**. Có lãi 0,2 USDT/ngày chỉ là ứng viên dương, không được báo đạt 1 USDT/ngày hoặc bảo đảm lợi nhuận tương lai.

## Yêu cầu giữ đúng

Theo [policy hiện hành](../runtime-risk-policy.md): vốn ban đầu **100 USDT**; lỗ tối đa **10 USDT/ngày cố định** trên toàn tài khoản; không giới hạn số lệnh; chấp nhận ngày âm/dương và ngày không giao dịch; kỳ vọng khoảng **1 USDT ròng/ngày lịch**.

ICT/SMC, BTC-only, cooldown 1h, exposure 100u, SL floor 0,8%, sizing 0,5%, trần 3%/lệnh, DD 15% và các gate giao dịch cũ không còn là ràng buộc. Averaging, long/short và đòn bẩy được nghiên cứu. Các thông số bên dưới chỉ là phạm vi của thử nghiệm đầu tiên, không phải rule mới của người dùng. Chỉ hỏi lại nếu cần đổi chính yêu cầu mới hoặc cần quyền ngoài phạm vi đã giao.

## Chỉ làm một ứng viên đầu tiên

**P1: EMA-anchor averaging trên SOLUSDT, one-way long hoặc short.** Chọn SOL vì seed có sẵn và ticket phù hợp vốn nhỏ trong feasibility đã làm; không mở tìm kiếm hàng chục coin/config.

Nguồn đã đọc: [nghiên cứu sâu hơn](../research/2026-10-12-futures-aggressive-followup.md); [config Passivbot đã lưu](../audits/2026-10-12-futures-aggressive-research/passivbot-source/configs/examples/ema_anchor.json), revision `82e0edf67a1f037b783d139039021ade8f449478`.

Seed đề xuất: EMA 415/793 phút; base fraction 0,06; exposure 2,5 mỗi hướng; doubling 1,96; `hedge_mode=false`. Ticket khởi đầu lý thuyết 15 USDT trên vốn 100. Không hiểu exposure hai hướng thành đồng thời 5×. Dùng toàn bộ entry/exit/spacing của seed đã pin, không triển khai vài con số rồi gọi là bản sao Passivbot.

Ở bước đăng ký, chốt leverage, margin buffer, stop/exit, rounding và phần sửa cần thiết cho vốn 100; lưu toàn bộ config và diff so với seed **trước PnL**. Nếu cần thay seed để khả thi, nêu lý do lot/margin hoặc lỗi thực thi đã xác minh; không chọn tham số theo lãi vừa nhìn thấy.

Tái sử dụng code, adapters, ledger và runner phù hợp đang có; tạo version nghiên cứu mới có seed thật 100. Không dùng runner gắn cứng 31,47744546 hoặc nhân wallet theo account row. Chặng này chưa cần sửa toàn bộ production workers. Nếu chạy bằng harness riêng, kết luận phải ghi rõ chưa có parity toàn hệ thống; đầu ra còn phải có interface/diff để tích hợp strategy và governor vào hệ thống hiện tại.

## Phép đo kinh tế tối thiểu

**Kỳ chính dự kiến: 01/07–30/09/2026 theo Asia/Ho_Chi_Minh, 92 ngày lịch liên tục.** Warmup riêng trước 01/07 đủ cho span lớn nhất; đăng ký thời điểm và dữ liệu trước PnL. Warmup không giao dịch, bắt đầu kỳ chính với đúng 100 USDT và không có vị thế. Không chọn một tháng đẹp sau khi xem return.

Dùng public price/mark phút và funding settlement của SOL; chốt listing/filter/tick/step và margin assumptions. Nếu chỉ có filters hiện tại, ghi đó là giả định hồi cứu, không giả làm historical exchange rules. Coverage và gap policy phải đăng ký; thiếu dữ liệu trọng yếu không được lấp bằng giá tương lai hoặc bỏ ngày xấu. Không tự cắt kỳ rồi báo COMPLETE của cả 92 ngày.

Đây là phép đo hồi cứu development. Seed bên ngoài có thể đã được tác giả tối ưu đến `end_date=now`; chưa biết upstream đã dùng những dữ liệu nào. Không gọi kỳ này là holdout độc lập, true out-of-sample hoặc bằng chứng kỳ vọng tương lai.

Chỉ chạy **một config chính, hai case base/stress**, cùng vốn, timestamps và governor. Mỗi case là một tài khoản 100 USDT riêng để so sánh, không cộng hai case thành tài khoản 200 USDT. Nếu sẵn đường chạy, một ablation bỏ averaging trên development được phép, nhưng không trì hoãn hai case chính để làm ablation.

Chi phí phải gồm phí giao dịch, slippage, funding thực theo settlement, đóng vị thế cuối kỳ và chi phí ngoài sàn khi có. Mặc định đề xuất cho screen: phí 0,05% mỗi phía ở cả base/stress; slip base 0,02%, stress 0,10% mỗi phía. Đây là scenario giả định trước đo, không phải phí tài khoản đã xác minh. Ghi execution reference để không cộng spread/slip hai lần. Nếu dùng limit fills, stress thêm missed fills/price penetration; không cho fill chắc chắn chỉ vì nến chạm giá.

Tín hiệu chỉ dùng dữ liệu đã biết; lệnh dựa trên close chỉ có hiệu lực từ thời điểm giao dịch kế tiếp. Với bar phút, quy định thứ tự intrabar bất lợi hoặc báo khoảng bất định; không chọn thứ tự high/low giúp averaging có lãi. Giá stop làm tròn tick đúng hướng; funding/liquidation/closeout dùng đúng mark và thời điểm. Nếu không đủ margin-tier dữ liệu, ghi mô hình và giả định rõ, chưa được gọi là bảo đảm không liquidation thực.

Mean ròng = toàn bộ net PnL / **92 ngày**, gồm ngày không lệnh; không lấy CAGR/365 hoặc chia cho riêng ngày có giao dịch. Đăng ký lịch terminal flatten lúc **23:59 ngày 30/09 ICT**, với execution reference có thể biết ở thời điểm đó; hoàn tất trước 00:00 ngày 01/10 và ghi phí/MTM/closeout vào đúng ngày. Nếu fill trễ vượt cutoff, lưu phần phát sinh và báo scope chưa khớp, không đưa phí ngày 01/10 vào kỳ 92 ngày rồi coi đủ kỳ. Báo riêng days traded, fills/round trips và PnL theo ngày; không có chỉ tiêu bắt buộc về số lệnh.

## Bộ kiểm soát lỗ ngày phải có trong replay

Một ledger/governor chung cho tất cả vị thế và lệnh chờ của tài khoản, kể cả khi sau này thêm coin. Anchor lúc 00:00 Asia/Ho_Chi_Minh; vị thế qua đêm vẫn được marked. Cashflow không xóa lỗ; fees/funding đã nằm trong equity không trừ lần nữa.

Reserve phần lỗ tăng thêm **từ mark hiện tại** đến stop/close cho open/pending, cộng chi phí đóng và funding/slippage chưa ghi; tránh đếm lại unrealized loss đã nằm trong net_day. Entry/averaging chỉ được nhận nếu tổng reservation còn nằm trong ngân sách còn lại. Ngân sách đo so với equity đầu ngày, không tự đổi thành drawdown từ đỉnh.

Khi gần hết 10 USDT: block entry → cancel pending và đối soát race → close reduce-only → verify trạng thái/ledger; latch đến ngày tiếp theo. Anchor/reservation/latch phải phục hồi qua restart theo clock của replay. Native HSL theo episode/EMA của Passivbot không thay governor này.

Kiểm có ý nghĩa: midnight với vị thế mở, funding/fees, partial fill/cancel race, restart, ngày lời rồi lỗ và gap qua stop. Kiểm MTM trong ngày và extrema có thể quan sát ở dữ liệu đã chọn; không chỉ ghi equity lúc close hoặc cuối ngày. Overshoot phải lưu thật: có breach không được gọi đạt trần 10 USDT trong scope. Mô phỏng bar phút chưa chứng minh trần tuyệt đối ngoài thị trường.

## Tiến độ và giới hạn thực thi

T0 = 12/10/2026 20:23:19 ICT; deadline48giờ = 14/10/2026 20:23:19 ICT. Goal đã active; tracking phase và usage ở run hiện hành. Mỗi checkpoint phải có artifact hoặc blocker cụ thể, không báo tiến triển bằng số helpers/tests.

| Chặng | Giới hạn công việc | Đầu ra bắt buộc |
|---|---:|---|
| 1. Inputs và registration | 4 giờ | Coverage/feasibility, config đầy đủ, costs/margin assumptions, period, hashes, seed100 và governor contract |
| 2. Replay tối thiểu đúng | 8 giờ | Strategy/governor/funding path, kiểm lỗi tài khoản quan trọng, prefix ledger/throughput và diff tích hợp |
| 3. Chạy và chốt quyết định | 4 giờ | Terminal base/stress đủ kỳ hoặc INCOMPLETE, ledger/cost audit độc lập, report một trang |

Một prefix kỹ thuật tối đa 20 phút; screen nhỏ tối đa 30 phút/case. Chốt estimate và cutoff trước lượt dài; replay chính tối đa 60 phút/case. Tổng việc tối đa 16 giờ chủ động, deadline 48 giờ từ T0, không tự gia hạn. Nếu dữ liệu/tốc độ không đáp ứng, lưu coverage và `INCOMPLETE`; không đổi partial thành kết quả đủ kỳ.

Đọc public API/archive và thử nghiệm local trong quyền nghiên cứu đã có. Chặng này dự kiến 0 paid LLM, private API, orders, transfers hoặc runtime deployment. Không cần AI để có phép đo đầu tiên. Đây là giới hạn công việc của quick win, không là hạn chế chiến lược tương lai.

Không sweep, không tuning theo PnL validation đã xem, không resume runner/goal cũ. Chỉ chạy lại khi có lỗi mới tái hiện và version/source/config mới được đăng ký; giữ kết quả lỗi ban đầu. Không kéo dài bằng polling hoặc chuỗi sửa helper không đi tới economic terminal.

## Đầu ra phải bàn giao

Lưu dưới một thư mục run mới `docs/audits/futures-quick-win/<run-id>/`; run hiện hành đã tạo lúc kích hoạt; registration/financial measurement vẫn phải có trước PnL.

1. `protocol.json`, config và source/data receipts: timestamps, giả định, vốn100, source hash, cutoff và phạm vi đã/ chưa xác minh.
2. `terminal.json`, fills/funding/cost ledger và daily/intraday MTM: đủ hai case, coverage, net, worst day, breaches/overshoot, MDD, modeled liquidation và inventory cuối kỳ.
3. `audit.json` và `report.md`: đối chiếu tiền độc lập, lỗi/unknown; báo mean USDT/ngày lịch, uncertainty theo ngày/chuỗi ngày, mức tập trung vào vài ngày thắng, verdict và việc kế tiếp duy nhất. Nếu mẫu không đủ ước lượng đáng tin, ghi rõ.

Không dùng tests/arithmetic hoặc leaderboard của người khác thay ba đầu ra này.

## Verdict: quyết định đi tiếp khác với đạt mục tiêu

| Verdict | Điều kiện | Ý nghĩa |
|---|---|---|
| **GO_QUICK_WIN** | Phép đo đủ scope; net positive ở cả base/stress; không breach 10 USDT/ngày trong mô hình đã khai báo; không modeled liquidation; accounting audit đạt | P1 đáng chuyển sang prospective paper. Chưa chứng minh live/1 USDT/ngày hoặc toàn hệ thống |
| **NO_GO** | Phép đo hợp lệ nhưng net không dương, breach hoặc modeled liquidation | Loại config này với bằng chứng; không quy thành mọi averaging đều vô ích |
| **INCOMPLETE** | Hết cutoff, thiếu dữ liệu trọng yếu, lỗi accounting hoặc không đủ coverage | Chưa có kết luận kinh tế hợp lệ; lưu blocker, không gọi strategy FAIL hoặc quick win đạt |

Chỉ tính `target_observed_base` và `target_observed_stress` khi case có measurement hợp lệ, đủ 92 ngày và đầy đủ chi phí/accounting; đặt `true` nếu mean net case tương ứng ≥1 USDT/ngày lịch, `false` nếu thấp hơn. Khi thiếu coverage/cost hoặc measurement invalid, dùng `null`/`UNKNOWN`, không đặt cờ từ partial PnL. Ngưỡng 1 là mốc so sánh cho kỳ vọng “khoảng 1”; ghi số thực tế và uncertainty, không làm tròn để đổi verdict. Khi base đạt nhưng stress chưa đạt, nói rõ khác biệt. Hai cờ này không biến dữ liệu hồi cứu thành kỳ vọng đã được xác nhận.

Không yêu cầu từng ngày, tháng hoặc rolling window dương; không áp lại DD15% hay cap per-trade cũ. MDD/ruin và uncertainty phải được báo để đánh giá, không tự biến thành yêu cầu mới của người dùng.

Nếu `GO_QUICK_WIN`, việc kế tiếp là paper prospective với frozen config và actual coverage/cost, rồi mới replay dài/parity và đề xuất thay runtime. Nếu `NO_GO`, P2 wick recovery là ứng viên kế tiếp trong [roadmap](2026-10-12-futures-system-research-roadmap.md), cần registration mới; không tự mở thêm P2 để vượt workbox goal này. Nếu `INCOMPLETE`, chỉ rõ một blocker cần giải quyết trước; không mở nhánh mới để che phép đo thiếu.

Hoàn thành gói điều tra có thể giao verdict âm; điều đó không có nghĩa đã đạt quick win kinh tế hoặc mục tiêu bình quân 1 USDT/ngày.

## Objective sẵn dùng khi kích hoạt

> Thực hiện goal quick win Futures theo tài liệu này: chốt một quyết định kinh tế có bằng chứng cho P1 EMA-anchor averaging trên vốn giả lập 100 USDT, governor chung 10 USDT/ngày Việt Nam, kỳ 92 ngày đã đăng ký và hai case base/stress. Tái dùng đường chạy phù hợp, sửa tối thiểu để tính đúng funding/chi phí/MTM; không giữ các trading rules cũ, không sweep, không rollout. Trong tối đa 16 giờ làm việc / 48 giờ từ T0, bàn giao protocol/config/data receipts, economic terminal/ledgers, audit và report với GO_QUICK_WIN/NO_GO/INCOMPLETE; báo riêng mức quan sát 1 USDT/ngày. Không đánh đồng thiếu phép đo hoặc có lãi dưới mục tiêu với đạt kỳ vọng.

[Bàn giao hiện hành](roi-opportunity-progress.md) ghi kết quả đã hoàn tất; các snapshot lúc lập tài liệu ghi trạng thái chưa chạy là lịch sử. [Snapshot trước cập nhật quick win](../audits/2026-10-12-futures-quick-win-documentation/prior-docs-receipt.json) giữ lịch sử; không sửa artifacts nghiên cứu trước.
