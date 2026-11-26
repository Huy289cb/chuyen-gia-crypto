#!/usr/bin/env python3
"""
INDEPENDENT MULTI-HORIZON BACKTEST AUDIT: DEFENSIVE IMPROVEMENTS SUITE
======================================================================
Tests the implemented improvements against the v1.0.0 baseline across:
  1. Canonical 1,500-day daily-source.csv (Close-only, 2022-09 .. 2026-10)
  2. Real Binance Futures 1d OHLCV 1,500-day dataset (Intraday H/L, 2022-11 .. 2026-11)
  3. Recent 180-day OHLCV window (2026-05-30 .. 2026-11-25)
  4. Hourly (1h) resolution across 64 live-traded + core coins in the 27-day live window (2026-10-30 .. 2026-11-25)

Improvements evaluated (v1.0.1):
  - Falling-Knife 24h/Intraday Guard: skip candidates down <= -15.0% in 24h / intraday
  - BTC Macro Bear Defensive Mode: when BTC 14d return <= -10.0%, cap to 1 slot x 25% equity (75% cash)
  - Differentiated Cooldown: 2h cooldown after profitable ratchet exit (preserves trend continuation)
"""

from __future__ import annotations
import concurrent.futures
import csv
import json
import sys
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

CSV = Path(__file__).resolve().parents[1] / "tests/fixtures/cct-source-projection/daily-source.csv"
FEE_TAKER = 0.00055

CORE_40 = [
    "BTCUSDT", "ETHUSDT", "BNBUSDT", "SOLUSDT", "XRPUSDT", "DOGEUSDT", "ADAUSDT",
    "AVAXUSDT", "LINKUSDT", "LTCUSDT", "DOTUSDT", "TRXUSDT", "UNIUSDT", "ATOMUSDT",
    "ETCUSDT", "XLMUSDT", "BCHUSDT", "FILUSDT", "NEARUSDT", "APTUSDT", "ARBUSDT",
    "OPUSDT", "INJUSDT", "SUIUSDT", "AAVEUSDT", "ICPUSDT", "ALGOUSDT", "SANDUSDT",
    "GALAUSDT", "GRTUSDT", "1000PEPEUSDT", "WLDUSDT", "SEIUSDT", "TIAUSDT",
    "RUNEUSDT", "ENAUSDT", "ORDIUSDT", "DYDXUSDT", "JUPUSDT", "ZECUSDT",
]

LIVE_DYN_24 = [
    "LISTAUSDT", "ONUSDT", "ELSAUSDT", "BLESSUSDT", "BEAMXUSDT", "AIOUSDT",
    "PIPPINUSDT", "ICNTUSDT", "IRYSUSDT", "BARDUSDT", "LITUSDT", "KERNELUSDT",
    "VVVUSDT", "DODOXUSDT", "SPACEUSDT", "MMTUSDT", "CROSSUSDT", "BREVUSDT",
    "HOTUSDT", "AIOTUSDT", "CAPUSDT", "CLANKERUSDT", "HYPEUSDT", "POWRUSDT",
]


def load_csv():
    with CSV.open() as handle:
        rows = list(csv.reader(handle))
    syms = rows[0][1:]
    dates = [r[0] for r in rows[1:]]
    data = {s: {} for s in syms}
    for r in rows[1:]:
        d = r[0]
        for i, s in enumerate(syms):
            raw = r[i + 1].strip()
            if raw:
                px = float(raw)
                if px > 0:
                    data[s][d] = (px, px, px, px)
    return dates, syms, data


def fetch_klines(sym: str, interval: str, limit: int):
    url = f"https://fapi.binance.com/fapi/v1/klines?symbol={sym}&interval={interval}&limit={limit}"
    with urllib.request.urlopen(url, timeout=10) as resp:
        return sym, json.loads(resp.read())


