# Bằng chứng ngoài cho tài khoản Futures 100 USDT — 12/10/2026

**Chưa tìm được bằng chứng công khai có thể kiểm toán và xác nhận đồng thời:** vốn 100 USDT, lợi nhuận ròng bình quân khoảng 1 USDT/ngày lịch và lỗ tối đa 10 USDT/ngày. Có kết quả live và backtest dương đáng học. Việc chưa xác nhận được không có nghĩa mục tiêu đã được chứng minh là bất khả thi.

Phạm vi theo lời làm rõ của người dùng là cải thiện **toàn hệ thống**, bỏ ICT/SMC và mọi giới hạn giao dịch cũ. Lượt nghiên cứu này không dùng private API, đặt lệnh, mua dịch vụ hoặc thay runtime.

## Bổ sung sau yêu cầu chấp nhận mạo hiểm

[Nghiên cứu sâu hơn ngày 12/10](2026-10-12-futures-aggressive-followup.md) kiểm trực tiếp ví Hyperliquid có ROI tháng +50,59%, mã Passivbot có seed EMA-anchor ticket 15 USDT trên vốn 100, và cơ chế wick recovery. Đã lưu public API/filters, đối chiếu cashflow và tính feasibility; chưa backtest chiến lược mới. Cửa sổ lợi nhuận cao có thật trong dữ liệu quan sát, nhưng chưa xác nhận kỳ vọng hoặc giới hạn lỗ ngày. Không đợi một tài khoản khớp hoàn toàn mới học cơ chế; ưu tiên mới P1/P2 nằm trong roadmap.

## Kết quả lượt nghiên cứu đầu

