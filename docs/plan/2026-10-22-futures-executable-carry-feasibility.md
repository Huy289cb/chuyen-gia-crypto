# Phép thử tiếp theo sau đối chiếu Codex/Claude — 22/10/2026

Trạng thái: **STOPPED 23/10**. Người dùng dừng dự án nghiên cứu. [Biên bản dừng](../research/2026-10-23-futures-roi-research-stop.md). Carry 2+2 vẫn là sleeve nhỏ chưa có lot, không phải đường tới 0,2u/ngày. Không chạy PnL 512, không dựng engine signed để đuổi mục tiêu, không đổi live.

[Bản đối chiếu](../research/2026-10-22-futures-codex-claude-roi-review.md). Sổ đã audit tốt nhất là CCT tracking-cost: 0,015866u/0,012207u mỗi ngày. Mục tiêu 0,2u ở cả hai phí. Cắt phí và sửa điểm phân bổ không đủ. Màn hình Claude chưa được tính là kết quả.

## Quyết định 22/10

Sổ đã audit không kéo lên 0,2u/ngày bằng đòn bẩy: tracking-cost phí cao 0,012u/ngày, ngày xấu −6,9u. Nhân 16 lần để tới 0,2u thì ngày xấu thành khoảng −110u, vượt trần 12. Màn hình thô tốt nhất khi còn trong soft −5,9 là khoảng 0,045u/ngày và có chọn hệ số trên cửa sổ test. Carry 2+2, phần cơ chế thật, khoảng 0,006u/ngày trên DEV. Cộng các sleeve đã sống vẫn dưới 0,05u/ngày. Kho dữ liệu không có open interest, lệnh khớp, hay sổ lệnh.

Việc làm bây giờ: dừng vòng CCT, screen và combo trên cùng 512 ngày. Giữ live dừng, giữ cap 12. Không nới trần để gọi là đạt.

Người dùng 23/10 bác mức khoảng 0,03u/ngày: khoảng 12u/năm trên ví 31u, ngày xấu đã −9,82u, nên gửi ngân hàng hơn việc chạy bot. Giữ live dừng. Không hạ mục tiêu rồi triển khai.

LLM veto một lần trên cùng sổ DEV: Qwen flat 839/987 ngày, mean −0,0079u, ngày xấu −2,67u, net −7,84u. NOT_BETTER. Claude Sonnet 5.5 trên 8 ngày lỗ và 8 ngày lời: cho qua 7/8 ngày lỗ, gồm −9,82u, và cho qua cả 8 ngày lời. Không gọi đủ 987 ngày. Trên key không có FinGPT, Bloomberg hay model futures riêng. DeepSeek và Jev router có mặt nhưng bảng paper công khai không đo ví 31u/trần 12u. Không đổi model để chấm lại.

Cửa dữ liệu mới đã có một luật khóa trên DEV, chưa đụng cửa sổ 512. Taker continuation B5, gross 1, phí cao: mean 0,0338u/ngày, ngày xấu −9,82u, net +33,32u / 987 ngày. Bản đảo dấu âm cả hai phí. Gross 8 phá ví trong mô hình ngày vì một ngày vượt quá vốn. Kéo gross 1 tới sát trần 12 chỉ còn khoảng 0,04u/ngày. **MISSES_DEV_GOAL.** Không mở lưới hệ số và không chạy 512.

## Một giả thuyết

Carry funding có thể đặt được: mỗi tuần, trong các coin đủ min notional tại thời điểm quyết định, mua hai coin có trung bình funding 7 ngày thấp nhất và bán hai coin có trung bình cao nhất, dollar-neutral, gross 1. Cơ chế là phần bù funding chéo, không phải xu hướng giá. Bản đảo dấu của rổ rộng đã âm ở cả DEV và TEST trong màn hình thô; điều đó chỉ biện minh cho một lần đo book 2+2, không phải bằng chứng book 2+2 có lãi.

Book 39 coin chia năm nhóm không đặt được tại ví 31,47744546u vì mỗi chân dưới min notional. Book 2+2 là chiến lược khác và phải được đo lại. Không lấy hệ số range breakout đã chọn trên cửa sổ 512. Không mở CCT signed 512 làm đường tới 0,2u: ca signed 64 ngày đã lỗ, và long/short xu hướng trên DEV không bền. Đặc tả signed của Codex giữ là việc engine riêng, không phải phép thử này.

## Chẩn đoán trên đúng công thức màn hình cũ — 22/10

Funding đã có từ 2022-09-01 với 29/39 coin phủ hết DEV; 39/39 coin phủ cửa sổ 512. ICP trống. Rổ năm nhóm, phí cao, gross 1: mỗi bên khoảng 7 coin, mỗi chân 2,25u, dưới min notional khoảng 5u. Book đó không đặt được.

Cùng công thức, khóa 2 long + 2 short, phí cao, gross 1, chưa lot và chưa cap: mỗi chân 7,87u. DEV 987 ngày: giá −3,2 điểm phần trăm, funding +42,4, phí −20,3, còn khoảng +5,9u trên ví 31,48u, tức khoảng 0,006u/ngày. Cửa sổ 512: giá +19,7, funding +16,0, phí −14,0, còn khoảng +6,8u, tức khoảng 0,013u/ngày. Phần TEST của rổ rộng còn lệch hơn: giá +28,0 điểm, funding +10,4. Sharpe TEST mà màn hình đã báo là phần giá của các coin được chọn, funding chỉ là một phần.

Vì vậy hướng carry còn đo được và book 2+2 đủ cỡ lệnh. Biên funding sau phí ở mức vài phần nghìn u mỗi ngày. Kéo gross lên để đuổi 0,2u sẽ kéo theo phần giá, đúng thứ đã làm ngày xấu chạm trần 12.

## Khóa trước khi tính

- Cửa sổ duy nhất của lần này: DEV 2022-09-05 → 2025-05-19. Cửa sổ 512 ngày 2025-05-20 → 2026-10-13 không được đọc để chọn coin, lookback, số chân, hoặc gross.
- Lookback funding 7 ngày, tái cân bằng 7 ngày, 2 long + 2 short. Không thử lookback 3/30 hay 3+3 trong cùng lần.
- Ví 31,47744546u. Gross 1, dollar-neutral. Cap 12 và soft −5,9 áp vào đường ngày. Phí 7 bps và 12 bps mỗi chiều là hai ca, không phải hai mẫu thị trường.
- Lot làm tròn xuống. Chân không đủ min notional tại giá đã biết thì bỏ qua kỳ đó, không nâng notional. Funding dùng bản ghi đã có trong `futures-roi-plus-screen-20261021/funding40/` nếu đủ phủ DEV; thiếu thì ghi thiếu, không điền 0.
- Đối chứng bắt buộc cùng rule, cùng lot: đảo dấu. Nếu bản đảo lãi và bản thuận không, giả thuyết sai.

## Cổng dừng

Chỉ được viết phương án engine 512 sau này khi **cả hai** điều sau đúng trên DEV, ở ca phí cao:

1. Net sau phí, funding và lot > 0.
2. Ngày xấu nhất ≥ −12u, và bản đảo dấu không phải bản có lãi.

Không đạt thì dừng carry 2+2. Không đổi số chân sau khi thấy PnL. Một lần đạt DEV vẫn chưa phải 0,2u/ngày và chưa được chạy 512 trong cùng lượt. Live, cap 12, soft −5,9, buffer 6,1, marker hold và sổ tiền giữ nguyên.
