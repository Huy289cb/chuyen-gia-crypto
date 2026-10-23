# Momentum futures: kết quả 64 ngày

**COMPLETE_AUDITED_NEGATIVE — không đủ điều kiện áp dụng cấu hình hiện tại.** Người dùng yêu cầu thử 64 ngày và tổng lãi ròng chia đủ 64 ngày phải dương trước áp dụng. Cả base và stress đều âm; các mốc 0,2u/ngày và mục tiêu gốc 1u/ngày đều chưa đạt.

Kỳ **11/08–13/10/2026 ICT**, `[2026-08-10T17:00Z, 2026-10-13T17:00Z)`. Mỗi case là một mô phỏng cùng ví 100 USDT ban đầu liên tục, fixed loss budget chung 10u/ngày ICT, không cap số lệnh và chấp nhận ngày âm/dương. Hai case là hai giả định chi phí của cùng tài khoản, không phải nhân đôi vốn/budget. 14 ngày cuối đã xem; đây là mở rộng hồi cứu, không holdout mới.

## Kết quả kinh tế

| Chỉ tiêu | Cơ sở: fee5bps/slip2bps | Stress: fee7bps/slip5bps |
|---|---:|---:|
| Cash cuối kỳ | 94,743716u | 93,507626u |
| Lãi ròng64ngày | -5,256284u | -6,492374u |
| Lãi ròng/64ngày | -0,08212944u | -0,10144334u |
| Trading fees | 1,843264u | 2,579428u |
| Slippage đã nằm trong realizedPnL | 0,737306u | 1,842448u |
| FundingPnL | -0,266350u | -0,260354u |
| RealizedPnL sau slip, trước fee/funding | -3,146670u | -3,652592u |
| Ngày xấu nhất trong modeled5m envelope | -6,608479u | -6,636618u |
| Max daily breach10u | 0,000000u | 0,000000u |
| Maxdrawdown5mclose, USDT | 15,052699u | 15,157153u |
| Ngày dương/âm/bằng0 | 32/32/0 | 32/32/0 |
| Fills / rebalances | 818/64 | 819/64 |

`net = realizedPnL − trading fees + fundingPnL`; terminal positions đã đóng hết nên unrealized=0. Slip nằm trong fillPrice và realizedPnL, không trừ lần nữa. Chia đủ64 ngày lịch, không chọn ngày có lãi hoặc ngày có lệnh. Không paidAI; chi phí hạ tầng tăng thêm chưa được quy thành tiền. Đây là exchange-model net theo giả định đã ghi, không verified live income.

Cả hai case có32ngày dương/32ngày âm; tần suất thắng50% vẫn không tạo tổng lãi dương. **Không có daily risk latch hoặc risk-governor rejection** trong kỳ này. Daily10u không kích hoạt flatten; việc bỏ rule cũ cũng không biến cấu hình này thành dương. Model no-breach không phải continuousvenue10u assurance. Maxdrawdown khoảng14,92%/15,04% là metric, không khôi phục gateDD15% cũ.

## Giữ cấu hình và các lệch so với benchmark nguồn

Giữ source40/momentum14/samplevol30/rank weights/gross2/additionalUTCdaylag. Engine tính tiền, broker lot/delta/nearestprojection/governor là cùng source byte với phép thử14ngày; leverage10/maintenance0,5%/closebuffer0,10u là giả định của cấu hình. Không đổi params, source signals, costs, initialcapital hoặc cửa sổ sau outcome. Không chạy lại old14financialcases hoặc sourcefractional1500rows.

Actual portfolio mean L1tracking/sourcegross: **40.68%/40.68%**. Có 793/784 rejection, tất cả `market_min_notional`; nguồn fractional không chịu giới hạn ticket này. Rawsignals giống nguồn, holdings/returns thực thi100u khác benchmark. Chưa chạy pairednative/executable trên cùng64ICTwindow nên chưa quy hết phần thua cho alpha hoặc lot projection.

Theo cùng tập fills đã ghi, giá tham chiếu trước slip có realized-attribution vẫn âm (base≈−2,409365u; stress≈−1,810144u). Đây là cộng lại slip để phân rã các fills đã xảy ra, **không phải replay chiến lược không phí**; thay phí/NAV có thể đổi qty/holdings. Kết quả không cho cơ sở để nói chỉ phí là nguyên nhân.

## Phân đoạn của cùng ví

| Phân đoạn | Base | Stress |
|---|---:|---:|
| 50ngày đầu | -4,245040u | -5,165228u |
| 14ngày cuối đã xem | -1,011244u | -1,327146u |

