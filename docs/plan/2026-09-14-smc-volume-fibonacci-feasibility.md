# Khả năng áp dụng H4/H1 → M15, Volume Profile, SMC và Fibonacci

Ngày 14/09/2026. Đây là đánh giá thiết kế và điều kiện nghiên cứu, không phải chiến lược đã đạt ROI+ hay yêu cầu đổi runtime sang M15-only.

## Kết luận

Khả thi để xây hệ thống phân tích có bằng chứng và bảng quản lý vị thế. Chưa có bằng chứng rằng thêm tất cả yếu tố cùng lúc sẽ tăng tần suất lệnh hoặc ROI. Nếu bắt buộc H4/H1, volume, OB, FVG, EQH/EQL và Fibonacci đều đồng thuận, số setup có thể giảm thêm. Dùng cấu trúc để xác định bối cảnh; mỗi kịch bản có một trigger rõ; các vùng còn lại là bằng chứng hoặc lý do phủ quyết được đo riêng.

## Khoảng cách với code hiện tại

| Thành phần | Hiện trạng đã đọc | Hướng phát triển |
|---|---|---|
| H4 structure, H1 direction | Đã có classifyStructureBias và HTF guards; pivot cần nến bên phải xác nhận | Theo dõi thời điểm pivot, confirmation, invalidation; không tự biến direction=null thành hướng giao dịch |
| M15 entry | Scheduler có ưu tiên M15 nhưng còn 1h/5m; không phải M15-only | M15-only là biến thể phải so sánh riêng, không tự đổi cấu hình hiện tại |
| Price action/volume | Có breakout-volume, sweep, stateful retest | Đo volume impulse và retest riêng, so sánh với cửa sổ chỉ gồm nến trước tín hiệu |
| Volume Profile | Chưa tìm thấy bộ tính POC/VAH/VAL/HVN/LVN trong backend/src | Cần dữ liệu volume theo giá và cửa sổ/bin cố định; aggregate volume M15 không phải volume-at-price |
| Liquidity | Đã có sweep và swing bounds | Phân biệt vùng suy ra từ giá với thanh khoản quan sát trong order book; không tuyên bố biết vị trí stop thực |
| OB/FVG/EQH/EQL/CHoCH | Được nhắc trong prompt/formatter; chưa thấy detector đầy đủ và lifecycle tương ứng trong V3 | Detector deterministic, zone ID, born/confirmed/mitigated/invalidated timestamps, bằng chứng nến |
| Fibonacci | Có utils/fibonacci.ts và analyzerFactory; chưa thấy tích hợp bộ tính đó trong groq-dispatch V3 | Khóa anchor và hướng bằng cấu trúc đã xác nhận; kiểm thử riêng trước dùng làm điều kiện lệnh |
| Xác suất thành công | Confidence của LLM chưa phải xác suất hiệu chuẩn | probability=null khi chưa có mẫu OOS đủ; hiển thị sample size và khoảng tin cậy khi có |
| Quản lý vị thế | Đã có pending/fill/protection/PnL và các guard | Báo cáo chỉ lấy fill/quantity/SL/TP thật; đề xuất hành động tách khỏi quyền thực thi |

Lưu ý Fibonacci: utility chọn cực trị trong cửa sổ nhưng không bắt buộc đủ nến xác nhận bên phải cho mọi pivot. Extension đang tính `swingHigh + range × ratio` cho up, thiếu anchor C; không nên mặc định coi nhãn 1,272/1,618 này tương đương trend-based extension ba điểm. `getOhlcvCandles(symbol,30,'15m')` là **30 giờ**, không phải giới hạn 30 nến. Không kết luận thiếu warmup chỉ từ số 30 ở caller.

## Hợp đồng dữ liệu nên có trước khi thêm trigger

