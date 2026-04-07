# ICT Smart Money Analysis Rules

## Core Philosophy
Phân tích thị trường crypto dựa trên **Inner Circle Trader (ICT)** methodology - Smart Money Concepts.

## 1. Multi-Timeframe Analysis (MTF)

### Timeframe Priority
Thứ tự ưu tiên (cao đến thấp): **1d > 4h > 1h > 15m**

| Timeframe | Purpose | Weight |
|-----------|---------|--------|
| 1d | Higher timeframe bias, major trend | High |
| 4h | Mid-term structure, primary decision | **Highest** |
| 1h | Short-term momentum, entries | Medium |
| 15m | Micro-structure, precise entries | Low |

## 2. Market Structure Analysis

### Bullish Structure
- **Higher Highs (HH)**: Đỉnh cao hơn đỉnh trước
- **Higher Lows (HL)**: Đáy cao hơn đáy trước
- Trend: Upward

### Bearish Structure  
- **Lower Highs (LH)**: Đỉnh thấp hơn đỉnh trước
- **Lower Lows (LL)**: Đáy thấp hơn đáy trước
- Trend: Downward

### Structure Break Events
- **BOS (Break of Structure)**: Phá vỡ cấu trúc → Tiếp tục xu hướng
- **CHOCH (Change of Character)**: Đổi tính chất → Đảo chiều xu hướng

## 3. Liquidity Model

### Buy-Side Liquidity
- Vị trí: Phía trên các đỉnh gần nhất
- Ý nghĩa: Target cho lệnh Long
- Hành vi: Giá thường sweep liquidity trước khi đảo chiều

### Sell-Side Liquidity
- Vị trí: Phía dưới các đáy gần nhất
- Ý nghĩa: Target cho lệnh Short
- Hành vi: Giá thường sweep liquidity trước khi đảo chiều

### Liquidity Sweep
- Giá chạm/vượt mức liquidity rồi quay đầu
- Thường là dấu hiệu đảo chiều sắp xảy ra

## 4. Order Blocks (OB)

### Definition
- Nến cuối cùng của phe đối lập trước khi có move mạnh
- Vùng institutional interest

### Types
- **Bullish OB**: Bearish candle trước bullish impulse
- **Bearish OB**: Bullish candle trước bearish impulse

### Usage
- Mark làm vùng support/resistance
- Price thường retest OB trước khi tiếp tục move

## 5. Fair Value Gaps (FVG)

### Definition
- Khoảng trống giá khi price move quá nhanh
- Imbalance giữa buyers và sellers

### Characteristics
- Thường xuất hiện trên các khung nhỏ (1h, 15m)
- Price có xu hướng quay lại fill gap
- Có thể làm entry zone hoặc take profit target

## 6. Narrative Building

### Required Story Elements
1. **Where is price now?** 
   - Vị trí tương đối với structure
   - Premium/Discount zone

2. **Where is liquidity?**
   - Buy-side rests above
   - Sell-side rests below

3. **What did price just do?**
   - Sweep liquidity?
   - Break structure (BOS)?
   - Change character (CHOCH)?

4. **Where is price likely to go?**
   - Next liquidity target
   - Nearest order block
   - FVG fill zone

## 7. Decision Logic

### BUY Signal
**Required conditions:**
- Bullish HTF bias (4h/1d)
- Price at discount zone hoặc gần support
- Liquidity taken below (swept)
- Bullish BOS hoặc CHOCH confirmed
- Structure: HH, HL forming

### SELL Signal
**Required conditions:**
- Bearish HTF bias (4h/1d)
- Price at premium zone hoặc gần resistance
- Liquidity taken above (swept)
- Bearish BOS hoặc CHOCH confirmed
- Structure: LH, LL forming

### HOLD Signal
**Conditions:**
- Conflicting signals across timeframes
- No clear liquidity target visible
- Sideways consolidation
- Unclear structure

## 8. Risk Management

### Required Risk Elements
1. **Volatility Warning**
   - "Crypto markets are extremely volatile"
   - "Price can move 10%+ in hours"

2. **Invalidation Scenario**
   - Level that would disprove the thesis
   - "Invalidation: Break below [support level]"

3. **Position Sizing**
   - Never risk more than you can afford to lose
   - Use proper stop loss placement

4. **Uncertainty Acknowledgment**
   - Never claim 100% certainty
   - "This is analysis, not prediction"

## 9. Confidence Scoring

### High Confidence (0.7-0.9)
- Clear structure on 3+ timeframes
- Liquidity sweep confirmed
- BOS/CHOCH aligned
- Narrative consistent

