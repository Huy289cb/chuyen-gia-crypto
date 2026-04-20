# Changelog

All notable changes to the project will be documented in this file.

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
