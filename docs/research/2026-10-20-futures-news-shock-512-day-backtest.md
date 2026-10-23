> **Cập nhật cuối20/10:** cả6ca512ngày và kiểm toán đã hoàn tất; tất cảlỗ, H1/H2giảmROI soH0. [Kết quả](2026-10-20-futures-news-shock-512-day-results.md). Theo yêu cầu mới, live đãdừng/flat và bootprofile stopped; chỉ chạy lại khi có ứngviên đạt mục tiêu/kiểmtoán, không tự khôi phục sau đợt này. [Biên bản giữdừng](../audits/futures-quick-win/news-shock-512d-live-hold-20261020/README.md). Các đoạn tự khôi phục bên dưới là thiết kế/quyền lịch sử trước thay đổi này.

<!-- news-shock-512d-finalization-v2 -->
> **Đợt512ngày đã kết thúc:** Xem [kết quả và khôi phục worker](2026-10-20-futures-news-shock-512-day-results.md). Các dòng RUNNING bên dưới mô tả mốc bắt đầu.
<!-- /news-shock-512d-finalization-v2 -->

# Đối chứng bảo vệ tin/sốc trên 512 ngày — 20/10/2026

Trạng thái: **RUNNING; chưa có PnL đủ 512 ngày**. Đợt này thực hiện yêu cầu mới của người dùng, mở rộng thời gian của đúng ba phương án đã thử; không đổi chiến lược hoặc dò thêm ngưỡng sau khi xem kết quả 128 ngày.

## Phạm vi đã khóa trước PnL

- Kỳ liên tục: 19/05/2025 17:00 UTC → 13/10/2026 17:00 UTC, tương ứng các ngày lịch Việt Nam 20/05/2025–13/10/2026, tổng 512 ngày.
- Mỗi ca một ví ban đầu31,47744546u, trần12u/ngày ICT, ngưỡng đóng sớm−5,9u và dự phòng6,1u. Không nạp thêm, reset ở đoạn trùng kỳ cũ hoặc cắt bỏ ngày không giao dịch. Nếu vốn không đủ hay không dương, tiếp tục hạch toán toàn bộ ngày còn lại, không khởi tạo lại ví.
- B5 BTC/ETH/BNB/SOL/XRP, nguồn constant-direction vol90 scalar6, biên giữ nguyên20%, gross8/leverage10; toàn bộ kernel, bộ xử lý phút, admission, projection và policy shock giữ nguyên byte so với gói128ngày.
- Sáu ca tuần tự: H0 cơ sở/base, H0/stress, H1 né lịch/base, H1/stress, H2 lịch+sốc/base, H2/stress. Phí0,05%/trượt2bps và0,07%/trượt5bps mỗi lượt khớp.
- Giữ đúng lịch đóng/mở và điều kiện vào lại của H1/H2 đã đăng ký; chưa thử giả thuyết vào lại sớm. Lịch tin được mở rộng theo nguồn chính thức, giữ nguyên cửa sổ bảo vệ và DST.
- Tính net/đủ512ngày; so từng ứng viên với H0 cùng chi phí. Chỉ gọi cải thiện đạt yêu cầu khi net cao hơn ở cả hai cost và không vi phạm trần mô hình. Tách PASS tính tiền khỏi FAIL rủi ro, không dừng thu thập kết quả chỉ vì ca kinh tế xấu.

Registration SHA-256: `d24c673c07871e5c07d8c38ff1bb52d8c0c7d50ef633e1f4e310357e4754bb4d`. Đăng ký lúc 2026-10-19T23:22:48.764397+00:00, trước mọi frame tài chính512ngày.

## Kiểm tra đầu vào đã đạt

