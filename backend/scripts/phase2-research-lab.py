#!/usr/bin/env python3
"""
PHASE 2 QUANT RESEARCH LAB: ZERO-BREACH & ROI >= 0.20u/day EXPLORATION

Systematically tests 4 Phase 2 breakthrough directions:
Direction 1: Long-Short Cross-Sectional Momentum (Top N Long + Bottom N Short)
  - Evaluates whether shorting the bottom momentum coins eliminates crash day losses (FTX 2022-11-08).
Direction 2: Volatility-Targeted Momentum (Risk Parity Sizing)
  - Sizes positions inversely to 14-day realized volatility: scales up during calm trends, scales down during crash regimes.
Direction 3: Dynamic Regime-Switched Momentum (BTC 50-day SMA Filter)
  - Full allocation in Bull regimes, defensive allocation or Cash in Bear regimes.
Direction 4: Combined Multi-Sleeve (Long Top 2 Momentum + Delta-Neutral Funding Harvest)

Execution Standards:
- Strict observed close evaluation on daily data (zero phantom stops).
- 0.07% taker fee (0.05% fee + 0.02% adverse slippage).
- Capital: 100.0 USDT.
- Hard circuit breaker: <= 12.0 USDT/day.
- Target: >= 0.20 USDT/day (>= 0.20%/day).
"""

from __future__ import annotations
import csv
from pathlib import Path
import math

CSV = Path(__file__).resolve().parents[1] / "tests/fixtures/cct-source-projection/daily-source.csv"
FEE_TAKER = 0.0007
FEE_MAKER = 0.0002

def load():
    with CSV.open() as handle:
        rows = list(csv.reader(handle))
    symbols = rows[0][1:]
    dates = []
    prices = []
    for row in rows[1:]:
        dates.append(row[0])
        day = {}
        for index, symbol in enumerate(symbols):
            raw = row[index + 1].strip()
            if raw:
                value = float(raw)
                if value > 0:
                    day[symbol] = value
        prices.append(day)
    return dates, symbols, prices

# ==============================================================================
# DIRECTION 1: LONG-SHORT CROSS-SECTIONAL MOMENTUM
# ==============================================================================
def run_long_short_momentum(
    dates: list[str],
    symbols: list[str],
    prices: list[dict[str, float]],
    long_alloc: float = 25.0,
    short_alloc: float = 25.0,
    n_long: int = 2,
    n_short: int = 2,
    rebalance: int = 2,
    stop_long: float = 0.12,
    stop_short: float = 0.12,
):
    cash = 100.0
    held_long: list[tuple[str, float, float]] = []   # (sym, entry, qty)
    held_short: list[tuple[str, float, float]] = []  # (sym, entry, qty)
    since = 0
    daily_pnls: list[float] = []

    def equity(px):
        unrealized = 0.0
        for sym, entry, qty in held_long:
            unrealized += (px.get(sym, entry) - entry) * qty
        for sym, entry, qty in held_short:
            unrealized += (entry - px.get(sym, entry)) * qty
        return cash + unrealized

    for idx in range(15, len(prices)):
        today = prices[idx]
        start_eq = equity(prices[idx - 1])

        # Evaluate Long stops at observed close
        surviving_long = []
        for sym, entry, qty in held_long:
            if sym not in today:
                surviving_long.append((sym, entry, qty))
                continue
            close = today[sym]
            ret = (close - entry) / entry
            if ret <= -stop_long:
                cash += (close - entry) * qty - close * qty * FEE_TAKER
            else:
                surviving_long.append((sym, entry, qty))
        held_long = surviving_long

        # Evaluate Short stops at observed close
        surviving_short = []
        for sym, entry, qty in held_short:
            if sym not in today:
                surviving_short.append((sym, entry, qty))
                continue
            close = today[sym]
            ret = (entry - close) / entry
            if ret <= -stop_short:
                cash += (entry - close) * qty - close * qty * FEE_TAKER
            else:
                surviving_short.append((sym, entry, qty))
        held_short = surviving_short

        # Check circuit breaker
        eq_now = equity(today)
        day_pnl = eq_now - start_eq
        fired = day_pnl <= -12.0
        if fired:
            for sym, entry, qty in held_long:
                exit_p = today.get(sym, entry)
                cash += (exit_p - entry) * qty - exit_p * qty * FEE_TAKER
            held_long = []
            for sym, entry, qty in held_short:
                exit_p = today.get(sym, entry)
                cash += (entry - exit_p) * qty - exit_p * qty * FEE_TAKER
            held_short = []
            eq_now = equity(today)
            day_pnl = eq_now - start_eq

        daily_pnls.append(day_pnl)

        since += 1
        if since >= rebalance and not fired:
            since = 0
            # Close existing
            for sym, entry, qty in held_long:
                exit_p = today.get(sym, entry)
                cash += (exit_p - entry) * qty - exit_p * qty * FEE_TAKER
            held_long = []
            for sym, entry, qty in held_short:
                exit_p = today.get(sym, entry)
                cash += (entry - exit_p) * qty - exit_p * qty * FEE_TAKER
            held_short = []

            past = prices[idx - 14]
            scores = []
            for sym in symbols:
                if sym in today and sym in past:
                    ret = (today[sym] - past[sym]) / past[sym]
                    scores.append((ret, sym))
            scores.sort(reverse=True)

            # Top N Long
            for ret, sym in scores[:n_long]:
                if ret > 0.01:
                    cash -= long_alloc * FEE_TAKER
                    held_long.append((sym, today[sym], long_alloc / today[sym]))

            # Bottom N Short
            for ret, sym in reversed(scores[-n_short:]):
                if ret < -0.01:
                    cash -= short_alloc * FEE_TAKER
                    held_short.append((sym, today[sym], short_alloc / today[sym]))

    final_eq = equity(prices[-1])
    net = final_eq - 100.0
    return {
        "days": len(daily_pnls),
        "net": net,
        "mean": net / len(daily_pnls),
        "worst": min(daily_pnls),
        "breaches": sum(1 for v in daily_pnls if v <= -12.0),
    }

