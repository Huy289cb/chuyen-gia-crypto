# Đánh giá vận hành và kế hoạch ICT Smart Money — 20/09/2026

## Kết luận

Bot chưa chứng minh ROI+. Cần ưu tiên chất lượng setup, vòng đời cấu trúc và mô phỏng đúng thực thi trước khi mở rộng số lệnh. Không có căn cứ chỉ hạ RR hoặc bỏ gate để đạt mục tiêu. Kế hoạch này đề xuất tăng **lệnh khớp có expectancy ròng dương**, không tăng lượt scan hay số tín hiệu thô.

Kiểm tra trực tiếp DB lúc 16:06 ICT ngày 20/09/2026, log worker, môi trường API/worker, code hiện có và các nghiên cứu trước. Trong lượt này chỉ đọc hệ thống và lưu báo cáo; không sửa chiến lược, restart, đặt lệnh hoặc thay rủi ro. Dữ liệu DB dùng tên bảng Testnet nhưng endpoint runtime là `fapi.binance.com`; không suy ra đây là paper trading từ tên bảng.

## 1. Kết quả chạy hiện tại

| Phạm vi | Lệnh đóng | Thắng / thua | PnL theo ledger, USDT |
|---|---:|---:|---:|
| 7 ngày | 2 | 0 / 2 | −1,39874143 |
| 14 ngày | 3 | 0 / 3 | −2,07624179 |
| 30 ngày | 6 | 0 / 6 | −4,12737338 |

Tài khoản: vốn gốc 40; balance/equity 32,20090460; realized PnL −7,79909540; tổng 39 giao dịch; chuỗi thua 6. Thay đổi số dư so vốn gốc **−19,4977%**. Đây chưa phải ROI đầy đủ sau AI hoặc lợi suất đã điều chỉnh nạp/rút; cần xác nhận cash-flow ledger trước khi dùng làm KPI chính thức. PnL vị thế hiện đã bao gồm phí/funding theo logic ledger; không trừ chúng lần hai. Cửa sổ thống kê dùng thời điểm đóng và chứa nhiều phiên bản chiến lược, không phải OOS của một mô hình cố định.

Lệnh mới nhất decision1099: BTC long 0,001 tại 81.372; SL 80.720; TP 83.328; RR kế hoạch 3. Đóng tại 80.715,3, gross −0,6567; phí vào 0,01627440; phí ra 0,04035765; funding 0,01628347; net **−0,72961552**. Event `pnl_ledger_v2` chứa fills và funding tương ứng; event close có `fill_verified=true`. Lượt này chưa gọi lại API sàn để xác minh độc lập. `stale_ghost_open` mô tả cách đồng bộ, chưa phải bằng chứng algo SL là nguyên nhân exit; cần nối algo→actualOrderId→fill. Rủi ro dự kiến gồm phí/trượt giá là 0,814744 USDT, khoảng 2,474% ví, dưới trần 3% nhưng cao hơn target sizing 0,5% do min lot.

Worker vẫn scan và reconciliation tại thời điểm kiểm tra, log báo không còn vị thế mở/pending. Có timestamp retry Binance và OpenRouter 404 trong log gần đây; chưa đủ bằng chứng các lỗi này gây ra lỗ hoặc bỏ lỡ lệnh. Cần đo tỷ lệ lỗi, fallback và độ trễ theo trace.

### Funnel 7 ngày: nút thắt chủ yếu ở phát hiện setup

2.854 observation key duy nhất, từ 13/09 16:10 đến 20/09 16:05 ICT: 2.014 khung 5m, 672 khung 15m, 168 khung 1h.

| First block | Số quan sát | Ý nghĩa |
|---|---:|---|
| signal_gate | 2.614 (91,59%) | Phần lớn bar không đạt setup hiện hành |
| structure | 203 (7,11%) | Có hướng/setup nhưng bị chặn cấu trúc đầu tiên |
| pullback_proxy | 26 | Hình học entry/pullback chưa phù hợp |
| entry_5m_guard | 5 | Guard entry |
| account_eligibility | 4 | Guard tài khoản |
| grade_playbook | 1 | Grade |
| Không có first block | 1 | Không đồng nghĩa đã được thực thi |

