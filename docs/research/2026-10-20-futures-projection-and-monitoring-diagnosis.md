# Chẩn đoán phân bổ vốn và giám sát Futures — 20/10/2026

Đã tái dựng đúng 2.044 quyết định phân bổ của bốn ca CCT đã chạy. Có bằng chứng cụ thể rằng bộ phân bổ có thể mua dư một coin để bù phần thiếu của coin khác. Đã chuẩn bị một ứng viên thay mục tiêu phân bổ, qua chín kiểm thử tổng hợp và review độc lập. **Ứng viên chưa chạy backtest tài chính; chưa có PnL mới hoặc bằng chứng ROI tăng.**

Live tiếp tục giữ dừng theo yêu cầu hiện hành. Trần 12u/ngày, ngưỡng đóng sớm −5,9u, dự phòng 6,1u và bảo vệ mất giám sát 15 giây giữ nguyên. Đây là nghiên cứu cách thực hiện tín hiệu và đo đường vận hành; không khôi phục các rule ICT/SMC, cooldown hoặc cap mỗi lệnh đã bỏ.

## Phạm vi và độ tin cậy

Đầu vào là CCT gốc và CCT active allocation, mỗi bản ở phí thường và phí cao, cùng 512 ngày 20/05/2025–13/10/2026 ICT. Mỗi ví giả lập bắt đầu 31,47744546u và tiến triển liên tục. Chỉ đọc lại ledger và tính lựa chọn tại các trạng thái đã ghi; không tạo chuỗi vị thế phản thực hoặc chạy lại PnL.

Protocol chẩn đoán được khóa trước khi thực thi, SHA256 `c785b77dc2bc5754326318482ae59a2e649c695a1f42d2277b2a811b4f0673af`. Mỗi ca có 512 cơ hội nguồn: 511 lần gọi projector và một lần bỏ qua vì khóa rủi ro. Kết quả khớp chính xác 2.044/2.044 quyết định. Đồng thời kiểm tra 2.048 checkpoint trạng thái ledger, gồm cash, phí/funding, lượng, giá vốn, anchor và số fill; có 1.410 fill đã ghi trong bốn ca. Band được tái dựng tại các quyết định nguồn và đối soát riêng số lần giữ inventory, không phải trường kiểm trong mỗi checkpoint ngày.

Đây không phải một lần định giá đóng ngày hay chạy lại risk governor độc lập. Kiểm toán tiền/ngày của các backtest trước vẫn là bằng chứng cho các phần đó. Root đã tính lại chín trường tiền/ràng buộc tĩnh của từng quyết định bằng Decimal55 và kiểm độc lập số đếm của phép thử đổi hai coin.

## Vì sao phân bổ có thể khác ý nghĩa tín hiệu

Mục tiêu cũ cộng ba phần: độ lệch từng coin, độ lệch tổng mức tiếp xúc và chi phí thực hiện tức thời không âm. Vì vậy, nếu không mua được lượng BTC mong muốn, mua dư ETH có thể làm tổng mức tiếp xúc gần mục tiêu hơn và được chọn. Đây là hệ quả của công thức đã thiết kế, chưa phải lỗi an toàn hoặc bằng chứng mất lợi nhuận.

Ví dụ quyết định đầu ngày 20/05/2025 lúc 07:00 ICT, CCT gốc/phí thường:

| Coin | Giá trị vị thế mong muốn (u) | Giá trị vị thế được chọn (u) |
|---|---:|---:|
| BTC | 16,961377 | 0 |
| ETH | 4,303734 | 20,212046 |
| BNB | 6,635243 | 6,499503 |
| SOL | 2,867179 | 5,001818 |
| XRP | 1,859055 | 0 |
| Tổng | 32,626588 | 31,713367 |

Giá trị trên là lượng nhân mark price, **không phải margin hoặc tiền đã chi**. Tổng khá gần mục tiêu, nhưng tổng độ lệch từng coin là 36,999122u vì vừa thiếu vừa thừa. Lựa chọn này vẫn qua ràng buộc tiền/rủi ro tĩnh.

