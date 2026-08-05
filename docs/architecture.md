# Architecture Overview

## System Design

Crypto Trend Analyzer là hệ thống phân tích crypto sử dụng **ICT Smart Money Concepts** và **Kim Nghia (SMC + Volume + Fibonacci)**.

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│   Frontend      │────▶│   Backend API   │────▶│   PostgreSQL    │
│ (Next.js 15)    │     │   (Express/TS)  │     │   (Prisma ORM)  │
└─────────────────┘     └─────────────────┘     └─────────────────┘
                               │
                               ▼
                        ┌─────────────────┐
                        │   Worker Proc   │
                        │  (node-cron)    │
                        │  Multi-Method   │
                        └─────────────────┘
                               │
              ┌────────────────┴────────────────┐
              ▼                                 ▼
    ┌─────────────────┐              ┌─────────────────┐
    │  Price Fetcher  │              │   Groq API      │
    │   (Binance)     │              │ (Multi-Method)  │
    └─────────────────┘              └─────────────────┘
                                             │
                              ┌──────────────┴──────────────┐
                              ▼                             ▼
                     ┌─────────────────┐         ┌─────────────────┐
                     │  ICT Method     │         │ Kim Nghia Method│
                     │  (15m schedule) │         │  (7.5m schedule) │
                     └─────────────────┘         └─────────────────┘
                              │                             │
                              └──────────────┬──────────────┘
                                             ▼
                                    ┌─────────────────┐
                                    │  PostgreSQL     │
                                    │  (OHLCV +       │
                                    │   Predictions, │
                                    │   Positions)    │
                                    └─────────────────┘
```

**Architecture Notes:**
- Backend rewritten in TypeScript with Prisma ORM
- Two-process architecture: `crypto-api` (HTTP) + `crypto-worker` (scheduler/sync)
- Production database: **PostgreSQL** (mặc định: container `docker/local/` trên VPS, bind `127.0.0.1`)
- SQLite retained only for migration input during cutover
- Worker uses PostgreSQL advisory lock for leader election

## Multi-Method Architecture

Hệ thống hỗ trợ 2 phương pháp phân tích:

### Multi-Method Architecture Preservation (v2.5.0)

**Note:** ICT Smart Money method is temporarily disabled as of v2.5.0. All ICT code is preserved in the codebase for future multi-method support.

**Current Status:**
- ICT method: Disabled (scheduler commented out, account initialization commented out)
- Kim Nghia method: Active (15-minute schedule: 0,15,30,45)
- Frontend: Defaults to kim_nghia, method selector UI preserved
- Backend: ICT configuration preserved in methods.js with `enabled: false`

**Re-enabling ICT Method:**
To re-enable ICT method in the future:
1. Uncomment ICT cron schedule in `backend/src/scheduler.js`
2. Uncomment ICT account initialization in `backend/src/index.js`
3. Change `enabled: false` to `enabled: true` in `backend/src/config/methods.js`
4. Frontend method selector already supports switching between methods

**Design Philosophy:**
The system is designed to support multiple trading methods running in parallel. All code for ICT method remains intact to allow easy re-enablement without code restoration.

### 1. ICT Smart Money Concepts
- **Market Structure** - Xác định BOS (Break of Structure) và CHOCH (Change of Character)
- **Liquidity** - Phát hiện buy-side/sell-side liquidity
- **Order Blocks** - Xác định vùng institutional interest
- **Fair Value Gaps** - Phát hiện imbalance zones
- **Narrative** - Xây dựng câu chuyện thị trường (Tiếng Việt)
- **Multi-Timeframe Predictions** - Dự báo cho 15m, 1h, 4h, 1d với target prices
- **Auto-Entry**: ICT confidence threshold 70%, Kim Nghia 82%, multi-timeframe alignment required (4h, 1d), R:R >= 2.0
- **Schedule**: Every 15 minutes

### 2. Kim Nghia (SMC + Volume + Fibonacci)
- **SMC Concepts** - Order Blocks, FVG, Liquidity sweeps
- **Volume Analysis** - Volume Profile để xác nhận breakout/impulse
- **Fibonacci Levels** - Golden Pocket (0.5-0.618) và Extension (1.272-1.618)
- **Scoring System** - HTF Alignment (30%), Liquidity & Structure (30%), Confluence (20%), Volume (20%)
- **No Timeframe Predictions** - Sử dụng price_prediction thay vì timeframe predictions (không cần multi-timeframe alignment)
- **Auto-Entry**: Confidence threshold 82%, không cần multi-timeframe alignment, R:R >= 2.5
- **Schedule**: Every 7.5 minutes (offset 450s)

### Multi-Timeframe Priority
```
1d (Higher TF bias) > 4h (Primary decision) > 1h (Entries) > 15m (Micro)
```

## Data Flow

```
1. Scheduler triggers (ICT: 15m, Kim Nghia: 7.5m)
   │
