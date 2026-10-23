# Spot v3: kiểm chứng policy mạo hiểm sau khi v2 không khớp

Ngày10/10/2026. Phạm vi chỉ backtest; Spot15USDT, giữFutures riêng. Người dùng đã chấp nhận rủi ro và phân bổ50/50; các cap.50/12/3 ban đầu là thiết kế của agent, không phải yêu cầu user về maxrisk. V3 chưa live/paper/provider/Telegram/transfer/runtimechange.

## Vì sao cần một revision riêng

V2 chạy đủ8cases,810,886giây/RAM37.320KiB, nhưng0BUY/SELL. Independent accounting/provenance audit PASS; formalFAIL là không đạt khả thi entry, alpha/PF chưa đo. Planner reasons là union của nhiềuquantity, không thể đổ hết cho riskcap.

Diagnostic chỉ dùng signal, eligibleminuteOPEN và prior5WAP, không replayoutcome: vớiRRhardgate1.5 giữnguyên, risk1.5 chỉ cho trend3/40base và1/40stress, meanreversion0/45. Vì trend không finiteTP,4ATRhurdle không phải payoffmax/forecast để làm hardRRadmission. Meanreversion có thể cóEVdương ởRRthấp nếu empiricalwinrate đủ cao; điều này chưa được chứng minh. Do đó đăng ký **một** jointpolicyrevision, khôngthresholdsweep, trướcfilledmainPnL.

V3 thay `min(.50,NAV/30,headroom)`→`min(1.50,NAV/10,headroom)`; bỏ hardnetRR≥1.5. GiữsoloProfit>0/soloLoss>0, hurdleBenefit≥4×roundtripdrag, fullfillstop/hurdle/flat sellable, 12purchase/3cash, fee/lot/slip/delay, dailyheadroom, entries/exits của hai cơ chế. Ratio vẫn ghi diagnostic. Không có lời hứa4ATR hay p(win), không tự tăng size theo LLMconfidence.

Diagnostic của policy mới cho trend35/40base,29/40stress; reversion9/45base,3/45stress. Đây là fixture độc lập15USDT từngentry; không phải sốtradeactual vì ledger cócash/risk/daily/position state liên tục. Không đủsample30 ởstress là khả năng đã biết trước PnL; vẫn giữ gate30, không hạ.

## Registration và dữ liệu

Protocol `/home/ubuntu/binance-income-research-2026-10-10/spot-aggressive-mechanisms-protocol.json`, canonicalSHA `0bd81f2178eaeb3cf6574bd36077a3aea23928a9249cac2bb67ee3e2fb3d29eb`. Nguồn `backend/spot_aggressive_v3` riêng; v2vàv1 không sửa core. Episodefeatures/setupIDs giữnamespacev2 để so cơ chế, policyID khác rõ.55tests vàdevelopmentMay2023QA trướcregistration; 4financialcases cố định:trend/reversion×base/stress. Không replaymain lại hoặc đổiadmission/cost/riskgates theoPnL.

90archive được hardlink và rehash từcleanmanifest8fe4e856...; không đổiasset/timeframe/điềnmissing/re-download. Derivedmanifest giữexactarchive/qualityrecords, pinoriginalmanifest/aggregation. MainJan2024→Sep2025 vớicontinuous15, confirmationJan2025carryover. Dữ liệu đã xem qua v2vàbuyhold; **retrospectivepolicycomparison**, không gọifreshholdout. Clarificationmetadata chỉ phân biệtMaydevelopmentQA cófill vớimain financialresults chưa thấy trướcregistration; không đổiparameters.

Freezeprotocol/source/dependencies/tests/data vàsnapshot trướcfull. Một process nice10;4mainreplays;wallcap3600s, external3620s, memorytarget256MiB. Fullrun không cónetwork/clientaccount/providerdependencies. Reportpresentationsource pinriêng; independentauditor chỉ đọcartifact khôngrerunstrategy, kiểmownedSOL/cash/fee/caps/solo economics/book+exec NAV/provenance.

## Đánh giá và implement

Gate trước PnL giữnguyên:base net>0/PF≥1.2,stressnet≥0,confirmationbase/stress≥0,DDbase/stress≤3USDT,30closedepisodes cảbase/stress. Samplethiếu màeconomicsđạt=INCONCLUSIVE;economicfail=FAIL. PASS chỉscreen cho việc xem xétpaper; khôngedge/prospectiveguarantee. VPSincrementalcostunknown, AIactual0; net làexchange-scenarioafterfees/slip/rounding, không allcostROI.

