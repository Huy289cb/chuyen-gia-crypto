# Giả thuyết ROI tiếp theo sau tracking-cost512 — 21/10/2026

Trạng thái: **F_DESIGN_ONLY — chưa tạo tín hiệu512 ngày, chưa implement engine signed, chưa đăng ký hoặc chạy PnL.** Không mở thêm phép thử tài chính trong đợt tracking-cost vừa hoàn tất.

[Kết quả mới](../research/2026-10-20-futures-cct-tracking-cost-512-day-results.md) tăng net so CCT gốc nhưng còn0,015866u/0,012207u mỗi ngày lịch. Phần giá trước chi phí trên cùng vị thế cũng chỉ khoảng0,020340u/0,018148u/ngày. Chọn bản này làm đối chứng nghiên cứu, giữ cả biến thể active allocation như nhánh đánh đổi. Chưa có bằng chứng giảm phí tiếp đủ đạt0,2u/ngày.

## Một giả thuyết cần kiểm khả thi

Khảo sát CCT hai chiều long/short để có thể tham gia xu hướng giảm, giữ bộ chín kênh Donchian, vol90, sizing6 và band20 làm cấu hình nghiên cứu đầu tiên. Cơ chế short có thể kiếm tiền trong nhịp giảm, đồng thời chịu squeeze, phí và funding khác; chưa có bằng chứng tăng PnL của cấu hình này. Không ghép nhiều thay đổi/sweep hoặc chọn coin thắng từ kết quả cũ.

Catalogue hồ sơ đã rà không tìm thấy đúng phép thử512 ngày/B5/scalar6/vốn31,47744546u/trần12. Có phép thử long/short trước đó64ngày, scalar8/vốn100u/trần10u/nến5phút: net−27,047105u/−28,901806u, ngày xấu nhất−12,684905u/−12,793517u, vượt trần ngày. Giữ kết quả thất bại này; khác cấu hình không biến nó thành bằng chứng dương hoặc holdout mới.

Generator đã khóa có nhánh signed từ bản port của ta theo appendix. Bản code tham khảo đã khóa của LineGM là long/cash; không gọi signed là replica nguyên byte hoặc tài khoản công khai đã chứng minh. Bộ loader512 và engine admission hiện nhận/vận hành long-only, nên chỉ đổi cờ mode sẽ từ chối hoặc thực hiện sai ý nghĩa short.

## Việc cần xong trước khi có quyền chạy PnL mới

1. Lập đặc tả inventory có dấu: short/open, cover/reduce-only, flip phải đóng phần cũ rồi mới xét phần tăng mới; giá bid/ask, phí và funding theo lượng có dấu.
2. Chỉ tái dùng projector/admission khi đã chứng minh xử lý đúng signed delta, margin, close reserve và strictlyinside day boundary; không suy từ test long/cash rằng short đã an toàn. Từ chối short/flip khi không đủ nguồn lực/rủi ro, không xóa khóa tài chính.
3. Fixed functional/fault tests trước nguồn lịch sử: lot/delta tối thiểu, tăng/giảm/flip, gap/spread, funding cả hai dấu, partial fill/UNKNOWN/restart và đối soát. Kiểm toán độc lập phương trình cash/NAV/realized/unrealized, không gọi model nhỏ là test toàn engine.
4. Giữ vốn tham chiếu31,47744546u, cap12/soft−5,9/buffer6,1; gross8/leverage10 là cấu hình thử nghiệm giữ nguyên. Không mang buffer0,10 của trial thất bại cũ sang. Các rule ICT/SMC/cooldown/risk mỗi lệnh đã bỏ không được phục hồi.
5. Nếu khả thi mới dựng một bộ nguồn causal512ngày và review/freeze; đăng ký trước PnL đúng hai chi phí, một ví liên tục, funding thật, đóng cuối kỳ, cùng money/risk audit. Dùng kết quả tracking-cost hiện có làm đối chứng, không chạy lại ca cũ. Toàn bộ512ngày đã xem vẫn là development.

Báo riêng dương, tốt hơn đối chứng ở cả hai chi phí, rủi ro và mục tiêu0,2u/ngày lịch=102,4u/512ngày. Không thêm yêu cầu mọi ngày/tháng/nửa kỳ có lãi. Nếu không khả thi hoặc không hiệu quả, lưu kết quả; không tự nới trần12 hoặc đổi tham số sau khi thấy kết quả để tìm bản thắng.

Song song, [đo giám sát](2026-10-21-futures-monitoring-phase-instrumentation.md) là nhánh vận hành riêng, chưa implement. Live/userhold/bootstopped giữ nguyên, guard15giây/quote5giây và durable transaction không đổi. Phép thử nguồn giá không chứng nhận phục hồi thật hoặc ổn định24/24. Khi có ứng viên đạt, vẫn cần kiểm đúng vốn thật/filters/lifecycle và tích hợp; chưa đổi live trong kế hoạch này.

[Catalogue và hash nguồn đã rà](/home/ubuntu/futures-roi-positive-research-20261020/next-method-catalogue-20261021.json). “Chưa tìm thấy” giới hạn trong các hồ sơ ghi trong catalogue, không tuyên bố chưa ai từng thử hoặc phương pháp có lời trên internet.
