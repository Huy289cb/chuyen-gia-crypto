# Paper Trading System

## Overview

The Crypto Trend Analyzer includes a comprehensive paper trading system for simulating trades on BTC and ETH without real money. This system supports **multiple trading methods** for parallel analysis and comparison:

- **ICT Smart Money**: ICT concepts with 1h/4h timeframe analysis (temporarily disabled as of v2.5.0)
- **Kim Nghia Method**: SMC + Volume + Fibonacci with H4/H1 timeframe analysis

### Multi-Method Architecture Preservation (v2.5.0)

**Note:** ICT Smart Money method is temporarily disabled as of v2.5.0. All ICT code is preserved in the codebase for future multi-method support.

**Current Status:**
- ICT method: Disabled (scheduler commented out, account initialization commented out)
- Kim Nghia method: Active (10-minute schedule: 0,10,20,30,40,50)
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

> **IMPORTANT UPDATE (17/04/2026)**: Due to poor performance metrics (1/9 win rate), ETH trading has been **temporarily disabled** to focus on improving core BTC trading skills and achieving profitability before re-enabling multi-symbol trading.
>
> **ADDITIONAL UPDATES (17/04/2026)**:
> - Changed main prediction timeframe from 4h+1d to **1h primary + 4h secondary**
> - Increased max concurrent positions from 5 to **9**
> - AI now analyzes open positions and can recommend early closure (>80% confidence)
>
> **ADDITIONAL UPDATES (18/04/2026)**:
> - Changed minimum confidence threshold from **80% to 70%** for position entry
>
> **MULTI-METHOD UPDATE (19/04/2026)**:
> - Added support for multiple trading methods (ICT and Kim Nghia)
> - Method-specific accounts with separate 100U starting balance per method
> - Staggered scheduling: ICT at 0/15/30/45m, Kim Nghia at 7m30s/22m30s/37m30s/52m30s
> - Method tab switcher in frontend header for easy method switching
> - Method filtering on all API endpoints
> - Method comparison endpoint for side-by-side performance analysis

## Features

### Multi-Method Support (New - 19/04/2026)

- **Method-Specific Accounts**: Separate 100U accounts for each trading method (ICT, Kim Nghia)
- **Staggered Scheduling**: Methods run on different schedules to avoid API rate limits
  - ICT: Runs at 0m, 15m, 30m, 45m past the hour
  - Kim Nghia: Runs at 7m30s, 22m30s, 37m30s, 52m30s past the hour
- **Method Configuration**: Each method has its own system prompt, auto-entry thresholds, and trading rules
- **Frontend Method Switcher**: Tab-based switcher in header for easy method selection
- **Method Filtering**: All API endpoints support `?method=ict|kim_nghia` query parameter
- **Method Comparison**: `/api/compare` endpoint provides side-by-side performance comparison
- **Method-Specific Cache**: Separate analysis cache per method to prevent data mixing

### Existing Features

- **Auto-Entry Logic**: Automatically suggests positions when confidence >= 80% and ICT criteria are met
- **Dual Order Types**: Supports both **Market Orders** (immediate execution) and **Limit Orders** (wait for price)
- **Pending Orders System**: Automatically creates limit orders when entry price differs from current price
- **Risk Management**: 10% risk per trade with risk-based position sizing
- **Position Management**: Automatic Stop Loss (SL) and Take Profit (TP) monitoring
- **Early Position Closure**: Automatic closure on prediction reversal (>80% confidence, opposite bias)
- **AI Position Analysis**: AI evaluates open positions every 15 minutes and recommends closure (>80% confidence)
- **AI Limit Order Analysis**: AI evaluates pending limit orders every 15 minutes and recommends keep/cancel (>80% confidence)
- **Performance Tracking**: Comprehensive metrics including win rate, profit factor, drawdown
- **Account Management**: 100U BTC account (ETH trading temporarily disabled)
- **Volume Limit**: Max 2k USD total position volume per account (open positions + pending orders). Individual positions and pending orders are capped at 2k USD each. When volume reaches limit, new pending orders only allowed if entry aligns with SL/TP of existing positions (±0.5% tolerance) (updated 23/04/2026)
- **Order Validation**: SL/TP validation ensures logical placement (LONG: SL<entry<TP, SHORT: SL>entry>TP) (updated 23/04/2026)
- **Cooldown**: 4h cooldown after 3 consecutive losses (updated from 8, 23/04/2026)
- **Position Limits**: Maximum 6 concurrent positions per symbol
- **Trade History Pagination**: Paginated viewing of trade history (10 trades per page)
- **Limit Order Management**: Automatic execution when price hits entry, manual cancellation available

## Account Structure

