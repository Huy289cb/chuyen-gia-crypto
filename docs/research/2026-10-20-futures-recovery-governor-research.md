# Ngắt vòng tái vào sau sự cố lặp — nghiên cứu biệt lập 20/10/2026

Đã hoàn tất một mô hình admission và replay trên tape sự cố thực tế đã lưu. Không sửa production, gửi lệnh, gửi Telegram, gọi broker hoặc khởi động worker. Live hold hiện hành không thay đổi.

Thiết kế cố định trước replay: sau sự cố đầu, chỉ cho một lần chuẩn bị kế hoạch phục hồi tự động khi **tất cả** cổng hiện có đã đạt. Một sự cố kỹ thuật mới sau khi đã dùng lần thử đó sẽ khóa các đường tăng vị thế; khóa tồn tại qua ngày mới, nguồn mới và khởi động lại. Có bằng chứng sửa hạ tầng được xác minh riêng mới cấp lại một lần thử; vẫn phải qua mọi cổng vốn/rủi ro/đối soát/nguồn. Không dùng một thời gian chờ tùy ý, không thay guard15giây, cap12u/ngày, soft−5,9u hay reserve6,1u. Đây là đề xuất nghiên cứu, chưa phải thay đổi đã được áp dụng.

Mục đích là xử lý việc mã hiện tại chỉ giới hạn một lần thử **trong từng incident**, rồi incident mới cấp lại quyền. Trong `live-service.ts`, `latch` xóa recovery khi một monitoring latch mới xuất hiện; `prepareTechnicalRecovery` tạo incident mới và quyền mới. Ba mươi giây khỏe không chứng minh hạ tầng đã ổn định dài hạn.

| Kết quả trên tape cố định | Số lượng |
|---|---:|
| Sự cố kỹ thuật có bản ghi | 29 |
| Đề nghị kế hoạch recovery có bản ghi | 27 |
| Bản ghi resumed của hệ thống đang có | 26 |
| Đề nghị được mô hình mới chấp nhận | 1 |
| Đề nghị bị mô hình mới chặn | 26 |
| Bằng chứng remediation giả định thêm | 0 |
| Nhóm kiểm thử lỗi trạng thái | 11/11 đạt |
| Kiểm tra prefix độc lập, không import mô hình | 57/57 đạt |

26 đề nghị bị chặn gắn với101lệnh đã khớp,3intent bị từ chối,127dòng khớp và **1,01842821u phí vào lệnh thực tế** trong lịch sử. Đây là phép nối mô tả, **không phải số phí tiết kiệm được**. Một khi không tái vào thì vị thế, lãi/lỗ, funding, lệnh đóng và sự cố tiếp theo sẽ khác. Chưa có mô phỏng phản thực để kết luận ROI tăng/giảm. Tape có dừng có chủ đích và triển khai, không phải một thí nghiệm hạ tầng ổn định.

26 khoảng từ resumed đến sự cố sau có tối thiểu84,001giây, trung vị956,7555giây. Đây là mô tả, không dùng để tối ưu thời gian chờ. Khóa bền vững đề xuất sẽ chặn cả các sự cố cách xa nhau nếu chưa có bằng chứng sửa; có thể bỏ lỡ cơ hội sinh lời và giảm thời gian giao dịch. Chưa có cơ chế cấp bằng chứng sửa hạ tầng tự động đã kiểm chứng, nên không tuyên bố đã đạt vận hành24/24.

## Chứng cứ nguyên nhân đóng

148intent đóng rủi ro vẫn không có trường lý do latch chính xác được lưu cùng intent. Có thể nối137/148intent với telemetry chứa tham chiếu đúng intent và trạng thái đang khóa `live_monitoring_gap` trong60giây sau lúc tạo. Có71dòng chuyển trạng thái đang khóa với cùng lý do. Đây là ngữ cảnh hỗ trợ, không chứng nhận nguyên nhân chính xác tại POST cho mọi intent.11intent chưa có ngữ cảnh phù hợp; không suy toàn bộ148intent đóng là do một nguyên nhân.

Tape trước thay đổi ngày19/10 có cap15u/soft−8,9u; sau revision dùng12u/−5,9u. Nghiên cứu này chỉ phủ thêm cổng nhận lệnh lên các đề nghị đã có, không giả vờ đã kiểm lại toàn bộ giao dịch cũ dưới cap12u. Thiết kế tương lai phải giữ chính sách hiện hành12/−5,9/6,1/15giây và user hold.

## Những gì kiểm thử đã chứng minh

Mô hình chặn các đường daily/pending/recovery khi khóa; sự cố giữa các chân rổ vô hiệu permit còn lại; permit cũ không có hiệu lực sau fault/rearm; khởi động lại và ngày/nguồn mới không làm mất ngân sách; lỗi/khởi động lại sau reservation không cấp lại lần thử. Rearm và ngay trước POST đều phải có cổng hiện có đạt và không có user hold. Cổng bổ sung không chặn nghiệp vụ giảm vị thế; bộ cổng đóng lệnh hiện hữu vẫn chịu trách nhiệm quyết định lệnh đóng. Không có thao tác sửa tiền, anchor ngày, cursor hoặc ledger.

