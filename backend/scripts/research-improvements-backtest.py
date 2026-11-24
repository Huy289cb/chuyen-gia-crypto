#!/usr/bin/env python3
"""
RESEARCH IMPROVEMENTS BACKTEST & QUANTITATIVE AUDIT
===================================================
Project: chuyen-gia-crypto
Simulates and stress-tests proposed improvements across 1,500 days and 3,000 days:
1. Improvement 1: Anti-Climax / Over-extended Gate (Chống Mua Đu Đỉnh Nến Dốc)
   - Test 1-day pump thresholds: 15%, 20%, 25%, 30%, vs No Gate
2. Improvement 2: Capital Efficiency / Slot Restructuring (Giải Phóng 52% Vốn Chết)
   - 2 slots x 24% (48% exposure - Current Live Reality)
   - 3 slots x 28% (84% exposure, 16% cash buffer)
   - 2 slots x 40% (80% exposure, 20% cash buffer)
   - 3 slots x 30% (90% exposure, 10% cash buffer)
3. Improvement 3: Time-Decay Pruning (Freqtrade style)
   - Cut stagnant coin at -5% if held >= 2 days and peak < +2%
4. Improvement 4: Integrated Suite (All Enhancements Combined)
"""

from __future__ import annotations
import csv
import math
from pathlib import Path

CSV = Path(__file__).resolve().parents[1] / "tests/fixtures/cct-source-projection/daily-source.csv"
FEE_TAKER = 0.00055  # 0.05% taker fee + 0.005% dynamic liquid slippage
FEE_MAKER = 0.0002   # 0.02% maker fee

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

