# Nâng lợi nhuận v1 trên tổng vốn Spot 100 USDT

Người dùng đã chốt **lợi nhuận x2–x3 trên vốn Spot 100 USDT**. So đối chứng và ứng viên cùng vốn, cùng kỳ, cùng chi phí; không lấy nạp thêm vốn làm bằng chứng cải thiện. Đây là nghiên cứu Spot; các mục tiêu Futures cũ đã bỏ.

## Kết quả vòng đã hoàn tất

[Báo cáo tổng hợp](/home/ubuntu/binance-income-research-2026-10-11-v1-step2-confirmation/report.md), Jan2024–Sep2025/639UTCdays,100USDT/sổ:

| Bản | PnL cơ sở / stress, USDT | DD cơ sở / stress | Quyết định |
|---|---:|---:|---|
| V1 fixed100 mua80/reserve20 | +42,0903 / +28,4293 | 27,29% / 30,85% | Giữ đối chứng nghiên cứu |
| Tái đầu tư 80% tiền hiện có | +31,8923 / +16,6251 | 33,19% / 35,77% | Loại |
| EXIT xác nhận hai nến giờ | +39,2582 / +26,0877 | 28,78% / 32,02% | Loại |

Hai invocation tài chính riêng COMPLETE; không stacking/tuning. Kỳ Oct2025–Sep2026 không chạy theo gate khóa sẵn, chưa đo. Snapshot v1 15USDT vẫn nguyên; fixed100 là adaptation được replay, không phải cấu hình đã deploy. Accounting và independent hourly signal audits PASS đúng scope; không phải chứng minh fill/live/ROI sau VPS. Mục tiêu x2–x3 chưa đạt.

## Cơ chế kế tiếp có nguồn: lọc đầu vào funding

[Căn cứ đã đọc](/home/ubuntu/binance-income-research-2026-10-11-v1-step1/next-mechanism-evidence.md) pin strategy tác giả ở commit `b68a5518b4a3eba2fde1733160d7d7de356023b5`. [Python](https://github.com/wiktorj137/btc-strategy-lab/blob/b68a5518b4a3eba2fde1733160d7d7de356023b5/user_data/strategies/EmaCrossFunding.py) có default90 nhưng [file parameter](https://github.com/wiktorj137/btc-strategy-lab/blob/b68a5518b4a3eba2fde1733160d7d7de356023b5/user_data/strategies/EmaCrossFunding.json) chốt **55**. Tác giả dùng funding mean72giờ/min24 observations, rank4320giờ/min720, chỉ nhận rank<55; NaN cho phép entry. Tuyên bố của tác giả là uplift khoảng18,55%, chưa phải bản sao của chúng ta hoặc bằng chứng x2.

Giả thuyết: tránh ENTRY trong giai đoạn vị thế long thị trường phái sinh đông; giảm nhóm lệnh vào kém chất lượng. Quan hệ này có thể đảo chiều theo chế độ thị trường. Đây là giả thuyết cần đo, không kết luận funding thấp luôn giúp giá tăng. Chỉ dùng public funding làm feature cho Spot; không mở vị thế Futures.

## Trình tự implement và backtest

1. **Dữ liệu trước PnL.** Thu official BTCUSDT funding Apr2023–Sep2026 vào batch riêng; lưu raw/URL/checksum/hash và download receipt. Kiểm đơn vị thời gian, thứ tự, trùng, hữu hạn, coverage/gaps và thay đổi lịch funding. Funding settlement time không phải historical publication time. Báo cáo khả thi riêng; không dùng dữ liệu future hoặc tự điền thiếu để tạo rank đẹp.
2. **Khóa availability và policy missing.** Historical receipt time không có trong settlement archive. Đề xuất available_at=settlement_time+1giờ là giả định nghiên cứu phải ghi rõ. Join chỉ records available_at<=giờ quyết định. Phân biệt warmup chưa đủ với missing/gap thật; gap thật chặn phép thử hoặc ENTRY, không coi là funding thấp. NaN policy của tác giả cần xác nhận riêng trước protocol; không âm thầm sửa sau khi xem PnL.
3. **Một implementation.** Tạo adapter mới đọc public funding và lọc ENTRY, giữ EMA600/exit98%/trail15%/startup1300/fixed100risk của v1. Chọn55/72/4320/min24/min720 theo bản nguồn, không gridsearch. Không ghép tái đầu tư/hai-nến đã bị loại. Feature hiển thị phải có source record/available_at; không gọi LLM để đoán funding thiếu.
4. **QA có ý nghĩa.** Fixture cho settlement ở ranh giới giờ, dữ liệu chưa tới, gap/NaN, percentile ties/ngưỡng55, đủ window và prefix không đổi khi append future; entry bị lọc phải có lineage và lý do. Review source độc lập trước run. Tests không chứa kỳ tài chính/PnL lịch sử.
5. **Đăng ký trước PnL.** Pin data/parser/source/config, convention timing, missing policy, kỳ và base/stress. Mỗi book100USDT, continuousledger; tái dùng control đã hoàn tất đúnghash khi cùngperiod/cost/source. Một invocation cơ chế này, không sweep sau kết quả. Jan2024–Sep2025 là development đã xem; Oct2025–Sep2026 đã xem trong nghiên cứu khác nên cũng không gọi freshholdout.
6. **Điều kiện chuyển bước.** Bước nhỏ có ích nếu cảhai case dương và cao hơncontrol; chưax2 vẫn báo đúng uplift. Chỉ mở kỳ Oct2025–Sep2026 nếu gate kỳ gốc cải thiện theo protocol mới. Mốcx2/x3 phải đạt cùngcase/capital; báo DD/USDTloss/months/topwinners/JanSep2025, không chỉ ROI tổng. Nếu cảhai hoặc stress không tốt hơn, loại và chốt nguyên trạng; không hạgate/tăngrisk/đổi55.
7. **Trước live.** Chỉ khi có cải thiện qua các kỳ mới lập prospective paper cùngđối chứng, ghi received_at/quotes/filter/latency/fees/costVPS thực. LLM nếu bổ sung phải đo lợi íchbiên và chi phí riêng. Backtest dương không tự triển khai tiền thật hoặc hứa thu nhập ngày.

Nguồn/báo cáo khả thi tiếp được lưu `/home/ubuntu/binance-income-research-2026-10-11-v1-funding-data-feasibility`; trạng thái thực lấy receipt, không lấy kế hoạch. Vòng tài chính hai cơ chế đã đóng; bước dữ liệu không phải một backtest mới. Không chạy lại các batch thất bại hoặc resume goal Futures.
