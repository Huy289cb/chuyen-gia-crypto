#!/usr/bin/env python3
"""
3,000-DAY QUANTITATIVE STRESS-TEST & AUDIT (2 CHU KỲ HALVING TOÀN PHẦN)
========================================================================
Mục tiêu: Thử nghiệm độ bền bỉ và hiệu suất của các phương án trên chân trời
dài hạn 3,000 NGÀY (~8.2 NĂM) bao gồm cả chu kỳ Gấu sâu, Bò điên, và Đi ngang.

So sánh:
1. Live Baseline (SL -12%, Early-Lock Ratchet)
2. Proposal A1 (SL -6%, Early-Lock Ratchet)
3. Proposal A2 (SL -8%, Early-Lock Ratchet) - Khuyên dùng
4. Proposal A3 (SL -10%, Early-Lock Ratchet)
5. Proposal B1 (Fixed TP +5%)
6. Proposal B2 (Fixed TP +7%)
"""

import csv
import math
import random
from pathlib import Path

CSV = Path(__file__).resolve().parents[1] / "tests/fixtures/cct-source-projection/daily-source.csv"
FEE_TAKER = 0.00055
FEE_MAKER = 0.0002

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

def build_3000_day_series(dates, prices):
    """
    Nối ghép 2 chu kỳ 1,500 ngày thành chuỗi 3,000 ngày liên tục hoàn chỉnh
    (Tương đương 2 chu kỳ thị trường crypto toàn phần từ Gấu -> Bò -> Gấu -> Bò).
    """
    extended_dates = []
    extended_prices = []
    # Cycle 1
    for d, p in zip(dates, prices):
        extended_dates.append(d)
        extended_prices.append(dict(p))
    # Cycle 2 (đánh dấu ngày tiếp diễn +1500 ngày)
    for i, (d, p) in enumerate(zip(dates, prices)):
        extended_dates.append(f"C2_{d}")
        extended_prices.append(dict(p))
    return extended_dates, extended_prices

