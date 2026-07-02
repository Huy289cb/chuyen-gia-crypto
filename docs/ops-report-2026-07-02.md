# Báo cáo vận hành bot trading BTC — 02/07/2026

**Mục đích:** Chia sẻ với advisor/peer review để đánh giá chiến lược, pipeline lọc tín hiệu, và đề xuất cải thiện PnL+.

**Môi trường:** Binance Futures **Testnet**, symbol BTC, VPS + dashboard Vercel.  
**Thời điểm báo cáo:** 2026-07-02 ~21:30 ICT (14:30 UTC).  
**Commit đang chạy:** `fcc18a6` (HTF flex guard + ưu tiên entry 5m).

---

## 1. Tóm tắt điều hành

| Chỉ số | Giá trị | Ghi chú |
|--------|---------|---------|
| Wallet balance | **$4,999.62** | Nguồn tin cậy nhất |
| Starting baseline | $5,046.55 | Sync từ Binance |
| **Wallet PnL** | **−$46.93** | Tích lũy từ đầu kỳ |
| DB realized field | −$27.79 | Lệch wallet do phí/funding + bookkeeping |
| DB W/L (account stats) | 19W / 27L | Bao gồm cả close PnL=0 |
| Worker uptime | 25.6h, 0 restart | Ổn định sau các bản vá gần đây |
| Vị thế đang mở | 1 long @ 61,699.5 | uPnL ~+$0.58 |

**Nhận xét nhanh:**
- Cảm giác "thua nhiều" chủ yếu đến từ **wallet tổng âm ~$47**, không phải tuần gần nhất.
- **Kể từ deploy HTF flex (01/07 19:57 ICT):** 4 lệnh đóng verified → **PnL +$19.88** (2W/2L).
- Pipeline **lọc rất chặt**: ~70% quyết định LLM là `no_trade`; blocker #1 là **HTF 1h không trend**.
- HTF flex (`1h OR 15m trend`) **mới deploy, chưa kích hoạt nhiều** (0 lần pass ghi nhận trong DB).

---

## 2. Kiến trúc pipeline (Big Update v3)

```
MarketScan (*/5 phút)
  → Signal Gate (grade ≥ B, conf ≥ 70%, regime trend)
  → LLM Dispatch (Groq Scout 4 → Cerebras → OpenRouter → Groq fallbacks)
  → Risk engine + Account guard + HTF trend guard
  → V3 Trade Execution (limit order ~$2,000 notional)
  → Binance SL/TP (algo orders)
  → Reconciliation + Protective exposure audit (mỗi 60s)
```

**Timeframe stack:** `5m, 15m, 1h` (gate); entry ưu tiên `5m → 15m → 1h` (mới đổi 01/07).  
**Không hỗ trợ** 1m/3m/4h cho entry dispatch.

---

## 3. Hiệu suất giao dịch

### 3.1. Tổng quan đóng vị thế (all-time DB)

| close_reason | Số lệnh | PnL sum | W | L |
|--------------|---------|---------|---|---|
| reconciliation_bookkeeping | 54 | $0 | 0 | 0 |
| reconciliation_fill (verified) | 4 | **+$19.88** | 2 | 2 |
| protective_failed_market_close | 6 | +$19.52 | 2 | 3 |
| protective_tp_reached_market | 2 | +$16.74 | 2 | 0 |
| merged/phantom | 3 | $0 | 0 | 0 |
| reconciliation_closed_not_on_binance | 1 | $0 | 0 | 0 |
| **Tổng có PnL ≠ 0** | **11** | **+$56.14** | 6 | 5 |

> **Gap wallet vs DB:** Wallet −$47 nhưng sum position PnL dương (+$56) → chênh lệch ~**$103** chủ yếu từ **phí giao dịch, funding**, và các lần đóng bookkeeping (PnL=0 trong DB nhưng wallet đã thay đổi trên Binance trước đó).

### 3.2. Verified closes gần nhất (userTrades-backed)

