# Paper Trading System

## Overview

The Crypto Trend Analyzer includes a comprehensive paper trading system for simulating trades on BTC and ETH without real money. This system uses ICT Smart Money Concepts analysis to automatically suggest and manage positions.

## Features

- **Auto-Entry Logic**: Automatically suggests positions when confidence >= 80% and ICT criteria are met
- **Dual Order Types**: Supports both **Market Orders** (immediate execution) and **Limit Orders** (wait for price)
- **Pending Orders System**: Automatically creates limit orders when entry price differs from current price
- **Risk Management**: 1% risk per trade with risk-based position sizing
- **Position Management**: Automatic Stop Loss (SL) and Take Profit (TP) monitoring
- **Performance Tracking**: Comprehensive metrics including win rate, profit factor, drawdown
- **Account Management**: Separate 100U accounts for BTC and ETH
- **Cooldown System**: 4-hour cooldown after 3 consecutive losses

## Account Structure

Each cryptocurrency has its own paper trading account:
- **Starting Balance**: 100 USDT
- **Independent Tracking**: Separate equity, PnL, and performance metrics
- **Auto-Initialization**: Accounts created automatically on first run

## Auto-Entry Criteria

A position is suggested when ALL of the following conditions are met:

1. **Confidence >= 80%**: AI confidence score must be at least 80%
2. **Clear Bias**: Bias must be bullish or bearish (not neutral)
3. **Multi-Timeframe Alignment**: Majority of 4h and 1d timeframes must align with bias
4. **Risk/Reward >= 2.0**: Expected R:R ratio must be at least 1:2
5. **No Cooldown**: Account must not be in cooldown period
6. **Max Positions**: No open positions for the symbol (max 1 per symbol)

## Order Types

### Market Orders
When AI suggests entry price within **0.5%** of current market price:
- Position opened **immediately** at current price
- No waiting required
- Best for high-confidence, immediate execution scenarios

### Limit Orders (Pending Orders)
When AI suggests entry price **more than 0.5%** away from current price:
- Order stored as **pending** and monitored every 30 seconds
- **Long positions**: Executed when price drops to entry level
- **Short positions**: Executed when price rises to entry level
- Entry price validated to be within 10% of current price (realistic range)

Example:
- Current BTC price: $71,000
- AI suggests short @ $67,000 (5.6% away)
- System creates **pending limit order** at $67,000
- When BTC drops to $67,000 → Position opened automatically

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

## Pending Orders System

### How It Works

1. **AI Analysis**: Groq AI analyzes market and suggests entry price
2. **Order Classification**:
   - Entry near current price (≤0.5% diff) → **Market Order** (execute now)
   - Entry far from price (>0.5% diff) → **Limit Order** (create pending)
3. **Monitoring**: Every 30 seconds, system checks all pending orders
4. **Execution**: When price hits entry level, position opened automatically

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

## Position Status

Positions can have the following statuses:

- `open`: Position is currently open
- `closed`: Closed normally
- `stopped`: Closed by hitting stop loss
- `taken_profit`: Closed by hitting take profit
- `closed_manual`: Closed manually by user
- `expired`: Closed due to time expiration

## Important Notes

- **Paper Trading Only**: This is a simulation system. No real money is involved.
- **Educational Purpose**: Designed for learning and evaluating AI performance.
- **No Financial Advice**: All suggestions are for educational purposes only.
- **API Limitations**: Analysis runs every 15 minutes due to free Groq API limits.
- **Data Freshness**: Price updates every 30 seconds for position monitoring.

## Configuration

Configuration is done via environment variables in `backend/.env`:

```env
RISK_PER_TRADE_PERCENT=1          # Risk percentage per trade
MIN_CONFIDENCE_THRESHOLD=80       # Minimum confidence for auto-entry
MIN_RR_RATIO=2                    # Minimum risk/reward ratio
PRICE_UPDATE_INTERVAL=30          # Price update interval in seconds
MAX_CONSECUTIVE_LOSSES=3          # Losses before cooldown
COOLDOWN_HOURS=4                  # Cooldown duration in hours
```

## Future Enhancements

The following features are planned but not yet implemented:

- Trailing stop loss
- Break-even at 1:1 R:R
- Partial position closing
- Scaling in/out of positions
- Multi-account support (user-specific)
- Real-time WebSocket price feeds
- Backtesting engine
