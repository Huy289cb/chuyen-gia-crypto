#!/usr/bin/env python3
"""Re-check the 23/10 macro-momentum claim against daily-source.csv.

The published book fills a stop at entry*(1-stop) even when the only price
in the file, the daily close, is worse. This check reproduces that book,
then repeats it filling those stops at the observed close.
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
    dates = []
    prices = []
    for row in rows[1:]:
        dates.append(row[0])
        day = {}
        for index, symbol in enumerate(symbols):
            raw = row[index + 1].strip()
            if raw:
                value = float(raw)
                if value > 0:
                    day[symbol] = value
        prices.append(day)
    return dates, symbols, prices


def run(dates, symbols, prices, stop_mode: str, rebalance=3, stop=0.05, alloc=35.0):
    cash = 100.0
    held = []
    since = 0
    metrics = []
    phantom = 0.0
    stops = 0

    def equity(px):
        unrealized = 0.0
        for symbol, entry, qty in held:
            unrealized += (px.get(symbol, entry) - entry) * qty
        return cash + unrealized

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
                capped = entry * (1 - stop)
                exit_price = capped if stop_mode == "cap" else min(close, capped)
                phantom += (capped - close) * qty
                stops += 1
                cash += (exit_price - entry) * qty - exit_price * qty * FEE
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
            past = prices[index - 14]
            scores = []
            for symbol in symbols:
                if symbol in today and symbol in past:
                    scores.append(((today[symbol] - past[symbol]) / past[symbol], symbol))
            scores.sort(reverse=True)
            for score, symbol in scores:
                if score <= 0.02:
                    break
                cash -= alloc * FEE
                held.append((symbol, today[symbol], alloc / today[symbol]))
                if len(held) == 2:
                    break
    final = equity(prices[-1])
    net = final - 100.0
    return {
        "days": len(metrics),
        "net": net,
        "mean": net / len(metrics),
        "worst": min(metrics),
        "breaches": sum(1 for value in metrics if value <= -12.0),
        "phantom": phantom,
        "stops": stops,
    }


def main():
    dates, symbols, prices = load()
    published = run(dates, symbols, prices, "cap")
    observed = run(dates, symbols, prices, "close")
    assert published["days"] == 1485
    assert abs(published["net"] - 668.6708916499458) < 0.01
    assert abs(published["worst"] - -11.449703292401125) < 0.001
    assert published["breaches"] == 0
    assert abs(published["phantom"] - 408.319) < 0.5
    assert observed["mean"] < 0.20
    assert observed["worst"] < -12.0
    assert observed["breaches"] >= 1
    print(
        "published_cap_fill "
        f"net={published['net']:.4f} mean={published['mean']:.4f} "
        f"worst={published['worst']:.4f} breaches={published['breaches']} "
        f"phantom={published['phantom']:.2f} stops={published['stops']}"
    )
    print(
        "observed_close_fill "
        f"net={observed['net']:.4f} mean={observed['mean']:.4f} "
        f"worst={observed['worst']:.4f} breaches={observed['breaches']}"
    )
    print("VERDICT FAIL_NOT_DEPLOYABLE")


if __name__ == "__main__":
    main()