def load_binance_1d():
    ohlcv = {}
    with concurrent.futures.ThreadPoolExecutor(max_workers=10) as ex:
        for sym, rows in ex.map(lambda s: fetch_klines(s, "1d", 1500), CORE_40):
            ohlcv[sym] = {
                datetime.fromtimestamp(k[0] / 1000, tz=timezone.utc).strftime("%Y-%m-%d"): (
                    float(k[1]), float(k[2]), float(k[3]), float(k[4])
                )
                for k in rows
            }
    return sorted(ohlcv["BTCUSDT"].keys()), CORE_40, ohlcv


def load_binance_1h():
    all_syms = list(dict.fromkeys(CORE_40 + LIVE_DYN_24))
    h1 = {}
    with concurrent.futures.ThreadPoolExecutor(max_workers=12) as ex:
        for sym, rows in ex.map(lambda s: fetch_klines(s, "1h", 1050), all_syms):
            h1[sym] = {
                k[0]: (float(k[1]), float(k[2]), float(k[3]), float(k[4]))
                for k in rows
            }
    return sorted(h1["BTCUSDT"].keys()), all_syms, h1


def sim_daily(dates, syms, data, start_idx, end_idx, use_hl: bool, improved: bool, max_atr=0.20):
    cash = 100.0
    held = []
    since_reb = 0
    cooldown = {}
    peak = 100.0
    max_dd = 0.0
    worst_day = 0.0
    breakers = 0
    trades = wins = sl_init = sl_lock = prune = 0
    daily_pnls = []

    def cpx(s, d, fb):
        return data[s][d][3] if d in data.get(s, {}) else fb

    def eq(di):
        d = dates[di]
        return cash + sum((cpx(p["sym"], d, p["entry"]) - p["entry"]) * p["qty"] for p in held)

    def atr_pct(s, idx):
        trs = []
        for j in range(max(1, idx - 13), idx + 1):
            dj, dp = dates[j], dates[j - 1]
            if dj in data[s] and dp in data[s]:
                _, h, l, _ = data[s][dj]
                pc = data[s][dp][3]
                if pc > 0:
                    trs.append(max(h - l, abs(h - pc), abs(l - pc)) / pc)
        return sum(trs) / len(trs) if trs else 0.05

    for idx in range(start_idx, end_idx):
        d, dp = dates[idx], dates[idx - 1]
        start_eq = eq(idx - 1)
        if start_eq > peak:
            peak = start_eq
        dd = (peak - start_eq) / peak if peak > 0 else 0.0
        if dd > max_dd:
            max_dd = dd

        btc_c = data["BTCUSDT"][d][3]
        btc_p = data["BTCUSDT"][dp][3]
        btc_1d = (btc_c - btc_p) / btc_p
        btc_14d = (btc_c - data["BTCUSDT"][dates[idx - 14]][3]) / data["BTCUSDT"][dates[idx - 14]][3]

        eff_slots = 2
        eff_alloc = 0.35
        if improved and btc_14d <= -0.10:
            eff_slots = 1
            eff_alloc = 0.25
        mom_alloc = 100.0 * eff_alloc

        surviving = []
        for p in held:
            p["days"] += 1
            s, e, q = p["sym"], p["entry"], p["qty"]
            if d not in data.get(s, {}):
                surviving.append(p)
                continue
            o, h, l, c = data[s][d]
            if not use_hl:
                h = l = c
            ret_l, ret_h, ret_c = (l - e) / e, (h - e) / e, (c - e) / e

            if ret_l <= p["sl"]:
                ep = min(o, e * (1 + p["sl"])) if (use_hl and o < e * (1 + p["sl"])) else e * (1 + p["sl"])
                pnl = (ep - e) * q - ep * q * FEE_TAKER
                cash += pnl
                trades += 1
                if pnl > 0:
                    wins += 1
                if p["sl"] >= 0.008:
                    sl_lock += 1
                else:
                    sl_init += 1
                cooldown[s] = idx
                continue

            if ret_h > p["max_ret"]:
                p["max_ret"] = ret_h
            for thr, sl_lvl in [(0.14, 0.10), (0.10, 0.06), (0.07, 0.035), (0.05, 0.008)]:
                if p["max_ret"] >= thr:
                    p["sl"] = max(p["sl"], sl_lvl)
                    break

            if ret_c <= p["sl"]:
                ep = e * (1 + p["sl"])
                pnl = (ep - e) * q - ep * q * FEE_TAKER
                cash += pnl
                trades += 1
                if pnl > 0:
                    wins += 1
                if p["sl"] >= 0.008:
                    sl_lock += 1
                else:
                    sl_init += 1
                cooldown[s] = idx
                continue

            if p["days"] >= 2 and p["max_ret"] < 0.02 and ret_l <= -0.05:
                ep = e * 0.95
                cash += (ep - e) * q - ep * q * FEE_TAKER
                trades += 1
                prune += 1
                cooldown[s] = idx
                continue

            surviving.append(p)
        held = surviving

        mid_eq = eq(idx)
        fired = (mid_eq - start_eq) <= -max(12.0, start_eq * 0.12)
        if fired:
            breakers += 1
            for p in held:
                ep = cpx(p["sym"], d, p["entry"])
                cash += (ep - p["entry"]) * p["qty"] - ep * p["qty"] * FEE_TAKER
                trades += 1
            held = []

        since_reb += 1
        btc_blk = btc_1d <= -0.03

        def pick(excl, need):
            if need <= 0:
                return []
            dp14 = dates[idx - 14]
            sc = []
            for s in syms:
                if s == "BTCUSDT" or s in excl or cooldown.get(s) == idx:
                    continue
                if d not in data[s] or dp14 not in data[s] or dp not in data[s]:
                    continue
                cn, cp, cy = data[s][d][3], data[s][dp14][3], data[s][dp][3]
                if cp <= 0 or cy <= 0:
                    continue
                m14 = (cn - cp) / cp
                r1 = (cn - cy) / cy
                if m14 < 0.02:
                    continue
                if improved and r1 <= -0.15:
                    continue
                if max_atr is not None and atr_pct(s, idx) > max_atr:
                    continue
                sc.append((m14, s))
            sc.sort(reverse=True)
            return [s for _, s in sc[:need]]

        if since_reb >= 3 and not fired:
            since_reb = 0
            for p in held:
                ep = cpx(p["sym"], d, p["entry"])
                pnl = (ep - p["entry"]) * p["qty"] - ep * p["qty"] * FEE_TAKER
                cash += pnl
                trades += 1
                if pnl > 0:
                    wins += 1
            held = []
            if not btc_blk:
                for s in pick(set(), eff_slots):
                    px = data[s][d][3]
                    cash -= mom_alloc * FEE_TAKER
                    held.append({"sym": s, "entry": px, "qty": mom_alloc / px, "sl": -0.12, "max_ret": 0.0, "days": 0})
        elif not fired and len(held) < eff_slots and not btc_blk:
            cur_s = {p["sym"] for p in held}
            for s in pick(cur_s, eff_slots - len(held)):
                px = data[s][d][3]
                cash -= mom_alloc * FEE_TAKER
                held.append({"sym": s, "entry": px, "qty": mom_alloc / px, "sl": -0.12, "max_ret": 0.0, "days": 0})

        end_eq = eq(idx)
        dpnl = end_eq - start_eq
        dpct = dpnl / start_eq if start_eq > 0 else 0.0
        if dpct < worst_day:
            worst_day = dpct
        daily_pnls.append(dpnl)

    half = len(daily_pnls) // 2
    return {
        "net": eq(end_idx - 1) - 100.0,
        "mdd": max_dd * 100,
        "worst": worst_day * 100,
        "p1": sum(daily_pnls[:half]),
        "p2": sum(daily_pnls[half:]),
        "r512": sum(daily_pnls[-512:]) / 512.0,
        "sl": sl_init,
        "brk": breakers,
        "trades": trades,
    }