**Current Status (19/04/2026)**:
- **ICT Method Accounts**: 100 USDT starting balance per symbol (BTC, ETH)
- **Kim Nghia Method Accounts**: 100 USDT starting balance per symbol (BTC, ETH)
- **ETH Trading**: Temporarily disabled for both methods to focus on BTC
- **Focus**: BTC-only trading to improve core skills and achieve profitability

Each trading method has its own independent paper trading accounts:
- **Starting Balance**: 100 USDT per method per symbol
- **Method-Specific Tracking**: Separate equity, PnL, and performance metrics per method
- **Auto-Initialization**: Accounts created automatically on first run per method
- **Database Schema**: Accounts table uses UNIQUE(symbol, method_id) for method separation

**Account Examples**:
- `BTC - ICT Method`: 100U starting balance, ICT analysis
- `BTC - Kim Nghia Method`: 100U starting balance, Kim Nghia analysis
- `ETH - ICT Method`: 100U starting balance (trading disabled)
- `ETH - Kim Nghia Method`: 100U starting balance (trading disabled)

## Auto-Entry Criteria (Updated 18/04/2026)

A position is suggested when ALL of the following conditions are met:

1. **Symbol Enablement**: Symbol must be in enabled list (currently only BTC)
2. **Confidence >= 70%**: AI confidence score must be at least 70% (updated from 80%)
3. **Clear Bias**: Bias must be bullish or bearish (not neutral)
4. **Multi-Timeframe Alignment**: Majority of 1h and 4h timeframes must align with bias (1h primary)
5. **Risk/Reward >= 2.0**: Expected R:R ratio must be at least 1:2
6. **No Cooldown**: Account must not be in cooldown period
7. **Position Limit**: Less than 6 concurrent positions per symbol open

## Order Types

### Market Orders
When AI suggests entry price that is **already hit** by current market price:
- **LONG**: Market order when `current_price <= entry_price` (price already dropped to entry)
- **SHORT**: Market order when `current_price >= entry_price` (price already rose to entry)
- Position opened **immediately** at current price
- No waiting required
- Best for when setup is already active

### Limit Orders (Pending Orders) - Updated (20/04/2026)
When AI suggests entry price that **has not been hit** yet:
- **LONG**: Pending when `current_price > entry_price` (waiting for price to drop to entry)
- **SHORT**: Pending when `current_price < entry_price` (waiting for price to rise to entry)
- Order stored as **pending** and monitored every 1 minute using 1-minute candle data
- Entry price validated to be within 10% of current price (realistic range)
- **AI Analysis**: AI evaluates pending orders every 15 minutes and recommends keep/cancel (>80% confidence)
- **Manual Cancellation**: Users can cancel pending orders via UI
- **Frontend Display**: Dedicated Pending Orders section shows all active limit orders
- **Accurate Trigger Detection**: Uses candle high/low to detect if entry was hit during fast price moves

Examples:
- **LONG Pending Example**:
  - Current BTC price: $77,000
  - AI suggests long @ $76,500 (current > entry)
  - System creates **pending limit order** at $76,500
  - When BTC drops to $76,500 → Position opened automatically

- **LONG Market Example**:
  - Current BTC price: $76,000
  - AI suggests long @ $76,500 (current <= entry)
  - System executes **market order** immediately at $76,000

- **SHORT Pending Example**:
  - Current BTC price: $76,000
  - AI suggests short @ $76,500 (current < entry)
  - System creates **pending limit order** at $76,500
  - When BTC rises to $76,500 → Position opened automatically

- **SHORT Market Example**:
  - Current BTC price: $77,000
  - AI suggests short @ $76,500 (current >= entry)
  - System executes **market order** immediately at $77,000

## Position Sizing (ICT-Based)

Position size is calculated using risk-based sizing:

```
Position Size = (Account Balance × Risk%) / |Entry Price - Stop Loss|
```

- **Risk per Trade**: 1% of account balance (configurable)
- **Entry Price**: AI suggested price for limit orders, current price for market orders
- **Stop Loss**: Below swing low (long) or above swing high (short)
- **Take Profit**: At liquidity target or FVG fill zone with minimum 1:2 R:R

## Cooldown System

- **Trigger**: After 3 consecutive losing trades
- **Duration**: 4 hours
- **Reset**: After any winning trade

This prevents overtrading during drawdown periods.

## Price Updates (Updated 20/04/2026)

- **Frequency**: Every 1 minute (changed from 30 seconds)
- **Data Source**: 1-minute candle OHLC data from Binance (open, high, low, close, volume)
- **Actions**:
  - **Check pending orders**: Execute limit orders when candle high/low crosses entry level
  - Update unrealized PnL for all open positions using candle close price
  - Check if SL or TP levels are hit using candle high/low for accurate detection
  - Auto-close positions on SL/TP hit
  - Update account equity
