# Setup Guide

## Prerequisites

- Node.js >= 18
- npm or yarn
- Groq API Key (free tier available)
- Docker + Docker Compose v2 (để chạy Postgres local — xem `docs/local-postgres.md`)

## Installation

### 1. Clone/Navigate to project
```bash
cd d:\Project\chuyen-gia-crypto
```

### 2. Install Backend Dependencies
```bash
cd backend
npm install
```

**Backend Stack:**
- Node.js + TypeScript 5.7
- Express 4.19
- Prisma ORM 5.22
- PostgreSQL (Docker trên VPS hoặc máy dev)
- node-cron 3.0

### 3. Install Frontend Dependencies (Next.js + TypeScript)
```bash
cd ../frontend
npm install
```

**Frontend Stack:**
- Next.js 15 + React 19
- TypeScript 5.7
- Tailwind CSS 3.4
- Lucide React icons

### 4. PostgreSQL (Docker — khuyến nghị)

Xem hướng dẫn đầy đủ: **[local-postgres.md](./local-postgres.md)**.

Tóm tắt:

```bash
cd docker/local
cp env.example .env
docker compose up -d   # hoặc: sudo docker compose up -d
```

Sau đó trong `backend/.env`:

```env
DATABASE_URL="postgresql://crypto:crypto_local_dev@127.0.0.1:5432/chuyen_gia?schema=public"
DIRECT_URL="postgresql://crypto:crypto_local_dev@127.0.0.1:5432/chuyen_gia?schema=public"
```

*(Đổi user/mật khẩu/db nếu bạn đã sửa `docker/local/.env`.)*

### 5. Initialize Database Schema
```bash
cd ../backend
npm run prisma:generate
npm run prisma:migrate  # or npm run prisma:db:push for fresh deployment
```

### 6. (Optional) Migrate SQLite Data
If you have existing SQLite data to migrate:
```bash
npm run prisma:seed
```

## Configuration

### Backend Environment Variables

Create `backend/.env` (see `.env.example` for reference):

```env
# Application
NODE_ENV=development
PORT=3000

# Database (PostgreSQL — Docker local, xem docs/local-postgres.md)
DATABASE_URL=postgresql://crypto:crypto_local_dev@127.0.0.1:5432/chuyen_gia?schema=public
DIRECT_URL=postgresql://crypto:crypto_local_dev@127.0.0.1:5432/chuyen_gia?schema=public

# Process Configuration
API_ONLY=false
WORKER_ONLY=false
WORKER_LEADER_LOCK_KEY=12345

# Worker Scheduler
PRICE_UPDATE_INTERVAL_MS=30000
PREDICTION_VALIDATION_CRON=0 * * * *
DAILY_MAINTENANCE_CRON=0 3 * * *
SNAPSHOT_CRON=*/5 * * * *

# Groq API (primary + fallbacks step 4+)
GROQ_API_KEY=gsk_your_groq_api_key_here
GROQ_API_KEY_1=
GROQ_API_KEY_2=
GROQ_MODEL_PRIMARY=meta-llama/llama-4-scout-17b-16e-instruct
# GROQ_MODEL_FALLBACKS=llama-3.3-70b-versatile,qwen/qwen3-32b,qwen/qwen3.6-27b,llama-3.1-8b-instant

# Cerebras (dispatch fallback step 2)
# CEREBRAS_API_KEY=csk_...
# CEREBRAS_DISPATCH_MODEL=gpt-oss-120b

# OpenRouter (dispatch fallback step 3 — paid Scout)
# OPENROUTER_API_KEY=sk-or-v1-...
# OPENROUTER_DISPATCH_MODEL=meta-llama/llama-4-scout

# CORS
ALLOWED_ORIGINS=http://localhost:3000,http://localhost:5173

# Binance (Testnet)
BINANCE_ENABLED=false
BINANCE_API_KEY=
BINANCE_API_SECRET=
```

**Get Groq API Key:**
1. Visit https://console.groq.com
2. Sign up for free account
3. Create API key
4. Copy key to .env file

**LLM dispatch providers (optional fallbacks):** Cerebras và OpenRouter chỉ dùng khi Groq Scout fail. Chi tiết thứ tự và env: [llm-dispatch-providers.md](./llm-dispatch-providers.md).

## Running Locally

### Option 1: Run Both Processes (Development)
```bash
cd backend
npm run dev:ts
```

### Option 2: Run API Only
```bash
cd backend
API_ONLY=true npm run dev:ts
```

### Option 3: Run Worker Only
```bash
cd backend
WORKER_ONLY=true npm run dev:ts
```

### Start Frontend (Next.js)
```bash
cd frontend
npm run dev
```

Expected output:
```
▲ Next.js 15.1.3
- Local:        http://localhost:3000
- Network:      http://192.168.x.x:3000

✓ Starting...
✓ Ready in 2.5s
```

### Access Application
Open browser: `http://localhost:3000`

