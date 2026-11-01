#!/usr/bin/env python3
"""
BACKTEST & SENSITIVITY AUDIT: PROFIT PROTECTION MECHANISMS
==========================================================
Simulates and evaluates profit protection strategies against the Phase 5 Baseline.
Uses the EXACT matching accounting engine and dataset from verify-phase5-compounding.py.
Dataset: 1,485 trading days (2022-09-05 to 2026-10-23) on canonical daily-source.csv.

Evaluates:
1. Baseline Phase 5 (No Profit Protection, Fixed -12% SL, 2d rebalance)
2. Ratchet Guard Conservative (BE@+8%, Lock+8%@+14%)
3. Ratchet Guard Moderate (BE@+6%, Lock+6%@+12%)
4. Ratchet Guard Aggressive (BE@+4%, Lock+4%@+8%)
5. Take-Profit Target Only (+15% TP)
6. Take-Profit Target Only (+20% TP)
7. Hybrid Ratchet + Take-Profit (BE@+8%, Lock+8%@+14%, TP@+20%)
"""

from __future__ import annotations
import csv
import sys
from pathlib import Path

CSV = Path(__file__).resolve().parents[1] / "tests/fixtures/cct-source-projection/daily-source.csv"
FEE_TAKER_DYNAMIC = 0.00055  # 0.05% taker + 0.005% slippage
FEE_MAKER = 0.0002          # 0.02% maker

EVENT_SHIELD_BLACKLIST = {
    "2022-05": {"LUNAUSDT", "USTUSDT"},
    "2022-11": {"FTTUSDT", "SRMUSDT"},
}

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

