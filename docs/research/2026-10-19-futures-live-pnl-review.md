# Review PnL thật và hướng cải thiện — 19/10/2026

**Cập nhật xác minh độc lập với sàn00:44:01 ICT:** tiền29,85075623u, tổng vốn29,89018109u, lãi/lỗ đang mở+0,03942486u, PnL toàn kỳ **−1,58726437u (khoảng−5,04%)**. Phí0,56767006u, chênh giá đã chốt−1,05705002u và funding−0,00196915u không đổi.65khớp/63intents/4vị thế đều khớp sổ, không có lệnh thường hoặc algo đang chờ; mọiintent đối soát đủ. Tổng vốn gồm lệnh mở, chưa trừ phí đóng giả định. So với mốc00:33 bên dưới, thay đổi vốn là biến động giá của cùng vị thế, không phải lãi đã chốt hoặc một phương pháp mới. Evidence `authenticated-current.json` có9checks PASS.

Mốc sổ dùng phân tích các rổ: **00:33:18 ICT ngày19/10**. Đây là snapshot sổ live được worker đánh dấu `reconciled`, kiểm tra lại bằng Decimal; chưa có GET độc lập đúng thời điểm đó. Lần GET độc lập00:44 được ghi riêng ở trên. Không đặt lệnh thử, sửa chiến lược, nâng size, nới guard hoặc reset ví để tạo kết quả đẹp hơn. Bản Telegram đã hoàn tất riêng theo biên bản triển khai.

## Kết quả tiền thật

|Khoản|USDT|
|---|---:|
|Vốn cấp ban đầu|31,47744546|
|Tiền đã ghi nhận|29,85075623|
|Tổng vốn gồm vị thế đang mở|29,84427623|
|PnL toàn kỳ|**−1,63316923 (−5,1884%)**|
|Chênh giá đã chốt|−1,05705002|
|Phí giao dịch|−0,56767006|
|Funding|−0,00196915|
|Chênh giá vị thế đang mở|−0,00648000|

Đối chiếu chính xác: vốn đầu + chênh giá đã chốt − phí + funding + chênh giá đang mở = tổng vốn; cashflow0, chênh lệch chưa giải thích0. Snapshot active, 65 khớp thuộc56 lệnh đã khớp; 63 intents gồm7 từ chối. Còn4 vị thế mua BNB/ETH/SOL/XRP, BTC không đặt được trong các rổ mẫu này. 65 khớp không phải65 thử nghiệm chiến lược độc lập.

Đã có7 lượt từ không giữ vị thế → mở → đóng hết và1 lượt đang mở. Chỉ2 nguồn ngày ban đầu, các lượt phục hồi phụ thuộc cùng nguồn ngày18/10. Mẫu dưới3ngày không đủ ước lượng lợi nhuận trung bình dài hạn. PnL ngày19 tới mốc này −0,02710223u, khác PnL toàn kỳ. Mốc ngày được quan sát ở các tick giá liền kề; chênh nhỏ0,00024766u giữa tổng các ngày lưu và hiệu anchor không được thay thế phép đối chiếu tiền toàn kỳ.

## Hai vấn đề cần tách rõ

**Phí do đóng/mở dồn dập có thật.** Từ23:35 ngày18 đến00:29 ngày19, bốn lượt đã đóng có tổng chênh giá **+0,25197998u**, phí **0,28714600u**, kết quả **−0,03516602u**. Toàn bộ65 khớp là taker. Chuỗi risk/technical-pause ghi nhận các gap khoảng20–55giây, không phải chạm soft−8,9u hoặc ngân sách15u. Rổ từng chỉ mở kịp2coin trước khi đóng.

**Chiến lược vẫn chịu lỗ do thị trường.** Lượt12:50→23:33 có chênh giá **−1,19302u** trước phí và net **−1,27483361u**; lớn hơn nhiều phần phí của rổ. Lệnh đóng được kích hoạt bởi mất giám sát, nhưng khoản lỗ giá đã tồn tại trước khi đóng. Không thể quy toàn bộ lỗ cho kỹ thuật hoặc kết luận giữ nguyên vị thế sẽ lãi hơn khi chưa có đường đối chứng.

Phí0,56767u tương đương khoảng34,76% trị tuyệt đối lỗ toàn kỳ ở mốc00:33; bỏ toàn bộ phí giả định vẫn còn lỗ do giá và funding. Minh họa entry5→2bps với mọi khớp giữ nguyên chỉ tiết kiệm **0,182310954u** trên mẫu này. Đây không phải kết quả maker và không chứng minh lệnh maker sẽ khớp được.

## Vì sao backtest dương mà live đang âm?

[Kiểm chứng128ngày](2026-10-18-futures-live-improvements.md) đúng vốn31,47744546u/ngân sách15u có mean mô phỏng cơ sở+0,241345u/ngày, stress+0,236585u/ngày. Chính mẫu đó có57ngày âm; nửa đầu chỉ+0,0207u/ngày, nửa sau+0,462u/ngày, drawdown quan sát5phút khoảng33,45u. Dữ liệu đã dùng để phát triển; không phải kiểm chứng ngoài mẫu hoặc cam kết thu nhập.