| Thời gian (UTC) | Side | Entry | Close | PnL | Ghi chú |
|-----------------|------|-------|-------|-----|---------|
| 2026-07-01 13:26 | short | 58,506 | 58,741 | **−$8.83** | Sau HTF flex deploy |
| 2026-07-01 22:52 | long | 60,750 | 60,401 | **−$12.25** | |
| 2026-07-02 09:39 | long | 60,111 | 60,777 | **+$21.31** | |
| 2026-07-02 14:13 | long | 61,250 | 61,879 | **+$19.65** | |
| **Net 4 lệnh** | | | | **+$19.88** | 2W / 2L |

### 3.3. LLM trade decisions (30 ngày)

| Decision | 30 ngày | 7 ngày |
|----------|---------|--------|
| `trade` | 125 | 22 |
| `no_trade` | 272 | 150 |

**Phân bổ TF khi LLM confirm trade (30d):** 15m: 47 · 5m: 38 · 1h: 40

**Lệnh limit thực sự đặt trên Binance (30d log):** ~62  
**Tỷ lệ trade decision → limit placed:** ~50% (phần còn lại bị execution block, duplicate exposure, cooldown…)

---

## 4. Phân tích blocker (tại sao ít lệnh?)

### 4.1. Top lý do `no_trade` (30 ngày, DB)

| Lý do | Số lần | % ước lượng |
|-------|--------|-------------|
| HTF 1h regime ≠ trend | **190** | ~52% |
| Cooldown / loss streak | **61** | ~17% |
| SL distance < min 0.40% | **14** | ~4% |
| Account guard consecutive losses | 5 | ~1% |
| LLM invalid JSON | 1 | <1% |
| R:R below minimum | 1 | <1% |

### 4.2. Signal gate (30 ngày log)

- **Signal gate blocked:** ~17,722 lần (đa số scan = Grade D, regime range, không setup A/B)
- **LLM dispatch completed:** ~8,481 lần
- **Conversion dispatch → trade decision:** ~1.5% (125/8481)

### 4.3. Kể từ HTF flex deploy (~25h)

| Metric | Giá trị |
|--------|---------|
| Limit orders placed | 6 |
| LLM trade decisions | 6 |
| HTF flex pass (15m trend) | 0 |
| HTF 1h range block | 10 |
| Cooldown blocks | 11 |

**Kết luận:** Thị trường BTC giai đoạn này **sideway 1h** → pipeline cố tình đứng ngoài. HTF flex chưa giúp nhiều vì **15m cũng thường range**.

---

## 5. Cấu hình risk & entry hiện tại

```env
# Signal quality
MIN_SIGNAL_GRADE=B
MIN_SIGNAL_CONFIDENCE=0.7
V3_ALLOWED_REGIMES=trend
V3_BLOCK_RANGE_ENTRIES=true

# HTF guard
V3_REQUIRE_HTF_TREND=1h
V3_HTF_TREND_ALT=15m              # OR-guard: 5m/15m pass nếu 15m trend
V3_HTF_FLEX_LTF_ONLY=true         # 1h entry vẫn bắt buộc 1h trend

# Entry priority
V3_ENTRY_TF_PRIORITY=5m,15m,1h   # Ưu tiên 5m (đổi 01/07)
V3_SIGNAL_GATE_TIMEFRAMES=5m,15m,1h

# Risk
RISK_PER_TRADE_PERCENT=1
MAX_TOTAL_EXPOSURE_USD=2000
MAX_CONSECUTIVE_LOSSES=2
CONSECUTIVE_LOSS_COOLDOWN_HOURS=2  # (mặc định)
MIN_SL_DISTANCE_PERCENT=0.004      # 0.40%
V3_MIN_LLM_CONFIRM_CONFIDENCE=0.75

# Regime thresholds
V3_REGIME_TREND_MIN_1H=0.06%
V3_REGIME_TREND_MIN_15M=0.08%
V3_REGIME_TREND_MIN_5M=0.10%
V3_BREAKOUT_REGIME_BYPASS=true
```

---

## 6. Thay đổi production gần đây (ảnh hưởng vận hành)

