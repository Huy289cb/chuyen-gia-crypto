#!/usr/bin/env python3
"""
EMPIRICAL BACKTEST & AUDIT: PHASE 9 SMALL-CAP ARCHITECTURE ENHANCEMENTS
========================================================================
Testing Proposals:
  Proposal 1a: Allocate capital into 3 Momentum Slots (vs 2 Slots) when BTC Grid is inactive due to minNotional.
  Proposal 4: Time-Decay Loser Pruning (Cut stagnant losers at day >= 2, max_ret < 2%, curr_ret <= -5.0%).
  Early-Lock Ratchet (Phase 8.1): +5% -> +0.8%, +7% -> +3.5%, +10% -> +6.0%, +14% -> +10.0%.

Grid Inactivity Reality: On Binance Futures, BTCUSDT requires minNotional = $50 and minQty = 0.001 BTC (~$69).
For account equity ~50-100 USDT, grid cannot execute, leaving 42-52% cash idle.
"""

import csv
import math
from pathlib import Path

CSV = Path(__file__).resolve().parents[1] / "tests/fixtures/cct-source-projection/daily-source.csv"
FEE_TAKER = 0.00055  # 0.05% taker + 0.005% dynamic liquid slippage
FEE_MAKER = 0.0002   # 0.02% maker

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
    enable_btc_grid: bool = True,
    btc_health_gate_pct: float = -0.03,
    enable_time_decay_exit: bool = True,
    stagnation_days: int = 2,
    stagnation_max_ret_thresh: float = 0.02,
    stagnation_curr_ret_thresh: float = -0.05,
    use_early_lock_ratchet: bool = True,
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
    trade_stats = {
        "total_trades": 0,
        "winning_trades": 0,
        "sl_hit_initial": 0,
        "sl_hit_breakeven": 0,
        "sl_hit_lock": 0,
        "stagnation_exits": 0,
        "rebalance_exits": 0,
        "btc_gate_blocks": 0,
        "grid_tps": 0,
        "retry_entries": 0,
    }

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

        mom_alloc = max(5.0, curr_eq * mom_alloc_pct)
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

        # Event Shield
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

        # 1. Position Evaluation & Ratchet & Time-Decay Loser Pruning
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

            if use_early_lock_ratchet:
                # Phase 8.1 Early-Lock 4-Tier Ratchet
                if pos["max_ret"] >= 0.14:
                    if pos["current_sl"] < 0.10:
                        pos["current_sl"] = 0.10
                        pos["tier"] = "lock3"
                elif pos["max_ret"] >= 0.10:
                    if pos["current_sl"] < 0.06:
                        pos["current_sl"] = 0.06
                        pos["tier"] = "lock2"
                elif pos["max_ret"] >= 0.07:
                    if pos["current_sl"] < 0.035:
                        pos["current_sl"] = 0.035
                        pos["tier"] = "lock1"
                elif pos["max_ret"] >= 0.05:
                    if pos["current_sl"] < 0.008:
                        pos["current_sl"] = 0.008
                        pos["tier"] = "breakeven"
            else:
                # Baseline 2-Tier Ratchet
                if pos["max_ret"] >= 0.14:
                    if pos["current_sl"] < 0.08:
                        pos["current_sl"] = 0.08
                        pos["tier"] = "lock"
                elif pos["max_ret"] >= 0.08:
                    if pos["current_sl"] < 0.008:
                        pos["current_sl"] = 0.008
                        pos["tier"] = "breakeven"

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
                else:
                    trade_stats["sl_hit_initial"] += 1

                if pos["current_sl"] <= -0.03:
                    same_day_cooldown[s] = idx
                continue

            # Time-Decay Loser Pruning (Cut stagnant loser)
            if enable_time_decay_exit and pos["days_held"] >= stagnation_days:
                if pos["max_ret"] < stagnation_max_ret_thresh and ret <= stagnation_curr_ret_thresh:
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
        if enable_btc_grid:
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
            if enable_btc_grid:
                for e, q, _ in held_grid:
                    if btc_today > 0:
                        cash += (btc_today - e) * q - btc_today * q * FEE_TAKER
                held_grid = []

        # 4. Momentum Rebalance & Eager Retry with BTC Trend Health Gate
        since_reb += 1
        is_rebalance_day = (since_reb >= reb_period) and not fired

        btc_gate_blocking = False
        if btc_health_gate_pct is not None and btc_1d_ret <= btc_health_gate_pct:
            btc_gate_blocking = True

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
                    if len(held_mom) == max_mom_slots:
                        break

        elif not fired and len(held_mom) < max_mom_slots:
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
                    trade_stats["retry_entries"] += 1
                    if len(held_mom) == max_mom_slots:
                        break

        # 5. BTC Grid Dip Entry
        if enable_btc_grid and not fired and len(held_grid) < 3 and btc_1d_ret >= -btc_crash_gate_pct:
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
    rec512_mean = rec512_net / 512.0

    return {
        "final_eq": final_eq,
        "net_pnl": net_pnl,
        "mean_daily": mean_pnl,
        "annualized_roi": (final_eq / 100.0) ** (365.25 / len(daily_pnls)) - 1.0,
        "worst_day_pct": worst_day_pct,
        "max_dd": max_dd,
        "breakers": breaker_trips,
        "p1_net": p1_net,
        "p2_net": p2_net,
        "rec512_net": rec512_net,
        "rec512_mean": rec512_mean,
        "trade_stats": trade_stats,
    }

