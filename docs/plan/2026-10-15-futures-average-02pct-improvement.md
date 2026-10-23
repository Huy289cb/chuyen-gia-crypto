# Cải thiện Futures: trung bình ròng +0,2u/ngày

**Trạng thái16/10 ICT:** CCT6/buffer1,1u full128 ngày net+14,1381/+12,6672u, mean+0,11045/+0,09896u/ngày, breach0 theo engine mô phỏng, audit tiền6.063.198checks PASS. Dương sau chi phí nhưng chưa đạt0,2u/ngày toàn kỳ. Shared TS source/engine/testbed/service/UI đã viết; full128 ledger parity V3 đã PASS6.801.300 phép kiểm tiền với sai lệch0. Chưa chọn CCT làm default.

Ví ban đầu **100 USDT**, vốn được phép tăng/giảm theo kết quả. Mục tiêu là **tổng lãi ròng chia toàn bộ ngày lịch ≥0,2 USDT/ngày**; trên 64 ngày cần net ≥12,8u sau phí, slippage, funding và đóng cuối kỳ. Chấp nhận ngày âm/dương/cash, không giới hạn số lệnh. Ngân sách lỗ **10u cố định/ngày ICT cho toàn ví**. Không khôi phục ICT/SMC, BTC-only, cooldown, exposure100, SL tối thiểu hoặc cap risk mỗi lệnh đã bỏ. Mốc1u/ngày cũ là tham khảo lịch sử.

[Báo cáo kết quả và giới hạn](../research/2026-10-15-futures-average-02pct-improvement.md).

## Tiến độ đã xác nhận

| Phép thử cùng 64 ngày | Trung bình ròng cơ sở / chi phí cao | Ngày lỗ sâu nhất cơ sở / chi phí cao | Kết luận |
|---|---:|---:|---|
| Momentum V1 theo lot | −0,0821 / −0,1014u | −6,6085 / −6,6366u | Âm |
| Momentum lot phân số chẩn đoán | −0,2956 / −0,3415u | −9,8733 / −9,9189u | Bám nguồn sát hơn vẫn âm |
| CCT long/cash 5 phút | +0,2170 / +0,1535u | −14,9393 / −14,8495u | Dương, còn vượt10u |
| CCT long/short 5 phút | −0,4226 / −0,4516u | −12,6849 / −12,7935u | Không ưu tiên |
| CCT gap reserve 5 phút | −0,2382 / −0,4218u | −12,3045 / −11,5473u | Giảm rủi ro nhưng mất lợi nhuận |
| CCT bộ dừng gốc 1 phút, sizing8 | +0,2859 / +0,2776u | −13,1157 / −13,3180u | Đạt mean, vượt10u |
| CCT gap reserve 1 phút | −0,2706 / −0,3037u | −9,2695 / −9,3191u | Giữ10u trong mô hình, mean âm |
| CCT giảm từng phần 1 phút | +0,1506 / +0,0967u | −10,7316 / −11,2696u | Cải thiện, còn thiếu cả hai điều kiện |
| **CCT bộ dừng gốc 1 phút, sizing6** | **+0,2677 / +0,2695u** | **−11,2839 / −11,4559u** | **Giữ mean mục tiêu, còn vượt10u** |
| CCT sizing6,dự phòng1,6u | +0,1295 / +0,1328u | −9,0849 / −9,0845u | Dương và giữ10u trong mô hình, mean chưa đủ |
| **CCT sizing6,dự phòng1,1u** | **+0,3574 / +0,2943u** | **−9,6787 / −9,7384u** | **Đạt cả mean và ngân sách trong mô hình, đã audit** |

Tất cả đã có audit tiền độc lập. Đó là xác nhận phép tính và ledger, không đồng nghĩa đạt lợi nhuận, rủi ro hoặc parity đầy đủ với production. Kết quả cũ được giữ nguyên, không chạy lại để thay bản âm bằng bản dương.

## Cấu hình nguồn và các thay đổi đã thử

Nguồn Catching Crypto Trends: 9 kênh Donchian 5/10/20/30/60/90/150/250/360 ngày; kiểm stop cũ trước khi nâng stop midpoint; vol90 ngày, band20%; daily close dùng ở UTC open tiếp theo. Long/cash về tiền mặt khi hết xu hướng.

Thích nghi công khai: B5 BTC/ETH/BNB/SOL/XRP thay Top20 thay đổi hàng tháng, chia đều5; scalar ban đầu8; gross cap8, leverage mô hình10, maintenance0,5%; inventory/delta/lot/minimum và ví chung100/10. Đây không phải bản sao nguyên cấu hình tác giả. Scalar4 chỉ sinh targets rồi nhân2 thành8, không có phép thử tài chính scalar4.

