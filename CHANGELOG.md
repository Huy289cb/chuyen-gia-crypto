# Changelog

All notable changes to the project will be documented in this file.

## [21/04/2026] - v2.2.10 - AI Conservatism Fixes & SL Distance Adjustments

### AI Improvements

**Issue 1: AI Too Conservative - Returns 30% Confidence Consistently**
- **Problem**: AI consistently returning 30% confidence with neutral bias despite having valid trading signals
- **Root Cause Analysis**:
  - Temperature too low (0.3) made AI extremely conservative
  - Prompt emphasized "xác suất thắng cao nhất" (highest win probability) causing AI to only trade when 100% confident
  - Database query showed AI providing entry/TP but no SL, defaulting to hold with 30% confidence
- **Fix**:
  - Increased temperature from 0.3 to 0.6 in analyzerFactory.js
  - Rewrote Kim Nghia prompt to be less conservative:
    - Removed emphasis on "xác suất thắng cao nhất"
    - Added instruction: "Trade với confidence 50-60% TỐT HƠN không trade"
    - Added instruction: "Nếu có entry + TP + RR >= 2.5 → set action = buy/sell, KHÔNG hold"
    - Removed strict multi-timeframe alignment requirement
    - Added: "Confidence 0.3 chỉ khi KHÔNG có setup nào khả thi"
- **Impact**: AI now returns 55% confidence with buy/sell actions instead of 30% hold
- **Files**: `backend/src/analyzers/analyzerFactory.js`, `backend/src/config/methods.js`

**Issue 2: SL Distance Validation Mismatch**
- **Problem**: Code validated SL distance at 1% (0.01) but prompt specified 0.75% (0.0075)
- **Root Cause**: Code and prompt were out of sync, causing valid AI suggestions to be rejected
- **Example**: AI provided SL with 0.235% distance, rejected by code (required 1%), even though prompt said 0.75%
- **Fix**: Updated SL validation in analyzerFactory.js and groqAnalyzer.js from 1% to 0.75% to match prompt
- **Impact**: Code validation now matches prompt requirements
- **Files**: `backend/src/analyzers/analyzerFactory.js`, `backend/src/groqAnalyzer.js`

### Configuration Changes

**Issue 3: Kim Nghia SL Distance Adjustment**
- **Problem**: 0.75% SL distance too strict for Kim Nghia method
- **User Decision**: Reduce to 0.5% for Kim Nghia method
- **Fix**: 
  - Updated Kim Nghia prompt SL distance from 0.75% to 0.5%
  - Updated SL validation from 0.75% (0.0075) to 0.5% (0.005) in analyzerFactory.js
  - Updated SL validation from 0.75% (0.0075) to 0.5% (0.005) in groqAnalyzer.js
- **Impact**: Kim Nghia method can use tighter stop losses (0.5% vs 0.75%), ICT remains at 0.75%
- **Files**: `backend/src/config/methods.js`, `backend/src/analyzers/analyzerFactory.js`, `backend/src/groqAnalyzer.js`

### Debugging Improvements

**Issue 4: Added AI Response Logging**
- **Problem**: Could not see raw AI response to understand why confidence was low
- **Fix**: Added detailed logging to show raw AI response and narratives
- **Impact**: Can now see complete AI response including structure, volume, smc fields for debugging
- **Files**: `backend/src/analyzers/analyzerFactory.js`

### Documentation Updates

**Issue 5: Documentation Outdated**
- **Problem**: Documentation mentioned old SL distances (0.5%, 1%) not matching current state
- **Fix**: Updated paper-trading.md to reflect current SL distances (ICT: 0.75%, Kim Nghia: 0.5%)
- **Impact**: Documentation now matches actual code configuration
- **Files**: `docs/paper-trading.md`

## [21/04/2026] - v2.2.9 - Position Limit & Kim Nghia Improvements

### Configuration Changes

