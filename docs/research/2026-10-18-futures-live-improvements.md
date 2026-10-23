# Đo vốn thực, kiểm chứng chi phí và Telegram dễ hiểu — 18/10/2026

Biên bản theo [kế hoạch đã chốt](../plan/2026-10-18-futures-live-improvements.md). Đã nghiệm thu: Telegram/telemetry chạy thật; baseline128ngày đúng31,477u hoàn tất; maker giữ ở testbed vì chưa đủ bằng chứng khớp. Kết quả mô phỏng và live được tách rõ ở phần cuối.

## Phạm vi và vốn

Vốn đầu kiểm chứng là **31,47744546 USDT**, không phải 100u quy đổi. Giữ ngân sách lỗ **15u/ngày**, bảo vệ sớm tại −8,9u với dự phòng đóng 6,1u; không tăng khối lượng, nạp tiền hoặc xóa lịch sử. Nguồn B5 constant-direction vol90 scalar6, gross8/leverage10/band20%, giám sát 2 giây, giá tối đa 5 giây và guard gián đoạn 15 giây không thay đổi.

## Đường vốn và giá trước lệnh

Worker ghi quan sát thật theo phút và khi có thay đổi quan trọng: vốn, lãi/lỗ, tiền đã ghi nhận, phí mua bán, phí/tiền nhận khi giữ lệnh, vị thế và giá mua/bán quan sát được. Ý định đặt lệnh mới lưu giá mark/reference/bid/ask, tuổi giá, phí và giả định trượt giá trước khi gửi sàn. Không dựng lại dữ liệu trước triển khai; trường chưa có là `null`.

Ước tính đóng tất cả lệnh dùng phía giá bất lợi phù hợp, trượt giá và phí taker. Đây là chi phí dự tính, không phải phí đã trả hoặc giá thoát được bảo đảm. Lãi/lỗ tổng trước chi phí thoát được giữ riêng để tránh trừ phí cũ hai lần.

Ghi chẩn đoán chạy nền, không chờ trong vòng kiểm tra rủi ro hoặc giữ khóa ví. Hàng đợi tối đa 4 mẫu; sự kiện ngoài mẫu phút cách ít nhất 10 giây; nhật ký tối đa 16 MiB/ngày, giữ 32 ngày UTC. Mẫu phút gọn có kiểm tra dung lượng cho đủ 24 giờ với 5 vị thế/22 khớp/20 lệnh. Health công bố mẫu bỏ qua/lỗi; latest và health tiếp tục cập nhật nếu nhật ký đầy. Sổ tiền chính vẫn là `live-wallet.json`.

Kiểm tra chéo đã sửa trường hợp sàn xác nhận không còn vị thế nhưng lịch sử khớp/phí còn chậm. Vị thế trống đã xác thực phải được giữ là trống, đồng thời đánh dấu chưa đối soát với sổ khớp; không giả rằng còn giữ coin hay tự thêm một khớp mới.

## Telegram

Tin giao dịch mới chỉ trình bày hành động, coin, lượng, giá trị, phí và lãi/lỗ phần đã đóng. Không hiện ACK, FILLED, intent, NAV, mã nội bộ hoặc tên chính sách. Tin cũ đã lưu không bị đổi hay gửi lại vì đổi câu chữ.

Ví dụ minh họa, **không phải giao dịch phát sinh để thử thông báo**:

```text
✅ MỞ LỆNH ETH — MUA
Đã mua: 0.009 ETH | Giá: 2408.91 USDT/ETH.
Giá trị mua/bán: 21.68019 USDT. Phí mua/bán vừa trả: 0.010840095 USDT.
Phần vừa mở chưa có lãi/lỗ đã chốt; lời khi giá tăng, lỗ khi giá giảm.
Thời gian mua/bán: … (giờ Việt Nam).
```

Nếu đóng đúng lượng trên ở 2418,91, phí đóng 0,010885095u thì thông báo lãi sau phí mở và đóng là **+0,06827481u**: 0,09 − 0,010840095 − 0,010885095. Phí/tiền nhận khi giữ lệnh được tính trong báo cáo toàn tài khoản; chưa có phân bổ xác thực thì không tự gán cho từng phần đóng.