| Nguồn sơ cấp đã đọc | Kết quả công bố | Khoảng trống và điều nên học |
|---|---|---|
| [Talyxion v2, 03/12/2025](https://arxiv.org/abs/2511.13239v2), §4/Table 4 | Tác giả báo giao dịch Binance Futures live trong 30 ngày: +16,68%, MDD 4,56%. Quy đổi khoảng **0,556 USDT/ngày trên vốn 100 USDT** | Chưa có kiểm toán độc lập hoặc xác nhận tài khoản 100 USDT và giới hạn lỗ ngày. Abstract ghi 227 lệnh, bảng ghi 277 lệnh. Học cách xác định size theo volatility và lưu equity toàn danh mục |
| [Can AI Make Money in Crypto? v1, 28/09/2026](https://arxiv.org/html/2609.34510v1), Table 4; [code chính thức](https://github.com/Starlien95/Awesome-TradingAI) | Live từ 24/08 đến 21/09: Qwen +3,72%, MDD 6,06%; paper trading cùng kỳ +10,10%. Chỉ 1/4 phương pháp live có lãi. Quy đổi khoảng **0,13 USDT/ngày trên vốn 100 USDT** | Chưa xác nhận vốn, giới hạn lỗ ngày và đầy đủ chi phí funding/inference. Học cách đóng băng cấu hình và so backtest, paper trading, live trên cùng kỳ |
| [ralgo public metrics, 14/06/2026](https://raw.githubusercontent.com/Xlerq/ralgo/main/performance/public_metrics.json); [README](https://github.com/Xlerq/ralgo) | BTC backtest từ 2020 đến 14/06/2026: +518,40% sau phí và slippage, DD 11,39%, 510 lệnh. Kịch bản funding ước tính trung tâm: +374,4% | Kết quả in-sample, source riêng tư, walk-forward là `null`, funding là ước tính. +623,91% ở README chỉ tính phí giao dịch. Kịch bản trung tâm quy đổi **0,159 USDT/ngày trên vốn 100 USDT** trong 2.356 ngày. Học cách công khai độ nhạy với chi phí |
| [Funding-rate arbitrage CEX/DEX, DOI 2025](https://doi.org/10.1016/j.bcra.2025.100354); [code/data tác giả](https://github.com/SainyTK/funding-arb-analysis) | Kịch bản backtest tốt nhất báo **tổng lợi nhuận +115,9% trong 6 tháng**, MDD 1,92%; scenario XRP có Drift, leverage 7x. Đây không phải APR hay lợi nhuận bình quân ngày | Chọn kết quả tốt nhất trong 60 scenarios; chưa xác nhận live, vốn 100 USDT hoặc giới hạn lỗ ngày. [common.py](https://raw.githubusercontent.com/SainyTK/funding-arb-analysis/main/common.py) dùng cùng giá tham chiếu hai venue trong `get_dual_backtest_result`, nên chưa phản ánh đầy đủ basis risk. Có giả định phí nhưng chưa đối soát đủ execution và chi phí từng venue, kể cả transfer costs. Học ledger funding riêng cho từng chân |
| [AutoQuant v3, 07/08/2026](https://arxiv.org/html/2512.22476v3); [bài xuất bản](https://doi.org/10.1016/j.eswa.2026.133924) | Framework kiểm định execution và chi phí. Baseline dài từ 2019 đến 2025: CAGR −24,09%, MDD 95,36%. Cấu hình sàng lọc hai giai đoạn, sau 2024: lợi nhuận trung bình hình học 1,6%/tháng | Không khẳng định alpha bền vững. Replication package cấp theo yêu cầu, chưa tái lập. Học cách tính tín hiệu tại close t, thực thi ở t+1, xét thời điểm biết funding và stress chi phí |

**Quy đổi tuyến tính không phải backtest hoặc kết quả của tài khoản thực 100 USDT.** Lot/min-notional, margin, sizing và cashflow có thể khiến kết quả không scale được. MDD toàn kỳ không chứng minh lỗ từng ngày ≤10 USDT. Kỳ Qwen có 28 ngày elapsed, hoặc 29 ngày lịch nếu đếm cả hai đầu; cả hai cho khoảng 0,13 USDT/ngày. [Số học đã lưu](../audits/2026-10-12-futures-system-reset/target-arithmetic.json) không chứa PnL mới.

[Portfolio Talyxion được paper dẫn](https://www.binance.com/vi/copy-trading/lead-details/4643208492293369601) và dashboard benchmark chưa đọc hoặc đối soát độc lập được. Kết quả live do tác giả báo cáo chưa phải audited live.

## Hai hướng nên kiểm định

**A — trend/momentum long-short trên perpetual thanh khoản.** Ưu tiên đầu vì dùng được exchange adapter sẵn có, không cần chia vốn sang nhiều venue. Chọn universe tại đúng thời điểm lịch sử. Xác định size theo volatility và ngân sách ngày chung, có tính tương quan. [bittrends paper](https://arxiv.org/abs/2009.12155) và [code gốc](https://github.com/Globe-Research/bittrends) đáng học về walk-forward; mức 255% annualized bỏ ma sát giao dịch, chưa chứng minh mục tiêu ròng. [Perp Quant Lab](https://github.com/AbdullaE100/perp-quant-lab) có code và công khai thiếu funding, slippage và kiểm soát survivorship bias. Dùng làm giả thuyết, chưa coi là chiến lược thắng.

ICT/SMC có thể bị thay toàn bộ. Chỉ giữ bộ lọc cũ nếu so cùng kỳ và cùng chi phí chứng minh được lợi ích. Không mở tiếp vòng tuning grade/RR chỉ để giữ tên phương pháp.

**B — funding carry với hai perpetual đối ứng cùng underlying.** Margin và buffer của cả hai chân nằm trong đúng tổng 100 USDT; không giả định có thêm vốn Spot. Tất cả tài khoản ở hai venue và mọi legs dùng chung **một ngân sách cố định 10 USDT/ngày**, với MTM và cashflow tổng hợp; không cấp 10 USDT riêng cho từng venue. Khi tái lập, phải tính giá và fill độc lập từng venue, basis, funding intervals, transfer costs và liquidation từng chân. Minh họa: 50 USDT margin/chân, leverage 7x → 350 USDT notional/chân. Để thu gross 1 USDT/ngày từ funding, cần spread **0,286%/ngày** trước phí và basis. Đây là số học về edge cần có, không phải khuyến nghị leverage hay rule mới.

[BIS Crypto Carry, PDF cập nhật](https://www.bis.org/publ/work1087.pdf) báo carry khoảng 7%/năm ở mẫu futures đáo hạn từ 04/2019 đến 07/2024. Cơ chế này khác perpetual funding, không dùng để hứa 1 USDT/ngày. Nếu vốn, minimums hoặc spread ròng không khả thi thì đóng hướng B trước backtest lớn.

## Dữ liệu và cách học áp dụng

- [Binance public data](https://github.com/binance/binance-public-data): ZIP/SHA256, lịch sửa archive, listing/delisting. History đã xem phải có registry; không đổi thành holdout mới.
- [Binance USD-M market data](https://developers.binance.com/en/docs/catalog/core-trading-derivatives-trading-usd-s-m-futures/api/rest-api/market-data): exchangeInfo/filters, fundingRate settlements, fundingInfo interval adjustments. Dùng tick/step filters; không hard-code funding 8 giờ cho mọi coin.
- [Binance phí Futures](https://www.binance.com/en/support/faq/detail/360033544231): khi chưa biết tier, có thể giả định taker 0,05%/chiều cho baseline nghiên cứu, ghi rõ giả định và stress. Phí tính trên notional. Maker fill cần bằng chứng về queue và adverse selection.
- [Binance portfolio performance, cập nhật 15/07/2026](https://www.binance.com/en/support/faq/detail/54aa6d3b43bc4f6eb4a3a6e3aea40acd): kiểm denominator và cashflow trước khi chuyển ROI leaderboard thành PnL của ví có vốn cố định.

Filters, fee tier và số dư thực hiện tại **chưa được refresh trong lượt này**. Docs sàn không thay thế snapshot endpoint/tài khoản có timestamp.

Mean cố định 1 USDT/ngày trên vốn ban đầu 100 USDT tương đương net 30 USDT/30 ngày, 90 USDT/90 ngày hoặc simple return 365%/năm nếu đạt mức đó. Không yêu cầu từng ngày hoặc từng cửa sổ đều dương. Không đổi thành tái đầu tư 1% NAV/ngày, không chia CAGR/365 để suy ra mean tiền mặt.

Bài học áp dụng: chọn cơ chế có dữ liệu → kiểm feasibility với 100 USDT → làm đúng ledger/execution → kiểm chi phí và stress → quan sát prospective với cùng cấu hình → thu bằng chứng live. Chỉ giữ AI khi đo được lợi ích biên sau chi phí và latency. [Lộ trình toàn hệ thống](../plan/2026-10-12-futures-system-research-roadmap.md) phân biệt các gate này. [Ghi chú nguồn ngoài](../audits/2026-10-12-futures-system-reset/external-agent-note.md) và [ghi chú cơ chế](../audits/2026-10-12-futures-system-reset/mechanisms-agent-note.md) lưu phạm vi đọc chi tiết.
