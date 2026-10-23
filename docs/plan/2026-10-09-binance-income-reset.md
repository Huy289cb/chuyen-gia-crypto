# Nghiên cứu và kế hoạch thu nhập tự động Binance — 09/10/2026

> **Phân bổ và giai đoạn mới nhất ngày10/10:** 50% Spot, 50% Futures; [nghiên cứu và kế hoạch backtest Spot trước live](2026-10-10-spot-half-capital-backtest-plan.md). Không áp phương án chuyển toàn bộ vốn hoặc khóa toàn bộ entryFutures của các kế hoạch cũ cho phân bổ này.

> **Cập nhật ưu tiên ngày10/10/2026:** Người dùng muốn mạo hiểm, giao dịch khi có cơ hội tốt và đứng ngoài khi khó, dùng LLM tham gia quyết định; đã chọn có thể mất toàn bộ30USDT cho cả lần thử. Hướng chính chuyển sang [AI-selective Spot](2026-10-10-ai-selective-spot-pilot.md). Earn trong tài liệu này là nghiên cứu nền/đối chứng, không còn là mục tiêu thu nhập chính. Ngân sách rủi ro mới không tự bật quyền Spot hoặc thay cấu hình Futures live. Các câu “chưa chốt ngân sách” hay “ưu tiên Earn” bên dưới là kết luận trước cập nhật này.

## Quyết định và kết luận

Người dùng yêu cầu bỏ toàn bộ mục tiêu cải thiện futures trước đây, nghiên cứu trên mạng các mô hình có thể tạo thu nhập hàng ngày trên Binance bằng VPS hiện có, rồi lập kế hoạch triển khai chi tiết. Đây là phạm vi mới; các chỉ tiêu BTC/ROI/fill-uplift của goal cũ không phải tiêu chí chọn phương án mới. Chưa có yêu cầu triển khai giao dịch hoặc chuyển tiền trong lượt nghiên cứu này.

**Phương án phù hợp vốn hiện tại nhất là Earn stablecoin với một bộ kiểm toán và lọc ưu đãi chạy nhẹ.** Một nhánh Spot maker phí 0 có thể được thử có thời hạn để tìm lợi nhuận cao hơn, nhưng chưa có bằng chứng có lãi. VPS chạy 24/24, Telegram và OpenRouter hỗ trợ vận hành; chúng không tự tạo lợi thế kinh tế.

Không có bằng chứng cho một mô hình tự động đáng tin cậy biến ~30 USDT thành 0,5–1 USDT lợi nhuận ròng/ngày. Earn có cơ chế thưởng đều, nhưng chỉ vài phần nghìn USD/ngày. Spot/arbitrage có ngày thua và không được gắn chỉ tiêu phải giao dịch hoặc phải lãi mỗi ngày.

Đã dừng riêng `roi-tx30-four-arm-20261009.service` theo yêu cầu bỏ mục tiêu cũ; main/child nghiên cứu không còn. Service terminal ghi `failed/exit-code`, không phải kết luận kinh tế về chiến lược. API và worker vận hành còn chạy, cấu hình Futures đang bật. Tài liệu nghiên cứu mới không tự tắt worker, đóng lệnh hay chuyển vốn. Migration phải xử lý nguồn mở lệnh cũ trước khi dùng chung vốn.

Bằng chứng, các nghiên cứu thành phần và response API đã lọc bí mật nằm trong `/home/ubuntu/binance-income-research-2026-10-09/`:

- `system-audit.md`, `system-runtime-snapshot.json` — tài nguyên và khả năng tái sử dụng.
- `account-capabilities-snapshot.json`, `earn-and-commission-snapshot.json` — GET có chữ ký, chỉ metadata/số dư/APR/phí; không có API secret.
- `optional-stablecoin-earn-snapshot.json` — rate/minimum/preview U, USD1, FDUSD, RLUSD của tài khoản.
- `earn-research.md` — cơ chế Earn, campaign hiện hành, API và rủi ro.
- `spot-research.md`, các JSON public market snapshots — filter, rounding, fee và kiểm tra spread/arbitrage.
- `other-models.md` — Alpha, P2P, DCA/copy, mining và các phương án loại.
- `legacy-research-stop.json` — hành động dừng nghiên cứu cũ và kiểm tra tiến trình.

Ngày giờ báo cáo dùng `Asia/Ho_Chi_Minh`; các thời hạn Binance ghi UTC được đổi sang giờ Việt Nam. Snapshot chỉ đúng tại thời điểm lấy, không bảo đảm cho lúc triển khai.

## 1. Hiện trạng đã kiểm tra trực tiếp

