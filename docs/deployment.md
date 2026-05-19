# Deployment

## Overview

| Target | What deploys | How |
|--------|----------------|-----|
| **Frontend** | Next.js dashboard (`frontend/`) | **Vercel** — push to git (connected branch); no VPS build |
| **Backend** | Express API + worker (`backend/`) | **VPS** — `scripts/deploy.sh` or `~/deploy.sh` |

Production API is proxied by Nginx to `127.0.0.1:3000`. PM2 runs two processes from `backend/ecosystem.config.cjs`:

- `crypto-api` — HTTP, Binance user-data WebSocket, reconciliation
- `crypto-worker` — MarketScan, LLMDispatch, PositionMonitor, price sync

## VPS backend deploy

Script (source of truth): `scripts/deploy.sh`

```bash
~/deploy.sh
# or
cd ~/chuyen-gia-crypto && ./scripts/deploy.sh
```

Default flow:

1. `git pull --ff-only origin develop`
2. Verify `backend/.env` exists
3. `npm ci` (or `npm install`)
4. `rm -rf dist && npm run build` (Prisma generate + `tsc`)
5. `pm2 reload ecosystem.config.cjs --update-env` (or `start` first time)
6. `pm2 save`
7. Wait for `GET http://127.0.0.1:3000/health` → 200
8. Print `pm2 status` + last 20 worker log lines (non-blocking)

### Optional environment flags

```bash
DEPLOY_BRANCH=develop ~/deploy.sh       # default branch
DEPLOY_SKIP_PULL=1 ~/deploy.sh          # build + reload only
DEPLOY_DB_PUSH=1 ~/deploy.sh            # run `npx prisma db push` when schema changed
DEPLOY_FLUSH_LOGS=1 ~/deploy.sh         # pm2 flush (default: keep logs)
```

### After deploy

```bash
pm2 status
pm2 logs crypto-api --lines 50 --nostream
pm2 logs crypto-worker --lines 50 --nostream
curl -s http://127.0.0.1:3000/health | jq .
```

### Schema changes

Repo may not have committed `prisma/migrations/` yet. For schema updates on VPS:

```bash
cd backend && npx prisma db push
```

Or use `DEPLOY_DB_PUSH=1` with deploy script.

## Frontend (Vercel)

1. Commit and push to the branch Vercel watches (e.g. `develop` / `main`).
2. Set **Environment variables** in Vercel project settings:
   - `NEXT_PUBLIC_API_URL` — production API base (e.g. `https://api.yourdomain.com/api`)
3. Vercel runs `npm run build` in `frontend/` automatically.

Local dev: frontend `:3001`, backend `:3000` — browser uses same-origin `/api` rewrite or `NEXT_PUBLIC_API_URL`.

## Nginx

Template: `backend/deploy/nginx.conf` or `deploy/nginx.conf`

- Upstream: `127.0.0.1:3000` (API only; worker has no public port)
- Health: `/health` → backend

## Operational logs (not errors)

`[MarketScan] Previous scan still running, skipping cycle` — **warning** when a 5-minute cron fires while the previous scan (~60s after restart) is still running. Safe to ignore unless it happens every cycle (scan slower than 5 minutes).

## Telegram bot (optional)

Plan: `docs/plan/telegram-bot-notifications.md`

1. Create bot via [@BotFather](https://t.me/BotFather), copy token.
2. Message the bot, then read `chat_id` from `getUpdates` or [@userinfobot](https://t.me/userinfobot).
3. Set in `backend/.env` on **both** PM2 processes (`crypto-api` + `crypto-worker`):

```bash
TELEGRAM_ENABLED=true
TELEGRAM_BOT_TOKEN=...
TELEGRAM_CHAT_IDS=123456789
TELEGRAM_NOTIFY_LEVEL=verbose
TELEGRAM_DAILY_REPORT_CRON=0 21 * * *
```

- **Worker**: daily report (21:00 ICT), bot commands (`/lenh`, `/show`, …), trade hooks from schedulers.
- **API**: WebSocket fill/close notifications when `BINANCE_ENABLED=true`.
- PnL in Telegram uses **GMT+7** day boundary (dashboard API stays UTC).

Commands: `/help`, `/lenh`, `/show`, `/pnl`, `/pipeline`, `/sukien`, `/baocao`, `/tat`, `/bat`.

See also: `docs/v3-operations.md`, `docs/setup.md`, `docs/binance-testnet-integration.md`.
