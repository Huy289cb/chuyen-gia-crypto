#!/usr/bin/env python3
"""
DEEP DIVE: TIME-DECAY PRUNING & CAPITAL SIZING (STATIC VS COMPOUNDING)
"""
import sys
import importlib.util
from pathlib import Path

mod_path = Path(__file__).resolve().parent / "research-improvements-backtest.py"
spec = importlib.util.spec_from_file_location("rib", str(mod_path))
rib = importlib.util.module_from_spec(spec)
spec.loader.exec_module(rib)

load_data = rib.load_data
build_3000_day_series = rib.build_3000_day_series
run_simulation = rib.run_simulation

dates1500, symbols, prices1500 = load_data()
dates3000, prices3000 = build_3000_day_series(dates1500, prices1500)

print("=" * 130)
print("KIỂM ĐỊNH ĐỘC LẬP: TIME-DECAY PRUNING KẾT HỢP TỐI ƯU HÓA VỐN (CHẾ ĐỘ VỐN TĨNH 100u)")
print("=" * 130)
print(f"{'Cấu hình':<55} | {'Net PnL':<11} | {'Max DD':<7} | {'Ngày Xấu':<9} | {'Win%':<6} | {'SL Gốc':<7} | {'Stagnation':<10}")
print("-" * 130)

configs = [
    ("1. Baseline (2 slots x 24u, No Decay)", {"num_slots": 2, "alloc_per_slot": 0.24, "enable_time_decay": False, "compounding": False}),
    ("2. Time-Decay Pruning (2 slots x 24u)", {"num_slots": 2, "alloc_per_slot": 0.24, "enable_time_decay": True, "compounding": False}),
    ("3. Time-Decay + 3 Slots x 28u", {"num_slots": 3, "alloc_per_slot": 0.28, "enable_time_decay": True, "compounding": False}),
    ("4. Time-Decay + 2 Slots x 35u", {"num_slots": 2, "alloc_per_slot": 0.35, "enable_time_decay": True, "compounding": False}),
    ("5. Time-Decay + 2 Slots x 40u", {"num_slots": 2, "alloc_per_slot": 0.40, "enable_time_decay": True, "compounding": False}),
]

for name, params in configs:
    r = run_simulation(dates1500, symbols, prices1500, **params)
    print(f"{name:<55} | {r['net_pnl']:>+9.2f}u | {r['max_dd_pct']:>5.1f}% | {r['worst_day_pct']:>7.2f}% | {r['win_rate']:>5.1f}% | {r['sl_initial']:>7} | {r['stagnation_exits']:>10}")

print("\n" + "=" * 130)
print("KIỂM ĐỊNH ĐỘC LẬP: CHẾ ĐỘ LÃI KÉP TOÀN PHẦN (EXPONENTIAL COMPOUNDING)")
print("=" * 130)
print(f"{'Cấu hình':<55} | {'Vốn Cuối':<12} | {'CAGR/năm':<9} | {'Max DD':<7} | {'Ngày Xấu':<9} | {'Cầu chì':<7}")
print("-" * 130)

for name, params in configs:
    p = dict(params)
    p["compounding"] = True
    r = run_simulation(dates1500, symbols, prices1500, **p)
    print(f"{name:<55} | {r['final_eq']:>10.1f}u | {r['cagr']:>7.1f}% | {r['max_dd_pct']:>5.1f}% | {r['worst_day_pct']:>7.2f}% | {r['breaker_trips']:>7}")

print("=" * 130)
