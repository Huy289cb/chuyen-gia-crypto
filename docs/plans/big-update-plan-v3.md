# 🚀 Big Update Plan v3 — Cost-Aware, Low-Frequency, High-Quality Trading System

## 🎯 Core Philosophy

This system is redesigned for:

- Small capital survival & growth
- Minimal trading frequency
- Maximum trade quality (A+ setups only)
- Strict risk control
- Reduced LLM dependency (Groq free tier optimized)

> ❗ The goal is NOT to trade more.  
> ✅ The goal is to trade LESS — but BETTER.

---

## 🧱 System Architecture (New)

We refactor the system into 4 main layers:

### 1. Signal Gate (No LLM)
Cheap, deterministic filters to detect valid setups.

### 2. Risk Engine (Hard Gate)
Controls whether a trade is allowed at all.

### 3. LLM Decision Layer (Groq)
Used ONLY when signal passes strict conditions.

### 4. Memory Layer
Stores past decisions, failures, and lessons.

---

## 📉 Key Strategic Changes

| Old System | New System |
|------|--------|
| Frequent signals | Rare signals (A+ only) |
| LLM used often | LLM used selectively |
| Static risk | Dynamic + capped risk |
| No memory learning | Memory-driven decisions |
| Multi-strategy | Single playbook focus |

---

## 🥇 Phase 1 — Strategy Simplification

### Objective
Focus on ONE market and ONE playbook.

### Scope
- Primary: BTCUSDT Perpetual
- Disable auto-trading for ETH (analysis only)

### Allowed Playbooks (max 2)
1. Liquidity Sweep + Reclaim
2. Breakout + Volume Confirmation

### Remove / Disable
- Multi-timeframe auto-entry spam
- Weak signals
- Low confidence trades

### Implementation

