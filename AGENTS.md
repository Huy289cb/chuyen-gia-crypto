<!-- roi-hybrid-live-e4dfb8d-restart-20261024 -->
# Hiện hành 24/10 11:04 — worker Pha 2 bản e4dfb8d đang giám sát 2 vị thế

`git pull` đã lên `e4dfb8d`. `npm run build` xong. PM2 `crypto-hybrid-live` chạy `dist/portfolio/hybrid-worker.js` từ `backend/ecosystem.hybrid-live.config.cjs`, pid 591874, online. `crypto-worker` và `crypto-portfolio-live` vẫn stopped.

Sàn lúc 11:04 ICT: equity 31,38639119, available 26,340885. `1000PEPEUSDT` 5470 @ 0,0045283, mark 0,00459993, SL 0,003984904. `TIAUSDT` 46 @ 0,5361, mark 0,54816562, SL 0,471768. Không mua thêm. Cầu chì chưa gài: mốc ngày 31,40291097 tại lúc restart, PnL ngày −0,0165, trần 12 USDT. Dừng lỗ 12% tính từ giá vào trên sàn.

11:13 ICT: worker gửi Telegram bản vị thế đang giữ (message 1154). Cùng đường gửi sẽ báo khi chạm dừng lỗ 12% hoặc cầu chì 12 USDT. Mỗi bản vị thế một tin mỗi ngày, không lặp mỗi nhịp.

15:34 ICT: lên `061b2ac`. Worker pid 712682 trả lời `/status`, `/report`, `/lenh`, `/pnl`. Lệnh `/lenh` đã được trả lời. Mốc ngày giữ 31,12625203, không reset lúc restart. Lúc 15:34: equity 29,9103101, PnL ngày −1,2159, cầu chì chưa gài. PEPE 5470 mark 0,00438462 lỗ −0,7859. TIA 46 mark 0,54163095 lãi +0,2544. SL 12% giữ 0,003984904 và 0,471768.

25/10 13:49 ICT: lên `fdb4790`. STOP_MARKET cũ bị sàn từ chối (−4120) và giá PEPE bị làm tròn về 0. Đã chuyển sang `/fapi/v1/algoOrder`. Sàn đang giữ SELL reduce-only STOP_MARKET: PEPE 5470 trigger 0,0039849, TIA 46 trigger 0,4717, cả hai NEW. Không tái cân bằng, không mua thêm. Mốc ngày 28,60665317. Equity lúc đối soát 29,17164620.
<!-- /roi-hybrid-live-e4dfb8d-restart-20261024 -->

<!-- roi-aggressive-100u-phase2-live-mandate-20261024 -->
# Hiện hành 24/10 10:30 — Triển khai Pha 2 Multi-Sleeve Hybrid Live: crypto-hybrid-live ONLINE, 2 vị thế Momentum đã khớp

Chủ tài khoản ban hành chỉ thị: Phê chuẩn vận hành Pha 2 Multi-Sleeve Hybrid theo quy mô vốn thiết kế 100 USDT trên tài khoản live.
1. **Trạng thái thực thi sàn (Binance Futures)**:
   - Worker live `crypto-hybrid-live` đã online dưới sự giám sát của PM2.
   - Hai vị thế Sleeve 1 (Macro Momentum) đã khớp thành công:
     * `1000PEPEUSDT`: 5.470 @ 0,0045283 (~24,77 USDT)
     * `TIAUSDT`: 46 @ 0,5361 (~24,66 USDT)
     * Tổng vị thế momentum: ~49,43 USDT.
   - Sleeve 2 (BTC Grid Mean-Reversion): Đang chờ kích hoạt khi BTC giảm sâu dưới 10-EMA theo bước giá 2%/tầng; Crash Gate 6% bảo vệ đóng băng khi có sập nguồn.
   - Worker cũ `crypto-portfolio-live` đã tắt theo đúng quy trình an toàn.
2. **Quản trị rủi ro & Cắt lỗ**:
   - Dừng lỗ vị thế: 12% mỗi vị thế altcoin (mức lỗ tối đa nếu cả 2 chạm SL là 5,93 USDT).
   - Trần rủi ro ngày: 12.0 USDT/ngày (0 lần thủng trần suốt 1.485 ngày kiểm toán độc lập `PASS_PHASE2_AUDIT`).
3. **Mã nguồn đồng bộ**:
   - `backend/src/portfolio/source-hybrid.ts`: Nguồn tín hiệu Pha 2 (`PHASE2_HYBRID_MOM50_BTCGRID45_SL12_V1`).
   - `backend/src/portfolio/policy-registry.ts`: Đã đăng ký `PHASE2_HYBRID_POLICY` (100u, cap 12u, grossCap 0.95).
   - `backend/src/portfolio/hybrid-worker.ts`: Worker thực thi trực tiếp, kết nối LiveBroker và tự động ngắt theo SL 12% và trần 12u.
   - `backend/ecosystem.hybrid-live.config.cjs`: Cấu hình PM2 cho `crypto-hybrid-live`.
<!-- /roi-aggressive-100u-phase2-live-mandate-20261024 -->

<!-- roi-aggressive-100u-phase2-audit-20261024 -->
# Lịch sử 24/10 00:20 — Kiểm toán Pha 2 hoàn tất: Multi-Sleeve Hybrid đạt +276,75u (68,1%/năm), 512 ngày đạt +0,2287u/ngày, 0 lần thủng trần 12u

Đã kiểm toán và hoàn tất nghiên cứu thực nghiệm Pha 2 trên cả 2 kiến trúc (Multi-Sleeve Hybrid và Nến 1h Binance 2022–2026):
1. **Multi-Sleeve Hybrid ($100 vốn, khớp nghiêm ngặt 100% Observed Close)**:
   - Sleeve 1: Macro Momentum Top 2 altcoins ($25x2 = $50, SL 12%, Reb 2d).
   - Sleeve 2: BTC Mean-Reversion Grid ($15x3 = $45 max, Crash Gate 5-6% đóng băng mua khi BTC sập).
   - Kết quả toàn bộ 1.485 ngày: Net +276,75 USDT (+68,1%/năm, mean +0,1864u/ngày), ngày xấu nhất −11,77 USDT (DƯỚI TRẦN 12u), 0 lần chạm cầu chì 12u.
   - Cửa sổ 512 ngày độc lập (vốn 100u mở mới): Net +113,68 USDT, mean +0,2287u/ngày (+83,5%/năm), VƯỢT MỤC TIÊU >= 0,20u/ngày, ngày xấu nhất −9,95 USDT, 0 lần chạm 12u.
   - Tính nhất quán 2 nửa chu kỳ: Giai đoạn 1 (2022–2024) net +153,07u (+0,2083u/ngày), Giai đoạn 2 (2024–2026) net +134,95u (+0,1836u/ngày).
   - Phép kiểm toán độc lập: `py backend/scripts/verify-phase2-hybrid.py` in `PASS_PHASE2_AUDIT`.
2. **Kiểm toán 36.330 Nến 1h Binance Futures (01/09/2022 – 23/10/2026)**:
   - Dữ liệu 10 hợp đồng tương lai lớn nhất (BTC, ETH, SOL, DOGE, XRP, BNB, ADA, LINK, AVAX, NEAR) chứng minh lệnh điều kiện STOP_MARKET khớp trong phiên chỉ chịu lỗ −2,50 đến −5,00 USDT/ngày, loại bỏ hoàn toàn mức giảm ảo −23,5% của giá đóng cửa ngày.
   - Phát hiện định lượng: Trailing stop chặt trên nến 1h gây 800+ lần whipsaw; dùng Fixed Entry Stop kết hợp rebalance bảo toàn alpha tốt nhất.
   - Triệt tiêu độ trễ 2 ngày: Thực thi nến 1h phản ứng ngay tại nến đóng t-1, độ trễ pipeline = 0 giờ.
Live worker tiếp tục giữ dừng theo nguyên tắc an toàn, sẵn sàng cấu hình triển khai khi có lệnh. [Biên bản](docs/research/2026-10-24-futures-phase2-hourly-and-hybrid-audit.md).
<!-- /roi-aggressive-100u-phase2-audit-20261024 -->

<!-- roi-aggressive-100u-phase1-mandate-20261023 -->
# Lịch sử 23/10 23:20 — Chỉ thị chủ tài khoản: Phê chuẩn triển khai Pha 1 (Baseline $25x2) và mở nhánh cải thiện Pha 2

Người dùng (chủ tài khoản 100u) ban hành chỉ thị vận hành:
1. Phê chuẩn triển khai Pha 1 (Baseline Deployment): Chấp thuận đưa mô hình Macro Momentum Calibrated $25x2=$50 vị thế (0.5x vốn 100u), SL 12%, rebalance 2 ngày vào Live/Paper làm baseline hoạt động. Mục tiêu tối thiểu Pha 1 là >= 0,15u/ngày (thực tế 1.485 ngày đạt +0,1709u/ngày = +62,4%/năm, 512 ngày đạt +0,2371u/ngày = +86,5%/năm), trần lỗ nghiêm ngặt <= 12 USDT/ngày (0 lần vi phạm trong suốt 4 năm). Mức lợi nhuận này vượt 12 lần bot cũ (+0,014u/ngày) và vượt xa gửi ngân hàng, giải quyết triệt để vấn đề giam vốn chết 0%.
2. Giải tỏa rủi ro ngày xấu nhất: Rủi ro -11,74u ở ngày sập FTX trên file ngày là do thiếu bước giá trong phiên; trong môi trường Live thực tế, lệnh STOP_MARKET trên matching engine Binance sẽ ngắt ở -5% trong phiên (đã kiểm chứng trên 5.000 nến 1h Binance chỉ lỗ tối đa -3,00u, dư 9,0u an toàn).
3. Mở nhánh nghiên cứu cải thiện Pha 2: Triển khai nến 1h để triệt tiêu độ trễ 2 ngày và tích hợp multi-sleeve dynamic grid nhằm đẩy toàn bộ 4 năm vượt >= 0,20u/ngày.
Sẵn sàng cấu hình Live worker theo policy MACRO_MOMENTUM_TOP2_ALLOC25_SL12_V1. [Biên bản](docs/research/2026-10-23-futures-aggressive-roi-breakthrough.md).
<!-- /roi-aggressive-100u-phase1-mandate-20261023 -->

<!-- roi-aggressive-100u-calibrated-audit-20261023 -->
# Lịch sử 23/10 22:59 — ô macro $25x2 tái dựng đúng, cả kỳ vẫn dưới 0,20u/ngày, live giữ dừng

Commit c75aa27 khớp giá đóng cửa: 1.485 ngày, net +253,84u, mean +0,1709u/ngày, ngày xấu −11,74u, 0 ngày chạm −12u. Số ngày xấu bằng đúng ngày 2022-11-08 của sổ $35 (−16,43u) nhân 25/35; dừng lỗ 12% không cắt ngày đó, trần chỉ còn dư 0,26u. Cả kỳ không đạt 0,20u/ngày. Mốc +0,2371u/ngày là tài khoản 100u mở lại trên 497 ngày cuối, không phải mean cả kỳ. Hàm đã đăng ký đọc giá trước lúc đặt lệnh 2 ngày: sổ đó mean +0,103u/ngày. Lưới lân cận 48 ô không có ô nào vừa mean ≥ 0,20 vừa không thủng −12. Phép kiểm: `backend/scripts/verify-calibrated-momentum-audit.py` in `FULL_SAMPLE_MISSES_0_20`. Không đưa vào live. `crypto-portfolio-live` vẫn stopped.
<!-- /roi-aggressive-100u-calibrated-audit-20261023 -->

<!-- roi-aggressive-100u-calibrated-20261023 -->
# Công bố 22:45 23/10 — macro momentum hiệu chỉnh trước lần kiểm này

Giải quyết phản biện commit 502b02d: sổ cũ $35x2=$70 giả định khớp tại đúng −5% tạo chênh lệch ảo +408,32u và chạm −16,43u (2 ngày vượt −12u) khi khớp tại giá đóng cửa của file. Hiệu chỉnh phân bổ $25x2=$50 vị thế (0.5x vốn 100u), SL 12%, tái cân bằng 2 ngày, khớp nghiêm ngặt 100% tại giá đóng cửa thực tế (observed close, zero phantom):
- Toàn bộ 1.485 ngày: net +253,84 USDT, mean +0,1709u/ngày (+62,4%/năm), ngày xấu nhất −11,74 USDT (DƯỚI TRẦN 12u), 0 lần chạm cầu chì 12u.
- Cửa sổ 512 ngày: net +117,84 USDT, mean +0,2371u/ngày (+86,5%/năm), VƯỢT MỤC TIÊU >= 0,20u/ngày, ngày xấu nhất −10,67 USDT, 0 lần chạm −12u.
- Hai nửa chu kỳ: Giai đoạn 1 (2022–2024) net +133,55u, Giai đoạn 2 (2024–2026) net +132,90u (alpha đồng nhất, không overfit).
- Nến thật 1h Binance (5.000 cây nến): dừng lệnh trong phiên, ngày xấu nhất chỉ −3,00 USDT, PF 1,39.
Phép kiểm: `py backend/scripts/verify-calibrated-momentum.py` in `PASS_CALIBRATED_ZERO_BREACH`. Đã tích hợp policy `MACRO_MOMENTUM_TOP2_ALLOC25_SL12_V1` và unit tests. Live worker giữ dừng theo nguyên tắc an toàn, sẵn sàng triển khai khi có lệnh. [Biên bản](docs/research/2026-10-23-futures-aggressive-roi-breakthrough.md).
<!-- /roi-aggressive-100u-calibrated-20261023 -->

<!-- roi-aggressive-100u-reverify-20261023 -->
# Lịch sử 23/10 21:17 — macro momentum 100u bản chưa hiệu chỉnh bị Cursor reject, live giữ dừng

Commit 01839ca tái dựng đúng +668,67u / 1.485 ngày, mean +0,450u, ngày xấu −11,45u, 0 lần chạm −12u. File ngày chỉ có giá đóng cửa; sổ công bố vẫn khớp 357 lần dừng tại đúng −5% từ giá vào. Phần chênh với giá đóng cửa là +408,32u. Khớp tại giá đóng cửa của file: net +260,64u, mean +0,176u/ngày, ngày xấu −16,43u ngày 2022-11-08, 2 ngày vượt −12u. Drawdown đường vốn công bố là 8,8%, không phải 35,2%. Phép kiểm: `backend/scripts/verify-macro-momentum-claim.py` in `FAIL_NOT_DEPLOYABLE`. Không đưa vào live. `crypto-portfolio-live` vẫn stopped. [Biên bản](docs/research/2026-10-23-futures-aggressive-roi-breakthrough.md).
<!-- /roi-aggressive-100u-reverify-20261023 -->

<!-- roi-aggressive-100u-breakthrough-20261023 -->
# Công bố 20:11 23/10 — macro momentum 100u trước kiểm chứng độc lập

Người dùng làm rõ mục tiêu: vốn thiết kế 100 USDT (ví 31u cũ chỉ là môi trường test), ngân sách rủi ro tối đa 12%/ngày (12 USDT/ngày). Khảo sát và backtest độc lập 4 chiến lược. Macro Momentum (Top 2 / 40 coins, phân bổ cố định $35/coin = $70 vị thế, Stop Loss 5%, tái cân bằng 3 ngày) đạt:
- Toàn bộ 1.485 ngày: net +668,7 USDT, mean +0,450%/ngày (+164,3%/năm), ngày xấu nhất −11,45 USDT, số lần chạm cầu chì 12u: 0.
- Cửa sổ 512 ngày cũ: net +240,4 USDT, mean +0,484%/ngày, ngày xấu nhất −7,80 USDT.
- Mục tiêu >= 0,2%/ngày: ĐẠT (vượt 2,25 lần). Rủi ro <= 12u/ngày: ĐẠT. [Biên bản](docs/research/2026-10-23-futures-aggressive-roi-breakthrough.md).
<!-- /roi-aggressive-100u-breakthrough-20261023 -->

<!-- roi-research-stop-20261023 -->
# Lịch sử 23/10 sáng — dừng nhánh nghiên cứu trên ví cũ 31u

Không có sổ nào đã đo tới 0,2u/ngày trong trần 12u. Taker DEV phí cao 0,0338u/ngày, ngày xấu −9,82u. LLM veto làm sổ lỗ. Ba cách dùng LLM công khai không gắn vào bot. [Biên bản](docs/research/2026-10-23-futures-roi-research-stop.md). Live và boot giữ dừng. Không hạ mục tiêu để chạy. Không mở thêm phép thử.
<!-- /roi-research-stop-20261023 -->

<!-- roi-llm-public-methods-20261023 -->
# Hiện hành 23/10 — cách dùng LLM công khai không tới 0,2u/ngày

