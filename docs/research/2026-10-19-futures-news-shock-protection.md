> **Kết quả mới nhất 20/10:** Đã hoàn tất sáu ca và kiểm toán độc lập6/6PASS sau khi user cho phép tạm dừng worker lúc ví flat. CảH1/H2 chưa đạt tăngROI ở cảbase/stress; worker cũ đã khôi phục active, giữcap12. Xem [báo cáo kết quả](2026-10-20-futures-news-shock-backtest-results.md). Các trạng thái chưa cóPnL/chưahoàntất bên dưới là lịch sử.

# Bảo vệ bot trước tin lớn, pump/dump và bán tháo — 19/10/2026

## Cập nhật backtest ứng viên — 19/10/2026

Đã triển khai ứng viên offline cho hai giả thuyết đã nêu ở dưới: H1 thoát rổ trước lịch tin; H2 thêm bộ lọc pump/dump trên nến mark 1 phút. Cùng so sánh baseline, H1 và H2 ở hai mức chi phí, dùng một ví31,47744546u, 128 ngày liên tục và giới hạn12u/ngày. Kiểm tra chức năng đạt; ngưỡng/cửa sổ/chi phí đã đăng ký trước PnL trong [gói backtest](../audits/futures-quick-win/news-shock-backtest-20261019/README.md).

Lượt đầu chạy sáu engine bị watchdog dừng ở ít nhất4.320/184.320 phút. Theo yêu cầu chạy tuần tự, hai lượt riêng H0 cơ sở cũng bị dừng: lượt hai ở27.360 phút với ngưỡng watchdog7giây; lượt ba ở73.440 phút với watchdog12giây và126 lần tạm dừng. Không lượt nào tạo PnL hoàn chỉnh, nên chưa đánh giá được hiệu quả H1/H2 hoặc baseline. Khoảng13giây sau khi lượt ba dừng, worker tự recovery qua incident giám sát, có thao tác đóng/mở live và trở lại active lúc07:36:58UTC. Khoảng13phút sau đó, khi không còn replay, incident thứ hai xảy ra sau lỗi Binance account GET và gap giám sát; root cause chưa xác định. Worker tự khóa rủi ro/flat rồi tự recovery, trở lại `running/active` với bốn vị thế, delta0, không history/intents pending lúc07:49:22UTC; mẫu đến07:51:27 vẫn active, Telegram pending/failed0. Incident thứ ba được ghi lúc07:52:55UTC khi không còn replay; worker resumed lúc07:55:31 và snapshot07:58:36 lại active/đối soát đủ. Nguyên nhân các incident sau lượt chạy chưa xác định. Runner không gọi sàn hay gửi lệnh, nhưng tài nguyên cùng VPS không an toàn. Dừng các ca còn lại trên máy này; cần máy tính riêng. Xem [lượt đầu](../audits/futures-quick-win/news-shock-backtest-20261019/attempt-1-status.json), [lượt hai](../audits/futures-quick-win/news-shock-backtest-20261019/attempt-2-status.json) và [lượt ba](../audits/futures-quick-win/news-shock-backtest-20261019/attempt-3-status.json).

Kết luận nghiên cứu: **nên bổ sung lệnh bảo vệ nằm trên sàn và một lớp điều khiển rủi ro thị trường, gồm lịch tin, nhận diện sốc và điều kiện vào lại**. Bot hiện chỉ có bảo vệ theo tiền, đối soát và gián đoạn giám sát; chưa có các lớp này. Chặn lệnh mới quanh giờ tin chưa bảo vệ được rổ đang giữ qua ngày.

Trạng thái: **nghiên cứu và thiết kế ứng viên; chưa kiểm chứng lợi nhuận, chưa triển khai quy tắc mới**. Vốn đầu31,47744546u, trần12u/ngày ICT, dự phòng6,1u/ngưỡng sớm−5,9u và guard15giây vẫn là cấu hình hiện hành. Các cửa sổ, ngưỡng sốc, hành vi đóng trước tin và thời gian vào lại dưới đây là đề xuất để chốt và kiểm chứng, không phải rule người dùng đã duyệt.

