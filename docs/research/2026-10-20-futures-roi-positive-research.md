> **CCT tracking-cost512 đã kết thúc:** POSITIVE_BOTH_COSTS_BELOW_PRIMARY_TARGET; kiểm toán PASS_INDEPENDENT_POSTRUN_EVENT_AND_DAY_AUDIT. [Kết quả](2026-10-20-futures-cct-tracking-cost-512-day-results.md). Live tiếp tục giữ dừng.

# Nghiên cứu cải thiện Futures — cập nhật 21/10/2026

Chẩn đoán20/10 là cơ sở của phép thử mới đã hoàn tất21/10. [Bằng chứng về phân bổ và đường giám sát](2026-10-20-futures-projection-and-monitoring-diagnosis.md); các trạng thái chưa chạy trong báo cáo đó là mốc lịch sử trước khi đăng ký.

**Đã hoàn tất ứng viên ưu tiên tỷ trọng từng coin và chi phí:** net+8,123520u/+6,250015u ở phí thường/cao, bình quân+0,015866u/+0,012207u mỗi ngày lịch. Tốt hơn CCT gốc ở cả hai chi phí, đồng thời giảm phí, ngày lỗ nặng nhất và sụt vốn trong mô hình. Chưa đạt0,2u/ngày. Live tiếp tục giữ dừng. [Kết quả512 và bằng chứng](2026-10-20-futures-cct-tracking-cost-512-day-results.md).

## So sánh đầy đủ

Mỗi ca dùng một ví31,47744546u liên tục từ20/05/2025 đến13/10/2026 theo ngày Việt Nam; 512 ngày gồm mọi ngày âm, dương và giữ tiền. Trần12u/ngày, đóng sớm−5,9u/dự phòng6,1u; không nạp hoặc reset giữa kỳ. Đã tính phí, slippage, funding thật và đóng hết cuối kỳ.

| Cấu hình | Net phí thường(u) | Net phí cao(u) | Mean thường(u/ngày) | Mean phí cao(u/ngày) |
|---|---:|---:|---:|---:|
| Luôn giữ chiều mua | −23,366837 | −23,378984 | −0,045638 | −0,045662 |
| CCT gốc long/cash | +7.228341 | +5.622029 | +0.014118 | +0.010981 |
| SMA50/200 long/cash | -8.836448 | -8.957645 | -0.017259 | -0.017495 |
| CCT chia vốn theo tín hiệu hoạt động | +6.932489 | +6.860398 | +0.013540 | +0.013399 |
| CCT ưu tiên tỷ trọng từng coin và chi phí | +8.123520 | +6.250015 | +0.015866 | +0.012207 |

**Mục tiêu chính là net chia tất cả ngày lịch≥0,2u/ngày:102,4u net/512 ngày ở cả hai mức phí, cùng kiểm toán và rủi ro đạt.** Dương và tốt hơn bản cũ là các mốc riêng. Hai mức phí là hai giả định của cùng cấu hình, không phải hai mẫu thị trường độc lập. Không thêm yêu cầu mọi ngày hoặc mọi nửa kỳ đều lãi.

## Kết quả mới: ưu tiên tỷ trọng từng coin và chi phí

Giữ nguyên tín hiệu CCT gốc, vol90/sizing6/band20 và mọi phần tính tiền, admission, rủi ro. Chỉ bỏ độ lệch tổng mức tiếp xúc khỏi điểm chính khi lựa chọn khối lượng; còn dùng nó để phân xử hòa. Điểm chính là độ lệch từng coin + chi phí tức thời không âm. Đây là thay đổi mục tiêu phân bổ, không phải sửa lỗi kế toán. Không kết hợp công thức5/n_active của biến thể trước.

| Chỉ tiêu | Phí thường | Phí cao |
|---|---:|---:|
| Net tăng so CCT gốc(u) | +0,895180 | +0,627985 |
| ROI toàn512ngày trên vốn đầu | 25,807% | 19,856% |
| Phí(u) | 0,766424 | 1,079339 |
| Số fill | 290 | 289 |
| Số khóa rủi ro | 1 | 1 |
| Ngày xấu nhất mô hình(u) | −6,884004 | −6,900325 |
| Sụt vốn theo giá đóng phút(u) | 22,843231 | 23,312415 |
| Trần12 trong mô hình | Đạt | Đạt |

So CCT gốc, phí giảm0,523922u/0,732743u; trượt giá giảm0,209569u/0,523388u và funding bớt âm0,708719u/0,665894u. Phần lãi theo giá tham chiếu giảm0,547030u/1,294040u. Các phần cộng thành net tăng0,895180u/0,627985u. Đây là đối chiếu hai sổ tiền đã tiến triển riêng; chưa xác nhận quan hệ nhân quả của từng thay đổi khối lượng riêng lẻ hoặc lợi nhuận tương lai.

