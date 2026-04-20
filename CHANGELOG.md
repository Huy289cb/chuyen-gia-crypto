# Changelog

All notable changes to the project will be documented in this file.

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
