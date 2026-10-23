# Kết quả áp dụng đã có —14/10/2026

[Account trials A/B](../audits/futures-quick-win/method-trials-20261013T152454Z/report.md) hoàn tất bốn case92ngày100u: momentum tập trung net base/stress−65,58/−80,03u; grid market trigger−0,44/−5,10u. Bốn money audits độc lập PASS; không breach10u trong synthetic minute envelope, chưa live assurance hoặc mean1u. Hai V1 economic NO_GO, khác danh mục nguồn40coin/config kín của trader. Bằng chứng công khai và thành tích nguồn bên dưới giữ nguyên; account NOT_RUN ở bản13/10 là lịch sử.

Kế tiếp [source-transfer feasibility](../plan/2026-10-14-futures-source-transfer-feasibility.md) trước registration mới. Giữ frozen source/config/outputs V1; không tăng size hoặc đổi phí cho đẹp kết quả trong package đã xong. Chưa runtime change.

# Có lợi nhuận Futures cao công khai; chuyển sang học cơ chế và kiểm tài khoản

Cập nhật 13/10/2026, khoảng 22:08–22:20 ICT. **Có người công khai đạt các cửa sổ lợi nhuận cao hơn nhiều so với những cấu hình vừa thử.** Vì vậy không có căn cứ kết luận “trên internet chưa ai làm được” hoặc mục tiêu của người dùng bất khả thi. Các nguồn dưới đây cho đầu mối nghiên cứu cụ thể. Chưa nguồn nào ở lượt này chứng minh đồng thời vốn Futures 100 USDT, ngân sách cố định 10 USDT mỗi ngày ICT và kỳ vọng bền vững khoảng 1 USDT ròng mỗi ngày lịch.

Yêu cầu vẫn chỉ là 100u ban đầu, ngân sách chung 10u/ngày, không cap số lệnh, chấp nhận ngày âm/dương và mean khoảng 1u/ngày. Không phục hồi ICT/SMC, BTC-only, cooldown, exposure 100u, SL floor hoặc caps giao dịch cũ. Sẵn sàng nghiên cứu đòn bẩy, altcoin, long/short, grid và averaging; không cần xin lại quyền đã có.

## Ví nhỏ có đối soát equity và dòng tiền