Đây là **core shadow funnel**, không đại diện toàn bộ nhánh range hoặc admission thực. Có 730 bản ghi chưa có classification mới; phải tách measurement version. Nhiều bar thuộc cùng sóng nên không được gọi 2.614 lần block là 2.614 cơ hội mất. `all_blocks` còn chứa trạng thái unavailable/not-applicable; chỉ đếm gate có status=block khi phân tích nguyên nhân sâu.

### Bằng chứng nghiên cứu đã có

- Testbed 05–19/09: RR1,5 / RR2 / RR3 đều 1 entry, 0 thắng, net −0,79822898 USDT. Đây là offline baseline, không đại diện toàn bộ live range. Một lệnh không đủ so sánh edge nhưng cho thấy hạ RR riêng lẻ không tăng entry trong mẫu này.
- Detector sweep→MSS→FVG đã tồn tại offline: 2 plan ban đầu đều hết TTL không khớp. Không cần viết lại detector từ đầu.
- Collector prospective freeze 16–30/09 mới có báo cáo đến 17/09: 1 candidate trong cửa sổ, outcome ambiguous cùng phút; sizing probe bị execution_risk. Chưa có full admission/baseline parity hoặc ROI. Không gọi snapshot này là kết quả cập nhật đến 20/09.
- Review decision1029 ngày 15/09: sweep chỉ 2,7 USDT đồng thời có breakdown volume 1,61x; MFE khoảng 0,46R. TP1R cũng không cứu được lệnh đó. Đây là giả thuyết về chất lượng reclaim, không đủ để chọn threshold sau khi biết kết quả.
- `classifyStructureBias` hiện xét hai swing high/low gần nhất. Nó chưa thể hiện đầy đủ lifecycle protected swing/BOS; có nguy cơ bias trễ khi giá phá mức bảo vệ nhưng chưa hình thành pivot mới. Đây là thiếu sót thiết kế cần kiểm thử, chưa chứng minh gây từng lệnh lỗ.

## 2. Mục tiêu và ràng buộc

Giữ BTC; cooldown 1h; ngân sách ngày 10%; risk/lệnh tối đa 3% equity/balance theo policy hiện hành gồm dự phòng chi phí; target sizing 0,5%; cap USD rỗng. Đã kiểm tra các khóa chọn lọc trong môi trường API và worker. Giữ SL floor đang dùng khi thử vòng đầu để tách tác động.

RR3 không bắt buộc theo quyết định ngày 15/09. Core runtime hiện vẫn MIN_RR_RATIO=3, trong khi nhánh range đã có RR1,5; không mô tả toàn bot là chỉ nhận RR3. RR thấp hơn là biến thể nghiên cứu hợp lệ nhưng chỉ chọn khi net expectancy ngoài mẫu dương.

KPI ưu tiên:

1. ROI tài khoản sau commission, funding, execution slippage, AI; cash-flow tách riêng. Dùng fill thực thì slippage đã nằm trong giá, không trừ lại.
2. Expectancy net/trade và profit factor; drawdown mark-to-market; khoảng bất định theo cụm ngày/sóng.
3. Số lệnh khớp duy nhất/tuần, fill rate trên candidate đủ điều kiện, delta so baseline trên cùng cửa sổ.
4. Expectancy của **lệnh bổ sung** và tác động của những lệnh baseline bị ứng viên thay thế do cạnh tranh vốn/cooldown.

Mục tiêu nghiên cứu ban đầu: tăng ít nhất 25% lệnh khớp so baseline nếu baseline có đủ giao dịch để so tỷ lệ; khi baseline gần 0 phải báo delta tuyệt đối. Đây là mục tiêu thử nghiệm, không chỉ tiêu ép bot giao dịch. Lợi nhuận và drawdown được ưu tiên hơn số lượng.

## 3. Thiết kế ICT/SMC để tăng cơ hội có chất lượng

### A. Hoàn thiện bối cảnh và liquidity map