# ==============================================================================
# DIRECTION 2: DYNAMIC REGIME-SWITCHED MOMENTUM (BTC 50 SMA REGIME SIZING)
# ==============================================================================
def run_regime_switched_momentum(
    dates: list[str],
    symbols: list[str],
    prices: list[dict[str, float]],
    bull_alloc: float = 32.0,   # Sized up to $32x2=$64 in bull regime
    bear_alloc: float = 16.0,   # Sized down to $16x2=$32 in bear regime
    rebalance: int = 2,
    stop: float = 0.12,
    btc_sma_period: int = 50,
):
    cash = 100.0
    held: list[tuple[str, float, float]] = []
    since = 0
    daily_pnls: list[float] = []

    def equity(px):
        return cash + sum((px.get(sym, entry) - entry) * qty for sym, entry, qty in held)

    start_idx = max(15, btc_sma_period + 5)
    for idx in range(start_idx, len(prices)):
        today = prices[idx]
        start_eq = equity(prices[idx - 1])

        # Regime evaluation
        btc_past = [prices[idx - k].get("BTCUSDT", 0) for k in range(btc_sma_period)]
        btc_sma = sum(btc_past) / btc_sma_period if btc_past and all(p > 0 for p in btc_past) else 0
        is_bull = today.get("BTCUSDT", 0) >= btc_sma if btc_sma > 0 else True
        active_alloc = bull_alloc if is_bull else bear_alloc

        # Evaluate stops at observed close
        surviving = []
        for sym, entry, qty in held:
            if sym not in today:
                surviving.append((sym, entry, qty))
                continue
            close = today[sym]
            ret = (close - entry) / entry
            if ret <= -stop:
                cash += (close - entry) * qty - close * qty * FEE_TAKER
            else:
                surviving.append((sym, entry, qty))
        held = surviving

        # Check circuit breaker
        eq_now = equity(today)
        day_pnl = eq_now - start_eq
        fired = day_pnl <= -12.0
        if fired:
            for sym, entry, qty in held:
                exit_p = today.get(sym, entry)
                cash += (exit_p - entry) * qty - exit_p * qty * FEE_TAKER
            held = []
            eq_now = equity(today)
            day_pnl = eq_now - start_eq

        daily_pnls.append(day_pnl)

        since += 1
        if since >= rebalance and not fired:
            since = 0
            for sym, entry, qty in held:
                exit_p = today.get(sym, entry)
                cash += (exit_p - entry) * qty - exit_p * qty * FEE_TAKER
            held = []

            past = prices[idx - 14]
            scores = []
            for sym in symbols:
                if sym in today and sym in past:
                    scores.append(((today[sym] - past[sym]) / past[sym], sym))
            scores.sort(reverse=True)

            for score, sym in scores:
                if score <= 0.02:
                    break
                cash -= active_alloc * FEE_TAKER
                held.append((sym, today[sym], active_alloc / today[sym]))
                if len(held) == 2:
                    break

    final_eq = equity(prices[-1])
    net = final_eq - 100.0
    return {
        "days": len(daily_pnls),
        "net": net,
        "mean": net / len(daily_pnls),
        "worst": min(daily_pnls),
        "breaches": sum(1 for v in daily_pnls if v <= -12.0),
    }