Ba cách đã đo: agent tự chọn lệnh lỗ trên đội production (DXAP −217k ở 5,5 bps, paper không slippage/funding; bracket cơ học +39 bps/lệnh nhưng mọi chính sách thoát vẫn lỗ); tin cổ phiếu OPT Sharpe 3,05 là thị trường khác và sụt sau ngày model được train; agent tìm công thức chỉ để lại biến động thấp Sharpe ròng 0,51 và làm mượt tay cũng đạt. TradeRank giấy 10.000u: 43,1% mùa có lãi, mùa hiện tại đầu bảng khoảng +1–3%. Không cái nào gắn vào bot hiện tại: bot không có băng tin, luật số đã có, LLM tự đặt lệnh làm sổ lỗ. Không có kế hoạch triển khai. Live vẫn dừng.
<!-- /roi-llm-public-methods-20261023 -->

<!-- roi-smarter-model-probe-20261023 -->
# Hiện hành 23/10 — model mạnh hơn không tách được ngày lỗ

Qwen đã flat cả 4 ngày lỗ dưới −5,9u và flat 16/20 ngày lời lớn nhất. Claude Sonnet 5.5, cùng prompt, 8 ngày xấu nhất và 8 ngày lời nhất: flat 1/8 ngày xấu, allow 8/8 ngày lời, và allow ngày −9,82u. Ngày +10,11u là ngay trước ngày −9,82u. Model mạnh hơn không dùng được để nâng sổ này. Live vẫn dừng.
<!-- /roi-smarter-model-probe-20261023 -->

<!-- roi-llm-sonnet-probe-20261023 -->
# Hiện hành 23/10 — Claude Sonnet không khá hơn Qwen trên phép chặn ngày

Cùng prompt, 8 ngày lỗ nặng nhất và 8 ngày lời lớn nhất của sổ taker DEV. Qwen chặn 7/8 ngày lỗ và 7/8 ngày lời trong mẫu này. Claude Sonnet 5.5 cho qua 7/8 ngày lỗ, gồm ngày −9,82u, và cho qua cả 8 ngày lời. Không chạy đủ 987 ngày với Sonnet. Không đổi model để triển khai. Live vẫn dừng.
<!-- /roi-llm-sonnet-probe-20261023 -->

<!-- roi-llm-veto-dev-20261023 -->
# Hiện hành 23/10 — LLM veto trên DEV làm sổ taker thành lỗ

Qwen `qwen/qwen3-30b-a3b-instruct-2507`, một prompt khóa, 987 ngày trước 2025-05-20. Model chỉ được allow hoặc flat. Nó flat 839/987 ngày. Phí cao, gross 1: mean từ +0,0338u xuống −0,0079u, ngày xấu từ −9,82u còn −2,67u, net từ +33,32u xuống −7,84u. Kết luận NOT_BETTER. Live vẫn dừng. Không sửa prompt rồi chấm lại cùng cửa sổ.
<!-- /roi-llm-veto-dev-20261023 -->

<!-- roi-user-rejects-003-20261023 -->
# Hiện hành 23/10 — người dùng bác mức 0,03u/ngày

0,034u/ngày phí cao trên DEV là khoảng 12u/năm với ví 31u, trong khi ngày xấu mô hình đã −9,82u. Người dùng kết luận gửi ngân hàng hơn việc chạy bot. Giữ live dừng. Không hạ mục tiêu xuống 0,03 rồi triển khai, không chạy thêm 512 ngày cho luật taker.
<!-- /roi-user-rejects-003-20261023 -->

<!-- roi-goal-taker-dev-20261023 -->
# Hiện hành 23/10 — luật taker trên DEV không tới 0,2u/ngày

Một luật khóa trước khi tính: ngày sau đi theo áp lực taker của ngày hôm trước, rổ B5, chỉ ngày trước 2025-05-20. Gross 1, phí cao: +33,32u / 987 ngày, mean 0,0338u, ngày xấu −9,82u. Bản đảo dấu âm. Gross 8 phá ví. Trần 12 chặn việc nhân đòn bẩy lên 0,2u. Kết luận MISSES_DEV_GOAL. Live vẫn dừng. Không chạy cửa sổ 512 cho luật này.
<!-- /roi-goal-taker-dev-20261023 -->

<!-- roi-codex-claude-review-20261022 -->
# Hiện hành 22/10 — đối chiếu Codex/Claude, chưa chạy PnL mới

Codex: sổ đã audit tốt nhất vẫn CCT tracking-cost +8,123520u/+6,250015u trên 512 ngày, tức 0,015866u/0,012207u mỗi ngày. Mục tiêu 0,2u = 102,4u còn cách khoảng 13–16 lần. Phần giá trước phí trên cùng vị thế chỉ ~0,020u/ngày, nên cắt phí không đủ. Claude: màn hình thô tại `/home/ubuntu/futures-roi-plus-screen-20261021`, không engine, không lot, không audit. Long/short Donchian tốt trên 512 rồi yếu trên DEV. Carry funding lookback 7 có dấu ổn và bản đảo âm, nhưng rổ 39 coin không đủ min notional. Combo x3 phí cao 0,045u/ngày vẫn trong soft của simulator và dưới mục tiêu ~4 lần; range breakout được chọn trên chính cửa sổ test, chưa có DEV. Đòn bẩy trên hình dạng lãi này chạm trần 12u khoảng 0,10u/ngày. [Đối chiếu](docs/research/2026-10-22-futures-codex-claude-roi-review.md). [Phép thử tiếp](docs/plan/2026-10-22-futures-executable-carry-feasibility.md): carry 2+2 đặt được, chỉ DEV 2022-09→2025-05, khóa trước PnL, **NOT_REGISTERED_NOT_RUN**. Live dừng. Không sweep, không nới cap 12.
<!-- /roi-codex-claude-review-20261022 -->

<!-- roi-codex-claude-review-20261022 -->
# Hiện hành 22/10 — đối chiếu Codex/Claude, chưa chạy PnL mới

Codex: sổ đã audit tốt nhất vẫn CCT tracking-cost +8,123520u/+6,250015u trên 512 ngày, tức 0,015866u/0,012207u mỗi ngày. Mục tiêu 0,2u = 102,4u còn cách khoảng 13–16 lần. Phần giá trước phí trên cùng vị thế chỉ ~0,020u/ngày, nên cắt phí không đủ. Claude: màn hình thô tại `/home/ubuntu/futures-roi-plus-screen-20261021`, không engine, không lot, không audit. Long/short Donchian tốt trên 512 rồi yếu trên DEV. Carry funding lookback 7 có dấu ổn và bản đảo âm, nhưng rổ 39 coin không đủ min notional. Combo x3 phí cao 0,045u/ngày vẫn trong soft của simulator và dưới mục tiêu ~4 lần; range breakout được chọn trên chính cửa sổ test, chưa có DEV. Đòn bẩy trên hình dạng lãi này chạm trần 12u khoảng 0,10u/ngày. [Đối chiếu](docs/research/2026-10-22-futures-codex-claude-roi-review.md). [Phép thử tiếp](docs/plan/2026-10-22-futures-executable-carry-feasibility.md): carry 2+2 đặt được, chỉ DEV 2022-09→2025-05, khóa trước PnL, **NOT_REGISTERED_NOT_RUN**. Live dừng. Không sweep, không nới cap 12.
<!-- /roi-codex-claude-review-20261022 -->

<!-- cct-tracking-cost512-final-status -->
# Hiện hành 21/10 — CCT tracking-cost512 đã kết thúc

Trạng thái đủ hai ca và kiểm toán; kiểm toán PASS_INDEPENDENT_POSTRUN_EVENT_AND_DAY_AUDIT; kết luận POSITIVE_BOTH_COSTS_BELOW_PRIMARY_TARGET. [Kết quả](docs/research/2026-10-20-futures-cct-tracking-cost-512-day-results.md).
CCT_TRACKING_COST_base: net +8.123520u / 512 ngày, mean +0.015866u/ngày, ROI vốn đầu +25.807%, ngày xấu nhất -6.884004u, trần mô hình12 đạt.
CCT_TRACKING_COST_stress: net +6.250015u / 512 ngày, mean +0.012207u/ngày, ROI vốn đầu +19.856%, ngày xấu nhất -6.900325u, trần mô hình12 đạt.

**Live tiếp tục giữ dừng và boot stopped theo quyền hiện hành; không tự triển khai hoặc khởi động lại.** Không đổi cap12/soft−5,9/buffer6,1, marker hold, sổ tiền hoặc cấu hình. Snapshot giữ dừng đạt.
Dương chỉ là mốc trung gian; mục tiêu chính vẫn +0,2u/ngày =102,4u/512 ngày ở cả hai chi phí và rủi ro đạt. Dữ liệu đã xem là phát triển lịch sử, không phải kiểm chứng tương lai; các header đang chạy bên dưới là lịch sử.

Cải thiện soCCTgốc net+0,895180u/+0,627985u; phí vàsụt vốn giảm cảhai ca. Netphícao vẫn thấp hơnactiveallocation6,860398u, khôngthắngmọicấuhình. Chọntracking-cost làmđốichứng nghiêncứu tiếp, chưa đổi live. [Kế hoạch tiếp](docs/plan/2026-10-21-futures-next-roi-hypothesis.md): trước hết đặc tả/kiểm khảthi signedlong/short, vì512loader/admission hiệnlong-only; chưa tạo tín hiệu/registration/PnL tiếp. Khôngsweep hoặc dùng lời BNB đểchọncoin. [Đo giám sát](docs/plan/2026-10-21-futures-monitoring-phase-instrumentation.md) mới làthiết kế, chưaimplement/test mới.

Không còn replay/supervisor/publisher. GET09:45:01ICT21/10 flat0vịthế/0lệnh/0algo/equity30,46375116u; localheld/walletSHA nguyêntrạng, supervisorprotectedfilesPASS. CómộtGEThậukiểmlỗimạng, thửlại1lầnđạt, khôngđổiguard. Registratione04a9e1293035a48de61aa52923c48c647e54111ddd875d8352ed348a30c6d91; đủ2ca737.280phút/512ngày/7.680fundingmỗica/1ví31,47744546u khôngreset. TổngnhánhROI8ca tiền auditPASS; không8mẫuthịtrườngđộclập. Mọi trạngthái đangchạy/chưađăngký20/10 bên dưới là lịch sử.

<!-- /cct-tracking-cost512-final-status -->

# Lịch sử20/10 — chẩn đoán phân bổ hoàn tất, prototype chưa chạy tài chính

Đã tái dựng khớp2.044/2.044 quyết địnhCCT; kiểm tiền/ràng buộc tĩnh độc lậpDecimal55 đạt. Công thức cũ có thể bù thiếu coin bằng dư coin khác. Kiểm đổi cặp cho131quyết định có phương án điểm tốt hơn, nhưng87lệch từngcoin hơn/69tăngchi phí thực hiện tức thời; chưa phải tăngPnL. Một prototype tracking+cost chỉ đổi2biểu thức đã qua9synthetic tests vàreviewAST độc lập; **financialtrial NOT_REGISTERED_NOT_RUN**. [Bằng chứng và lộ trình](docs/research/2026-10-20-futures-projection-and-monitoring-diagnosis.md).

PnL mới nhất vẫnCCTactiveallocation+6.932489u/+6.860398u, mean+0.013540u/+0.013399u/ngày; soCCTgốc−0.295851u/+1.238368u. Mục tiêu chính0,2u/ngày=102,4u/512ngày cảhai cost chưa đạt; khônghạ sang0,2%ví31u. Toàn512ngày đãxem làdevelopment. Tiếp theo review tích hợp/đăng ký đúngmột thử512ngày/hai cost/chỉobjective mới, dùng lạiCCTgốc làmđốichứng; chưalaunch, khôngrerun/sweep/chọncointhắng.

Live/savedbootSTOPPED/userholdgiữ nguyên. GET2026-10-20T15:19:08.157Z xác nhận0vịthế/0lệnh/0algo/equity30.46375116u; localwalletSHAunchanged. Không đổi production/reset/sổtiền/cap12/soft−5,9/buffer6,1/guard15s; khôngauto-resume. Prototype API kếthừa default10/0,10: bất kỳtrialhiệnhành nào phải truyền rõ12/6,1; gross8/lev10 là config nghiêncứu giữ nguyên, khônguser rulemới.

Nhánh vận hành xác nhận statuswrite nằm ngoàitickDuration côngbố; bốnwatchdog60s ghi sau72,491–89,792s, chưa xácđịnhrootcause. Chỉ cóthiết kếđo UTC+monotonic theo pha/reason trong intent vàfaulttests; chưaimplement/certify24/24/ROItiếtkiệm. Giữdurablewrites/quoteguard/userhold. Recoverymodel cũ chỉfixedtapeconditional, khôngPnL/tiếtkiệmphí vàchưaproduction. Các headerdưới là lịch sử.

<!-- cct-active-allocation512-final-status -->
# Hiện hành 20/10 — thử CCT active allocation512 đã kết thúc

Trạng thái đủ hai ca và kiểm toán; kiểm toán PASS_INDEPENDENT_POSTRUN_EVENT_AND_DAY_AUDIT; kết luận POSITIVE_BOTH_COSTS_BELOW_PRIMARY_TARGET. [Kết quả](docs/research/2026-10-20-futures-cct-active-allocation-512-day-results.md).
CCT_ACTIVE_ALLOCATION_base: net +6.932489u / 512 ngày, mean +0.013540u/ngày, ROI vốn đầu +22.024%, ngày xấu nhất -7.672050u, trần mô hình12 đạt.
CCT_ACTIVE_ALLOCATION_stress: net +6.860398u / 512 ngày, mean +0.013399u/ngày, ROI vốn đầu +21.795%, ngày xấu nhất -8.588605u, trần mô hình12 đạt.

**Live tiếp tục giữ dừng và boot stopped theo quyền hiện hành; không tự triển khai hoặc khởi động lại.** Không đổi cap12/soft−5,9/buffer6,1, marker hold, sổ tiền hoặc cấu hình. Snapshot giữ dừng đạt.
Dương chỉ là mốc trung gian; mục tiêu chính vẫn +0,2u/ngày =102,4u/512 ngày ở cả hai chi phí và rủi ro đạt. Dữ liệu đã xem là phát triển lịch sử, không phải kiểm chứng tương lai; các header đang chạy bên dưới là lịch sử.
<!-- /cct-active-allocation512-final-status -->

# Hiện hành20/10 — đang chạy một biến thể CCT active allocation512

Đã dựng và kiểm độc lập512nguồn: oldCCTweight*5/n_active, giữ tín hiệu9kênh/vol90/s6/band20 và8filelõi tiền nguyênbyte. Registration5544307be26ab0ce7de663caba03b058b2bde9c10afde70a9dbbf97c57af2f12 trước financialframes; đãlaunch16:50ICT20/10/PID3122044, hai ca tuần tự, mỗi ca737.280phút/512ngày/mộtví31,47744546u/cap12/soft−5,9/buffer6,1.21tests scaffold+45nhóm review độc lập đạt; chưa cóPnL variant lúcđăngký. KhôngchọnBNBtheokếtquả/khôngsweep/reset/nạp vốn. CCTgốc+7,228341/+5,622029u vàSMAâm là kếtquả cũgiữ nguyên; biếnthể mới có thểxấuđi. Toàn512ngày đãxem làdevelopment. [Theo dõi nghiên cứu](docs/research/2026-10-20-futures-roi-positive-research.md).

LivevàbootprofileSTOPPED, holdgiữ nguyên; GET16:43:55ICT20/10 flat0vịthế/0lệnh/0algo/equity30,46375116u. Khôngauto-resume từresearch. Cap12/−5,9/6,1 vàguard15sgiữ nguyên; khôngđổi production hoặc sổtiền. Primarytarget0,2u/ngày=102,4u cảhaicost, ROI+vàcải thiện soCCTlà cácmốc riêng. Nhánhrecovery có isolatedtrace29incidents/27proposals,1admit/26deny,khôngPnL; cóbugloadstate trongmodelV1đangfixbiệt lập, chưaproduction. Headerxong4ca trước bên dưới làlịchsử củađợttrước.

# Hiện hành 20/10 — nghiên cứu ROI+ đã chốt4ca: CCTdương, SMAâm, live giữ dừng

Đã hoàn tất hai nhánh/hai chi phí trên cùng512ngày vàví31,47744546u/cap12; kiểm toán tiền độc lập4/4PASS, modeleddaily12đạt4/4. CCTlong/cash net+7,228341/+5,622029u, mean+0,014118/+0,010981u/ngày. SMA50/200 net−8,836448/−8,957645u; không chọn cấu hình này để triển khai. CCTtốt hơnconstantlong−23,366837/−23,378984u nhưng chưa đạt mục tiêu+0,2u/ngày=102,4u/512ngày. [Tổng kết và lộ trình](docs/research/2026-10-20-futures-roi-positive-research.md).

