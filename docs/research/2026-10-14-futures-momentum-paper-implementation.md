# Phép thử64ngày mới đã xong — 14/10/2026

[Report64](2026-10-14-futures-momentum-64-day-test.md): sameconfig100/10, base−5,256284u/stress−6,492374u, mean−0,082129/−0,101443u/day. User yêu cầu tổngnet/64dương trướcápdụng: **chưađạt**. Khôngpromote/realorders hoặc sửa/rerun kếtquả14ngày dướiđây;64window mới có3900fundingmarkOPENfallback/case côngkhai và2.142.656moneychecksPASS.

# Cập nhật vận hành paper — 14/10/2026

[Patch vận hành](../audits/futures-quick-win/momentum-paper-watchdog-20261014T092700Z/report.md) đã thêm watchdog180s, UI nhận biết giá chậm, own-origin cho trang VPS và funding theo held inventory/latest-page có coverage. Browser public POSTtestbed PASS, không financial rerun. Provider public còn thỉnh thoảng403: báo degraded/tự retry, không giả thiếu phí/funding là0. 26 unit tests + watchdog/Chromium checks PASS. Engine tính tiền và source signals không đổi; frozen14day PnL vẫn base−1,138224/stress−1,694410u. Paper implementation đã có, expectation0,2/1u chưa xác nhận; không order thật hoặc reset wallet. Nội dung dưới là bàn giao trước patch.

# Momentum portfolio đã triển khai paper và replay 14 ngày

14/10/2026. Theo yêu cầu triển khai ngay, đã thêm luồng danh mục vào backend hiện tại, dùng chung lõi cho paper và testbed lịch sử. Hai ca 14 ngày đã hoàn tất; không phải chờ 14 ngày thực. **Hoàn thành triển khai paper và kiểm workflow; chưa xác nhận lãi 0,2u/ngày hoặc mục tiêu 1u/ngày.**

## Kết quả trên vốn 100u

Kỳ cố định: 30/09/2026 00:00 → 14/10/2026 00:00 giờ Việt Nam, tức đủ 14 ngày lịch 30/09–13/10. Một ví cho toàn bộ danh mục, một ngân sách cố định 10u/ngày. Không giới hạn số lệnh hoặc yêu cầu mọi ngày dương.

| Metric | Cơ sở | Chi phí cao hơn |
|---|---:|---:|
| Equity cuối, đã đóng hết | 98.861776u | 98.305590u |
| Net PnL 14 ngày | -1.138224u | -1.694410u |
| Mean / đủ ngày lịch | -0.081302u | -0.121029u |
| Phí | 0.569845u | 0.797473u |
| Trượt giá đã nằm trong PnL | 0.227938u | 0.569623u |
| Funding PnL có dấu | +0.276137u | +0.276216u |
| Net ngày xấu nhất trong envelope | -3.633032u | -3.656188u |
| Fills / rebalance | 226 / 14 | 226 / 14 |
| Vượt 10u/ngày trong mô hình | 0 | 0 |

Cơ sở dùng phí 5bps/fill, slip 2bps; stress phí 7bps/fill, slip 5bps. Funding dùng 1.848 settlement thật/case, không fallback mark. Trượt giá đã đi vào fill/realized/MTM; không trừ lần hai. Không có external cashflow hoặc phí AI. Leverage 10, maintenance 0,5%, buffer đóng 0,10u là giả định thực thi nghiên cứu, không phải rule mới của người dùng.

Cả hai ca âm trong cửa sổ này. Điều đó chưa chứng minh mọi momentum bất khả thi; cũng chưa xác nhận thu nhập 0,2u/ngày. Không đổi tham số hoặc chọn lại coin sau kết quả để làm đẹp báo cáo. [Report máy](../audits/futures-quick-win/momentum-paper-implementation-20261014T043000Z/outputs/report.json), [protocol trước PnL](../audits/futures-quick-win/momentum-paper-implementation-20261014T043000Z/protocol.json).

## Phần giống nguồn và phần thích nghi

Giữ đúng 40 raw signals, momentum 14 ngày, sample volatility 30 ngày, average ranks/demean, gross target 2×NAV và một ngày lag UTC bổ sung của nguồn. TypeScript mới khớp **60.000 weights trên 1.500 hàng**, sai lệch tuyệt đối lớn nhất bằng 0. Không đưa qua ICT/SMC, grade/RR/cooldown/SL/risk-size cũ. Không chạy lại hoặc sửa benchmark đã frozen.

Executable book dùng nearest valid lot hoặc 0, công khai các targets không đạt minimum; prune có thứ tự cố định khi gross vượt nguồn. Chỉ giao dịch delta từ inventory thực, giảm/đóng trước tăng/đảo chiều. MARKET minimum dựa vào mark, reduce-only không cần opening minimum-notional nhưng vẫn phải đúng lot/minQty.

Trong ca cơ sở giữ 23–27 vị thế, sai lệch L1 bình quân **36,50% gross nguồn**, chênh net weight từ −0,2862 tới +0,3623 NAV. Đây là adaptation thực thi với vốn nhỏ; không gọi lợi nhuận này là bản sao executable chính xác của mô hình fractional 40 coin. [Targets và inventory](../audits/futures-quick-win/momentum-paper-implementation-20261014T043000Z/outputs/base/targets.ndjson).

