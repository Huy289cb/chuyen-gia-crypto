#!/usr/bin/env python3
"""
BACKTEST AUDIT: VOLATILITY-ADAPTIVE STOP LOSS & SIZING SOLUTIONS
==============================================================
Evaluates:
1. Baseline: Fixed 12% SL, Fixed 24% allocation.
2. Solution A (ATR-Based Dynamic SL): SL = clamp(8%, 20%, 2.0 * ATR_14_pct). Fixed 24% size.
3. Solution B (Risk Parity / Vol-Scaled Sizing): SL = clamp(8%, 20%, 2.0 * ATR_14_pct), Size = Dollar_Risk / SL (capped at 24%).
4. Solution C (Risk-Adjusted Momentum Ranking): Score = 14d_Return / ATR_14_pct (Sharpe Momentum) + Fixed 12% SL.
5. Solution D (Combined: Sharpe Momentum + Vol-Scaled Sizing + Same-Day Cooldown).
"""

from __future__ import annotations
import csv
from pathlib import Path

CSV = Path(__file__).resolve().parents[1] / "tests/fixtures/cct-source-projection/daily-source.csv"
FEE_TAKER_DYNAMIC = 0.00055
FEE_MAKER = 0.0002

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

def compute_atr_pct(prices: list[dict[str, float]], idx: int, sym: str, lookback: int = 14) -> float:
    if idx < lookback:
        return 0.05
    trs = []
    for j in range(idx - lookback + 1, idx + 1):
        curr_p = prices[j].get(sym, 0.0)
        prev_p = prices[j - 1].get(sym, 0.0)
        if curr_p > 0 and prev_p > 0:
            trs.append(abs(curr_p - prev_p) / prev_p)
    if not trs:
        return 0.05
    return sum(trs) / len(trs)

