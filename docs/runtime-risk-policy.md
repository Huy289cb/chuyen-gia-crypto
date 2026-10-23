<!-- cct-tracking-cost512-final-status -->
# Hiện hành 21/10 — CCT tracking-cost512 đã kết thúc

Trạng thái đủ hai ca và kiểm toán; kiểm toán PASS_INDEPENDENT_POSTRUN_EVENT_AND_DAY_AUDIT; kết luận POSITIVE_BOTH_COSTS_BELOW_PRIMARY_TARGET. [Kết quả](research/2026-10-20-futures-cct-tracking-cost-512-day-results.md).
CCT_TRACKING_COST_base: net +8.123520u / 512 ngày, mean +0.015866u/ngày, ROI vốn đầu +25.807%, ngày xấu nhất -6.884004u, trần mô hình12 đạt.
CCT_TRACKING_COST_stress: net +6.250015u / 512 ngày, mean +0.012207u/ngày, ROI vốn đầu +19.856%, ngày xấu nhất -6.900325u, trần mô hình12 đạt.

**Live tiếp tục giữ dừng và boot stopped theo quyền hiện hành; không tự triển khai hoặc khởi động lại.** Không đổi cap12/soft−5,9/buffer6,1, marker hold, sổ tiền hoặc cấu hình. Snapshot giữ dừng đạt.
Dương chỉ là mốc trung gian; mục tiêu chính vẫn +0,2u/ngày =102,4u/512 ngày ở cả hai chi phí và rủi ro đạt. Dữ liệu đã xem là phát triển lịch sử, không phải kiểm chứng tương lai; các header đang chạy bên dưới là lịch sử.

Cải thiện soCCTgốc net+0,895180u/+0,627985u; phí vàsụt vốn giảm cảhai ca. Netphícao vẫn thấp hơnactiveallocation6,860398u, khôngthắngmọicấuhình. Chọntracking-cost làmđốichứng nghiêncứu tiếp, chưa đổi live. [Kế hoạch tiếp](plan/2026-10-21-futures-next-roi-hypothesis.md): trước hết đặc tả/kiểm khảthi signedlong/short, vì512loader/admission hiệnlong-only; chưa tạo tín hiệu/registration/PnL tiếp. Khôngsweep hoặc dùng lời BNB đểchọncoin. [Đo giám sát](plan/2026-10-21-futures-monitoring-phase-instrumentation.md) mới làthiết kế, chưaimplement/test mới.

Không còn replay/supervisor/publisher. GET09:45:01ICT21/10 flat0vịthế/0lệnh/0algo/equity30,46375116u; localheld/walletSHA nguyêntrạng, supervisorprotectedfilesPASS. CómộtGEThậukiểmlỗimạng, thửlại1lầnđạt, khôngđổiguard. Registratione04a9e1293035a48de61aa52923c48c647e54111ddd875d8352ed348a30c6d91; đủ2ca737.280phút/512ngày/7.680fundingmỗica/1ví31,47744546u khôngreset. TổngnhánhROI8ca tiền auditPASS; không8mẫuthịtrườngđộclập. Mọi trạngthái đangchạy/chưađăngký20/10 bên dưới là lịch sử.

<!-- /cct-tracking-cost512-final-status -->

# Lịch sử20/10 — chẩn đoán phân bổ hoàn tất, prototype chưa chạy tài chính

Đã tái dựng khớp2.044/2.044 quyết địnhCCT; kiểm tiền/ràng buộc tĩnh độc lậpDecimal55 đạt. Công thức cũ có thể bù thiếu coin bằng dư coin khác. Kiểm đổi cặp cho131quyết định có phương án điểm tốt hơn, nhưng87lệch từngcoin hơn/69tăngchi phí thực hiện tức thời; chưa phải tăngPnL. Một prototype tracking+cost chỉ đổi2biểu thức đã qua9synthetic tests vàreviewAST độc lập; **financialtrial NOT_REGISTERED_NOT_RUN**. [Bằng chứng và lộ trình](research/2026-10-20-futures-projection-and-monitoring-diagnosis.md).

PnL mới nhất vẫnCCTactiveallocation+6.932489u/+6.860398u, mean+0.013540u/+0.013399u/ngày; soCCTgốc−0.295851u/+1.238368u. Mục tiêu chính0,2u/ngày=102,4u/512ngày cảhai cost chưa đạt; khônghạ sang0,2%ví31u. Toàn512ngày đãxem làdevelopment. Tiếp theo review tích hợp/đăng ký đúngmột thử512ngày/hai cost/chỉobjective mới, dùng lạiCCTgốc làmđốichứng; chưalaunch, khôngrerun/sweep/chọncointhắng.

Live/savedbootSTOPPED/userholdgiữ nguyên. GET2026-10-20T15:19:08.157Z xác nhận0vịthế/0lệnh/0algo/equity30.46375116u; localwalletSHAunchanged. Không đổi production/reset/sổtiền/cap12/soft−5,9/buffer6,1/guard15s; khôngauto-resume. Prototype API kếthừa default10/0,10: bất kỳtrialhiệnhành nào phải truyền rõ12/6,1; gross8/lev10 là config nghiêncứu giữ nguyên, khônguser rulemới.

Nhánh vận hành xác nhận statuswrite nằm ngoàitickDuration côngbố; bốnwatchdog60s ghi sau72,491–89,792s, chưa xácđịnhrootcause. Chỉ cóthiết kếđo UTC+monotonic theo pha/reason trong intent vàfaulttests; chưaimplement/certify24/24/ROItiếtkiệm. Giữdurablewrites/quoteguard/userhold. Recoverymodel cũ chỉfixedtapeconditional, khôngPnL/tiếtkiệmphí vàchưaproduction. Các headerdưới là lịch sử.

<!-- cct-active-allocation512-final-status -->
# Hiện hành 20/10 — thử CCT active allocation512 đã kết thúc

Trạng thái đủ hai ca và kiểm toán; kiểm toán PASS_INDEPENDENT_POSTRUN_EVENT_AND_DAY_AUDIT; kết luận POSITIVE_BOTH_COSTS_BELOW_PRIMARY_TARGET. [Kết quả](research/2026-10-20-futures-cct-active-allocation-512-day-results.md).
CCT_ACTIVE_ALLOCATION_base: net +6.932489u / 512 ngày, mean +0.013540u/ngày, ROI vốn đầu +22.024%, ngày xấu nhất -7.672050u, trần mô hình12 đạt.
CCT_ACTIVE_ALLOCATION_stress: net +6.860398u / 512 ngày, mean +0.013399u/ngày, ROI vốn đầu +21.795%, ngày xấu nhất -8.588605u, trần mô hình12 đạt.

**Live tiếp tục giữ dừng và boot stopped theo quyền hiện hành; không tự triển khai hoặc khởi động lại.** Không đổi cap12/soft−5,9/buffer6,1, marker hold, sổ tiền hoặc cấu hình. Snapshot giữ dừng đạt.
Dương chỉ là mốc trung gian; mục tiêu chính vẫn +0,2u/ngày =102,4u/512 ngày ở cả hai chi phí và rủi ro đạt. Dữ liệu đã xem là phát triển lịch sử, không phải kiểm chứng tương lai; các header đang chạy bên dưới là lịch sử.
<!-- /cct-active-allocation512-final-status -->

# Hiện hành20/10 — đang chạy một biến thể CCT active allocation512

Đã dựng và kiểm độc lập512nguồn: oldCCTweight*5/n_active, giữ tín hiệu9kênh/vol90/s6/band20 và8filelõi tiền nguyênbyte. Registration5544307be26ab0ce7de663caba03b058b2bde9c10afde70a9dbbf97c57af2f12 trước financialframes; đãlaunch16:50ICT20/10/PID3122044, hai ca tuần tự, mỗi ca737.280phút/512ngày/mộtví31,47744546u/cap12/soft−5,9/buffer6,1.21tests scaffold+45nhóm review độc lập đạt; chưa cóPnL variant lúcđăngký. KhôngchọnBNBtheokếtquả/khôngsweep/reset/nạp vốn. CCTgốc+7,228341/+5,622029u vàSMAâm là kếtquả cũgiữ nguyên; biếnthể mới có thểxấuđi. Toàn512ngày đãxem làdevelopment. [Theo dõi nghiên cứu](research/2026-10-20-futures-roi-positive-research.md).

