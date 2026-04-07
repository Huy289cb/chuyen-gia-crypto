# API Specification

## Base URL
```
http://localhost:3000/api
```

## Endpoints

### GET /analysis
Returns current cached ICT Smart Money analysis for BTC and ETH.

#### Response Schema

```json
{
  "success": true,
  "data": {
    "prices": {
      "btc": {
        "price": 67197.50,
        "change24h": -0.16,
        "change7d": 2.34,
        "marketCap": 1320000000000,
        "sparkline7d": [66000, 66500, 67197]
      },
      "eth": {
        "price": 2050.40,
        "change24h": -0.14,
        "change7d": 1.87,
        "marketCap": 247000000000,
        "sparkline7d": [1980, 2020, 2050]
      },
      "timestamp": "2026-04-05T17:03:52.514Z"
    },
    "analysis": {
      "btc": {
        "bias": "neutral",
        "action": "hold",
        "confidence": 0.50,
        "narrative": "Giá đang đi ngang sau khi thất bại quét bên trên. Thanh khoản nghỉ trên các đỉnh gần đây. Bias HTF trung lập. Kỳ vọng di chuyển trong biên độ cho đến khi breakout cấu trúc.",
        "timeframes": {
          "15m": "đi ngang ngắn hạn",
          "1h": "đi ngang tích lũy",
          "4h": "cấu trúc trung lập, không có BOS rõ ràng",
          "1d": "CHOCH giảm từ đỉnh tuần"
        },
        "key_levels": {
          "liquidity": "Buy-side trên $67,500; Sell-side dưới $66,800",
          "order_blocks": "Bullish OB tại $66,500; Bearish OB tại $67,800",
          "fvg": "FVG 1h tại $66,900-$67,000",
          "bos": "BOS tại $67,200",
          "choch": "CHOCH tại $66,500"
        },
        "predictions": {
          "15m": { "direction": "sideways", "target": null, "confidence": 0.3 },
          "1h": { "direction": "sideways", "target": null, "confidence": 0.4 },
          "4h": { "direction": "sideways", "target": null, "confidence": 0.5 },
          "1d": { "direction": "down", "target": 66000, "confidence": 0.6 }
        },
        "risk": "Biến động cao. Vô hiệu hóa: Break rõ ràng dưới $66,500."
      },
      "eth": {
        "bias": "bullish",
        "action": "buy",
        "confidence": 0.70,
        "narrative": "Giá đã quét thanh khoản sell-side và đảo chiều. CHOCH tăng trên khung 4h. Bias HTF tăng. Kỳ vọng di chuyển về phía thanh khoản buy-side bên trên.",
        "timeframes": {
          "15m": "tăng ngắn hạn",
          "1h": "xác nhận BOS tăng",
          "4h": "cấu trúc tăng đang hình thành",
          "1d": "đã thiết lập đáy cao hơn"
        },
        "key_levels": {
          "liquidity": "Buy-side trên $2,100; Sell-side đã quét tại $2,020",
          "order_blocks": "Bullish OB tại $2,030",
          "fvg": "FVG 4h tại $2,050-$2,080",
          "bos": "BOS tại $2,060",
          "choch": "CHOCH tại $2,030"
        },
        "predictions": {
          "15m": { "direction": "up", "target": 2060, "confidence": 0.7 },
          "1h": { "direction": "up", "target": 2080, "confidence": 0.75 },
          "4h": { "direction": "up", "target": 2100, "confidence": 0.8 },
          "1d": { "direction": "up", "target": 2150, "confidence": 0.7 }
        },
        "risk": "Rủi ro tương quan với BTC. Vô hiệu hóa: Break dưới $2,020."
      },
      "comparison": "ETH thể hiện cấu trúc mạnh hơn BTC. ETH đã quét thanh khoản và đảo chiều; BTC vẫn đang tích lũy.",
      "marketSentiment": "cautiously_bullish",
      "disclaimer": "Đây KHÔNG phải là lời khuyên tài chính. Phân tích ICT Smart Money yêu cầu phân tích biểu đồ đúng cách. Crypto cực kỳ biến động."
    },
    "lastUpdated": "2026-04-05T17:03:52.514Z"
  },
  "meta": {
    "cachedAt": "2026-04-05T17:03:52.514Z",
    "ageSeconds": 120,
    "nextUpdateIn": 780
  }
}
```

#### Error Response (Cache Empty)

```json
{
  "success": false,
  "error": "Data not available yet",
  "message": "Analysis is running. Please try again in a few moments.",
  "status": "initializing"
}
```

### GET /health
Health check endpoint.

#### Response Schema

```json
{
  "status": "ok",
  "cache": {
    "hasData": true,
    "age": 120,
    "cachedAt": "2026-04-05T17:03:52.514Z"
  },
  "database": {
    "connected": true,
    "path": "/path/to/data/predictions.db"
  },
  "timestamp": "2026-04-05T17:05:00.000Z"
}
```

### GET /api/ohlc/:coin
Get OHLCV candle data for charting.

#### Query Parameters
- `timeframe`: Timeframe (15m, 1h, 4h, 1d) - default: 15m
- `limit`: Number of candles to return - default: 100

#### Response Schema

```json
{
  "success": true,
  "data": [
    {
      "time": 1712345678,
      "open": 67000,
      "high": 67500,
      "low": 66800,
      "close": 67200,
      "volume": 1000000
    }
  ]
}
```

## Field Definitions

### Price Object
| Field | Type | Description |
|-------|------|-------------|
| price | number | Current USD price |
| change24h | number | 24h change percentage |
| change7d | number | 7-day change percentage |
| marketCap | number | Market cap in USD |
| sparkline7d | number[] | Price points for last 7 days |

### ICT Analysis Object
| Field | Type | Description |
|-------|------|-------------|
| bias | string | `bullish`, `bearish`, `neutral` - Directional bias |
| action | string | `buy`, `sell`, `hold` - Trading action |
| confidence | number | 0.0 to 1.0 confidence score |
| narrative | string | Market story in Vietnamese (max 200 words) |
| timeframes | object | Structure description per TF (Vietnamese) |
| key_levels | object | Liquidity, OB, FVG, BOS, CHOCH levels (Vietnamese) |
| predictions | object | Multi-timeframe predictions with targets |
| risk | string | Risk warning + invalidation (Vietnamese) |

### Timeframes Object
| Field | Type | Description |
|-------|------|-------------|
| 15m | string | Short-term structure (Vietnamese) |
| 1h | string | Short-term structure (Vietnamese) |
| 4h | string | Mid-term structure (Vietnamese) |
| 1d | string | Higher TF structure (Vietnamese) |

### Predictions Object
| Field | Type | Description |
|-------|------|-------------|
| direction | string | `up`, `down`, `sideways` - Price direction |
| target | number | Target price for the timeframe |
| confidence | number | 0.0 to 1.0 prediction confidence |

### Key Levels Object
| Field | Type | Description |
|-------|------|-------------|
| liquidity | string | Buy-side and sell-side liquidity locations (Vietnamese) |
| order_blocks | string | Key institutional order block levels (Vietnamese) |
| fvg | string | Fair Value Gaps (imbalances) (Vietnamese) |
| bos | string | Break of Structure levels (Vietnamese) |
| choch | string | Change of Character levels (Vietnamese) |

## Rate Limits
- Frontend auto-refresh: every 30 seconds
- Cache TTL: 20 minutes
- Cron schedule: 15 minutes
