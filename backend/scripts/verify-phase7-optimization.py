#!/usr/bin/env python3
"""
DEEP SEARCH FOR GENUINE ALPHA SURPLUS (PHASE 7 EXPERIMENTS)
Systematically evaluates:
- Trend Regime Filter (BTC 50-day EMA)
- Holding Period (1-day, 2-day, 3-day)
- Momentum Lookback (7d, 10d, 14d, 21d)
- Wide Ratchet Parameter Sweeps (+12%/+5%, +14%/+8%, +16%/+10%)
- Grid TP Tuning (3.0%, 3.5%, 4.0%, 4.5%)
"""

from __future__ import annotations
import csv
import math
import sys
from pathlib import Path

CSV = Path(__file__).resolve().parents[1] / "tests/fixtures/cct-source-projection/daily-source.csv"
FEE_TAKER = 0.00055
FEE_MAKER = 0.0002

EVENT_SHIELD_BLACKLIST = {
    "2022-05": {"LUNAUSDT", "USTUSDT"},
    "2022-11": {"FTTUSDT", "SRMUSDT"},
}

RESTRICTED_OR_LEVERAGED_SYMBOLS = {
    "SOXSUSDT", "SOXLUSDT", "KORUUSDT", "YINNUSDT", "YANGUSDT",
    "NVDLUSDT", "TSLLUSDT", "UVXYUSDT", "SVIXUSDT", "CLUSDT",
    "BZUSDT", "SKHYNIXUSDT", "SNDKUSDT", "SKHYUSDT",
}

def load_data():
    with CSV.open() as handle:
        rows = list(csv.reader(handle))
    symbols = [s for s in rows[0][1:] if s not in RESTRICTED_OR_LEVERAGED_SYMBOLS]
    dates = []
    prices = []
    for row in rows[1:]:
        dates.append(row[0])
        day = {}
        for index, symbol in enumerate(rows[0][1:]):
            if symbol in RESTRICTED_OR_LEVERAGED_SYMBOLS:
                continue
            raw = row[index + 1].strip()
            if raw:
                val = float(raw)
                if val > 0:
                    day[symbol] = val
        prices.append(day)
    return dates, symbols, prices