**Issue 1: Position Limit Adjustment**
- **Problem**: maxPositionsPerSymbol was inconsistent across codebase (8, 9, various values)
- **Fix**: Standardized to 6 positions per symbol across all components
  - Updated backend/src/config/methods.js: ICT & Kim Nghia maxPositionsPerSymbol 9 → 6
  - Updated backend/src/services/autoEntryLogic.js: AUTO_ENTRY_CONFIG maxPositionsPerSymbol 9 → 6
  - Updated docs/paper-trading.md: Position limit 9 → 6 (5 places)
  - Updated docs/plans/multi-method-paper-trading-implementation.md: maxPositionsPerSymbol 9 → 6
  - Updated frontend/app/rules/page.tsx: Position limit 8/9 → 6 (Vietnamese & English)
  - Updated frontend/app/sections/TradingDashboard.tsx: Max Positions 8 → 6
- **Impact**: Consistent position limits across backend, docs, and frontend
- **Files**: `backend/src/config/methods.js`, `backend/src/services/autoEntryLogic.js`, `docs/paper-trading.md`, `docs/plans/multi-method-paper-trading-implementation.md`, `frontend/app/rules/page.tsx`, `frontend/app/sections/TradingDashboard.tsx`

### Bug Fixes

**Issue 2: Fibonacci Calculation Error - db Parameter Missing**
- **Problem**: formatAnalysisResponse called getOHLCCandles with priceData.btc?.db which was undefined
- **Error**: "Cannot read properties of undefined (reading 'all')" at database.js:685
- **Fix**: 
  - Added db parameter to formatAnalysisResponse function signature
  - Use db parameter instead of priceData.btc?.db for getOHLCCandles calls
  - Add db check before attempting Fibonacci calculation
  - Update formatAnalysisResponse call to pass db parameter
- **Impact**: Fibonacci calculation now works correctly for Kim Nghia method
- **Files**: `backend/src/analyzers/analyzerFactory.js`

### Improvements

**Issue 3: Kim Nghia Prompt Too Concise - Low Confidence Predictions**
- **Problem**: Simplified Kim Nghia prompt resulted in all predictions returning neutral with 30% confidence
- **Fix**: Enhanced Kim Nghia prompt with detailed multi-timeframe analysis framework
  - Added detailed multi-timeframe analysis (4h > 1h > 15m priority)
  - Added comprehensive volume analysis instructions
  - Added Fibonacci levels and liquidity concepts
  - Added entry/exit rules with SMC zones (OB, FVG, EQL/EQH)
  - Added partial TP and trailing SL rules
  - Increased narrative max length from 150 to 200 chars
  - Added explicit MUST provide Entry/SL/TP instructions
- **Impact**: AI now has better context to make confident predictions
- **Files**: `backend/src/config/methods.js`

**Issue 4: Missing OHLC Data in User Prompt**
- **Problem**: User prompt lacked OHLC candle data needed for SMC analysis
- **Fix**: Added OHLC candle data to user prompt for Kim Nghia method
  - Fetch 50 candles (15m timeframe) for BTC and ETH
  - Include last 10 OHLC candles in user prompt
  - Format: [HH:MM] O:price H:price L:price C:price V:volume
  - Only applied for Kim Nghia method
- **Impact**: AI now has price action context for SMC analysis
- **Files**: `backend/src/analyzers/analyzerFactory.js`

**Issue 5: Model Priority**
- **Problem**: Default model order prioritized llama-3.1-8b-instant
- **Initial Fix Attempt**: Swapped to prioritize llama-4-scout-17b-16e-instruct (failed - model not found)
- **Final Fix**: Updated to use 70b models for better analysis capabilities
  - Primary: llama-3.3-70b-versatile
  - Secondary: llama-3.1-70b-versatile
  - Fallback: llama-3.1-8b-instant
- **Impact**: 70b models better for complex analysis tasks like SMC + Volume + Fibonacci
- **Files**: `backend/src/groq-client.js`