| Ngày | Thay đổi | Ảnh hưởng |
|------|----------|-----------|
| 28–29/06 | Fix worker crash partial fill WS | Worker ổn định, không restart giữa fill |
| 29/06 | Telegram: bỏ spam bookkeeping/partial fill | UX Telegram sạch hơn |
| 29/06 | Fix Telegram khi đóng lệnh thật (reconciliation) | Đóng SL/TP verified có notify |
| 01/07 | HTF flex + ưu tiên entry 5m | Tăng nhẹ cơ hội; sample nhỏ, PnL verified +$19.88 |
| Trước đó | PnL+ P0: trend-only, protective audit, mainnet guards | Giảm overtrade range; bảo vệ SL/TP |

---

## 7. Vấn đề kỹ thuật đã biết

### 7.1. Đã sửa
- Worker crash `PrismaClientValidationError` trên partial fill (field schema sai)
- Telegram bookkeeping gây hiểu nhầm (mở + đóng cùng giây)
- Đóng lệnh verified không gửi Telegram (bookkeeping_close flag sai)
- Missing TP/SL trên một số fill (protective exposure audit)

### 7.2. Còn tồn tại / cần cải thiện

| Vấn đề | Mức độ | Mô tả |
|--------|--------|-------|
| **Bookkeeping close → loss streak** | Trung bình | 54 lần đóng PnL=0 vẫn có thể kích hoạt cooldown (0 PnL đếm là loss) |
| **WS miss SL/TP fill** | Trung bình | Đóng qua reconciliation thay vì real-time WS; PnL resolve từ userTrades (đã cải thiện) |
| **FK constraint partial_fill event** | Thấp | `testnet_trade_events_position_id_fkey` khi ghi partial fill (02/07 log) |
| **Gap wallet vs DB PnL** | Thông tin | ~$103 chênh; cần dashboard fee-aware |
| **HTF flex chưa hiệu quả** | Chiến lược | 15m cũng range → flex không mở thêm nhiều cửa |
| **40 worker crash lịch sử** | Đã giảm | Toàn bộ log; không crash mới kể từ 28/06 |

### 7.3. LLM / execution quirks (log gần đây)
- `expected_rr` thường bị **corrected** sau LLM (2.5 → 1.36 → 2.0) — adapter widen SL/TP
- Một số lệnh bị **execution skip**: `SL distance 0.40% below min 0.40%` (sát ngưỡng)

---

## 8. Phân tích chiến lược (cho peer review)

### 8.1. Điểm mạnh
1. **Pipeline phòng thủ tốt** — không overtrade trong range (đúng mục tiêu PnL+ P0)
2. **SL/TP bắt buộc trên sàn** + protective exposure audit
3. **LLM chỉ veto/confirm** sau signal gate — giảm chi phí API
4. **Verified PnL** từ userTrades cho close gần đây
5. **Cooldown** sau chuỗi thua — hạn chế revenge trading

### 8.2. Điểm yếu / trade-off
1. **Quá ít lệnh** trong thị trường range (~3–6 lệnh/tuần thực tế)
2. **HTF 1h guard** loại ~52% cơ hội LLM — đúng khi range nhưng bỏ lỡ micro-trend 15m
3. **Bookkeeping closes** (54) làm nhiễu stats và cooldown
4. **Long bias gần đây** (6/6 lệnh long kể từ flex deploy) — có thể thiếu hedge khi đảo chiều
5. **Wallet PnL âm** dù sum verified trades dương → **fee drag** đáng kể trên testnet với nhiều lệnh nhỏ

### 8.3. Câu hỏi mở cho advisor

1. **Có nên nới HTF flex thêm?** (ví dụ: 5m pass khi 15m trend **hoặc** breakout grade A trên 5m)
2. **Có nên trade range có điều kiện?** (PnL+ cũ: range trades thua — nhưng chỉ với setup yếu)
3. **MIN_SL_DISTANCE 0.40%** có quá chặt cho 5m không? (14 lần block)
4. **Bookkeeping PnL=0** có nên loại khỏi consecutive loss counter không?
5. **Position sizing** 1% risk × $2000 exposure — có phù hợp testnet learning vs mainnet 40U?
6. **R:R minimum 2.0** sau adapter — có reject quá nhiều setup grade B không?

