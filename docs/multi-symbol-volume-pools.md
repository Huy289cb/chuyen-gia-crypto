# Multi-Symbol Volume Pools

**Status:** implemented on Binance demo/testnet  
**Current runtime:** `ENABLED_SYMBOLS=BTC,ETH,SOL`; market scan, LLM dispatch, pending-order lifecycle, price sync, and testnet sync use the enabled-symbol list.

This document is the source of truth for adding ETH and SOL alongside BTC without sharing one exposure bucket across all symbols.

## Principle

Each token must have its own **volume pool**:

```text
symbol pool = open position notional + blocking pending order notional
```

The pool is checked per symbol before placing new pending orders. A full BTC pool must not block ETH/SOL by itself, and an ETH/SOL pool must not consume BTC's BTC-specific headroom.

The current BTC pool is:

```text
BTC max pool: $2,000
```

The implementation computes exposure snapshots by `symbol` in `v3-entry-eligibility.service.ts` and now reads the cap from `config/symbol-policy.ts`. `MAX_TOTAL_EXPOSURE_USD` remains as the BTC-compatible fallback.

## Proposed Symbol Policy

Altcoins need wider SL and smaller notional pools because they wick harder and have lower effective liquidity than BTC.

| Symbol | Status | Max pool | Min SL | Min grade | Min confidence | Risk multiplier | Notes |
|--------|--------|----------|--------|-----------|----------------|-----------------|-------|
| BTC | active baseline | `$2,000` | `0.8%` | `A` | `0.75` | `1.00` | Current production baseline |
| ETH | active demo | `$1,200` | `1.2%` | `A` | `0.78` | `0.70` | More room than BTC, smaller pool |
| SOL | active demo, SOL-specific | `$700` | `2.0%` | `A` | `0.82` | `0.45` | Only `liquidity_sweep_reclaim`; breakout is blocked |

Initial rollout should prefer `A` only for all three symbols. Do not loosen ETH/SOL to grade B just because their pools are smaller.

## Correlation Guard

BTC, ETH, and SOL are highly correlated during broad market moves. Per-symbol pools are necessary but not sufficient.

An aggregate directional guard is enabled before order placement:

| Guard | Proposed value |
|-------|----------------|
| Max same-direction long exposure | `$2,500` |
| Max same-direction short exposure | `$2,500` |
| Third same-direction symbol | Allow only grade `A` and confidence above the symbol minimum by `+0.05` |
| Mixed long/short on same symbol | Block |

Example:

```text
BTC long $2,000 + ETH long $800 = $2,800
→ block SOL long unless override rule passes.
```

## Implemented Code Changes

1. Added `backend/src/config/symbol-policy.ts`.
2. Replaced global-only reads of `MAX_TOTAL_EXPOSURE_USD`, `MIN_SL_DISTANCE_PERCENT`, `MIN_SIGNAL_GRADE`, and `MIN_SIGNAL_CONFIDENCE` in entry/testbed paths with symbol-aware values.
3. Replaced hardcoded `['BTC']` in:
   - `src/schedulers/market-scan.scheduler.ts`
   - `src/schedulers/llm-dispatch.scheduler.ts`
   - `src/schedulers/pending-order.scheduler.ts`
4. Worker price sync now supports BTC, ETH, and SOL.
5. Protective SL/TP recompute and levels adapter use symbol-specific min SL.
6. Historical testbed defaults `notionalUsd` to the symbol max pool.
7. Added tests for symbol policy, correlation guard, trade execution, and SOL price fetch.
8. Added SOL symbol-policy playbook allowlist so SOL can run a different strategy from BTC/ETH.

## Testbed Sweeps To Run Next

Run 30d / 45d / 60d sweeps by symbol:
   - BTC: `0.006,0.008,0.010`
   - ETH: `0.010,0.012,0.015`
   - SOL: `0.014,0.016,0.020`

## Proposed Env Shape

Keep `ENABLED_SYMBOLS` as the rollout switch. Add per-symbol policy values instead of reusing one global cap for every token.

```env
ENABLED_SYMBOLS=BTC,ETH,SOL

SYMBOL_POLICY_BTC_MAX_EXPOSURE_USD=2000
SYMBOL_POLICY_BTC_MIN_SL_DISTANCE_PERCENT=0.008
SYMBOL_POLICY_BTC_MIN_SIGNAL_GRADE=A
SYMBOL_POLICY_BTC_MIN_SIGNAL_CONFIDENCE=0.75
SYMBOL_POLICY_BTC_RISK_MULTIPLIER=1.0

SYMBOL_POLICY_ETH_MAX_EXPOSURE_USD=1200
SYMBOL_POLICY_ETH_MIN_SL_DISTANCE_PERCENT=0.012
SYMBOL_POLICY_ETH_MIN_SIGNAL_GRADE=A
SYMBOL_POLICY_ETH_MIN_SIGNAL_CONFIDENCE=0.78
SYMBOL_POLICY_ETH_RISK_MULTIPLIER=0.7

SYMBOL_POLICY_SOL_MAX_EXPOSURE_USD=700
SYMBOL_POLICY_SOL_MIN_SL_DISTANCE_PERCENT=0.020
SYMBOL_POLICY_SOL_MIN_SIGNAL_GRADE=A
SYMBOL_POLICY_SOL_MIN_SIGNAL_CONFIDENCE=0.82
SYMBOL_POLICY_SOL_RISK_MULTIPLIER=0.45
SYMBOL_POLICY_SOL_ALLOWED_PLAYBOOKS=liquidity_sweep_reclaim

CORRELATION_MAX_LONG_EXPOSURE_USD=2500
CORRELATION_MAX_SHORT_EXPOSURE_USD=2500
```