def run_simulation(
    dates: list[str],
    symbols: list[str],
    prices: list[dict[str, float]],
    variant: str = "baseline", # "baseline", "atr_sl_only", "vol_scaled_sizing", "sharpe_ranking", "combined_optimal"
    k_atr: float = 2.0,
    min_sl: float = 0.08,
    max_sl: float = 0.20,
    target_risk_pct: float = 0.0288, # 24% * 12% = ~2.88% equity risk per trade
):
    cash = 100.0
    held_mom: list[dict] = []
    held_grid: list[tuple[float, float, float]] = []
    since_reb = 0
    daily_pnls: list[tuple[str, float, float, float]] = []
    btc_prices = [p.get("BTCUSDT", 0.0) for p in prices]
    
    symbol_cooldown: dict[str, int] = {}
    breaker_trips = 0
    min_equity_observed = cash
    peak_equity = cash
    max_drawdown_pct = 0.0

    stats = {
        "sl_hit_disaster": 0,
        "sl_hit_be": 0,
        "sl_hit_lock": 0,
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

        mom_alloc_base = max(5.0, curr_eq * 0.24)
        grid_ticket = max(5.0, curr_eq * 0.14)
        daily_loss_limit = max(12.0, curr_eq * 0.12)

        btc_today = today.get("BTCUSDT", 0.0)
        btc_yesterday = yesterday.get("BTCUSDT", 0.0)
        btc_1d_ret = (btc_today - btc_yesterday) / btc_yesterday if btc_yesterday > 0 else 0.0

        # ATR-14 Volatility Grid for BTC
        trs = [abs(btc_prices[j] - btc_prices[j-1]) for j in range(idx-13, idx+1) if btc_prices[j] > 0 and btc_prices[j-1] > 0]
        atr = sum(trs) / len(trs) if trs else 0.0
        atr_pct = atr / btc_today if btc_today > 0 else 0.0168
        vol_mult = max(0.8, min(1.5, atr_pct / 0.0168))
        grid_step_pct = max(0.015, min(0.035, 0.020 * vol_mult))
        grid_tp_pct = max(0.025, min(0.050, 0.035 * vol_mult))
        btc_crash_gate_pct = max(0.050, min(0.090, 0.060 * vol_mult))

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

        # 1. Evaluate Momentum Positions
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

            if ret > pos["max_ret"]:
                pos["max_ret"] = ret

            # Ratchet Logic
            if pos["max_ret"] >= 0.14:
                if pos["current_sl"] < 0.08:
                    pos["current_sl"] = 0.08
            elif pos["max_ret"] >= 0.08:
                if pos["current_sl"] < 0.008:
                    pos["current_sl"] = 0.008

            sl = pos["current_sl"]
            if ret <= sl:
                trade_pnl = (close - entry) * qty - close * qty * FEE_TAKER_DYNAMIC
                cash += (close - entry) * qty - close * qty * FEE_TAKER_DYNAMIC
                stats["total_trades"] += 1
                if sl <= -0.06:
                    stats["sl_hit_disaster"] += 1
                    symbol_cooldown[sym] = idx + 1 # Same-day cooldown
                elif sl == 0.008:
                    stats["sl_hit_be"] += 1
                    stats["winning_trades"] += 1
                elif sl >= 0.08:
                    stats["sl_hit_lock"] += 1
                    stats["winning_trades"] += 1
            else:
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

        # 4. Momentum Rebalance & Selection
        since_reb += 1
        is_rebalance_day = (since_reb >= 2) and not fired

        if is_rebalance_day:
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

            past = prices[idx - 14]
            candidates = []
            for sym in symbols:
                if sym == "BTCUSDT" or sym in blacklisted_now:
                    continue
                if sym in today and sym in past:
                    ret_14d = (today[sym] - past[sym]) / past[sym]
                    if ret_14d <= 0.02:
                        continue
                    sym_atr = compute_atr_pct(prices, idx, sym, 14)
                    
                    if variant in ("sharpe_ranking", "combined_optimal"):
                        score = ret_14d / max(0.02, sym_atr)
                    else:
                        score = ret_14d

                    candidates.append((score, ret_14d, sym_atr, sym))

            candidates.sort(key=lambda x: x[0], reverse=True)

            for score, ret_14d, sym_atr, sym in candidates:
                if symbol_cooldown.get(sym, 0) > idx:
                    continue

                # Determine SL and Size
                if variant in ("atr_sl_only",):
                    sl_dist = max(min_sl, min(max_sl, k_atr * sym_atr))
                    alloc = mom_alloc_base
                elif variant in ("vol_scaled_sizing", "combined_optimal"):
                    sl_dist = max(min_sl, min(max_sl, k_atr * sym_atr))
                    # Risk budget: target_risk_pct * curr_eq
                    dollar_risk = max(1.0, curr_eq * target_risk_pct)
                    alloc = min(mom_alloc_base, dollar_risk / sl_dist)
                    alloc = max(5.0, alloc)
                else: # baseline
                    sl_dist = 0.12
                    alloc = mom_alloc_base

                cash -= alloc * FEE_TAKER_DYNAMIC
                held_mom.append({
                    "sym": sym,
                    "entry": today[sym],
                    "qty": alloc / today[sym],
                    "current_sl": -sl_dist,
                    "max_ret": 0.0,
                })
                if len(held_mom) == 2:
                    break

        elif not fired and len(held_mom) < 2:
            # Retry opening missing slots
            needed_slots = 2 - len(held_mom)
            currently_held = {p["sym"] for p in held_mom}
            past = prices[idx - 14]
            candidates = []
            for sym in symbols:
                if sym == "BTCUSDT" or sym in blacklisted_now or sym in currently_held:
                    continue
                if sym in today and sym in past:
                    ret_14d = (today[sym] - past[sym]) / past[sym]
                    if ret_14d <= 0.02:
                        continue
                    sym_atr = compute_atr_pct(prices, idx, sym, 14)
                    if variant in ("sharpe_ranking", "combined_optimal"):
                        score = ret_14d / max(0.02, sym_atr)
                    else:
                        score = ret_14d
                    candidates.append((score, ret_14d, sym_atr, sym))

            candidates.sort(key=lambda x: x[0], reverse=True)
            opened = 0
            for score, ret_14d, sym_atr, sym in candidates:
                if symbol_cooldown.get(sym, 0) > idx:
                    continue

                if variant in ("atr_sl_only",):
                    sl_dist = max(min_sl, min(max_sl, k_atr * sym_atr))
                    alloc = mom_alloc_base
                elif variant in ("vol_scaled_sizing", "combined_optimal"):
                    sl_dist = max(min_sl, min(max_sl, k_atr * sym_atr))
                    dollar_risk = max(1.0, curr_eq * target_risk_pct)
                    alloc = min(mom_alloc_base, dollar_risk / sl_dist)
                    alloc = max(5.0, alloc)
                else:
                    sl_dist = 0.12
                    alloc = mom_alloc_base

                cash -= alloc * FEE_TAKER_DYNAMIC
                held_mom.append({
                    "sym": sym,
                    "entry": today[sym],
                    "qty": alloc / today[sym],
                    "current_sl": -sl_dist,
                    "max_ret": 0.0,
                })
                opened += 1
                if opened >= needed_slots:
                    break

        # 5. BTC Grid
        if not fired and len(held_grid) < 3 and btc_1d_ret >= -btc_crash_gate_pct:
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
    win_rate = (stats["winning_trades"] / max(1, stats["total_trades"])) * 100.0

    return {
        "final_equity": final_equity,
        "net_pnl": net_pnl,
        "mean_daily": mean_daily,
        "annualized_roi": mean_daily * 365.0,
        "worst_day_pnl": worst_day_pnl,
        "worst_ret_pct": worst_ret_pct,
        "max_drawdown": max_drawdown_pct * 100,
        "win_rate": win_rate,
        "total_trades": stats["total_trades"],
        "disaster_sl_count": stats["sl_hit_disaster"],
        "breaker_trips": breaker_trips,
    }

def main():
    dates, symbols, prices = load()
    print(f"Loaded {len(symbols)} symbols over {len(prices)} trading days ({dates[0]} to {dates[-1]}).\n")

    experiments = [
        ("1. Baseline (Fixed 12% SL, Fixed 24% size)", "baseline", 2.0),
        ("2. ATR-Dynamic SL Only (8%-20% SL, Fixed 24% size)", "atr_sl_only", 2.0),
        ("3. Risk Parity Sizing (Vol-Scaled Size + ATR SL)", "vol_scaled_sizing", 2.0),
        ("4. Sharpe Momentum Ranking (14d Ret / ATR14)", "sharpe_ranking", 2.0),
        ("5. Combined Optimal (Sharpe Rank + Vol Sizing + Cooldown)", "combined_optimal", 2.0),
    ]

    header = f"{'Configuration':<56} | {'Final Eq':<9} | {'Net PnL':<10} | {'Mean/d':<8} | {'Max DD':<7} | {'WinRate':<7} | {'Trades':<6} | {'SL Hits'}"
    print(header)
    print("-" * len(header))

    for label, variant, k in experiments:
        res = run_simulation(dates, symbols, prices, variant=variant, k_atr=k)
        print(f"{label:<56} | {res['final_equity']:>7.2f}u | {res['net_pnl']:>8.2f}u | {res['mean_daily']:>+6.4f}u | {res['max_drawdown']:>5.1f}% | {res['win_rate']:>5.1f}% | {res['total_trades']:>6} | {res['disaster_sl_count']:>7}")

    print("-" * len(header))

if __name__ == "__main__":
    main()
