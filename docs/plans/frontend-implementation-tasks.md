---

# 🛠 Frontend Task Breakdown
## For Windsurf Implementation

This section breaks the frontend plan into file-level tasks.

Agents must:
- follow the order strictly
- keep the current chart/account features
- add monitoring panels without removing trading UI
- request backend support only where needed
- avoid expanding scope beyond Big Update v3

---

## PHASE 1 — BASE DASHBOARD SHELL

### Goal
Create the main dashboard layout and shared UI structure.

### Frontend Tasks
- Update `frontend/app/page.tsx`
- Create shared section wrappers:
  - `frontend/app/components/SectionHeader.tsx`
  - `frontend/app/components/MetricCard.tsx`
  - `frontend/app/components/StatusBadge.tsx`
  - `frontend/app/components/EmptyState.tsx`
  - `frontend/app/components/LoadingSkeleton.tsx`

### UI Requirements
- Clean 3-column desktop layout
- Responsive mobile stacking
- Consistent spacing and section titles
- Global refresh state
- Auto-refresh indicator for live data

### Done When
- Main page renders all major dashboard zones
- Shared components are reusable across sections
- Layout works on desktop and mobile

---

## PHASE 2 — SYSTEM OVERVIEW SECTION

### Goal
Show whether the whole system is healthy, warmed up, or blocked.

### Frontend Tasks
- Create `frontend/app/sections/SystemOverview.tsx`
- Create `frontend/app/sections/SchedulerStatusPanel.tsx`
- Create `frontend/app/sections/CandleWarmupPanel.tsx`

### Data to Display
- worker status
- database status
- safety validation status
- BTC-only scope status
- scheduler status
- candle count
- warmup progress
- lock status

### Done When
- User can see system health at a glance
- User can tell whether the bot is ready or still warming up
- Statuses are visually clear and not hidden in logs

---

## PHASE 3 — MARKET VIEW

### Goal
Keep chart/indicator functionality and make it useful for trade inspection.

### Frontend Tasks
- Create `frontend/app/sections/MarketChartPanel.tsx`
- Create `frontend/app/sections/IndicatorPanel.tsx`
- Create `frontend/app/components/TimeframeSwitcher.tsx`
- Create `frontend/app/components/ChartToolbar.tsx`

### Market View Requirements
- Candlestick chart
- Volume panel
- Timeframe switcher
- Indicator overlays
- Setup annotations
- Entry / SL / TP markers
- Hover tooltip for candle details

### Done When
- User can inspect price action normally
- User can switch timeframe easily
- Setup markers and indicators are visible on chart

---

## PHASE 4 — TESTNET ACCOUNT CENTER

### Goal
Show testnet account health and trading state.

### Frontend Tasks
- Create `frontend/app/sections/TestnetBalancePanel.tsx`
- Create `frontend/app/sections/OpenPositionsPanel.tsx`
- Create `frontend/app/sections/ActiveOrdersPanel.tsx`
- Create `frontend/app/sections/TradeHistoryPanel.tsx`

### Data to Display
- total balance
- available balance
- equity
- margin usage
- realized pnl
- unrealized pnl
- open positions
- active orders
- filled orders
- closed trades

### Done When
- User can see account state without opening logs
- Positions and orders are readable and updated live
- Balance and PnL are easy to understand

---

## PHASE 5 — SIGNAL / RISK / NO-TRADE MONITORING

### Goal
Explain why the bot trades or does not trade.

### Frontend Tasks
- Create `frontend/app/sections/SignalGatePanel.tsx`
- Create `frontend/app/sections/NoTradeReasonsPanel.tsx`
- Create `frontend/app/sections/RiskEnginePanel.tsx`
- Create `frontend/app/components/ReasonChip.tsx`

### Data to Display
- signal grade
- confidence
- playbook
- regime
- pass / block state
- no-trade reasons
- daily loss cap
- max consecutive losses
- current lock state
- spread / slippage warnings

### Done When
- User can instantly see why a trade was blocked
- Risk state is always visible
- No-trade reasons are aggregated and not buried

