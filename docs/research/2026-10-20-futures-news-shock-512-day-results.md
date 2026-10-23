# Kết quả bảo vệ tin/sốc trên 512 ngày — 20/10/2026

**Trạng thái live hiện hành: GIỮ DỪNG theo yêu cầu mới của người dùng.** Cả sáu ca đều âm nên chưa có ứng viên được triển khai hoặc được phép bật lại. GET sàn lúc10:55:33ICT20/10 xác nhận không vị thế/lệnh chờ, ví30,46375116u; PM2 live và cấu hình khởi động lại đều stopped. Giữ cap12u/ngày, không reset tiền hoặc lịch sử. [Biên bản giữ dừng và điều kiện chạy lại](../audits/futures-quick-win/news-shock-512d-live-hold-20261020/README.md).

Trạng thái chạy: **COMPLETE**; ca hoàn tất: **6/6**; kiểm toán tiền: **PASS_INDEPENDENT_POSTRUN_EVENT_AND_DAY_AUDIT**; rủi ro mô hình: **PASS**.

Mỗi ca một ví ban đầu31,47744546u,512ngày liên tục20/05/2025–13/10/2026 theo ngày Việt Nam. Trần mô hình12u/ngày, đóng sớm−5,9u/dự phòng6,1u. Phí, funding và trượt giá đã hạch toán; không reset/nạp lại ở đoạn trùng128ngày. Bình quân là net chia đủ512ngày kể cả ngày âm/không giao dịch.

| Phương án | Chi phí | Lãi ròng (u) | ROI vốn đầu | Bình quân u/ngày | Ngày xấu nhất (u) | Sụt vốn lớn nhất (u) | Phí (u) | Lượt khớp |
|---|---|---:|---:|---:|---:|---:|---:|---:|
| Cơ sở | Cơ sở | -23.366837 | -74.234% | -0.045638 | -7.527194 | 74.202020 | 2.707155 | 195 |
| Cơ sở | Cao | -23.378984 | -74.272% | -0.045662 | -7.187458 | 73.889261 | 3.487809 | 190 |
| Né lịch tin | Cơ sở | -24.288985 | -77.163% | -0.047439 | -10.516246 | 63.720685 | 5.216950 | 574 |
| Né lịch tin | Cao | -25.990965 | -82.570% | -0.050764 | -7.855509 | 67.105396 | 6.804577 | 588 |
| Né tin + lọc sốc | Cơ sở | -27.900071 | -88.635% | -0.054492 | -6.410736 | 90.311766 | 10.192303 | 859 |
| Né tin + lọc sốc | Cao | -28.368054 | -90.122% | -0.055406 | -6.490047 | 73.123392 | 10.751048 | 810 |

Lợi nhuận tuyệt đối được đọc riêng với mức cải thiện tương đối. Verdict tăng ROI so với bản cơ sở có thể đúng khi cả hai vẫn lỗ, nếu ứng viên lỗ ít hơn. Verdict đó không tự có nghĩa toàn kỳ lãi ròng dương hoặc đạt bình quân +0,2u/ngày.

- Cơ sở / base: lãi ròng dương **KHÔNG**; đạt bình quân ≥+0,2u/ngày **KHÔNG**.
- Cơ sở / stress: lãi ròng dương **KHÔNG**; đạt bình quân ≥+0,2u/ngày **KHÔNG**.
- Né lịch tin / base: lãi ròng dương **KHÔNG**; đạt bình quân ≥+0,2u/ngày **KHÔNG**.
- Né lịch tin / stress: lãi ròng dương **KHÔNG**; đạt bình quân ≥+0,2u/ngày **KHÔNG**.
- Né tin + lọc sốc / base: lãi ròng dương **KHÔNG**; đạt bình quân ≥+0,2u/ngày **KHÔNG**.
- Né tin + lọc sốc / stress: lãi ròng dương **KHÔNG**; đạt bình quân ≥+0,2u/ngày **KHÔNG**.

## Kết luận theo điều kiện đã đăng ký

- Né lịch tin: **NO_ROI_UPLIFT_BOTH_COSTS**.
  base: chênh lệch net so với bản cơ sở cùng chi phí -0.922148u; bình quân -0.001801u/ngày.
  stress: chênh lệch net so với bản cơ sở cùng chi phí -2.611981u; bình quân -0.005102u/ngày.
