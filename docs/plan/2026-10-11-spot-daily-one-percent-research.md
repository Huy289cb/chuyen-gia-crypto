> **Chốt kết quả 11/10/2026:** Backtest bốn case đã COMPLETE, 365 ngày 01/10/2025–30/09/2026, tổng Spot giả lập100 USDT. Luân chuyển net tiền mặt −36,23280903/−49,78283272 USDT: loại. BTC đối chứng +5,18332770/−0,01624130; stress book NAV100,595047216 do còn dust thuộc sở hữu. Cả bốn không đạt mean1%/ngày; cũng không có rolling30/90 đạt. [Báo cáo hoàn chỉnh](/home/ubuntu/binance-income-research-2026-10-11-daily-1pct/report.md), [verdict](/home/ubuntu/binance-income-research-2026-10-11-daily-1pct/verdict.json), [audit ledger v2 PASS](/home/ubuntu/binance-income-research-2026-10-11-daily-1pct/rotation-recorded-artifact-independent-verification-v2.json). Main1.445,805giây/82.344KiB dưới1.800; protocol/source/data giữ nguyên. V1 dương đã lưu riêng. Kế tiếp là [order-flow data feasibility](/home/ubuntu/binance-income-research-2026-10-11-daily-1pct/orderflow-next-experiment-plan.md), chưa có alpha/ROI cho hướng này. Phần bên dưới giữ thiết kế trước main; trạng thái cũ được cập nhật ở các chỗ đánh dấu.

# Nghiên cứu Spot: bản chốt v1 và mục tiêu bình quân 1% tài khoản/ngày

Phạm vi ngày 11/10/2026: chỉ Spot; bình quân nhiều tháng, tính cả ngày đứng ngoài và ngày lỗ. Người dùng có thể bổ sung khoảng 100 USDT. Tạm dùng **tổng vốn giả lập 100 USDT** cho phép thử kế tiếp; nếu ý người dùng là nạp thêm 100 vào 15 hiện có thì tổng khoảng 115, cần ghi nhận lại trước một phép thử khác. Đây là ngân sách nghiên cứu giả lập, chưa xác nhận số dư hoặc đã nạp tiền.

## Bản chốt v1 đã được lưu

[BTC_SPOT_ROI_POSITIVE_V1](/home/ubuntu/binance-income-baselines/spot-roi-positive-v1-2026-10-11/README.md) giữ nguyên kết quả BTC, code, dữ liệu, protocol và biên lai kiểm tra. Snapshot có 218 file được liệt kê, gồm 181 artifact gốc, bản manifest gốc, 34 bản sao external references, thông tin baseline và README. Hash snapshot manifest: `13eff89f4c0b5bf30f96e552b2982522be0ba77d830e16743bd4f5777b3a1261`. Kiểm tra độc lập toàn bộ bản sao và nguồn gốc đều khớp; quyền chỉ đọc giảm nguy cơ sửa nhầm.

Ví giả lập 15 USDT, 01/2024–09/2025, sau phí/trượt giá/làm tròn mô phỏng: base +6,36567791 USDT, stress +4,46902244; drawdown 26,51%/30,12%, 39 lệnh đóng mỗi case. Bình quân 0,00996/0,00699 USDT trên mỗi ngày trong 639 ngày. Giai đoạn 01–09/2025 âm; phần lớn lợi nhuận tập trung vào hai lệnh lớn. Kết quả dương này là ứng viên hồi cứu; chi phí VPS và khớp lệnh thực chưa được xác minh.

Mức 0,15 USDT/ngày trên ví 15 đòi lợi nhuận cao hơn khoảng 15–21 lần bình quân cũ. Tăng vốn giảm ảnh hưởng của lot và dust; không được nhân kết quả v1 rồi coi là backtest ví 100. V1 cũ có buy cap cố định 12 USDT, nên việc đổi vốn/sizing cần version riêng.

## Định nghĩa mục tiêu và tác động của vốn mới

