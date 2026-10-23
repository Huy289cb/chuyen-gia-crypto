> **Hậu kiểm vận hành 00:45 ICT:** Sau snapshot active lúc00:34, worker lại gặp monitoringgap lúc00:39 và00:43. Mốc00:45:35 tiến trình vẫn chạy nhưng ví đang flat, khóa kỹ thuật/chờ tự phục hồi, đối soát đủ và delta0. Nguyên nhân chưa rõ; không kết luận giám sát đã ổn định. [Bằng chứng bổ sung](../audits/futures-quick-win/news-shock-post-resume-20261020/README.md). Kết quả sáu ca offline không thay đổi.

# Kết quả backtest bảo vệ tin tức và sốc thị trường — 20/10/2026

**Đã hoàn tất sáu ca, kiểm toán độc lập PASS 6/6. Hai ứng viên chưa đạt tiêu chí tăng ROI ở cả chi phí cơ sở và chi phí cao, nên không triển khai nguyên bản vào giao dịch thật. Worker cũ đã được khôi phục và đối soát.**

## Cách đọc kết quả

Mỗi ca dùng một ví ban đầu **31,47744546 USDT**, chạy liên tục **128 ngày** từ 07/06/2026 17:00 UTC đến 13/10/2026 17:00 UTC, không reset sau 64 ngày. Giới hạn ngày cùng là **12u**, đóng sớm ở −5,9u với dự phòng 6,1u. Đã tính phí, trượt giá và funding trong mô hình.

Chi phí cơ sở: phí 0,05% và trượt 2 điểm cơ bản mỗi lượt khớp; chi phí cao: phí 0,07% và trượt 5 điểm cơ bản. Mỗi phương án được chạy lại toàn bộ danh mục, không cộng lợi nhuận của các lệnh tránh được để thay kết quả một ví.

Bình quân = tổng lãi ròng / đủ 128 ngày lịch, có cả ngày âm và thời gian giữ tiền mặt. ROI = lãi ròng / vốn ban đầu; không phải lãi suất năm hoặc cam kết lãi kép.

| Phương án | Chi phí | Lãi ròng (u) | ROI vốn đầu | Bình quân (u/ngày) | Ngày xấu nhất (u) | Sụt vốn lớn nhất (u) | Phí (u) | Lượt khớp |
|---|---|---:|---:|---:|---:|---:|---:|---:|
| Cơ sở | Cơ sở | 25.642884 | 81.464% | 0.200335 | -7.476318 | 29.695516 | 2.551497 | 124 |
| Cơ sở | Cao | 30.580668 | 97.151% | 0.238911 | -6.995209 | 25.671291 | 3.077303 | 114 |
| Né lịch tin | Cơ sở | 30.267111 | 96.155% | 0.236462 | -8.638638 | 25.420818 | 4.008199 | 222 |
| Né lịch tin | Cao | 26.641596 | 84.637% | 0.208137 | -7.736126 | 24.533659 | 5.809175 | 235 |
| Né lịch tin + sốc | Cơ sở | 15.252486 | 48.455% | 0.119160 | -6.761488 | 23.156601 | 4.022464 | 251 |
| Né lịch tin + sốc | Cao | 10.812689 | 34.351% | 0.084474 | -7.226797 | 23.402403 | 4.448327 | 227 |

Không ca nào vượt 12u/ngày **trong mô hình**. Trường drawdown mang tên cũ `maxDrawdown5mCloseUsd` thực tế được cập nhật ở giá đóng từng phút; không phải sụt vốn liên tục theo tick hoặc trong phút. Lượt khớp gồm cả mở, tăng, giảm và đóng từng coin; không phải số cơ hội chiến lược độc lập.

## Đánh giá từng lớp

**Né lịch tin (H1):** tăng lãi 4,624227u ở ca cơ sở nhưng giảm 3,939072u ở ca chi phí cao so với H0 cùng chi phí. Sụt vốn lớn nhất giảm ở cả hai ca, song ngày lỗ nặng nhất xấu hơn ở cả hai: −8,638638/−7,736126u so với −7,476318/−6,995209u. Vì vậy chưa thể gọi đây là lớp vừa tăng ROI vừa giảm ngày lỗ nặng nhất. Có 15 lần thoát theo lịch ở mỗi ca; bản này chờ nguồn ngày tiếp theo để vào lại.

