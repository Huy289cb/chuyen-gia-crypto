> **Đã thay phạm vi ngày12/10/2026:** [Policy mới](../runtime-risk-policy.md) và [lộ trình toàn hệ thống](2026-10-12-futures-system-research-roadmap.md) ưu tiên. Người dùng bỏ ICT/SMC và mọi khóa trading rule cũ; chỉ giữ100u vốn ban đầu,10u lỗ tối đa/ngày, không cap số lệnh, chấp nhận ngày âm và kỳ vọng mean1u/ngày lịch. “Không đổi cấu hình/giữ BTC/cooldown/cap/floor/must tăng fills” dưới đây là lịch sử, không chặn thiết kế mới. Phương pháp kế toán/provenance/phân biệt development–confirmation vẫn hữu ích, không tự resume goal hoặc run cũ.

> **Chỉ thị mới nhất 04/10/2026 — đánh giá lại mỗi 1 giờ goal:** bắt buộc đọc [quy tắc điều phối](roi-goal-coordination.md) và [mốc đánh giá](roi-goal-hourly-review.md). Ưu tiên hơn mọi next-action lịch sử: sửa tương thích gate H1/H2 → chứng minh workflow thật → hiệu năng journal → đo danh mục ROI/fills. Không vòng chờ/polling, không chạy lại nguyên trạng, không tính test/pending là đạt ROI. Goal hiện paused; cập nhật này không resume.

> **Chỉ thị resume hiện hành — cập nhật theo yêu cầu người dùng 04/10/2026:** đọc [bàn giao goal](2026-10-04-goal-resume.md). Mục này ưu tiên hơn mọi next-action lịch sử bên dưới. Tiếp theo: tích hợp H1/H2 vào workflow chung → đăng ký phép đo danh mục lịch sử liên tục → chốt F/P và kết quả kinh tế. Không chờ live, không lặp admission/baseline đã đóng. ROI+ và tăng fills vẫn chưa được chứng minh.

# Làm lại kế hoạch cải thiện ROI và cơ hội vào lệnh

**Cập nhật phạm vi ngày 02/10/2026:** người dùng cho phép nghiên cứu SL rộng hơn, trần rủi ro mỗi lệnh trên 3% và bỏ circuit drawdown 15%; xem [policy mới](../runtime-risk-policy.md) và [kế hoạch nâng cấp](2026-10-02-roi-upgrade-plan.md). Các khóa nghiên cứu 3%/drawdown15 trong tài liệu ngày 27/09 là baseline, không phủ định quyền mới. Giữ F/P/E, registry dữ liệu, hạch toán chi phí và các giới hạn khác; chưa đổi live.

Ngày chốt kế hoạch: 27/09/2026. **Người dùng yêu cầu mọi lượt agent tiếp theo tuân thủ quy trình này.** Đây là quy trình hiện hành, chưa phải bằng chứng có lợi thế giao dịch hoặc thay đổi live. Điểm vào bắt buộc là [AGENTS.md](../../AGENTS.md); đọc [trạng thái bàn giao](roi-opportunity-progress.md) để tiếp tục đúng việc, không mở lại vòng tìm kiếm đã thất bại.

**Mục tiêu không đổi: ROI+ sau mọi chi phí VÀ tăng cơ hội vào lệnh có chất lượng/số lệnh khớp độc lập. Khóa cấu hình hiện tại: cooldown 1h, trần rủi ro mỗi lệnh 3% tài khoản, ngân sách ngày 10%, SL distance floor 0,8%, target sizing 0,5%, BTC và không cap USD cố định.** “3% tài khoản” là trần rủi ro, không phải khoảng cách SL theo giá hoặc mức lỗ tối thiểu. Nguồn chính sách: [runtime-risk-policy.md](../runtime-risk-policy.md). Không tự nới các khóa này ở live hoặc candidate để có kết quả tốt hơn.

## 1. Kết luận đánh giá lại

Trong toàn tài liệu, “không cap USD cố định” là không trần **rủi ro mỗi lệnh** bằng USD cố định; cap exposure hiện hành vẫn được giữ theo chính sách runtime.

