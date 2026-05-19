# V3 Operations Reference

Operational behavior for Big Update v3 (BTC-only, Kim Nghia, Binance Futures testnet).

## Pipeline (worker)

```
MarketScan (*/5) → Signal Gate cache (15m/1h/4h parallel)
       ↓
LLMDispatch (2,17,32,47 * * * *) → best PASS timeframe only → Groq → executeV3Trade
       ↓
Binance limit order + pending → WS fill → open position + SL/TP on Binance
       ↓
PositionMonitor (*/1) → HOLD / REDUCE / EXIT (executes on Binance when not hold)
```

## Schedulers

| Scheduler | Cron | Notes |
|-----------|------|--------|
| MarketScan | `*/5 * * * *` | Fetches 3 TFs in parallel; runs immediately on worker start |
| LLMDispatch | `2,17,32,47 * * * *` | +2 min after scan boundary; **one** best TF per cycle |
| PositionMonitor | `*/1 * * * *` | Mark price refresh; REDUCE 50% or EXIT via market close |

Dashboard `lastRun` for schedulers uses in-memory **heartbeats** (`utils/scheduler-heartbeat.ts`), with DB fallbacks when worker just restarted.

## Key modules (May 2026)

| Area | Module |
|------|--------|
| Signal gate env | `signal-gate.service.ts` ← `MIN_SIGNAL_GRADE`, `MIN_SIGNAL_CONFIDENCE` via `getRiskPolicy()` |
| Best-of ranking | `utils/signal-gate-ranking.ts` (dashboard + LLM) |
| R:R from prices | `utils/trade-levels.ts` — `reconcileExpectedRr()` overwrites LLM `expected_rr`; blocks if below `MIN_RR_RATIO` |
| Trade execution | `v3-trade-execution.service.ts` — Binance limit + pending (not local-only position) |
| Fill / position | `binance-order-fill.service.ts`, `position-close.service.ts` |
| WS sync | `binance-websocket-sync.ts` — SL/TP fill closes local position; `ACCOUNT_UPDATE` zero position sync |
| Exposure cap | `config/risk-policy.ts` — `MAX_TOTAL_EXPOSURE_USD` (open + pending notional) |
| Hedge mode | `binance-hedge-mode.ts` — `getDualSidePosition()` on worker startup |

## Environment (risk / gate)

See `backend/.env.example`:

- `MIN_SIGNAL_GRADE` — `A` \| `B` \| `C` \| `D` (gate minimum)
- `MIN_SIGNAL_CONFIDENCE` — 0–1 (production: `0.7` with `MIN_SIGNAL_GRADE=B` so grade B at conf 0.70 can pass)
- `MAX_POSITIONS_PER_SYMBOL`, `MAX_TOTAL_EXPOSURE_USD`
- `BINANCE_ENABLED=true` for real testnet orders
- Safety: do **not** set `DISABLE_SIGNAL_GATE`, `DISABLE_RISK_CHECK`, `DISABLE_MEMORY_LAYER`

## Maintenance scripts

```bash
cd backend
npm run testnet:cleanup          # phantom positions, recover filled pending
npx tsx scripts/pipeline-v3-test.ts   # one-shot pipeline smoke
```

## Deploy

Backend only on VPS: `scripts/deploy.sh`. Frontend on Vercel: git push. See `docs/deployment.md`.
