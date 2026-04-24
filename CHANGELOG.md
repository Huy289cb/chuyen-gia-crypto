# Changelog

All notable changes to the project will be documented in this file.

## [24/04/2026] - v2.8.2 - Binance Testnet Order Sync Critical Fixes

### Bug Fixes

**Issue 1: Pending Orders Not Creating Limit Orders on Binance (Import Error)**
- **Problem**: Paper trading created pending orders but Binance testnet didn't create corresponding limit orders
- **Root Cause**: `placeLimitOrder` was imported in `testnetEngine.js` but not re-exported, causing import failures in `scheduler.js`
- **Fix**:
  - Added `placeLimitOrder` to imports from `binanceClient.js` in `testnetEngine.js`
  - Re-exported `placeLimitOrder` and `cancelOrder` for use in scheduler
- **Impact**: Testnet pending orders now create actual limit orders on Binance
- **Files**: `backend/src/services/testnetEngine.js`

**Issue 2: Testnet Pending Order Decisions Not Processed**
- **Problem**: Scheduler processed paper trading pending order decisions and testnet position decisions, but not testnet pending order decisions
- **Root Cause**: Missing Step 6 in scheduler to process testnet pending order decisions (cancel/modify)
- **Fix**:
  - Added Step 6 to process testnet pending order decisions in scheduler.js
  - Syncs with Binance when modifying orders (cancel old limit, place new limit)
  - Added confidence threshold check for testnet pending order decisions
- **Impact**: AI can now cancel/modify testnet pending orders with Binance sync
- **Files**: `backend/src/scheduler.js`

**Issue 3: Missing updateTestnetPendingOrder Function**
- **Problem**: No function to update testnet pending orders in database
- **Fix**: Added `updateTestnetPendingOrder` function to support modify operations
- **Impact**: Testnet pending orders can be modified in database and synced with Binance
- **Files**: `backend/src/db/testnetDatabase.js`

### Verified Working

- **Market orders**: `openTestnetPosition` correctly places market orders with SL/TP
- **Close orders**: `closeTestnetPositionEngine` correctly cancels SL/TP and places market close order
- **Pending order execution**: `checkTestnetPendingOrders` correctly cancels Binance limit order and places market order when triggered

### Version Update

**Issue 4: Version Bump to 2.8.2**
- Updated frontend version from 2.8.1 to 2.8.2
- Updated backend version from 1.0.1 to 1.0.2
- **Impact**: Versions reflect critical Binance sync fixes
- **Files**: `frontend/lib/version.ts`, `backend/package.json`

## [24/04/2026] - v2.8.1 - Binance Testnet Pending Order Synchronization Fix

### Bug Fixes

**Issue 1: Pending Orders Not Creating Limit Orders on Binance**
- **Problem**: Paper trading created pending orders but Binance testnet didn't create corresponding limit orders
- **Root Cause**: `scheduler.js` only saved pending orders to database, didn't call Binance API to place limit orders
- **Fix**:
  - Added `placeLimitOrder` call when creating testnet pending orders in scheduler.js
  - Added `binance_order_id` column to `testnet_pending_orders` table to track Binance order IDs
  - Updated `createTestnetPendingOrder` to accept and save `binance_order_id` parameter
- **Impact**: Testnet pending orders now create actual limit orders on Binance, mirroring paper trading behavior
- **Files**: `backend/src/scheduler.js`, `backend/src/db/migrations.js`, `backend/src/db/testnetDatabase.js`

**Issue 2: Cancel Pending Order Not Syncing with Binance**
- **Problem**: Canceling pending orders only updated database, didn't cancel Binance limit orders
- **Fix**:
  - Updated `cancelTestnetPendingOrder` to cancel Binance limit order before updating DB
  - Updated scheduler to pass `binance_order_id` when canceling pending orders
- **Impact**: Canceling pending orders now cancels corresponding Binance limit orders
- **Files**: `backend/src/db/testnetDatabase.js`, `backend/src/scheduler.js`

**Issue 3: Execute Pending Order Not Canceling Binance Limit Order**
- **Problem**: When price hit entry, system placed market order but didn't cancel existing Binance limit order
- **Fix**:
  - Added Binance limit order cancellation in `checkTestnetPendingOrders` before executing as market order
- **Impact**: Prevents duplicate orders when pending orders execute
- **Files**: `backend/src/schedulers/priceUpdateScheduler.js`

**Issue 4: Modify Pending Order Not Syncing with Binance**
- **Problem**: Modifying pending orders only updated database, didn't sync with Binance
- **Fix**:
  - Updated scheduler modify logic to cancel old Binance order and place new order with updated parameters
  - Updated `modifyPendingOrder` to accept `newBinanceOrderId` parameter
  - Updated `updatePendingOrder` to support `binance_order_id` field
- **Impact**: Modifying pending orders now syncs with Binance by replacing the limit order
- **Files**: `backend/src/scheduler.js`, `backend/src/db/database.js`

### Database Schema Updates

**Issue 5: Add binance_order_id Column to Pending Orders Tables**
- Added `binance_order_id TEXT` column to `testnet_pending_orders` table
- Added `binance_order_id TEXT` column to `pending_orders` table (for consistency)
- **Impact**: Both tables can track Binance order IDs for synchronization
- **Files**: `backend/src/db/migrations.js`

