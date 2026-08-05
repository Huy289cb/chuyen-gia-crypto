# V3 Trend Pullback Entry (PnL+)

**Shipped:** 2026-07-29  
**Status:** Phase 1 live (EMA band). Fib impulse zone = Phase 2 (deferred).

## Why

Crude `V3_BLOCK_ENTRY_EXTENSION` (distance from 12×1h high/low) blocked FOMO dumps/pumps but also blocked valid continuations and did not encode **pullback-in-trend** — the entry style with strongest positive-expectancy literature support.

Phase 1 replaces that with: **only enter when price is near SMA20** (buy dip / sell rally), after HTF side-align already passed.

## Rule (Phase 1)

After LLM confirms + HTF side-align:

1. Load candles on `V3_PULLBACK_TF` (default `15m`).
2. `SMA = mean(close[-V3_PULLBACK_SMA_PERIOD:])` (default 20).
3. `distPct = (entry - SMA) / entry * 100`.

| Side | Pass when |
|------|-----------|
| Long | `-maxBelow ≤ distPct ≤ +maxAbove` |
| Short | `-maxAbove ≤ distPct ≤ +maxBelow` (near/above SMA, not chase dump) |

Defaults: `maxAbove=0.25%`, `maxBelow=1.0%`.

Fail → `no_trade` with reason containing `V3_REQUIRE_PULLBACK`.

## Relation to extension gate

| `V3_REQUIRE_PULLBACK` | Extension |
|----------------------|-----------|
| `true` (default) | Off unless `V3_BLOCK_ENTRY_EXTENSION=true` (AND both) |
| `false` | Legacy default on (`!== false`) |

Dispatch wiring: pullback **else** extension — not both unless extension forced on while pullback on.

## Code

| Piece | Path |
|-------|------|
| Pure policy | `backend/src/config/v3-entry-policy.ts` — `evaluateTrendPullbackEntry`, `smaFromCloses` |
| Wire | `backend/src/services/groq-dispatch.service.ts` (after HTF side-align) |
| Tests | `backend/tests/unit/v3-entry-policy.test.ts` |

## Env

```bash
V3_REQUIRE_PULLBACK=true
V3_PULLBACK_TF=15m
V3_PULLBACK_SMA_PERIOD=20
V3_PULLBACK_MAX_ABOVE_PCT=0.25
V3_PULLBACK_MAX_BELOW_PCT=1.0
V3_BLOCK_ENTRY_EXTENSION=false
```

## Rollback

```bash
V3_REQUIRE_PULLBACK=false
V3_BLOCK_ENTRY_EXTENSION=true
V3_MAX_ENTRY_EXTENSION_PCT=0.8
# pm2 restart crypto-api crypto-worker --update-env
```

## Monitoring

See [pnl-expectancy-monitoring.md](./pnl-expectancy-monitoring.md) — grep decisions for `V3_REQUIRE_PULLBACK` / `pullback`.

## Phase 1 — kế hoạch theo dõi & cải thiện

**Baseline ship:** 2026-07-29 ~24:00 VN · wallet ~$35.84 · `V3_REQUIRE_PULLBACK=true` · extension off.

**Không làm Phase 2** cho đến khi đủ sample Phase 1 (dưới đây).

### Cadence

| Khi | Việc |
|-----|------|
| Mỗi close | Ghi PnL, reason, entry vs SMA (từ decision), TP-after-exit? |
| Mỗi ngày | Đếm `no_trade` có `V3_REQUIRE_PULLBACK` vs `trade` fills |
| Sau **15–20 closes** (hoặc 14 ngày nếu &lt;10 fills) | Review expectancy → quyết định tune / giữ / Phase 2 / pause |

### Metrics Phase 1

| # | Metric | Cách lấy | Target |
|---|--------|----------|--------|
| M1 | Pullback block rate | decisions `reason` chứa `V3_REQUIRE_PULLBACK` / tổng LLM-confirm | &gt;0 khi có chase |
| M2 | Fill trong band | \|distPct\| khớp MAX_ABOVE/BELOW lúc entry | ≥90% fills |
| M3 | Σ realized (post-ship) | wallet / position PnL | ≥0 trên 15–20 lệnh |
| M4 | Full TP | close tại/near TP | ≥1–2 |
| M5 | Chase leak | fill với \|dist\| &gt; band (bug) hoặc vừa sát trần rồi SL nhanh | 0 bug; ít “vừa lọt rồi SL” |
| M6 | Im lệnh kéo dài | 0 fill + toàn block pullback trong khi price hay gần SMA | → nới band (env) |

### Cây quyết định cải thiện (chỉ env trước)

```
Sau 15–20 closes (hoặc 14d):
├─ Σ ≥ 0 và có ≥1 TP     → GIỮ Phase 1; không Phase 2
├─ 0 fill / gần mọi setup bị pullback dù giá gần SMA
│     → nới MAX_ABOVE 0.25→0.40 và/hoặc MAX_BELOW 1.0→1.5
│     → đo lại 10 lệnh; chưa đủ → mới xét Phase 2
├─ Nhiều fill đuổi (xanh ngắn rồi SL) / distPct hay sát MAX_ABOVE
│     → siết MAX_ABOVE 0.25→0.15
│     → nếu vẫn chase → Phase 2 Fib
├─ Σ < 0 rõ, entry OK (gần SMA) nhưng exit kém
│     → đừng đụng pullback; xem invalidation / BE / trail
└─ Σ < 0 + entry vẫn xấu sau siết band
      → pause live hoặc Phase 2; không nới FOMO extension
```

### Grep nhanh

```bash
# blocks / passes
pm2 logs crypto-worker --nostream --lines 2000 | grep -E 'PULLBACK|pullback'
# DB decisions (post-ship)
# reason ILIKE '%V3_REQUIRE_PULLBACK%' OR reason ILIKE '%pullback%'
```

### Eval hiệu quả / PnL+ proxy

```bash
cd backend
npm run test:run -- tests/unit/v3-entry-policy.test.ts
npm run eval:pullback              # expectancy R: take_all vs extension vs pullback
npm run eval:pullback:strict       # exit 1 nếu không PNL+_PROXY_YES
```

**PnL+ proxy YES chỉ khi:** `pullback.avgR > 0` **và** `pullback.avgR > take_all.avgR` **và** ≥5 lệnh enter.  
Nếu `PNL+_PROXY_NO` → Phase 1 **chưa** chứng minh hiệu quả trên sample counterfactual (không đủ để tin deploy đã PnL+).

Script: `scripts/eval-pullback-entry.ts`

### Phase 2 trigger (chỉ khi)

1. Phase 1 đã **≥15 closes**, **và**
2. Band đã tune ≥1 lần (siết) mà vẫn micro-chase, **hoặc** nới band vẫn 0 fill vô lý khi giá liên tục trong vùng giá trị.

Phase 2 = Fib 38–50% impulse (`utils/fibonacci.ts`) ± ATR band — **không** implement trước trigger.

## Phase 2 (deferred)

- Fib 38–50% impulse retracement (`utils/fibonacci.ts`) if EMA band still allows micro-chase after Phase 1 sample + env tune.
- ATR-based band width instead of fixed %.
