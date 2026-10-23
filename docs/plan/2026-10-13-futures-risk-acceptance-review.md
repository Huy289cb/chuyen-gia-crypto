# Chấp nhận mạo hiểm: sửa phạm vi kết luận và gate nghiên cứu

Ngày 13/10/2026 ICT, theo phản hồi của người dùng. **Được nghiên cứu phương án mạo hiểm; chưa có bằng chứng mục tiêu bất khả thi.** Chỉ giữ [policy](../runtime-risk-policy.md): vốn100u, chung cố định10u/ngàyICT, không giới hạn lệnh, chấp nhận ngày âm/dương và mục tiêu khoảng1u/ngày. Không tự bỏ10u vì người dùng nhắc lại chấp nhận mạo hiểm.

## Những gì thực sự đã thử

- [QW1](../audits/futures-quick-win/qw1-20261012T132319Z/report.md): một seed SOL, leverage nghiên cứu5 thay seed10, MTM ngày xấu nhất−2,37u/−2,33u. Kết quả loại config, chưa kiểm một thiết kế sử dụng phần lớn ngân sách10u. Không suy ra cứ dùng hết ngân sách sẽ có lãi.
- [Screen SOL](../audits/futures-quick-win/screen-20261013T124932Z/report.md) và [relative reversal](../audits/futures-quick-win/cross-20261013T132038Z/report.md): fractional event/basket diagnostics; chưa đo stop/sizing/governor10/tài khoản100u. Âm trong cấu hình cố định không bác bỏ mọi thiết kế quản trị vị thế của cơ chế.
- Gate lower95%stressmean>0 trước full replay ở kế hoạch spillover là điều kiện tự đặt, chặt hơn yêu cầu của người dùng. Nó chưa làm thay đổi verdict các screen đã âm; bỏ gate không biến chúng thành dương.

## Thay đổi từ review này

Ứng viên có net dương base/stress nhưng interval chứazero vẫn được nghiên cứu tài khoản tiếp, ghi rõ chưa chắc chắn. Control dùng để đo giá trị biên của peers, không loại một own-model dương chỉ vì model khác không thắng. Không cần bằng chứng lợi nhuận chắc chắn trước khi làm thử nghiệm.

Thiết kế tài khoản phải gồm strategy, stop, sizing, execution và governor; đăng ký mức notional/leverage theo margin, stop distance, phí và ngân sách còn lại của cả tài khoản. Có thể thử mức rủi ro lớn hơn cap cũ, tối đa trong10u chung, không bắt buộc phải dùng hết10u. Dừng khi governor yêu cầu; lưu breach/overshoot thật. SL/mark-gap assumptions phải báo, không bảo đảm tuyệt đối trần ngoài sàn.

Có thể phát triển tham số trên development theo một phạm vi hữu hạn khóa trước, sau đó kiểm validation riêng; history đã xem phải ghi đúng. Không sửa frozen runs, xóa thất bại, đổi gate của phép đo đã kết thúc hoặc retune trên validation để tìm kết quả dương. Tăng size đơn thuần của cùng trades không là bằng chứng tạo edge. [CME giải thích leverage](https://www.cmegroup.com/education/courses/understanding-the-benefits-of-futures/the-power-of-leverage) là cơ chế tăng exposure qua margin, khuếch đại cả lời/lỗ; leverage setting riêng chưa xác định toàn bộ rủi ro.

**Kế tiếp vẫn là [spillover + own-return control](2026-10-13-futures-spillover-screen.md), chưa chạy.** Feasibility360ngày training → protocol/source/data trước return → screen → nếu có ứng viên thì replay tài khoản100u với thiết kế rủi ro nêu trên. Đây là sửa cách thực hiện nghiên cứu, không tìm được phương pháp đạt1u/ngày hoặc thay runtime. Không goal công cụ mới, privateAPI/paidLLM/orders/transfers/runtime deployment.
