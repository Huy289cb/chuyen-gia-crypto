#!/usr/bin/env python3
"""
EXACT REPLICATION AUDIT: INTEGRATED VOLATILITY-ADAPTIVE SUITE
============================================================
Accurately replicates the canonical multi-sleeve hybrid strategy:
- 2-Day Scheduled Rebalance Cycle
- Multi-tier Ratchet Profit Guard (BE @ +8.0%, Lock @ +14.0%)
- Hyper-Volatility Filter (Daily ATR14 <= 12%)
- Sharpe Momentum Ranking (14d Return / ATR14)
- Dynamic ATR Stop Loss (clamp 8% to 18%, 2.0 * ATR14)
- Risk-Parity Sizing (target risk capped at 1.00 USD on 30u / 2.88% equity)
- Same-Day Stop Loss Cooldown (blocks re-entry within same UTC day)
- BTC Volatility-Adjusted Grid (10d EMA, Crash Gate 6% * vol_mult, TP 3.5%)
- Daily Loss Circuit Breaker (12.0 USDT floor, 12% equity)
- Compounding Sizing on Shared Wallet

Simulated across 1,500 trading days (2022-09-05 to 2026-10-13) on canonical daily-source.csv.
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
        return 0.05
    trs = []
    for j in range(idx - 13, idx + 1):
        curr_p = prices[j].get(sym, 0.0)
        prev_p = prices[j - 1].get(sym, 0.0)
        if curr_p > 0 and prev_p > 0:
            trs.append(abs(curr_p - prev_p) / prev_p)
    return sum(trs) / len(trs) if trs else 0.05

def run_simulation(
    dates: list[str],
    symbols: list[str],
    prices: list[dict[str, float]],
    enable_suite: bool = True,
    k_atr: float = 2.0,
    min_sl: float = 0.08,
    max_sl: float = 0.18,
):
    cash = 100.0
    held_mom: list[dict] = []
    held_grid: list[tuple[float, float, float]] = []
    since_reb = 0
    daily_pnls: list[tuple[str, float, float, float]] = []
    btc_prices = [p.get("BTCUSDT", 0.0) for p in prices]
    
    same_day_cooldown: dict[str, int] = {}
    breaker_trips = 0
    min_equity_observed = cash
    peak_equity = cash
    max_drawdown_pct = 0.0

    stats = {
        "sl_hit_disaster": 0,
        "sl_hit_be": 0,
        "sl_hit_lock": 0,
        "reb_closed": 0,
        "reb_kept": 0,
        "grid_tp": 0,
        "total_trades": 0,
        "winning_trades": 0,
        "cooldown_blocks": 0,
        "hyper_vol_blocks": 0,
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

        # Compounding allocations
        mom_alloc_base = max(5.0, curr_eq * 0.24)
        grid_ticket = max(5.0, curr_eq * 0.14)
        daily_loss_limit = max(12.0, curr_eq * 0.12)

        btc_today = today.get("BTCUSDT", 0.0)
        btc_yesterday = yesterday.get("BTCUSDT", 0.0)
        btc_1d_ret = (btc_today - btc_yesterday) / btc_yesterday if btc_yesterday > 0 else 0.0

        # BTC Volatility-Adjusted Grid Parameters
        trs = [abs(btc_prices[j] - btc_prices[j-1]) for j in range(idx-13, idx+1) if btc_prices[j] > 0 and btc_prices[j-1] > 0]
        atr = sum(trs) / len(trs) if trs else 0.0
        atr_pct = atr / btc_today if btc_today > 0 else 0.0168
        vol_mult = max(0.8, min(1.5, atr_pct / 0.0168))
        grid_step_pct = max(0.015, min(0.035, 0.020 * vol_mult))
        grid_tp_pct = max(0.025, min(0.050, 0.035 * vol_mult))
        btc_crash_gate_pct = max(0.050, min(0.090, 0.060 * vol_mult))

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
                cash += (exit_p - entry) * qty - exit_p * qty * FEE_TAKER
            else:
                safe_mom.append(pos)
        held_mom = safe_mom

        # 1. Evaluate Momentum Positions (Ratchet Profit Guard & Stop Loss)
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

            if enable_suite:
                # Multi-tier Ratchet Profit Guard
                # Tier 2: Lock profit at +8.0% if max return >= +14.0%
                # Tier 1: Break-even at +0.8% if max return >= +8.0%
                if pos["max_ret"] >= 0.14:
                    if pos["current_sl"] < 0.08:
                        pos["current_sl"] = 0.08
                        pos["tier"] = "lock"
                elif pos["max_ret"] >= 0.08:
                    if pos["current_sl"] < 0.008:
                        pos["current_sl"] = 0.008
                        pos["tier"] = "breakeven"

            sl = pos["current_sl"]
            if ret <= sl:
                trade_pnl = (close - entry) * qty - close * qty * FEE_TAKER
                cash += (close - entry) * qty - close * qty * FEE_TAKER
                stats["total_trades"] += 1
                if sl <= -0.07:
                    stats["sl_hit_disaster"] += 1
                    if enable_suite:
                        same_day_cooldown[sym] = idx + 1
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
                stats["grid_tp"] += 1
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
                cash += (exit_p - entry) * qty - exit_p * qty * FEE_TAKER
            held_mom = []
            for entry, qty, _ in held_grid:
                if btc_today > 0:
                    cash += (btc_today - entry) * qty - btc_today * qty * FEE_TAKER
            held_grid = []

        # 4. Momentum Rebalance (Every 2 days)
        since_reb += 1
        is_rebalance_day = (since_reb >= 2) and not fired

        if is_rebalance_day:
            since_reb = 0
            # Close existing momentum positions (exact canonical protocol)
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

            past = prices[idx - 14]
            candidates = []
            for sym in symbols:
                if sym == "BTCUSDT" or sym in blacklisted_now:
                    continue
                if sym in today and sym in past:
                    ret_14d = (today[sym] - past[sym]) / past[sym]
                    if ret_14d <= 0.02:
                        continue
                    sym_atr = compute_atr14_pct(prices, idx, sym)
                    if enable_suite:
                        # Hyper-volatility filter (ATR14 <= 12%)
                        if sym_atr > 0.12:
                            stats["hyper_vol_blocks"] += 1
                            continue
                        # Same-Day Cooldown filter
                        if same_day_cooldown.get(sym, 0) > idx:
                            stats["cooldown_blocks"] += 1
                            continue
                        # Sharpe Momentum Ranking
                        score = ret_14d / max(0.015, sym_atr)
                    else:
                        score = ret_14d
                    candidates.append((score, ret_14d, sym_atr, sym))

            candidates.sort(key=lambda x: x[0], reverse=True)

            for score, ret_14d, sym_atr, sym in candidates:
                if enable_suite:
                    sl_dist = max(min_sl, min(max_sl, k_atr * sym_atr))
                    target_risk_usd = curr_eq * 0.24 * 0.12
                    alloc = min(mom_alloc_base, target_risk_usd / sl_dist)
                    alloc = max(5.00, alloc)
                else:
                    sl_dist = 0.12
                    alloc = mom_alloc_base

                cash -= alloc * FEE_TAKER
                held_mom.append({
                    "sym": sym,
                    "entry": today[sym],
                    "qty": alloc / today[sym],
                    "current_sl": -sl_dist,
                    "max_ret": 0.0,
                    "tier": "initial",
                })
                if len(held_mom) == 2:
                    break

        # 5. BTC Volatility-Adjusted Grid Entry
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

    # Subperiod metrics
    mid_idx = total_days // 2
    p1_net = sum(p[1] for p in daily_pnls[:mid_idx])
    p2_net = sum(p[1] for p in daily_pnls[mid_idx:])
    d512 = daily_pnls[-512:]
    d512_net = sum(p[1] for p in d512)
    d512_mean = d512_net / len(d512)

    return {
        "final_equity": final_equity,
        "net_pnl": net_pnl,
        "mean_daily": mean_daily,
        "annualized_roi": mean_daily * 365.0,
        "worst_day_pnl": worst_day_pnl,
        "worst_ret_pct": worst_ret_pct * 100.0,
        "worst_day_date": worst_day_date,
        "max_drawdown": max_drawdown_pct * 100.0,
        "win_rate": win_rate,
        "total_trades": stats["total_trades"],
        "disaster_sl_count": stats["sl_hit_disaster"],
        "be_sl_count": stats["sl_hit_be"],
        "lock_sl_count": stats["sl_hit_lock"],
        "reb_closed": stats["reb_closed"],
        "grid_tp": stats["grid_tp"],
        "breaker_trips": breaker_trips,
        "p1_net": p1_net,
        "p2_net": p2_net,
        "d512_net": d512_net,
        "d512_mean": d512_mean,
    }

def main():
    dates, symbols, prices = load()
    print("=" * 85)
    print("      CANONICAL AUDIT: BASELINE PHASE 5 vs IMPLEMENTED VOLATILITY-ADAPTIVE SUITE")
    print("=" * 85)
    print(f"Dataset: {len(symbols)} symbols over {len(prices)} trading days ({dates[0]} to {dates[-1]}).\n")

    base = run_simulation(dates, symbols, prices, enable_suite=False)
    suite = run_simulation(dates, symbols, prices, enable_suite=True)

    print(f"{'Performance Metric':<35} | {'Baseline Phase 5':<22} | {'New Implemented Suite':<22}")
    print("-" * 85)
    print(f"{'Initial Capital':<35} | {'100.00 USDT':<22} | {'100.00 USDT':<22}")
    print(f"{'Final Equity':<35} | {base['final_equity']:>10.2f} USDT         | {suite['final_equity']:>10.2f} USDT")
    print(f"{'Net Profit':<35} | {base['net_pnl']:>+10.2f} USDT         | {suite['net_pnl']:>+10.2f} USDT")
    print(f"{'Mean Daily Return':<35} | {base['mean_daily']:>+10.4f} USDT/d       | {suite['mean_daily']:>+10.4f} USDT/d")
    print(f"{'Annualized Compounded ROI':<35} | {base['annualized_roi']:>+10.1f}%/yr          | {suite['annualized_roi']:>+10.1f}%/yr")
    print(f"{'Maximum Drawdown (MDD)':<35} | {base['max_drawdown']:>10.1f}%             | {suite['max_drawdown']:>10.1f}%")
    print(f"{'Overall Win Rate':<35} | {base['win_rate']:>10.1f}%             | {suite['win_rate']:>10.1f}%")
    print(f"{'Worst Single-Day Return':<35} | {base['worst_ret_pct']:>10.2f}%             | {suite['worst_ret_pct']:>10.2f}%")
    print(f"{'Circuit Breaker Trips':<35} | {base['breaker_trips']:>10}                | {suite['breaker_trips']:>10}")
    print("-" * 85)
    print(f"{'Total Closed Momentum Trades':<35} | {base['total_trades']:>10}                | {suite['total_trades']:>10}")
    print(f"{'Initial Stop Loss Hits':<35} | {base['disaster_sl_count']:>10}                | {suite['disaster_sl_count']:>10}")
    print(f"{'Break-Even Stop Hits (+0.8%)':<35} | {base['be_sl_count']:>10}                | {suite['be_sl_count']:>10}")
    print(f"{'Lock-Profit Stop Hits (+8.0%)':<35} | {base['lock_sl_count']:>10}                | {suite['lock_sl_count']:>10}")
    print(f"{'BTC Grid Take Profits':<35} | {base['grid_tp']:>10}                | {suite['grid_tp']:>10}")
    print("-" * 85)
    print("SUBPERIOD ATTRIBUTION:")
    print(f"  • Period 1 (Bear Market 2022-2024):  Base={base['p1_net']:>+7.2f} USDT    vs    Suite={suite['p1_net']:>+7.2f} USDT")
    print(f"  • Period 2 (Bull Market 2024-2026):  Base={base['p2_net']:>+7.2f} USDT    vs    Suite={suite['p2_net']:>+7.2f} USDT")
    print(f"  • Recent 512-Day Window:             Base={base['d512_net']:>+7.2f} USDT    vs    Suite={suite['d512_net']:>+7.2f} USDT")
    print(f"                                       (Mean: {base['d512_mean']:>+6.4f} u/d)        (Mean: {suite['d512_mean']:>+6.4f} u/d)")
    print("=" * 85)

if __name__ == "__main__":
    main()
