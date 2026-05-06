# Fix: Use prediction_reversal Instead of close_early for Bias Reversal

**Status**: ✅ COMPLETED (2026-05-06)

This plan fixes the issue where positions are closed with close_reason='close_early' when they should use 'prediction_reversal' for bias reversal scenarios.

## Root Cause

The system has a `checkPredictionReversal` function that automatically closes positions when bias reverses with high confidence (>=80%), but this function is **NOT called** in the scheduler. Instead, AI returns `action: "close_early"` in position_decisions, which is less descriptive.

## Current Behavior

At 14:00:17 UTC (2026-05-06):
- Bias: bearish (confidence 0.88)
- Position: long
- AI returns: `position_decisions: [{"action": "close_early", reason: "Bearish bias, position against trend"}]`
- Result: Position closed with close_reason='close_early'

## Proposed Solution

### Option 1: Enable checkPredictionReversal in Scheduler (RECOMMENDED)

**File**: `backend/src/scheduler.js`

Add call to `checkPredictionReversal` after saving analysis:

```javascript
// After saveAnalysis (line 148)
const btcResult = await saveAnalysis(db, 'BTC', priceData, analysis, methodId, analysis.raw_question, analysis.raw_answer);

// Check for prediction reversal BEFORE processing position_decisions
const { checkPredictionReversal } = await import('./services/paperTradingEngine.js');
const reversalResult = await checkPredictionReversal(db, analysis.btc, 'BTC');
console.log(`[Scheduler][${method.name}] Prediction reversal check:`, reversalResult);
```

**Benefits**:
- Automatic handling of bias reversal
- Uses correct close_reason='prediction_reversal'
- Consistent with existing code design
- No need to modify AI prompt

**Drawbacks**:
- May conflict with position_decisions if AI also returns close_early for same position
- Need to handle duplicate close attempts

### Option 2: Modify AI Prompt to Use Reverse Action

**File**: `backend/src/analyzers/analyzerFactory.js`

Update prompt to instruct AI to use `reverse` action when bias reverses:

```javascript
// In buildPrompt function (around line 260)
openPositionsContext += `\n\nIMPORTANT: If bias has reversed (e.g., bearish bias with long position), use action='reverse' instead of close_early. Reverse will close current position and open opposite direction in one operation.`;
```

**Benefits**:
- AI explicitly states intent to reverse
- Single action handles both close and open

**Drawbacks**:
- Requires AI to provide all reverse parameters (new_sl, new_tp, etc.)
- More complex for AI
- Still doesn't use 'prediction_reversal' close_reason

### Option 3: Map close_early to prediction_reversal Based on Context

**File**: `backend/src/analyzersAnalyzerFactory.js`

In `validatePositionDecisions`, auto-convert close_early to prediction_reversal when bias opposes position:

```javascript
// After line 487
if (dec.action === 'close_early') {
  const position = positionMap.get(dec.position_id);
  if (position) {
    // If bias opposes position, this is a prediction reversal
    const isBiasOpposite = (bias === 'bearish' && position.side === 'long') ||
                          (bias === 'bullish' && position.side === 'short');
    if (isBiasOpposite) {
      console.log(`[AnalyzerFactory] Auto-converting close_early to prediction_reversal: bias=${bias}, position=${position.side}`);
      // Note: This would require changing action to something else or adding a flag
      // Since close_early is a close_reason, not an action, we need a different approach
    }
  }
}
```

**Benefits**:
- Automatic conversion based on context
- No scheduler changes needed

**Drawbacks**:
- close_early is a close_reason, not an action in position_decisions
- Would require different implementation approach

## Recommended Implementation

**Use Option 1**: Enable `checkPredictionReversal` in scheduler

1. Add call to `checkPredictionReversal` after `saveAnalysis`
2. Add logic to skip position_decisions for positions already closed by reversal check
3. Apply same logic to testnet if needed

## Files to Modify

1. `backend/src/scheduler.js` - Add checkPredictionReversal call
2. Optionally: `backend/src/services/testnetEngine.js` - Add similar logic for testnet

## Testing

After implementation, verify:
- When bias reverses (bearish + long, or bullish + short) with confidence >= 80%, position closes with close_reason='prediction_reversal'
- No duplicate close attempts
- Position history shows correct close reason