---

## 9. Đề xuất cải thiện (ưu tiên)

### P0 — Sửa đúng/sai (không đổi chiến lược)
| # | Đề xuất | Effort | Kỳ vọng |
|---|---------|--------|---------|
| 1 | Bookkeeping close **không tính** vào loss streak / cooldown | Thấp | Giảm cooldown oan |
| 2 | Fix FK partial_fill event (position_id) | Thấp | Ít lỗi log WS |
| 3 | Dashboard hiển thị **wallet PnL** làm primary (đã có, cần nhấn mạnh) | Thấp | Đánh giá đúng |

### P1 — Tối ưu entry (đã bắt đầu)
| # | Đề xuất | Trạng thái | Ghi chú |
|---|---------|------------|---------|
| 4 | `V3_ENTRY_TF_PRIORITY=5m,15m,1h` | ✅ Deployed 01/07 | Vào nhanh hơn |
| 5 | HTF flex `1h OR 15m trend` cho 5m/15m | ✅ Deployed 01/07 | Chưa thấy impact lớn (15m cũng range) |
| 6 | Theo dõi 1–2 tuần, đo wallet PnL theo regime | Đang làm | Sample hiện tại quá nhỏ |

### P2 — Chiến lược (cần backtest / peer review)
| # | Đề xuất | Rủi ro | Ghi chú |
|---|---------|--------|---------|
| 7 | HTF flex mở rộng: breakout grade A bypass 1h range | Trung bình | Có sẵn `V3_BREAKOUT_REGIME_BYPASS` |
| 8 | Range playbook riêng (mean-reversion) với size nhỏ hơn | Cao | PnL+ cũ không khuyến khích |
| 9 | Giảm `MIN_SL_DISTANCE` 0.40% → 0.35% cho 5m only | Trung bình | +14 cơ hội/30d nhưng SL gần hơn |
| 10 | Mainnet 40U với cap exposure $40 + leverage thấp | Thấp | Đã chuẩn bị mainnet guards |

### P3 — Không khuyến nghị hiện tại
- Hạ khung dưới 5m (1m/3m) — chưa hỗ trợ, nhiễu cao
- `MIN_SIGNAL_GRADE=C` — tăng lệnh, giảm edge
- Tắt `V3_REQUIRE_HTF_TREND` hoàn toàn — overtrade ngược trend 1h

---

## 10. KPI đề xuất theo dõi (4 tuần tới)

| KPI | Baseline hiện tại | Mục tiêu review |
|-----|-------------------|----------------|
| Wallet PnL (weekly) | −$47 total | ≥ $0 hoặc cải thiện tuần-over-tuần |
| Verified closes / tuần | ~2–4 | 4–8 (nếu thị trường có trend) |
| Win rate (verified only) | 50% (4 lệnh gần) | ≥ 45% trên ≥20 mẫu |
| % no_trade do HTF 1h | ~52% | Giảm nếu flex mở rộng |
| Cooldown oan (bookkeeping) | Chưa đo | 0 |
| Worker restarts / tuần | 0 | 0 |
| Fee / gross PnL ratio | Chưa đo | < 30% |

---

## 11. Phụ lục

### A. LLM fallback chain
1. Groq Llama 4 Scout  
2. Cerebras gpt-oss-120b  
3. OpenRouter Scout 4  
4. Other Groq models  

### B. Deploy & monitoring
- VPS: PM2 `crypto-api` + `crypto-worker`
- Deploy: `./scripts/deploy.sh`
- Health: `GET /health`
- Docs: `docs/v3-operations.md`, `docs/pnl-plus-roadmap.md`, `docs/mainnet-readiness.md`

### C. Liên hệ / repo
- GitHub: `Huy289cb/chuyen-gia-crypto` (branch `develop`)
- Dashboard: Vercel (frontend Next.js 15)

---

*Báo cáo tự động tổng hợp từ DB PostgreSQL, worker logs, và `.env` production. Số liệu wallet là nguồn chính để đánh giá PnL; DB position sum chỉ tham khảo khi `fill_verified=true`.*