### Version Update

**Issue 6: Version Bump to 2.8.1**
- Updated frontend version from 2.8.0 to 2.8.1
- **Impact**: Frontend reflects new version with pending order sync fixes
- **Files**: `frontend/lib/version.ts`

## [24/04/2026] - v2.8.0 - Binance Futures REST API Refactoring

### Major Refactoring

**Issue 1: Remove SDK Dependency - Use Official REST API**
- **Problem**: System used `binance` SDK package which added unnecessary dependency and potential compatibility issues
- **Solution**: Refactored to use official Binance Futures REST API directly
- **Implementation**:
  - Created new architecture in `backend/src/services/binance/`:
    - `signer.js` - HMAC SHA256 signature generation for signed requests
    - `config.js` - Configuration with environment variables (BINANCE_BASE_URL, API_KEY, API_SECRET, etc.)
    - `endpoints.js` - API endpoints definitions (TIME, KLINE, PRICE, ACCOUNT, ORDER, etc.)
    - `client.js` - Core HTTP client with signature, retry logic, error handling
    - `market.js` - Market data functions (getServerTime, getKlines, getPrice)
    - `account.js` - Account functions (getAccount, getBalance, getPositionRisk)
    - `trading.js` - Trading functions (setLeverage, setMarginType, placeOrder, cancelOrder, etc.)
    - `stream.js` - User data stream (listenKey management)
  - Updated `binanceClient.js` to use new REST API modules instead of SDK
  - Removed `binance` package from dependencies
  - Added `axios` ^1.7.9 as HTTP client
- **Impact**: 
  - No SDK dependency - more control and transparency
  - Better error handling with specific error code detection (-1021, -2015, -1008)
  - Modular architecture for easier maintenance
  - Support for both Demo and Mainnet via environment variable
- **Files**: `backend/src/services/binance/`, `backend/src/services/binanceClient.js`, `backend/package.json`

**Issue 2: Environment Variable Update for Demo/Mainnet Switching**
- **Problem**: Old environment variables were testnet-specific, couldn't easily switch to mainnet
- **Solution**: Updated environment variables to support both environments
- **Implementation**:
  - Changed `BINANCE_TESTNET_*` to `BINANCE_*` for consistency
  - Added `BINANCE_BASE_URL` to switch between environments:
    - Demo: `https://demo-fapi.binance.com`
    - Mainnet: `https://fapi.binance.com`
  - Updated `binance.js` config to use new environment variables
  - Updated `.env.example` with new variable structure
- **Impact**: Easy switch between Demo and Mainnet by changing one environment variable
- **Files**: `backend/src/config/binance.js`, `backend/.env.example`

### Documentation Updates

**Issue 3: Documentation Updated for REST API Architecture**
- Updated `docs/binance-testnet-integration.md` to reflect new REST API architecture
- Added changelog section documenting the refactoring
- Updated README.md with new environment variables and architecture
- **Impact**: Documentation matches new implementation
- **Files**: `docs/binance-testnet-integration.md`, `README.md`

### Version Update

**Issue 4: Version Bump to 2.8.0**
- Updated backend version from 1.0.0 to 1.0.1
- Updated frontend version from 2.7.6 to 2.8.0
- **Impact**: Versions reflect new REST API refactoring
- **Files**: `backend/package.json`, `frontend/lib/version.ts`

## [23/04/2026] - v2.7.6 - Trade History UI Pagination Fix

### Bug Fixes

**Issue 1: Trade History Count Displaying "undefined"**
- **Problem**: Trade History header showed "Trade History (undefined)" instead of actual count
- **Root Cause**: Backend API returned `meta.totalCount` but frontend expected `meta.total`
- **Fix**: Renamed backend response fields to match frontend expectations:
  - `totalCount` → `total`
  - `currentPage` → `page`
- **Impact**: Trade History header now displays correct count (e.g., "Trade History (0)" or "Trade History (5)")
- **Files**: `backend/src/routes/performance.js`

**Issue 2: usePaperTrading Hook Missing Pagination Parameters**
- **Problem**: `fetchTradeHistory` in usePaperTrading hook didn't use pagination parameters
- **Fix**: Added `limit` and `page` parameters to `fetchTradeHistory` function
- **Impact**: Consistent server-side pagination across the codebase
- **Files**: `frontend/app/hooks/usePaperTrading.ts`

### Version Update

**Issue 3: Version Bump to 2.7.6**
- Updated frontend version from 2.7.5 to 2.7.6
- **Impact**: Frontend reflects new version with Trade History UI fix
- **Files**: `frontend/lib/version.ts`

## [23/04/2026] - v2.7.4 - Market Order SL/TP Recalculation Fix

### Bug Fixes

**Issue 1: Market Order SL Distance Violation**
- **Problem**: When AI suggested entry price was already hit by current price, system executed market order with entry=currentPrice but kept original AI SL/TP, causing invalid SL distances
- **Example**: 
  - AI: entry=77800, SL=78400, TP=77200 (short)
  - Current: 78300
  - System: entry changed to 78300, but SL kept at 78400
  - Result: SL distance = 100 USD (~0.13%) < ICT minimum (0.75%)
