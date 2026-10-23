# Kiểm độ tin cậy và hướng thực thi bổ sung —14/10/2026

[Trust/cost/integration report](2026-10-14-futures-source-trust-and-costs.md) hoàn tất theo yêu cầu0,2u đángthử. Rawprice data/phéptínhsource đãkiểm, chưa có net cash0,2/ngày với100u/10ICT. Con số0,206/hàng của compoundingcurve cómean capital238,95u; cost/bias/riskcầnđothêm. Coldnearestlot vẫntracking ít nhất35,29%gross trướcneutrality/margin; minimum làđiều kiệnorder vàmarket dùngmarkprice, không chỉtargetposition. Source cósignal40giữbaseline; executionsai lệchphảiversion.

[Planpaper](../plan/2026-10-14-futures-momentum-paper-integration.md) đặt phase1offlineadapter/lotpreview/sharedwalletgovernorreview trướcaccountPnL, chưaimplementation/financialregistration/scheduler. Các kếtquả nguồn bên dưới giữ nguyên; toàn bộfrozen source/results khôngsửa. Khôngruntimechange.

# Đã sửa cách thử: giữ nguyên code/cấu hình nguồn trước khi thích nghi

14/10/2026. Người dùng yêu cầu làm giống cấu hình tham khảo. **Hai V1 trước có thay đổi đáng kể, chưa phải bản sao của nguồn.** Các kết quả âm của chúng chỉ đúng với thiết kế riêng đã chạy; không dùng chúng để kết luận cấu hình nguồn thất bại. Không sửa các financial artifacts cũ.

## Khác biệt đã xác nhận

| Thành phần | Momentum của nguồn | Bản A trước |
|---|---|---|
| Danh mục | 40 mã từ CANDIDATES của research/fetch.py | Bảy mã |
| Tỷ trọng | Rank trung bình, trừ mean rank, chuẩn hóa tổng trị tuyệt đối thành2 | Một long/một short, chia đôi gross notional |
| Tổng exposure | 2 lần NAV trong mô hình nguồn | Sizing theo ngân sách8u, volatility60 ngày và margin cap20x |
| Tín hiệu/thời gian | Momentum14/sample vol30, shift1/15, UTC price labels; có thêm một ngày chờ trước đoạn return | Closed-known ICT features và entry ngay lúc chọn rổ |
| Cập nhật | Tỷ trọng toàn danh mục hằng ngày | Chỉ đổi rổ khi cặp symbol thay đổi hoặc stop |
| Chi phí/rủi ro | Fee5bps trên thay đổi weights; không funding/slip/lot/margin/daily governor | Broker giả lập, phí/slip/funding, lot và governor |

