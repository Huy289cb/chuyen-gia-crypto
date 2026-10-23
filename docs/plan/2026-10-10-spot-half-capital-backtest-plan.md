# Kế hoạch kiểm chứng Spot trước giao dịch — vốn chia 50/50

**Cập nhật sau yêu cầu `continue`:** Đã triển khai và chạy xong backtest v1 lúc **11:00:46 ICT, 10/10/2026**. Kết quả **FAIL**: main base −4,83807289 USDT, stress −5,50381984 USDT trên ví mô phỏng 15 USDT liên tục tháng 04–09. Xem [báo cáo thực hiện](/home/ubuntu/binance-income-research-2026-10-10/backtest-run-v1/report.md), [registration trước OOS](/home/ubuntu/binance-income-research-2026-10-10/backtest-run-v1/run-registration.json) và [audit kế toán độc lập](/home/ubuntu/binance-income-research-2026-10-10/backtest-run-v1/artifact-accounting-verification.json). Nội dung thiết kế ban đầu dưới đây giữ để đối chiếu; các dòng chưa chạy mô tả trạng thái lúc lập kế hoạch. Protocol JSON được giữ nguyên hash, trạng thái thực hiện lấy từ `backtest-run-v1/execution.json`.

**Yêu cầu hiện hành ngày 10/10/2026:** khoảng 50% vốn dành cho Spot, 50% giữ ở Futures; nghiên cứu và lập kế hoạch backtest vào lệnh Spot trước khi dùng tiền thật. Yêu cầu này thay thế phương án chuyển toàn bộ 30 USDT sang Spot. Không khởi động lại goal cải thiện Futures cũ.

## 1. Phạm vi, vốn và quyết định nghiên cứu

Backtest chính dùng **15 USDT tiền Spot**, tương ứng một nửa vốn danh nghĩa 30. Snapshot tài khoản 09:13 ICT có 31,47744546 USDT khả dụng ở Futures: nếu tổng equity đủ điều kiện vẫn bằng số đó khi triển khai, 50% lý thuyết là 15,73872273 USDT. Đây chưa phải số dư Spot hoặc lệnh chuyển tiền. Không lấy lợi nhuận Futures bù lỗ Spot trong báo cáo, tự nạp bổ sung hay tái cân bằng 50/50 sau mỗi ngày.

Giữ phần Futures riêng. Đề xuất cũ khóa toàn bộ entry Futures trước chuyển cả vốn **không còn áp dụng cho phương án này**. Trước chuyển một nửa vốn sau này, kiểm tra margin/vị thế/lệnh và giới hạn dùng tiền ở từng bucket; không chuyển phần đang bảo đảm nghĩa vụ Futures. Lượt lập kế hoạch và lượt chạy offline tiếp theo đều không đổi runtime hoặc tài khoản.

**Chọn SOL/USDT cho backtest đầu tiên**, long-only, một vị thế, taker vào/ra. Lý do là loại bỏ bước đổi USDT↔FDUSD và có thể mô phỏng chi phí taker minh bạch hơn maker queue. Không chọn cặp dựa trên kết quả PnL. SOL/FDUSD maker 0% giữ làm ý tưởng về sau, chưa mở thêm nhánh để tìm winner.

| Tham số backtest đề xuất | Giá trị ban đầu |
|---|---:|
| Vốn Spot |15 USDT |
| Phần Futures |Không thuộc account/ROI của backtest Spot |
| Vị thế/lệnh entry đang chờ |Tối đa 1 |
| Giá trị mua gồm dự phòng |Tối đa 12 USDT; đồng thời không vượt cash khả dụng trừ 3 USDT |
| Cash giữ lại |3 USDT dùng được; coin dust không tính thành cash |
| Planned loss/lệnh |`min(0,50 USDT, NAV hiện tại / 30)`, tính phí/slippage/rounding |
| Ngưỡng ngày |`min(1,50 USDT, 10% NAV đầu ngày Việt Nam)`; vượt thì nghỉ entry, giữ exit |
| Budget AI forward đề xuất |Tối đa 0,50 USD/14 ngày, gồm WAIT/VETO/lỗi, trừ vào economic PnL Spot |

50/50 là lựa chọn của người dùng; các cap 12/3/0,50/1,50 là thiết kế kỹ thuật đề xuất. Quyền trước đây chấp nhận mất toàn bộ 30 USDT không cho phép nhánh Spot dùng phần Futures. Ngân sách kinh tế tối đa của nhánh Spot bị giới hạn bởi phần vốn được phân bổ; phí AI không được nằm ngoài kiểm soát lỗ. Risk/stop là dự kiến, không bảo đảm giá khớp khi gap.