- **Root Cause**: autoEntryLogic.js changed entry to currentPrice for market orders but didn't recalculate SL/TP to maintain proper distance
- **Fix**:
  - Added recalculateSLTPForMarketOrder function to recalculate SL/TP when entry changes
  - Maintains same percentage distance from original AI suggestion
  - Validates recalculated SL meets method-specific minimum (ICT: 0.75%, Kim Nghia: 0.4%)
  - Rejects trade if recalculated SL distance is too small
  - Added comprehensive logging for debugging
- **Impact**: Market orders now have valid SL/TP distances that meet method requirements
- **Files**: `backend/src/services/autoEntryLogic.js`

### Testing

**Issue 2: Unit Tests for SL/TP Recalculation**
- Created comprehensive test suite for recalculateSLTPForMarketOrder function
- Tests cover:
  - LONG position recalculation maintaining % distance
  - SHORT position recalculation maintaining % distance
  - Rejection when recalculated SL distance < minimum threshold
  - Using minimum SL distance when original SL not provided
  - Using 2x SL distance for TP when original TP not provided
  - Method-specific minimum distances (ICT: 0.75%, Kim Nghia: 0.4%)
  - Invalid side handling
  - User-reported bug case (short 78300, entry 77800, SL 78400)
- All 9 tests passing
- **Impact**: Verified SL/TP recalculation logic works correctly for both long and short positions
- **Files**: `backend/tests/unit/autoEntryLogic.test.js`

### Documentation Updates

**Issue 3: Paper Trading Documentation Updated**
- Updated Market Orders section to document SL/TP recalculation behavior
- Added validation notes for method-specific minimum distances
- **Impact**: Documentation reflects new market order SL/TP recalculation feature
- **Files**: `docs/paper-trading.md`

### Version Update

**Issue 4: Version Bump to 2.7.4**
- Updated frontend version from 2.7.3 to 2.7.4
- **Impact**: Frontend reflects new version with market order SL/TP fix
- **Files**: `frontend/lib/version.ts`

## [23/04/2026] - v2.7.2 - AI Position Decision Consistency Fix

### Bug Fixes

**Issue 1: AI Position Decision Logic Inconsistency**
- **Problem**: AI suggested closing positions that aligned with market bias (e.g., bias=bearish but closed short position with -0.21% PnL)
- **Root Cause**: System prompt lacked explicit consistency rule between bias and position decisions
- **Example**: AI returned bias=bearish (85% confidence), action=sell, but position_decisions=close_early for existing short position
- **Fix**:
  - Added CRITICAL CONSISTENCY RULE to both ICT and Kim Nghia system prompts
  - Rule: Position decisions PHẢI nhất quán với market bias
  - If bias=bullish and position=long → action should be hold (KHÔNG close_early)
  - If bias=bearish and position=short → action should be hold (KHÔNG close_early)
  - Only use close_early when: (1) bias đã đảo chiều, HOẶC (2) cấu trúc thị trường đã thay đổi hoàn toàn, HOẶC (3) position đã đạt mục tiêu TP gần nhất
- **Impact**: AI will no longer suggest closing positions that align with market bias
- **Files**: `backend/src/config/methods.js`

**Issue 2: Post-Processing Validation for Bias Consistency**
- **Problem**: AI might still ignore consistency rules in prompt
- **Fix**: Added post-processing validation in analyzerFactory.js
  - Enhanced validatePositionDecisions function to check bias-position alignment
  - Auto-corrects close_early to hold when bias aligns with position
  - Auto-corrects reverse to hold when bias aligns with position
  - Logs corrections for debugging
  - Fetches open positions for validation context
- **Impact**: Safety net catches any remaining inconsistencies from AI
- **Files**: `backend/src/analyzers/analyzerFactory.js`

**Issue 3: User Prompt Enhancement**
- **Problem**: AI needs explicit reminder during decision making
- **Fix**: Added CRITICAL REMINDER in user prompt context
  - "Position decisions MUST align with your overall bias assessment"
  - "If you determine bias=bearish, do NOT close existing short positions unless structure has fundamentally changed"
  - "If bias=bullish, do NOT close existing long positions unless structure has fundamentally changed"
- **Impact**: AI receives explicit instruction during position decision analysis
- **Files**: `backend/src/analyzers/analyzerFactory.js`

### Testing

**Issue 4: Unit Tests for Bias Consistency Validation**
- Created comprehensive test suite for bias consistency validation
- Tests cover:
  - Auto-correction when bias=bearish + position=short
  - Auto-correction when bias=bullish + position=long
  - Allow close_early when bias changes direction
  - Allow hold regardless of bias
  - Auto-correction for reverse action
  - Neutral bias handling
  - Missing position handling
- All 8 tests passing
- **Impact**: Verified bias consistency validation logic works correctly
- **Files**: `backend/tests/unit/biasConsistencyValidation.test.js`

### Documentation Updates

**Issue 5: AI Position Management Documentation Updated**
- Added bias consistency rule section to ai-position-management.md
- Documented the new validation logic and auto-correction behavior
- **Impact**: Documentation reflects new bias consistency enforcement
- **Files**: `docs/ai-position-management.md`

### Version Update

