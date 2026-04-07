# Advanced Risk Management

This document outlines the design and implementation guide for advanced risk management features to be implemented in future phases.

---

## 1. Max Daily Loss

### Overview
Limit the maximum loss per account per day to prevent significant drawdowns and protect capital.

### Schema Design

#### Database Migration
```sql
ALTER TABLE accounts ADD COLUMN daily_loss_limit REAL DEFAULT 5.0;
ALTER TABLE accounts ADD COLUMN daily_loss_current REAL DEFAULT 0;
ALTER TABLE accounts ADD COLUMN daily_loss_reset_time DATETIME;
```

#### Fields
- `daily_loss_limit`: Maximum daily loss as percentage of account balance (default: 5%)
- `daily_loss_current`: Current daily loss amount
- `daily_loss_reset_time`: Time when daily loss counter resets (e.g., midnight UTC)

### API Endpoints

#### GET /api/accounts/:symbol/daily-loss
Get current daily loss status for an account.

**Response:**
```json
{
  "success": true,
  "data": {
    "daily_loss_limit": 5.0,
    "daily_loss_current": 2.5,
    "daily_loss_remaining": 2.5,
    "daily_loss_reset_time": "2026-04-09T00:00:00Z",
    "is_limit_reached": false,
    "auto_entry_suspended": false
  }
}
```

#### POST /api/accounts/:symbol/reset-daily-loss
Manually reset daily loss counter (admin function).

### Implementation Guide

1. **Daily Loss Calculation**
   - Calculate total realized PnL for trades closed within the current day
   - Update `daily_loss_current` on each position close
   - Reset counter at `daily_loss_reset_time` (scheduled job)

2. **Auto-Entry Suspension**
   - Check `daily_loss_current` before opening new positions
   - If `daily_loss_current >= daily_loss_limit * account_balance`, suspend auto-entry
   - Log suspension reason in trade_events table

3. **Scheduled Job**
   - Run daily at midnight UTC
   - Reset `daily_loss_current` to 0
   - Update `daily_loss_reset_time` to next midnight
   - Re-enable auto-entry if it was suspended

### Configuration Options
```bash
# .env
DAILY_LOSS_LIMIT_DEFAULT=5.0  # 5% of account balance
DAILY_LOSS_RESET_TIME=00:00  # Midnight UTC
```

---

## 2. Drawdown Limits

### Overview
Automatically suspend auto-entry when account drawdown exceeds a threshold to prevent further losses during unfavorable market conditions.

### Schema Design

#### Database Migration
```sql
ALTER TABLE accounts ADD COLUMN max_drawdown_limit REAL DEFAULT 15.0;
ALTER TABLE accounts ADD COLUMN drawdown_suspended_until DATETIME;
```

#### Fields
- `max_drawdown_limit`: Maximum allowed drawdown percentage (default: 15%)
- `drawdown_suspended_until`: Timestamp until which auto-entry is suspended

### API Endpoints

#### GET /api/accounts/:symbol/drawdown-status
Get current drawdown status.

**Response:**
```json
{
  "success": true,
  "data": {
    "max_drawdown_limit": 15.0,
    "current_drawdown": 8.5,
    "drawdown_remaining": 6.5,
    "is_limit_exceeded": false,
    "drawdown_suspended_until": null,
    "auto_entry_suspended": false
  }
}
```

#### POST /api/accounts/:symbol/lift-drawdown-suspension
Manually lift drawdown suspension (admin function).

### Implementation Guide

1. **Drawdown Calculation**
   - Track peak equity using account_snapshots
   - Calculate drawdown: `(peak_equity - current_equity) / peak_equity * 100`
   - Update on each equity snapshot

2. **Auto-Entry Suspension**
   - Check current drawdown before opening new positions
   - If `current_drawdown >= max_drawdown_limit`, suspend auto-entry
   - Set `drawdown_suspended_until` to 24 hours from now
   - Log suspension reason

3. **Recovery Check**
   - If drawdown recovers below threshold, allow auto-entry again
   - Or wait until `drawdown_suspended_until` expires

### Configuration Options
```bash
# .env
MAX_DRAWDOWN_LIMIT_DEFAULT=15.0  # 15% drawdown
DRAWDOWN_SUSPENSION_HOURS=24  # Suspend for 24 hours
DRAWDOWN_RECOVERY_THRESHOLD=10.0  # Re-enable if drawdown drops to 10%
```

---

## 3. Dynamic Position Sizing

### Overview
Adjust position size based on account performance, win rate, and confidence calibration to optimize risk-adjusted returns.

### Schema Design

#### Database Migration
```sql
ALTER TABLE accounts ADD COLUMN base_risk_percent REAL DEFAULT 1.0;
ALTER TABLE accounts ADD COLUMN current_risk_percent REAL DEFAULT 1.0;
ALTER TABLE accounts ADD COLUMN risk_adjustment_factor REAL DEFAULT 1.0;
ALTER TABLE accounts ADD COLUMN last_risk_adjustment DATETIME;
```

