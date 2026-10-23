# Kế hoạch tăng cơ hội BTC với điều kiện ROI dương

> Cập nhật 14/09: các vòng nghiên cứu/paper sau kế hoạch này đã kết thúc, chưa có biến thể đạt triển khai. Source measurement và cổng kiểm chứng mới được mô tả tại ../entry-measurement-and-research-gates.md; framework bổ sung tại 2026-09-14-smc-volume-fibonacci-feasibility.md. Đây không phải xác nhận candidate đã chạy live.

Ngày lập: 11/09/2026. Trạng thái: **đã hoàn thành chẩn đoán ban đầu và kế hoạch; chưa có biến thể mới đủ điều kiện triển khai**.

## Quyết định từ bằng chứng

Không bỏ hàng loạt bộ lọc để tăng lệnh. Nghiên cứu cơ chế **ghi nhận setup → đợi xác nhận/retest → vào khi đạt điều kiện**, cùng tính nhất quán của cấu trúc và hướng. Giữ BTC, cooldown1h, giới hạn ngày10%, tổng rủi ro mỗi lệnh3% số dư, capUSD rỗng, target sizing0,5%. Các giới hạn này theo [chính sách vận hành](../runtime-risk-policy.md).

Mục tiêu đánh giá: tăng **số giao dịch độc lập có thể thực thi**, đồng thời ROI sau toàn bộ chi phí >0 và phần giao dịch bổ sung tạo lợi nhuận dương. Không dùng số lần quét, số gọi AI hoặc số thắng đơn lẻ làm tiêu chí thay thế.

## Các lệnh không vào có chạm SL trước TP không?

Đã đóng băng cửa sổ04/09–11/09, tới16:17 ICT; tải10080 nến1m Binance Futures đúng endpoint runtime và funding lịch sử. Quy tắc mô phỏng được ghi trước khi tải kết quả trong [protocol.json](../audits/2026-09-11-opportunity-plan/protocol.json).

| Nhóm kiểm tra | Tổng | SL trước | TP trước | Chưa đủ kết luận |
|---|---:|---:|---:|---|
| Kế hoạch bị từ chối, có entry/SL/TP đã lưu | 10 | 7 | 1 | 2 không chạm entry trong45phút |
| Tín hiệu qua signal gate nhưng bị gate khác chặn; mức giá giả định | 175 | 135 | 6 | 11 hết48h chưa chạm;23 thiếu thời gian theo dõi |
| Nhóm giả định, chỉ giữ quan sát đầu mỗi giờ/mỗi hướng | 57 | 41 | 2 | 4 hết48h;10 thiếu thời gian |

Nhóm có mức giá thật: giả định limit chạm entry trong45phút, giữ tối đa48h, chỉ đánh giá từ phút sau phút chạm. Chạm giá không chứng minh có thể khớp; chưa mô phỏng hàng đợi/marketable limit/better-price fill. Không tồn tại lệnh thật trên sàn cho những quyết định này.

Kiểm tra độ nhạy bổ sung sau kết quả ban đầu: nếu limit đã có thể khớp tại open nến1m kế tiếp thì cho khớp ở giá đó, có cải thiện giá; giữ nguyênSL/TP. Kết quả thành **9SL trước,1TP trước**: hai quyết định898/899 trước đó không chạm đúng giálimit nay khớp ở giá tốt hơn và đều đi tớiSL trước. Đây là mô hình khớp khác, không phải10 lệnh thật; chưa xét hàng đợi hoặc độ trễ dưới1phút. Bằng chứng: [marketable-limit-sensitivity.json](../audits/2026-09-11-opportunity-plan/marketable-limit-sensitivity.json). Kết luận tránh nới hàng loạt không đổi giữa hai giả định; không dùng kết quả mô hình này để ghi đè thống kê mô hình đã đăng ký trước.

Nhóm chưa có mức giá: giả định vào tại open nến1m đầu tiên sau thời điểm quan sát, SL0,8%, TP cách entry2,4% tương ứng RR3. Đây **không phải kế hoạch AI bị bỏ lỡ**. Không suy ra135 tín hiệu chắc chắn sẽ thua dưới mọi cách đặt entry/SL/TP. Tín hiệu còn chồng lấn; gom theo giờ vẫn chưa tạo mẫu độc lập.

