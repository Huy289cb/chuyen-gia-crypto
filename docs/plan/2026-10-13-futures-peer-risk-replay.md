# Trạng thái sau A/B —14/10/2026

[Account A/B trials](../audits/futures-quick-win/method-trials-20261013T152454Z/report.md) hoàn tất: hai V1 âm sau chi phí, money audits độc lập PASS. [Source-transfer feasibility](2026-10-14-futures-source-transfer-feasibility.md) là ưu tiên kế tiếp, chưa chạy. Nhánh peer trong tài liệu này vẫn là hypothesis riêng chưa có account PnL, thứ cấp; không gán outcomes A/B cho peer. Engineering frozen giữ nguyên, chỉnh core tạo derivative. Timeline/next dưới đây là lịch sử; chưa scheduler/toolgoal/runtime change.

# Thứ tự nghiên cứu cập nhật — 13/10/2026

[Điều tra lợi nhuận cao](../research/2026-10-13-futures-high-return-evidence.md) bổ sung cơ chế và bằng chứng mới. [Plan A/B](2026-10-13-futures-aggressive-candidates.md) hiện ưu tiên momentum/volatility giữ inventory, rồi grid regime. Hypothesis peer stop/sizing ở tài liệu này chuyển thành nhánh thứ cấp; không còn là next duy nhất. Prototype wallet/governor và inputs đã kiểm vẫn dùng chung bằng derivative có version. Các tham số/timeline dưới là thiết kế cũ của nhánh peer, không đăng ký tài chính cho A/B. Chưa account replay mới, scheduler hoặc runtime change.

# Trạng thái sau chuẩn bị — 13/10/2026

[Package](../audits/futures-quick-win/peer-risk-20261013T142339Z/report.md) **ENGINEERING_READY — FINANCIAL_NOT_REGISTERED_NOT_RUN**. Đủ bảy coin/927.360 phút trade+mark,56 archives;141 inputs khoảng181 MB. Audit độc lập 9.273.600 minute fields và77.280 aggregate fields PASS. Wallet/Governor có 16 tests nội bộ và 16 checks độc lập PASS; đã sửa stale commit và mark stop. Chưa ghép event runner hoặc money auditor tài khoản.

Kế tiếp là workbox4 giờ chủ động ghép runner/auditor, stream inputs trên host khoảng956 MiB RAM, chốt timing/intrabar/gap rồi freeze protocol tài chính mới. Source/receipts engineering giữ nguyên; chỉnh core tạo derivative có version. Prefix24 giờ và main60 phút/case theo kế hoạch. Chưa có PnL tài khoản, chứng minh10u/1u, runtimechange, toolgoal hoặc scheduler. Timeline14–15/10 dưới đây là dự kiến; có thể làm sớm khi đủ điều kiện.

# Phép thử kế tiếp: stop toàn rổ và sizing theo ngân sách 10u

Ngày 13/10/2026 ICT. **PLANNED_NOT_REGISTERED_NOT_RUN đối với account replay**. Nhánh chuẩn bị: `docs/audits/futures-quick-win/peer-risk-20261013T142339Z`; chưa có goal công cụ hoặc scheduler. Kết quả tài khoản và mục tiêu 1u/ngày còn chưa đo.

## Vì sao thử thiết kế này

[Spillover screen](../audits/futures-quick-win/spillover-20261013T141126Z/report.md) cho peers gross +0,081792%, net base +0,002081%, stress −0,088819% trên normalized gross notional/ngày lịch. Cấu hình giữ đủ 24h hiện tại NO_GO; không promote hoặc chỉ tăng size của chuỗi ấy. Tuy nhiên screen chưa đo stop và đường đi của tài khoản. Một quy tắc thoát khi rổ gần hết ngân sách có thể thay cả thời gian giữ, funding và phân phối lãi/lỗ; đó là **hypothesis mới cần phép đo riêng**, chưa phải bằng chứng sẽ cải thiện expectancy.

Giữ các yêu cầu người dùng: một tài khoản ban đầu 100u; ngân sách chung cố định 10u/ngày ICT; không cap số lệnh; chấp nhận ngày âm/dương; mean khoảng 1u ròng/ngày lịch. Không phục hồi ICT/SMC, cooldown, exposure 100, SL floor, sizing 0,5% NAV, trần 3%/lệnh hoặc DD15. Các mức dưới đây chỉ là tham số nghiên cứu V1.

## V1 cần khóa trước account PnL

