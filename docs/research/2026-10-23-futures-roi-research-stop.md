# Dừng nghiên cứu ROI futures — 23/10/2026

Trạng thái: **STOPPED**. Người dùng chốt dừng dự án nghiên cứu này. Live giữ tắt. Không hạ mục tiêu 0,2u/ngày để triển khai. Không mở agent LLM, không chạy thêm model, không nới trần 12u.

Mục tiêu đã khóa: net ≥ **0,2u/ngày lịch = 102,4u / 512 ngày** ở cả phí thường và phí cao, ví 31,47744546u, cap 12u/ngày, soft −5,9u, buffer 6,1u, gross nghiên cứu tối đa 8, đòn bẩy 10. Cửa sổ 512 ngày 2025-05-20 → 2026-10-13 là dữ liệu đã xem, không phải holdout mới.

## Sổ đã kiểm toán

Nguồn: [đối chiếu 22/10](2026-10-22-futures-codex-claude-roi-review.md), [kế hoạch carry](../plan/2026-10-22-futures-executable-carry-feasibility.md).

| Sổ | u/ngày phí thường | u/ngày phí cao | Ngày xấu phí cao |
|---|---:|---:|---:|
| CCT tracking-cost | 0,015866 | 0,012207 | −6,900325 |
| Carry 2+2, màn hình thô, DEV |  | khoảng 0,006 | chưa có lot |
| Taker continuation, DEV, gross 1 | 0,038394 | 0,033759 | −9,822539 |

Phần giá của tracking-cost trước phí chỉ khoảng 0,020u/ngày. Cắt phí không tới 0,2u. Nhân đòn bẩy của sổ phí cao để tới 0,2u đưa ngày xấu lên khoảng −110u, vượt trần 12. Màn hình combo thô tốt nhất còn trong soft khoảng 0,045u/ngày và được chọn trên cửa sổ test.

## Dữ liệu mới và một luật đã khóa

Phủ Binance Vision cho BTC, ETH, BNB, SOL, XRP: metrics 5 phút và premium 1 giờ, 2022-01-01 → 2026-10-13, 9085 file, checksum đủ. Open interest không trống. Cột top-trader trống khoảng 18%. Cột taker trống khoảng 7%. Gói zip nằm trên VPS tại `/home/ubuntu/futures-new-data-feasibility-20261023/`, không đưa vào git.

Một luật khóa trước PnL, chỉ ngày trước 2025-05-20: ngày sau đi theo áp lực taker của ngày hôm trước, rổ B5, gross 1. Phí cao: **+33,320177u / 987 ngày, mean 0,033759u, ngày xấu −9,822539u**, 4 ngày ≤ −5,9u, 0 ngày ≤ −12u. Bản đảo dấu âm cả hai phí. Gross 8 phá ví. Kéo gross 1 tới sát trần 12 còn khoảng 0,04u/ngày. Kết luận **MISSES_DEV_GOAL**. Không chạy 512 cho luật này.

Người dùng bác mức khoảng 0,03u/ngày: khoảng 12u/năm trên ví 31u, một ngày xấu khoảng −10u ăn gần cả năm lời. Gửi ngân hàng hơn việc chạy bot.

## LLM trên sổ này

Veto khóa, model `qwen/qwen3-30b-a3b-instruct-2507`, chỉ allow hoặc flat, số đầu vào là số đã biết trước ngày được chấm. JSON hỏng tính là allow. Kết quả phí cao: flat 839/987 ngày, net **−7,839775u**, mean **−0,007943u**, ngày xấu −2,667683u. Kết luận **NOT_BETTER**. Qwen flat 17/20 ngày lỗ nặng nhất và 16/20 ngày lời lớn nhất. Cả 4 ngày ≤ −5,9u đều bị flat.

Claude Sonnet 5.5, cùng prompt, 8 ngày lỗ và 8 ngày lời: flat 1/8 ngày lỗ, allow ngày −9,82u, allow 8/8 ngày lời. Ngày +10,11u đứng ngay trước ngày −9,82u. Không gọi đủ 987 ngày.

Trên key không có FinGPT, Bloomberg hay model futures riêng. Có DeepSeek và router Jev. Ba cách dùng LLM đã đo công khai không gắn vào bot này:

- Agent tự chọn lệnh: đội Hyperliquid DXAP lỗ 217.000 USD ở phí 5,5 điểm cơ bản mỗi chiều; paper khớp mark, không trượt giá, không funding. Bracket cắt lỗ 2% / chốt lời 4% thêm 39 điểm cơ bản mỗi lệnh, sổ vẫn lỗ. Benchmark tiền thật OKX 24/8–21/9/2026: bốn phương pháp, lời giữa nhóm −0,56% khi Bitcoin +11,63%, alpha đều âm.
- Đọc tin cổ phiếu: OPT Sharpe 3,05 sau 10 điểm cơ bản là thị trường khác. Qua ngày model được train, lợi nhuận kiểu FinMem giảm khoảng 72%.
- Tìm công thức: tín hiệu biến động thấp Sharpe ròng 0,51, khoảng 7,8%/năm; làm mượt bằng tay cũng đạt.

TradeRank giấy 10.000 USD: 43,1% mùa có lãi. Mùa 10 tính đến 23/10/2026 đầu bảng khoảng +1–3% với 0–2 lệnh.

Bot hiện tại không có băng tin nhân quả. LLM chỉ được hỏi giữ hay bỏ một sổ đã chọn, và câu đó làm sổ lỗ. Không có kế hoạch triển khai.

## Việc giữ nguyên

Live và boot dừng. Cap 12, soft −5,9, buffer 6,1, sổ tiền và cờ `OPENROUTER_RISK_VETO_SHADOW` giữ tắt. Không reset ví, không nới trần, không chọn coin theo BNB.

Bản chụp lệnh và kết quả nhỏ nằm trong `2026-10-23-futures-roi-research-stop-artifacts/`. Dữ liệu nến và zip metrics không nằm trong git.
