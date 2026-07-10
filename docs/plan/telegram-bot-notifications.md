# Kế hoạch Telegram notification & report

> Checklist triển khai: [telegram-bot-checklist.md](./telegram-bot-checklist.md)

## Bối cảnh hiện tại

- **Không có** Telegram / webhook / notifier trong repo (`backend/package.json` chỉ có `axios`, `node-cron`).
- Luồng giao dịch v3: worker → `executeV3Trade` → pending → **API process** WebSocket fill → position + SL/TP → `position-monitor` đóng lệnh.
- Audit trail: `recordTestnetTradeEvent` + `console.log`; dashboard đọc DB qua `backend/src/routes/dashboard.ts`.
- PnL dashboard: **UTC midnight**; Telegram dùng **ICT (GMT+7)**.
- Báo cáo 21:00 ICT = cron `0 21 * * *` với `timezone: 'Asia/Ho_Chi_Minh'`.

## Kiến trúc

| File | Vai trò |
|------|---------|
| `backend/src/config/telegram.ts` | Env + validate |
| `backend/src/services/telegram/telegram-client.ts` | axios Bot API |
| `backend/src/services/telegram/message-formatters.ts` | Template VN |
| `backend/src/services/telegram/telegram-notify.service.ts` | notify + dedup |
| `backend/src/services/account-summary.service.ts` | PnL ICT |
| `backend/src/services/system-health.service.ts` | pipeline/health |
| `backend/src/services/telegram/telegram-bot.service.ts` | polling + commands |
| `backend/src/schedulers/telegram-daily-report.scheduler.ts` | cron 21:00 ICT |
| `backend/src/services/telegram/telegram-hooks.ts` | hook helpers |

## Process split

| Thành phần | Process |
|------------|---------|
| Notify realtime | API + Worker |
| Daily report + bot polling | Worker leader only |

## Lệnh bot

`/lenh`, `/show`, `/pnl`, `/pipeline`, `/sukien`, `/help`, `/tat`, `/bat`

## Thứ tự triển khai

1. Config + telegram-client + notify
2. account-summary + system-health
3. Hooks giao dịch + verbose
4. Daily report + bot commands
5. Wire worker/API + docs + tests
