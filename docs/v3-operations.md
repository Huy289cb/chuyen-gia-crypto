# V3 Operations Reference

Operational behavior for Big Update v3 (BTC-only, Kim Nghia, Binance Futures testnet).

**Signal gate stack (May 2026):** `5m`, `15m`, `1h` — see [v3-5m-reset-plan.md](./v3-5m-reset-plan.md).

## Pipeline (worker)

```
MarketScan (*/5) → Signal Gate cache (5m/15m/1h parallel)
       ↓
LLMDispatch (1,6,11,…56 * * * *) → best PASS timeframe → HTF 1h trend guard → Groq → executeV3Trade
       ↓
Binance limit order + pending → WS fill → open position + SL/TP on Binance
       ↓
PendingOrderLifecycle (*/5) → TTL / drift cancel → optional LLM pending review
       ↓
PositionMonitor (*/1) → defer to exchange SL/TP (PnL+ P0: reduce/exit off by default)
```

## Schedulers

| Scheduler | Cron | Notes |
|-----------|------|--------|
| MarketScan | `*/5 * * * *` | Fetches 3 TFs in parallel; runs immediately on worker start |
| LLMDispatch | `1,6,11,16,21,26,31,36,41,46,51,56` | +1 min after each 5m scan; **one** best TF per cycle; lifecycle/review if pending |
| PendingOrderLifecycle | `*/5 * * * *` | TTL + drift + LLM review — see [pending-order-lifecycle.md](./pending-order-lifecycle.md) |
| PositionMonitor | `*/1 * * * *` | Mark refresh; REDUCE/EXIT only if env enabled |

Env overrides: `V3_MARKET_SCAN_CRON`, `V3_LLM_DISPATCH_CRON`, `V3_SIGNAL_GATE_TIMEFRAMES`.

**MarketScan snapshot vs duplicate:** Re-scans on the same closed bar hit the signal-gate in-memory duplicate branch (`isDuplicate`). The scheduler keeps the last **fresh** `PASS + shouldCallGroq` snapshot for that bar’s open timestamp so LLMDispatch is not starved before the next bar closes. Cache TTL: `SIGNAL_GATE_CACHE_TTL_MS` (default 5 min when 5m in stack).

Dashboard `lastRun` for schedulers uses in-memory **heartbeats** (`utils/scheduler-heartbeat.ts`), with DB fallbacks when worker just restarted.

**Telegram (verbose):** Signal gate digest at most **once per 15 minutes** from MarketScan. Each LLM dispatch cron run sends **one** `LLM Dispatch — kết quả` summary.

## Key modules (May 2026)

| Area | Module |
|------|--------|
| Timeframes | `config/v3-schedulers.ts` — `getV3SignalGateTimeframes()` |
| HTF guard | `V3_REQUIRE_HTF_TREND=1h` in `groq-dispatch.service.ts` |
| Signal gate env | `signal-gate.service.ts` ← `MIN_SIGNAL_GRADE`, `MIN_SIGNAL_CONFIDENCE` |
| Best-of ranking | `utils/signal-gate-ranking.ts` — `V3_TF_PRIORITY` |
| R:R from prices | `utils/trade-levels.ts` |
| Trade execution | `v3-trade-execution.service.ts` |
| Fill / position | `binance-order-fill.service.ts`, `position-close.service.ts` |
| Pending lifecycle | `pending-order-lifecycle.service.ts`, `pending-order-review.service.ts` |
| PnL backfill | `position-pnl-backfill.service.ts`, `npm run testnet:backfill-pnl` — [pnl-backfill.md](./pnl-backfill.md) |
| Pending limits | [pending-order-lifecycle.md](./pending-order-lifecycle.md) |
| WS sync | `binance-websocket-sync.ts` |
| P0 policy | [pnl-plus-p0-plan.md](./pnl-plus-p0-plan.md) |

### Maintenance (PnL measurement)

**Tracking:** live checklist + metrics — [pnl-plus-tracking.md](./pnl-plus-tracking.md) (wallet-first; cập nhật sau mỗi reconcile).

After deploy when `trade_outcomes` is empty but positions were closed in DB:

```bash
cd backend
npm run testnet:backfill-pnl -- --dry-run   # preview
npm run testnet:backfill-pnl                # apply + sync wallet from Binance
```

Going forward, reconciliation merge and phantom close paths record PnL via `closeDuplicateForMerge` / `closeLocalPosition`.

## Reset for 5m experiment

```bash
cd backend && npm run v3:reset-5m
pm2 delete crypto-api crypto-worker; pm2 start ecosystem.config.cjs && pm2 save
```

## Environment (5m stack + P0)

```env
V3_SIGNAL_GATE_TIMEFRAMES=5m,15m,1h
V3_TF_PRIORITY=5m,15m,1h
V3_LLM_DISPATCH_CRON=1,6,11,16,21,26,31,36,41,46,51,56
SIGNAL_GATE_CACHE_TTL_MS=300000
V3_REQUIRE_HTF_TREND=1h
V3_ALLOWED_REGIMES=trend
POSITION_MONITOR_ALLOW_REDUCE=false
POSITION_MONITOR_ALLOW_EXIT=false
PHANTOM_REOPEN_ENABLED=false
```

## Telegram AI runbook

Plan chi tiết: [plan/telegram-ai-qa.md](./plan/telegram-ai-qa.md)

| Triệu chứng | Kiểm tra | Hành động |
|-------------|----------|-----------|
| `/ai` không phản hồi | `TELEGRAM_AI_ENABLED`, `GROQ_API_KEY*` | Bật env, `pm2 reload --update-env` |
| Rate limit liên tục | Log `[TelegramAI]` | Tăng `TELEGRAM_AI_RATE_LIMIT_*` hoặc đợi reset ICT midnight |
| Job treo >60s | Log `timedOut=true` | `/ai cancel`, kiểm tra Groq quota |
| Hallucination số liệu | Prompt version | Tăng `TELEGRAM_AI_SYSTEM_PROMPT_VERSION`, tune `ai-prompts.ts` |
| `/fix` không tạo PR | `CURSOR_*` env, job `#` trong DB | `/fix status`, kiểm tra repo access + API key |
| Worker OOM | `pm2 logs`, memory | Giữ `TELEGRAM_AI_ENABLED=false` nếu RAM thấp; 1 job/chat |

**Cost monitor:** Groq dashboard (ops Q&A) + Cursor dashboard (cloud agent runs).

**Security:** Read-only context — không gọi `executeV3Trade`. Secrets redacted trong context builder.