### Medium Confidence (0.5-0.7)
- Moderate agreement across 2 timeframes
- Some conflicting signals
- Structure forming but not clear

### Low Confidence (0.3-0.5)
- Mixed signals
- No clear direction
- Consolidation phase
- Prefer HOLD action

## 10. Output Format

### Required JSON Structure (all text in VIETNAMESE)
```json
{
  "btc": {
    "bias": "bullish | bearish | neutral",
    "action": "buy | sell | hold",
    "confidence": 0.0-1.0,
    "narrative": "max 350 characters in VIETNAMESE - market story",
    "timeframes": {
      "15m": "structure description in VIETNAMESE",
      "1h": "structure description in VIETNAMESE",
      "4h": "structure description in VIETNAMESE",
      "1d": "structure description in VIETNAMESE"
    },
    "key_levels": {
      "liquidity": "where liquidity rests in VIETNAMESE",
      "order_blocks": "key OB levels in VIETNAMESE",
      "fvg": "imbalance zones in VIETNAMESE",
      "bos": "break of structure levels in VIETNAMESE",
      "choch": "change of character levels in VIETNAMESE"
    },
    "predictions": {
      "15m": { "direction": "up | down | sideways", "target": number, "confidence": 0-1 },
      "1h": { "direction": "up | down | sideways", "target": number, "confidence": 0-1 },
      "4h": { "direction": "up | down | sideways", "target": number, "confidence": 0-1 },
      "1d": { "direction": "up | down | sideways", "target": number, "confidence": 0-1 }
    },
    "risk": "volatility warning + invalidation in VIETNAMESE"
  },
  "eth": { ... same structure ... },
  "marketSentiment": "bullish | bearish | neutral | mixed",
  "comparison": "BTC vs ETH comparison in VIETNAMESE"
}
```

### Narrative Template (in VIETNAMESE)
"Giá ở [vị trí] sau [sự kiện]. Thanh khoản nghỉ [trên/dưới]. Bias HTF [tăng/giảm/trung lập]. Kỳ vọng [hướng] về phía [mục tiêu]. Rủi ro tại [vô hiệu hóa]."

## 11. Multi-Timeframe Predictions

### Prediction Requirements
- For each timeframe (15m, 1h, 4h, 1d), provide:
  - **Direction**: up/down/sideways
  - **Target**: Specific price level (liquidity or FVG)
  - **Confidence**: 0.0-1.0 based on structure clarity

### Target Selection Logic
- Use nearest liquidity level if clear
- Use FVG fill zone if visible
- Use recent BOS/CHOCH level as reference
- Default to 2-5% move if no clear level

## 12. Fallback Behavior

### When Groq API Fails
1. Calculate % change per timeframe
2. Determine bias from 4h trend
3. Generate simple narrative
4. Set confidence 40-55%
5. Mark key_levels as "not identified"

### Fallback Logic
- 4h change > 1% → bullish bias
- 4h change < -1% → bearish bias
- |4h change| < 1% → neutral bias
- Action: buy/sell only if 1h agrees, else hold
- Generate Vietnamese narrative
- Set BOS/CHOCH levels as "not identified"
- Set prediction targets to null for uncertain cases

## 13. Historical Prediction Context

### When Historical Data is Available
The system provides recent prediction accuracy (4h and 1d timeframes, last 24 hours) as context for new predictions.

### Timeframe Priority for Historical Context
- **Primary timeframes**: 4h and 1d (tracked for historical accuracy)
- **15m timeframe**: Used for micro-structure analysis only, not stored for historical context
- **Reasoning**: 4h and 1d provide meaningful data points; 15m is too noisy for long-term accuracy tracking

### Using Historical Context
When provided with past prediction results:
- **If recent predictions were incorrect** → Be more conservative with confidence (reduce by 10-20%)
- **If recent predictions were accurate** → Maintain or increase confidence
- **Review actual vs target differences** → Use to refine future target selection
- **Check for patterns** → If consistently missing targets in one direction, adjust bias

### Example Historical Context Format
```
BTC 4h: [2h ago] predicted UP to $68000 (conf: 80%) → actual: $68200 ✓ CORRECT
BTC 4h: [6h ago] predicted DOWN to $66000 (conf: 70%) → actual: $66500 ✗ INCORRECT
BTC 1d: [12h ago] predicted UP to $69000 (conf: 75%) → actual: $68800 ✓ CORRECT
```

### Validation Logic Improvement
Historical accuracy is tracked using OHLCV candles (15m granularity) for precise actual prices at prediction expiration time, ensuring accurate validation of 4h and 1d predictions.
