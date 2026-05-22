# PnL+ Phase 0 Plan

**Status:** Implemented (code + env)  
**Deploy:** Run `./scripts/deploy.sh` after review (use `DEPLOY_SKIP_PULL=1` if deploying local commits not yet pushed)

## Goal

Stop behaviors that destroy PnL **before** optimizing for more profit. Phase 0 is defensive: fewer bad entries, no phantom accounting, exchange-first exits, enforced cooldown.

## Evidence that motivated P0

| Issue | Symptom |
|-------|---------|
| PositionMonitor | Multi-reduce, early exit, ~0% PnL churn |
| Phantom close | DB TP +$11 → reopen → real loss -$14 |
| Range trading | 98% scans BLOCK/range; executed trades lost |
| Overtrade | LLM 88% conf, same-side stacking |
| Accounting | `realized_pnl` ≠ wallet |

## P0 scope (4 pillars)

### P0.1 — Trend-only entries

| Item | Implementation |
|------|----------------|
| Allowed regimes | `V3_ALLOWED_REGIMES=trend` (default). `range`/`chop`/`unknown` blocked at gate + dispatch |
| Signal gate | `signal-gate.service.ts` reads allowed regimes from `v3-entry-policy.ts` |
| LLM dispatch | `groq-dispatch.service.ts` rejects non-trend before confirm |
| Grade | `MIN_SIGNAL_GRADE=B` (unchanged) |

**Env:**

```env
V3_ALLOWED_REGIMES=trend
V3_BLOCK_RANGE_ENTRIES=true
```

**Verify:**

- Logs: `Regime X blocked` or gate BLOCK in range
- No new `Binance pending order` when only range PASS on dashboard

---

### P0.2 — No phantom PnL

| Item | Implementation |
|------|----------------|
| Paper SL/TP on candle | Already skipped when `BINANCE_ENABLED=true` (`testnet-sync.ts`) |
| WS close | Only if `binance_order_id` matches SL/TP/entry (`position-close.service.ts`) |
| ACCOUNT_UPDATE close | Verify `positionAmt==0` on Binance before DB close |
| Phantom reopen | **Disabled** unless `PHANTOM_REOPEN_ENABLED=true` (`binance-reconciliation.ts`) |
| Unverified SL/TP close | Block `closeLocalPosition` for `stop_loss`/`take_profit` without Binance proof |

**Env:**

```env
PHANTOM_REOPEN_ENABLED=false
BINANCE_ENABLED=true
```

**Verify:**

- No `reconciliation_reopened` in logs after deploy
- No `position_closed` with `source: paper_candle_simulation` when Binance on
- `trade_outcomes` only after verified close paths

---

### P0.3 — PositionMonitor: emergency only

| Item | Implementation |
|------|----------------|
| REDUCE | Off unless `POSITION_MONITOR_ALLOW_REDUCE=true` |
| EXIT | Off unless `POSITION_MONITOR_ALLOW_EXIT=true` (default **false**) |
| Defer | `POSITION_MONITOR_DEFER_TO_EXCHANGE_SLTP=true` when SL+TP order ids exist |
| Min age | `POSITION_MONITOR_MIN_MINUTES=30` |

**Env:**

```env
POSITION_MONITOR_ALLOW_REDUCE=false
POSITION_MONITOR_ALLOW_EXIT=false
POSITION_MONITOR_DEFER_TO_EXCHANGE_SLTP=true
POSITION_MONITOR_MIN_MINUTES=30
```

**Verify:**

- Startup log: `allow_reduce=false allow_exit=false defer_sl_tp=true`
- No `Reduced ` / `position_monitor_exit` in logs
- Log: `deferring to exchange SL/TP` while position open

---

### P0.4 — Cooldown + exposure caps

| Item | Implementation |
|------|----------------|
| Max positions/symbol | `MAX_POSITIONS_PER_SYMBOL=1` |
| Consecutive loss cooldown | `MAX_CONSECUTIVE_LOSSES=2` → set `cooldown_until` on close (`account-risk-guard` + `testnet.repository`) |
| Cooldown hours | `CONSECUTIVE_LOSS_COOLDOWN_HOURS=4` |
| Exposure cap | `MAX_EXPOSURE_PCT_OF_EQUITY=0.15` (15% of wallet, replaces flat $2000 cap when set) |
| Account guard | `assertTestnetAccountCanOpenTrade` in Groq + V3 execution |
| Skip LLM if open/pending | `llm-dispatch.scheduler.ts` skips dispatch when position/pending exists |