The legacy globals should remain as fallback defaults while the migration is in progress.

## 30d Testbed Snapshot

Latest run on 2026-07-11, period 2026-06-11 → 2026-07-11, baseline env policy:

| Symbol | Pool notional | Min SL | Entries | Win rate | Net PnL | Max loss streak | Read |
|--------|---------------|--------|---------|----------|---------|-----------------|------|
| BTC | `$2,000` | `0.8%` | 27 | `33.3%` | `$-43.20` | not recorded in prior quick run | Needs stricter entry filtering |
| ETH | `$1,200` | `1.2%` | 31 | `45.2%` | `$+101.55` | 5 | Best candidate; longs and 15m carry edge |
| SOL old baseline | `$700` | `1.6%` | 38 | `23.7%` | `$-144.55` | 8 | Rejected; too much breakout noise |
| SOL new profile | `$700` | `2.0%` | 11 | `45.5%` | `$+23.84` | 2 | 30d, only `liquidity_sweep_reclaim` |

ETH breakdown worth preserving:

- `15m`: 10 trades, 70.0% WR, `+$148.85`.
- `5m`: 17 trades, 29.4% WR, `-$72.26`.
- Longs: 15 trades, 66.7% WR, `+$174.52`.
- Shorts: 16 trades, 25.0% WR, `-$72.97`.

SOL old baseline breakdown:

- `breakout_volume`: 33 trades, 21.2% WR, `-$153.07`.
- `liquidity_sweep_reclaim`: 5 trades, 40.0% WR, `+$8.52`.
- Both long and short sides are negative.

## SOL-Specific Strategy

SOL must not reuse BTC/ETH's broader breakout strategy. The optimized SOL profile from testbed is:

```env
SYMBOL_POLICY_SOL_MIN_SL_DISTANCE_PERCENT=0.020
SYMBOL_POLICY_SOL_ALLOWED_PLAYBOOKS=liquidity_sweep_reclaim
```

Why:

| Window | Strategy | Entries | Win rate | Net PnL | Max loss streak |
|--------|----------|---------|----------|---------|-----------------|
| 30d | baseline, SL 1.6%, all playbooks | 38 | `23.7%` | `$-144.55` | 8 |
| 30d | SL 2.0%, all playbooks | 28 | `28.6%` | `$-59.19` | 9 |
| 30d | SL 2.0%, cooldown | 23 | `34.8%` | `$+13.87` | 5 |
| 30d | SL 2.0%, only `liquidity_sweep_reclaim` | 11 | `45.5%` | `$+23.84` | 2 |
| 45d | SL 2.0%, cooldown | 48 | `39.6%` | `$+111.26` | 5 |
| 45d | SL 2.0%, only `liquidity_sweep_reclaim` | 19 | `57.9%` | `$+159.25` | 2 |
| 60d | SL 2.0%, cooldown | 54 | `38.9%` | `$+108.09` | 5 |
| 60d | SL 2.0%, only `liquidity_sweep_reclaim` | 23 | `56.5%` | `$+185.16` | 2 |

Decision:

- Use `liquidity_sweep_reclaim` only for SOL.
- Keep SOL pool at `$700`.
- Keep SOL risk multiplier at `0.45`.
- Do not enable SOL `breakout_volume` until a future 60d sweep shows positive expectancy.

## Rollout Notes

1. **BTC remains primary** with its `$2,000` pool.
2. ETH is acceptable for demo rollout with current `$1,200` pool.
3. SOL is enabled on demo/testnet with its own liquidity-sweep-only profile; do not increase pool/risk until live closes confirm the edge.
4. Revisit pool sizes only after at least 30 verified closes per symbol.

## Acceptance Criteria

Before enabling a new symbol:

- Testbed can load and replay that symbol for 30d and 60d.
- Net PnL is positive or near breakeven with max loss streak controlled.
- The symbol policy is visible in logs and Telegram `/show` or daily report.
- Protective SL/TP orders are confirmed for the symbol on Binance.
- The symbol's pool blocks new entries when open + pending reaches its cap.

Do not use ETH/SOL as a way to “average out” a weak BTC edge. Add them only when the symbol-specific gate and pool controls are working.
