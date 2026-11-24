#!/usr/bin/env python3
"""
RESEARCH & BACKTEST: TIME-COMPRESSION & ACCELERATED VELOCITY SUITE
==================================================================
Objective: Reduce time dependency and accelerate the timeline to Milestone 1 (+25u),
without violating Risk Ceiling Gate (Worst Day > -12.0%, Breakers = 0).

Hypotheses to Test:
  1. Quick Take Profit (Intraday/Swing Exit): Lock in +7% to +10% gains actively and free slot immediately.
  2. Holding Period: 2-Day vs 3-Day rebalance cycle with Eager Retry.
  3. Short-Term Momentum Acceleration: Blending 3-day short momentum with 14-day trend momentum.
  4. Rolling Time Distribution to Milestone 1 (+48.4% capital growth).
"""

import csv
import math
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
    "BZUSDT", "SKHYNIXUSDT", "SNDKUSDT", "SKHYUSDT", "PAXGUSDT", "XAUTUSDT"
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
    reb_period: int = 3,
    max_mom_slots: int = 2,
    mom_alloc_pct: float = 0.24,
    quick_tp_pct: float | None = None, # e.g. 0.08 (+8.0% active profit exit)
    momentum_mode: str = "14d", # "14d" or "blended_3d_14d"
    enable_time_decay_exit: bool = True,
    stagnation_days: int = 2,
    stagnation_max_ret_thresh: float = 0.02,
    stagnation_curr_ret_thresh: float = -0.05,
):
    cash = 100.0
    held_mom: list[dict] = []
    since_reb = 0
    daily_pnls: list[tuple[str, float, float, float]] = []
    btc_prices = [p.get("BTCUSDT", 0.0) for p in prices]
    breaker_trips = 0
    min_eq_obs = cash
    peak_eq = cash
    max_dd = 0.0
    same_day_cooldown: dict[str, int] = {}
    eq_series: list[float] = []

    trade_stats = {
        "total_trades": 0,
        "winning_trades": 0,
        "sl_hit_initial": 0,
        "sl_hit_breakeven": 0,
        "sl_hit_lock": 0,
        "quick_tp_exits": 0,
        "stagnation_exits": 0,
        "rebalance_exits": 0,
        "retry_entries": 0,
    }

    def equity(px):
        unrl = sum((px.get(p["sym"], p["entry"]) - p["entry"]) * p["qty"] for p in held_mom)
        return cash + unrl

    for idx in range(15, len(prices)):
        today_date = dates[idx]
        today = prices[idx]
        yesterday = prices[idx - 1]
        start_eq = equity(yesterday)
        curr_eq = start_eq

        if curr_eq < min_eq_obs: min_eq_obs = curr_eq
        if curr_eq > peak_eq: peak_eq = curr_eq
        dd = (peak_eq - curr_eq) / peak_eq if peak_eq > 0 else 0.0
        if dd > max_dd: max_dd = dd

        mom_alloc = max(5.0, curr_eq * mom_alloc_pct)
        daily_loss_limit = max(12.0, curr_eq * 0.12)

        btc_today = today.get("BTCUSDT", 0.0)
        btc_yesterday = yesterday.get("BTCUSDT", 0.0)
        btc_1d_ret = (btc_today - btc_yesterday) / btc_yesterday if btc_yesterday > 0 else 0.0

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

        # 1. Position Evaluation & Active Exits
        surviving_mom = []
        for pos in held_mom:
            pos["days_held"] = pos.get("days_held", 0) + 1
            s, e, q = pos["sym"], pos["entry"], pos["qty"]
            if s not in today:
                surviving_mom.append(pos)
                continue
            close = today[s]
            ret = (close - e) / e
            if ret > pos["max_ret"]: pos["max_ret"] = ret

            # Early-Lock Ratchet
            if pos["max_ret"] >= 0.14:
                if pos["current_sl"] < 0.10: pos["current_sl"] = 0.10; pos["tier"] = "lock3"
            elif pos["max_ret"] >= 0.10:
                if pos["current_sl"] < 0.06: pos["current_sl"] = 0.06; pos["tier"] = "lock2"
            elif pos["max_ret"] >= 0.07:
                if pos["current_sl"] < 0.035: pos["current_sl"] = 0.035; pos["tier"] = "lock1"
            elif pos["max_ret"] >= 0.05:
                if pos["current_sl"] < 0.008: pos["current_sl"] = 0.008; pos["tier"] = "breakeven"

            # Quick Take Profit Exit (Harvest profit immediately & free slot)
            if quick_tp_pct is not None and ret >= quick_tp_pct:
                trade_pnl = (close - e) * q - close * q * FEE_TAKER
                cash += trade_pnl
                trade_stats["total_trades"] += 1
                trade_stats["winning_trades"] += 1
                trade_stats["quick_tp_exits"] += 1
                continue

            # SL trigger
            if ret <= pos["current_sl"]:
                trade_pnl = (close - e) * q - close * q * FEE_TAKER
                cash += trade_pnl
                trade_stats["total_trades"] += 1
                if trade_pnl > 0: trade_stats["winning_trades"] += 1
                if "lock" in pos["tier"]: trade_stats["sl_hit_lock"] += 1
                elif pos["tier"] == "breakeven": trade_stats["sl_hit_breakeven"] += 1
                else: trade_stats["sl_hit_initial"] += 1

                if pos["current_sl"] <= -0.03: same_day_cooldown[s] = idx
                continue

            # Time-Decay Loser Pruning
            if enable_time_decay_exit and pos["days_held"] >= stagnation_days:
                if pos["max_ret"] < stagnation_max_ret_thresh and ret <= stagnation_curr_ret_thresh:
                    trade_pnl = (close - e) * q - close * q * FEE_TAKER
                    cash += trade_pnl
                    trade_stats["total_trades"] += 1
                    trade_stats["stagnation_exits"] += 1
                    if trade_pnl > 0: trade_stats["winning_trades"] += 1
                    continue

            surviving_mom.append(pos)
        held_mom = surviving_mom

        # 2. Circuit Breaker
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

        # 3. Momentum Candidate Selection
        def get_candidate_scores(excluded_set):
            scores = []
            past14 = prices[idx - 14]
            past3 = prices[idx - 3]
            for s in symbols:
                if s == "BTCUSDT" or s in blacklisted_now or s in excluded_set or same_day_cooldown.get(s, -1) == idx:
                    continue
                if s in today and s in past14 and s in past3:
                    ret14 = (today[s] - past14[s]) / past14[s]
                    ret3 = (today[s] - past3[s]) / past3[s]
                    if momentum_mode == "blended_3d_14d":
                        # 60% weight on 3-day impulse surge, 40% weight on 14-day trend foundation
                        score = ret3 * 0.6 + ret14 * 0.4
                    else:
                        score = ret14
                    scores.append((score, s))
            scores.sort(reverse=True)
            return scores

        # 4. Rebalance & Eager Retry
        since_reb += 1
        is_rebalance_day = (since_reb >= reb_period) and not fired
        btc_blocking = (btc_1d_ret <= -0.03)

        if is_rebalance_day:
            since_reb = 0
            for pos in held_mom:
                exit_p = today.get(pos["sym"], pos["entry"])
                trade_pnl = (exit_p - pos["entry"]) * pos["qty"] - exit_p * pos["qty"] * FEE_TAKER
                cash += trade_pnl
                trade_stats["rebalance_exits"] += 1
                trade_stats["total_trades"] += 1
                if trade_pnl > 0: trade_stats["winning_trades"] += 1
            held_mom = []

            if not btc_blocking:
                scores = get_candidate_scores(set())
                for score, s in scores:
                    if score <= 0.02 or len(held_mom) == max_mom_slots: break
                    cash -= mom_alloc * FEE_TAKER
                    held_mom.append({
                        "sym": s, "entry": today[s], "qty": mom_alloc / today[s],
                        "current_sl": -0.12, "max_ret": 0.0, "tier": "initial", "days_held": 0
                    })

        elif not fired and len(held_mom) < max_mom_slots and not btc_blocking:
            cur_held = {p["sym"] for p in held_mom}
            scores = get_candidate_scores(cur_held)
            for score, s in scores:
                if score <= 0.02 or len(held_mom) == max_mom_slots: break
                cash -= mom_alloc * FEE_TAKER
                held_mom.append({
                    "sym": s, "entry": today[s], "qty": mom_alloc / today[s],
                    "current_sl": -0.12, "max_ret": 0.0, "tier": "initial", "days_held": 0
                })
                trade_stats["retry_entries"] += 1

        end_eq = equity(today)
        d_pnl = end_eq - start_eq
        d_pnl_pct = d_pnl / start_eq if start_eq > 0 else 0.0
        daily_pnls.append((today_date, d_pnl, d_pnl_pct, end_eq))
        eq_series.append(end_eq)

    final_eq = equity(prices[-1])
    net_pnl = final_eq - 100.0
    worst_day_pct = min(d[2] for d in daily_pnls) * 100
    winrate = trade_stats["winning_trades"] / trade_stats["total_trades"] * 100 if trade_stats["total_trades"] > 0 else 0.0

    # Calculate rolling days to achieve +48.35% (Milestone 1)
    durations = []
    for i in range(len(eq_series)):
        start_val = eq_series[i]
        target_val = start_val * 1.4835
        for j in range(i + 1, min(i + 400, len(eq_series))):
            if eq_series[j] >= target_val:
                durations.append(j - i)
                break
    durations.sort()
    p50_days = durations[int(len(durations) * 0.50)] if durations else 999
    p25_days = durations[int(len(durations) * 0.25)] if durations else 999

    return {
        "final_eq": final_eq,
        "net_pnl": net_pnl,
        "cagr": (final_eq / 100.0) ** (365.25 / len(daily_pnls)) - 1.0,
        "worst_day_pct": worst_day_pct,
        "max_dd": max_dd,
        "breakers": breaker_trips,
        "winrate": winrate,
        "total_trades": trade_stats["total_trades"],
        "quick_tp_exits": trade_stats["quick_tp_exits"],
        "p50_days": p50_days,
        "p25_days": p25_days,
    }