| Vốn ban đầu giả lập | Tham chiếu 1% ban đầu/ngày | 30 ngày | 90 ngày | 365 ngày |
|---|---:|---:|---:|---:|
| 15 USDT | 0,15 USDT | 4,50 USDT | 13,50 USDT | 54,75 USDT |
| 100 USDT | 1,00 USDT | 30,00 USDT | 90,00 USDT | 365,00 USDT |
| 115 USDT | 1,15 USDT | 34,50 USDT | 103,50 USDT | 419,75 USDT |

Bảng là lợi nhuận ròng chia vốn **ban đầu**, chưa phải lợi nhuận kép. Báo cáo phải tách ba cách tính:

1. Bình quân PnL ròng/ngày lịch và `net/(vốn ban đầu × số ngày)`.
2. Bình quân lợi nhuận ngày trên equity đầu từng ngày: `mean(E_d/E_(d-1)-1)`. Đây là chỉ tiêu chính cho cách hiểu “1% tài khoản/ngày”.
3. Tăng trưởng kép tương đương: `(E_cuối/E_đầu)^(1/N)-1`.

Không tuyên bố đạt mục tiêu chung chỉ vì một cách tính thuận lợi hơn đạt 1%. Nếu ngày nào cũng tăng đúng 1% và tái đầu tư, 100 USDT sẽ thành khoảng 3.778,34 USDT sau 365 ngày; bình quân số học 1% với ngày lỗ và biến động không suy ra con số đó. Mọi phép tính loại tiền nạp/rút khỏi lợi nhuận.

