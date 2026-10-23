#!/usr/bin/env python3
"""
PHASE 2 HOURLY MOMENTUM BACKTEST & AUDIT ENGINE
================================================
Comprehensive, causal, zero-lookahead backtesting engine on real 1h Binance Futures OHLCV.

Features:
1. True Intraday Stop Loss:
   - Evaluated bar-by-bar on every 1h candle.
   - If Low <= StopPrice: triggered intraday.
   - Slippage model: 0.05% adverse slippage on stop fill + 0.05% taker fee = 0.10% friction.
   - Gap protection: if Open <= StopPrice, executed at Open * (1 - slippage).
2. Realistic Friction:
   - Rebalance exit/entry: 0.05% taker fee + 0.02% slippage = 0.07% each way.
3. Daily Circuit Breaker (<= -12.0 USDT):
   - Tracked from 00:00 UTC daily.
   - If cumulative daily PnL drops to <= -12.0 USDT, immediate market flatten and freeze trading.
4. Exact Accounting Parity:
   - Day Start Equity, Day End Equity, and daily PnL summation strictly equals final equity - 100.0.
   - Zero phantom fills, zero compounding inflation.
"""

from __future__ import annotations
import json
import sys
from pathlib import Path
from datetime import datetime, timezone
from dataclasses import dataclass

DATA_DIR = Path(__file__).resolve().parents[1] / "data" / "backtest-cache" / "hourly-universe"

FEE_TAKER = 0.0005       # Binance VIP0 / standard futures taker fee (0.05%)
SLIPPAGE_STOP = 0.0005   # 0.05% adverse slippage on stop trigger
FEE_REBALANCE = 0.0007   # 0.05% taker + 0.02% execution slippage for market orders

@dataclass
class Candle:
    t: int
    dt: str
    o: float
    h: float
    l: float
    c: float
    v: float

@dataclass
class Position:
    symbol: str
    entry_price: float
    qty: float
    sl_price: float
    entry_time: int
    max_high: float = 0.0

@dataclass
class SimulationResult:
    alloc: float
    sl_pct: float
    reb_hours: int
    lb_hours: int
    net_pnl: float
    mean_daily_pnl: float
    annualized_roi: float
    worst_day_pnl: float
    breaker_count: int
    win_rate: float
    profit_factor: float
    total_trades: int = 0
    yearly_pnls: dict = None
    pass_target: bool = False
    pass_risk_cap: bool = False

def load_universe(symbols: list[str]) -> tuple[list[int], dict[str, dict[int, Candle]]]:
    """Loads all candles and returns aligned timestamp list and lookup table."""
    candle_tables: dict[str, dict[int, Candle]] = {}
    time_sets: list[set[int]] = []

    for sym in symbols:
        p = DATA_DIR / f"{sym}_1h_2022_2026.json"
        if not p.exists():
            raise FileNotFoundError(f"Missing data file: {p}")
        with p.open("r", encoding="utf-8") as f:
            raw = json.load(f)
        table = {}
        for r in raw:
            c = Candle(t=r["t"], dt=r["dt"], o=r["o"], h=r["h"], l=r["l"], c=r["c"], v=r["v"])
            table[c.t] = c
        candle_tables[sym] = table
        time_sets.append(set(table.keys()))

    # Find common intersection
    common_times = set.intersection(*time_sets)
    sorted_times = sorted(list(common_times))
    print(f"Loaded {len(symbols)} symbols. Common aligned 1h bars: {len(sorted_times)} ({datetime.fromtimestamp(sorted_times[0]/1000, timezone.utc).strftime('%Y-%m-%d')} to {datetime.fromtimestamp(sorted_times[-1]/1000, timezone.utc).strftime('%Y-%m-%d')})")
    return sorted_times, candle_tables

