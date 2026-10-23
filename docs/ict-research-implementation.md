# ICT economic gate, H1 structure and continuation research

Implementation: `backend/src/utils/ict-research.ts`. This pure module has no environment, exchange, database, AI or execution imports. It is used by the offline chronological runner, not enabled in the live scheduler. Owner BTC/1h/10%/3% risk settings remain unchanged.

## Economic admission

`evaluateIctTargetEconomics` computes signed gross reward at target, subtracts entry and exit commissions on their respective notionals, round-trip slippage on entry notional, funding reserve and AI cost. Inputs must be finite; negative/unknown costs fail closed. A target must have strictly positive net reward to pass. Passing is not an expected-value or win-probability claim.

The current experiment uses commission0.05% per side, slippage0.2%, explicit zero AI cost because it makes no AI calls, and zero funding reserve only for this admission diagnostic. Actual historical funding remains charged in the replay. This filter therefore does not promise a positive settlement result if funding costs exceed its reward. Entry/SL/TP are never changed by this function.

## Causal H1 permission

`buildIctH1Structure` uses strict fractal pivots with two bars on each side. A pivot is available only after its confirming bar closes. The first close crossing a fresh confirmed high/low establishes long/short permission and protects the most recent confirmed opposite swing. Repeated breaks of the same pivot do not create a fresh event.

A close through the protected swing immediately clears permission, without waiting for two new right-hand bars. This event is transition, not an automatic opposite permission on the same bar. A new confirmed close-break is needed to establish direction again. Wick-only breaks do not invalidate this close-based rule. This is the project's explicit research definition, not a claim to implement every ICT interpretation.

`ictStructureAt` exposes only states known at the requested timestamp and rejects stale context beyond one hour. `ictStructurePermits` checks the full interval, so a pending plan cannot regain permission merely because H1 later realigns after a prior invalidation.

## M15 continuation lane

`buildIctContinuationCandidates` requires:

1. Close crossing a previously confirmed M15 swing and displacement body at least the preceding14-bar ATR.
2. H1 permission aligned at the displacement close and throughout the following confirmation candle.
3. A three-candle FVG around the displacement; it becomes known only when the third candle closes. No protected M15 swing violation during the impulse/confirmation.
4. Midpoint limit entry, with stop beyond the protected M15 swing by one tick or the0.8% floor, whichever is farther. Tick rounding preserves the floor.
5. Nearest still-unswept confirmed M15/H1/H4 opposing target. Higher-timeframe consumption is known only after that timeframe's candle closes. A missing target is explicit and cannot be admitted.

One plan is produced per qualifying BOS pivot. Entry latency, TTL, wallet, exposure, funding, fees and execution-risk cap are handled by the existing portfolio replay, not by the detector. There are no market orders or external side effects in candidate generation.

## Fixed experiment variants

| Variant | Candidates | Economic gate | H1 interval gate |
|---|---|---|---|
| `edge_baseline` | Previous sweep→MSS→FVG edge model | Off | Off |
| `sweep_cost` | Same sweep plans | On | Off |
| `sweep_h1` | Same sweep plans | Off | On |
| `sweep_cost_h1` | Same sweep plans | On | On |
| `continuation_cost_h1` | New continuation midpoint plans | On | On |
| `combined_cost_h1` | Both lanes, common wallet | On | On |

The combined lane gives sweep priority at the same confirmation time. It never selects a plan using future outcomes. It shares one pending order/position, the budget and cooldown. The H1 gate is checked at candidate admission, while pending, and again at fill; target economics uses the actual proposed quantity at admission/fill.

## Running and verifying

From `backend`, run `npm run research:ict`. It reads the frozen20-month dataset windows and candidate artifacts referenced by `docs/audits/2026-09-20-ict-implementation/protocol.json`, checks hashes and owner-policy parity, and writes results only to that audit directory. It requires the already-present research datasets and the same risk configuration as the parent run; it fails rather than silently changing policy.

The runner checks H1 and continuation prefix invariance on each dataset, replays six variants under base/stress costs and records each trade/decision. The baseline must reproduce parent results before deltas are interpreted. All four windows have already been inspected; this is development/revalidation, not untouched OOS.

Relevant checks:

```bash
npx vitest run tests/unit/ict-research.test.ts tests/unit/opportunity-portfolio.test.ts tests/unit/opportunity-accounting-parity.test.ts --maxWorkers=1 --minWorkers=1
npx tsc --noEmit
```

Tests cover net target costs, short-side fees, unknown-cost rejection, immediate protected-level invalidation, stale/missing H1, pending invalidation, long/short continuation, the third-candle rule, prefix invariance and still-forming H1 target consumption.

No promotion is automatic. Profitable development results still require independent evidence, sufficient incremental trades and execution validation under the existing risk policy.