Sau khi sizing8 có mean dương nhưng ngày xấu nhất13,318u, thử **một hiệu chỉnh sizing** `floor(8×10/13,317995…)=6`. Replay đầy đủ cho kết quả dương ở trên; không nhân PnL cũ với0,75. Sau đó thử **dự phòng đóng1,6u**; kết quả dương nhưng mean chưa đủ. Tiếp tục một calibration rủi ro nội suy từ hai điểm đã đo, chọn1,1u. Công thức đầu tiên của1,6u là `ceil((11,455878…−10+0,1)×10)/10=1,6u` để kiểm chứng tiếp.

Chi phí cơ sở là fee5bps/slippage2bps mỗi fill; chi phí cao7bps/5bps. Funding dùng timestamp và MARK thực, giữ cả phần lệch mili giây; đóng cuối kỳ và mọi64 ngày đều được tính. Không cắt lỗ về−10u hoặc loại ngày không có lệnh.

## Nghiệm thu và áp dụng — cập nhật16/10

Nghiên cứu tài chính đã hoàn tất26 cost cases, giữ mọi kết quả âm, ngày giữ tiền mặt và các calibration. CCT6/buffer1,1 đạt trên64 ngày phát triển nhưng một ví liên tục128 ngày chỉ đạt **0,11045/0,09896u/ngày**, còn thiếu so với0,2. Audit tiền độc lập6.063.198 kiểm tra PASS. Không yêu cầu mọi đoạn64 ngày phải dương; quyết định dùng net thực chia đủ128 ngày.

1. **Mã paper đã có:** nguồn CCT, làm tròn lot và chọn danh mục thực thi, shared engine, dữ liệu công khai, khôi phục ví, API, testbed và hai giao diện. Phiên bản `CCT_LC_B5_S6_BUFFER11_V1` có ví riêng, giữ ví momentum cũ.
2. **Kiểm tra đã đạt:** bộ74 tests ban đầu và scoped backend TypeScript. Sau tối ưu bộ nhớ,12 tests engine/testbed đạt; sau sửa funding công bố chậm và khóa protocol của job,9 tests service/market đạt. Scoped backend TypeScript cuối sau sửa service/worker và scoped frontend TypeScript đều PASS. Full Next build chưa chứng nhận, có retry tải font bên ngoài và thiếu tài nguyên.
3. **Nghiệm thu đã hoàn tất:** TS128 V3 PASS184.320 phút mỗi ca,4.950 events,6.801.300 phép đối chiếu tiền, sai lệch0; số dư/net/ngân sách khớp Python. V1 dừng tối ưu, V2 thất bại receiver20 chữ số; giữ đủ code/prefix và sửa Money40 ởV3, không nới tolerance.29 tests sau sửa và scoped backend TypeScript PASS.
4. **Điều kiện áp dụng mặc định:** hoàn tất nghiệm thu kỹ thuật và đáp ứng mục tiêu kinh tế cùng ngân sách đã yêu cầu. CCT128 chưa qua điều kiện kinh tế. Chưa đổi flags, PM2, ví mặc định hoặc gửi lệnh thật.

Testbed kiểm nhanh trên lịch sử, không bắt chờ14 ngày. Paper lấy quote định kỳ còn giới hạn khi mất dữ liệu hoặc bỏ lỡ biến động giữa hai lần lấy giá; không chứng nhận trần lỗ10u liên tục ngoài thị trường.

## Hướng nghiên cứu tiếp theo

Kỳ64 ngày trước có **0 lần dừng rủi ro**, và PnL tại giá tham chiếu đã âm trước phí. Trên chính đường đi inventory128 ngày, xóa toàn bộ chi phí đã ghi vẫn chưa đủ25,6u. Đây là đối soát kế toán, không phải replay chi phí0; đổi chi phí có thể đổi đường đi. Vì vậy chưa có căn cứ rằng chỉ giảm phí hoặc nới bộ dừng sẽ đủ.

- **Chẩn đoán lịch tái vào:** đối soát đủ7 lần dừng mỗi ca và cơ hội tại ICT reset. Hook tái vào với buffer1,1 là phiên bản mới phải khóa và replay riêng; không cộng delta của bản1,6 vào1,1. Nó không sửa được kỳ trước vốn không có lần dừng nào.
- **Kiểm khả thi rổ rộng:** một giả thuyết là tối đa20 USDT perps, xếp theo volume tháng đã đóng, chọn lại đầu tháng, đủ360 ngày lịch sử. Cần thành viên theo thời điểm, daily/mark/trade/funding và filters; ví100u có thể không đáp ứng lot/minimum. Chưa có bằng chứng tăng lợi nhuận, chưa chạy tài chính.

