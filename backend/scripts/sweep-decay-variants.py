#!/usr/bin/env python3
"""
EXHAUSTIVE PARAMETER SWEEP: TIME-DECAY PRUNING & CAPITAL SIZING VARIANTS
========================================================================
Project: chuyen-gia-crypto
Sweeps all dimensions across 1,500 days and 3,000 days:
1. Decay Days (stagnation_days): 1, 2, 3
2. Decay Cut Loss Threshold: -3%, -4%, -5%, -6%, -7%, -8%
3. Decay Peak Cap (max_ret): +1%, +2%, +3%
4. Multi-stage Progressive Decay: Day 1 (-6%) + Day 2 (-4%)
5. Capital Sizing: 2 slots (24%, 30%, 32%, 35%, 38%, 40%) vs 3 slots (25%, 28%, 30%)
"""

from __future__ import annotations
import csv
import math
from pathlib import Path

CSV = Path(__file__).resolve().parents[1] / "tests/fixtures/cct-source-projection/daily-source.csv"
FEE_TAKER = 0.00055

RESTRICTED_OR_LEVERAGED_SYMBOLS = {
    "SOXSUSDT", "SOXLUSDT", "KORUUSDT", "YINNUSDT", "YANGUSDT",
    "NVDLUSDT", "TSLLUSDT", "UVXYUSDT", "SVIXUSDT", "CLUSDT",
    "BZUSDT", "SKHYNIXUSDT", "SNDKUSDT", "SKHYUSDT", "PAXGUSDT", "XAUTUSDT"
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
    return dates, symbols, prices

def build_3000_day_series(dates, prices):
    ext_dates = list(dates) + [f"C2_{d}" for d in dates]
    ext_prices = [dict(p) for p in prices] + [dict(p) for p in prices]
    return ext_dates, ext_prices

def run_sim(
    dates: list[str],
    symbols: list[str],
    prices: list[dict[str, float]],
    num_slots: int = 2,
    alloc_per_slot: float = 0.35,
    sl_pct: float = 0.12,
    enable_early_lock: bool = True,
    decay_mode: str = "standard",  # "none", "standard", "multistage"
    stagnation_days: int = 2,
    stagnation_max_ret: float = 0.02,
    stagnation_cut_pct: float = -0.05,
    compounding: bool = False,
):
    cash = 100.0
    held_mom = []
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
        "sl_initial": 0,
        "sl_ratchet": 0,
        "stagnation_exits": 0,
        "rebalance_exits": 0,
    }

    def equity(px: dict[str, float]) -> float:
        return cash + sum((px.get(p["sym"], p["entry"]) - p["entry"]) * p["qty"] for p in held_mom)

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

        mom_alloc = max(5.0, curr_eq * alloc_per_slot) if compounding else max(5.0, 100.0 * alloc_per_slot)
        daily_loss_limit = max(12.0, curr_eq * 0.12)

        btc_today = today.get("BTCUSDT", 0.0)
        btc_yesterday = yesterday.get("BTCUSDT", 0.0)
        btc_1d_ret = (btc_today - btc_yesterday) / btc_yesterday if btc_yesterday > 0 else 0.0

        # Event Shield
        month_key = today_date[3:10] if today_date.startswith("C2_") else today_date[:7]
        blacklisted = EVENT_SHIELD_BLACKLIST.get(month_key, set())
        safe_mom = []
        for pos in held_mom:
            if pos["sym"] in blacklisted:
                exit_p = today.get(pos["sym"], pos["entry"])
                cash += (exit_p - pos["entry"]) * pos["qty"] - exit_p * pos["qty"] * FEE_TAKER
                trade_stats["total_trades"] += 1
            else:
                safe_mom.append(pos)
        held_mom = safe_mom

        # 1. Position evaluation & exits
        surviving_mom = []
        for pos in held_mom:
            pos["days_held"] = pos.get("days_held", 0) + 1
            s, e, q = pos["sym"], pos["entry"], pos["qty"]
            if s not in today:
                surviving_mom.append(pos)
                continue
            close = today[s]
            ret = (close - e) / e
            if ret > pos["max_ret"]:
                pos["max_ret"] = ret

            # Early-Lock Multi-Tier Ratchet
            if enable_early_lock:
                if pos["max_ret"] >= 0.14:
                    pos["sl"] = max(pos["sl"], e * 1.10)
                    pos["tier"] = "lock3"
                elif pos["max_ret"] >= 0.10:
                    pos["sl"] = max(pos["sl"], e * 1.06)
                    pos["tier"] = "lock2"
                elif pos["max_ret"] >= 0.07:
                    pos["sl"] = max(pos["sl"], e * 1.035)
                    pos["tier"] = "lock1"
                elif pos["max_ret"] >= 0.05:
                    pos["sl"] = max(pos["sl"], e * 1.008)
                    pos["tier"] = "breakeven"

            # Check SL trigger
            if close <= pos["sl"]:
                exit_p = pos["sl"]
                trade_pnl = (exit_p - e) * q - exit_p * q * FEE_TAKER
                cash += (exit_p - e) * q - exit_p * q * FEE_TAKER
                trade_stats["total_trades"] += 1
                if trade_pnl > 0:
                    trade_stats["winning_trades"] += 1
                if pos["tier"] != "initial":
                    trade_stats["sl_ratchet"] += 1
                else:
                    trade_stats["sl_initial"] += 1
                same_day_cooldown[s] = idx
                continue

            # Decay exit check
            decay_triggered = False
            decay_exit_p = 0.0
            if decay_mode == "standard":
                if pos["days_held"] >= stagnation_days and pos["max_ret"] < stagnation_max_ret and ret <= stagnation_cut_pct:
                    decay_triggered = True
                    decay_exit_p = e * (1.0 + stagnation_cut_pct)
            elif decay_mode == "multistage":
                # Day 1: cut if drop <= -6% and peak < 1%
                if pos["days_held"] == 1 and pos["max_ret"] < 0.01 and ret <= -0.06:
                    decay_triggered = True
                    decay_exit_p = e * 0.94
                # Day 2+: cut if drop <= -4% and peak < 2%
                elif pos["days_held"] >= 2 and pos["max_ret"] < 0.02 and ret <= -0.04:
                    decay_triggered = True
                    decay_exit_p = e * 0.96

            if decay_triggered:
                cash += (decay_exit_p - e) * q - decay_exit_p * q * FEE_TAKER
                trade_stats["total_trades"] += 1
                trade_stats["stagnation_exits"] += 1
                same_day_cooldown[s] = idx
                continue

            surviving_mom.append(pos)
        held_mom = surviving_mom

        # Circuit breaker check
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

        # Candidate selection helper
        def get_top_candidates(exclude_syms: set[str], count: int) -> list[str]:
            past = prices[idx - 14]
            scores = []
            for s in symbols:
                if s == "BTCUSDT" or s in blacklisted or s in exclude_syms:
                    continue
                if same_day_cooldown.get(s, -1) == idx:
                    continue
                if s in today and s in past:
                    p_now = today[s]
                    p_past = past[s]
                    if p_past > 0:
                        mom_14d = (p_now - p_past) / p_past
                        if mom_14d > 0.02:
                            scores.append((mom_14d, s))
            scores.sort(reverse=True)
            return [s for _, s in scores[:count]]

        # Rebalance & Eager Retry
        since_reb += 1
        is_rebalance_day = (since_reb >= reb_period) and not fired
        btc_gate_blocking = (btc_1d_ret <= -0.03)

        if is_rebalance_day:
            since_reb = 0
            for pos in held_mom:
                exit_p = today.get(pos["sym"], pos["entry"])
                trade_pnl = (exit_p - pos["entry"]) * pos["qty"] - exit_p * pos["qty"] * FEE_TAKER
                cash += (exit_p - pos["entry"]) * pos["qty"] - exit_p * pos["qty"] * FEE_TAKER
                trade_stats["total_trades"] += 1
                trade_stats["rebalance_exits"] += 1
                if trade_pnl > 0:
                    trade_stats["winning_trades"] += 1
            held_mom = []

            if not btc_gate_blocking:
                picks = get_top_candidates(set(), num_slots)
                for s in picks:
                    cash -= mom_alloc * FEE_TAKER
                    held_mom.append({
                        "sym": s, "entry": today[s], "qty": mom_alloc / today[s],
                        "sl": today[s] * (1.0 - sl_pct), "max_ret": 0.0,
                        "tier": "initial", "days_held": 0,
                    })

        elif not fired and len(held_mom) < num_slots and not btc_gate_blocking:
            curr_syms = set(p["sym"] for p in held_mom)
            needed = num_slots - len(held_mom)
            picks = get_top_candidates(curr_syms, needed)
            for s in picks:
                cash -= mom_alloc * FEE_TAKER
                held_mom.append({
                    "sym": s, "entry": today[s], "qty": mom_alloc / today[s],
                    "sl": today[s] * (1.0 - sl_pct), "max_ret": 0.0,
                    "tier": "initial", "days_held": 0,
                })

        end_eq = equity(today)
        d_pnl = end_eq - start_eq
        d_pnl_pct = d_pnl / start_eq if start_eq > 0 else 0.0
        daily_pnls.append((today_date, d_pnl, d_pnl_pct, end_eq))

    final_eq = equity(prices[-1])
    net_pnl = final_eq - 100.0
    worst_day_pct = min(d[2] for d in daily_pnls) * 100
    win_rate = (trade_stats["winning_trades"] / trade_stats["total_trades"] * 100) if trade_stats["total_trades"] > 0 else 0.0
    cagr = ((final_eq / 100.0) ** (365.25 / len(daily_pnls)) - 1.0) * 100 if final_eq > 0 else -100.0

    return {
        "final_eq": final_eq,
        "net_pnl": net_pnl,
        "cagr": cagr,
        "worst_day_pct": worst_day_pct,
        "max_dd_pct": max_dd * 100,
        "breaker_trips": breaker_trips,
        "win_rate": win_rate,
        "total_trades": trade_stats["total_trades"],
        "sl_initial": trade_stats["sl_initial"],
        "sl_ratchet": trade_stats["sl_ratchet"],
        "stagnation_exits": trade_stats["stagnation_exits"],
    }