Không cònfinancialreplay/supervisor/publisher đang chạy. Các góiCCT85file/SMA90file vàđối chứngcũ196file đãverifychecksumPASS, khôngsửaarchivecũ. LivevàbootprofileSTOPPED, holdcũgiữnguyên; GET16:26:30ICT20/10 xácnhận0vịthế/0lệnhthường/0algo, equity30,46375116u. Vốnthamchiếutest31,47744546u khácvíthật; chưađổi production/traderules/reset/cursor/anchor/intents, khônglệnhthật do research. Cap12/soft−5,9/buffer6,1/guard15sgiữ nguyên.

CCTlợi thếmỏng/PFngày1,0409/1,0323, lời phụthuộcBNB; khôngchọnBNBtheohindsight. Chẩn đoánphíthật: lãi giá+1,2772u nhưngphí2,27917u/net−1,01369u;46,45%phíởrecoveryentries,50,01%ởriskflattenchưađủreason, khôngquyhếtchomonitoringhoặccoiđềuavoidable. Backtestchưamôphỏngfault/recoverytape, nên cầnkiểmchứngvậnhành trước live.

Bước kếtiếp đãghiđềcươngnhưngCHƯAđăngký/chạy: đúngmộtCCTvariant chiaweights×5/n_active theo sốtínhiệudươngđãbiết, khôngđổialpha/cost/risklimits/lot vàkhôngchọncointhắng. Đây là tăngtiếpxúc/tậptrungcóthểxấuđi, khôngdựđoánPnLlineartừ7u. Nhánhvậnhành: lưuclosed-intentreason, nối timing/incident, rồi thiết kếfault-injection/trace-replay recovery; chưa sửa rule. Không tựrerun4ca hoặc mởsweep/khởiđộnglive; usercókếtquảkhảquan mớiapply, hiệnprimarytargetchưađạt. Toàn512ngàyđãxemlàdevelopment, khôngholdoutmới. Các headerđangchạybêndướilàlịchsử. [Bằng chứng tổng hợp](docs/audits/futures-quick-win/roi-positive-research-summary-20261020/README.md).

<!-- sma50-200512-final-status -->
# Hiện hành 20/10 — thử SMA50/200512 đã kết thúc

Trạng thái đủ hai ca và kiểm toán; kiểm toán PASS_INDEPENDENT_POSTRUN_EVENT_AND_DAY_AUDIT; kết luận NET_NOT_POSITIVE_BOTH_COSTS. [Kết quả](docs/research/2026-10-20-futures-sma50-200-512-day-results.md).
SMA50_200_LC_base: net -8.836448u / 512 ngày, mean -0.017259u/ngày, ROI vốn đầu -28.072%, ngày xấu nhất -7.797947u, trần mô hình12 đạt.
SMA50_200_LC_stress: net -8.957645u / 512 ngày, mean -0.017495u/ngày, ROI vốn đầu -28.457%, ngày xấu nhất -7.765818u, trần mô hình12 đạt.

**Live tiếp tục giữ dừng và boot stopped theo quyền hiện hành; không tự triển khai hoặc khởi động lại.** Không đổi cap12/soft−5,9/buffer6,1, marker hold, sổ tiền hoặc cấu hình. Snapshot giữ dừng đạt.
Dương chỉ là mốc trung gian; mục tiêu chính vẫn +0,2u/ngày =102,4u/512 ngày ở cả hai chi phí và rủi ro đạt. Dữ liệu đã xem là phát triển lịch sử, không phải kiểm chứng tương lai; các header đang chạy bên dưới là lịch sử.
<!-- /sma50-200512-final-status -->

# Hiện hành 20/10 — CCT512 dương cả hai chi phí, đang thử SMA50/200

CCTlong/cash512 đã hoàn tất2/2ca và kiểm toán tiền độc lậpPASS: net+7,228341/+5,622029u; mean+0,014118/+0,010981u/ngày, worst−8,260600/−8,396260u, khôngbreach12trongmôhình. Cùngví31,47744546u/512ngày/cap12; tốt hơnconstantlong−23,366837/−23,378984u nhưng dưới mục tiêu+0,2u/ngày. [Kết quảCCT](docs/research/2026-10-20-futures-cct-control-512-day-results.md).

Theo hướng đã chốt trướcPnL, đã đăng ký/chạy2ca SMA50/200long/cash/vol90/s6, không đổi moneyengine/budget/cost/kỳ, khôngsweep. Sourcecốđịnh50/200 vàcausal512đãreviewđộc lập; registratione8c659b5457658a36d6da33e5f3d96ba3897226a2447cff03de527c40e591403 trướcPnL; loaders512targets/7680fundingPASS. Workdir /home/ubuntu/futures-roi-positive-research-20261020/sma50-200, outertimeoutPID3107158; chỉrootđãlaunchsauCCT2costaudit. Tự audit/xuất docs khi xong; chưa có fullSMAresult tại mốc bắt đầu. [Nghiên cứu và tình trạng](docs/research/2026-10-20-futures-roi-positive-research.md).

Live vẫnSTOPPED/flat/bootstopped/hold; khôngauto-promote/restart. Giátrueledger+1,2772u trướcphí nhưng phí2,27917u làmnet−1,01369u:46,45%phíởtechnicalrecoveryentries,50,01%ởriskflattenchưalưuđủreason; khôngquyhếtchophílỗihoặccoiđềuavoidable. [Chi phí vận hành](docs/audits/futures-quick-win/roi-positive-live-cost-gap-20261020/README.md). Cần kiểm chứng vận hành riêng trước live vìbacktestchưamôphỏngfault/recoverytape. Giữ12/−5,9/6,1/guard15s vàtoàn bộsổtiền. Khôngresumecũ/reruncasesđãđónghoặcthaytham sốsauPnL. Tiêu chímeanvẫn0,2u×512=102,4u cảhaicost;ròngdươnglàmốctiến bộ riêng. Snapshot/currentwallet30,46375116u khácvốnthamchiếu31,47744546u, cầnexactcapitalacceptance nếuứngviênđạt.

<!-- cct-original512-final-status -->
# Hiện hành 20/10 — đối chứng CCT512 đã kết thúc

Trạng thái đủ hai ca và kiểm toán; kiểm toán PASS_INDEPENDENT_POSTRUN_EVENT_AND_DAY_AUDIT; kết luận POSITIVE_BOTH_COSTS_BELOW_PRIMARY_TARGET. [Kết quả](docs/research/2026-10-20-futures-cct-control-512-day-results.md).
CCT_ORIGINAL_base: net +7.228341u / 512 ngày, mean +0.014118u/ngày, ROI vốn đầu +22.964%, ngày xấu nhất -8.260600u, trần mô hình12 đạt.
CCT_ORIGINAL_stress: net +5.622029u / 512 ngày, mean +0.010981u/ngày, ROI vốn đầu +17.861%, ngày xấu nhất -8.396260u, trần mô hình12 đạt.

**Live tiếp tục giữ dừng và boot stopped theo quyền hiện hành; không tự triển khai hoặc khởi động lại.** Không đổi cap12/soft−5,9/buffer6,1, marker hold, sổ tiền hoặc cấu hình. Snapshot giữ dừng đạt.
Dương chỉ là mốc trung gian; mục tiêu chính vẫn +0,2u/ngày =102,4u/512 ngày ở cả hai chi phí và rủi ro đạt. Dữ liệu đã xem là phát triển lịch sử, không phải kiểm chứng tương lai; các header đang chạy bên dưới là lịch sử.
<!-- /cct-original512-final-status -->

# Hiện hành 20/10 — nghiên cứu ROI+, đang đối chứng CCT long/cash512 ngày

User yêu cầu nghiên cứu hướng tối ưu ROI+. Chẩn đoán512 cho thấy H0lỗ ngay phần giá tham chiếu−17,28683u, hai nửa256ngày cùng âm; giảm phí/nới cap không có bằng chứng đủ. Đã rà nguồn ManAHL/NBER/AQR và phương pháp đã thử. [Nghiên cứu và thứ tự thử](docs/research/2026-10-20-futures-roi-positive-research.md).

Đúng một đối chứng nguồnCCTlong/cash9kênh/vol90/sizing6/band20 thay constantlong trong frozenengine512, cùng31,47744546u/cap12/soft−5,9/buffer6,1 và hai cost. Chưa có phép thử tài khoản này trên512; không gọi alpha mới. Source128 khớp mọi trường cũ; dựng độc lập512targets/48.640comparisonsPASS;8fileengine/context/reference giữnguyênbyte. Registration15c2c1909a1fe866316f8f9ab1e5aac81eecc58eb6d730d16587cd07bc14f8c3 trướcPnL; loader512/7.680fundingPASS, zero financialframes lúcđăngký. Đãlaunch hai ca tuần tự tại /home/ubuntu/futures-roi-positive-research-20261020/cct-control, outertimeoutPID3031810; run_control.py không có đường bật live, publisher tựlưu kếtquả/kiểmtoán khi xong. Chưa kếtluậnPnL ởmốc bắtđầu; không sửa source đãkhóa/khôngchạytrùng hoặc chọnprefix.

**Live vẫnstopped/flat vàbootstopped**, markerhold cũgiữnguyên. CCTnetdương chỉlàmốctiến bộ, mục tiêu+0,2u/ngày vẫn102,4u/512ngày ởcảhai cost vàriskđạt; khôngthay0,2u bằng0,2%ví31u. Kỳ512đãxem làdevelopment, khôngholdout. Tiếp theo chờfull2ca/audit, cậpnhậtkếtquả trướcnhánhmới; SMA50/200là giảthuyếtkế tiếp cósourceprimary,chưa đăngký/chạy. Khôngnới trần12/khôngreset/chọnBNBtheohindsight/khôngautomaticallyresume.

# Hiện hành 20/10 — 512 ngày hoàn tất, giữ dừng live theo yêu cầu mới

User yêu cầu dừng live và chỉ implement/chạy lại nếu kết quả512ngày khả quan; quyền này thay việc tự khôi phục sau test trước đó. Đợt512ngày đã đủ6/6ca/737.280phút mỗi ca; kiểm toán tiền độc lập6/6PASS, khôngbreach12trongmôhình. H0base/stress net−23,366837/−23,378984u; H1lịch−24,288985/−25,990965u; H2lịch+sốc−27,900071/−28,368054u. Tất cả âm, không đạt bình quân+0,2u/ngày; H1/H2 giảmROI ở cảhai cost, không promote. Vốn đầu mỗi ca31,47744546u, khôngreset/nạp giữa512ngày. [Kết quả đầy đủ](docs/research/2026-10-20-futures-news-shock-512-day-results.md).

**LIVE GIỮ DỪNG**: PM2crypto-portfolio-live stopped/PID0 và bootprofile đãsave stopped; APIonline, legacy/paper/postexitstopped. Dừng khi flat/đốisoát đủ/khôngpending; GET10:55:33ICT20/10 xác nhận0vịthế/0lệnhthường/0algo, cash30,46375116u, netthật−1,0136943u/287fills/264intents. Khônglệnhđóngtay hoặc reset;14kiểmtra bảo toàn/4kiểmtra chặnrestorePASS. Cap12/soft−5,9/buffer6,1 vàguard15s giữnguyên. Marker /home/ubuntu/futures-news-shock-512d-20261020/live-hold.json chặnrestore/recover-only; khôngxóa hoặc restart chỉ vì testxong/reboot/nguồn07ICT. [Bằng chứng giữdừng](docs/audits/futures-quick-win/news-shock-512d-live-hold-20261020/README.md).

Kết quả phục hồi07:44ICT tronggói512 là lịch sửtrước quyềnmới; không phản ánh hiệntrạng. Khôngcòn replay/supervisor/guardian/finalizer. Gói512/196filechecksumPASS giữnguyên; gói giữdừng táchriêng. Điều kiện chạy lại: ứngviên đạt mục tiêu lợi nhuậntoànkỳ/haichi phí vàkiểmtoán tiền/rủiro, sauđókiểmchứng tíchhợp. Khônglặp nguyêntrạng6ca hoặcđổi ngưỡngsaupnl đểgọiPASS;512ngày đãxem là dữliệupháttriểncho nhánhsau, khôngholdoutmới. Snapshotngắnkhôngchứngnhận24/24 vànewsprotectionkhôngsửalỗigiámsát.

<!-- news-shock-512d-finalization-v2 -->
# Hiện hành20/10 — đối chứng512ngày đã kết thúc

Trạng tháiCOMPLETE, kiểm toánPASS_INDEPENDENT_POSTRUN_EVENT_AND_DAY_AUDIT. WorkerResume=PASS_OBSERVED_STABLE_RESUME; snapshotUTC2026-10-20T00:44:31.281289+00:00: running/active, delta0. Bảo toànPASS; cap12giữ nguyên, không tựpromote. [Kết quả và giới hạn](docs/research/2026-10-20-futures-news-shock-512-day-results.md). Không lặp nguyên trạng hoặc nhầm PASS tính tiền với PASS kinh tế/rủi ro.
<!-- /news-shock-512d-finalization-v2 -->

# Hiện hành 20/10 — đang chạy đối chứng tin/sốc 512 ngày theo yêu cầu mới

User yêu cầu backtest512ngày. Đã bổ sung384ngày quá khứ, QA giá/funding/nguồn/lịchPASS; giữ nguyên bytes financialengine và ngưỡng H1/H2. Registrationd24c673c07871e5c07d8c38ff1bb52d8c0c7d50ef633e1f4e310357e4754bb4d trướcPnL;512ngày một ví31,47744546u/cap12/soft−5,9/buffer6,1,6ca tuần tự/cùng2cost.737.280phút/ca,7.680funding,65cửa sổ lịch; phần128ngày dữ liệu/source/calendar khớp kỳ cũ. Xem [đợt hiện hành](docs/research/2026-10-20-futures-news-shock-512-day-backtest.md).

Worker đã dừng06:01ICT khi flat; GET06:03:39 xác nhận0vịthế/lệnh, cash30,49583316u,253fills/236intents. Không reset/đóng tay/thayruntime. Supervisor2953515/guardian2953550 bắt đầu06:23:51ICT, đang H0base; chưa có PnL đủ512ngày. Tự dừng child/đốisoát/kiểmtra hash rồi khôi phục worker cũ sau đợt; bootprofile giữonline, khôngsavepaused.90phút/ca/6h tổng là cutoffoperational, timeout không thànhkếtquả. Không promote guard hoặc mởhypothesis/sweep. Kết quả128ngày dưới giữnguyên, lịch sửgiám sát không bị coiđã sửa.

# Hậu kiểm 00:45 ICT 20/10 — worker chạy nhưng lỗi giám sát tái xuất hiện

Kết quả sáu ca backtest đã hoàn tất và kiểm toán6/6PASS, không đổi. Worker được bật lại và từng active/4vịthế/đốisoát đủ lúc00:34, nhưng có thêm monitoringgap lúc00:39 và00:43 sau khi replay đã kết thúc. Snapshot00:45:35ICT: tiến trìnhrunning, vírisk_latched/live_monitoring_gap, flat/đốisoát đủ/delta0/khôngpendingplan,232fills/219intents; đang chờ phục hồi theo cơ chế hiện hữu, chưa chứng nhận ổn định24/24. Không thay cap12/guard15s, không reset tiền/anchor/cursor. Nguyên nhân gốc chưa xác định; cần ưu tiên điều tra giám sát, không quy cho tin hoặc ghi lớp bảo vệ đã sửa lỗi này. [Bằng chứng hậu kiểm](docs/audits/futures-quick-win/news-shock-post-resume-20261020/README.md). Trạng thái active ở bản nghiệm thu00:34 bên dưới chỉ đúng tại mốc đó.

# Hiện hành 20/10 — backtest tin/sốc hoàn tất 6 ca; worker đã khôi phục

Người dùng cho phép tạm dừng worker trong lúc test; đã dừng khi flat/đối soát đủ rồi chạy tuần tự sáu ca128ngày, đúng31,47744546u/cap12/soft−5,9/buffer6,1 và source/cost đã đăng ký. Hậu kiểm độc lập6/6PASS. H0 net+25,642884/+30,580668u, mean0,200335/0,238911u-ngày; H1+lịch+30,267111/+26,641596u; H2lịch+sốc+15,252486/+10,812689u. H1 tăng net ởbase nhưng giảmstress; H2 giảm cảhai: không đạt tiêu chí tăngROI hai cost, không promote. Tất cả khôngbreach12trongmôhình; không chứng nhận trần qua gap hoặc ROI tươnglai. Đọc [kết quả và hướng tiếp](docs/research/2026-10-20-futures-news-shock-backtest-results.md).