| Thành phần | Bằng chứng hiện tại | Hệ quả cho thiết kế |
|---|---|---|
| VPS | 2 logical CPU; RAM khoảng 956,6 MiB; swap 2 GiB; disk 49 GiB, còn khoảng 16 GiB | Dùng một worker nhẹ; không cần thêm Redis, dashboard mới hoặc backtest nặng chạy đồng thời |
| Runtime | Node 20, TypeScript; PM2; PostgreSQL 16/Prisma | Tái sử dụng TS/DB/Telegram; thư mục Go không phải bằng chứng runtime live đang dùng Go |
| Binance | Adapter hiện có chủ yếu `/fapi`; mainnet futures live enabled | Viết client `/api/v3` và `/sapi` riêng; không đổi base URL của Futures client để làm Spot |
| Vốn thực | Futures wallet/available 31,47744546 USDT; positions 0; regular/algo open orders 0 tại snapshot ~22:14–22:15 | Vốn chưa ở Spot; phải recheck, khóa nguồn mở lệnh cũ rồi chuyển vốn trong giai đoạn migration |
| Spot wallet | Không có liquid USDT/USDC; chỉ một ít LD receipt assets | Không thể coi vốn futures là số dư sẵn để subscribe hoặc đặt Spot |
| API key | Reading/Futures/IP restriction bật; Spot trading/internal/universal transfer/withdrawal tắt | GET Spot/Earn đọc được; trade/transfer cần quyền thích hợp. GET thành công không chứng minh Earn POST được phép |
| Telegram | Có token, polling và notification service | Chỉ một process sở hữu polling; worker mới ghi outbox để bot hiện tại gửi |
| OpenRouter | Có credential, client và cost journal | Dùng theo sự kiện khi có lợi ích đo được; không cần gọi model mỗi lần cập nhật giá |

Các kiểm tra trong lượt này chỉ GET/quan sát, không gửi Telegram, không gọi model trả phí, không thay đổi tiền hay lệnh trên Binance. Future migration phải recheck account và lệnh vì worker cũ vẫn có thể thay đổi trạng thái sau snapshot.

## 2. Mức thu nhập và điều kiện cần

Số liệu GET tài khoản khoảng 22:14–22:15 ngày 09/10, minh họa với **30 đơn vị** để so sánh. USDC/RWUSD cần quy đổi theo bid thực nếu báo cáo USDT; bảng dưới xấp xỉ giả định gần par. Chưa tính chi phí hệ thống, đổi tài sản, T+1/T+2 hoặc APR biến động.

| Sản phẩm | Rate/preview hiện tại | Ước tính/ngày | Ước tính 30 ngày nếu rate giữ nguyên |
|---|---:|---:|---:|
| USDT Flexible | 2,500776%; bonus preview = 0 | 0,0020553 USDT | 0,061659 USDT |
| USDC Flexible | 2,226137% realtime + 2% tier = 4,226137%; preview 30 xác nhận hai khoản | 0,00347353 USDC | 0,104206 USDC |
| RWUSD | Rate history ba ngày gần nhất 3,61%; không phải future guarantee | khoảng 0,002967 RWUSD | khoảng 0,089014 RWUSD |
| U Flexible, lựa chọn bổ sung | GET ~22:21: base 1,064158% + bonus 6% = 7,064158%; minimum 0,1 U | 0,005806 U | Không ngoại suy tháng: bonus công bố hết 15/10 |