LivevàbootprofileSTOPPED, holdgiữ nguyên; GET16:43:55ICT20/10 flat0vịthế/0lệnh/0algo/equity30,46375116u. Khôngauto-resume từresearch. Cap12/−5,9/6,1 vàguard15sgiữ nguyên; khôngđổi production hoặc sổtiền. Primarytarget0,2u/ngày=102,4u cảhaicost, ROI+vàcải thiện soCCTlà cácmốc riêng. Nhánhrecovery có isolatedtrace29incidents/27proposals,1admit/26deny,khôngPnL; cóbugloadstate trongmodelV1đangfixbiệt lập, chưaproduction. Headerxong4ca trước bên dưới làlịchsử củađợttrước.

# Hiện hành 20/10 — nghiên cứu ROI+ đã chốt4ca: CCTdương, SMAâm, live giữ dừng

Đã hoàn tất hai nhánh/hai chi phí trên cùng512ngày vàví31,47744546u/cap12; kiểm toán tiền độc lập4/4PASS, modeleddaily12đạt4/4. CCTlong/cash net+7,228341/+5,622029u, mean+0,014118/+0,010981u/ngày. SMA50/200 net−8,836448/−8,957645u; không chọn cấu hình này để triển khai. CCTtốt hơnconstantlong−23,366837/−23,378984u nhưng chưa đạt mục tiêu+0,2u/ngày=102,4u/512ngày. [Tổng kết và lộ trình](research/2026-10-20-futures-roi-positive-research.md).

Không cònfinancialreplay/supervisor/publisher đang chạy. Các góiCCT85file/SMA90file vàđối chứngcũ196file đãverifychecksumPASS, khôngsửaarchivecũ. LivevàbootprofileSTOPPED, holdcũgiữnguyên; GET16:26:30ICT20/10 xácnhận0vịthế/0lệnhthường/0algo, equity30,46375116u. Vốnthamchiếutest31,47744546u khácvíthật; chưađổi production/traderules/reset/cursor/anchor/intents, khônglệnhthật do research. Cap12/soft−5,9/buffer6,1/guard15sgiữ nguyên.

CCTlợi thếmỏng/PFngày1,0409/1,0323, lời phụthuộcBNB; khôngchọnBNBtheohindsight. Chẩn đoánphíthật: lãi giá+1,2772u nhưngphí2,27917u/net−1,01369u;46,45%phíởrecoveryentries,50,01%ởriskflattenchưađủreason, khôngquyhếtchomonitoringhoặccoiđềuavoidable. Backtestchưamôphỏngfault/recoverytape, nên cầnkiểmchứngvậnhành trước live.

Bước kếtiếp đãghiđềcươngnhưngCHƯAđăngký/chạy: đúngmộtCCTvariant chiaweights×5/n_active theo sốtínhiệudươngđãbiết, khôngđổialpha/cost/risklimits/lot vàkhôngchọncointhắng. Đây là tăngtiếpxúc/tậptrungcóthểxấuđi, khôngdựđoánPnLlineartừ7u. Nhánhvậnhành: lưuclosed-intentreason, nối timing/incident, rồi thiết kếfault-injection/trace-replay recovery; chưa sửa rule. Không tựrerun4ca hoặc mởsweep/khởiđộnglive; usercókếtquảkhảquan mớiapply, hiệnprimarytargetchưađạt. Toàn512ngàyđãxemlàdevelopment, khôngholdoutmới. Các headerđangchạybêndướilàlịchsử. [Bằng chứng tổng hợp](audits/futures-quick-win/roi-positive-research-summary-20261020/README.md).

<!-- sma50-200512-final-status -->
# Hiện hành 20/10 — thử SMA50/200512 đã kết thúc

Trạng thái đủ hai ca và kiểm toán; kiểm toán PASS_INDEPENDENT_POSTRUN_EVENT_AND_DAY_AUDIT; kết luận NET_NOT_POSITIVE_BOTH_COSTS. [Kết quả](research/2026-10-20-futures-sma50-200-512-day-results.md).
SMA50_200_LC_base: net -8.836448u / 512 ngày, mean -0.017259u/ngày, ROI vốn đầu -28.072%, ngày xấu nhất -7.797947u, trần mô hình12 đạt.
SMA50_200_LC_stress: net -8.957645u / 512 ngày, mean -0.017495u/ngày, ROI vốn đầu -28.457%, ngày xấu nhất -7.765818u, trần mô hình12 đạt.

**Live tiếp tục giữ dừng và boot stopped theo quyền hiện hành; không tự triển khai hoặc khởi động lại.** Không đổi cap12/soft−5,9/buffer6,1, marker hold, sổ tiền hoặc cấu hình. Snapshot giữ dừng đạt.
Dương chỉ là mốc trung gian; mục tiêu chính vẫn +0,2u/ngày =102,4u/512 ngày ở cả hai chi phí và rủi ro đạt. Dữ liệu đã xem là phát triển lịch sử, không phải kiểm chứng tương lai; các header đang chạy bên dưới là lịch sử.
<!-- /sma50-200512-final-status -->

# Hiện hành 20/10 — CCT512 dương cả hai chi phí, đang thử SMA50/200

CCTlong/cash512 đã hoàn tất2/2ca và kiểm toán tiền độc lậpPASS: net+7,228341/+5,622029u; mean+0,014118/+0,010981u/ngày, worst−8,260600/−8,396260u, khôngbreach12trongmôhình. Cùngví31,47744546u/512ngày/cap12; tốt hơnconstantlong−23,366837/−23,378984u nhưng dưới mục tiêu+0,2u/ngày. [Kết quảCCT](research/2026-10-20-futures-cct-control-512-day-results.md).

Theo hướng đã chốt trướcPnL, đã đăng ký/chạy2ca SMA50/200long/cash/vol90/s6, không đổi moneyengine/budget/cost/kỳ, khôngsweep. Sourcecốđịnh50/200 vàcausal512đãreviewđộc lập; registratione8c659b5457658a36d6da33e5f3d96ba3897226a2447cff03de527c40e591403 trướcPnL; loaders512targets/7680fundingPASS. Workdir /home/ubuntu/futures-roi-positive-research-20261020/sma50-200, outertimeoutPID3107158; chỉrootđãlaunchsauCCT2costaudit. Tự audit/xuất docs khi xong; chưa có fullSMAresult tại mốc bắt đầu. [Nghiên cứu và tình trạng](research/2026-10-20-futures-roi-positive-research.md).

Live vẫnSTOPPED/flat/bootstopped/hold; khôngauto-promote/restart. Giátrueledger+1,2772u trướcphí nhưng phí2,27917u làmnet−1,01369u:46,45%phíởtechnicalrecoveryentries,50,01%ởriskflattenchưalưuđủreason; khôngquyhếtchophílỗihoặccoiđềuavoidable. [Chi phí vận hành](audits/futures-quick-win/roi-positive-live-cost-gap-20261020/README.md). Cần kiểm chứng vận hành riêng trước live vìbacktestchưamôphỏngfault/recoverytape. Giữ12/−5,9/6,1/guard15s vàtoàn bộsổtiền. Khôngresumecũ/reruncasesđãđónghoặcthaytham sốsauPnL. Tiêu chímeanvẫn0,2u×512=102,4u cảhaicost;ròngdươnglàmốctiến bộ riêng. Snapshot/currentwallet30,46375116u khácvốnthamchiếu31,47744546u, cầnexactcapitalacceptance nếuứngviênđạt.

<!-- cct-original512-final-status -->
# Hiện hành 20/10 — đối chứng CCT512 đã kết thúc

Trạng thái đủ hai ca và kiểm toán; kiểm toán PASS_INDEPENDENT_POSTRUN_EVENT_AND_DAY_AUDIT; kết luận POSITIVE_BOTH_COSTS_BELOW_PRIMARY_TARGET. [Kết quả](research/2026-10-20-futures-cct-control-512-day-results.md).
CCT_ORIGINAL_base: net +7.228341u / 512 ngày, mean +0.014118u/ngày, ROI vốn đầu +22.964%, ngày xấu nhất -8.260600u, trần mô hình12 đạt.
CCT_ORIGINAL_stress: net +5.622029u / 512 ngày, mean +0.010981u/ngày, ROI vốn đầu +17.861%, ngày xấu nhất -8.396260u, trần mô hình12 đạt.

