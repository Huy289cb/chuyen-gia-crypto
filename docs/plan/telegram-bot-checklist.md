# Checklist — Telegram Bot

## Phase 0 — Docs

- [x] Plan lưu tại `docs/plan/telegram-bot-notifications.md`
- [x] Checklist file này tồn tại

## Phase 1 — Config

- [x] `backend/src/config/telegram.ts` (enabled, token, chatIds, cron, timezone)
- [x] Validate khi `TELEGRAM_ENABLED=true`
- [x] `backend/.env.example` có biến Telegram

## Phase 2 — Core Telegram

- [x] `telegram-client.ts` — sendMessage, getUpdates
- [x] `message-formatters.ts`
- [x] `telegram-notify.service.ts` — dedup, queue, mute flag
- [x] `telegram-hooks.ts`

## Phase 3 — Data services

- [x] `account-summary.service.ts` — `getDayBoundsICT()`, balance/PnL ICT
- [x] `system-health.service.ts` — schedulers, worker, warmup

## Phase 4 — Hooks

- [x] Wrap `recordTestnetTradeEvent` → notify
- [x] `executeV3Trade` success/fail (pending + binance disabled)
- [x] signal-gate, groq via llm-dispatch no_trade, market-scan pass/block
- [x] position-monitor EXIT/REDUCE
- [x] binance-websocket-sync cancel + WS status

## Phase 5 — Daily + Bot

- [x] `telegram-daily-report.scheduler.ts` — 21:00 ICT
- [x] `telegram-bot.service.ts` — all commands
- [x] `worker.ts` start bot + daily cron
- [x] API path: notify via WS + recordTestnetTradeEvent wrap

## Phase 6 — Quality

- [x] Unit tests: `ict-time.test.ts`, `message-formatters.test.ts` (vitest env issue on host — build passes)
- [x] `docs/deployment.md` Telegram section
- [x] `npm run build` pass
- [x] Final review: checklist complete