- **Account Snapshots**: Created every 5 minutes for equity curve
- **Why 1-minute candles**: Single price every 30 seconds cannot detect if TP/SL was hit during fast price moves. 1-minute candle high/low provides accurate trigger detection.

## Prediction Tracking System

### Overview

Each position opened is linked to a specific prediction timeframe for outcome tracking and performance analysis.

### Linking Logic

**Primary Timeframe: 4h**

- All positions are linked to the **4h prediction** when available
- If 4h prediction doesn't exist, falls back to **1d prediction**
- Position tracks outcome (win/loss/neutral) and realized PnL against this prediction

### Why 4h?

- **4h timeframe** is the primary trading signal for auto-entry
- **1d timeframe** is used for confirmation and trend alignment
- Only positions linked to 4h predictions are tracked in the prediction history timeline

### Outcome Flow

1. **Position Opened**: Prediction outcome set to `pending`
2. **Position Active**: Outcome remains `pending` while position is open
3. **Position Closed**: Outcome updated to `win`, `loss`, or `neutral` based on realized PnL
4. **PnL Recorded**: Realized profit/loss saved to prediction record

### Frontend Display

**Prediction Timeline Component** (`PredictionTimeline.jsx`):
- Only displays **4h timeframe predictions**
- Shows prediction price, confidence, and outcome
- Displays entry suggestion, SL, TP levels when expanded
- Color-coded outcomes: green (win), red (loss), yellow (pending), gray (-)

### API Response

```json
{
  "id": "analysis-123-4h",
  "analysis_id": 123,
  "timestamp": "2024-01-15T08:00:00Z",
  "current_price": 70954.74,
  "timeframe": "4h",
  "direction": "up",
  "confidence": 0.85,
  "outcome": "win",
  "pnl": 12.50,
  "linked_position_id": 456
}
```

## Volume Management (Updated 23/04/2026)

### Total Volume Calculation
- Total volume = open positions volume + pending orders volume
- Maximum limit: 2k USD per account
- System checks both open positions and pending orders before creating new orders

### Strategic Entry Validation
When total volume reaches 2k limit (or 90% of limit):
- New pending orders only allowed if entry price aligns with SL or TP of existing open positions
- Tolerance: ±0.5% from SL/TP levels
- Prevents over-leveraging while allowing strategic position additions

### Example
- Current open positions: $1,800 (2 positions)
- Existing pending orders: $150 (1 order)
- Total volume: $1,950
- New pending order requested: $100
- Check: $1,950 + $100 = $2,050 > $2,000 limit
- Strategic check: Does entry align with SL/TP of existing positions?
  - If yes: Allow order
  - If no: Reject with reason "Volume limit reached, entry not at strategic level"

## Pending Orders System

### How It Works (Updated 18/04/2026)

1. **AI Analysis**: Groq AI analyzes market and suggests entry price
2. **Order Classification** (Direction-Based):
   - **LONG**: Market order when `current_price <= entry_price`, Limit order when `current_price > entry_price`
   - **SHORT**: Market order when `current_price >= entry_price`, Limit order when `current_price < entry_price`
3. **Monitoring**: Every 1 minute using 1-minute candle data, system checks all pending orders
4. **Execution**: When candle high/low crosses entry level, position opened automatically

### Pending Order Lifecycle

| Status | Description |
|--------|-------------|
| `pending` | Order waiting for price to hit entry level |
| `executed` | Order successfully executed, position opened |
| `cancelled_*` | Order cancelled (e.g., analysis invalidated) |

### Database Schema

**pending_orders table**:
- `order_id`: Unique identifier
- `symbol`: BTC or ETH
- `side`: long or short
- `entry_price`: Target entry price
- `stop_loss`, `take_profit`: Risk management levels
- `size_usd`, `size_qty`: Position sizing
- `status`: pending, executed, or cancelled
- `created_at`, `executed_at`: Timestamps

## API Endpoints

### Analysis (Updated - 19/04/2026)
- `GET /api/analysis` - Get cached trend analysis (supports `?method=ict|kim_nghia`)
- `GET /api/analysis?method=ict` - Get ICT method analysis
- `GET /api/analysis?method=kim_nghia` - Get Kim Nghia method analysis

### Predictions (Updated - 19/04/2026)
- `GET /api/predictions/:coin` - Get prediction history (supports `?method=ict|kim_nghia`)
- `GET /api/predictions/:coin?method=ict` - Get ICT predictions
- `GET /api/predictions/:coin?method=kim_nghia` - Get Kim Nghia predictions

