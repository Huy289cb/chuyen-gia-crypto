# Nghiên cứu Futures mạo hiểm hơn — 12/10/2026

**Có cửa sổ Futures công khai lời hơn 1%/ngày khi chia số học. Có cơ chế mã nguồn mở đáng thử với vốn nhỏ. Chưa xác nhận hệ thống giữ được kỳ vọng 1 USDT/ngày và ngân sách lỗ 10 USDT/ngày trên vốn 100 USDT.** Không cần tìm được người khớp hoàn toàn rồi mới học cơ chế của họ.

Người dùng yêu cầu nghiên cứu thêm và chấp nhận mạo hiểm. Chỉ giữ [yêu cầu hiện hành](../runtime-risk-policy.md): vốn ban đầu 100 USDT, lỗ tối đa cố định 10 USDT/ngày, không giới hạn số lệnh, chấp nhận ngày âm/dương và kỳ vọng khoảng 1 USDT ròng/ngày lịch. Không khôi phục ICT/SMC, BTC-only, cooldown, exposure, SL floor, sizing, per-trade hoặc DD cũ. Việc chấp nhận mạo hiểm chưa thay giới hạn 10 USDT/ngày.

Lượt này đã đọc thêm nguồn chính, kiểm trực tiếp dữ liệu sàn, đọc code và tính feasibility. Chưa chạy backtest chiến lược mới, sửa runtime hoặc đặt lệnh. [Lộ trình cập nhật](../plan/2026-10-12-futures-system-research-roadmap.md) ưu tiên averaging và wick recovery; trend là đối chứng, carry là dự phòng.

## 1. Người giao dịch thật có cửa sổ lợi nhuận cao

