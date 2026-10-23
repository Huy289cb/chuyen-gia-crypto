# Đánh giá kết quả live và ưu tiên cải thiện — 18/10/2026

Đối soát sàn lúc **18:39:51 ICT**; vốn đầu **31.47744546 USDT**. Lượt này chỉ đọc dữ liệu và cập nhật đánh giá/lộ trình, không restart, đổi rule hoặc tạo lệnh. Bản vá gần nhất: [nghiệm thu18:30](2026-10-18-futures-live-hardening.md).

## Kết quả tiền thật

| Chỉ tiêu | USDT |
| --- | ---: |
| Equity hiện tại | 31.52118001 |
| PnL toàn kỳ, gồm thả nổi | **+0.04373455** |
| PnL hôm nay so với mốc ngày | +0.2353532 |
| Tiền mặt sau realized/phí/funding | 31.15669644 |
| PnL tiền mặt so với vốn đầu | -0.32074902 |
| Thả nổi hiện tại | +0.36448357 |
| Realized trước phí/funding | -0.11601 |
| Phí đã trả | −0.20139548 |
| Funding đã trả | -0.00334354 |

Cash, fees, realized, funding, danh sách fill, vị thế và intent đều khớp dữ liệu sàn; không lệnh chờ, chênh lệch đối soát0. Bốn long BNB0,04/ETH0,009/SOL0,16/XRP10,4, tổng notional **80.805474u**, khoảng **2.564 lần equity**. Mốc ngày31,28582681u và trần15u vẫn giữ nguyên.

Chỉ xét giá mark hiện tại, phí đóng bốn vị thế ước **0.040403u**; PnL tổng sau phí đóng còn **0.003332u**. Thêm trượt giá bất lợi2bps theo cấu hình hiện hành cho ước tính **-0.012821u**. Đây là mô hình từ mark, chưa có spread/quote đặt lệnh và không phải báo giá có thể khớp; không có lệnh đóng được gửi. Vì vậy mức dương nhỏ chưa được bảo toàn.

## Phân rã từng rổ

| Rổ | Trạng thái | Net sau chi phí đã ghi nhận |
| --- | --- | ---: |
| 17/10, mở07:00; đóng08:24 vì monitoring gap | Đã đóng | −0,19161865u |
| 18/10, mở07:00; đóng07:38 vì monitoring gap | Đã đóng | −0,08556635u |
| Phục hồi18/10 khoảng12:50 | Đang giữ | +0.32091955u, gồm phí mở/funding, chưa phí đóng |

Hai rổ đã đóng tổng **−0,277185u**. Phí riêng của chúng là0,08081865u và0,08035635u. Phí đóng rổ sáng nay cộng mở lại là **0,08039735u**; đây là chi phí quanh hai lần thay inventory, không được cộng thẳng thành lợi nhuận giả định nếu không đóng vì đường giá khi tiếp tục giữ có thể khác.

22fills tương ứng20lệnh, chỉ **hai rổ hoàn tất và một rổ đang mở**; không phải22phép thử chiến lược độc lập. XRP có một lệnh khớp ba phần, không có bằng chứng gửi trùng lệnh. Rổ hiện tại đều long; lãi đang mở phù hợp với giá các coin tăng so với entry, chưa chứng minh được lợi thế vượt rổ long thụ động cùng trọng số/chi phí.

## So với mục tiêu trung bình

Từ 22:26:01ICT16/10 tới snapshot là **44.231giờ**, tức1.8429ngày. Net chia thời gian đã trôi qua tương đương **0.023731u/ngày**, khoảng **0.0754% vốn đầu/ngày**; đây là phép quy đổi tại snapshot gồm PnL chưa chốt, không phải kỳ vọng đã kiểm chứng.

Nếu đếm cả ba ngày lịch đã chạm16/17/18 (ngày đầu/ngày cuối chưa đủ24giờ), phép chia là **0.014578u/ngàylịch**. Chỉ17/10 là ngày đầy đủ đã kết thúc; giữ cả kết quả âm.

Với vốn31,47744546u, mục tiêu0,2% tương đương **0.062955u/ngày**. Nếu giữ mục tiêu tuyệt đối0,2u/ngày thì tương đương **0.6354%/ngày**. Snapshot hiện chưa đạt cả hai. Không lấy hôm nay dương để thay phép chia toàn kỳ, cũng không loại phương pháp chỉ vì có ngày âm.