**Live tiếp tục giữ dừng và boot stopped theo quyền hiện hành; không tự triển khai hoặc khởi động lại.** Không đổi cap12/soft−5,9/buffer6,1, marker hold, sổ tiền hoặc cấu hình. Snapshot giữ dừng đạt.
Dương chỉ là mốc trung gian; mục tiêu chính vẫn +0,2u/ngày =102,4u/512 ngày ở cả hai chi phí và rủi ro đạt. Dữ liệu đã xem là phát triển lịch sử, không phải kiểm chứng tương lai; các header đang chạy bên dưới là lịch sử.
<!-- /cct-original512-final-status -->

# Hiện hành 20/10 — nghiên cứu ROI+, đang đối chứng CCT long/cash512 ngày

User yêu cầu nghiên cứu hướng tối ưu ROI+. Chẩn đoán512 cho thấy H0lỗ ngay phần giá tham chiếu−17,28683u, hai nửa256ngày cùng âm; giảm phí/nới cap không có bằng chứng đủ. Đã rà nguồn ManAHL/NBER/AQR và phương pháp đã thử. [Nghiên cứu và thứ tự thử](research/2026-10-20-futures-roi-positive-research.md).

Đúng một đối chứng nguồnCCTlong/cash9kênh/vol90/sizing6/band20 thay constantlong trong frozenengine512, cùng31,47744546u/cap12/soft−5,9/buffer6,1 và hai cost. Chưa có phép thử tài khoản này trên512; không gọi alpha mới. Source128 khớp mọi trường cũ; dựng độc lập512targets/48.640comparisonsPASS;8fileengine/context/reference giữnguyênbyte. Registration15c2c1909a1fe866316f8f9ab1e5aac81eecc58eb6d730d16587cd07bc14f8c3 trướcPnL; loader512/7.680fundingPASS, zero financialframes lúcđăngký. Đãlaunch hai ca tuần tự tại /home/ubuntu/futures-roi-positive-research-20261020/cct-control, outertimeoutPID3031810; run_control.py không có đường bật live, publisher tựlưu kếtquả/kiểmtoán khi xong. Chưa kếtluậnPnL ởmốc bắtđầu; không sửa source đãkhóa/khôngchạytrùng hoặc chọnprefix.

**Live vẫnstopped/flat vàbootstopped**, markerhold cũgiữnguyên. CCTnetdương chỉlàmốctiến bộ, mục tiêu+0,2u/ngày vẫn102,4u/512ngày ởcảhai cost vàriskđạt; khôngthay0,2u bằng0,2%ví31u. Kỳ512đãxem làdevelopment, khôngholdout. Tiếp theo chờfull2ca/audit, cậpnhậtkếtquả trướcnhánhmới; SMA50/200là giảthuyếtkế tiếp cósourceprimary,chưa đăngký/chạy. Khôngnới trần12/khôngreset/chọnBNBtheohindsight/khôngautomaticallyresume.

# Hiện hành 20/10 — 512 ngày hoàn tất, giữ dừng live theo yêu cầu mới

User yêu cầu dừng live và chỉ implement/chạy lại nếu kết quả512ngày khả quan; quyền này thay việc tự khôi phục sau test trước đó. Đợt512ngày đã đủ6/6ca/737.280phút mỗi ca; kiểm toán tiền độc lập6/6PASS, khôngbreach12trongmôhình. H0base/stress net−23,366837/−23,378984u; H1lịch−24,288985/−25,990965u; H2lịch+sốc−27,900071/−28,368054u. Tất cả âm, không đạt bình quân+0,2u/ngày; H1/H2 giảmROI ở cảhai cost, không promote. Vốn đầu mỗi ca31,47744546u, khôngreset/nạp giữa512ngày. [Kết quả đầy đủ](research/2026-10-20-futures-news-shock-512-day-results.md).

**LIVE GIỮ DỪNG**: PM2crypto-portfolio-live stopped/PID0 và bootprofile đãsave stopped; APIonline, legacy/paper/postexitstopped. Dừng khi flat/đốisoát đủ/khôngpending; GET10:55:33ICT20/10 xác nhận0vịthế/0lệnhthường/0algo, cash30,46375116u, netthật−1,0136943u/287fills/264intents. Khônglệnhđóngtay hoặc reset;14kiểmtra bảo toàn/4kiểmtra chặnrestorePASS. Cap12/soft−5,9/buffer6,1 vàguard15s giữnguyên. Marker /home/ubuntu/futures-news-shock-512d-20261020/live-hold.json chặnrestore/recover-only; khôngxóa hoặc restart chỉ vì testxong/reboot/nguồn07ICT. [Bằng chứng giữdừng](audits/futures-quick-win/news-shock-512d-live-hold-20261020/README.md).

Kết quả phục hồi07:44ICT tronggói512 là lịch sửtrước quyềnmới; không phản ánh hiệntrạng. Khôngcòn replay/supervisor/guardian/finalizer. Gói512/196filechecksumPASS giữnguyên; gói giữdừng táchriêng. Điều kiện chạy lại: ứngviên đạt mục tiêu lợi nhuậntoànkỳ/haichi phí vàkiểmtoán tiền/rủiro, sauđókiểmchứng tíchhợp. Khônglặp nguyêntrạng6ca hoặcđổi ngưỡngsaupnl đểgọiPASS;512ngày đãxem là dữliệupháttriểncho nhánhsau, khôngholdoutmới. Snapshotngắnkhôngchứngnhận24/24 vànewsprotectionkhôngsửalỗigiámsát.

<!-- news-shock-512d-finalization-v2 -->
# Hiện hành20/10 — đối chứng512ngày đã kết thúc

Trạng tháiCOMPLETE, kiểm toánPASS_INDEPENDENT_POSTRUN_EVENT_AND_DAY_AUDIT. WorkerResume=PASS_OBSERVED_STABLE_RESUME; snapshotUTC2026-10-20T00:44:31.281289+00:00: running/active, delta0. Bảo toànPASS; cap12giữ nguyên, không tựpromote. [Kết quả và giới hạn](research/2026-10-20-futures-news-shock-512-day-results.md). Không lặp nguyên trạng hoặc nhầm PASS tính tiền với PASS kinh tế/rủi ro.
<!-- /news-shock-512d-finalization-v2 -->

# Hiện hành 20/10 — đang chạy đối chứng tin/sốc 512 ngày theo yêu cầu mới

User yêu cầu backtest512ngày. Đã bổ sung384ngày quá khứ, QA giá/funding/nguồn/lịchPASS; giữ nguyên bytes financialengine và ngưỡng H1/H2. Registrationd24c673c07871e5c07d8c38ff1bb52d8c0c7d50ef633e1f4e310357e4754bb4d trướcPnL;512ngày một ví31,47744546u/cap12/soft−5,9/buffer6,1,6ca tuần tự/cùng2cost.737.280phút/ca,7.680funding,65cửa sổ lịch; phần128ngày dữ liệu/source/calendar khớp kỳ cũ. Xem [đợt hiện hành](research/2026-10-20-futures-news-shock-512-day-backtest.md).

Worker đã dừng06:01ICT khi flat; GET06:03:39 xác nhận0vịthế/lệnh, cash30,49583316u,253fills/236intents. Không reset/đóng tay/thayruntime. Supervisor2953515/guardian2953550 bắt đầu06:23:51ICT, đang H0base; chưa có PnL đủ512ngày. Tự dừng child/đốisoát/kiểmtra hash rồi khôi phục worker cũ sau đợt; bootprofile giữonline, khôngsavepaused.90phút/ca/6h tổng là cutoffoperational, timeout không thànhkếtquả. Không promote guard hoặc mởhypothesis/sweep. Kết quả128ngày dưới giữnguyên, lịch sửgiám sát không bị coiđã sửa.

