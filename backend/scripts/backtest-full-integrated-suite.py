#!/usr/bin/env python3
"""
INTEGRATED SYSTEM BACKTEST: VOLATILITY-ADAPTIVE HYBRID SUITE
===========================================================
Backtests across 1,500 trading days (2022-2026) comparing:
1. Baseline Phase 5 (Official benchmark)
2. Integrated Suite:
   - Same-Day Stop Loss Cooldown (blocks re-entry within same UTC day)
   - Hyper-Volatility Filter (Daily ATR14% <= 10%)
   - Sharpe Momentum Ranking (Score = Return14d / ATR14%)
   - Dynamic ATR Stop Loss (clamp 8% to 18%, 2.0 * ATR14%)
   - Risk-Parity Sizing (Cap risk per trade to ~2.88% equity / max 1.00u on 30u)
   - Multi-Tier Ratchet Profit Guard (BE @ +8%, Lock+8% @ +14%)
   - BTC Volatility Grid + Compounding
"""

from __future__ import annotations
import csv
from pathlib import Path

CSV = Path(__file__).resolve().parents[1] / "tests/fixtures/cct-source-projection/daily-source.csv"
FEE_TAKER = 0.00055  # 0.05% taker + 0.005% slippage
FEE_MAKER = 0.0002   # 0.02% maker

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

def compute_atr14_pct(prices: list[dict[str, float]], idx: int, sym: str) -> float:
    if idx < 14:
        return 0.04
    trs = []
    for j in range(idx - 13, idx + 1):
        curr_p = prices[j].get(sym, 0.0)
        prev_p = prices[j - 1].get(sym, 0.0)
        if curr_p > 0 and prev_p > 0:
            trs.append(abs(curr_p - prev_p) / prev_p)
    return sum(trs) / len(trs) if trs else 0.04

def run_suite(
    dates: list[str],
    symbols: list[str],
    prices: list[dict[str, float]],
    enable_cooldown: bool = True,
    enable_atr_filter: bool = True,
    max_atr_threshold: float = 0.10,
    enable_sharpe_ranking: bool = True,
    enable_dynamic_sl: bool = True,
    k_atr: float = 2.0,
    min_sl: float = 0.08,
    max_sl: float = 0.18,
    enable_risk_parity_sizing: bool = True,
    target_trade_risk_pct: float = 0.0288, # 24% * 12% = 2.88%
):
    cash = 100.0
    held_mom: list[dict] = []
    held_grid: list[tuple[float, float, float]] = []
    since_reb = 0
    daily_pnls: list[tuple[str, float, float, float]] = []
    btc_prices = [p.get("BTCUSDT", 0.0) for p in prices]
    
    same_day_cooldown: dict[str, int] = {} # sym -> day index
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
        "filtered_high_atr": 0,
        "cooldown_blocks": 0,
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
                cash += (exit_p - entry) * qty - exit_p * qty * FEE_TAKER
            else:
                safe_mom.append(pos)
        held_mom = safe_mom

        # 1. Evaluate Momentum Positions (Ratchet + SL)
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

            # Multi-tier Ratchet Guard
            if pos["max_ret"] >= 0.14:
                if pos["current_sl"] < 0.08:
                    pos["current_sl"] = 0.08
            elif pos["max_ret"] >= 0.08:
                if pos["current_sl"] < 0.008:
                    pos["current_sl"] = 0.008

            sl = pos["current_sl"]
            if ret <= sl:
                trade_pnl = (close - entry) * qty - close * qty * FEE_TAKER
                cash += (close - entry) * qty - close * qty * FEE_TAKER
                stats["total_trades"] += 1
                if sl <= -0.05:
                    stats["sl_hit_disaster"] += 1
                    if enable_cooldown:
                        same_day_cooldown[sym] = idx + 1 # Block for remainder of the day
                elif sl == 0.008:
                    stats["sl_hit_be"] += 1
                    stats["winning_trades"] += 1
                elif sl >= 0.08:
                    stats["sl_hit_lock"] += 1
                    stats["winning_trades"] += 1
            else:
                surviving_mom.append(pos)
        held_mom = surviving_mom

        # 2. Evaluate BTC Grid
        surviving_grid = []
        for entry, qty, tp_price in held_grid:
            if btc_today >= tp_price:
                cash += (tp_price - entry) * qty - tp_price * qty * FEE_MAKER
            else:
                surviving_grid.append((entry, qty, tp_price))
        held_grid = surviving_grid

        # 3. Circuit Breaker
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
                cash += (exit_p - entry) * qty - exit_p * qty * FEE_TAKER
            held_mom = []
            for entry, qty, _ in held_grid:
                if btc_today > 0:
                    cash += (btc_today - entry) * qty - btc_today * qty * FEE_TAKER
            held_grid = []

        # 4. Momentum Rebalance & Selection
        since_reb += 1
        is_rebalance_day = (since_reb >= 2) and not fired

        def rank_candidates(exclude_syms: set[str]):
            past = prices[idx - 14]
            cand = []
            for sym in symbols:
                if sym == "BTCUSDT" or sym in blacklisted_now or sym in exclude_syms:
                    continue
                if sym in today and sym in past:
                    ret_14d = (today[sym] - past[sym]) / past[sym]
                    if ret_14d <= 0.02:
                        continue
                    sym_atr = compute_atr14_pct(prices, idx, sym)
                    if enable_atr_filter and sym_atr > max_atr_threshold:
                        stats["filtered_high_atr"] += 1
                        continue
                    if enable_cooldown and same_day_cooldown.get(sym, 0) > idx:
                        stats["cooldown_blocks"] += 1
                        continue
                    score = ret_14d / max(0.015, sym_atr) if enable_sharpe_ranking else ret_14d
                    cand.append((score, ret_14d, sym_atr, sym))
            cand.sort(key=lambda x: x[0], reverse=True)
            return cand

        def calculate_sl_and_size(sym_atr: float):
            if enable_dynamic_sl:
                sl_dist = max(min_sl, min(max_sl, k_atr * sym_atr))
            else:
                sl_dist = 0.12

            if enable_risk_parity_sizing:
                dollar_risk = max(1.0, curr_eq * target_trade_risk_pct)
                alloc = min(mom_alloc_base, dollar_risk / sl_dist)
                alloc = max(5.0, alloc)
            else:
                alloc = mom_alloc_base
            return sl_dist, alloc

        if is_rebalance_day:
            since_reb = 0
            for pos in held_mom:
                sym = pos["sym"]
                entry = pos["entry"]
                qty = pos["qty"]
                exit_p = today.get(sym, entry)
                trade_pnl = (exit_p - entry) * qty - exit_p * qty * FEE_TAKER
                cash += (exit_p - entry) * qty - exit_p * qty * FEE_TAKER
                stats["reb_closed"] += 1
                stats["total_trades"] += 1
                if trade_pnl > 0:
                    stats["winning_trades"] += 1
            held_mom = []

            candidates = rank_candidates(set())
            for score, ret_14d, sym_atr, sym in candidates:
                sl_dist, alloc = calculate_sl_and_size(sym_atr)
                cash -= alloc * FEE_TAKER
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
            needed = 2 - len(held_mom)
            held_set = {p["sym"] for p in held_mom}
            candidates = rank_candidates(held_set)
            opened = 0
            for score, ret_14d, sym_atr, sym in candidates:
                sl_dist, alloc = calculate_sl_and_size(sym_atr)
                cash -= alloc * FEE_TAKER
                held_mom.append({
                    "sym": sym,
                    "entry": today[sym],
                    "qty": alloc / today[sym],
                    "current_sl": -sl_dist,
                    "max_ret": 0.0,
                })
                opened += 1
                if opened >= needed:
                    break

        # 5. BTC Grid Entry
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
        "worst_day_pnl": worst_day_pnl,
        "worst_ret_pct": worst_ret_pct,
        "max_drawdown": max_drawdown_pct * 100,
        "win_rate": win_rate,
        "total_trades": stats["total_trades"],
        "disaster_sl_count": stats["sl_hit_disaster"],
        "filtered_high_atr": stats["filtered_high_atr"],
        "cooldown_blocks": stats["cooldown_blocks"],
    }

