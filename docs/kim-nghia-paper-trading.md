# Paper Trading System — Method 2 (kim-nghia-paper-trading) (SMC + Volume + Fibonacci)

## Overview

Method 2 (kim-nghia-paper-trading) is an advanced market analysis system that combines:

- Price Action (PA)
- Volume Analysis
- Market Structure
- Liquidity Zones
- Smart Money Concepts (SMC)
- Fibonacci Retracement & Extension

This method focuses on identifying high-probability setups using multi-timeframe confluence and provides:

- Directional bias
- Entry / Stop Loss / Take Profit levels
- Risk/Reward evaluation
- Active position management
- Alternative scenarios on reversal

> CORE PRINCIPLE: All decisions must be based on confluence between structure, liquidity, volume, and SMC signals.

## System Integration

### Method Configuration

- **Method ID**: `kim_nghia`
- **Schedule**: Runs at 7m30s, 22m30s, 37m30s, 52m30s past the hour (staggered from ICT)
- **Account**: Separate 100U account (BTC-KimNghia) for independent performance tracking
- **Auto-Entry Thresholds**:
  - Minimum Confidence: 60%
  - Minimum R:R: 2.5
  - Risk Per Trade: 10%
  - Max Positions: 8

### Database Integration

- **method_id**: All records (accounts, predictions, positions, pending_orders, analysis_history) tagged with `kim_nghia`
- **Account Linking**: Positions linked to BTC-KimNghia account via account_id
- **Performance Tracking**: Separate metrics calculated per method/account

### API Integration

All paper trading API endpoints support method filtering:
- `GET /api/paper-trading/accounts?method=kim_nghia`
- `GET /api/paper-trading/positions?method=kim_nghia`
- `GET /api/paper-trading/performance?method=kim_nghia`
- `GET /api/compare` - Side-by-side comparison with ICT method

### Frontend Integration

- **Method Tab Switcher**: Header component allows switching between ICT and Kim Nghia methods
- **Method-Specific Charts**: Kim Nghia method displays Fibonacci levels, Order Blocks, and FVG indicators
- **Rules Page**: Dedicated Kim Nghia rules component with method-specific content
- **Dashboard**: TradingDashboard shows method name badge and filters accounts by method_id

## Features

- Multi-Timeframe Analysis: H4 + H1 for direction, M15 for execution
- SMC Integration: OB, FVG, EQH/EQL, CHoCH, BOS
- Volume Confirmation: Validate breakouts and reversals
- Liquidity Mapping: Identify stop-hunt and key reaction zones
- Fibonacci Confluence: Entry and TP optimization
- Breakout/Retest Logic: Validate continuation vs fakeout
- Position Evaluation: Analyze active trades every cycle
- Action Recommendations: Hold, close, move SL, partial TP, scale
- Scenario Generation: New trade setup when reversal detected

## Analysis Framework

### Market Structure
- Identify trend direction (bullish / bearish)
- Detect HH/HL or LH/LL
- Confirm BOS / CHoCH

### Volume Analysis
- Volume expansion / contraction
- Breakout confirmation
- Participation at key zones

### Liquidity Zones
- EQH / EQL
- Buy-side / Sell-side liquidity
- Stop-hunt zones

### Smart Money Concepts (SMC)
- OB (Order Block)
- FVG (Fair Value Gap)
- EQH / EQL
- BOS / CHoCH

### Fibonacci Confluence
- Retracement zones (entry)
- Extension zones (TP)

### Breakout / Retest
- Validate strength with volume
- Identify fake vs real breakout

## Multi-Timeframe Analysis

- H4: Bias
- H1: Confirmation
- M15: Entry

## Trade Evaluation System

- Entry
- SL
- TP
- PnL
- Trade status

## Decision System

- Hold
- Close
- Move SL
- Partial TP
- Scale in/out

## Trading Logic

[Structure + Volume + Liquidity] → Bias  
[Breakout + Fib + SMC + Volume] → Entry  
[RR + S/R] → Exit  

## Output Requirements

- Market bias
- Structure
- Liquidity
- Volume
- SMC signals
- Fibonacci
- Trade evaluation
- Action
- Alternative scenario

## Integration

- Runs every 15 minutes
- Parallel with Method 1
- Feeds auto-trading system

## Notes

- Must explain logic
- Must confirm breakout
- Must include SMC if present
- Output must be actionable