Báo cáo ngày tách lãi/lỗ đã vào số dư với tổng kết có lệnh chưa đóng, vẫn công bố dữ liệu tiền nhận muộn hoặc thiếu quan sát đầu/cuối ngày. Cảnh báo nói bằng tiếng Việt hệ thống đang chặn, đối chiếu hay phục hồi việc gì. Giữ định danh sự kiện, chống gửi trùng, quyền sở hữu, phiên gửi, chờ lịch sử khớp 30 giây và gửi bù báo cáo.

Đã sửa một lỗi nâng cấp tương thích: đổi câu cảnh báo sang tiếng Việt có thể làm fingerprint dựng lại từ câu chữ khác fingerprint nguồn. Tin lỗi mới lưu fingerprint riêng; dữ liệu cũ còn fallback đúng định dạng cũ. Có ca hồi quy xác nhận tin đã gửi/đang chờ không bị viết lại, và chỉ giao dịch mới nhận định dạng mới.

## Phương pháp kiểm chứng lịch sử

Một ví liên tục/case qua 128 ngày lịch, không nạp thêm hoặc reset tại điểm chia 64 ngày; giữ mọi ngày âm/không giao dịch. Dữ liệu gồm 184.320 phút B5/case, 1.920 sự kiện phí giữ lệnh và nguồn hằng ngày đã khóa. Cơ sở phí taker thực 5bps và trượt giả định 2bps; ca chi phí cao giả định 7bps/5bps. Mức 7bps không phải phí hiện hành của tài khoản.

Kiểm tra trước khi chạy gồm đối chiếu kernel với engine TypeScript dùng chung trên 12 tình huống/54 bước/1.174 kiểm tra, và đối chiếu trực tiếp điều kiện nhận lệnh live trên 12 tình huống/84 kiểm tra, sai số tiền 0. Đã bổ sung điều kiện min-notional theo giá reference, dự phòng chi phí phát sinh ngay và số dư khả dụng; không gọi parity với paper engine là chứng nhận mọi đường thực thi live.

Sổ sự kiện tiền được kiểm toán độc lập với Decimal50 ở từng bước mô hình; kiểm tra không thay thế kiểm toán độc lập toàn bộ bộ tối ưu/rủi ro. Giới hạn vẫn gồm filters hiện tại áp hồi cứu, số dư khả dụng mô hình trong ví riêng, nến phút và việc các chân lệnh nguồn không tái tạo độ trễ thật. Không bịa lịch mất mạng/phục hồi. 128 ngày đã được xem trong nghiên cứu trước, không phải dữ liệu mới ngoài mẫu.

## Ứng viên giảm phí

Ứng viên post-only được triển khai riêng trong testbed để kiểm tra không khớp, khớp một phần, hết hạn, hủy chưa rõ và chặn rủi ro. Chỉ được bật live khi chứng minh lợi nhuận sau chi phí tốt hơn ở cả hai ca và rủi ro đạt. Không lấy việc thay phí taker bằng maker cho mọi khớp hoặc nến chạm giá làm bằng chứng.