Đây là mô hình Python biệt lập, không gọi mã đặt lệnh thật. `base_allowed` là sự hội đủ các cổng hiện có do bên gọi cung cấp; mô hình không độc lập tái dựng tài chính/nguồn/support lịch sử. Các kiểm thử không thay thế kiểm thử tích hợp TypeScript, filesystem/concurrency, xác nhận khớp từng phần, đối soát lệnh chưa rõ và khả năng giữ giới hạn khi thị trường gap.

## Bước tích hợp có thể kiểm chứng

1. Lưu lý do latch, tất cả stopReasons, liên kết incident và mốc giám sát/quote/ghi sổ/POST vào close intent **trước** đặt lệnh. Không chỉ dựa vào trạng thái cuối ngày hoặc Telegram.
2. Lưu trạng thái governor cùng khóa ví và transaction bền vững khi dự trữ quyền phục hồi. Trạng thái lỗi/không biết phiên bản phải chặn entry; không để file tùy chọn riêng dễ mất sau reboot.
3. Gate nguồn thường lệ, pending plan, recovery và từng POST tăng vị thế. Fault mới vô hiệu generation của plan cũ; vẫn giám sát/đối soát/giảm vị thế. Không reset khóa theo ngày, nguồn, lịch sử giá hoặc30giây khỏe.
4. Định nghĩa bằng chứng sửa hạ tầng và quyền xác nhận, rồi fault injection lỗi ghi đĩa/crash/restart/race/partial fills/stale permit, sau đó replay giá+execution+fault để đo ROI cùng chi phí. Chưa triển khai live chỉ vì kiểm thử state machine đạt.

Học mô thức trạng thái half-open/giới hạn probes, mở lại khi lỗi, theo dõi và override từ [Microsoft Circuit Breaker pattern](https://learn.microsoft.com/en-us/azure/architecture/patterns/circuit-breaker), truy cập20/10/2026. Thiết kế chính xác một lần thử và rearm bằng bằng chứng sửa là thích nghi của ta; nguồn không chứng minh lợi nhuận giao dịch hoặc các ngưỡng của bot.

`protocol.json` được khóa trước replay; `implementation-freeze.json` khóa mô hình và11test trước replay. `results.json` và `sanitized-trace.json` chỉ chứa dữ liệu tổng hợp/chỉ số nội bộ an toàn, không xuất ID tài khoản/lệnh/khớp/source/incident. `verify_results.py` dựng độc lập logic phủ trên trace và kiểm mọi prefix; `manifest.json` khóa gói này. Ví thật nguồn giữ nguyên SHA256 `3e718d1f24de9568e7538d4f5beb5881139db5c7e0ca04dfa5be0607e9aaf0ec`.


## Hậu kiểm và bản sửa mô hình

Review độc lập phát hiện V1 nhận JSON thiếu trường và tự điền trạng thái mới, có thể làm mất khóa trong mô hình. Bản dẫn xuất chỉ sửa loader: bắt buộc đủ9trường, đúng kiểu, không khóa JSON trùng, generation/lịch sử và quan hệ trạng thái hợp lệ.20nhóm kiểm thử đạt,72ca thiếu trường bị chặn; logic chuyển trạng thái giữ nguyên. Review thêm16.000lần lưu/đọc trạng thái hợp lệ đạt. Tape56event/57prefix vẫn1đề nghị nhận và26bị chặn. Đây là sửa model Python nghiên cứu, không phải lỗi đã được xác nhận hoặc vá trong bot TypeScript thật.

Còn hai giới hạn nhỏ đã tái hiện: tổ hợp pause=true/probe=true/hold=false không thể tạo bằng các phương thức hợp lệ vẫn được loader nhận; mọi đường entry vẫn bị chặn nhưng không thể rearm. JSON lồng rất sâu có thể ném RecursionError thay vì ValueError. Vì vậy không tuyên bố mọi input lỗi đã được xử lý hoàn chỉnh. Không sửa âm thầm hai gói đã khóa để giấu phát hiện.

**Chưa đủ triển khai production.** Cần ràng buộc permit với thời hạn/chân/khối lượng, xác minh bằng chứng sửa hạ tầng, xử lý transaction/crash/race, tích hợp mọi đường tăng vị thế và replay giá+execution+fault trước khi kết luận về ROI. Mô hình một lần thử rồi giữ khóa có thể bỏ lỡ nhiều ngày sinh lời; chưa được chọn làm rule vận hành. Giữ live dừng và12/−5,9/6,1/15giây.

[Gói V1 và trace](../audits/futures-quick-win/roi-positive-recovery-governor-20261020/README.md) · [Bản sửa loader biệt lập](../audits/futures-quick-win/roi-positive-recovery-governor-hardening-20261020/README.md).
