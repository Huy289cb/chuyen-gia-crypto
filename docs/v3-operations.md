# V3 Operations Reference

Operational behavior for Big Update v3 (BTC-only, Kim Nghia, Binance Futures testnet).

**Signal gate stack (May 2026):** `5m`, `15m`, `1h` — see [v3-5m-reset-plan.md](./v3-5m-reset-plan.md).

## Pipeline (worker)

```
MarketScan (*/5) → Signal Gate cache (5m/15m/1h parallel)
       ↓
LLMDispatch (1,6,11,…56 * * * *) → best PASS timeframe → HTF trend + side-align → **pullback EMA band** → LLM dispatch chain → executeV3Trade
       ↓
Binance limit order + pending → WS fill → open position + SL/TP on Binance
       ↓
PendingOrderLifecycle (*/5) → TTL / drift cancel → optional LLM pending review
       ↓
PositionMonitor (*/1) → profit-protect + invalidation exit-only → defer exchange SL/TP
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
| HTF guard | `V3_REQUIRE_HTF_TREND=1h` + `V3_REQUIRE_HTF_SIDE_ALIGN` in `groq-dispatch.service.ts` |
| Pullback entry | `V3_REQUIRE_PULLBACK` EMA band — [v3-trend-pullback-entry.md](./v3-trend-pullback-entry.md) |
| LLM dispatch chain | `groq-client.ts` — Scout → Cerebras → OpenRouter → Groq fallbacks — [llm-dispatch-providers.md](./llm-dispatch-providers.md) |
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
| Telegram PnL / trade history | `account-summary.service.ts`, `binance-trade-history.service.ts` — wallet-first, Binance rounds |
| Risk cooldown (Binance streak) | `account-risk-guard.service.ts` — `getBinanceLossStreak()` khi DB bookkeeping PnL=0 |

### Production fixes (2026-06)

| Area | Fix |
|------|-----|
| Telegram `/lenh`, `/show`, `/baocao` | PnL từ Binance equity delta + income rounds; không mix DB phantom sau bookkeeping close |
| Dashboard trade history | `fetchBinanceClosedTradeRounds` — demo API không filter `startTime`; aggregate theo fill `realizedPnl` |
| Phantom rounds | Dust filter + per-fill PnL; bỏ net-position drift (0.0001 BTC, PnL=0) |
| Consecutive loss cooldown | Streak từ Binance closed rounds khi close reason `reconciliation_bookkeeping` |
| LLM fallback | Scout → Cerebras gpt-oss → OpenRouter Scout → Groq 70B/Qwen — xem [llm-dispatch-providers.md](./llm-dispatch-providers.md) |

## LLM dispatch runbook

| Triệu chứng | Kiểm tra | Hành động |
|-------------|----------|-----------|
| Dispatch fail toàn bộ | Log `All dispatch providers failed` | Kiểm tra quota Groq; `CEREBRAS_API_KEY`, `OPENROUTER_API_KEY` |
| Scout empty body trên Groq | Log model `openai/gpt-oss-120b` | Chỉ dùng cho levels adapter; dispatch primary vẫn Scout |
| Cerebras trả hold/zeros | Thiếu `json_object` | Đã bật trong `cerebras-client.ts` |
| OpenRouter 402 | Credits hết | Nạp credit hoặc `OPENROUTER_DISPATCH_FALLBACK_ENABLED=false` |
| OpenRouter 429 free | Model `:free` | Dùng paid Scout `meta-llama/llama-4-scout` |

**Benchmark:** `cd backend && npm run smoke:llm-providers`

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
V3_TF_PRIORITY=15m,1h,5m
V3_LLM_DISPATCH_CRON=1,6,11,16,21,26,31,36,41,46,51,56
SIGNAL_GATE_CACHE_TTL_MS=300000
V3_REQUIRE_HTF_TREND=1h
V3_REQUIRE_HTF_SIDE_ALIGN=true
V3_REQUIRE_PULLBACK=true
V3_PULLBACK_TF=15m
V3_PULLBACK_SMA_PERIOD=20
V3_PULLBACK_MAX_ABOVE_PCT=0.25
V3_PULLBACK_MAX_BELOW_PCT=1.0
V3_BLOCK_ENTRY_EXTENSION=false
V3_ALLOWED_REGIMES=trend
PROFIT_PROTECT_BE_AT_R=1.5
INVALIDATION_ALLOW_EXIT=true
INVALIDATION_MIN_SCORE=3
POSITION_MONITOR_ALLOW_REDUCE=false
POSITION_MONITOR_ALLOW_EXIT=false
PHANTOM_REOPEN_ENABLED=false
```

PnL+ tracking: [pnl-expectancy-monitoring.md](./pnl-expectancy-monitoring.md) · pullback: [v3-trend-pullback-entry.md](./v3-trend-pullback-entry.md)

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