## Đánh giá vận hành

60mẫu từ **18:36:37–18:38:36ICT**: toàn bộ active; gap median2005.0ms/max2512ms, tickmax975ms; không blocked, backgrounderror, risklatch hoặc quote chưa sẵn sàng; cash luôn đối soát0, fills/intents không đổi. Log không có watchdog/transition mới kể từ bản18:30; Telegram76ACK, pending0/failed0, đủ22tin trade. Hai cảnh báo lúc restart là dừng tiến trình và chờ mark BTC đầu tiên; sau đó không có cảnh báo mới trong cửa sổ kiểm tra. Không có bằng chứng bug giao dịch mới ở lần kiểm tra này.

Rổ vẫn được giữ từ12:50, không có lần đóng kỹ thuật mới trong journal. Bản worker18:30 mới được quan sát vài phút; chưa qua báo cáo21:00, rollover00:00 hay nguồn07:00 kế tiếp. Không suy cửa sổ ngắn thành chứng nhận uptime24/24.

## Ưu tiên cải thiện có căn cứ

| Ưu tiên | Việc làm cụ thể | Phạm vi/điều kiện nghiệm thu |
| --- | --- | --- |
| 1. Đo đầy đủ đường vốn và chi phí | Ghi checkpoint equity/net/cash/funding/vị thế và reference trước lệnh theo phút; báo cáo tách hai rổ đóng với rổ mở, tiền đã ghi nhận với thả nổi, và ước tính chi phí thoát. | Không đổi trading rule; ghi nhẹ, có retention, không đặt công việc nặng vào vòng2giây. Kiểm tra được mean/MFE/MAE/slippage và nguồn mất lợi nhuận; wallet hiện chỉ lưu worst ngày và quan sát mới nhất. |
| 2. Kiểm chứng đúng vốn thực | Đăng ký một đối chiếu replay cùng engine/source: vốn31,47744546u, trần15u/soft−8,9/buffer6,1, filters/lô tối thiểu/phí thật, một ví liên tục; báo riêng tác động đường phục hồi kỹ thuật so với backtest nguồn. | Không dùng kết quả vốn100u làm kết quả31u; không reset ví giữa các đoạn, không loại ngày âm. Chốt baseline đúng cấu hình trước khi tìm thêm tín hiệu. Chưa khởi chạy replay trong lượt đánh giá này. |
| 3. Giảm phí vào/cân đối rổ | Nghiên cứu riêng entry maker/post-only có hạn chờ, thay vì tất cả đều taker. Mọi fill hiện đều taker; rates xác thực: maker0,02%/taker0,05%. | Nếu giả định cả rổ entry80,44099u khớp maker cùng giá, tiết kiệm khoảng **0.024132u/lần**. Đây là trần minh họa chưa tính không khớp/adverse selection. Phải thử partial fill/timeout/cancel/giới hạn60giây; thoát rủi ro vẫn cần thực hiện ngay. Chưa thay execution/rule live. |
| 4. Đo hiệu quả giữ lãi trước khi sửa exit | Từ đường vốn và replay, so baseline với một cơ chế chốt/giữ lãi đã đăng ký; dùng cùng phí/funding và có cả xu hướng lẫn đi ngang. | Không chọn TP/trailing từ đúng đoạn giá vừa nhìn. Hiện thiếu đường equity đủ dài và chỉ có hai rổ đóng do kỹ thuật nên chưa có căn cứ chọn ngưỡng hoặc tăng size. |

Phí phụ thuộc notional và cơ chế maker/taker, còn funding phụ thuộc vị thế đang giữ và rate/kỳ thanh toán; đã đối chiếu [hướng dẫn phí chính thức Binance](https://www.binance.com/en-PH/support/faq/detail/98488a516eb84e3eb34605683dffd554) và [funding chính thức](https://www.binance.com/en/support/faq/detail/360033525031). Funding đã trả0,00334354u nhỏ hơn nhiều phí0,20139548u ở mẫu hiện tại; chưa phải nút thắt đầu tiên.

Giữ cấu hình live hiện tại. Ưu tiên đề xuất: **đo chi phí/đường vốn → baseline đúng31u → kiểm thử entry tiết kiệm phí**. Đây là lộ trình nghiên cứu có giới hạn, không phải xác nhận lợi nhuận hay tự cho phép đổi rule. [Bằng chứng](../audits/futures-quick-win/live-results-review-20261018/README.md).