Vòng lặp vừa qua chưa chứng minh được một chiến lược có expectancy dương. Có hai vấn đề riêng: chất lượng tín hiệu có thể yếu, và quy trình kiểm chứng chưa trả lời đúng hiệu quả của toàn hệ thống hiện tại. Không được suy luận mọi chiến lược đều âm, cũng không được xem một đoạn backtest dương là bằng chứng triển khai.

Các bằng chứng cụ thể:

- Snapshot testbed 24/09 khác runtime đã chụp ở 6 module JS và model Scout→Qwen; có thêm Gemini shadow. Xem `../audits/2026-09-26-live-diagnosis/parity-gate.json`. Hash khác là chênh lệch phiên bản, chưa tự chứng minh tất cả hành vi đều khác; phải phân loại module ảnh hưởng quyết định/execution và module chỉ quan sát.
- 82 snapshot RR2 từ Jan–Jun2025 đã dùng lại để thử AI rồi thử entry. Đây là development đã xem. Các thư viện/engine và tập kế hoạch không giống toàn bộ live. Baseline khớp giữa hai script nghiên cứu không bằng baseline khớp live.
- Ba vị thế đóng gần đây trong export lỗ gộp do biến động giá 1,933 USDT; phí/funding DB ghi nhận 0,18920057; net −2,12220057. Khoảng 91,1% khoản lỗ này có trước phí. Đây chỉ là ba lệnh thuộc hai fingerprint trước lần đổi model, chưa đủ kết luận về Qwen hiện tại.
- Giá khớp entry gần giá đặt; tổng phí entry quan sát 0,04852352 USDT, trong khi mô hình cơ sở cộng phí/slippage entry 0,24261770. Không thể dùng ba mẫu để khẳng định phí thực mãi thấp như vậy; cũng không được coi giả định stress là mức phí đã đo.
- MFE trên các phút trọn vẹn của ba vị thế khoảng 0,46R/0,86R/0,36R; chưa ghi nhận đạt 1R. Bằng chứng này chưa ủng hộ tiếp tục ưu tiên dời SL sau 1R. Các phút entry/exit không trọn bị loại, nên MFE không phải cực trị toàn bộ tick.
- 553 lần dispatch có 240 lý do structure transition, 111 no BOS, 99 ngược structure. Đây là lượt kiểm tra, có thể lặp setup; không được báo là 450 cơ hội giao dịch độc lập bị bỏ lỡ.
- Export có 118 provider result chưa biết chi phí. Tổng net kinh tế live gồm AI chưa đối soát đầy đủ.
- Nhánh chờ xác nhận 5m cải thiện stress ROI −8,67%→−1,79%, cùng 18 fills, nhưng vẫn âm và chỉ trên development. Giữ làm giả thuyết, không chọn làm chiến lược thắng.

Sai lầm cần sửa: chọn RR/model trước khi xác định cơ chế tạo lợi nhuận; liên tiếp tối ưu trên dữ liệu đã xem; so số liệu khác baseline; mô phỏng nguồn ứng viên bằng ví cố định rồi diễn giải thành hiệu quả account động; chưa kiểm tra khả năng đặt lệnh ngay từ đầu. Các kế hoạch trước đã có giới hạn số thử nhưng vẫn không giải quyết những nền tảng này. Chỉ đặt thêm giới hạn số thử không đủ.

## 2. Định nghĩa mục tiêu đúng

Mục tiêu cuối là **toàn danh mục BTC có ROI kinh tế ròng dương và nhiều lệnh khớp độc lập hơn baseline live đã đóng băng**, cùng thời gian, vốn, giới hạn rủi ro và chất lượng dữ liệu.