**Issue 6: Version Bump to 2.7.2**
- Updated frontend version from 2.7.1 to 2.7.2
- **Impact**: Frontend reflects new version with bias consistency fix
- **Files**: `frontend/lib/version.ts`

## [23/04/2026] - v2.7.1 - AI Prompt Context Testing & Validation

### Testing

**Issue 1: Unit Tests for AI Prompt Context**
- **Problem**: No tests to verify that open positions and pending orders are correctly fetched and passed to AI prompt
- **Solution**: Created comprehensive unit test suite for buildUserPrompt function
- **Implementation**:
  - Exported buildUserPrompt function from analyzerFactory.js for testing
  - Created buildUserPrompt.test.js with 18 tests covering:
    - Open positions fetching with correct filters (symbol: BTC, status: open, method_id)
    - Pending orders fetching with correct filters (symbol: BTC, status: pending, method_id)
    - Position formatting with PnL, time-in-position, risk info
    - Pending order formatting with price distance, waiting time, R:R
    - Decision instructions inclusion when positions/orders exist
    - Error handling for database failures
    - OHLC data fetching for Kim Nghia method
  - Created getPositions.test.js with 14 tests covering:
    - Filter by symbol, status, method_id, account_id
    - Multiple filters together
    - Pagination (limit/offset)
    - Ordering by entry_time DESC
  - Created getPendingOrders.test.js with 10 tests covering:
    - Filter by symbol, status, method_id, account_id
    - Multiple filters together
    - Ordering by created_at DESC
- **Impact**: Verified that AI prompt correctly includes position and order context for decision making
- **Files**: `backend/src/analyzers/analyzerFactory.js`, `backend/tests/unit/buildUserPrompt.test.js`, `backend/tests/unit/getPositions.test.js`, `backend/tests/unit/getPendingOrders.test.js`

### Documentation Updates

**Issue 2: CHANGELOG Updated**
- Added entry for v2.7.1 with testing improvements
- **Impact**: Documentation reflects new test coverage
- **Files**: `CHANGELOG.md`

### Version Update

**Issue 3: Version Bump to 2.7.1**
- Updated frontend version from 2.7.0 to 2.7.1
- **Impact**: Frontend reflects new version with test coverage improvements
- **Files**: `frontend/lib/version.ts`

## [23/04/2026] - v2.7.0 - Pending Order Volume Management & Logic Validation

### Bug Fixes

**Issue 1: Volume Limit Not Enforced for Pending Orders**
- **Problem**: System allowed creating 6 pending orders simultaneously with total volume $9,123.53 exceeding 2k limit
- **Root Cause**: Volume check in autoEntryLogic.js only considered open positions, ignored pending orders
- **Fix**:
  - Updated volume check to include pending order volume in total calculation
  - Added strategic entry validation: when volume reaches 2k limit, new pending orders only allowed if entry aligns with SL/TP of existing positions (±0.5% tolerance)
  - Total volume (open positions + pending orders) never exceeds 2k
- **Impact**: System now properly enforces volume limit across both open positions and pending orders
- **Files**: `backend/src/services/autoEntryLogic.js`

**Issue 2: Pending Orders with Illogical SL/TP Placement**
- **Problem**: Pending orders created with invalid SL/TP (e.g., SHORT order: entry $78,250, SL $77,950 below entry, TP $78,650 above entry)
- **Root Cause**: SL/TP validation in createPendingOrder was missing, allowing invalid orders to be created
- **Fix**:
  - Added validatePendingOrderLogic function in createPendingOrder to check SL/TP placement before database insertion
  - LONG: SL must be below entry, TP must be above entry
  - SHORT: SL must be above entry, TP must be below entry
  - Minimum SL distance validation (0.5% from entry)
  - Reject invalid orders with descriptive error message
- **Impact**: No pending orders with illogical SL/TP placement can be created
- **Files**: `backend/src/db/database.js`

**Issue 3: Fallback Logic Overriding Valid AI Values**
- **Problem**: Fallback logic in calculateSuggestedPosition could override valid AI-provided SL/TP with invalid defaults
- **Root Cause**: Fallback logic applied after validation, causing valid AI values to be replaced
- **Fix**:
  - Moved SL/TP validation before fallback logic
  - If AI provides invalid SL/TP, reject trade instead of using fallback
  - Added logging to track when fallback logic is triggered
- **Impact**: AI-provided values are validated before fallback, preventing invalid overrides
- **Files**: `backend/src/services/autoEntryLogic.js`

### New Features

**Helper Functions for Volume and Order Validation**
- calculateTotalVolume(db, accountId, symbol) - Returns total volume of open positions + pending orders
- validateStrategicEntry(entryPrice, openPositions, tolerance) - Checks if entry aligns with SL/TP of existing positions
- validateOrderLogic(side, entry, sl, tp) - Validates SL/TP placement based on side
- **Impact**: Reusable validation functions for consistent order logic across codebase
- **Files**: `backend/src/services/autoEntryLogic.js`

### Testing

**Issue 4: Unit Tests for New Validation Logic**
- Created comprehensive test suite for new validation functions
- Tests for validateOrderLogic (12 tests covering LONG/SHORT, valid/invalid scenarios)
- Tests for validateStrategicEntry (6 tests covering alignment checks)
- Tests for calculateTotalVolume (3 tests covering volume calculation)
- All 21 tests passing
- **Files**: `backend/tests/unit/autoEntryLogic.test.js`

