# Kết quả thực thi — xác nhận14/10/2026

[Hai V1 đã chạy](../audits/futures-quick-win/method-trials-20261013T152454Z/report.md): protocol155 inputs trước PnL, một prefix24h và bốn main cases92ngày. A net base/stress−65,576904/−80,025678u; B−0,439908/−5,102860u. Bốn money audits độc lập PASS, không breach10u trong mô hình; mean1u chưa đạt. Main hoàn tất13/10 22:55ICT, trước mốc14–15/10 đề xuất. NO_GO_CURRENT_CONFIGURATIONS; không sweep/rerun hoặc promote V1. Scope khác danh mục nguồn40coin/config kín của trader được nêu trong report.

Kế tiếp [source-transfer feasibility](2026-10-14-futures-source-transfer-feasibility.md), PLANNED_NOT_RUN. Yêu cầu100u/10u chung cố địnhICT/không cap lệnh/âm-dương/mean khoảng1u không đổi. Thiết kế/timeline NOT_RUN bên dưới giữ như snapshot trước PnL. Chưa scheduler/toolgoal/live change.

# Ứng viên Futures mạo hiểm có căn cứ — kế hoạch 14–15/10/2026

**RESEARCH_PRIORITY_UPDATED; FINANCIAL_NOT_REGISTERED_NOT_RUN.** Đây là bước tiếp theo của nghiên cứu được người dùng yêu cầu, không tạo goal công cụ hoặc scheduler. [Bằng chứng mới](../research/2026-10-13-futures-high-return-evidence.md) xác nhận các cửa sổ lợi nhuận cao công khai. Cần học cơ chế, không đòi tìm một trader đã khớp toàn bộ rule của ta mới được thử.

Chỉ giữ vốn đầu 100 USDT, ngân sách chung cố định 10 USDT/ngày ICT, không cap số lệnh, ngày âm/dương và kỳ vọng khoảng 1u ròng/ngày lịch. Exposure, leverage, tần suất và entry/exit được thiết kế lại. Các con số nghiên cứu không trở thành rule người dùng.

## Hai hypothesis và thứ tự làm