### Positions (Updated - 19/04/2026)
- `GET /api/positions` - Get all positions (filter by symbol, status, method)
- `GET /api/positions?method=ict` - Get ICT method positions
- `GET /api/positions?method=kim_nghia` - Get Kim Nghia method positions
- `GET /api/positions/:id` - Get specific position
- `POST /api/positions/open` - Open new position
- `POST /api/positions/close/:id` - Close position

### Accounts (Updated - 19/04/2026)
- `GET /api/accounts` - Get all accounts (supports `?method=ict|kim_nghia`)
- `GET /api/accounts?method=ict` - Get ICT method accounts
- `GET /api/accounts?method=kim_nghia` - Get Kim Nghia method accounts
- `GET /api/accounts/:symbol` - Get account by symbol (supports `?method=ict|kim_nghia`)
- `POST /api/accounts/reset/:symbol` - Reset account to starting balance (requires `method` in body)

### Performance (Updated - 19/04/2026)
- `GET /api/performance?symbol=` - Get performance metrics (supports `?method=ict|kim_nghia`)
- `GET /api/performance/equity-curve?symbol=` - Get equity curve data (supports `?method=ict|kim_nghia`)
- `GET /api/performance/trades?symbol=` - Get trade history (supports `?method=ict|kim_nghia`)
- `GET /api/performance/accuracy-timeframe?symbol=` - Get accuracy by timeframe (supports `?method=ict|kim_nghia`)
- `GET /api/performance/accuracy-bias?symbol=` - Get accuracy by bias (supports `?method=ict|kim_nghia`)
- `GET /api/performance/hold-time?symbol=` - Get average hold time (supports `?method=ict|kim_nghia`)

### Method Comparison (New - 19/04/2026)
- `GET /api/compare` - Side-by-side comparison of ICT and Kim Nghia methods
  - Returns account metrics, performance stats, open positions, latest analysis for both methods
  - Includes summary showing which method performs better in each category

### Pending Orders (Updated - 19/04/2026)
- `GET /api/pending-orders` - Get all pending orders (supports `?method=ict|kim_nghia`)
- `GET /api/pending-orders/:id` - Get specific pending order
- `POST /api/pending-orders/:id/cancel` - Cancel a pending order

## Performance Metrics

The system tracks the following metrics:

- **Starting Balance**: Initial account balance (100U)
- **Current Equity**: Balance + unrealized PnL
- **Realized PnL**: Total profit/loss from closed positions
- **Total Return %**: (Equity - Starting) / Starting × 100
- **Win Rate**: Winning trades / Total trades × 100
- **Profit Factor**: Gross profit / Gross loss
- **Max Drawdown**: Maximum peak-to-trough decline
- **Average R Multiple**: Average profit per unit of risk
- **Total Trades**: Number of closed positions
- **Winning/Losing Trades**: Count of profitable and unprofitable trades
- **Consecutive Losses**: Current loss streak

## Position Status (Updated 17/04/2026)

Positions can have the following statuses:

- `open`: Position is currently open
- `closed`: Closed normally
- `stopped`: Closed by hitting stop loss
- `taken_profit`: Closed by hitting take profit
- `closed_manual`: Closed manually by user
- `closed_reversal`: Closed due to prediction reversal (new)
- `expired`: Closed due to time expiration

## Performance Optimization (17/04/2026)

### Problem Identified
- **Win Rate**: 1/9 (11%) - unsustainable with current R:R ratios
- **Root Cause**: ETH trading contributing to poor performance, unlimited position accumulation, no early closure mechanism

### Implemented Solutions

#### 1. BTC-Only Focus
- **ETH Trading**: Temporarily disabled to eliminate ETH-related losses
- **Symbol Configuration**: `enabledSymbols: ['BTC']` in auto-entry logic
- **Frontend**: ETH trading information hidden, price charts and predictions preserved

#### 2. Position Management
- **Position Limit**: Maximum 6 concurrent positions per symbol
- **Entry Logic**: Each new prediction (>80% confidence) can open 1 position if total <6
- **Validation**: Symbol enablement check at entry level
- **Timeframe Priority**: 1h primary, 4h secondary (changed from 4h+1d)

#### 3. Early Closure System
- **Trigger**: New analysis with opposite bias AND confidence > 80%
- **Frequency**: Runs every 15 minutes (when new analysis generated)
- **Scope**: BTC positions only
- **Close Reason**: `prediction_reversal` with proper status tracking

#### 4. AI Position Analysis (New - 17/04/2026)
- **Open Position Monitoring**: AI receives all open positions in analysis prompt
- **Intelligent Decisions**: AI can recommend position closure, SL/TP adjustments
- **Confidence Threshold**: Recommendations only if confidence > 80%
- **Risk Assessment**: AI evaluates current PnL, risk %, and market conditions
- **Integration**: Position decisions included in AI response JSON structure

