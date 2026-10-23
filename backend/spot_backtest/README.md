# Offline Spot backtest

This package tests the locked `spot-half-capital-breakout-retest-v1` rule with
15 USDT. It does not import the production bot, read account credentials, send
Telegram messages, call models, transfer funds or place exchange orders.

`features.py` is the canonical causal candidate generator; `account.py` owns the
Decimal cash/coin ledger. A future paper worker must use these same interfaces
or validate an equivalent port. `runner.py` uses streaming official Spot bars,
one account April–September, and conservative execution assumptions. Python's
standard library keeps this process small on the existing VPS.

Run from `/home/ubuntu/chuyen-gia-crypto/backend`:

```bash
PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover -s spot_backtest/tests -v
nice -n 10 python3 -m spot_backtest.dataset --protocol /home/ubuntu/binance-income-research-2026-10-10/spot-half-capital-backtest-protocol.json --data-dir /home/ubuntu/binance-income-research-2026-10-10/backtest-data --download --verify
```

The completed dataset is pinned in its manifest. Do not replace an archive or
checksum silently. Independent aggregation QA is in
`backtest-data/aggregation-validation.json`.

Use `spot_backtest.runner` with `--protocol`, `--data-dir`, `--output-dir` and
`--mode qa`, then `--mode register`, then `--mode full`. Registration requires
matching development QA and pins protocol/data/core source and test hashes.
It refuses a second full attempt in the same output directory. The full run is
finite: one process, six preregistered base/stress/filter/partial cases and two
secondary September standalone cases. Do not sweep settings after seeing PnL.

Use `python3 -m spot_backtest.report --output-dir RUN_DIRECTORY` after execution
finishes. Exchange net PnL includes fees, slip, rounding and dust. Infrastructure
costs and unarchived historical filter/reference prices are not known; the
conditional five-minute volume-weighted reference is only a scenario proxy.
Book NAV and immediately executable NAV are reported separately. Historical
model calls are zero; this replay cannot establish an LLM selection advantage.

The immutable original design can still say `NOT_EXECUTED`: execution status
belongs to the registered run's `execution.json`, not a rewritten protocol.