def main():
    dates, symbols, prices = load_data()

    configs = [
        ("Phase 8.1 Live Baseline (2 slots 24% + BTC Grid theoretical)", 2, 0.24, True),
        ("Live Reality (2 slots 24%, BTC Grid inactive due to minNotional)", 2, 0.24, False),
        ("Proposal 1a (3 slots x 24% = 72% exposure, no grid)", 3, 0.24, False),
        ("Proposal 1a (3 slots x 26% = 78% exposure, no grid)", 3, 0.26, False),
        ("Proposal 1a (3 slots x 28% = 84% exposure, no grid)", 3, 0.28, False),
        ("Proposal 1a (3 slots x 30% = 90% exposure, no grid)", 3, 0.30, False),
        ("Alternative 2-Slot (2 slots x 35% = 70% exposure, no grid)", 2, 0.35, False),
        ("Alternative 2-Slot (2 slots x 40% = 80% exposure, no grid)", 2, 0.40, False),
    ]

    print("=" * 115)
    print(f"{'Strategy Configuration':<60} | {'Final Eq':<9} | {'Net PnL':<10} | {'Worst Day':<10} | {'MDD':<6} | {'Breakers':<8}")
    print("-" * 115)

    for name, slots, alloc, grid in configs:
        res = run_simulation(
            dates, symbols, prices,
            reb_period=3,
            max_mom_slots=slots,
            mom_alloc_pct=alloc,
            enable_btc_grid=grid,
            btc_health_gate_pct=-0.03,
            enable_time_decay_exit=True,
            use_early_lock_ratchet=True,
        )
        print(f"{name:<60} | {res['final_eq']:>7.2f}u | {res['net_pnl']:>+8.2f}u | {res['worst_day_pct']:>8.2f}% | {res['max_dd']*100:>4.1f}% | {res['breakers']:>8}")

if __name__ == "__main__":
    main()

def test_deep_attribution():
    dates, symbols, prices = load_data()
    print("\n" + "=" * 115)
    print("DETAILED DEEP DIVE: WHY DID 3 MOMENTUM SLOTS FAIL GATE 1?")
    print("=" * 115)
    # Compare 2 slots vs 3 slots on drawdowns and worst days
    for slots, alloc in [(2, 0.24), (2, 0.28), (3, 0.24), (3, 0.20)]:
        res = run_simulation(
            dates, symbols, prices,
            reb_period=3,
            max_mom_slots=slots,
            mom_alloc_pct=alloc,
            enable_btc_grid=False,
            btc_health_gate_pct=-0.03,
            enable_time_decay_exit=True,
            use_early_lock_ratchet=True,
        )
        print(f"Slots: {slots} | Alloc: {alloc*100:.0f}%/pos (Total: {slots*alloc*100:.0f}%) | "
              f"Final Eq: {res['final_eq']:.2f}u | Net: {res['net_pnl']:+.2f}u | "
              f"Worst Day: {res['worst_day_pct']:.2f}% | MDD: {res['max_dd']*100:.1f}% | "
              f"Breakers: {res['breakers']} | P1(Bear): {res['p1_net']:+.1f}u | P2(Bull): {res['p2_net']:+.1f}u")