**Né lịch tin cộng nhận diện sốc (H2):** giảm lãi 10,390398u ở ca cơ sở và 19,767979u ở ca chi phí cao. Sụt vốn lớn nhất giảm, nhưng ngày xấu nhất chỉ cải thiện ở ca cơ sở; ca chi phí cao lại xấu hơn H0 khoảng 0,231588u. Không đạt mục tiêu tăng ROI, không triển khai nguyên bản.

**Bản cơ sở H0:** bình quân 0,200335/0,238911u mỗi ngày trong kỳ hồi cứu. Đây là bản đối chứng với trần 12u, không phải lãi giao dịch thật hoặc bằng chứng bảo đảm lặp lại trong tương lai. Không lấy kết quả 15u/ngày trước đây để thay so sánh này.

## Hai phát hiện hữu ích cho vòng sau

1. **Độ nhạy của đường lệnh:** chi phí cao khiến H0 có lãi hơn H0 cơ sở trong mẫu này. Kiểm toán tiền khớp. Nguyên nhân đầu tiên được xác minh ở XRP ngày 09/08: tỷ lệ lệch trọng số của hai ví nằm hai phía ngưỡng giữ nguyên 20% (20,0147% và 19,8657%), làm một ca mua thêm 4,9 XRP sớm hơn một ngày. Từ đó lượng giữ, sizing và thời điểm dừng khác nhau. Phí và trượt giá thực sự cao hơn ở ca stress; không suy chi phí cao là có lợi.
2. **Chờ quá lâu sau thoát sốc là một cơ chế cần kiểm tra riêng:** ở H2 cơ sở có 51 tín hiệu và 5 lần đóng rổ vì sốc. Sau năm lần đóng, bot giữ tiền mặt lần lượt 7 giờ 08, 21 giờ 46, 2 giờ 49, 18 giờ 52 và 9 giờ 17; tổng 59 giờ 52. Tất cả đợi lần cập nhật 07:00 ICT kế tiếp, không có khoảng nào trùng cửa sổ lịch tin. Hết khóa sốc 10 phút chưa tự tạo lệnh vào lại. Đây là thời gian quan sát từ sổ sự kiện; chưa tính lợi nhuận giả định nếu vào sớm hơn và chưa chứng minh nó gây toàn bộ chênh lệch PnL.

## Hướng tiếp theo, có điểm dừng rõ ràng

- Chốt vòng H1/H2 hiện tại ở trạng thái **hoàn tất nhưng không đạt tiêu chí tăng ROI**. Không chạy lại nguyên trạng, không đổi ngưỡng theo kết quả đã xem.
- Nếu tiếp tục cải thiện hiệu quả, đăng ký riêng đúng một thay đổi về **điều kiện vào lại sau khi thị trường ổn định**, dùng trọng số nguồn đã biết, tính lại giá/khối lượng/rủi ro và đối chiếu toàn ví với H0/H2 cùng vốn, ngày và chi phí. Giữ 12u/ngày. Chưa chạy hoặc chọn thời gian vào lại mới trong lượt này.
- Bảo vệ khi VPS hoặc mạng ngắt cần nhánh **lệnh dừng khẩn trên sàn**, với đối soát vòng đời lệnh, mất ACK, khớp một phần, trigger và khởi động lại. Không dùng kết quả H1/H2 để chứng nhận lớp này: dữ liệu hiện tại thiếu BBO và lịch sử vòng đời algo order nên chưa backtest được nó như lệnh thật.
- Chỉ đề xuất triển khai ứng viên mới sau bằng chứng đạt tiêu chí đã đăng ký và kiểm thử mọi đường daily/pending/recovery/trước POST. Không cần thay cap, vốn cấp, sổ tiền hoặc tự gỡ khóa để tìm kết quả đẹp hơn.

## Tạm dừng và khôi phục worker thật

Người dùng đã cho phép tạm dừng trong lúc test. Worker được dừng khi ví đã flat và đối soát đủ; GET sàn 16:49:18 UTC xác nhận không vị thế/lệnh chờ. Không đóng lệnh thủ công để tạo điều kiện test và không sửa cấu hình hoặc module production.