| Nguồn chính | Dữ liệu quan sát | Kết luận và bài học |
|---|---|---|
| [Ví Hyperliquid 0x83c4…afe5](https://app.hyperliquid.xyz/explorer/address/0x83c4c5a492d77e22120ba90bdaad00739788afe5); [leaderboard chính thức](https://app.hyperliquid.xyz/leaderboard) | ROI tháng do sàn trả về **+50,5926%**. Portfolio lấy sau: profit sau loại tiền nạp **494,209951 USDC trong 30,5932 ngày**, phần perps **494,048010** | Đủ bằng chứng cho một cửa sổ lời cao; chưa phải kỳ vọng lâu dài hoặc kết quả tài khoản 100 USDT. Có long/short và nhiều coin; lợi nhuận tập trung ở HYPE/ZEC, nhưng không biết rule chọn chúng trước giao dịch |
| [WhiteBIT ICTC, thông cáo của tổ chức giải](https://chainwire.org/2025/05/19/whitebit-crowns-worlds-top-trader-in-first-ever-live-international-crypto-trading-cup/); [thể lệ chính thức](https://blog.whitebit.com/en/ictc-mainstage/) | Max Hamaha: 7.488,84 trên 50.000 USDTB, **+14,98% trong hai ngày**, 47 giao dịch; intraday đòn bẩy cao và vị thế ETH long được mô tả | Vốn USDTB cấp cho giải, không phải track record vốn cá nhân. Lỗ một giao dịch lớn nhất **toàn giải** là 10.725, bằng 21,45% vốn; không gán lệnh đó cho người thắng. Học cơ hội alt/long-short, không suy ra detector cụ thể từ tường thuật |
| [Passivbot Canon, vault do README tác giả dẫn tới](https://app.hyperliquid.xyz/vaults/0x490af7d4a048a81db0f677517ed6373565b42349) | API vaultDetails: equity 19.302,576704 USDC; PnL tháng **+794,105754**; trường APR **36,24%**; leader commission 10% | Có nguồn live công khai đi cùng code. Có nạp/rút và khác vốn/venue; không suy return bằng tăng equity, không gán return của vault cho config EMA-anchor đề xuất |

### Đã kiểm ví, không chỉ đọc leaderboard

Một snapshot leaderboard có 47.304 hàng. Chọn ba ví thắng tháng để điều tra rồi đọc portfolio, fills và ledger chính thức; đây là chọn người thắng sau khi biết outcome, không phải tỷ lệ thành công của trader nói chung. [API chính thức](https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/info-endpoint).

Ví A: equity đầu 601,547260, cuối 1.487,467211; một khoản nạp 391,71 trong cửa sổ. Phép tính `1487,467211 − 601,547260 − 391,71 = 494,209951` khớp thay đổi pnlHistory. Không nhầm tăng equity 885,919951 với lãi. USDC không đồng nhất tuyệt đối với USDT.

Ước tính Modified Dietz có điều chỉnh thời điểm nạp là 78,4651% cho cửa sổ; khác ROI 50,59% do sàn công bố. Không thay hai số cho nhau, không quy nó thành lãi ròng kỳ vọng của hệ thống 100 USDT. Equity/PnL thật của sàn có vị thế mở và dòng tiền; chưa đối soát độc lập từng funding event hoặc hedge ngoài sàn.

Trong gần 24 giờ 22–23/09, PnL giảm 271,946954, bằng **44,54% equity đầu khoảng**. Đây là một khoảng 06:16→06:16 đi qua hai ngày Việt Nam, **không phải phép đo lỗ ngày lịch hoặc bằng chứng riêng rằng trần ngày bị vi phạm**. Portfolio tháng chỉ khoảng 45–52 mẫu, không đủ kiểm anchor 00:00 và MTM trong ngày. Daily-budget status của ví là `UNKNOWN`; mức biến động đã quan sát là lý do phải kiểm tail và hiệu quả sau khi gắn governor 10 USDT.

70 fills tháng gồm cả mở/đóng long và short, không phải 70 round trips. HYPE/ZEC đóng góp phần lớn closed PnL gross; phí fills khoảng 25 USDC. Không trừ phí lần nữa khỏi portfolio PnL, hoặc dùng closed PnL bỏ funding/open PnL. Một ví đối chứng có ROI tháng tổng +40,84% nhưng perps all-time gần −9.962 USDC: cần tách Spot/Futures và xem lịch sử dài hơn tháng thắng.

[Report chi tiết, raw API, SHA và calculator](../audits/2026-10-12-futures-aggressive-research/live-source/report.md) giữ số liệu snapshot và phép đối chiếu. Chúng không tiết lộ lợi thế entry, leverage lịch sử hay kết quả của việc sao chép sau giới hạn lỗ.

## 2. Passivbot: học averaging có điều kiện thay vì cứu ICT/SMC

Đã đọc revision `82e0edf67a1f037b783d139039021ade8f449478`. [README](https://github.com/enarjord/passivbot/blob/82e0edf67a1f037b783d139039021ade8f449478/README.md) mô tả contrarian market making với EMA, trailing entry/exit, averaging và unstuck; Rust planner dùng chung live/backtest. Đây là cơ chế để nghiên cứu lại module strategy của hệ thống.

Template mặc định vốn 100.000, bảy slots: ticket lý thuyết khi scale xuống 100 chỉ khoảng **0,24 USDT**, dưới minimum. Không sao chép template hoặc performance của vốn lớn rồi nhân xuống.

[Example EMA-anchor](https://github.com/enarjord/passivbot/blob/82e0edf67a1f037b783d139039021ade8f449478/configs/examples/ema_anchor.json) có SOL, EMA 415/793 phút, base fraction 0,06, exposure 2,5 mỗi hướng và doubling 1,96. Ticket lý thuyết `100 × 2,5 × 0,06 = 15 USDT`; sau rounding vẫn phải kiểm filters. `hedge_mode=false`: có thể chọn long hoặc short, không suy thành đồng thời hai chân/gross 5×. HSL và unstuck của example đang tắt.

**Ứng viên P1:** EMA-anchor one-way, ticket nhỏ và averaging theo khoảng cách giá/volatility, với governor chung 10 USDT/ngày. Chọn một config chính sau feasibility; ticket, doubling, exposure, leverage và exit là tham số nghiên cứu, không phải rule của người dùng. Không chạy sweep tích Descartes rồi chọn winner trên validation đã xem. So với một ablation bỏ averaging trên development để biết lợi ích đến từ detector hay tăng inventory.

Cần bổ sung trước phép đo ròng:

- HSL của Passivbot là drawdown theo episode/EMA, không phải ngân sách cố định ngày Việt Nam. Dùng account-day governor riêng, theo dõi mọi inventory/pending, phí đóng và cashflow; không dùng setting chặn close lỗ làm daily stop.
- Đọc Rust/backtest Python tại revision chưa thấy funding settlement. Đây là nhận xét source, chưa phải kiểm chứng chạy; không gọi native output là net-after-funding trước khi nối lịch sử settlement.
- Limit-price chạm nến không xác nhận queue fill. Kiểm missed fills, partial fills, đổi sang taker khi đóng bảo vệ, giá đi một chiều và liquidation. Sau khi cắt averaging bằng 10 USDT, return có thể khác nhiều bản gốc và cần đo lại.

[Source/risk notes và snapshot vault](../audits/2026-10-12-futures-aggressive-research/bots-agent-note.md) lưu chi tiết. Chưa có kết quả P1.

## 3. Wick recovery và funding: có ý tưởng, phải sửa lỗi trước thử

[CryptoPinHunter](https://github.com/ShixiangChang/CryptoPinHunter/tree/034bb57856397db33bb70a8ce02b936d689173b9) gợi ý bắt hồi sau low phút giảm ≥5% so với close 15 phút trước và hồi ≥1%; funding trước ≥+0,01%, gần đỉnh 90 ngày, time exit 12 giờ. Source hiện không có SL theo ngày. Đây là giả thuyết forced-selling recovery; OHLCV wick không chứng minh toàn bộ liquidation tape.

Đọc code thấy hourly high của **giờ đang diễn ra** có thể lọt vào filter của event phút; tín hiệu dùng low/close cùng phút rồi fill ngay close với nhãn open_time. Kết quả đó chưa phản ánh thời điểm dữ liệu có thật. Funding chỉ làm filter, chưa có ledger settlement; NAV lúc đóng lệnh không kiểm được lỗ intraday.

**Ứng viên P2:** rebuild detector từ nến đã đóng, chỉ dùng completed-hour high và funding đã settled; entry sớm nhất ở phút giao dịch kế tiếp; sizing/stop/time exit qua governor chung. Seed long-wick recovery lấy từ source; short mirror nếu nghiên cứu là extension riêng, không giả làm kết quả của tác giả. Đếm events, coverage và qty hợp lệ trước screen kinh tế; không nới threshold sau nhìn PnL chỉ để có thêm lệnh.

[Funding-rate-alpha](https://github.com/OctopusTakopi/funding-rate-alpha/tree/cf9f87c01d3165bbc3bf34438baee289d248ffca) kiểm 791 hợp đồng gồm delisted, 6,1 triệu settlements ba venue: high funding dự báo **continuation** trong 2024–2026, khác câu chuyện reversal giai đoạn trước. Spread một giờ 2025–2026 gross 11,4 bps, chỉ còn 1,4 bps trước slip nếu phí taker 5 bps mỗi phía; execution tại settlement print là upper bound của tác giả. Không dùng high funding làm contrarian rule vô điều kiện hoặc coi funding capture tức thời là tiền miễn phí.

Nghiên cứu hourly reversal và cost-aware ML có cơ chế đáng xem tiếp nhưng chưa ưu tiên trên P1/P2: full economics của paper reversal chưa truy cập được; paper BTC ML ghi Binance USD-M Futures từ 2017 trái thời điểm launch 2019. Paper microstructure năm 2026 cho thấy forecast gross có ích nhưng net Futures âm sau turnover/cost. [Note nguồn, defect và archive probes](../audits/2026-10-12-futures-aggressive-research/events-agent-note.md).

## 4. Feasibility vốn nhỏ đã có phép tính thực

Đã lấy ba unsigned public Binance endpoints: exchangeInfo, bookTicker, premiumIndex; giữ raw bytes/SHA và thời gian. Không đọc tài khoản riêng. [Receipt](../audits/2026-10-12-futures-aggressive-research/public-market-receipt.json).

| Symbol | Ticket market tối thiểu ước tính tại mark/ask đã chụp, USDT |
|---|---:|
| BTC | 82,8964 |
| ETH | 20,2810 |
| SOL | 5,5220 |
| XRP | 5,0058 |
| DOGE | 5,0793 |
| AVAX | 10,9410 |
| LINK | 20,1005 |
| 1000PEPE | 5,0085 |
| 1000BONK | 5,0043 |

Effective minimum phải thỏa quantity/step và [market min-notional tại mark price](https://developers.binance.com/en/docs/products/derivatives-trading-usds-futures/common-definition#min_notional). Independent review phát hiện bản tính đầu dùng bid làm PEPE chỉ 4,99984102 theo mark; **v2 dùng qty 1.199**, giữ bản đầu làm provenance. Không báo exchange order eligibility đã PASS.

Ví dụ SOL: qty 3,15, notional 347,886, margin minh họa ở 5× là 69,5772. Giả định phí taker 0,05% mỗi phía, extra adverse slip 0,02% mỗi phía và một bid/ask spread; drag khoảng 14,91 bps. Stop-price distance 1% cho modeled stop+drag khoảng **3,9974 USDT**; favorable move khoảng **0,4365%** cho net 1 USDT **trước funding**. Leverage 5× và risk 4 USDT trong ví dụ không phải cap mới; không phải recommendation đã được backtest.

Điều đã xác minh: arithmetic theo mô hình khai báo và các market quantity filters chụp được. Điều chưa xác minh: actual account margin/tier, liquidation price, stop tick rounding, funding, fill/latency, historical filters, edge, kỳ vọng ngày và trần lỗ 10 USDT. Tăng leverage mà giữ notional chỉ giảm margin; đổi notional mới thay PnL và loss. Cần lợi thế net để vốn nhỏ có ích.

exchangeInfo.serverTime 10:24:37 UTC, nhận file 12:50:26 UTC: khoảng 2 giờ 26 phút khác nhau. Book/premium chỉ trước fetch khoảng 1–2 giây. Không gán thời gian tải thành thời gian filters có hiệu lực. Snapshot hiện tại không chứng minh filters lịch sử.

[Calculator v2](../audits/2026-10-12-futures-aggressive-research/compute-frontier-v2.py), [kết quả](../audits/2026-10-12-futures-aggressive-research/small-account-frontier-v2.json) và [verification](../audits/2026-10-12-futures-aggressive-research/frontier-v2-verification.json) là feasibility arithmetic, **không phải backtest**. Archive probes thêm xác nhận vài file BTC price/funding/metrics tồn tại và ba checksum khớp, chưa xác nhận toàn kỳ/đa coin.

## 5. Quyết định phát triển sau nghiên cứu

1. **Ưu tiên P1 EMA-anchor averaging**: seed có code và ticket phù hợp hơn template; gắn funding và governor ngày. Đo tail sau khi stop bắt buộc làm thay đổi inventory.
2. **Ưu tiên P2 wick recovery**: rebuild causal event path; đo feasibility events trước return. Có thể dùng volatility/notional lớn hơn cũ trong ngân sách mới.
3. **Trend long/short đa coin làm đối chứng**. Bỏ yêu cầu giữ ICT/SMC; universe chọn bằng dữ liệu có lúc đó, không nhét HYPE/ZEC vì đã nhìn ví thắng.
4. **Carry hai venue chuyển dự phòng**: tổng vốn 100, hai legs, minimums/basis/cost có thể hạn chế; chưa có feasibility đủ để đặt trước hai cơ chế trên. Không kết luận carry không có lợi thế.
5. **Đánh giá toàn tài khoản**: mean net USDT/ngày lịch; base/stress; ngày chạm 10 USDT và overshoot; drawdown/ruin; cost/funding; attribution; nhiều regime và prospective. Không yêu cầu mỗi ngày/tháng/rolling window dương.

Ngày 12/10: research và public snapshot/arithmetic **DONE trong scope**; account/margin/funding/historical coverage feasibility **PARTIAL**; implementation, strategy backtest và prospective **NOT_RUN**. Mốc 13/10 hoàn tất thiết kế governor/registry và input còn thiếu; 14/10 shared implementation; 15/10 bounded screen; 16/10 continuous replay nếu đủ gate. Đây là kế hoạch, chưa có automation tự chạy hoặc lời hứa ROI.

Nếu dùng giả định public fee/filter để screen development, ghi rõ scenario và uncertainty; không chờ private account mới được nghiên cứu. Chỉ giữ khác biệt đó ở kết luận, không giả làm financial/live proof. Việc kế tiếp cần tạo artifact triển khai/registration cụ thể, không tiếp tục thêm helper hoặc tìm leaderboard như đầu ra chính.
