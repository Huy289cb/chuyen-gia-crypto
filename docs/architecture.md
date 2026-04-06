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
```

## ICT Smart Money Concepts

Hệ thống sử dụng phương pháp phân tích **Inner Circle Trader (ICT)**:

### Core Components
1. **Market Structure** - Xác định BOS (Break of Structure) và CHOCH (Change of Character)
2. **Liquidity** - Phát hiện buy-side/sell-side liquidity
3. **Order Blocks** - Xác định vùng institutional interest
4. **Fair Value Gaps** - Phát hiện imbalance zones
5. **Narrative** - Xây dựng câu chuyện thị trường

### Multi-Timeframe Priority
```
1d (Higher TF bias) > 4h (Primary decision) > 1h (Entries) > 15m (Micro)
```

## Data Flow

```
1. Scheduler triggers every 15 minutes
   │
2. Fetch BTC/ETH prices from CoinGecko
   │
3. Send price data to Groq API with ICT prompt
   │
4. Groq analyzes using Smart Money Concepts
   │
5. Receive structured JSON with:
   - bias (bullish/bearish/neutral)
   - action (buy/sell/hold)
   - narrative (market story)
   - key_levels (liquidity, OB, FVG)
   │
6. Cache result in memory (TTL: 20 minutes)
   │
7. Frontend fetches from /api/analysis
   │
8. Display cards with narrative, key levels, and bias
```

## Components

### Frontend (Port 5173)
- **Stack**: React 18, Vite, TailwindCSS, Recharts
- **Features**:
  - BTC/ETH summary cards với bias và narrative
  - Interactive key levels display
  - Multi-timeframe structure view
  - Confidence indicator
  - 7-day normalized trend chart
  - Disclaimer footer
- **API Calls**: Chỉ gọi backend, không gọi trực tiếp external APIs

### Backend (Port 3000)
- **Stack**: Node.js, Express, node-cron
- **APIs**:
  - `GET /api/analysis` - Trả về cached ICT analysis
  - `GET /api/health` - Health check với cache status
- **Scheduler**: Chạy mỗi 15 phút (`*/15 * * * *`)

### ICT Analysis Engine (Groq API)
- **Model**: llama-3.1-8b-instant (free tier, fast)
- **Input**: Current price + 7-day price history
- **Output**: Structured JSON với:
  ```json
  {
    "bias": "bullish|bearish|neutral",
    "action": "buy|sell|hold",
    "confidence": 0.0-1.0,
    "narrative": "Market story...",
    "timeframes": {"1h": "...", "4h": "...", "1d": "..."},
    "key_levels": {
      "liquidity": "Above recent highs...",
      "order_blocks": "Key institutional levels...",
      "fvg": "Imbalance zones..."
    },
    "risk": "Volatility warning..."
  }
  ```
- **Fallback**: Rule-based analysis nếu API fails

### Cache Layer
- **Type**: In-memory với TTL
- **TTL**: 20 minutes (dài hơn 15-min schedule)
- **Structure**:
  ```js
  {
    prices: { btc, eth },
    analysis: { btc, eth, comparison, marketSentiment, disclaimer },
    lastUpdated: ISO timestamp
  }
  ```

## Scalability Considerations

### Current (MVP)
- Single process, in-memory cache
- Đủ cho demo/small usage
- Dễ extend thêm coins khác

### Future Scaling
- Replace in-memory cache với Redis
- Add rate limiting per API key
- Support WebSocket cho real-time updates
- Thêm nhiều timeframes hơn (weekly, monthly)
- Integrate thêm nguồn dữ liệu (TradingView, etc.)