### Documentation Updates

**Issue 5: README Updated**
- Updated version to 2.7.0
- Added notes about volume management with strategic entry validation
- Added notes about SL/TP validation for pending orders
- **Impact**: README reflects new volume management and validation features
- **Files**: `README.md`

**Issue 6: Paper Trading Documentation Updated**
- Updated volume limit section to include pending order volume
- Added strategic entry validation documentation
- Added order logic validation section
- **Impact**: Documentation matches new volume management and validation implementation
- **Files**: `docs/paper-trading.md`

**Issue 7: Risk Management Documentation Updated**
- Updated volume management section to include strategic entry rules
- Added order validation best practices
- **Impact**: Risk management docs reflect new volume strategy
- **Files**: `docs/risk-management.md`

### Version Update

**Issue 8: Version Bump to 2.7.0**
- Updated frontend version from 2.6.0 to 2.7.0
- Updated frontend package.json from 2.0.3 to 2.7.0
- Backend package.json remains at 1.0.0 (separate versioning)
- **Impact**: Frontend reflects new version with pending order fixes
- **Files**: `frontend/lib/version.ts`, `frontend/package.json`

## [22/04/2026] - v2.6.0 - Prediction Timeline Enhancement: Raw Data Display & Pagination

### New Features

**Issue 1: Raw AI Request/Response Display in Prediction Timeline**
- **Problem**: Raw AI responses were logged to txt files on server, inefficient and not accessible from frontend
- **Solution**: Moved raw data storage from txt files to database, added frontend display
- **Implementation**:
  - Added `raw_question` and `raw_answer` TEXT columns to analysis_history table
  - Modified analyzerFactory to capture full request (system + user prompt) and raw response
  - Updated saveAnalysis to accept and store raw data
  - Updated scheduler to pass raw data to saveAnalysis
  - Added expandable sections in PredictionsSection to display raw question/answer
  - Removed txt file logging (rawResponseLogger.js deleted, cleanup job removed)
- **Impact**: Users can now view raw AI input/output directly in frontend Prediction Timeline
- **Files**: `backend/src/db/migrations.js`, `backend/src/db/database.js`, `backend/src/analyzers/analyzerFactory.js`, `backend/src/scheduler.js`, `backend/src/groq-client.js`, `frontend/app/sections/PredictionsSection.tsx`

**Issue 2: Server-Side Pagination for Prediction Timeline**
- **Problem**: Prediction Timeline loaded all data at once, inefficient for large datasets
- **Solution**: Implemented server-side pagination with default 5 items per page
- **Implementation**:
  - Updated getRecentAnalysisWithPredictions to accept page parameter and calculate OFFSET
  - Added total count query for pagination metadata
  - Updated /api/predictions/:coin endpoint to accept page and limit parameters
  - Added pagination UI controls (Previous/Next buttons, page indicator) in PredictionsSection
  - Default limit changed from 20 to 5 items per page
- **Impact**: Prediction Timeline now loads data efficiently with pagination
- **Files**: `backend/src/db/database.js`, `backend/src/routes.js`, `frontend/app/sections/PredictionsSection.tsx`

### Documentation Updates

**Issue 3: API Documentation Updated**
- **Changes**:
  - Added /api/predictions/:coin endpoint documentation with pagination parameters
  - Documented raw_question and raw_answer fields
  - Added field definitions for new raw data fields
- **Impact**: API spec now reflects new pagination and raw data features
- **Files**: `docs/api-spec.md`

**Issue 4: README Updated**
- **Changes**:
  - Updated Prediction Timeline description to mention pagination (5 items per page)
  - No changes needed for txt logging (was not documented in README)
- **Impact**: README reflects new pagination feature
- **Files**: `README.md`

### Version Update

**Issue 5: Version Bump to 2.6.0**
- **Change**: Updated APP_VERSION from '2.5.0' to '2.6.0'
- **Impact**: Frontend reflects new version
- **Files**: `frontend/lib/version.ts`

## [22/04/2026] - v2.5.0 - ICT Method Disablement & KimNghia Scheduler Update

### Configuration Changes

**Issue 1: ICT Method Temporarily Disabled**
- **Decision**: ICT Smart Money method temporarily disabled to focus on KimNghia method
- **Implementation**:
  - Commented out ICT cron schedule in scheduler.js (code preserved for future multi-method support)
  - Commented out ICT account initialization in index.js (code preserved for future multi-method support)
  - ICT configuration remains in methods.js with `enabled: false`
- **Impact**: System now runs only KimNghia method, ICT code preserved for future re-enablement
- **Files**: `backend/src/scheduler.js`, `backend/src/index.js`

**Issue 2: KimNghia Scheduler Updated to 10-Minute Intervals**
- **Change**: Updated KimNghia cron schedule from 7,22,37,52 to 0,10,20,30,40,50
- **Impact**: KimNghia analysis now runs every 10 minutes at :00, :10, :20, :30, :40, :50
- **Files**: `backend/src/scheduler.js`

### Frontend Changes