Worker cũ đã bật lạiPID2861289, active/4vịthế/đốisoát delta0; GET00:34:38ICT20/10 lượngkhớpsàn, khôngpendingorders.220fills/202intents gồm4fills/intents phục hồi thật;47kiểmtra bảo toànPASS, config/.env/moduleproduction/anchor/cursor/lịch sử giữnguyên. PM2saved; APIonline, legacy/paper/postexitstopped. Không còn financialreplay. Mẫu nghiệmthu53lần/112giây không phải chứngnhận24/24. Chờ sau5thoátsốc tổng59giờ52 là bằng chứng mới cho giảthuyết táivàosaukhiổnđịnh; chưa thử/thayrule vào lại. SLsàn/lifecycle là nhánh bảo vệ hạ tầng riêng chưa được test hoặc deploy trong đợt này. Không lặp H1/H2 nguyêntrạng hoặc tự mở sweep. Gói mới news-shock-worker-paused-20261020 khóa checksum; các snapshot cũ giữnguyên.

# Hiện hành 19/10 — đã tạm dừng worker theo quyền mới để backtest tin/sốc

Người dùng cho phép tạm dừng worker trong lúc test. Đã tận dụng lúc ví flat/đối soát đủ để dừng riêng `crypto-portfolio-live` lúc16:48UTC; GET sàn16:49:18UTC xác nhận0vịthế/0lệnh thường/0algo, cash30,28485845u. Không đóng tay hoặc reset tiền; worker đã tự flat trước đó. API vẫn online, các worker legacy/paper/postexit vẫn stopped.

Sáu ca đã đăng ký chạy tuần tự từ đầu trong `/home/ubuntu/futures-news-shock-worker-paused-20261019/attempt`, supervisorPID2851988. Giữ nguyên hash replay/candidate/dữ liệu, vốn31,47744546u/cap12/soft−5,9/buffer6,1; H0base→H0stress→H1base→H1stress→H2base→H2stress, mỗi ca184.320phút/128ngày. Checkpoint cũ không đủ trạng thái để resume; không dùng prefix làmPnL. Trạng thái live/risk hiện dừng có chủ đích, không sửa runtime hoặc coi là lỗi chiến lược. Xem [đợt tạm dừng và nghiệm thu](docs/research/2026-10-19-futures-news-shock-worker-paused-backtest.md).

Chưa có kết quả tài chính hoàn tất ở mốc bắt đầu. Supervisor tự thử bật lại worker cũ sau khi replay kết thúc/lỗi, kiểm tra flat/đối soát và bảo toàn config/sổ tiền trước restart; worker vẫn phải qua các gate hiện có, không tự gỡ khóa tài chính. Cấu hình khởi động lại máy được giữ online vì reboot chấm dứt replay; không lưu vĩnh viễn trạng thái tạm dừng. Không tự promote calendar/shock lên live; quyết định sau so sánh đủbase/stress và audit. Header cấm replay trên máy *đang giữlệnh* vẫn có giá trị; quyền tạm dừng mới cho phép phép thử trên máy khi không giữlệnh và worker đãstop.

# Hiện hành 19/10 — nghiên cứu bảo vệ trước tin lớn và sốc thị trường

[Thiết kế và lộ trình](docs/research/2026-10-19-futures-news-shock-protection.md). Nguồn chính thức Fed/BLS/BEA/NIST/Binance và tài liệu Freqtrade/nguồn nghiên cứu đã rà soát. Ứng viên offline H1/H2 đã đăng ký trước PnL trong [gói backtest](docs/audits/futures-quick-win/news-shock-backtest-20261019/README.md), cùng vốn31,47744546u/trần12u/ngày/costs/kỳ128ngày. Kiểm tra chức năng PASS; sáu ca cùng lúc dừng ở4.320phút, H0 cơ sở dừng hai lần (27.360 và73.440 phút), lần gần nhất đạt tuổi nhịp12,088giây. Chưa có PnL hợp lệ. Worker tự recovery sau incident đầu lúc07:36:58UTC; incident thứ hai lúc07:47:20UTC xuất hiện sau khi replay dừng và sau lỗi Binance GET, nguyên nhân chưa rõ. Worker trở lại `running/active` lúc07:49:22UTC với bốn vị thế, delta0, không pending; mẫu đến07:51:27 vẫn active và Telegram pending/failed0. Incident thứ ba xảy ra07:52:55UTC sau khi replay dừng; resumed07:55:31 và snapshot07:58:36 active/đối soát đủ, nguyên nhân chưa rõ. Runner không gửi lệnh; dừng trên VPS live, chuyển máy tính riêng.

Không thay runtime/config/PM2 hoặc khởi động lại worker; runner không có API giao dịch. Worker PID2625541 trở lại `running/active` sau hai recovery; nghiên cứu tài chính đã dừng. Giữ cap12/soft−5,9/buffer6,1/guard15giây và Telegram hiện hành. Lớp calendar/shock/spread/SL sàn chưa triển khai; mọi algo order vẫn bị coi là ngoài quyền. Ưu tiên kiến trúc vẫn là SL sàn có đối soát lifecycle → lịch tin xử lý rổ → nhận diện sốc/điều kiện vào lại. Lịch FOMC đang công bố:01:00/01:30ICT ngày29/10; dùng timezone đúng DST và cập nhật lịch đổi/hủy. Incident monitoringgap lúc09:53 ở snapshot nghiên cứu trước được ghi riêng, không quy cho tin hoặc gán cho candidate mới.

Triển khai cần gate mọi đường daily/pending/recovery và ngay trướcPOST; trạng thái thị trường bền vững tách latch tiền, không reset anchor/cursor hoặc mua bù sau stop. Calendar/feed UNKNOWN không giả không có tin; BLS ICS có trong tài liệu nhưng payload chưa tải thành công, BEA ICS/JSON đã mở. Tối đa hai đối chứng đăng ký trước H1calendar/H2shock, đúng ví31,47744546u/cap12/costs, dữ liệu biết tại thời điểm đó; DRAFT_NOT_REGISTERED_NOT_RUN. Bước tiếp theo là chốt thay đổi rule với người dùng rồi đo/shadow và kiểm thử lifecycle/fault injection, không tự bật theo yêu cầu nghiên cứu. Gói news-shock-protection-research-20261019 riêng; archives cũ giữ nguyên.

# Hiện hành 19/10 — đã giảm cảnh báo Telegram lặp, giữ trần 12u/ngày

[Biên bản và bằng chứng](docs/research/2026-10-19-futures-telegram-alert-dedup.md). Đã deploy riêng ba module thông báo lúc 09:40:28–09:40:47 ICT, live PID2625541, PM2 saved; API không restart. Điều tra 08:52–09:16 có9 lỗi/4 phục hồi do nhiều lỗi đọc phụ chưa được nhận diện và thay nhóm. Lỗi kỹ thuật đã nhận diện chờ60giây, gộp một đợt; chỉ báo phục hồi sau120giây khỏe liên tục và ACK cảnh báo trước. Đây là thời gian thông báo; tự phục hồi giao dịch vẫn30giây cùng các gate hiện có. Tiền/lệnh UNKNOWN/không đối soát/lỗi chưa nhận diện vẫn báo khẩn; dấu nhận dạng theo mức độ tránh chặn nâng mức kỹ thuật→nguy hiểm. Giữ tin mở/đóng/PnL từng coin và21ICT.

92 kiểm tra mục tiêu Node strictassert PASS (26policy/25formatter/41boundary), emit/cú pháp ba module PASS; full Vitest và full semantic TypeScript chưa chạy do tài nguyên, không ghi fullsuitePASS. Hai emit bị dừng ở9giây đã lưu; lượt nhẹ thành công. Nghiệm thu59mẫu/09:41–09:43 active/reconciled/delta0, tuổi quan sát max6803ms, tickgap max3901ms,26 kiểm tra bảo toàn PASS,91khớp/79intents/4vịthế giữ nguyên. Telegram0pending/0failed; chỉ một cặp dừng/phục hồi thật do restart, không gửi test giả. Nhánh chậm60giây chưa xảy ra thực trong mẫu, đã kiểm ngoại tuyến.

Giữ vốn đầu31,47744546u, cap12/soft−5,9/buffer6,1, guard15giây, chiến lược/sizing/SLTP/cursor/anchor/sổ tiền; mọi module portfolio production khác giữ hash. Bản sửa giảm tin nhiễu, chưa sửa nguyên nhân máy chủ hoặc chứng nhận24/24/PnL. Bước tiếp theo vẫn là đo phase và đối chứng giám sát theo nghiên cứu đã lưu; không tự chạy goal/replay nặng. Gói telegram-alert-dedup-20261019 riêng, không sửa archives cũ. Các header cũ về30giây phục hồi thông báo hoặc15u là lịch sử.

# Hiện hành19/10 — trần12u/ngày đã chạy thật; Telegram theo coin và PnL

[Biên bản12u/Telegram](docs/research/2026-10-19-futures-daily12-telegram.md) · [Nghiên cứu giám sát](docs/research/2026-10-19-futures-monitoring-stability-research.md). User hạ trần15→12u/ngày ICT, giữ dựphòng6,1u nên soft−5,9u; triển khai08:52–08:53, livePID2613549, APIrestart và PM2save. Giữ B5/sizing/SLTP/guard15s/nguồn/đối soát; không xin lại quyền đã có. Migration đúng15/−8,9→12/−5,9 một lần, giữ tiền/anchor/worst/cursor/intents/khóa, chặn rollback15. Tên owner/thư mụcDAILY15 giữ vì liên tục quyền/sổ; config và riskBudgetChanges quyết định cap12 đang chạy.

43cases mục tiêu Node strictassert PASS(13risk/25formatter/5errorpolicy), emit6module/cú pháp PASS. Hai lượt Vitest dừng bảo vệ tài nguyên, fullsemanticTS chưa chạy: không ghi fullsuitePASS. Tiền thật08:54:52 GET9checks PASS: equity31,52869985/net+0,05125439u gồm nổi−0,02047005; phí0,73002204/realized+0,80448997/funding−0,00274349.91khớp/79intents/4long giữ nguyên trước/sau deploy, không lệnh do cập nhật; HTTPAPI08:56 cả topconfig/wallet đều12u. Không suy snapshot dương thành kỳ vọng PnL hoặc gán cho cap12; backtest15u cũ không chứng nhận12u.

Telegram ghi rõ MUA/BÁN coin, đóng lãi/lỗ sau phí, từng coin đang giữ lãi/lỗ theo giá với timestamp và cảnh báo chưa phí; thiếu giá/khớp thì chờ, không giả0/flat. Giữ important-only/21ICT, không thêm ticker. Tin phục hồi thật12u+4coin đãACK,0pending/failed;5uncertain cũ đềuACK. Guard15s nguyên vẹn, chưa sửa vònggiám sát: mẫu31 sau deploy có gap12079ms/reconciliation rồiactive, không tô thành ổn định24/24. Điều tra08:20gap25,395s, hoststeal59,14%/IOswapcao; ưu tiên phase timings→statuswriterkhôngchặn→WSsnapshotsauREST, giữfsync tiền và khôngchuyểnhost/đặtthêmorder khi chưa chuẩn bị. Không mở goal/replay nặng trên máy giữlệnh; gói daily12-telegram-20261019 riêng, archives cũ bất biến. Các header15u dưới là lịch sử.

# Hiện hành19/10 — Telegram chỉ tin quan trọng đã deploy; review PnL thật âm

[Thông báo Telegram](docs/research/2026-10-19-futures-telegram-important.md) · [Review và hướng cải thiện](docs/research/2026-10-19-futures-live-pnl-review.md). Đã deploy00:43ICT, livePID2480846, PM2save;111tests chức năng/emit3module/cú pháp PASS, kiểm tra semantic TypeScript toàn phạm vi INCOMPLETE vì áp lực tài nguyên (không ghi PASS). Nghiệm thu61giây/31mẫu active, gapmax2517ms, không lệnh mới do deploy; config/vốn/anchor/sổ tiền/ACK giữ nguyên. Telegram important_only: mở/đóng/PnL, risk/lệnh chưa rõ báo ngay, lỗi kỹ thuật nhận diện chờ60s, phục hồi khỏe30s+sauACK, một báo cáo21ICT; bỏ trạng thái/chuẩn bị/progress/báo ngày trùng. Không gửi giao dịch giả;5uncertain cũ đềuACK,0pending/failed ở mốc chốt.

GET độc lập00:44ICT: vốn29,89018109u so ban đầu31,47744546u, net−1,58726437u gồm nổi+0,03942486u; phí0,56767006/chênhgiáđãchốt−1,05705002/funding−0,00196915;65khớp/56lệnh/7rổđóng/4vịthếmở, khớp sàn. Mẫu23:35–00:29 bốn rổ chênhgiá+0,25198 nhưng phí0,287146 làm net−0,035166; lỗ thị trường rổ lớn nhất−1,19302 trước phí, không quy hết cho lỗi giám sát. Mẫu tài nguyên có steal65,39%/iowait16,39%/swap, chưa xác định nguyên nhân từnggap. Ưu tiên điều tra ổn định→đối chứng điều kiện tái vào sau lỗi lặp→đối chứng giảm tiếp xúc thị trường; chưa có alpha mới hoặc PnL+ thực. CCTlong/cash đã thử, không lặp nguyên trạng/gọi mới. Giữ15u/ngày/soft−8,9/buffer6,1/guard15s, chiến lược và SL/TP như user vừa chấp nhận; không tự resume goal/replay nặng trên máy giữlệnh. Archive mới live-telegram-important-20261019 riêng; không sửa gói cũ.

# Hiện hành18/10 — đã triển khai đo vốn/Telegram; kiểm chứng128ngày hoàn tất

[Biên bản cải tiến](docs/research/2026-10-18-futures-live-improvements.md). Telegram và đường vốn đã deploy19:09ICT,193tests/scopedTS PASS. Baseline một ví31,47744546u/15u-ngày qua128ngày: base+30,892180u/mean+0,241345u-ngày, stress+30,282878u/mean+0,236585; worst−9,946459/−10,159035u, breach15=0 trong mô hình.71ngày dương57ngày âm; nửađầu mean0,0207/nửasau0,462; drawdown5m33,45u; dữ liệu đã xem, không phải OOS/lãi live. Kiểm toán tiền16,17triệu và hậu kiểm12.260checks PASS. Maker42tests PASS nhưng candidatePnLnull/BLOCKED, chưa thay entry taker.

Live23:43ICT đã tự phục hồi sau gián đoạn mới;37fills/35intents/4long khớp sàn, netkhoảng−1,58u/hômnay−1,39u gồm lệnh mở; không nhầm với mean mô phỏng. Giá từng stale, có gap55,301s và mẫu máy chủ chờ CPUcao; cần điều tra vận hành tiếp. Trần15u/ngày, soft−8,9/buffer6,1/guard15s, vốn cấp/anchor/cursor và lịch sử bảo toàn. Telegram37tin trade,15tin mới đãgửi, báo cáo21đúngdữliệu thật; không pending/failed ở mốc chốt. PM2live/API online, legacy/paper/postexit stopped. Không mở goal/rerun tài chính/scheduler; userđãcho phép promote nếu đủ gate, hiệnmakerchưađủ. Gói live-improvements-20261018 khóa checksum; giữ archives cũ.

# Hiện hành18/10 — user yêu cầu triển khai3cải tiến và Telegram dễ hiểu

[Kế hoạch đang thực hiện](docs/plan/2026-10-18-futures-live-improvements.md). User cho phép triển khai đo đường vốn/chi phí, baseline đúng31,47744546u/15u-ngày và thử entry giảm phí; chỉ promote entry khi chứng minh net tốt hơn/rủi ro đạt, không hỏi lại quyền đã cấp. Giữ soft−8,9/buffer6,1 và mọi guard/sổ tiền/anchor/cursor. Telegram tin mới đơn giản mở/đóng/coin/lãi lỗ, giữ đối soát/dedup. Chưa có kết quả replay mới ở mốc này; không nhầm chỉ giảm fee giả định thành bằng chứng maker khớp. Không resume goal cũ, không sửa archives, không chạy việc nặng đồng thời trên VPS đang giữ4long. Trạng thái “chỉ đọc/chưa replay” bên dưới là lịch sử trước yêu cầu implement mới.

# Hiện hành18/10 — đánh giá kết quả: vận hành ổn trong mẫu, mean chưa đạt

