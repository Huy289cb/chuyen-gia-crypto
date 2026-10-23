# Kế hoạch kiểm chứng short đối ứng range-long và theo dõi giá sau đóng lệnh

Ngày 24/09/2026. Trạng thái: kế hoạch triển khai, chưa thay đổi runtime. Căn cứ: `docs/audits/2026-09-24-long-reversal/report.md`. Mục tiêu là expectancy ròng sau chi phí và drawdown tốt hơn, không tối đa tỷ lệ thắng. Ba range-long gần đây đảo short có lời chỉ là giả thuyết hình thành sau khi xem kết quả, không phải bằng chứng ngoài mẫu.

## 1. Khóa phạm vi và phép so sánh trước khi thu mẫu mới

Chỉ nghiên cứu candidate `range_sweep_reclaim` thuộc nhánh range-long; breakout được báo cáo riêng. Lưu mọi candidate ngay khi xác nhận bằng nến đã đóng, trước AI/risk/execution veto; sau đó gắn trạng thái từng tầng. Không chỉ lưu lệnh được khớp hoặc lệnh thua. Khử trùng theo candidate key và phiên bản chiến lược, giữ observation ID cho các lần đánh giá lại. Báo cáo cả toàn bộ candidate và tập đủ điều kiện giao dịch.

Ba lựa chọn chính:

- L0: range-long hiện tại, mô phỏng đúng exit policy đã đóng băng; thêm benchmark SL/TP cố định để tách ảnh hưởng quản lý lệnh.
- S0: short ngay khi có cùng candidate, giữ khoảng cách SL/TP: nếu long entry E, SL L, TP T thì short SL = E + (E − L), TP = E − (T − E). Hình học lấy từ mức giá có thể biết ở thời điểm quyết định; từng chiều dùng bid/ask hoặc quy tắc fill/slippage riêng. Không mặc định short khớp cùng giá long thực tế.
- N0: đứng ngoài, PnL giao dịch bằng 0; vẫn ghi chi phí quan sát/hạ tầng nếu có.

S1 (giai đoạn tiếp theo, chưa đồng thời tối ưu S0): short sau khi reclaim thất bại được xác nhận. Ví dụ quy tắc ban đầu để khóa trước test: trong 12 nến 5m sau candidate, nến đóng trở lại dưới reclaimed boundary, tiếp theo trong 3 nến có retest chạm boundary và đóng dưới; vào ở open nến kế tiếp. SL trên đỉnh retest với buffer tick đã quy định, vẫn phải đạt SL floor; TP RR1.5, thời hạn giữ 72h. Hết thời gian, thiếu dữ liệu hoặc vi phạm admission => không vào. Quy tắc này là giả thuyết mới, phải version và kiểm chứng riêng, không chọn threshold theo dữ liệu đánh giá. Short sau thất bại không có nghĩa tự động short ngay khi long hit SL; nếu có giao dịch live trước đó vẫn phải tuân thủ cooldown.

Không chọn phương án đổi TP cũ thành SL làm ứng viên triển khai ở giai đoạn đầu: audit cho thấy vượt 3% với minimum lot. Giữ BTC, trần mỗi lệnh3% gồm phí/slippage, ngày10%, cooldown1h, target sizing0.5%, cap USD rỗng, giới hạn exposure và các guard hiện hữu. Phương án không đủ risk budget phải ghi rejected, không giảm lượng xuống dưới minimum lot.

## 2. Lưu bằng chứng trước khi biết kết quả

Bổ sung dữ liệu versioned, append-only ở các bảng nghiên cứu riêng:

- `research_candidates`: candidate_id, observation_id, symbol, side, setup, decision/observation time, available_at, các nến nguồn và hash, range low/high, reclaimed boundary, vị trí entry trong range, ATR/volume, cấu trúc H1/H4, mức entry/SL/TP dự kiến, AI decision/confidence, lý do veto, policy/code version. Chỉ dùng nến đã đóng và dữ liệu đã có tại available_at.
- `research_paths`: candidate_id, variant/version, trigger/fill time, quantity, initial và amended SL/TP, exit policy, fill status, rejection reason, fee/slippage/funding, balance và risk admission. Liên kết position_id/decision_id khi có lệnh thật.
- `post_exit_observations`: path/position id, exit execution time, window end, completeness, MFE/MAE, first passage times, recovery/continuation flags và nguồn dữ liệu/hash.