Cùng nến chạm cả SL/TP được đánh dấu không rõ thứ tự; không tự chọn TP. Trong mẫu này không xuất hiện trường hợp đó. Nhóm đủ48h riêng gồm133 tín hiệu giả định:121SL,1TP,11timeout; điều này tránh diễn giải kết quả còn thiếu tương lai như đã hoàn tất.

Ví dụ cụ thể:

- Quyết định893, short entry78204,7 / SL78450 / TP77900. Giả định chạm entry lúc19:13 ngày08/09 ICT, chạm SL lúc19:55. TP có xuất hiện về sau nhưng **sau SL**; nhìn riêng giá cuối kỳ sẽ kết luận sai.
- Quyết định915, short entry78195,1 / SL78550 / TP77800. Giả định chạm entry lúc02:57 ngày10/09 ICT, chạm TP trước lúc05:08. Bot đã bỏ lỡ một đường giá thuận lợi, nhưng SL chỉ khoảng0,45% và RR thực khoảng1,11, không đạt chính sách core. Một thắng lợi nhìn lại không đủ lý do bỏ ngưỡng.

Ở giả định0,001BTC, phí0,05% mỗi chiều, trượt giá tổng0,1% và funding thực,8 kế hoạch có kết quả rõ cộng lại−3,6560USDT. **Đây không phải PnL tài khoản**: các kế hoạch chồng nhau, chưa xét giới hạn ví, cooldown, ngân sách ngày, circuit và fill thật. Chi phí stress tổng trượt giá0,2% còn kém hơn. Không có bằng chứng nên mở lại toàn bộ các lệnh bị từ chối.

## Vì sao kế hoạch không chỉ nới BOS hoặc pullback?

Audit24h cho thấy27 tín hiệu qua signal gate đều bị structure chặn;27 cũng trượt pullback proxy,25 trượt side-align,19 trượt guard5m. Cấu trúc4h dùng pivot xác nhận chậm; giá pháHL không làm bias mất hiệu lực ngay. Regime có thể trend nhưng direction=null; side-align cho phép fallback theo structure trong khi guard5m vẫn cần hướng rõ. Breakout cùng volume thường xaSMA, còn pullback yêu cầu gầnSMA. Nhánh trend-retest hiện chỉ nhận khi pullback là điểm chặn duy nhất.

Telemetry `would_pass_pre_llm` hiện gom cả gate chạy sauLLM. Pullback proxy dùng close nến đóng, dispatch dùng entryAI và dữ liệu SMA chưa được loại nến mở ở đoạn kiểm tra đó. Vì thế cần sửa độ chính xác của phép đo trước khi dùng funnel để chọn tham số.

## Lộ trình và đầu ra nghiệm thu

### Bước1 — Tạo baseline đáng tin cậy

1. Ghi tách ba tầng: trướcAI; kế hoạch sauAI; admission/fill. Lưu observationKey, phiên bản code/policy, thời điểm quyết định, source/cutoff nến, lý do mọi gate, entry/SL/TP gốc và kế hoạch sau sửa nếu có.
2. Dùng chung hàm tính SMA với nến đã đóng giữa funnel và executor; proxy_entry phải là trường riêng, không tính vào số lần từ chối entry thật.
3. Ghi rõ `no_setup`, `blocked_before_ai`, `ai_veto`, `invalid_levels`, `risk_rejected`, `pending_expired`, `filled`. Thiếu hướng hoặc lỗi dữ liệu không được gộp thành không có setup.
4. Đóng băng baseline gồm code đang chạy, env được lọc bí mật, phí, filtersBTC, funding, thời gian sàn. Replay phải tái hiện các quyết định mẫu và8 kết quả barrier có thứ tự rõ.

Đầu ra: tập dữ liệu tái lập được và kiểm thử parity nến/decision time; không tuyên bố số lệnh tăng chỉ vì đổi nhãn telemetry.

### Bước2 — Chỉ thử ba giả thuyết, mỗi lần thay một yếu tố