Ở từng ca CCT gốc có 397 quyết định BTC có target dương nhưng lượng được chọn bằng 0. Tại cả 397 trạng thái, phương án BTC tối thiểu có sẵn qua filters và dự phòng chung khi giữ các coin còn lại cố định, nhưng có điểm mục tiêu cục bộ kém hơn. Vì vậy không thể quy toàn bộ việc BTC bằng 0 cho thiếu vốn/minimum lot. Những phương án tĩnh này chưa được chứng nhận admission tuần tự với available balance và giá mới ngay trước từng lệnh thật.

Hai mức chi phí dùng cùng trọng số nguồn ở 511 thời điểm so sánh. Dù vậy, lượng được chọn khác nhau ở 183/511 quyết định CCT gốc và 299/511 quyết định active allocation. Chi phí làm ví tiến triển khác, chạm ngưỡng lot ở thời điểm khác và thay đường vị thế. Không được diễn giải kết quả ca phí cao tốt hơn thành “phí cao tạo lợi thế”.

## Vì sao chưa chọn tối ưu bằng đổi hai coin

Đã đăng ký riêng một phép kiểm tĩnh: thử mọi cặp trong năm coin trên các mức lượng ứng viên đã có, giữ các coin khác cố định. Không mở thêm mức lượng hoặc tham số. Một lần chạy đủ 2.044 quyết định trong khoảng 62 giây, thử 389.067 phương án cặp; 233.143 phương án qua ràng buộc tĩnh.

| Ca đã ghi | Quyết định có phương án làm điểm mục tiêu cũ giảm trên 0,000001u |
|---|---:|
| CCT gốc/phí thường | 35 |
| CCT gốc/phí cao | 21 |
| Active allocation/phí thường | 31 |
| Active allocation/phí cao | 44 |
| Tổng | 131/2.044 (6,41%) |

Trong 131 trường hợp này, 87 làm lệch từng coin nhiều hơn, 69 tăng chi phí tức thời và 103 tăng tổng giá trị vị thế. Chỉ bốn trường hợp đồng thời không tăng độ lệch từng coin và không tăng chi phí. Các nhóm có giao nhau.

Điểm mục tiêu giảm không phải tiền lãi hoặc phí tiết kiệm. Không có phương án thay thế nào được thực hiện hoặc tiến triển thành ví mới trong phép kiểm này. Kết quả xác nhận heuristic một coin mỗi bước có thể bỏ lỡ tổ hợp tốt hơn theo chính điểm cũ; không chứng minh nghiệm tối ưu toàn cục hoặc chiến lược sinh lời hơn. Do điểm cũ có thể ưu tiên bù lệch giữa coin, chưa chọn cách đổi hai coin để thay production.

## Một ứng viên cụ thể để thử tiếp

Revision `cct-tracking-cost-primary-v1` thay mục tiêu chính thành:

`độ lệch từng coin + chi phí thực hiện tức thời không âm`

Độ lệch tổng mức tiếp xúc còn làm tiêu chí phụ khi hòa điểm. AST review xác nhận đúng hai biểu thức thực thi thay đổi: điểm dùng chọn phương án và điểm báo cáo. Lattice lượng, kế hoạch delta, phương trình rủi ro, giới hạn vòng lặp và kiểm tiền Decimal40 giữ nguyên. Công thức chọn mới vẫn tác động lựa chọn khởi đầu, sửa phương án và bước cải thiện; không được nói mọi quyết định khác giữ nguyên.

Giả thuyết: bớt mua dư coin khác để bù sleeve không mua được, bám trọng số hiệu lực hơn. Trọng số hiệu lực bao gồm band giữ inventory do caller áp dụng; không đồng nghĩa sao chép tuyệt đối phương pháp công bố. Ứng viên có thể giữ nhiều tiền hơn, giảm vị thế và kiếm ít hơn. Đây là thay đổi mục tiêu kinh tế, không phải sửa lỗi đã chứng minh gây lỗ.