Nguồn cố định: [backtest3.py tại revision104dc669](https://github.com/AbdullaE100/perp-quant-lab/blob/104dc669084b7f0d0a99748a0f4300950b49930d/research/backtest3.py). Bản grid B trước dùng EMA20/80, MACD12/26/9, ATR, bốn phần inventory và market triggers do ta chọn. Features chỉ trên **BTC/ETH/BNB**; bảy coin trong runner là phạm vi wallet/data stream. Trader Binance công khai mô tả EMA/MACD/grid hai chiều nhưng không công bố các tham số này hoặc hedge mechanics. B không phải một replica đã xác nhận.

## Lần này đã chạy nguyên code nguồn

[Package mới](../audits/futures-quick-win/source-replication-20261014T032757Z/report.md) chạy **backtest3.py nguyên byte, một lần**, sau registration49inputs. Giữ40mã, rank weights, gross2, lookback/lag, daily updates và fee nguồn; không thêm cap20/stop8/chunks hoặc chọn lại coin.

Tác giả không đưa `prices.csv` lên revision tham khảo (HTTP404). Vì vậy lấy snapshot public Binance mới: **1.500 hàng daily, 05/09/2022–13/10/2026 UTC, đủ40 mã**. Thay đổi data acquisition duy nhất là chốt endTime để bỏ ngày UTC đang chạy; không tự chọn subset theo PnL. Author dependency versions không công bố; môi trường riêng Python3.10.12/numpy2.2.6/pandas2.3.3 được ghi lại.

Kết quả **mô hình nguồn**, quy đổi chỉ số ban đầu thành100:

- Toàn kỳ: **100 → 409,48445**, gain **309,48445**; Sharpe OOS1,5285, MDD close-to-close35,5829%.
- Chia gain cho1.500 hàng của mô hình: **0,206323u/hàng**. Các hàng gồm warm-up giữ tiền và terminal fee-only; không gọi đây là kỳ vọng mỗi ngày ICT.
- Chẩn đoán từ arrays đã lưu cho92 đoạn nắm giữ UTC tháng7–9/2026: chỉ số rebased100 → **96,12189**, −3,87811. Không phải account replay92ngày ICT; phí đầu đoạn vẫn là transition của danh mục đã chạy trước đó, không thêm chi phí tài trợ entry mới.
- Curve quy đổi100 có mức giảm tiền close-to-close lớn nhất **34,33873**,40 hàng giảm hơn10u. Daily UTC close-to-close không kiểm được ngân sách ngày ICT.

[Audit độc lập](../audits/futures-quick-win/source-replication-20261014T032757Z/independent/report.md) dùng công thức standard-library riêng:60.000 weights và60.000 ranks khớp chính xác;1.500 hàng returns/turnover/equity khớp, sai số equity lớn nhất1,38e−14. Đây là cùng code/config trên dữ liệu mới, không tái tạo chính xác curve5,0192 của tác giả vì thiếu giá gốc.

Code gốc dùng ngày mở kline làm label nhưng giá là close. Signal tại labelt chỉ biết giá đếnt−1, còn return là close[t]→close[t+1]; thời gian nắm giữ thực tương ứngt+1→t+2 UTC. Giữ nguyên cách này khi sao chép, không sửa ngầm. Hàng cuối không có forward return; nguồn vẫn trừ fee turnover, chưa thanh lý broker cuối kỳ.

## Khả năng thực thi trên100u

[Ticket diagnostic](../audits/futures-quick-win/source-replication-20261014T032757Z/receipts/ticket-feasibility.json) dùng đúng weights13/10, giá close đã biết và filters Binance public lấy14/10. Tại100u, **26/40 targets không đạt minimum ticket**,14 targets qua kiểm floor/minimum. Nếu bỏ targets không hợp lệ, gross còn98,721252u và net exposure+17,010812u; đó đã là danh mục khác.

Ví dụ BTC có weight0,0175, target1,75u nhưng minimum quantity0,001BTC tương ứng83,1257u ở reference price. Giới hạn vốn tối thiểu từ tickets của riêng snapshot này khoảng4.750,04u, **không phải đề xuất tăng vốn hoặc proof margin/risk đầy đủ**. Không thay vốn100u hoặc nâng weights cho đủ ticket khi người dùng chưa đổi yêu cầu.

Kết quả source model chưa gồm funding, slippage, giá trị lot/minimum, margin/liquidation hoặc governor10u/ngày ICT. Chạy benchmark nguồn không đổi các yêu cầu100u/10u; chưa thể gọi nó là bot100u có thể giao dịch y nguyên cấu hình.

## Grid: không tự điền tham số thiếu

[Hồ sơ Binance](https://www.binance.com/uk-UA/copy-trading/lead-details/5229164046792448257?timeRange=30D) chỉ đủ xác nhận mô tả của tác giả: EMA/MACD, BTC/ETH/BNB, grid hai chiều, API, leverage10–20x. Đã tìm theo tên/ID và nguồn công khai, chưa tìm được config/code gắn chính xác với trader. EMA spans, timeframe, spacing, quantities, TP/SL, triggers, hedge mode và risk exits đều chưa biết. Các ví dụ Passivbot công khai không được coi là config của trader này.

Xem [grid audit](../audits/futures-quick-win/source-replication-20261014T032757Z/grid-source/report.md) cùng correction-v2. Không mở thêm một bản grid phỏng đoán rồi gọi là học đúng cấu hình thắng.

## Quy tắc nghiên cứu hiện hành

Ưu tiên yêu cầu mới của người dùng: baseline nguồn phải giữ nguyên symbol/weights, entry/exit, timeframe/lag, lịch rebalance, exposure và costs mà nguồn công bố. Data hoặc tham số không có phải ghi thiếu; không điền bằng phỏng đoán. Chỉ sau baseline/parity mới mô tả adaptation bắt buộc do broker hoặc100u/10u, và ghi thành version riêng. Nếu buộc đổi yêu cầu mới thì hỏi người dùng; không tự nâng vốn/ngân sách ngày. Không khôi phục các rules giao dịch cũ.

Next là thiết kế execution/risk tương thích với100u/10u, trình bày rõ những khác biệt không thể tránh do minimums, không thay alpha một cách tùy ý. Exact executable replica hiện chưa đủ điều kiện; account adaptation NOT_RUN. Không runtime deployment, private API, paid LLM, orders hoặc transfers.