#### Fields
- `base_risk_percent`: Base risk per trade (default: 1%)
- `current_risk_percent`: Current adjusted risk per trade
- `risk_adjustment_factor`: Multiplier for position sizing (0.5x to 2x)
- `last_risk_adjustment`: Timestamp of last risk adjustment

### API Endpoints

#### GET /api/accounts/:symbol/risk-settings
Get current risk settings and adjustment factors.

**Response:**
```json
{
  "success": true,
  "data": {
    "base_risk_percent": 1.0,
    "current_risk_percent": 0.8,
    "risk_adjustment_factor": 0.8,
    "adjustment_reason": "Win rate below 50%",
    "last_risk_adjustment": "2026-04-08T12:00:00Z"
  }
}
```

#### POST /api/accounts/:symbol/adjust-risk
Manually adjust risk settings (admin function).

### Implementation Guide

1. **Adjustment Algorithm**
   ```
   IF win_rate >= 60% AND last_10_trades_profitable:
       risk_adjustment_factor = MIN(2.0, current_factor * 1.1)
   ELSE IF win_rate <= 40% OR consecutive_losses >= 3:
       risk_adjustment_factor = MAX(0.5, current_factor * 0.8)
   ELSE:
       risk_adjustment_factor = 1.0
   
   current_risk_percent = base_risk_percent * risk_adjustment_factor
   ```

2. **Position Size Calculation**
   - Use `current_risk_percent` instead of fixed 1%
   - Ensure position size doesn't exceed 5% of account balance (hard limit)

3. **Scheduled Review**
   - Review risk settings daily
   - Adjust based on rolling 20-trade performance
   - Log all adjustments with reasons

### Configuration Options
```bash
# .env
BASE_RISK_PERCENT_DEFAULT=1.0
MIN_RISK_ADJUSTMENT_FACTOR=0.5
MAX_RISK_ADJUSTMENT_FACTOR=2.0
RISK_REVIEW_INTERVAL_HOURS=24
```

---

## Implementation Checklist

### Phase 1: Database Schema
- [ ] Add daily loss columns to accounts table
- [ ] Add drawdown limit columns to accounts table
- [ ] Add dynamic sizing columns to accounts table
- [ ] Create migration script
- [ ] Test migration on development database

### Phase 2: Backend Implementation
- [ ] Implement daily loss calculation logic
- [ ] Implement drawdown calculation logic
- [ ] Implement dynamic sizing algorithm
- [ ] Create scheduled jobs for daily reset
- [ ] Add API endpoints for all features
- [ ] Add unit tests

### Phase 3: Frontend Implementation
- [ ] Create DailyLossStatus component
- [ ] Create DrawdownStatus component
- [ ] Create RiskSettings component
- [ ] Add controls for manual overrides
- [ ] Add to dashboard
- [ ] Add to account settings page

### Phase 4: Integration
- [ ] Integrate with auto-entry logic
- [ ] Integrate with position sizing logic
- [ ] Add logging for all suspensions/adjustments
- [ ] Add notifications for limit breaches
- [ ] Test end-to-end

### Phase 5: Documentation
- [ ] Update API documentation
- [ ] Update user guide
- [ ] Add configuration examples
- [ ] Create troubleshooting guide

---

## Testing Strategy

### Unit Tests
- Test daily loss calculation
- Test drawdown calculation
- Test dynamic sizing algorithm
- Test edge cases (zero balance, extreme values)

### Integration Tests
- Test auto-entry suspension when daily limit reached
- Test auto-entry suspension when drawdown exceeded
- Test position sizing with different adjustment factors
- Test manual override functions

### Load Tests
- Test with high frequency trading
- Test with large number of accounts
- Test scheduled job performance

---

## Monitoring & Alerts

### Metrics to Track
- Daily loss limit breaches
- Drawdown limit breaches
- Risk adjustment frequency
- Auto-entry suspension duration
- Recovery time after suspension

### Alert Configuration
- Alert when daily loss > 80% of limit
- Alert when drawdown > 80% of limit
- Alert when risk adjustment factor changes
- Alert when auto-entry is suspended

---

## Rollback Plan

If advanced risk management causes issues:
1. Disable features via environment variables
2. Reset risk_adjustment_factor to 1.0
3. Clear suspension flags
4. Revert to fixed 1% risk per trade
5. Monitor for 24 hours before re-enabling

---

## Future Enhancements

1. **Machine Learning Risk Adjustment**
   - Use ML to predict optimal position sizing
   - Learn from historical performance
   - Adapt to changing market conditions

2. **Volatility-Based Sizing**
   - Adjust position size based on market volatility
   - Reduce size in high volatility periods
   - Increase size in low volatility periods

3. **Portfolio-Level Risk**
   - Consider correlated positions across symbols
   - Limit total exposure per asset class
   - Diversification requirements

4. **Custom Risk Profiles**
   - Allow users to define custom risk profiles
   - Conservative, moderate, aggressive presets
   - Custom limits per strategy
