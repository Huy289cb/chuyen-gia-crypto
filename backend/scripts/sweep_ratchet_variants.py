#!/usr/bin/env python3
"""
GRID SWEEP: OPTIMAL RATCHET & RISK-REDUCTION TIERS ON HOURLY & DAILY
====================================================================
"""

from __future__ import annotations
import csv
from pathlib import Path

HOURLY_DIR = Path(__file__).resolve().parents[2] / "docs/audits/futures-quick-win/cross-20261013T132038Z/data"
FEE_TAKER = 0.00055

class Candle:
    def __init__(self, t: int, o: float, h: float, l: float, c: float):
        self.t = t
        self.o = o
        self.h = h
        self.l = l
        self.c = c

def load_hourly_data():
    data: dict[str, list[Candle]] = {}
    csv_files = list(HOURLY_DIR.glob("*-hourly.csv"))
    for file_path in csv_files:
        sym = file_path.stem.replace("-hourly", "")
        candles = []
        with open(file_path, "r") as f:
            reader = csv.reader(f)
            header = next(reader)
            for row in reader:
                t = int(row[0])
                o, h, l, c = float(row[1]), float(row[2]), float(row[3]), float(row[4])
                candles.append(Candle(t, o, h, l, c))
        data[sym] = candles
    return data

def run_hourly_simulation(
    all_candles: dict[str, list[Candle]],
    enable_ratchet: bool = False,
    be_trigger: float = 0.08,
    be_sl: float = 0.008,
    lock1_trigger: float = 0.14,
    lock1_sl: float = 0.08,
    enable_lock2: bool = False,
    lock2_trigger: float = 0.12,
    lock2_sl: float = 0.075,
    mom_stop: float = 0.12,
    reb_hours: int = 48,
    lookback_hours: int = 14 * 24,
):
    symbols = [s for s in all_candles.keys() if s != "BTCUSDT"]
    common_len = min(len(c) for c in all_candles.values())
    
    cash = 100.0
    held: list[dict] = []
    since_reb = 0

    stats = {
        "sl_hit_disaster": 0,
        "sl_hit_be": 0,
        "sl_hit_lock1": 0,
        "sl_hit_lock2": 0,
        "reb_closed": 0,
        "total_trades": 0,
        "winning_trades": 0,
        "total_profit": 0.0,
        "total_loss": 0.0,
    }

    start_bar = lookback_hours
    for bar_idx in range(start_bar, common_len):
        since_reb += 1
        
        # 1. Bar-by-bar evaluation of open positions
        surviving = []
        for pos in held:
            sym = pos["sym"]
            candle = all_candles[sym][bar_idx]
            entry = pos["entry"]
            qty = pos["qty"]

            if candle.h > pos["max_high"]:
                pos["max_high"] = candle.h

            max_ret = (pos["max_high"] - entry) / entry

            # Ratchet logic
            if enable_ratchet:
                if enable_lock2 and max_ret >= lock2_trigger:
                    target_sl = entry * (1.0 + lock2_sl)
                    if pos["current_sl"] < target_sl:
                        pos["current_sl"] = target_sl
                elif max_ret >= lock1_trigger:
                    target_sl = entry * (1.0 + lock1_sl)
                    if pos["current_sl"] < target_sl:
                        pos["current_sl"] = target_sl
                elif max_ret >= be_trigger:
                    target_sl = entry * (1.0 + be_sl)
                    if pos["current_sl"] < target_sl:
                        pos["current_sl"] = target_sl

            # Check if Low pierced current SL
            if candle.l <= pos["current_sl"]:
                exit_price = min(candle.o, pos["current_sl"])
                pnl = (exit_price - entry) * qty - exit_price * qty * FEE_TAKER
                cash += pnl
                stats["total_trades"] += 1
                
                if exit_price <= entry * (1.0 - 0.07):
                    stats["sl_hit_disaster"] += 1
                    stats["total_loss"] += abs(pnl)
                elif abs(exit_price - entry * (1.0 + be_sl)) / entry < 0.008:
                    stats["sl_hit_be"] += 1
                    if pnl > 0:
                        stats["winning_trades"] += 1
                        stats["total_profit"] += pnl
                    else:
                        stats["total_loss"] += abs(pnl)
                elif abs(exit_price - entry * (1.0 + lock1_sl)) / entry < 0.008:
                    stats["sl_hit_lock1"] += 1
                    stats["winning_trades"] += 1
                    stats["total_profit"] += pnl
                elif enable_lock2 and abs(exit_price - entry * (1.0 + lock2_sl)) / entry < 0.008:
                    stats["sl_hit_lock2"] += 1
                    stats["winning_trades"] += 1
                    stats["total_profit"] += pnl
                else:
                    if pnl > 0:
                        stats["winning_trades"] += 1
                        stats["total_profit"] += pnl
                    else:
                        stats["total_loss"] += abs(pnl)
            else:
                surviving.append(pos)
        held = surviving

        # 2. Rebalance every reb_hours
        if since_reb >= reb_hours:
            since_reb = 0
            for pos in held:
                sym = pos["sym"]
                candle = all_candles[sym][bar_idx]
                exit_price = candle.c
                pnl = (exit_price - pos["entry"]) * pos["qty"] - exit_price * pos["qty"] * FEE_TAKER
                cash += pnl
                stats["reb_closed"] += 1
                stats["total_trades"] += 1
                if pnl > 0:
                    stats["winning_trades"] += 1
                    stats["total_profit"] += pnl
                else:
                    stats["total_loss"] += abs(pnl)
            held = []

            scores = []
            for sym in symbols:
                c_now = all_candles[sym][bar_idx].c
                c_past = all_candles[sym][bar_idx - lookback_hours].c
                ret = (c_now - c_past) / c_past
                scores.append((ret, sym))

            scores.sort(reverse=True)
            alloc_usd = 25.0
            for score, sym in scores[:2]:
                if score <= 0.02:
                    break
                entry_p = all_candles[sym][bar_idx].c
                cash -= alloc_usd * FEE_TAKER
                held.append({
                    "sym": sym,
                    "entry": entry_p,
                    "qty": alloc_usd / entry_p,
                    "current_sl": entry_p * (1.0 - mom_stop),
                    "max_high": entry_p,
                })

    final_eq = cash
    for pos in held:
        sym = pos["sym"]
        last_c = all_candles[sym][-1].c
        final_eq += (last_c - pos["entry"]) * pos["qty"]

    net_pnl = final_eq - 100.0
    win_rate = (stats["winning_trades"] / stats["total_trades"] * 100.0) if stats["total_trades"] > 0 else 0.0
    profit_factor = (stats["total_profit"] / stats["total_loss"]) if stats["total_loss"] > 0 else 999.0

    return {
        "final_equity": final_eq,
        "net_pnl": net_pnl,
        "win_rate": win_rate,
        "profit_factor": profit_factor,
        "stats": stats,
    }