**Bằng chứng sizing:** ba GET lúc khoảng09:29 ICT xác nhận SOLUSDT đang TRADING, tick0,01, step/minQty0,001SOL, minNotional5USDT, phí maker/taker0,1%/phía; special/tax/buyer/seller0. Không áp BNB discount. Worksheet với entry109,72/stop108/target113 và slippage0,1% là **fixture**, không phải tín hiệu: mua0,109SOL, bán được0,108 sau phí/step, cấp vốn11,97147USDT; target netprofit chỉ0,20738, netR:R≈0,63. Gross R:R và lượng mua không thay thế kết quả sau phí.

## 2. Giả thuyết và quy tắc phải khóa trước xem PnL

Giả thuyết duy nhất: **breakout rồi retest trong bối cảnh SOL và BTC không giảm có lợi nhuận sau chi phí với vốn Spot nhỏ**. LLM sau này có thể cải thiện bằng cách loại setup xấu; đó là giả thuyết thứ hai cần kiểm chứng forward, không mặc định đúng.

Phiên đầu dùng một cấu hình, không sweep coin/window/ATR/TP/confidence. Đây là bản thiết kế trước khi tải lịch sử đầy đủ; engine/source/data hash được khóa trong registration trước khi chạy. Mọi sửa threshold sau khi xem PnL phải ghi thành trial mới và không dùng lại final holdout đã xem để tuyên bố xác nhận.

1. **Breakout:** nến15m đã đóng có `close > max(high của 20 nến trước)`. Loại chính nến breakout khỏi vùng tham chiếu; lưu mức L cố định và thời điểm breakout.
2. **Retest:** chờ nến đóng đầu tiên trong tối đa8 nến15m tiếp theo với `low <= L < close`. Nếu trước đó có nến đóng dưới/đúng L, hoặc hết8 nến, setup hết hiệu lực. Nến breakout không tự làm retest.
3. **Bối cảnh:** tại retestclose, SOL và BTC lastclosed1h close đều >= SMA20 của nến1h đã đóng. Volume/ATR/returns được ghi vào packet; không thêm ngưỡng volume sau khi nhìn kết quả. Thiếu warmup/context => skip.
4. **Dedup:** `setup_id=hash(version,pair,breakout_close_time,L)`; một lần đánh giá/entry attempt mỗi setup. Retest sau của cùng breakout không cho thử lại để tìm BUY. Nếu có nhiều setup cùng thời điểm, chọn breakout mới nhất bằng thứ tự cố định; consume/log các setup còn lại.
5. **Entry:** quyết định chỉ sau retestclose. Taker base dùng first1m open có timestamp >= retestclose+1µs+30s, cộng slippage bất lợi; stress delay120s. Không fill ở giá low của nến retest đã biết. Một vị thế; không pyramiding/DCA.
6. **Stop/target:** ATR14 Wilder trên closed15m. Stop = retestlow−0,5ATR14, round xuống tick. Target = giá tham chiếu lúc retestclose +2×(giá tham chiếu−stop), round xuống tick; khóa trước khi đọc giá fill tương lai. Không sửa target theo mức lãi USD mong muốn. Nếu entry thực phỏng <=stop hoặc >=target, hoặc target netprofit sau chi phí <=0 thì skip. Không bắt netR:R bằng2; báo ratio thực.
7. **Size:** Decimal floor step dưới cả cap cash/notional/risk; kiểm quantity bán được sau phí base và minimum tại stop. Không tăng quantity để qua minimum nếu vi phạm risk. Mức tham chiếu/tick/fee không rõ thì ghi không khả thi.
8. **Exit:** stop/target/time exit taker; maxhold24h từ fill đầu. Có gap qua stop thì giá open/firstavailable tệ hơn stop, cộng slippage. Nến1m chạm cả stop và target: stop trước nếu chưa có dữ liệu thứ tự tốt hơn. Provider offline không chặn stop/time exit.
9. **Ngày và vốn:** ngày theo Asia/Ho_Chi_Minh; loss/remaining risk tính từ economic NAV, giữ exposure qua rollover, không reset wallet/risk để có thêm lệnh. Entry mới không làm tổng lỗ ngày đã có + planned candidate risk vượt headroom. Kết thúc dataset đóng phần bán được theo giá bất lợi và báo dust còn lại.