- H4/H1: swing có timestamp xác nhận, protected high/low, BOS close, transition và invalidation. Phá swing bảo vệ phải cập nhật trạng thái mà không đợi thêm hai pivot hoàn chỉnh. Phân biệt break bằng close với wick sweep.
- M15: liquidity từ swing, EQH/EQL, previous-day high/low và session high/low. Mỗi level có ID, thời điểm biết, tuổi, swept/unswept, invalidation; không chọn lại anchor sau khi biết outcome.
- Target: mục tiêu còn hiệu lực gần nhất theo hướng trade. Nếu đã bị phá thì cập nhật lifecycle; nếu vẫn là cản thì không bỏ qua để tìm target xa nhằm đạt RR.
- Cùng một vùng OB/FVG/EQH không được cộng thành ba tín hiệu độc lập. OTE, session và volume là feature để kiểm định, không bắt tất cả đồng thời.

### B. Ưu tiên nhánh đã có: sweep → displacement/MSS → FVG

Tiếp tục detector freeze hiện hành: sweep/reclaim pivot M15 đã biết; MSS xác nhận trong tối đa 4 bar; displacement body≥ATR14 trước nến; FVG biết sau nến thứ ba đóng; midpoint entry từ nến sau; TTL4 M15. Đây là thông số nghiên cứu dự án, không tuyên bố là định nghĩa ICT duy nhất.

Trước hết hoàn thiện dữ liệu và execution parity cho bản này. Sau khi đóng cửa sổ freeze, chỉ thử **một** thay đổi để tăng fill: entry ở biên FVG thay midpoint, giữ nguyên TTL và tiêu chuẩn cấu trúc. Đánh đổi phải đo: fill tăng nhưng entry kém hơn, RR giảm, adverse selection tăng. Không thử đồng thời nhiều TTL/entry rồi chọn đường đẹp.

SL tại điểm mất hiệu lực + buffer và floor hiện hành. TP theo liquidity/structure đã biết; ghi RR liên tục và RR ròng dự kiến, không kéo TP. Không dùng confidence của LLM làm xác suất thắng.

### C. Nhánh mở rộng tiếp theo: continuation pullback

Chỉ sau B: H4/H1 có hướng còn hiệu lực, M15 BOS/displacement, hồi FVG hoặc OB được định nghĩa bằng nến gốc trước impulse. Long ở vùng discount của dealing range đóng băng, short đối xứng ở premium; M5 dùng xác nhận entry, không tự đảo hướng HTF. Hết TTL hoặc phá protected swing thì hủy.

Nhánh continuation giúp tìm cơ hội mà không bắt buộc chờ sweep đảo chiều. Phải đo độ trùng với breakout/retest hiện có bằng wave/level ID. Short kiểm thử đối xứng nhưng đánh giá riêng, không mặc định hiệu quả bằng long. Chưa đưa trực tiếp vào runtime.

### D. Range failed-breakout và exit

Nhánh range hiện có: nghiên cứu độ sâu sweep theo ATR/tick, breakout ngược hướng và mất reclaim. Chọn một biến thể xác nhận MSS M15, so chi phí entry trễ và số winner bị loại. Sau đó mới thử time-stop/exit khi reclaim mất hiệu lực. Không suy từ riêng lệnh1029 rằng cần nới SL hay TP thấp hơn.

Partial TP phải kiểm tra tính khả thi lượng BTC: vị thế 0,001 có thể không chia được theo minQty/stepSize. Không backtest chốt 50% nếu sàn không nhận. Mọi phương án exit phải qua cùng mô hình min lot, commission và funding.

## 4. Kế hoạch triển khai theo thứ tự — cập nhật: backtest trước

Người dùng yêu cầu ưu tiên backtest để kiểm chứng ngay. Không cần chờ 2–4 tuần trước khi đánh giá hiệu quả. Dùng dữ liệu lịch sử 1m/funding hiện có, khóa biến thể, chạy replay có chi phí và giới hạn tài khoản, rồi đánh giá các giai đoạn tách biệt. Shadow là bước xác minh execution gap của ứng viên vượt backtest, không là điều kiện để bắt đầu nghiên cứu. Lượt backtest đầu lưu tại `docs/audits/2026-09-20-ict-backtest/`.