Lưu candle series theo symbol/time để chia sẻ giữa nhiều lệnh, tránh nhân bản dữ liệu và gọi API mỗi lệnh. Dữ liệu raw và derived tách riêng; backfill chỉ ghi dữ liệu nghiên cứu, không phát lại hành động giao dịch.

## 3. Theo dõi từ entry đến 72h sau exit

Tự tạo observation job khi phát hiện exit thực tế, kể cả SL, TP, trailing, invalidation, time exit hoặc reconciliation. Neo vào timestamp khớp đóng lệnh đã xác minh, không timestamp bot phát hiện ghost position. Khi reconciliation sửa exit/PnL, version lại kết quả và tính lại cửa sổ; không ghi đè mất bằng chứng cũ.

Thu 1m OHLC và funding; thu mark-price bars nếu stop dùng mark. Không trộn trade-price với mark-price trong nhãn chạm stop. Lệnh mới lưu thêm fill/trade timestamp nếu cần giải thứ tự trong phút; dữ liệu lịch sử không đủ thì đánh dấu ambiguous. Không tự gán thứ tự TP/SL khi cùng chạm trong một bar; dùng kịch bản bảo thủ và báo độ nhạy.

Các mốc sau exit: **15m, 1h, 4h, 12h, 24h, 72h**. Scheduler cập nhật theo nến đóng, idempotent, có cursor/retry/backoff, kiểm tra khoảng trống, tiếp tục được sau restart. Mẫu chưa đủ horizon là pending/censored; thiếu dữ liệu là incomplete, không tính như thất bại hoặc thành công.

Trong lệnh ghi MFE/MAE theo USDT, %, và R gốc; thời điểm đạt 0.5R/1R/1.5R/2R; thời gian giữ và diễn biến quanh exit. R gốc lấy actual entry tới initial stop, không thay denominator sau trailing.

Sau SL:

- Giá có quay lại entry và vùng hòa vốn sau chi phí không; sau bao lâu?
- Có tới TP cũ trong horizon không? Trước đó đi ngược thêm bao nhiêu?
- Có tiếp tục đi theo hướng short giả định không, và short có bị SL trước khi tới TP không?
- Với SL rộng hơn, khối lượng hợp lệ có giảm được không, và PnL sau chi phí/risk thay đổi thế nào?

Sau TP:

- Giá đi tiếp được bao nhiêu theo hướng cũ và mất bao lâu?
- Nếu giữ thêm, phải chịu pullback bao nhiêu, chạm SL/trailing trước target cao hơn không?
- Chốt toàn bộ, chốt một phần và trailing khác nhau thế nào khi tuân thủ minimum quantity/step size? Không mô phỏng partial close không thể thực thi ở 0.001 BTC.

Giá quay lại TP sau SL không tự chứng minh SL quá gần. Giá tăng tiếp sau TP không tự chứng minh TP quá ngắn. Mọi sửa đổi phải replay cả đường giá, sizing, chi phí và lệnh không hồi phục.

## 4. Bài học có bằng chứng, tách quan sát và giả thuyết

Thay template theo USD PnL trong `memory.service.ts` bằng summary có nguồn: setup/side/version, actual reason, reconciled net, MFE/MAE trước exit, kết quả từng horizon sau exit, chất lượng dữ liệu. Kiểm tra lookup outcome_id so với decision_id và làm mới summary sau reconciliation; không suy đoán lý do hit SL từ số tiền lỗ.

Ví dụ nhãn mô tả: `stopped_then_recovered_within_4h`, `stopped_then_continued_down`, `tp_then_extended`, `ambiguous_or_incomplete`. Nhãn có nhiều horizon, không coi là nguyên nhân chắc chắn. Bài học đưa vào prompt phải nêu cỡ mẫu và expectancy theo cohort thay vì yêu cầu lặp lại/đảo hướng từ một lệnh.

**Chống nhìn trước:** một bài học 24h chỉ được dùng sau khi đã đủ 24h dữ liệu, cộng độ trễ thực tế. Backtest memory phải lọc available_at; không gắn bài học biết ngày mai vào quyết định hôm nay. Không tự cập nhật trọng số/policy hoặc mở lệnh từ observation job.

## 5. Backtest và điều kiện ra quyết định