- ROI kinh tế = PnL giao dịch sau fee/funding/slippage trừ chi phí AI và phần hạ tầng tăng thêm, chia vốn ban đầu. Tách chi phí trả từ ví exchange và chi phí trả ngoài để hạch toán đúng việc admission.
- Đếm riêng: setup độc lập → kế hoạch có thể đặt → order gửi → fill → close. Chuẩn hóa theo 30 ngày dữ liệu được quan sát; không nhân bản tín hiệu lặp để tăng số cơ hội.
- Nhóm lệnh bổ sung phải có expectancy ròng dương; danh mục gộp vẫn phải replay lại vì occupancy/cooldown/số dư thay đổi lệnh sau. Không cộng lợi nhuận counterfactual để thay thế replay.
- Đánh giá từng thành phần bằng chức năng của nó. Một sửa lỗi dữ liệu/khớp lệnh không bắt buộc tự tăng cả ROI và số lệnh. Hai mục tiêu phải đạt ở danh mục cuối; không dùng một thành phần lọc hết lệnh để tuyên bố thành công.
- BTC, cooldown 1h, ngày 10%, trần mỗi lệnh 3% gồm dự phòng chi phí, không cap USD cố định; target sizing 0,5% giữ theo chính sách hiện hành. Không reset circuit hoặc nâng rủi ro để tạo số lệnh.

## 3. Bước đầu tiên: kiểm tra không gian đặt lệnh khả thi

Số dư DB lúc rà soát: 31,47744546 USDT. Minh họa bằng giá fill gần nhất 84.340,3 và lot giả định 0,001 BTC, không phải báo giá hiện tại:

- Notional 84,3403 USDT; trần rủi ro 0,94432336 USDT.
- SL sàn 0,8% gây rủi ro giá 0,6747224 USDT; cộng reserve phí/slip tổng 0,2% thành khoảng 0,843403 USDT, tức 2,68% số dư.
- Khoảng SL khả thi xấp xỉ 0,8%–0,92% trong ví dụ long này, trước các guard khác. Target sizing 0,5% không thể thực hiện đúng với lot đó và SL sàn.
- Vì vậy lỗi thiết kế có thể nằm ở sự không tương thích giữa vốn/lot, khoảng SL và độ rộng chuyển động của setup. Dời entry tốt hơn trong khi khóa SL tuyệt đối dễ làm SL gần hơn sàn: đã xảy ra với 81/82 kế hoạch thử.

Đầu ra bắt buộc: bảng khả thi theo timestamp, lấy filter/giá/account fee thực của đúng môi trường exchange, tính minQty/step/minNotional/exposure/risk rounding. Tách rủi ro dự phòng admission khỏi chi phí execution đo được. Không giả định tăng leverage làm giảm lỗ USD tại SL cho cùng quantity.

**Gate F:** nếu không còn không gian khả thi cho đủ cơ hội, dừng tối ưu model/entry của nhánh đó và trình bày chính xác ràng buộc. Chỉ nghiên cứu thay đổi cấu trúc entry/SL trên paper nằm trong cấu hình đã khóa, bao gồm SL floor 0,8%; không hạ floor, đổi BTC hoặc yêu cầu thêm vốn như thể đó là edge. Nếu cải thiện đòi thay cấu hình đã khóa, ghi rõ chưa khả thi trong phạm vi được giao; chỉ thay khi có yêu cầu mới rõ ràng của người dùng.

## 4. Một baseline và một engine thực thi

Tạo release manifest cho code, config, model, prompt, memory/state và candle cutoff. Giữ engine quyết định, admission, sizing, TTL, fill, funding, protection, exit và circuit chung cho live/replay; chỉ thay adapter dữ liệu/exchange/clock/storage. Không phát triển thêm một simulator chiến lược riêng.

Hai lớp kiểm chứng:

1. **Replay kiểm toán đã xảy ra:** dùng quyết định AI và sự kiện exchange đã ghi tại thời điểm đó. Không gọi model hôm nay rồi giả làm quyết định cũ. So signal/decision/order/fill/exit và từng khoản tiền; chỗ thiếu snapshot ghi `unknown`.
2. **Backtest phản thực:** dùng market data và biến thể mới, account state tiến triển độc lập theo thời gian; ghi rõ giới hạn của queue, mark-price stop và LLM có thể đã biết lịch sử. Kết quả này không thay thế lớp 1.