#### 5. AI Limit Order Analysis (New - 17/04/2026)
- **Pending Order Monitoring**: AI receives all pending limit orders in analysis prompt
- **Intelligent Decisions**: AI can recommend keep/cancel/modify limit orders
- **Confidence Threshold**: Recommendations only if confidence > 80%
- **Market Conditions**: AI evaluates if setup is still valid or market has changed
- **Time Analysis**: AI considers how long orders have been waiting
- **Integration**: Limit order decisions included in AI response JSON structure

#### 6. UI Enhancements
- **Trade History**: Pagination (10 trades per page) with BTC-only filtering
- **Dashboard**: BTC-focused metrics display
- **Performance**: Enhanced position limit indicators
- **Pending Orders**: Dedicated section showing all active limit orders with cancellation capability

### Expected Outcomes
- **ETH Losses**: Eliminated to zero
- **Position Management**: Better risk control with 6-position limit per symbol and 1h timeframe focus
- **Early Loss Cutting**: Reduced losses through AI-driven position analysis and prediction reversal
- **Limit Order Intelligence**: AI-powered limit order management to keep only valid setups
- **Focus**: Improved BTC trading skills before multi-symbol expansion
- **AI Intelligence**: Enhanced decision-making with open position and limit order analysis
- **Consecutive Loss Protection**: Increased cooldown trigger from 3 to 8 consecutive losses for better risk management

## Important Notes

- **Paper Trading Only**: This is a simulation system. No real money is involved.
- **Educational Purpose**: Designed for learning and evaluating AI performance.
- **No Financial Advice**: All suggestions are for educational purposes only.
- **API Limitations**: Analysis runs every 15 minutes due to free Groq API limits.
- **Data Freshness**: Price updates every 1 minute using 1-minute candle data for accurate SL/TP detection.

## Order Logic Validation (Updated 23/04/2026)

### SL/TP Placement Rules
All orders (market and pending) must have logically correct SL/TP placement:

**LONG Positions:**
- Stop Loss must be BELOW entry price
- Take Profit must be ABOVE entry price
- Example: Entry $77,000, SL $76,500, TP $78,000 ✓

**SHORT Positions:**
- Stop Loss must be ABOVE entry price
- Take Profit must be BELOW entry price
- Example: Entry $77,000, SL $77,500, TP $76,500 ✓

**Validation Points:**
- AI response validation (analyzerFactory.js)
- Position calculation validation (autoEntryLogic.js)
- Pending order creation validation (database.js)

**Minimum SL Distance:**
- ICT method: 0.75% from entry
- Kim Nghia method: 0.3% from entry

## Position Opening Logic (Updated 18/04/2026)

### Smart Order Type Decision

**IMPORTANT**: The system intelligently decides between market and limit orders based on whether the suggested entry price has already been hit by current market price.

### Implementation Details

1. **Order Type Decision Logic**
   - **LONG positions**:
     - Market order when `current_price <= entry_price` (price already dropped to entry)
     - Limit order when `current_price > entry_price` (waiting for price to drop)
   - **SHORT positions**:
     - Market order when `current_price >= entry_price` (price already rose to entry)
     - Limit order when `current_price < entry_price` (waiting for price to rise)

2. **Market Order Execution**
   - Position opened **immediately** at current market price
   - No waiting required
   - Best for when setup is already active

3. **Limit Order (Pending) Execution**
   - Order stored as **pending** and monitored every 1 minute using 1-minute candle data
   - Automatic execution when candle high/low crosses entry level
   - Full SL/TP management once position is opened

4. **Order Creation Process Examples**
   ```
   Example 1 - LONG Market Order:
   AI Analysis Entry Price: $76,500
   Current Market Price: $76,000
   Decision: Market order (current <= entry)
   Action: Execute immediately at $76,000

   Example 2 - LONG Limit Order:
   AI Analysis Entry Price: $76,500
   Current Market Price: $77,000
   Decision: Limit order (current > entry)
   Action: Create pending order at $76,500
   Status: Wait for price to drop to $76,500

   Example 3 - SHORT Market Order:
   AI Analysis Entry Price: $76,500
   Current Market Price: $77,000
   Decision: Market order (current >= entry)
   Action: Execute immediately at $77,000

   Example 4 - SHORT Limit Order:
   AI Analysis Entry Price: $76,500
   Current Market Price: $76,000
   Decision: Limit order (current < entry)
   Action: Create pending order at $76,500
   Status: Wait for price to rise to $76,500
   ```

5. **Price Difference Tracking**
   - System logs price difference percentages
   - Example: "Entry $76,500 vs current $77,000 (0.65% away)"
   - Helps monitor how close price is to entry level