def main():
    candles = load_hourly_data()
    print("Running Hourly Grid Sweep on 7 pairs, 2,928 bars (~122 days)...\n")

    test_variants = [
        ("1. Baseline (No Ratchet, -12% SL)", False, 0.08, 0.008, 0.14, 0.08, False, 0.12, 0.075),
        ("2. Current Live Phase 6 (BE@+8% -> +0.8%, Lock@+14% -> +8%)", True, 0.08, 0.008, 0.14, 0.08, False, 0.12, 0.075),
        ("3. Variant A: BE@+6% -> +0.8%, Lock@+12% -> +6%", True, 0.06, 0.008, 0.12, 0.06, False, 0.12, 0.075),
        ("4. Variant B: BE@+7% -> +0.8%, Lock@+12% -> +6%", True, 0.07, 0.008, 0.12, 0.06, False, 0.12, 0.075),
        ("5. Variant C: Soft BE@+6% -> -2.0% (Risk cut), Hard BE@+8% -> +0.8%", True, 0.06, -0.02, 0.08, 0.008, True, 0.14, 0.08),
        ("6. Variant D: Soft BE@+5% -> -3.0% (Risk cut), Hard BE@+8% -> +0.8%", True, 0.05, -0.03, 0.08, 0.008, True, 0.14, 0.08),
        ("7. Variant E (Progressive Lock): BE@+8% -> +1%, Lock1@+12% -> +5%, Lock2@+16% -> +10%", True, 0.08, 0.010, 0.12, 0.050, True, 0.16, 0.100),
        ("8. Variant F (Progressive Lock): BE@+7% -> +0.8%, Lock1@+11% -> +4.5%, Lock2@+15% -> +9%", True, 0.07, 0.008, 0.11, 0.045, True, 0.15, 0.090),
    ]

    print("=" * 115)
    print(f"{'Variant Description':<65} | {'Final Eq':<9} | {'Net PnL':<10} | {'WinRate':<7} | {'PF':<5} | {'BE Hits':<7}")
    print("=" * 115)

    for name, en, be_tr, be_sl, l1_tr, l1_sl, en_l2, l2_tr, l2_sl in test_variants:
        res = run_hourly_simulation(
            candles,
            enable_ratchet=en,
            be_trigger=be_tr,
            be_sl=be_sl,
            lock1_trigger=l1_tr,
            lock1_sl=l1_sl,
            enable_lock2=en_l2,
            lock2_trigger=l2_tr,
            lock2_sl=l2_sl,
        )
        st = res["stats"]
        print(f"{name:<65} | {res['final_equity']:>7.2f}u | {res['net_pnl']:>+8.2f}u | {res['win_rate']:>5.1f}% | {res['profit_factor']:>4.2f} | {st['sl_hit_be']:>7}")

    print("=" * 115)

if __name__ == "__main__":
    main()