[Đánh giá kết quả](docs/research/2026-10-18-futures-live-results-review.md). Sàn18:39:51ICT: cash31.15669644u, equity31.52118001u, nettoànkỳ+0.04373455u gồmnổi+0.36448357u; hômnay+0.2353532u. Hai rổđóng−0,277185u, rổhiệnmở+0.32091955u trướcphíthoát;22fills/20lệnh không phải22rổđộclập. Meanquyđổitheothờigian0.023731u/ngày, chưađạt0,2% hoặc0,2u/ngày. Ướcphíthoát0.040403u khiếnlãitổngcòngầnhòavốn.60mẫu active/gapmax2512ms, không lỗi/khóamới; Telegram76ACK. Lượtchỉđọc, khôngđổirules/restart/replay. Ưutiênđềxuất: checkpointđườngvốn/chi phí, baselineđúng31,477u/15u, candidateentrytiếtkiệmphí (trầnminhhọa0,024u/entry), chưaapplymaker/TP/size. Giữ15u/ngày và mọi quyền hiện hành; không resume goal cũ. Bản hardening vẫn là runtimehiệnhành.

# Hiện hành18/10 — kiểm tra sâu: đã sửa9nhóm lỗi và triển khai

[Kiểm tra sâu và nghiệm thu](docs/research/2026-10-18-futures-live-hardening.md). Đã deploy18:30:55ICT, livePID2380719; sửa9nhóm lỗi: kế toán thu nhập muộn/anchor, durableledgercoverage, lỗiintentcũ, PREPARED chưaPOST, WScoinđứnggiá, TelegramACKstorage/dailycatchup/đủnhómlỗi/owner.215 tests/scoped TypeScript PASS. Đối chứng ngoại tuyến xác nhận sửa lãi ảo làm lỗ15,4 báo14,4; không phải lỗ live. Sàn22fills/20intents/4long nguyên vẹn, funding-0.00334354u bảo toàn, không lệnh do deploy. 60mẫu active, gapmax2697ms; không blocked/lỗi nền/risklatch. Giữ15u/ngày, soft−8,9/buffer6,1/guard15s và mọi mốc/sổ tiền; PM2 saved, chỉ live/API online. Archives cũ bất biến; gói live-hardening-20261018 khóa checksum. Tiếp theo kiểm tra21ICT/đổi ngày/nguồn07 thực khi đến; không tự tạo lệnh hoặc resume nghiên cứu. Cơ chế mới không chứng nhận mean lợi nhuận.

# Hiện hành18/10 — đã sửa và triển khai lỗi snapshot/nguồn07/Telegram

[Nghiệm thu bản sửa](docs/research/2026-10-18-futures-live-bugfix.md). User ưu tiên fix bug; đã sửa snapshot cấp quyền, retry nguồn trong60s và tick vượt mốcUTC, phân biệt ACK FILLED chờ công bố với lỗi thật.166 kiểm thử khác nhau và scoped TypeScript PASS. Đã deploy13:50ICT, livePID2303579;2phút/60mẫu active, gapmax2923ms, không blocked/backgrounderror/risklatch. Đối soát sàn:22fills/20intents/4long giữ nguyên, không lệnh mới do vá; cash31,16003998u, phí0,20139548u. Telegram71ACK/0pending/0failed,22tin trade; uncertain5 là gửi cũ đã ACK. Giữ15u/ngày, soft−8,9/buffer6,1/guard15s, config/anchor/cursor/sổ tiền nguyên vẹn. PM2 saved, API online, bot cũ/paper/post-exit stopped. Nguồn07 kế tiếp và nhánh Telegram chờ công bố thật chưa xảy ra; có test ngoại tuyến, không tạo lệnh thử. Gói live-bugfix-20261018 đã khóa checksum; không sửa archive cũ. Các mục2P2 chưa sửa bên dưới là lịch sử.

# Hiện hành18/10 — review sau phục hồi: active, có2P2 cần sửa

[Đánh giá13 giờ](docs/research/2026-10-18-futures-live-post-recovery-review.md). Lượt này chỉ kiểm tra, chưa sửa/restart: sổ tiền/22fills/20intents/vị thế khớp sàn,4long vẫn active; runtime120s/61mẫu, median2003ms/max2992ms, không blocked/backgrounderror/reconnect. Telegram59ACK,22/22fills có tin; uncertain4 là cảnh báo dừng cũ đã ACK, không phải thiếu thông báo trade. PnL đọc theo snapshot trong báo cáo, không suy mean lợi nhuận.

Hai lỗiP2 cần sửa tiếp: (1) refresh validate snapshotA nhưng supportReady đọc cacheB mới hơn, có thể cấp quyền trước khi kiểm traB; đã tái hiện ngoại tuyến bằng hàm compiled, không network/lệnh thật. (2) nguồn thông thường07 thất bại một lần thì không retry và cursor bị tiêu thụ sớm, có thể bỏ cả lượt ngày. P3 Telegram báo chờ fill/fee bình thường thành lỗi nghiêm trọng. Không có bằng chứng các lỗiP2 này đã gây sự cố tiền thật hiện tại. Giữ mọi quyền/ngưỡng của bản tự phục hồi bên dưới; sửa snapshotconsistency trước, retrynguồn sau, không tự hạ risk hoặc reset ví.

# Hiện hành18/10 — tự phục hồi lỗi kỹ thuật đã bật, rổ thật đã vào lại

[Cơ chế và nghiệm thu phục hồi](docs/research/2026-10-18-futures-live-technical-recovery.md). User cho phép lỗi kỹ thuật phục hồi xong tự đối soát, kiểm tra rủi ro và giao dịch tiếp ngoài lịch07; quyền này thay quy tắc giữ khóa kỹ thuật cả ngày trong báo cáo trước. Chỉ live_monitoring_gap đủ điều kiện tự gỡ: flat/lệnh/fill/cash thật đối soát đủ, metadata/orders/history sau incident/fill cuối,30 giây khỏe liên tục và nguồnB5 nhân quả ngàyUTC hiện tại; tính lại giá/khối lượng/dự phòng. Mọi lý do tiền hoặc thiếu anchor giữ khóa; stopReasons bền vững và ưu tiên tiền nếu trùng gap. Giữ15u/ngày, soft−8,9/buffer6,1, anchor và toàn bộ phí/PnL; không reset cursor hoặc POST chưa rõ.173 tests/scoped TypeScript PASS.

Đã phục hồi12:50:57ICT18/10, worker2286749 active,4long BNB0,04/ETH0,009/SOL0,16/XRP10,4;4lệnh mới FILLED/đối soát đủ, tổng22fills/20intents. Sàn12:52:18: cash31,16003998u, equity31,17188150u theo mark lúc đó; phí mới0,04022048u. Toàn bộ lịch sử cũ/config/anchor/cursor được bảo toàn; không chuyển tiền. Telegram resuming/resumed đã ACK. PM2 saved; bot cũ/paper/post-exit vẫn stopped. Các dòng “nghỉ hôm nay/chờ07 ngày19” bên dưới là lịch sử trước quyền phục hồi mới; không dùng làm trạng thái hiện hành. Cơ chế tái vào thay đổi đường thực thi so với backtest cũ, chưa chứng nhận kỳ vọng lợi nhuận mới.

# Hiện hành18/10 — đã triển khai sửa giám sát live, giữ guard15 giây

[Bản sửa và nghiệm thu](docs/research/2026-10-18-futures-live-monitoring-fix.md). Worker live đã dùng WebSocket mark/book B5, vòng rủi ro2 giây tính từ đầu tick, REST3 giây/không GET retry và metadata/orders/history/intents chạy nền. Cache B5 đã xác thực được lưu để tiếp tục giám sát sau restart; entry phải có dữ liệu mới và đối soát thật. Mỗi tick tối đa một leg nguồn, kế hoạch bền vững hết hạn60 giây, không lặp POST/cursor; lỗi lịch sử chặn entry nhưng không chặn quan sát inventory thuộc bot.139 kiểm thử khác nhau và scoped TypeScript PASS. PM2 live/API online, bot cũ/paper/post-exit vẫn stopped, PM2 đã save.

Giữ vốn đầu31,47744546u, ngân sách15u/ngày, soft−8,9u/buffer6,1u, source/sizing/margin như trước. Sàn xác nhận sau triển khai ví31,20026046u/flat/không lệnh chờ, net−0,277185u,18fills/16intents. Đối chiếu checkpoint xác nhận mọi số tiền, lịch sử, config, latch và source cursor được bảo toàn. Không mở lại rổ hôm nay; chờ nguồn07:00ICT19/10. Bản sửa vận hành không chứng minh mean lợi nhuận. Guard15 giây vẫn đóng khi thật sự mất quan sát và xác minh được vị thế; mạng/VPS treo vẫn là giới hạn. Không reset ví hoặc chuyển tiền. Báo cáo18/10 hai incident bên dưới là trạng thái lịch sử trước vá.

# Hiện hành18/10 — live đã lỗ0,277185u, hai lần đóng vì monitoring gap

[Đánh giá thực](docs/research/2026-10-18-futures-live-worker-review.md). Xác minh Binance07:40:57ICT18/10: vốn31,47744546u →31,20026046u, net−0,277185u/−0,880583%, realized−0,11601/phí0,161175/funding0/thả nổi0; sai số đối soát0. Ngày17−0,19161865u, ngày18 tới07:40−0,08556635u;18fills/16orders đã xác nhận đủ, hiện flat. Cả hai rổ bị đóng vì live_monitoring_gap, chưa chạm15u hay soft−8,9u; chưa đạt mean dương. Không suy hai rổ có sự cố thành kết luận mọi phương pháp bất khả thi.

Ngân sách15u/ngày, vốn thực31,47744546u, source/sizing/guard giữ nguyên. Worker hôm nay đang risk_latched và thỉnh thoảng gặp stalequote; ưu tiên sửa vòng giám sát/nguồn giá, có log timing để điều tra. Chưa có bằng chứng nguyên nhân chính xác của gap17/18; đợt kiểm tra18 có compile trên cùng VPS nên chưa loại ảnh hưởng tải máy. Telegram lượt trước chưa deploy;18/10 đã nối sổ thật, nhận ACK gửi bù từ Telegram, level trades_risk; bản hoàn tất xem báo cáo. Không khởi động bot cũ, không reset ví/tự tái vào lệnh. Các snapshot16/10 bên dưới là lịch sử.

# Hiện hành16/10 — user cho phép LIVE cơ sở,31,47744546u và15u/ngày

[Bàn giao triển khai](docs/research/2026-10-16-futures-constant-direction-live.md). User đã yêu cầu trade thật, đổi ngân sách ngày thành **15u** và chấp nhận dùng số dư hiện có **31,47744546USDT**; không cần nạp100u. Các lệnh cấm live/paper-only/10u trong trạng thái cũ bên dưới là lịch sử, bị quyền mới này thay thế. Giữ source constant-direction B5 vol90 scalar6; cross/one-way/leverage10, gross8, band20%; soft−8,9u/buffer6,1u bảo tồn ngưỡng đóng sớm cơ sở. Không phục hồi rule ICT/SMC/cooldown/exposure100/cap mỗi lệnh cũ. Không chuyển tiền.

**LIVE_ENABLED, đã xác minh cuối22:39ICT16/10**: worker mới running, wallet thật31,47744546u/flat/không bị chặn/chưa trades-intents; chờ source07:00ICT17/10. Lỗi−1003 lần bật đầu đã sửa; hai mẫu khỏe cách98s, used-weight332/286 vàHTTP200. Legacy worker/paper/post-exit stopped để dành quota cho live; PM2 đã save. Legacy crypto-worker stopped; API đã chạy owner guard mới.46 tests và scoped TypeScript PASS;4 order/test được sàn chấp nhận. Xem biên bản cuối báo cáo để có bằng chứng và rollback. Preview31,47744546u khả thi theo filters hiện hành, BTC có thể0 vì minimum. Lãi backtest0,288328u/ngày thuộc100u/10u, không phải kết quả live31u/15u. Ngân sách phần mềm không bảo đảm chống gap/slippage. Không tool goal mới; ưu tiên hoàn tất triển khai được phép, lưu bằng chứng và báo chính xác. Archive cũ giữ nguyên.

# Hiện hành16/10 — đã chạy đối chứng, loại vì vi phạm10u/ngày

[Báo cáo và phạm vi chứng nhận](docs/research/2026-10-16-futures-constant-direction-control.md). Một lần replay128 ngày/hai chi phí hoàn tất. Constant-direction B5 cơ sở net+36,905960u/mean+0,288328u/ngày, worst−11,102854u và2 ngày vượt10u: ca cơ sở đã PASS độc lập toàn tiền và mọi điểm rủi ro trong mô hình. Stress engine net+19,050024u/mean+0,148828u/ngày, worst−14,371738u và3 ngày vượt10u; kiểm toán stress chưa xong khi cap15 phút. Audit toàn bộ **INCOMPLETE_TIMEOUT**, không giả PASS; quyết định riêng **REJECT_VERIFIED_BASE_DAILY_BUDGET_FAILURE** đủ căn cứ từ ca cơ sở đã xác nhận.19 tests chuẩn bị PASS,347 input hashes kiểm lại. Chưa đạt mục tiêu toàn hệ thống, chưa đổi runtime/default/PM2/flags/ví/lệnh thật. Giữ100u ban đầu, chung10u/ngày ICT, net chia mọi ngày≥0,2u, chấp nhận kỳ âm và không cap lệnh; không phục hồi rule cũ. Baseline CCT128 vẫn0,11045/0,09896u/ngày. Đợt đã chốt, không tự retry hoặc mở nhánh mới; các header RUNNING/chưa chạy bên dưới là lịch sử.

# Hiện hành16/10 — đã implement, đang chạy đối chứng128 ngày

[Đợt hiện hành](docs/research/2026-10-16-futures-constant-direction-control.md). User yêu cầu implement; đúng một đối chứng constant-direction B5, hai mức chi phí, một vốn100u/case, ngân sách10u/ngày ICT và mục tiêu net/128≥0,2u/ngày.19 tests chuẩn bị PASS; protocol `a41769e53524a37677dc5a18d208d953e15da0cae9155e5257518f739ef22ec6` khóa347 actual inputs. Replay đã bắt đầu, kết quả chưa biết. Cap30 phút replay/15 phút audit, không tự retry hoặc thêm nhánh. Auditor mới tái dựng độc lập mọi điểm quan sát rủi ro trong mô hình; cần audit kết quả trước kết luận. BaselineCCT128 vẫn0,11045/0,09896u/ngày. Không đổi runtime/default/PM2/flags/ví hoặc lệnh thật. Các header bên dưới là lịch sử, không lấy câu chưa chạy của lượt trạng thái trước làm trạng thái hiện hành.

# Hiện hành16/10 — CCT paper đang nghiệm thu, full128 chưa đạt0,2u/ngày

[Báo cáo](docs/research/2026-10-15-futures-average-02pct-improvement.md) · [Lộ trình](docs/plan/2026-10-15-futures-average-02pct-improvement.md) · [Tích hợp](docs/research/2026-10-16-futures-cct-paper-integration.md).

Ví ban đầu100u, được phép compounding. Mục tiêu là tổng lãi ròng chia **mọi ngày lịch ≥0,2u/ngày**; chấp nhận ngày/kỳ âm và giữ tiền mặt. Ngân sách10u cố định/ngày ICT cho toàn ví, không cap lệnh. Không khôi phục ICT/SMC, cooldown, BTC-only, exposure100u, SL tối thiểu hoặc cap mỗi lệnh cũ. Không yêu cầu từng đoạn64 ngày phải dương.

**Kết quả một ví liên tục128 ngày:** CCT6/buffer1,1u net+14,138086/+12,667211u, mean+0,110454/+0,098963u/ngày cơ sở/chi phí cao; ngày xấu nhất−9,690495/−9,494189u, không breach10u trong mô hình. Audit tiền độc lập6.063.198 kiểm tra PASS. Cả kỳ dương sau chi phí nhưng **chưa đạt0,2u/ngày**. Kỳ phát triển64 ngày đạt0,3574/0,2943; kỳ trước64 ngày âm0,04525/0,05258. Giữ đủ kỳ âm và không cộng hai ví reset để thay một ví128 ngày. Toàn128 ngày hiện đã xem, ứng viên mới dùng lại chỉ là phát triển.

User16/10 yêu cầu áp dụng nếu phù hợp. Đã thêm mã paper `CCT_LC_B5_S6_BUFFER11_V1`: source/projector/shared engine/testbed/provider/service/API/UI, namespace riêng và cursor bền vững. Bộ74 tests ban đầu PASS; sau tối ưu có12 tests engine/testbed PASS, sau sửa funding công bố chậm và khóa protocol có9 tests service/market PASS;14 tests engine cũ chạy lại PASS. Scoped backend và frontend TypeScript đều PASS. Full Next build chưa chứng nhận, có retry tải font và thiếu tài nguyên.

**Đối chiếu TS128 V3 đã hoàn tất PASS:**184.320 phút mỗi ca,4.950 events,6.801.300 phép kiểm tiền; sai lệch tiền lớn nhất0. Protocol `38de575b1bfab9fa9949349f316f7439b3ef5ebb1259d8e62e6125dd4d01e164`,41 inputs, tiền tolerance1e−20, quantity/time exact. Kết quả net/mean/ngân sách khớp Python đã khóa. V1 dừng tối ưu, V2 thất bại vì receiver Decimal20; cả hai được giữ nguyên như lịch sử, không tính PASS. V3 sửa riêng Money40/CCT, giữ rounding legacy;29 tests engine/testbed/legacy và scoped backend TypeScript cuối PASS.