**Env:**

```env
MAX_POSITIONS_PER_SYMBOL=1
MAX_CONSECUTIVE_LOSSES=2
CONSECUTIVE_LOSS_COOLDOWN_HOURS=4
MAX_EXPOSURE_PCT_OF_EQUITY=0.15
```

**Verify:**

- After 2 losses: `cooldown_until` set, LLM/V3 blocked with cooldown reason
- Exposure: order blocked if open+pending notional > 15% equity
- `LLMDispatch` skip log when same symbol already open

---

## Files changed (P0)

| File | Change |
|------|--------|
| `docs/pnl-plus-p0-plan.md` | This plan |
| `backend/src/config/v3-entry-policy.ts` | Trend/regime + exposure % helpers |
| `backend/src/config/position-monitor-policy.ts` | EXIT default false |
| `backend/src/config/risk-policy.ts` | `maxExposurePercentOfEquity` |
| `backend/src/services/signal-gate.service.ts` | Allowed regimes from env |
| `backend/src/services/account-risk-guard.service.ts` | Cooldown + consecutive loss guard |
| `backend/src/services/groq-dispatch.service.ts` | Trend-only, account guard, regime in decisions |
| `backend/src/services/v3-trade-execution.service.ts` | Exposure %, account guard |
| `backend/src/services/position-close.service.ts` | Verified close only, cooldown after losses |
| `backend/src/services/binance-reconciliation.ts` | Phantom reopen gated |
| `backend/src/schedulers/llm-dispatch.scheduler.ts` | Skip when open/pending |
| `backend/src/repositories/testnet.repository.ts` | Cooldown threshold from risk policy |
| `backend/.env.example` | P0 env documentation |
| `backend/.env` | Production P0 values (VPS) |

---

## Double-check checklist (post-deploy)

```bash
# 1. Monitor config
grep "PositionMonitor\] Starting scheduler" backend/logs/worker-out.log | tail -1
# Expect: allow_reduce=false allow_exit=false defer_sl_tp=true

# 2. No monitor churn (24h)
grep -E "Reduced |position_monitor_exit" backend/logs/worker-out.log | tail -5
# Expect: empty or only pre-P0 timestamps

# 3. No phantom reopen
grep "reconciliation_reopened\|phantom" backend/logs/worker-out.log | tail -5

# 4. Outcomes growing
cd backend && node -e "const {PrismaClient}=require('@prisma/client');new PrismaClient().tradeOutcome.count().then(console.log).finally(()=>process.exit())"

# 5. API health
curl -s http://127.0.0.1:3000/health

# 6. Regime blocks
grep "blocked for entries\|not in V3_ALLOWED_REGIMES" backend/logs/worker-out.log | tail -5
```

---

## Out of scope (P1+)

- Auto-block playbook from `trade_outcomes` stats (needs ≥30 samples)
- Dashboard PnL from outcomes only (partial in P0 memory filter)
- Leverage reduction (manual env `BINANCE_LEVERAGE`)
- Backfill historical `trade_outcomes`

---

## Rollback

| Rollback | Env change |
|----------|------------|
| Allow range again | `V3_ALLOWED_REGIMES=trend,range` |
| Re-enable monitor exit | `POSITION_MONITOR_ALLOW_EXIT=true` |
| Phantom reopen | `PHANTOM_REOPEN_ENABLED=true` |
| More exposure | `MAX_EXPOSURE_PCT_OF_EQUITY=0.4` or unset + `MAX_TOTAL_EXPOSURE_USD=2000` |

---

## Success criteria (7 days)

1. **0** monitor-driven reduces/exits (unless EXIT explicitly enabled)
2. **0** phantom reopen events
3. **≥80%** no-trade reasons cite regime/cooldown/exposure (not execution bugs)
4. New closes all have `trade_outcomes` rows
5. Expectancy measurable with trend-only sample (target: ≥15 closed trades before judging edge)