1. Dùng 17 lệnh đã xem để kiểm tra pipeline/công thức; không gọi là ngoài mẫu. Backfill dữ liệu có sẵn để chẩn đoán, ghi rõ giới hạn bằng chứng trước entry.
2. Khóa protocol, code hash, candidate definition, fill/exit rules, chi phí và horizon trước giai đoạn shadow mới. Giai đoạn đầu chỉ so L0/S0/N0. Hạn chế số biến thể, không quét hàng trăm threshold rồi lấy kết quả đẹp nhất.
3. Chạy hai báo cáo: paired candidate comparison để tách chất lượng tín hiệu; chronological portfolio replay riêng cho mỗi policy với equity, vị thế đồng thời, cooldown, exposure, daily budget và minimum lot. Không cộng các cơ hội chồng lấn rồi gọi là ROI.
4. Chạy base/stress với fee thực hoặc giả định bảo thủ, adverse gap, funding, slippage; phân bổ AI/infrastructure nhất quán và báo cả trước/sau overhead. So sánh cùng ngân sách rủi ro và thêm sensitivity cùng 0.001 BTC.
5. Review vận hành hằng tuần nhưng không thay protocol theo từng chuỗi thắng/thua. Cổng đánh giá nghiên cứu đầu tiên: ít nhất **8 tuần và 50 candidate độc lập đã đủ horizon**; nếu chưa đủ thì tiếp tục quan sát. Đây là ngưỡng sàng lọc, không bảo đảm đủ power hay ROI+; candidate cùng một range/đợt biến động phải cluster, không tính quét lặp thành mẫu độc lập.
6. Chỉ đề xuất triển khai khi expectancy ròng stress >0, cải thiện so L0 và đứng ngoài, không phụ thuộc vài outlier; báo confidence interval của mean net và paired delta bằng block bootstrap theo ngày/episode. Khoảng tin cậy còn chứa 0 => chưa kết luận. Kiểm tra drawdown, tail loss, lệnh đủ điều kiện và mức tập trung lợi nhuận, báo cả kết quả âm. Những rule sửa sau review phải có block đánh giá mới.
7. Lập release/rollback riêng cho ứng viên đã qua kiểm chứng. Collector và báo cáo có thể triển khai trước; chưa chuyển hướng đặt lệnh thật chỉ dựa vào 3 trade range đã thắng trong mô phỏng.

## 6. Thứ tự thực hiện và nghiệm thu

| Ưu tiên | Công việc | Đầu ra / điều kiện xong |
|---|---|---|
| P0 | Schema, snapshot candidate, exit event + reconciliation binding | Migration; dedupe; không ảnh hưởng trading; đúng initial levels và timestamps |
| P1 | Collector sau exit, backfill 17 lệnh, restart/retry | Timeline tới +72h hoặc trạng thái pending/incomplete; coverage/hash rõ ràng |
| P2 | Replay L0/S0/N0, costing và admission | Báo cáo paired + portfolio; giữ nguyên risk policy; chạy lại tái lập kết quả |
| P3 | Reflection có bằng chứng và dashboard | Mỗi lệnh có timeline trước/sau exit; cohort expectancy, mẫu độc lập, available_at đúng |
| P4 | Shadow dữ liệu mới, review định kỳ | Protocol khóa; quyết định tiếp tục/loại/promote dựa trên cổng kiểm chứng |

Điểm tích hợp cần kiểm tra khi implement: candidate pipeline/`utils/entry-trace.ts`, `utils/adaptive-retest-dispatch.ts`, `services/position-close.service.ts`, các đường reconciliation và `schedulers/position-monitor.scheduler.ts`, `services/memory.service.ts`, repository/migration và scheduler riêng. Không chỉ hook một hàm close vì các lệnh ghost có thể được phát hiện ở đường khác.

Tests bắt buộc: outcome/decision identity; close timestamp bị sửa; initial SL khác trailing SL; long/short sign; fee/funding; gap/dual-hit; incomplete windows; duplicate exit/restart; future lesson leakage; minlot/3%/10%/cooldown admission. Integration tests dùng DB/API giả lập hoặc DB nghiên cứu riêng, không ghi trace giả vào production. Observation failure không được chặn SL/TP/execution scheduler.

## Cập nhật thực hiện theo chỉ đạo mới

Người dùng yêu cầu implement ngay và cho phép đưa lên live nếu backtest đạt, không bắt buộc chờ 8 tuần shadow. Vì vậy thời hạn shadow ở mục 5 không còn là điều kiện chặn triển khai. Vẫn cần kết quả sau chi phí/risk hợp lệ. Lần thực hiện đầu: `docs/audits/2026-09-24-range-implementation/`; short mirror không vượt qua historical screen, bộ đo và evidence memory được triển khai độc lập sau kiểm thử.
