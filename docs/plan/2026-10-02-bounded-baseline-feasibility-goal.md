# Goal mới: baseline replay và kết luận khả thi

Trạng thái: goal đã complete ngày02/10/2026 sau khi giao bốn đầu ra và kiểm tra completion audit. Kết luận: chưa thể xác nhận baseline end-to-end và cơ hội độc lập vì thiếu dữ liệu cụ thể; chưa đạt ROI+. Xem [quyết định](../audits/2026-10-02-bounded-baseline/decision-report.md) và [completion audit](../audits/2026-10-02-bounded-baseline/completion-audit.json).

## Mục tiêu của chặng

Hoàn thiện baseline live–replay có phiên bản và kết luận liệu cấu hình hiện tại có đủ không gian đặt lệnh cho nghiên cứu ROI+ và tăng fills có chất lượng. Giao một quyết định có bằng chứng: đi tiếp, dừng nhánh vì không khả thi, hoặc chưa thể xác nhận vì thiếu dữ liệu cụ thể.

Hoàn thành chặng này không đồng nghĩa đã chứng minh chiến lược có lợi nhuận.

## Phạm vi khóa

BTC; cooldown1h; ngân sách ngày10%; tối đa rủi ro mỗi lệnh3% số dư gồm reserve; SL floor0,8%; target sizing0,5%; exposure100USDT; không trần risk USD cố định. Không đổi cấu hình/model để tạo thêm lệnh, reset circuit hoặc gửi test order. Tái sử dụng audit và release hiện có theo runtime-risk-policy.md.

## Đầu ra bắt buộc

1. **Baseline manifest:** exact runtime code/config/model/prompt, kỳ dữ liệu, account initial state, candle cutoff và registry dữ liệu đã xem. Snapshot hiện tại không giả làm state lịch sử.
2. **Ma trận replay:** quyết định/admission, quantity/risk/account/circuit, pending TTL/cancel/fill/partial/protection/close và fee/funding/AI. Mỗi mục có bằng chứng actual matched, mismatch hoặc unknown. Synthetic regressions ghi riêng; dùng production paths, không thêm simulator chiến lược khác.
3. **Báo cáo khả thi:** tập cơ hội có coverage và identity/dedup rõ ràng; financial envelope theo đúng timestamp/account/filter/residual exposure; phân biệt setup, plan khả thi, order, fill và close. Không gọi dispatch lặp là cơ hội độc lập.
4. **Quyết định:** phần baseline đã/chưa kiểm chứng, ràng buộc tài chính, dữ liệu thiếu và điều kiện cụ thể để nghiên cứu edge tiếp. Không tuyên bố ROI+ từ phép tính khớp hoặc một lát dữ liệu dương.

## Giới hạn và điểm dừng

- Một chặng audit với manifest/cutoff đóng băng; một lượt kiểm tra từng mục còn thiếu, sửa mismatch tái hiện được và kiểm tra hồi quy thích hợp. Chỉ chạy lại khi có sửa đổi hoặc bằng chứng mới liên quan trực tiếp.
- Không mở sweep RR/TP/model/confidence; không chạy lại các candidate ICT đã thất bại hay mở reserved validation khi chưa đủ điều kiện.
- Không chờ vô hạn có fill. Nếu không có actual input/state để xác nhận một phần, ghi unknown và kết thúc với kết luận chưa thể xác nhận cùng danh sách thiếu, thay vì tự gia hạn vòng thu dữ liệu.
- Nếu miền đặt lệnh không đủ khả thi trong cấu hình khóa, kết thúc với kết luận dừng nhánh. Không tự yêu cầu thêm vốn hoặc nới rủi ro như giải pháp tạo edge.
- Nếu baseline đạt và miền khả thi có bằng chứng, kết thúc chặng bằng đề xuất nghiên cứu tối đa hai cơ chế có cơ sở. Nghiên cứu chiến lược là chặng tiếp theo, không tự mở trong goal này.

## Lịch sử đăng ký

Lần đầu create_goal bị từ chối vì goal `resume` chưa kết thúc. Sau khi người dùng clear, get_goal trả null và create_goal thành công trong cùng thread. Không đánh dấu giả goal cũ complete, không thay đổi vận hành bot để đăng ký goal.
