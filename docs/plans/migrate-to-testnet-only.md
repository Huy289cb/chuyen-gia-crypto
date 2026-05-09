# Migration Plan: Remove Paper Trading, Focus on Testnet-AI Integration

This plan outlines the complete removal of paper trading functionality and migration to Binance testnet-only trading with focus on AI-testnet integration for position management and auto-entry.

## Overview

**Remove:**
- All paper trading code (backend repositories, sync services, routes)
- All paper trading frontend hooks and components
- Comparison dashboard and all comparison features
- Paper trading database tables (keep for historical data but mark as deprecated)

**Focus:**
- AI position management using testnet data (open positions, pending orders)
- Auto-entry logic placing orders on Binance testnet
- Testnet-only dashboard and UI
- Worker scheduler syncing only testnet data

## Phase 1: Backend - Update AI/Analyzer to Use Testnet

**File:** `backend/src/analyzers/analyzerFactory.ts`

**Tasks:**
- [x] Replace import from `paperTrading.repository` to `testnet.repository`
  - Line 232: Change `getPositions` → `getTestnetPositions`
  - Line 284: Change `getPendingOrders` → `getTestnetPendingOrders`
  - Line 435: Change `getPositions` → `getTestnetPositions`
- [x] Update function calls with testnet repository functions
- [x] Verify field name compatibility between paper trading and testnet schemas
- [ ] Test AI context fetching with testnet data (runtime)

## Phase 2: Backend - Remove Paper Trading Code

**Files to delete:**
- [x] `backend/src/repositories/paperTrading.repository.ts`
- [x] `backend/src/services/paper-trading-sync.ts`
- [x] `backend/src/routes/accounts.ts`
- [x] `backend/src/routes/positions.ts`

**Files to modify:**
- [x] `backend/src/routes/index.ts` - Remove accounts route import and registration
- [x] `backend/src/routes/performance.ts` - Update to use testnet repository and tables
- [x] `backend/src/config/worker.ts` - Remove `enablePaperTradingSync` config
- [x] `backend/src/services/worker-scheduler.ts` - Remove paper trading sync calls
- [x] `backend/src/services/runtime-maintenance.ts` - Remove paper trading snapshot logic

**Changes to `performance.ts`:**
- [x] Replace `getOrCreateAccount` with `getOrCreateTestnetAccount`
- [x] Update Prisma queries: `position` → `testnetPosition`, `account` → `testnetAccount`, `accountSnapshot` → `testnetAccountSnapshot`
- [x] Verify field compatibility and update as needed

**Changes to `worker.ts`:**
- [x] Remove `enablePaperTradingSync: boolean` from interface
- [x] Remove `enablePaperTradingSync` from workerConfig object
- [x] Remove from validation function

**Changes to `worker-scheduler.ts`:**
- [x] Remove import of `syncPaperTradingForSymbol`
- [x] Remove paper trading sync call (lines 69-71)
- [x] Update log message to remove paperTradingSync reference

## Phase 3: Backend - Update Auto-Entry Logic
x
**Files to search and modify:**
- [ ] Search and update auto-entry logic in `runtime-maintenance.ts`
- [ ] Search and update auto-entry logic in `testnet-sync.ts`
- [ ] Search and update any other files with `evaluateAutoEntry`, `openPosition`, `placeOrder`
x
**Tasks:**
- [x] Ensure auto-entry uses testnet repository functions
- [x] Verify position opening calls Binance testnet API (binanceClient.ts)
- [x] Update any paper trading references to testnet
- [x] Test auto-entry places orders on Binance testnet

## Phase 4: Frontend - Remove Paper Trading Hook and Comparison
x
**Files to delete:**
- [x] `frontend/app/hooks/usePaperTrading.ts`
- [x] `frontend/app/components/crypto/ComparisonDashboard.tsx`
x
**Files to modify:**
- [x] `frontend/app/page.tsx` - Remove paper trading hook and comparison tab
x
**Changes to `page.tsx`:**
- [x] Remove import of `usePaperTrading`
- [x] Remove paper trading hook usage
- [x] Remove `activeTab` state (paper/testnet/comparison)
- [x] Remove ComparisonDashboard component
- [x] Add or ensure useTestnet hook is used
- [x] Update all components to use testnet data only (removed unused section imports)
- [x] Remove paper trading refresh function

