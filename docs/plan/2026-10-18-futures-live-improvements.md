# Triển khai đo lường, kiểm chứng vốn thực và giảm phí — 18/10/2026

Trạng thái cuối: **Telegram/telemetry đã chạy thật; baseline128ngày hoàn tất, base/stress+0,241345/+0,236585u/ngày; maker42tests PASS nhưng chưa promote**. [Biên bản và giới hạn](../research/2026-10-18-futures-live-improvements.md). Người dùng yêu cầu triển khai ba cải tiến trong [đánh giá live](../research/2026-10-18-futures-live-results-review.md), giữ vốn khoảng31,48u/trần15u/ngày, cho phép áp dụng cách vào lệnh mới nếu được kiểm chứng tốt hơn; đồng thời yêu cầu Telegram dễ hiểu cho người không biết trading. Quyền này thay trạng thái chỉ đọc/chưa chạy nghiên cứu của lượt đánh giá trước, không resume các goal cũ.

## Cấu hình phải bảo toàn

- Vốn kiểm chứng dùng chính xác **31,47744546 USDT**, đúng ví đã cấp; không reset ví live hoặc nạp/chuyển tiền.
- Trần ngày15u; soft−8,9u/buffer6,1u; giữ gross8/leverage10/band20%, one-way/cross, quote freshness5giây, guard15giây, nguồn B5 constant-direction vol90 scalar6 và cửa sổ07:00ICT60giây.
- Không tăng size để bù phí hoặc tái lập các rule ICT/SMC cũ. Khóa tài chính, anchor, source cursor và sổ tiền phải được đối chiếu trước/sau deploy.

## Ba phần triển khai

1. **Đo đường vốn và chi phí:** log theo phút và theo sự kiện, gồm số tiền đã ghi nhận, tổng giá trị có lãi/lỗ chưa đóng, phí/funding và ước tính chi phí thoát. Lưu tham chiếu giá trước lệnh khi thật sự quan sát được; dữ liệu cũ thiếu thì để null. Ghi nền có queue/retention và báo lỗi riêng, không chặn vòng giám sát hoặc sửa sổ tiền.
2. **Baseline đúng vốn thực:** một ví liên tục128ngày, cùng raw mark/trade1m và funding/targets đã khóa trước đây; filters và fee cơ sở theo metadata tài khoản hiện hành. Hai ca: cơ sở phí5bps/trượt2bps; stress giả định phí7bps/trượt5bps, không gọi7bps là phí tài khoản thực. Tái dùng kernel đã audit, kiểm tra đối chiếu engine TS trên ca tiền/rủi ro/lô tối thiểu trước khi chạy. Phân biệt mô hình theo phút với các sự cố kỹ thuật/phục hồi live. Dữ liệu128ngày đã xem, không đổi tên thành holdout.
3. **Ứng viên entry tiết kiệm phí:** testbed riêng cho post-only/partial/timeout/cancel/unknown; không lấy việc thay5bps thành2bps cho tất cả fills làm chứng cứ maker thực sự tốt hơn. Nếu thiếu diễn biến khớp/queue/spread/timing trong raw data, ghi rõ gate thiếu, giữ taker live và hoàn thiện công cụ kiểm chứng thay vì giả tạo fills.

## Điều kiện áp dụng entry mới vào live

Ứng viên phải tốt hơn baseline về **net sau đầy đủ chi phí trên toàn kỳ** ở cơ sở và stress, giữ mọi ngày âm; không breach15u trong mô hình, sizing/margin/order filters hợp lệ. Cách mô phỏng khớp phải có dữ liệu thích hợp và công bố giả định độ trễ/adverse selection; xử lý partial/cancel chưa rõ không gây gửi trùng hoặc trì hoãn thoát rủi ro. Đủ các gate mới bật theo quyền người dùng đã cấp, không cần hỏi lại. Kết quả thiếu dữ liệu phải là chưa đủ chứng cứ, không phải PASS.

Chỉ một baseline/case và một giả thuyết entry, không chạy tìm tham số TP/RR/sizing. Dùng kiểm tra ưu tiên thấp/cô lập CPU, guard bảo vệ quan sát live; không build/test/replay nặng đồng thời trên VPS956MB. Đóng băng protocol/input hashes trước replay, lưu cả lần chạy không hoàn tất và giới hạn thực tế.

## Telegram

Tin mới dùng “MỞ LỆNH”, “MUA THÊM”, “ĐÓNG MỘT PHẦN”, “ĐÓNG LỆNH”, tên coin, lượng/giá trị và lãi/lỗ sau đúng phí mở/đóng. Phí giữ lệnh tính toàn tài khoản nếu chưa phân bổ được, không gán tùy ý. Báo cáo tách tiền đã ghi nhận với lãi/lỗ của lệnh chưa đóng; lỗi nói rõ hệ thống đang làm gì bằng tiếng Việt. Giữ dedup/owner/lease/catchup và lịch báo cáo; không viết lại hoặc phát lại tin cũ.

Kết quả, gate, kiểm toán, triển khai và các gián đoạn live phát sinh sau đó đã ghi trong biên bản nghiệm thu. Giữ taker đang vận hành; ưu tiên điều tra gián đoạn mới và bổ sung bằng chứng khớp trước khi promote maker.