def sim_1h(ts_list, all_syms, h1, improved: bool):
    t_start = int(datetime(2026, 10, 30, 0, 0, tzinfo=timezone.utc).timestamp() * 1000)
    start_idx = next(i for i, t in enumerate(ts_list) if t >= t_start)

    cash = 100.0
    held = []
    cooldown_until = {}
    days_since_reb = 0
    last_day = ""
    peak = 100.0
    max_dd = 0.0
    worst_day = 0.0
    day_start_eq = 100.0
    trades = wins = sl_init = sl_lock = sl_be = prune = 0
    profit_cd_hours = 2

    def eq(ti):
        t = ts_list[ti]
        return cash + sum((h1[p["sym"]].get(t, (0, 0, 0, p["entry"]))[3] - p["entry"]) * p["qty"] for p in held)

    def sym_atr_pct(s, ti):
        trs = []
        for d_off in range(14):
            e_i = ti - d_off * 24
            s_i = e_i - 24
            p_i = s_i - 24
            if p_i < 0:
                break
            hs = [h1[s][ts_list[j]][1] for j in range(s_i + 1, e_i + 1) if ts_list[j] in h1[s]]
            ls = [h1[s][ts_list[j]][2] for j in range(s_i + 1, e_i + 1) if ts_list[j] in h1[s]]
            pc = h1[s].get(ts_list[s_i], (0, 0, 0, 0))[3]
            if hs and pc > 0:
                hi, lo = max(hs), min(ls)
                trs.append(max(hi - lo, abs(hi - pc), abs(lo - pc)) / pc)
        return sum(trs) / len(trs) if trs else 0.05

    def rank_candidates(ti, excl, need):
        if need <= 0:
            return []
        t = ts_list[ti]
        t_24 = ts_list[ti - 24]
        t_14d = ts_list[ti - 14 * 24]
        sc = []
        for s in all_syms:
            if s == "BTCUSDT" or s in excl or cooldown_until.get(s, 0) > t:
                continue
            if t not in h1[s] or t_14d not in h1[s] or t_24 not in h1[s]:
                continue
            cn, c14, c24 = h1[s][t][3], h1[s][t_14d][3], h1[s][t_24][3]
            if c14 <= 0 or c24 <= 0:
                continue
            m14 = (cn - c14) / c14
            r24 = (cn - c24) / c24
            if m14 < 0.02:
                continue
            if improved and r24 <= -0.15:
                continue
            if sym_atr_pct(s, ti) > 0.20:
                continue
            sc.append((m14, s))
        sc.sort(reverse=True)
        return [s for _, s in sc[:need]]

    for ti in range(start_idx, len(ts_list)):
        t = ts_list[ti]
        utc_day = datetime.fromtimestamp(t / 1000, tz=timezone.utc).strftime("%Y-%m-%d")
        next_midnight = (t // 86_400_000 + 1) * 86_400_000
        btc_c = h1["BTCUSDT"][t][3]
        btc_24 = h1["BTCUSDT"][ts_list[ti - 24]][3]
        btc_14d_ago = h1["BTCUSDT"][ts_list[ti - 14 * 24]][3]
        btc_24h_ret = (btc_c - btc_24) / btc_24
        btc_14d_ret = (btc_c - btc_14d_ago) / btc_14d_ago

        eff_slots = 1 if (improved and btc_14d_ret <= -0.10) else 2
        eff_alloc = 0.25 if (improved and btc_14d_ret <= -0.10) else 0.35
        btc_blk = btc_24h_ret <= -0.03

        if utc_day != last_day:
            if last_day != "":
                days_since_reb += 1
            last_day = utc_day
            day_start_eq = eq(ti - 1)

        if days_since_reb >= 3 and not btc_blk:
            days_since_reb = 0
            picks = rank_candidates(ti, set(), eff_slots)
            if picks:
                new_held = []
                for p in held:
                    if p["sym"] in picks:
                        new_held.append(p)
                    else:
                        ep = h1[p["sym"]].get(t, (0, 0, 0, p["entry"]))[3]
                        pnl = (ep - p["entry"]) * p["qty"] - ep * p["qty"] * FEE_TAKER
                        cash += pnl
                        trades += 1
                        if pnl > 0:
                            wins += 1
                held = new_held
                cur_s = {p["sym"] for p in held}
                mom_alloc = 100.0 * eff_alloc
                for s in picks:
                    if s not in cur_s and len(held) < eff_slots:
                        px = h1[s][t][3]
                        cash -= mom_alloc * FEE_TAKER
                        held.append({"sym": s, "entry": px, "qty": mom_alloc / px, "sl": -0.12, "max_ret": 0.0, "entry_ts": t, "tier": "initial"})

        surviving = []
        for p in held:
            s, e, q = p["sym"], p["entry"], p["qty"]
            if t not in h1[s]:
                surviving.append(p)
                continue
            o, hi, lo, cl = h1[s][t]
            ret_l, ret_h, ret_c = (lo - e) / e, (hi - e) / e, (cl - e) / e
            if ret_l <= p["sl"]:
                ep = e * (1 + p["sl"])
                pnl = (ep - e) * q - ep * q * FEE_TAKER
                cash += pnl
                trades += 1
                if pnl > 0:
                    wins += 1
                if p["sl"] >= 0.03:
                    sl_lock += 1
                elif p["sl"] > 0:
                    sl_be += 1
                else:
                    sl_init += 1
                cooldown_until[s] = (t + profit_cd_hours * 3_600_000) if p["tier"] in ("breakeven", "lock1", "lock2", "lock3") else next_midnight
                continue

            if ret_h > p["max_ret"]:
                p["max_ret"] = ret_h
            for thr, sl_lvl, tn in [(0.14, 0.10, "lock3"), (0.10, 0.06, "lock2"), (0.07, 0.035, "lock1"), (0.05, 0.008, "breakeven")]:
                if p["max_ret"] >= thr:
                    if sl_lvl > p["sl"]:
                        p["sl"] = sl_lvl
                        p["tier"] = tn
                    break

            if ret_c <= p["sl"]:
                ep = e * (1 + p["sl"])
                pnl = (ep - e) * q - ep * q * FEE_TAKER
                cash += pnl
                trades += 1
                if pnl > 0:
                    wins += 1
                if p["sl"] >= 0.03:
                    sl_lock += 1
                elif p["sl"] > 0:
                    sl_be += 1
                else:
                    sl_init += 1
                cooldown_until[s] = (t + profit_cd_hours * 3_600_000) if p["tier"] in ("breakeven", "lock1", "lock2", "lock3") else next_midnight
                continue

            if (t - p["entry_ts"]) / 86_400_000 >= 2.0 and p["max_ret"] < 0.02 and ret_c <= -0.05:
                cash += (cl - e) * q - cl * q * FEE_TAKER
                trades += 1
                prune += 1
                cooldown_until[s] = next_midnight
                continue

            surviving.append(p)
        held = surviving

        if len(held) < eff_slots and not btc_blk:
            cur_s = {p["sym"] for p in held}
            mom_alloc = 100.0 * eff_alloc
            for s in rank_candidates(ti, cur_s, eff_slots - len(held)):
                px = h1[s][t][3]
                cash -= mom_alloc * FEE_TAKER
                held.append({"sym": s, "entry": px, "qty": mom_alloc / px, "sl": -0.12, "max_ret": 0.0, "entry_ts": t, "tier": "initial"})

        cur_eq = eq(ti)
        if cur_eq > peak:
            peak = cur_eq
        dd = (peak - cur_eq) / peak if peak > 0 else 0.0
        if dd > max_dd:
            max_dd = dd
        dpct = (cur_eq - day_start_eq) / day_start_eq if day_start_eq > 0 else 0.0
        if dpct < worst_day:
            worst_day = dpct
        if (cur_eq - day_start_eq) <= -max(12.0, day_start_eq * 0.12):
            for p in held:
                ep = h1[p["sym"]].get(t, (0, 0, 0, p["entry"]))[3]
                cash += (ep - p["entry"]) * p["qty"] - ep * p["qty"] * FEE_TAKER
                trades += 1
            held = []

    return {
        "net": eq(len(ts_list) - 1) - 100.0,
        "mdd": max_dd * 100,
        "worst": worst_day * 100,
        "trades": trades,
        "wr": wins / trades * 100 if trades else 0.0,
        "sl": sl_init,
        "lock": sl_lock,
        "be": sl_be,
        "prune": prune,
    }


def main():
    csv_dates, csv_syms, csv_data = load_csv()
    d_dates, d_syms, d_data = load_binance_1d()
    h1_ts, h1_syms, h1_data = load_binance_1h()

    print("=" * 115)
    print("INDEPENDENT MULTI-HORIZON BACKTEST AUDIT: v1.0.0 BASELINE VS DEFENSIVE IMPROVEMENTS")
    print("=" * 115)

    for label, fn in [
        ("1. Canonical 1500d CSV (Close-only, 2022-09..2026-10)", lambda imp: sim_daily(csv_dates, csv_syms, csv_data, 15, len(csv_dates), False, imp, max_atr=None)),
        ("2. Real Binance OHLCV 1500d (Intraday H/L, 2022-11..2026-11)", lambda imp: sim_daily(d_dates, d_syms, d_data, 15, len(d_dates), True, imp)),
        ("3. Recent 180d OHLCV (2026-05-30..2026-11-25)", lambda imp: sim_daily(d_dates, d_syms, d_data, len(d_dates) - 180, len(d_dates), True, imp)),
    ]:
        base = fn(False)
        imp = fn(True)
        print(f"\n[{label}]")
        print(f"  Baseline v1.0.0 : Net={base['net']:+7.2f}u | MDD={base['mdd']:4.1f}% | Worst={base['worst']:6.2f}% | R512={base['r512']:+.4f}u/d | SL={base['sl']:3d} | Brk={base['brk']}")
        print(f"  Improved Suite  : Net={imp['net']:+7.2f}u | MDD={imp['mdd']:4.1f}% | Worst={imp['worst']:6.2f}% | R512={imp['r512']:+.4f}u/d | SL={imp['sl']:3d} | Brk={imp['brk']}")

    base_1h = sim_1h(h1_ts, h1_syms, h1_data, False)
    imp_1h = sim_1h(h1_ts, h1_syms, h1_data, True)
    print("\n[4. Hourly (1h) Live Window (2026-10-30..2026-11-25, 64 Core+Dynamic Coins)]")
    print(f"  Baseline v1.0.0 : Net={base_1h['net']:+7.2f}u | MDD={base_1h['mdd']:4.1f}% | Worst={base_1h['worst']:6.2f}% | T={base_1h['trades']:2d} WR={base_1h['wr']:4.1f}% | SL={base_1h['sl']:2d} Lock={base_1h['lock']:2d} BE={base_1h['be']:2d}")
    print(f"  Improved Suite  : Net={imp_1h['net']:+7.2f}u | MDD={imp_1h['mdd']:4.1f}% | Worst={imp_1h['worst']:6.2f}% | T={imp_1h['trades']:2d} WR={imp_1h['wr']:4.1f}% | SL={imp_1h['sl']:2d} Lock={imp_1h['lock']:2d} BE={imp_1h['be']:2d}")

    ok = (
        imp_1h["net"] > base_1h["net"]
        and imp_1h["mdd"] < base_1h["mdd"]
        and imp_1h["sl"] < base_1h["sl"]
    )
    print(f"\n>>> VERDICT: {'PASS_DEFENSIVE_IMPROVEMENTS_AUDIT ✅' if ok else 'FAIL ❌'} <<<")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