**Note**: Next.js frontend runs on port 3000. In development, backend can run on a different port or use the dev proxy. In production, frontend builds static files and can deploy separately.

## Cron Job Details

### Schedule
- **Frequency**: Every 15 minutes
- **Expression**: `*/15 * * * *`
- **Runs**: Continuously while backend is running

### What It Does
1. Fetches latest BTC/ETH prices
2. Calls Groq API for analysis
3. Updates cache with new data
4. Logs to console

### Manual Trigger
To run analysis immediately (for testing):
- Restart backend (runs on startup)
- Or wait for next scheduled run

## Troubleshooting

### "Module not found" Error in Next.js
If you see module resolution errors:
```bash
# Xóa cache và reinstall
cd frontend
rm -rf node_modules .next
npm install
npm run build
```

### TypeScript Errors
Check `tsconfig.json` paths configuration:
```json
{
  "compilerOptions": {
    "paths": {
      "@/*": ["./*"]
    }
  }
}
```

### Backend won't start
- Check `.env` file exists
- Verify DATABASE_URL is set (for production)
- Verify GROQ_API_KEY is set
- Check port 3000 is available

### Prisma Client Issues
```bash
# Regenerate Prisma client
cd backend
npm run prisma:generate

# Push schema to database (for fresh deployment)
npm run prisma:db:push

# Or create migration
npm run prisma:migrate
```

### No data showing
- Check backend console for errors
- Verify `/api/analysis` returns data
- Check browser network tab
- Verify worker process is running (for scheduler jobs)

### Cache not updating
- Check worker console for scheduler logs
- Verify Groq API key is valid
- Check rate limits (Groq free tier: 20 requests/minute)

### Database errors
- Verify `DATABASE_URL` / `DIRECT_URL` in `backend/.env`
- Ensure Postgres container is running: `cd docker/local && docker compose ps`
- Run `npm run prisma:generate` to regenerate client
- Run `npm run prisma:db:push` to sync schema

## Production Considerations

### Environment
- Set NODE_ENV=production
- Configure `DATABASE_URL` and `DIRECT_URL` (PostgreSQL — xem `docs/local-postgres.md`)
- Set API_ONLY=true for API process, WORKER_ONLY=true for worker process
- Configure ALLOWED_ORIGINS for production domains
- Add rate limiting middleware

### Database (PostgreSQL)

- Database: **PostgreSQL** (mặc định Docker trên VPS — `docker/local/`)
- Schema source of truth: `prisma/schema.prisma`
- Use Prisma migrations for schema changes
- Data retention: 15m candles kept for 30 days (auto-cleanup)
- SQLite retained only for migration input

### Process Management (PM2)

Prefer **`scripts/deploy.sh`** for production rollouts (pull, build, reload, health check).

```bash
cd backend
pm2 start ecosystem.config.cjs --update-env   # first time
pm2 reload ecosystem.config.cjs --update-env  # subsequent deploys
pm2 logs crypto-api --lines 50 --nostream
pm2 logs crypto-worker --lines 50 --nostream
pm2 monit
```

Memory limits (for 1 vCPU / 1 GB RAM VPS):
- API: 300M max memory
- Worker: 350M max memory

### Nginx Configuration
Copy `backend/deploy/nginx.conf` to `/etc/nginx/sites-available/crypto-analyzer`:
```bash
sudo cp backend/deploy/nginx.conf /etc/nginx/sites-available/crypto-analyzer
sudo ln -s /etc/nginx/sites-available/crypto-analyzer /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx
```

### Security
- Never commit .env files
- Use environment variables for secrets
- Enable CORS only for trusted origins
- Add request validation
- Use HTTPS in production

### Timezone Configuration
- **Backend**: Uses UTC timestamps (Postgres `DEFAULT NOW()`)
- **Frontend**: Automatically converts all timestamps to GMT+7 (Asia/Ho_Chi_Minh) for display
- **Server Timezone**: No specific timezone required (UTC is fine)
- **Frontend Display**: All timestamps use `toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' })` or +7 hours offset for Unix timestamps
- **Chart Data**: Unix timestamps have +7 hours offset added before display

**VPS Deployment (backend only)**:

Frontend is deployed on **Vercel** (git push). On the VPS, use the deploy script:

```bash
~/deploy.sh
# or: ./scripts/deploy.sh
```

See **`docs/deployment.md`** for flags (`DEPLOY_DB_PUSH`, `DEPLOY_SKIP_PULL`, etc.).

Manual equivalent:

```bash
cd ~/chuyen-gia-crypto && git pull --ff-only origin develop
cd backend && npm ci && npm run build
pm2 reload ecosystem.config.cjs --update-env && pm2 save
curl -s http://127.0.0.1:3000/health
```

### Monitoring
- Health check endpoint: `/health`
- PM2 logs: `pm2 logs crypto-api` and `pm2 logs crypto-worker`
- PM2 monitoring: `pm2 monit`
- Log rotation: Configure in PM2 ecosystem file