def main():
    dates, symbols, prices = load_data()

    experiments = [
        ("1. Baseline Live (3-Day Holding, No Quick TP, 14d Mom)", 3, None, "14d"),
        ("2. Quick TP +8% (Harvest +8% & Free Slot immediately)", 3, 0.08, "14d"),
        ("3. Quick TP +10% (Harvest +10% & Free Slot immediately)", 3, 0.10, "14d"),
        ("4. Quick TP +12% (Harvest +12% & Free Slot immediately)", 3, 0.12, "14d"),
        ("5. 2-Day Holding Cycle (Faster turnover, no Quick TP)", 2, None, "14d"),
        ("6. 2-Day Cycle + Quick TP +8%", 2, 0.08, "14d"),
        ("7. Blended Momentum (3d Surge + 14d Trend, 3-Day Holding)", 3, None, "blended_3d_14d"),
        ("8. Blended Momentum + Quick TP +8%", 3, 0.08, "blended_3d_14d"),
    ]

    print("=" * 125)
    print(f"{'Experiment Configuration':<58} | {'Final Eq':<9} | {'Net PnL':<9} | {'CAGR':<6} | {'Worst Day':<9} | {'MDD':<6} | {'Brk':<3} | {'P50 Days':<8}")
    print("-" * 125)

    for name, reb, qtp, mom_m in experiments:
        r = run_simulation(
            dates, symbols, prices,
            reb_period=reb,
            max_mom_slots=2,
            mom_alloc_pct=0.24,
            quick_tp_pct=qtp,
            momentum_mode=mom_m,
            enable_time_decay_exit=True,
        )
        print(f"{name:<58} | {r['final_eq']:>7.2f}u | {r['net_pnl']:>+7.2f}u | {r['cagr']*100:>5.1f}% | {r['worst_day_pct']:>8.2f}% | {r['max_dd']*100:>4.1f}% | {r['breakers']:>3} | {r['p50_days']:>3}d ({r['p50_days']/30.4:>3.1f}m)")