Khôi phục state circuit từ baseline snapshot, không khởi tạo account "sạch" rồi gọi là phiên bản live. Xây cost base từ fee tier/maker-taker/fills được đối soát; stress là kịch bản riêng với giả định công khai, không bỏ stress vì làm kết quả xấu. Giải quyết khác biệt exit 48h/end liquidation, latency và pending TTL trước khi so chiến lược.

**Gate P:** mọi mismatch ảnh hưởng quyết định/tiền/rủi ro phải được giải thích hoặc sửa; unknown không được tính pass. Có parity test cho sự kiện đủ dữ liệu và test synthetic cho gap, fill/cancel race, funding, min lot, fee, circuit. Nếu thiếu lịch sử, bắt đầu journal prospective đầy đủ ngay; không ngồi chờ đủ mẫu mới sửa kỹ thuật. Chỉ hash giống nhau hoặc unit test pass chưa phải execution parity.

## 5. Tìm nguồn lợi nhuận từ toàn bộ tập cơ hội

Thu setup trước bộ lọc chiến lược từ nến đóng, cả long/short và các trạng thái thị trường được mô tả bằng thông tin quá khứ. Tách bộ lọc tài chính bắt buộc khỏi bộ lọc dự đoán. Dùng khóa setup/sóng để gộp các lần dispatch lặp; lưu lý do qua/rớt của mọi lớp, kể cả không gọi AI.

Đo trên toàn inventory, không chỉ lệnh đã fill hoặc đã thắng:

- Chuyển động thuận/ngược sau tín hiệu, thời gian tới MFE/MAE, chạm entry/SL/TP theo thứ tự quan sát được, sau SL/TP, expiry và censorship.
- Khả năng fill, adverse selection sau fill và chi phí tối thiểu cần vượt. Path chưa fill không được hạch toán như trade.
- Phân rã chênh lệch các stage bằng so sánh cùng inventory; khi thay stage phải replay lại toàn danh mục để định lượng tác động nhân quả trong mô hình. Thống kê nhóm hậu nghiệm chỉ sinh giả thuyết.
- Đối chứng tín hiệu theo thời gian/regime và hướng để biết detector có lợi thế vượt drift/ngẫu nhiên hay không. Không chỉ so với một baseline đang lỗ.

**Gate E:** chọn nhiều nhất hai giả thuyết có cơ chế cụ thể và không gian execution khả thi: ví dụ continuation có xác nhận hoặc failed-breakout reversal chỉ khi dữ liệu ủng hộ. Không định trước bắt buộc dùng cả hai hoặc bắt buộc RR2. Nếu tín hiệu thô không có dấu hiệu lợi thế sau chi phí, loại cả detector đó; không cứu bằng chuỗi thử RR/TP/model.

## 6. Một vòng xác nhận có điều kiện dừng

Trước lượt chạy: đăng ký giả thuyết, universe, detector/regime, entry/SL/TP, fill/latency/exit, model/prompt nếu có, chi phí, source hash, giai đoạn và tiêu chí. Tối đa hai giả thuyết cơ chế, không grid tuning. Mọi lần thử mới cộng vào lịch sử nghiên cứu chung; đóng một "vòng" không xóa multiplicity.

Lập registry dữ liệu đã sử dụng. Dữ liệu 2023/2024/2025 và các giai đoạn gần đây đã xem phải được gắn đúng trạng thái; kiểm tra registry trước khi gọi một đoạn là chưa xem. Chia chronological development/validation/test, loại giao thoa theo horizon giữ lệnh, không chia random các setup chồng lấn.

Tiêu chí cho candidate: base/stress net ROI>0; expectancy nhóm bổ sung>0; toàn danh mục nhiều fill độc lập hơn baseline trên cùng kỳ; drawdown không xấu hơn baseline ngoài dung sai đã định trước và không vi phạm policy; kết quả không phụ thuộc một lệnh/tuần hoặc một vốn khởi tạo sát biên lot. Dùng khoảng bất định theo block thời gian, có tính số thử, không đặt một con số trade count rồi coi nó là chứng minh.

Nếu validation thất bại, không chỉnh tham số rồi chạy lại chính validation như chưa xem. Dừng candidate và ghi failure theo nguyên nhân. Không tự mở vòng mới nếu chưa có dữ liệu mới hoặc một cơ chế khác được chẩn đoán; báo trạng thái không tìm được edge, không gửi thêm bảng âm rồi mời thử tiếp.

