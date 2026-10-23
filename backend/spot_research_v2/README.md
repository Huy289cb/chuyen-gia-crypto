# Offline Spot mechanism research v2

Two preregistered four-hour mechanisms, a separate15USDT cash ledger and exact fee/lot accounting. This package has no broker, Telegram or LLM client. It reuses only immutable `spot_backtest.models` and the pure fill ledger in `spot_backtest.account`; v1 strategies/results are unchanged.

Run from `backend` with Python3.10 standard library:

```sh
python3 -m unittest discover -s spot_research_v2/tests -v
python3 -m spot_research_v2.runner --protocol /home/ubuntu/binance-income-research-2026-10-10/spot-new-mechanisms-protocol.json --data-dir /home/ubuntu/binance-income-research-2026-10-10/new-model-data-clean --output-dir /home/ubuntu/binance-income-research-2026-10-10/backtest-run-v2 --mode qa
python3 -m spot_research_v2.runner --protocol /home/ubuntu/binance-income-research-2026-10-10/spot-new-mechanisms-protocol.json --data-dir /home/ubuntu/binance-income-research-2026-10-10/new-model-data-clean --output-dir /home/ubuntu/binance-income-research-2026-10-10/backtest-run-v2 --mode register
nice -n 10 python3 -m spot_research_v2.runner --protocol /home/ubuntu/binance-income-research-2026-10-10/spot-new-mechanisms-protocol.json --data-dir /home/ubuntu/binance-income-research-2026-10-10/new-model-data-clean --output-dir /home/ubuntu/binance-income-research-2026-10-10/backtest-run-v2 --mode full
```

Fullrun refuses a second attempt and verifies frozen protocol/source/dataset identity. Tests and developmentQA are required before registration. `report.py` is presentation-only and separately pinned. Raw archive timestamps are explicitly ms before2025, µs thereafter; missing candles fail rather than being invented. April2023 warmup/development; Jan2024–Sep2025 one continuous portfolio, Jan2025 onward confirmation. This is a retrospective screen after observing2026v1; it cannot establish prospective return.

Trend has no finite TP: its4ATR cost hurdle is never an exit. Trailing changes apply at the first minuteopen after closed4h; model exits delay30/120s, existing stops remain active. Reversion freezes the preceding20bar mean as target. Prior5completed1m WAP is a conditional filter proxy only. Fees/filter/slippage are scenarios, not reconstructed historical exchange receipts. Partial inventory stays owned and is shown in book and executable marks separately. Unknown VPS costs are not zero.
