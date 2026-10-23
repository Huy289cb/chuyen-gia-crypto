# CCT ưu tiên bám tỷ trọng và chi phí trên512 ngày —21/10/2026

Trạng thái: **HOÀN TẤT VÀ KIỂM TOÁN**. Kiểm toán tiền: **PASS_INDEPENDENT_POSTRUN_EVENT_AND_DAY_AUDIT**. Live giữ dừng; không tự triển khai hoặc chạy lại.

Hai ca cùng nguồn CCT gốc chín kênh/vol90/sizing6/band20; mỗi ca một ví31,47744546u, 20/05/2025–13/10/2026 ICT, đủ512 ngày. Cap12/soft−5,9/buffer6,1; không nạp/reset giữa kỳ. Nguồn gốc/engine tiền/admission/processor giữ nguyên; chỉ hai công thức mục tiêu projection thay đổi: bám tỷ trọng từng coin + chi phí, net deviation dùng phân xử hòa.

| Chi phí | Net512 ngày (u) | Bình quân u/ngày | ROI vốn đầu | Ngày xấu nhất (u) | Trần12 trong mô hình |
|---|---:|---:|---:|---:|---|
| base | 8.123520 | 0.015866 | 25.807% | -6.884004 | Đạt |
| stress | 6.250015 | 0.012207 | 19.856% | -6.900325 | Đạt |

Kết luận: **POSITIVE_BOTH_COSTS_BELOW_PRIMARY_TARGET**.

Lãi ròng dương và đạt0,2u/ngày là hai mức riêng. Mục tiêu chính cần102,4u net trong512 ngày ở cả hai mức phí, đồng thời money audit và kiểm tra rủi ro đạt. Không làm tròn mức thấp hơn thành đạt mục tiêu.

- CCT_TRACKING_COST_base: chênh lệch net so với CCT gốc đã hoàn tất, cùng ví/kỳ/chi phí: **+0.895180u**.
- CCT_TRACKING_COST_stress: chênh lệch net so với CCT gốc đã hoàn tất, cùng ví/kỳ/chi phí: **+0.627985u**.

## Chi phí và rủi ro thay đổi thế nào

| Chỉ tiêu | Phí thường | Phí cao |
|---|---:|---:|
| Phí | 0,766424u | 1,079339u |
| Phí giảm so CCT gốc | 0,523922u | 0,732743u |
| Trượt giá giảm | 0,209569u | 0,523388u |
| Funding bớt âm | 0,708719u | 0,665894u |
| Phần lãi giá tham chiếu giảm | 0,547030u | 1,294040u |
| Fill | 290 | 289 |
| Khóa rủi ro | 1 | 1 |
| Sụt vốn theo đóng phút | 22,843231u | 23,312415u |

Net tăng nhờ tổng chi phí thấp hơn bù phần lãi giá giảm trên hai chuỗi vị thế đã mô phỏng. Đây là phân rã kế toán, không phải phép thử thay một khoản chi phí rồi giữ nguyên mọi quyết định. Sụt vốn lấy từ giá đóng mỗi phút do engine báo, không phải max drawdown độc lập ở mọi thời điểm.

So CCT gốc, ngày xấu nhất bớt lỗ khoảng1,38u/1,50u và sụt vốn giảm11,54u/12,60u. Tuy nhiên lãi vẫn tập trung ở BNB; không chọn riêng coin thắng theo lịch sử. So active allocation, bản này có net phí thường cao hơn nhưng net phí cao thấp hơn; không tuyên bố vượt mọi cấu hình đã thử.

**Quyết định nghiên cứu:** giữ bản tracking-cost làm đối chứng cho bước tiếp; không đổi hoặc bật live. Đóng phép thử mục tiêu phân bổ này, không sweep tiếp. Phần lãi giá tham chiếu trước các chi phí trên cùng vị thế cũng chỉ khoảng0,02034u/0,01815u mỗi ngày, nên tối ưu chi phí đơn thuần chưa có bằng chứng đủ đạt0,2u/ngày. Nhánh vận hành có [kế hoạch đo giám sát](../plan/2026-10-21-futures-monitoring-phase-instrumentation.md), hiện mới là thiết kế.

[Đối chiếu ledger sau kiểm toán](/home/ubuntu/futures-roi-positive-research-20261020/tracking-cost-final-diagnosis/output/comparison-diagnosis.json) xác nhận đủ512ngày, ví liên tục, coin accounting cuối kỳ flat và các chênh lệch trên; không chạy financialreplay mới.

Đây là biến thể mục tiêu phân bổ mới, không phải sửa lỗi kế toán hoặc bằng chứng sao chép tác giả. Tín hiệu và band CCT gốc giữ nguyên. 512 ngày đã được xem, không phải holdout tiến cứu. Nến phút, filters snapshot và slippage cố định không tái hiện đầy đủ thanh khoản, gap, outage hoặc khớp từng phần. Kiểm toán tiền độc lập không mô phỏng lại mọi quyết định risk/alpha. Không bảo đảm trần12u tuyệt đối ngoài sàn.

Ví thật trong snapshot: 30.46375116u; lượng coin đang giữ0; đối soátreconciled/delta0; bootstopped. Số dư thật khác vốn tham chiếu backtest; chưa có thay đổi sản phẩm hoặc lệnh thật do nghiên cứu.

GET chỉ đọc sau cùng09:45:01ICT21/10 xác nhận0vịthế/0lệnh thường/0algo, equity30,46375116u. Kiểm local xác nhận user hold/savedbootstopped, không PIDlive và hash sổ tiền nguyên trạng. Một lần GET trước đó lỗi mạng; thử lại một lần đạt. Không sửa guard hoặc bật worker để khắc phục lỗi GET.

RegistrationSHA256: `e04a9e1293035a48de61aa52923c48c647e54111ddd875d8352ed348a30c6d91`.

[Nghiên cứu và hướng tiếp](2026-10-20-futures-roi-positive-research.md). [Bằng chứng](../audits/futures-quick-win/roi-positive-cct-tracking-cost-512d-20261020/README.md).