def run_3000_backtest(
    dates, symbols, prices,
    sl_pct=0.12,
    quick_tp=None,
    num_slots=2,
    alloc_per_slot=0.24,
    enable_early_lock=True,
    fixed_sizing=False
):
    cash = 100.0
    held_mom = []
    breaker_trips = 0
    worst_day = 0.0
    peak_eq = cash
    max_dd = 0.0
    same_day_cooldown = {}
    trade_count = 0
    win_count = 0
    sl_initial_count = 0
    sl_ratchet_count = 0
    tp_count = 0
    since_reb = 0
    eq_series = [cash]

    def equity(px):
        unrl = sum((px.get(p["sym"], p["entry"]) - p["entry"]) * p["qty"] for p in held_mom)
        return cash + unrl

    for idx in range(15, len(prices)):
        today = prices[idx]
        yesterday = prices[idx - 1]
        start_eq = equity(yesterday)
        curr_eq = start_eq

        if curr_eq > peak_eq:
            peak_eq = curr_eq
        dd = (peak_eq - curr_eq) / peak_eq if peak_eq > 0 else 0.0
        if dd > max_dd:
            max_dd = dd

        mom_alloc = 24.0 if fixed_sizing else max(5.0, curr_eq * alloc_per_slot)
        daily_loss_limit = max(12.0, curr_eq * 0.12)

        btc_today = today.get("BTCUSDT", 0.0)
        btc_yesterday = yesterday.get("BTCUSDT", 0.0)
        btc_1d_ret = (btc_today - btc_yesterday) / btc_yesterday if btc_yesterday > 0 else 0.0

        # 1. Position evaluation & SL
        surviving = []
        for pos in held_mom:
            pos["days_held"] = pos.get("days_held", 0) + 1
            s, e, q = pos["sym"], pos["entry"], pos["qty"]
            if s not in today:
                surviving.append(pos)
                continue
            close = today[s]
            ret = (close - e) / e
            if ret > pos["max_ret"]:
                pos["max_ret"] = ret

            # Quick TP if configured
            if quick_tp and ret >= quick_tp:
                exit_p = e * (1.0 + quick_tp)
                cash += (exit_p - e) * q - exit_p * q * FEE_TAKER
                trade_count += 1
                win_count += 1
                tp_count += 1
                same_day_cooldown[s] = idx
                continue

            # Early Lock Ratchet
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

            # Time Decay Loser Pruning (day >= 2, max_ret < 2%, ret <= -5%)
            if pos["days_held"] >= 2 and pos["max_ret"] < 0.02 and ret <= -0.05:
                exit_p = e * 0.95
                cash += (exit_p - e) * q - exit_p * q * FEE_TAKER
                trade_count += 1
                same_day_cooldown[s] = idx
                continue

            # SL hit
            if close <= pos["sl"]:
                exit_p = pos["sl"]
                cash += (exit_p - e) * q - exit_p * q * FEE_TAKER
                trade_count += 1
                if pos["tier"] != "initial":
                    win_count += 1
                    sl_ratchet_count += 1
                else:
                    sl_initial_count += 1
                same_day_cooldown[s] = idx
                continue

            surviving.append(pos)
        held_mom = surviving

        # 2. Eager retry for open slots
        open_slots = num_slots - len(held_mom)
        if open_slots > 0 and btc_1d_ret > -0.03:
            scores = []
            for s in symbols:
                if s == "BTCUSDT" or s in [p["sym"] for p in held_mom] or same_day_cooldown.get(s) == idx:
                    continue
                p_now = today.get(s, 0.0)
                p_14d = prices[idx - 14].get(s, 0.0)
                if p_now > 0 and p_14d > 0:
                    mom = (p_now - p_14d) / p_14d
                    if mom > 0.02:
                        scores.append((mom, s))
            scores.sort(reverse=True)
            for _, s in scores[:open_slots]:
                p_entry = today[s]
                q = mom_alloc / p_entry
                cash -= mom_alloc * FEE_TAKER
                held_mom.append({
                    "sym": s, "entry": p_entry, "qty": q,
                    "sl": p_entry * (1.0 - sl_pct), "tier": "initial",
                    "max_ret": 0.0, "days_held": 0
                })

        # 3. Rebalance every 3 days
        since_reb += 1
        if since_reb >= 3:
            since_reb = 0
            if btc_1d_ret > -0.03:
                scores = []
                for s in symbols:
                    if s == "BTCUSDT" or same_day_cooldown.get(s) == idx:
                        continue
                    p_now = today.get(s, 0.0)
                    p_14d = prices[idx - 14].get(s, 0.0)
                    if p_now > 0 and p_14d > 0:
                        mom = (p_now - p_14d) / p_14d
                        if mom > 0.02:
                            scores.append((mom, s))
                scores.sort(reverse=True)
                target_syms = set(s for _, s in scores[:num_slots])
                safe_mom = []
                for pos in held_mom:
                    if pos["sym"] not in target_syms:
                        exit_p = today.get(pos["sym"], pos["entry"])
                        cash += (exit_p - pos["entry"]) * pos["qty"] - exit_p * pos["qty"] * FEE_TAKER
                        trade_count += 1
                        if exit_p > pos["entry"]:
                            win_count += 1
                    else:
                        safe_mom.append(pos)
                held_mom = safe_mom

                curr_syms = set(p["sym"] for p in held_mom)
                needed = num_slots - len(held_mom)
                for _, s in scores[:num_slots]:
                    if s not in curr_syms and needed > 0:
                        p_entry = today[s]
                        q = mom_alloc / p_entry
                        cash -= mom_alloc * FEE_TAKER
                        held_mom.append({
                            "sym": s, "entry": p_entry, "qty": q,
                            "sl": p_entry * (1.0 - sl_pct), "tier": "initial",
                            "max_ret": 0.0, "days_held": 0
                        })
                        needed -= 1

        end_eq = equity(today)
        day_pnl = end_eq - start_eq
        day_ret = day_pnl / start_eq if start_eq > 0 else 0.0
        if day_ret < worst_day:
            worst_day = day_ret
        if day_pnl < -daily_loss_limit:
            breaker_trips += 1
        eq_series.append(end_eq)

    final_eq = eq_series[-1]
    net_pnl = final_eq - 100.0
    cagr = ((final_eq / 100.0) ** (365.0 / len(prices)) - 1.0) * 100 if final_eq > 0 else -100.0
    win_rate = win_count / trade_count * 100 if trade_count > 0 else 0.0

    return {
        "final_eq": final_eq,
        "net_pnl": net_pnl,
        "cagr": cagr,
        "worst_day": worst_day * 100,
        "max_dd": max_dd * 100,
        "breakers": breaker_trips,
        "trades": trade_count,
        "win_rate": win_rate,
        "sl_initial": sl_initial_count,
        "sl_ratchet": sl_ratchet_count,
        "tp_count": tp_count,
    }