## 7. AI và triển khai

AI không bị loại chỉ vì tốn token. Dùng OpenRouter khi cần cho một bài toán đo được: lựa chọn setup, phân loại trạng thái hoặc giải thích tín hiệu theo schema. Cùng inventory so engine quy tắc và AI; phải đo giá trị tăng thêm sau chi phí/latency, không đánh giá bằng tỷ lệ JSON đúng hay confidence cao. Nhận định AI trên lịch sử là development; quyết định prospective mới kiểm tra được hiệu quả ở thời điểm thật.

Chỉ candidate vượt Gate F/P/E và validation mới vào prospective shadow. Journal không có kế hoạch trong một ngày chưa nói lên profitability; coverage và không gian khả thi phải được báo ngay để tránh lặp hai đợt24h không setup.

Đặt cửa sổ shadow đầu 14 ngày lịch, xử lý hết horizon của lệnh đang mở; đủ/thiếu bằng chứng theo uncertainty và số setup độc lập đã định trước, không tự gia hạn liên tục. Chỉ mở thêm cửa sổ khi có câu hỏi chưa giải quyết cụ thể và chi phí đo được. Không đổi ngưỡng sau khi thấy kết quả. Sample nhỏ có thể kiểm chứng plumbing, không đủ để chứng minh edge.

Người dùng đã cho phép triển khai khi kiểm chứng đạt. Khi đủ bằng chứng, thực hiện rollout có phiên bản với mức thực thi nhỏ nhất hợp lệ dưới trần đã chốt; nếu minimum lot khiến không thể giảm quy mô nữa phải nêu đúng giới hạn. Giữ rollback và điều kiện dừng, không nâng risk để canary trông có nhiều giao dịch. Review theo cùng metric ROI/cơ hội/fill, không chỉ log bot online.

## 8. Thứ tự thực hiện và đầu ra review

| Công việc | Kết quả phải giao | Điều kiện đi tiếp |
|---|---|---|
| F + audit baseline | Bản đồ khả thi; ledger chi phí; mismatch live/replay | Biết chính xác có thể đặt gì và phép đo nào đáng tin |
| Engine/journal parity | Một đường xử lý chung; event replay; coverage/unknown | Không còn mismatch trọng yếu chưa giải thích |
| Inventory và attribution | Một báo cáo nguồn edge và mất mát, có setup dedup | Một hoặc hai cơ chế có bằng chứng đáng kiểm chứng |
| Xác nhận đóng băng | Bảng baseline/candidate trên dữ liệu đúng trạng thái | Đạt mục tiêu kép và độ bất định chấp nhận được |
| Shadow rồi rollout | Kết quả prospective, chi phí thực, rollback | Bằng chứng đủ; không dùng deadline thay bằng chứng |

Tại thời điểm chốt quy trình, đầu ra kế tiếp chỉ gồm bước F và danh sách mismatch ưu tiên, không thêm backtest RR/model. Từ đó, việc kế tiếp được cập nhật trong [trạng thái bàn giao](roi-opportunity-progress.md) theo gate đã có bằng chứng; không hiểu câu này là phải làm lại bước F từ đầu mỗi lượt. Mỗi báo cáo ngắn phải trả lời: nguyên nhân nào đã xác minh, đã sửa gì, ảnh hưởng đo được, gate nào đang thiếu. Thời gian chờ outcome chạy bằng collector; không giữ phiên Codex mở để liên tục báo tiến độ không đổi.

Tài liệu phương pháp: Bailey và cộng sự, [Probability of Backtest Overfitting](https://www.davidhbailey.com/dhbpapers/backtest-prob.pdf), về rủi ro chọn chiến lược sau nhiều thử nghiệm; [Binance contract specifications](https://www.binance.com/en-AE/support/faq/detail/360033161972), chỉ là tham chiếu cơ chế filter — giá trị vận hành phải lấy từ đúng endpoint/account tại thời điểm đo.
