# Cải thiện Futures: tổng lãi ròng chia toàn bộ ngày

**Đợt implement đối chứng16/10 đã chốt:** constant-direction có mean cơ sở0,288328u/ngày nhưng vi phạm10u/ngày được kiểm chứng độc lập, nên loại cấu hình. Stress engine0,148828u/ngày, audit chưa hoàn tất do cap; không công bố PASS chung. [Báo cáo](2026-10-16-futures-constant-direction-control.md). Baseline CCT dưới đây giữ nguyên.

**Cập nhật16/10/2026 ICT:** replay128 ngày trên đúng một ví100u cho net **+14,1381/+12,6672u**, trung bình **+0,11045/+0,09896u/ngày** cơ sở/chi phí cao. Audit tiền độc lập PASS6.063.198 kiểm tra; không có ngày vượt10u trong mô hình. **Đã dương sau chi phí, nhưng chưa đạt mục tiêu0,2u/ngày trên toàn128 ngày.** Kết quả0,3574/0,2943u/ngày của riêng64 ngày sau không được dùng thay kết quả dài kỳ này.

Theo yêu cầu mới “có chiến lược phù hợp thì apply”, đã thêm CCT source/projector/engine/testbed/service/UI trong hệ thống paper;74tests chung và kiểm TypeScript PASS. Đối chiếu toàn ledger128 ngày bằng cùng engine TS, phiên bản `CCT_LC_B5_S6_BUFFER11_V1`, đã hoàn tất V3 PASS6.801.300 phép kiểm tiền với sai lệch0. Bản CCT chưa được chọn làm mặc định và chưa có lệnh thật. Mục tiêu0,2 không bị tự hạ xuống0,1.

## Mục tiêu hiện hành

Ví ban đầu **100 USDT**, cho phép compounding. Chấp nhận ngày lỗ, ngày lãi và ngày không giao dịch. Chỉ tiêu người dùng xác nhận:

`Trung bình = (NAV cuối kỳ − 100 − dòng tiền nạp ròng) / toàn bộ ngày lịch`

Trên64 ngày không nạp/rút, **+0,2 USDT/ngày** tương đương net **ít nhất12,8 USDT**. Phí, slippage, funding và đóng toàn bộ vị thế cuối kỳ đều được tính; slippage đã nằm trong giá khớp, không trừ hai lần. Không chia riêng ngày thắng hoặc ngày có lệnh, không ép NAV luôn bằng100.

Ngân sách lỗ là **10 USDT cố định/ngày Asia/Ho_Chi_Minh cho toàn ví**, không giới hạn số lệnh. Không yêu cầu mỗi ngày hoặc mỗi tháng dương. Các rule ICT/SMC, BTC-only, cooldown1h, exposure100u, SL tối thiểu và cap risk mỗi lệnh đã bỏ không được tự khôi phục. Mốc1u/ngày trước đây chỉ là tham khảo lịch sử.

## Kết quả đã có

Cùng cửa sổ **11/08–13/10/2026 ICT, đủ64 ngày**, cùng vốn ban đầu và cách tính tiền. “Ngày xấu nhất” là mức net sâu nhất quan sát trong ngày, gồm cả PnL chưa chốt tại MARK và mọi chi phí; có thể khác PnL cuối ngày.