| Thành phần | Thiết kế đề xuất |
|---|---|
| Entry | Giữ causal peer forecasts, bảy coin, monthly fit, hurdle 0,003 và tie policy đã kiểm. Tách input quyết định khỏi exit prices/PnL của screen |
| Wallet | Một cash ledger và positions theo symbol; equity = cash + tổng signed MTM. Không tạo hai wallet 100u hoặc hai ngân sách 10u |
| Ngày | Anchor tại 00:00 ICT từ equity có mark hợp lệ; carry positions được tính. Phí/funding/closeout phân ngày theo actual event timestamp. Thiếu anchor không được reset từ equity hiện tại |
| Ngân sách thiết kế | Planned close loss 8u, 2u dự phòng gap/latency. Kiểm actual loss so với anchor−10; mọi overshoot phải giữ trong báo cáo |
| Sizing | Dùng 60 daily paired returns đã đóng: `r_pair = 0.5*(r_long-r_short)`; population σ, adverse fraction `max(0.005, 2σ)`. Gross notional theo phần ngân sách 8u còn lại, adverse fraction, stress round-trip costs và funding reserve |
| Margin | Leverage 10, slack 5u, cộng gross hai chân; kiểm margin sau entry fee/slip. Không cho long/short triệt tiêu gross margin. Maintenance 0,5% chỉ là giả định mô hình cần công khai, chưa historical tier proof |
| Lot/minimum | Floor quantity theo current market step; kiểm minQty/minNotional theo mark. Một chân không đủ thì giữ tiền cả rổ; không loại BTC sau outcome. Báo hedge imbalance do rounding |
| Stop | Project equity sau đóng cả hai chân với fee/slip, trừ reserve funding chưa book; flatten toàn rổ khi gần anchor−8. Cũng dừng nếu net loss theo mark chạm 8u, dù trade basis làm projected close có vẻ thuận lợi. Phí đóng đã có trong projected close, không trừ hai lần |
| Funding | Mỗi coin reserve bằng max absolute settled rate trong 30 ngày đã biết, floor 0,0001. Prototype giữ bốn slots của một cửa sổ 24h tại mỗi kiểm tra; chưa giảm slots khi thời gian giữ còn ít, nên bảo thủ hơn reserve tới giờ thoát dự kiến. Book actual mark/rate một lần, funding ID bền vững, kiểm lại risk sau settlement |
| Turnover | Đóng rổ cũ rồi chọn rổ mới hàng ngày; cuối kỳ flatten 23:59 ICT. Khi latch dừng ngày bật, không mở lại trong chính ngày ấy |
| Chi phí | Fee 0,0005/phía; slip base 0,0002, stress 0,001. Cùng sizing rule dùng stress reservation ở cả hai case. Không giả maker fill hoặc chọn phí để cứu outcome |

Con số gross size phải tính lại từ fee/slip/mark và actual rounded quantities, không chỉ lấy công thức gần đúng rồi bỏ reservation. Atomic pair admission và rollback phải giữ phí nếu có partial fill; account replay chưa được giả hai chân khớp hoàn hảo rồi gọi là production proof.

## Việc đang chuẩn bị và điều kiện trước chạy

Chuẩn bị public trade/mark 1m cho cả bảy coin, đủ 132.480 phút kỳ 92 ngày; checksum và exact hourly aggregation. Không forward fill gap trong kỳ chính. Hourly training và funding lấy từ inputs đã frozen, có hash/provenance.

Prototype đa vị thế cần kiểm hai legs chung ngân sách; projected close costs; reserve không tính funding hai lần; min-ticket rejection; day roll; checkpoint/restart không reset anchor/latch/funding IDs. **Prototype và tests chỉ xác nhận chức năng đã kiểm, không phải PnL hoặc bảo đảm lỗ ngày.** Chưa ghép strategy vào production.

Admission phải dùng đúng 60 labels mới nhất đã đóng. Local atomic commit chỉ hợp lệ tại cùng timestamp với đề xuất đã kiểm; đề xuất cũ sau latency, đổi ngày hoặc restart phải hủy/reprice, không ghi fill ở giá cũ. Giới hạn này là của mô hình local, chưa thay cơ chế exchange partial-fill/reconciliation.

Trước registration tài chính phải chốt thứ tự event, mark sampling, funding settlement, entry/close latency, cách stress intrabar và xử lý gap. Không dùng high/low chưa biết để chọn lệnh rồi đặt fill ở giá quá khứ. Minute OHLC không cung cấp timestamp đồng thời của extrema hai coin; joint adverse bound chỉ là giả định stress, phải tách khỏi observed MTM. Một minute ledger không tự chứng minh giám sát liên tục hoặc protective exchange execution.

Runner và auditor độc lập phải dùng một wallet, kiểm lot/margin/liquidation, toàn bộ 92 ngày gồm giữ tiền, end-flat, fee/funding, anchor, breach và restart. Sau đó mới freeze source/config/data/protocol. Dùng prefix 24h đo throughput; mỗi base/stress main tối đa 60 phút. Không sửa config sau outcome, không gia hạn run vì chưa ra số đẹp.

## Tiến độ có đầu ra cụ thể

- **13/10:** đóng spillover screen trước mốc 14–15/10 cũ; chuẩn bị minute inputs và prototype shared wallet/governor. Bàn giao receipt, tests và các thiếu sót thật; account PnL NOT_RUN.
- **14/10:** tối đa 4 giờ chủ động ghép replay và auditor, chốt event/intrabar specification; bàn giao registration đủ điều kiện hoặc INCOMPLETE có nguyên nhân. Có thể làm sớm nếu sẵn sàng; chưa có tác vụ tự chạy.
- **15/10:** nếu đã registered, chạy đúng một V1 base/stress trong cutoff, audit và giữ mọi kết quả. Không dùng CI chứa zero hoặc control chưa bị vượt làm veto; net, rủi ro và mức bất định được báo riêng.
- **Sau development:** chỉ ứng viên có ích mới kiểm thêm một mẫu chưa dùng để chọn tham số của nhánh này. Đề xuất 01–12/10/2026 ICT, protocol khóa trước khi xem PnL giai đoạn ấy; 12 ngày chưa đủ xác nhận kỳ vọng dài hạn. Không rename Jul–Sep đã xem thành validation.

GO nghiên cứu tiếp không đồng nghĩa đạt mean 1u/ngày hoặc sẵn sàng live. Net âm loại V1 cụ thể; breach hoặc thiếu margin/ledger/mark không được che bằng mean dương. Bounded development mới được đăng ký riêng; giữ nguyên mọi artifacts cũ. Không private API, paid LLM, orders, transfers hoặc runtime deployment. Quyền nghiên cứu đã có; không xin lại quyền chọn stop/sizing trong yêu cầu mới.