# Hậu kiểm 00:45 ICT 20/10 — worker chạy nhưng lỗi giám sát tái xuất hiện

Kết quả sáu ca backtest đã hoàn tất và kiểm toán6/6PASS, không đổi. Worker được bật lại và từng active/4vịthế/đốisoát đủ lúc00:34, nhưng có thêm monitoringgap lúc00:39 và00:43 sau khi replay đã kết thúc. Snapshot00:45:35ICT: tiến trìnhrunning, vírisk_latched/live_monitoring_gap, flat/đốisoát đủ/delta0/khôngpendingplan,232fills/219intents; đang chờ phục hồi theo cơ chế hiện hữu, chưa chứng nhận ổn định24/24. Không thay cap12/guard15s, không reset tiền/anchor/cursor. Nguyên nhân gốc chưa xác định; cần ưu tiên điều tra giám sát, không quy cho tin hoặc ghi lớp bảo vệ đã sửa lỗi này. [Bằng chứng hậu kiểm](audits/futures-quick-win/news-shock-post-resume-20261020/README.md). Trạng thái active ở bản nghiệm thu00:34 bên dưới chỉ đúng tại mốc đó.

# Hiện hành 20/10 — backtest tin/sốc hoàn tất 6 ca; worker đã khôi phục

Người dùng cho phép tạm dừng worker trong lúc test; đã dừng khi flat/đối soát đủ rồi chạy tuần tự sáu ca128ngày, đúng31,47744546u/cap12/soft−5,9/buffer6,1 và source/cost đã đăng ký. Hậu kiểm độc lập6/6PASS. H0 net+25,642884/+30,580668u, mean0,200335/0,238911u-ngày; H1+lịch+30,267111/+26,641596u; H2lịch+sốc+15,252486/+10,812689u. H1 tăng net ởbase nhưng giảmstress; H2 giảm cảhai: không đạt tiêu chí tăngROI hai cost, không promote. Tất cả khôngbreach12trongmôhình; không chứng nhận trần qua gap hoặc ROI tươnglai. Đọc [kết quả và hướng tiếp](research/2026-10-20-futures-news-shock-backtest-results.md).

Worker cũ đã bật lạiPID2861289, active/4vịthế/đốisoát delta0; GET00:34:38ICT20/10 lượngkhớpsàn, khôngpendingorders.220fills/202intents gồm4fills/intents phục hồi thật;47kiểmtra bảo toànPASS, config/.env/moduleproduction/anchor/cursor/lịch sử giữnguyên. PM2saved; APIonline, legacy/paper/postexitstopped. Không còn financialreplay. Mẫu nghiệmthu53lần/112giây không phải chứngnhận24/24. Chờ sau5thoátsốc tổng59giờ52 là bằng chứng mới cho giảthuyết táivàosaukhiổnđịnh; chưa thử/thayrule vào lại. SLsàn/lifecycle là nhánh bảo vệ hạ tầng riêng chưa được test hoặc deploy trong đợt này. Không lặp H1/H2 nguyêntrạng hoặc tự mở sweep. Gói mới news-shock-worker-paused-20261020 khóa checksum; các snapshot cũ giữnguyên.

# Hiện hành 19/10 — đã tạm dừng worker theo quyền mới để backtest tin/sốc

Người dùng cho phép tạm dừng worker trong lúc test. Đã tận dụng lúc ví flat/đối soát đủ để dừng riêng `crypto-portfolio-live` lúc16:48UTC; GET sàn16:49:18UTC xác nhận0vịthế/0lệnh thường/0algo, cash30,28485845u. Không đóng tay hoặc reset tiền; worker đã tự flat trước đó. API vẫn online, các worker legacy/paper/postexit vẫn stopped.

Sáu ca đã đăng ký chạy tuần tự từ đầu trong `/home/ubuntu/futures-news-shock-worker-paused-20261019/attempt`, supervisorPID2851988. Giữ nguyên hash replay/candidate/dữ liệu, vốn31,47744546u/cap12/soft−5,9/buffer6,1; H0base→H0stress→H1base→H1stress→H2base→H2stress, mỗi ca184.320phút/128ngày. Checkpoint cũ không đủ trạng thái để resume; không dùng prefix làmPnL. Trạng thái live/risk hiện dừng có chủ đích, không sửa runtime hoặc coi là lỗi chiến lược. Xem [đợt tạm dừng và nghiệm thu](research/2026-10-19-futures-news-shock-worker-paused-backtest.md).

Chưa có kết quả tài chính hoàn tất ở mốc bắt đầu. Supervisor tự thử bật lại worker cũ sau khi replay kết thúc/lỗi, kiểm tra flat/đối soát và bảo toàn config/sổ tiền trước restart; worker vẫn phải qua các gate hiện có, không tự gỡ khóa tài chính. Cấu hình khởi động lại máy được giữ online vì reboot chấm dứt replay; không lưu vĩnh viễn trạng thái tạm dừng. Không tự promote calendar/shock lên live; quyết định sau so sánh đủbase/stress và audit. Header cấm replay trên máy *đang giữlệnh* vẫn có giá trị; quyền tạm dừng mới cho phép phép thử trên máy khi không giữlệnh và worker đãstop.

# Hiện hành 19/10 — nghiên cứu bảo vệ trước tin lớn và sốc thị trường

[Thiết kế và lộ trình](research/2026-10-19-futures-news-shock-protection.md). Đã rà mã và nguồn chính thức Fed/BLS/BEA/NIST/Binance, đối chiếu Freqtrade/nghiên cứu gốc. Hiện chưa có calendar/shock/spread guard hoặc SL sàn; mọi algo order đang bị coi là ngoài quyền. Đề xuất ưu tiên SL khẩn trên sàn → lịch tin có xử lý rổ đang giữ → nhận diện sốc/điều kiện vào lại. Cửa sổ FOMC−30/+90phút, CPI/NFP/PCE/GDP−15/+30 và chờ thị trường10phút/2phút cuối khỏe là ứng viên chưa kiểm chứng, không phải rule đã duyệt. Lịch FOMC đang công bố:01:00/01:30ICT ngày29/10; dùng timezone đúng DST và cập nhật lịch đổi/hủy.

Kết quả lượt này là nghiên cứu/thiết kế, không có backtest mới, thay mã/runtime/config/PM2 hoặc lệnh thủ công. Cap12/soft−5,9/buffer6,1, guard15s và cơ chế vận hành/Telegram đã deploy vẫn giữ. Khoảng09:53 bot tự đóng do monitoringgap rồi tự phục hồi; snapshot sau active/4vịthế/103khớp/88intents, không quy incident cho tin và không gọi là tác dụng lớp bảo vệ mới. SL sàn chỉ giảm phụ thuộc VPS, không bảo đảm cap12 tuyệt đối; ACK/trigger không thay fill/đối soát.

Triển khai cần gate mọi đường daily/pending/recovery và ngay trướcPOST; trạng thái thị trường bền vững tách latch tiền, không reset anchor/cursor hoặc mua bù sau stop. Calendar/feed UNKNOWN không giả không có tin; BLS ICS có trong tài liệu nhưng payload chưa tải thành công, BEA ICS/JSON đã mở. Tối đa hai đối chứng đăng ký trước H1calendar/H2shock, đúng ví31,47744546u/cap12/costs, dữ liệu biết tại thời điểm đó; DRAFT_NOT_REGISTERED_NOT_RUN. Bước tiếp theo là chốt thay đổi rule với người dùng rồi đo/shadow và kiểm thử lifecycle/fault injection, không tự bật theo yêu cầu nghiên cứu. Gói news-shock-protection-research-20261019 riêng; archives cũ giữ nguyên.

# Hiện hành 19/10 — đã giảm cảnh báo Telegram lặp, giữ trần 12u/ngày

