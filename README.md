# Crypto Trend Analyzer - ICT Edition

MVP web app phân tích xu hướng BTC/ETH sử dụng **ICT Smart Money Concepts** với AI.

## Tính năng nổi bật

### ICT Smart Money Analysis
- **Market Structure**: Phát hiện BOS (Break of Structure) và CHOCH (Change of Character)
- **Liquidity Model**: Xác định buy-side/sell-side liquidity
- **Order Blocks**: Mark institutional reference levels
- **Fair Value Gaps**: Phát hiện imbalance zones
- **Narrative Building**: Xây dựng câu chuyện thị trường dựa trên Smart Money Concepts

### Multi-Timeframe Analysis
Phân tích đa khung thời gian với priority: **1d > 4h > 1h > 15m**

### Real-time Data
- Giá BTC/ETH cập nhật real-time từ CoinGecko
- Phân tích tự động mỗi 15 phút
- Cache 20 phút để đảm bảo performance

### Giao diện tương tác
- Narrative hiển thị rõ ràng
- Key levels (Liquidity, OB, FVG) interactive display
- Confidence gauge với bias indicator
- 7-day normalized trend chart

## Cấu trúc thư mục

```
crypto-analyzer/
├── backend/              # Node.js + Express + Groq API
│   ├── src/
│   │   ├── index.js         # Entry point
│   │   ├── groqAnalyzer.js  # ICT analysis engine
│   │   ├── price-fetcher.js # CoinGecko integration
│   │   ├── groq-client.js   # Groq API wrapper
│   │   ├── scheduler.js     # 15-min cron job
│   │   ├── cache.js         # In-memory cache
│   │   └── routes.js        # API endpoints
│   └── .env                 # GROQ_API_KEY
├── frontend/             # React + Vite + Tailwind
│   ├── src/
│   │   ├── App.jsx
│   │   ├── components/
│   │   │   ├── CryptoCard.jsx     # ICT card với narrative
│   │   │   ├── PriceChart.jsx     # 7-day trend
│   │   │   ├── MarketOverview.jsx
│   │   │   └── Disclaimer.jsx
│   │   └── hooks/
│   │       └── useTrends.js
│   └── index.html
├── docs/                 # Documentation
│   ├── architecture.md   # System architecture
│   ├── api-spec.md       # API specification
│   ├── app-behaviors.md  # ICT methodology
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

## API Response Example

```json
{
  "btc": {
    "bias": "bullish",
    "action": "buy",
    "confidence": 0.75,
    "narrative": "Price swept sell-side liquidity and reversed. Bullish CHOCH on 4h. HTF bias bullish. Expecting move toward buy-side liquidity above $68k.",
    "timeframes": {
      "1h": "bullish BOS confirmed",
      "4h": "bullish structure forming", 
      "1d": "higher low established"
    },
    "key_levels": {
      "liquidity": "Buy-side above $68,000; Sell-side swept at $66,500",
      "order_blocks": "Bullish OB at $66,800",
      "fvg": "4h FVG at $67,200-$67,500"
    },
    "risk": "Volatility high. Invalidation: Clean break below $66,500."
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
