# Historical Testbed (Walk-Forward Backtest)

Offline replay of the **deterministic** parts of the V3 pipeline on 2–4 weeks of Binance Futures OHLCV. No LLM calls, no DB writes, no orders on the exchange.

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
| Cooldown / exposure cap | Can be added in v2 |
| Funding fees | Optional flat fee per side only |

Use this to compare **SL distance**, **TF priority**, and **gate pass rate** before changing production config.

## Commands

```bash
cd backend

# Default: 3 weeks BTC, current .env policy
npm run backtest:historical

# 4 weeks
npm run backtest:historical -- --weeks=4

# Compare min SL 0.40% vs 0.50% vs 0.60%
npm run backtest:historical -- --weeks=3 --sl-sweep=0.004,0.005,0.006

# JSON output for scripts
npm run backtest:historical -- --weeks=3 --json > /tmp/testbed.json
```

Requires network access to Binance Futures API (same as `v3:backfill-ohlcv`).

## Output metrics

- **Gate pass cycles** — how often signal gate passes (before HTF/regime block)
- **Entries / W-L / net PnL** — after simulation
- **Blocks** — `signal_gate`, `regime`, `htf`, `no_direction`, `open_position`
- **SL buckets** — PnL grouped by SL distance (`0.40-0.50%`, etc.)

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