| Biến thể | Cơ hội cần phục hồi | Quy tắc thử nghiệm | Không được làm |
|---|---|---|---|
| A: mất hiệu lực cấu trúc cũ | Giá đã pháHL/LH nhưng bias pivot chưa đổi | Nến4h đóng pháHL gần nhất làm bull mất hiệu lực, chuyển sang trạng thái chờ; hướng ngược chỉ được xét sauBOS15m và retest xác nhận trên nến sau. Quy tắc đối xứng cho bear | Không coi pháHL là lệnhshort ngay; không dùng pivot chưa xác nhận |
| B: thống nhất hướng giữa các guard | Setup đủ bằng chứng cấu trúc nhưng trend/null chặn chéo | Tách market regime, SMA direction và hướng cấu trúc; chỉ cấp quyền cho nhánh cóBOS15m+retest rõ và điều kiện4h hợp lệ. Kiểm tra cùng một hợp đồng dữ liệu ở side-align và guard5m | Không biến null thành bullish/bearish hoặc cho mọi trend/null qua |
| C: breakout rồi đợi retest | Impulse tốt nhưng giá đang xaSMA | Lưu ứng viên có identity theo sóng, không tiêu thụ cơ hội chỉ vì giá hiện tại xaSMA; dùng TTL đã chốt trước replay, đợi retest nến sau rồi đánh giá lại structure/HTF/AI/risk lúc entry | Không nới biên pullback đồng loạt, kéoTP để đủRR hoặc hồi sinh setup đã invalid |

A/B/C dùng SL tại mức mất hiệu lực cấu trúc, RR tối thiểu của nhánh và TP nằm trong mục tiêu cấu trúc gốc. NếuSL floor0,8%,RR3,lotBTC tối thiểu và cap3% không cùng đáp ứng thì từ chối. Không giảmRR sau khi nhìn kết quả; nhánh rangeRR1,5 được đánh giá riêng.

Giữ range live long5m như hiện tại trong vòng nghiên cứu này. Bật range short hoặc early-flip/micro-BOS live là giả thuyết mới, không gộp vào ba biến thể để tránh không biết cải thiện đến từ đâu. Trong từng biến thể, các thay đổi chỉ chạy replay/shadow trước khi đạt cổng nghiệm thu.

Đầu ra: baseline và từng biến thể có kết quả riêng; ablation theo nhóm gate; bảng lý do lệnh thêm/bớt và PnL của phần thêm. Chỉ kết hợp biến thể sau khi từng phần có bằng chứng, rồi kiểm tra lại toàn danh mục.

### Bước3 — Replay thực thi và ví theo thời gian

- Dùng nến1m để kiểm tra thứ tự entry/SL/TP; cùng nến không rõ thứ tự phải tách hoặc đánh giá biên xấu, không tùy chọn thắng.
- Có trạng thái candidate→pending→filled→closed/expired; giá chỉ được biết sau thời điểm xuất hiện. Chống trùng5m/15m/1h và một ví/một vị thế; tái sinh ứng viên theo đúng trạng thái sau khi đóng/hủy.
- Entry limit cần mô hình fill bảo thủ và latency; phí entry/exit, funding tại timestamp thực, slippage, tick/step/minNotional, spread và chi phí lệnh thoát. Phân biệt contract-price/mark-price khi mô phỏng trigger sàn.
- Bắt buộc1h/10%/3%, ví33,59964603USDT làm baseline nghiên cứu và cập nhật mốc trước vòng mới; target0,5%, không capUSD. Ngân sách ngày theoICT, phí mở lệnh và funding tính đúng ngày; circuit drawdown/expectancy, cooldown sau lỗ và pending reentry phải cùng logic runtime.
- So sánh cả equity mark-to-market và PnL đã chốt, drawdown intrabar bảo thủ. Lệnh chưa đóng cuối kỳ phải định giá và báo riêng, không âm thầm loại để làmROI đẹp.
- Không gọi AI hiện tại để giả vờ tạo quyết định lịch sử. Mẫu cũ không lưu output chỉ đánh giá deterministic counterfactual; chất lượng veto/entryAI phải thu prospective shadow hoặc dùng output đã ghi đúng thời điểm.

Đầu ra: trade ledger theo thời gian, wallet ledger, rejected admission log, chi phí cơ sở và stress, kết quả riêng core/range và danh mục gộp.

### Bước4 — Cổng chọn biến thể ROI+

Các ngưỡng sau là **tiêu chí đề xuất chốt trước vòng đánh giá tiếp theo**, không phải đặc tính đã đạt:

1. ROI = (equity cuối−equity đầu−nạp+rút)/equity đầu, sau mọi chi phí và vị thế cuối kỳ. ROI danh mục biến thể >0 ở chi phí cơ sở **và stress**.
2. Lợi nhuận tăng thêm so với baseline >0; riêng cohort lệnh bổ sung có net expectancy>0. Không dùng lãi baseline che phần lệnh thêm đang lỗ.
3. Profit factor sau chi phí cơ sở≥1,2 và stress>1; drawdown không vượt baseline và ngưỡng circuit chiến lược15%. Cần ghi rõ mốc epoch, không xóa drawdown để làm pass.
4. Số lệnh khớp độc lập tăng≥20% so với baseline trên cùng cửa sổ; nếu baseline quá ít/0 thì yêu cầu ít nhất10 lệnh bổ sung và đánh giá độ bất định riêng. Đây là ngưỡng nghiên cứu đề xuất, không ép bot giao dịch đủ chỉ tiêu.
5. Không chỉ nhìn trung bình: kiểm tra theo giai đoạn tăng/giảm/range, tuần, chi phí, một cụm lệnh tốt nhất và khả năng khớp. Dùng bootstrap theo block thời gian/sóng; cận dưới95% của net expectancy và delta lợi nhuận phải>0 trên mẫu đánh giá độc lập, có kiểm soát việc thử nhiều biến thể. Nếu không đủ block độc lập thì kết luận chưa đủ dữ liệu.
6. Dữ liệu2025–2026 đã được nghiên cứu chỉ dùng khám phá/regression, không gọi là holdout. Khóa mã/tham số ứng viên trước một cửa sổ chưa xem; ghi manifest chống đổi sau kết quả. Thu prospective shadow đủ tối thiểu8tuần và100 giao dịch độc lập đã kết thúc; đó là sàn dữ liệu đề xuất, không bảo đảm ý nghĩa thống kê. Nếu chưa đạt số mẫu hoặc khoảng tin cậy thì tiếp tục thu, không hạ chuẩn.

Kết quả mô phỏng range hiện có với chính sách1h/10%/3%:23lệnh, cơ sở+0,6914USDT nhưng stress−0,9037USDT. Bản này **không đạt cổngROI+stress**; nghiên cứu kỳ trước cũng chưa hoàn tất trong báo cáo09/09. Không dùng số cơ sở dương để duyệt tăng lệnh.

### Bước5 — Quyết định triển khai

Chỉ đưa đề xuất triển khai khi có phiên bản cụ thể, diff, kiểm thử, replay ledger, holdout/shadow report và kiểm tra1h/10%/3%. Bản được chọn phải đạt toàn bộ cổng ở bước4, không chỉ unit test. Nếu không có biến thể đạt, kết luận đúng là **chưa có bằng chứng tăng cơ hội màROI+**, giữ chiến lược hiện tại và ghi rõ giả thuyết thất bại.

Sau triển khai theo phạm vi được người dùng cho phép: đối soát fill/PnL sàn, báo cáo riêng phiên bản, theo dõi deviation so với shadow và hành vi circuit. ROI dương trong kiểm chứng không bảo đảm ROI tương lai.

## Phạm vi đã làm và phần còn lại

Đã làm: audit gate; đóng băng protocol; đọcDB; tải nến/funding; replay barrier; kiểm tra độc lập8/8 kế hoạch có kết quả;9 kiểm thử offline; lập kế hoạch và cổngROI+. **Chưa sửa runtime, bật nhánh mới, đặt/hủy lệnh hoặc chứng minh một biến thể mớiROI+.** Bước1–5 là công việc tiếp theo của kế hoạch, không phải kết quả đã hoàn thành.

Mã nghiên cứu: [audit-blocked-barriers.py](../../backend/scripts/audit-blocked-barriers.py), [kiểm thử](../../backend/scripts/test-audit-blocked-barriers.py). Bằng chứng: [summary](../audits/2026-09-11-opportunity-plan/barrier-summary.json), [kết quả từng quan sát](../audits/2026-09-11-opportunity-plan/barrier-outcomes.json), [kết quả range trước](../audits/2026-09-09-current-policy-replay/summary.json).

Tái lập từ dữ liệu đã lưu:

```bash
python3 backend/scripts/test-audit-blocked-barriers.py
nice -n 15 python3 backend/scripts/audit-blocked-barriers.py docs/audits/2026-09-11-opportunity-plan
```