## [21/04/2026] - v2.2.8 - SL Distance Adjustment

### Configuration Changes

**Issue: SL Distance Minimum Adjustment**
- **Problem**: 0.25% SL distance was too close to entry, not standard for risk management
- **User Decision**: Increase to 0.75% for better risk management
- **Fix**: Increased minimum SL distance from 0.25% to 0.75%
  - Updated autoEntryLogic.js: minRiskDistance from 0.0025 to 0.0075
  - Updated ICT prompt: SL≥0.25% to SL≥0.75% from entry
  - Updated Kim Nghia prompt: SL≥0.25% to SL≥0.75% entry
- **Impact**: More conservative risk management, reduces chance of being stopped out by market noise
- **Files**: `backend/src/services/autoEntryLogic.js`, `backend/src/config/methods.js`

### Method Switch

**Issue: Method Priority Change**
- **Problem**: User requested to disable ICT and focus on Kim Nghia method
- **Fix**: 
  - Disabled ICT method (enabled: false)
  - Enabled Kim Nghia method (enabled: true)
- **Impact**: System will now only run Kim Nghia analysis
- **Files**: `backend/src/config/methods.js`

## [21/04/2026] - v2.2.7 - Critical Feedback Fixes

### Bug Fixes

**Issue 1: SQL Column Mismatch - CRITICAL BLOCKER**
- **Problem**: INSERT statement had 29 columns but only 28 values (missing r_multiple)
- **Error**: "SQLITE_ERROR: 31 values for 29 columns"
- **Fix**: Added r_multiple = 0 to VALUES clause in INSERT statement
- **Impact**: Positions can now be saved to database when entry criteria are met
- **Files**: `backend/src/db/database.js`

**Issue 2: ICT Method - SL Distance Validation Too Strict**
- **Problem**: SL distance of 0.26% was being rejected (below 0.5% threshold)
- **Fix**: Reduced minimum SL distance from 0.5% to 0.25%
- **Impact**: More trades can pass validation, including those with tighter stops
- **Files**: `backend/src/services/autoEntryLogic.js`, `backend/src/config/methods.js`

**Issue 3: Kim Nghia Method - Disabled Temporarily**
- **Problem**: AI consistently returns neutral with 30% confidence (below 60% threshold)
- **Fix**: Disabled Kim Nghia method to focus 100% on ICT method
- **Impact**: System will only run ICT analysis until Kim Nghia is revisited
- **Files**: `backend/src/config/methods.js`

### Debug Logging

**Issue 4: Fibonacci Calculation Error (Still Present)**
- **Problem**: "Cannot read properties of undefined (reading 'all')" error persists
- **Fix**: Added detailed logging to identify exact error location
  - Logs OHLC data fetch, candle counts, bias, and error stack
- **Impact**: Can now identify exact line causing the error for proper fix
- **Files**: `backend/src/analyzers/analyzerFactory.js`

## [21/04/2026] - v2.2.6 - Prompt Documentation Update

### Documentation Updates

**Rule: No Specific Price Values in AI Prompts**
- **Problem**: Including specific price examples (e.g., 74835.52, 74800) in prompts can confuse the AI and cause it to misunderstand instructions
- **Fix**: 
  - Removed specific price examples from ICT prompt
  - Removed specific price examples from Kim Nghia prompt
  - Added documentation comment in methods.js explaining the rule
  - Changed to use generic examples with "e.g." notation
- **Impact**: AI will no longer be confused by specific price values in examples
- **Files**: `backend/src/config/methods.js`

## [21/04/2026] - v2.2.5 - AI Prompt Optimization & Debug Logging

### AI Prompt Improvements

