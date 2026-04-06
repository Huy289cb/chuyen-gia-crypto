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
        "narrative": "Price consolidating after failed sweep above. Liquidity rests above recent highs. HTF neutral bias. Expecting range-bound movement until structure breakout.",
        "timeframes": {
          "1h": "sideways consolidation",
          "4h": "neutral structure, no clear BOS",
          "1d": "bearish CHOCH from weekly high"
        },
        "key_levels": {
          "liquidity": "Buy-side above $67,500; Sell-side below $66,800",
          "order_blocks": "Bullish OB at $66,500; Bearish OB at $67,800",
          "fvg": "1h FVG at $66,900-$67,000"
        },
        "risk": "Volatility high. Invalidation: Clean break below $66,500."
      },
      "eth": {
        "bias": "bullish",
        "action": "buy",
        "confidence": 0.70,
        "narrative": "Price swept sell-side liquidity and reversed. Bullish CHOCH on 4h. HTF bias bullish. Expecting move toward buy-side liquidity above.",
        "timeframes": {
          "1h": "bullish BOS confirmed",
          "4h": "bullish structure forming",
          "1d": "higher low established"
        },
        "key_levels": {
          "liquidity": "Buy-side above $2,100; Sell-side swept at $2,020",
          "order_blocks": "Bullish OB at $2,030",
          "fvg": "4h FVG at $2,050-$2,080"
        },
        "risk": "BTC correlation risk. Invalidation: Break below $2,020."
      },
      "comparison": "ETH showing stronger structure than BTC. ETH swept liquidity and reversed; BTC still consolidating.",
      "marketSentiment": "cautiously_bullish",
      "disclaimer": "This is NOT financial advice. ICT Smart Money analysis requires proper chart analysis. Crypto is extremely volatile."
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
  "timestamp": "2026-04-05T17:05:00.000Z"
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
| narrative | string | Market story (max 80 words) |
| timeframes | object | Structure description per TF |
| key_levels | object | Liquidity, OB, FVG levels |
| risk | string | Risk warning + invalidation |

### Timeframes Object
| Field | Type | Description |
|-------|------|-------------|
| 1h | string | Short-term structure |
| 4h | string | Mid-term structure |
| 1d | string | Higher TF structure |

### Key Levels Object
| Field | Type | Description |
|-------|------|-------------|
| liquidity | string | Buy-side and sell-side liquidity locations |
| order_blocks | string | Key institutional order block levels |
| fvg | string | Fair Value Gaps (imbalances) |

## Rate Limits
- Frontend auto-refresh: every 30 seconds
- Cache TTL: 20 minutes
- Cron schedule: 15 minutes