[Biên bản và bằng chứng](research/2026-10-19-futures-telegram-alert-dedup.md). Đã deploy riêng ba module thông báo lúc 09:40:28–09:40:47 ICT, live PID2625541, PM2 saved; API không restart. Điều tra 08:52–09:16 có9 lỗi/4 phục hồi do nhiều lỗi đọc phụ chưa được nhận diện và thay nhóm. Lỗi kỹ thuật đã nhận diện chờ60giây, gộp một đợt; chỉ báo phục hồi sau120giây khỏe liên tục và ACK cảnh báo trước. Đây là thời gian thông báo; tự phục hồi giao dịch vẫn30giây cùng các gate hiện có. Tiền/lệnh UNKNOWN/không đối soát/lỗi chưa nhận diện vẫn báo khẩn; dấu nhận dạng theo mức độ tránh chặn nâng mức kỹ thuật→nguy hiểm. Giữ tin mở/đóng/PnL từng coin và21ICT.

92 kiểm tra mục tiêu Node strictassert PASS (26policy/25formatter/41boundary), emit/cú pháp ba module PASS; full Vitest và full semantic TypeScript chưa chạy do tài nguyên, không ghi fullsuitePASS. Hai emit bị dừng ở9giây đã lưu; lượt nhẹ thành công. Nghiệm thu59mẫu/09:41–09:43 active/reconciled/delta0, tuổi quan sát max6803ms, tickgap max3901ms,26 kiểm tra bảo toàn PASS,91khớp/79intents/4vịthế giữ nguyên. Telegram0pending/0failed; chỉ một cặp dừng/phục hồi thật do restart, không gửi test giả. Nhánh chậm60giây chưa xảy ra thực trong mẫu, đã kiểm ngoại tuyến.

Giữ vốn đầu31,47744546u, cap12/soft−5,9/buffer6,1, guard15giây, chiến lược/sizing/SLTP/cursor/anchor/sổ tiền; mọi module portfolio production khác giữ hash. Bản sửa giảm tin nhiễu, chưa sửa nguyên nhân máy chủ hoặc chứng nhận24/24/PnL. Bước tiếp theo vẫn là đo phase và đối chứng giám sát theo nghiên cứu đã lưu; không tự chạy goal/replay nặng. Gói telegram-alert-dedup-20261019 riêng, không sửa archives cũ. Các header cũ về30giây phục hồi thông báo hoặc15u là lịch sử.

# Hiện hành19/10 — trần12u/ngày đã chạy thật; Telegram theo coin và PnL

[Biên bản12u/Telegram](research/2026-10-19-futures-daily12-telegram.md) · [Nghiên cứu giám sát](research/2026-10-19-futures-monitoring-stability-research.md). User hạ trần15→12u/ngày ICT, giữ dựphòng6,1u nên soft−5,9u; triển khai08:52–08:53, livePID2613549, APIrestart và PM2save. Giữ B5/sizing/SLTP/guard15s/nguồn/đối soát; không xin lại quyền đã có. Migration đúng15/−8,9→12/−5,9 một lần, giữ tiền/anchor/worst/cursor/intents/khóa, chặn rollback15. Tên owner/thư mụcDAILY15 giữ vì liên tục quyền/sổ; config và riskBudgetChanges quyết định cap12 đang chạy.

43cases mục tiêu Node strictassert PASS(13risk/25formatter/5errorpolicy), emit6module/cú pháp PASS. Hai lượt Vitest dừng bảo vệ tài nguyên, fullsemanticTS chưa chạy: không ghi fullsuitePASS. Tiền thật08:54:52 GET9checks PASS: equity31,52869985/net+0,05125439u gồm nổi−0,02047005; phí0,73002204/realized+0,80448997/funding−0,00274349.91khớp/79intents/4long giữ nguyên trước/sau deploy, không lệnh do cập nhật; HTTPAPI08:56 cả topconfig/wallet đều12u. Không suy snapshot dương thành kỳ vọng PnL hoặc gán cho cap12; backtest15u cũ không chứng nhận12u.

Telegram ghi rõ MUA/BÁN coin, đóng lãi/lỗ sau phí, từng coin đang giữ lãi/lỗ theo giá với timestamp và cảnh báo chưa phí; thiếu giá/khớp thì chờ, không giả0/flat. Giữ important-only/21ICT, không thêm ticker. Tin phục hồi thật12u+4coin đãACK,0pending/failed;5uncertain cũ đềuACK. Guard15s nguyên vẹn, chưa sửa vònggiám sát: mẫu31 sau deploy có gap12079ms/reconciliation rồiactive, không tô thành ổn định24/24. Điều tra08:20gap25,395s, hoststeal59,14%/IOswapcao; ưu tiên phase timings→statuswriterkhôngchặn→WSsnapshotsauREST, giữfsync tiền và khôngchuyểnhost/đặtthêmorder khi chưa chuẩn bị. Không mở goal/replay nặng trên máy giữlệnh; gói daily12-telegram-20261019 riêng, archives cũ bất biến. Các header15u dưới là lịch sử.

# Hiện hành19/10 — Telegram chỉ tin quan trọng đã deploy; review PnL thật âm

[Thông báo Telegram](research/2026-10-19-futures-telegram-important.md) · [Review và hướng cải thiện](research/2026-10-19-futures-live-pnl-review.md). Đã deploy00:43ICT, livePID2480846, PM2save;111tests chức năng/emit3module/cú pháp PASS, kiểm tra semantic TypeScript toàn phạm vi INCOMPLETE vì áp lực tài nguyên (không ghi PASS). Nghiệm thu61giây/31mẫu active, gapmax2517ms, không lệnh mới do deploy; config/vốn/anchor/sổ tiền/ACK giữ nguyên. Telegram important_only: mở/đóng/PnL, risk/lệnh chưa rõ báo ngay, lỗi kỹ thuật nhận diện chờ60s, phục hồi khỏe30s+sauACK, một báo cáo21ICT; bỏ trạng thái/chuẩn bị/progress/báo ngày trùng. Không gửi giao dịch giả;5uncertain cũ đềuACK,0pending/failed ở mốc chốt.

GET độc lập00:44ICT: vốn29,89018109u so ban đầu31,47744546u, net−1,58726437u gồm nổi+0,03942486u; phí0,56767006/chênhgiáđãchốt−1,05705002/funding−0,00196915;65khớp/56lệnh/7rổđóng/4vịthếmở, khớp sàn. Mẫu23:35–00:29 bốn rổ chênhgiá+0,25198 nhưng phí0,287146 làm net−0,035166; lỗ thị trường rổ lớn nhất−1,19302 trước phí, không quy hết cho lỗi giám sát. Mẫu tài nguyên có steal65,39%/iowait16,39%/swap, chưa xác định nguyên nhân từnggap. Ưu tiên điều tra ổn định→đối chứng điều kiện tái vào sau lỗi lặp→đối chứng giảm tiếp xúc thị trường; chưa có alpha mới hoặc PnL+ thực. CCTlong/cash đã thử, không lặp nguyên trạng/gọi mới. Giữ15u/ngày/soft−8,9/buffer6,1/guard15s, chiến lược và SL/TP như user vừa chấp nhận; không tự resume goal/replay nặng trên máy giữlệnh. Archive mới live-telegram-important-20261019 riêng; không sửa gói cũ.

# Hiện hành18/10 — đã triển khai đo vốn/Telegram; kiểm chứng128ngày hoàn tất

[Biên bản cải tiến](research/2026-10-18-futures-live-improvements.md). Telegram và đường vốn đã deploy19:09ICT,193tests/scopedTS PASS. Baseline một ví31,47744546u/15u-ngày qua128ngày: base+30,892180u/mean+0,241345u-ngày, stress+30,282878u/mean+0,236585; worst−9,946459/−10,159035u, breach15=0 trong mô hình.71ngày dương57ngày âm; nửađầu mean0,0207/nửasau0,462; drawdown5m33,45u; dữ liệu đã xem, không phải OOS/lãi live. Kiểm toán tiền16,17triệu và hậu kiểm12.260checks PASS. Maker42tests PASS nhưng candidatePnLnull/BLOCKED, chưa thay entry taker.

Live23:43ICT đã tự phục hồi sau gián đoạn mới;37fills/35intents/4long khớp sàn, netkhoảng−1,58u/hômnay−1,39u gồm lệnh mở; không nhầm với mean mô phỏng. Giá từng stale, có gap55,301s và mẫu máy chủ chờ CPUcao; cần điều tra vận hành tiếp. Trần15u/ngày, soft−8,9/buffer6,1/guard15s, vốn cấp/anchor/cursor và lịch sử bảo toàn. Telegram37tin trade,15tin mới đãgửi, báo cáo21đúngdữliệu thật; không pending/failed ở mốc chốt. PM2live/API online, legacy/paper/postexit stopped. Không mở goal/rerun tài chính/scheduler; userđãcho phép promote nếu đủ gate, hiệnmakerchưađủ. Gói live-improvements-20261018 khóa checksum; giữ archives cũ.

