#!/usr/bin/env python3
"""
PHASE 2 DEEP QUANTITATIVE EXPERIMENT:
Testing 4 Potential Improvements to Verify if They Are Truly Optimal:
1. Break-Even Stop (Move SL to entry when profit >= +3%, +5%, +7%, +10%)
2. Trailing Stop (Trail behind peak by 5%, 8%, 10%)
3. Sleeve 2 BTC Grid Tuning (Step size 1.5%, 2.0%, 2.5%; TP 2.5%, 3.0%, 4.0%; Max levels 2 vs 3)
4. Rebalance Cycle (1-day vs 2-day vs 3-day)
"""

from __future__ import annotations
import csv
from pathlib import Path

CSV = Path(__file__).resolve().parents[1] / "tests/fixtures/cct-source-projection/daily-source.csv"
FEE_TAKER = 0.0007
FEE_MAKER = 0.0002

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

def run_experiment(
    dates, symbols, prices,
    mom_alloc=25.0,
    mom_lookback=14,
    mom_stop=0.12,
    mom_reb=2,
    be_trigger=None,       # e.g. 0.05 for +5% break-even trigger
    trailing_dist=None,    # e.g. 0.08 for 8% trailing stop
    grid_ticket=15.0,
    grid_max_levels=3,
    grid_step_pct=0.02,
    grid_tp_pct=0.03,
    btc_crash_gate_pct=0.06,
):
    cash = 100.0
    # held_mom: list of dicts {sym, entry, qty, peak, sl}
    held_mom = []
    # held_grid: list of dicts {entry, qty, tp_price}
    held_grid = []
    since_reb = 0
    daily_pnls = []
    btc_prices = [p.get("BTCUSDT", 0.0) for p in prices]

    def equity(px):
        unrl = 0.0
        for m in held_mom:
            unrl += (px.get(m["sym"], m["entry"]) - m["entry"]) * m["qty"]
        btc_p = px.get("BTCUSDT", 0.0)
        for g in held_grid:
            if btc_p > 0:
                unrl += (btc_p - g["entry"]) * g["qty"]
        return cash + unrl

    for idx in range(15, len(prices)):
        today = prices[idx]
        yesterday = prices[idx - 1]
        start_eq = equity(yesterday)

        btc_today = today.get("BTCUSDT", 0.0)
        btc_yesterday = yesterday.get("BTCUSDT", 0.0)
        btc_1d_ret = (btc_today - btc_yesterday) / btc_yesterday if btc_yesterday > 0 else 0.0

        # 1. Update peaks & break-even / trailing stops for momentum
        surviving_mom = []
        for m in held_mom:
            sym = m["sym"]
            if sym not in today:
                surviving_mom.append(m)
                continue
            close = today[sym]
            if close > m["peak"]:
                m["peak"] = close

            # Update Break-Even stop
            if be_trigger is not None:
                if (m["peak"] - m["entry"]) / m["entry"] >= be_trigger:
                    m["sl"] = max(m["sl"], m["entry"] * (1.0 + FEE_TAKER * 2))

            # Update Trailing stop
            if trailing_dist is not None:
                trail_sl = m["peak"] * (1.0 - trailing_dist)
                m["sl"] = max(m["sl"], trail_sl)

            # Evaluate stop
            if close <= m["sl"]:
                cash += (close - m["entry"]) * m["qty"] - close * m["qty"] * FEE_TAKER
            else:
                surviving_mom.append(m)
        held_mom = surviving_mom

        # 2. Evaluate Grid Take Profits
        surviving_grid = []
        for g in held_grid:
            if btc_today >= g["tp_price"]:
                cash += (g["tp_price"] - g["entry"]) * g["qty"] - g["tp_price"] * g["qty"] * FEE_MAKER
            else:
                surviving_grid.append(g)
        held_grid = surviving_grid

        # 3. Daily circuit breaker check
        mid_eq = equity(today)
        if mid_eq - start_eq <= -12.0:
            for m in held_mom:
                exit_p = today.get(m["sym"], m["entry"])
                cash += (exit_p - m["entry"]) * m["qty"] - exit_p * m["qty"] * FEE_TAKER
            held_mom = []
            for g in held_grid:
                if btc_today > 0:
                    cash += (btc_today - g["entry"]) * g["qty"] - btc_today * g["qty"] * FEE_TAKER
            held_grid = []

        # 4. Momentum Rebalance
        since_reb += 1
        if since_reb >= mom_reb:
            since_reb = 0
            for m in held_mom:
                exit_p = today.get(m["sym"], m["entry"])
                cash += (exit_p - m["entry"]) * m["qty"] - exit_p * m["qty"] * FEE_TAKER
            held_mom = []

            past = prices[idx - mom_lookback]
            scores = []
            for sym in symbols:
                if sym in today and sym in past:
                    scores.append(((today[sym] - past[sym]) / past[sym], sym))
            scores.sort(reverse=True)

            for score, sym in scores:
                if score <= 0.02:
                    break
                p_entry = today[sym]
                qty = mom_alloc / p_entry
                cash -= mom_alloc * FEE_TAKER
                held_mom.append({
                    "sym": sym,
                    "entry": p_entry,
                    "qty": qty,
                    "peak": p_entry,
                    "sl": p_entry * (1.0 - mom_stop),
                })
                if len(held_mom) == 2:
                    break

        # 5. BTC Grid Entry
        if len(held_grid) < grid_max_levels and btc_1d_ret >= -btc_crash_gate_pct:
            btc_window = [p for p in btc_prices[idx-10:idx] if p > 0]
            if len(btc_window) >= 8 and btc_today > 0:
                btc_ema = sum(btc_window) / len(btc_window)
                lvl = len(held_grid) + 1
                target_dip_price = btc_ema * (1.0 - lvl * grid_step_pct)
                if btc_today <= target_dip_price:
                    cash -= grid_ticket * FEE_MAKER
                    qty = grid_ticket / btc_today
                    tp_price = btc_today * (1.0 + grid_tp_pct)
                    held_grid.append({
                        "entry": btc_today,
                        "qty": qty,
                        "tp_price": tp_price,
                    })

        end_eq = equity(today)
        daily_pnls.append(end_eq - start_eq)

    net_pnl = equity(prices[-1]) - 100.0
    mean_daily = net_pnl / len(daily_pnls)
    worst_day = min(daily_pnls)
    breakers = sum(1 for p in daily_pnls if p <= -12.0)
    recent_512 = daily_pnls[-512:]
    recent_512_net = sum(recent_512)
    recent_512_mean = recent_512_net / 512

    return {
        "net_pnl": net_pnl,
        "mean_daily": mean_daily,
        "worst_day": worst_day,
        "breakers": breakers,
        "512_net": recent_512_net,
        "512_mean": recent_512_mean,
    }

