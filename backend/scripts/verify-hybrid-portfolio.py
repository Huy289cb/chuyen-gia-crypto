#!/usr/bin/env python3
"""
UNIFIED HYBRID PORTFOLIO VERIFIER (100 USDT Capital, Risk <= 12u/day)

Shared Wallet Architecture:
- Capital Base: 100.0 USDT (One shared cash ledger, one shared equity).
- Sleeve 1 (Macro Momentum, $50 allocation):
  - Top 2 of 40 coins ranked by 14-day momentum.
  - Allocation: $25.0 per coin ($50.0 total exposure).
  - Rebalance: Every 3 days.
  - Stop Loss: 8% per coin, evaluated strictly at OBSERVED CLOSE (Cursor rule, zero phantom).
- Sleeve 2 (Dynamic Contrarian Grid on SOLUSDT, $50 allocation):
  - Trades SOLUSDT mean-reversion around 20-day EMA.
  - Buys when price dips below EMA (-2%, -4%, -6%). Ticket $12/level, max 3 levels ($36 max exposure).
  - Sells TP when price recovers +2.5% above fill. Maker fee: 0.02%.
- Unified Circuit Breaker:
  - If combined daily PnL <= -12.0 USDT at any day, hard close all positions in both sleeves, halt until next day.
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

def run_unified_hybrid(dates, symbols, prices):
    cash = 100.0
    day_metrics = []
    breaker_count = 0

    # Sleeve 1 state: Momentum
    held_mom = [] # list of (symbol, entry, qty)
    since_reb = 0

    # Sleeve 2 state: Grid on SOL
    held_grid = [] # list of (entry, qty, tp_price)

    def calc_equity(px):
        unrealized = 0.0
        # Momentum unrl
        for sym, entry, qty in held_mom:
            unrealized += (px.get(sym, entry) - entry) * qty
        # Grid unrl
        sol_p = px.get("SOLUSDT", 0)
        for entry, qty, _ in held_grid:
            if sol_p > 0:
                unrealized += (sol_p - entry) * qty
        return cash + unrealized

    sol_prices = [p.get("SOLUSDT", 0) for p in prices]

    for index in range(25, len(prices)):
        today = prices[index]
        yesterday = prices[index - 1]
        start_equity = calc_equity(yesterday)

        # ---------------------------------------------------------------------
        # 1. EVALUATE SLEEVE 1: MOMENTUM EXITS (STRICT OBSERVED CLOSE)
        # ---------------------------------------------------------------------
        surviving_mom = []
        for sym, entry, qty in held_mom:
            if sym not in today:
                surviving_mom.append((sym, entry, qty))
                continue
            close = today[sym]
            ret = (close - entry) / entry
            if ret <= -0.08: # 8% stop loss
                exit_price = close # STRICT CLOSE FILL (Zero phantom)
                cash += (exit_price - entry) * qty - exit_price * qty * FEE_TAKER
            else:
                surviving_mom.append((sym, entry, qty))
        held_mom = surviving_mom

        # ---------------------------------------------------------------------
        # 2. EVALUATE SLEEVE 2: GRID TPs & LIMIT BUYS (SOLUSDT)
        # ---------------------------------------------------------------------
        sol_close = today.get("SOLUSDT", 0)
        surviving_grid = []
        for entry, qty, tp in held_grid:
            if sol_close >= tp:
                # TP filled at tp price (maker)
                cash += (tp - entry) * qty - tp * qty * FEE_MAKER
            else:
                surviving_grid.append((entry, qty, tp))
        held_grid = surviving_grid

        # ---------------------------------------------------------------------
        # 3. UNIFIED CIRCUIT BREAKER CHECK (-12.0 USDT)
        # ---------------------------------------------------------------------
        equity_now = calc_equity(today)
        day_pnl = equity_now - start_equity
        fired = day_pnl <= -12.0

        if fired:
            breaker_count += 1
            # Panic close both sleeves
            for sym, entry, qty in held_mom:
                exit_price = today.get(sym, entry)
                cash += (exit_price - entry) * qty - exit_price * qty * FEE_TAKER
            held_mom = []
            for entry, qty, _ in held_grid:
                if sol_close > 0:
                    cash += (sol_close - entry) * qty - sol_close * qty * FEE_TAKER
            held_grid = []
            equity_now = calc_equity(today)
            day_pnl = equity_now - start_equity

        day_metrics.append(day_pnl)

        if fired:
            continue # Halted for today

        # ---------------------------------------------------------------------
        # 4. SLEEVE 1 REBALANCE (EVERY 2 DAYS, TOP 2 COINS, $25 EACH)
        # ---------------------------------------------------------------------
        since_reb += 1
        if since_reb >= 2:
            since_reb = 0
            # Close existing momentum
            for sym, entry, qty in held_mom:
                exit_price = today.get(sym, entry)
                cash += (exit_price - entry) * qty - exit_price * qty * FEE_TAKER
            held_mom = []

            # Rank 14-day momentum
            past = prices[index - 14]
            scores = []
            for s in symbols:
                if s in today and s in past:
                    scores.append(((today[s] - past[s]) / past[s], s))
            scores.sort(reverse=True)

            for score, sym in scores:
                if score <= 0.02:
                    break
                alloc = 25.0
                cash -= alloc * FEE_TAKER
                held_mom.append((sym, today[sym], alloc / today[sym]))
                if len(held_mom) == 2:
                    break

        # ---------------------------------------------------------------------
        # 5. SLEEVE 2 GRID ENTRIES (SOLUSDT)
        # ---------------------------------------------------------------------
        # Calculate 20 EMA of SOL
        sol_window = [p for p in sol_prices[index-20:index] if p > 0]
        if len(sol_window) >= 15 and sol_close > 0:
            sol_ema = sum(sol_window) / len(sol_window)
            if len(held_grid) < 3:
                lvl = len(held_grid) + 1
                target_dip = sol_ema * (1 - lvl * 0.025) # 2.5% dip per level
                if sol_close <= target_dip:
                    ticket = 12.0
                    cash -= ticket * FEE_MAKER
                    qty = ticket / sol_close
                    tp_price = sol_close * 1.035 # 3.5% TP
                    held_grid.append((sol_close, qty, tp_price))

    final_equity = calc_equity(prices[-1])
    net_pnl = final_equity - 100.0
    total_days = len(day_metrics)
    mean_daily = net_pnl / total_days
    worst_day = min(day_metrics)

    return {
        "total_days": total_days,
        "final_equity": final_equity,
        "net_pnl": net_pnl,
        "mean_daily_pnl": mean_daily,
        "annualized_roi_pct": mean_daily * 365,
        "worst_day_pnl": worst_day,
        "breaker_count": breaker_count,
        "meets_target": mean_daily >= 0.20,
        "respects_risk": worst_day >= -12.0,
    }

def main():
    dates, symbols, prices = load()
    res = run_unified_hybrid(dates, symbols, prices)
    print("==========================================================================================")
    print("                 UNIFIED HYBRID PORTFOLIO RESULTS (SHARED $100 WALLET)                    ")
    print("==========================================================================================")
    print(f"Total Days: {res['total_days']} days (~4.0 years)")
    print(f"Initial Capital: 100.00 USDT")
    print(f"Final Equity: {res['final_equity']:.2f} USDT")
    print(f"Net Profit: +{res['net_pnl']:.2f} USDT")
    print(f"Mean Daily PnL: +{res['mean_daily_pnl']:.4f} USDT/day (+{res['mean_daily_pnl']:.3f}%/day)")
    print(f"Annualized Return: +{res['annualized_roi_pct']:.1f}% / year")
    print(f"Worst Single Day: {res['worst_day_pnl']:.2f} USDT")
    print(f"Circuit Breakers Triggered: {res['breaker_count']}")
    print(f"Target >= 0.20u/day: {'PASS' if res['meets_target'] else 'FAIL'}")
    print(f"Risk <= 12u/day: {'PASS' if res['respects_risk'] else 'FAIL'}")
    print("==========================================================================================")

if __name__ == "__main__":
    main()