**Issue 3: Frontend Defaults to KimNghia Method**
- **Changes**:
  - Updated default selectedMethod from 'ict' to 'kim_nghia' in page.tsx
  - Updated default selectedMethod from 'ict' to 'kim_nghia' in Header.tsx
  - Updated default method parameter from 'ict' to 'kim_nghia' in useTrends.ts
  - Updated default method parameter from 'ict' to 'kim_nghia' in usePaperTrading.ts
  - Updated default method prop from 'ict' to 'kim_nghia' in all section components
  - Updated default method from 'ict' to 'kim_nghia' in rules page
- **Note**: Method selector UI preserved for future multi-method support
- **Impact**: Frontend defaults to kim_nghia method but UI switcher remains available
- **Files**: `frontend/app/page.tsx`, `frontend/app/layout/Header.tsx`, `frontend/app/hooks/useTrends.ts`, `frontend/app/hooks/usePaperTrading.ts`, `frontend/app/sections/*.tsx`, `frontend/app/rules/page.tsx`

### Documentation Updates

**Issue 4: README Updated with Disablement Notes**
- **Changes**:
  - Updated title to v2.5.0
  - Added note: "ICT Smart Money method is temporarily disabled (code preserved for future multi-method support)"
  - Added disablement note to ICT Smart Money Analysis section
  - Updated scheduler description: "KimNghia: 10 minutes, ICT: disabled"
  - Updated architecture section to reflect ICT disabled status
  - Added disablement note to ICT Methodology section
- **Impact**: Documentation clearly reflects current state with preservation notes
- **Files**: `README.md`

**Issue 5: Multi-Method Architecture Preservation Documentation**
- **Changes**: Added documentation notes explaining that ICT code is preserved for future multi-method support
- **Impact**: Developers understand preservation strategy for future multi-method re-enablement
- **Files**: Documentation updates (pending in docs/architecture.md and docs/paper-trading.md)

### Version Update

**Issue 6: Version Bump to 2.5.0**
- **Change**: Updated APP_VERSION from '2.4.2' to '2.5.0'
- **Impact**: Frontend reflects new version
- **Files**: `frontend/lib/version.ts`

## [22/04/2026] - v2.4.2 - Datetime Standardization & R-Multiple Display Fix

### Bug Fixes

**Issue 1: R-Multiple Column Displaying +0.00R Despite Positive PnL**
- **Problem**: Trade History R-Multiple column showed "+0.00R" even when PnL was "+$6.23"
- **Root Cause**: `updatePosition` function missing case to handle `r_multiple` field updates
- **Fix**: Added `r_multiple` field handling to `updatePosition` function
- **Impact**: R-Multiple now correctly displays as PnL / risk_usd (e.g., "+0.62R" for $6.23 PnL with $10 risk)
- **Files**: `backend/src/db/database.js`

**Issue 2: Pending Orders Created Column Format Inconsistent**
- **Problem**: Pending Orders "Created" column displayed "HH:MM DD/MM/YY" (e.g., "04:07 23/04/26") while Trade History showed "HH:MM:SS DD/MM/YYYY" (e.g., "20:22:21 22/04/2026")
- **Root Cause**: `formatToGMT7` function used `year: '2-digit'` and missing `second` parameter
- **Fix**: 
  - Changed `year: '2-digit'` to `year: 'numeric'` for 4-digit year display
  - Added `second: '2-digit'` to show seconds
- **Impact**: All datetime columns now display consistently as "HH:MM:SS DD/MM/YYYY" across Pending Orders and Trade History
- **Files**: `frontend/lib/dateHelpers.ts`

**Issue 3: Database Datetime Fields Using Inconsistent Formats**
- **Problem**: Some database datetime fields used `new Date().toISOString()` (JS format) while others used `datetime('now')` (SQLite format)
- **Root Cause**: Mixed approaches across codebase caused potential format inconsistencies
- **Fix**: Standardized all database datetime default fields to use SQLite `datetime('now')`:
  - `pending_orders.created_at`: Changed from `new Date().toISOString()` to `datetime('now')`
  - `predictions.predicted_at`: Changed from `new Date().toISOString()` to `datetime('now')`
  - `accounts.last_trade_time`: Auto-set to `datetime('now')` when updating trading-related fields (equity, realized_pnl, total_trades)
  - Removed manual `last_trade_time` setting from `paperTradingEngine.js`
- **Impact**: All database timestamps now use consistent SQLite datetime format ("YYYY-MM-DD HH:MM:SS")
- **Files**: `backend/src/db/database.js`, `backend/src/services/paperTradingEngine.js`

### Documentation Updates

**Issue 4: Version Bump**
- Updated frontend version from 2.4.1 to 2.4.2
- Files: `frontend/lib/version.ts`

## [21/04/2026] - v2.4.1 - Database Schema Validation & Column Mismatch Fixes

### Database Fixes

**Issue 1: Positions INSERT Statement Column Mismatch**
- **Problem**: SQLITE_ERROR: 22 values for 23 columns when inserting position
- **Root cause**: INSERT statement included 29 columns but table schema has only 23 columns
  - Table schema: 23 columns from initial CREATE TABLE
  - INSERT statement: included 6 extra columns from ALTER TABLE migrations (ict_strategy, tp_levels, tp_hit_count, partial_closed, method_id, r_multiple)
