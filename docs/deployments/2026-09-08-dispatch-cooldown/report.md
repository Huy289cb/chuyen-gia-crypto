# Kiểm tra cooldown trước khi tiêu thụ tín hiệu

Triển khai **20:37:59 ICT ngày 08/09/2026**. Lúc 16:01, retest range đã được durable claim và AI xác nhận trước khi executor từ chối vì cooldown sau lỗ 360 phút còn 120 phút. Admission mới dùng chính guard post-close của executor trước bước claim và AI. Giữ kiểm tra lần nữa tại executor để bảo vệ khi trạng thái tài khoản thay đổi giữa các bước.

Không giảm thời gian nghỉ. Tín hiệu còn hạn được chờ; peek hiện có xóa tín hiệu hết hạn. Không khôi phục tín hiệu 16:01 đã bị claim hay cưỡng bức đặt lệnh.

**42 kiểm thử/3 file đạt** gồm fixture tái hiện thời điểm 4 giờ sau lỗ và mở eligibility đúng ranh giới 6 giờ; các kiểm thử executor rủi ro 1 USDT và durable claim đạt. Full TypeScript build đạt. Chỉ thay `services/v3-entry-eligibility.service.js` trong 177 file JS; đối chiếu hash xác minh các module khác giữ nguyên.

API khỏe. PID API 3533441, worker 3533452. Đọc env thực: trần 1 USDT/lệnh, ngày 3%, post-close 90 phút, sau lỗ 360 phút, range live RR1,5. Đối soát sàn sau triển khai: không vị thế/lệnh chờ/lệnh bảo vệ; ví 33,59964603 USDT.

Phần nghiên cứu cũng bổ sung post-close cooldown như một lựa chọn replay riêng, qua 11 kiểm thử/2 file. Các module replay không được đưa vào bản live. Kết quả nghiên cứu tại `../../audits/2026-09-08-post-close-parity/`.

Giới hạn: sửa admission tránh tiêu thụ tín hiệu quá sớm; không bảo đảm tín hiệu sẽ còn hiệu lực sau cooldown hoặc vượt qua các guard khác như ngân sách ngày. Chưa chứng minh ROI+ live từ thay đổi này.
