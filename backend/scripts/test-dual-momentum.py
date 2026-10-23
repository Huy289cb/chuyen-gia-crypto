#!/usr/bin/env python3
"""
Test Dual Momentum (Macro Momentum + BTC Trend Filter)
Evaluated strictly under Cursor's OBSERVED CLOSE exit rule (no phantom stop fills).

Rules:
1. BTC Trend Filter:
   - Calculate BTC 20-day and 50-day SMA.
   - If BTC < SMA(20) (Bear/Crash regime): Stay in 100% CASH. (Avoids market crashes like FTX 2022-11-08).
   - If BTC >= SMA(20) (Bull/Expansion regime): Select Top 2 coins by 14-day momentum.
2. Allocations: Test $35/coin ($70 total) and $40/coin ($80 total).
3. Exit rule: Evaluated strictly at OBSERVED CLOSE (Cursor's worst-case execution).
"""

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

def run_dual_momentum(dates, symbols, prices, btc_sma_period=20, rebalance=3, stop=0.05, alloc=35.0, stop_mode="close"):
    cash = 100.0
    held = []
    since = 0
    metrics = []
    stops = 0

    def equity(px):
        unrealized = 0.0
        for symbol, entry, qty in held:
            unrealized += (px.get(symbol, entry) - entry) * qty
        return cash + unrealized

    start_idx = max(55, btc_sma_period + 5)

    for index in range(start_idx, len(prices)):
        today = prices[index]
        start = equity(prices[index - 1])

        # 1. Check BTC Trend Filter
        btc_past = [prices[index - k].get("BTCUSDT", 0) for k in range(btc_sma_period)]
        btc_sma = sum(btc_past) / btc_sma_period if btc_past and all(p > 0 for p in btc_past) else 0
        btc_today = today.get("BTCUSDT", 0)
        market_bullish = btc_today >= btc_sma if btc_sma > 0 else True

        # 2. Check Stop Loss on held positions (evaluated at observed close)
        surviving = []
        for symbol, entry, qty in held:
            if symbol not in today:
                surviving.append((symbol, entry, qty))
                continue
            close = today[symbol]
            ret = (close - entry) / entry
            if ret <= -stop:
                stops += 1
                exit_price = entry * (1 - stop) if stop_mode == "cap" else close
                cash += (exit_price - entry) * qty - exit_price * qty * FEE
            else:
                surviving.append((symbol, entry, qty))
        held = surviving

        # 3. Check Daily Circuit Breaker (-12u)
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

        # 4. Rebalance / Trend Filter Action
        since += 1
        if not market_bullish:
            # Bear regime: Close all positions to 100% Cash
            for symbol, entry, qty in held:
                exit_price = today.get(symbol, entry)
                cash += (exit_price - entry) * qty - exit_price * qty * FEE
            held = []
            since = 0
        elif since >= rebalance and not fired:
            since = 0
            # Close old
            for symbol, entry, qty in held:
                exit_price = today.get(symbol, entry)
                cash += (exit_price - entry) * qty - exit_price * qty * FEE
            held = []

            # Rank momentum (14 days)
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
        "stops": stops,
    }

def main():
    dates, symbols, prices = load()
    print("==========================================================================================")
    print("    DUAL MOMENTUM SWEEP: STRICT OBSERVED CLOSE (CURSOR-COMPLIANT, ZERO PHANTOM)          ")
    print("==========================================================================================")

    results = []
    for btc_period in [0, 20, 50]:
        for alloc in [25.0, 30.0, 35.0, 40.0]:
            for reb in [2, 3, 5]:
                for sl in [0.05, 0.08, 0.12]:
                    res = run_dual_momentum(dates, symbols, prices, btc_sma_period=btc_period, rebalance=reb, stop=sl, alloc=alloc, stop_mode="close")
                    results.append((res, btc_period, alloc, reb, sl))

    # Sort by Mean Daily PnL descending
    results.sort(key=lambda x: x[0]["mean"], reverse=True)
    for res, btc_period, alloc, reb, sl in results[:20]:
        print(
            f"BTC_SMA={btc_period:2d}d | Alloc=${alloc:2.0f}x2 | Reb={reb}d | SL={sl*100:2.0f}% => "
            f"Net=+{res['net']:6.1f}u | Mean=+{res['mean']:.4f}u/d | "
            f"Worst={res['worst']:6.2f}u | Breaches={res['breaches']} | Stops={res['stops']}"
        )

if __name__ == "__main__":
    main()