def run_simulation(
    dates: list[str],
    symbols: list[str],
    prices: list[dict[str, float]],
    compounding: bool = True,
    volatility_grid: bool = True,
    mom_alloc_pct: float = 0.24,
    grid_ticket_pct: float = 0.14,
    mom_lookback: int = 14,
    mom_stop: float = 0.12,
    mom_reb: int = 2,
    grid_max_levels: int = 3,
    step_base: float = 0.020,
    tp_base: float = 0.035,
    crash_base: float = 0.060,
    baseline_atr_pct: float = 0.0168,
    # Profit Protection parameters
    enable_ratchet: bool = False,
    be_trigger_pct: float = 0.08,
    be_sl_pct: float = 0.008,
    lock_trigger_pct: float = 0.14,
    lock_sl_pct: float = 0.08,
    enable_tp: bool = False,
    tp_target_pct: float = 0.15,
):
    cash = 100.0
    # held_mom: list of dict: {sym, entry, qty, current_sl_pct, max_ret}
    held_mom: list[dict] = []
    held_grid: list[tuple[float, float, float]] = []  # (entry, qty, tp_price) on BTC
    since_reb = 0
    daily_pnls: list[tuple[str, float, float, float]] = []
    btc_prices = [p.get("BTCUSDT", 0.0) for p in prices]
    
    breaker_trips = 0
    min_equity_observed = cash
    peak_equity = cash
    max_drawdown_pct = 0.0

    stats = {
        "sl_hit_disaster": 0,
        "sl_hit_be": 0,
        "sl_hit_lock": 0,
        "tp_hit": 0,
        "reb_closed": 0,
        "total_trades": 0,
        "winning_trades": 0,
    }

    def equity(px):
        unrl = 0.0
        for pos in held_mom:
            sym = pos["sym"]
            entry = pos["entry"]
            qty = pos["qty"]
            unrl += (px.get(sym, entry) - entry) * qty
        btc_p = px.get("BTCUSDT", 0.0)
        for entry, qty, _ in held_grid:
            if btc_p > 0:
                unrl += (btc_p - entry) * qty
        return cash + unrl

    for idx in range(15, len(prices)):
        today_date = dates[idx]
        today = prices[idx]
        yesterday = prices[idx - 1]
        start_eq = equity(yesterday)
        curr_eq = start_eq

        if curr_eq < min_equity_observed:
            min_equity_observed = curr_eq
        if curr_eq > peak_equity:
            peak_equity = curr_eq
        dd = (peak_equity - curr_eq) / peak_equity if peak_equity > 0 else 0.0
        if dd > max_drawdown_pct:
            max_drawdown_pct = dd

        # Sizing
        if compounding:
            mom_alloc = max(5.0, curr_eq * mom_alloc_pct)
            grid_ticket = max(5.0, curr_eq * grid_ticket_pct)
            daily_loss_limit = max(12.0, curr_eq * 0.12)
        else:
            mom_alloc = 25.0
            grid_ticket = 15.0
            daily_loss_limit = 12.0

        # ATR-14 Volatility Grid Parameters
        btc_today = today.get("BTCUSDT", 0.0)
        btc_yesterday = yesterday.get("BTCUSDT", 0.0)
        btc_1d_ret = (btc_today - btc_yesterday) / btc_yesterday if btc_yesterday > 0 else 0.0

        if volatility_grid:
            trs = [abs(btc_prices[j] - btc_prices[j-1]) for j in range(idx-13, idx+1) if btc_prices[j] > 0 and btc_prices[j-1] > 0]
            atr = sum(trs) / len(trs) if trs else 0.0
            atr_pct = atr / btc_today if btc_today > 0 else baseline_atr_pct
            vol_mult = max(0.8, min(1.5, atr_pct / baseline_atr_pct))
            grid_step_pct = max(0.015, min(0.035, step_base * vol_mult))
            grid_tp_pct = max(0.025, min(0.050, tp_base * vol_mult))
            btc_crash_gate_pct = max(0.050, min(0.090, crash_base * vol_mult))
        else:
            grid_step_pct = 0.020
            grid_tp_pct = 0.030
            btc_crash_gate_pct = 0.060

        # Event Shield Emergency Exit
        month_key = today_date[:7]
        blacklisted_now = EVENT_SHIELD_BLACKLIST.get(month_key, set())
        safe_mom = []
        for pos in held_mom:
            sym = pos["sym"]
            entry = pos["entry"]
            qty = pos["qty"]
            if sym in blacklisted_now:
                exit_p = today.get(sym, entry)
                cash += (exit_p - entry) * qty - exit_p * qty * FEE_TAKER_DYNAMIC
            else:
                safe_mom.append(pos)
        held_mom = safe_mom

        # 1. Evaluate Momentum Positions (Stop Loss / Ratchet / Take Profit)
        surviving_mom = []
        for pos in held_mom:
            sym = pos["sym"]
            entry = pos["entry"]
            qty = pos["qty"]
            if sym not in today:
                surviving_mom.append(pos)
                continue
            close = today[sym]
            ret = (close - entry) / entry

            # Update highest observed return
            if ret > pos["max_ret"]:
                pos["max_ret"] = ret

            # Ratchet Stop Loss updating
            if enable_ratchet:
                if pos["max_ret"] >= lock_trigger_pct:
                    if pos["current_sl"] < lock_sl_pct:
                        pos["current_sl"] = lock_sl_pct
                elif pos["max_ret"] >= be_trigger_pct:
                    if pos["current_sl"] < be_sl_pct:
                        pos["current_sl"] = be_sl_pct

            # Check Take Profit
            exited = False
            if enable_tp and ret >= tp_target_pct:
                trade_pnl = (close - entry) * qty - close * qty * FEE_TAKER_DYNAMIC
                cash += (close - entry) * qty - close * qty * FEE_TAKER_DYNAMIC
                stats["tp_hit"] += 1
                stats["total_trades"] += 1
                stats["winning_trades"] += 1
                exited = True

            # Check Stop Loss violation (Disaster SL or Ratcheted BE/Lock)
            if not exited:
                sl = pos["current_sl"]
                if ret <= sl:
                    trade_pnl = (close - entry) * qty - close * qty * FEE_TAKER_DYNAMIC
                    cash += (close - entry) * qty - close * qty * FEE_TAKER_DYNAMIC
                    stats["total_trades"] += 1
                    if sl <= -0.10:
                        stats["sl_hit_disaster"] += 1
                    elif sl == be_sl_pct:
                        stats["sl_hit_be"] += 1
                        stats["winning_trades"] += 1
                    elif sl >= lock_sl_pct:
                        stats["sl_hit_lock"] += 1
                        stats["winning_trades"] += 1
                    exited = True

            if not exited:
                surviving_mom.append(pos)

        held_mom = surviving_mom

        # 2. Evaluate BTC Grid Take Profit
        surviving_grid = []
        for entry, qty, tp_price in held_grid:
            if btc_today >= tp_price:
                cash += (tp_price - entry) * qty - tp_price * qty * FEE_MAKER
            else:
                surviving_grid.append((entry, qty, tp_price))
        held_grid = surviving_grid

        # 3. Check Daily Circuit Breaker
        mid_eq = equity(today)
        mid_day_pnl = mid_eq - start_eq
        fired = mid_day_pnl <= -daily_loss_limit
        if fired:
            breaker_trips += 1
            for pos in held_mom:
                sym = pos["sym"]
                entry = pos["entry"]
                qty = pos["qty"]
                exit_p = today.get(sym, entry)
                cash += (exit_p - entry) * qty - exit_p * qty * FEE_TAKER_DYNAMIC
            held_mom = []
            for entry, qty, _ in held_grid:
                if btc_today > 0:
                    cash += (btc_today - entry) * qty - btc_today * qty * FEE_TAKER_DYNAMIC
            held_grid = []

        # 4. Momentum Rebalance (Every mom_reb days)
        since_reb += 1
        if since_reb >= mom_reb and not fired:
            since_reb = 0
            for pos in held_mom:
                sym = pos["sym"]
                entry = pos["entry"]
                qty = pos["qty"]
                exit_p = today.get(sym, entry)
                trade_pnl = (exit_p - entry) * qty - exit_p * qty * FEE_TAKER_DYNAMIC
                cash += (exit_p - entry) * qty - exit_p * qty * FEE_TAKER_DYNAMIC
                stats["reb_closed"] += 1
                stats["total_trades"] += 1
                if trade_pnl > 0:
                    stats["winning_trades"] += 1
            held_mom = []

            past = prices[idx - mom_lookback]
            scores = []
            for sym in symbols:
                if sym == "BTCUSDT" or sym in blacklisted_now:
                    continue
                if sym in today and sym in past:
                    ret = (today[sym] - past[sym]) / past[sym]
                    scores.append((ret, sym))

            scores.sort(reverse=True)
            for score, sym in scores:
                if score <= 0.02:
                    break
                cash -= mom_alloc * FEE_TAKER_DYNAMIC
                held_mom.append({
                    "sym": sym,
                    "entry": today[sym],
                    "qty": mom_alloc / today[sym],
                    "current_sl": -mom_stop,
                    "max_ret": 0.0,
                })
                if len(held_mom) == 2:
                    break

        # 5. BTC Volatility Grid Entry
        if not fired and len(held_grid) < grid_max_levels and btc_1d_ret >= -btc_crash_gate_pct:
            btc_window = [p for p in btc_prices[idx-10:idx] if p > 0]
            if len(btc_window) >= 8 and btc_today > 0:
                btc_ema = sum(btc_window) / len(btc_window)
                lvl = len(held_grid) + 1
                target_dip_price = btc_ema * (1.0 - lvl * grid_step_pct)
                if btc_today <= target_dip_price:
                    cash -= grid_ticket * FEE_MAKER
                    qty = grid_ticket / btc_today
                    tp_price = btc_today * (1.0 + grid_tp_pct)
                    held_grid.append((btc_today, qty, tp_price))

        end_eq = equity(today)
        day_pnl = end_eq - start_eq
        ret_pct = day_pnl / start_eq if start_eq > 0 else 0.0
        daily_pnls.append((dates[idx], day_pnl, start_eq, ret_pct))

    final_equity = equity(prices[-1])
    net_pnl = final_equity - 100.0
    total_days = len(daily_pnls)
    mean_daily = net_pnl / total_days
    worst_day_pnl, worst_day_date = min((pnl, dt) for dt, pnl, _, _ in daily_pnls)
    worst_ret_pct, worst_ret_date = min((ret, dt) for dt, _, _, ret in daily_pnls)

    # Accounting Parity Check
    sum_daily = sum(pnl for _, pnl, _, _ in daily_pnls)
    assert abs(sum_daily - net_pnl) < 1e-4, f"Parity mismatch: sum={sum_daily}, net={net_pnl}"

    # Subperiod metrics (Period 1: Bear 2022-2024, Period 2: Bull 2024-2026)
    mid_idx = total_days // 2
    p1_net = sum(p[1] for p in daily_pnls[:mid_idx])
    p2_net = sum(p[1] for p in daily_pnls[mid_idx:])

    # 512-day window
    d512 = daily_pnls[-512:]
    d512_net = sum(p[1] for p in d512)
    d512_mean = d512_net / len(d512)

    win_rate = (stats["winning_trades"] / max(1, stats["total_trades"])) * 100.0

    return {
        "final_equity": final_equity,
        "net_pnl": net_pnl,
        "mean_daily": mean_daily,
        "annualized_roi": mean_daily * 365.0,
        "worst_day_pnl": worst_day_pnl,
        "worst_ret_pct": worst_ret_pct,
        "worst_day_date": worst_day_date,
        "breaker_trips": breaker_trips,
        "min_equity": min_equity_observed,
        "max_drawdown": max_drawdown_pct * 100,
        "p1_net": p1_net,
        "p2_net": p2_net,
        "d512_net": d512_net,
        "d512_mean": d512_mean,
        "stats": stats,
        "win_rate": win_rate,
    }