# ==============================================================================
# DIRECTION 3: VOLATILITY-TARGETED (RISK PARITY) MOMENTUM
# ==============================================================================
def run_volatility_targeted_momentum(
    dates: list[str],
    symbols: list[str],
    prices: list[dict[str, float]],
    target_daily_risk_usd: float = 1.5,  # $1.5 daily dollar risk per position
    rebalance: int = 2,
    stop: float = 0.12,
    max_alloc_per_coin: float = 35.0,
    min_alloc_per_coin: float = 12.0,
):
    cash = 100.0
    held: list[tuple[str, float, float]] = []
    since = 0
    daily_pnls: list[float] = []

    def equity(px):
        return cash + sum((px.get(sym, entry) - entry) * qty for sym, entry, qty in held)

    for idx in range(25, len(prices)):
        today = prices[idx]
        start_eq = equity(prices[idx - 1])

        # Evaluate stops
        surviving = []
        for sym, entry, qty in held:
            if sym not in today:
                surviving.append((sym, entry, qty))
                continue
            close = today[sym]
            ret = (close - entry) / entry
            if ret <= -stop:
                cash += (close - entry) * qty - close * qty * FEE_TAKER
            else:
                surviving.append((sym, entry, qty))
        held = surviving

        # Check circuit breaker
        eq_now = equity(today)
        day_pnl = eq_now - start_eq
        fired = day_pnl <= -12.0
        if fired:
            for sym, entry, qty in held:
                exit_p = today.get(sym, entry)
                cash += (exit_p - entry) * qty - exit_p * qty * FEE_TAKER
            held = []
            eq_now = equity(today)
            day_pnl = eq_now - start_eq

        daily_pnls.append(day_pnl)

        since += 1
        if since >= rebalance and not fired:
            since = 0
            for sym, entry, qty in held:
                exit_p = today.get(sym, entry)
                cash += (exit_p - entry) * qty - exit_p * qty * FEE_TAKER
            held = []

            # Calculate 14-day momentum and 14-day volatility
            candidates = []
            for sym in symbols:
                window = [prices[idx - k].get(sym, 0) for k in range(15)]
                if all(p > 0 for p in window):
                    ret_14 = (window[0] - window[-1]) / window[-1]
                    # daily returns in window
                    rets = [(window[k] - window[k+1]) / window[k+1] for k in range(len(window)-1)]
                    mean_r = sum(rets) / len(rets)
                    vol = math.sqrt(sum((r - mean_r)**2 for r in rets) / (len(rets) - 1)) if len(rets) > 1 else 0.05
                    candidates.append((ret_14, vol, sym))

            candidates.sort(reverse=True, key=lambda x: x[0])

            for score, vol, sym in candidates:
                if score <= 0.02:
                    break
                # Dollar risk targeting: alloc * (vol * 2) = target_risk
                # i.e. alloc = target_risk / (vol * 2)
                vol_safe = max(vol, 0.02)
                alloc = min(max_alloc_per_coin, max(min_alloc_per_coin, target_daily_risk_usd / (vol_safe * 1.5)))
                cash -= alloc * FEE_TAKER
                held.append((sym, today[sym], alloc / today[sym]))
                if len(held) == 2:
                    break

    final_eq = equity(prices[-1])
    net = final_eq - 100.0
    return {
        "days": len(daily_pnls),
        "net": net,
        "mean": net / len(daily_pnls),
        "worst": min(daily_pnls),
        "breaches": sum(1 for v in daily_pnls if v <= -12.0),
    }