test_deep_attribution()

def test_sol_grid():
    dates, symbols, prices = load_data()
    print("\n" + "=" * 115)
    print("TESTING PROPOSAL 1B: SOL/ETH GRID (EXECUTABLE ON SMALL CAPITAL)")
    print("=" * 115)
    # Simulate grid on SOLUSDT vs BTCUSDT
    for grid_sym in ["BTCUSDT", "ETHUSDT", "SOLUSDT"]:
        # We replace btc_prices with grid_sym prices for grid simulation
        cash = 100.0
        held_mom = []
        held_grid = []
        since_reb = 0
        daily_pnls = []
        grid_asset_prices = [p.get(grid_sym, 0.0) for p in prices]
        btc_prices = [p.get("BTCUSDT", 0.0) for p in prices]
        breaker_trips = 0
        min_eq_obs = cash
        peak_eq = cash
        max_dd = 0.0
        same_day_cooldown = {}

        def equity(px):
            unrl = 0.0
            for pos in held_mom:
                s, e, q = pos["sym"], pos["entry"], pos["qty"]
                unrl += (px.get(s, e) - e) * q
            g_p = px.get(grid_sym, 0.0)
            for e, q, _ in held_grid:
                if g_p > 0:
                    unrl += (g_p - e) * q
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

            mom_alloc = max(5.0, curr_eq * 0.24)
            grid_ticket = max(5.0, curr_eq * 0.14)
            daily_loss_limit = max(12.0, curr_eq * 0.12)

            btc_today = today.get("BTCUSDT", 0.0)
            btc_yesterday = yesterday.get("BTCUSDT", 0.0)
            btc_1d_ret = (btc_today - btc_yesterday) / btc_yesterday if btc_yesterday > 0 else 0.0

            g_today = today.get(grid_sym, 0.0)
            g_yesterday = yesterday.get(grid_sym, 0.0)
            g_1d_ret = (g_today - g_yesterday) / g_yesterday if g_yesterday > 0 else 0.0

            trs = [abs(grid_asset_prices[j] - grid_asset_prices[j-1]) for j in range(idx-13, idx+1) if grid_asset_prices[j] > 0 and grid_asset_prices[j-1] > 0]
            atr = sum(trs) / len(trs) if trs else 0.0
            atr_pct = atr / g_today if g_today > 0 else 0.02
            vol_mult = max(0.8, min(1.5, atr_pct / 0.02))
            grid_step_pct = max(0.015, min(0.045, 0.025 * vol_mult))
            grid_tp_pct = max(0.025, min(0.070, 0.040 * vol_mult))
            crash_gate_pct = max(0.050, min(0.120, 0.080 * vol_mult))

            # Position Evaluation & Ratchet & Time-Decay Pruning
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

                if pos["max_ret"] >= 0.14:
                    if pos["current_sl"] < 0.10:
                        pos["current_sl"] = 0.10
                        pos["tier"] = "lock3"
                elif pos["max_ret"] >= 0.10:
                    if pos["current_sl"] < 0.06:
                        pos["current_sl"] = 0.06
                        pos["tier"] = "lock2"
                elif pos["max_ret"] >= 0.07:
                    if pos["current_sl"] < 0.035:
                        pos["current_sl"] = 0.035
                        pos["tier"] = "lock1"
                elif pos["max_ret"] >= 0.05:
                    if pos["current_sl"] < 0.008:
                        pos["current_sl"] = 0.008
                        pos["tier"] = "breakeven"

                if ret <= pos["current_sl"]:
                    trade_pnl = (close - e) * q - close * q * FEE_TAKER
                    cash += trade_pnl
                    if pos["current_sl"] <= -0.03:
                        same_day_cooldown[s] = idx
                    continue

                if pos["days_held"] >= 2 and pos["max_ret"] < 0.02 and ret <= -0.05:
                    trade_pnl = (close - e) * q - close * q * FEE_TAKER
                    cash += trade_pnl
                    continue

                surviving_mom.append(pos)
            held_mom = surviving_mom

            # Grid TP
            surviving_grid = []
            for e, q, tp_price in held_grid:
                if g_today >= tp_price and g_today > 0:
                    cash += (tp_price - e) * q - tp_price * q * FEE_MAKER
                else:
                    surviving_grid.append((e, q, tp_price))
            held_grid = surviving_grid

            # Breaker Check
            mid_eq = equity(today)
            if (mid_eq - start_eq) <= -daily_loss_limit:
                breaker_trips += 1
                for pos in held_mom:
                    exit_p = today.get(pos["sym"], pos["entry"])
                    cash += (exit_p - pos["entry"]) * pos["qty"] - exit_p * pos["qty"] * FEE_TAKER
                held_mom = []
                for e, q, _ in held_grid:
                    if g_today > 0:
                        cash += (g_today - e) * q - g_today * q * FEE_TAKER
                held_grid = []

            # Rebalance & Eager Retry
            since_reb += 1
            if since_reb >= 3 and (mid_eq - start_eq) > -daily_loss_limit:
                since_reb = 0
                for pos in held_mom:
                    exit_p = today.get(pos["sym"], pos["entry"])
                    cash += (exit_p - pos["entry"]) * pos["qty"] - exit_p * pos["qty"] * FEE_TAKER
                held_mom = []

                if btc_1d_ret > -0.03:
                    past = prices[idx - 14]
                    scores = []
                    for s in symbols:
                        if s in [grid_sym, "BTCUSDT"]:
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
                            "sym": s, "entry": today[s], "qty": mom_alloc / today[s],
                            "current_sl": -0.12, "max_ret": 0.0, "tier": "initial", "days_held": 0
                        })
                        if len(held_mom) == 2:
                            break

            elif (mid_eq - start_eq) > -daily_loss_limit and len(held_mom) < 2 and btc_1d_ret > -0.03:
                currently_held = {p["sym"] for p in held_mom}
                past = prices[idx - 14]
                scores = []
                for s in symbols:
                    if s in [grid_sym, "BTCUSDT"] or s in currently_held:
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
                        "sym": s, "entry": today[s], "qty": mom_alloc / today[s],
                        "current_sl": -0.12, "max_ret": 0.0, "tier": "initial", "days_held": 0
                    })
                    if len(held_mom) == 2:
                        break

            # Grid Entry
            if len(held_grid) < 3 and g_1d_ret >= -crash_gate_pct:
                g_window = [p for p in grid_asset_prices[idx-10:idx] if p > 0]
                if len(g_window) >= 8 and g_today > 0:
                    g_ema = sum(g_window) / len(g_window)
                    lvl = len(held_grid) + 1
                    target_dip_price = g_ema * (1.0 - lvl * grid_step_pct)
                    if g_today <= target_dip_price:
                        cash -= grid_ticket * FEE_MAKER
                        qty = grid_ticket / g_today
                        tp_price = g_today * (1.0 + grid_tp_pct)
                        held_grid.append((g_today, qty, tp_price))

            end_eq = equity(today)
            d_pnl = end_eq - start_eq
            d_pnl_pct = d_pnl / start_eq if start_eq > 0 else 0.0
            daily_pnls.append((today_date, d_pnl, d_pnl_pct, end_eq))

        final_eq = equity(prices[-1])
        net_pnl = final_eq - 100.0
        worst_day = min(d[2] for d in daily_pnls) * 100
        print(f"Grid Asset: {grid_sym:<8} | Final Eq: {final_eq:>7.2f}u | Net: {net_pnl:>+8.2f}u | Worst Day: {worst_day:>7.2f}% | Breakers: {breaker_trips}")

