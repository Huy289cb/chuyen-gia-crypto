# Historical Testbed (Walk-Forward Backtest)

Offline replay of the **deterministic** parts of the V3 pipeline on Binance Futures OHLCV. No LLM calls, no DB writes, no orders on the exchange.

The CLI supports `--symbol`, so it can test BTC/ETH/SOL data. Runtime symbol policy is documented in [multi-symbol-volume-pools.md](./multi-symbol-volume-pools.md).

## What it simulates

```
Historical candles (5m / 15m / 1h)
  → Signal Gate (same code as production)
  → Regime + HTF trend guard (V3_REQUIRE_HTF_TREND, V3_HTF_TREND_ALT)
  → Rule-based entry: close price + policy SL/TP (computePolicyCompliantStopAndTarget)
  → SL/TP fill on subsequent 5m bar high/low
```

## What it does NOT simulate

| Gap | Why |
|-----|-----|
| LLM confirm/veto | Expensive; use live testnet for that layer |
| Limit order partial fill / TTL | Assumes fill at signal bar close |
| Cooldown / exposure cap | Testbed variant `cooldown` simulates tiered loss-streak pause |
| Funding fees | Optional flat fee per side only |

Use this to compare **SL distance**, **TF priority**, and **gate pass rate** before changing production config.

## Commands

```bash
cd backend

# Default: 3 weeks BTC, current .env policy
npm run backtest:historical

# 30 days (~4.3w)
npm run backtest:historical -- --weeks=4.3

# Anti-overfit windows: run separately and compare reports
npm run backtest:historical -- --weeks=2
npm run backtest:historical -- --weeks=3
npm run backtest:historical -- --weeks=4.3
npm run backtest:historical -- --weeks=6

# Compare min SL 0.40% vs 0.50% vs 0.60%
npm run backtest:historical -- --weeks=3 --sl-sweep=0.004,0.005,0.006

# Multi-symbol SL sweeps
npm run backtest:historical -- --symbol=BTC --weeks=4.3 --sl-sweep=0.006,0.008,0.010
npm run backtest:historical -- --symbol=ETH --weeks=4.3 --sl-sweep=0.010,0.012,0.015
npm run backtest:historical -- --symbol=SOL --weeks=4.3 --sl-sweep=0.016,0.020,0.024

# SOL optimized profile check
npm run backtest:historical -- --symbol=SOL --days=60 --min-sl=0.020 --variant=only-liquidity-sweep

# JSON output for scripts
npm run backtest:historical -- --weeks=4.3 --json > /tmp/testbed.json
```

Requires network access to Binance Futures API (same as `v3:backfill-ohlcv`).

## Output metrics

- **Gate pass cycles** — how often signal gate passes (before HTF/regime block)
- **Entries / W-L / net PnL** — after simulation
- **Blocks** — `signal_gate`, `regime`, `htf`, `no_direction`, `duplicate_signal`, `open_position`
- **SL buckets** — PnL grouped by SL distance (`0.40-0.50%`, etc.)
- **Trades** — entry time, side, timeframe, SL distance, close reason, PnL

Planned diagnostics: breakdown by timeframe, playbookKey, grade, side, UTC day/week, plus rule variants such as grade-A-only and cooldown.

## Example use: test SL hypothesis

After seeing live losses cluster at 0.40% SL:

```bash
npm run backtest:historical -- --weeks=4 --sl-sweep=0.004,0.005,0.006
```

If `0.50%` improves net PnL with acceptable trade count, consider `MIN_SL_DISTANCE_PERCENT=0.005` for 5m only (production change).

## Code layout

| File | Role |
|------|------|
| `src/backtest/historical-testbed.service.ts` | Walk-forward engine |
| `src/backtest/candle-loader.ts` | Binance OHLCV load |
| `src/backtest/signal-direction.ts` | Long/short from playbook |
| `src/backtest/position-simulator.ts` | SL/TP on bars |
| `scripts/run-historical-testbed.ts` | CLI |

## Env

Uses the same `.env` as production for:

- `V3_SIGNAL_GATE_TIMEFRAMES`
- `V3_ENTRY_TF_PRIORITY`
- `V3_REQUIRE_HTF_TREND` / `V3_HTF_TREND_ALT`
- `MIN_SIGNAL_GRADE` / `MIN_SIGNAL_CONFIDENCE`
- `MIN_SL_DISTANCE_PERCENT` (overridable via CLI sweep)

## Multi-Symbol Acceptance

Before enabling ETH or SOL in live runtime:

- Run 30d and 60d testbeds per symbol.
- Use wider altcoin SL sweeps than BTC.
- Compare max loss streak, not only net PnL.
- Confirm that each symbol's proposed pool is small enough for its observed drawdown.

Suggested first-pass policies:

| Symbol | SL sweep | Proposed pool |
|--------|----------|---------------|
| BTC | `0.006,0.008,0.010` | `$2,000` |
| ETH | `0.010,0.012,0.015` | `$1,200` |
| SOL | `0.016,0.020,0.024`; optimized `0.020` + `only-liquidity-sweep` | `$700` |