def main():
    dates, symbols, prices = load()
    print("=" * 85)
    print("      QUANTITATIVE EXPERIMENT: VALIDATING POTENTIAL IMPROVEMENTS")
    print("=" * 85)

    # 1. Baseline
    base = run_experiment(dates, symbols, prices)
    print(f"\n[BASELINE Phase 2 Hybrid] (Fixed SL 12%, Reb 2d, BTC Grid 3 lvl)")
    print(f"  Net: +{base['net_pnl']:.2f}u | Mean: +{base['mean_daily']:.4f}u/d | Worst: {base['worst_day']:.2f}u | Breakers: {base['breakers']} | 512d: +{base['512_net']:.2f}u (+{base['512_mean']:.4f}u/d)")

    # 2. Testing Break-Even Stop triggers: +3%, +5%, +7%, +10%
    print("\n--- TEST 1: BREAK-EVEN STOP EXPERIMENT ---")
    for be in [0.03, 0.05, 0.07, 0.10]:
        res = run_experiment(dates, symbols, prices, be_trigger=be)
        diff = res['net_pnl'] - base['net_pnl']
        status = "BETTER" if diff > 0 else "WORSE"
        print(f"  BE Trigger +{be*100:.0f}%: Net={res['net_pnl']:+6.2f}u (Diff {diff:+6.2f}u, {status}) | Mean={res['mean_daily']:+.4f}u/d | Worst={res['worst_day']:.2f}u | Breakers={res['breakers']}")

    # 3. Testing Trailing Stop: 5%, 8%, 10%
    print("\n--- TEST 2: TRAILING STOP EXPERIMENT ---")
    for tr in [0.05, 0.08, 0.10, 0.12]:
        res = run_experiment(dates, symbols, prices, trailing_dist=tr)
        diff = res['net_pnl'] - base['net_pnl']
        status = "BETTER" if diff > 0 else "WORSE"
        print(f"  Trailing {tr*100:.0f}%: Net={res['net_pnl']:+6.2f}u (Diff {diff:+6.2f}u, {status}) | Mean={res['mean_daily']:+.4f}u/d | Worst={res['worst_day']:.2f}u | Breakers={res['breakers']}")

    # 4. Testing Rebalance Periods: 1d, 2d, 3d, 4d
    print("\n--- TEST 3: REBALANCE CADENCE EXPERIMENT ---")
    for reb in [1, 2, 3, 4]:
        res = run_experiment(dates, symbols, prices, mom_reb=reb)
        diff = res['net_pnl'] - base['net_pnl']
        print(f"  Rebalance {reb}d: Net={res['net_pnl']:+6.2f}u (Diff {diff:+6.2f}u) | Mean={res['mean_daily']:+.4f}u/d | Worst={res['worst_day']:.2f}u | Breakers={res['breakers']}")

    # 5. Testing BTC Grid Take Profit: 2%, 3%, 4%, 5%
    print("\n--- TEST 4: BTC GRID TAKE PROFIT EXPERIMENT ---")
    for tp in [0.02, 0.025, 0.03, 0.035, 0.04]:
        res = run_experiment(dates, symbols, prices, grid_tp_pct=tp)
        diff = res['net_pnl'] - base['net_pnl']
        print(f"  Grid TP {tp*100:.1f}%: Net={res['net_pnl']:+6.2f}u (Diff {diff:+6.2f}u) | Mean={res['mean_daily']:+.4f}u/d | Worst={res['worst_day']:.2f}u")

    print("\n" + "=" * 85)

if __name__ == "__main__":
    main()