- Mỗi zone: `zone_id, type, side, timeframe, lower, upper, anchor_bar_ids, confirmed_at, invalidated_at, status, source, policy_hash`.
- OB: phải chốt định nghĩa nến gốc, impulse/displacement, BOS xác nhận, phạm vi body hay wick, tiêu chí mitigation và invalidation. Nhãn OB là quy tắc hình học; OHLCV không chứng minh đó là lệnh tổ chức.
- FVG: đề xuất nghiên cứu mô hình ba nến; bullish khi low nến thứ ba > high nến thứ nhất, bearish đối xứng. Chỉ biết vùng sau khi nến thứ ba đóng; chốt ngưỡng kích thước, partial/full fill và thời hạn trước khi đánh giá.
- EQH/EQL: ít nhất hai swing đã xác nhận, khoảng cách giá nằm trong dung sai tick/ATR đã đóng băng, có khoảng cách thời gian tối thiểu. Ghi trạng thái swept/unswept; không gọi đó là số lượng stop đã biết.
- CHoCH/BOS: close vượt swing tham chiếu đã được biết trước; quy tắc body/wick và buffer cố định. CHoCH là tín hiệu mất hiệu lực cấu trúc cũ, chưa phải giấy phép đảo vị thế.
- Fibonacci retracement: với impulse up A→B, `B−r(B−A)`; down đối xứng. Trend-based extension: khai báo đủ A/B/C, `C+r(B−A)` theo hướng impulse. C phải đã được xác nhận; không chọn lại swing đẹp hơn sau khi biết outcome.
- Volume Profile: chọn một nguồn BTCUSDT futures nhất quán, một cửa sổ kết thúc trước quyết định và bin/tick cố định. Ưu tiên aggregate trades price/quantity với kiểm tra phân trang, trùng và thiếu dữ liệu. Nếu phân bổ volume nến 1m theo khoảng giá thì phải ghi **ước lượng**, không coi đó là volume giao dịch thực tại từng mức.

## Luồng phân tích đề xuất

1. H4: structure và mức mất hiệu lực; H1: hướng/pha thị trường, bao gồm trạng thái không rõ hoặc chuyển tiếp.
2. M15: chọn **một** nhánh đã đăng ký, ví dụ breakout → retest có xác nhận, hoặc sweep → reclaim. Đánh giá từng nhánh độc lập trước khi ghép danh mục.
3. Khi breakout/retest xuất hiện, báo rõ boundary có trùng mép value area, OB/FVG hay EQH/EQL không; vùng được biết từ khi nào, đã bị xuyên/lấp chưa. Không cộng ba nhãn của cùng một vùng thành ba bằng chứng độc lập.
4. Fibonacci dùng mô tả vị trí hồi; TP extension chỉ là mục tiêu tham khảo. Target cấu trúc gần nhất, SL bảo vệ invalidation và RR vẫn quyết định tính khả thi. Không kéo TP xuyên cản chỉ để có RR3.
5. Lập plan và kiểm tra lot, exposure, stop, RR, phí/slippage, funding, ngân sách ngày. Chỉ plan hợp lệ mới vào lane AI chọn/veto. Báo cáo `missing_data` nếu không tính được zone/profile.
6. Nếu không có plan hợp lệ: WAIT với lý do cụ thể, không dựng entry và xác suất thành công cho đủ mẫu trình bày.

Core SL floor0,8% và RR3 vẫn đòi khoảng TP tối thiểu2,4% trước chi phí. Thêm Fibonacci/SMC không tự giải quyết hạn chế hình học đó. Nhánh range RR1,5 phải được ghi nhãn và đánh giá riêng, không trộn với core.

## Bảng vị thế và hành động

Đối soát trực tiếp Binance lúc **15:28:53 ICT ngày 14/09/2026**: equity33,59964603USDT, unrealized PnL0, không có vị thế/order/algo order. Snapshot: ../audits/2026-09-14-development-review/exchange-framework-review.json.