- 5×737.280 =3.686.400 dòng giá Futures USD-M trade+mark 1 phút, kiểm tra độc lập không thiếu/trùng thời gian, OHLC hữu hạn và đúng quan hệ giá.140archive có checksum chính thức.
- 7.680 sự kiện funding thực tế, giữ nguyên mili giây và giá thanh toán; không giả định hoặc làm tròn thời điểm thành phút. Tổng số được xác minh từ dữ liệu.
-512 nguồn ngày, kiểm toán độc lập20.480 trọng số/2.560 volatility cells. Dùng đầy đủ seed đóng từ2022; phần128ngày trùng khớp chính xác mọi trường tài chính và metadata.
- Phần128ngày giá/funding được tái dùng nguyên byte hoặc nguyên object, không tải lại để thay kết quả cũ.
- Lịch chính thức86bản ghi/76timestamp,65cửa sổ/3.750phút. Phần128ngày trùng giữ đúng15cửa sổ/900phút. Có xử lý tin dời/hủy do shutdown, giờ đặc biệt và DST. Thời điểm PCE data update23/12/2025 được BEA xác nhận cùng GDP; không thêm cửa sổ trùng.
-13đầu vào trực tiếp/371.269.825byte được hash; source, hồ sơ dữ liệu và bằng chứng nguồn ngày/lịch được khóa riêng. Kiểm thử mục tiêu auditor PASS, bao gồm512ngày/511roll/sốfunding thực tế và tách vi phạm12u khỏi tính tiền.

## Vận hành thật trong lúc test

Đã dừng riêng crypto-portfolio-live lúc23:01UTC ngày19/10 (06:01ICT20/10) khi ví đã flat/đối soát đủ/không pending. Sàn23:03:39UTC xác nhận0vịthế/0lệnh thường/0algo, cash30,49583316u;253khớp/236intents cũ được giữ. Đây là snapshot vốn thật, tách khỏi vốn cấp mô phỏng31,47744546u. Không đóng tay, chuyển tiền hoặc reset mốc rủi ro.

SupervisorPID2953515 bắt đầu23:23:51UTC, guardianPID2953550. Chỉ một child replay tài chính mỗi lúc; nice10/ioniceidle. SavedPM2bootprofile vẫnonline vì reboot sẽ chấm dứt replay rồi khôi phục worker cũ; không lưu trạng thái tạm dừng vào bootprofile. Có guardian độc lập để dừng child còn sót và khôi phục nếu supervisor chết; kiểm toán hậu kỳ cũng thuộc nhóm tiến trình được quản lý.

Cutoff đã khai báo90phút/ca và6giờ toàn đợt, dư so với ước tính2–3giờ theo tốc độ128ngày. Timeout hoặc lỗi phải ghiINCOMPLETE, không quy đổi prefix thành PnL512ngày. Khi hoàn tất/lỗi, dừng mọi child, kiểm tra hash/config/sổ tiền/flat và GET sàn trước bật lại worker cũ; giữcap12/guard15s và mọi khóa tiền. Sau bật lại vẫn phải quan sát đối soát và phục hồi; lỗi giám sát cũ chưa được sửa bởi backtest này.

## Đầu ra và việc tiếp theo

Thư mục chạy: `/home/ubuntu/futures-news-shock-512d-20261020`. execution.json và log riêng từng ca ghi tiến độ; attempt/cases chứa event ledger, daily checkpoints, summary và manifest. Sau sáu ca, auditor độc lập tạo attempt/results/audit-report.json và comparison-report.json/.md. Phải đọc đủ kết quả, trần ngày và tình trạng khôi phục trước kết luận.

Kết quả cuối cần có net, ROI, bình quân theo mọi ngày, ngày xấu nhất, drawdown, phí/funding/lượt khớp và số ngày dương/âm. Có thể mô tả bốn đoạn128ngày từ cùng ví liên tục; không coi đó là bốn ví độc lập hoặc yêu cầu từng đoạn phải dương. Không tự triển khai calendar/shock vào live theo yêu cầu mở rộng kiểm chứng này.

## Giới hạn cần giữ khi đọc kết quả

Đây là hồi cứu mở rộng, có128ngày đã xem; không phải holdout tiến cứu. Lịch đã sửa có nguồn chính thức nhưng không có đủ feed lưu đúng thông tin biết tại thời điểm lịch sử, nên lịch as-known vẫnUNKNOWN. Dùng historical OHLC, trượt giá cố định và filters hiện tại; không chứng nhận khớp qua panic, gap, spread, mất mạng hoặc trần12u tuyệt đối. Drawdown trường tên cũ5m được cập nhật ở giá đóng từng phút; kiểm toán tiền không thay mô phỏng độc lập mọi bước rủi ro trong phút. SL khẩn trên sàn và lifecycle algo order chưa được kiểm chứng trong đợt này.

[Báo cáo128ngày đã chốt](2026-10-20-futures-news-shock-backtest-results.md) được giữ nguyên.