| Ưu tiên | Cơ chế / căn cứ | Khác phép thử đã thất bại | Đầu ra trước PnL |
|---|---|---|---|
| A | Momentum 14 ngày / volatility 30 ngày, long/short tập trung; [source tác giả](https://github.com/AbdullaE100/perp-quant-lab/blob/104dc669084b7f0d0a99748a0f4300950b49930d/research/backtest3.py) | Ranking dài hơn, inventory liên tục và chỉ trade chênh lệch; khác ridge peers đóng/mở cả rổ mỗi ngày | Định nghĩa lag/weight, số vị thế, ticket eligibility, turnover, stop/sizing và một config trước return |
| B | Grid chậm có regime EMA/MACD, inventory/trailing exit; Binance author description + Passivbot source | Hai hướng, nhiều symbol, inventory/risk khác seed SOL QW1; chưa có bằng chứng hybrid sẽ thắng | Công thức regime, giá/grid spacing, tăng/giảm inventory, exit và fill specification; không giả đây là config của trader |
| Thứ cấp | Peer forecasts + account stop/sizing | Hypothesis stop thay daily-hold âm | Chỉ thực hiện khi A/B có terminal hoặc feasibility chặn; prototype giữ nguyên |

Bắt đầu với A vì có công thức source rõ; B không được vội ghép nhiều tín hiệu rồi gán cơ chế thắng. Mỗi hypothesis tối đa một V1 base/stress trước khi quyết định sửa thiết kế trong package khác. Không sweep cho tới khi có số đẹp; không dùng hiệu suất ví để chọn symbol thắng hồi cứu.

## Shared account và mức mạo hiểm cần đo

Tái dùng [prototype đã kiểm](../audits/futures-quick-win/peer-risk-20261013T142339Z/report.md) bằng derivative có version; giữ nguyên source/tests/receipts frozen. Wallet vẫn một cash ledger, toàn bộ MTM, fees và funding; không tạo 100u cho mỗi strategy hoặc nhiều ngân sách 10u.

Đề xuất V1 dùng leverage margin **tối đa 20x**, planned close loss **8u** và buffer **2u**; tính gross size từ ngân sách còn lại, adverse move và chi phí đóng thực tế, rồi hạn chế theo margin/ticket. 20x là trần thí nghiệm margin, không chỉ thị luôn dùng gross 2.000u. Không cap rủi ro mỗi lệnh theo rule cũ. Hai tham số 8/2 vẫn phải được khóa trong protocol, không coi stop mô phỏng là bảo đảm lỗ tối đa khi gap/slippage. Nếu breach 10u, giữ kết quả và ghi rõ vi phạm.

Phải kiểm mark intraday, margin/liquidation và projected taker close. Ngày anchor 00:00 ICT; dừng mở lại khi ngân sách ngày hết. Chấp nhận giữ tiền hoặc ngày âm. Close loss không được tăng bằng cách reset anchor lúc restart hay chuyển rủi ro sang wallet khác.

Với A, fee reservation dùng trường hợp taker; actual settled funding và base/stress slip. Với B, limit fill phải có latency, không tự khớp khi OHLC chỉ chạm giá; missed/partial fills và protective taker close cần được mô hình hóa. Không dựa vào maker rebate chưa được xác nhận cho tài khoản này.

## Inputs, tính khả thi và đánh giá

Có 927.360 phút trade/mark, funding và training causal của bảy symbol ADA/BNB/BTC/DOGE/ETH/SOL/XRP trong package cũ. Dùng chúng làm universe phát triển ban đầu, công khai survivor bias. TIA/ZEC/HYPE trong ví chỉ là đầu mối, không tự thêm vì biết trước tháng thắng. Mở rộng alt cần kiểm contract history, lot/minimum, volume/volatility đã biết tại lúc quyết định và dữ liệu đủ; thiếu dữ liệu ghi INCOMPLETE, không forward fill.

Đăng ký source/config/input hashes, thứ tự event, known-at, rounding, margin, funding, stop và restart **trước khi xem PnL**. Jul–Sep/2026 là development đã được nghiên cứu, không gọi là holdout. Mean = tổng net USDT / đủ 92 ngày lịch, kể cả cash; báo riêng số ngày âm/dương, worst ICT day, breaches, drawdown và margin events. Không đổi sang CAGR/365 hoặc 1% của NAV đang tăng.

Net base/stress và rủi ro báo riêng; CI chứa zero không tự cấm nghiên cứu. Một ứng viên dương vẫn chưa xác nhận kỳ vọng bền vững. Chỉ sau development mới khóa validation riêng; đề xuất 01–12/10/2026 nếu chưa dùng để chọn nhánh/params, và paper prospective khi phù hợp. Không triển khai live chỉ từ tháng thắng.

## Mốc và cutoff

- **13/10:** hoàn tất receipt nguồn, đối soát ví nhỏ và ưu tiên A/B. Không có account PnL mới.
- **14/10:** workbox tối đa 4 giờ chủ động ghép account runner/auditor với A, chốt registration và prefix 24 giờ đo bộ nhớ/tốc độ. Host RAM khoảng 956 MiB, stream inputs. Đầu ra là READY hoặc INCOMPLETE có thiếu sót cụ thể; được làm sớm khi sẵn sàng.
- **15/10:** nếu đã registered, một main base và một stress, tối đa 60 phút/case; audit terminal, ghi mean1u và ngân sách10u riêng. Không kéo dài run vì số nhỏ. Sau terminal A mới chốt B; không hứa B cũng xong cùng ngày khi fill model chưa đủ.

Các mốc là kế hoạch làm việc, không tác vụ tự chạy. Tài liệu này thay ưu tiên peer replay trong header trước; phần engineering peer còn có ích, không cần làm lại. Chưa private API, orders, transfers, paid LLM hoặc runtime deployment.