| Trường | Khi đang flat như snapshot này | Khi có vị thế |
|---|---|---|
| Entry, SL, TP | Không áp dụng | Giá fill và protection thật, không dùng suggested levels thay cho lệnh sàn |
| Lãi/lỗ tạm tính | 0 USDT; tỷ suất vị thế không áp dụng | Mark-to-market theo quantity; ghi timestamp và nguồn mark |
| SL: lỗ bao nhiêu USD | Không áp dụng | Lỗ từ entry tới SL + phí/funding/reserve; không nhầm với rủi ro còn lại từ mark tới SL |
| TP: lời bao nhiêu USD | Không áp dụng | Gross theo fill/quantity, trừ chi phí đã biết và ước lượng còn lại; unknown hiển thị riêng |
| Giữ/thoát/dời SL | Không có lệnh để xử lý | Nêu trigger giữ/thoát, evidence và mức mất hiệu lực; không tự nới SL làm tăng risk |
| Scale-in/chốt từng phần | Chưa áp dụng | Chạy lại lot/minNotional/step cho phần thêm/đóng và phần còn lại; ghi risk tổng sau thao tác |
| Kịch bản đảo chiều | Chỉ lập khi có setup đủ dữ liệu | Vị thế cũ và lệnh bảo vệ phải được đối soát; không flip chỉ vì CHoCH hoặc đề xuất AI |

PnL% phải ghi mẫu số: notional entry, equity hay margin. Không dùng ROE theo leverage thay ROI tài khoản. Với lượng BTC tối thiểu, chốt50% có thể không đủ step/minQty; khi đó ghi thao tác không khả thi, không quảng cáo quản lý từng phần như luôn thực hiện được.

Mẫu output khi có dữ liệu: `H4/H1 bias | M15 setup | OB/FVG/EQH/EQL (có/không đủ dữ liệu) | Fib anchors/zone | Volume/Profile | Entry | SL/net loss USD | TP/net gain USD | unrealized USD/% + denominator | action + trigger | probability + sample/CI`. Đề cập OB/FVG/EQH/EQL khi phát hiện, kèm vùng giá và trạng thái; không điền giá giả khi detector/dữ liệu chưa có.

## Thử nghiệm có kiểm soát

Hoàn tất measurement/parity trước. Sau đó so baseline với **một bổ sung mỗi vòng**: ví dụ retest gắn vùng profile, rồi Fibonacci, rồi một trigger SMC được định nghĩa; chỉ chọn vòng mới nếu có chẩn đoán hỗ trợ. Không bắt đầu hàng loạt phép thử để chọn kết quả đẹp nhất.

Mỗi vòng phải có protocol/source freeze, kỳ dữ liệu chưa dùng, portfolio replay có fill và mọi chi phí, ROI base/stress>0, delta netPnL>0, expectancy của lệnh bổ sung>0, đủ mẫu/CI điều chỉnh thử nhiều giả thuyết và parity. Trường hợp không tăng tần suất nhưng giảm lệnh xấu phải báo đúng mục tiêu đó, không gọi là tăng cơ hội. Không có bằng chứng đạt gate thì không bật live.

## Nguồn kỹ thuật

- TradingView: Volume Profile tính hoạt động theo mức giá, dùng dữ liệu khung thấp hơn; nguồn này mô tả công cụ, không chứng minh chiến lược có edge: https://www.tradingview.com/support/solutions/43000502040-volume-profile-indicators-basic-concepts/
- TradingView: trend-based Fibonacci extension dùng ba điểm, gồm impulse và mức retracement: https://www.tradingview.com/support/solutions/43000612397-auto-fib-extension/
- Binance USDⓈ-M aggregate trades: dữ liệu price/quantity cho thiết kế profile; không suy ra order book/stop inventory từ đó: https://developers.binance.com/docs/derivatives/usds-margined-futures/market-data/rest-api/Compressed-Aggregate-Trades-List

Các định nghĩa OB/FVG/EQH/EQL ở trên là đề xuất chuẩn hóa thuật toán để kiểm thử, không phải một tiêu chuẩn duy nhất hay bằng chứng về xác suất thắng.


Cập nhật 15/09/2026: người dùng ưu tiên ROI+ sau chi phí, không bắt buộc RR3. Xem `docs/plan/2026-09-15-ict-net-expectancy.md`; các mô tả RR3 ở trên là baseline lịch sử, không phải cổng bắt buộc cho biến thể mới.