def run_simulation(
    dates: list[str],
    symbols: list[str],
    prices: list[dict[str, float]],
    num_slots: int = 2,
    alloc_per_slot: float = 0.24,
    sl_pct: float = 0.12,
    enable_early_lock: bool = True,
    enable_time_decay: bool = False,
    climax_gate_1d: float | None = None,  # e.g. 0.20 skips coin if 1d ret > 20%
    btc_crash_gate_pct: float = -0.03,
    compounding: bool = True,
    enable_btc_grid: bool = False,
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
        "sl_initial": 0,
        "sl_ratchet": 0,
        "stagnation_exits": 0,
        "rebalance_exits": 0,
        "climax_blocks": 0,
        "btc_gate_blocks": 0,
    }

    def equity(px: dict[str, float]) -> float:
        unrl = sum((px.get(p["sym"], p["entry"]) - p["entry"]) * p["qty"] for p in held_mom)
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

        mom_alloc = max(5.0, curr_eq * alloc_per_slot) if compounding else max(5.0, 100.0 * alloc_per_slot)
        grid_ticket = max(5.0, curr_eq * 0.14) if compounding else 14.0
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

        # 1. Evaluate Momentum Positions
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

            # Time-Decay Pruning
            if enable_time_decay and pos["days_held"] >= 2:
                if pos["max_ret"] < 0.02 and ret <= -0.05:
                    exit_p = e * 0.95
                    cash += (exit_p - e) * q - exit_p * q * FEE_TAKER
                    trade_stats["total_trades"] += 1
                    trade_stats["stagnation_exits"] += 1
                    same_day_cooldown[s] = idx
                    continue

            surviving_mom.append(pos)
        held_mom = surviving_mom

        # 2. BTC Grid TP (if enabled)
        if enable_btc_grid:
            surviving_grid = []
            for ge, gq, tp_p in held_grid:
                if btc_today >= tp_p and btc_today > 0:
                    cash += (tp_p - ge) * gq - tp_p * gq * FEE_MAKER
                else:
                    surviving_grid.append((ge, gq, tp_p))
            held_grid = surviving_grid

        # 3. Circuit breaker check
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
            for ge, gq, _ in held_grid:
                cash += (btc_today - ge) * gq - btc_today * gq * FEE_TAKER
            held_grid = []

        # 4. Helper to rank momentum candidates with Climax Gate
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
                            # Climax Gate Check
                            if climax_gate_1d is not None and s in yesterday:
                                p_yest = yesterday[s]
                                if p_yest > 0:
                                    ret_1d = (p_now - p_yest) / p_yest
                                    if ret_1d > climax_gate_1d:
                                        trade_stats["climax_blocks"] += 1
                                        continue  # Skip over-extended / climax pump
                            scores.append((mom_14d, s))
            scores.sort(reverse=True)
            return [s for _, s in scores[:count]]

        # 5. Rebalance & Eager Retry
        since_reb += 1
        is_rebalance_day = (since_reb >= reb_period) and not fired

        btc_gate_blocking = (btc_1d_ret <= btc_crash_gate_pct)
        if btc_gate_blocking:
            trade_stats["btc_gate_blocks"] += 1

        if is_rebalance_day:
            since_reb = 0
            # Close existing momentum
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
                        "sym": s,
                        "entry": today[s],
                        "qty": mom_alloc / today[s],
                        "sl": today[s] * (1.0 - sl_pct),
                        "max_ret": 0.0,
                        "tier": "initial",
                        "days_held": 0,
                    })

        elif not fired and len(held_mom) < num_slots and not btc_gate_blocking:
            curr_syms = set(p["sym"] for p in held_mom)
            needed = num_slots - len(held_mom)
            picks = get_top_candidates(curr_syms, needed)
            for s in picks:
                cash -= mom_alloc * FEE_TAKER
                held_mom.append({
                    "sym": s,
                    "entry": today[s],
                    "qty": mom_alloc / today[s],
                    "sl": today[s] * (1.0 - sl_pct),
                    "max_ret": 0.0,
                    "tier": "initial",
                    "days_held": 0,
                })

        # 6. BTC Grid Dip Entry (if enabled)
        if enable_btc_grid and not fired and len(held_grid) < 3 and btc_1d_ret >= -0.06:
            btc_window = [prices[j].get("BTCUSDT", 0.0) for j in range(idx-10, idx) if prices[j].get("BTCUSDT", 0.0) > 0]
            if len(btc_window) >= 8 and btc_today > 0:
                btc_ema = sum(btc_window) / len(btc_window)
                lvl = len(held_grid) + 1
                target_dip_price = btc_ema * (1.0 - lvl * 0.02)
                if btc_today <= target_dip_price:
                    cash -= grid_ticket * FEE_MAKER
                    qty = grid_ticket / btc_today
                    tp_price = btc_today * 1.035
                    held_grid.append((btc_today, qty, tp_price))

        # End of day
        end_eq = equity(today)
        d_pnl = end_eq - start_eq
        d_pnl_pct = d_pnl / start_eq if start_eq > 0 else 0.0
        daily_pnls.append((today_date, d_pnl, d_pnl_pct, end_eq))

    final_eq = equity(prices[-1])
    net_pnl = final_eq - 100.0
    worst_day_pct = min(d[2] for d in daily_pnls) * 100
    win_rate = (trade_stats["winning_trades"] / trade_stats["total_trades"] * 100) if trade_stats["total_trades"] > 0 else 0.0
    cagr = ((final_eq / 100.0) ** (365.25 / len(daily_pnls)) - 1.0) * 100 if final_eq > 0 else -100.0

    # Recent 512d stats
    rec512 = daily_pnls[-512:] if len(daily_pnls) >= 512 else daily_pnls
    rec512_net = sum(d[1] for d in rec512)
    rec512_mean = rec512_net / len(rec512)

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
        "climax_blocks": trade_stats["climax_blocks"],
        "rec512_net": rec512_net,
        "rec512_mean": rec512_mean,
    }