### Why This Matters

- **Realistic Trading**: Executes at appropriate prices based on market conditions
- **Efficiency**: Market orders for immediate entry when setup is active
- **Patience**: Limit orders for better entry prices when setup hasn't triggered
- **Strategy Integrity**: Ensures AI suggestions are executed at intended levels
- **Performance Accuracy**: True reflection of strategy performance

### Monitoring

Check backend logs for:
```
[AutoEntry] Market order: entry already hit - entry=76500.00, current=76000.00
[Scheduler] BTC market order executed immediately at 76000.00
[AutoEntry] Limit order created: entry=76500.00, current=77000.00, diff=0.65%
[Scheduler] BTC limit order created (pending): entry 76500.00
[PriceScheduler] BTC limit order executed: side=long @ $76500.00
```

## ICT Position Management Strategies (Updated 17/04/2026)

### Smart Money Concepts (ICT) Position Management

The system implements ICT-based position management strategies that adapt to different Risk/Reward ratios. This ensures optimal profit-taking while managing risk effectively.

#### **R:R 2.0 Strategy (Default)**
- **TP1 (1:1)**: Close 50%, move SL to entry (breakeven)
- **TP2 (2:1)**: Close remaining 50%
- **Rationale**: Secure profit at 1:1, let remainder run to full target

#### **R:R 3.0 Strategy**
- **TP1 (1:1)**: Close 33%, move SL to entry
- **TP2 (2:1)**: Close 33%, tighten trailing stop
- **TP3 (3:1)**: Close remaining 34%
- **Rationale**: Scale out progressively, reduce risk as profit increases

#### **R:R 5.0 Strategy**
- **TP1 (1:1)**: Close 25%, move SL to entry
- **TP2 (2:1)**: Close 25%, move SL to 1.5:1 level
- **TP3 (3:1)**: Close 25%, move SL to 2.5:1 level
- **TP4 (5:1)**: Close remaining 25%
- **Rationale**: Conservative scaling with progressive SL tightening

#### **R:R 7.0 Strategy**
- **TP1 (1:1)**: Close 20%, move SL to entry
- **TP2 (2:1)**: Close 20%, move SL to 1.5:1 level
- **TP3 (3:1)**: Close 20%, move SL to 2.5:1 level
- **TP4 (5:1)**: Close 20%, move SL to 4:1 level
- **TP5 (7:1)**: Close remaining 20%
- **Rationale**: Very conservative scaling, lock in profits progressively

### **Stop Loss Management**

#### **Progressive SL Movement**
- **SL Move 0**: Move to entry price (breakeven)
- **SL Move 1**: Move to TP1 level
- **SL Move 2**: Move to TP2 level
- **SL Move 3**: Move to TP3 level
- **SL Move 4**: Move to TP4 level

#### **Trailing Stop Logic**
- After each TP hit, SL is moved to protect profits
- Higher R:R ratios get more aggressive SL tightening
- Ensures risk-free trading after initial profit secured

### **Implementation Examples**

#### **Example: R:R 3.0 Long Position**
```
Entry: $70,000
Stop Loss: $68,000 (Risk: $2,000)
Expected RR: 3.0

TP1 (1:1): $72,000 - Close 33%, move SL to $70,000
TP2 (2:1): $74,000 - Close 33%, move SL to $72,000  
TP3 (3:1): $76,000 - Close remaining 34%
```

#### **Example: R:R 7.0 Short Position**
```
Entry: $70,000
Stop Loss: $72,000 (Risk: $2,000)
Expected RR: 7.0

TP1 (1:1): $68,000 - Close 20%, move SL to $70,000
TP2 (2:1): $66,000 - Close 20%, move SL to $68,000
TP3 (3:1): $64,000 - Close 20%, move SL to $66,000
TP4 (5:1): $60,000 - Close 20%, move SL to $64,000
TP5 (7:1): $56,000 - Close remaining 20%
```

### **Monitoring and Logging**

The system logs all TP hits and SL movements:
```
[PaperTrading] BTC position abc-123 hit TP1, closed 50%, SL moved to 70000.00
[PaperTrading] BTC position abc-123 hit TP2, closed 33%, SL moved to 72000.00
[PaperTrading] BTC position abc-123 hit TP3, closed 34%, position fully closed
```

### **Benefits of ICT Position Management**

1. **Risk Management**: Progressive risk reduction as profits increase
2. **Psychological Advantage**: Securing profits reduces emotional trading
3. **Maximum Profit Potential**: Let portions run to full targets
4. **Adaptive Strategy**: Different approaches for different R:R ratios
5. **Professional Trading**: Follows institutional trading practices

## Configuration (Updated 17/04/2026)