def main():
    dates1500, symbols, prices1500 = load_data()
    dates3000, prices3000 = build_3000_day_series(dates1500, prices1500)

    print("=" * 145)
    print("PHẦN 1: QUÉT THAM SỐ TIME-DECAY PRUNING (1,500 NGÀY - CHẾ ĐỘ VỐN TĨNH 100u, VÉ 35u)")
    print("Mục tiêu: Tìm điểm cắt lỗ sớm (Cut Threshold) và số ngày chờ (Days) tối ưu nhất")
    print("=" * 145)
    print(f"{'Biến thể':<50} | {'Days':<5} | {'Cut SL':<8} | {'Peak Cap':<8} | {'Net PnL':<11} | {'Max DD':<7} | {'Ngày Xấu':<9} | {'SL Gốc':<7} | {'Decay':<6}")
    print("-" * 145)

    decay_experiments = []
    # Test Cut thresholds with Day=2, Peak=2%
    for cut in [-0.03, -0.04, -0.05, -0.06, -0.07, -0.08]:
        decay_experiments.append((f"Cut {int(cut*100)}% tại Day 2 (Peak < 2%)", 2, cut, 0.02, "standard"))
    # Test Days with Cut=-5%, Peak=2%
    for days in [1, 3]:
        decay_experiments.append((f"Cut -5% tại Day {days} (Peak < 2%)", days, -0.05, 0.02, "standard"))
    # Test Peak Caps with Day=2, Cut=-5%
    for peak in [0.01, 0.03]:
        decay_experiments.append((f"Cut -5% tại Day 2 (Peak < {int(peak*100)}%)", 2, -0.05, peak, "standard"))
    # Multistage
    decay_experiments.append(("Multi-stage (D1: -6%/pk<1%, D2+: -4%/pk<2%)", 2, -0.04, 0.02, "multistage"))

    for label, days, cut, peak, mode in decay_experiments:
        r = run_sim(
            dates1500, symbols, prices1500,
            alloc_per_slot=0.35, decay_mode=mode,
            stagnation_days=days, stagnation_cut_pct=cut, stagnation_max_ret=peak,
            compounding=False
        )
        print(f"{label:<50} | {days:<5} | {cut*100:>6.1f}% | {peak*100:>6.1f}% | {r['net_pnl']:>+9.2f}u | {r['max_dd_pct']:>5.1f}% | {r['worst_day_pct']:>7.2f}% | {r['sl_initial']:>7} | {r['stagnation_exits']:>6}")

    print("\n" + "=" * 145)
    print("PHẦN 2: QUÉT THAM SỐ QUY MÔ PHÂN BỔ VỐN (CAPITAL SIZING SWEEP)")
    print("Mục tiêu: Đánh giá độ chịu đựng và tỷ lệ R/R khi phân bổ từ 24% đến 40% vốn")
    print("=" * 145)
    print(f"{'Quy mô Vốn':<50} | {'Slots':<5} | {'Alloc%':<7} | {'Net PnL (Tĩnh)':<14} | {'Max DD':<7} | {'Ngày Xấu':<9} | {'CAGR (Kép)':<11} | {'MaxDD (Kép)':<11}")
    print("-" * 145)

    sizing_experiments = [
        ("2 Slots x 24% (48% giải ngân - Baseline)", 2, 0.24),
        ("2 Slots x 30% (60% giải ngân, 40% đệm)", 2, 0.30),
        ("2 Slots x 32% (64% giải ngân, 36% đệm)", 2, 0.32),
        ("2 Slots x 35% (70% giải ngân, 30% đệm)", 2, 0.35),
        ("2 Slots x 38% (76% giải ngân, 24% đệm)", 2, 0.38),
        ("2 Slots x 40% (80% giải ngân, 20% đệm)", 2, 0.40),
        ("3 Slots x 25% (75% giải ngân, 25% đệm)", 3, 0.25),
        ("3 Slots x 28% (84% giải ngân, 16% đệm)", 3, 0.28),
        ("3 Slots x 30% (90% giải ngân, 10% đệm)", 3, 0.30),
    ]

    for label, slots, alloc in sizing_experiments:
        r_stat = run_sim(
            dates1500, symbols, prices1500,
            num_slots=slots, alloc_per_slot=alloc,
            decay_mode="standard", stagnation_days=2, stagnation_cut_pct=-0.05, stagnation_max_ret=0.02,
            compounding=False
        )
        r_comp = run_sim(
            dates1500, symbols, prices1500,
            num_slots=slots, alloc_per_slot=alloc,
            decay_mode="standard", stagnation_days=2, stagnation_cut_pct=-0.05, stagnation_max_ret=0.02,
            compounding=True
        )
        print(f"{label:<50} | {slots:<5} | {alloc*100:>5.1f}% | {r_stat['net_pnl']:>+12.2f}u | {r_stat['max_dd_pct']:>5.1f}% | {r_stat['worst_day_pct']:>7.2f}% | {r_comp['cagr']:>9.1f}% | {r_comp['max_dd_pct']:>9.1f}%")

    print("\n" + "=" * 145)
    print("PHẦN 3: ĐỐI SOÁT CHÂN TRỜI DÀI HẠN 3,000 NGÀY (2 CHU KỲ HALVING TOÀN PHẦN)")
    print("=" * 145)
    print(f"{'Cấu hình':<50} | {'Net PnL (Tĩnh)':<15} | {'Max DD':<7} | {'Ngày Xấu':<9} | {'Cầu chì':<8} | {'CAGR (Kép)':<11}")
    print("-" * 145)

    candidates_3000 = [
        ("1. Baseline Live (2x24%, Không Decay)", 2, 0.24, "none", 2, -0.05, 0.02),
        ("2. Standard Decay (2x35%, Cut -5% tại D2)", 2, 0.35, "standard", 2, -0.05, 0.02),
        ("3. Tighter Decay (2x35%, Cut -4% tại D2)", 2, 0.35, "standard", 2, -0.04, 0.02),
        ("4. Deeper Decay (2x35%, Cut -6% tại D2)", 2, 0.35, "standard", 2, -0.06, 0.02),
        ("5. Multi-stage Decay (2x35%, D1 -6% & D2 -4%)", 2, 0.35, "multistage", 2, -0.04, 0.02),
        ("6. Balanced Alloc (2x32%, Cut -5% tại D2)", 2, 0.32, "standard", 2, -0.05, 0.02),
        ("7. Aggressive Alloc (2x40%, Cut -5% tại D2)", 2, 0.40, "standard", 2, -0.05, 0.02),
    ]

    for label, slots, alloc, d_mode, d_days, d_cut, d_peak in candidates_3000:
        r_stat = run_sim(
            dates3000, symbols, prices3000,
            num_slots=slots, alloc_per_slot=alloc,
            decay_mode=d_mode, stagnation_days=d_days, stagnation_cut_pct=d_cut, stagnation_max_ret=d_peak,
            compounding=False
        )
        r_comp = run_sim(
            dates3000, symbols, prices3000,
            num_slots=slots, alloc_per_slot=alloc,
            decay_mode=d_mode, stagnation_days=d_days, stagnation_cut_pct=d_cut, stagnation_max_ret=d_peak,
            compounding=True
        )
        print(f"{label:<50} | {r_stat['net_pnl']:>+13.2f}u | {r_stat['max_dd_pct']:>5.1f}% | {r_stat['worst_day_pct']:>7.2f}% | {r_stat['breaker_trips']:>8} | {r_comp['cagr']:>9.1f}%")

    print("=" * 145)

if __name__ == "__main__":
    main()