Sáu ca chạy tuần tự 16:52:56–17:30:24 UTC ngày 19/10, tức 23:52 ngày 19/10 đến 00:30 ngày 20/10 ICT. Checkpoint các lượt dở trước thiếu trạng thái để resume nên các ca này bắt đầu từ phút 0; mọi lượt dở vẫn được giữ nguyên.

Supervisor hoàn tất kiểm toán rồi bật lại worker cũ PID 2861289. Worker tự đồng bộ lịch sử, đối soát và qua quy trình phục hồi hiện hữu; ban đầu có trạng thái chờ lịch sử/khớp lệnh, sau đó trở lại active. Mẫu nghiệm thu 53 lần trong 112 giây, kết thúc với 6 mẫu khỏe liên tiếp, đối soát đủ/delta 0/không pending. Không diễn giải cửa sổ ngắn này thành chứng nhận vận hành 24/24.

GET sàn **00:34:38 ICT ngày 20/10**: BNB 0,04; ETH 0,009; SOL 0,16; XRP 10,0; lượng từng coin khớp sổ, không lệnh thường/algo chờ. 220 lượt khớp/202 intents: tăng 4 lượt khớp và 4 intents do rổ phục hồi thật, không phải lệnh thử. Cash 30,24469917u, equity theo sàn tại mốc đọc 30,28682336u gồm lãi/lỗ mở; các số này là live, tách khỏi bảng mô phỏng.

47 kiểm tra bảo toàn PASS: toàn bộ lịch sử khớp/intents trước đó, mốc vốn cấp, cấu hình, owner/handoff, cursor, anchor và mức lỗ tệ nhất ngày cũ được giữ. Đổi ngày ICT sử dụng quy trình hiện hữu lúc ví flat; không reset rủi ro để mở lệnh. Hash .env và module JS portfolio production không thay đổi; giới hạn vẫn 12u/ngày. PM2 đã lưu trạng thái khôi phục; API vẫn online, legacy/paper/post-exit vẫn stopped.

## Phạm vi bằng chứng và giới hạn

Registration SHA-256: `c89496372e48db0e62b89ab97c62097f5e82c78efedd8e6564d8b346dad099db`. Đầu vào 21 tệp/92,13MB được kiểm hash. Mỗi ca có đủ 184.320 phút và 1.920 sự kiện funding. Kiểm toán online Decimal50 kiểm từng fill/funding và trạng thái ví định kỳ; hậu kiểm độc lập xác minh hash, sổ tiền, 128 checkpoint, 127 lần chuyển ngày, tính tổng PnL, giá trị theo giá đóng và anchor theo giá mở ngày kế tiếp. Kiểm thử mục tiêu và review độc lập auditor không phát hiện lỗi schema ảnh hưởng số tiền.

PASS kiểm toán không phải xác minh độc lập mọi quyết định rủi ro trong phút, giá tham chiếu khớp hoặc tối ưu danh mục. Lịch lịch sử có thể được sửa; chưa có feed lưu đúng thông tin biết tại thời điểm đó. Kỳ dữ liệu đã xem là phát triển, không phải holdout/OOS. Trượt giá cố định, nến một phút và khớp phút kế tiếp không tái hiện toàn bộ gap, spread, tin bất ngờ, khớp một phần, thanh khoản hoặc lỗi sàn. Không bảo đảm trần 12u ngoài thị trường.

## Bằng chứng để kiểm lại

- [Gói kết quả và nguồn đã khóa](../audits/futures-quick-win/news-shock-worker-paused-20261020/README.md).
- [Bảng so sánh và verdict](../audits/futures-quick-win/news-shock-worker-paused-20261020/results/comparison-report.json).
- [Kiểm toán độc lập 6 ca](../audits/futures-quick-win/news-shock-worker-paused-20261020/results/audit-report.json).
- [Đối soát khôi phục thật](../audits/futures-quick-win/news-shock-worker-paused-20261020/exchange-after-resume.json).
- [47 kiểm tra bảo toàn](../audits/futures-quick-win/news-shock-worker-paused-20261020/live-preservation-after-resume.json).
- [Thiết kế và các giới hạn ban đầu](2026-10-19-futures-news-shock-protection.md).