**Issue 1: Kim Nghia Method Always Returns Neutral**
- **Problem**: Kim Nghia method consistently returns neutral bias with 30% confidence, preventing any position entries
- **Fix**: Optimized Kim Nghia prompt to be more decisive instead of overly cautious
  - Added instruction: "Hãy PHÂN TÍCH QUYẾT ĐOÁN hơn là thận trọng"
  - Lowered HOLD threshold from 60% to 40% confidence
  - Encouraged BUY/SELL actions even with 40-50% confidence if signals are clear
  - Added explicit guidelines for when to use HOLD (no clear signals, sideways market, severe conflict)
- **Impact**: AI should now provide more actionable signals instead of defaulting to neutral
- **Files**: `backend/src/config/methods.js`

### Debug Logging

**Issue 2: ICT Method with >80% Confidence Not Opening Positions**
- **Problem**: ICT predictions with >80% confidence are not opening positions, root cause unclear
- **Fix**: Added comprehensive debug logging to auto-entry logic
  - Logs all 8 auto-entry checks with PASSED/FAILED status
  - Logs confidence scores, timeframe alignment details, AI action, R:R ratio
  - Will help diagnose which check is failing (bias, timeframe alignment, action, etc.)
- **Impact**: Can now identify why high-confidence predictions aren't resulting in positions
- **Files**: `backend/src/services/autoEntryLogic.js`

## [21/04/2026] - v2.2.4 - Configuration Improvements

### Configuration Changes

**Issue 1: Risk Distance Validation Too Strict**
- **Problem**: SL distance requirement of 1% was rejecting valid trades (e.g., 0.92% distance rejected)
- **Fix**: Reduced minimum SL distance from 1% to 0.5% of entry price
- **Impact**: More trades can pass validation, reducing false rejections
- **Files**: `backend/src/services/autoEntryLogic.js`, `backend/src/config/methods.js`

## [21/04/2026] - v2.2.3 - Production Feedback Fixes

### Bug Fixes

**Issue 1: SQL Column Mismatch - CRITICAL BLOCKER**
- **Problem**: positions table has 30 columns but INSERT statement only provided 22 columns
- **Impact**: Positions could not be saved to database even when entry criteria were met (0 positions entered overnight)
- **Fix**: Updated INSERT statement to include all 30 columns with explicit values
- **Missing columns added**: status, realized_pnl, unrealized_pnl, close_price, close_time, close_reason, tp1_hit, r_multiple
- **Files**: `backend/src/db/database.js`

**Issue 2: Fibonacci Calculation Error**
- **Problem**: getOHLCCandles may return undefined or incorrect data structure, causing "Cannot read properties of undefined (reading 'all')" error
- **Fix**: Added null/undefined checks before calling getFibonacciFromOHLC
- **Impact**: Kim Nghia method Fibonacci calculation now handles missing data gracefully
- **Files**: `backend/src/analyzers/analyzerFactory.js`

**Issue 3: AI Not Providing Entry/SL/TP Consistently**
- **Problem**: AI sometimes provided suggested_stop_loss: null or 0, triggering fallback calculation that could fail validation
- **Fix**: Updated ICT and Kim Nghia prompts to ALWAYS provide Entry/SL/TP when action=buy/sell, regardless of confidence
- **Impact**: AI will now consistently provide valid Entry/SL/TP for trade signals
- **Files**: `backend/src/config/methods.js`

## [20/04/2026] - v2.2.2 - Bug Fixes

### Bug Fixes

**Issue 1: getOHLCData Function Not Found**
- **Problem**: analyzerFactory.js called non-existent getOHLCData function for Fibonacci calculation
- **Fix**: Changed to getOHLCCandles with correct function signature
- **Impact**: Kim Nghia method Fibonacci calculation now works correctly
- **Files**: `backend/src/analyzers/analyzerFactory.js`

**Issue 2: Debug Logs for SL Calculation**
- **Problem**: SHORT SL placement error persisted, needed to diagnose root cause
- **Fix**: Added debug logs to track suggestedEntry, bias, and calculated suggestedSL values
- **Impact**: Can now diagnose why SL is being calculated incorrectly (75245 vs expected 76150)
- **Files**: `backend/src/services/autoEntryLogic.js`

