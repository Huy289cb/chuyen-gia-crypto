# Deployment

## Database (PostgreSQL)

- **Default / recommended:** Postgres trong Docker trên cùng VPS (hoặc máy dev) — xem [local-postgres.md](./local-postgres.md) và thư mục `docker/local/`.
- **`DATABASE_URL` / `DIRECT_URL`:** trỏ tới instance Postgres của bạn (local thường giống nhau; managed cloud thì thêm `sslmode=require` nếu nhà cung cấp yêu cầu).
- Sau khi đổi URL: `pm2 restart crypto-api crypto-worker --update-env` (hoặc `./scripts/deploy.sh`).

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
TELEGRAM_POLLING_ENABLED=true
```

- **Worker**: daily report (21:00 ICT), trade hooks from schedulers.
- **Commands** (`/lenh`, `/show`): only when `TELEGRAM_POLLING_ENABLED=true` on worker. While polling runs, manual `getUpdates` returns empty (409 if two pollers). Set `TELEGRAM_POLLING_ENABLED=false` to debug chat_id via curl/script.
- **API**: WebSocket fill/close notifications when `BINANCE_ENABLED=true`.
- PnL in Telegram uses **GMT+7** day boundary (dashboard API stays UTC).

Commands: `/help`, `/lenh`, `/show`, `/pnl`, `/pipeline`, `/sukien`, `/baocao`, `/tat`, `/bat`.

### Telegram AI Q&A (`/ai`)

Plan: `docs/plan/telegram-ai-qa.md`

```bash
TELEGRAM_AI_ENABLED=true
TELEGRAM_AI_MODEL=meta-llama/llama-4-scout-17b-16e-instruct
TELEGRAM_AI_MAX_TOKENS=2048
TELEGRAM_AI_RATE_LIMIT_PER_USER_HOUR=5
TELEGRAM_AI_RATE_LIMIT_PER_CHAT_DAY=30
TELEGRAM_AI_SYSTEM_PROMPT_VERSION=1
# Production + AI enabled: bắt buộc whitelist user
TELEGRAM_ALLOWED_USER_IDS=your_telegram_user_id
```

- Chạy trên **worker** (polling). Không block polling — job async in-memory, timeout 60s.
- Lệnh: `/ai`, `/ai loi`, `/ai pipeline`, `/ai llm`, `/ai vi ...`, `/ai so sanh`, `/ai cancel`, `/logs` (admin).
- Dashboard mirror: `GET/POST /api/dashboard/telegram-ai/*` khi AI enabled.

Schema mới: `ai_sessions`, `ai_fix_jobs` — sau deploy:

```bash
cd backend && npx prisma db push
```

### Cursor Agent (`/fix`)

```bash
CURSOR_AGENT_ENABLED=true
CURSOR_API_KEY=cursor_...
CURSOR_AGENT_MODEL=composer-2.5
CURSOR_AGENT_REPO_URL=https://github.com/org/chuyen-gia-crypto
CURSOR_AGENT_BASE_BRANCH=develop
```

- Cloud agent tạo **draft PR** — không auto-merge, không auto-deploy.
- Lệnh: `/fix <mô tả>`, `/fix status`, `/deploy?` (hướng dẫn merge + `deploy.sh`).

### Post-deploy: historical PnL (optional)

When upgrading to merge-PnL / outcome recording, run once on VPS (worker can stay up):

```bash
cd ~/chuyen-gia-crypto/backend
npm run testnet:backfill-pnl -- --dry-run
npm run testnet:backfill-pnl
```

Details: [pnl-backfill.md](./pnl-backfill.md). Pending limit lifecycle env: [pending-order-lifecycle.md](./pending-order-lifecycle.md).

See also: `docs/v3-operations.md`, `docs/setup.md`, `docs/binance-testnet-integration.md`.