Chín kiểm thử tổng hợp đạt, gồm trường hợp BTC không đủ lot/ETH minimum, đối soát các trường tiền, filters, giới hạn ngày nghiêm ngặt, admission từng lệnh và từ chối cấu hình rủi ro không hợp lệ. Review độc lập chạy lại chín test và xác minh manifest tám file. Test chủ yếu dùng phí cơ sở và mark/reference bằng nhau; chưa bao phủ toàn bộ stress/divergence, partial fill hoặc trình tự bất đồng bộ.

Source SHA256 `45ce0bd3c9d522a5018d6d9e748bb96b2760a95468b5fd98b7bc76503e0e5331`; protocol prototype `23a13b1c53bbdf36e2b0c30e55ceb7b28daed7360c45fe4cf6e4e1dfb99924f4`. Mặc định API cũ vẫn là budget10/buffer0,10; mọi thử nghiệm hệ thống hiện hành phải truyền **tường minh 12/6,1**, gross8/leverage10, cùng soft−5,9 và guard15s ở engine. Gross/leverage là cấu hình thử nghiệm giữ nguyên, không phải yêu cầu mới của người dùng.

**Backtest tài chính ứng viên: NOT_REGISTERED_NOT_RUN.** Không có quyết định lịch sử, PnL hoặc số ROI của prototype để diễn giải lúc chốt báo cáo.

## Giám sát: xác nhận đường chờ, chưa kết luận nguyên nhân gốc

Log giữ lại có 204 transition: 27 lần chuyển sang khóa monitoring, 44 dòng tiếp tục trạng thái khóa và 133 dòng còn lại. Đây không phải toàn bộ tick hoặc census sự cố. Có bốn watchdog 60 giây được ghi sau 72,491 / 87,603 / 89,792 / 76,307 giây theo đồng hồ tường. Callback đã trễ; thiếu đồng hồ monotonic từng pha nên chưa tách được event loop, CPU, IO hay clock step.

Mã xác nhận `tickDurationMs` hiện được ghi trước khi chờ ghi trạng thái worker bền xuống đĩa. Khoảng giữa hai tick có thể gồm cả lần ghi này nhưng duration công bố chưa gồm nó. Snapshot giá WS cũng có thể già đi trong lúc chờ REST. Các lỗi “aged during durable write” xác nhận tuổi giá đã vượt budget sau một đoạn await; chưa chứng minh fsync riêng lẻ tốn hơn 5 giây. Không bỏ durable write, kiểm giá hoặc nới guard để che triệu chứng.

Trong 148 intent đóng rủi ro, 140 có context giá; median tuổi giá lúc tạo intent 2.080ms, p95 4.753ms, max 12.653ms. Có 137 intent liên kết telemetry cùng intent/trạng thái monitoring phù hợp, nhưng 0/148 lưu lý do khóa bất biến ngay trên intent. Chưa được quy toàn bộ phí đóng cho lỗi giám sát hoặc cộng phí đó thành lợi nhuận có thể tiết kiệm.