Mô hình không tái hiện lịch mất giám sát, đóng bảo vệ và tái vào thực tế này; khớp từng leg/độ trễ cũng khác. Không lấy mean128ngày làm PnL tiền thật hoặc suy mẫu live ngắn bác bỏ/khẳng định lợi thế dài hạn. Kết luận hiện tại: **chưa chứng minh PnL+ trong vận hành thật**.

## Thứ tự cải thiện và điều kiện thông qua

1. **Ổn định giám sát trước.** Điều tra worker chờ CPU, VM steal, I/O, swap, quote từng coin và thời gian vòng lặp; tách công việc build/nghiên cứu khỏi thời gian giữ lệnh khi có thể. Giữ guard15giây và mọi đối soát. Thành công kỹ thuật phải có gap giảm trong cửa sổ quan sát xác định, không còn chuỗi thoát/phục hồi dồn dập, không mất phát hiện rủi ro; chưa được gọi là cải thiện PnL đã chứng minh.
2. **Kiểm chứng điều kiện mua lại sau sự cố lặp.** Hiện30giây khỏe có thể đủ mở lại nhưng sau1,5–2,4phút lại gián đoạn. Đăng ký một ứng viên phục hồi ổn định lâu hơn khi incident lặp, replay chuỗi sự cố/giá thật cùng một sổ vốn và toàn bộ chi phí; đo cả phí giảm lẫn biến động bị bỏ lỡ khi đứng ngoài. Không tự thêm cooldown vào live trước kết quả. Thiếu giá hoặc thời gian sự kiện thì ghi chưa đủ dữ liệu, không dùng đường giá biết trước để chọn lúc quay lại.
3. **Kiểm chứng cách giảm tiếp xúc lúc thị trường yếu.** Sau khi nền vận hành đạt, đăng ký một ứng viên có điều kiện giảm/không mở vị thế mua khi thị trường xuống, so với baseline cùng vốn31,47744546u/15u-ngày, cơ sở và chi phí cao. Không sweep nhiều bộ lọc trên lịch sử đã xem rồi gọi là xác nhận mới; giữ cả ngày xấu, phí, funding và drawdown. Không tăng size để che expectancy âm. Maker tiếp tục là nhánh đo spread/queue/khả năng khớp, chưa ưu tiên bật thật chỉ từ phép tính giảm phí.

Một bộ lọc hướng không mặc định tăng lợi nhuận: CCTlong/cash đã thử trước đây chỉ đạt mean0,11045/0,09896u/ngày ở vốn100u/ngày10u, còn đối chứng bỏ hướng có mean cao hơn nhưng vi phạm cap10u. Các con số này khác vốn/cap hiện tại, không dùng so trực tiếp với live31u/15u. Nếu dùng lại CCT làm đối chứng phải ghi đúng phiên bản đã có và vốn/rủi ro mới, không gọi là phát hiện phương pháp mới; xem [kết quả cũ](2026-10-15-futures-average-02pct-improvement.md).

Việc kế tiếp cụ thể là hoàn tất điều tra nguyên nhân gap và bản đo nhẹ, rồi lập một đối chứng phục hồi trên sự kiện đã ghi; không chạy lại nguyên trạng128ngày. Chưa có PnL của ứng viên mới, không tự mở goal hoặc scheduler. Quyền thử nghiệm và quyền áp dụng khi đủ bằng chứng đã có từ người dùng, không hỏi lại chỉ để bắt đầu phân tích.

## Bằng chứng vận hành bổ sung

Mẫu chỉ đọc30giây **00:36:44–00:37:14 ICT**: CPU steal65,39% tổng, iowait16,39%; main-thread worker chờ được cấp CPU8,739giây,389major pagefaults; có swap và áp lực I/O/bộ nhớ. Mẫu vẫn active, gap lớn nhất3,886giây, giá đầy đủ, không reconnect/lỗi nền mới. Đây là bằng chứng áp lực tài nguyên hiện hữu; không có dữ liệu `/proc` cùng thời điểm các gap cũ để quy nguyên nhân chính xác cho host, compiler hay mạng. Lượt này compiler đã được giới hạn tải; không coi đó là bằng chứng loại trừ ảnh hưởng validation lên máy nhỏ.

Linux mô tả `steal` là thời gian máy ảo bị chờ ngoài ý muốn: [tài liệu kernel `/proc`](https://www.kernel.org/doc/html/v6.12/filesystems/proc.html). Phí maker/taker khác nhau theo tài khoản và sản phẩm; số phí trong review lấy từ khớp thật, không thay bằng biểu phí quảng cáo: [Binance Futures fee calculation](https://www.binance.com/en-NG/support/faq/detail/360033544231).

Các file evidence đã bỏ thông tin tài khoản được lưu trong gói audit mới `live-telegram-important-20261019/pnl-review/`: snapshot, phân tích từng rổ, đối chiếu Decimal, bounded log transitions và mẫu tài nguyên. Không sửa các gói lịch sử đã đóng băng. Trần15u/ngày, soft−8,9u/buffer6,1u, guard15giây và cơ chế SL/TP hiện hành giữ nguyên.

[Telegram chỉ gửi tin quan trọng](2026-10-19-futures-telegram-important.md) đã deploy00:43ICT. Nghiệm thu61giây/31mẫu active, gapmax2517ms, không lỗi/khóa mới hoặc lệnh mới do deploy. Không dùng cửa sổ ngắn này để tuyên bố đã chữa dứt điểm sự cố giám sát.
