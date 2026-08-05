# PnL expectancy monitoring (P0/P1 + pullback)

Track after deploy of:

1. Invalidation **exit-only** (no `tighten_be`)
2. Any-side post-close cooldown (4h / 6h loss)
3. Profit-protect BE@1.5R + trail P0
4. **Trend pullback entry** (EMA band; replaces range-extension FOMO) — [v3-trend-pullback-entry.md](./v3-trend-pullback-entry.md)
5. **Phase 0 circuits + expectancy** (growth track 100–200%/60d) — below

## Phase 0 circuits (entry soft-block)

Wired in `assertTestnetAccountCanOpenTrade` + pre-LLM `canRunLlmDispatchForSymbol`:

| Circuit | Env | Default | Action |
|---------|-----|---------|--------|
| Daily loss | `DAILY_LOSS_LIMIT_PERCENT` | 3% (set in `.env`) | Block new entries rest of ICT day |
| Peak DD | `MAX_DRAWDOWN_PERCENT` | 15% | Block until equity recovers |
| Expectancy kill | last N closes `sumR <= MIN` | N=10, sumR≤−3 | Block + cooldown `CIRCUIT_EXPECTANCY_COOLDOWN_HOURS` (168h) |

Toggle: `CIRCUIT_DAILY_LOSS_ENABLED` / `CIRCUIT_DRAWDOWN_ENABLED` / `CIRCUIT_EXPECTANCY_KILL_ENABLED` (`false` to disable).

**Rebase at Phase 0 ship** (avoid lock on pre-plan history):

- `CIRCUIT_PEAK_EQUITY` — peak for DD = max(this, current); ignores older snapshot highs
- `CIRCUIT_EXPECTANCY_SINCE` — kill window only counts outcomes after this ISO time

**Risk stays 1%** until Phase 1 Pass (15–20 closes, avgR≥0) — then ladder 2%→3%. Do **not** raise `RISK_PER_TRADE_PERCENT` in Phase 0.

### Commands / API

```bash
cd backend && npm run metrics:expectancy -- --n=20
# or --days=14
curl -s localhost:3000/api/metrics/expectancy?n=20
curl -s localhost:3000/api/metrics/risk   # includes circuit block
```

## Horizon

- **Review cadence:** every closed trade (Telegram) + daily block counts + rollup after **15–20 closes** (or 14 days if &lt;10 fills).
- **Baseline wallet (pullback ship):** ~$35.84 vs starting $40 (2026-07-29).
- **Phase 1 plan (chi tiết):** [v3-trend-pullback-entry.md § Phase 1 — kế hoạch theo dõi & cải thiện](./v3-trend-pullback-entry.md#phase-1--kế-hoạch-theo-dõi--cải-thiện)

## Phase 1 improvement ladder (summary)

1. **Giữ** nếu Σ≥0 + có TP sau 15–20 lệnh.  
2. **Nới band (env)** nếu im lệnh vô lý khi giá gần SMA.  
3. **Siết band (env)** nếu chase/leak.  
4. **Phase 2 Fib** chỉ sau sample + ≥1 lần tune band mà vẫn fail entry quality.  
5. **Pause** nếu Σ âm rõ mà entry đã gần SMA (lỗi không phải pullback gate).

## Per-trade log

| Field | How |
|-------|-----|
| `position_id`, side, entry, SL, TP | DB / Telegram |
| Close reason | `invalidation_exit` / exchange SL / TP / `profit_protect` / reconcile |
| Realized PnL + R multiple | `(pnl) / initial_risk_usd` |
| MFE% / MAE% while open | optional: 15m highs/lows entry→close |
| **TP-after-exit?** | After close: did price hit original TP *without* hitting original SL? Y/N |
| Entry vs SMA | decision reason / log: `pullback … vs SMA20@15m` |
| Blocked entries same day | `V3_REQUIRE_PULLBACK` / `post-close cooldown` / `HTF side align` / legacy `extension` |

## Success criteria (15–20 trades post-pullback)

| Metric | Target | Fail signal |
|--------|--------|-------------|
| Full TP count | ≥1–2 | Still 0 after 20 trades + runners existed |
| Invalidation `tighten_be` | **0** | Any new → bug |
| Invalidation exits | Occasional small ± when score≥3 | Exits every chop → raise `MIN_SCORE` |
| FOMO re-entry &lt;4h after close | **0** fills | Cooldown bug |
| Pullback blocks | Some `no_trade` with `V3_REQUIRE_PULLBACK` on chase | Never fires + fills far above/below SMA |
| Fills near SMA | Most entries within band | Fills systematically outside → wire bug |
| Net expectancy | ≥0 over window | Still deeply negative → pause / Phase 2 Fib |

## Weekly checklist

1. Count closes by reason (`invalidation_exit` vs SL vs TP vs BE-protect).
2. For every early exit: **TP-after-exit?** column.
3. Grep: `V3_REQUIRE_PULLBACK`, `post-close cooldown`, `Invalidation] … EXIT`, `breakeven`.
4. Confirm env: `V3_REQUIRE_PULLBACK=true`, `V3_BLOCK_ENTRY_EXTENSION=false`, `PROFIT_PROTECT_BE_AT_R=2`, `PROFIT_PROTECT_TRAIL_ACTIVATE_PCT=1.6`, `INVALIDATION_ALLOW_EXIT=false`, `MIN_RR_RATIO=3`, `FUNDING_VETO_ENABLED=true`, CD 240/360.
5. Offense watch: LS playbook share up vs breakout; funding `no_trade` reasons; full-TP rate at RR3.
5. If longs still dominate losses after 20 trades → pause-long / stronger HTF (not first knob).

## Rollback knobs (env only)

| Symptom | Knob |
|---------|------|
| Too many invalidation exits | `INVALIDATION_ALLOW_EXIT=false` (TP-first default) or raise `MIN_SCORE` |
| Pullback too tight (zero fills, all near-SMA blocked) | Raise `V3_PULLBACK_MAX_ABOVE_PCT=0.4` / `MAX_BELOW_PCT=1.5` |
| Pullback too loose (chase fills) | Lower `MAX_ABOVE_PCT=0.15` or enable Phase 2 Fib |
| Revert to old FOMO % gate | `V3_REQUIRE_PULLBACK=false` + `V3_BLOCK_ENTRY_EXTENSION=true` |
| Cooldown too long | `POST_CLOSE_SAME_SIDE_COOLDOWN_MINUTES=180` |
| BE still early / scratch before TP | `PROFIT_PROTECT_BE_AT_R=2.5` or `PROFIT_PROTECT_ENABLED=false` |
| Want early BE again | `PROFIT_PROTECT_BE_AT_R=1.5` + `TRAIL_ACTIVATE_PCT=1.0` |

## Do not change yet

- Partial TP (min notional)
- `INVALIDATION_MIN_SCORE` back to 2
- LLM position manager
- Open range trading / disable `V3_REQUIRE_HTF_TREND`