Dữ liệu nến đang có không chứa lịch sử bid/ask theo sự kiện, thứ tự khớp và hàng chờ thích hợp. Binance cũng lưu ý dữ liệu khớp tổng hợp có cả thanh khoản RPI, trong khi `nq` mới là lượng thông thường loại RPI và bookTicker loại RPI. Vì vậy không dùng tổng lượng `q` để suy lệnh post-only của bot chắc chắn được khớp. Tham chiếu: [lệnh và GTX](https://developers.binance.com/en/docs/catalog/core-trading-derivatives-trading-usd-s-m-futures/api/rest-api/trade), [dữ liệu thị trường và nq](https://developers.binance.com/en/docs/catalog/core-trading-derivatives-trading-usd-s-m-futures/api/rest-api/market-data).

## Nghiệm thu cuối

**Hoàn tất phần vận hành và phép thử đã đăng ký; chưa promote maker.** Telegram và ghi đường vốn đã deploy lúc **19:09 ngày18/10**, PID2391682, PM2 saved. Cấu hình taker cơ sở đang vận hành được giữ nguyên; không có chiến lược mới, đổi leverage hoặc tăng size phát sinh từ phép thử.

### Kết quả đúng vốn31,47744546u

Kỳ **08/06/2026 00:00 ICT đến trước 14/10/2026 00:00 ICT**, một ví liên tục/case, đủ128ngày và184.320phút/case; không nạp thêm, không reset giữa hai nửa64ngày. Kết quả đã đóng vị thế cuối kỳ và bao gồm phí, funding, trượt giá.

| Chỉ số | Cơ sở: phí5bps/trượt2bps | Chi phí cao giả định:7bps/5bps |
|---|---:|---:|
| Vốn đầu |31,47744546u|31,47744546u|
| Vốn cuối |62.369626u|61.760323u|
| Lãi ròng toàn kỳ |+30.892180u|+30.282878u|
| Lãi ròng / đủ128ngày lịch |+0.241345u/ngày|+0.236585u/ngày|
| Mean theo vốn đầu |0.7667%/ngày|0.7516%/ngày|
| Mức lỗ trong ngày lớn nhất ghi nhận |-9.946459u|-10.159035u|
| Số ngày vượt15u trong mô hình |0|0|
| Ngày dương / âm |71 /57|71 /57|
| Số lượt khớp mô phỏng |81|80|
| Tổng phí mua/bán |1.547578u|2.157859u|
| Funding ròng |-1.894079u|-1.892856u|
| Chi phí trượt đã nằm trong giá khớp |0.619033u|1.541337u|
| Giảm vốn lớn nhất từ đỉnh, lấy mẫu đóng5phút |33.453194u|33.505643u|

Cả hai ca đạt **0,2% vốn đầu/ngày (~0,062955u)** và cả mốc **0,2u/ngày** khi chia tổng lãi cho đủ128ngày. Đây là kết quả mô phỏng trên dữ liệu phát triển đã xem, **không chứng nhận kỳ vọng hoặc lãi live tương lai**.

Kết quả phụ thuộc giai đoạn: mean64ngày đầu **+0.020701u/ngày**,64ngày sau **+0.461989u/ngày** ở cơ sở; ca chi phí cao tương ứng **+0.020776 /+0.452394**. Không chọn riêng nửa tốt hoặc reset vốn tại điểm chia. Mean thấp đầu kỳ và drawdown lớn vẫn phải giữ trong đánh giá.

Không suy kết quả bằng100u chia tỷ lệ: minimum/lô làm tròn, giới hạn tiền cố định và đường vị thế/phục hồi làm kết quả phi tuyến. Chênh lệch với bản100u trước còn có ngân sách15u/currentfilters và điều kiện nhận lệnh live; chưa có matchedexperiment để quy riêng tác động cho từng thay đổi.

### Kiểm toán và triển khai

- **193 kiểm thử vận hành PASS**:102 ca Telegram/telemetry,91 ca giao dịch/kế toán ngày/phục hồi/giám sát/nguồn; scoped TypeScript PASS. Một lượt kiểm tra và một lượt build đã chủ động dừng ở guard7giây, được giữ làm bằng chứng; lượt sau giảm tải, dùng cache phụ thuộc và nhường tài nguyên chủ động thì PASS. Không nới guard15giây hoặc sửa ví.
- Parity tham chiếu12 tình huống/54 bước/1.174 kiểm tra tiền; admission live12 tình huống/84 kiểm tra;3 ca skipleg/dropplan/longonly PASS. Đây là các phạm vi cụ thể, không phải full historical live parity.
- Kiểm toán Decimal50 tại từng bước: **8,086,095 +8,085,100 kiểm tra PASS**, sai lệch tối đa rất nhỏ hơn1e−24u. Hậu kiểm độc lập thêm **12,260 kiểm tra PASS** trên toàn bộ events, raw funding,128 checkpoint/case, lot inventory/cash/fees và chuỗi mốc ngày. Checksum đầu ra khớp; không chạy lại tài chính để chọn kết quả.
- Replay hoàn tất một lần trong **832.4giây**; guard khi chạy quan sát lớn nhất **4.010giây**, không chạm ngưỡng dừng. Hai phút sau deploy:59mẫu active, gapmax3.493giây, không blocked/risklatch/lỗi nền. Đây là bằng chứng cho các khoảng đo đó, không bảo đảm mọi giờ sau.
- Tại19:25,22fills/20intents/4long nguyên vẹn, mọi config/sổ tiền/phí/funding/anchor/cursor khớp checkpoint; không có lệnh do nâng cấp. Các giao dịch về sau là hoạt động live và phục hồi kỹ thuật theo quyền đã cấp, không phải lệnh tạo để test thông báo.

### Maker: testbed đã có, chưa bật trên tiền thật

**42 test PASS**, bao gồm không khớp, khớp một phần, timeout, cancel/POST chưa rõ, fallback một lần, LIMIT tick/lot/notional và MARKET residual/dust, NaN/Infinity, dữ liệu RPI/nq. Review độc lập đã sửa3 lỗi trước nghiệm thu: lặp quyền fallback, thiếu bộ lọc và gate số vô hạn. Không cộng25ca ban đầu vào42ca cuối.

Kết quả lợi nhuận ứng viên vẫn **`null`**, gate **`BLOCKED_PROMOTION`**, không gửi lệnh maker thật. Dữ liệu hiện có thiếu bằng chứng khớp trong cửa sổ60giây; testbed chưa có journal bền vững/transport giao dịch thật. 42tests không được đổi thành chứng nhận execution live. Trên đúng các khớp entry cơ sở đã ghi, chênh3bps chỉ tương đương **0.459123u toàn kỳ (~0.003587u/ngày)** ở riêng thành phần phí; không phải lợi nhuận maker hoặc trần tăng lợi nhuận cho một đường giao dịch khác.

Vì chưa chứng minh maker tốt hơn ở cả hai mức chi phí, không kích hoạt theo điều kiện “nếu tốt hơn thì áp dụng”. Không cần hỏi lại quyền khi có đủ bằng chứng sau này, nhưng không bỏ qua gate.

### Giao dịch thật sau đó — tách khỏi mô phỏng

Lần tiếp tục vào23:35 phát hiện giá BTC chậm và thêm gián đoạn giám sát. Có gap **55,301giây** ghi trong log lúc23:37; guard giữ nguyên đã đóng rổ và cơ chế phục hồi tiếp tục sau đối soát. Máy chủ cùng lúc có mẫu chờ CPU của máy ảo (st)65–72% và chờI/O; đây là đầu mối điều tra, chưa chứng minh toàn bộ nguyên nhân. Không nâng ngưỡng giá/15giây hoặc trần lỗ để làm đẹp kết quả.

Đối soát sàn **23:43:10 ICT**:37fills/35intents, không lệnh chờ, đủ phí/funding/số dư/vị thế. Một lần đọc lúc đang đặt lệnh cho kết quả khác snapshot cũ do dữ liệu đang thay đổi; giữ receipt và đọc lại sau khi hoàn tất, mọi kiểm tra đều PASS. Tại **23:43:51**, trạng thái active/4long, đã đối soát đủ; net từ đầu **-1.576888u** gồm lệnh chưa đóng, hôm nay **-1.385270u**, worstday **-1.494689u**, breach15u=0. Vốn cấp ban đầu, anchor, cursor và mọi giao dịch cũ vẫn nguyên vẹn. Không diễn giải backtest dương thành live đã có lãi.

Telegram:37thông báo khớp thật,15tin mới sau triển khai đều đã gửi; xác nhận cả mở/đóng theo định dạng mới và báo cáo21:00 theo giao dịch thật. Lúc23:43:51 không pending/failed; uncertain5 là trạng thái gửi cũ đã giải trình, không phải5tin trade hiện thiếu. Telemetry đã ghi300mẫu, lỗi0/không bỏ journal vì đầy;43mẫu sự kiện bị gom/giới hạn theo cơ chế chống quá tải, không làm mất giao dịch trong sổ chính.

### Lộ trình sau nghiệm thu

1. **Đã hoàn tất18/10:** Telegram thật, đo đường vốn/giá trước lệnh, baseline31,477u/15u, hậu kiểm và testbed maker; bằng chứng khóa trong [live-improvements-20261018](../audits/futures-quick-win/live-improvements-20261018/sha256-manifest.json).
2. **Ưu tiên vận hành:** đối chiếu các lần gián đoạn mới với độ trễ mạng, thời gian xử lý/chờ của VPS và ghi ví; xác định nguyên nhân trước khi tăng rủi ro hoặc dùng mean mô phỏng làm kỳ vọng live. Giữ tự phục hồi có kiểm tra và mọi guard hiện hành, không reset lịch sử.
3. **Gate maker còn thiếu:** lấy dữ liệu bid/ask/depth/trades có trình tự và `nq`, hoặc receipt thực thích hợp; hoàn thiện journal/đối soát/cancel/fallback bền vững; đăng ký phép so sánh cặp trước PnL, giữ cơ hội bị bỏ lỡ và các ca không khớp. Chỉ promote nếu cả hai ca chi phí net tốt hơn và rủi ro đạt. Không lập scheduler hay mở goal nghiên cứu vô hạn từ bước này.
