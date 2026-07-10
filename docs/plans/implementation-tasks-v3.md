# 🛠 Implementation Tasks — Windsurf Execution Guide

## 🎯 Goal

This document translates the Big Update Plan into **exact file-level tasks**.

Agents must:
- Follow order strictly
- Not skip steps
- Not expand scope

---

# 🧱 PHASE 1 — SIGNAL GATE LAYER

## Files to Create

### 1. analyzers
- `backend/src/analyzers/setup-gate.analyzer.ts`
- `backend/src/analyzers/liquidity-sweep.analyzer.ts`
- `backend/src/analyzers/breakout-volume.analyzer.ts`
- `backend/src/analyzers/market-regime.analyzer.ts`

### 2. service
- `backend/src/services/signal-gate.service.ts`

---

## Responsibilities

### setup-gate.analyzer
- Combine all conditions
- Output:
  - playbookKey
  - grade (A/B/C/D)
  - confidence
  - regime

### liquidity-sweep.analyzer
- Detect:
  - sweep high + rejection
  - sweep low + reclaim

### breakout-volume.analyzer
- Detect breakout with volume confirmation

### market-regime.analyzer
- Detect:
  - trend
  - range
  - chop

---

## Done When

- System can classify:
  - valid setup
  - invalid setup
- Each signal has grade + reason

---

# 🧱 PHASE 2 — RISK ENGINE

## Files to Create

- `backend/src/services/risk-manager.service.ts`
- `backend/src/config/risk-policy.ts`

---

## Responsibilities

### risk-manager.service

Must implement:

- canOpenTrade()
- calculatePositionSize()
- checkDailyLossLimit()
- checkConsecutiveLosses()
- applyExecutionCostFilter()

---

## Rules

Block trade if:

- grade < A
- confidence too low
- daily loss exceeded
- too many consecutive losses
- spread/slippage too high

---

## Done When

- System can reject trades EVEN if signal exists

---

# 🧠 PHASE 3 — MEMORY SYSTEM

## Files to Create

- `backend/src/services/memory.service.ts`
- `backend/src/repositories/trade.repository.ts`
- `backend/src/repositories/memory.repository.ts`

---

## Responsibilities

### memory.service

- storeSignal()
- storeDecision()
- storeOutcome()
- storeReflection()
- buildContextForLLM()

---

## Database

Must use:

- trade_decisions
- trade_outcomes
- trade_reflections
- playbook_stats

---

## Done When

- Every decision is logged
- System can fetch past similar trades

---

# 🤖 PHASE 4 — GROQ LAYER

## Files to Update

- `backend/src/lib/groq-client.ts`

## Files to Create

- `backend/src/services/groq-dispatch.service.ts`

---

## Responsibilities

- Only accept structured JSON
- Validate response strictly
- Retry max 1
- Fallback → NO_TRADE

---

## Rules

DO NOT call Groq if:
- signal is not A-grade
- duplicate candle
- risk engine blocks trade

---

## Done When

- No invalid JSON reaches execution
- No accidental trade from bad response

---

# ⏱ PHASE 5 — SCHEDULERS

## Files to Create

- `backend/src/schedulers/market-scan.scheduler.ts`
- `backend/src/schedulers/llm-dispatch.scheduler.ts`
- `backend/src/schedulers/position-monitor.scheduler.ts`

---

## Responsibilities

### market-scan
- Fetch market data
- Run signal gate
- Store snapshot

### llm-dispatch
- Only process valid signals
- Call Groq
- Save decision

### position-monitor
- Manage open positions
- Apply HOLD / REDUCE / EXIT

---

## Done When

- Pipelines are separated
- No direct scan → trade shortcut exists

---

# 📊 PHASE 6 — POSITION MANAGEMENT

## Files to Create

- `backend/src/services/position-management.service.ts`
- `backend/src/analyzers/position-health.analyzer.ts`

---

## Rules

Allowed actions:

- HOLD
- REDUCE
- EXIT

---

## Remove

- aggressive reverse
- noisy SL changes

---

## Done When

- System behaves predictably
- No over-management

---

# 📊 PHASE 7 — BACKEND API

## Files to Update

- `backend/src/routes/`

---

## Add Endpoints

- `/metrics/risk`
- `/metrics/playbooks`
- `/metrics/no-trade`
- `/metrics/costs`

---

## Done When

- All system states are queryable

---

# 🖥 PHASE 8 — FRONTEND

## Files to Create

- `frontend/app/sections/RiskDashboard`
- `frontend/app/sections/SetupPerformance`
- `frontend/app/sections/NoTradeReasons`
- `frontend/app/sections/ExecutionCostPanel`
- `frontend/app/sections/MemoryInsights`

---

## Requirements

UI must show:

- trade allowed or not
- signal grade
- reason for skipping trade
- cost impact

---

## Done When

- User can understand system behavior without logs

---

# 🔄 PHASE 9 — INTEGRATION ORDER

## Strict Order

1. Signal Gate
2. Risk Engine
3. Memory
4. Groq Dispatch
5. Schedulers
6. Position Management
7. API
8. Frontend

---

## DO NOT

- Skip phases
- Mix responsibilities
- Call Groq early
- Enable auto-trading before risk engine

---

# ✅ FINAL CHECKLIST

System is ready when:

- Trades are rare
- Trades are high quality
- Groq usage is low
- Risk limits always respected
- Memory influences decisions
- UI explains everything clearly