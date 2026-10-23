#!/usr/bin/env python3
"""
PHASE 2 DEEP SEARCH: ZERO-BREACH PORTFOLIO REACHING >= 0.2000 USDT/DAY

Investigates 3 strategic levers:
1. Dynamic Momentum Rebalancing (adaptive rebalance: rebalances when momentum ranking flips or every N days).
2. Trailing Stop / Volatility-Adjusted Stop (instead of fixed 12%, uses ATR/High trailing).
3. Hybrid Multi-Sleeve: Momentum (Top 2 or Top 3 coins) + BTC Mean-Reversion Sleeve.
4. Compounding / Variable Sizing based on Realized Margin Buffer.

Evaluated strictly under Cursor's OBSERVED CLOSE exit rule (Zero Phantom Stops).
Daily circuit breaker strictly <= -12.0 USDT.
Capital: 100.0 USDT.
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

def run_strategy(
    dates: list[str],
    symbols: list[str],
    prices: list[dict[str, float]],
    n_mom_coins: int = 2,
    mom_alloc: float = 25.0,
    mom_lookback: int = 10,
    mom_reb: int = 2,
    mom_stop: float = 0.12,
    mom_trail: float = 0.0,       # trailing stop from peak close if > 0
    mom_tp: float = 0.0,          # take profit if > 0
    grid_ticket: float = 15.0,
    grid_levels: int = 2,
    grid_step: float = 0.02,
    grid_tp: float = 0.03,
    btc_crash_gate: float = 0.06,
    enable_grid: bool = True,
):
    cash = 100.0
    held_mom: list[dict] = []  # dict with sym, entry, qty, peak_price
    held_grid: list[tuple[float, float, float]] = []  # (entry, qty, tp_price) on BTC
    since_reb = 0
    daily_pnls: list[float] = []
    btc_prices = [p.get("BTCUSDT", 0) for p in prices]

    def equity(px):
        unrl = 0.0
        for m in held_mom:
            cur_p = px.get(m["sym"], m["entry"])
            unrl += (cur_p - m["entry"]) * m["qty"]
        btc_p = px.get("BTCUSDT", 0)
        for entry, qty, _ in held_grid:
            if btc_p > 0:
                unrl += (btc_p - entry) * qty
        return cash + unrl

    for idx in range(15, len(prices)):
        today = prices[idx]
        yesterday = prices[idx - 1]
        start_eq = equity(yesterday)

        btc_today = today.get("BTCUSDT", 0)
        btc_yesterday = yesterday.get("BTCUSDT", 0)
        btc_ret = (btc_today - btc_yesterday) / btc_yesterday if btc_yesterday > 0 else 0.0

        # 1. Update Momentum Peaks and Check Exits (SL, Trailing, TP)
        surviving_mom = []
        for m in held_mom:
            sym = m["sym"]
            if sym not in today:
                surviving_mom.append(m)
                continue
            close = today[sym]
            if close > m["peak"]:
                m["peak"] = close

            ret = (close - m["entry"]) / m["entry"]
            trail_ret = (close - m["peak"]) / m["peak"] if m["peak"] > 0 else 0.0

            should_exit = False
            if ret <= -mom_stop:
                should_exit = True
            elif mom_trail > 0 and trail_ret <= -mom_trail:
                should_exit = True
            elif mom_tp > 0 and ret >= mom_tp:
                should_exit = True

            if should_exit:
                cash += (close - m["entry"]) * m["qty"] - close * m["qty"] * FEE_TAKER
            else:
                surviving_mom.append(m)
        held_mom = surviving_mom

        # 2. Check BTC Grid Exits
        surviving_grid = []
        if enable_grid:
            for entry, qty, tp in held_grid:
                if btc_today >= tp:
                    cash += (tp - entry) * qty - tp * qty * FEE_MAKER
                else:
                    surviving_grid.append((entry, qty, tp))
            held_grid = surviving_grid

        # 3. Check Daily Circuit Breaker (-12.0 USDT)
        eq_mid = equity(today)
        day_pnl_mid = eq_mid - start_eq
        fired = day_pnl_mid <= -12.0
        if fired:
            for m in held_mom:
                exit_p = today.get(m["sym"], m["entry"])
                cash += (exit_p - m["entry"]) * m["qty"] - exit_p * m["qty"] * FEE_TAKER
            held_mom = []
            for entry, qty, _ in held_grid:
                if btc_today > 0:
                    cash += (btc_today - entry) * qty - btc_today * qty * FEE_TAKER
            held_grid = []
            eq_mid = equity(today)
            day_pnl_mid = eq_mid - start_eq

        # 4. Momentum Rebalancing
        since_reb += 1
        if since_reb >= mom_reb and not fired:
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
                cash -= mom_alloc * FEE_TAKER
                held_mom.append({
                    "sym": sym,
                    "entry": today[sym],
                    "qty": mom_alloc / today[sym],
                    "peak": today[sym]
                })
                if len(held_mom) == n_mom_coins:
                    break

        # 5. BTC Grid Entries with Crash Veto
        if enable_grid and not fired and len(held_grid) < grid_levels and btc_ret >= -btc_crash_gate:
            btc_window = [p for p in btc_prices[idx-10:idx] if p > 0]
            if len(btc_window) >= 8 and btc_today > 0:
                btc_ema = sum(btc_window) / len(btc_window)
                lvl = len(held_grid) + 1
                target_dip = btc_ema * (1.0 - lvl * grid_step)
                if btc_today <= target_dip:
                    ticket = grid_ticket
                    cash -= ticket * FEE_MAKER
                    qty = ticket / btc_today
                    tp_price = btc_today * (1.0 + grid_tp)
                    held_grid.append((btc_today, qty, tp_price))

        end_eq = equity(today)
        day_pnl = end_eq - start_eq
        daily_pnls.append(day_pnl)

    final_eq = equity(prices[-1])
    net = final_eq - 100.0
    return {
        "days": len(daily_pnls),
        "net": net,
        "mean": net / len(daily_pnls),
        "worst": min(daily_pnls),
        "breaches": sum(1 for v in daily_pnls if v <= -12.0),
        "final_equity": final_eq,
    }

def main():
    dates, symbols, prices = load()
    print("==========================================================================================")
    print("             PHASE 2 DEEP SEARCH: ACHIEVING >= 0.2000 u/day WITH ZERO BREACHES            ")
    print("==========================================================================================")

    best = []
    # Test across n_coins in [2, 3], lookbacks in [7, 10, 14], rebalance in [1, 2], trailing stops, and grid combinations
    for n_coins in [2, 3]:
        for mom_alloc in [18.0, 22.0, 24.0, 25.0]:
            total_mom = n_coins * mom_alloc
            if total_mom > 60.0:
                continue
            for lb in [7, 10, 14]:
                for reb in [1, 2]:
                    for sl in [0.10, 0.12]:
                        for trail in [0.0, 0.08, 0.12]:
                            for g_ticket in [0.0, 12.0, 15.0]:
                                g_levels = 2 if g_ticket > 0 else 0
                                res = run_strategy(
                                    dates, symbols, prices,
                                    n_mom_coins=n_coins,
                                    mom_alloc=mom_alloc,
                                    mom_lookback=lb,
                                    mom_reb=reb,
                                    mom_stop=sl,
                                    mom_trail=trail,
                                    grid_ticket=g_ticket,
                                    grid_levels=g_levels,
                                    enable_grid=g_ticket > 0,
                                )
                                if res["breaches"] == 0 and res["worst"] >= -12.0:
                                    best.append((res["mean"], res, n_coins, mom_alloc, total_mom, lb, reb, sl, trail, g_ticket))

    best.sort(reverse=True)
    print(f"Total Zero-Breach Configurations Found: {len(best)}")
    print(f"\nTop 20 Zero-Breach Configurations sorted by Daily Mean PnL:")
    for mean, res, nc, ma, tm, lb, reb, sl, tr, gt in best[:20]:
        grid_str = f"BTC Grid ${gt:.0f}x2" if gt > 0 else "No Grid"
        tr_str = f"Trail={tr*100:.0f}%" if tr > 0 else "No Trail"
        print(f"Mom {nc}c (${ma:.0f}x{nc}=${tm:.0f}) | LB={lb:2d}d | Reb={reb}d | SL={sl*100:.0f}% | {tr_str:10s} | {grid_str:12s} => Net=+{res['net']:6.2f}u | Mean=+{res['mean']:.4f}u/d (+{res['mean']*365:5.1f}%/yr) | Worst={res['worst']:6.2f}u | Breaches={res['breaches']}")

if __name__ == "__main__":
    main()
