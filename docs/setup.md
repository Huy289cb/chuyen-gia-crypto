# Setup Guide

## Prerequisites

- Node.js >= 18
- npm or yarn
- Groq API Key (free tier available)

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

### 4. Initialize Database (Optional - auto-initialized on first run)
```bash
cd ../backend
npm run db:init
```

## Configuration

### Backend Environment Variables

Create `backend/.env`:

```env
# Required
GROQ_API_KEY=gsk_your_groq_api_key_here

# Optional (defaults shown)
PORT=3000
CACHE_TTL_MINUTES=20
CRON_SCHEDULE=*/15 * * * *

# CORS Configuration (comma-separated origins)
ALLOWED_ORIGINS=http://localhost:3000,http://localhost:5173
```

**Get Groq API Key:**
1. Visit https://console.groq.com
2. Sign up for free account
3. Create API key
4. Copy key to .env file

## Running Locally

### Terminal 1 - Start Backend
```bash
cd backend
npm run dev
```

Expected output:
```
=================================
  Crypto Trend Analyzer Backend
=================================
Server running on http://localhost:3000
Database: connected

[Scheduler] Starting 15-minute job scheduler...
[Job 2026-04-05T...] Starting analysis job...
[PriceFetcher] Fetching prices from CoinGecko...
[Database] Connected to SQLite database at: .../data/predictions.db
[Cache] Data cached at ...
```

### Terminal 2 - Start Frontend (Next.js)
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

**Note**: Next.js frontend chạy trên port 3000 (cùng port với backend dev proxy). Trong production, frontend build ra static files và có thể deploy riêng.

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
- Verify GROQ_API_KEY is set
- Check port 3000 is available

### No data showing
- Check backend console for errors
- Verify `/api/analysis` returns data
- Check browser network tab

### Cache not updating
- Check cron job logs
- Verify Groq API key is valid
- Check rate limits (Groq free tier: 20 requests/minute)

### Database errors
- Ensure `backend/data` directory exists
- Check file permissions for database directory
- Run `npm run db:init` to recreate schema if needed
- Check SQLite is available on the system

## Production Considerations

### Environment
- Use strong random PORT if behind reverse proxy
- Set NODE_ENV=production
- Use Redis instead of in-memory cache for production
- Configure ALLOWED_ORIGINS for production domains
- Add rate limiting middleware

### Database
- SQLite suitable for MVP/single-server deployments
- For multi-server deployments, consider PostgreSQL or MySQL
- Database file location: `backend/data/predictions.db`
- Data retention: 15m candles kept for 30 days
- Run `npm run db:init` to initialize/recreate database schema

### Security
- Never commit .env files
- Use environment variables for secrets
- Enable CORS only for trusted origins
- Add request validation

### Monitoring
- Add health check endpoints
- Log rotation for cron jobs
- Alert on API failures
