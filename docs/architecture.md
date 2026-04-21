# Architecture Overview

## System Design

Crypto Trend Analyzer là hệ thống phân tích crypto sử dụng **ICT Smart Money Concepts**.

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│   Frontend      │────▶│   Backend API   │────▶│     Cache       │
│  (React/Vite)   │     │   (Express)     │     │  (In-Memory)    │
└─────────────────┘     └─────────────────┘     └─────────────────┘
                               │
                               ▼
                        ┌─────────────────┐
                        │   Scheduler     │
                        │  (node-cron)    │
                        └─────────────────┘
                               │
              ┌────────────────┴────────────────┐
              ▼                                 ▼
    ┌─────────────────┐              ┌─────────────────┐
    │  Price Fetcher  │              │   Groq API      │
    │  (CoinGecko)    │              │ (ICT Analysis)  │
    └─────────────────┘              └─────────────────┘
                                             │
                                             ▼
                                    ┌─────────────────┐
                                    │  SQLite DB      │
                                    │  (OHLCV +       │
                                    │   Predictions)  │
                                    └─────────────────┘
```

## ICT Smart Money Concepts

Hệ thống sử dụng phương pháp phân tích **Inner Circle Trader (ICT)**:

### Core Components
1. **Market Structure** - Xác định BOS (Break of Structure) và CHOCH (Change of Character)
2. **Liquidity** - Phát hiện buy-side/sell-side liquidity
3. **Order Blocks** - Xác định vùng institutional interest
4. **Fair Value Gaps** - Phát hiện imbalance zones
5. **Narrative** - Xây dựng câu chuyện thị trường (Tiếng Việt)
6. **Multi-Timeframe Predictions** - Dự báo cho 15m, 1h, 4h, 1d với target prices

### Multi-Timeframe Priority
```
1d (Higher TF bias) > 4h (Primary decision) > 1h (Entries) > 15m (Micro)
```

## Data Flow

```
1. Scheduler triggers every 15 minutes
   │
2. Fetch BTC/ETH prices from CoinGecko/Binance
   │
3. Send price data to Groq API with ICT prompt
   │
4. Groq analyzes using Smart Money Concepts (Vietnamese output)
   │
5. Receive structured JSON with:
   - bias (bullish/bearish/neutral)
   - action (buy/sell/hold)
   - narrative (market story in Vietnamese)
   - key_levels (liquidity, OB, FVG, BOS, CHOCH)
   - predictions (multi-timeframe with targets)
   │
6. (Optional) If database available, include historical prediction context (4h/1d, last 24h) for AI to learn from past accuracy
   │
7. Save analysis to SQLite database:
   - analysis_history table
   - predictions table
   - key_levels table
   - OHLCV candles (15m timeframe)
   │
8. Cache result in memory (TTL: 20 minutes)
   │
9. Frontend fetches from /api/analysis
   │
10. Display with:
   - Candlestick charts (lightweight-charts)
   - ICT indicator overlays
   - Prediction lines
   - Vietnamese narrative
```

## Components

### Frontend (Port 5173)
- **Stack**: React 18, Vite, TailwindCSS, lightweight-charts, Lucide Icons
- **Features**:
  - BTC/ETH candlestick charts với OHLCV data
  - ICT indicator overlays (BOS, CHOCH, OB, FVG, Liquidity)
  - Multi-timeframe prediction lines on charts
  - Timeframe selector (15m, 1h, 4h, 1d)
  - Vietnamese language UI
  - Confidence indicator
  - Disclaimer footer
- **API Calls**: Chỉ gọi backend, không gọi trực tiếp external APIs

### Backend (Port 3000)
- **Stack**: Node.js, Express, node-cron, SQLite3
- **APIs**:
  - `GET /api/analysis` - Trả về cached ICT analysis
  - `GET /api/health` - Health check với cache status
  - `GET /api/ohlc/:coin` - OHLCV candle data cho charts
- **Scheduler**: Chạy mỗi 15 phút (`*/15 * * * *`)
- **CORS**: Whitelist-based configuration via ALLOWED_ORIGINS

### ICT Analysis Engine (Groq API)
- **Model**: llama-3.3-70b-versatile (primary), llama-3.1-70b-versatile (secondary), llama-3.1-8b-instant (fallback)
- **Input**: Current price + multi-timeframe price history + OHLC candle data (for Kim Nghia method)
- **Output**: Structured JSON với (all text in Vietnamese):
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
    "risk": "Volatility warning in Vietnamese"
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

### Database Layer (SQLite)
- **Location**: `backend/data/predictions.db`
- **Tables**:
  - `analysis_history` - Lịch sử phân tích với bias, action, confidence
  - `predictions` - Dự báo multi-timeframe với validation tracking
  - `key_levels` - ICT indicators (liquidity, OB, FVG, BOS, CHOCH)
  - `ohlcv_candles` - OHLCV data cho charts (15m timeframe)
  - `latest_prices` - Latest price cache
  - `price_history` - Historical prices cho validation
- **Data Retention**: 15m candles kept for 30 days (auto-cleanup)

## Scalability Considerations

### Current (MVP)
- Single process, in-memory cache
- Đủ cho demo/small usage
- Dễ extend thêm coins khác

### Future Scaling
- Replace SQLite với PostgreSQL/MySQL cho multi-server deployments
- Replace in-memory cache với Redis
- Add rate limiting per API key
- Support WebSocket cho real-time updates
- Thêm nhiều timeframes hơn (weekly, monthly)
- Integrate thêm nguồn dữ liệu (TradingView, etc.)
- Add authentication và user-specific analysis history
- Implement prediction accuracy tracking dashboard