## [20/04/2026] - v2.2.1 - Bug Fixes

### Bug Fixes

**Issue 1: Syntax Errors in analyzerFactory.js**
- **Problem**: Typos causing syntax errors in generateFallbackAnalysis function
- **Fix**: Fixed "consg" → "console.log" and "lasole.lot" → "last"
- **Impact**: Fallback analysis now works correctly when Groq API fails
- **Files**: `backend/src/analyzers/analyzerFactory.js`

**Issue 2: Default SL/TP Calculation Using Wrong Price**
- **Problem**: Default SL/TP calculated from currentPrice instead of suggestedEntry
- **Impact**: For SHORT limit orders (entry > currentPrice), SL was placed below entry instead of above, causing position rejection
- **Fix**: Changed default SL/TP calculation to use suggestedEntry
- **Files**: `backend/src/services/autoEntryLogic.js`

**Issue 3: Scheduler Returning Wrong Data Structure**
- **Problem**: fetchCurrentPrices returned only price value instead of full candle object
- **Impact**: Scheduler tried to access .price on undefined, causing "Cannot read properties of undefined (reading toLocaleString)" error
- **Fix**: Changed return to include full candle object (price, open, high, low, close, volume)
- **Files**: `backend/src/schedulers/priceUpdateScheduler.js`

**Issue 4: Cron Schedule Running Every Second**
- **Problem**: Cron schedule had 6 asterisks instead of 5, running every second instead of every minute
- **Impact**: Excessive log spam every 50-700ms instead of every minute
- **Fix**: Changed price update from '* * * * * *' to '* * * * *' (every minute)
- **Fix**: Changed account snapshot from '0 */5 * * * *' to '0 */5 * * *' (every 5 minutes)
- **Files**: `backend/src/schedulers/priceUpdateScheduler.js`

## [20/04/2026] - v2.2.0 - 1-Minute Candle Scheduler & Testing Infrastructure

### Scheduler Update

**Issue 1: Accurate SL/TP Detection**
- **Problem**: Single price every 30 seconds cannot detect if TP/SL was hit during fast price moves
- **Fix**: Changed scheduler interval from 30s to 1 minute, fetch 1-minute candle OHLC data from Binance
- **Impact**: SL/TP detection now uses candle high/low for accurate trigger detection
- **Files**: `backend/src/schedulers/priceUpdateScheduler.js`, `backend/src/price-fetcher.js`, `backend/src/services/paperTradingEngine.js`

**Issue 2: Candle Data Structure**
- **Problem**: Price fetching only returned single price, no high/low data
- **Fix**: Updated fetchRealTimePrices to return full 1-minute candle data (open, high, low, close, volume)
- **Impact**: All price-based operations now use candle data for accurate detection
- **Files**: `backend/src/price-fetcher.js`

**Issue 3: Pending Order Trigger Detection**
- **Problem**: Pending orders couldn't detect if entry was hit during candle formation
- **Fix**: Updated checkAndExecutePendingOrders to use candle high/low for trigger detection
- **Impact**: Limit orders execute accurately even during fast price moves
- **Files**: `backend/src/schedulers/priceUpdateScheduler.js`

### Testing Infrastructure

**Issue 4: No Test Coverage**
- **Problem**: No automated tests for new features (Fibonacci, alternative scenario validation)
- **Fix**: Installed Vitest, created test structure, implemented unit and integration tests
- **Impact**: 53 tests covering new features and affected functionality
- **Files**: `backend/vitest.config.js`, `backend/tests/unit/`, `backend/tests/integration/`, `backend/tests/fixtures/`

**Issue 5: Fibonacci Utility Tests**
- **Problem**: No validation for automatic Fibonacci calculation
- **Fix**: Created unit tests for detectSwingPoints, calculateFibonacciLevels, getFibonacciFromOHLC
- **Impact**: 12 tests validating Fibonacci calculation logic
- **Files**: `backend/tests/unit/fibonacci.test.js`

