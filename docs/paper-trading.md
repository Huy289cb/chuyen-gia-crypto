# Paper Trading System

## Overview

The Crypto Trend Analyzer includes a comprehensive paper trading system for simulating trades on BTC and ETH without real money. This system uses ICT Smart Money Concepts analysis to automatically suggest and manage positions.

> **IMPORTANT UPDATE (17/04/2026)**: Due to poor performance metrics (1/9 win rate), ETH trading has been **temporarily disabled** to focus on improving core BTC trading skills and achieving profitability before re-enabling multi-symbol trading.
> 
> **ADDITIONAL UPDATES (17/04/2026)**: 
> - Changed main prediction timeframe from 4h+1d to **1h primary + 4h secondary**
> - Increased max concurrent positions from 5 to **8**
> - AI now analyzes open positions and can recommend early closure (>80% confidence)

## Features

- **Auto-Entry Logic**: Automatically suggests positions when confidence >= 80% and ICT criteria are met
- **Dual Order Types**: Supports both **Market Orders** (immediate execution) and **Limit Orders** (wait for price)
- **Pending Orders System**: Automatically creates limit orders when entry price differs from current price
- **Risk Management**: 1% risk per trade with risk-based position sizing
- **Position Management**: Automatic Stop Loss (SL) and Take Profit (TP) monitoring
- **Early Position Closure**: Automatic closure on prediction reversal (>80% confidence, opposite bias)
- **AI Position Analysis**: AI evaluates open positions every 15 minutes and recommends closure (>80% confidence)
- **AI Limit Order Analysis**: AI evaluates pending limit orders every 15 minutes and recommends keep/cancel (>80% confidence)
- **Performance Tracking**: Comprehensive metrics including win rate, profit factor, drawdown
- **Account Management**: 100U BTC account (ETH trading temporarily disabled)
- **Cooldown System**: 4-hour cooldown after 3 consecutive losses
- **Position Limits**: Maximum 8 concurrent BTC positions
- **Trade History Pagination**: Paginated viewing of trade history (10 trades per page)
- **Limit Order Management**: Automatic execution when price hits entry, manual cancellation available

## Account Structure

**Current Status (17/04/2026)**:
- **BTC Account**: 100 USDT starting balance, fully active
- **ETH Account**: 100 USDT starting balance, trading temporarily disabled
- **Focus**: BTC-only trading to improve core skills and achieve profitability

Each cryptocurrency has its own paper trading account:
- **Starting Balance**: 100 USDT
- **Independent Tracking**: Separate equity, PnL, and performance metrics
- **Auto-Initialization**: Accounts created automatically on first run

## Auto-Entry Criteria (Updated 17/04/2026)

A position is suggested when ALL of the following conditions are met:

1. **Symbol Enablement**: Symbol must be in enabled list (currently only BTC)
2. **Confidence >= 80%**: AI confidence score must be at least 80%
3. **Clear Bias**: Bias must be bullish or bearish (not neutral)
4. **Multi-Timeframe Alignment**: Majority of 1h and 4h timeframes must align with bias (1h primary)
5. **Risk/Reward >= 2.0**: Expected R:R ratio must be at least 1:2
6. **No Cooldown**: Account must not be in cooldown period
7. **Position Limit**: Less than 8 concurrent BTC positions open

## Order Types

### Market Orders
When AI suggests entry price that is **already hit** by current market price:
- **LONG**: Market order when `current_price <= entry_price` (price already dropped to entry)
- **SHORT**: Market order when `current_price >= entry_price` (price already rose to entry)
- Position opened **immediately** at current price
- No waiting required
- Best for when setup is already active

### Limit Orders (Pending Orders) - Updated (18/04/2026)
When AI suggests entry price that **has not been hit** yet:
- **LONG**: Pending when `current_price > entry_price` (waiting for price to drop to entry)
- **SHORT**: Pending when `current_price < entry_price` (waiting for price to rise to entry)
- Order stored as **pending** and monitored every 30 seconds
- Entry price validated to be within 10% of current price (realistic range)
- **AI Analysis**: AI evaluates pending orders every 15 minutes and recommends keep/cancel (>80% confidence)
- **Manual Cancellation**: Users can cancel pending orders via UI
- **Frontend Display**: Dedicated Pending Orders section shows all active limit orders

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

## Price Updates

- **Frequency**: Every 30 seconds
- **Actions**:
  - **Check pending orders**: Execute limit orders when price hits entry level
  - Update unrealized PnL for all open positions
  - Check if SL or TP levels are hit
  - Auto-close positions on SL/TP hit
  - Update account equity
- **Account Snapshots**: Created every 5 minutes for equity curve

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

## Pending Orders System

### How It Works (Updated 18/04/2026)

1. **AI Analysis**: Groq AI analyzes market and suggests entry price
2. **Order Classification** (Direction-Based):
   - **LONG**: Market order when `current_price <= entry_price`, Limit order when `current_price > entry_price`
   - **SHORT**: Market order when `current_price >= entry_price`, Limit order when `current_price < entry_price`
3. **Monitoring**: Every 30 seconds, system checks all pending orders
4. **Execution**: When price crosses entry level, position opened automatically

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

### Positions
- `GET /api/positions` - Get all positions (filter by symbol, status)
- `GET /api/positions/:id` - Get specific position
- `POST /api/positions/open` - Open new position
- `POST /api/positions/close/:id` - Close position

### Accounts
- `GET /api/accounts` - Get all accounts
- `GET /api/accounts/:symbol` - Get account by symbol
- `POST /api/accounts/reset/:symbol` - Reset account to starting balance

### Performance
- `GET /api/performance?symbol=` - Get performance metrics
- `GET /api/performance/equity-curve?symbol=` - Get equity curve data
- `GET /api/performance/trades?symbol=` - Get trade history

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
- **Position Limit**: Maximum 8 concurrent BTC positions (increased from 5)
- **Entry Logic**: Each new prediction (>80% confidence) can open 1 position if total <8
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
- **Position Management**: Better risk control with 8-position limit and 1h timeframe focus
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
- **Data Freshness**: Price updates every 30 seconds for position monitoring.

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
   - Order stored as **pending** and monitored every 30 seconds
   - Automatic execution when price crosses entry level
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
MIN_CONFIDENCE_THRESHOLD=80
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
   - **Issue**: Manual opening rejected if ANY position existed, but auto-entry allows up to 8
   - **Fix**: Manual opening now respects `maxPositionsPerSymbol` limit (8 positions)
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
- **Minimum risk distance**: 0.5% of entry price (e.g., $380 minimum on $76k entry)
- **Maximum positions**: 8 concurrent positions per symbol
- **Price range validation**: Entry within 10% of current price for limit orders
- **Direction alignment**: Entry price must align with trade direction

## Future Enhancements

The following features are planned but not yet implemented:

- Trailing stop loss
- Break-even at 1:1 R:R
- Partial position closing
- Scaling in/out of positions
- Multi-account support (user-specific)
- Real-time WebSocket price feeds
- Backtesting engine
