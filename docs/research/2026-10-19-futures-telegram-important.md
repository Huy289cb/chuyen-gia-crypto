# Telegram chỉ gửi tin quan trọng — triển khai19/10/2026

Người dùng yêu cầu để cơ chế giao dịch hiện tại vận hành, tối ưu Telegram cho người không biết trade. Đã triển khai **00:43 ICT19/10**; chỉ sửa ba module thông báo/điểm nối worker. Không đổi người nhận, chiến lược, sizing, SL/TP, nguồn07giờ hoặc quyền tự phục hồi. Trần15u/ngày, soft−8,9u/buffer6,1u, guard15giây giữ nguyên.

## Những tin sẽ nhận

- **MỞ LỆNH:** tên coin, mua khi kỳ vọng giá tăng hay bán khi kỳ vọng giá giảm, giá trị và phí; ghi rõ chưa chốt lãi/lỗ.
- **ĐÓNG LỆNH:** coin, lãi/lỗ thực sau phân bổ phí mở và phí đóng; ghi rõ nếu chỉ đóng một phần hoặc số liệu còn chờ sàn.
- **Dừng vì rủi ro hoặc lỗi quan trọng:** lý do tiếng Việt, PnL ngày và việc cần kiểm tra. Lệnh chưa rõ kết quả/tiền hoặc cấu hình lệch/mất mốc đầu ngày vẫn cảnh báo ngay.
- **Lỗi kỹ thuật kéo dài:** các lỗi kết nối/cập nhật chậm đã nhận diện chỉ cảnh báo nếu kéo dài60giây. Một sự cố không lặp cảnh báo mỗi tick; chỉ báo phục hồi sau30giây khỏe liên tục, đã đối soát và tin sự cố đã được Telegram xác nhận gửi cho người nhận.
- **Một báo cáo lúc21giờ Việt Nam:** lãi/lỗ ngày gồm lệnh đang mở, tổng vốn, số lệnh đang giữ và kết quả từ khi chạy. Nếu dữ liệu cũ thì chờ bản mới, không gửi thêm báo cáo cũ rồi sửa nối tiếp.

Tắt tin khởi động/trạng thái, chuẩn bị nguồn/rổ, đang đối soát bình thường, đang phục hồi và các bản tổng kết/cập nhật ngày trùng nhau. Các bước này vẫn có trong nhật ký vận hành. Không gửi sốlãi/lỗ tự suy từ lệnh được chấp nhận; chỉ dùng khớp, phí, funding và sổ giao dịch thật. Tiền hiển thị2số lẻ; số khác0 nhưng nhỏ hơn0,01được ghi rõ, không giả thành0.

## Bảo toàn và nghiệm thu

Outbox giữ nguyên tin đã ACK, retry chưa rõ kết quả và cảnh báo quan trọng. Chỉ tin ưu tiên thấp chưa từng thử gửi mới được đánh dấu im lặng; không xóa lịch sử hoặc gửi lại hàng loạt tin cũ. Versionv1 và cơ chế khóa/ghi nguyên tử/dedup được giữ. Production bật `importantOnly:true`; các tích hợp cũ vẫn dùng mặc định cũ.

**111kiểm thử chức năng PASS**:22formatter cũ,60notifier cũ,14formatter mới và15policy mới. Có ca đối soát phí/lệnh một phần, lỗi tiền chưa rõ, lỗi kỹ thuật thưa/restart, chờACK trước báo phục hồi, chờ khỏe liên tục, một báo cáo ngày và bảo toàn tin cũ/không sửa ví. Rà soát chữ ký/type nguồn độc lập không thấy lệch rõ ràng.

Emit đúng ba module thành công theo options production và cả ba JavaScript qua kiểm tra cú pháp. **Kiểm tra semantic TypeScript toàn phạm vi portfolio chưa hoàn tất**: đã dừng vì áp lực bộ nhớ/I/O trên VPS nhỏ đang giữ lệnh, không ghi PASS. Hai lượt trước cũng giữ receipt dừng thay vì xóa dấu vết; controller validation từng bị treo ở ngưỡng resume quá chặt đã được sửa riêng. Đây không phải thay đổi ngưỡng giám sát của bot. Không chạy lại toàn bộ bộ test sau111PASS vì source đã khóa hash và không đổi.

Chỉ PM2`crypto-portfolio-live` được restart, PID2391682→2480846, PM2save thành công; fileenv không đổi. Checkpoint tiền/outbox giữ private ngoài repo. Lịch sử65khớp/63intents, thu nhập, vốn cấp, config, anchor và ACK cũ được đối chiếu bảo toàn; không có lệnh mới do cập nhật. Bot cũ/paper/post-exit không được bật.

Nghiệm thu **00:43:48→00:44:49,31mẫu**: active toàn bộ, gap cao nhất2517ms, đối soát0, không lỗi/khóa mới. Telegram`important_only`,224tin đã gửi,0pending/0failed. Có1tin dừng worker theo mẫu cũ phát sinh lúc chuyển phiên; fingerprint xác nhận là thông báo shutdown của bản cũ, ACK được giữ nguyên, không gửi lại để sửa câu chữ.5cờuncertain là lịch sử đã ACK, không phải5tin đang chờ. Chưa có giao dịch mới hoặc mốc21giờ mới sau deploy; nội dung mới được kiểm chứng ngoại tuyến, không tạo lệnh/tin giao dịch giả để thử.

[ReviewPnL và hướng cải thiện](2026-10-19-futures-live-pnl-review.md) tách riêng hiệu quả tiền thật và thay đổi thông báo. Gói bằng chứng mới `docs/audits/futures-quick-win/live-telegram-important-20261019` có checksum riêng; không sửa gói cũ. Rollback module thông báo dùng backup private của đúng phiên, restart riêng worker; không khôi phục ví/outbox/cursor từ checkpoint cũ.