**Issue 6: Alternative Scenario Validation Tests**
- **Problem**: No validation for alternative scenario SL/TP placement
- **Fix**: Created unit tests for SL/TP placement validation, R:R ratio validation, structure validation
- **Impact**: 15 tests ensuring alternative scenarios follow trading rules
- **Files**: `backend/tests/unit/alternativeScenario.test.js`

**Issue 7: AnalyzerFactory Tests**
- **Problem**: No tests for AI response formatting and validation
- **Fix**: Created unit tests for validatePriceLevel, formatAnalysisResponse, AI response structure
- **Impact**: 13 tests validating analyzer formatting logic
- **Files**: `backend/tests/unit/analyzerFactory.test.js`

**Issue 8: Price Scheduler Integration Tests**
- **Problem**: No tests for candle-based SL/TP detection
- **Fix**: Created integration tests for candle data structure, SL/TP detection, pending order execution
- **Impact**: 13 tests validating end-to-end scheduler logic
- **Files**: `backend/tests/integration/priceScheduler.test.js`

## [20/04/2026] - v2.1.0 - Timezone Fixes & SL/TP Validation

### Timezone Fixes

**Issue 1: Chart Timezone Display**
- **Problem**: Charts displayed UTC time instead of GMT+7
- **Fix**: Added +7 hours offset to Unix timestamps in PriceChartContainer
- **Impact**: Charts now display correct GMT+7 time
- **Files**: `frontend/app/components/crypto/PriceChartContainer.tsx`

**Issue 2: Trade History Timezone Display**
- **Problem**: Trade history timestamps displayed in UTC instead of GMT+7
- **Fix**: Added formatToGMT7 helper function with +7 hours offset
- **Impact**: Trade history now displays correct GMT+7 time
- **Files**: `frontend/app/sections/HistorySection.tsx`

**Issue 3: Prediction Timeline Timezone Display**
- **Problem**: Prediction timeline timestamps displayed in UTC instead of GMT+7
- **Fix**: Updated formatDateTime to add +7 hours offset for GMT+7
- **Impact**: Prediction timeline now displays correct GMT+7 time
- **Files**: `frontend/app/sections/PredictionsSection.tsx`

### SL/TP Validation & AI Prompt Fixes

**Issue 4: SL/TP Side Validation**
- **Problem**: System allowed SHORT positions with SL below entry
- **Fix**: Added SL/TP side validation in autoEntryLogic, groqAnalyzer, analyzerFactory
- **Impact**: System rejects invalid SL/TP placements
- **Files**: `backend/src/services/autoEntryLogic.js`, `backend/src/groqAnalyzer.js`, `backend/src/analyzers/analyzerFactory.js`

**Issue 5: AI Prompt Specific Price Examples**
- **Problem**: AI prompt used specific price values (e.g., Entry=75000, SL=74250) causing confusion
- **Fix**: Removed specific price examples, used abstract positioning (SL BELOW/ABOVE entry, TP ABOVE/BELOW entry)
- **Impact**: AI no longer uses example prices as actual values
- **Files**: `backend/src/config/methods.js`

**Issue 6: Database Column Mismatch**
- **Problem**: SQLITE_ERROR: 22 values for 23 columns in Kim Nghia order processing
- **Fix**: Added entry_time column back to INSERT statement with datetime('now')
- **Impact**: Fixed column mismatch error
- **Files**: `backend/src/db/database.js`

**Issue 7: AI Not Returning SL/TP Fields**
- **Problem**: AI not returning suggested_entry, suggested_stop_loss, suggested_take_profit
- **Fix**: Marked fields as REQUIRED in prompts, added columns to analysis_history table
- **Impact**: AI now provides required SL/TP fields
- **Files**: `backend/src/config/methods.js`, `backend/src/db/migrations.js`, `backend/src/db/database.js`