| Giai đoạn | Việc cụ thể | Đầu ra và điều kiện hoàn tất |
|---|---|---|
| P0 — 1–2 ngày công | Đối soát decision1099 và các exit ghost; nối order/algo/fill; tách phí AI unknown; kiểm tra nạp/rút; funnel theo lane/policy/version; đo lỗi provider và latency | Ledger khớp tới độ chính xác tài sản; exit chưa xác minh được ghi unknown; mọi candidate có trace, lane, code/policy hash; không trộn proxy với live |
| P1 — 2–3 ngày | State machine cấu trúc và liquidity lifecycle; sửa phép đo target/retest cùng lane; bổ sung stale-bias, swept-target, sweep-depth, displacement, MFE/MAE | Prefix invariance; nến tương lai không đổi tín hiệu cũ; break/reclaim/transition có fixtures; target không xuyên cản còn hiệu lực |
| P2 — 2–3 ngày | Catch-up collector giữ freeze16–30/09; kiểm tra coverage/checksum; nối detector hiện có vào chronological account replay; baseline và candidate chung guard | Có pending→filled/expired/cancelled, min lot/risk, funding, cooldown, open exposure, drawdown/expectancy circuit và cạnh tranh vốn; parity sai khác có báo cáo |
| P3 — backtest ngay trên dữ liệu lịch sử | Replay B và các biến thể đã khóa; so cùng vốn/chi phí, phân tách giai đoạn; đánh giá thêm lịch sử khi thiếu mẫu. Shadow chỉ theo sau ứng viên vượt cổng | Báo delta net PnL, fill, drawdown, cohort bổ sung/thay thế; ghi rõ baseline nghiên cứu hay runtime; không gọi dữ liệu đã dùng là holdout mới |
| P4 — sau khi đạt cổng | Chuẩn bị bản phát hành có feature flag theo lane, version/rollback; triển khai có kiểm soát theo quy trình vận hành | Chỉ ứng viên đã đạt tiêu chí được bật; giữ risk policy; so admission/predicted cost với fill thực và theo dõi drift |

Ngày công là ước lượng kỹ thuật, không phải hẹn đủ mẫu hay hẹn ROI+. Không xem giai đoạn16–20/09 đã biết kết quả là holdout mới. Cửa sổ prospective16–30/09 chỉ còn giá trị theo manifest cũ nếu không đổi detector; các thay đổi mới cần epoch và dữ liệu tương lai mới.

Ưu tiên tái sử dụng: `backend/scripts/research_ict_fvg.py`, `replay_ict_1m.py`, `collect-ict-prospective.cjs`, `ict-account-timeline.ts`; `src/backtest/replay-account.ts`; `src/services/entry-gate-funnel.service.ts` nếu đúng module hiện hành, và các service measurement sẵn có. Kiểm tra tên/path và hash trước triển khai; không xem source đang sửa là bản live đã nạp.

## 5. Protocol kiểm chứng ROI+

- Freeze hypothesis, detector, entry/exit, dataset, account rules, fee/AI model trước chạy. Lưu mọi lần thử để kiểm soát selection bias.
- Chia chronological train/validation/untouched test; purge overlap ít nhất theo lookback và holding horizon liên quan. Walk-forward phải giữ tham số đã chọn trước mỗi đoạn test.
- Nến đóng, pivot chỉ dùng sau xác nhận. Entry sau khi tín hiệu đã biết + latency; chạm limit không mặc định fill. Nếu entry và exit cùng 1m không có tick sequencing: giữ unresolved hoặc dùng bound bất lợi đã chốt, không chọn thứ tự có lợi.
- Baseline/candidate cùng dữ liệu, vốn đầu kỳ, slippage, funding, độ trễ và guards. Báo cả realized và equity cuối kỳ, không bỏ vị thế mở.
- Base phí theo tier/fill; stress giữ cùng signal population và tăng execution cost đã định trước. Nếu stress cũng đổi admission, báo riêng tác động selection. Chi phí AI chưa rõ cần bound bảo thủ; unknown không phải 0.
- Báo số lệnh, số ngày/sóng độc lập, long/short, regime/session, median holding, fill/expire, MFE/MAE, net R và ROI. Bootstrap theo cụm ngày/sóng, không coi nhiều bar là mẫu độc lập.
- Cổng nghiên cứu đề xuất: ít nhất 50 lệnh đóng và 20 cụm ngày/sóng độc lập để bắt đầu xét; đây là mức sàn, không bảo đảm đủ lực thống kê. Nếu chưa đủ hoặc CI rộng, giữ shadow và kéo dài quan sát.
- Cổng promote: ROI net base và stress >0; delta net so baseline >0; cohort bổ sung net expectancy >0; cận dưới CI95% của expectancy và delta không âm; drawdown stress không xấu hơn baseline trên cùng cửa sổ; không vi phạm risk policy. Nếu một tiêu chí thiếu dữ liệu thì chưa đạt.
- Theo dõi sau release: tắt lane mới/rollback khi có sai lệch guard, thiếu protective order, dữ liệu cũ hoặc execution vượt envelope đã kiểm chứng. Guard tài khoản hiện hành vẫn quyết định cooldown; không tự đổi 1h hay đặt một trần rủi ro khác.