Mỗi ca có 175/170 ngày dương,194/198 ngày âm và143/144 ngày bằng0. Hai nửa256ngày của cùng ví lần lượt+6,716900u/+1,406620u ở phí thường, +5,759620u/+0,490395u ở phí cao; chỉ là mô tả, không thêm yêu cầu mọi nửa kỳ/ngày đều lãi. Đóng góp net theo coin ở phí thường: BTC0, ETH+2,679072u, BNB+7,186350u, SOL−0,150563u, XRP−1,591340u. Lãi vẫn tập trung ở BNB; không lấy kết quả này để loại coin thua hoặc chỉ chọn BNB.

Ứng viên cải thiện cảhai chi phí so CCT gốc và giảm sụt vốn. So biến thể5/n_active, net phí thường cao hơn nhưng net phí cao thấp hơn6,860398u của biến thể đó; không kết luận thắng tất cả cấu hình. Giữ tracking-cost làm đối chứng nghiên cứu cho bước tiếp vì có cải thiện so cấu hình nguồn gốc cùng chi phí; giữ active allocation như nhánh đánh đổi. Chưa đổi hệ thống live.

Phần giá tham chiếu trên chính các vị thế đã mô phỏng là+10,414300u/+9,291530u, chia512 tương ứng khoảng0,020340u/0,018148u/ngày. Cộng ngược chi phí kế toán trên cùng vị thế vẫn thấp hơn0,2u/ngày; đây không phải kết quả một chiến lược bỏ phí rồi chạy lại, vì đường ví/khối lượng khi đó có thể đổi. Vì vậy giảm phí hoặc tiếp tục sửa điểm phân bổ chưa có bằng chứng đủ đạt mục tiêu chính.

Registration`e04a9e1293035a48de61aa52923c48c647e54111ddd875d8352ed348a30c6d91` khóa lúc09:10:49ICT21/10, trước financialframe đầu. Có36unit tests,11nhóm kiểm toán synthetic, review độc lập, coldloader512targets/7.680funding và7file lõi tiền khớp nguyên byte. Chạy hai ca tuần tự09:11–09:37; kiểm toán hậu kỳ2/2PASS và xuất bằng chứng09:38. Tổng nhánhROI nay có8ca đã audit tiền; đây không phải8mẫu thị trường độc lập hoặc kiểm chứng tiến cứu.

## Biến thể chia theo số tín hiệu — kết quả trước

Giữ tín hiệu CCT chín kênh, vol90, sizing6 và band20. Thay duy nhất việc chia vốn: trọng số cũ×5/n_active, với n_active là số coin B5 có trọng số dương đã biết ở thời điểm đó; không có tín hiệu thì giữ tiền. Không chọn riêng BNB hoặc coin đã thắng. Trọng số thay đổi ở189 ngày;251 ngày nguồn có đủ 5 tín hiệu và72 ngày nguồn có target toàn tiền mặt không đổi. Đó là ngày nguồn UTC, không phải số ngày PnL bằng0 hoặc tài khoản flat suốt ngày ICT. Số tín hiệu không đồng nghĩa số coin có thể đặt được lệnh tối thiểu.

| Chi phí | Chênh lệch net so CCT gốc(u) | Phí(u) | Ngày xấu nhất(u) | Sụt vốn theo đóng phút(u) | Trần12 mô hình |
|---|---:|---:|---:|---:|---|
| base | -0.295851 | 1.628237 | -7.672050 | 41.215826 | Đạt |
| stress | +1.238368 | 2.692812 | -8.588605 | 47.782061 | Đạt |

CCT_ACTIVE_ALLOCATION_base:256 ngày đầu net+7.917390u, 256 ngày sau-0.984900u trong cùng một ví. Đóng góp theo coin: BTC-3.535412u, ETH+8.273756u, BNB+7.094788u, SOL+1.789715u, XRP-6.690357u. Đây là mô tả hậu nghiệm, không phải danh sách chọn coin thắng.
Phân rã chênh lệchbase: phần giá tham chiếu+0.323860u, chi phí phí+slippage−funding tăng+0.619711u; hai phần kết hợp thành net chênh-0.295851u. Đây là phân rã hai ledger thực tế đã mô phỏng; không phải phản thực bỏ phí giữ nguyên mọi quyết định.
Chỉ cộng ngược chi phí trên cùng chuỗi vị thếbase cho phần giá tham chiếu +0.022041u/ngày. Con số kế toán này vẫn cần so với0,2u/ngày; giảm phí đơn thuần chưa có bằng chứng đủ đạt mục tiêu. Không xem phép cộng ngược là kết quả một chiến lược miễn phí có thể thực thi.

