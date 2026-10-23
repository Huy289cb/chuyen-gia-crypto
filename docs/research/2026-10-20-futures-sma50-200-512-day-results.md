# Thử SMA50/200 long/cash trên 512 ngày — 20/10/2026

Trạng thái: **HOÀN TẤT VÀ KIỂM TOÁN**. Kiểm toán tiền: **PASS_INDEPENDENT_POSTRUN_EVENT_AND_DAY_AUDIT**. Live giữ dừng; không tự triển khai hoặc chạy lại.

Hai ca cùng quy tắc SMA50>SMA200 thì mua, còn lại giữ tiền; vol90/sizing6/band20; mỗi ca một ví31,47744546u, 20/05/2025–13/10/2026 ICT, đủ512 ngày. Cap12/soft−5,9/buffer6,1; không nạp/reset giữa kỳ. Engine tiền, admission, projection và processor giữ nguyên byte so với bản cơ sở trước.

| Chi phí | Net512 ngày (u) | Bình quân u/ngày | ROI vốn đầu | Ngày xấu nhất (u) | Trần12 trong mô hình |
|---|---:|---:|---:|---:|---|
| base | -8.836448 | -0.017259 | -28.072% | -7.797947 | Đạt |
| stress | -8.957645 | -0.017495 | -28.457% | -7.765818 | Đạt |

Kết luận: **NET_NOT_POSITIVE_BOTH_COSTS**.

Lãi ròng dương và đạt0,2u/ngày là hai mức riêng. Mục tiêu chính cần102,4u net trong512 ngày ở cả hai mức phí, đồng thời money audit và kiểm tra rủi ro đạt. Không làm tròn mức thấp hơn thành đạt mục tiêu.

- SMA50_200_LC_base: chênh lệch net so với luôn giữ chiều mua, cùng ví/kỳ/chi phí: **+14.530389u**.
- SMA50_200_LC_stress: chênh lệch net so với luôn giữ chiều mua, cùng ví/kỳ/chi phí: **+14.421340u**.

SMA50/200 là giả thuyết mới đã chốt công thức trước PnL, sử dụng hai trung bình của giá đóng ngày đã hoàn tất. 512 ngày đã được xem, không phải holdout tiến cứu. Nến phút, filters snapshot và slippage cố định không tái hiện đầy đủ thanh khoản, gap, outage hoặc khớp từng phần. Kiểm toán tiền độc lập không mô phỏng lại mọi quyết định risk/alpha. Không bảo đảm trần12u tuyệt đối ngoài sàn.

Ví thật trong snapshot: 30.46375116u; lượng coin đang giữ0; đối soátreconciled/delta0; bootstopped. Số dư thật khác vốn tham chiếu backtest; chưa có thay đổi sản phẩm hoặc lệnh thật do nghiên cứu.

RegistrationSHA256: `e8c659b5457658a36d6da33e5f3d96ba3897226a2447cff03de527c40e591403`.

[Nghiên cứu và hướng tiếp](2026-10-20-futures-roi-positive-research.md). [Đối chứng CCT trước](2026-10-20-futures-cct-control-512-day-results.md). [Bằng chứng](../audits/futures-quick-win/roi-positive-sma50-200-512d-20261020/README.md).