Nguồn phí hiện tại của [Binance](https://www.binance.com/en/fee/trading) ghi mức regular 0,1% mỗi chiều; ưu đãi BNB cần điều kiện riêng. Với 80% vốn được triển khai, một vòng mỗi ngày muốn tạo 1% toàn ví cần khoảng 1,25% ròng trên phần được dùng. Phí 0,1% mỗi chiều và slip 0,1% mỗi chiều đưa chuyển động giá thuận cần thiết lên khoảng 1,66%, trước lot/dust và ngày lỗ; slip 0,3% đưa mức này lên khoảng 2,06%. Đây là đại số giới hạn, không phải lợi nhuận dự báo.

Public exchangeInfo/bookTicker của bảy cặp đã được lưu kèm thời điểm và hash. Đại số ở vốn 100/115 cho thấy ngân sách 4×20 hoặc 5×16 USDT có thể vượt các minimum theo giá giả định, nhưng chưa kiểm acceptance bằng WAP 5 phút hoặc rủi ro tương quan. Không chọn ngay một danh mục nhiều vị thế chỉ vì đặt được lệnh. Dust vẫn thuộc sở hữu; phải tách phần thiếu tiền mặt có thể dùng khỏi hao hụt kinh tế sau đánh dấu dust.

## Các cơ chế đã đối chiếu với nguồn gốc

| Cơ chế | Điều đáng học | Giới hạn và quyết định |
|---|---|---|
| Momentum/relative strength và tiền mặt | Chọn tài sản mạnh hơn, giảm thời gian giữ khi đà chung yếu | Ưu tiên một phép thử cụ thể; chưa có bằng chứng exact model đạt 1%/ngày |
| OBV, volume và filter/hysteresis | Thêm thông tin khối lượng, giảm đổi vị thế vì tín hiệu nhiễu | Hướng thứ hai; chưa chạy khi chưa chốt được exact model và tham số có lý do |
| Maker trên cặp FDUSD đủ điều kiện | Có thể giảm phí khớp lệnh | Chỉ nghiên cứu execution riêng; không thay giả định taker bằng “0 phí” trong backtest OHLC |
| Scalping, grid, listing/news | Có thể có phiên lời cao | Chưa có bằng chứng phù hợp về nhiều tháng, chi phí, latency và vốn nhỏ để ưu tiên |

[CTREND gốc](https://unipub.lib.uni-corvinus.hu/11621/1/a-trend-factor-for-the-cross-section-of-cryptocurrency-returns.pdf) dùng 28 đặc trưng, 52 tuần ước lượng và danh mục quintile đổi hàng tuần. Table 9 cho long quintile của nhóm 100 coin lớn mức khoảng 3,11–3,38%/tuần sau chi phí giả định. Khoảng 20 vị thế với floor phổ biến 5 USDT đã cần ít nhất 100 USDT trước reserve và chênh lệch trọng số; ví 100/80 triển khai chưa sao chép được danh mục đó. Không chuyển số này sang một coin hoặc 1%/ngày.

[Bản tái lập CTREND, commit 79b90d7](https://github.com/avakof/CTREND/blob/79b90d7f9624149cd46d8e112aaf1c2b9090a95e/README.md) tự báo lợi thế long-only giảm mạnh ở dữ liệu sau 2022 và phiên bản thanh khoản cao âm năm 2025/2026. Nguồn có công bố lỗi đã sửa và giới hạn universe/dữ liệu; chưa chạy lại độc lập tại VPS này. Đây là bằng chứng chống việc bê lợi nhuận giai đoạn cũ vào kỳ vọng hiện tại, không phải chứng minh mọi momentum đều thất bại.

[Nghiên cứu Spot momentum của FionaNi](https://github.com/FionaNi-DS/crypto-statistical-arbitrage) báo mô hình top-3 hàng tuần tốt ở development 2023–2024 nhưng giá trị danh mục 2025 còn 0,5626 sau chi phí mô hình. Vì vậy không coi “chọn coin tăng mạnh” tự nó đã là edge.

[Nghiên cứu Ghent về technical rules](https://backoffice.biblio.ugent.be/download/01HY3C3S169G1N6QNYR55NZMFB/01HY60XZGZYHNQ6188MSVJT0SG) có long/cash OOS sau chi phí, và nhóm OBV đáng khảo sát. Kết quả thuộc các ensemble được chọn theo quá khứ, không phải một cặp MA tùy ý trên Binance. Tổng log-return và log-drawdown không được đọc thành phần trăm đơn giản; không sao chép sweep 75.360 luật để tìm một kết quả dương.

[Thông báo FDUSD](https://www.binance.com/en/support/announcement/detail/4856a6d4e4014d4e8a5a29ec5fb44857) giữ maker 0 ở các cặp được liệt kê, nhưng taker áp phí chuẩn từ 29/01/2026. Lệnh maker cần kiểm fill, queue, adverse selection, lệnh bỏ lỡ, chuyển quote và stop bằng taker. Nến chạm giá limit chưa chứng minh lệnh được khớp. Ba URL Binance không trả được raw body qua HTTP downloader; receipt ghi thất bại, dù trang phí/thông báo đọc được qua browser. Các PDF và README đã lưu byte/hash.

## Phép thử ưu tiên: một coin dẫn đầu hoặc tiền mặt

Định danh mới: `SPOT_ROTATION_7D_DAILY_100_V1`. Đây là giả thuyết hybrid mới, không phải bản tái tạo CTREND hoặc sửa tham số BTC v1.

- Universe cố định: BTCUSDT, ETHUSDT, BNBUSDT, SOLUSDT, DOGEUSDT, XRPUSDT, ADAUSDT. Chọn trước khi đọc PnL mới; universe các coin còn tồn tại vẫn có selection/survivor bias.
- Mỗi 00:00 UTC, sau khi ngày trước đóng, tính `C(T)/C(T−7 ngày)−1` từ **tám** daily closes; xếp hạng Decimal, tie theo tên symbol. Không dùng nến ngày đang mở.
- Target là coin có return cao nhất nếu return đó dương và return BTC dương; còn lại target tiền mặt. Daily ranking nhanh hơn nguồn weekly và có nguy cơ tăng turnover; đây là thay đổi phải đo.
- Giữ nếu leader không đổi; không mua thêm/cắt bớt để ép tỷ trọng 80%. Nếu đổi leader, bán vị thế cũ trước; leader không đặt được thì giữ tiền mặt, không chọn coin thấp hạng để làm đẹp fills.
- Một active position và một ví USDT dùng chung; dust của mọi coin vẫn được giữ trong inventory. Không nhân vốn thành bảy ví riêng, không giả bán tài sản dưới minimum.
- Entry dùng tối đa 80% executable NAV, chừa ít nhất 20% tiền mặt lúc mua. Research risk budget theo tỷ lệ 20% NAV và phần ngân sách lỗ còn lại của ngày VN; tại 100 đây là thay đổi policy so với cap USD cố định ở v1, chỉ áp vào giả lập.
- Initial stop tĩnh bằng fill trừ 2×ATR14 từ các ngày đã đóng; Wilder seed SMA14, không mở rộng stop, không TP. Tại minute open, chỉ stop gap cũ được ưu tiên trước action cùng open; sau đó xử lý pending SELL/BUY, rồi mới xét low trong phút nếu còn vị thế. Stop từ low không rõ thời điểm crossing: cash chỉ khả dụng tại cuối phút, có interval annotation, không cấp tiền ngược về open. Exact rounding, risk reserve, entry-minute stop, order latency và retry phải thể hiện trong code/test/registration trước main.
- Mô phỏng lệnh ở 1m open đầu tiên sau due time; delay 30/120 giây là yêu cầu tối thiểu, không giả chính xác 30 giây khi quote tiếp theo cách 60 giây. Sau bán có cooldown 1h rồi mới BUY với delay mới; target TTL 2h. Một entry attempt mỗi daily decision, không vào lại trong ngày do vừa bị stop.
- Base: phí 0,1% mỗi chiều, slip 0,1%; stress: phí như base, slip 0,3%. BUY fee trả base, SELL fee trả USDT. Dùng tick/step/precision riêng từng cặp; NOTIONAL reference dùng năm phút **đã hoàn tất** theo proxy quote/base volume. Filter hiện tại dùng làm scenario, lịch sử filter và avgPrice thực vẫn unknown.
- Không BUY/SELL/stop/trail trên phút có volume hoặc trade count bằng 0; pending entry chờ phút có giao dịch trong TTL. Nếu phút cuối rỗng, không giả terminal sale; giữ stranded inventory. NAV đánh dấu có thể dùng giá cũ như conditional model mark, ghi rõ thiếu chứng cứ khớp lệnh và không tạo tiền mặt. Failed rotation exit được xét sau quyết định mới để HOLD có thể hủy; protective STOP latch không bị HOLD hủy.
- Không kế thừa hidden gate “1,5× forecast”, “4× drag”, hoặc gate lot-value 0,10 USDT từ planner cũ. Past return chỉ để xếp hạng, không phải dự báo lợi nhuận để vượt cost gate.

## Dữ liệu, triển khai và tiêu chí báo cáo

Root nghiên cứu: `/home/ubuntu/binance-income-research-2026-10-11-daily-1pct`.

Đã COMPLETE và audit độc lập: 105 Spot1h archives Jul2025–Sep2026, 76.776 nến, bảy cặp, zero gap/duplicate; mỗi cặp 2.208 giờ warmup và 8.760 giờ main. Không tính indicator/return trong bước data QA. 1h đủ tạo daily signal nhưng thiếu minute fill/stop/WAP; collector 1m riêng đã COMPLETE Sep2025–Sep2026: 91 archives, 3.981.600 nến, 353,22 giây dưới cutoff 1.200, không retry. Audit độc lập strict dừng FAIL sau 10/91 file do ADA 26/07/2026 00:00 là phút rỗng giữ giá cũ 0,1648, còn 00:01 giao dịch đầu giá 0,1649 đúng hourly open. Receipt FAIL giữ nguyên; audit v2 có registration riêng kiểm chính xác first/last traded-minute OHLC, không nới tolerance. Audit v2 sau đó đã PASS đủ91/91,3.981.600rows/66.360hourlycomparisons,805phút rỗng,0chênh lệch chưa giải thích; gate dữ liệu đạt trước registration tài chính. Receipt strict FAIL cũ giữ nguyên.

Main là 01/10/2025–01/10/2026 exclusive, 365 ngày UTC. Đây là đánh giá hồi cứu ở kỳ muộn hơn v1, chưa phải prospective holdout sạch sau khi đã xem nguồn công bố 2026. Cần paper từ dữ liệu phát sinh sau registration để xác nhận sau này.

Implementation riêng ở `backend/spot_rotation`: strategy chỉ đọc closed bars; ledger parameterized theo symbol; runner streaming, bốn case độc lập trên cùng market clock nếu control sẵn sàng. Hai case rotation và hai case `V1_RULES_CONTROL_100_2025_2026` dùng cùng vốn, phí, sizing/risk và dữ liệu. Control giữ luật EMA600/exit98%EMA/trailing15%/TP11×entry; EMA warmup bắt đầu từ dữ liệu BTC cũ Apr2023, không sửa source v1. Control ví 100 dùng policy tỷ lệ và thứ tự minute execution mới có tính nhân quả; không được gọi là replay chính xác bản v1 15 đã chốt.

Trước main: kiểm synthetic cho chronology, tám closes, ATR seed, shared cash/dust, bị từ chối exit, cooldown, entry/stop cùng phút, minnotional và terminal; review độc lập; pin tất cả local runtime dependencies/config/metadata/data/QA bằng SHA. Một financial run có cutoff 1.800 giây kể cả startup và output; incomplete/exception là INCONCLUSIVE, không cộng kết quả prefix hoặc mở rộng budget để đạt ROI. Performance QA v3 đã COMPLETE40,006giây sau v1 INCOMPLETE và v2 FAILED được giữ. Main sau registration đã COMPLETE bốn case; xem kết quả ở đầu tài liệu. Các bước này không biến kết quả âm thành financial PASS.

Báo cáo kết quả luôn có:

- Trading-net và all-system-net tách nhau; phí/slip/rounding/dust đã hạch toán một lần. AI calls=0 trong historical rules-only. VPS/chi phí phát sinh chưa có bằng chứng ghi unknown.
- Executable NAV, book NAV/dust từng coin, lệnh đóng, WAIT/rejections, ngày không fill, occupancy, số entry độc lập và nguyên nhân exit; stranded tài sản không được biến thành tiền.
- PnL mọi ngày, ba cách tính ROI, ROI tháng và rolling30/90, drawdown tuyệt đối/phần trăm, expectancy/PF và tập trung lợi nhuận. Day returns dùng đủ 365 ngày UTC; day-risk VN có hai biên partial và không làm denominator ROI.
- Đối chứng cash, buy-hold BTC cùng phần vốn triển khai và BTC v1-rule control cùng kỳ. Buy-hold có risk khác nên không coi ROI chênh lệch là so risk ngang nhau.
- Net dương cả base/stress mới là ứng viên; phải báo riêng có đạt mục tiêu 1% hay chưa. Không đạt mục tiêu nhưng ROI cải thiện vẫn được giữ đúng nhãn; không điều chỉnh tham số rồi dùng lại kỳ này làm holdout.

LLM chỉ đánh giá sau baseline rules được xác minh, bằng quyết định prospective và chi phí provider thực, cùng rules-only control. Confidence do model tự khai không phải xác suất thắng; không gọi model hôm nay để giả nó chưa biết lịch sử. Vòng này không thay runtime, Futures, private account, chuyển tiền hoặc gửi Telegram. Khi source/data/review/protocol đủ, tiến hành phép đo được ủy quyền; không cần xin lại quyền thử nghiệm.