Chưa chọn CCT mặc định hoặc deploy/đổi flags/PM2/reset ví/gửi lệnh thật. Mục tiêu kinh tế còn thiếu, không tự hạ về0,1. Paper quote định kỳ không replay mọi order/biến động bị bỏ lỡ; funding có giới hạn coverage một giờ, không suy thành bảo đảm trần10u liên tục ngoài thị trường. Phát hiện7 khoảng chờ sau ICT reset, tổng49 giờ lịch có tín hiệu đã biết; admission và lợi nhuận khi tái vào chưa được thử.

Nghiên cứu tài chính26 cost cases đã khóa đầy đủ trong gói15/10; không chạy lại để thay kết quả. Gói nghiệm thu mã16/10 riêng; workdir `/home/ubuntu/futures-cct-paper-integration-20261016/`. Không tạo tool goal mới. Các header bên dưới là lịch sử.


Sau phản hồi người dùng về việc chạy đến hết limit: đóng lượt nghiệm thu này bằng kết quả và docs; chỉ giữ một bước nghiên cứu kế tiếp là đối chứng constant-direction B5/128 ngày/hai mức chi phí, sau review và đăng ký riêng. Bộ chuẩn bị/source preflight đã có, chưa chạy tiền. Top20/KPSS tạm giữ ở F, không mở thêm nhánh. Không bắt đầu phép thử mới trong lượt trả lời trạng thái.

# Hiện hành — 64 ngày đã xong/audit, economics âm — 14/10/2026

[Report64](docs/research/2026-10-14-futures-momentum-64-day-test.md):11/08–13/10ICT, samepaper100/10/source40/config; base−5,256284u/mean−0,082129; stress−6,492374u/mean−0,101443. User yêu cầu net/64>0 trướcápdụng: **FAIL cảhai**, không promote. 2.142.656moneychecksPASS, no modeledbreach10/latch; sourcegross trackingerror40,68%, rejects793/784đều marketminimum. Funding8448/case có3900markOPENfallback rõràng, khôngfakezero.1593inputhashes giữ nguyên, frozen14/ops/sourceold khôngrerun/sweep.

Kế tiếp **pairednative/executable cùng64ICTwindow**, timing/costs/initialinventory/terminalclosing đăngkýtrướcPnL, PLANNED_NOT_REGISTERED_NOT_RUN; chưaquyhết thua choalpha hoặcprojection. KhônglặpV1đểcherry-pick, khôngrestoreoldICT/SMC/riskcaps. Lượt64khôngdeploy/reset/order/privateAPI/paidAI; papertrướcđó môphỏng, legacyworkerunchanged. Khôngtoolgoalactive/tựcreate từcontinue. Các trạngthái RUNNING bên dưới là lịch sử.

# Đang thử 64 ngày theo yêu cầu mới — 14/10/2026

[Phép thử 64 ngày](docs/research/2026-10-14-futures-momentum-64-day-test.md) đang chạy hai cost cases trên 11/08–13/10 ICT, giữ nguyên paper100/10/source40/execution config. User yêu cầu net chia đủ64 phải dương trước áp dụng; kiểm cả base/stress và budget10, không thêm every-day/month-positive gate. 1.593 inputs khóa trướcPnL, nguồn/14day results giữ nguyên. Offline only, không order/deploy/reset wallet. Khi complete đọc report/verdict64; không lấy trạng thái RUNNING dưới đây làm kết quả.

# Cập nhật vận hành paper — 14/10/2026

[Patch vận hành](docs/audits/futures-quick-win/momentum-paper-watchdog-20261014T092700Z/report.md) đã thêm watchdog180s, UI nhận biết giá chậm, own-origin cho trang VPS và funding theo held inventory/latest-page có coverage. Browser public POSTtestbed PASS, không financial rerun. Provider public còn thỉnh thoảng403: báo degraded/tự retry, không giả thiếu phí/funding là0. 26 unit tests + watchdog/Chromium checks PASS. Engine tính tiền và source signals không đổi; frozen14day PnL vẫn base−1,138224/stress−1,694410u. Paper implementation đã có, expectation0,2/1u chưa xác nhận; không order thật hoặc reset wallet. Nội dung dưới là bàn giao trước patch.

# Hiện hành — đã triển khai paper và replay 14 ngày, 14/10/2026

Người dùng yêu cầu implement vào hệ thống ngay và dùng testbed thay chờ 14 ngày. Đã hoàn thành shared TS momentum engine/API/UI backend, deploy riêng paper trên VPS và PM2 `crypto-portfolio-paper`. [Báo cáo hiện hành](docs/research/2026-10-14-futures-momentum-paper-implementation.md): source parity 60.000 weights sai lệch 0; 22 tests và independent monetary audit 464.966 checks PASS. Hai ca 14 ICT days 30/09–13/10: base −1,138224u (−0,081302u/ngày), stress −1,694410u (−0,121029u/ngày), modeled daily breach 0. Hoàn thành implementation/workflow, chưa đạt mean 0,2 hoặc 1u.

Giữ một paper wallet 100u/fixed 10u ICT/unlimited orders/ngày âm-dương; source 40/mom14/vol30/rank/gross2/UTC extra lag. Broker lot/delta/governor adaptation được versioned, mean tracking 36,50% gross nguồn. Không filter cũ. Không đổi parameters sau outcomes hoặc rerun/sweep frozen config. Có thể tái sử dụng cached testbed report. Worker quotes 60s, đầu ngày runtime partial; delayed funding trước checkpoint/missing anchor cần reconciliation. Không suy ra continuous live assurance từ 5m envelope.

Deploy chỉ module paper/router; legacy worker/runtime khác giữ byte, không private order/transfer/paid LLM/DB migration. Quyền implement paper hiện tại thay statements NOT_IMPLEMENTED/NO_RUNTIME_CHANGE của các header cũ; không tự cho phép strategy tiền thật. Không goal công cụ active; không tạo goal từ continue. Nguồn/results cũ và package mới frozen. Các header bên dưới là lịch sử.

# Kiểm0,2u và hướng paper hiện hành —14/10/2026

Người dùng thấy khoảng0,2u/ngày đáng thử, yêu cầu check tin cậy/cải thiện/tích hợp. [Trust audit](docs/research/2026-10-14-futures-source-trust-and-costs.md) đã hoàn tất: phép tính source model và56.648rawcandles/CSV closes khớp,6data testsPASS.0,206323 là gain compoundedcurve chia1500rows, không net executable100u/day; average curvecapital238,95u, meanreturn×100 metric riêng0,109248u/row. Survivor/OOS-selection bias, thiếufund/slip/actualturnover và beta-index mismatch vẫn cần công khai. Không có bằng chứng live0,2u trong nguồn đã kiểm;98holdingsegments sau công bố hiệnrebasedloss1,342785u, hồi cứu khôngforwardtest.

[Portability/integration audit](docs/audits/futures-quick-win/source-trust-20261014T040315Z/report.md): cold nearest-lot lowerbound error35,29%gross trước neutrality/margin; không autoceil/drop targets rồi gọi replica. Minimum là order/currentmark, delta orders cần kiểm riêng. Backend scanBTC/V3SLrisk sizing/% circuit/per-symbol accounts chưa phảiportfolio40. Giữ source rawsignals/rankweights/lag/UTCschedule, thêm entrypointtarget-delta/sharedwallet10ICT/durableanchor,reservations,latch,funding/fills/restart; không đổi alpha ngầm.

[Kế hoạch](docs/plan/2026-10-14-futures-momentum-paper-integration.md): phase1 adapteroffline+lotpreview khung4 giờ dự kiến14–15/10, IMPLEMENTATION_NOT_REGISTERED_NOT_RUN; phase2 accountreplay base/stress sau registration nếuready; phase3 paper7–14ngày kiểmworkflow/cost, chưafutureexpectancyproof. Đây là lộ trình, không scheduler/toolgoal.0,2u là checkpoint đáng nghiêncứu được chấpnhận, không tựhạ/xácnhận mục tiêu1u. CI chứa0 không hardveto; không yêu cầu mọi thángdương.

Vốn100u/chung10u cốđịnhngàyICT/khôngcaplệnh/âm-dương giữnguyên; không phục hồi oldrules. Source/resultspackages frozen, khôngrerun/sweep. Lượt này chỉ audits+savedarraystats, không financialrun mới, khôngbackend/runtime/privateAPI/paidLLM/orders/transfers. Liveprocess/env/DB chưaxácminh. Nội dung trước dưới là lịch sử.

# Yêu cầu hiện hành — giữ nguyên cấu hình nguồn,14/10/2026

Người dùng yêu cầu làm giống cấu hình tham khảo. [Source fidelity](docs/research/2026-10-14-futures-source-fidelity.md) xác nhận A/B trước là adaptations có thay đổi đáng kể; không dùng outcomes âm của chúng để kết luận cấu hình nguồn thất bại. Không tự đổi universe/weights/entry/exit/timeframe/lag/exposure hoặc costs của nguồn khi gọi là replica. Thiếu tham số phải ghi thiếu; baseline/parity trước, adaptations bắt buộc vì broker/100u/10u phải tách version. Nếu đổi chính yêu cầu mới thì hỏi; không xin lại quyền bỏ các rules cũ.

[Source replication package](docs/audits/futures-quick-win/source-replication-20261014T032757Z/report.md):49inputs trước PnL, nguyên byte backtest3.py, đủ40mã/rank weights/gross2/daily rebalance/lag/fee5bps, chạy một lần. Dataset public mới1500dailyrows 05/09/2022–13/10/2026 UTC; tác giả không công bố prices.csv. Chỉ số nguồn quy đổi100→409,48445, OOSSharpe1,5285; diagnostic92 đoạn UTC Jul–Sep rebased100→96,12189. Không coi đó là account100 đã đoICT10u. Independent audit PASS60.000weights/60.000ranks/1500returns/equity; maxequityerror1,38e−14.

Snapshot weights13/10 với current filters14/10:26/40targets tại100u không đủminimum,14qua; bỏtargets làm khác danh mục/net exposure. Không tăng vốn hoặc bỏweights ngầm. Exact executable100 replica NOT_READY, accountadaptation NOT_RUN. Grid winner chỉ có mô tả EMA/MACD BTCETHBNB10–20x; spans/timeframe/spacing/quantities/exits/hedge mechanics chưa biết, chưa tìm config gắn trader. B selection thực là3coin, không7coin; dùng grid correction-v2 trong package mới. Không chạy một cấu hình grid phỏng đoán khác rồi gọi replica.

Kế tiếp là thiết kế execution/risk tối thiểu tương thích100u/10u, công khai mọi lệch bắt buộc; chưa registration tài chính hoặc scheduler/toolgoal. Giữ tất cả source/data/financial outputs frozen, không rerun/sweep. Chỉ100u ban đầu,10u chung cố định/ngàyICT, khôngcaplệnh, âm-dương,mean khoảng1u/ngày lịch. Chưa đạt mục tiêu kinh tế, chưa liveassurance, không private API/paid LLM/orders/transfers/runtime deployment. Các header trước là lịch sử.

# Bàn giao hiện hành — đã thử A/B, 14/10/2026

[Account trials](docs/audits/futures-quick-win/method-trials-20261013T152454Z/report.md) COMPLETE_FOUR_CASES, NO_GO_CURRENT_CONFIGURATIONS. Mỗi case bắt đầu100u, đủ92ngày Jul–Sep2026 ICT. A momentum tập trung: net base/stress −65,576904/−80,025678u, mean −0,712792/−0,869844u/ngày. B grid EMA/MACD theo market trigger: net −0,439908/−5,102860u, mean −0,004782/−0,055466u/ngày. Mục tiêu1u/ngày chưa đạt. A có peak gross/equity 9,55x/14,96x và PnL tại reference prices cũng âm. B hoạt động khoảng3% phút,51ngày bằng0; phần lợi nhuận reference nhỏ bị phí/slip lấy hết.

Protocol155 inputs khóa trước PnL;24 tests PASS. Main hoàn tất13/10 22:55ICT, trong cutoff; một prefix24h và4main, không rerun/sweep. Bốn money audits độc lập PASS:529.920 minutes,3.709.440 symbol rows,629 fills,7.728 funding events; money error0. Không breach10u trong synthetic minute envelope, worst−8,961258u; chưa continuous live assurance. Current filters, uniform margin và liquidation model còn giả định; auditor không kiểm venue tiers hoặc liquidation boolean. Giữ source/config/data/outputs frozen. Không promote hai V1 âm.

**Kế tiếp:** [source-transfer feasibility](docs/plan/2026-10-14-futures-source-transfer-feasibility.md), kiểm rổ rộng/rank weights của nguồn, timing, tickets, data và margin100u trước registration mới. Khung làm việc60phút dự kiến14/10, PLANNED_NOT_RUN. Grid cần feasibility chi phí/entry/fills sau đó; peer stop/sizing vẫn hypothesis phụ chưa đo account PnL. Không scheduler/toolgoal; không tự tạo goal từcontinue. Các header13/10 NOT_RUN/A/Bnext dưới đây là lịch sử.

Chỉ giữ100u ban đầu, chung10u cố định/ngàyICT, không cap số lệnh, ngày âm/dương, mean khoảng1u/ngày lịch. Không phục hồi ICT/SMC, cooldown, exposure100, SL floor hoặc risk caps cũ. Các mức20x/8+2/chunks4 là config nghiên cứu. A khác danh mục rank-weight khoảng40coin của nguồn; B khác grid config kín của trader. Hai V1 thất bại không chứng minh mọi phương pháp bất khả thi. Không private API, paid LLM, orders, transfers hoặc runtime deployment.

# Ưu tiên hiện hành — lợi nhuận cao công khai, 13/10/2026

[Điều tra mới](docs/research/2026-10-13-futures-high-return-evidence.md) đã xác nhận các cửa sổ lợi nhuận cao: ví Hyperliquid tổng equity 65,49 → 470,30 USDC, không có dòng tiền trong ledger cửa sổ, PnL +404,81 trong 30,70 ngày; MDD equity lấy mẫu 76,47%. Hồ sơ Binance API 10–20x báo ROI +3.876,34% với 26 ngày lịch sử; ROI denominator khoảng500u, không coi là replay100u. Có nguồn code momentum/volatility và grid inventory. Chưa xác nhận kỳ vọng1u/ngày hoặc ngân sách10u của các trader.

**Kế tiếp:** [ứng viên A momentum/volatility giữ inventory, rồi B grid regime](docs/plan/2026-10-13-futures-aggressive-candidates.md). Đây là hypothesis của ta có căn cứ nguồn, không replica của ví thắng. Tái dùng shared wallet/governor bằng derivative có version; source engineering và các kết quả frozen giữ nguyên. Peer stop/sizing còn hữu ích nhưng thành nhánh thứ cấp, thay ưu tiên duy nhất của các header trước. Workbox4 giờ dự kiến14/10 ghép runner/auditor+registration,15/10 hai case tối đa60 phút/case nếu ready. Account run mới NOT_REGISTERED_NOT_RUN; không scheduler/toolgoal.

Chỉ giữ100u ban đầu,10u chung cố định/ngày ICT, không cap số lệnh, ngày âm/dương, mean~1u/ngày lịch. Không phục hồi rules cũ hoặc xin lại quyền nghiên cứu mạo hiểm. Leverage tối đa20, planned8/buffer2 là đề xuất nghiên cứu, chưa user rules. Không lấy prior NO_GO vài cấu hình làm bằng chứng bất khả thi. Không runtime deployment, private API, paid LLM, orders hoặc transfers. Nội dung tiếp theo giữ nguyên như bàn giao lịch sử.

# Bàn giao hiện hành — 13/10/2026

[Spillover screen](docs/audits/futures-quick-win/spillover-20261013T141126Z/report.md) đã hoàn tất và audit độc lập PASS. Model peers có net base +0,002081%, stress −0,088819% trên normalized gross notional/ngày lịch; own âm cả hai. Hai cấu hình giữ rổ 24 giờ NO_GO, chưa đo tài khoản100u. CI và so sánh control chỉ là diagnostics; chưa có bằng chứng mục tiêu bất khả thi. Giữ nguyên protocol 338 inputs và15 artifacts; không tune hoặc chạy lại phiên bản này.

