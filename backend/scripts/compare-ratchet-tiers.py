#!/usr/bin/env python3
"""
Backtest & Quantitative Comparison: Baseline Ratchet vs Aggressive Early-Lock Ratchets
Simulated across 1,500 canonical trading days (2022-09-05 to 2026-10-13) on 40 liquid symbols.
Uses the identical audited simulation engine from verify-phase8-freqtrade-enhancements.py.
"""
from __future__ import annotations
import csv
import math
from pathlib import Path

CSV = Path(__file__).resolve().parents[1] / "tests/fixtures/cct-source-projection/daily-source.csv"
FEE_TAKER = 0.00055
FEE_MAKER = 0.0002

RESTRICTED_OR_LEVERAGED_SYMBOLS = {
    "SOXSUSDT", "SOXLUSDT", "KORUUSDT", "YINNUSDT", "YANGUSDT",
    "NVDLUSDT", "TSLLUSDT", "UVXYUSDT", "SVIXUSDT", "CLUSDT",
    "BZUSDT", "SKHYNIXUSDT", "SNDKUSDT", "SKHYUSDT",
}

EVENT_SHIELD_BLACKLIST = {
    "2023-06": {"FTTUSDT", "SRMUSDT"},
    "2023-11": {"LUNAUSDT", "USTCUSDT"},
    "2024-04": {"OMGUSDT", "WAVESUSDT"},
    "2024-08": {"C98USDT"},
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
    btc_prices = [d.get("BTCUSDT", 0.0) for d in prices]
    return dates, symbols, prices, btc_prices

def run_simulation(
    dates: list[str],
    symbols: list[str],
    prices: list[dict[str, float]],
    btc_prices: list[float],
    ratchet_mode: str = "baseline_4tier",
):
    cash = 100.0
    held_mom = []
    held_grid = []
    daily_pnls = []
    since_reb = 0
    reb_period = 3
    same_day_cooldown = {}
    breaker_trips = 0
    peak_eq = 100.0
    max_dd = 0.0

    trade_stats = {
        "total_trades": 0,
        "winning_trades": 0,
        "sl_hit_initial": 0,
        "sl_hit_risk_reduction": 0,
        "sl_hit_breakeven": 0,
        "sl_hit_lock": 0,
        "stagnation_exits": 0,
        "rebalance_exits": 0,
        "grid_tps": 0,
        "btc_gate_blocks": 0,
    }

    def equity(px: dict[str, float]) -> float:
        unrl = 0.0
        for pos in held_mom:
            s, e, q = pos["sym"], pos["entry"], pos["qty"]
            close = px.get(s, e)
            unrl += (close - e) * q
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

        if curr_eq > peak_eq:
            peak_eq = curr_eq
        dd = (peak_eq - curr_eq) / peak_eq if peak_eq > 0 else 0.0
        if dd > max_dd:
            max_dd = dd

        mom_alloc = max(5.0, curr_eq * 0.24)
        grid_ticket = max(5.0, curr_eq * 0.14)
        daily_loss_limit = max(12.0, curr_eq * 0.12)

        btc_today = today.get("BTCUSDT", 0.0)
        btc_yesterday = yesterday.get("BTCUSDT", 0.0)
        btc_1d_ret = (btc_today - btc_yesterday) / btc_yesterday if btc_yesterday > 0 else 0.0

        trs = [abs(btc_prices[j] - btc_prices[j-1]) for j in range(idx-13, idx+1) if btc_prices[j] > 0 and btc_prices[j-1] > 0]
        atr = sum(trs) / len(trs) if trs else 0.0
        atr_pct = atr / btc_today if btc_today > 0 else 0.0168
        vol_mult = max(0.8, min(1.5, atr_pct / 0.0168))
        grid_step_pct = max(0.015, min(0.035, 0.020 * vol_mult))
        grid_tp_pct = max(0.025, min(0.060, 0.035 * vol_mult))
        btc_crash_gate_pct = max(0.050, min(0.090, 0.060 * vol_mult))

        month_key = today_date[:7]
        blacklisted_now = EVENT_SHIELD_BLACKLIST.get(month_key, set())
        safe_mom = []
        for pos in held_mom:
            if pos["sym"] in blacklisted_now:
                exit_p = today.get(pos["sym"], pos["entry"])
                cash += (exit_p - pos["entry"]) * pos["qty"] - exit_p * pos["qty"] * FEE_TAKER
                trade_stats["total_trades"] += 1
            else:
                safe_mom.append(pos)
        held_mom = safe_mom

        # 1. Momentum Position Evaluation & Ratchet
        surviving_mom = []
        for pos in held_mom:
            pos["days_held"] = pos.get("days_held", 0) + 1
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

            # Ratchet Logic
            if ratchet_mode == "baseline_4tier":
                # Standard Phase 6/7/8: +5% -> -3%, +8% -> +0.8%, +12% -> +5%, +16% -> +10%
                if pos["max_ret"] >= 0.16:
                    if pos["current_sl"] < 0.10:
                        pos["current_sl"] = 0.10
                        pos["tier"] = "lock2"
                elif pos["max_ret"] >= 0.12:
                    if pos["current_sl"] < 0.05:
                        pos["current_sl"] = 0.05
                        pos["tier"] = "lock1"
                elif pos["max_ret"] >= 0.08:
                    if pos["current_sl"] < 0.008:
                        pos["current_sl"] = 0.008
                        pos["tier"] = "breakeven"
                elif pos["max_ret"] >= 0.05:
                    if pos["current_sl"] < -0.03:
                        pos["current_sl"] = -0.03
                        pos["tier"] = "risk_reduction"

            elif ratchet_mode == "early_lock":
                # Proposed Early-Lock: +5% -> +0.8%, +7% -> +3.5%, +10% -> +6%, +14% -> +10%
                if pos["max_ret"] >= 0.14:
                    if pos["current_sl"] < 0.10:
                        pos["current_sl"] = 0.10
                        pos["tier"] = "lock2"
                elif pos["max_ret"] >= 0.10:
                    if pos["current_sl"] < 0.06:
                        pos["current_sl"] = 0.06
                        pos["tier"] = "lock1"
                elif pos["max_ret"] >= 0.07:
                    if pos["current_sl"] < 0.035:
                        pos["current_sl"] = 0.035
                        pos["tier"] = "lock_early"
                elif pos["max_ret"] >= 0.05:
                    if pos["current_sl"] < 0.008:
                        pos["current_sl"] = 0.008
                        pos["tier"] = "breakeven"

            elif ratchet_mode == "tight_lock":
                # Tighter Trail: +5% -> +0.8%, +6% -> +2.5%, +8% -> +4.5%, +12% -> +8%
                if pos["max_ret"] >= 0.12:
                    if pos["current_sl"] < 0.08:
                        pos["current_sl"] = 0.08
                        pos["tier"] = "lock2"
                elif pos["max_ret"] >= 0.08:
                    if pos["current_sl"] < 0.045:
                        pos["current_sl"] = 0.045
                        pos["tier"] = "lock1"
                elif pos["max_ret"] >= 0.06:
                    if pos["current_sl"] < 0.025:
                        pos["current_sl"] = 0.025
                        pos["tier"] = "lock_early"
                elif pos["max_ret"] >= 0.05:
                    if pos["current_sl"] < 0.008:
                        pos["current_sl"] = 0.008
                        pos["tier"] = "breakeven"

            elif ratchet_mode == "hybrid_protect":
                # Hybrid Protect: Keep -3% at +5%, but lock +2.5% at +7%, +5% at +10%, +10% at +15%
                if pos["max_ret"] >= 0.15:
                    if pos["current_sl"] < 0.10:
                        pos["current_sl"] = 0.10
                        pos["tier"] = "lock2"
                elif pos["max_ret"] >= 0.10:
                    if pos["current_sl"] < 0.05:
                        pos["current_sl"] = 0.05
                        pos["tier"] = "lock1"
                elif pos["max_ret"] >= 0.07:
                    if pos["current_sl"] < 0.025:
                        pos["current_sl"] = 0.025
                        pos["tier"] = "lock_early"
                elif pos["max_ret"] >= 0.05:
                    if pos["current_sl"] < -0.03:
                        pos["current_sl"] = -0.03
                        pos["tier"] = "risk_reduction"

            # Check SL trigger
            if ret <= pos["current_sl"]:
                trade_pnl = (close - e) * q - close * q * FEE_TAKER
                cash += (close - e) * q - close * q * FEE_TAKER
                trade_stats["total_trades"] += 1
                if trade_pnl > 0:
                    trade_stats["winning_trades"] += 1
                if "lock" in pos["tier"]:
                    trade_stats["sl_hit_lock"] += 1
                elif pos["tier"] == "breakeven":
                    trade_stats["sl_hit_breakeven"] += 1
                elif pos["tier"] == "risk_reduction":
                    trade_stats["sl_hit_risk_reduction"] += 1
                else:
                    trade_stats["sl_hit_initial"] += 1

                if pos["current_sl"] <= -0.03:
                    same_day_cooldown[s] = idx
                continue

            # Time-Decay Pruning (days >= 2, max_ret < 2%, ret <= -5%)
            if pos["days_held"] >= 2 and pos["max_ret"] < 0.02 and ret <= -0.05:
                trade_pnl = (close - e) * q - close * q * FEE_TAKER
                cash += (close - e) * q - close * q * FEE_TAKER
                trade_stats["total_trades"] += 1
                trade_stats["stagnation_exits"] += 1
                if trade_pnl > 0:
                    trade_stats["winning_trades"] += 1
                continue

            surviving_mom.append(pos)
        held_mom = surviving_mom

        # 2. BTC Grid Take Profit
        surviving_grid = []
        for e, q, tp_price in held_grid:
            if btc_today >= tp_price and btc_today > 0:
                cash += (tp_price - e) * q - tp_price * q * FEE_MAKER
                trade_stats["grid_tps"] += 1
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
                trade_stats["total_trades"] += 1
            held_mom = []
            for e, q, _ in held_grid:
                if btc_today > 0:
                    cash += (btc_today - e) * q - btc_today * q * FEE_TAKER
            held_grid = []

        # 4. Momentum Rebalance & Eager Retry with BTC Trend Health Gate
        since_reb += 1
        is_rebalance_day = (since_reb >= reb_period) and not fired
        btc_gate_blocking = (btc_1d_ret <= -0.03)

        if is_rebalance_day:
            since_reb = 0
            for pos in held_mom:
                exit_p = today.get(pos["sym"], pos["entry"])
                trade_pnl = (exit_p - pos["entry"]) * pos["qty"] - exit_p * pos["qty"] * FEE_TAKER
                cash += (exit_p - pos["entry"]) * pos["qty"] - exit_p * pos["qty"] * FEE_TAKER
                trade_stats["rebalance_exits"] += 1
                trade_stats["total_trades"] += 1
                if trade_pnl > 0:
                    trade_stats["winning_trades"] += 1
            held_mom = []

            if btc_gate_blocking:
                trade_stats["btc_gate_blocks"] += 1
            else:
                past = prices[idx - 14]
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
                        "tier": "initial",
                        "days_held": 0,
                    })
                    if len(held_mom) == 2:
                        break

        elif not fired and len(held_mom) < 2:
            if btc_gate_blocking:
                trade_stats["btc_gate_blocks"] += 1
            else:
                currently_held = {p["sym"] for p in held_mom}
                past = prices[idx - 14]
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
                        "tier": "initial",
                        "days_held": 0,
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
    win_rate = (trade_stats["winning_trades"] / trade_stats["total_trades"] * 100) if trade_stats["total_trades"] > 0 else 0

    # 512-day window metrics
    win_512 = daily_pnls[-512:]
    eq_512_start = win_512[0][3] - win_512[0][1]
    eq_512_end = win_512[-1][3]
    net_512 = eq_512_end - eq_512_start
    mean_512 = sum(d[1] for d in win_512) / len(win_512)

    return {
        "final_equity": final_eq,
        "net_pnl": net_pnl,
        "worst_day_pct": worst_day_pct,
        "max_drawdown_pct": max_dd * 100,
        "mean_daily_pnl": mean_pnl,
        "breaker_trips": breaker_trips,
        "total_trades": trade_stats["total_trades"],
        "win_rate": win_rate,
        "sl_hit_lock": trade_stats["sl_hit_lock"],
        "sl_hit_breakeven": trade_stats["sl_hit_breakeven"],
        "sl_hit_risk_reduction": trade_stats["sl_hit_risk_reduction"],
        "sl_hit_initial": trade_stats["sl_hit_initial"],
        "stagnation_exits": trade_stats["stagnation_exits"],
        "rebalance_exits": trade_stats["rebalance_exits"],
        "grid_tps": trade_stats["grid_tps"],
        "net_512": net_512,
        "mean_512": mean_512,
    }

