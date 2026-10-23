# Spot theo ưu tiên ROI+ — 11/10/2026

Người dùng yêu cầu ưu tiên khả năng ROI+ và tiếp tục tìm giải pháp. Đã chọn và đo một bản thích nghi BTC EMA600 từ nguồn công khai, thay vì chỉ nhận ROI do tác giả quảng bá. Kết quả: **dương sau chi phí giao dịch mô phỏng ở cả base và stress, là ứng viên hồi cứu; chưa xác nhận ROI toàn hệ thống hoặc tiền thật.**

## Kết quả đủ toàn kỳ

Ví giả lập15USDT, liên tục01/01/2024→01/10/2025 exclusive:21tháng/639ngày UTC,640ngày lịch Việt Nam có ngày biên. Không reset vốn theo tháng. Dữ liệu BTC60archive1m/1h đã checksum,0gap/duplicate/OHLCerror; gom1m→1h khớp đủ21936giờ. Tín hiệu độc lập khớp432toàn warmup+main; main145ENTRY,216EXIT, không phải361lệnh khớp.

| Chỉ tiêu | Base | Stress |
|---|---:|---:|
| Lãi ròng có thể thanh lý, USDT | +6,36567791 | +4,46902244 |
| ROI trên ví Spot15, % | +42,44 | +29,79 |
| Mua/đóng roundtrip | 39/39 | 39/39 |
| PF | 1,6205 | 1,3824 |
| DD lớn nhất theo minute-close, % | 26,51 | 30,12 |
| MTM01–09/2025, USDT | −1,09670714 | −1,89214697 |
| Tháng dương/âm | 9/12 | 9/12 |
| Bình quân USDT/ngày quá khứ | 0,009962 | 0,006994 |
| Đối chứng mua giữ BTC12+3, USDT | +18,88041158 | +18,79520656 |

Đối chứng có stop risk khác; không chứng minh chiến lược chủ động tốt hơn mua giữ. Có571/640ngày không khớp lệnh,10lệnh thắng/29lệnh lỗ ở base. Lợi nhuận phụ thuộc các đoạn trend lớn, không phải lãi đều hàng ngày và không xác nhận mục tiêu1–3USDT/ngày.

## Những thay đổi đã thực hiện

Tạo `backend/spot_btc_trend` riêng: EMA600 nến1h đã đóng, SMAseed/warmup1300; BUY cắt lên EMA, EXIT cắt xuống98%EMA; trailing15%, target11×price là bản thích nghi1000% của nguồn. Kiểm stop cũ trước và áp stop nâng từ phút sau. Phút entry chưa chứng minh bảo vệ intrabar; mô hình bắt đầu từ phút kế tiếp.

BTC account có step0,00001BTC, tick0,01, fee BUY0,1% bằngBTC/SELL0,1% bằngUSDT, dust carry và nav có thể bán riêng book NAV. Ví15, mua≤12, giữ≥3. Policy nghiên cứu mới reservedrisk≤min(3,NAV/5,dailyheadroom), dailyheadroom min(3,20%VN-day-startNAV) trừ loss, cooldown1h; **khác cap1,50/NAV10 của SOLv3**, không sửa bản cũ hoặc live. Gap/minimum có thể khiến lỗ vượt reservation, không coi cap là bảo đảm.

Base slip0,1% mỗi chiều/delay30s; stress0,3%/120s; reference-filter proxy là5phút hoàn tất trước fill. Current public filter không phải bằng chứng historical/private tier. Dust sở hữu cuối kỳ base0,45961719/stress0,46075768USDT chưa được cộng vào tiền có thể thanh lý. Không paidAIcalls nên AIcost0; VPScost vẫnunknown. Trần chi phí vận hành hòa vốn theo arithmetic quá khứ chỉ khoảng0,30base/0,21stressUSDT mỗi30ngày; không dùng làm forecast.

## Bằng chứng và giới hạn

Main COMPLETE, runtime896,012giây, ru_maxrss36.908KiB. TechnicalQA25tests+14synthetic độc lập; đã sửa lỗi phantom gap stop trước main. AccountingauditPASS độc lập cả2case:78events/case, cash/inventory/fee/dust, PF, monthly/dailytelescoping, caps và benchmark. Source/protocol/data recheck trước/sau từng phase/case và cuối run.

Các phép kiểm không xác minh live fills, lịch phí/filter, order queue hoặc toàn bộ minute-by-minute strategy/stop/DD. Nguồn công khai commit22/08/2026 postdates kỳ replay2024–25; đây là retrospective đã chọn sau khi biết headline, không phải prospective holdout. Không sweep tham số, không báo financial/livePASS hoặc rollout từ kết quả này.

Recovery5m F-only dừng INCOMPLETE tại601giây, mới quét56,33%warmup+main.0episodes ở prefix không phải0cơ hội toàn kỳ; chưa đo PnL. Chẩn đoán hiệu năng lưu riêng; không rerun hoặc thay rules trong lượt này.

## Việc tiếp theo đã chốt

Ưu tiên kiểm BTC trên dữ liệu mới, cùng tham số/phiên bản, với đối chứng mua giữ và cash/Earn đủ điều kiện; đo cả khả năng giữ lợi nhuận ở regime bất lợi. Đọc [kế hoạch thực hiện](/home/ubuntu/binance-income-research-2026-10-11-roi-search/implementation-plan.md): giữ EMAstate cùng seed/checkpoint, public quote/avgPrice receipts, ledger paper, tối thiểu90ngày và8roundtrip là mốc review dự kiến chứ không phải chứng minh thống kê. LLM chỉ thử overlay BUY/WAIT/VETO sau baseline có ích và đủ eligibility, đếm actualbill và lợi ích biên. Không gọi model định kỳ để tạo chi phí khi không có cơ hội.

Không đưa ứng viên tiền thật khi chưa kiểm dữ liệu mới, full execution/reconciliation và chi phí thực. Không đổi runtime/Telegram, không đặt order/chuyển tiền, không truy cập privateAPI, không khởi động lại goal Futures cũ. Phần Futures15được giữ riêng theo phân bổ50/50, không coi nghiên cứu Spot là vốn cả tài khoản.

Báo cáo chi tiết: [/home/ubuntu/binance-income-research-2026-10-11-roi-search/btc-trend-run-v1/report.md](/home/ubuntu/binance-income-research-2026-10-11-roi-search/btc-trend-run-v1/report.md). Nguồn đã sàng lọc: [roi-solution-evidence.md](/home/ubuntu/binance-income-research-2026-10-11-roi-search/roi-solution-evidence.md). Protocolfinancial SHA`d37d9f3c4374cc6ff2c7ad7170220a5cf021d733d082ef9e33c25c3081fd10de`; manifestBTC SHA`d8772dc166bbc38e6d2dd550f7673b0074a77147878288e612738fe49ecf6e85`.

RawCSV fill-reference audit độc lập PASS: đủ156fills/2case,21monthlyZIPs/920160rows, MS trước2025 và µs từ2025, checksums trước/sau. Giá buy/sell, delay,36EMA exits+2STOP+1terminal mỗi case khớp;0entry-minute initial-stop touch. Chỉ kiểm reference của fills đã ghi, không full strategy/NAV/DD/filter/queue/livefill replay. Receipt `/home/ubuntu/binance-income-research-2026-10-11-roi-search/btc-fill-reference-verification.json`. Lỗi kiểm format `.001`/`0.001` được sửa ở audit-only và lưu bản trước; không rerunfinance hoặc sửa frozen source.