Đây là một hypothesis để kiểm tra, chưa phải chiến lược đã có edge. Việc chọn target2R/rule8bars là thiết kế ban đầu, không yêu cầu Futures hoặc bằng chứng tối ưu. Nếu không có đủ lệnh hoặc net âm, giữ kết luận đó.

## 3. Dữ liệu và chia thời gian

Nguồn là [Binance Public Data chính thức](https://github.com/binance/binance-public-data): Spot SOLUSDT1m, SOLUSDT15m và BTCUSDT15m, dự kiến **01/10/2025–30/09/2026 UTC**. Features5m/15m/1h aggregate từ nến đủ và đã đóng; đối chiếu SOL15m archive để kiểm parser. Không thay nến perpetual cho Spot dù ticker giống nhau.

**Ảnh chụp lúc lập kế hoạch:** đã kiểm URL tháng09/2026: SOLUSDT1m ZIP khoảng1,79MB, 15m khoảng138KB, BTC15m khoảng157KB; rangeGET/CHECKSUM trả thành công. Khi đó chưa tải archive đầy đủ, chưa kiểm hash hoặc coverage, và chưa xác minh các tháng còn lại. Stage dữ liệu phải xác minh tất cả file trước khi gọi dataset complete; kết quả hoàn thành nằm ở mục 9.

| Thời gian UTC | Vai trò |
|---|---|
|01/10/2025–31/03/2026 |Development/QA/warmup; kiểm engine, không dùng làm bằng chứng xác nhận |
|01/04/2026–31/08/2026 |5 fold chronological, config cố định; báo riêng từng tháng và ledger nối tiếp |
|01/09/2026–30/09/2026 |Final holdout chỉ mở sau khi khóa config và kiểm tra kỹ thuật |

Ledger OOS chạy liên tục tháng04→09, bắt đầu15USDT một lần; không reset mỗi tháng. Snapshot đầu tháng09 lấy từ ledger tháng08, không bơm thêm vốn. Báo thêm finalmonth standalone15USDT dưới cùng config để phân biệt lỗi chiến lược với account đã cạn, nhưng kết quả này không thay stitched portfolio. Feature warmup chỉ quá khứ; fills/trade labels development kết thúc trước boundary. Không dùng outcome sau boundary để sửa rule; mô hình giữ tối đa24h phải ghi rõ xử lý vị thế qua tháng, không xóa chúng.

Importer ghi URL, SHA256, CHECKSUM, bytes, downloaded_at, sourceunit, parserversion, market/pair và khoảng thời gian. Archive Spot từ01/01/2025 dùng **microsecond**; REST mặc định millisecond. Normalize đơn vị rõ ràng về UTC integer, không đoán chia1000 tùy data. Archive có thể revised; pin phiên bản, không âm thầm thay checksum. Kiểm duplicate/gap/OHLC/volume/alignment; dữ liệu thiếu không forward-fill để tạo trade. [Binance dataset và timestamp notes](https://github.com/binance/binance-public-data).

Phí/filter lịch sử chưa đủ provenance: bài test đầu là **replay giá lịch sử dưới giả định phí/filter đã ghi**, không phải PnL lịch sử thật của tài khoản. Currentmin5/currentstep/tick làm một scenario; thêm scenario minimum10USDT để đánh giá độ nhạy. Nếu historical referencePrice/filter không tái hiện được, ghi điều kiện và cần forward verification. [Binance filters](https://github.com/binance/binance-spot-api-docs/blob/master/filters.md).

## 4. Mô phỏng execution, phí và ledger

| Scenario đã đề xuất | Trading fee | Slippage bất lợi mỗi phía | Delay entry |
|---|---|---|---|
|Base |0,1% buy +0,1% sell |0,1% |30s, rồi lấy1mopen kế tiếp |
|Stress |0,1% buy +0,1% sell |0,3% |120s, rồi lấy1mopen kế tiếp |

Slippage là giả định tổng spread/impact để khảo sát, không phải số đã đo trong quá khứ. Roundtrip base khoảng0,4%, stress0,8%, trước gap/dust/AI. Venue fee không miễn quantity loss do basecommission. Không coi fee maker0 hoặc candle-touch là fill; trades/aggTrades cũng không khôi phục queueahead.

Mua trừ full USDT cost, cộng SOL net; bán chỉ coin thực có, cộng USDT net. Giữ cashavailable/reserved và coinavailable/reserved riêng. Commission theo từng asset; BNB không có thì không giả discount. Carry SOL dust qua các vòng, cộng vào inventory khi có thể bán cùng quantity mới; không mất dấu hoặc tự biến thành USDT. Báo NAV theo executable/liquidationvalue (dust chưa bán được định giá0 bảo thủ) và bookvalue riêng, để thấy phần chênh. [Binance commission mechanics](https://github.com/binance/binance-spot-api-docs/blob/master/faqs/commission_faq.md).

Entry hợp lệ không bảo đảm exit hợp lệ. Mọi actualpartial sau fee phải được kiểm lại; thiếu quantity/notional thì tồn tại inventory mắc kẹt, không giả SELL thành công. Scenariopartial50% và scenariofee/rounding phải ghi cả trạng thái không thể exit. Nếu không có lịch sử book, full-fill taker là approximation cần gắn nhãn; kiểm thêm volume/partial sensitivity, không gọi execution là exact.

Benchmark cùng vốn/kỳ/cost: **giữ15USDT**, **buy-and-hold SOL** đã trừ fee/closecost/dust, và **rules-only**. Earn chỉ là bảng độ nhạy APR, không áp APR hiện tại lên quá khứ để giả reward đã nhận. Futures không nằm trong benchmarkNAV Spot.

`economic_net = Spot_NAV_end − Spot_NAV_start − external_deposits + external_withdrawals − AI_paid_cost − incremental_infra_cost`.

Fees đã nằm trong cash/inventory/NAV không trừ lần thứ hai. Chuyển nội bộ khi phân bổ vốn là funding allocation, không phải lợi nhuận. Report incremental cost và phần phân bổ VPS đầy đủ riêng; không cộng Futuresincome vào Spotreturn. Không annualize vài trade thành lời hứa lãi ngày.

## 5. LLM được kiểm chứng thế nào

**Stage lịch sử chạy rules-only, không gọi model trả phí.** Điều này kiểm giả thuyết entry/exit trước và giảm nguy cơ LLM biết diễn biến sau mốc lịch sử. Nghiên cứu gốc chỉ ra bias khi training/backtest overlap; giấu tên/ngày không bảo đảm loại bỏ bias cho model này. [Glasserman và Lin](https://arxiv.org/abs/2309.17322).

Sau khi historical gate đạt điều kiện paper, chạy **14 ngày prospective paper** với hai account15USDT độc lập: rules-only và rules+LLM. Cùng candidate generator, features, risk/fill/fees/entry expiry; khác vị thế/cash sau veto được phản ánh đầy đủ. So wholeportfolio, không chỉ chấm hindsight các lệnh model thích. Rules-only giữ fullstream; report thêm subset first4setup/ngày để tách ảnh hưởng AIbudgetcap khỏi lựa chọn model. Không lấy subset đẹp hơn làm kết quả chính.

LLM chỉ gọi khi branch có candidate/risk/exit hợp lệ; max4setup mới/ngày, một call/setup, prompt/model khóa. Lưu request/response/evidence/cost/latency, cả WAIT/VETO/lỗi và diễn biến của candidate bị bỏ. BUY cần plan qua engine; confidence không tăng size. Timeout/schemaerror/stalepacket → WAIT do hệ thống, phải tách khỏi AI chủ động chọn WAIT.

Đã có probe trước trả429, cost unknown, chưa có AIdecision. Cần reconcile receipt/provider trước paid stage; không coi429 là miễn phí hay kết quả model. Price caps và usage receipts theo [OpenRouter provider routing](https://openrouter.ai/docs/guides/routing/provider-selection), [usage accounting](https://openrouter.ai/docs/cookbook/administration/usage-accounting). API Spot trading tắt **không cản historical backtest/public paper**, chỉ là prerequisite nếu triển khai tiền thật về sau.

14 ngày paper chủ yếu đo integration/fill/cost và AI selection prospective; ít lệnh => chưa chứng minh lợi thế. Không tự gia hạn hoặc thay model/prompt để tìm kết quả dương.

## 6. Output và quyết định pass/fail

Report cần equitycurve15USDT, netUSDT/% theo tháng, winrate, averagewin/loss, expectancy, profitfactor, maxdrawdownUSDT/%, sốsetup độc lập/filled/partial/khôngkhớp, tỷ lệ skip/veto, giờ có vị thế, chuỗi thua, ngày không lệnh, gap/tailcost, dust và chi phí AI. Ghi theo regime đã định nghĩa từpastfeatures và theo tháng; không dùng tương lai để gắn nhãn “lúc tự tin”.

Các tiêu chí dưới đây là **gate nghiên cứu đề xuất**, không quy chuẩn sàn hoặc bảo đảm tương lai:

- Accounting/time/market correctness phải pass; mutation broker không tồn tại trong runner.
- OOS stitched base neteconomic>0 và PF>=1,2; stress neteconomic>=0, gồm cost assumptions đã khóa. Historicalrules không có actualAIcost; báo thêm sensitivity0,10/0,25/0,50USD, không giả đó là hóa đơn.
- Finalmonth base/stress không âm; OOSmaxdrawdown<=3USDT (20%15USDT), ghi nguyên nhân nếu vượt. Currentfilter scenario không thay proofhistorical; min10/partialstress phải được báo, sự phụ thuộc giả định làm hạ kết luận.
- Tối thiểu30 closedOOS setups độc lập để xem xét bước paper; sample count không tự là statisticalproof. Report blockbootstrap CI theo ngày/tuần, concentration và bỏ3lệnh lời lớn nhất. Ít mẫu/CI rộng/phụ thuộc vài event => chưa đủ bằng chứng; không tuyên bố ROI bền vững.
- **PASS_PAPER_ONLY:** điều kiện kỹ thuật/kết quả nêu trên đạt, đủ để làm forwardpaper có giới hạn. **FAIL:** giả thuyết không sống qua fees/cost/risk, không cố sửa vô hạn. **INCONCLUSIVE:** thiếu dữ liệu/fills/cost/độ tin cậy; ghi chính xác thiếu gì, không đổi thành pass.

LLM chỉ được gọi cải thiện khi pairedforwardportfolio cho thấy economic benefit sau mọi callcost và không làm rủi ro tệ hơn; vài lệnh/14ngày không đủ kết luận thắng bền vững. Backtest thuận lợi chỉ mở bước paper, chưa chuyển tiền hoặc đặt lệnh thật.

## 7. Implement cụ thể và giới hạn run

| Work package | File/đầu ra đề xuất | Acceptance |
|---|---|---|
|W0: khóa protocol |`spot-half-capital-backtest-protocol.json`, registration/sourcehash trước run |Chỉ1config, đúng15USDT; chưa có PnL |
|W1: dataset |`backend/src/spot/backtest/dataset.ts`, manifest + archivechecksum |Đủ cả12tháng, rõSpot/unit/gaps; tách cacheFutures |
|W2: sharedpurecore |`backend/src/spot/core/features.ts`, `candidate.ts`, `risk.ts` |Một logic cho replay/paper sau này; cash/risk/exitDecimal không importworker |
|W3: Spotaccount/execution |`backend/src/spot/backtest/spot-account.ts`, `execution-adapter.ts` |Fullcashpurchase/inventory/fee/dust/partial/stopgap đúng |
|W4: runner/report |`runner.ts`, `reports.ts`, `backend/scripts/run-spot-backtest.ts` |Oneprocess, replayclock, immutableevents và base/stress/holdout report |
|W5: AIpaper sau gate |`llm-review-contract.ts`, paper runner/costjournal |Timestamp thật, onecall/setup,2portfolio, providerfailure rõ |

Repo có runner/ledger Futures nhưng không phù hợp cashSpot. Có thể tái dùng pureclosedcandles/indicator equations; không đổi ticker BTC thành SOL rồi coi xong. DBcache thiếu market/pair/source; kiểm tra các keySOL/SOLFDUSD/FDUSD cho0rows và chưa có datasetSpot đủ dài được kiểm chứng. Dùng manifest riêng, không trộn nếnSpot vào keycoin của Futures.

Tests có ý nghĩa: nofutureclosedbar/context; breakout/retest khác nến; no duplicate setup; fullcashdebit/feeasset; oversell/negativecash impossible; entrypass nhưng stopexit fail; dustcarry/partialcancel/idempotentfill; minimum5/10; stop+TP cùngbar và gap; dayrolloveropenrisk; inputcapital15 không dùng Futureswallet; deterministicreplay/ledgerreconcile; budgetAIunknown/timeout giữ noentry.

Ước tính effort **2–3 ngày** cho dataset/core/engine/tests/runner và report đầu; không phải thời gian đã chạy hoặc cam kết kết quả có lãi. Chạy QA một đoạn development nhỏ trước, sau đó một fullbase và một fullstress; không parallelgrid. VPS2CPU/~1GB: streamingCSV,1process nice10, peakRAM mục tiêu<=256MiB, diskcap2GB, fullrules-stage wallcap2giờ saudataQA. Đo thực tế; vượtcap thì ghi incomplete và tối ưu kỹ thuật có nguyên nhân, không lặp strategy.

## 8. Trạng thái lúc khóa thiết kế, trước lượt `continue`

**Đã hoàn thành nghiên cứu và kế hoạch:** kiểm SOLUSDT bằng3GET, kiểm nhỏ URL/CHECKSUM archives, rà engine/cache hiện có, tính fixture vốn15 và đối chiếu tài liệu chính thức. Đã tạo protocol cụ thể bên dưới để implementation có đầu vào reviewable. Chưa tải đầy đủ lịch sử/chạy backtest, nên **chưa có ROI/winrate hoặc kết luận Spot có lời**.

Không có chuyển tiền, order, gọi AI trả phí, freezeFutures hoặc đổi runtime trong lượt này. Các script30/25 và kết quảprobe trước là bằng chứng lịch sử, không dùng làm policy15/12 mới. Work tiếp theo theo thứ tựW1→W4; W5 chỉ sau historicalgate. Không tạo goal/automation mới khi người dùng chỉ yêu cầu nghiên cứu/kế hoạch.

Memos/bằng chứng: `/home/ubuntu/binance-income-research-2026-10-10/{spot-backtest-data-research.md,spot-half-capital-research.md,spot-backtest-code-audit.md,historical-data-availability-sample.json,solusdt-backtest-feasibility.json}`. Ba memo có những threshold gợi ý khác nhau; **cấu hình trong kế hoạch/protocol này là lựa chọn phiên đầu**, không chạy cả các gợi ý để lấy winner.

## 9. Implementation và kết quả đã thực hiện

Các đường dẫn TypeScript ở W1–W4 là đề xuất lúc thiết kế. Bản thực hiện dùng một package Python standard-library riêng tại [backend/spot_backtest](/home/ubuntu/chuyen-gia-crypto/backend/spot_backtest/README.md), phù hợp streaming/Decimal và tài nguyên VPS; không import bootstrap, private API, DB hoặc worker production. `features.py` là core causal chung cho replay và paper tương lai; `account.py` quản lý cash/coin/phí/dust; `runner.py` khớp lệnh theo replay clock. Không thay đổi hypothesis hoặc threshold để chuyển ngôn ngữ. Paper phải dùng cùng core hoặc kiểm chứng một port tương đương trước khi vận hành.

Đã tải 36 monthly ZIP/CHECKSUM Spot chính thức: 525.600 nến SOL1m, 35.040 SOL15m và 35.040 BTC15m. Tất cả gap/duplicate/OHLC/volume checks đạt; toàn bộ SOL1m tổng hợp sang SOL15m khớp chính xác OHLC, volume/quotevolume và số trade. Archive và manifest được pin hash. 46 tests dataset/account/chronology đạt trước registration; source snapshot và SHA đã khóa trước OOS. Audit hậu kiểm độc lập xác minh đủ 8 case, ledger Decimal và mọi source/data pin, không lỗi.

| Main ledger 01/04–30/09 UTC | Base | Stress |
|---|---:|---:|
| Vốn đầu, không reset tháng |15 USDT |15 USDT |
| NAV bán được cuối |10,16192711 |9,49618016 |
| Net sau trading fee/slippage/dust |−4,83807289 |−5,50381984 |
| Closed setups |123 |78 |
| Profit factor |0,3469 |0,1909 |
| Max drawdown USDT |4,94676456 |5,50381984 |

Main base âm cả sáu tháng; stress và hai run tháng09 standalone cũng âm. Minimum10 base/stress lần lượt −1,97114325/−1,93950565 USDT, chỉ 26/15 closed setups. Partial50 cuối kỳ còn inventory không thể thoát theo minimum; không giả SELL hoặc xóa coin. Báo cáo chi tiết giữ book NAV riêng với executable NAV. Buy-and-hold benchmark base cùng cap12+cash3 và cost lời 4,864806 USDT trong cả kỳ; đây không phải lời ngày hoặc khuyến nghị mua ở giá hiện tại.

Partial50 base giữ 0,032033 SOL: cash/NAV bán được11,42256354 nhưng book NAV15,20630150. Partial50 stress giữ0,033033 SOL: cash/NAV bán được9,47535430, book NAV13,37721226. Inventory vẫn là tài sản; chênh lệch book/executable không phải coin bị xóa hoặc toàn bộ lỗ đã thực hiện. Hai nhánh mắc lại vị thế và không đạt khả năng thực thi theo protocol, dù book NAV base cao hơn vốn đầu.

Full stage hoàn tất 8 case trong 474,85 giây, peak process RAM 31.228 KiB (30,50 MiB); dataset khoảng24,2 MiB. Không có historical LLM call, chuyển tiền, order, Telegram, dịch vụ mới hoặc thay đổi Futures. Phí/filter lịch sử và reference-price service không tái dựng được: kết quả là simulation dưới scenario phí/filter/slippage và prior5m volume-weighted reference proxy đã ghi, không phải lịch sử khớp thật. Chi phí VPS incremental/full allocation chưa biết, báo riêng; trading net đã âm trước các chi phí ngoài này.

**Quyết định:** v1 không qua historical gate, không triển khai live hoặc tự khởi động paid AI paper theo protocol này. Đây là thất bại của giả thuyết entry/exit v1, chưa kiểm chứng lợi thế chọn lệnh của LLM hoặc mọi mô hình Spot. Không sweep/rerun v1 để tìm kết quả dương; tháng09 đã được xem nên không còn là holdout mới cho một hypothesis khác. Các câu `NOT_EXECUTED` trong protocol là trạng thái thiết kế được giữ bất biến, không phải trạng thái thực hiện hiện nay. `continue` sau này phải xuất phát từ kết quả FAIL này, không khởi động lại goal Futures hoặc nguyên trạng v1.

## 10. Lượt tìm tiếp đã hoàn tất: v2 và v3

Sau yêu cầu tìm phương án khác, đã nghiên cứu momentum và mean reversion từ nguồn sơ cấp rồi khóa hai cơ chế4h trước khi đọc PnL. [Kế hoạch v2](2026-10-10-spot-new-mechanisms.md) chạy8case nhưng0fills: formalFAIL về khả thi entry; chưa đo được alpha. Diagnostic causal chỉ dùng thông tin sẵn có tại entry xác minh admission quá chặt. Một [revision v3](2026-10-10-spot-aggressive-mechanisms.md) riêng đổi riskcap thànhmin(1.50,NAV/10,dailyheadroom), bỏ hardhypotheticalRR1.5 và giữ cost/minimum/fee/cash/dailyguards. Không sửa kết quả hay core v1/v2.

V3 đã hoàn tất4case lúc20:02:59 ICT,10/10/2026; mỗi ví15USDT liên tục01/2024–09/2025 (21tháng/639ngày): trend netbase−0,37757156/stress−1,50652221USDT,34/26closed; reversion+0,36083866/−0,61559243,7/2closed. **Cả haiFAIL** dưới gate khóa trước mainPnL. Reversion không có giao dịch năm2025 trong kỳ; confirmation0 không chứng minh sinh lời.55tests trước registration, replay537,247giây, peakRAM40.216KiB. Net đã gồm phí/trượt giá mô phỏng, VPSunknown; historicalfee/filter/reference vẫn là giả định được báo riêng. V3 chưa chạy financialsensitivityminimum10/partial50.

[Báo cáo đầy đủ](/home/ubuntu/binance-income-research-2026-10-10/backtest-run-v3/report.md), [verdict](/home/ubuntu/binance-income-research-2026-10-10/backtest-run-v3/verdict.json) và [kế hoạch triển khai có điều kiện](/home/ubuntu/binance-income-research-2026-10-10/new-model-conditional-implementation-plan.md) là nguồn bàn giao mới nhất. Chưa tìm được ứng viên đủ bằng chứng cho thu nhập hàng ngày, không khởi động paidAIpaper/live. Giữ kết quả để loại hai rule này trong scenario đã thử; nghiên cứu sau cần cơ chế hoặc nguyên nhân mới được xác minh và registration riêng, không mở sweep sauFAIL hoặc đổi knownhistory thành holdout sạch. Không thay đổi phầnFutures, gọi provider/privateAPI, gửi Telegram, chuyển vốn hoặc đặt lệnh trong các lượt backtest mới.
