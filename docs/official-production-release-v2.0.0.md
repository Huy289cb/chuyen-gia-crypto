# Phiên Bản Chính Thức v2.0.0 — Turtle20 Dual L/S (`O2+O3_R3.0% @4h`)
=============================================================================

> **Ngày phát hành thực tế**: 27/11/2026 16:35 ICT  
> **Trạng thái**: Đã triển khai và vận hành trực tiếp trên Binance Futures Mainnet  
> **Dịch vụ PM2 Online**: `crypto-hybrid-live` (ID `6`), `crypto-telegram-bot` (ID `9`), `crypto-api` (ID `0`)  
> **Module Chiến lược Lõi**: `backend/src/portfolio/turtle-dual-strategy.ts`

---

## 1. Tổng Quan Chuyển Đổi Kiến Trúc (`v1.0.x` ➔ `v2.0.0`)

Phiên bản `v2.0.0` chuyển đổi hoàn toàn hệ thống từ chiến lược **14d Cross-Sectional Long-only Momentum + BTC Grid** sang **Turtle20 Dual Long/Short Breakout (`O2+O3_R3.0% @4h`)** với định cỡ **Risk Parity động theo biến động ATR14** và **Chandelier 2.5× ATR Trailing Stop** đối xứng 2 chiều:

* **Khắc phục nhược điểm cũ**: Loại bỏ lực cản BTC Grid khi vốn dưới ngưỡng `minNotional` `$50`, loại bỏ việc nắm giữ Long trái pha trong thị trường gấu (`bear_trend`), và thay thế bộ chốt lời bậc thang cứng bằng trailing stop thích nghi theo ATR14 (`Chandelier 2.5x ATR`).
* **Giao dịch 2 chiều theo chế độ BTC**: Long khi BTC trong xu hướng tăng (`BTC > EMA50`), chủ động đánh Short khi BTC xác nhận gấu (`BTC < EMA50 && BTC EMA20 < EMA50`), và giữ 100% tiền mặt bảo toàn vốn ở pha hồi phục kỹ thuật yếu (`neutral_cash`).
* **Quét breakout cố định khung `@4h UTC`**: Chạy đúng nhịp `00:00 / 04:00 / 08:00 / 12:00 / 16:00 / 20:00 UTC`, sử dụng dữ liệu giá live (`lastPrice`) kết hợp đồng bộ cache nến 100 ngày trước mỗi phiên quét.

---

## 2. Năm Trụ Cột Kỹ Thuật v2.0.0

### 2.1. Phân Giải Pha Thị Trường BTC (`resolveTurtleDualRegime`)
Tính toán từ `100` nến ngày (`BTCUSDT`, EMA20 & EMA50):
* **🟢 Bull Trend**: `BTC > EMA50` ➔ Mở tối đa **3 slot LONG** (`0` Short). Đóng băng mở Long mới nếu BTC 1D hoặc rolling 24h giảm `<= -4.0%` (`BTC_CRASH_LONG_BLOCK_PCT = -0.04`).
* **🔴 Bear Trend**: `BTC < EMA50 && BTC EMA20 < EMA50` ➔ Mở tối đa **2 slot SHORT** (`0` Long). Đóng băng mở Short mới nếu BTC 1D hoặc rolling 24h bật tăng `>= +4.0%` (`BTC_SQUEEZE_SHORT_BLOCK_PCT = +0.04`, dùng `Math.max(intraday, rolling24h)`).
* **🟡 Neutral Cash**: `BTC < EMA50 && BTC EMA20 >= EMA50` (sóng hồi kỹ thuật chưa lấy lại EMA50) ➔ `0` Long / `0` Short, đóng toàn bộ vị thế trái pha và đứng ngoài tiền mặt.
* **🛡️ Fail-Safe (`signal_unavailable`)**: Khi API BTC mất tín hiệu, giữ `0` slot để tránh giao dịch mù.