[Ví Hyperliquid 0x7dea…6d03](https://app.hyperliquid.xyz/explorer/address/0x7dea599d27f929ebe5f5b3c1bd0ea832e6a46d03) được lấy trực tiếp qua public API, không dùng số ROI leaderboard để suy ra lãi tài khoản. Cửa sổ 12/09/2026 22:26 UTC → 13/10/2026 15:08 UTC dài **30,69588 ngày**:

| Phép đo | Kết quả USDC |
|---|---:|
| Tổng equity đầu / cuối | 65,487578 / 470,296998 |
| Nạp/rút trong non-funding ledger trả về của cửa sổ | 0 |
| Equity tăng sau điều chỉnh dòng tiền | +404,809420 |
| PnL toàn ví do portfolio API báo | +404,809420 |
| PnL perpetual do portfolio API báo | +405,973891 |

Equity tăng khớp PnL ở toàn bộ 48 cặp mẫu; kiểm độc lập xác nhận. **MDD tổng equity quan sát lên tới 76,47%**: cửa sổ thắng có rủi ro lớn, không phải mô hình lãi đều. Đây là lãi theo định giá tài khoản, có thể gồm PnL vị thế mở. Không gọi tất cả là tiền lời đã chốt. USDC và sàn Hyperliquid cũng khác tài khoản Binance USDT dự kiến. MDD này là thông tin để học sizing/exit, không áp lại cap drawdown cũ của người dùng.

138 fills trong cửa sổ thuộc TIA, ZEC, HYPE, MELANIA, ENA, APT, NEAR, có cả mở/đóng long và short. API trả 2.000 fills gần nhất; fill cũ nhất ở tháng 05/2025, trước cửa sổ này, nên cap chưa cắt cửa sổ theo timestamp. Chưa đối soát độc lập toàn bộ funding và giá trị vị thế mở. Perp equity/PnL có residual −14,07 USDC, không gán toàn bộ thành một dòng chuyển nội bộ đã xác minh. Không biết entry/exit chủ ý của chủ ví; **alt long/short là hành vi quan sát, không chứng minh momentum hay grid là nguyên nhân lợi nhuận**.

[Ví 0x83c4…afe5](https://app.hyperliquid.xyz/explorer/address/0x83c4c5a492d77e22120ba90bdaad00739788afe5) cũng được cập nhật: tổng equity 627,707574 → 1.699,164567; có nạp 391,71; lãi điều chỉnh dòng tiền **679,746993 USDC** trong 30,70276 ngày. Không tính khoản nạp thành lãi. Cả hai là ví thắng được chọn để học, không phải thống kê tỷ lệ người thành công. Mẫu portfolio tháng không xác nhận giới hạn lỗ 10u từ nửa đêm ICT.

Số liệu tái lập: [calculation](../audits/futures-quick-win/external-high-return-20261013T150439Z/root/live-calculation.json), [raw API receipts](../audits/futures-quick-win/external-high-return-20261013T150439Z/live/receipt.json), [kiểm độc lập](../audits/futures-quick-win/external-high-return-20261013T150439Z/evidence-audit/addendum.md). Các snapshot leaderboard và portfolio có thời điểm/bounds khác nhau; không trộn ROI và PnL của chúng thành một phép đo.

## Binance có hồ sơ API/grid lợi nhuận rất cao

[乾坤策略量化, tab 30D](https://www.binance.com/uk-UA/copy-trading/lead-details/5229164046792448257?timeRange=30D) trong snapshot kiểm độc lập báo **ROI +3.876,34%, PnL +19.381,73 USDT**, lịch sử **26 ngày**, MDD 5,67%, API và leverage 10–20x. Tác giả tự mô tả EMA/MACD, grid hai chiều BTC/ETH/BNB. Chưa có config hoặc ledger để tái lập lời mô tả này; không xác nhận lời quảng cáo “rủi ro thấp, thu nhập ổn định”. Có 18 danh mục đóng nhưng chưa biết kết quả của chúng.

Theo [FAQ chính thức Binance](https://www.binance.com/en/support/faq/detail/54aa6d3b43bc4f6eb4a3a6e3aea40acd), ROI dùng PnL/MaxBaseBalance. Cặp số trên suy ra mẫu số khoảng 500 USDT; margin snapshot là 8.581,94, mức copy tối thiểu 500. MDD không phải ngân sách tiền tuyệt đối 10u/ngày. Tab 30D không biến lịch sử 26 ngày thành đủ tháng. Không dùng headline làm ROI dự kiến của tài khoản 100u.

Root còn đọc [Lemma](https://www.binance.com/en-IA/copy-trading/lead-details/5194385911194262785?timeRange=30D): snapshot **+57,87%/30D**, PnL +12.045,70, MDD 6,38%, lịch sử 51 ngày, có nhãn high leverage và TradFi. Chưa đọc độc lập được lần thứ hai, không gọi là nguồn crypto thuần hoặc đã xác nhận toàn bộ. Snapshot khác locale/thời điểm cho số khác; giữ riêng receipts, không ghép thành lịch sử.

## Hai cơ chế có source để học

[Perp Quant Lab](https://github.com/AbdullaE100/perp-quant-lab/blob/104dc669084b7f0d0a99748a0f4300950b49930d/research/backtest3.py) có momentum 14 ngày chia volatility 30 ngày, inputs trễ một ngày, long/short theo ranking, gross weight 2 và phí turnover 5 bps. Fixture tác giả có tháng +34,64%; toàn kỳ giả vốn đầu 100u chỉ khoảng 0,268u/ngày, bỏ funding/slippage và daily governor. Đáng học cách xếp hạng, inventory và giảm turnover; chưa đạt mục tiêu của ta.

[HFTBacktest Order Book Imbalance](https://hftbacktest.readthedocs.io/en/latest/tutorials/Market%20Making%20with%20Alpha%20-%20Order%20Book%20Imbalance.html) báo backtest +34,24% gần một tháng nhưng book 2,5 triệu USD và maker rebate. Học inventory skew và alpha điều chỉnh giá đặt lệnh. Phép tính lại chi phí cho thấy rebate là yếu tố lớn; không đưa headline này vào kế hoạch vốn 100u với fee retail. HFT đứng sau grid chậm vì cần orderbook, queue và latency. [Notes/code/fee arithmetic](../audits/futures-quick-win/external-high-return-20261013T150439Z/methods/report.md).

## Thay đổi ưu tiên nghiên cứu

Các phép thử nhỏ trước chưa sử dụng đầy đủ mức rủi ro được phép. Một seed EMA-anchor SOL hoặc daily spillover giữ đủ 24h âm không loại cả grid, alt long/short hay account sizing khác. Chưa có phép thử mới chứng minh lợi nhuận chỉ nhờ nâng leverage.

Ưu tiên mới: **ứng viên momentum/volatility tập trung, giữ inventory để giảm phí**, sau đó **ứng viên grid chậm có regime EMA/MACD và quản lý inventory**. Nguồn code và quan sát ví là căn cứ tạo hypothesis, không gọi thiết kế mới là bản sao của trader thắng. Dùng shared wallet/governor đã chuẩn bị để thử exposure và đòn bẩy lớn hơn, tính toàn bộ fee/funding/MTM vào ngân sách chung 10u. Peer stop/sizing giữ là nhánh so sánh thứ cấp, không còn là hướng kế tiếp duy nhất.

Xem [kế hoạch và đầu ra 14–15/10](../plan/2026-10-13-futures-aggressive-candidates.md). Lượt này hoàn tất điều tra nguồn, đối soát và cập nhật lộ trình; **account replay mới chưa chạy**, chưa thay bot đang vận hành. Mục tiêu kinh tế toàn hệ thống chưa được xác nhận.