def main():
    dates, symbols, prices = load()
    total_days = len(dates) - 15
    print(f"Loaded {len(symbols)} symbols over {total_days} trading days ({dates[15]} to {dates[-1]}).\n")

    configs = [
        ("1. Baseline Phase 5 (No Profit Protection)", {
            "compounding": True,
            "enable_ratchet": False,
            "enable_tp": False,
        }),
        ("2. Ratchet Guard Conservative (BE@+8%, Lock+8%@+14%)", {
            "compounding": True,
            "enable_ratchet": True,
            "be_trigger_pct": 0.08,
            "be_sl_pct": 0.008,
            "lock_trigger_pct": 0.14,
            "lock_sl_pct": 0.08,
            "enable_tp": False,
        }),
        ("3. Ratchet Guard Moderate (BE@+6%, Lock+6%@+12%)", {
            "compounding": True,
            "enable_ratchet": True,
            "be_trigger_pct": 0.06,
            "be_sl_pct": 0.008,
            "lock_trigger_pct": 0.12,
            "lock_sl_pct": 0.06,
            "enable_tp": False,
        }),
        ("4. Ratchet Guard Aggressive (BE@+4%, Lock+4%@+8%)", {
            "compounding": True,
            "enable_ratchet": True,
            "be_trigger_pct": 0.04,
            "be_sl_pct": 0.008,
            "lock_trigger_pct": 0.08,
            "lock_sl_pct": 0.04,
            "enable_tp": False,
        }),
        ("5. Take-Profit Target Only (+15% TP)", {
            "compounding": True,
            "enable_ratchet": False,
            "enable_tp": True,
            "tp_target_pct": 0.15,
        }),
        ("6. Take-Profit Target Only (+20% TP)", {
            "compounding": True,
            "enable_ratchet": False,
            "enable_tp": True,
            "tp_target_pct": 0.20,
        }),
        ("7. Hybrid Ratchet + Take-Profit (BE@+8%, Lock+8%@+14%, TP@+20%)", {
            "compounding": True,
            "enable_ratchet": True,
            "be_trigger_pct": 0.08,
            "be_sl_pct": 0.008,
            "lock_trigger_pct": 0.14,
            "lock_sl_pct": 0.08,
            "enable_tp": True,
            "tp_target_pct": 0.20,
        }),
    ]

    results = []
    print("=" * 122)
    print(f"{'Strategy Configuration':<46} | {'Final Eq':<9} | {'Net PnL':<10} | {'Mean/d':<9} | {'Worst Day %':<11} | {'Max DD':<7} | {'WinRate':<7} | {'Breakers'}")
    print("=" * 122)

    for name, cfg in configs:
        res = run_simulation(dates, symbols, prices, **cfg)
        results.append((name, cfg, res))
        print(f"{name:<46} | {res['final_equity']:>7.2f}u  | {res['net_pnl']:>+8.2f}u  | {res['mean_daily']:>+6.4f}u | {res['worst_ret_pct']*100:>9.2f}% | {res['max_drawdown']:>5.1f}% | {res['win_rate']:>5.1f}% | {res['breaker_trips']}")

    print("=" * 122)
    print("\n" + "=" * 80)
    print("               DETAILED TRADE & EXIT ATTRIBUTION")
    print("=" * 80)
    for name, cfg, res in results:
        st = res["stats"]
        print(f"\n[{name}]")
        print(f"  • Net Profit: {res['net_pnl']:+.2f} USDT (Final Equity: {res['final_equity']:.2f} USDT)")
        print(f"  • Worst Day Return: {res['worst_ret_pct']*100:.2f}% ({res['worst_day_date']}) | Max Drawdown: {res['max_drawdown']:.1f}%")
        print(f"  • Total Closed Trades: {st['total_trades']} | Overall Win Rate: {res['win_rate']:.1f}%")
        print(f"  • Exit Breakdown:")
        print(f"      - Initial Stop Loss Hit (-12%):   {st['sl_hit_disaster']:>4} ({st['sl_hit_disaster']/max(1,st['total_trades'])*100:.1f}%)")
        print(f"      - Break-Even Stop Hit (+0.8%):    {st['sl_hit_be']:>4} ({st['sl_hit_be']/max(1,st['total_trades'])*100:.1f}%)")
        print(f"      - Lock-Profit Stop Hit:           {st['sl_hit_lock']:>4} ({st['sl_hit_lock']/max(1,st['total_trades'])*100:.1f}%)")
        print(f"      - Take-Profit Target Hit:         {st['tp_hit']:>4} ({st['tp_hit']/max(1,st['total_trades'])*100:.1f}%)")
        print(f"      - 2-Day Rebalance Close:          {st['reb_closed']:>4} ({st['reb_closed']/max(1,st['total_trades'])*100:.1f}%)")
        print(f"  • Subperiod Consistency:")
        print(f"      - Period 1 Bear (2022-2024):      {res['p1_net']:>+7.2f} USDT")
        print(f"      - Period 2 Bull (2024-2026):      {res['p2_net']:>+7.2f} USDT")
        print(f"      - Standalone 512d Window:         {res['d512_net']:>+7.2f} USDT (Mean: {res['d512_mean']:+.4f} u/d)")

if __name__ == "__main__":
    main()