Key configuration options in `.env`:

```bash
# Paper Trading Configuration
RISK_PER_TRADE_PERCENT=1
MIN_CONFIDENCE_THRESHOLD=70  # Updated from 80% on 18/04/2026
MIN_RR_RATIO=2
PRICE_UPDATE_INTERVAL=30
MAX_CONSECUTIVE_LOSSES=3
COOLDOWN_HOURS=4

# Symbol Configuration (BTC-only trading - Updated 17/04/2026)
ENABLED_SYMBOLS=BTC
MAX_POSITIONS_PER_SYMBOL=8

# Prediction Reversal Check (New - 17/04/2026)
PREDICTION_REVERSAL_ENABLED=true
PREDICTION_REVERSAL_CONFIDENCE=80

# Session Timing (ICT: focus on high-liquidity sessions)
ALLOWED_SESSIONS=london,ny_killzone

# Partial Take Profits (ICT: take profits in stages)
PARTIAL_TP_ENABLED=true
PARTIAL_TP_RATIOS=0.5,0.5
PARTIAL_TP_RR_LEVELS=1.0,2.0

# Trailing Stop (ICT: move SL to breakeven after TP1)
TRAILING_STOP_ENABLED=true
TRAIL_AFTER_RR=1.0
TRAIL_DISTANCE_PCT=0.5
```

### New Configuration Variables (Updated 17/04/2026)

- **ENABLED_SYMBOLS**: Controls which symbols can trade (currently BTC only)
- **MAX_POSITIONS_PER_SYMBOL**: Maximum concurrent positions per symbol (8 for BTC, increased from 5)
- **PREDICTION_REVERSAL_ENABLED**: Enable/disable early closure on prediction reversal
- **PREDICTION_REVERSAL_CONFIDENCE**: Minimum confidence for reversal-triggered closure (80%)
- **AI_POSITION_ANALYSIS**: AI analyzes open positions every 15 minutes for closure recommendations

## Bug Fixes (18/04/2026)

### Fixed Logic Errors

1. **Pending Order Execution After Restart**
   - **Issue**: Pending orders wouldn't execute after server restart due to null `previousPrice`
   - **Fix**: Execute orders if current price is at/beyond entry level regardless of previous price
   - **Impact**: Limit orders now execute correctly even after server restart

2. **Manual Position Limit Consistency**
   - **Issue**: Manual opening rejected if ANY position existed, but auto-entry allows up to 6
   - **Fix**: Manual opening now respects `maxPositionsPerSymbol` limit (6 positions per symbol)
   - **Impact**: Consistent position limits across manual and auto-entry

3. **Minimum Risk Distance Validation**
   - **Issue**: Manual opening lacked validation for tight stop losses (could create positions with SL $1.27 away from entry on $76k price)
   - **Fix**: Added 0.5% minimum risk distance validation to manual opening
   - **Impact**: Prevents unrealistically tight stop losses in manual positions

4. **Auto-Entry Stop Loss Validation**
   - **Issue**: AI could suggest stop loss too close to entry (e.g., $1.27 difference on $76k price)
   - **Fix**: Added 0.5% minimum risk distance validation in auto-entry logic
   - **Impact**: AI suggestions with tight stop losses are rejected

5. **Groq Analyzer Stop Loss Validation**
   - **Issue**: AI validation only checked price range (50%-150%), not distance from entry
   - **Fix**: Added minimum distance validation (0.5% from entry) in AI response validation
   - **Impact**: AI-generated suggestions with tight stop losses are rejected at source

### Validation Summary

All position openings (manual and auto) now enforce:
- **Minimum risk distance**: ICT method 0.75%, Kim Nghia method 0.5% of entry price (updated on 21/04/2026)
- **Maximum positions**: 6 concurrent positions per symbol
- **Price range validation**: Entry within 10% of current price for limit orders
- **Direction alignment**: Entry price must align with trade direction

> **Note**: groqAnalyzer.js has been removed. All analysis now uses analyzerFactory.js directly. Shared utilities extracted to utils/dateHelpers.js and utils/asyncHelpers.js.
- **Minimum confidence**: ICT 70%, Kim Nghia 75% threshold for auto-entry
- **AI-provided SL/TP**: Required for auto-entry (no default fallback)
- **SL/TP side validation**: SL must be on correct side of entry based on bias
- **Granular SL/TP**: AI must provide precise price levels with at least 2 decimal places

## Production Fixes (20/04/2026)

### Issue 1: Granular SL/TP Values
- **Problem**: SL/TP values appearing as even numbers (e.g., 74800, 75600)
- **Root Cause**: AI prompts didn't explicitly request granular price levels
- **Fix**: Added AI prompt rules requiring precise price levels with at least 2 decimal places
- **Files Modified**: `backend/src/config/methods.js` (ICT and Kim Nghia prompts)
- **Impact**: SL/TP now reflect actual market structure (e.g., 74835.52, 74787.06)

