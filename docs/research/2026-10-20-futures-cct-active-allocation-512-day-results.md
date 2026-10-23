# Thử CCT active allocation long/cash trên 512 ngày — 20/10/2026

Trạng thái: **HOÀN TẤT VÀ KIỂM TOÁN**. Kiểm toán tiền: **PASS_INDEPENDENT_POSTRUN_EVENT_AND_DAY_AUDIT**. Live giữ dừng; không tự triển khai hoặc chạy lại.

Hai ca cùng quy tắc CCT gốc nhân trọng số5/n_active theo số coin có tín hiệu dương đã biết; vol90/sizing6/band20; mỗi ca một ví31,47744546u, 20/05/2025–13/10/2026 ICT, đủ512 ngày. Cap12/soft−5,9/buffer6,1; không nạp/reset giữa kỳ. Engine tiền, admission, projection và processor giữ nguyên byte so với bản cơ sở trước.

| Chi phí | Net512 ngày (u) | Bình quân u/ngày | ROI vốn đầu | Ngày xấu nhất (u) | Trần12 trong mô hình |
|---|---:|---:|---:|---:|---|
| base | 6.932489 | 0.013540 | 22.024% | -7.672050 | Đạt |
| stress | 6.860398 | 0.013399 | 21.795% | -8.588605 | Đạt |

Kết luận: **POSITIVE_BOTH_COSTS_BELOW_PRIMARY_TARGET**.

Lãi ròng dương và đạt0,2u/ngày là hai mức riêng. Mục tiêu chính cần102,4u net trong512 ngày ở cả hai mức phí, đồng thời money audit và kiểm tra rủi ro đạt. Không làm tròn mức thấp hơn thành đạt mục tiêu.

- CCT_ACTIVE_ALLOCATION_base: chênh lệch net so với CCT gốc, cùng ví/kỳ/chi phí: **-0.295851u**.
- CCT_ACTIVE_ALLOCATION_stress: chênh lệch net so với CCT gốc, cùng ví/kỳ/chi phí: **+1.238368u**.

CCT active allocation là biến thể phân bổ do ta thiết kế, giữ nguyên tín hiệu CCT chín kênh; oldweight*5/n_active, khi n_active=0 giữ tiền. 512 ngày đã được xem, không phải holdout tiến cứu. Nến phút, filters snapshot và slippage cố định không tái hiện đầy đủ thanh khoản, gap, outage hoặc khớp từng phần. Kiểm toán tiền độc lập không mô phỏng lại mọi quyết định risk/alpha. Không bảo đảm trần12u tuyệt đối ngoài sàn.

Ví thật trong snapshot: 30.46375116u; lượng coin đang giữ0; đối soátreconciled/delta0; bootstopped. Số dư thật khác vốn tham chiếu backtest; chưa có thay đổi sản phẩm hoặc lệnh thật do nghiên cứu.

RegistrationSHA256: `5544307be26ab0ce7de663caba03b058b2bde9c10afde70a9dbbf97c57af2f12`.

[Nghiên cứu và hướng tiếp](2026-10-20-futures-roi-positive-research.md). [Đối chứng CCT trước](2026-10-20-futures-cct-control-512-day-results.md). [Bằng chứng](../audits/futures-quick-win/roi-positive-cct-active-allocation-512d-20261020/README.md).
