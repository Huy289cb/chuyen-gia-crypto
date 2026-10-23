# Pending limit order lifecycle (PnL+)

> **Cooldown giao dịch:** [Chính sách rủi ro đã được người dùng chốt](runtime-risk-policy.md) — cooldown **1h**, ngày **10%**, mỗi lệnh **3% số dư**, cap USD để rỗng. Không áp dụng lại mức cũ từ default hoặc báo cáo lịch sử.

Unfilled Binance **GTC limit** orders are managed so they do not block the pipeline indefinitely or fill on stale setups.

## Pipeline interaction

```
MarketScan / LLMDispatch (new trades)
  ↓ blocked only when open position OR pending still exists after review
PendingOrderScheduler (*/5)
  1. TTL + price drift cancel (deterministic)
  2. LLM pending review (hold / cancel / modify)
LLMDispatch start (when pending existed)
  → runs lifecycle + review before skip-new-trade
```

## Schedulers

| Scheduler | Cron | Role |
|-----------|------|------|
| `PendingOrderScheduler` | `*/5 * * * *` (env: `PENDING_ORDER_LIFECYCLE_CRON`) | TTL, drift, LLM review |
| `LLMDispatch` | offset +1 min after scan | Same lifecycle/review if pending before skip |

## TTL (default)

| Timeframe (from `pending_order_linked` event) | Max age |
|-----------------------------------------------|---------|
| 5m | 4 h |
| 15m | 6 h |
| 1h | 24 h |
| unknown / other | 48 h (`PENDING_ORDER_TTL_MAX_HOURS`) |

## Price drift

Cancel when `|mark - entry| / entry >= PENDING_ORDER_DRIFT_PCT` (default **0.8%**).

## LLM review (Sprint 2)

- Runs after TTL/drift pass if orders still `pending`.
- Actions: `hold`, `cancel` (Binance + DB), `modify` (DB SL/TP/entry only — **exchange limit price unchanged**).
- Min confidence: `PENDING_ORDER_REVIEW_MIN_CONFIDENCE` (default **0.7**).
- Models: `GROQ_MODEL_AUXILIARY` (default `openai/gpt-oss-20b`) then
  `openai/gpt-oss-120b`; retired Llama IDs are filtered before requests.

Disable: `PENDING_ORDER_REVIEW_ENABLED=false`.

## Environment

```env
PENDING_ORDER_LIFECYCLE_ENABLED=true
PENDING_ORDER_LIFECYCLE_CRON=*/5 * * * *
PENDING_ORDER_TTL_HOURS_5M=4
PENDING_ORDER_TTL_HOURS_15M=6
PENDING_ORDER_TTL_HOURS_1H=24
PENDING_ORDER_TTL_MAX_HOURS=48
PENDING_ORDER_DRIFT_PCT=0.008

PENDING_ORDER_REVIEW_ENABLED=true
PENDING_ORDER_REVIEW_MIN_CONFIDENCE=0.7
```

## Telegram

- Limit placed / fill / close: enriched fields (side, volume, SL/TP, balance, PnL).
- Pending cancel: `ttl_expired`, `price_drift`, `ai_review`.

## Modules

| File | Role |
|------|------|
| `config/pending-order-policy.ts` | TTL / drift / review env |
| `services/pending-order-actions.ts` | Binance cancel + DB + Telegram |
| `services/pending-order-lifecycle.service.ts` | TTL + drift |
| `services/pending-order-review.service.ts` | LLM review |
| `schedulers/pending-order.scheduler.ts` | Cron wrapper |
| `utils/pending-order-decisions.ts` | Parse/apply LLM decisions |

See also [pnl-plus-p0-plan.md](./pnl-plus-p0-plan.md) (PnL measurement) and [v3-operations.md](./v3-operations.md).