| Phương pháp | Net cơ sở / chi phí cao | Trung bình mỗi ngày cơ sở / chi phí cao | Ngày xấu nhất cơ sở / chi phí cao |
|---|---:|---:|---:|
| Momentum V1 theo lot | −5,2563 / −6,4924u | −0,0821 / −0,1014u | −6,6085 / −6,6366u |
| Momentum lot phân số chẩn đoán | −18,9156 / −21,8587u | −0,2956 / −0,3415u | −9,8733 / −9,9189u |
| CCT long/cash,5 phút | +13,8875 / +9,8261u | +0,2170 / +0,1535u | −14,9393 / −14,8495u |
| CCT long/short,5 phút | −27,0471 / −28,9018u | −0,4226 / −0,4516u | −12,6849 / −12,7935u |
| CCT gap reserve,5 phút | −15,2459 / −26,9933u | −0,2382 / −0,4218u | −12,3045 / −11,5473u |
| CCT bộ dừng gốc,1 phút,sizing8 | +18,2953 / +17,7687u | +0,2859 / +0,2776u | −13,1157 / −13,3180u |
| CCT gap reserve,1 phút | −17,3190 / −19,4379u | −0,2706 / −0,3037u | −9,2695 / −9,3191u |
| CCT giảm từng phần,1 phút | +9,6405 / +6,1911u | +0,1506 / +0,0967u | −10,7316 / −11,2696u |
| **CCT bộ dừng gốc,1 phút,sizing6** | **+17,1357 / +17,2461u** | **+0,2677 / +0,2695u** | **−11,2839 / −11,4559u** |
| CCT sizing6,dự phòng1,6u | +8,2885 / +8,4969u | +0,1295 / +0,1328u | −9,0849 / −9,0845u |
| **CCT sizing6,dự phòng1,1u** | **+22,8721 / +18,8350u** | **+0,3574 / +0,2943u** | **−9,6787 / −9,7384u** |

**Đã tìm được phương pháp có trung bình dương vượt0,2u/ngày trong phép thử**, kể cả ở mức chi phí cao. Sizing6 giảm mức lỗ ngày nặng nhất so với sizing8 và vẫn giữ mức lời trung bình. Tuy nhiên cả hai còn vượt10u/ngày. Bản dự phòng1,6u đã giữ10u trong mô hình và vẫn dương, nhưng mean còn0,1295/0,1328u/ngày; **Bản dự phòng1,1u mới nhất đã đồng thời đạt hai yêu cầu trên cửa sổ64 ngày này**, ở cả hai mức chi phí, sau audit tiền. Xác nhận đã cho prior64 âm và full128 chỉ+0,11045/+0,09896u/ngày, nên không suy kết quả64 này thành mức kỳ vọng0,2u/ngày dài kỳ.

Cơ sở dùng fee5bps/slippage2bps mỗi fill; chi phí cao7bps/5bps. Mọi ngày, fills, funding và lỗ vượt ngân sách đều được giữ nguyên. Không cắt net về−10u hoặc chạy lại kết quả cũ để thay con số.

## Học được gì từ nguồn bên ngoài

