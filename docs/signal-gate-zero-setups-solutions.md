# Signal gate — 2 ngày không có setup: nguyên nhân & giải pháp

**Cập nhật:** 2026-05-24

## Triệu chứng

- Chạy ~2 ngày sau reset stack 5m/15m/1h: **0 PASS**, **0 lệnh**.
- Chart BTC biến động ~3–4% nhưng dashboard luôn BLOCK.
- Thỉnh thoảng log có **grade A breakout** vẫn BLOCK vì `Regime range không thuộc trend`.

## Nguyên nhân gốc (3 lớp chồng)

| # | Vấn đề | Chi tiết |
|---|--------|----------|
| 1 | **Regime `trend` quá khó** | 1h cần slope regression > **0.15%** trên 50 nến — BTC gần đây ~**0.05–0.08%** → luôn `range`. |
| 2 | **`V3_ALLOWED_REGIMES=trend`** | Setup đẹp trong `range` → BLOCK dù giá dump/pump mạnh. |
| 3 | **Playbook strict** | Sweep cần wick+body đúng 1 nến; ~95% scan = Grade D. |

Căn HTF (`V3_LTF_ALIGN_REGIME_HTF=1h`) **không giúp** khi 1h cũng bị classify range.

## Giải pháp đã triển khai (profile 6.15 — cân bằng)

### A. Ngưỡng trend theo TF (env)

```env
V3_REGIME_TREND_MIN_1H=0.06
V3_REGIME_TREND_MIN_15M=0.08
V3_REGIME_TREND_MIN_5M=0.10
V3_REGIME_STRONG_TREND_MIN=0.25
```

### B. Breakout B+ bypass regime (mặc định bật khi `V3_ALLOWED_REGIMES=trend`)

Khi **15m/1h/5m** có `breakout_volume` **grade A hoặc B** (vol ≥1.5x, close phá vùng):

- `gateRegime` = **trend** cho pass (LTF vẫn hiển thị `range` trên UI).
- Log: `breakout B → gate trend`.

Giữ PnL+: không bypass sweep yếu; vẫn cần grade ≥ B, conf ≥ 70%.

Tắt: `V3_BREAKOUT_REGIME_BYPASS=false`

### C. Fast sample (chỉ test pipeline — không đánh giá edge)

```env
V3_TEST_FAST_SAMPLE=true
```

→ grade ≥ C, regime trend+range, conf ≥ 55%. **Không** dùng để kết luận win rate.

## Kỳ vọng sau deploy

| Metric | Trước | Sau (ước lượng) |
|--------|-------|------------------|
| PASS / ngày | ~0 | 2–8 khi có impulse breakout |
| Lệnh / tuần | 0 | 5–15 (tùy LLM veto + execution) |

## Theo dõi

```bash
grep "PASS\|breakout.*gate trend" backend/logs/worker-out.log | tail -20
curl -s http://127.0.0.1:3000/api/dashboard/signals?symbol=BTC | jq '.data[0].pass, .data[0].reasonCodes'
```

## Execution layer (groq-dispatch)

After signal gate PASS with `gateRegime=trend` (breakout bypass), LLM dispatch must use **`signalResult.gateRegime`**, not `setupResult.regime`, for `V3_BLOCK_RANGE_ENTRIES`. Fixed 2026-05-26 — keep `V3_BLOCK_RANGE_ENTRIES=true` on PnL+.

## Rollback

```env
V3_BREAKOUT_REGIME_BYPASS=false
V3_REGIME_TREND_MIN_1H=0.15
V3_REGIME_TREND_MIN_15M=0.15
```

Hoặc profile 6.1 cũ (strict) trong `docs/v3-5m-reset-plan.md`.
