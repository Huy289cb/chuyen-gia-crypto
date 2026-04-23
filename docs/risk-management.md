# ICT-Based Risk Management

## Overview

This document explains the risk management principles based on Inner Circle Trader (ICT) Smart Money Concepts implemented in the paper trading system.

## Core Principles

### 1. Risk Per Trade

**Recommended**: 1-2% of account balance per trade
**Implementation**: 1% (configurable via `RISK_PER_TRADE_PERCENT`)

**Rationale**:
- Small enough to survive drawdowns
- Large enough to learn from outcomes
- Allows for multiple consecutive losses without significant account damage
- Follows professional trading standards

### 2. Risk-Based Position Sizing

**Formula**:
```
Position Size = (Account Balance × Risk%) / (Entry Price - Stop Loss)
```

**Example**:
- Account Balance: $100
- Risk: 1% ($1)
- Entry Price: $67,000
- Stop Loss: $66,500 (distance: $500)
- Position Size: $1 / $500 = 0.002 BTC
- Position Value: 0.002 × $67,000 = $134

**Benefits**:
- Automatically adjusts position size based on stop loss distance
- Tighter stops = larger positions
- Wider stops = smaller positions
- Consistent risk per trade

### 3. Minimum Risk/Reward Ratio

**Requirement**: Minimum 1:2 R:R (risk 1 to make 2)
**Implementation**: `MIN_RR_RATIO=2`

**Rationale**:
- Win rate can be lower and still be profitable
- 33% win rate with 1:2 R:R = breakeven
- 40% win rate with 1:2 R:R = profitable
- Protects against poor entries

### 4. Partial Take Profits (NEW - ICT Enhanced)

**Implementation**: 
- `PARTIAL_TP_ENABLED=true`
- `PARTIAL_TP_RATIOS=0.5,0.5` (50% @ TP1, 50% @ TP2)
- `PARTIAL_TP_RR_LEVELS=1.0,2.0` (TP1 @ 1:1 R:R, TP2 @ 2:1 R:R)

**ICT Rationale**:
- Lock in profits early to reduce psychological pressure
- Move SL to breakeven after TP1 (risk-free trade)
- Capture momentum at multiple levels
- Allows for riding winners while protecting capital

**Example**:
- Entry: $67,000, SL: $66,500 (risk: $500)
- TP1: $67,500 (1:1 R:R) → Close 50%, move SL to $67,000
- TP2: $68,000 (2:1 R:R) → Close remaining 50%

### 5. Trailing Stop (NEW - ICT Enhanced)

**Implementation**:
- `TRAILING_STOP_ENABLED=true`
- `TRAIL_AFTER_RR=1.0` (start trailing after hitting 1:1 R:R)
- `TRAIL_DISTANCE_PCT=0.5` (0.5% trailing distance)

**ICT Rationale**:
- Protect profits after momentum confirms
- Trail SL to lock in gains
- Allows price room to breathe
- Reduces risk of giving back profits

### 6. Session Timing (NEW - ICT Enhanced)

**Implementation**:
- `ALLOWED_SESSIONS=london,ny_killzone`
- London: 07:00-10:00 UTC
- NY Killzone: 12:00-15:00 UTC

**ICT Rationale**:
- Focus on high-liquidity sessions
- Institutional activity peaks during these times
- Better fills and less slippage
- Clearer market structure
- Avoid low-liquidity Asian session for trend entries

**Note**: Manual entries allowed anytime, auto-entry restricted to sessions only.

### 7. Stop Loss Placement

ICT Concepts for Stop Loss:

**Long Positions**:
- Below recent swing low
- Below liquidity sweep level
- Below order block
- Below invalidation level

**Short Positions**:
- Above recent swing high
- Above liquidity sweep level
- Above order block
- Above invalidation level