Report cảmonthly/daily exec+book,fees/dust,min/risk/cost-skips,exposure,wholeportfoliovsbuyhold/cash,impliedbreak-evenwinrate/concentration/bootstrapdiagnostic. V3không chạymin10/partial50financialsensitivity; đây là hạn chế cần kiểm tiếp nếueconomics/sampledủtốt, không tự coi v2zero-fill sensitivity là bằng chứngv3exit tốt.

Plan triển khai có điều kiện tại `/home/ubuntu/binance-income-research-2026-10-10/new-model-conditional-implementation-plan.md`: closed4h/public1mworker cùngcore, SQLitepaper riêng/checkpoint-idempotency,pairedrules/rules+LLM15virtualaccounts, receipt/costunknownlock, frozenprompt/model, budget, Telegramtriggers, operationaltests vàactivationgates. Không triển khai paidLLM khi kết quả chưa đạt; prior429costunknown cần resolve receipt trướccallmới.14ngày chỉoperationalminimum, khôngproof cho lowfrequencytrend.

## Kết quả v3 — COMPLETE / FAIL

Bốn case đăng ký đã hoàn thành lúc **20:02:59 ICT, 10/10/2026**. Kỳ chính **01/01/2024–30/09/2025, 21 tháng / 639 ngày**, mỗi case dùng ví giả lập 15 USDT liên tục. Wall time **537,247 giây**, peak memory **40.216 KiB**; **55 tests PASS** trước freeze. [Audit kế toán/provenance độc lập](/home/ubuntu/binance-income-research-2026-10-10/backtest-run-v3/artifact-accounting-verification.json) **PASS đủ4case**, đối chiếu13source/dependencies,90archive/checksum, cash/SOL/fee/NAV/PF/risk-cost-gates;6artifact sửa sai đều bị phát hiện. Audit không chạy lại từng phút/indicator hoặc xác minh phí/filter/fill lịch sử; headroom/DD kiểm source và receipt bounds, không chứng minh đường giá khớp thực tế. [Phạm vi kiểm toán](/home/ubuntu/binance-income-research-2026-10-10/new-model-runner-review.md) giữ cả lỗi auditor đã sửa. AccountingPASS không đổi financialFAIL.

| Mô hình/case | Net USDT | Mua/đóng | PF | DD executable USDT | Confirmation 01–09/2025 |
|---|---:|---:|---:|---:|---:|
| Xu hướng 4h/base | −0,3776 | 34/34 | 0,950 | 4,8746 | −0,0273 |
| Xu hướng 4h/stress | −1,5065 | 26/26 | 0,795 | 5,2114 | −0,7464 |
| Hồi phục 4h/base | +0,3608 | 7/7 | 1,207 | 1,5413 | 0,0000 |
| Hồi phục 4h/stress | −0,6156 | 2/2 | 0,527 | 1,5911 | 0,0000 |

**Hai mô hình đều FAIL theo gate đã đăng ký.** Xu hướng âm, PF<1,2, DD>3 USDT, confirmation âm; stress cũng thiếu mẫu 30 lệnh. Hồi phục base có lời nhỏ nhưng stress âm và mẫu 7/2 quá ít. Hồi phục không có entry/exit nào trong năm 2025 ở cả base và stress; confirmation bằng 0 do không giao dịch, chưa xác nhận hiệu quả ngoài phần mẫu đầu năm 2024. Không hạ gate hoặc đổi indicator/risk/admission sau kết quả.

Net đã gồm phí/slippage/rounding mô phỏng, chưa xác minh chi phí VPS và chưa phải all-cost ROI. Chưa có ứng viên khả thi từ hai cơ chế này; không tự mở paper, paid LLM, Telegram hay triển khai live. Chi tiết triển khai có điều kiện giữ để tham khảo cho một ứng viên đủ gate sau này. Bước nghiên cứu mới cần cơ chế hoặc bằng chứng khác rõ ràng và registration riêng trước kết quả, không quét các tham số trên cùng lịch sử nhằm kiếm một cấu hình xanh.

Artifacts: [execution](/home/ubuntu/binance-income-research-2026-10-10/backtest-run-v3/execution.json), [report](/home/ubuntu/binance-income-research-2026-10-10/backtest-run-v3/report.md), [verdict và hashes](/home/ubuntu/binance-income-research-2026-10-10/backtest-run-v3/verdict.json). Protocol, core và dữ liệu đã đăng ký giữ nguyên; source trình bày được pin riêng trong verdict.