def main():
    dates, symbols, prices, btc_prices = load_data()
    print("=" * 80)
    print("QUANTITATIVE COMPARISON: RATCHET PROFIT GUARD CONFIGURATIONS (1,500 DAYS)")
    print("=" * 80)

    configs = [
        ("baseline_4tier", "BASELINE 4-TIER (+5%->-3%, +8%->+0.8%, +12%->+5%, +16%->+10%)"),
        ("early_lock",     "PROPOSED EARLY-LOCK (+5%->+0.8%, +7%->+3.5%, +10%->+6%, +14%->+10%)"),
        ("tight_lock",     "TIGHT-LOCK (+5%->+0.8%, +6%->+2.5%, +8%->+4.5%, +12%->+8%)"),
        ("hybrid_protect", "HYBRID-PROTECT (+5%->-3%, +7%->+2.5%, +10%->+5%, +15%->+10%)"),
    ]

    for mode, label in configs:
        res = run_simulation(dates, symbols, prices, btc_prices, ratchet_mode=mode)
        print(f"\n>>> {label}")
        print(f"    Final Equity:       ${res['final_equity']:.2f} (Net: +${res['net_pnl']:.2f})")
        print(f"    512-day Net PnL:    +${res['net_512']:.2f} (Mean: +${res['mean_512']:.4f}/day)")
        print(f"    Max Drawdown:       {res['max_drawdown_pct']:.2f}% | Worst Day: {res['worst_day_pct']:.2f}%")
        print(f"    Win Rate:           {res['win_rate']:.1f}% ({res['total_trades']} total trades)")
        print(f"    Exit Breakdown:     Lock SL: {res['sl_hit_lock']} | BE: {res['sl_hit_breakeven']} | -3% SL: {res['sl_hit_risk_reduction']} | Initial SL: {res['sl_hit_initial']} | Rebalance: {res['rebalance_exits']}")
        print(f"    Circuit Breakers:   {res['breaker_trips']}")

    print("\n" + "=" * 80)

if __name__ == "__main__":
    main()
