> **Phạm vi mới ngày12/10/2026:** Dùng [lộ trình](2026-10-12-futures-system-research-roadmap.md) và [policy](../runtime-risk-policy.md): cải thiện toàn hệ thống, bỏ trading rule cũ, mục tiêu100u/10u lỗ ngày/no count cap/mean khoảng1u/ngày và chấp nhận ngày âm. Goal/đồng hồ/candidate/risk/must tăng fills trong văn bản dưới là lịch sử, không resume qua cập nhật docs. Giữ nguyên tắc có terminal, chi phí, cutoff, không polling hoặc lặp thử nguyên trạng; áp vào work package mới, không dùng chúng khôi phục giới hạn giao dịch cũ.

> **Quyền thử nghiệm cập nhật08/10/2026:** Người dùng: “nếu là thử nghiệm thì luôn chấp thuận, khi có hiệu quả thì trình bày lại thay đổi gì là được”. Chủ động thực hiện thử nghiệm trong phạm vi nghiên cứu đã chốt, không xin lại phép từng run/budget hợp lý. Vẫn đăng ký phiên bản/cost/cutoff, giữ BTC/daily10/cooldown1h/exposure/SLfloor0,8%/target0,5% và các guard khác; không lặp nguyên trạng để tìm kết quả dương. Quyền này không thay thế bằng chứng ROIbase/stress/fills độc lập hoặc tự cho phép rollout candidate. Khi có hiệu quả, trình bày thay đổi và bằng chứng.

# Quy tắc điều phối goal ROI — 04/10/2026

Quy tắc bắt buộc theo yêu cầu người dùng; ưu tiên hơn chỉ thị next-action lịch sử. Không thay đổi quyền rủi ro hoặc tiêu chuẩn rollout.

## Đích chính

ROI kinh tế ròng toàn danh mục BTC dương ở base và stress, sau phí, funding, slippage và AI; số lệnh khớp độc lập có chất lượng tăng so với baseline cùng vốn/kỳ/policy. Setup, pending, test pass và tối ưu hạ tầng chỉ là bằng chứng hỗ trợ. Không suy phần trăm hoàn thành từ giờ chạy hoặc số file/test.

## Đánh giá lại sau mỗi 1 giờ chạy goal

Dùng `get_goal().goal.timeUsedSeconds` làm đồng hồ tích lũy, không dùng giờ thị trường hay giờ treo khi paused. Lưu mốc đánh giá vào `docs/plan/roi-goal-hourly-review.md`. Kiểm tra ở đầu mỗi lượt, trước tác vụ dài và ngay sau tác vụ; nếu tăng ít nhất 3600 giây so với mốc gần nhất, phải đánh giá trước khi tiếp tục. Không reset mốc qua resume/compaction. Nếu vượt nhiều mốc, ghi độ trễ thật, không dựng báo cáo giờ đã bỏ lỡ. Tác vụ dài phải có checkpoint/cutoff để có thể đánh giá; không tạo vòng chat sleep nhằm đủ một giờ.

Mỗi đánh giá phải ghi ngắn gọn:

1. Mục tiêu chính và gate F/P/E còn thiếu; artifact mới thực sự trả lời được điều gì?
2. Fills độc lập, ROI base/stress, chi phí và coverage hiện biết; thiếu bằng chứng ghi unknown, không ghi 0.
3. Giờ vừa qua có loại được blocker trên đường tới phép đo kinh tế không? Phân biệt tiến triển kỹ thuật với tiến triển mục tiêu.
4. Một blocker ưu tiên và một việc kế tiếp, với đầu ra kiểm chứng, ngân sách thời gian/provider và điều kiện dừng.
5. Quyết định tiếp tục/đổi cách làm/dừng nhánh cùng lý do và nguồn bằng chứng.

Nếu một giờ không có bằng chứng mới liên quan mục tiêu hoặc không loại được blocker: không tiếp tục cách làm cũ. Chẩn đoán, đổi phương pháp hoặc dừng nhánh; không mở thêm hạ tầng/giả thuyết để thay thế kết quả. Nếu hai kỳ liên tiếp không tiến triển, bắt buộc thu hẹp về một blocker; báo rõ giới hạn và kết luận chưa đạt. Không tự pause/mark blocked/complete trái quy tắc công cụ goal.

## Chặn lỗi điều phối đã xảy ra

- Không lấy polling/sleep/background checkpoint làm công việc chính; làm phần độc lập hữu ích. Nếu không còn việc độc lập, kết thúc lượt với trạng thái thật thay vì vòng chờ chat. Không cần chờ dữ liệu live khi lịch sử đủ cho phép đo đã đăng ký.
- Trước replay dài, kiểm chứng đầu vào H1/H2 qua workflow thật: producer → gate → reviewer → executor → lifecycle. Từ chối hợp lệ là kết quả; pending không phải fill. Không giả grade/confidence, sửa levels hoặc bỏ guard để ép lệnh.
- Phát hiện gate không nhận mô hình hoặc bottleneck hiệu năng thì ưu tiên sửa nguyên nhân có bằng chứng trong phiên bản riêng. Không sửa source/runtime của run đang đóng băng; run cũ không là phụ thuộc bắt buộc của việc sửa độc lập.
- Không chạy lại admission/baseline/helper đã đóng nếu không có lỗi hoặc bằng chứng mới. Không tự kéo dài cutoff, tăng ngân sách hoặc mở cơ chế thứ ba.
- Chỉ chạy danh mục sau khi đầu vào/tính đúng/tốc độ đủ dùng đã có bằng chứng. Đăng ký cửa sổ, phiên bản, costs, baseline và cutoff trước; khi dừng xuất kết quả kể cả partial/failure. Không có terminal artifact thì không tuyên bố phép đo hoàn thành.

## Thứ tự resume hiện tại

1. Đọc journal proof đã pass; không lặp test này nếu không sửa implementation hoặc tìm thấy lỗi mới.
2. Xử lý tương thích chấm điểm H1/H2 với gate bằng tiêu chí đăng ký trước và candle evidence, giữ guards. Kiểm chứng quyết định xuyên suốt workflow thật trong tài khoản cô lập; không hứa phải tạo lệnh.
3. Kiểm chứng hiệu năng bản journal mới bằng dữ liệu cô lập phù hợp quy mô. Nếu không đủ throughput, sửa bottleneck trước replay dài.
4. Đánh giá artifacts run cũ khi terminal; đăng ký phép đo danh mục candidate/baseline cùng điều kiện chỉ khi các bước trên đủ bằng chứng. Sau đó kết luận ROI/fills base/stress; không đạt thì báo không đạt và nguyên nhân.

Goal hiện paused theo trạng thái công cụ tại lần cập nhật này. Đây là cập nhật chỉ thị, không resume, không thay live, không cam kết ROI+.