def simulate(
    sorted_times: list[int],
    candles: dict[str, dict[int, Candle]],
    symbols: list[str],
    alloc_per_coin: float = 35.0,
    sl_pct: float = 0.05,
    reb_hours: int = 48,
    lb_hours: int = 240,
    top_n: int = 2,
) -> dict:
    cash = 100.0
    open_positions: list[Position] = []
    hours_since_reb = 0
    breaker_active = False
    breaker_trips = 0

    # Daily tracking
    daily_pnls: list[tuple[str, float]] = []
    day_start_equity = 100.0
    current_day = datetime.fromtimestamp(sorted_times[lb_hours] / 1000, timezone.utc).strftime("%Y-%m-%d")

    # Trade stats
    gross_profits = 0.0
    gross_losses = 0.0
    win_trades = 0
    loss_trades = 0
    total_trades = 0
    worst_day_pnl = 0.0
    yearly_pnls: dict[str, float] = {}

    def get_equity(bar_time: int) -> float:
        unrl = 0.0
        for pos in open_positions:
            cur_c = candles[pos.symbol][bar_time].c
            unrl += (cur_c - pos.entry_price) * pos.qty
        return cash + unrl

    start_idx = lb_hours
    day_start_equity = get_equity(sorted_times[start_idx])

    for i in range(start_idx, len(sorted_times)):
        t_cur = sorted_times[i]
        today_str = datetime.fromtimestamp(t_cur / 1000, timezone.utc).strftime("%Y-%m-%d")

        # ---------------------------------------------------------------------
        # A. Day Roll Check (at 00:00 UTC)
        # ---------------------------------------------------------------------
        if today_str != current_day:
            t_prev = sorted_times[i - 1]
            end_day_eq = get_equity(t_prev)
            day_pnl = end_day_eq - day_start_equity
            daily_pnls.append((current_day, day_pnl))

            yr = current_day[:4]
            yearly_pnls[yr] = yearly_pnls.get(yr, 0.0) + day_pnl

            if day_pnl < worst_day_pnl:
                worst_day_pnl = day_pnl

            # Reset for new day
            current_day = today_str
            day_start_equity = end_day_eq
            breaker_active = False

        # ---------------------------------------------------------------------
        # B. Intraday Stop Loss Evaluation (Hourly High/Low matching)
        # ---------------------------------------------------------------------
        surviving_pos: list[Position] = []
        for pos in open_positions:
            c_bar = candles[pos.symbol][t_cur]

            # Check stop breach
            if c_bar.l <= pos.sl_price:
                # Stop triggered! Determine execution price
                if c_bar.o <= pos.sl_price:
                    # Gapped below stop at open
                    fill_price = c_bar.o * (1.0 - SLIPPAGE_STOP)
                else:
                    # Traversed stop during bar
                    fill_price = pos.sl_price * (1.0 - SLIPPAGE_STOP)

                trade_pnl = (fill_price - pos.entry_price) * pos.qty - fill_price * pos.qty * FEE_TAKER
                cash += (fill_price - pos.entry_price) * pos.qty - fill_price * pos.qty * FEE_TAKER

                total_trades += 1
                if trade_pnl > 0:
                    win_trades += 1
                    gross_profits += trade_pnl
                else:
                    loss_trades += 1
                    gross_losses += abs(trade_pnl)
            else:
                surviving_pos.append(pos)

        open_positions = surviving_pos

        # ---------------------------------------------------------------------
        # C. Circuit Breaker Check (<= -12.0 USDT within current day)
        # ---------------------------------------------------------------------
        cur_eq = get_equity(t_cur)
        intraday_pnl = cur_eq - day_start_equity
        if intraday_pnl <= -12.0 and not breaker_active:
            breaker_active = True
            breaker_trips += 1
            # Emergency flatten all remaining positions
            for pos in open_positions:
                c_bar = candles[pos.symbol][t_cur]
                fill_price = c_bar.c * (1.0 - SLIPPAGE_STOP)
                trade_pnl = (fill_price - pos.entry_price) * pos.qty - fill_price * pos.qty * FEE_TAKER
                cash += (fill_price - pos.entry_price) * pos.qty - fill_price * pos.qty * FEE_TAKER
                total_trades += 1
                if trade_pnl > 0:
                    win_trades += 1
                    gross_profits += trade_pnl
                else:
                    loss_trades += 1
                    gross_losses += abs(trade_pnl)
            open_positions = []

        # ---------------------------------------------------------------------
        # D. Periodic Rebalancing (Every reb_hours)
        # ---------------------------------------------------------------------
        hours_since_reb += 1
        if hours_since_reb >= reb_hours:
            hours_since_reb = 0

            if not breaker_active:
                # 1. Compute momentum scores using closed bars up to t_prev (t_cur is the entry bar)
                t_signal = sorted_times[i - 1]
                t_lb = sorted_times[i - 1 - lb_hours]

                scores: list[tuple[float, str]] = []
                for sym in symbols:
                    p_sig = candles[sym][t_signal].c
                    p_past = candles[sym][t_lb].c
                    if p_past > 0:
                        mom = (p_sig - p_past) / p_past
                        scores.append((mom, sym))

                scores.sort(reverse=True)
                top_targets = set(sym for _, sym in scores[:top_n])

                # 2. Close positions no longer in top targets
                retained_pos: list[Position] = []
                for pos in open_positions:
                    if pos.symbol not in top_targets:
                        c_bar = candles[pos.symbol][t_cur]
                        fill_price = c_bar.o * (1.0 - 0.0002)  # slight adverse entry slippage
                        trade_pnl = (fill_price - pos.entry_price) * pos.qty - fill_price * pos.qty * FEE_REBALANCE
                        cash += (fill_price - pos.entry_price) * pos.qty - fill_price * pos.qty * FEE_REBALANCE
                        total_trades += 1
                        if trade_pnl > 0:
                            win_trades += 1
                            gross_profits += trade_pnl
                        else:
                            loss_trades += 1
                            gross_losses += abs(trade_pnl)
                    else:
                        retained_pos.append(pos)

                open_positions = retained_pos

                # 3. Open new positions for missing top targets
                currently_held = set(p.symbol for p in open_positions)
                for sym in top_targets:
                    if sym not in currently_held:
                        c_bar = candles[sym][t_cur]
                        entry_price = c_bar.o * (1.0 + 0.0002)  # slight entry slippage
                        qty = alloc_per_coin / entry_price
                        entry_fee = alloc_per_coin * FEE_REBALANCE
                        cash -= entry_fee
                        sl_price = entry_price * (1.0 - sl_pct)
                        open_positions.append(Position(
                            symbol=sym,
                            entry_price=entry_price,
                            qty=qty,
                            sl_price=sl_price,
                            entry_time=t_cur,
                            max_high=entry_price,
                        ))

    # Close out at the end of the entire dataset for clean final accounting
    t_final = sorted_times[-1]
    final_day_pnl = get_equity(t_final) - day_start_equity
    daily_pnls.append((current_day, final_day_pnl))
    yr = current_day[:4]
    yearly_pnls[yr] = yearly_pnls.get(yr, 0.0) + final_day_pnl
    if final_day_pnl < worst_day_pnl:
        worst_day_pnl = final_day_pnl

    final_equity = get_equity(t_final)
    net_pnl = final_equity - 100.0
    total_days = len(daily_pnls)
    mean_daily_pnl = net_pnl / total_days if total_days > 0 else 0.0
    annualized_roi = mean_daily_pnl * 365.25

    # Rigorous Parity Audit: Check that sum of daily PnLs equals net_pnl
    sum_daily = sum(p for _, p in daily_pnls)
    parity_diff = abs(sum_daily - net_pnl)
    assert parity_diff < 1e-4, f"Parity mismatch: sum_daily={sum_daily}, net_pnl={net_pnl}, diff={parity_diff}"

    win_rate = (win_trades / total_trades * 100.0) if total_trades > 0 else 0.0
    pf = (gross_profits / gross_losses) if gross_losses > 0 else 999.0

    return {
        "alloc": alloc_per_coin,
        "sl_pct": sl_pct,
        "reb_hours": reb_hours,
        "lb_hours": lb_hours,
        "total_days": total_days,
        "final_equity": final_equity,
        "net_pnl": net_pnl,
        "mean_daily_pnl": mean_daily_pnl,
        "annualized_roi": annualized_roi,
        "worst_day_pnl": worst_day_pnl,
        "breaker_count": breaker_trips,
        "win_rate": win_rate,
        "profit_factor": pf,
        "total_trades": total_trades,
        "yearly_pnls": yearly_pnls,
        "pass_target": mean_daily_pnl >= 0.20,
        "pass_risk_cap": worst_day_pnl >= -12.0 and breaker_trips == 0,
    }