# Hiện hành18/10 — kiểm tra sâu: đã sửa9nhóm lỗi và triển khai

[Kiểm tra sâu và nghiệm thu](research/2026-10-18-futures-live-hardening.md). Đã deploy18:30:55ICT, livePID2380719; sửa9nhóm lỗi: kế toán thu nhập muộn/anchor, durableledgercoverage, lỗiintentcũ, PREPARED chưaPOST, WScoinđứnggiá, TelegramACKstorage/dailycatchup/đủnhómlỗi/owner.215 tests/scoped TypeScript PASS. Đối chứng ngoại tuyến xác nhận sửa lãi ảo làm lỗ15,4 báo14,4; không phải lỗ live. Sàn22fills/20intents/4long nguyên vẹn, funding-0.00334354u bảo toàn, không lệnh do deploy. 60mẫu active, gapmax2697ms; không blocked/lỗi nền/risklatch. Giữ15u/ngày, soft−8,9/buffer6,1/guard15s và mọi mốc/sổ tiền; PM2 saved, chỉ live/API online. Archives cũ bất biến; gói live-hardening-20261018 khóa checksum. Tiếp theo kiểm tra21ICT/đổi ngày/nguồn07 thực khi đến; không tự tạo lệnh hoặc resume nghiên cứu. Cơ chế mới không chứng nhận mean lợi nhuận.

# Hiện hành18/10 — bản vá snapshot/nguồn07/Telegram đã chạy thật

[Bản sửa và nghiệm thu](research/2026-10-18-futures-live-bugfix.md). Giữ nguyên mọi ngưỡng bên dưới. Cấp quyền dùng đúng snapshot đã đối soát, không mượn freshness của cache mới. Nguồn thông thường retry tối thiểu10s trong cửa sổ60s cũ; backoff và tick vượtUTC không được tiêu thụ sớm cursor. Telegram chỉ chờ tối đa30s cho ACK FILLED đủ điều kiện, engine vẫn chặn lệnh chưa đối soát và lỗi thật cảnh báo ngay.166 tests/scoped TypeScript PASS; deploy13:50ICT, live2303579 active,4vị thế/22fills/20intents bảo toàn, trần15u/ngày và mốc ngày không đổi.60mẫu sau vá không lỗi hoặc khóa rủi ro; chưa qua nguồn07 kế tiếp. Không suy bản vá thành bằng chứng lợi nhuận.

# Hiện hành18/10 — tự phục hồi lỗi kỹ thuật đã bật, rổ thật đã vào lại

[Cơ chế và nghiệm thu phục hồi](research/2026-10-18-futures-live-technical-recovery.md). User cho phép lỗi kỹ thuật phục hồi xong tự đối soát, kiểm tra rủi ro và giao dịch tiếp ngoài lịch07; quyền này thay quy tắc giữ khóa kỹ thuật cả ngày trong báo cáo trước. Chỉ live_monitoring_gap đủ điều kiện tự gỡ: flat/lệnh/fill/cash thật đối soát đủ, metadata/orders/history sau incident/fill cuối,30 giây khỏe liên tục và nguồnB5 nhân quả ngàyUTC hiện tại; tính lại giá/khối lượng/dự phòng. Mọi lý do tiền hoặc thiếu anchor giữ khóa; stopReasons bền vững và ưu tiên tiền nếu trùng gap. Giữ15u/ngày, soft−8,9/buffer6,1, anchor và toàn bộ phí/PnL; không reset cursor hoặc POST chưa rõ.173 tests/scoped TypeScript PASS.

Đã phục hồi12:50:57ICT18/10, worker2286749 active,4long BNB0,04/ETH0,009/SOL0,16/XRP10,4;4lệnh mới FILLED/đối soát đủ, tổng22fills/20intents. Sàn12:52:18: cash31,16003998u, equity31,17188150u theo mark lúc đó; phí mới0,04022048u. Toàn bộ lịch sử cũ/config/anchor/cursor được bảo toàn; không chuyển tiền. Telegram resuming/resumed đã ACK. PM2 saved; bot cũ/paper/post-exit vẫn stopped. Các dòng “nghỉ hôm nay/chờ07 ngày19” bên dưới là lịch sử trước quyền phục hồi mới; không dùng làm trạng thái hiện hành. Cơ chế tái vào thay đổi đường thực thi so với backtest cũ, chưa chứng nhận kỳ vọng lợi nhuận mới.

# Hiện hành18/10 — đã triển khai sửa giám sát live, giữ guard15 giây

[Bản sửa và nghiệm thu](research/2026-10-18-futures-live-monitoring-fix.md). Worker live đã dùng WebSocket mark/book B5, vòng rủi ro2 giây tính từ đầu tick, REST3 giây/không GET retry và metadata/orders/history/intents chạy nền. Cache B5 đã xác thực được lưu để tiếp tục giám sát sau restart; entry phải có dữ liệu mới và đối soát thật. Mỗi tick tối đa một leg nguồn, kế hoạch bền vững hết hạn60 giây, không lặp POST/cursor; lỗi lịch sử chặn entry nhưng không chặn quan sát inventory thuộc bot.139 kiểm thử khác nhau và scoped TypeScript PASS. PM2 live/API online, bot cũ/paper/post-exit vẫn stopped, PM2 đã save.

Giữ vốn đầu31,47744546u, ngân sách15u/ngày, soft−8,9u/buffer6,1u, source/sizing/margin như trước. Sàn xác nhận sau triển khai ví31,20026046u/flat/không lệnh chờ, net−0,277185u,18fills/16intents. Đối chiếu checkpoint xác nhận mọi số tiền, lịch sử, config, latch và source cursor được bảo toàn. Không mở lại rổ hôm nay; chờ nguồn07:00ICT19/10. Bản sửa vận hành không chứng minh mean lợi nhuận. Guard15 giây vẫn đóng khi thật sự mất quan sát và xác minh được vị thế; mạng/VPS treo vẫn là giới hạn. Không reset ví hoặc chuyển tiền. Báo cáo18/10 hai incident bên dưới là trạng thái lịch sử trước vá.

# Hiện hành18/10 — live đã lỗ0,277185u, hai lần đóng vì monitoring gap

[Đánh giá thực](research/2026-10-18-futures-live-worker-review.md). Xác minh Binance07:40:57ICT18/10: vốn31,47744546u →31,20026046u, net−0,277185u/−0,880583%, realized−0,11601/phí0,161175/funding0/thả nổi0; sai số đối soát0. Ngày17−0,19161865u, ngày18 tới07:40−0,08556635u;18fills/16orders đã xác nhận đủ, hiện flat. Cả hai rổ bị đóng vì live_monitoring_gap, chưa chạm15u hay soft−8,9u; chưa đạt mean dương. Không suy hai rổ có sự cố thành kết luận mọi phương pháp bất khả thi.

Ngân sách15u/ngày, vốn thực31,47744546u, source/sizing/guard giữ nguyên. Worker hôm nay đang risk_latched và thỉnh thoảng gặp stalequote; ưu tiên sửa vòng giám sát/nguồn giá, có log timing để điều tra. Chưa có bằng chứng nguyên nhân chính xác của gap17/18; đợt kiểm tra18 có compile trên cùng VPS nên chưa loại ảnh hưởng tải máy. Telegram lượt trước chưa deploy;18/10 đã nối sổ thật, nhận ACK gửi bù từ Telegram, level trades_risk; bản hoàn tất xem báo cáo. Không khởi động bot cũ, không reset ví/tự tái vào lệnh. Các snapshot16/10 bên dưới là lịch sử.

# Hiện hành16/10 — user cho phép LIVE cơ sở,31,47744546u và15u/ngày