- **Fix**: Remove extra columns from INSERT statement to match actual table schema
- **Impact**: Positions can now be saved to database without column mismatch error
- **Files**: `backend/src/db/database.js`

**Issue 2: Pending Orders INSERT Statement Missing Column**
- **Problem**: Column mismatch in pending_orders INSERT statement
- **Root cause**: INSERT statement was missing created_at column (exists in table schema)
- **Fix**: Add created_at column to INSERT statement with datetime('now')
- **Impact**: Pending orders can now be saved to database without column mismatch error
- **Files**: `backend/src/db/database.js`

### New Features

**Issue 3: Schema Validation to Prevent Future Column Mismatches**
- **Problem**: Column mismatch errors occur at runtime, causing deployment failures
- **Solution**: Created schemaValidator.js with validation functions
  - getTableSchema(): Retrieves actual table schema from database
  - validateInsertSchema(): Compares INSERT columns with table schema
  - validateAllSchemas(): Validates critical tables (positions, pending_orders, accounts)
  - runSchemaValidationOnStartup(): Runs validation on startup with non-blocking error handling
- **Integration**:
  - Added to init.js: Runs after migrations during database initialization
  - Added to index.js: Runs after account initialization on application startup
- **Impact**: Column mismatches detected early with detailed error logging, preventing runtime errors
- **Files**: `backend/src/db/schemaValidator.js` (new), `backend/src/db/init.js`, `backend/src/index.js`

### Documentation

**Issue 4: Update Documentation**
- **Problem**: No documentation on how to fix schema mismatches
- **Fix**: Added documentation for schema validation feature
- **Impact**: Developers can now understand and fix schema mismatches quickly
- **Files**: `CHANGELOG.md`

## [21/04/2026] - v2.4.0 - Kim Nghia Auto-Entry Fixes & JSON Parsing Improvements

### Bug Fixes

**Issue 1: Kim Nghia Multi-Timeframe Alignment Blocking Position Entry**
- **Problem**: Kim Nghia method blocked by "Multi-timeframe alignment insufficient (0/2 aligned)" despite high confidence (80-85%)
- **Root Cause**: 
  - Kim Nghia method doesn't save timeframe predictions to database (by design - uses price_prediction instead)
  - Auto-entry logic required timeframe predictions for alignment check
  - Scheduler passed method.autoEntry (config only) instead of full method object