def run_simulation(
    dates: list[str],
    symbols: list[str],
    prices: list[dict[str, float]],
    config: dict,
):
    cash = 100.0
    held_mom: list[dict] = []
    held_grid: list[tuple[float, float, float]] = []
    since_reb = 0
    daily_pnls: list[tuple[str, float, float, float]] = []
    btc_prices = [p.get("BTCUSDT", 0.0) for p in prices]
    breaker_trips = 0
    min_eq_obs = cash
    peak_eq = cash
    max_dd = 0.0
    same_day_cooldown: dict[str, int] = {}

    mom_pct = config.get("mom_pct", 0.24)
    grid_pct = config.get("grid_pct", 0.14)
    reb_period = config.get("reb_period", 2)
    lookback = config.get("lookback", 14)
    grid_base_tp = config.get("grid_base_tp", 0.035)
    r_be_trig = config.get("r_be_trig", 0.08)
    r_be_sl = config.get("r_be_sl", 0.008)
    r_lock_trig = config.get("r_lock_trig", 0.14)
    r_lock_sl = config.get("r_lock_sl", 0.08)
    use_regime = config.get("use_regime", False)

    def equity(px):
        unrl = 0.0
        for pos in held_mom:
            s, e, q = pos["sym"], pos["entry"], pos["qty"]
            unrl += (px.get(s, e) - e) * q
        btc_p = px.get("BTCUSDT", 0.0)
        for e, q, _ in held_grid:
            if btc_p > 0:
                unrl += (btc_p - e) * q
        return cash + unrl

    for idx in range(15, len(prices)):
        today_date = dates[idx]
        today = prices[idx]
        yesterday = prices[idx - 1]
        start_eq = equity(yesterday)
        curr_eq = start_eq

        if curr_eq < min_eq_obs:
            min_eq_obs = curr_eq
        if curr_eq > peak_eq:
            peak_eq = curr_eq
        dd = (peak_eq - curr_eq) / peak_eq if peak_eq > 0 else 0.0
        if dd > max_dd:
            max_dd = dd

        # Regime adjustment
        effective_mom_pct = mom_pct
        if use_regime:
            btc_50_window = [p for p in btc_prices[idx-40:idx] if p > 0]
            if len(btc_50_window) >= 30:
                btc_sma50 = sum(btc_50_window) / len(btc_50_window)
                if btc_today < btc_sma50:
                    effective_mom_pct = mom_pct * 0.75  # defensive sizing in bear trend

        mom_alloc = max(5.0, curr_eq * effective_mom_pct)
        grid_ticket = max(5.0, curr_eq * grid_pct)
        daily_loss_limit = max(12.0, curr_eq * 0.12)

        btc_today = today.get("BTCUSDT", 0.0)
        btc_yesterday = yesterday.get("BTCUSDT", 0.0)
        btc_1d_ret = (btc_today - btc_yesterday) / btc_yesterday if btc_yesterday > 0 else 0.0

        trs = [abs(btc_prices[j] - btc_prices[j-1]) for j in range(idx-13, idx+1) if btc_prices[j] > 0 and btc_prices[j-1] > 0]
        atr = sum(trs) / len(trs) if trs else 0.0
        atr_pct = atr / btc_today if btc_today > 0 else 0.0168
        vol_mult = max(0.8, min(1.5, atr_pct / 0.0168))
        grid_step_pct = max(0.015, min(0.035, 0.020 * vol_mult))
        grid_tp_pct = max(0.025, min(0.060, grid_base_tp * vol_mult))
        btc_crash_gate_pct = max(0.050, min(0.090, 0.060 * vol_mult))

        # Event Shield
        month_key = today_date[:7]
        blacklisted_now = EVENT_SHIELD_BLACKLIST.get(month_key, set())
        safe_mom = []
        for pos in held_mom:
            if pos["sym"] in blacklisted_now:
                exit_p = today.get(pos["sym"], pos["entry"])
                cash += (exit_p - pos["entry"]) * pos["qty"] - exit_p * pos["qty"] * FEE_TAKER
            else:
                safe_mom.append(pos)
        held_mom = safe_mom

        # 1. Momentum Position Evaluation & Ratchet
        surviving_mom = []
        for pos in held_mom:
            s = pos["sym"]
            e = pos["entry"]
            q = pos["qty"]
            if s not in today:
                surviving_mom.append(pos)
                continue
            close = today[s]
            ret = (close - e) / e
            if ret > pos["max_ret"]:
                pos["max_ret"] = ret

            if pos["max_ret"] >= r_lock_trig:
                if pos["current_sl"] < r_lock_sl:
                    pos["current_sl"] = r_lock_sl
                    pos["tier"] = "lock"
            elif pos["max_ret"] >= r_be_trig:
                if pos["current_sl"] < r_be_sl:
                    pos["current_sl"] = r_be_sl
                    pos["tier"] = "breakeven"

            if ret <= pos["current_sl"]:
                cash += (close - e) * q - close * q * FEE_TAKER
                if pos["current_sl"] <= -0.03:
                    same_day_cooldown[s] = idx
            else:
                surviving_mom.append(pos)
        held_mom = surviving_mom

        # 2. BTC Grid Take Profit
        surviving_grid = []
        for e, q, tp_price in held_grid:
            if btc_today >= tp_price and btc_today > 0:
                cash += (tp_price - e) * q - tp_price * q * FEE_MAKER
            else:
                surviving_grid.append((e, q, tp_price))
        held_grid = surviving_grid

        # 3. Circuit Breaker Check
        mid_eq = equity(today)
        mid_day_pnl = mid_eq - start_eq
        fired = mid_day_pnl <= -daily_loss_limit
        if fired:
            breaker_trips += 1
            for pos in held_mom:
                exit_p = today.get(pos["sym"], pos["entry"])
                cash += (exit_p - pos["entry"]) * pos["qty"] - exit_p * pos["qty"] * FEE_TAKER
            held_mom = []
            for e, q, _ in held_grid:
                if btc_today > 0:
                    cash += (btc_today - e) * q - btc_today * q * FEE_TAKER
            held_grid = []

        # 4. Momentum Rebalance & Eager Retry
        since_reb += 1
        is_rebalance_day = (since_reb >= reb_period) and not fired

        if is_rebalance_day:
            since_reb = 0
            for pos in held_mom:
                exit_p = today.get(pos["sym"], pos["entry"])
                cash += (exit_p - pos["entry"]) * pos["qty"] - exit_p * pos["qty"] * FEE_TAKER
            held_mom = []

            past = prices[idx - lookback]
            scores = []
            for s in symbols:
                if s == "BTCUSDT" or s in blacklisted_now:
                    continue
                if same_day_cooldown.get(s, -1) == idx:
                    continue
                if s in today and s in past:
                    ret = (today[s] - past[s]) / past[s]
                    scores.append((ret, s))
            scores.sort(reverse=True)
            for score, s in scores:
                if score <= 0.02:
                    break
                cash -= mom_alloc * FEE_TAKER
                held_mom.append({
                    "sym": s,
                    "entry": today[s],
                    "qty": mom_alloc / today[s],
                    "current_sl": -0.12,
                    "max_ret": 0.0,
                    "tier": "initial"
                })
                if len(held_mom) == 2:
                    break

        elif not fired and len(held_mom) < 2:
            currently_held = {p["sym"] for p in held_mom}
            past = prices[idx - lookback]
            scores = []
            for s in symbols:
                if s == "BTCUSDT" or s in blacklisted_now or s in currently_held:
                    continue
                if same_day_cooldown.get(s, -1) == idx:
                    continue
                if s in today and s in past:
                    ret = (today[s] - past[s]) / past[s]
                    scores.append((ret, s))
            scores.sort(reverse=True)
            for score, s in scores:
                if score <= 0.02:
                    break
                cash -= mom_alloc * FEE_TAKER
                held_mom.append({
                    "sym": s,
                    "entry": today[s],
                    "qty": mom_alloc / today[s],
                    "current_sl": -0.12,
                    "max_ret": 0.0,
                    "tier": "initial"
                })
                if len(held_mom) == 2:
                    break

        # 5. BTC Grid Dip Entry
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

        # End of day settlement
        end_eq = equity(today)
        d_pnl = end_eq - start_eq
        d_pnl_pct = d_pnl / start_eq if start_eq > 0 else 0.0
        daily_pnls.append((today_date, d_pnl, d_pnl_pct, end_eq))

    final_eq = equity(prices[-1])
    net_pnl = final_eq - 100.0
    worst_day_pct = min(d[2] for d in daily_pnls) * 100
    mean_pnl = sum(d[1] for d in daily_pnls) / len(daily_pnls)

    half = len(daily_pnls) // 2
    p1_net = sum(d[1] for d in daily_pnls[:half])
    p2_net = sum(d[1] for d in daily_pnls[half:])
    rec512_net = sum(d[1] for d in daily_pnls[-512:])

    return {
        "final_eq": final_eq,
        "net_pnl": net_pnl,
        "mean_daily": mean_pnl,
        "worst_day_pct": worst_day_pct,
        "max_dd_pct": max_dd * 100,
        "breaker_trips": breaker_trips,
        "p1_net": p1_net,
        "p2_net": p2_net,
        "rec512_net": rec512_net,
    }