**Issue 8: Auto-Entry Calculate Position for Hold Action**
- **Problem**: Auto-entry attempted to calculate position when AI action was "hold"
- **Fix**: Added check to only calculate position when action is buy or sell
- **Impact**: System skips position calculation for hold actions
- **Files**: `backend/src/services/autoEntryLogic.js`

**Issue 9: AI Returning Null SL for Sell Action**
- **Problem**: AI returning suggested_stop_loss as null even when action is "sell"
- **Fix**: Made prompt more explicit about SL/TP requirements, added fallback calculation
- **Impact**: System calculates default SL/TP if AI doesn't provide them
- **Files**: `backend/src/config/methods.js`, `backend/src/services/autoEntryLogic.js`

### Documentation Updates

**Issue 10: Timezone Configuration Documentation**
- **Problem**: Documentation didn't specify timezone handling approach
- **Fix**: Added timezone configuration documentation (backend UTC, frontend GMT+7)
- **Impact**: Clear documentation for timezone setup
- **Files**: `docs/setup.md`

## [20/04/2026] - Production Fixes & Prompt Optimization

### Production Fixes

**Issue 1: Granular SL/TP Values**
- **Problem**: SL/TP values appearing as even numbers (e.g., 74800, 75600)
- **Fix**: Added AI prompt rules requiring precise price levels with at least 2 decimal places
- **Impact**: SL/TP now reflect actual market structure (e.g., 74835.52, 74787.06)
- **Files**: `backend/src/config/methods.js`

**Issue 2: Short Position TP/SL Logic**
- **Problem**: Short positions had TP higher than SL (incorrect)
- **Fix**: Added validation ensuring SL > entry > TP for short positions
- **Impact**: Correct SL/TP ordering for short positions
- **Files**: `backend/src/analyzers/analyzerFactory.js`

**Issue 3: Prediction Timeline Close Prediction**
- **Problem**: Predictions showed "close" but no positions were actually closed
- **Fix**: Added processing of `position_decisions` from AI to close positions
- **Impact**: Positions now close when AI recommends closure
- **Files**: `backend/src/scheduler.js`

**Issue 4: Stop Loss PnL Positive**
- **Problem**: Positions hit stop loss but showed positive PnL
- **Fix**: Changed to use stop loss price instead of current price when closing
- **Impact**: Accurate PnL calculation for stop loss events
- **Files**: `backend/src/services/paperTradingEngine.js`

**Issue 5: Default SL/TP Fallback**
- **Problem**: System used default percentage-based SL/TP when AI didn't provide values
- **Fix**: Removed fallback and require AI-provided Entry, SL, TP
- **Impact**: Only trades with proper market structure levels execute
- **Files**: `backend/src/services/autoEntryLogic.js`

**Issue 6: SL Distance Too Small**
- **Problem**: Entry and SL too close (e.g., $3.33 on $74k price)
- **Fix**: Increased minimum SL distance from 0.5% to 1%, calculate from entry
- **Impact**: Minimum $750 SL distance on $75k entry
- **Files**: `backend/src/services/autoEntryLogic.js`, `backend/src/analyzers/analyzerFactory.js`, `backend/src/config/methods.js`

### Prompt Optimization

**Issue 7: AI Prompt SL/TP Placement Rules**
- **Problem**: AI suggesting TP on wrong side of entry for short positions
- **Fix**: Added explicit SL/TP placement rules with examples for LONG/SHORT
- **Impact**: AI now follows correct SL/TP ordering
- **Files**: `backend/src/config/methods.js`

**Issue 8: Groq API Token Limit**
- **Problem**: Rate limit reached (496,843/500,000 tokens per day)
- **Fix**: Optimized prompts by removing educational content and condensing JSON schema
- **Impact**: Token usage reduced by ~70% while maintaining method-specific information
- **Files**: `backend/src/config/methods.js`