**Default Fallback** (if AI doesn't provide specific SL):
- Long: 2% below entry price
- Short: 2% above entry price

**Minimum SL Distance:**
- ICT method: 0.75% from entry
- Kim Nghia method: 0.4% from entry price

### 8. Take Profit Placement

ICT Concepts for Take Profit:

**Primary Targets**:
- Next liquidity zone
- Fair Value Gap (FVG) fill
- Order block target
- Displacement target

**Secondary Targets**:
- Based on R:R ratio (minimum 1:2)
- Previous swing high/low
- Institutional levels

**Default Fallback** (if AI doesn't provide specific TP):
- Long: 4% above entry price (1:2 R:R)
- Short: 4% below entry price (1:2 R:R)

## Multi-Timeframe Alignment

### Priority Structure

```
1d (Higher TF bias) > 4h (Primary decision) > 1h (Entries) > 15m (Micro)
```

### Auto-Entry Requirement

For auto-entry, the system checks alignment on **main timeframes only**:
- **4h**: Mid-term trend direction
- **1d**: Higher timeframe bias

**Requirement**: Majority (50%+) must align with the bias

**Example**:
- Bias: Bullish
- 4h prediction: Up ✓
- 1d prediction: Up ✓
- Result: 2/2 aligned (100%) ✓ Entry allowed

- Bias: Bullish
- 4h prediction: Up ✓
- 1d prediction: Sideways ✗
- Result: 1/2 aligned (50%) ✓ Entry allowed

- Bias: Bullish
- 4h prediction: Sideways ✗
- 1d prediction: Down ✗
- Result: 0/2 aligned (0%) ✗ Entry denied

## Confidence Threshold

**Minimum Confidence**: 80% (0.8)
**Implementation**: `MIN_CONFIDENCE_THRESHOLD=80`

**Rationale**:
- Only enter high-conviction setups
- Reduces overtrading
- Focuses on best opportunities
- AI confidence calibrated from historical accuracy

## Cooldown System

### Trigger Conditions

- **3 consecutive losing trades** → Enter cooldown
- **Any winning trade** → Reset cooldown

### Cooldown Duration

- **4 hours** (configurable via `COOLDOWN_HOURS=4`)

### Purpose

- Prevents emotional trading after losses
- Allows market conditions to potentially change
- Reduces overtrading during drawdowns
- Forces review of recent performance

## Volume Management (Updated 23/04/2026)

### Individual Position/Order Size Limits (Updated 23/04/2026)
- **Position Size Limit**: 2k USD per individual position
- **Pending Order Size Limit**: 2k USD per individual pending order
- **Rationale**: Prevents oversized single trades even when account balance allows larger positions
- **Implementation**: Size is capped after risk-based calculation, so it only affects oversized positions

### Total Volume Limit
- **Limit**: 2k USD total volume per account
- **Calculation**: Open positions + Pending orders
- **Rationale**: Prevents over-leveraging across both active and waiting positions

### Strategic Entry Validation
When volume reaches limit:
- New pending orders only allowed at strategic levels
- Entry must align with SL or TP of existing positions (±0.5% tolerance)
- Ensures new positions add to existing strategy rather than diversifying randomly

### Example Scenario
- 2 open positions: $1,000 each = $2,000 total
- Volume at limit
- New analysis suggests entry at $76,500
- Check: Does $76,500 align with SL/TP of existing positions?
  - Position 1: SL $76,480, TP $77,500
  - Position 2: SL $75,000, TP $76,600
  - $76,500 is within 0.5% of Position 1's SL ($76,480) → ALLOW
  - Or: $76,500 is within 0.5% of Position 2's TP ($76,600) → ALLOW
  - Otherwise: REJECT

## Position Limits

### Maximum Positions Per Symbol

- **Limit**: 1 position per symbol
- **Rationale**:
  - Focus on best setup
  - Prevents over-leveraging
  - Easier to manage risk
  - Clearer performance analysis

### Total Position Limit

- No hard limit across symbols
- Each symbol (BTC, ETH) tracked independently
- Allows diversification if both have signals

## Drawdown Management

### Maximum Drawdown Tracking

- System tracks maximum drawdown from peak equity
- Displayed in performance metrics
- Used for evaluating strategy health

### Drawdown Warning Signs

- Max drawdown > 20%: Consider reducing risk
- Max drawdown > 30%: Consider pausing trading
- Max drawdown > 50%: Reset account or review strategy

## ICT-Specific Risk Rules

### 1. Liquidity Sweeps

- Price often sweeps liquidity before reversal
- Don't enter immediately after sweep without confirmation
- Wait for CHOCH (Change of Character)

### 2. Market Structure

- Only trade with structure, not against it
- BOS (Break of Structure) = continuation
- CHOCH (Change of Character) = potential reversal

### 3. Fair Value Gaps (FVG)

- Price often returns to fill FVG
- Use FVG for entry or TP targets
- Don't chase price after FVG fill

### 4. Order Blocks

- Institutional reference levels
- Use for SL placement or entry zones
- Respect OB boundaries

### 5. Time of Day

- Avoid low liquidity periods
- Focus on London and NY sessions
- Consider Asian session for range trading

## Performance Metrics for Risk Assessment

### Key Metrics to Monitor

1. **Win Rate**: Should be > 40% with 1:2 R:R
2. **Profit Factor**: Should be > 1.5
3. **Max Drawdown**: Should be < 20%
4. **Average R Multiple**: Should be > 1.5
5. **Consecutive Losses**: Alert if > 3

### When to Adjust Risk

**Reduce Risk If**:
- Win rate drops below 35%
- Max drawdown exceeds 20%
- Consecutive losses > 5
- Profit factor < 1.2

**Increase Risk If** (cautiously):
- Win rate > 50% with good sample size
- Max drawdown < 10%
- Consistent profitability over 30+ trades

## Disclaimer

This risk management system is for educational purposes in a paper trading environment. Real trading involves additional risks not captured in this simulation, including:
- Slippage
- Exchange fees
- Emotional factors
- Real market liquidity constraints
- Black swan events

Always trade with money you can afford to lose and never risk more than you're comfortable with in live trading.
