# Crypto Trend Analyzer - ICT Edition

MVP web app phân tích xu hướng BTC/ETH sử dụng **ICT Smart Money Concepts** với AI và **Paper Trading**.

## Tính năng nổi bật

### ICT Smart Money Analysis
- **Market Structure**: Phát hiện BOS (Break of Structure) và CHOCH (Change of Character)
- **Liquidity Model**: Xác định buy-side/sell-side liquidity
- **Order Blocks**: Mark institutional reference levels
- **Fair Value Gaps**: Phát hiện imbalance zones
- **Narrative Building**: Xây dựng câu chuyện thị trường dựa trên Smart Money Concepts (Tiếng Việt)

### Multi-Timeframe Analysis
Phân tích đa khung thời gian với priority: **1d > 4h > 1h > 15m**

### Paper Trading System
- **Auto-Entry ICT-Based**: Chỉ trade trong London/NY killzone sessions, multi-timeframe alignment (4h, 1d)
- **Partial Take Profits**: Chốt từng phần (50% @ 1:1 R:R, 50% @ 2:1 R:R) theo ICT
- **Trailing Stop**: Move SL to breakeven sau hit TP1, trail để bảo vệ lợi nhuận
- **Risk Management**: 1% risk per trade, position sizing dựa trên SL distance
- **Separate Accounts**: 100U demo account riêng cho BTC và ETH
- **Real-time PnL**: Cập nhật PnL mỗi 30 giây, auto-close khi hit SL/TP
- **Cooldown System**: 4h cooldown sau 3 consecutive losses
- **Performance Tracking**: Equity curve, win rate, profit factor, max drawdown
- **Price Updates**: Cập nhật giá và PnL mỗi 30 giây

### Real-time Data
- Giá BTC/ETH cập nhật real-time từ CoinGecko/Binance
- Phân tích tự động mỗi 15 phút
- Cache 20 phút để đảm bảo performance
- Lưu trữ OHLCV candles trong SQLite database

### Giao diện tương tác
- Narrative hiển thị rõ ràng (Tiếng Việt)
- Key levels (Liquidity, OB, FVG, BOS, CHOCH) interactive display
- Confidence gauge với bias indicator
- Candlestick charts chuyên nghiệp với lightweight-charts
- Dự báo multi-timeframe overlay trên biểu đồ
- Timeframe selector (15m, 1h, 4h, 1d)

### Database & Persistence
- SQLite database lưu trữ lịch sử phân tích
- Theo dõi độ chính xác của dự báo
- Lưu trữ OHLCV candles (15m timeframe)
- Data retention: giữ 30 ngày dữ liệu 15m candles
- Historical prediction context: AI học từ độ chính xác dự báo trước đây (4h, 1d timeframes)
- Paper trading: lưu vị thế, lịch sử giao dịch, equity curve

## Cấu trúc thư mục

```
crypto-analyzer/
├── backend/              # Node.js + Express + Groq API
│   ├── src/
│   │   ├── index.js         # Entry point
│   │   ├── groqAnalyzer.js  # ICT analysis engine
│   │   ├── price-fetcher.js # CoinGecko integration
│   │   ├── groq-client.js   # Groq API wrapper
│   │   ├── scheduler.js     # 15-min cron job + price updates
│   │   ├── cache.js         # In-memory cache
│   │   ├── routes.js        # Main API endpoints
│   │   ├── routes/          # API route modules
│   │   │   ├── positions.js # Position management API
│   │   │   ├── accounts.js  # Account management API
│   │   │   └── performance.js # Performance metrics API
│   │   ├── schedulers/      # Scheduler modules
│   │   │   └── priceUpdateScheduler.js # 30s price updates
│   │   ├── services/        # Business logic
│   │   │   ├── autoEntryLogic.js # Auto-entry decision engine
│   │   │   └── paperTradingEngine.js # Position management
│   │   ├── config/          # Configuration
│   │   │   └── cors.js      # CORS middleware
│   │   └── db/              # Database layer
│   │       ├── database.js  # SQLite operations
│   │       ├── init.js      # DB initialization
│   │       └── migrations.js # Paper trading migrations
│   ├── data/               # SQLite database storage
│   ├── scripts/
│   │   └── ensure-data-dir.js
│   └── .env                 # GROQ_API_KEY + paper trading config
├── frontend/             # React + Vite + Tailwind
│   ├── src/
│   │   ├── App.jsx
│   │   ├── components/
│   │   │   ├── CryptoCard.jsx     # ICT card với narrative
│   │   │   ├── PriceChart.jsx     # Candlestick chart với predictions
│   │   │   ├── MarketOverview.jsx
│   │   │   └── Disclaimer.jsx
│   │   └── hooks/
│   │       └── useTrends.js
│   └── index.html
├── docs/                 # Documentation
│   ├── architecture.md   # System architecture
│   ├── api-spec.md       # API specification
│   ├── api-paper-trading.md # Paper trading API
│   ├── app-behaviors.md  # ICT methodology
│   ├── paper-trading.md  # Paper trading system docs
│   ├── risk-management.md # ICT risk management
│   └── setup.md          # Setup guide
├── rules/                # Analysis rules
│   └── analysis.rules.md # ICT Smart Money rules
└── README.md
```