## 1. Bot hiện bảo vệ được gì, còn thiếu gì

| Thành phần | Hiện trạng và hệ quả |
|---|---|
| Ngân sách toàn ví | Đánh giá PnL gồm lệnh mở, phí/funding, dự phòng đóng và margin; có ngưỡng sớm−5,9u và cap12u. Đây là điều khiển phần mềm, không phải bảo đảm giá khớp. |
| Giám sát | Tick mục tiêu2giây, giá WebSocket cũ quá5giây không được dùng; mất quan sát quá15giây khi giữ vị thế thì bảo vệ. Chỉ hành động được khi tiến trình/quan sát hoạt động trở lại. |
| Đóng vị thế | MARKET giảm vị thế, đối soát giữa các bước; UNKNOWN chặn gửi tiếp. Mạng/sàn/giá thiếu có thể làm chậm đường đóng. |
| Chiến lược | Constant long B5, sizing từ90 lợi suất ngày; không nhận diện thay đổi trong vài giây/phút. Gross cap8×equity, leverage cài trên sàn10×. |
| Lịch và sốc thị trường | Chưa có lịch FOMC/CPI/NFP/PCE, ngưỡng biến động nhanh, ngưỡng spread tối đa hoặc lịch sử giá ngắn trong đường live. |
| SL trên sàn | Chưa có. Hiện tất cả algo orders đều bị coi là lệnh ngoài quyền của bot; không thể chỉ đặt thêm STOP rồi cho rằng tích hợp đã xong. |
| Tự vào lại | Sau lỗi kỹ thuật,30giây khỏe và đủ gate tiền/nguồn có thể vào lại long; chưa kiểm tra thị trường đã hết sốc hay chưa. |

Bằng chứng mã: [cấu hình](</home/ubuntu/chuyen-gia-crypto/backend/src/portfolio/live-service.ts:18>), [bảo vệ tiền/gap](</home/ubuntu/chuyen-gia-crypto/backend/src/portfolio/live-service.ts:433>), [đóng rổ](</home/ubuntu/chuyen-gia-crypto/backend/src/portfolio/live-service.ts:749>), [nguồn long](</home/ubuntu/chuyen-gia-crypto/backend/src/portfolio/source-constant-direction.ts:93>), [algo ownership](</home/ubuntu/chuyen-gia-crypto/backend/src/portfolio/live-service.ts:269>), [tự phục hồi](</home/ubuntu/chuyen-gia-crypto/backend/src/portfolio/live-service.ts:636>).

Trong lượt chỉ đọc này, snapshot09:53:41 ICT cho thấy bot đã đóng4vịthế vì `live_monitoring_gap`, flat/đối soát/delta0, PnL ngày+1,84226034u/breach0; không phải chạm12u. Sau đó cơ chế có sẵn tự phục hồi: snapshot kế tiếp active/4vịthế/103khớp/88intents. Đây là hoạt động tự động của worker đang chạy, không có lệnh hay restart do nghiên cứu. Nó minh họa việc lớp bảo vệ phải hoạt động cả khi VPS có vấn đề và phải kiểm soát đường vào lại; không gán incident này cho tin tức.

Ví dụ quy mô, **không phải exposure hiện tại hoặc backtest**: dùng hết gross8× với31,47744546u tương ứng251,81956368u notional. Cả rổ cùng biến động bất lợi1%/3%/5% gây hao hụt xấp xỉ2,5182/7,5546/12,5910u trước phí và trượt giá. Không nhân thêm leverage10 lần nữa. Vì vậy chờ phát hiện đúng−12u rồi mới bắt đầu gửi đóng không tạo trần lỗ chắc chắn.

## 2. Lịch tin: biết trước thời điểm, không đoán hướng giá

