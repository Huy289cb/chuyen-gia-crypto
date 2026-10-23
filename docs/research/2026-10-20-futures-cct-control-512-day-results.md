# Đối chứng CCT long/cash trên 512 ngày — 20/10/2026

Trạng thái: **HOÀN TẤT VÀ KIỂM TOÁN**. Kiểm toán tiền: **PASS_INDEPENDENT_POSTRUN_EVENT_AND_DAY_AUDIT**. Live giữ dừng; không tự triển khai hoặc chạy lại.

Hai ca cùng nguồn CCT gốc chín kênh/vol90/sizing6/band20; mỗi ca một ví31,47744546u, 20/05/2025–13/10/2026 ICT, đủ512 ngày. Cap12/soft−5,9/buffer6,1; không nạp/reset giữa kỳ. Engine tiền, admission, projection và processor giữ nguyên byte so với bản cơ sở trước.

| Chi phí | Net512 ngày (u) | Bình quân u/ngày | ROI vốn đầu | Ngày xấu nhất (u) | Trần12 trong mô hình |
|---|---:|---:|---:|---:|---|
| base | 7.228341 | 0.014118 | 22.964% | -8.260600 | Đạt |
| stress | 5.622029 | 0.010981 | 17.861% | -8.396260 | Đạt |

Kết luận: **POSITIVE_BOTH_COSTS_BELOW_PRIMARY_TARGET**.

Lãi ròng dương và đạt0,2u/ngày là hai mức riêng. Mục tiêu chính cần102,4u net trong512 ngày ở cả hai mức phí, đồng thời money audit và kiểm tra rủi ro đạt. Không làm tròn mức thấp hơn thành đạt mục tiêu.

- CCT_ORIGINAL_base: chênh lệch net so với luôn giữ chiều mua, cùng ví/kỳ/chi phí: **+30.595177u**.
- CCT_ORIGINAL_stress: chênh lệch net so với luôn giữ chiều mua, cùng ví/kỳ/chi phí: **+29.001014u**.

Bản CCT128 ngày trước dùng100u/10u; đây là phép thử tài khoản mới, không phải alpha mới. 512 ngày đã được xem, không phải holdout tiến cứu. Nến phút, filters snapshot và slippage cố định không tái hiện đầy đủ thanh khoản, gap, outage hoặc khớp từng phần. Kiểm toán tiền độc lập không mô phỏng lại mọi quyết định risk/alpha. Không bảo đảm trần12u tuyệt đối ngoài sàn.

Ví thật trong snapshot: 30.46375116u; lượng coin đang giữ0; đối soátreconciled/delta0; bootstopped. Số dư thật khác vốn tham chiếu backtest; chưa có thay đổi sản phẩm hoặc lệnh thật do nghiên cứu.

RegistrationSHA256: `15c2c1909a1fe866316f8f9ab1e5aac81eecc58eb6d730d16587cd07bc14f8c3`.

[Nghiên cứu và hướng tiếp](2026-10-20-futures-roi-positive-research.md). [Bằng chứng](../audits/futures-quick-win/roi-positive-cct-control-512d-20261020/README.md).
