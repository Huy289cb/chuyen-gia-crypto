#!/usr/bin/env python3
"""
PHASE 2 DEEP DIVE: YEAR-BY-YEAR PnL BREAKDOWN & HYBRID SLEEVE VERIFICATION

1. Detailed breakdown of Macro Momentum ($25x2, SL 12%, Reb 2d) year by year:
   - 2022, 2023, 2024, 2025, 2026.
2. Investigate Sleeve 2 candidates on daily data:
   - Can we add a low-beta carry / mean-reversion sleeve on BTC that adds >= +0.035 USDT/day
     WITHOUT pushing the worst day below -12.0 USDT?
3. Hourly Data Architecture Testbed:
   - Tests hourly execution with exchange conditional stops on real Binance OHLCV.
"""

from __future__ import annotations
import csv
from pathlib import Path

CSV = Path(__file__).resolve().parents[1] / "tests/fixtures/cct-source-projection/daily-source.csv"
FEE_TAKER = 0.0007

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

def analyze_yearly_momentum():
    dates, symbols, prices = load()
    cash = 100.0
    held = []
    since = 0

    def equity(px):
        return cash + sum((px.get(sym, entry) - entry) * qty for sym, entry, qty in held)

    yearly_data = {}  # year -> list of daily PnLs

    for index in range(15, len(prices)):
        today = prices[index]
        date_str = dates[index]
        year = date_str[:4]
        if year not in yearly_data:
            yearly_data[year] = {"daily_pnls": [], "trades": 0, "stops": 0}

        start_eq = equity(prices[index - 1])

        # Evaluate stops at observed close
        surviving = []
        for sym, entry, qty in held:
            if sym not in today:
                surviving.append((sym, entry, qty))
                continue
            close = today[sym]
            ret = (close - entry) / entry
            if ret <= -0.12:
                cash += (close - entry) * qty - close * qty * FEE_TAKER
                yearly_data[year]["stops"] += 1
            else:
                surviving.append((sym, entry, qty))
        held = surviving

        eq_now = equity(today)
        day_pnl = eq_now - start_eq
        fired = day_pnl <= -12.0
        if fired:
            for sym, entry, qty in held:
                exit_p = today.get(sym, entry)
                cash += (exit_p - entry) * qty - exit_p * qty * FEE_TAKER
            held = []
            eq_now = equity(today)
            day_pnl = eq_now - start_eq

        since += 1
        if since >= 2 and not fired:
            since = 0
            for sym, entry, qty in held:
                exit_p = today.get(sym, entry)
                cash += (exit_p - entry) * qty - exit_p * qty * FEE_TAKER
            held = []

            past = prices[index - 14]
            scores = []
            for sym in symbols:
                if sym in today and sym in past:
                    scores.append(((today[sym] - past[sym]) / past[sym], sym))
            scores.sort(reverse=True)

            for score, sym in scores:
                if score <= 0.02:
                    break
                alloc = 25.0
                cash -= alloc * FEE_TAKER
                held.append((sym, today[sym], alloc / today[sym]))
                yearly_data[year]["trades"] += 1
                if len(held) == 2:
                    break

        # End of day equity after all fills and fees
        end_eq = equity(today)
        day_pnl = end_eq - start_eq
        yearly_data[year]["daily_pnls"].append((date_str, day_pnl))

    print("==========================================================================================")
    print("                     YEAR-BY-YEAR DETAILED MOMENTUM BREAKDOWN ($25x2)                     ")
    print("==========================================================================================")
    total_net = 0.0
    total_days = 0
    all_worst = 0.0
    total_breaches = 0

    for yr in sorted(yearly_data.keys()):
        pnls = [p for _, p in yearly_data[yr]["daily_pnls"]]
        net_yr = sum(pnls)
        days_yr = len(pnls)
        mean_yr = net_yr / days_yr if days_yr else 0
        worst_yr = min(pnls) if pnls else 0
        worst_date = min(yearly_data[yr]["daily_pnls"], key=lambda x: x[1])[0] if pnls else "N/A"
        breaches_yr = sum(1 for p in pnls if p <= -12.0)

        total_net += net_yr
        total_days += days_yr
        if worst_yr < all_worst:
            all_worst = worst_yr
        total_breaches += breaches_yr

        print(f"Year {yr} ({days_yr:3d} days): Net=+{net_yr:6.2f}u | Mean=+{mean_yr:.4f}u/d (+{mean_yr*365:5.1f}%/yr) | Worst={worst_yr:6.2f}u on {worst_date} | Breaches={breaches_yr}")

    print("-" * 90)
    full_mean = total_net / total_days
    print(f"Full Period ({total_days} days): Net=+{total_net:6.2f}u | Mean=+{full_mean:.4f}u/d (+{full_mean*365:.1f}%/yr) | Worst={all_worst:6.2f}u | Breaches={total_breaches}")

if __name__ == "__main__":
    analyze_yearly_momentum()