- **Fix**:
  - Skip multi-timeframe alignment check for Kim Nghia method (doesn't use timeframe predictions)
  - Changed scheduler to pass full method object instead of method.autoEntry
  - Updated evaluateAutoEntry to handle both full method object and autoEntry config
- **Impact**: Kim Nghia can now open positions based on AI confidence without timeframe alignment requirement
- **Files**: `backend/src/services/autoEntryLogic.js`, `backend/src/scheduler.js`

**Issue 2: "alignment is not defined" Error**
- **Problem**: Database error "alignment is not defined" when Kim Nghia passed all auto-entry checks
- **Root Cause**: Line 224 referenced alignment.alignedCount but alignment variable was never defined when check was skipped for Kim Nghia
- **Fix**:
  - Declare let alignment = null before the check
  - Set default alignment = { alignedCount: 0, details: {} } when skipped for Kim Nghia
  - Conditionally build reason string to include alignment info only when check was performed
- **Impact**: Kim Nghia can successfully enter positions when all checks pass
- **Files**: `backend/src/services/autoEntryLogic.js`

**Issue 3: JSON Validation Errors from Groq API**
- **Problem**: qwen/qwen3-32b and openai/gpt-oss-120b returning invalid JSON causing 400 errors
- **Root Cause**: Models add extra text/markdown around JSON, Groq json_object mode rejects non-pure JSON
- **Fix**:
  - Added cleanJSONResponse function to extract JSON from raw response
  - Disabled response_format json_object mode
  - Added fixJSONSyntax function to handle trailing commas and double commas
  - Reordered models to prioritize working meta-llama/llama-4-scout-17b-16e-instruct
  - Added strong technical warning to Kim Nghia prompt (no extra text/markdown)
- **Impact**: System can now handle malformed JSON from models, meta-llama prioritized as most reliable
- **Files**: `backend/src/groq-client.js`, `backend/src/config/methods.js`

**Issue 4: SL Distance Validation Too Strict**
- **Problem**: AI suggested SL distance 0.39% rejected (below 0.5% minimum)
- **Fix**: Reduced minimum SL distance from 0.5% to 0.3% to match AI behavior
- **Impact**: Positions with 0.3%+ risk distance now accepted
- **Files**: `backend/src/services/autoEntryLogic.js`

**Issue 5: Undefined Variable Errors**
- **Problem**: Potential errors when analysis.confidence, currentPrice, or suggestedEntry are undefined
- **Fix**:
  - Added fallback for confidenceScore: (analysis.confidence || 0) * 100
  - Added validation for currentPrice: if (!currentPrice || currentPrice <= 0)
  - Added validation for suggestedEntry: if (!suggestedEntry || suggestedEntry <= 0)
- **Impact**: Prevents NaN/toFixed errors and division by zero errors
- **Files**: `backend/src/services/autoEntryLogic.js`

### Documentation Updates

**Issue 6: Documentation Outdated**
- **Problem**: Documentation didn't reflect Kim Nghia method differences and recent fixes
- **Fix**: Updated README.md, CHANGELOG.md, and architecture documentation
- **Impact**: Documentation now matches actual code configuration
- **Files**: `README.md`, `CHANGELOG.md`

## [21/04/2026] - v2.3.0 - Refactoring, Model Updates & Risk Distance Fix

### Code Refactoring

**Issue 1: Remove Hardcoded Confidence & Fallback Analysis**
- **Problem**: AI confidence values were hardcoded to 55% (Kim Nghia) and 40% (ICT) in fallback logic
- **Root Cause**: `generateFallbackAnalysis` function in both groqAnalyzer.js and analyzerFactory.js had hardcoded confidence values
- **Fix**:
  - Removed `generateFallbackAnalysis` function from both files
  - Changed error handling to return simple error message when AI fails instead of fallback analysis
  - All confidence now comes from AI responses without fallback overrides
- **Impact**: AI raw output displayed correctly without hardcoded fallback values
- **Files**: `backend/src/groqAnalyzer.js` (deleted), `backend/src/analyzers/analyzerFactory.js`

**Issue 2: Duplicate Code Consolidation**
- **Problem**: groqAnalyzer.js was just a wrapper around analyzerFactory.js, creating code duplication
- **Fix**:
  - Deleted groqAnalyzer.js file
  - Updated scheduler.js to use analyzerFactory directly
  - Updated routes.js to use analyzerFactory directly
- **Impact**: Cleaner codebase, single source of truth for analysis logic
- **Files**: `backend/src/groqAnalyzer.js` (deleted), `backend/src/scheduler.js`, `backend/src/routes.js`

**Issue 3: Extract Shared Utilities**
- **Problem**: Helper functions duplicated across multiple files
- **Fix**:
  - Created `backend/src/utils/dateHelpers.js` with `formatVietnamTime` function
  - Created `backend/src/utils/asyncHelpers.js` with `promiseAllWithTimeout` function
  - Updated scheduler.js, priceUpdateScheduler.js, autoEntryLogic.js to import from dateHelpers
  - Updated database.js, migrations.js to import from asyncHelpers
- **Impact**: Duplicated code consolidated into reusable utilities
- **Files**: `backend/src/utils/dateHelpers.js`, `backend/src/utils/asyncHelpers.js`, `backend/src/scheduler.js`, `backend/src/schedulers/priceUpdateScheduler.js`, `backend/src/services/autoEntryLogic.js`, `backend/src/db/database.js`, `backend/src/db/migrations.js`

**Issue 4: Duplicate formatVietnamTime Declaration**
- **Problem**: autoEntryLogic.js imported formatVietnamTime but also had local function declaration
- **Error**: "Identifier 'formatVietnamTime' has already been declared" at runtime
- **Fix**: Removed local function declaration, kept only import from dateHelpers.js
- **Impact**: Fixed runtime error
- **Files**: `backend/src/services/autoEntryLogic.js`

### AI Prompt Updates

**Issue 5: Kim Nghia Scoring-Based Confidence System**
- **Problem**: Previous prompt lacked structured confidence scoring
- **Fix**:
  - Added scoring system: HTF Alignment (30%), Liquidity & Structure (30%), SMC & Fibo Confluence (20%), Volume Confirmation (20%)
  - Added action thresholds: 90-100% (perfect), 70-89% (strong), 50-69% (average), <50% (hold)
  - Added `scoring_detail` field to output format
  - Changed structure format to use `key_event` instead of `hh_hl`/`bos_choch`
  - Changed `volume_analysis` to string instead of volume object
  - Removed `smc` and `indicators` objects from output
- **Impact**: AI provides more structured confidence scores and detailed analysis
- **Files**: `backend/src/config/methods.js`, `backend/src/analyzers/analyzerFactory.js`

### Groq Model Updates

**Issue 6: Deprecated Model Removal**
- **Problem**: llama-3.1-70b-versatile model was decommissioned by Groq (404 error)
- **Fix**:
  - Removed llama-3.1-70b-versatile from model list
  - Added qwen/qwen3-32b: Best for reasoning, math, JSON handling (60 RPM, 6000 TPM)
  - Added openai/gpt-oss-120b: GPT-4o equivalent, best for narrative understanding (30 RPM, 8000 TPM)
  - Added meta-llama/llama-4-scout-17b-16e-instruct: Fastest speed, 30,000 TPM for scalping
  - Kept llama-3.3-70b-versatile and llama-3.1-8b-instant as fallbacks
- **Impact**: System uses latest supported Groq models with better capabilities
- **Files**: `backend/src/groq-client.js`

### Bug Fixes

**Issue 7: Risk Distance Too Strict for Kim Nghia**
- **Problem**: 70% confidence analysis rejected due to risk distance 0.74% < 0.75%
- **Root Cause**: Min risk distance hardcoded at 0.75% in autoEntryLogic.js
- **Fix**: Reduced minRiskDistance from 0.75% to 0.5% to match Kim Nghia config
- **Impact**: Positions with 0.5%+ risk distance now accepted for Kim Nghia method
- **Files**: `backend/src/services/autoEntryLogic.js`

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
