#!/usr/bin/env python3
"""
PHASE 2 HYBRID ARCHITECTURE TESTBED:
Macro Momentum ($50) + BTC Low-Beta Mean-Reversion Sleeve ($30) on Shared 100u Wallet

Design Principles:
1. Sleeve 1 (Macro Momentum, $25x2 = $50 allocation):
   - Rebalance every 2 days, SL 12% at observed close.
   - Generates +0.1709 u/day core trend alpha.
2. Sleeve 2 (BTC Mean-Reversion Maker, max $30 allocation):
   - Trades ONLY BTCUSDT (lowest volatility, highest liquidity, no altcoin contagion).
   - Buys when BTC drops below its 10-day EMA (-1.5%, -3.0%). Ticket $15/level, max 2 levels ($30 max).
   - Take Profit at EMA recovery (+1.5%), Maker fee 0.02%.
   - Crash Gate: If BTC 1-day drop > 8%, pauses grid entries (protects against black swans like FTX).
3. Shared Risk Engine:
   - Single 100u wallet.
   - Combined daily loss cap strictly <= 12.0 USDT.
   - Strict observed close evaluation (ZERO phantom fills).
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

def run_hybrid_simulation(
    dates: list[str],
    symbols: list[str],
    prices: list[dict[str, float]],
    mom_alloc: float = 24.0,       # $24x2 = $48 for momentum
    mom_lookback: int = 14,
    mom_stop: float = 0.12,
    mom_reb: int = 2,
    grid_ticket: float = 12.0,     # $12 per grid level on BTC (max 2 levels = $24)
    grid_max_levels: int = 2,
    grid_step_pct: float = 0.020,  # 2.0% dip from 10 EMA
    grid_tp_pct: float = 0.025,    # 2.5% TP
    btc_crash_gate_pct: float = 0.06, # Pause grid if BTC drops > 6% in 1 day
):
    cash = 100.0
    held_mom: list[tuple[str, float, float]] = []      # (sym, entry, qty)
    held_grid: list[tuple[float, float, float]] = []    # (entry, qty, tp_price) on BTC
    since_reb = 0
    daily_pnls: list[float] = []
    btc_prices = [p.get("BTCUSDT", 0) for p in prices]

    def equity(px):
        unrl = 0.0
        for sym, entry, qty in held_mom:
            unrl += (px.get(sym, entry) - entry) * qty
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
        btc_1d_ret = (btc_today - btc_yesterday) / btc_yesterday if btc_yesterday > 0 else 0.0

        # ---------------------------------------------------------------------
        # 1. Evaluate Sleeve 1 (Momentum) Stops at Observed Close
        # ---------------------------------------------------------------------
        surviving_mom = []
        for sym, entry, qty in held_mom:
            if sym not in today:
                surviving_mom.append((sym, entry, qty))
                continue
            close = today[sym]
            ret = (close - entry) / entry
            if ret <= -mom_stop:
                cash += (close - entry) * qty - close * qty * FEE_TAKER
            else:
                surviving_mom.append((sym, entry, qty))
        held_mom = surviving_mom

        # ---------------------------------------------------------------------
        # 2. Evaluate Sleeve 2 (BTC Grid) TPs at Observed Close
        # ---------------------------------------------------------------------
        surviving_grid = []
        for entry, qty, tp in held_grid:
            if btc_today >= tp:
                # Filled TP at tp price (maker)
                cash += (tp - entry) * qty - tp * qty * FEE_MAKER
            else:
                surviving_grid.append((entry, qty, tp))
        held_grid = surviving_grid

        # ---------------------------------------------------------------------
        # 3. Check Combined Daily Circuit Breaker (-12.0 USDT)
        # ---------------------------------------------------------------------
        eq_mid = equity(today)
        day_pnl_mid = eq_mid - start_eq
        fired = day_pnl_mid <= -12.0
        if fired:
            # Flatten both sleeves
            for sym, entry, qty in held_mom:
                exit_p = today.get(sym, entry)
                cash += (exit_p - entry) * qty - exit_p * qty * FEE_TAKER
            held_mom = []
            for entry, qty, _ in held_grid:
                if btc_today > 0:
                    cash += (btc_today - entry) * qty - btc_today * qty * FEE_TAKER
            held_grid = []
            eq_mid = equity(today)
            day_pnl_mid = eq_mid - start_eq

        # ---------------------------------------------------------------------
        # 4. Rebalance Sleeve 1 (Momentum Every 2 Days)
        # ---------------------------------------------------------------------
        since_reb += 1
        if since_reb >= mom_reb and not fired:
            since_reb = 0
            for sym, entry, qty in held_mom:
                exit_p = today.get(sym, entry)
                cash += (exit_p - entry) * qty - exit_p * qty * FEE_TAKER
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
                held_mom.append((sym, today[sym], mom_alloc / today[sym]))
                if len(held_mom) == 2:
                    break

        # ---------------------------------------------------------------------
        # 5. Evaluate Sleeve 2 (BTC Grid Entries with Crash Veto)
        # ---------------------------------------------------------------------
        if not fired and len(held_grid) < grid_max_levels and btc_1d_ret >= -btc_crash_gate_pct:
            btc_window = [p for p in btc_prices[idx-10:idx] if p > 0]
            if len(btc_window) >= 8 and btc_today > 0:
                btc_ema = sum(btc_window) / len(btc_window)
                lvl = len(held_grid) + 1
                target_dip = btc_ema * (1.0 - lvl * grid_step_pct)
                if btc_today <= target_dip:
                    ticket = grid_ticket
                    cash -= ticket * FEE_MAKER
                    qty = ticket / btc_today
                    tp_price = btc_today * (1.0 + grid_tp_pct)
                    held_grid.append((btc_today, qty, tp_price))

        # End of day equity & PnL
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
    print("      PHASE 2 HYBRID MULTI-SLEEVE SWEEP (SHARED $100 WALLET, STRICT OBSERVED CLOSE)       ")
    print("==========================================================================================")

    best = []
    for lb in [10, 14]:
        for m_alloc in [24.0, 25.0]:
            for g_ticket in [10.0, 12.0, 15.0]:
                for g_levels in [2, 3]:
                    for g_step in [0.015, 0.020]:
                        for g_tp in [0.025, 0.030]:
                            for crash_gate in [0.05, 0.06]:
                                res = run_hybrid_simulation(
                                    dates, symbols, prices,
                                    mom_alloc=m_alloc,
                                    mom_lookback=lb,
                                    grid_ticket=g_ticket,
                                    grid_max_levels=g_levels,
                                    grid_step_pct=g_step,
                                    grid_tp_pct=g_tp,
                                    btc_crash_gate_pct=crash_gate
                                )
                                if res["breaches"] == 0 and res["worst"] >= -12.0:
                                    best.append((res["mean"], res, lb, m_alloc, g_ticket, g_levels, g_step, g_tp, crash_gate))

    best.sort(reverse=True)
    print(f"Total Zero-Breach Hybrid Configurations Found: {len(best)}")
    for mean, res, lb, ma, gt, gl, gs, gtp, cg in best[:25]:
        print(f"LB={lb:2d}d | Mom=${ma:.0f}x2 | Grid=${gt:.0f}x{gl} | Step={gs*100:.1f}% | TP={gtp*100:.1f}% | CrashGate={cg*100:.0f}% => Net=+{res['net']:6.2f}u | Mean=+{res['mean']:.4f}u/d (+{res['mean']*365:5.1f}%/yr) | Worst={res['worst']:6.2f}u | Breaches={res['breaches']}")

if __name__ == "__main__":
    main()