CCT_ACTIVE_ALLOCATION_stress:256 ngày đầu net+10.008224u, 256 ngày sau-3.147827u trong cùng một ví. Đóng góp theo coin: BTC-5.366139u, ETH+9.933194u, BNB+6.736567u, SOL+1.290937u, XRP-5.734160u. Đây là mô tả hậu nghiệm, không phải danh sách chọn coin thắng.
Phân rã chênh lệchstress: phần giá tham chiếu+3.141460u, chi phí phí+slippage−funding tăng+1.903092u; hai phần kết hợp thành net chênh+1.238368u. Đây là phân rã hai ledger thực tế đã mô phỏng; không phải phản thực bỏ phí giữ nguyên mọi quyết định.
Chỉ cộng ngược chi phí trên cùng chuỗi vị thếstress cho phần giá tham chiếu +0.026811u/ngày. Con số kế toán này vẫn cần so với0,2u/ngày; giảm phí đơn thuần chưa có bằng chứng đủ đạt mục tiêu. Không xem phép cộng ngược là kết quả một chiến lược miễn phí có thể thực thi.

Bản mới tốt hơn ở ca phí cao nhưng kém hơn ở phí thường, và drawdown tăng ở cả hai ca. Chưa chọn thay CCT gốc hoặc bật live: mục tiêu chính còn thiếu. Giữ kết quả đánh đổi này để tham khảo; không quét hệ số trên cùng lịch sử để tìm lại một bản thắng.

## Khả năng đặt lệnh và chi phí vận hành

Đã bổ sung kiểm tra nguồn so với minimum lot/notional trên giá đóng đã biết và vốn tham chiếu cố định31,47744546u. Đây là kiểm tra vé làm tròn xuống không vượt giá trị yêu cầu, trước margin/risk/band/inventory; không phải admission thật hoặc thêm backtest PnL. Bộ phân bổ có thể chọn lượng tối thiểu cao hơn target. Trong backtest bản mới đã có lệnh BTC, dù phép kiểm vé DOWN tại vốn cố định vẫn cho0ngày đạt; điều đó xác nhận không được dùng screen này để suy nguyên nhân hoặc loại coin. [Kết quả khả thi nguồn](2026-10-20-futures-cct-source-lot-feasibility.md).

Ledger thật gần nhất: lãi giá đã chốt+1,27719995u, phí2,27916897u, funding−0,01172528u, net−1,01369430u. Phí tái vào sau phục hồi là1,05864869u; phí đóng rủi ro1,13990377u. 137/148intent đóng có telemetry cùng intent và trạng thái monitoring-gap phù hợp; lý do chính xác lưu cùng intent vẫn0/148. Không quy toàn bộ phí cho lỗi giám sát.

Đã thử mô hình phục hồi biệt lập: một probe, sự cố lặp thì giữ khóa tăng vị thế qua ngày/nguồn/restart. Trên tape29sự cố/27đề nghị:1nhận/26chặn;11nhóm fault test và57prefix đạt. Các đề nghị bị chặn gắn1,01842821u phí vào lệnh lịch sử; **chưa được gọi là phí tiết kiệm hoặc ROI tăng**. Model có thể giảm thời gian giao dịch và bỏ lỡ lợi nhuận. Bản sửa loader đạt20nhóm kiểm thử, review16.000roundtrip hợp lệ, nhưng còn hai giới hạn validation và chưa tích hợp durable transaction/permit/remediation. **Chưa chọn làm rule production.** [Nghiên cứu và giới hạn recovery](2026-10-20-futures-recovery-governor-research.md).

## Hướng tiếp theo

Nhánh vận hành21/10 đã chốt [kế hoạch đo từng pha và seam kiểm thử](../plan/2026-10-21-futures-monitoring-phase-instrumentation.md), tận dụng FakeBroker/temp-ledger qua public orchestration; chỉ là thiết kế, chưa implement/test mới hoặc thay live. Phép thử tài chính tracking-cost512 đã hoàn tất độc lập với nhánh thiết kế này.

