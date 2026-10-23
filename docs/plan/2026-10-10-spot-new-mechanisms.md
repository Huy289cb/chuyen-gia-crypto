# Hai cơ chế Spot mới — kiểm chứng hồi cứu với15USDT

**Trạng thái cuối 10/10/2026:** V2 chạy đủ8case nhưng không có lệnh khớp; formalFAIL về khả thi entry, alpha chưa đo. [Báo cáo v2](/home/ubuntu/binance-income-research-2026-10-10/backtest-run-v2/report.md) và audit độc lập đủ8case được giữ nguyên. Sau diagnostic chỉ dùng thông tin trước entry, một revision policy riêng [v3](2026-10-10-spot-aggressive-mechanisms.md) đã chạy4case: trend base−0,3776/stress−1,5065USDT (34/26closed), reversion+0,3608/−0,6156 (7/2closed). Cả hai v3FAIL; không triển khai live/paidAIpaper. [Kết quả v3](/home/ubuntu/binance-income-research-2026-10-10/backtest-run-v3/report.md) là kết quả mới nhất; các quy tắc v2 bên dưới vẫn là thiết kế lịch sử, không thay bằng policy v3.

Người dùng yêu cầu tìm phương án khác sau v1 thua lỗ. Vòng này giữ50%vốnSpot/50%Futures, mô phỏngSpot15USDT, không chuyển vốn hoặc thay botFutures. Không gọi OpenRouter trả phí, gửi Telegram, đặt lệnh hay mở paper worker. Kết quả tài chính chưa chạy khi khóa quy tắc.

Protocol: `/home/ubuntu/binance-income-research-2026-10-10/spot-new-mechanisms-protocol.json`. Nguồn nghiên cứu và phản chứng: `spot-v2-primary-research.md` cùng thư mục. Không có paper nào chứng minh SOL4h/ví15USDT hay lợi nhuận1–3USDT mỗi ngày. SMA20/60, ATR14,2SD là lựa chọn thiết kế trước PnL, không tham số tối ưu từ dữ liệu này.

## Quy tắc và thực thi

**Trend4h:** SOLvàBTC cóSMA20>SMA60 trên nến4h đã đóng; thử một lần khi jointregime tắt→bật. Warmup-readyon đầu tiên tính là episode. Stop ban đầu close−2ATR14Wilder, tickfloor. Không TP cố định. Mỗi nến4h đóng tăng stop lên max(stopcũ,close−2ATR), hiệu lực tại minuteopen đầu tiên sau4hclose: bar đóng03:59:59.999999→stop mới áp04:00:00 trướcH/L04:00. Trail không chịu delay entry. Regime tắt tạo marketexit sau30sbase/120sstress; protective stop vẫn hoạt động trong khi chờ. Giữ tối đa720giờ. Stop/timeexit trong episode không cho entry lại trước regime tắt→bật.

**Reversion4h:** lowerband=mean20priorclosedSOL−2populationSD20prior, loại bar tín hiệu khỏi reference. Close lần đầu dưới band mở excursion, một attempt kể cả bị reject. Rearm khi close≥band hiện hành. BTCclosedclose≥SMA60 mới eligible. Stopclose−2ATR;targetmean20prior tickfloor, cố định từ signal. Giữ tối đa48giờ; stop/target cùng1m thì stopfirst. Không DCA/grid/pyramiding.

Hai mechanism giữ sizing largestvalidlot, maxpurchase12USDT, reserve3, risk=min(.50,executableNAV/30,VNdayremainingheadroom), daycap=min1.50/10%daystartNAV. Entry tại first1mopen≥signalclose+1us+delay. Stopgap dùngopen xấu hơnstop rồi slip; các fill là proxy từ nến, không receipt lịch sử. Exit không hợp minimum được latch và thử lại minuteopen, giữ ownedinventory.

Costgate cho lệnh mới riêng: basefeeSOLceil8, sellsUSDTceil8, lot.001/tick.01; stop và hurdle phải bán được sau phí. newaloneNetProfit/newaloneStopLoss≥1.5 và hurdleBenefitVsFlat≥4×unchangedpriceRoundtripDrag. Olddust không được làm expectedreward trông lớn hơn. Reversionhurdle=target. Trendhurdle=signalclose+4ATR là kiểm volatility/cost, **không forecast, TP hoặc p(win)**. Actual portfolio và solo fullfill stoprisk đều phải vừa cap. Partialentry50%cancelrest là sensitivity, không loại inventory bị stranded khỏi bookvalue.

## Dữ liệu, giới hạn và đăng ký

PublicBinanceSpotZIP+CHECKSUM, SOL1m/SOL4h/BTC4h. Rawms trước2025 phải normalize close_ms×1000+999; từ2025 rawµs. Initial Jan2023 development data bị strictQA reject:Feb thiếu1minute,Mar thiếu80minute và1rawclose sớm. Bản protocol trước sửa lưu `spot-new-mechanisms-protocol-initial-data-rejected.json`; audit và failedmanifest giữ nguyên. Sửa data.start thànhApr2023 trước financialresults; **không sửa mechanism, mainperiod hoặc confirmation theo PnL**. Không tự điền thiếu nến.

CleanperiodApr2023→Sep2025:90archives; fullOHLC/volume/trades/gaps/provenance và tất cả SOL1m→SOL4h phải exactmatch. DevelopmentQA trongMay2023. Maincontinuous15USDT từJan2024→Sep2025, confirmationJan2025→Sep2025 bắt đầu bằng NAV/cuộc giữlệnh cuối2024, không resetcash. Episode đã bắt đầu trongwarmup không giả tạoentry mới ởJan1. Chọn chiến lược sau khi thấy2026v1 nên đây là **retrospectivecross-periodscreen**, không holdout prospective sạch.

Một cấu hình/mô hình;8replays cố định:2×(base,stress,min10stress,partial50stress). Fees.1%mỗi phía, slipbase.1%/stress.3%, minmain5/sensitivity10; historicalfee/filter không được xác nhận theo từng ngày. Cash15 và buyhold12+cash3 so sánh cùngcost/filter. Download2threads/20min/2GiB, replay1worker nice10/7200s/target256MiB. Pin protocol/dataset/source/tests và snapshot trướcmain; fullrun chỉ một lần, không repeat/tune sau PnL.

## Đọc kết quả và hành động tiếp theo

Gate: basenet>0/PF≥1.2, stressnet≥0, confirmationbase/stress≥0, DD≤3USDT, ít nhất30closedepisodes; FAIL/INCONCLUSIVE/RETROSPECTIVE_SCREEN_PASS_FOR_PAPER. Samplecount không chứng minh edge. Report fees/nativeassets, exec/bookNAV/drawdown, monthly/daily, independentepisodes/minimum/risk/cost-skips, concentration và remove3winners diagnostic. VPSincrementalcost unknown, AIhistorical0 với sensitivity.10/.25/.50USDT; không gọi exchangereturn là lãi ròng mọi chi phí.

Nếu passscreen mới có ứng viên quan sát forward riêng, giữ nguyênsource/rules và ghi thời gian/lệnh đủ để đo, không bật tiền thật tự động. LLM chỉ được đánh giá rulesvsrules+LLM theo candidate/time/cost công bằng; confidence tự báo không thay bằng chứng. Nếu fail, giữ cả kết quả âm và lý do, không hạgate hoặc sweep để in số dương. Vòng này không thể hứa lãi hàng ngày.