## Phần đã tích hợp vào hệ thống

- `backend/src/portfolio/source-momentum.ts`: tín hiệu và thời điểm nguồn.
- `paper-engine.ts`: Decimal ledger, inventory/delta, phí/slip/funding, margin giả định và fixed 10u governor. Có reserve phí/spread/slip đóng, latch và lưu overshoot thật.
- `paper-store.ts`: checkpoint atomic, fsync, một lock liên tiến trình; restart không reset tiền hoặc ngân sách.
- `paper-service.ts`, `market-data.ts`: public data, một wallet, settlement dedup/cursor có overlap, phục hồi anchor ICT từ open của mark candle 1m. Funding công bố trễ hơn checkpoint làm dừng tăng vị thế để đối soát, không ghi sai ngày/quantity. Khoảng nghỉ qua nhiều ngày cần reconciliation.
- `historical-replay.ts`: cùng engine nhận trade/mark 5m, funding theo timestamp; adverse envelope trước close, đóng cuối kỳ trước end-exclusive. Không dùng testbed V3 có filter cũ.
- API `/api/portfolio-paper`: GET trạng thái; POST `/advance` paper; POST `/testbed` với `{"days":14}`. Không nhận override vốn/risk/universe. Kết quả cùng cửa sổ/config được tái sử dụng, không chạy sweep.
- Trang dùng ngay [mở paper trên VPS](http://132.226.2.93/api/portfolio-paper/view) tại `/api/portfolio-paper/view`; Next page `/futures-paper` cũng đã có trong source, typecheck đạt. Trang Next chưa publish Vercel; trang backend phục vụ từ VPS hiện tại.
- PM2 `crypto-portfolio-paper`: polling 60s, public quotes và fills mô phỏng; không import order/private-account/LLM clients. Ledger riêng `backend/data/portfolio-paper-v1/wallet.json` không cộng với các account legacy.

Đã deploy riêng 22 module/router artifacts và thêm mount vào router API; 858 file runtime cũ giữ nguyên. Không rollout toàn bộ workspace đang có thay đổi khác. API được restart, worker legacy không restart, `.env` và DB không đổi. Không gửi order thật. [Release receipt](../audits/futures-quick-win/momentum-paper-implementation-20261014T043000Z/deployment/release.json).

Trong report replay, `completedDays=13` là 13 ngày đã lưu khi chuyển ngày, cộng `currentDay` cuối kỳ: denominator kinh tế vẫn đủ 14 ngày. Đóng cuối kỳ tại END−1ms để không tạo thêm ngày thứ 15.

Runtime đầu tiên có ngày chưa đủ 24 giờ. UTC target tới lúc start/poll được ghi cả scheduled và actual timestamp; không che việc entry trễ bằng đổi lag nguồn. Polling 60s và recovery lịch sử không phải chứng minh kiểm rủi ro liên tục. Paper hiện tại và replay 14 ngày là hai ví/mẫu tách biệt, không ghép balances hoặc PnL thành một tài khoản 200u.

## Kiểm chứng và giới hạn

22 unit tests PASS: source timing, cash/MTM, inventory delta/flip, funding/dedup, fixed USD budget/cashflows/latch/restart, minimum theo mark, API không cho override, store khóa/atomic và phục hồi boundary. Build module backend và focused frontend TypeScript PASS. Kiểm Chromium desktop/mobile PASS, không lỗi browser, missing values không biến thành 0.

Auditor Decimal độc lập kiểm **464.966 giá trị tiền** của 8.064 frames, 452 fills và 3.696 funding records/cả hai ca: cash, average entry/realized, signed funding, fees/slip, close marks/equity, lot, ICT anchors và denominator. Sai lệch tối đa khoảng 4,29e−42u, tolerance 1e−12u. Đây không phải audit continuous ticks hoặc venue liquidation. [Audit](../audits/futures-quick-win/momentum-paper-implementation-20261014T043000Z/receipts/independent-ledger-audit.json).

Dữ liệu 322.560 trade/mark candles public có receipts/hash, mỗi symbol đủ 4.032 bars. Adverse envelope ghép low của long/high của short trên từng coin, không là synchronized actual ticks. Filters hiện tại được áp hồi cứu; historical filters/tier/ADL, fill queue/partials và latency chưa có proof. Dataset đã xem được, không đổi tên thành holdout/prospective. Không dùng 14 ngày để cam kết thu nhập lâu dài hoặc bảo đảm tuyệt đối 10u khi gap.

## Việc tiếp theo

Luồng paper đã có thể kiểm ngay; không chặn triển khai bằng việc chờ 14 ngày. Hướng cải thiện đầu tiên là projection lot cân bằng long/short hơn và measured delta/no-trade-band execution; đăng ký adaptation riêng trước PnL, giữ benchmark nguồn nguyên trạng. Không thêm lại rule cũ, không yêu cầu mọi tháng dương hoặc lower-CI dương. Chiến lược tiền thật vẫn cần quyết định theo bằng chứng thực thi/chi phí/risk; chưa được bật bởi lượt paper này.