def main():
    dates, symbols, prices = load()

    print("==========================================================================================")
    print("                     PHASE 2 QUANT RESEARCH LAB: SYSTEMATIC EXPLORATION                   ")
    print("==========================================================================================")

    # 1. Sweep Long-Short Momentum
    print("\n[EXPERIMENT 1: Long-Short Cross-Sectional Momentum]")
    ls_results = []
    for l_alloc in [15.0, 20.0, 25.0]:
        for s_alloc in [10.0, 15.0, 20.0]:
            for reb in [2, 3]:
                for sl in [0.08, 0.12]:
                    res = run_long_short_momentum(dates, symbols, prices, long_alloc=l_alloc, short_alloc=s_alloc, rebalance=reb, stop_long=sl, stop_short=sl)
                    if res["breaches"] == 0 and res["worst"] >= -12.0:
                        ls_results.append((res["mean"], res, l_alloc, s_alloc, reb, sl))
    ls_results.sort(reverse=True)
    print(f"Top 5 Zero-Breach Long-Short configurations:")
    for mean, res, la, sa, reb, sl in ls_results[:5]:
        print(f"  Long=${la}x2 | Short=${sa}x2 | Reb={reb}d | SL={sl*100:.0f}% => Net=+{res['net']:.2f}u | Mean=+{res['mean']:.4f}u/d (+{res['mean']*365:.1f}%/yr) | Worst={res['worst']:.2f}u | Breaches={res['breaches']}")

    # 2. Sweep Regime-Switched Momentum
    print("\n[EXPERIMENT 2: Dynamic Regime-Switched Momentum (BTC 50-day SMA)]")
    regime_results = []
    for b_alloc in [28.0, 32.0, 35.0, 38.0]:
        for bear_a in [10.0, 15.0, 18.0]:
            for reb in [2, 3]:
                for sl in [0.10, 0.12, 0.15]:
                    res = run_regime_switched_momentum(dates, symbols, prices, bull_alloc=b_alloc, bear_alloc=bear_a, rebalance=reb, stop=sl)
                    if res["breaches"] == 0 and res["worst"] >= -12.0:
                        regime_results.append((res["mean"], res, b_alloc, bear_a, reb, sl))
    regime_results.sort(reverse=True)
    print(f"Top 5 Zero-Breach Regime-Switched configurations:")
    for mean, res, ba, beara, reb, sl in regime_results[:5]:
        print(f"  BullAlloc=${ba}x2 | BearAlloc=${beara}x2 | Reb={reb}d | SL={sl*100:.0f}% => Net=+{res['net']:.2f}u | Mean=+{res['mean']:.4f}u/d (+{res['mean']*365:.1f}%/yr) | Worst={res['worst']:.2f}u | Breaches={res['breaches']}")

    # 3. Sweep Volatility-Targeted Momentum
    print("\n[EXPERIMENT 3: Volatility-Targeted (Risk Parity) Momentum]")
    vol_results = []
    for risk_usd in [1.2, 1.5, 1.8, 2.0]:
        for max_a in [28.0, 32.0, 35.0]:
            for reb in [2, 3]:
                for sl in [0.10, 0.12]:
                    res = run_volatility_targeted_momentum(dates, symbols, prices, target_daily_risk_usd=risk_usd, max_alloc_per_coin=max_a, rebalance=reb, stop=sl)
                    if res["breaches"] == 0 and res["worst"] >= -12.0:
                        vol_results.append((res["mean"], res, risk_usd, max_a, reb, sl))
    vol_results.sort(reverse=True)
    print(f"Top 5 Zero-Breach Volatility-Targeted configurations:")
    for mean, res, r_usd, ma, reb, sl in vol_results[:5]:
        print(f"  RiskUSD=${r_usd} | MaxAlloc=${ma} | Reb={reb}d | SL={sl*100:.0f}% => Net=+{res['net']:.2f}u | Mean=+{res['mean']:.4f}u/d (+{res['mean']*365:.1f}%/yr) | Worst={res['worst']:.2f}u | Breaches={res['breaches']}")

if __name__ == "__main__":
    main()