## Yêu cầu

- Node.js >= 18
- Groq API Key (free tier: 20 requests/min)

## Chạy local

### 1. Backend
```bash
cd backend
npm install

# Tạo .env file với GROQ_API_KEY
echo "GROQ_API_KEY=gsk_your_key_here" > .env

# Khởi tạo database (tự động chạy khi start, có thể chạy thủ công)
npm run db:init

npm run dev
```

Backend chạy tại http://localhost:3000

### 2. Frontend
```bash
cd frontend
npm install
npm run dev
```

Frontend chạy tại http://localhost:5173

## ICT Methodology

Hệ thống sử dụng **Inner Circle Trader (ICT)** Smart Money Concepts:

### 1. Market Structure
- **Bullish**: Higher Highs (HH), Higher Lows (HL)
- **Bearish**: Lower Highs (LH), Lower Lows (LL)
- **BOS**: Break of Structure → Continuation
- **CHOCH**: Change of Character → Reversal

### 2. Liquidity
- Buy-side: Above recent highs
- Sell-side: Below recent lows
- Price tends to sweep liquidity before reversing

### 3. Order Blocks
- Last opposing candle before strong move
- Institutional reference levels

### 4. Fair Value Gaps (FVG)
- Imbalance zones from fast price moves
- Price often returns to fill gaps

### 5. Multi-Timeframe Predictions
- **15m**: Short-term entry points
- **1h**: Intraday trend direction
- **4h**: Swing trade targets
- **1d**: Higher timeframe bias
- Mỗi timeframe có direction, target price, và confidence score

### Price Fetching
- **Primary Source**: Binance API (real-time, no rate limit)
- **Fallback**: CoinGecko API (rate-limited, only if Binance fails)
- **Price Consistency**: 100% Binance (no exchange discrepancies)
- **OHLC Data**: 15m candles from Binance for ICT analysis
- **Update Frequency**: 30s (paper trading), 15m (analysis)

## API Response Example

```json
{
  "btc": {
    "bias": "bullish",
    "action": "buy",
    "confidence": 0.75,
    "narrative": "Giá đã quét thanh khoản sell-side và đảo chiều. CHOCH tăng trên khung 4h. Bias HTF tăng. Kỳ vọng di chuyển về phía thanh khoản buy-side trên $68k.",
    "timeframes": {
      "15m": "tăng ngắn hạn",
      "1h": "xác nhận BOS tăng",
      "4h": "cấu trúc tăng đang hình thành",
      "1d": "đã thiết lập đáy cao hơn"
    },
    "key_levels": {
      "liquidity": "Buy-side trên $68,000; Sell-side đã quét tại $66,500",
      "order_blocks": "Bullish OB tại $66,800",
      "fvg": "FVG 4h tại $67,200-$67,500",
      "bos": "BOS tại $67,000",
      "choch": "CHOCH tại $66,800"
    },
    "predictions": {
      "15m": { "direction": "up", "target": 67200, "confidence": 0.7 },
      "1h": { "direction": "up", "target": 67500, "confidence": 0.75 },
      "4h": { "direction": "up", "target": 68000, "confidence": 0.8 },
      "1d": { "direction": "up", "target": 69000, "confidence": 0.7 }
    },
    "risk": "Biến động cao. Vô hiệu hóa: Break rõ ràng dưới $66,500."
  }
}
```

## Decision Logic

### BUY Signal
- Bullish HTF bias (4h/1d)
- Price at discount hoặc gần support
- Liquidity taken below (swept)
- Bullish BOS/CHOCH confirmed

### SELL Signal
- Bearish HTF bias (4h/1d)
- Price at premium hoặc gần resistance
- Liquidity taken above (swept)
- Bearish BOS/CHOCH confirmed

### HOLD Signal
- Conflicting signals across timeframes
- No clear liquidity target
- Sideways consolidation

## Disclaimer

**This is NOT financial advice.** 

- Crypto markets are extremely volatile
- ICT Smart Money analysis requires proper chart analysis
- Never invest more than you can afford to lose
- Past performance does not guarantee future results
- AI analysis may contain errors - always verify independently

## Tài liệu

- [Architecture](./docs/architecture.md)
- [API Spec](./docs/api-spec.md)
- [ICT Rules](./rules/analysis.rules.md)
- [Setup Guide](./docs/setup.md)

## License

MIT