### 2.2. Bộ Lọc Breakout `O2+O3` Trên Vũ Trụ Động Top 30 (`@4h UTC`)
Quét danh sách **Top 30 hợp đồng Binance Futures** có thanh khoản rolling 24h `>= $50M/ngày` (loại trừ `BTCUSDT`, stablecoin, token ETF đòn bẩy, hàng hóa, và mã vượt biên độ `±35%/24h`), sử dụng chỉ báo không look-ahead trên **20 nến ngày hoàn chỉnh liền trước**:
* **Phá vỡ Kênh Donchian 20 ngày**: Giá `> hi20` (Long) hoặc `< lo20` (Short).
* **Đồng pha xu hướng `O3` (`EMA20` / `EMA50`)**: `price > ema20 > ema50` (Long) hoặc `price < ema20 < ema50` (Short).
* **Xác nhận dòng tiền `O2` (`volRatio >= 1.25x`)**: `rolling24hQuoteVol / avg20QuoteVol >= 1.25`.
* **Kiểm soát biến động & nhiễu**: `ATR14 <= 16.0%`, chặn rơi dao/short-squeeze cực đoan (`±15%`), chặn Event Shield blacklist, và kiểm tra funding rate đối xứng `<= ±0.05% / 8h` (`LONG <= +0.05%`, `SHORT >= -0.05%`).
* **Xếp hạng ứng viên**: `score = (±mom20Return) / Math.max(0.03, atr14Pct)`.

### 2.3. Định Cỡ Vị Thế Risk Parity Động (`computeRiskParityOrderUsd`)
* **Ngân sách rủi ro mỗi lệnh**: **3.0% Equity / Long**, **2.5% Equity / Short**.
* **Stop Loss khởi tạo thích nghi**: `slPct = clamp(2.0 × ATR14, 6.0%, 14.0%)`.
* **Công thức Notional động**:
  `allocUsd = min(Equity × 40%, (Equity × RiskPct) / slPct, min(Equity × 1.05, MAINNET_MAX_TOTAL_EXPOSURE_USD) - activeNotionalUsd)`
* **Cầu dao bảo vệ `.env`**: Đã nâng `MAINNET_MAX_TOTAL_EXPOSURE_USD` & `MAX_TOTAL_EXPOSURE_USD` lên **`2000 USDT`** và nạp qua `ecosystem.config.cjs`, giúp lãi kép tự động mở rộng không bị nghẽn ở mốc `$100` cũ while preserving safety boundary. Tự động bỏ qua nếu `< minNotional` sàn (không ép tăng đòn bẩy).

### 2.4. Thoát Lệnh Đối Xứng & Chandelier Trailing (`computeChandelierStop`)
* **Lệnh `STOP_MARKET` thật trên sàn**: `SELL STOP_MARKET` (`floorPriceToTickSize`) cho Long và `BUY STOP_MARKET` (`ceilPriceToTickSize`) cho Short (`positionSide: 'BOTH'`, `reduceOnly: true`), thay lệnh mới trước khi hủy lệnh cũ để tránh khoảng trống không bảo vệ.
* **Chandelier `2.5 × ATR14`**: Kích hoạt khi đỉnh lãi vị thế `>= +5.0%`; dời một chiều theo `extremePrice ∓ 2.5 × atr14Pct` (`atr14Pct` cập nhật hàng ngày từ nến hoàn chỉnh).
* **Đóng khẩn cấp khi đảo pha (`REGIME_ALIGN`)**: Nếu BTC cắt qua `EMA50` làm mất slot hướng tương ứng (kiểm tra cả tại `@4h` và mỗi `200` ticks ~10 phút), đóng ngay bằng `MARKET` và hủy `STOP_MARKET`.
* **Cooldown đối xứng 24h**: Mọi lệnh đóng đều kích hoạt cooldown `24h` theo timestamp UTC (`TURTLE_COOLDOWN_MS = 86,400,000ms`).

### 2.5. Cầu Chì Ngày `-12%` & Miễn Trừ Lệnh Khóa Lãi
* Khi lãi/lỗ ngày `<= -max(12.0, DayStartEquity × 12%)`: kích hoạt `breakerLatched = true`, đóng toàn bộ vị thế **chưa khóa lãi**, nhưng **miễn trừ giữ nguyên** các vị thế thắng đã có `SL` khóa tối thiểu `>= +1%` so với giá vào (`isPositionLockedWinner`).

---

## 3. Kiểm Chứng Định Lượng (`audit_o2_o3_winners.py` & 1H Top30 Check)

### 3.1. Hiệu suất trên tập dữ liệu 1D Top30 `>= $50M/24h` (`O2+O3_R3.0% (1.05x)`)
| Cửa sổ kiểm thử | Kết quả ghi nhận | Ghi chú |
| :--- | :--- | :--- |
| **In-Sample (2020-04 – 2023-12)** | **+508.2u** | Tập vốn tĩnh `100u` |
| **Out-of-Sample (2024-01 – 2026-11)** | **+72.3u** (`PF 1.32`) | Dữ liệu OOS chưa từng tối ưu |
| **1,500 ngày Static (2022-10 – 2026-11)** | **+232.8u** (`NoTop3: +43.0u`) | Dương bền vững kể cả khi loại 3 lệnh lãi lớn nhất |
| **1,500 ngày Compounding (từ `$91.82`)** | **$352.3** (`MDD 41.6%`, `Worst -14.3%`, `Brk 2`) | Chịu ma sát 2× + slip + funding còn **$258.2** |
| **2,430 ngày Compounding (2020–2026, từ `$91.82`)** | **$3,705.6** | Gấp **40.4×** vốn gốc |