Không reset vốn ở ranh giới50/14. Bởi vậy phần14cuối trong ví64ngày khác phép thử14ngày trước đó bắt đầu100u. Đây là attribution đã đăng ký trước PnL, không đổi kỳ để tìm cửa sổ thắng.

## Dữ liệu và kiểm chứng

40contracts ×18432nến5m ×trade/mark = **1.474.560candles**; bổ sung50ngày bằng240BinanceofficialZIP có publishedCHECKSUM. DailyCSV/filter snapshot và14ngày cuối giữ byte/giá đúng; officialarchive/REST overlap kiểm được.

8448fundingsettlements/case có thời điểm/rate thật:4548có actualfundingmark, **3900thiếu markPrice** do publicAPI403, đã dùng5mOPENmark fallback của engine và đếm rõ. Truy vấn công khai bổ sung22symbols đều403; không coi missingfunding=0. Timestamp/rate từarchive vẫn có. QA trên mark đã biết ghi meanabsdifferenceOPEN0,1278bps/max12,6301bps; không suy ra bound cho3900marks chưa biết.

IndependentDecimal audit **PASS 2,142,656 monetarychecks**,36864frames/1637fills/16896fundingevents, maxerror2,47197e−20u<tolerance1e−12. Reconstruct cash/realized/entry/fees/slip/funding/closeMTM/lot/currentminimum/ICTanchors/daily totals/denominator. Intrabar worst/breach chỉ kiểm reportedconsistency, không venueADL/liquidation/continuousrisk proof.

Protocol **1593inputs REGISTERED_BEFORE_PNL**, SHA`9b4d595b06795cebdf2ff6e2d1b89b7558643051cd8c46a7b565344f6a10b022`; post-run input hashes giữ nguyên. Mỗi case59756engine steps, globalIDs unique/chronological,8448fundingdedupIDs retained. Offline memory optimization chỉ rút processedStepIds khỏi snapshot trước midnightrestore, mọi cash/positions/anchor/latch/counters/fundingIDs giữ nguyên; synthetic6day77full-state/event/summary comparisonsPASS. Source/engine/caseconfig được review độc lập trướcPnL.

Mainfinancial replay: base29,83phút/stress33,13phút, tổng≈62,96phút; không cần chờ64 ngày thực. Preflight ban đầu thiếu protocol do nhầm cwd đã bị chặn trước khi khởi tạo engine, log giữ riêng; không có financialrerun. Data collection bị dừng/restart workers2 trước finalizedmanifest để giảmRAM, không thay PnL.

[Package](../audits/futures-quick-win/momentum-paper-64d-20261014T140124Z/), [protocol](../audits/futures-quick-win/momentum-paper-64d-20261014T140124Z/protocol.json), [verdict](../audits/futures-quick-win/momentum-paper-64d-20261014T140124Z/verdict.json), [money audit](../audits/futures-quick-win/momentum-paper-64d-20261014T140124Z/receipts/independent-ledger-64d-audit.json), [data quality](../audits/futures-quick-win/momentum-paper-64d-20261014T140124Z/receipts/data-quality.json).

## Lộ trình từ kết quả này

1. V1 giữ frozen và **không đề xuất áp dụng**: net64/64 âm cảbase/stress. Mục tiêu economics chưa đạt; không gọi engineering/auditPASS là incomePASS. Luồng paper trước đó chỉ mô phỏng; lượt64này không deploy/reset/order/transfer/privateAPI/paidAI.
2. Kế tiếp cần phép so sánh **cùng64ICTwindow** giữa source-native và versionexecutable100u, đăng ký timing/initialinventory/terminalcosts/cost definitions trướcPnL. Tách alpha, fees/funding/slip và lot/projection; không dùng nativeUTCsubset khác kỳ làm comparator. Giai đoạn này **PLANNED_NOT_REGISTERED_NOT_RUN**, không scheduler hay toolgoalactive.
3. Nếu kiểm soát nguồn dương nhưng100uimplementation âm, ưu tiên projection dùng actualinventory/delta minimum và tracking/net bias; biến thể versionriêng trướcPnL, giữ baseline/results này. Nếu native cũng âm, ưu tiên cơ chế/bằng chứng mới thay vì tiếp tục tune V1 hoặc đổi cửa sổ để báo đạt. Mọi phương án mới vẫn100u/sharedfixed10ICT/unlimitedorders/negative-dayallowed; hỏi nếu chính các yêu cầu đó cần đổi.

Không kết luận mọimomentum/hệthống đều không thể sinh lời từ64ngày này. Kết luận cụ thể: **cấu hình V1 đã thử hiện không đạt điều kiện trung bình dương để áp dụng.**