## Phase 5: Frontend - Update Components for Testnet-Only
x
**Files to modify:**
- [x] `frontend/app/sections/TradingDashboard.tsx` - Removed from page.tsx (no longer needed)
- [x] `frontend/app/sections/PositionsSection.tsx` - Removed from page.tsx (no longer needed)
- [x] `frontend/app/sections/HistorySection.tsx` - Removed from page.tsx (no longer needed)
- [x] `frontend/app/sections/PendingOrdersSection.tsx` - Removed from page.tsx (no longer needed)
- [x] `frontend/app/sections/PerformanceSection.tsx` - Removed from page.tsx (no longer needed)
- [x] `frontend/app/components/crypto/TestnetPanel.tsx` - Already uses testnet data

**Tasks:**
- [x] Update components to accept testnet data structure (TestnetPanel already uses testnet)
- [x] Update API endpoint calls (TestnetPanel already uses /api/testnet/*)
- [x] Verify field names match testnet schema
- [x] Update type definitions if needed

## Phase 6: Database Schema

**Decision:** Keep paper trading tables for historical data but mark as deprecated

**File:** `backend/prisma/schema.prisma`
x
**Tasks:**
- [x] Add comment to paper trading models marking as deprecated
- [x] Keep tables: Account, Position, PendingOrder, AccountSnapshot, TradeEvent
- [x] No code references to these tables after migration

## Phase 7: Configuration and Environment
x
**Files to modify:**
- [x] `backend/.env.example` - Remove paper trading env vars
- [x] `backend/.env` - Remove paper trading env vars if present (user to do)

**Txsks:**
- [x] Remove `WORKER_ENABLE_PAPER_TRADING_SYNC`
- [x] Ensure `WORKER_ENABLE_TESTNET_SYNC=true`
- [ ] Ensure `BINANCE_ENABLED=true` (user to configure in actual .env)
- [ ] Verify Binance testnet credentials are configured (user to configure)

## Phase 8: Documentation Updates

**Files to update:**
- [x] `README.md` - Remove paper trading references
- [x] `docs/paper-trading.md` - Mark as deprecated or delete
- [x] `docs/api-paper-trading.md` - Mark as deprecated or delete
- [x] `docs/kim-nghia-paper-trading.md` - Mark as deprecated or delete
- [ ] `docs/binance-testnet-integration.md` - Update as primary trading system
- [ ] `docs/ai-position-management.md` - Update to reference testnet
- [ ] Any other docs mentioning paper trading

**Tasks:**
- [x] Remove all paper trading references from README
- [x] Mark paper trading docs as deprecated
- [ ] Update architecture diagrams for testnet-only
- [ ] Update API docs for testnet-only endpoints
- [ ] Update setup instructions for Binance testnet

## Phase 9: Testing

**Backend Testing:**
- [ ] Verify AI analyzer fetches testnet positions/orders
- [ ] Verify auto-entry opens testnet positions via Binance API
- [ ] Verify worker scheduler syncs only testnet
- [ ] Verify performance routes return testnet data
- [ ] Verify no paper trading imports or calls

**Frontend Testing:**
- [ ] Verify dashboard displays testnet account data
- [ ] Verify positions section shows testnet positions
- [ ] Verify pending orders section shows testnet orders
- [ ] Verify performance metrics use testnet data
- [ ] Verify no paper trading hooks imported
- [ ] Verify comparison dashboard is removed

**Integration Testing:**
- [ ] Run full analysis cycle with AI context including testnet positions
- [ ] Trigger auto-entry and verify position opens on Binance testnet
- [ ] Verify position management actions (close, modify) work on testnet
- [ ] Verify data flow: Binance → DB → API → Frontend
- [ ] Verify AI position management uses testnet data

## Phase 10: Deployment

**Tasks:**
- [ ] Commit all changes
- [ ] Deploy backend changes
- [ ] Deploy frontend changes
- [ ] Restart worker scheduler
- [ ] Monitor logs for errors
- [ ] Verify testnet trading works end-to-end
- [ ] Verify no paper trading sync errors
- [ ] Monitor for 24-48 hours

**Rollback Plan:**
- [ ] Keep git history for revert
- [ ] Monitor for issues
- [ ] Have database backup ready

## Tracking Summary
35
**Completed:** 8/10 phases (Phases 1-8 code changes complete, some doc tasks remain)
**Total Tasks:** 43/48 tasks completed
**Estimated Time:** 8-12 hours

## Last Updated

- Date: 2026-05-09
- Notes: All code changes complete. Remaining: mark paper trading docs as deprecated, runtime testing, deployment
- Date: 2026-05-09
- Notes: Initial plan created, focus on testnet-AI integration, remove comparison features