Đề xuất tiếp là đo UTC và monotonic theo từng pha: đọc sổ, lock, REST, snapshot giá, validation, ghi tài chính, ghi status và trước POST; lưu reason trên lần ghi intent vốn đã có. Observer phải có queue giới hạn và không thêm await disk/network trong vòng rủi ro. Runtime đang dùng Node20.20.2; kế hoạch đo dùng API có trong [tài liệu perf_hooks đúng phiên bản](https://nodejs.org/download/release/v20.20.2/docs/api/perf_hooks.html). `monitorEventLoopDelay` có đơn vị đầu ra nanosecond, không tự xác định nguyên nhân CPU hoặc IO.

Năm test chẩn đoán hiện tại chỉ kiểm phân loại/thống kê, **chưa phải fault test worker**. Trước tích hợp cần test stub cho REST chậm có WS mới, status write 20 giây, PREPARED/SUBMITTING chậm/lỗi, UNKNOWN/crash, event loop nghẽn, observer đầy và user hold. Chưa triển khai instrumentation hoặc chứng nhận vận hành 24/24 trong đợt này.

## Lộ trình và điều kiện kết thúc

| Việc | Trạng thái khi chốt | Kết quả cần tiếp theo |
|---|---|---|
| Tái dựng phân bổ và trạng thái đã ghi | Hoàn tất, khớp 2.044 quyết định | Giữ immutable evidence, không chạy lại ca cũ |
| Kiểm đổi cặp theo điểm cũ | Hoàn tất, không chọn triển khai | Không dùng điểm giảm thay PnL |
| Prototype tracking/cost | Có mã, 9 test và review đạt | Review tích hợp + đăng ký đúng một phép thử tài chính |
| Backtest prototype | Chưa đăng ký/chạy | Hai chi phí, cùng 512 ngày/ví liên tục/nguồn CCT gốc/band20; chỉ đổi objective |
| Đo pha vận hành và fault test | Có thiết kế, chưa implement | Trace đầy đủ khi lỗi, không thay quyền đặt lệnh hoặc guard |
| Live | Giữ dừng | Chỉ xem xét sau lợi nhuận/rủi ro đạt và kiểm chứng tích hợp/vốn thật |

Đợt tài chính tiếp dùng lại kết quả CCT gốc làm đối chứng, không chạy lại hoặc sửa chúng. Đóng băng hash/cost/risk/data/cutoff trước PnL đầu tiên; giữ 31,47744546u ban đầu, không reset/nạp, cùng funding và đóng cuối kỳ. Báo riêng net dương, cải thiện so đối chứng ở cả hai chi phí, rủi ro và mục tiêu chính **0,2u mỗi ngày lịch =102,4u/512 ngày**. Nếu không tốt hơn, lưu kết quả thất bại; không sweep hệ số từ cùng dữ liệu để tìm bản thắng. Toàn bộ 512 ngày đã xem là development hồi cứu.

Kết quả tài chính mới nhất vẫn là active allocation +6,932489u/+6,860398u, tương ứng +0,013540u/+0,013399u/ngày; CCT gốc +7,228341u/+5,622029u. Chẩn đoán và test phần mềm không thay các số này. [Bảng so sánh và giới hạn đầy đủ](2026-10-20-futures-roi-positive-research.md).

## Bằng chứng và trạng thái giữ dừng

[Gói evidence đã khóa](../audits/futures-quick-win/roi-positive-execution-diagnosis-20261020/README.md) gồm protocol, mã/tests/receipts, 2.044 quyết định đã ghi, kết quả pair audit, phase diagnosis, prototype và ba review độc lập:61file/79.429.138byte, manifestSHA256 `a76dab3f44dbdff81dc3cf88f61c4006903b8f3053125da4f6a27313ab4b50fc`. Không công bố raw account logs, wallet hoặc credentials.

GET chỉ đọc lúc **22:19:08 ICT ngày20/10/2026** xác nhận 0 vị thế/0 lệnh thường/0 algo, equity30,46375116u. Kiểm local cùng thời điểm xác nhận không PID live, savedboot stopped, hold còn hiệu lực và hash sổ tiền nguyên trạng `3e718d1f24de9568e7538d4f5beb5881139db5c7e0ca04dfa5be0607e9aaf0ec`. Vốn thật khác vốn tham chiếu; ứng viên đạt vẫn cần acceptance đúng vốn/filters/lifecycle. Không đặt lệnh, sửa production, reset hoặc khởi động lại worker trong nghiên cứu này.

Hai receipt cuối được giữ riêng sau khi archive đã khóa: [kiểm local](/home/ubuntu/futures-roi-positive-research-20261020/execution-diagnosis-final-local.json) và [GET sàn](/home/ubuntu/futures-roi-positive-research-20261020/execution-diagnosis-final-exchange.json); không chèn vào manifest cũ.

[Hậu kiểm cuối](/home/ubuntu/futures-roi-positive-research-20261020/execution-diagnosis-final-verification.json) xác minh manifest/tập61file,48đầu vào đăng ký và10hash mã production/sổ tiền nguyên trạng; không còn tiến trình backtest tài chính. [Review báo cáo](/home/ubuntu/futures-roi-positive-research-20261020/execution-diagnosis-doc-review.json) được lưu riêng.