if __name__ == "__main__":
    main()

def test_trend_filter_boost():
    dates, symbols, prices = load_data()
    print("\n" + "=" * 125)
    print("TESTING REGIME-BASED VELOCITY: BOOST ONLY WHEN BTC IS IN HEALTHY BULL TREND")
    print("=" * 125)
    
    # Hypothesis: When BTC 1d return is positive and BTC > 10 EMA, can we expand allocation to 26% safely?
    # Or does it still violate Gate 1?
    for alloc_boost in [0.24, 0.25, 0.26]:
        cash = 100.0
        held_mom = []
        daily_pnls = []
        btc_prices = [p.get("BTCUSDT", 0.0) for p in prices]
        breaker_trips = 0
        since_reb = 0
        peak_eq = cash
        max_dd = 0.0
        same_day_cooldown = {}
        eq_series = []

        def equity(px):
            unrl = sum((px.get(p["sym"], p["entry"]) - p["entry"]) * p["qty"] for p in held_mom)
            return cash + unrl

        for idx in range(15, len(prices)):
            today_date = dates[idx]
            today = prices[idx]
            yesterday = prices[idx - 1]
            start_eq = equity(yesterday)
            curr_eq = start_eq

            if curr_eq > peak_eq: peak_eq = curr_eq
            dd = (peak_eq - curr_eq) / peak_eq if peak_eq > 0 else 0.0
            if dd > max_dd: max_dd = dd

            btc_today = today.get("BTCUSDT", 0.0)
            btc_yesterday = yesterday.get("BTCUSDT", 0.0)
            btc_1d_ret = (btc_today - btc_yesterday) / btc_yesterday if btc_yesterday > 0 else 0.0

            btc_w = [p for p in btc_prices[idx-10:idx] if p > 0]
            btc_ema = sum(btc_w) / len(btc_w) if len(btc_w) >= 8 else btc_today
            is_bull_regime = (btc_today > btc_ema and btc_1d_ret > 0.0)

            # Dynamic allocation: boost slightly during healthy bull regime, stay at 24% otherwise
            alloc = alloc_boost if is_bull_regime else 0.24
            mom_alloc = max(5.0, curr_eq * alloc)
            daily_loss_limit = max(12.0, curr_eq * 0.12)

            # Position eval
            surviving = []
            for pos in held_mom:
                pos["days_held"] = pos.get("days_held", 0) + 1
                s, e, q = pos["sym"], pos["entry"], pos["qty"]
                if s not in today: surviving.append(pos); continue
                close = today[s]
                ret = (close - e) / e
                if ret > pos["max_ret"]: pos["max_ret"] = ret

                if pos["max_ret"] >= 0.14:
                    if pos["current_sl"] < 0.10: pos["current_sl"] = 0.10
                elif pos["max_ret"] >= 0.10:
                    if pos["current_sl"] < 0.06: pos["current_sl"] = 0.06
                elif pos["max_ret"] >= 0.07:
                    if pos["current_sl"] < 0.035: pos["current_sl"] = 0.035
                elif pos["max_ret"] >= 0.05:
                    if pos["current_sl"] < 0.008: pos["current_sl"] = 0.008

                if ret <= pos["current_sl"]:
                    cash += (close - e) * q - close * q * FEE_TAKER
                    if pos["current_sl"] <= -0.03: same_day_cooldown[s] = idx
                    continue

                if pos["days_held"] >= 2 and pos["max_ret"] < 0.02 and ret <= -0.05:
                    cash += (close - e) * q - close * q * FEE_TAKER
                    continue
                surviving.append(pos)
            held_mom = surviving

            mid_eq = equity(today)
            if (mid_eq - start_eq) <= -daily_loss_limit:
                breaker_trips += 1
                for pos in held_mom:
                    p_c = today.get(pos["sym"], pos["entry"])
                    cash += (p_c - pos["entry"]) * pos["qty"] - p_c * pos["qty"] * FEE_TAKER
                held_mom = []

            # Rebalance
            since_reb = since_reb + 1
            if since_reb >= 3 and (mid_eq - start_eq) > -daily_loss_limit:
                since_reb = 0
                for pos in held_mom:
                    p_c = today.get(pos["sym"], pos["entry"])
                    cash += (p_c - pos["entry"]) * pos["qty"] - p_c * pos["qty"] * FEE_TAKER
                held_mom = []
                if btc_1d_ret > -0.03:
                    past = prices[idx - 14]
                    scores = []
                    for s in symbols:
                        if s == "BTCUSDT" or same_day_cooldown.get(s, -1) == idx: continue
                        if s in today and s in past:
                            scores.append(((today[s] - past[s]) / past[s], s))
                    scores.sort(reverse=True)
                    for score, s in scores:
                        if score <= 0.02 or len(held_mom) == 2: break
                        cash -= mom_alloc * FEE_TAKER
                        held_mom.append({"sym": s, "entry": today[s], "qty": mom_alloc / today[s], "current_sl": -0.12, "max_ret": 0.0, "days_held": 0})

            elif (mid_eq - start_eq) > -daily_loss_limit and len(held_mom) < 2 and btc_1d_ret > -0.03:
                cur_held = {p["sym"] for p in held_mom}
                past = prices[idx - 14]
                scores = []
                for s in symbols:
                    if s == "BTCUSDT" or s in cur_held or same_day_cooldown.get(s, -1) == idx: continue
                    if s in today and s in past:
                        scores.append(((today[s] - past[s]) / past[s], s))
                scores.sort(reverse=True)
                for score, s in scores:
                    if score <= 0.02 or len(held_mom) == 2: break
                    cash -= mom_alloc * FEE_TAKER
                    held_mom.append({"sym": s, "entry": today[s], "qty": mom_alloc / today[s], "current_sl": -0.12, "max_ret": 0.0, "days_held": 0})

            end_eq = equity(today)
            daily_pnls.append((today_date, end_eq - start_eq, (end_eq - start_eq) / start_eq, end_eq))
            eq_series.append(end_eq)

        final_eq = equity(prices[-1])
        worst_day = min(d[2] for d in daily_pnls) * 100
        durations = []
        for i in range(len(eq_series)):
            target = eq_series[i] * 1.4835
            for j in range(i + 1, min(i + 400, len(eq_series))):
                if eq_series[j] >= target:
                    durations.append(j - i)
                    break
        durations.sort()
        p50 = durations[int(len(durations) * 0.50)] if durations else 999
        print(f"Alloc Boost: {alloc_boost*100:.0f}% in Bull | Final Eq: {final_eq:.2f}u | Net: {final_eq-100:+.2f}u | Worst Day: {worst_day:.2f}% | Breakers: {breaker_trips} | P50 Days: {p50}d ({p50/30.4:.1f}m)")

test_trend_filter_boost()