[Catching Crypto Trends, PDF](https://concretumgroup.com/wp-content/uploads/2026/02/Catching-Crypto-Trends.pdf) dùng nhiều kênh Donchian, stop theo trạng thái, điều chỉnh vị thế theo biến động và vùng không cần tái cân bằng. Bản PDF tải được mang ngày09/04/2025; không trộn với bản SSRN sửa ngày khác. Code long/cash tham khảo được giữ tại [commit đã khóa](https://github.com/LineGM/catching_crypto_trends/tree/2a882b79be8fd1c60c2ee49bfc3c4cc83023a353). Đây là bản tái hiện độc lập của LineGM, không phải mã do tác giả bài báo công bố. Parity với bản mã này không chứng minh đã tái hiện nguyên universe và kết quả của bài báo.

Bản thử của ta giữ tín hiệu9 chân5/10/20/30/60/90/150/250/360 ngày; close breakout; kiểm stop cũ trước khi nâng stop theo midpoint; vol90 ngày và band20%. Daily close chỉ dùng ở UTC open tiếp theo. Long/cash về tiền mặt khi hết xu hướng. Không có độ trễ thêm24h của momentum cũ, không dùng dữ liệu chưa biết.

Các thích nghi được công khai: rổ cố định BTC/ETH/BNB/SOL/XRP thay Top20 thay đổi hàng tháng, chia đều5; scalar ban đầu8, sau đó thử một hiệu chỉnh rủi ro xuống6 có protocol riêng; gross cap8, leverage mô hình10, maintenance0,5%; cùng ví100/10 và lot/minimum/phí/funding theo inventory thực. Đây không phải bản sao nguyên cấu hình tác giả hoặc xác nhận lợi nhuận live của tác giả. Không quy CAGR nguồn thành tiền/ngày bằng cách nhân đòn bẩy.

Targets ban đầu được sinh ở scalar4, rồi processor nhân2 thành8. **Không có phép thử PnL scalar4 để chọn4/8.** Scalar8 ban đầu được khóa trước PnL theo khả năng mở ticket nhỏ. Scalar6 là một calibration rủi ro tiếp theo, sau khi đã xem kết quả sizing8; không gọi nó là tham số chọn trước toàn bộ nghiên cứu.

Nguồn funding cross-venue và reversal15 phút cũng được kiểm tra; chúng chưa cung cấp bằng chứng phù hợp hơn với mục tiêu và chi phí hiện tại. Bản tải, lý do và hashes nằm trong gói nguồn. Không lấy ảnh ROI của trader làm chứng minh thu nhập ổn định.

## Những thay đổi đã thử và ý nghĩa

**Lot/delta của momentum.** Projection mới kiểm trên inventory và delta thực, giữ/giảm vị thế nhỏ khi hợp lệ và thực hiện reductions trước. Sai số tĩnh bám danh mục giảm từ khoảng40,68% xuống35,49% gross nguồn; đó chưa phải lợi nhuận. Đối chứng lot phân số bám sát hơn, sai số khoảng2,3–2,4%, nhưng lỗ nhiều hơn cả trước chi phí theo attribution. Vì vậy chỉ sửa execution chưa đủ biến alpha momentum cũ thành+0,2u/ngày. Lot phân số chỉ là chẩn đoán, không phải lệnh sàn chấp nhận.

**Gap reserve.** V1 chỉ dự phòng phí/slip/basis đóng tại quotes đang biết. V2 cộng `Σabs(q)×MARK×max biến động bất lợi quá khứ`, với max từ288 nến MARK5 phút đã đóng, dùng previous close→low/high theo chiều vị thế. Warmup289 nến gồm previous-close seed; chỉ cập nhật lịch sử sau close. Một lookback cố định, không chọn quantile theo PnL. Attribution cho thấy cả11 lần dừng của LC5 phút xảy ra ở bước giá bất lợi trong nến; max quá khứ không chặn được mọi biến động mới. Ở độ phân giải1 phút, reserve này giữ được10u trong mô hình nhưng làm trung bình âm. Phần thiệt hại chủ yếu do thời điểm giữ/đóng vị thế thay đổi, không chỉ phí tăng.

**Giảm từng phần.** Thay vì luôn đóng hết vì thiếu gap reserve, giữ quantity theo tỷ lệ đủ `C_full+G_retained<9,9+observedNet`, tròn xuống lot và tính đầy đủ chi phí actual fills. Hard loss−10u/maintenance vẫn đóng hết và latch. Proposal được ghi trước khi có kết quả bốn ca1 phút. Kết quả dương+0,1506/+0,0967u/ngày, tốt hơn gap flatten nhưng chưa đạt0,2; mỗi ca còn một ngày vượt10u, ngày07/10ICT. Không gọi certificate nội bộ là bảo đảm rủi ro tương lai.

**Sizing6.** Chọn đúng một mức theo kết quả rủi ro sizing8:

`floor(8×10/13,3179950169473473393)=6`

Weights scalar4 được nhân Decimal0,75 rồi frozen processor nhân2 thànhactual6. States/counts/timestamps, alpha, band20%, gross cap8, leverage10, phí/funding/cửa sổ giữ nguyên. Replay tiền đầy đủ, không nhân PnL cũ với0,75. Mỗi ca có121 fills và6 lần dừng; ngày lãi/lỗ35/29 cơ sở,34/30 chi phí cao;5/3 ngày vượt ngân sách. Phí chi phí cao giảm từ5,9679u ở sizing8 xuống2,8933u. Net chi phí cao nhỉnh hơn cơ sở do đường đi vị thế khác; không suy rằng tăng phí làm tăng lợi thế chiến lược.

## Đã kiểm chứng: sizing6 với dự phòng đóng1,6u

Từ phần vượt ngân sách thực đo của sizing6, chọn đúng một mức dự phòng, làm tròn lên theo0,1u:

`ceil((11,4558785397708452396−10+0,1)×10)/10=1,6u`

Ngưỡng đóng mềm chuyển từ−9,9u sang **−8,4u sau dự phòng chi phí đóng**. Buffer1,6u được dùng nhất quán trong bộ kiểm rủi ro, từng lệnh tăng vị thế và projection. Ngưỡng lỗ cứng quan sát vẫn−10u, maintenance và ledger tiền giữ nguyên. Sizing6/tín hiệu/band/rổ/costs/64 ngày không đổi, không thêm gap hoặc partial controller.

13 fixtures và2.602 kiểm tra preflight độc lập PASS; review AST xác nhận chỉ đổi các vị trí dùng buffer và thêm logs. Auditor source được khóa trước registration/PnL. Protocol `75743a6842d83a72660187d8e4130fdba648dfc9765eefc31ac453e5656bcaea`; đúng hai ca đã chạy một lần và audit độc lập PASS3.351.261 kiểm tra tiền,184.320frames,277fills,146 admission logs và16 latch contexts; funding fallback0, sai lệch tối đa4,55×10⁻³⁷u. Đây là calibration hồi cứu, không phải bảo đảm10u: thay buffer có thể đổi lệnh, latch, NAV và kết quả phi tuyến.

Kết quả **+8,2885/+8,4969u**, mean **+0,1295/+0,1328u/ngày**, worstday **−9,0849/−9,0845u**, không có vi phạm10u trong mô hình. Mỗi ca8 lần dừng,138/139fills. Đạt ngân sách trên cửa sổ này, còn thiếu lợi nhuận mục tiêu. Bản xác nhận prior64 của buffer1,6 giữ trạng thái chưa đăng ký/chưa chạy vì điều kiện mean chính chưa đạt.

## Đã kiểm chứng: lần hiệu chỉnh dự phòng thứ hai,1,1u

Dùng hai điểm rủi ro đã quan sát của cùng sizing6: buffer0,1u có max loss11,45587853977u; buffer1,6u có max loss9,08490083384u. Nội suy đường thẳng tới loss10u rồi làm tròn buffer lên0,1u:

`b = ceil((0,1 + 1,5 × (11,45587853977−10)/(11,45587853977−9,08490083384)) × 10)/10 = 1,1u`

Giá trị trước làm tròn khoảng1,021062u. Đây là **lần calibration buffer thứ hai trên dữ liệu đã xem**, sau khi đã biết kết quả1,6u; không gọi là thiết kế chọn trước toàn bộ nghiên cứu. Công thức dùng rủi ro, không chọn buffer tối đa hóa PnL. Giữ kết quả của cả0,1u và1,6u; đúng một ứng viên nội suy1,1u được thử tiếp, không chạy một dải buffer.

Ngưỡng mềm mới−8,9u; hard observed−10u giữ nguyên. Kế thừa nguyên risk/admission/projector của engine1,6u, chỉ đổi thuộc tính buffer và nhãn metadata, cùng sizing6/alpha/band/B5/costs/grosscap8/leverage10/cửa sổ. Các điểm rủi ro có đường đi vị thế khác nhau, nên nội suy không phải cận trên hoặc đảm bảo mean. Source/auditor đã khóa trước registration/PnL, protocol `f7fe18687b59c8469297bd18fc8fbb8fd81111b4cb77d18cd055ae593f8cb0f5`. Hai ca chạy đúng một lần và audit độc lập PASS **3.380.984 kiểm tra tiền**,184.320frames,261fills,137 admission logs và14 latch contexts,1.920funding events, fallback0; sai lệch tối đa4,55×10⁻³⁷u.

**Kết quả cơ sở/chi phí cao: net+22,8721/+18,8350u; chia đủ64 ngày+0,3574/+0,2943u/ngày; ngày xấu nhất−9,6787/−9,7384u, không có vi phạm10u trong mô hình.** NAV cuối122,8721/118,8350u,130/131fills và7 lần dừng mỗi ca. Đây là ứng viên đầu tiên trong lượt này đồng thời đạt mean mục tiêu và ngân sách mô phỏng ở cả hai mức chi phí.26files source/outcome/audit đã frozen; không đổi tham số khi chuyển sang prior64.

## Phép thử execution riêng: tái vào sau khi ngân sách ICT reset

Đối soát các ledger đã có cho thấy buffer1,6u mất khoảng8,85/8,75u so với buffer0,1u; phần phí tăng chỉ khoảng0,40/0,61u, slippage tăng0,16/0,44u và funding bù0,16/0,14u. Phần lớn chênh lệch nằm ở trading PnL do inventory/thời điểm giữ khác nhau. Có1.941/1.830 phút bản gốc còn vị thế trong khi bản1,6u đã vềcash. Các nhóm attribution mô tả đường đi đã ghi, không phải ước lượng nhân quả độc lập.

Sau một lần dừng ngày26/08, sang17:00UTC ngân sách ngày ICT đã reset nhưng bản1,6u vẫn vềcash đến00:00UTC, chờ thêm7 giờ. Trong khoảng này equity của bản gốc tiếp tục tăng. Đây là điểm chờ do lịch execution, không phải yêu cầu cooldown của người dùng.

Đã ghi thiết kế **trước khi có kết quả buffer1,1u**: giữ nguyên engine sizing6/buffer1,6u, chỉ thêm một lần tái vào ở ngày ICT mới nếu ngày trước bị risk latch, inventory đangflat và đã có source row hợp lệ. Thực hiện sau bước opening/reset/funding, trước funding lệchms và bước giá bất lợi; dùng đúng weights của row đã biết, không sửa knownAt/executeAt/label/count/state hoặc nhìn trước tín hiệuUTC tiếp theo. Ngày đanglatched không được thử lại; lầnattempt ghi trước lệnh để zero/reject cũng không lặp.7 giờ đầu toàn kỳ vẫnflat vì chưa có active row. Lịch tín hiệuUTC thông thường giữ nguyên.

Đúng hai mức chi phí, cùng64 ngày/100u/hard10u/grosscap8/leverage10. Đây là giả thuyết lịch execution độc lập với calibration1,1u. Protocol `e19bf66054fce6b2448ab6636c1ac85c7cc8cffbe88cefb91f3656830a25ec66` đã khóa trước PnL; hai ca đã chạy một lần; audit money/provenance độc lập PASS **3.416.445 kiểm tra**, gồm previous recorded frame/latest raw source và mọi lần tái vào đủ điều kiện.29files đã frozen. Net+14,7329/+12,5888u, mean+0,2302/+0,1967u/ngày, worst−9,4728/−9,6885u, breach0. Cơ sở đạt mean, chi phí cao còn thiếu0,2112u tổng kỳ so với12,8u; không làm tròn0,1967 thành đạt0,2. So với buffer1,6u chờUTC, hook đã tăng net khoảng6,44/4,09u nhưng chưa hơn ứng viên1,1u ở cả hai costcases. Không mặc định việc tái vào sẽ thu hồi phần lãi đã mất hoặc giữ được ngân sách.

## Xác nhận cùng cấu hình trên64 ngày liền trước

Không đổi sizing6/buffer1,1u/lịchUTC/costs. Cửa sổ cố định08/06–10/08ICT, own92160 phút/mã và960funding actualms, initial100u riêng cho mỗi costcase. Protocol `488fdaa7db65fb57e04cc8d7b6f598de25b506f8ac843d18b6bc2338b3693ef9` khóa trước PnL sau11fixtures/2.895preflight checks và review độc lập.

| Chi phí | Net64 ngày trước | Trung bình/ngày | Ngày xấu nhất | Vi phạm10u trong mô hình |
|---|---:|---:|---:|---:|
| Cơ sở | −2,8960u | −0,04525u | −4,8369u | 0 |
| Cao | −3,3653u | −0,05258u | −4,9674u | 0 |

Đã replay một lần, mỗi ca64fills; audit độc lập PASS **2.679.170 kiểm tra tiền**,184.320frames,128fills,1.920funding events, không thiếu held MARK; sai lệch tối đa3,48×10⁻³⁷u.24files đã frozen. Kỳ này âm, giữ đầy đủ kết quả. Điều đó không xóa số dương ở kỳ sau; cũng không xác nhận expectedmean0,2u/ngày. User chấp nhận kỳ lỗ, nên tiếp tục kiểm toàn128 ngày trên một ví thay vì thêm điều kiện mỗi64 ngày phải dương.

## Replay128 ngày liền mạch: đúng một ví100u

Hai phép thử64 ngày bắt đầu từ100u độc lập không tự tạo thành đường đi của một ví100u xuyên suốt128 ngày. Đã ghi thiết kế128 ngày **trước khi đọc kết quả prior64**: ghép08/06–10/08 với11/08–13/10 theo thứ tự thời gian, giữ nguyên sizing6/buffer1,1u/lịchUTC gốc.

Một lần khởi tạo100u, giữ nguyên quantity/average entry/cash/source state/funding đã xử lý qua ranh giới hai tập dữ liệu. Không đóng toàn bộ, nạp/rút hoặc resetví tại ranh giới; daily anchor vẫn reset theo ICT như mọi ngày. Chỉ đóng cuối toàn kỳ.128 quyết địnhdaily,1.920 funding actualms,184.320 phút/mã; mean cuối là **actualnet/128**, mục tiêu net≥25,6u. Engine tiền giữ nguyên; trường mean/calendarDays của summary được ghi đúng128 thay vì lấy/64 hardcoded ở runner cũ.

Điều kiện trước chạy là prior64 **audit tiền PASS**, không yêu cầu riêng kỳ prior64 phải dương hoặc đạt0,2u/ngày. Người dùng chấp nhận kỳ lỗ; tiêu chí áp dụng cho toàn kỳ128 với mọi ngày lãi/lỗ/cash và fixed10u/ngày. Đây là cửa sổ hồi cứu liền mạch đã chọn cố định, gồm cả dữ liệu phát triển, không gọi là holdout mới. Đã khóa protocol `d91eb01b5ded0713987b2864465e636953b0cde430a476eab02f81902336af8b`,13fixtures/5.140preflight checks/review độc lập trước128PnL. Design ghi trước priorPnL; auditor hoàn tất sau khi prior đã biết, trước khi có128outcome, không giả là blind với mọi kết quả cũ.

| Chi phí128 ngày | Net | Net/128 | Ngày xấu nhất | Vi phạm10u |
|---|---:|---:|---:|---:|
| Cơ sở | +14,138086u | +0,110454u/ngày | −9,690495u | 0 |
| Cao | +12,667211u | +0,098963u/ngày | −9,494189u | 0 |

Audit độc lập PASS **6.063.198 kiểm tra tiền**,368.640frames,378fills,3.840funding events qua hai ca,127ICTrolls/case; sai lệch tối đa4,55×10⁻³⁷u, heldfallback0. Kiểm điểm nối giữ inventory/averageEntry/cash/marks, không reset/đóng cưỡng bức/nạp tiền.26files đã frozen. Tổng kỳ vẫn dương nhưng còn thiếu11,4619/12,9328u để đạt25,6u, tức0,2×128. Không cộng PnL hai ví64 độc lập để thay đường đi này; compounding/lot/band/latch làm inventory và kết quả khác.

## Kiểm chứng tiền và dữ liệu

| Bộ kết quả | Audit tiền độc lập |
|---|---:|
| Momentum lot phân số | 3.186.410 kiểm tra |
| CCT V1,4 ca5 phút | 1.329.343 kiểm tra |
| CCT V2,2 ca5 phút | 1.634.387 kiểm tra; thêm5.780 giá trị warmup |
| CCT gốc/gap,4 ca1 phút | 11.084.822 kiểm tra |
| CCT giảm từng phần,2 ca1 phút | 8.985.790 kiểm tra |
| CCT sizing6,2 ca1 phút | 3.404.396 kiểm tra |
| CCT sizing6/buffer1,6u,2 ca1 phút | 3.351.261 kiểm tra |
| CCT sizing6/buffer1,1u,2 ca1 phút | 3.380.984 kiểm tra |
| CCT tái vào sau ICTreset,2 ca1 phút | 3.416.445 kiểm tra |
| CCT1,1u prior64,2 ca1 phút | 2.679.170 kiểm tra |
| CCT1,1u continuous128,2 ca1 phút | 6.063.198 kiểm tra |

Các audit trên PASS. Auditor Decimal50 tính tiền độc lập từ ledger thay vì gọi lại money engine Decimal40; kiểm filters, actualfees, funding, quantity/cash/entry/equity, ICT anchor và totalnet/64. Sai lệch đều thấp hơn tolerance10⁻¹²u; không thiếu funding MARK của vị thế đang giữ. Audit giảm từng phần được hoàn thiện khi còn blind, trước khi đọc outcome, theo kế hoạch song song ghi trước; không giả auditor đã khóa trước execution. Các auditor của sizing6/buffer1,6 khóa trước registration.

Dữ liệu1 phút B5 có92.160 phút/mã, không thiếu/trùng;150 ZIP chính thức khớp CHECKSUM. Ghép độc lập1m→5m khớp737.280 giá trị OHLC, không sai lệch. Có960 funding settlements B5 với MARK thực;765 events trùng dữ liệu khác khớp timestamp/rate/MARK. Timestamp lệch+1..26ms được giữ nguyên; funding sau UTC entry được xử lý sau entry.7.488 events ngoài rổ có quantity luôn0 được loại có khai báo. Gap history trong ca1 phút vẫn288 nến5 phút đã đóng, không đổi thành288 phút hoặc dùng nến chưa đóng.

Đây là audit ledger đã ghi, chưa kiểm độc lập mọi quyết định alpha/solver hoặc trạng thái chưa log, chưa chứng nhận parity đầy đủ với production TypeScript. Mô hình dùng cực trị trong nến1 phút/5 phút có thể ghép cực trị các mã ở thời điểm khác nhau, filters hiện hành, margin đồng nhất và giả định khớp đủ ngay. Vì vậy không suy ra stop live tuyệt đối hoặc lợi nhuận tương lai.

## Lộ trình phát triển và áp dụng

1. **Đã xong nghiên cứu hiện tại:** nguồn ngoài, đối chứng momentum, CCT5phút/1phút, gap/partial, sizing6, hai calibration buffer, reset-reentry, prior64 và one-wallet128. Mọi kết quả dương/âm/cash giữ nguyên cùng audit. CCT11 là ứng viên dương sau chi phí, giữ10u trong mô hình; chưa đạt mean0,2 trên toàn128.
2. **Đã tích hợp mã paper:** CCT source B5/state/UTC đúng nguồn, actual-inventory band/projector, versioned config6/1,1/8/10, sharedmoney/testbed1m, source cursor bền vững, public-data freshness/funding guards, API/UI. Legacy checkpoint/default được giữ.74tests/TypeScript PASS; source5120weights/640metadata và22projectorfixtures đã khớp Python.
3. **Shared engine đã đối chiếu đầy đủ:** TS128 V3 PASS6.801.300 phép kiểm tiền/184.320 phút mỗi ca/4.950 events, sai lệch0; protocol `38de575b1bfab9fa9949349f316f7439b3ef5ebb1259d8e62e6125dd4d01e164`. Đây là xác nhận bản tích hợp, không biến mean0,11/0,099 thành0,2.
4. **Chọn bản paper chạy:** sau parity và kiểm giao diện/vận hành, ghi rõ tiêu chí kích hoạt. Kết quả hiện tại dưới mục tiêu0,2; không gắn nhãn “đã đạt” hoặc đổi vốn/ngân sách/goal ngầm. [Tài liệu tích hợp](2026-10-16-futures-cct-paper-integration.md) ghi cấu hình, kiểm tra và trạng thái bật thực tế. Không bắt chờ14 ngày để kiểm lịch sử.


Gói bằng chứng: `docs/audits/futures-quick-win/improvement-02pct-20261015T014500Z/`. Workdir `/home/ubuntu/futures-improvement-20261015/` giữ đầy đủ ledger lớn và manifests. Các gói14 ngày, watchdog và64 ngày cũ được giữ nguyên. Lượt nghiên cứu chưa đổi bot đang vận hành, gửi lệnh thật, chuyển tiền, reset ví hoặc tạo scheduler/tool goal mới. Paper momentum cũ chưa trở thành CCT chỉ vì báo cáo mới.