Thứ tự tiếp tục: chẩn đoán → dữ liệu/lot đủ điều kiện → khóa đúng một thiết kế và hai mức chi phí → replay/audit → kiểm trên cửa sổ khác hoặc forward interval khóa trước. Toàn128 ngày hiện đã xem; dùng lại chỉ để phát triển, không gọi là bằng chứng độc lập. Không tăng ngân sách10u hoặc chọn coin/tham số theo PnL đã biết. Chi tiết chẩn đoán giữ trong gói nghiệm thu16/10.

Gói bằng chứng: `docs/audits/futures-quick-win/improvement-02pct-20261015T014500Z/`; workdir `/home/ubuntu/futures-improvement-20261015/`. Ledger lớn giữ đầy đủ cùng manifest SHA256. Các gói14 ngày, watchdog và64 ngày cũ được giữ nguyên. Lượt này chưa đổi bot, gửi lệnh thật, reset ví, deploy hoặc tạo scheduler/tool goal mới.

## Phạm vi đợt kế tiếp sau phản hồi16/10

Đợt này **đã implement, replay hai ca và chốt loại cấu hình**. [Báo cáo16/10](../research/2026-10-16-futures-constant-direction-control.md): mean cơ sở0,288328u/ngày nhưng worst−11,102854u,2 ngày vượt ngân sách đã được kiểm chứng độc lập; stress engine0,148828u/ngày, worst−14,371738u, kiểm toán stress chưa xong do cap15 phút. Audit toàn bộ INCOMPLETE, quyết định loại dựa trên vi phạm cơ sở đã xác nhận; không retry, mở nhánh khác hoặc bật mặc định. Rổ rộng/KPSS tiếp tục tạm hoãn.

### Thiết kế trước chạy — đợt đã kết thúc, xem kết quả bên trên

Giữ nguyên cả bản64 ngày đạt0,3574/0,2943u/ngày và bản một ví128 ngày đạt0,11045/0,09896u/ngày làm bằng chứng gốc. Mốc so sánh chính của ứng viên mới là cùng128 ngày, cùng100u ban đầu, hai mức chi phí và ngân sách10u/ngày; không lấy kết quả của hai ví64 ngày riêng thay cho một ví liên tục. Không thêm yêu cầu mỗi kỳ64 ngày phải dương.

**Câu hỏi duy nhất:** bỏ trạng thái xu hướng/cash của CCT, chỉ tạo mục tiêu mua trên cùngB5 với volatility sizing đang dùng, có cải thiện net/128 không? Can thiệp cũng bỏ ngoại lệ band khi số tín hiệu thay đổi; không diễn giải thành đo riêng alpha hoặc rủi ro thực tế bằng nhau. Bộ khung tiền và lịch thị trường giữ nguyên. Không tăng leverage/sizing, đổi coin hoặc thử thêm buffer trong đợt này.

**Chuẩn bị đã có:** source/static/Spy preflight10/10,640 volatility cells và5.120 weights được đối chiếu; chưa có control PnL. Review chỉ đọc xác nhận đây là đối chứng hữu ích. Trước chạy cần đóng băng protocol/auditor/driver và xác định rõ kiểm chứng worst-net ở các bước trong phút: auditor kế thừa hiện tái dựng ledger và các latch có log, chưa tái dựng mọi cực trị không được log. Không ghi PASS kiểm chứng rủi ro độc lập đầy đủ chỉ dựa vào trường breach engine báo cáo.

**Giới hạn thực hiện:** đúng hai cost cases, một lần chạy, một lần audit. Mốc hiệu năng bản Python128 trước là1.144 giây replay và564 giây audit; đây không phải cam kết tốc độ. Lượt chạy kế tiếp dùng giới hạn thời gian riêng: tối đa30 phút replay và15 phút audit; nếu hết thời gian hoặc lỗi, giữ prefix/log và ghi INCOMPLETE, không tự chạy lại hoặc mở nhánh khác. Không lặp TS parity hoặc tải thêm dữ liệu cho đối chứng này.

**Quyết định sau lượt:** báo net/128, chênh lệch so baseline, ngày lỗ sâu nhất, chi phí và tình trạng kiểm chứng ngân sách ở cả hai ca.128 ngày cần net25,6u; bản hiện tại còn thiếu11,4619/12,9328u. Nếu kết quả tốt hơn nhưng dưới mục tiêu, ghi nhận cải thiện và giữ ứng viên nghiên cứu. Nếu đạt mục tiêu và ngân sách, khóa cấu hình rồi kiểm một khoảng khác được chọn trước khi đọc PnL; toàn128 ngày hiện tại đã dùng phát triển. Việc đạt trong development chưa tự kích hoạt chiến lược mặc định. Nếu thua baseline hoặc vượt ngân sách, loại đối chứng và chốt đợt bằng kết quả đó.