2. Fetch BTC/ETH prices from Binance API (primary), CoinGecko (fallback)
   │
3. Send price data + OHLC candles to Groq API with method-specific prompt
   │
4. Groq analyzes using method-specific concepts (Vietnamese output)
   │
5. Receive structured JSON with:
   - bias (bullish/bearish/neutral)
   - action (buy/sell/hold)
   - confidence (0.0-1.0)
   - narrative (market story in Vietnamese)
   - key_levels (liquidity, OB, FVG, BOS, CHOCH)
   - suggested_entry, suggested_stop_loss, suggested_take_profit
   - expected_rr
   - (ICT only) predictions (multi-timeframe with targets)
   - (Kim Nghia only) scoring_detail, structure, volume_analysis
   │
6. (Optional) If database available, include historical prediction context (ICT only, 4h/1d, last 24h)
   │
7. Save analysis to SQLite database:
   - analysis_history table (with method_id)
   - predictions table (ICT only)
   - OHLCV candles (15m timeframe)
   │
8. Evaluate auto-entry:
   - ICT: Check confidence >= 70%, multi-timeframe alignment, R:R >= 2.0
   - Kim Nghia: Check confidence >= 82%, R:R >= 2.5 (skip multi-timeframe alignment)
   │
9. If entry criteria met, create position in paper trading system
   │
10. Cache result in memory (TTL: 20 minutes)
   │
11. Frontend fetches from /api/analysis
   │
12. Display with:
   - Candlestick charts (lightweight-charts)
   - Method-specific indicator overlays
   - Prediction lines
   - Vietnamese narrative
   - Paper trading positions and performance