- Né tin + lọc sốc: **NO_ROI_UPLIFT_BOTH_COSTS**.
  base: chênh lệch net so với bản cơ sở cùng chi phí -4.533234u; bình quân -0.008854u/ngày.
  stress: chênh lệch net so với bản cơ sở cùng chi phí -4.989069u; bình quân -0.009744u/ngày.

PASS tính tiền không tự đồng nghĩa đạt trần rủi ro hoặc tăng ROI. Đọc riêng cột breach/modeledDailyRisk trong kiểm toán và verdict: chỉ công nhận cải thiện đáp ứng điều kiện khi net cao hơn ở cả hai cost và các ca so sánh không vượt trần12u trong mô hình. Không tự triển khai guard sau nghiên cứu.

## Vì sao khác kết quả 128 ngày trước

Bản cơ sở từng lãi25,642884u khi bắt đầu riêng kỳ128ngày bằng31,47744546u. Trong phép thử512ngày một ví liên tục, sau384ngày đầu chỉ còn3,861704u;128ngày cuối tăng4,248905u và kết thúc8,110609u. Tiền đầu đoạn, lượng nắm giữ và lịch sử rủi ro khác nhau nên không thể ghép lợi nhuận của ví128ngày được khởi tạo riêng vào ví512ngày. Không có nạp thêm hoặc reset giữa kỳ. Kết quả dương trong kỳ ngắn chưa đủ chứng minh lợi thế lâu dài.

Né tin/lọc sốc làm tăng số lượt khớp từ195 lên574/859 ở chi phí cơ sở; phí tăng từ2,707155u lên5,216950u/10,192303u. Có điểm rủi ro được cải thiện, nhưng lợi nhuận ròng của hai cấu hình này đều thấp hơn bản cơ sở ở cả hai mức chi phí. Giảm một chỉ số lỗ không đồng nghĩa đạt mục tiêu lợi nhuận.

## Lịch sử khôi phục trước yêu cầu giữ dừng

Kết quả phục hồi: **PASS_OBSERVED_STABLE_RESUME**. SnapshotUTC 2026-10-20T00:44:31.281289+00:00: tiến trình running, ví active, lý do None; lượng coin đang giữ 4; đối soát reconciled, delta 0.

Đây là snapshot lịch sử theo quyền tự khôi phục trước đó. Sau yêu cầu mới chỉ chạy lại nếu512ngày khả quan, worker đã được dừng và lưu bootprofile stopped như phần trạng thái hiện hành ở đầu báo cáo. Không dùng snapshot này làm bằng chứng live đang chạy.

Kiểm tra bảo toàn: **PASS**. Không reset cấu hình, vốn cấp, lịch sử hoặc mốc rủi ro. Sourcecursor có thể tiến tự nhiên sau khi phục hồi qua nguồn ngày mới. Bản cũ vẫn có thể gặp monitoringgap; snapshot ngắn không chứng nhận24/24. Không gán trạng thái vận hành hoặc PnL thật cho lớp bảo vệ đang thử.

## Giới hạn và nguồn

512ngày là hồi cứu mở rộng có128ngày đã xem, không phải holdout tiến cứu. Lịch có nguồn Fed/BLS/BEA nhưng không đủ feed as-known. Nến1phút, trượt cố định và filters hiện tại không tái hiện đầy đủ gap, spread, partialfill hoặc outage. Không bảo đảm trần12u tuyệt đối. Drawdown trường tên cũ5m thực tế cập nhật mỗi phút đóng; kiểm toán tiền không thay mô phỏng độc lập mọi quyết định rủi ro trong phút.

RegistrationSHA256: `d24c673c07871e5c07d8c38ff1bb52d8c0c7d50ef633e1f4e310357e4754bb4d`. Đầu vào371MB được hash, giữ nguyên128ngày giá/funding/nguồn/lịch trùng kỳ cũ; không nhân bản toàn bộ CSV/archive vào gói báo cáo.

[Thiết kế và phạm vi đã đăng ký](2026-10-20-futures-news-shock-512-day-backtest.md).

[Gói bằng chứng](../audits/futures-quick-win/news-shock-512d-20261020/README.md).
