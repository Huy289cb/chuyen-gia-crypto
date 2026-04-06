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

### 3. Install Frontend Dependencies
```bash
cd ../frontend
npm install
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

[Scheduler] Starting 15-minute job scheduler...
[Job 2026-04-05T...] Starting analysis job...
[PriceFetcher] Fetching prices from CoinGecko...
[Cache] Data cached at ...
```

### Terminal 2 - Start Frontend
```bash
cd frontend
npm run dev
```

Expected output:
```
VITE v5.4.21  ready in 524 ms

➜  Local:   http://localhost:5173/
```

### Access Application
Open browser: `http://localhost:5173`

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

### "React is not defined" Error
Check `frontend/vite.config.js` has:
```js
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
})
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

## Production Considerations

### Environment
- Use strong random PORT if behind reverse proxy
- Set NODE_ENV=production
- Use Redis instead of in-memory cache
- Add rate limiting middleware

### Security
- Never commit .env files
- Use environment variables for secrets
- Enable CORS only for trusted origins
- Add request validation

### Monitoring
- Add health check endpoints
- Log rotation for cron jobs
- Alert on API failures