def main():
    symbols = [
        "BTCUSDT", "ETHUSDT", "SOLUSDT", "DOGEUSDT", "XRPUSDT",
        "BNBUSDT", "ADAUSDT", "LINKUSDT", "AVAXUSDT", "NEARUSDT"
    ]
    sorted_times, candle_tables = load_universe(symbols)

    allocs = [20.0, 25.0, 30.0, 35.0]
    sls = [0.06, 0.08, 0.10, 0.12]
    rebs = [48, 72]
    lbs = [240, 336]

    print("\n" + "=" * 115)
    print("           SWEEPING HOURLY MOMENTUM CANDIDATES (REAL 1H BINANCE FUTURES 2022-2026)")
    print("=" * 115)

    valid_configs = []

    for alloc in allocs:
        for sl in sls:
            for reb in rebs:
                for lb in lbs:
                    res = simulate(
                        sorted_times=sorted_times,
                        candles=candle_tables,
                        symbols=symbols,
                        alloc_per_coin=alloc,
                        sl_pct=sl,
                        reb_hours=reb,
                        lb_hours=lb,
                    )
                    if res["pass_risk_cap"]:
                        valid_configs.append(res)
                        status = "PASS_ALL" if res["pass_target"] else "BELOW_0_20"
                        print(f"[{status:9s}] Alloc=${alloc:2.0f}x2 | SL={sl*100:2.0f}% | Reb={reb:2d}h | LB={lb:3d}h ({lb//24:2d}d) => "
                              f"Net={res['net_pnl']:+6.2f}u | Mean={res['mean_daily_pnl']:+0.4f}u/d ({res['annualized_roi']:+5.1f}%/yr) | "
                              f"Worst={res['worst_day_pnl']:+6.2f}u | Breakers={res['breaker_count']:d} | PF={res['profit_factor']:.2f}")

    print("\n" + "=" * 115)
    print(f"Sweep Completed: Found {len(valid_configs)} Zero-Breach Configurations.")
    valid_configs.sort(key=lambda x: x["mean_daily_pnl"], reverse=True)

    print("\nTOP 5 CANDIDATES BY MEAN DAILY RETURN (ZERO BREACHES <= -12.0u):")
    for idx, c in enumerate(valid_configs[:5]):
        print(f"#{idx+1}: Alloc=${c['alloc']:2.0f}x2 | SL={c['sl_pct']*100:.0f}% | Reb={c['reb_hours']}h | LB={c['lb_hours']}h => "
              f"Net={c['net_pnl']:+6.2f}u | Mean={c['mean_daily_pnl']:+0.4f}u/d (+{c['annualized_roi']:.1f}%/yr) | "
              f"Worst Day={c['worst_day_pnl']:+6.2f}u | Trades={c['total_trades']} | PF={c['profit_factor']:.2f}")
        print("    Yearly breakdown:", " | ".join(f"{yr}: {pnl:+6.2f}u" for yr, pnl in sorted(c['yearly_pnls'].items())))

if __name__ == "__main__":
    main()