def main():
    dates, symbols, prices = load()
    print(f"Loaded {len(symbols)} symbols over {len(prices)} trading days ({dates[0]} to {dates[-1]}).\n")

    experiments = [
        ("1. Baseline Phase 5 (Fixed 12% SL, No Retry)", False, False, 0.10, False, False, False),
        ("2. Eager Retry Baseline (Fixed 12% SL, No Cooldown)", False, False, 0.10, False, False, False),
        ("3. Variant A: + Same-Day Cooldown Only", True, False, 0.10, False, False, False),
        ("4. Variant B: + Cooldown + ATR Cap (<= 10%)", True, True, 0.10, False, False, False),
        ("5. Variant C: + Cooldown + ATR Cap + Sharpe Ranking", True, True, 0.10, True, False, False),
        ("6. Variant D: Full Suite (Cooldown + ATR Cap + Sharpe + Dyn SL + Sizing)", True, True, 0.10, True, True, True),
        ("7. Variant E: Full Suite Mild (Cooldown + ATR Cap 12% + Sharpe + Dyn SL 10-16%)", True, True, 0.12, True, True, False),
    ]

    header = f"{'Experiment':<52} | {'Final Eq':<9} | {'Net PnL':<10} | {'Mean/d':<8} | {'Max DD':<7} | {'WinRate':<7} | {'SL Hits':<7}"
    print(header)
    print("-" * len(header))

    for label, cd, atr_f, max_atr, sharpe, dyn_sl, sizing in experiments:
        res = run_suite(
            dates, symbols, prices,
            enable_cooldown=cd,
            enable_atr_filter=atr_f,
            max_atr_threshold=max_atr,
            enable_sharpe_ranking=sharpe,
            enable_dynamic_sl=dyn_sl,
            enable_risk_parity_sizing=sizing,
        )
        print(f"{label:<52} | {res['final_equity']:>7.2f}u | {res['net_pnl']:>8.2f}u | {res['mean_daily']:>+6.4f}u | {res['max_drawdown']:>5.1f}% | {res['win_rate']:>5.1f}% | {res['disaster_sl_count']:>7}")

    print("-" * len(header))

if __name__ == "__main__":
    main()