test_sol_grid()

def analyze_milestone_durations():
    dates, symbols, prices = load_data()
    # Let's inspect rolling periods from each day to reach 1.4835x (+48.35%), 3.0x, and 9.0x
    # First, let's run simulation and collect daily equity
    # Modify simulation slightly to yield equity series
    cash = 100.0
    held_mom = []
    since_reb = 0
    btc_prices = [p.get("BTCUSDT", 0.0) for p in prices]
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

        mom_alloc = max(5.0, curr_eq * 0.24)
        daily_loss_limit = max(12.0, curr_eq * 0.12)
        btc_today = today.get("BTCUSDT", 0.0)
        btc_yesterday = yesterday.get("BTCUSDT", 0.0)
        btc_1d_ret = (btc_today - btc_yesterday) / btc_yesterday if btc_yesterday > 0 else 0.0

        # Position evaluation
        surviving = []
        for pos in held_mom:
            pos["days_held"] = pos.get("days_held", 0) + 1
            s, e, q = pos["sym"], pos["entry"], pos["qty"]
            if s not in today:
                surviving.append(pos)
                continue
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

        # Breaker
        mid_eq = equity(today)
        if (mid_eq - start_eq) <= -daily_loss_limit:
            for pos in held_mom:
                p_c = today.get(pos["sym"], pos["entry"])
                cash += (p_c - pos["entry"]) * pos["qty"] - p_c * pos["qty"] * FEE_TAKER
            held_mom = []

        # Rebalance
        since_reb += 1
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
        eq_series.append((today_date, end_eq))

    print("\n" + "=" * 115)
    print("TIMELINE ANALYSIS: HOW FAST DOES CAPITAL GROW THROUGH MILESTONES?")
    print("=" * 115)
    
    # 1. From Day 0: When did it reach 148.5u (equivalent to 51.5u -> 76.4u)?
    d_m1 = next((i for i, (d, eq) in enumerate(eq_series) if eq >= 148.35), None)
    d_m2 = next((i for i, (d, eq) in enumerate(eq_series) if eq >= 300.0), None)
    d_m3 = next((i for i, (d, eq) in enumerate(eq_series) if eq >= 900.0), None)

    print(f"From Day 0 (Base 100u):")
    if d_m1: print(f"  • Mốc 1 (+48.4% Về bờ): Ngày {d_m1} (~{d_m1/30.4:.1f} tháng) - {eq_series[d_m1][0]}")
    if d_m2: print(f"  • Mốc 2 (3x Vốn ~150u): Ngày {d_m2} (~{d_m2/30.4:.1f} tháng) - {eq_series[d_m2][0]}")
    if d_m3: print(f"  • Mốc 3 (9x Vốn ~450u): Ngày {d_m3} (~{d_m3/30.4:.1f} tháng) - {eq_series[d_m3][0]}")

    # 2. Rolling analysis: If you enter at any random date, how many days to reach +48.4%?
    durations_48pct = []
    for i in range(len(eq_series)):
        start_val = eq_series[i][1]
        target_val = start_val * 1.4835
        for j in range(i + 1, len(eq_series)):
            if eq_series[j][1] >= target_val:
                durations_48pct.append(j - i)
                break
    
    durations_48pct.sort()
    p10 = durations_48pct[int(len(durations_48pct) * 0.10)]
    p25 = durations_48pct[int(len(durations_48pct) * 0.25)]
    p50 = durations_48pct[int(len(durations_48pct) * 0.50)]
    p75 = durations_48pct[int(len(durations_48pct) * 0.75)]
    p90 = durations_48pct[int(len(durations_48pct) * 0.90)]

    print(f"\nPhân phối thời gian thực tế đạt Mốc 1 (+48.4% / Về bờ +25u) từ điểm bất kỳ:")
    print(f"  • Top 10% Bùng nổ (Vào đúng sóng Altseason): {p10} ngày (~{p10/30.4:.1f} tháng)")
    print(f"  • Top 25% Thuận lợi (Bắt được 2-3 nhịp trend): {p25} ngày (~{p25/30.4:.1f} tháng)")
    print(f"  • Trung vị 50% (Thị trường bình thường): {p50} ngày (~{p50/30.4:.1f} tháng)")
    print(f"  • 75% Thận trọng (Thị trường giằng co): {p75} ngày (~{p75/30.4:.1f} tháng)")
    print(f"  • 90% Chậm nhất (Trùng kỳ gấu xả dài hạn): {p90} ngày (~{p90/30.4:.1f} tháng)")

analyze_milestone_durations()