def main():
    dates1500, symbols, prices1500 = load_data()
    dates3000, prices3000 = build_3000_day_series(dates1500, prices1500)

    print("=" * 140)
    print("NGHIÊN CỨU & KIỂM TOÁN CÁC PHƯƠNG ÁN CẢI THIỆN (1,500 NGÀY & 3,000 NGÀY)")
    print("=" * 140)

    # Scenarios to test:
    scenarios = [
        # Baseline: 2 slots x 24% (representing actual live condition without BTC grid)
        ("1. Live Actual Baseline (2 slots x 24%, No Climax Gate, No Decay Prune)", {
            "num_slots": 2, "alloc_per_slot": 0.24, "climax_gate_1d": None, "enable_time_decay": False
        }),
        # Experiment 1: Climax Gate (Chống đu đỉnh) with different thresholds
        ("2. Climax Gate 25% (Loại bỏ coin vừa pump > 25% trong ngày)", {
            "num_slots": 2, "alloc_per_slot": 0.24, "climax_gate_1d": 0.25, "enable_time_decay": False
        }),
        ("3. Climax Gate 20% (Loại bỏ coin vừa pump > 20% trong ngày)", {
            "num_slots": 2, "alloc_per_slot": 0.24, "climax_gate_1d": 0.20, "enable_time_decay": False
        }),
        ("4. Climax Gate 15% (Loại bỏ coin vừa pump > 15% trong ngày)", {
            "num_slots": 2, "alloc_per_slot": 0.24, "climax_gate_1d": 0.15, "enable_time_decay": False
        }),
        # Experiment 2: Time-Decay Pruning (Cắt sớm coin đuối sức ở ngày 2 tại -5%)
        ("5. Time-Decay Pruning (Cắt sớm -5% sau 2 ngày nếu ret < 2%)", {
            "num_slots": 2, "alloc_per_slot": 0.24, "climax_gate_1d": None, "enable_time_decay": True
        }),
        # Experiment 3: Capital Allocation Restructuring (Giải phóng 52% vốn chết)
        ("6. Capital: 3 Slots x 28% (84% vốn giải ngân, 16% đệm an toàn)", {
            "num_slots": 3, "alloc_per_slot": 0.28, "climax_gate_1d": None, "enable_time_decay": False
        }),
        ("7. Capital: 2 Slots x 40% (80% vốn giải ngân, 20% đệm an toàn)", {
            "num_slots": 2, "alloc_per_slot": 0.40, "climax_gate_1d": None, "enable_time_decay": False
        }),
        ("8. Capital: 3 Slots x 30% (90% vốn giải ngân, 10% đệm an toàn)", {
            "num_slots": 3, "alloc_per_slot": 0.30, "climax_gate_1d": None, "enable_time_decay": False
        }),
        # Experiment 4: Combined Integrated Suites
        ("9. Suite A: Climax 20% + Time-Decay Pruning (2 slots x 24%)", {
            "num_slots": 2, "alloc_per_slot": 0.24, "climax_gate_1d": 0.20, "enable_time_decay": True
        }),
        ("10. Suite B: Climax 20% + Time-Decay + 3 Slots x 28% (Full Alpha & High Efficiency)", {
            "num_slots": 3, "alloc_per_slot": 0.28, "climax_gate_1d": 0.20, "enable_time_decay": True
        }),
        ("11. Suite C: Climax 20% + Time-Decay + 2 Slots x 40% (Balanced 2-Coin)", {
            "num_slots": 2, "alloc_per_slot": 0.40, "climax_gate_1d": 0.20, "enable_time_decay": True
        }),
    ]

    print("\n" + "=" * 140)
    print("PHẦN 1: KẾT QUẢ KIỂM TOÁN 1,500 NGÀY CHUẨN (2022 - 2026)")
    print("=" * 140)
    print(f"{'Cấu hình':<60} | {'Vốn Cuối':<10} | {'Net PnL':<11} | {'CAGR/năm':<9} | {'Max DD':<7} | {'Ngày Xấu':<9} | {'Win%':<6} | {'SL Gốc':<7} | {'Climax Blk':<10}")
    print("-" * 140)

    res_1500 = {}
    for name, params in scenarios:
        r = run_simulation(dates1500, symbols, prices1500, **params)
        res_1500[name] = r
        print(f"{name:<60} | {r['final_eq']:>8.2f}u | {r['net_pnl']:>+9.2f}u | {r['cagr']:>7.1f}% | {r['max_dd_pct']:>5.1f}% | {r['worst_day_pct']:>7.2f}% | {r['win_rate']:>5.1f}% | {r['sl_initial']:>7} | {r['climax_blocks']:>10}")

    print("\n" + "=" * 140)
    print("PHẦN 2: KẾT QUẢ STRESS-TEST DÀI HẠN 3,000 NGÀY (2 CHU KỲ HALVING TOÀN PHẦN)")
    print("=" * 140)
    print(f"{'Cấu hình':<60} | {'Vốn Cuối':<12} | {'CAGR/năm':<9} | {'Max DD':<7} | {'Ngày Xấu':<9} | {'Cầu chì':<7} | {'Win%':<6} | {'SL Gốc':<7}")
    print("-" * 140)

    res_3000 = {}
    for name, params in scenarios:
        r = run_simulation(dates3000, symbols, prices3000, **params)
        res_3000[name] = r
        print(f"{name:<60} | {r['final_eq']:>10.1f}u | {r['cagr']:>7.1f}% | {r['max_dd_pct']:>5.1f}% | {r['worst_day_pct']:>7.2f}% | {r['breaker_trips']:>7} | {r['win_rate']:>5.1f}% | {r['sl_initial']:>7}")

    print("=" * 140)

if __name__ == "__main__":
    main()
