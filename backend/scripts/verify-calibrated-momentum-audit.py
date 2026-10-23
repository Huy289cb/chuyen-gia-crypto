#!/usr/bin/env python3
"""Audit the calibrated $25 x 2, 12% stop, 2-day book in commit c75aa27.

The published close-fill cell reproduces. The full 1,485-day mean stays
below 0.20 USDT/day. The worst day is the 2022-11-08 loss of the $35 book
scaled by 25/35; the 12% stop does not bind on it. The registered source
reads prices two days before execution, and that lagged book is lower.
"""

from __future__ import annotations

import csv
from pathlib import Path

CSV = Path(__file__).resolve().parents[1] / "tests/fixtures/cct-source-projection/daily-source.csv"
FEE = 0.0007


def load():
    with CSV.open() as handle:
        rows = list(csv.reader(handle))
    symbols = rows[0][1:]
    prices = []
    for row in rows[1:]:
        day = {}
        for index, symbol in enumerate(symbols):
            raw = row[index + 1].strip()
            if raw:
                value = float(raw)
                if value > 0:
                    day[symbol] = value
        prices.append(day)
    return symbols, prices


def run(symbols, prices, lag=0, rebalance=2, stop=0.12, alloc=25.0):
    cash = 100.0
    held = []
    since = 0
    metrics = []

    def equity(px):
        return cash + sum((px.get(symbol, entry) - entry) * qty for symbol, entry, qty in held)

    for index in range(15, len(prices)):
        today = prices[index]
        start = equity(prices[index - 1])
        surviving = []
        for symbol, entry, qty in held:
            if symbol not in today:
                surviving.append((symbol, entry, qty))
                continue
            close = today[symbol]
            if (close - entry) / entry <= -stop:
                cash += (close - entry) * qty - close * qty * FEE
            else:
                surviving.append((symbol, entry, qty))
        held = surviving
        equity_now = equity(today)
        day_pnl = equity_now - start
        fired = day_pnl <= -12.0
        if fired:
            for symbol, entry, qty in held:
                exit_price = today.get(symbol, entry)
                cash += (exit_price - entry) * qty - exit_price * qty * FEE
            held = []
            equity_now = equity(today)
            day_pnl = equity_now - start
        metrics.append(day_pnl)
        since += 1
        if since >= rebalance and not fired:
            since = 0
            for symbol, entry, qty in held:
                exit_price = today.get(symbol, entry)
                cash += (exit_price - entry) * qty - exit_price * qty * FEE
            held = []
            signal = index - lag
            past = signal - 14
            if past < 0:
                continue
            scores = []
            for symbol in symbols:
                if symbol in prices[signal] and symbol in prices[past] and symbol in today:
                    scores.append(((prices[signal][symbol] - prices[past][symbol]) / prices[past][symbol], symbol))
            scores.sort(reverse=True)
            picked = 0
            for score, symbol in scores:
                if score <= 0.02:
                    break
                cash -= alloc * FEE
                held.append((symbol, today[symbol], alloc / today[symbol]))
                picked += 1
                if picked == 2:
                    break
    net = equity(prices[-1]) - 100.0
    worst = min(metrics)
    return net, net / len(metrics), worst, sum(value <= -12.0 for value in metrics)


def main():
    symbols, prices = load()
    net, mean, worst, breaches = run(symbols, prices)
    old_worst = run(symbols, prices, rebalance=3, stop=0.05, alloc=35.0)[2]
    lagged_net, lagged_mean, lagged_worst, lagged_breaches = run(symbols, prices, lag=2)
    assert abs(net - 253.83522264475306) < 0.01
    assert abs(worst - -11.739239144681477) < 1e-9
    assert breaches == 0
    assert abs(worst - old_worst * (25.0 / 35.0)) < 1e-9
    assert mean < 0.20
    assert lagged_mean < 0.12
    print(
        f"published_cell net={net:.4f} mean={mean:.4f} worst={worst:.4f} breaches={breaches}"
    )
    print(
        f"same_crash_scaled_from_35u old_worst={old_worst:.4f} scaled={old_worst * 25 / 35:.4f}"
    )
    print(
        f"source_lag_2d net={lagged_net:.4f} mean={lagged_mean:.4f} "
        f"worst={lagged_worst:.4f} breaches={lagged_breaches}"
    )
    print("VERDICT FULL_SAMPLE_MISSES_0_20")


if __name__ == "__main__":
    main()