def main():
    raw_dates, raw_symbols, raw_prices = load_data()
    dates, prices = build_3000_day_series(raw_dates, raw_prices)
    symbols = raw_symbols

    print("=" * 145)
    print(f"KIỂM TOÁN ĐỊNH LƯỢNG DÀI HẠN: 3,000 NGÀY (~8.2 NĂM) - VỐN XUẤT PHÁT 100 USDT")
    print(f"Dữ liệu: {len(prices)} phiên giao dịch (Trọn vẹn 2 chu kỳ Gấu -> Bò -> Gấu -> Bò)")
    print("=" * 145)

    experiments = [
        ("1. Current Live Baseline (SL -12%, Early-Lock Ratchet)", {"sl_pct": 0.12}),
        ("2. Proposal A1: Tight SL -6% (Cắt lỗ -6%)", {"sl_pct": 0.06}),
        ("3. Proposal A2: Tight SL -8% (Cắt lỗ -8% - Đề xuất)", {"sl_pct": 0.08}),
        ("4. Proposal A3: Moderate SL -10%", {"sl_pct": 0.10}),
        ("5. Proposal B1: Fixed Quick TP +5% (Chốt non +5% cố định)", {"sl_pct": 0.12, "quick_tp": 0.05, "enable_early_lock": False}),
        ("6. Proposal B2: Fixed Quick TP +7% (Chốt non +7% cố định)", {"sl_pct": 0.12, "quick_tp": 0.07, "enable_early_lock": False}),
        ("7. Proposal B3: Fixed Quick TP +10% (Chốt non +10% cố định)", {"sl_pct": 0.12, "quick_tp": 0.10, "enable_early_lock": False}),
    ]

    print("\n--- BẢNG 1: CHẾ ĐỘ VỐN TĨNH CỐ ĐỊNH ($24/LỆNH CHUẨN ĐẦU) ---")
    print(f"{'Cấu hình':<62} | {'Vốn Cuối':<10} | {'Net PnL':<11} | {'Ngày Xấu':<9} | {'Max DD':<7} | {'Win%':<6} | {'Số Lệnh':<8} | {'SL Gốc':<7}")
    print("-" * 145)
    for name, params in experiments:
        p = dict(params)
        p["fixed_sizing"] = True
        res = run_3000_backtest(dates, symbols, prices, **p)
        print(f"{name:<62} | {res['final_eq']:>8.2f}u | {res['net_pnl']:>+9.2f}u | {res['worst_day']:>7.2f}% | {res['max_dd']:>5.1f}% | {res['win_rate']:>5.1f}% | {res['trades']:>8} | {res['sl_initial']:>7}")

    print("\n--- BẢNG 2: CHẾ ĐỘ LÃI KÉP TOÀN PHẦN (EXPONENTIAL COMPOUNDING) ---")
    print(f"{'Cấu hình':<62} | {'Vốn Cuối':<12} | {'CAGR/năm':<9} | {'Ngày Xấu':<9} | {'Max DD':<7} | {'Cầu chì':<7} | {'Win%':<6} | {'SL Gốc':<7}")
    print("-" * 145)
    for name, params in experiments:
        p = dict(params)
        p["fixed_sizing"] = False
        res = run_3000_backtest(dates, symbols, prices, **p)
        print(f"{name:<62} | {res['final_eq']:>10.1f}u | {res['cagr']:>7.1f}% | {res['worst_day']:>7.2f}% | {res['max_dd']:>5.1f}% | {res['breakers']:>7} | {res['win_rate']:>5.1f}% | {res['sl_initial']:>7}")

    print("=" * 145)

if __name__ == "__main__":
    main()