USDC campaign hôm nay quảng cáo tối đa 5%/VIP 5,5%, nhưng bậc vốn nhỏ công bố ~4,5%; rate realtime tài khoản lúc kiểm tra thấp hơn, tổng thực khoảng 4,226%. Campaign công bố kết thúc **08/11/2026 06:59:59 giờ Việt Nam**. Sau campaign không mặc định còn bonus 2%. Phải xác nhận lại rate/quota/new-subscription eligibility trước hành động. [Thông báo USDC](https://www.binance.com/en/support/announcement/detail/aa50d46ffef448f98c42f9272fcee663).

RWUSD tài khoản hiện có `freeQuota=100` cho fast redemption, thường fee fast 0,1% ngoài quota, standard 0,05%, thời gian 3 ngày. Đừng áp phí 0,1% máy móc cho toàn bộ 30 u, cũng đừng giả định free quota tồn tại mãi. Tài sản trả về là USDC. Current 3,61% thấp hơn USDC offer; giữ RWUSD làm lựa chọn dự phòng sau khi rate đổi. [RWUSD FAQ](https://www.binance.com/en/support/faq/detail/62626eed1296460eaa5c0f8e70085389).

Đổi USDT↔USDC hiện GET commission của tài khoản cho thấy maker/taker/special/tax = 0. Vẫn có spread, lot rounding, premium/depeg và chi phí nếu phải thoát ngoài chính sách hiện tại. Dùng executable quote và quantity thực, không ghi conversion cost = 0 chỉ vì commission = 0.

Với rate 10%/năm giả định phẳng, không bonus tiers, để nhận 0,1 USD/ngày cần khoảng **365 USD**, 1 USD/ngày cần **3.650 USD** trước chi phí. Đây là phép tính vốn, không phải khuyên nạp thêm hay hứa có sản phẩm trả 10% lâu dài. 1 USD/ngày trên 30 USD tương đương 3,33%/ngày; một mô hình có thể đạt một ngày không chứng minh duy trì được.

Chi phí AI 0,01 USD/ngày đã cao hơn reward Earn hiện tại. Mục tiêu 30 u cần tận dụng native accrual, polling thưa, báo cáo template. Báo cáo tách:

1. Lợi nhuận trong Binance sau phí và đổi tiền.
2. Lợi nhuận kinh tế sau AI và chi phí hạ tầng tăng thêm.
3. Lợi nhuận nếu phân bổ cả tiền thuê VPS hiện có. Hóa đơn VPS chưa được xác minh; không gọi khoản này bằng 0.

## 3. So sánh các mô hình

| Mô hình | Cơ chế thu tiền | Khả thi với ~30 u | Quyết định |
|---|---|---|---|
| Simple Earn stablecoin | Phần thưởng từ sản phẩm Binance, tích lũy/chi trả theo cơ chế sản phẩm | Cao về kỹ thuật, thu nhập rất nhỏ; rate/counterparty/liquidity risk | Chọn làm nguồn nền |
| RWUSD | Reward ngày, redeem thành USDC | Minimum 0,1; API có; current free fast quota nhưng rate thấp hơn USDC | Comparator/dự phòng |
| Stablecoin hold campaigns | RLUSD→XRP, USD1→WLFI; reward theo event/pool | Có thể tham gia nhỏ; reward tuần, dust, rate/terms không chắc | Discovery và thông báo, không coi thu nhập ngày cố định |
| U Flexible | Bonus ngắn hạn; actual account hiện 7,064158%, minimum 0,1 U | Còn tới 15/10 06:59; sau spread và mất bonus khi quay lại, tăng thêm chỉ khoảng 0,007 u trên 30 u trong kịch bản rate không đổi | Optional, không đổi stablecoin mới mặc định |
| Launchpool/HODLer/BNB | Nhận token theo staking/snapshot/event | Một số minimum nhỏ đủ, nhưng BNB biến động; reward không đều/dust | Chỉ theo dõi event; không mua BNB chỉ để lấy APR |
| Spot ít giao dịch, maker phí 0 trên FDUSD | Bán sau hồi giá; giảm fee drag nhờ maker phí 0 | Ticket 8–10 có thể phù hợp; có inventory loss và no-fill | Một nhánh paper có hạn định, chưa chọn live |
| Spot grid nhiều mức | Ghép buy/sell quanh range | Vốn mỏng, lot/reserve; grid profit có thể dương trong khi NAV âm | Không xây grid nhiều tầng ở 30 u |
| Market making phí chuẩn | Thu spread | Spread snapshot nhỏ hơn phí của 2 lượt giao dịch; adverse selection | Loại |
| Stablecoin grid maker/taker phí 0 | Spread/deviation quanh peg | Gross mỗi vòng rất nhỏ, queue/dust/depeg | Ưu tiên thấp; không xây HFT |
| Triangular/cross-exchange arb | Chênh giá sau 2–3 lượt giao dịch | Snapshot triangles không có positive net; không atomic, phí, vốn chia nhiều nơi | Không xây execution ở giai đoạn này |
| Alpha points | Volume/holdings tạo quyền claim | FAQ yêu cầu ≥100 USD tài sản đủ điều kiện; dưới 100 USD, điểm volume/task không tính | Loại với vốn hiện tại |
| P2P merchant | Chênh fiat/crypto | Cần fiat, settlement ngân hàng, merchant/access/disputes | Không phù hợp vận hành không có người giám sát với 30 u |
| DCA/copy/rebalancing | Exposure giá hoặc theo lead trader | Không chứng minh tạo dòng tiền dương; copy có fee/profit share | Không chọn làm nguồn ngày |
| Dual Investment | Reward cao đổi lấy settlement contingent | Có thể nhận coin giảm giá mạnh; khóa vốn | Loại cho mục tiêu stable income |
| Funding/basis | Thu funding với spot/perp đối ứng | Vẫn futures/margin và hai lượt giao dịch | Ngoài phạm vi mới |
| VPS mining/referral/Learn&Earn | Hashrate/khách hàng/event | Không tự sinh tiền nhờ VPS này; điều kiện không đủ | Không chọn; reward event chỉ alerts |

Alpha threshold là điều kiện hiện tại, không phải nhận xét rằng mọi airdrop cần 100 USD. [FAQ Alpha](https://www.binance.com/en-AE/support/faq/detail/12e7f2e555704f9c8e852d1c1afb032a). Nguồn và điều kiện chi tiết của các hàng còn lại nằm trong ba nghiên cứu thành phần.

## 4. Hai hướng triển khai được đề xuất

### 4.1 Earn và bộ lọc cơ hội

Mục đích: để vốn nhàn rỗi nhận reward thực; chỉ di chuyển nếu số tiền tăng thêm sau chi phí đủ đáng làm. Mặc định đề xuất **25 u Earn, phần còn lại ≈6,48 u giữ thanh khoản** nếu toàn bộ 31,4774 thực chuyển được. Chưa phân bổ vốn Spot thật.

Allowlist ban đầu: USDT/USDC; RWUSD là sản phẩm bổ sung nếu comparator ưu tiên. U/RLUSD/USD1/FDUSD và coin nhận thưởng phải có policy riêng về issuer, mức exposure và cách thoát; ưu đãi APR cao không tự thêm vào allowlist.

USDC current offer đứng trên USDT/RWUSD trong các lựa chọn nền đã kiểm tra, nhưng công thức chọn dùng snapshot thực lúc triển khai. Không cố định rate hiện tại trong config.

U đã được kiểm tra GET: hiện tại 7,064158% cao hơn USDC, minimum 0,1 U; phí UUSDT bằng 0. Tuy nhiên tại 22:21 ngày 09/10 chỉ còn khoảng 5,36 ngày và tối đa 5 ngày bonus trước promo hết. Phép so sánh trong báo cáo Earn tính cả spread và bonus mất khi trở về USDC cho lợi tăng thêm khoảng 0,007 u trên 30 u, khoảng 0,006 u trên bucket 25 u nếu rate giữ nguyên. Đây là ước tính theo snapshot, chưa là giá khớp hay thưởng chắc chắn. Nó dưới ngưỡng đổi 0,01 u đề xuất.

Về issuer, tài liệu U mô tả dự trữ bằng USD và stablecoin; nói rõ việc tách tài sản về vận hành không mặc định trao quyền sở hữu/ưu tiên đối với dự trữ cho holder khi mất khả năng thanh toán. Trang attestation lúc đọc có báo cáo tới 08/2026; chưa kiểm toán độc lập toàn bộ dự trữ trong lượt này. Vì vậy không xem APR cao hơn như sản phẩm có cùng rủi ro với USDC. [Whitepaper U](https://www.u.tech/resources/white-paper/), [attestation U](https://u.tech/transparency/audit-report/).

USD1 Flexible thực tế 3,695676% không tự cộng airdrop Stage 1 chỉ tính Spot/Funding. RLUSD Flexible base thực tế 0,002573% và preview airdrop 0 không phủ định XRP reward của campaign riêng; phải tính lịch/quyền nhận/giá trị XRP và khả năng bán dust riêng. [RLUSD campaign](https://www.binance.com/en/support/announcement/detail/3bd5e178205f4051bd008994c5a99363). Issuer Ripple mô tả dự trữ thanh khoản tách biệt và attestations; giá trên sàn vẫn có thể lệch 1 USD. [RLUSD terms](https://ripple.com/legal/stablecoin/).

`net_gain(H) = projected_rewards_new(H) - projected_rewards_stay(H) - conversion_spread_and_commission - redemption_fees - lost_bonus - reward_sale_cost - AI_incremental - infra_incremental`

H là thời gian đủ dài nhưng không vượt ngày kết thúc promo; sau đó dùng rate base đã quan sát hoặc stress rõ ràng. APR theo tier tính riêng phần vốn thuộc mỗi tier; reward airdrop chưa rõ không cộng vào guaranteed return. Mọi nguồn chưa biết chi phí/quyền/eligibility ghi `unknown` và chỉ xuất đề xuất.

Điều kiện đổi đề xuất: net_gain theo kịch bản thận trọng ≥0,01 USDT cho cả holding horizon, lớn hơn dự phòng chi phí; sản phẩm/risk allowance/commission mới được xác nhận; không cần tiền trước thời gian redeem; không đang có action chưa reconcile. Ngưỡng 0,01 là quyết định vận hành đề xuất cho 30 u, không là bằng chứng dự báo.

USDT autoSubscribe hiện đã bật. Trước khi giữ cash buffer phải chọn **một chủ thể sweep**: native Binance auto-subscribe hoặc worker mới. Nếu worker giữ reserve, native auto-subscribe trên cùng assets phải tắt trong migration, có ghi nhận; không để hai bên tự sweep và làm mất buffer. Mặc định v1 có thể chỉ giữ một khoản Earn cố định, theo dõi reward và tạo đề xuất; subscription mới chỉ khi có surplus đủ minimum/hợp lệ, không liên tục redeem rồi subscribe.

Rewards nhỏ tích lũy trong wallet; coin airdrop chỉ bán khi tổng net quantity đủ filters và proceeds sau cost đáng kể. Không bán dust bằng nhiều chuyển đổi thiếu hiệu quả. Kế toán vẫn ghi nhận dust theo giá và thanh khoản, tách khỏi cash rút được.

### 4.2 Một nhánh thử Spot có giới hạn

Ưu tiên nếu cần kiểm chứng lợi nhuận cao hơn: **mean reversion một vị thế trên BNB/FDUSD hoặc SOL/FDUSD**, dùng maker phí 0 đã xác nhận tài khoản. Đây là giả thuyết giá hồi trong range, không phải chứng minh maker phí 0 tạo alpha. Chọn đúng một cặp sau so sánh liquidity/lot/fill feasibility; không chạy cả danh mục và không tìm hàng trăm bộ tham số.

Phí current BNBFDUSD/SOLFDUSD maker 0/taker 0,1% đã GET xác nhận; BTCUSDT nền maker/taker 0,1%. Stop khẩn cấp có thể là taker nên luôn dự phòng phí đó. Thông báo chính thức giữ zero maker có thể đổi; phí phải kiểm tra lại và dừng entries khi mất điều kiện. [Cập nhật FDUSD](https://www.binance.com/en/support/announcement/detail/4856a6d4e4014d4e8a5a29ec5fb44857).

Thiết kế ứng viên để đăng ký trước paper: nến 5 phút đã đóng, VWAP trượt trong 24 giờ làm anchor; một bid tại anchor − 1 ATR(14, 5m) khi dữ liệu đầy đủ và VWAP không đang trượt xuống ngoài ngưỡng trend đã đăng ký; maker exit tại anchor cập nhật theo quy tắc đóng băng; hard stop theo giá/ATR được đăng ký, tối đa thời gian giữ 24 giờ. Các tham số này chỉ là bản thiết kế cần chốt trước run, chưa được backtest chọn hoặc khẳng định hợp lý. Nếu không có bằng chứng range/execution, bỏ nhánh thay vì nới thresholds để buộc có lệnh. Không có martingale, không tăng size sau lỗ.

Một ticket 8–10 u; một vị thế tổng; phần còn lại vẫn Earn/cash. Dự phòng đề xuất cho pilot 10 u: tổng lỗ tối đa 0,90 u cho cả pilot, pause entries tại 0,30 u lỗ ngày theo định giá theo bid cộng chi phí thoát. Đây là policy mới đề xuất, không thay policy Futures live và không là lời hứa stop luôn khớp đúng budget khi gap. Chọn size từ mức lỗ tối đa, stop và filters; nếu không đủ exit hợp lệ thì không mở.

Trước pilot phải phân bổ lại, ví dụ theo giá trị USDT trước chi phí: **15 u Earn + 10 u Spot + 6,47744546 u cash**; chờ redeem và conversion thực sự hoàn tất, rồi giữ tối thiểu 5 u cash sau chi phí. Không dùng khoản reserve 6,48 u để mở ticket 10 u và vẫn báo rằng reserve còn nguyên. Phí USDT↔FDUSD funding/unwind chưa được xác nhận trong snapshot signed; phải đọc riêng và tính cả spread/rounding/depeg để định giá khoản Spot về USDT, không dùng phí 0 của USDCUSDT thay thế.

Không hạch toán maker fill khi chỉ có nến chạm giá. Paper dùng trades/orderbook, queue-ahead và latency; base case conservative; stress có maker không khớp, taker exit, slip cao hơn, partial fills và stop gaps. Có thể không khớp đủ để suy luận profitability: đó là kết luận **thiếu bằng chứng**, không giấy phép gia hạn vô hạn.

Snapshot spot cho minNotional 5 USD nhưng bước BTC 0,00001 và fee bằng BTC có thể làm lệnh mua ~5,80 u chỉ bán lại ~4,97 u ở giá ngang, bị reject. Phải preflight **cả entry và exit tại giá stop**, sau fees/lot rounding; minNotional entry không đủ. Dùng quantity/base balance thực, commission asset/dust và tick/step theo symbol.

Partial fill cũng có thể khiến intent 10 u chỉ mua được 3 u và không bán riêng được. Khi đó hủy phần pending nếu phù hợp, ghi `STRANDED_INVENTORY`, giữ quantity trong NAV nhưng tách khỏi cash có thể tiêu, chặn entries mới và cảnh báo. Mua thêm/gộp lượng để thoát chỉ được làm theo policy đã chốt và nếu còn risk budget; không tự top-up hoặc gọi MARKET exit lặp khi chưa đủ minimum.

Kết quả báo cáo NAV/cash+coin theo executable bid, realized và unrealized, fees/dust, số cycles đã đóng, exposure time và AI/infra. Ví dụ ticket 10 u tăng 1%, gross ≈0,10 u, nhưng coin giảm 3% ≈−0,30 u; số lệnh xanh không chứng minh toàn danh mục có lãi.

## 5. Kiến trúc và file map

Tạo **worker TS mới tách scheduler Futures**, dùng adapters/interfaces thuần. Không import entrypoint `worker.ts` hay bootstrap module có side effects từ bot cũ. Tái dùng helper ký request sau khi tách khỏi `/fapi`, Telegram client/outbox, OpenRouter usage journal và DB connection pool nhỏ. Không cần viết lại bằng Go hay broker mới.

```text
GET account / fee / Earn offer / market data
    -> snapshots + capability checks
    -> deterministic income-policy / feasibility
    -> economic proposal + durable action intent
    -> scoped executor (only in the selected live mode)
    -> exchange history reconciliation
    -> cash / holdings / reward / cost ledger
    -> Telegram outbox + daily template report
```

| Module mới đề xuất trong backend | Chức năng cụ thể |
|---|---|
| `src/services/binance-spot/client.ts` | HMAC/time sync, GET account/commission/exchangeInfo, order query/trade history, optional Spot order executor tách quyền |
| `src/services/binance-earn/client.ts` | Flexible list/preview/quota/positions/reward/subscription/redemption history; RWUSD account/quota/rates; optional POST executor |
| `src/config/income-mutation-policy.ts` | Kiểm host+method+path và capability riêng; mặc định chỉ đọc; từ chối mutation ngoài allowlist, không lấy flag Futures để bật Spot/Earn |
| `src/services/income/income-policy.ts` | Allowlist, capital bucket/reserve, tiered reward math, risk allowance, mode/cost budget, stop rules |
| `src/services/income/opportunity-discovery.ts` | Official announcements, campaign dates/terms/eligibility, URL/content hash, parser; manual-review flags nếu không có API ổn định |
| `src/services/income/earn-router.ts` | Stay-vs-switch expected net benefit, holding horizon, quota/minimum/liquidity checks; xuất proposal |
| `src/services/income/action-journal.ts` | Intent/action state, account lock, unknown response handling, startup recovery |
| `src/services/income/income-ledger.ts` | External flows, internal transfers, rewards, conversions, commissions by asset, mark/dust, provider costs |
| `src/services/income/reconciliation.ts` | So lịch sử Binance với intent/ledger, cursor overlap/dedup, reconcile snapshots |
| `src/services/income/spot-feasibility.ts` | Tick/step, entry+exit sellability, base commission, stop price, depth và reserve |
| `src/services/income/spot-paper.ts` | Một đường logic strategy/risk chung paper/live; exchange adapter khác, queue/partial-fill stress |
| `src/schedulers/income.scheduler.ts` + `src/income-worker.ts` | Một process observe/paper/earn-live/spot-pilot; flags đọc trạng thái, không auto-enable Futures |
| `src/services/telegram/income-report.ts` | Report template, notification dedup, `/income`, `/opportunities`, `/income_pause` qua poller hiện có |
| `src/services/telegram/income-outbox.ts` và command handler | Consumer có lease, dedup update_id, sent-state và pause-state lưu DB; retry báo cáo không lặp action tài chính |
| `prisma/schema.prisma`/migration mới hoặc schema income riêng | Các bảng income tách dữ liệu/hạch toán khỏi trade-futures lịch sử |

Đường dẫn trên là **đề xuất**, chưa tạo code/modules. Repo có nhiều thay đổi chưa commit từ công việc cũ; implementation phải giữ nguyên và dùng commit phạm vi mới, không reset/checkout làm mất chúng.

`mainnet-safety.ts` hiện chỉ bảo vệ hostname/path Futures. Chỉ tái dùng signer HMAC thuần sau audit; guard đó không chứng minh request Spot/SAPI được bảo vệ. Guard mới phải kiểm toàn bộ host/method/path, chặn unknown POST/DELETE, withdrawal/transfer không thuộc scope và chứng minh observe-mode không thể bị flag Futures bật mutation.

Data model tối thiểu: `IncomeAccountSnapshot`, `IncomeOfferSnapshot`, `IncomePolicyVersion`, `IncomeAction`, `IncomeLedgerEntry`, `IncomeReward`, `IncomeCost`, `IncomeOpportunity`, `IncomeReport`, `IncomeAlertOutbox`. Dùng Decimal, không float cho tiền/quantity. Unique keys gồm account+exchange transaction/reward/order id; thời gian có timezone. Giữ reference raw snapshot đã lọc bí mật và policy/source version cho mỗi action.

Action lifecycle: `PROPOSED -> PREPARED -> SENT -> CONFIRMED/UNKNOWN/FAILED -> RECONCILED`. Earn POST không được mặc định có idempotency key như clientOrderId Spot. Timeout sau gửi giữ `UNKNOWN`; đọc history/positions để xác định trước khi làm tiếp; nếu không phân biệt được thì chặn action mới và alert. Không retry subscribe/redeem mù. Spot dùng stable clientOrderId + order query, reconcile fills/partial before cancel/reissue.

Toàn tài khoản chỉ có một scheduler/action lock cho vùng vốn income. Người dùng/native auto-subscribe/lệnh thủ công có thể đổi số dư: re-read trước execute, reconcile sau execute và daily full snapshot; balance anomaly block mutation. Xử lý 429/418/time drift với backoff và không tạo request storm. Dữ liệu/quotes cũ hoặc API unavailable => chặn action, giữ báo cáo lỗi có tuổi dữ liệu.

DB pool 1–2; mục tiêu RAM của worker ≤100 MiB khi chạy ổn định và trần tối đa 128 MiB là **mục tiêu cần đo**, không chứng cứ đã đạt. REST tài khoản/Earn mỗi 30–60 phút; WebSocket thị trường chỉ bật cho 2–4 symbols trong paper. Retain raw book/trades có rotation/aggregation, không lưu toàn sàn vô hạn. Dùng disk cap cho collector; log không có secrets.

OpenRouter chỉ hỗ trợ tóm tắt/parsing thông báo mới theo schema: asset/campaign/eligibility/minimum/tier/expiry/sourceURL. Kết quả AI luôn được kiểm chứng bằng API/terms; model không được gửi order/transfer hoặc sửa risk. Cache theo content hash, không gọi cho báo cáo ngày template. Budget đề xuất `min(0,01 USD/tháng, 10% reward dự kiến/tháng)` và dừng paid calls khi chưa biết giá/cost; root study không gọi paid API.

Telegram báo cáo ngày đề xuất lúc 20:00 giờ Việt Nam: equity, net earned day/7d/30d, reward pending vs credited, fees/dust/AI, offer hiện tại, next expiry, action blocked. Alerts ngay khi sai lệch tiền/lệnh, offer hết hạn/fee đổi, API failure kéo dài hoặc stop rule. Không spam trạng thái không đổi. Bot cũ là chủ polling, worker dùng outbox; poller authorization kiểm tra chat/user allowlist cho commands ảnh hưởng trạng thái.

Lệnh `/tat` hiện chỉ mute thông báo, không pause giao dịch. `/income_pause` cần lưu DB và giữ qua restart. Nếu ngừng worker cũ sau migration thì chuyển chủ polling có kiểm chứng; outbox consumer có lease và trạng thái gửi bền vững, không được retry financial action khi retry alert.

## 6. Kế hoạch thực hiện, đầu ra và điều kiện dừng

Thời gian là ước tính effort/lịch sau khi bắt đầu implementation; vướng quyền tài khoản phải ghi rõ, không tự giả pass. Một tuần paper không thể chứng minh bất kỳ APR giao dịch nào.

| Giai đoạn | Thời lượng đề xuất | Việc làm và bàn giao | Acceptance / stop |
|---|---|---|---|
| A: đọc và đo | 0,5–1 ngày | Income CLI observe; snapshot account/fee/Earn; ledger cơ bản; báo cáo minh bạch; tái dùng GET đang hoạt động | Có wallet chính xác, quyền API key, offer/quota/cost. Không cần trade để hoàn thành |
| B: Earn MVP | 1–2 ngày | Adapters/action journal/reconcile/Telegram template; deterministic comparator; tests có ý nghĩa | Giả lập/fixtures chứng minh không duplicate, đúng tier, rounding và luồng tiền bên ngoài. Chưa có quyền POST thì dừng executor, vẫn bàn giao chế độ observe |
| C: migration/Earn activation | khoảng 0,5 ngày sau khi plan cụ thể được chấp thuận | Backup trạng thái; disable nguồn lệnh Futures mở mới trên API/worker/Telegram; giữ exits nếu có position; recheck account/orders; transfer vốn; chọn chủ thể sweep/key; subscribe nhỏ rồi khoản chính | Exact exchange receipt và đối soát balance. Quyền/position/unknown action không rõ thì dừng. Không dùng GET capability làm chứng cứ POST được phép |
| D: reward verification | 3–7 ngày quan sát, không giữ chat chờ | Reconcile realtime/bonus T+1/T+2, cash reserve, missed rewards, fees và lợi nhuận ròng sau chi phí; observer tự chạy | Reward thực không khớp thì sửa hoặc dừng router; không gọi accrued forecast là cash đã nhận |
| E: Spot paper (optional) | 7 ngày data, tối đa 14 ngày lịch kể từ start | Chốt một hypothesis/config trước run; trades/book, queue fill + inventory P&L, conservative cost; so với Earn/giữ cash | NAV ròng ≤0 hoặc không có đủ economic benefit => bỏ. Ít fills/unknown = thiếu bằng chứng; không gia hạn tự động hoặc sửa threshold chạy lại |
| F: Spot pilot để đo execution, tùy chọn | tối đa 7 ngày và ≤0,90 u tổng mức lỗ cho phép đề xuất | Sau review bằng chứng và budget cụ thể: một pair/position 8–10 u, phần còn lại Earn/cash; fills/fee/stop thực tế; review ngày 3/ngày 7 | Stop risk/fee/data/anomaly hoặc net không vượt Earn + cost. Không tự kích hoạt vì paper có lãi; pilot chưa chứng minh profitability bền vững |

Giai đoạn C/F là kế hoạch thay đổi tài khoản và runtime tương lai, **chưa thực hiện trong lượt này**. Trước activation, người dùng xem cụ thể assets/amounts/risk/mode và các thay đổi API/worker. Quyền thử nghiệm Futures trước đây không tự chuyển thành quyền nạp/rút/chuyển hoặc chọn stablecoin mới ở hệ thống này.

Migration phải chặn new-entry tại `v3-trade-execution.service.ts` và đường `binanceClient.ts`/`placeLimitOrder` trực tiếp, bao gồm LLM, causal, Telegram AI và legacy jobs; dừng paid dispatch không cần thiết. Giữ monitor/protective/close/cancel cho vị thế đang có. Không dùng global live-trading=false thay cho stop-entry vì có thể chặn cả exits. Acceptance phải chứng minh mọi nguồn entry bị chặn và exits vẫn hoạt động trước chuyển vốn.

Gate nghiên cứu Spot: một configuration được đăng ký trước; so các giai đoạn lịch sử khác chế độ thị trường tách khỏi phần đã dùng để chọn design và một đoạn prospective. Không đổi tên dữ liệu đã xem thành ngoài mẫu. Screening lịch sử giới hạn một run và ≤2 giờ wall-time, không gọi AI trả phí; thiếu dữ liệu/queue history thì ghi giới hạn rõ. Chỉ giữ candidate nếu kết quả NAV sau mọi chi phí vượt Earn cùng vốn và kỳ trong base/stress, không phụ thuộc vài fill và lợi ích vượt sai số fill/cost. Lịch 7–14 ngày, số lệnh hoặc profit factor đơn lẻ không phải gate pass. Nếu chưa đủ bằng chứng thì không auto-rollout; một execution pilot nhỏ vẫn là thử nghiệm rủi ro có budget cụ thể cần review, không được gọi là triển khai mô hình kiếm tiền đã chứng minh.

Sau E không tìm được lợi thế thì đóng nhánh Spot và báo kết luận, không mở vòng nghiên cứu vô hạn. Việc scheduler chạy ổn, có nhiều signals hoặc tạo dashboard không được tính thành kết quả kiếm tiền. Không tạo goal mới trong lượt này vì user yêu cầu nghiên cứu/lập kế hoạch, chưa yêu cầu tạo goal.

## 7. Kiểm chứng kỹ thuật và kinh tế

Các bài kiểm tra cần thiết trước sử dụng tiền:

- Entry hợp lệ nhưng exit sau fee/rounding/stop không hợp lệ => không mở; partial fills/dust giữ đúng asset quantity.
- Earn subscribe/redeem timeout sau gửi + restart => reconcile trước bất kỳ POST tiếp theo, không ghi success hoặc retry mù.
- Reward realtime/tier/snapshot UTC/T+1/T+2: không cộng forecast và credited reward hai lần; cash chậm về không được tiêu trước.
- Native autoSubscribe và worker cạnh tranh => phát hiện/chặn; cash reserve không bị sweep.
- Internal Futures→Spot, Spot→Earn, Earn→Spot là chuyển nội bộ, không phải profit/deposit làm ROI đẹp hơn. External deposits/withdrawals tách khỏi PnL.
- Promo expiry/commission change/429/stale book/clock drift/DB restart => giữ state và dừng mutations an toàn.
- NAV loss của coin/depeg và taker cost được tính ngay cả khi chưa đóng; stress fill model không dùng candle-touch fill.
- AI cost có receipt hoặc ghi unknown; AI parse không thể tự bỏ allowlist/quota/risk/user auth.
- Capability policy kiểm host/method/path và observe-mode; entry freeze chặn đủ LLM/causal/AI/direct sources nhưng vẫn cho exits/protection/cancel.
- LD receipt và underlying Earn position chỉ tính một lần; pending redemption không đồng thời ở Spot và Earn; reward đã nhập position không cộng lại thành tài sản mới.

`exchange_net = consolidated_equity_now - consolidated_equity_start - external_deposits + external_withdrawals`; equity gồm Spot/Earn/Futures/cash/pending redemptions/dust theo consistent executable valuation, tránh tính hai lần asset chuyển đi. Reward/PnL/fees là breakdown phục vụ đối soát, không cộng lần nữa lên equity difference. `economic_net = exchange_net - AI_cost - incremental_infra_cost`; full VPS allocation báo thêm riêng.

Kết quả cuối phải cho biết tiền tăng ròng bao nhiêu, loại asset nào, đã liquid hay pending, kể cả lỗ; so với giữ Earn cùng vốn/cùng kỳ. Tiny positive paper estimate không đủ nếu nằm trong sai số fill/cost. Kỳ Earn dương không bảo đảm depeg/custody risk bằng 0. Giới hạn thu nhập 30 u vẫn tồn tại dù code đúng.

## 8. Nguồn API chính thức và phạm vi chưa biết

- [Simple Earn API catalog hiện hành](https://developers.binance.com/en/docs/catalog/investment-and-services-simple-earn/api/rest-api/flexible-locked) và [official Go generated API reference](https://github.com/binance/binance-connector-go/blob/main/clients/simpleearn/src/restapi/docs/FlexibleLockedAPI.md): Flexible list, preview, positions/history/quota; lấy endpoint/field hiện hành, không copy rate từ example.
- [Spot official API docs](https://github.com/binance/binance-spot-api-docs), [filters](https://github.com/binance/binance-spot-api-docs/blob/master/filters.md), [commission FAQ](https://github.com/binance/binance-spot-api-docs/blob/master/faqs/commission_faq.md): spot quantities/order states/fees.
- [Binance Simple Earn mechanics](https://www.binance.com/en/earn/simple-earn): accrual/bonus/redeem restrictions/risk.
- [Grid PnL definitions](https://www.binance.com/en/support/faq/detail/688ff6ff08734848915de76a07b953dd): matched grid profit và unrealized P&L là khác nhau, tổng phải gộp.

Chưa biết: mục tiêu thu nhập và khả năng bổ sung vốn của user; quyền thực hiện thay đổi qua API cho Earn; eligibility/quota offer tại thời điểm subscribe; hóa đơn VPS hằng tháng; lợi thế Spot bền vững/xác suất khớp; reward pool tương lai và khả năng tự động claim cho từng event. Mục tiêu thu nhập đã hỏi nhưng dùng mặc định 30 u để hoàn tất nghiên cứu, không cần treo kế hoạch chờ câu trả lời.

**Đề xuất bắt đầu bằng A/B: worker đọc tài khoản và Earn MVP nhẹ; C chỉ sau review migration cụ thể.** Chọn USDC Flexible nếu offer lúc đó vẫn đứng đầu theo net thực tế và policy; giữ cash buffer; tạo ledger và alerts chi phí nhỏ. Spot chỉ là nhánh E có deadline, không là lời hứa lãi ngày. Không tăng leverage, martingale hoặc tái mở goal Futures để bù khoảng cách thu nhập.