[Bàn giao triển khai](research/2026-10-16-futures-constant-direction-live.md). User đã yêu cầu trade thật, đổi ngân sách ngày thành **15u** và chấp nhận dùng số dư hiện có **31,47744546USDT**; không cần nạp100u. Các lệnh cấm live/paper-only/10u trong trạng thái cũ bên dưới là lịch sử, bị quyền mới này thay thế. Giữ source constant-direction B5 vol90 scalar6; cross/one-way/leverage10, gross8, band20%; soft−8,9u/buffer6,1u bảo tồn ngưỡng đóng sớm cơ sở. Không phục hồi rule ICT/SMC/cooldown/exposure100/cap mỗi lệnh cũ. Không chuyển tiền.

**LIVE_ENABLED, đã xác minh cuối22:39ICT16/10**: worker mới running, wallet thật31,47744546u/flat/không bị chặn/chưa trades-intents; chờ source07:00ICT17/10. Lỗi−1003 lần bật đầu đã sửa; hai mẫu khỏe cách98s, used-weight332/286 vàHTTP200. Legacy worker/paper/post-exit stopped để dành quota cho live; PM2 đã save. Legacy crypto-worker stopped; API đã chạy owner guard mới.46 tests và scoped TypeScript PASS;4 order/test được sàn chấp nhận. Xem biên bản cuối báo cáo để có bằng chứng và rollback. Preview31,47744546u khả thi theo filters hiện hành, BTC có thể0 vì minimum. Lãi backtest0,288328u/ngày thuộc100u/10u, không phải kết quả live31u/15u. Ngân sách phần mềm không bảo đảm chống gap/slippage. Không tool goal mới; ưu tiên hoàn tất triển khai được phép, lưu bằng chứng và báo chính xác. Archive cũ giữ nguyên.

# Hiện hành16/10 — đã chạy đối chứng, loại vì vi phạm10u/ngày

[Báo cáo và phạm vi chứng nhận](research/2026-10-16-futures-constant-direction-control.md). Một lần replay128 ngày/hai chi phí hoàn tất. Constant-direction B5 cơ sở net+36,905960u/mean+0,288328u/ngày, worst−11,102854u và2 ngày vượt10u: ca cơ sở đã PASS độc lập toàn tiền và mọi điểm rủi ro trong mô hình. Stress engine net+19,050024u/mean+0,148828u/ngày, worst−14,371738u và3 ngày vượt10u; kiểm toán stress chưa xong khi cap15 phút. Audit toàn bộ **INCOMPLETE_TIMEOUT**, không giả PASS; quyết định riêng **REJECT_VERIFIED_BASE_DAILY_BUDGET_FAILURE** đủ căn cứ từ ca cơ sở đã xác nhận.19 tests chuẩn bị PASS,347 input hashes kiểm lại. Chưa đạt mục tiêu toàn hệ thống, chưa đổi runtime/default/PM2/flags/ví/lệnh thật. Giữ100u ban đầu, chung10u/ngày ICT, net chia mọi ngày≥0,2u, chấp nhận kỳ âm và không cap lệnh; không phục hồi rule cũ. Baseline CCT128 vẫn0,11045/0,09896u/ngày. Đợt đã chốt, không tự retry hoặc mở nhánh mới; các header RUNNING/chưa chạy bên dưới là lịch sử.

# Hiện hành16/10 — đã implement, đang chạy đối chứng128 ngày

[Đợt hiện hành](research/2026-10-16-futures-constant-direction-control.md). User yêu cầu implement; đúng một đối chứng constant-direction B5, hai mức chi phí, một vốn100u/case, ngân sách10u/ngày ICT và mục tiêu net/128≥0,2u/ngày.19 tests chuẩn bị PASS; protocol `a41769e53524a37677dc5a18d208d953e15da0cae9155e5257518f739ef22ec6` khóa347 actual inputs. Replay đã bắt đầu, kết quả chưa biết. Cap30 phút replay/15 phút audit, không tự retry hoặc thêm nhánh. Auditor mới tái dựng độc lập mọi điểm quan sát rủi ro trong mô hình; cần audit kết quả trước kết luận. BaselineCCT128 vẫn0,11045/0,09896u/ngày. Không đổi runtime/default/PM2/flags/ví hoặc lệnh thật. Các header bên dưới là lịch sử, không lấy câu chưa chạy của lượt trạng thái trước làm trạng thái hiện hành.

# Hiện hành16/10 —100u, chung10u/ngày, net chia toàn bộ ngày

[Báo cáo](research/2026-10-15-futures-average-02pct-improvement.md) · [Tích hợp](research/2026-10-16-futures-cct-paper-integration.md).

Ví ban đầu100u, được phép compounding. Mục tiêu là tổng lãi ròng chia **mọi ngày lịch ≥0,2u/ngày**; chấp nhận ngày/kỳ âm và giữ tiền mặt. Ngân sách10u cố định/ngày ICT cho toàn ví, không cap lệnh. Không khôi phục ICT/SMC, cooldown, BTC-only, exposure100u, SL tối thiểu hoặc cap mỗi lệnh cũ. Không yêu cầu từng đoạn64 ngày phải dương.

**Kết quả một ví liên tục128 ngày:** CCT6/buffer1,1u net+14,138086/+12,667211u, mean+0,110454/+0,098963u/ngày cơ sở/chi phí cao; ngày xấu nhất−9,690495/−9,494189u, không breach10u trong mô hình. Audit tiền độc lập6.063.198 kiểm tra PASS. Cả kỳ dương sau chi phí nhưng **chưa đạt0,2u/ngày**. Kỳ phát triển64 ngày đạt0,3574/0,2943; kỳ trước64 ngày âm0,04525/0,05258. Giữ đủ kỳ âm và không cộng hai ví reset để thay một ví128 ngày. Toàn128 ngày hiện đã xem, ứng viên mới dùng lại chỉ là phát triển.

User16/10 yêu cầu áp dụng nếu phù hợp. Đã thêm mã paper `CCT_LC_B5_S6_BUFFER11_V1`: source/projector/shared engine/testbed/provider/service/API/UI, namespace riêng và cursor bền vững. Bộ74 tests ban đầu PASS; sau tối ưu có12 tests engine/testbed PASS, sau sửa funding công bố chậm và khóa protocol có9 tests service/market PASS;14 tests engine cũ chạy lại PASS. Scoped backend và frontend TypeScript đều PASS. Full Next build chưa chứng nhận, có retry tải font và thiếu tài nguyên.

**Đối chiếu TS128 V3 đã hoàn tất PASS:**184.320 phút mỗi ca,4.950 events,6.801.300 phép kiểm tiền; sai lệch tiền lớn nhất0. Protocol `38de575b1bfab9fa9949349f316f7439b3ef5ebb1259d8e62e6125dd4d01e164`,41 inputs, tiền tolerance1e−20, quantity/time exact. Kết quả net/mean/ngân sách khớp Python đã khóa. V1 dừng tối ưu, V2 thất bại vì receiver Decimal20; cả hai được giữ nguyên như lịch sử, không tính PASS. V3 sửa riêng Money40/CCT, giữ rounding legacy;29 tests engine/testbed/legacy và scoped backend TypeScript cuối PASS.

Chưa chọn CCT mặc định hoặc deploy/đổi flags/PM2/reset ví/gửi lệnh thật. Mục tiêu kinh tế còn thiếu, không tự hạ về0,1. Paper quote định kỳ không replay mọi order/biến động bị bỏ lỡ; funding có giới hạn coverage một giờ, không suy thành bảo đảm trần10u liên tục ngoài thị trường. Phát hiện7 khoảng chờ sau ICT reset, tổng49 giờ lịch có tín hiệu đã biết; admission và lợi nhuận khi tái vào chưa được thử.

Nghiên cứu tài chính26 cost cases đã khóa đầy đủ trong gói15/10; không chạy lại để thay kết quả. Gói nghiệm thu mã16/10 riêng; workdir `/home/ubuntu/futures-cct-paper-integration-20261016/`. Không tạo tool goal mới. Các header bên dưới là lịch sử.