---

## PHASE 6 — LLM / MEMORY / INTELLIGENCE

### Goal
Expose Groq usage and memory-based learning.

### Frontend Tasks
- Create `frontend/app/sections/LlmDispatchPanel.tsx`
- Create `frontend/app/sections/MemoryInsightsPanel.tsx`

### Data to Display
- last Groq call
- model name
- prompt version
- response status
- invalid JSON count
- no-trade count
- last 3 similar setups
- playbook winrate
- recurring failure patterns

### Done When
- User can see if LLM is being used efficiently
- Memory insights help explain repeated behavior
- Invalid or skipped LLM outputs are visible

---

## PHASE 7 — EVENT LOG / ACTIVITY FEED

### Goal
Show system activity in human-readable form.

### Frontend Tasks
- Create `frontend/app/sections/EventLogFeed.tsx`
- Create `frontend/app/components/EventLogItem.tsx`

### Data to Display
- safety validation events
- scheduler starts/stops
- candle save events
- signal gate decisions
- risk engine blocks
- LLM dispatch events
- position monitor actions

### Done When
- User can read recent system activity chronologically
- Logs are grouped by module and severity
- Errors and blocks are easy to spot

---

## PHASE 8 — GLOBAL STATE MANAGEMENT

### Goal
Make data refresh and state handling stable.

### Frontend Tasks
- Create or update:
  - `frontend/app/hooks/useDashboardSummary.ts`
  - `frontend/app/hooks/useMarketData.ts`
  - `frontend/app/hooks/useAccountData.ts`
  - `frontend/app/hooks/useIntelligenceData.ts`

### State Requirements
- loading state
- error state
- empty state
- polling state
- manual refresh state

### Done When
- Sections fetch data independently
- Errors do not break the whole page
- Refresh behavior is predictable

---

## PHASE 9 — BACKEND SUPPORT TASKS FOR FRONTEND

These tasks are only needed because the frontend needs stable data sources.

### Goal
Expose clean API endpoints that frontend panels can consume.

### Backend Tasks
- Update `backend/src/routes/`
- Add dashboard APIs for:
  - system summary
  - schedulers
  - signals
  - risk state
  - account data
  - orders
  - positions
  - trades
  - LLM stats
  - memory stats
  - event logs

### Recommended Endpoints
- `GET /api/dashboard/system`
- `GET /api/dashboard/schedulers`
- `GET /api/dashboard/scope`
- `GET /api/dashboard/signals`
- `GET /api/dashboard/risk`
- `GET /api/dashboard/llm`
- `GET /api/dashboard/memory`
- `GET /api/dashboard/events`
- `GET /api/account/balance`
- `GET /api/account/positions`
- `GET /api/account/orders`
- `GET /api/account/trades`
- `GET /api/market/candles`
- `GET /api/market/indicators`

### Backend Data Tasks
- Ensure candle history is queryable by symbol and timeframe
- Ensure orders and positions are queryable for testnet
- Ensure risk state is queryable
- Ensure scheduler status is available
- Ensure signal gate output is saved and queryable
- Ensure LLM call stats are saved and queryable

### Done When
- Every frontend panel has a backend source of truth
- No panel relies on guessed or duplicated data
- APIs return stable and consistent JSON

---

## PHASE 10 — UPDATE ORDER

### Strict Build Order
1. Base dashboard shell
2. System overview
3. Market view
4. Testnet account center
5. Signal / risk monitoring
6. LLM / memory panels
7. Event log feed
8. Backend API support
9. Final polish

### Do Not
- remove chart functionality
- hide account data behind logs
- merge unrelated concerns into one component
- build new trading features before monitoring is visible

---

## DEFINITION OF DONE

Frontend v3 is done when:

- chart and indicators still work
- testnet account data is visible
- system health is visible
- signal gate status is visible
- no-trade reasons are visible
- risk engine state is visible
- LLM usage is visible
- memory insights are visible
- event log is readable
- the whole system can be monitored from the UI without opening backend logs