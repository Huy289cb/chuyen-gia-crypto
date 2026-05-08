# Setup Guide

## Prerequisites

- Node.js >= 18
- npm or yarn
- Groq API Key (free tier available)
- Neon Postgres account (for production deployment)

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
- Neon Postgres (production)
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

### 4. Set Up Neon Postgres (Production)
1. Create a Neon account at https://console.neon.tech/
2. Create a new project
3. Copy the connection string
4. Update `backend/.env` with:
   ```
   DATABASE_URL=postgresql://user:password@ep-xxx.region.aws.neon.tech/neondb?sslmode=require
   DIRECT_URL=postgresql://user:password@ep-xxx.region.aws.neon.tech/neondb?sslmode=require
   ```

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

# Database (Neon Postgres)
DATABASE_URL=postgresql://user:password@ep-xxx.region.aws.neon.tech/neondb?sslmode=require
DIRECT_URL=postgresql://user:password@ep-xxx.region.aws.neon.tech/neondb?sslmode=require

# Process Configuration
API_ONLY=false
WORKER_ONLY=false
WORKER_LEADER_LOCK_KEY=12345

# Worker Scheduler
PRICE_UPDATE_INTERVAL_MS=30000
PREDICTION_VALIDATION_CRON=0 * * * *
DAILY_MAINTENANCE_CRON=0 3 * * *
SNAPSHOT_CRON=*/5 * * * *

# Groq API
GROQ_API_KEY=gsk_your_groq_api_key_here
GROQ_API_KEY_1=
GROQ_API_KEY_2=

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
- Verify DATABASE_URL is correct
- Check Neon Postgres is accessible
- Run `npm run prisma:generate` to regenerate client
- Run `npm run prisma:db:push` to sync schema

## Production Considerations

### Environment
- Set NODE_ENV=production
- Configure DATABASE_URL and DIRECT_URL (Neon Postgres)
- Set API_ONLY=true for API process, WORKER_ONLY=true for worker process
- Configure ALLOWED_ORIGINS for production domains
- Add rate limiting middleware

### Database (Neon Postgres)
- Production database: Neon Postgres (managed PostgreSQL)
- Schema source of truth: `prisma/schema.prisma`
- Use Prisma migrations for schema changes
- Data retention: 15m candles kept for 30 days (auto-cleanup)
- SQLite retained only for migration input

### Process Management (PM2)
```bash
# Build TypeScript
cd backend
npm run build

# Start API process
pm2 start ecosystem.config.cjs --only crypto-api

# Start Worker process
pm2 start ecosystem.config.cjs --only crypto-worker

# Start both
pm2 start ecosystem.config.cjs

# View logs
pm2 logs

# Monitor
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

**VPS Deployment**:
```bash
cd ~/chuyen-gia-crypto
git pull origin develop
cd backend
npm install
npm run build
npm run prisma:generate
npm run prisma:db:push
pm2 restart all
```

### Monitoring
- Health check endpoint: `/health`
- PM2 logs: `pm2 logs crypto-api` and `pm2 logs crypto-worker`
- PM2 monitoring: `pm2 monit`
- Log rotation: Configure in PM2 ecosystem file