### Issue 2: Short Position TP/SL Logic
- **Problem**: Short positions had TP higher than SL (incorrect - TP should be lower than entry for short)
- **Root Cause**: Missing validation for SL/TP side alignment with position direction
- **Fix**: Added validation in `analyzerFactory.js` ensuring:
  - Long: SL < entry < TP
  - Short: SL > entry > TP
- **Files Modified**: `backend/src/analyzers/analyzerFactory.js`
- **Impact**: Correct SL/TP ordering for short positions

### Issue 3: Prediction Timeline Close Prediction
- **Problem**: Predictions showed "close" but no positions were actually closed
- **Root Cause**: `position_decisions` from AI were stored but not processed to execute closures
- **Fix**: Added processing in `scheduler.js` to:
  - Read `position_decisions.recommendations` from AI analysis
  - Execute close action when AI recommends closure
  - Log which position was closed and reason
- **Files Modified**: `backend/src/scheduler.js`
- **Impact**: Positions now close when AI recommends closure

### Issue 4: Stop Loss PnL Positive
- **Problem**: Positions hit stop loss but showed positive PnL (should be negative)
- **Root Cause**: When closing position, used current market price instead of stop loss price for PnL calculation
- **Fix**: Changed `paperTradingEngine.js` to use `position.stop_loss` instead of `currentPrice` when closing due to stop loss
- **Files Modified**: `backend/src/services/paperTradingEngine.js`
- **Impact**: Accurate PnL calculation for stop loss events (negative for losses)

### Issue 5: Default SL/TP Fallback
- **Problem**: System used default percentage-based SL/TP when AI didn't provide values
- **Root Cause**: `autoEntryLogic.js` had fallback logic:
  - Entry: fallback to current price
  - SL: fallback to entry ± 1%
  - TP: fallback to entry ± 2%
- **Fix**: Removed all fallback logic and require AI-provided Entry, SL, TP
- **Files Modified**: `backend/src/services/autoEntryLogic.js`
- **Impact**: Only trades with proper market structure levels execute; trades rejected if AI doesn't provide clear values

### Issue 6: SL Distance Too Small
- **Problem**: Entry and SL too close (e.g., $3.33 on $74k price = 0.0044%)
- **Root Cause**:
  - Minimum validation was only 0.5%
  - Default SL calculated from current price instead of entry
  - When entry close to current price, SL would be very close to entry
- **Fix**:
  - Increased minimum SL distance from 0.5% to 1%
  - Changed default SL calculation from current price to entry price
  - Updated validation in both `autoEntryLogic.js` and `analyzerFactory.js`
  - Added prompt rules requiring SL to be at least 1% away from entry
- **Files Modified**: `backend/src/services/autoEntryLogic.js`, `backend/src/analyzers/analyzerFactory.js`, `backend/src/config/methods.js`
- **Impact**: Minimum $750 SL distance on $75k entry (1%)

### Issue 7: AI Prompt SL/TP Placement Rules
- **Problem**: AI suggesting TP on wrong side of entry for short positions
- **Root Cause**: AI prompts lacked explicit SL/TP placement rules with examples
- **Fix**: Added explicit SL/TP placement rules with examples for LONG/SHORT positions
  - LONG: SL < Entry < TP (SL below entry, TP above entry)
  - SHORT: Entry > TP > SL (TP below entry, SL above entry)
- **Files Modified**: `backend/src/config/methods.js` (ICT and Kim Nghia prompts)
- **Impact**: AI now follows correct SL/TP ordering for both long and short positions

### Issue 8: Groq API Token Limit
- **Problem**: Rate limit reached (496,843/500,000 tokens per day)
- **Root Cause**: Prompts contained educational content that the AI already knows, and verbose JSON schema descriptions
- **Fix**: Optimized prompts by:
  - Removing educational content about ICT concepts (AI already knows BOS, CHOCH, liquidity, etc.)
  - Condensing JSON schema from verbose to compact format
  - Combining related rules into single lines
  - Using symbols (|, ≥, ≤, →) for brevity
  - Maintaining all method-specific information and validation rules
- **Files Modified**: `backend/src/config/methods.js`
- **Impact**: Token usage reduced by ~70% while maintaining method-specific information and output accuracy

## Future Enhancements

The following features are planned but not yet implemented:

- Trailing stop loss
- Break-even at 1:1 R:R
- Partial position closing
- Scaling in/out of positions
- Multi-account support (user-specific)
- Real-time WebSocket price feeds
- Backtesting engine