Sau phản hồi người dùng về việc chạy đến hết limit: đóng lượt nghiệm thu này bằng kết quả và docs; chỉ giữ một bước nghiên cứu kế tiếp là đối chứng constant-direction B5/128 ngày/hai mức chi phí, sau review và đăng ký riêng. Bộ chuẩn bị/source preflight đã có, chưa chạy tiền. Top20/KPSS tạm giữ ở F, không mở thêm nhánh. Không bắt đầu phép thử mới trong lượt trả lời trạng thái.

# Điều kiện áp dụng bổ sung — 14/10/2026

Người dùng yêu cầu thử **64 ngày** và tổng lãi ròng chia đủ64 ngày phải dương trước áp dụng. [Phép thử](research/2026-10-14-futures-momentum-64-day-test.md) giữ cấu hình hiện tại, đo cả base/stress sau trading fees/slippage/funding và budget10ICT. Đây là điều kiện net toàn kỳ, không yêu cầu mỗi ngày/tháng dương; không đổi vốn100/10u chung hoặc kỳ vọng1u/ngày. Paper chưa phải lệnh thật; historicalpositive không tự xác nhận futureincome.

# Triển khai policy trong portfolio paper — 14/10/2026

[Momentum paper](research/2026-10-14-futures-momentum-paper-implementation.md) đã dùng một wallet 100u, một ngân sách fixed 10u/ngày ICT, phí/funding/MTM chung, durable anchor/latch và close reserve. Không RR/ICT/SMC/cooldown/exposure/SL/risk caps cũ. Replay 14 ngày base/stress không có modeled breach; chưa bảo đảm continuous live hoặc mean 0,2u. Có runtime paper public quotes, không order thật. Các policy/user requirements bên dưới giữ nguyên; statements “chưa migration” phía dưới là trạng thái lịch sử đối với trước triển khai paper, legacy private-trading path vẫn riêng.

# Chính sách Futures hiện hành — 12/10/2026

**Nguồn quyết định: yêu cầu và lời làm rõ của người dùng ngày 12/10/2026.** Cải thiện toàn hệ thống; loại ICT/SMC nếu không hiệu quả. Tài liệu này thay các khóa giao dịch cũ trong AGENTS, README và kế hoạch lịch sử. Lời làm rõ cũng thay câu trả lời trước đó chỉ cho phép ứng viên riêng nhưng giữ giới hạn cũ.

## Chỉ các yêu cầu mới này là ràng buộc của người dùng

| Nội dung | Quyết định hiện hành |
|---|---|
| Vốn Futures ban đầu | **100 USDT** cho tài khoản nghiên cứu; chưa xác minh đã nạp hoặc có đủ số dư thực |
| Lỗ tối đa ngày | **10 USDT/ngày cố định**; không tự tăng thành 10% NAV khi số dư tăng |
| Số lệnh | **Không giới hạn**; không bắt buộc phải giao dịch hoặc tăng số lệnh khớp |
| Ngày âm/dương | Chấp nhận cả hai và ngày không giao dịch; không cần ngày nào cũng lãi |
| Lợi nhuận kỳ vọng | Khoảng **1 USDT ròng/ngày lịch**, tương đương 1% vốn ban đầu 100 USDT; đo qua nhiều ngày |
| Khi cần đổi | Hỏi nếu cần đổi chính các yêu cầu mới; không xin lại quyền bỏ rule cũ đã được bỏ rõ ràng |

**Không còn bắt buộc:** ICT/SMC, chỉ giao dịch BTC, cooldown 1h, exposure 100 USDT, SL tối thiểu 0,8%, target sizing 0,5%, trần 3%/lệnh, circuit drawdown 15%, RR/grade/structure/expectancy cũ. Symbol, entry/exit, lựa chọn chiến lược, sizing, exposure, leverage, stop và tần suất là biến thiết kế nghiên cứu. Tham số ứng viên phải công khai và đăng ký trước PnL; không biến thành rule cứng của người dùng.

Người dùng tiếp tục yêu cầu nghiên cứu và **chấp nhận mạo hiểm**. Averaging/grid, altcoin, long/short, exposure và leverage lớn hơn cũ được nghiên cứu trong yêu cầu mới; không tự thêm trần giao dịch cũ hoặc loại cơ chế chỉ vì rủi ro cao. Lời này chưa đổi ngân sách cố định 10 USDT/ngày. [Nghiên cứu sâu hơn](research/2026-10-12-futures-aggressive-followup.md) ưu tiên EMA-anchor averaging và wick recovery; các tham số ví dụ không phải rule người dùng.

Nhánh mới phải cải thiện chiến lược, execution, quản lý tài khoản, chi phí và đo lường của hệ thống đang có. Framework, model hoặc phương pháp chỉ giữ nếu hiệu quả theo mục tiêu mới.

## Ngân sách ngày và cách đo

Ngày lịch theo **Asia/Ho_Chi_Minh, 00:00–24:00**. Một equity/ngân sách chung cho toàn bộ vốn 100 USDT được nghiên cứu, mọi symbol, chiến lược, vị thế mở và lệnh chờ. Với carry nhiều venue, **tổng hai chân và mọi tài khoản venue dùng chung 10 USDT/ngày**; cộng equity MTM, cashflow và chi phí, không cấp 10 USDT cho mỗi sàn. Không nhân vốn hoặc ngân sách theo các dòng account của DB.

`net_day(t) = equity_MTM(t) - equity_MTM(day_start) - net_cashflow(day_start,t) - external_cost_allocated(day_start,t)`.

Equity phản ánh lãi/lỗ đang mở và đã chốt, trading fees và funding đúng một lần; ghi mark/index, thời điểm và chất lượng dữ liệu. Chi phí AI/hạ tầng ngoài exchange báo riêng và trừ khi đo net kinh tế. Không dùng deposit, vị thế chưa đóng hoặc thiếu cost để che lỗ. Mức 10 USDT được hiểu là mức âm tối đa so với equity đầu ngày đã điều chỉnh cashflow; không tự thêm drawdown từ đỉnh trong ngày.

Mean kỳ vọng = tổng net PnL chia toàn bộ số ngày lịch, gồm ngày không có lệnh. Báo riêng % return/ngày nếu hữu ích; không thay 1u cố định bằng 1% NAV tái đầu tư hoặc chia CAGR/365 để tính mean tiền mặt. Cửa sổ 30/90 ngày và drawdown nhiều ngày là metric; không yêu cầu mỗi cửa sổ dương hoặc áp lại DD 15%.

Governor cần anchor/reservation/latch bền vững; reserve rủi ro nguyên tử cho vị thế mở/lệnh chờ và chi phí đóng/funding/slippage/latency; theo dõi giữa các nến; cancel/reconcile race, reduce-only close và verify exchange khi gần hết ngân sách. Restart không xóa ngân sách hoặc lỗ đã ghi. Thiếu anchor/dữ liệu phải báo thiếu; không lấy equity hiện tại làm đầu ngày rồi báo pass.

**Giới hạn kỹ thuật:** SL/kill switch không bảo đảm tuyệt đối 10u khi gap, mất kết nối hoặc thiếu thanh khoản. Phép thử phải lưu breach/overshoot thật và stress đóng vị thế. Ứng viên vượt ngân sách không được báo đạt bằng sửa ledger hoặc bỏ ngày xấu.

## Policy đã đổi; runtime chưa migration

Lượt 12/10 chỉ nghiên cứu và cập nhật docs, **không sửa `.env`, PM2, DB, số dư, order hoặc tiến trình giao dịch**. Runtime có thể vẫn áp guard cũ: đây là hiện trạng cần migration có version, không là giới hạn thiết kế. Không copy defaults hoặc `.env.example` làm policy mới.

Idempotency, số học tiền tệ, dữ liệu đúng, protective orders và đối soát là tính đúng kỹ thuật để thực thi yêu cầu mới; không khôi phục bộ lọc dự đoán ICT/SMC. Giữ nguyên source/results đã đóng băng; nghiên cứu không tự resume goal/run cũ.

Đọc [lộ trình toàn hệ thống](plan/2026-10-12-futures-system-research-roadmap.md) và [bằng chứng internet](research/2026-10-12-futures-evidence.md). [Policy trước sửa nguyên bytes](audits/2026-10-12-futures-system-reset/prior-docs/docs/runtime-risk-policy.md) là lịch sử, không ghi đè yêu cầu mới.