1. Giữ tracking-cost làm đối chứng nghiên cứu tiếp; CCT gốc là đối chứng nguồn đã khóa và active allocation là nhánh có đánh đổi. Chưa chọn thay production hoặc tuyên bố một cấu hình thắng mọi chỉ tiêu. Không lặp nguyên trạng SMA hoặc news/shock đã thất bại.
2. Đã hoàn tất đúng một thử nghiệm tracking-cost512/hai chi phí và audit2/2PASS. Giữ kết quả cải thiện so CCT gốc; không chạy lại hoặc sweep mục tiêu phân bổ. Bước nghiên cứu tiếp là [kiểm khả thi CCT hai chiều theo cấu hình cụ thể](../plan/2026-10-21-futures-next-roi-hypothesis.md), trước khi tạo nguồn hoặc đăng ký PnL: loader/admission hiện long-only, signed cần đặc tả/test riêng, chưa sẵn sàng đổi mode rồi chạy. Catalogue giữ cả trial long/short64ngày/scalar8/100u/day10 âm và vượt trần cũ; không gọi cấu hình mới là đã được chứng minh. Chưa tạo tín hiệu hoặc trial tài chính tiếp.
3. Đã chẩn đoán phase: statuswrite nằm ngoài tickDuration hiện công bố; bốn watchdog ghi trễ nhưng chưa xác định nguyên nhân gốc. Tiếp theo implement đo phase/reason không thêm awaitIO, fault test stub rồi mới execution+giá+fault replay; chưa implement hoặc chứng minh tiết kiệm phí. Giữ15giây và12/−5,9/6,1.
4. Khi ứng viên đạt cổng lợi nhuận/rủi ro, kiểm tra lại đúng vốn thật/filters/lifecycle và tích hợp trước quyết định chạy lại. Chưa ứng viên nào được tự triển khai từ báo cáo này.

## Bằng chứng và giới hạn

Registration biến thể`5544307be26ab0ce7de663caba03b058b2bde9c10afde70a9dbbf97c57af2f12` được khóa trước financialframe đầu tiên. 512 targets/40.960 so sánh trọng số và48.640 so sánh chỉ báo nguồn độc lập đạt; 8 file lõi tiền giữ nguyên byte. Hai ca mới đủ737.280 phút,7.680 funding và512 ngày mỗi ca; kiểm toán tiền độc lập mới2/2 đạt, tại mốc biến thể đó tổng nhánhROI6/6ca; thêm tracking-cost2ca đã đạt21/10, nay tổng8/8ca. Tiền tính đúng, ngân sách mô hình đạt và có lợi nhuận là ba điều riêng.

Toàn512 ngày đã được xem là dữ liệu phát triển hồi cứu, không phải holdout mới. Money audit tái dựng fill/phí/funding/định giá ngày, không mô phỏng độc lập mọi quyết định alpha/risk trong phút. Nến phút, filters snapshot, maintenance và slippage cố định chưa tái hiện đầy đủ spread/gap/outage/partialfill/thanh lý thật; backtest alpha chưa chứa tape phục hồi thật. Trường drawdown tên cũ5m dùng đóng nến1phút. Không chứng nhận trần12u tuyệt đối ngoài sàn hoặc lợi nhuận tương lai; chưa trừ chi phí hạ tầng.

Nguồn công khai: [Man AHL](https://www.man.com/insights/in-crypto-we-trend) hỗ trợ nghiên cứu xu hướng, volatility scaling và chi phí; công thức5/n_active là thích nghi của ta, không phải bản sao đã được tác giả xác nhận hoặc tài khoản31u có track record. [Backtest overfitting](https://escholarship.org/uc/item/4w1110bb) giải thích vì sao phải lưu mọi thử nghiệm và không gọi dữ liệu đã xem thành holdout.

[Kết quả CCT mới](2026-10-20-futures-cct-active-allocation-512-day-results.md) · [CCT gốc](2026-10-20-futures-cct-control-512-day-results.md) · [SMA](2026-10-20-futures-sma50-200-512-day-results.md) · [Tin/sốc512](2026-10-20-futures-news-shock-512-day-results.md).

GET cuối2026-10-21T02:45:01.587Z (09:45ICT):0vịthế/0lệnh thường/0algo, equity30.46375116u. Live và savedbootstopped; supervisor xác nhận sổ tiền/code/config được bảo vệ giữ nguyên. Vốn thật khác31,47744546u tham chiếu. Không lệnh thật, reset, triển khai hoặc khởi động lại do nghiên cứu. Lần GET hậu kiểm đầu có lỗi mạng; một lần thử lại đã đạt, không thay trading guard.

Hậu kiểm độc lập tracking-cost đã đối chiếu toàn kỳ/các khoản tiền/từngcoin cuối kỳ flat và xác minh gói tài chính93file cùng manifest của từng ca. Không còn tiến trình backtest hoặc xuất báo cáo. [Bằng chứng tracking-cost](../audits/futures-quick-win/roi-positive-cct-tracking-cost-512d-20261020/README.md). [Nghiệm thu biến thể active allocation trước đó](../audits/futures-quick-win/roi-positive-active-research-verification-20261020/README.md).
