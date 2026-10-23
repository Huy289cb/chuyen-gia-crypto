# Đối chiếu nghiên cứu Codex và Claude — 22/10/2026

Trạng thái: **REVIEW_ONLY**. Không đăng ký, không chạy PnL, không lệnh, không đổi live.

Mục tiêu gốc giữ nguyên: net ≥ **0,2u/ngày lịch = 102,4u / 512 ngày** ở **cả hai** mức phí, cùng kiểm toán tiền và trần rủi ro. Ví tham chiếu 31,47744546u, cap 12u/ngày, soft −5,9u, buffer 6,1u. Dương và tốt hơn bản cũ là mốc riêng.

## Codex — sổ đã kiểm toán

Nguồn: engine 512 ngày đã khóa, hai chi phí, một ví liên tục, audit `PASS_INDEPENDENT_POSTRUN_EVENT_AND_DAY_AUDIT`. [Kết quả tracking-cost](2026-10-20-futures-cct-tracking-cost-512-day-results.md).

| Sổ | Net phí thường | Net phí cao | u/ngày thường | u/ngày phí cao | So với 0,2u |
|---|---:|---:|---:|---:|---|
| CCT tracking-cost | +8,123520 | +6,250015 | 0,015866 | 0,012207 | 8% / 6% |
| CCT gốc | +7,228341 | +5,622029 | 0,014118 | 0,010981 | thấp hơn |
| Active allocation | +6,932489 | +6,860398 | 0,013540 | 0,013399 | đổi chỗ hai phí, drawdown lớn hơn |
| SMA50/200 | −8,836448 | −8,957645 | âm | âm | loại |
| Luôn mua | −23,366837 | −23,378984 | âm | âm | loại |

Phần giá trên đúng vị thế tracking-cost chỉ khoảng **0,02034u / 0,01815u mỗi ngày** trước phí. Cắt phí tiếp không đủ đường tới 0,2u. Lãi vẫn tập trung BNB; không được dùng để chọn coin.

Bước Codex ghi tiếp là CCT hai chiều. Chưa có tín hiệu 512, chưa có engine signed, chưa có PnL. Loader hiện long-only. Ca long/short cũ 64 ngày, scalar 8, ví 100u, trần 10u đã lỗ khoảng −27u/−29u và vượt trần. Ca đó không chứng minh cấu hình mới, cũng không phải lý do để coi short là đường tới 0,2u.

## Claude — màn hình thô, chưa phải kết quả

Thư mục `/home/ubuntu/futures-roi-plus-screen-20261021`. Simulator riêng, không lot, không khớp trong nến, khoảng 40 cấu hình trên cùng cửa sổ. `combo4.out` ghi 494 ngày test, không phải 512 ngày của sổ Codex. Không được cộng các số này vào bảng audit.

Việc sàng có ích:

- Donchian 168h + xu hướng 60 ngày, long/short, trông +18,4u/+10,6u trên cửa sổ 512. Kiểm 2022-09→2025-05 làm cùng tín hiệu còn khoảng +6,5u phí cao trên ~990 ngày, nửa sau âm. Lợi thế long/short trên 2025–26 là regime, không phải edge bền.
- Carry funding chéo, lookback 7 ngày, tái cân bằng tuần: dấu dương ở cả DEV và TEST; bản đảo dấu âm cả hai. Lookback 30 ngày tốt trên DEV rồi gần 0 trên TEST. Đây là manh mối cơ chế, chưa phải sổ tiền.
- BAB và vol premium không đứng vững ở phí cao. Funding 8 giờ đảo chiều không giữ dấu qua hai nửa kỳ.
- Range breakout k=2, 24 giờ, giữ 48 giờ là cấu hình được chọn trên chính cửa sổ TEST. Chưa có nến 1 giờ DEV. Trọng số trong combo dùng vol TEST của sleeve này. Chưa được đưa vào phép thử.

Combo carry+bab+trend+rangebrk ở đòn bẩy x3, phí cao: **+22,26u, 0,045u/ngày, ngày xấu −5,16u**. Nằm trong soft −5,9 của simulator này và vẫn còn cách mục tiêu khoảng 4 lần. X4 đã có ngày −7,61u. Bản không có rangebrk, phí cao, x3: +15,68u, ngày xấu −6,93u, đã chạm soft.

Rổ 39 coin chia năm nhóm tại ví 31u cho mỗi chân khoảng 2u, dưới min notional khoảng 5u. Sổ carry đó không đặt được.

Hook OpenRouter trong `backend/src/portfolio/live-risk-veto-shadow.ts` chỉ ghi log khi `OPENROUTER_RISK_VETO_SHADOW=true`. Mặc định tắt. Không đổi lệnh. Không phải đường tăng ROI. Live vẫn dừng; không bật cờ này.

## Trần của đòn bẩy

Hình dạng lãi ngày của combo phí cao x3: trung bình 0,045u, ngày xấu −5,16u, tỷ lệ đuôi/trung bình khoảng 115. Nhân sổ này lên cho đến khi ngày xấu chạm −12u thì trung bình dừng khoảng **0,10u/ngày**. Giữ soft −5,9 thì dừng khoảng **0,05u/ngày**. Đòn bẩy trên các sleeve đã sàng không tới 0,2u.

0,2u/ngày không bị cấm bởi Sharpe 1 theo phân phối chuẩn: độ lệch ngày khoảng 3u và ngày 4 sigma quanh −12u tương ứng Sharpe năm khoảng 1,3. Các sleeve đã thấy có đuôi trái dày hơn mức đó. Việc cần tìm là phần thưởng trên mỗi đơn vị đuôi lỗ, không phải thêm biến thể CCT hay thêm đòn bẩy.

## Việc không làm

Không chạy lại 8 ca đã audit. Không sweep hệ số range breakout. Không lấy BNB, không chọn coin theo PnL 512. Không nới cap 12. Không khởi động live.