```

## Components

### Frontend (Port 3000)
- **Stack**: Next.js 15, TypeScript, TailwindCSS, lightweight-charts, Lucide Icons
- **Features**:
  - BTC/ETH candlestick charts với OHLCV data
  - ICT indicator overlays (BOS, CHOCH, OB, FVG, Liquidity)
  - Multi-method analysis display (ICT, Kim Nghia)
  - Multi-timeframe prediction lines on charts (ICT only)
  - Timeframe selector (15m, 1h, 4h, 1d)
  - Vietnamese language UI
  - Confidence indicator
  - Paper trading positions display
  - Performance metrics (equity curve, win rate, profit factor)
  - Dark/Light mode toggle
  - Disclaimer footer
- **API Calls**: Chỉ gọi backend, không gọi trực tiếp external APIs

### Backend (Port 3000)
- **Stack**: Node.js, TypeScript, Express, node-cron, Prisma ORM, PostgreSQL
- **Architecture**: Two-process split (API + Worker)
  - `crypto-api`: HTTP API server (serves endpoints)
  - `crypto-worker`: Background worker (scheduler, price sync, testnet sync)
  - Worker uses PostgreSQL advisory lock for leader election
- **APIs**:
  - `GET /api/analysis` - Trả về cached analysis (ICT hoặc Kim Nghia)
  - `GET /api/health` - Health check với cache status
  - `GET /api/ohlc/:coin` - OHLCV candle data cho charts
  - `GET /api/positions` - Paper trading positions
  - `POST /api/positions` - Create new position
  - `GET /api/accounts` - Paper trading accounts
  - `POST /api/accounts/reset` - Reset account balance
  - `GET /api/performance/metrics` - Performance metrics
  - `GET /api/performance/equity-curve` - Equity curve data
  - `GET /api/performance/trades` - Trade history
- **Schedulers** (Worker only):
  - ICT: Chạy mỗi 15 phút (`*/15 * * * *`)
  - Kim Nghia: Chạy mỗi 7.5 phút (`7,22,37,52 * * * *`)
  - Price Update: Chạy mỗi 30 giây với 1-minute candle data để update PnL và check SL/TP
  - Prediction Validation: Hourly (`0 * * * *`)
  - Account Snapshots: Every 5 minutes (`*/5 * * * *`)
  - Daily Maintenance: 3 AM daily (`0 3 * * *`)
- **LLM dispatch (trading)** — xem [llm-dispatch-providers.md](./llm-dispatch-providers.md):
  - Step 1: Groq `meta-llama/llama-4-scout-17b-16e-instruct` (primary)
  - Step 2: Cerebras `gpt-oss-120b` + `json_object`
  - Step 3: OpenRouter `meta-llama/llama-4-scout` (paid) + `json_object`
  - Step 4+: Groq fallbacks: `llama-3.3-70b-versatile`, `qwen/qwen3-32b`, `qwen/qwen3.6-27b`, `llama-3.1-8b-instant`
  - Levels adapter (riêng): `openai/gpt-oss-120b` on `GROQ_API_KEY_2`
  - JSON Parsing: `cleanJSONResponse()` handles malformed JSON
- **CORS**: Whitelist-based configuration via ALLOWED_ORIGINS

### Multi-Method Analysis Engine (LLM dispatch)
- **Provider chain** (dispatch only): Groq Scout → Cerebras gpt-oss → OpenRouter Scout → Groq fallbacks — [llm-dispatch-providers.md](./llm-dispatch-providers.md)
- **Groq models**:
  - Primary: `meta-llama/llama-4-scout-17b-16e-instruct`
  - Fallbacks: `llama-3.3-70b-versatile`, `qwen/qwen3-32b`, `qwen/qwen3.6-27b`, `llama-3.1-8b-instant`
  - Not in dispatch chain: `openai/gpt-oss-120b` on Groq (empty body on long prompts; levels adapter only)
- **Input**: Current price + multi-timeframe price history + OHLC candle data (for Kim Nghia method)
- **Output**: Structured JSON (all text in Vietnamese):
  
  **ICT Output:**
  ```json
  {
    "bias": "bullish|bearish|neutral",
    "action": "buy|sell|hold",
    "confidence": 0.0-1.0,
    "narrative": "Market story in Vietnamese (max 350 characters)",
    "timeframes": {
      "15m": "...",
      "1h": "...",
      "4h": "...",
      "1d": "..."
    },
    "key_levels": {
      "liquidity": "...",
      "order_blocks": "...",
      "fvg": "...",
      "bos": "...",
      "choch": "..."
    },
    "predictions": {
      "15m": { "direction": "up|down|sideways", "target": number, "confidence": 0-1 },
      "1h": { "direction": "up|down|sideways", "target": number, "confidence": 0-1 },
      "4h": { "direction": "up|down|sideways", "target": number, "confidence": 0-1 },
      "1d": { "direction": "up|down|sideways", "target": number, "confidence": 0-1 }
    },
    "suggested_entry": 76100.50,
    "suggested_stop_loss": 75800.25,
    "suggested_take_profit": 77270.75,
    "expected_rr": 2.8
  }
  ```
  
  **Kim Nghia Output:**
  ```json
  {
    "btc": {
      "bias": "bullish|bearish|neutral",
      "action": "buy|sell|hold",
      "confidence": 0.0-1.0,
      "scoring_detail": "HTF:x/30, Structure:x/30, Confluence:x/20, Volume:x/20",
      "narrative": "Market story in Vietnamese (max 200 characters)",
      "structure": { "trend": "bullish|bearish|sideways", "key_event": "BOS/CHOCH tại mức giá..." },
      "volume_analysis": "Volume Profile description and breakout confirmation",
      "suggested_entry": 76100.50,
      "suggested_stop_loss": 75800.25,
      "suggested_take_profit": 77270.75,
      "expected_rr": 2.8,
      "alternative_scenario": { "trigger": "Mức giá vô hiệu hóa", "logic": "Kịch bản ngược lại" }
    }
  }
  ```
- **Fallback**: Rule-based analysis nếu API fails (Vietnamese output)

### Cache Layer
- **Type**: In-memory với TTL
- **TTL**: 20 minutes (dài hơn 15-min schedule)
- **Structure**:
  ```js
  {
    prices: { btc, eth },
    analysis: { btc, eth, comparison, marketSentiment },
    lastUpdated: ISO timestamp
  }
  ```

### Database Layer (PostgreSQL + Prisma)
- **Database**: PostgreSQL — cấu hình qua `DATABASE_URL` / `DIRECT_URL` (xem `docs/local-postgres.md`, `backend/.env.example`)
- **ORM**: Prisma with schema as source of truth
- **Schema File**: `prisma/schema.prisma`
- **Migration**: Fresh deployment uses `prisma db push` or `prisma migrate dev --name init`
- **SQLite**: Retained only for migration input during cutover (not used in runtime)
- **Tables**:
  - `analysis_history` - Lịch sử phân tích với bias, action, confidence, method_id
  - `predictions` - Dự báo multi-timeframe với validation tracking (ICT only)
  - `key_levels` - ICT indicators (liquidity, OB, FVG, BOS, CHOCH)
  - `ohlcv_candles` - OHLCV data cho charts (15m timeframe)
  - `latest_prices` - Latest price cache
  - `price_history` - Historical prices cho validation
  - `accounts` - Paper trading accounts (mỗi method có account riêng)
  - `positions` - Paper trading positions với PnL tracking
  - `account_snapshots` - Account balance snapshots cho equity curve
  - `trade_events` - Trade events (entry, TP, SL, close)
  - `pending_orders` - Pending orders for paper trading
  - `testnet_accounts` - Binance testnet accounts
  - `testnet_positions` - Binance testnet positions
  - `testnet_trade_events` - Binance testnet trade events
  - `testnet_account_snapshots` - Binance testnet account snapshots
  - `testnet_pending_orders` - Binance testnet pending orders
- **Data Retention**: 15m candles kept for 30 days (auto-cleanup via maintenance job)

## Big Update v3 pipeline (current — Kim Nghia, BTC-only)

Worker schedulers (see `docs/v3-operations.md`):

1. **MarketScan** (`*/5`) — fetch 15m/1h/4h in parallel, run Signal Gate (no Groq)
2. **LLMDispatch** — pick **one** best PASS timeframe, LLM dispatch chain, `executeV3Trade`
3. **PositionMonitor** (`*/1`) — mark price, REDUCE 50% or EXIT on Binance when triggered

Execution: Binance Futures testnet limit entry → pending order → TTL/drift/LLM review → WS fill → open position + SL/TP. Sync: `binance-order-fill.service.ts`, `position-close.service.ts`, `pending-order-lifecycle.md`. Historical PnL: `npm run testnet:backfill-pnl` ([pnl-backfill.md](./pnl-backfill.md)).

**PnL+ entry/exit (Jul 2026):** HTF side-align → **trend pullback EMA band** ([v3-trend-pullback-entry.md](./v3-trend-pullback-entry.md)) → execute; open book: profit-protect BE@1.5R + invalidation exit-only. Ops: [v3-operations.md](./v3-operations.md), monitor: [pnl-expectancy-monitoring.md](./pnl-expectancy-monitoring.md).

API process: HTTP + Binance WebSocket + reconciliation. Dashboard scheduler status uses worker heartbeats (`utils/scheduler-heartbeat.ts`).

Deploy: backend `scripts/deploy.sh` on VPS; frontend Vercel (`docs/deployment.md`).

## Scalability Considerations

### Current (Production)
- Two-process architecture (API + Worker) on 1 vCPU / 1 GB RAM VPS
- PostgreSQL (thường chạy cùng host qua Docker; xem `docker/local/`)
- In-memory cache with TTL
- Worker leader lock via PostgreSQL advisory lock
- PM2 for process management with memory caps (API: 300M, Worker: 350M)
- Nginx reverse proxy in front of API only

### Future Scaling
- Replace in-memory cache với Redis
- Add rate limiting per API key
- Support WebSocket cho real-time updates
- Thêm nhiều timeframes hơn (weekly, monthly)
- Integrate thêm nguồn dữ liệu (TradingView, etc.)
- Add authentication và user-specific analysis history
- Implement prediction accuracy tracking dashboard
- Horizontal scaling with multiple API instances behind load balancer