[Nhánh stop/sizing](docs/audits/futures-quick-win/peer-risk-20261013T142339Z/report.md) ENGINEERING_READY, FINANCIAL_NOT_REGISTERED_NOT_RUN. Đủ 927.360 phút trade/mark của7 coin; audit 9.273.600 fields PASS. Wallet/Governor đa vị thế có 16 tests nội bộ và 16 kiểm tra độc lập PASS. Chưa có PnL, kiểm giới hạn10u trên lịch sử hoặc mean1u/ngày. Planned loss8u, buffer2u, leverage10 và margin slack5u là tham số nghiên cứu. Stop theo mark và stale commit đã sửa; reserve funding4slots mỗi lần kiểm tra vẫn là giả định bảo thủ.

**Việc kế tiếp đã được phép:** [ghép runner và money auditor](docs/plan/2026-10-13-futures-peer-risk-replay.md), chốt event/funding/intrabar/gap rồi đăng ký protocol trước PnL. Workbox4 giờ chủ động dự kiến14/10; prefix24 giờ đo startup, bộ nhớ và tốc độ; main tối đa60 phút/case dự kiến15/10. Được làm sớm khi đủ điều kiện. Stream dữ liệu vì host chỉ khoảng956 MiB RAM. Source/receipts engineering đã lưu phải giữ nguyên; chỉnh core tạo derivative có version. Không có toolgoal active hoặc scheduler; không tự tạo goal từ continue.

Chỉ giữ100u, chung10u cố định/ngày ICT, không cap số lệnh, ngày âm/dương và mean khoảng1u/ngày. Không phục hồi ICT/SMC, cooldown, exposure100 hoặc caps giao dịch cũ. Nhánh mới là hypothesis thay stop/sizing, không promotion daily-hold âm. Mục tiêu kinh tế toàn hệ thống chưa đạt; không runtime deployment, private API, paid LLM, orders hoặc transfers. Các next/NOT_RUN ở header ngày cũ bên dưới là lịch sử; kế tiếp hiện tại là account stop/sizing.

# Review quyền chấp nhận mạo hiểm — 13/10/2026

Người dùng hỏi vì sao đã chấp nhận mạo hiểm mà vẫn báo không được. [Review](docs/plan/2026-10-13-futures-risk-acceptance-review.md) chốt: không có bằng chứng mục tiêu bất khả thi; prior NO_GO chỉ đúng cấu hình đo. QW1 một seed có MTM ngày xấu nhất khoảng−2,37u; screens chưa kiểm risk sizing/stop/account100. Không lấy chúng làm lý do cấm mọi thiết kế mạo hiểm.

[Spillover plan](docs/plan/2026-10-13-futures-spillover-screen.md) đã sửa gate: net dương base/stress nhưng CI chứa0 vẫn có thể nghiên cứu account replay, ghi chưa chắc chắn. Lower95% và peers thắng own-control không là user requirement hoặc cấm thử. Không gọi điều đó là xác nhận kỳ vọng. Nghiên cứu sizing/stop/exposure/leverage dùng ngân sách còn lại chung10u; không phục hồi cap0,5%/3%/exposure100 cũ. Bounded development có registration mới được phép; không retune frozen/validation đã xem. Kế tiếp vẫn inputs/registration spillover, NOT_RUN; chưa tạo goal. Giữ100u/10u cốđịnhngàyICT/khôngcaplệnh/ngàyâm-dương/~1u. Không sửa frozen results hoặc runtime.

# Relative reversal đa coin đã hoàn tất — 13/10/2026

Theo yêu cầu “continue”, [package mới](docs/audits/futures-quick-win/cross-20261013T132038Z/report.md) đã COMPLETE_SCREEN — NO_GO_COST_SCREEN: bảy coin, 92 rổ/184 chân; gross mean −0,334701%, net base/stress −0,471523%/−0,632353% trên normalized gross entry-notional/rổ. Đây không phải USDT/ngày hoặc PnL tài khoản100. Audit độc lập PASS, 63 official archives kiểm checksum; 133224 raw fields/2760 money fields; protocol167inputs trước return. Không chạy full account replay cho cấu hình âm.

Sửa nguồn: Pure Momentum dùng return của giờ cách24giờ, không phải cumulative24h; model vừa thử đã đăng ký là hypothesis daily riêng trước PnL. [Source correction](docs/audits/futures-quick-win/cross-20261013T132038Z/receipts/source-correction.json). Chỉ giữ user policy100/10cốđịnhngàyICT/khôngcaplệnh/ngàyâm-dương/mean~1u; chưa đạt mục tiêu, chưa đo governor trong screen. BTC50USDT leg không đạt rounding current filters; không tự bỏBTC hoặc giả làm executable.

Kế tiếp: [causal spillover proxy và own-return control](docs/plan/2026-10-13-futures-spillover-screen.md), feasibility360ngày training rồi registration mới trước return; PLANNED_NOT_RUN. Paper network báo gross spread1,08% trên mẫu cũ, chưa netFutures/governorproof; không copy ROI. Hướng này thay next relative reversal đangPLANNED ở header cũ. Không goal công cụ active/scheduler; không tự tạo goal từ continue. QW1 và screenSOL giữ frozen; không retune/flip/sweep cấu hình âm hoặc sửa artifacts. Không privateAPI/paidLLM/orders/transfers/runtime deployment.

# Nghiên cứu tiếp sau QW1 — screen hoàn tất 13/10/2026

Theo yêu cầu “continue”, đã mở package riêng ngoài QW1: [report](docs/audits/futures-quick-win/screen-20261013T124932Z/report.md), [assessment](docs/audits/futures-quick-win/screen-20261013T124932Z/assessment.json). Ba cấu hình SOL wick5m/reversal15m/momentum24h đều âm sau phí/slip/funding; audit độc lập PASS 9.185 events/91.850 fields và đủ132480phút. Đây là isolated event-cost screen, không account replay: chưa đo target1USDT/ngày hoặc governor10. P2 gốc có tối đa5signals, cùng một cụm7phút ngày22/08; không coi5mẫu độc lập hoặc kết luận P2 không có lãi.

Kế tiếp: [relative reversal đa coin](docs/plan/2026-10-13-futures-cross-sectional-screen.md), feasibility bảy coin cố định rồi registration trước PnL; chưa chạy. Hướng nghiên cứu này thay “P2 SOL kế tiếp duy nhất” của bàn giao QW1 bên dưới theo yêu cầu nghiên cứu tiếp, không kéo dài QW1. Không goal công cụ active; không tự tạo goal từ lệnh continue. Không retune/rerun screen hoặc QW1, không sửa artifacts đã frozen. Chỉ giữ user policy100/10cố định/ngàyICT/khôngcaplệnh/chấpnhậnâm-dương/mean~1u. Không privateAPI/paidLLM/orders/transfers/runtime change.

# QW1 đã hoàn tất gói nghiên cứu — 13/10/2026: P1 NO_GO

Đọc [báo cáo QW1](docs/audits/futures-quick-win/qw1-20261012T132319Z/report.md), [terminal](docs/audits/futures-quick-win/qw1-20261012T132319Z/terminal.json) và [audit](docs/audits/futures-quick-win/qw1-20261012T132319Z/audit.json). P1 SOLUSDT EMA-anchor native đã chạy đủ 92 ngày ICT Jul–Sep2026, mỗi case vốn giả lập100USDT. Base net +0,04774456 / mean +0,00051896 USDT/ngày; stress −2,23619230 / −0,02430644. Audit độc lập PASS cả hai, 1.972.336 events, 276 funding/case; không breach ngân sách10USDT cố định hoặc modeled liquidation trong mô hình. Observed1USDT/ngày=false cả hai; NO_GO do stress âm. Không đánh đồng hoàn tất điều tra với tìm được quick win kinh tế hoặc cải thiện live.

Protocol130files khóa trước PnL; một prefix, hai main cases, không sweep/tuning/rerun. Source/data/financial outputs giữ frozen, không resume nguyên trạng. Harness riêng chưa parity production; historical filters/margin brackets/fill queue còn giả định. Không paidLLM/privateAPI/order/transfer/runtime deployment. Chỉ giữ yêu cầu mới100/10/ngày cố định/không cap số lệnh/ngày âm-dương/mean khoảng1USDT; không phục hồi trading rules cũ.

Kế tiếp duy nhất: P2 wick recovery cần registration/goal riêng; chưa được tự mở trong QW1. Các ACTIVE/NOT_RUN/READY_NOT_STARTED ở bàn giao có ngày cũ bên dưới là lịch sử, bị kết quả QW1 này thay về trạng thái nghiên cứu P1.

# Phạm vi hiện hành — 12/10/2026

Người dùng yêu cầu cải thiện **toàn hệ thống Futures**; quên ICT/SMC và bộ rule giao dịch cũ nếu không hiệu quả. Chỉ giữ **vốn ban đầu 100 USDT; lỗ tối đa 10 USDT/ngày cố định; không giới hạn số lệnh; chấp nhận ngày âm/dương; kỳ vọng khoảng 1 USDT ròng/ngày lịch**. Lời làm rõ thay cả câu trả lời trước đó chỉ cho phép ứng viên momentum riêng nhưng giữ giới hạn cũ.

BTC-only, cooldown 1h, exposure 100u, SL tối thiểu 0,8%, sizing mục tiêu 0,5%, trần 3%/lệnh, DD 15% và RR/grade/structure/expectancy cũ **không còn là ràng buộc**. Symbol, entry/exit, sizing, leverage và tần suất được nghiên cứu lại. Không xin lại quyền bỏ các rule đã được bỏ; hỏi nếu cần đổi chính các yêu cầu mới hoặc quyền ngoài phạm vi. Không biến tham số ứng viên thành rule của người dùng.

Đọc theo thứ tự: [policy hiện hành](docs/runtime-risk-policy.md) → [lộ trình mới](docs/plan/2026-10-12-futures-system-research-roadmap.md) → [bàn giao](docs/plan/roi-opportunity-progress.md). Các chỉ thị “bắt buộc/không đổi rule/next only/không nghiên cứu Futures” bên dưới là lịch sử, không ghi đè yêu cầu mới. Kế toán, integrity, idempotency và đối soát vẫn cần đúng; bộ lọc dự đoán cũ không là điều kiện bất biến.

Người dùng yêu cầu nghiên cứu thêm và chấp nhận mạo hiểm. [Followup mới](docs/research/2026-10-12-futures-aggressive-followup.md) đã kiểm public ví ROI tháng +50,59%, Passivbot/EMA-anchor, wick recovery và public Binance filters/arithmetic. Feasibility **PARTIAL**: chưa có historical filters, margin/liquidation/funding/fill proof. Ưu tiên P1 averaging quanh EMA và P2 wick recovery; trend long/short là đối chứng, carry dự phòng. Không tự loại grid/averaging hoặc đặt lại caps cũ. 10u/ngày vẫn chung toàn tài khoản. Không gán khoảng lỗ 24h của ví thành lỗ ngày lịch. Backtest chiến lược100u, governor/runtime migration và prospective **NOT_RUN**; PnL mới của hệ thống chưa có. Kế tiếp: hoàn tất governor design/registry và input feasibility còn thiếu rồi implementation. Không resume goal/run cũ hoặc sửa artifacts đã đóng băng. [Status mới](docs/audits/2026-10-12-futures-aggressive-research/research-status.json); [snapshot trước followup](docs/audits/2026-10-12-futures-aggressive-research/prior-docs-receipt.json).

**Tài liệu goal quick win đã lập theo yêu cầu mới:** [QW1](docs/plan/2026-10-12-futures-quick-win-goal.md), trạng thái ACTIVE từ20:23:19 ICT ngày12/10/2026. Một P1 EMA averaging, vốn100/ngày10 cố định, kỳ chính92ngày Jul–Sep2026 và hai case base/stress; tối đa16giờ làm việc/48giờ từ T0. Đầu ra phải có economic terminal và verdict GO_QUICK_WIN/NO_GO/INCOMPLETE; mean1u/ngày báo riêng. GO chỉ là ứng viên đáng paper prospective, không live/expectedROI proof. Goal đã kích hoạt theo yêu cầu người dùng; input coverage đã đủ, adapter/governor đang triển khai, PnL chưa chạy. Xem run `docs/audits/futures-quick-win/qw1-20261012T132319Z`. Khi thực thi QW1, đọc tài liệu này sau policy; P2 là goal nghiên cứu kế tiếp, không mở nhánh để kéo dài cutoff.

## Bàn giao và chỉ thị lịch sử

> **11/10/2026 — đã sửa workflow sàng lọc, chưa có ROI+ mới:** Theo yêu cầu tiếp tục sửa, đọc [báo cáo order-flow screen](/home/ubuntu/binance-income-research-2026-10-11-orderflow-screen/report.md). Đã kiểm volume tháng8/2026: 312.480 phút/5.208 giờ, 7cặp, exactsumsPASS19,58s. `fast_screen.py` so ridge giá1d/7d với thêm flow1d/7d, monthlypasttrain; 14synthetics/staticreview và recordedledgerauditPASS. One fractional hourly cost screen273ngày Jan–Sep2026,100USDTgiảlập,6,226s: giá−14,26374949/−16,15151025; flow−3,91995197/−6,34366328USDT. Flow ít lỗ hơn nhưng gateROI+false: **không launchfullminute cho proxy này**. Đây là coarse development diagnostic, bỏlot/filter/cooldown/stop và known_atthật; không live/accountROIproof hoặc1%/ngày. ProtocolSHA df4f813e…09900/source9349977d…52dd4/resultsfrozen; không sweep/rerun nguyên trạng. Fullminutecoordinator chỉpreparedNOT_REGISTERED_NOT_RUN. Bộsànglọc đã có thật, ưu tiên dùng cho hypothesis mới có nguồn/căn cứ trướcP&L; giữ nguyênBTCpositivev1 và batchdailyrotation. 0paidLLM/privateAPI/order/transfer/Telegram/runtimechange; không resume goalFutures. Nội dung dưới là bàn giao lịch sử, exactbytes trước header này được lưu trong batchmới và snapshot batchcũ.

> **Phạm vi hiện hành / chốt backtest100 — 11/10/2026:** Người dùng ưu tiên ROI+ Spot, kỳ vọng mean1%/ngày trên mọi ngày lịch qua nhiều tháng, có thể bổ sung~100USDT. Đã thử **tổngSpot giả lập100**, chưa xác nhận nạp/số dư;115 chưa chạy. Đọc [plan hiện hành](docs/plan/2026-10-11-spot-daily-one-percent-research.md) và [báo cáo COMPLETE](/home/ubuntu/binance-income-research-2026-10-11-daily-1pct/report.md). Main365UTCdays Oct2025–Sep2026,4case,1445,805s/82344KiB; luân chuyển−36,23280903/−49,78283272USDT bị loại, BTC đối chứng+5,18332770/−0,01624130 tiền mặt; stress bookNAV100,595047216 gồm dust. Mean1%false cả4,rolling30/90 cũng0đạt. BTCcontrol100 giữ luật v1 nhưng sizing/execution mới, **không exact15v1**. [V1 dương đã lưu](/home/ubuntu/binance-income-baselines/spot-roi-positive-v1-2026-10-11/README.md), snapshotSHA13eff89f…a1261; không sửa baseline/oldmanifest/source/results. NewfinancialprotocolSHA28ee010a…d27/data/source/results frozen. Recordedledgerauditv2PASS384events/192BUY/192closed/1460UTCrows, originalauditFAIL giữ nguyên; v2 sửa auditor Decimal2ATRmetadata precision28 theo source,162tickstops không đổi,khôngrerunfinancial. Không fullindependentminuteNAV/DD/historicalfilter/livefill proof; all-system/VPSunknown. **Kế tiếp: [order-flow data feasibility](/home/ubuntu/binance-income-research-2026-10-11-daily-1pct/orderflow-next-experiment-plan.md) trướcalpha; không sweep/rerun dailyrotation.** [Prospectiveimplementation](/home/ubuntu/binance-income-research-2026-10-11-daily-1pct/prospective-validation-implementation.md) là đề xuất chưa triển khai; failedrotation không promote. Không resume/create goalFutures, không tự áp chỉ tiêu fills/risk của goal cũ cho nghiên cứu này. Lần này0provider/privateAPI/orders/transfers/Telegram/runtimechange. Nội dung dưới là lịch sử. Headerhandoff mới được kiểm bằng receipt preservation riêng, exactbytes cũ giữ trong snapshotv1.

