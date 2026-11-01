#!/usr/bin/env python3
"""
HOURLY INTRADAY AUDIT: SENSITIVE MULTI-TIER RATCHET PROFIT GUARD
================================================================
Simulates bar-by-bar (1-hour candles) execution on real Binance Futures OHLCV.
Evaluates intraday high/low whipsaw, breakeven triggers, and stop loss execution.

Data: 7 Liquid Pairs (BTC, ETH, SOL, DOGE, XRP, BNB, ADA) across 2,929 1h bars.
"""

from __future__ import annotations
import csv
from pathlib import Path
from dataclasses import dataclass

HOURLY_DIR = Path(__file__).resolve().parents[2] / "docs/audits/futures-quick-win/cross-20261013T132038Z/data"

FEE_TAKER = 0.00055  # 0.05% taker + 0.005% slippage

@dataclass
class Candle:
    t: int
    o: float
    h: float
    l: float
    c: float

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
    be_trigger: float = 0.04,
    be_sl: float = 0.005,
    lock1_trigger: float = 0.075,
    lock1_sl: float = 0.035,
    enable_lock2: bool = False,
    lock2_trigger: float = 0.12,
    lock2_sl: float = 0.075,
    mom_stop: float = 0.12,
    reb_hours: int = 48,
    lookback_hours: int = 14 * 24, # 14 days lookback
):
    symbols = [s for s in all_candles.keys() if s != "BTCUSDT"]
    common_len = min(len(c) for c in all_candles.values())
    
    cash = 100.0
    held: list[dict] = [] # {sym, entry, qty, current_sl, max_high}
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

            # Update highest observed price intraday
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
                # Exit at Stop Price (or Open if gap down)
                exit_price = min(candle.o, pos["current_sl"])
                pnl = (exit_price - entry) * qty - exit_price * qty * FEE_TAKER
                cash += pnl
                stats["total_trades"] += 1
                
                # Categorize exit
                if exit_price <= entry * (1.0 - 0.07):
                    stats["sl_hit_disaster"] += 1
                    stats["total_loss"] += abs(pnl)
                elif abs(exit_price - entry * (1.0 + be_sl)) / entry < 0.005:
                    stats["sl_hit_be"] += 1
                    stats["winning_trades"] += 1
                    stats["total_profit"] += pnl
                elif abs(exit_price - entry * (1.0 + lock1_sl)) / entry < 0.005:
                    stats["sl_hit_lock1"] += 1
                    stats["winning_trades"] += 1
                    stats["total_profit"] += pnl
                elif enable_lock2 and abs(exit_price - entry * (1.0 + lock2_sl)) / entry < 0.005:
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
            # Close existing
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

            # Momentum Ranking over lookback_hours
            scores = []
            for sym in symbols:
                c_now = all_candles[sym][bar_idx].c
                c_past = all_candles[sym][bar_idx - lookback_hours].c
                ret = (c_now - c_past) / c_past
                scores.append((ret, sym))

            scores.sort(reverse=True)
            alloc_usd = 25.0 # $25 per position (100u design)
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

    # Close any open positions at end
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
    print(f"Loaded {len(candles)} pairs with {min(len(c) for c in candles.values())} hourly bars (~122 days).\n")

    configs = [
        {
            "name": "1. Hourly Baseline (No Ratchet, Fixed -12% SL)",
            "params": {
                "enable_ratchet": False,
                "mom_stop": 0.12,
            },
        },
        {
            "name": "2. Hourly Phase 6 Live (BE@+8%, Lock@+14%)",
            "params": {
                "enable_ratchet": True,
                "be_trigger": 0.08,
                "be_sl": 0.008,
                "lock1_trigger": 0.14,
                "lock1_sl": 0.08,
                "enable_lock2": False,
                "mom_stop": 0.12,
            },
        },
        {
            "name": "3. Hourly Proposal A (Sensitive 3-Tier: BE@+4%, Lock1@+7.5%, Lock2@+12%)",
            "params": {
                "enable_ratchet": True,
                "be_trigger": 0.04,
                "be_sl": 0.005,
                "lock1_trigger": 0.075,
                "lock1_sl": 0.035,
                "enable_lock2": True,
                "lock2_trigger": 0.12,
                "lock2_sl": 0.075,
                "mom_stop": 0.12,
            },
        },
        {
            "name": "4. Hourly Proposal B (Moderate 3-Tier: BE@+5%, Lock1@+8.5%, Lock2@+14%)",
            "params": {
                "enable_ratchet": True,
                "be_trigger": 0.05,
                "be_sl": 0.005,
                "lock1_trigger": 0.085,
                "lock1_sl": 0.040,
                "enable_lock2": True,
                "lock2_trigger": 0.14,
                "lock2_sl": 0.080,
                "mom_stop": 0.12,
            },
        },
    ]

    print("=" * 110)
    print(f"{'Hourly Configuration':<58} | {'Final Eq':<9} | {'Net PnL':<10} | {'WinRate':<7} | {'PF':<5} | {'BE Hits':<7}")
    print("=" * 110)

    for cfg in configs:
        res = run_hourly_simulation(candles, **cfg["params"])
        st = res["stats"]
        print(f"{cfg['name']:<58} | {res['final_equity']:>7.2f}u | {res['net_pnl']:>+8.2f}u | {res['win_rate']:>5.1f}% | {res['profit_factor']:>4.2f} | {st['sl_hit_be']:>7}")

    print("=" * 110)

if __name__ == "__main__":
    main()