## 6. Kết quả mong đợi và quyết định hiện tại

Thứ tự ưu tiên cập nhật: **ledger/funnel đúng → backtest lịch sử ngay → sửa/kiểm chứng structure và execution → xác nhận trên giai đoạn tách biệt → shadow đo execution gap → mở rộng lane**. Chưa chọn ngưỡng RR mới hoặc thay runtime.

Đã chạy [backtest đầu tiên](../audits/2026-09-20-ict-backtest/report.md) theo yêu cầu tiếp theo:02–06/2025 edge FVG có2 lệnh, ROI base+1,2888%, stress+0,7467%; midpoint không ép RR3 có2 lệnh lỗ, ROI−5,1349%/−5,6483%. Giai đoạn07–09/2025 cả ba biến thể0 lệnh; hai bản structural bị cả min-lot risk và exposure100 USDT chặn trên ví32,2009. Mẫu chưa đủ để kết luận edge; kết quả này sàng lọc ngay bằng lịch sử, không cần đợi shadow mới phát hiện vấn đề.

**Kiểm chứng mở rộng đã hoàn tất:** [12 tháng2023/2024](../audits/2026-09-20-ict-extended/report.md) giữ nguyên cả3 cấu hình. Edge ROI base/stress2023−9,4787%/−10,6888%,2024−5,5400%/−8,6440%; midpoint structural cũng âm, comparator ICT RR3 không có fill. Không promote edge từ2 lệnh thắng2025. Ưu tiên trial mới kiểm tra target có bù chi phí stress, sau đó tách riêng giả thuyết protected-swing/MSS và continuation pullback; không nới risk để tăng số lệnh. Các cửa sổ này đã được xem, không gọi chúng là holdout mới khi retune.

**Đã IMPLEMENT theo yêu cầu tiếp theo:** [module và trial48 scenario](../audits/2026-09-20-ict-implementation/report.md) hoàn tất economic gate, H1 protected-swing permission, continuation FVG M15 và portfolio chung hai nhánh.24 tests và TypeScript qua;8 baseline parity checks khớp. Sweep cost+H1 giảm lỗ trong2023/2024 nhưng vẫn âm, loại hai winner2025; continuation/combined không đạt ROI+. Giữ toàn bộ dưới dạng nghiên cứu, không promote hoặc sửa risk live. Chạy lại bằng `npm run research:ict` trong backend; xem [hợp đồng kỹ thuật](../ict-research-implementation.md).

## Bằng chứng và nguồn

- [DB snapshot và positions](../audits/2026-09-20-ict-review/db-evidence.json), [funnel summary](../audits/2026-09-20-ict-review/funnel-summary.json), [events decision1099](../audits/2026-09-20-ict-review/latest-position-events.json), [runtime policy](../audits/2026-09-20-ict-review/runtime-policy.json).
- [RR study14d](../audits/2026-09-19-rr-variant-study-14d.json), [SL review1029](../audits/2026-09-16-sl-review/report.md), [collector freeze](../audits/2026-09-15-ict-opportunities/collection-report.md), [risk policy](../runtime-risk-policy.md).
- [ICT — 2022 Mentorship Episode6](https://www.youtube.com/watch?v=Bkt8B3kLATQ): nguồn gốc chủ đề FVG/MSS; trang duyệt xác nhận metadata, không xác minh toàn bộ video hay hiệu quả trên BTC. Các quy tắc định lượng ở đây là thiết kế của dự án.
- [CFTC — Trading systems](https://www.cftc.gov/LearnAndProtect/AdvisoriesAndArticles/fraudadv_tradingsystem.html): phân biệt kết quả mô phỏng và hiệu quả giao dịch thực; không dùng backtest như cam kết lợi nhuận.