Fed công bố cả quyết định và họp báo. Lịch hiện tại ghi14:00 và14:30 ngày28/10/2026 theo Eastern Time; tương ứng **01:00 và01:30 ngày29/10 Việt Nam**. Không mở lại ngay sau quyết định mà bỏ qua họp báo. [Lịch Fed tháng10](https://www.federalreserve.gov/newsevents/2026-october.htm).

| Mốc đã kiểm tra ngày19/10 | Giờ Việt Nam theo lịch đang công bố | Nguồn chính thức |
|---|---|---|
| FOMC quyết định / họp báo | 29/10/2026,01:00 /01:30 | [Fed](https://www.federalreserve.gov/newsevents/2026-october.htm) |
| GDP và Personal Income and Outlays, có PCE | 29/10/2026,19:30 | [BEA JSON](https://apps.bea.gov/API/signup/release_dates.json) |
| Employment Situation, có NFP | 06/11/2026,20:30 | [BLS](https://www.bls.gov/schedule/news_release/empsit.htm) |
| CPI | 10/11/2026,20:30 | [BLS](https://www.bls.gov/schedule/news_release/cpi.htm) |

Đây là ví dụ đã đối chiếu, không phải lịch bot đã kết nối hoặc lịch bất biến. Lưu UTC, hiển thị ICT; dùng `America/New_York` khi nguồn ghi ET. DST Mỹ kết thúc01/11/2026 nên cùng08:30ET chuyển từ19:30 sang20:30ICT. [NIST](https://www.nist.gov/pml/time-and-frequency-division/popular-links/daylight-saving-time-dst).

BEA có [ICS chính thức](https://www.bea.gov/news/schedule/ics/online-calendar-subscription.ics) và JSON đã mở được. BLS công bố [địa chỉ ICS](https://www.bls.gov/schedule/news_release/bls.ics) trên lịch chính thức, nhưng lượt nghiên cứu chưa tải thành công payload qua công cụ duyệt; khả năng tải/parse vận hành còn UNKNOWN. Không coi feed BLS đã nghiệm thu.

Lịch thực sự có thể đổi hoặc hủy: [BLS đã sửa ngày CPI/NFP](https://www.bls.gov/bls/2025-lapse-revised-release-dates.htm); [BEA từng dời/gộp kỳ và đổi giờ sang10:00](https://www.bea.gov/news/blog/2026-01-07/economic-release-schedule-updates-gdp-personal-income-and-outlays). Vì vậy cần lưu nguồn, thời gian tải, UID/phiên bản, lịch cũ và mới; lịch stale/mâu thuẫn không đồng nghĩa không có tin. Giữ bản hợp lệ gần nhất, chặn tăng rủi ro khi độ phủ lịch không xác định; vẫn quản lý và cho phép giảm vị thế đã xác thực. Không xóa sự kiện chỉ vì một lần feed thiếu nó. Cửa sổ tin tồn tại qua mốc đổi ngày ICT và các cửa sổ trùng phải gộp.

Bằng chứng tác động không đồng nhất. [Nghiên cứu gốc về FOMC/DeFi](https://arxiv.org/abs/2302.10252) tìm thấy tác động biến động quanh statement trong mẫu; [NY Fed2023](https://www.newyorkfed.org/research/staff_reports/sr1052) lại không thấy phản ứng macro có ý nghĩa thống kê của BTC trong mẫu intraday của họ. Không suy “ra tin là dump” hoặc dùng lịch làm tín hiệu mua/bán. Cần đo mức lỗ đuôi, trượt giá và chi phí của chính bot.

**Ứng viên lịch để kiểm chứng:** FOMC chặn tăng vị thế từ quyết định−30phút đến quyết định+90phút, bao trùm họp báo; CPI/NFP/PCE/GDP từ−15 đến+30phút. Giữ phòng thủ lâu hơn nếu thị trường còn bất thường. Đây là điểm xuất phát đề xuất, chưa có bằng chứng các con số tối ưu.

Với rổ đang giữ24/24, cần kiểm chứng chính sách **thoát rổ trước cửa sổ tin lớn**, thay vì chỉ chặn mở mới. Đóng trước tin tốn phí và có thể bỏ lỡ nhịp tăng; ưu tiên so sánh đúng một chính sách được chốt trước kết quả. Không tự thay bằng giảm50%, đổi cửa sổ liên tục hoặc chọn phương án sau khi thấy PnL.

## 3. Tin bất ngờ, pump/dump và bán tháo: đo thị trường đang xảy ra

Lịch không bao phủ tin chiến sự, hack, quyết định khẩn, lỗi sàn hoặc thao túng. Tên “panic” chỉ mô tả trạng thái rủi ro; dữ liệu giá không chứng minh được động cơ người bán hoặc ý đồ thao túng.

Đề xuất bộ đo nhẹ trên B5, tái sử dụng mark/book WebSocket: biến động10giây/60giây/5phút; biến động so với nền trước đó; chênh bid/ask; lệch mark với giá giữa bid/ask; tuổi/mất mẫu. Dùng thời điểm sự kiện và thời điểm nhận; không lấy quote lỗi/lặp/cũ làm bằng chứng thị trường bình tĩnh. Bộ nhớ vòng có giới hạn, không tải tin tức hoặc gọi AI trong tick2giây.

| Tình huống | Hành vi ứng viên |
|---|---|
| Tăng hoặc giảm quá nhanh, spread nở | Chặn mở/tăng vị thế ngay; giữ quyền giảm/đóng. Chưa tự đóng chỉ vì biến động đang thuận chiều. |
| Sốc đi ngược vị thế, lan nhiều coin, nguy cơ danh mục tăng | Giảm hoặc đóng rổ theo mức rủi ro danh mục và dữ liệu đã xác thực; không đợi cạn ngân sách ngày. |
| Giá/nguồn không đáng tin | Chặn tăng rủi ro; giữ cơ chế dữ liệu/đối soát và SL sàn. Không tự bịa giá hoặc báo đã đóng khi chưa có fill. |
| Sốc đã qua | Chờ thị trường yên liên tục, hoàn tất mọi fill/lệnh/tiền và kiểm lại ngân sách rồi mới cấp quyền vào lại. |

Đề xuất **khóa thiết kế đầu vào trước khi xem kết quả**, rồi mới chọn ngưỡng số: đo phân phối return/spread B5, độ trễ và khoảng mất mẫu. Ngưỡng BTC và alt không mặc định giống nhau. Một cú bật giá thuận chiều long có thể chỉ khóa tăng vị thế; cú dump nguy hiểm với long có thể yêu cầu thoát. Nếu sau này có short thì áp dụng đối xứng. Không mở hedge/short tự động hoặc mua bình quân xuống để “bảo vệ”.

Tín hiệu bổ sung có thể dùng aggTrade và thanh lý. Binance cung cấp mark1s/3s, aggTrade100ms; nhưng `forceOrder` chỉ phát lệnh thanh lý mới nhất mỗi symbol trong1000ms, **không phải toàn bộ thanh lý**. Chỉ dùng hỗ trợ xác nhận sốc, không cộng payload rồi gọi là tổng bán tháo. [Binance market streams](https://developers.binance.com/en/docs/catalog/core-trading-derivatives-trading-usd-s-m-futures/api/ws-streams/market). Book/depth thông thường cũng không hiện toàn bộ RPI; chưa cần mở depth toàn thị trường trên VPS yếu. [Binance public streams](https://developers.binance.com/en/docs/catalog/core-trading-derivatives-trading-usd-s-m-futures/api/ws-streams/public).

Có mô hình tham khảo thực tế: Freqtrade có SpreadFilter, StoplossGuard và khóa sau chuỗi dừng lỗ. Học cách tách quyền vào lệnh khỏi quản lý vị thế, không sao chép ngưỡng mẫu của họ sang B5 hoặc khôi phục cooldown1giờ đã bị bỏ. Chính tài liệu lưu ý tham số không phù hợp mọi chiến lược. [Freqtrade protections](https://www.freqtrade.io/en/stable/plugins/#protections).

## 4. SL khẩn nằm trên sàn: ưu tiên về kiến trúc bảo vệ

Binance dùng `POST /fapi/v1/algoOrder` cho TP/SL. `STOP_MARKET` với `closePosition=true` bỏ quantity/reduceOnly; SELL đóng long, BUY đóng short. `workingType` mặc định CONTRACT_PRICE, phải chọn rõ nếu dùng MARK_PRICE. `priceProtect=true` có thể trì hoãn trigger khi mark/contract lệch quá ngưỡng; không mặc định coi bật nó là an toàn hơn. [API Algo Order](https://developers.binance.com/en/docs/catalog/core-trading-derivatives-trading-usd-s-m-futures/api/rest-api/trade#new-algo-order-trade).

Conditional orders đã chuyển sang Algo Service từ09/12/2025; hướng dẫn gửi STOP qua `/order` cũ không còn phù hợp. Theo changelog, reject chuyển sang `ALGO_UPDATE`; không dựa sự kiện deprecated `CONDITIONAL_ORDER_TRIGGER_REJECT`. [Binance changelog](https://developers.binance.com/en/docs/products/derivatives-trading-usds-futures/change-log).

Đây là thiết kế đề xuất: SL khẩn dùng giá đánh dấu làm một ứng viên trigger, mức dừng theo phần rủi ro còn lại và khoảng cách thanh lý; toàn bộ coin chia chung ngân sách. Không cấp12u cho từng coin hoặc dùng một phần trăm cố định từ entry mà bỏ qua lãi/lỗ đã có trong ngày. Sau làm tròn giá/lot, tổng tổn thất mô hình cộng phí/trượt giá dự phòng phải nằm trong headroom mà bộ bảo vệ hiện có cho phép. Nếu stop hợp lệ và yêu cầu sizing không thể cùng đạt thì chặn tăng vị thế hoặc giảm quy mô theo chính sách đã duyệt.

ACK không chứng minh vị thế đã đóng: `ALGO_UPDATE.TRIGGERED` là vào matching engine; `FINISHED` có thể filled hoặc canceled. Phải nối algoID→actual order→fills→vịthế còn lại. [Sự kiện Binance](https://developers.binance.com/en/docs/products/derivatives-trading-usds-futures/user-data-streams#event-algo-order-update). POST timeout/503UNKNOWN không được gửi lại mù; đối soát trước. [Binance General Info](https://developers.binance.com/en/docs/products/derivatives-trading-usds-futures/general-info#http-503-status-message-variants--handling).

Cần nghiệm thu vòng đời create/query/trigger/cancel/restart/partialfill; duy trì ownership theo tài khoản/policy/positiongeneration. Stop cũ không được sống sang rổ mới rồi đóng nhầm vị thế mới. Trong thay thế stop, phải xử lý reject/race và khoảng trống bảo vệ. Khi một SL đã khớp, bot cần giữ trạng thái phòng thủ để không mua bù ngay theo target long còn nguyên. Khôi phục chỉ sau đối soát và hết hiểm họa.

Lệnh phía sàn giảm phụ thuộc VPS nhưng vẫn chịu gap, thanh khoản, hạn chế sàn và trạng thái trigger. MARKET cũng có thể không khớp hết và phần dư bị hủy; cần kiểm tra vị thế còn lại. [Order update Binance](https://developers.binance.com/en/docs/products/derivatives-trading-usds-futures/user-data-streams#event-order-update), [Mã lỗi Binance](https://developers.binance.com/en/docs/products/derivatives-trading-usds-futures/error-code). Không cam kết cap12u tuyệt đối; cũng không coi SL limit là bảo đảm thoát trong crash. [Freqtrade về stop trên sàn](https://www.freqtrade.io/en/stable/stoploss/#stoploss_on_exchange-and-stoploss_on_exchange_limit_ratio).

## 5. Tích hợp phải bao phủ mọi đường vào lại

Thêm trạng thái phòng thủ thị trường bền vững riêng, không dùng chung latch lỗ ngày. Ví dụ `NORMAL → BLOCK_INCREASE → DEFENSIVE → WAIT_STABLE → NORMAL`; mức bảo vệ tiền luôn có quyền ưu tiên. `BLOCK_INCREASE` vẫn cho phép giảm/đóng vị thế đã xác thực. Một lệnh “rebalance” phải xét delta risk, không chỉ tên lệnh. Không xóa monetary stopReasons, reset anchor/cursor hoặc cấp lại12u khi hết tin.

Nguồn lịch/market-quality được cập nhật nền thành snapshot tách rời có version/event/observed/expiry; trạng thái UNKNOWN rõ ràng. Không web/LLM/REST lịch hoặc fsync telemetry trong vòng quan sát tiền. Giữ fsync sổ tiền có sẵn. Cơ chế này bổ sung cho [nghiên cứu ổn định giám sát](2026-10-19-futures-monitoring-stability-research.md), không thay thế việc sửa máy/vòng giám sát.

Chặn tăng vị thế tại cả ba đường: [daily projection](</home/ubuntu/chuyen-gia-crypto/backend/src/portfolio/live-service.ts:785>), [mỗi pending leg](</home/ubuntu/chuyen-gia-crypto/backend/src/portfolio/live-service.ts:828>) và [technical recovery](</home/ubuntu/chuyen-gia-crypto/backend/src/portfolio/live-service.ts:637>). Kiểm tra lại ngay trước POST sau mọi ghi bền vững/query, vì quá trình chuẩn bị có thể đi qua giờ bắt đầu cửa sổ tin. Không chặn reduce-only bằng cửa sổ tin, nhưng giữ kiểm tra sở hữu/UNKNOWN/đối soát.

Nguồn thường chỉ có cửa sổ60giây; hết cửa sổ tin không có nghĩa lệnh bị chặn trước đó sẽ tự chạy đúng. Cần kế hoạch trì hoãn có thời hạn và nguồn nhân quả hiện tại, đánh giá lại giá/khối lượng/rủi ro; không reset cursor để ép chạy lại. Khóa sốc/SL phải tồn tại qua restart/đổi ngày. Đề xuất ban đầu đợi10phút không tái sốc, trong đó tối thiểu2phút cuối có dữ liệu đầy đủ và chỉ số thị trường dưới ngưỡng phục hồi thấp hơn ngưỡng kích hoạt. Các thời lượng này chưa kiểm chứng, tách hoàn toàn khỏi30giây phục hồi kỹ thuật và120giây phục hồi thông báo Telegram hiện hành.

Telegram chỉ báo thay đổi có ý nghĩa: “Sắp có tin lãi suất lúc01:00; bot tạm ngừng mở lệnh”, “Đã đóng MUA ETH để bảo vệ; lãi/lỗ…”, “Thị trường đã ổn định; bot được phép giao dịch lại”. Thông báo đóng phải theo khớp/chi phí thật; hết cửa sổ thời gian chưa đủ để tuyên bố đã an toàn. Một tin cho một đợt, không gửi ticker hoặc cảnh báo lặp mỗi giây.

## 6. Lộ trình và điều kiện kiểm chứng

| Bước | Đầu ra cụ thể | Điều kiện hoàn tất |
|---|---|---|
| P0: chốt thiết kế | Quy tắc SL sàn, thoát trước tin, phạm vi tin, điều kiện vào lại; nguồn/clock/ownership | Người dùng duyệt thay đổi hành vi giao dịch; không suy quyền triển khai từ yêu cầu nghiên cứu. |
| P1: đo và quan sát | Calendar adapter có coverage; rolling metrics B5; quyết định phòng thủ chỉ ghi nhận, không đổi lệnh | Chứng minh lịch/giờ/đổi lịch đúng, tải nhẹ; ghi đầy đủ cả tín hiệu sai và lệnh có thể bị bỏ lỡ. Không cần đợi14ngày nếu đã có dữ liệu phù hợp để replay. |
| P2: kiểm chứng chức năng và tài chính | Broker stop lifecycle và hai đối chứng đăng ký trước | Fault injection đạt; đo lỗ đuôi/PnL/phí/cơ hội cùng ví31,47744546u/cap12; không dùng kết quả15u để chứng nhận. |
| P3: triển khai có gate | Shadow/paper theo cùng code, rồi bật đúng bản được duyệt | Sổ tiền/UNKNOWN/không mua bù sai/rollback và tài nguyên đạt; báo kết quả thật trước khi mở rộng. |

Tối đa hai giả thuyết trong đợt này: **H1 né lịch tin bằng một chính sách chốt trước**, **H2 thêm bộ chặn sốc và vào lại lên chính sách đã chốt**. Nền SL sàn vẫn chưa được kiểm chứng bằng lifecycle/fill; không gọi scaffold hay replay giả định đã khớp là thành công về rủi ro. Dùng cùng risk/account/execution production; không tạo simulator bỏ qua filters/partialfill/rate limits. Mọi so sánh có baseline/cùng chi phí/cùng vốn/cùng ngày; giữ cả kỳ âm. Trạng thái hiện tại: **đã đăng ký trước PnL, kiểm tra chức năng PASS, replay tài chính INCOMPLETE_SAFETY_ABORT, ROI UNKNOWN; không promote**. Chỉ tiếp tục trên máy tính toán tách biệt với worker live, không điều chỉnh ngưỡng/cost sau đăng ký.

Ma trận bắt buộc gồm lịch đổi/hủy/mất feed/DST/mốc ICT, gap giá và pump/dump hai chiều, spread mở, dữ liệu stale/lặp/future/mất mẫu, máy dừng trước trigger, fill xuất hiện muộn, trigger bị từ chối, market partialfill, stop bị hủy, cancel/recreate race, restart/đổi ngày,503UNKNOWN và stop cũ gặp rổ mới. Kiểm tra đóng xong không tự mua bù và lỗi kỹ thuật hồi phục không vượt khóa thị trường.

Đo thời gian từ phát hiện→lệnh→khớp, phần vị thế chưa được SL bảo vệ, lỗ đuôi/ngày xấu nhất/drawdown/tần suất vượt12u, phí và số lần đóng–mở lại, net PnL toàn kỳ/mọi ngày, thời gian bị khóa và PnL bỏ lỡ, tài nguyên/tickgap. Ngưỡng sốc phải khóa trước vòng đánh giá, không sweep đến khi tìm được số đẹp. Replay5phút/OHLC1phút không xác nhận thứ tự trigger/khớp trong giây; thiếu dữ liệu thì ghi UNKNOWN, không giả fill đúng giá stop hoặc cố định slippage2bps trong crash.

Lịch lịch sử phải là bản biết tại thời điểm giao dịch. Dùng lịch đã sửa sau này để né ngược sự kiện là thông tin tương lai. Quan sát trên dữ liệu đã xem chỉ là phát triển, chưa phải OOS hoặc bằng chứng tăng PnL. Đây là lớp giảm rủi ro đuôi; có thể giảm lợi nhuận trung bình, cần lượng hóa rõ.

## 7. Bằng chứng và giới hạn của lượt này

Đã rà mã và nguồn chính thức Fed/BLS/BEA/NIST/Binance, tài liệu Freqtrade và nghiên cứu gốc; tính lại giờ DST bằng zoneinfo và ví dụ notional bằng Decimal. Không chạy backtest mới, không gửi lệnh/API giao dịch, không đổi source/runtime/PM2/cấu hình, không gửi Telegram thử. Kiểm chứng kết nối/feed/STOP thật, ngưỡng shock và tác động PnL vẫn chưa thực hiện. Checksum và snapshot đã bỏ định danh được lưu trong gói nghiên cứu riêng; archive vận hành trước giữ nguyên.