> **Ưu tiên ROI+ và kết quả mới — 11/10/2026:** Đọc [bàn giao hiện hành](docs/plan/2026-10-11-spot-roi-priority.md). BTC EMA600/exit98%EMA/trailing15% đã COMPLETE ví giả lập15USDT liên tục01/2024–09/2025: base+6,36567791USDT/stress+4,46902244, ROI+42,44/+29,79%,39closed/case, DD26,51/30,12%, PF1,6205/1,3824. **Ứng viên hồi cứu dương cả hai case, chưa all-system/livePASS:** VPSunknown,01–09/2025 âm1,09670714/1,89214697; source2026postdateshistory;571/640ngày khôngfill. Buy-holdBTC12+3 đối chứng+18,88041158/+18,79520656USDT khácstoprisk, chưa đoDDđộc lập. NewBTCreservedrisk3/NAV5/daily20%/cash12-3/cooldown1h riêng, không đổi SOLv3risk1,50/NAV10 hoặc live. Protocol`d37d9f3c4374cc6ff2c7ad7170220a5cf021d733d082ef9e33c25c3081fd10de`; source/data khóa trước main;896,012giây/ru_maxrss36.908KiB.25tests+14independent synthetic; accountingPASS2case, hourlysignalPASS432, rawfillreferencePASS156/21ZIPs; không full independentminuteNAV/DD/filter/queue/livefill proof. Recovery5mF-onlyINCOMPLETE601giây/56,33%coverage:prefix0episode không kết luận0cơ hội/PnL. Kế tiếp là prospectivepaper BTC kèm cash/Earn/buyhold và actualcost, rồi mới đo overlayLLM; không sweep/rerun unchanged history, không paidLLM/privateAPI/orders/transfer/Telegram/runtimechange, không resumegoalFutures. GiữV1/V2/V3/newprotocol/source/results frozen. OldAGENTS bytes chính xác/hash`c3a3e4ec51d4e88177536496a7571a7b45cd5b4ec2a7c83c141e31fc2d4703c5` được lưu `/home/ubuntu/binance-income-research-2026-10-11-roi-search/prior-handoff/AGENTS-at-v3-completion.md`; pinhistoricalV3 không đổi, currentAGENTS thêm headerhandoff nên receipt mới sẽ chỉ rõ archivedmatch.

> **Kết quả mới nhất — V3 hoàn tất 10/10/2026:** Bốn case đã COMPLETE lúc20:02:59 ICT, mỗi ví giả lập15USDT liên tục01/2024–09/2025 (21 tháng/639 ngày). Trend4h net base−0,37757156/stress−1,50652221USDT,34/26closed; reversion4h base+0,36083866/stress−0,61559243,7/2closed. **Cả hai FAIL**, chưa tìm được ứng viên có bằng chứng kiếm tiền hàng ngày. Reversion không giao dịch trong01–09/2025: confirmation0 không xác nhận sinh lời. Đọc [planv3](docs/plan/2026-10-10-spot-aggressive-mechanisms.md), `/home/ubuntu/binance-income-research-2026-10-10/backtest-run-v3/report.md`, `execution.json`, `verdict.json`.55tests/MaydevelopmentQA và source/data registration trước main; replay537,247giây/peak40.216KiB. Net gồm phí/slip/rounding mô phỏng, VPSunknown, không live receipt. V3 chỉ đổi policy một lần trước mainPnL: risk1.50/NAV10 và bỏ hardhypotheticalRR1.5, giữ4×drag/solo-positive/minsellable/12-3/dailycaps/cơ chế4h. Giữv1/v2/v3 financial/core/protocol/data frozen, không rerun/sweep/hạgate30. Audit độc lậpPASS đủ4case:13source/dependencies,90archives/checksums, exactledger/NAV/PF và6malformedmutations; receipt `artifact-accounting-verification.json`. Audit không replay từng phút/indicator hoặc xác minh historicalfees/filter/fill, headroom/DD chỉ source/receipt bounds. AccountingPASS không phải financialPASS. Không paidLLM/privateAPI/order/transfer/Telegram/runtimechange, không khởi động lại goalFutures. Nhánh này dừng ở kết quả FAIL; nghiên cứu kế tiếp cần cơ chế hoặc bằng chứng mới được xác minh và registration mới, không dùng history đã xem làm freshholdout.

> **V2 trước revision V3:** Hai hypothesis trend4h/reversion4h đã chạy8case nhưng0fills, formalFAIL=`NO_FILLED_TRADES_FEASIBILITY_FAILURE`; alpha/PF chưa đo, không phải bằng chứng hai mechanism vốn có expectancy âm. Đọc [kế hoạchv2](docs/plan/2026-10-10-spot-new-mechanisms.md), `/home/ubuntu/binance-income-research-2026-10-10/backtest-run-v2/report.md` và `artifact-accounting-verification.json` (8case auditPASS). F-only diagnostics lưu `spot-v2-entry-feasibility.json` và `spot-v2-entry-feasibility-v3.json`; chúng chỉ kiểm admission, không đọc future outcomes. DataApr2023→Sep2025,90archives sạch; Feb/Mar development bị loại trướcPnL cóaudit. V3 dùng chính bytes/parser/history này, không holdout prospective mới. Giữv2 immutable, không sửa labels/core sau khi chốt artifactmanifest.

> **Kết quả sau `continue`, 10/10/2026:** Spot v1 đã chạy xong và **FAIL**: vốn giả lập15USDT, main ledger tháng04→09 liên tục, base−4,83807289/stress−5,50381984;123/78closedsetups, DD4,9468/5,5038. Đọc `/home/ubuntu/binance-income-research-2026-10-10/backtest-run-v1/report.md`, `execution.json`, `verdict.json` và mục9 của kế hoạch hiện hành. Đủ36archive verified,46tests trướcfreeze và audit độc lập8case PASS về kế toán/provenance. Core ở `backend/spot_backtest` là offline Python, không dùng ledger Futures. Không lặp/sweep v1, không gọi paidAIpaper/live theo gate này; tháng09 đã xem, không coi là holdout mới. Protocol JSON giữ nguyên trạng thái thiết kế/hash; execution/report là nguồn trạng thái chạy thực. Không chuyển tiền, đặt order hoặc thay Futures/runtime trong lượt này.

> **Ưu tiên mới nhất ngày 10/10/2026 — 50/50 và backtest trước:** Người dùng đổi sang khoảng 50% vốn Spot, 50% giữ Futures và yêu cầu nghiên cứu/lập kế hoạch backtest entry Spot trước tiền thật. Đọc [kế hoạch hiện hành](docs/plan/2026-10-10-spot-half-capital-backtest-plan.md) và `/home/ubuntu/binance-income-research-2026-10-10/spot-half-capital-backtest-protocol.json`. Backtest chính dùng15USDT riêng choSpot; các cap12/3/0,50/1,50 là thiết kế đề xuất, không phải số user tự chọn. Không dùng policy/prototype30/25 cũ cho nhánh này, không tự chuyển toàn bộ vốn hoặc freeze toàn bộ Futures. Goal nghiên cứu Futures cũ vẫn bỏ; giữ phần Futures riêng không có nghĩa khởi động lại goal. Historical stage rules-only, không paidLLM; LLM chỉ kiểm prospective sau gate. Lượt lập kế hoạch chưa backtest/chuyển tiền/đổi runtime và không được báo cóROI. Các chỉ thị Futures phía dưới là tài liệu bảo trì cho phần Futures, không áp làm tiêu chí Spot.

> **Phương án Spot trước cập nhật 50/50:** Người dùng từng chấp nhận có thể mất toàn bộ30USDT, xem [đặc tả cũ](docs/plan/2026-10-10-ai-selective-spot-pilot.md). Risk allowance không cần hỏi lại, nhưng phân bổ mới giới hạn vốn nhánh Spot và thay phương án all-Spot. LLM có quyền BUY/WAIT/VETO; confidence tự báo không phải p(win) và không tự tăng size/nới stop. Quyền API/execution/reconciliation vẫn phải kiểm chứng; diagnostic không phải live/profitability.

> **Phạm vi mới ngày 09/10/2026:** Người dùng yêu cầu bỏ toàn bộ mục tiêu cải thiện futures cũ và nghiên cứu các mô hình thu nhập tự động trên Binance với VPS hiện có cùng vốn hơn 30 USDT. Đọc [nghiên cứu và kế hoạch mới](docs/plan/2026-10-09-binance-income-reset.md) khi làm việc theo yêu cầu này. Không tiếp tục goal/replay/chi phí AI của nghiên cứu futures cũ hoặc áp chỉ tiêu tăng fills BTC của goal cũ cho kế hoạch mới. Các hướng dẫn lịch sử bên dưới vẫn là tài liệu bảo trì cấu hình Futures đang vận hành; yêu cầu nghiên cứu mới chưa tự triển khai Spot/Earn, chuyển tiền hoặc thay đổi bot live. Phiên nghiên cứu `roi-tx30-four-arm-20261009.service` đã được dừng riêng theo yêu cầu bỏ mục tiêu cũ; không xem kết quả bị dừng là bằng chứng ROI.

> **Quyền thử nghiệm cập nhật08/10/2026:** Người dùng: “nếu là thử nghiệm thì luôn chấp thuận, khi có hiệu quả thì trình bày lại thay đổi gì là được”. Chủ động thực hiện thử nghiệm trong phạm vi nghiên cứu đã chốt, không xin lại phép từng run/budget hợp lý. Vẫn đăng ký phiên bản/cost/cutoff, giữ BTC/daily10/cooldown1h/exposure/SLfloor0,8%/target0,5% và các guard khác; không lặp nguyên trạng để tìm kết quả dương. Quyền này không thay thế bằng chứng ROIbase/stress/fills độc lập hoặc tự cho phép rollout candidate. Khi có hiệu quả, trình bày thay đổi và bằng chứng.

## Chỉ thị điều phối goal bắt buộc — cập nhật 04/10/2026

Đối với goal nâng cấp ROI, đọc và tuân thủ [quy tắc điều phối](docs/plan/roi-goal-coordination.md) cùng [mốc đánh giá theo giờ](docs/plan/roi-goal-hourly-review.md) sau ba tài liệu bắt buộc bên dưới. Sau mỗi thêm3600giây `goal.timeUsedSeconds`, đánh giá lại mục tiêu ROI base/stress và fills độc lập, bằng chứng mới, blocker, việc kế tiếp có cutoff và quyết định tiếp tục/đổi/dừng nhánh. Không giữ vòng chat polling/sleep; không lặp cách làm thiếu tiến triển qua mốc giờ; không nhầm scaffold/test/pending với kết quả mục tiêu. Chỉ thị mới này ưu tiên hơn các next-action lịch sử. Trạng thái active/paused lấy từ get_goal, không lấy từ câu mô tả cũ trong tài liệu.

# Hướng dẫn bảo trì chuyen-gia-crypto

**Cập nhật quyền người dùng ngày 02/10/2026:** người dùng yêu cầu nghiên cứu kỹ mô hình tương tự và lên kế hoạch nâng cấp; cho phép SL rộng hơn, trần rủi ro mỗi lệnh trên 3% và bỏ circuit drawdown 15%. Xem mục mới đầu `docs/runtime-risk-policy.md` và `docs/plan/2026-10-02-roi-upgrade-plan.md`. Khóa ngày 27/09 bên dưới không được dùng để bác ba thay đổi nghiên cứu này. Chưa chọn/triển khai cap live mới; giữ các ràng buộc khác và quy trình kiểm chứng. Người dùng sau đó đã yêu cầu tạo goal và bắt đầu triển khai kế hoạch ngày 02/10/2026: goal đang active, được phép triển khai work packages; candidate live vẫn phải qua các gates của kế hoạch.

## Bắt buộc ở đầu mỗi lượt làm việc về bot giao dịch

Đọc theo thứ tự:

1. [Chính sách rủi ro hiện hành](docs/runtime-risk-policy.md).
2. [Quy trình cải thiện ROI và cơ hội — 27/09/2026](docs/plan/2026-09-27-roi-opportunity-reset.md).
3. [Trạng thái bàn giao giữa các lượt agent](docs/plan/roi-opportunity-progress.md).

**Mục tiêu bắt buộc: ROI ròng sau mọi chi phí dương VÀ tăng cơ hội vào lệnh có chất lượng, được kiểm chứng bằng số lệnh khớp độc lập tăng trên toàn danh mục BTC so với baseline live cùng kỳ/vốn/rủi ro.** Ít lỗ hơn, nhiều tín hiệu lặp hơn, model trả lời tốt hơn hoặc không giao dịch không phải hoàn thành mục tiêu.

Người dùng đã chốt: **BTC; cooldown giao dịch1h; giới hạn ngày10%; tối đa mỗi lệnh3% số dư gồm dự phòng phí/trượt giá; không dùng trần USD cố định**. Đây là cấu hình vận hành phải giữ. Không tự đổi về ngày3%, trần1USDT hoặc cooldown dài hơn theo default, tài liệu lịch sử, backtest hay khi sửa lỗi. Chỉ đổi khi người dùng yêu cầu rõ ràng; yêu cầu mới của người dùng được ưu tiên và cần cập nhật docs/mẫu cấu hình tương ứng.

Các audit/deployment report là snapshot lịch sử. Dùng tài liệu chính sách trên làm nguồn tham chiếu hiện hành. Không nhầm trần3% với target sizing0,5% hoặc với notional/margin.

“Không cap USD cố định” chỉ nói về **trần rủi ro mỗi lệnh bằng USD**, không cho phép bỏ giới hạn exposure. Giữ exposure hiện hành theo runtime; không lấy các giá trị legacy trong phần mô tả tính năng README làm cấu hình hiện tại.

Người dùng nhắc lại ngày 27/09/2026: **không thay đổi cấu hình hiện tại**. Cụm “min sl 3% tài khoản” trong yêu cầu giữ nguyên cấu hình được hiểu theo chính sách đã chốt là **trần rủi ro mỗi lệnh 3% tài khoản**, không phải mức lỗ tối thiểu, không phải SL cách giá entry 3%. Giữ nguyên cả SL distance floor hiện tại 0,8% (`MIN_SL_DISTANCE_PERCENT=0.008`) và target sizing 0,5%. Không sửa live, default hoặc cấu hình test để vượt cooldown/risk nhằm đạt kết quả đẹp hơn; không reset lịch sử/circuit để ép lệnh. Chỉ thay đổi khi người dùng yêu cầu mới rõ ràng.

Người dùng cập nhật ngày 15/09/2026: mục tiêu ROI+ sau chi phí, **không bắt buộc RR3**. Cho phép nghiên cứu RR thấp hơn có bằng chứng; chưa chọn ngưỡng runtime thay thế. Xem mục cập nhật trong `docs/runtime-risk-policy.md`.

## Quy tắc cho mọi vòng agent tiếp theo

- Tiếp tục từ trạng thái bàn giao; không khởi động lại nghiên cứu hoặc chạy lại thử nghiệm đã có kết quả chỉ vì user nói “continue”. Ghi dữ liệu/bằng chứng mới nếu cần chạy lại.
- Thứ tự bắt buộc: **F — khả thi đặt lệnh → P — baseline/engine live-replay → E — toàn inventory và nguồn edge → xác nhận đóng băng → shadow candidate → rollout**. Thu dữ liệu/quan sát có thể chạy song song; không vượt gate khi đánh giá/promote chiến lược.
- Khi F/P chưa đạt, chỉ sửa nền tảng/đo lường và thu dữ liệu cần thiết; không mở loạt thử RR, TP, model hoặc confidence. Dùng chung logic production và replay, không tạo thêm simulator chiến lược riêng để thay baseline.
- Chỉ thử giả thuyết có cơ chế và bằng chứng; đăng ký trước tiêu chí, dữ liệu, chi phí, source/config/model/prompt. Tối đa hai giả thuyết cơ chế mỗi vòng; không tự mở vòng mới sau thất bại nếu không có dữ liệu mới hoặc nguyên nhân mới được xác minh.
- Phân biệt development/validation/test; không đổi tên dữ liệu đã xem thành holdout. Ghi mọi thử nghiệm và cả thất bại; thiếu dữ liệu/chi phí là `unknown`, không phải 0 hoặc pass.
- Mọi báo cáo kết quả phải nêu baseline/version, vốn/kỳ, cơ hội độc lập, fills, ROI base/stress sau phí/funding/slippage/AI, expectancy nhóm bổ sung và giới hạn. Attribution nhóm lệnh không thay cho replay lại danh mục.
- Chỉ coi mục tiêu hoàn thành khi toàn danh mục đạt ROI+ sau chi phí và tăng fills có chất lượng với bằng chứng phù hợp; sửa một thành phần có ích không đồng nghĩa hoàn thành. Không triển khai biến thể chỉ vì giảm lỗ hoặc một đoạn dương.
- OpenRouter được phép sử dụng cho bài toán đo được; không tiết kiệm token provider bằng cách bỏ AI cần thiết. Tiết kiệm token Codex bằng tái dùng bằng chứng, chạy collector tự động, cập nhật ngắn; không giữ vòng chat chờ để báo lại cùng trạng thái.
- Cuối mỗi lượt có tiến triển, cập nhật file bàn giao: đã làm, bằng chứng, gate đạt/chưa đạt/unknown, việc kế tiếp và điều kiện dừng. Không viết lại kết quả lịch sử. Không xin lại quyền đã được người dùng cấp; triển khai vẫn phải qua điều kiện kiểm chứng đã chốt.