**backend/src/analyzers/**
- `setup-gate.analyzer.ts`
- `liquidity-sweep.analyzer.ts`
- `breakout-volume.analyzer.ts`
- `market-regime.analyzer.ts`

**Rules**
- No setup → No LLM → No trade
- Setup must be labeled: `A / B / C`
- Only A-grade allowed to proceed

---

## 🚫 Phase 2 — Signal Gate Before LLM

### Objective
Reduce Groq usage by 70–90%

### New Flow
Market Scan → Signal Gate → (IF PASS) → Call Groq → Trade Decision

### Conditions to Call Groq
- Valid playbook detected
- Market regime not "choppy"
- Liquidity/volume confirmed
- No duplicate signal (same candle)

### Implementation

**backend/src/services/**
- `signal-gate.service.ts`
- `llm-dispatch.service.ts`
- `candle-hash.service.ts`

**backend/src/schedulers/**
- `market-scan.scheduler.ts`
- `llm-dispatch.scheduler.ts`
- `position-monitor.scheduler.ts`

**Cache Strategy**
key = symbol + timeframe + candleHash + regime


### Groq Safety

**backend/src/lib/groq-client.ts**
- Add strict JSON schema validation
- Retry max: 1
- If fail → return `NO_TRADE`

---

## 💰 Phase 3 — Hard Risk Engine (CRITICAL)

### Objective
Prevent account death.

### New Risk Rules

#### 1. Risk per Trade
- Very low (e.g. 0.5% – 1%)

#### 2. Daily Loss Cap
- Stop trading after X% loss/day

#### 3. Max Consecutive Losses
- After 2–3 losses → reduce size or stop

#### 4. Fee + Slippage Protection
- Skip trade if cost too high

#### 5. Volatility-Based Position Sizing
- Smaller size in high volatility

---

### Implementation

**backend/src/services/**
- `risk-manager.service.ts`

Functions:
- `canOpenTrade()`
- `calculatePositionSize()`
- `checkDailyLossLimit()`
- `checkConsecutiveLosses()`
- `applyExecutionCostFilter()`

---

### Database Changes

Add tables:
risk_events
daily_stats
execution_costs
---

### Trade Blocking Conditions

Trade is BLOCKED if:

- Daily loss limit hit
- Too many consecutive losses
- Spread/slippage too high
- Signal < A grade

---

## 🧠 Phase 4 — Decision Memory System

Inspired by TradingAgents but simplified.

### Objective
Stop repeating mistakes.

---

### What to Store

#### trade_decisions
- setup type
- entry reason
- confidence
- no-trade reason (if skipped)

#### trade_outcomes
- win/loss
- RR achieved
- execution cost

#### trade_reflections
- what went wrong
- what worked

#### playbook_stats
- winrate per setup
- avg RR
- failure patterns

---

### Implementation

**backend/src/services/**
- `memory.service.ts`

Functions:
- `storeDecision()`
- `storeOutcome()`
- `generateReflection()`
- `getRelevantMemoryContext()`

---

### LLM Context Injection

When calling Groq, include ONLY:

- Last 3 similar trades
- Last 2 failures
- Current winrate of playbook

> ❗ DO NOT inject full history

---

## 🔄 Phase 5 — Position Management (Simplified)

### Objective
Reduce over-management.

---

### Allowed Actions

- HOLD
- REDUCE
- EXIT

---

### Remove / Limit

- ❌ Aggressive reverse
- ❌ Over-frequent SL movement
- ❌ Noise-based decisions

---

### Implementation

**backend/src/services/**
- `position-management.service.ts`

**backend/src/analyzers/**
- `position-health.analyzer.ts`

---

### Rules

- Only manage when:
  - Position is in profit OR
  - Market structure changed

- Reverse ONLY if:
  - New valid setup exists

---

## 📊 Phase 6 — Observability & Dashboard

### Objective
Answer critical questions:

- Should the bot trade right now?
- Why did it skip trades?
- Which setup works best?
- Are fees killing profits?

---

### Backend APIs

**backend/src/routes/**
- `/metrics/risk`
- `/metrics/playbooks`
- `/metrics/no-trade`
- `/metrics/costs`

---

### Frontend Panels

**frontend/app/sections/**

- `RiskDashboard`
- `SetupPerformance`
- `NoTradeReasons`
- `ExecutionCostPanel`
- `MemoryInsights`

---

### UI Indicators

- Trade Allowed: ✅ / ❌
- Signal Grade: A / B / C
- Market Regime: Trend / Chop
- Cost Warning: ⚠️

---

## ⚙️ Phase 7 — Groq Optimization

### Objective
Fit free-tier usage.

---

### Strategy

- Call Groq only on:
  - New A+ setups
  - Active position management

- Cache responses per candle

- Use:
  - Short prompts
  - Structured output only

---

### Expected Reduction

- ❌ Old: call every 15 min
- ✅ New: call only on valid signals

---

## ❌ Explicitly NOT Doing (for now)

- ❌ No migration to Go
- ❌ No mainnet trading
- ❌ No multi-strategy expansion
- ❌ No high-frequency trading
- ❌ No over-optimization

---

## ✅ Success Criteria

System is considered successful if:

- Trade frequency ↓ significantly
- Winrate ↑
- Drawdown ↓
- LLM usage ↓
- Fees impact ↓
- Equity curve smoother

---

## 🧭 Final Principle

> "The best trade is the one you DON'T take."

This system should become:

- Selective
- Defensive
- Cost-aware
- Memory-driven

NOT:

- Reactive
- Over-trading
- LLM-dependent

---

## 🚀 Next Step

After this system is stable and profitable on testnet:

→ THEN consider:
- Scaling capital
- Multi-market expansion
- Mainnet deployment

NOT BEFORE.

---

# 🧭 Implementation Plan for Windsurf

## Execution Rules

1. Do not expand the scope.
2. Do not migrate to Go.
3. Do not add new strategies before the core system is stable.
4. Prioritize risk control and trade quality over trade frequency.
5. Prefer deterministic rules before LLM calls.
6. Every change must reduce cost, reduce noise, or improve survival.

---

## Workstream 1 — Strategy Narrowing

### Goal
Reduce the system to one main market and one main playbook at a time.

### Tasks
- Keep BTCUSDT as the primary live/test symbol.
- Disable auto-trading for secondary markets unless explicitly enabled later.
- Reduce strategy set to:
  - Liquidity Sweep + Reclaim
  - Breakout + Volume Confirmation
- Remove weak or redundant entry conditions.
- Replace multi-signal behavior with strict A-grade setup filtering.

### Done When
- The bot only trades when the selected playbook is clearly detected.
- Weak or ambiguous signals are filtered out before LLM usage.

---

## Workstream 2 — Signal Gate First, LLM Second

### Goal
Make the system call Groq only for high-quality setups.

### Tasks
- Add a deterministic signal gate before any LLM request.
- Require candle structure, regime, volume, and setup confirmation first.
- Skip LLM calls for repeated candles or duplicate signals.
- Add a strict no-trade path for setup failures.
- Make signal quality grading explicit: A, B, C, D.

### Done When
- Most weak signals never reach Groq.
- Groq is only used for confirmed, high-quality setups.
- Duplicate LLM requests are eliminated or heavily reduced.

---

## Workstream 3 — Hard Risk Engine

### Goal
Protect the account from overtrading and drawdown spirals.

### Tasks
- Enforce max risk per trade.
- Add daily loss cap.
- Add max consecutive losses cap.
- Add execution-cost filters for spread, fee, and slippage.
- Add volatility-based position sizing.
- Block trades when risk rules are violated.
- Add a clear lockout state when trading must stop for the day.

### Done When
- The bot can refuse trading even when a signal exists.
- Risk rules are enforced automatically and consistently.
- Trading stops after a bad streak or daily loss threshold.

---

## Workstream 4 — Memory and Learning Layer

### Goal
Let the system learn from previous decisions without becoming noisy or overcomplicated.

### Tasks
- Store every decision with its setup, grade, confidence, and reason.
- Store trade outcomes and post-trade reflections.
- Track playbook performance by symbol and regime.
- Keep only short, relevant memory context for LLM prompts.
- Surface recurring failure patterns in the dashboard.

### Done When
- The bot can explain why it traded or skipped a trade.
- The next decision can reuse only the most relevant prior lessons.
- Repeated mistakes become visible in statistics.

---

## Workstream 5 — Position Management Simplification

### Goal
Make open-position management more disciplined and less reactive.

### Tasks
- Limit position actions to:
  - HOLD
  - REDUCE
  - EXIT
- Avoid aggressive reverse behavior unless a new setup is fully confirmed.
- Add stale-trade and invalidation-based exit logic.
- Prefer profit protection over “smart” repositioning.
- Reduce unnecessary management calls.

### Done When
- Position management is simple and predictable.
- The bot exits or reduces only when there is a strong reason.
- Reverse actions are rare and strictly justified.

---

## Workstream 6 — Observability and UI

### Goal
Make the system easy to audit and easy to trust.

### Tasks
- Add risk state visibility.
- Add setup grade and no-trade reason visibility.
- Add execution cost panels.
- Add playbook performance stats.
- Add memory insights for recent trades.
- Show whether the bot is currently allowed to open new trades.

### Done When
- The dashboard clearly explains what the bot is doing.
- User can see why a trade was skipped.
- The cost of trading is visible, not hidden.

---

## Workstream 7 — Groq Usage Optimization

### Goal
Make free-tier Groq usage sustainable.

### Tasks
- Reduce prompt size.
- Use structured output only.
- Cache by candle state, symbol, timeframe, and regime.
- Avoid repeated requests for the same setup.
- Return no-trade on invalid or malformed model output.
- Call the model only when the signal gate says the setup is worth it.

### Done When
- Groq usage is low and intentional.
- LLM failures do not create accidental trades.
- Prompt cost is no longer a bottleneck.

---

## Implementation Order

### Step 1
Lock strategy scope and remove broad, noisy behavior.

### Step 2
Build the signal gate and duplicate-signal suppression.

### Step 3
Add the hard risk engine and lockout rules.

### Step 4
Add memory tables and decision tracking.

### Step 5
Simplify position management.

### Step 6
Expose all major states in the UI.

### Step 7
Optimize Groq usage and prompt quality.

---

## Priority Matrix

### Must Do First
- Strategy narrowing
- Signal gate
- Risk engine

### Should Do Next
- Memory layer
- Position management simplification

### Can Do After Stabilization
- Dashboard improvements
- Prompt refinement
- Extra analytics

---

## Acceptance Criteria

The update is successful only if all of the following are true:

- The bot trades less often.
- The bot uses Groq less often.
- Trade quality improves.
- Execution cost becomes visible and controlled.
- Daily loss is capped.
- Consecutive-loss behavior is controlled.
- Memory helps future decisions.
- The UI explains bot behavior clearly.

---

## Final Principle

If a trade is not good enough to survive the risk engine, it should not reach the LLM.

If a trade is not good enough after the LLM, it should not reach execution.

If execution cost is too high, the trade should not happen at all.
---

## 📂 Detailed Implementation Tasks

For step-by-step execution, see:

➡️ `docs/plans/implementation-tasks-v3.md`

This file contains:
- File-level breakdown
- Service responsibilities
- Scheduler responsibilities
- Integration order
- Definition of done per component

Windsurf agents MUST follow that file for implementation.