def main():
    dates, symbols, prices = load_data()

    experiments = [
        ("Phase 6 Baseline (14d lookback, 2d reb, wide ratchet)", {}),
        ("Exp 1: Lookback 10-Day (Faster Momentum)", {"lookback": 10}),
        ("Exp 2: Lookback 21-Day (Macro Trend)", {"lookback": 21}),
        ("Exp 3: Rebalance 3-Day (Lower Churn)", {"reb_period": 3}),
        ("Exp 4: Rebalance 1-Day (High Turnover)", {"reb_period": 1}),
        ("Exp 5: BTC Grid Base TP 4.0% (vs 3.5%)", {"grid_base_tp": 0.040}),
        ("Exp 6: BTC Grid Base TP 4.5% (vs 3.5%)", {"grid_base_tp": 0.045}),
        ("Exp 7: Wide Ratchet Shift (+10% BE, +16% Lock +10%)", {"r_be_trig": 0.10, "r_be_sl": 0.01, "r_lock_trig": 0.16, "r_lock_sl": 0.10}),
        ("Exp 8: Wide Ratchet Shift (+9% BE, +15% Lock +9%)", {"r_be_trig": 0.09, "r_be_sl": 0.01, "r_lock_trig": 0.15, "r_lock_sl": 0.09}),
        ("Exp 9: Wide Ratchet Relaxed (+7% BE, +13% Lock +7%)", {"r_be_trig": 0.07, "r_be_sl": 0.008, "r_lock_trig": 0.13, "r_lock_sl": 0.07}),
        ("Exp 10: Trend Regime Filter (SMA50 BTC defensive)", {"use_regime": True}),
        ("Exp 11: Combined: Grid TP 4.0% + Ratchet +9%/+15%", {"grid_base_tp": 0.040, "r_be_trig": 0.09, "r_be_sl": 0.01, "r_lock_trig": 0.15, "r_lock_sl": 0.09}),
    ]

    print("=" * 115)
    print(f"{'Experiment Architecture':<55} | {'Final Eq':<9} | {'Net PnL':<22} | {'Worst Day %':<11} | {'MDD %':<7} | {'Trips'}")
    print("=" * 115)

    baseline_net = None
    for name, cfg in experiments:
        res = run_simulation(dates, symbols, prices, cfg)
        if baseline_net is None:
            baseline_net = res["net_pnl"]
        diff = res["net_pnl"] - baseline_net
        diff_str = f"({diff:+.2f}u)" if name != experiments[0][0] else "(BASELINE)"
        pnl_col = f"{res['net_pnl']:>+8.2f}u {diff_str}"
        print(f"{name:<55} | {res['final_eq']:>7.2f}u | {pnl_col:<22} | {res['worst_day_pct']:>9.2f}% | {res['max_dd_pct']:>5.1f}% | {res['breaker_trips']}")

if __name__ == "__main__":
    main()