### 3.2. Đối soát khung 1H Top30 `>= $50M` (`@4h` vs `@1h`)
* **`O2+O3_R3.0% (1.05x) @4h`**:
  - **73 ngày (2026-09-14 – 2026-11-26)**: **+22.1u** (`PF 5.82`, `7` lệnh, `MDD 13.0%`).
  - **Stress ma sát 2× + 1% SL slip**: **+20.2u**.
  - **Live Window 28 ngày (2026-10-30 – 2026-11-26)**: **+5.4u**.
  - **CORE40 (static)**: **+14.2u**.
* So với `@1h` (`73d: +49.0u, PF 3.71, MDD 29.9%, CORE40: -1.6u`), tần suất `@4h` giảm hơn nửa Max Drawdown (`13.0%` vs `29.9%`), đạt `PF 5.82` và duy trì dương ổn định trên cả `CORE40` lẫn `Live 28d`.

---

## 4. Xác Minh Xây Dựng, Kiểm Thử & Trạng Thái Live (27/11/2026)

* **Build TypeScript**: `npm run build` (`prisma generate && tsc`) hoàn tất `0` lỗi.
* **Kiểm thử đơn vị**: **16/16 files passed — 146/146 tests passed** (bao gồm `tests/unit/v2-turtle-dual-ls.test.ts` kiểm tra regime Bull/Bear/Neutral, lọc `O2+O3` Long/Short, Risk Parity sizing + `minNotional` skip, Chandelier 2.5× ATR đối xứng + tick rounding `floor`/`ceil`, Short funding gate, cập nhật `lastScanBucket4h` an toàn, `livePrice` `@4h`, và miễn trừ lệnh khóa lãi khi sập cầu chì).
* **Hardening vá qua đối soát live**:
  1. Đồng bộ `candleCache.prefetchAll` trước quét `@4h` (khi cache > 20s) + truyền `lastPrice` live vào `computeTurtleIndicators`.
  2. Chỉ ghi nhận `lastScanBucket4h` ở cuối `runTurtleCycle` khi quét thành công (tránh bỏ lỡ cả phiên 4h nếu API Binance gặp lỗi tạm).
  3. Dùng `Math.max(todayReturn, rolling24hReturn)` cho `shortBlocked` (`>= +4%`) và `Math.min` cho `longBlocked` (`<= -4%`).
  4. Làm mới `ATR14` hoàn chỉnh hàng ngày cho `ratchetState` và dùng ATR fallback thay vì 12% tĩnh trong `reconcileState`.
* **Vận hành thực tế (`16:33 ICT`)**:
  - `crypto-hybrid-live` (ID `6`), `crypto-telegram-bot` (ID `9`), `crypto-api` (ID `0`) đều `online`; đã xác nhận `pm2 env` của worker & API nạp `MAINNET_MAX_TOTAL_EXPOSURE_USD=2000`.
  - BTC tại `$61,721.2 < EMA20 ($65,071.5) < EMA50 ($71,301.3)` ➔ chế độ **`bear_trend` (`L=0, S=2`)**; đã đóng sạch 2 vị thế Long trái pha cũ (`MOVEUSDT`, `VVVUSDT`) và giữ `100%` tiền mặt (`Equity $92.37 USDT`, `Day PnL +$0.77`) chờ điểm phá đáy Short `O2+O3` đạt chuẩn trên khung `@4h`.

---

## 5. Danh Sách Tệp Chính Liên Quan

* Core Strategy: `backend/src/portfolio/turtle-dual-strategy.ts`
* Live Worker: `backend/src/portfolio/hybrid-worker.ts`
* Telegram Formatter & Bot Commands: `backend/src/portfolio/hybrid-live-notice.ts`, `backend/src/services/telegram/agy-chat.service.ts`
* Unit Tests: `backend/tests/unit/v2-turtle-dual-ls.test.ts`, `backend/tests/unit/v1-1-defensive-improvements.test.ts`, `backend/tests/unit/hybrid-live-notice.test.ts`, `backend/tests/unit/phase5-dynamic-compounding.test.ts`, `backend/tests/unit/phase6-ratchet-profit-guard.test.ts`, `backend/tests/unit/phase8-freqtrade-suite.test.ts`
