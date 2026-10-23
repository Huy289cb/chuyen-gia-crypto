#!/usr/bin/env python3
"""DEV-only check of one precommitted rule against the 0.2u/day goal.

Rule, fixed before the run: next-day continuation of today's mean taker
buy/sell volume ratio on B5. Ratio > 1 is long. Gross is 1 or 8, the research
cap. The 512-day window is not scored and is not used to pick this rule.
No orders, no live access.
"""
import csv
import json
import zipfile
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path('/home/ubuntu/futures-new-data-feasibility-20261023')
PRICES = Path('/home/ubuntu/futures-news-shock-512d-20261020/data/daily-source.csv')
FUNDING = Path('/home/ubuntu/futures-roi-plus-screen-20261021/funding40')
SYMS = ('BTCUSDT', 'ETHUSDT', 'BNBUSDT', 'SOLUSDT', 'XRPUSDT')
DEV_END = '2025-05-20'  # score return dates strictly before this
WALLET = 31.47744546
COSTS = {'base': 0.0007, 'stress': 0.0012}
GOAL = 0.2
GROSS_CAP = 8


def self_check() -> None:
    pnl, ret = day_return(100.0, {'BTCUSDT': 0.01}, {'BTCUSDT': 1.0}, {'BTCUSDT': 0.001}, {}, 0.001)
    assert abs(ret - 0.008) < 1e-12 and abs(pnl - 0.8) < 1e-12, (pnl, ret)
    assert side(1.2) == 1 and side(0.8) == -1 and side(1.0) == 0
    print('self_check PASS')


def side(ratio: float) -> int:
    if ratio > 1:
        return 1
    if ratio < 1:
        return -1
    return 0


def day_return(equity, price_rets, weights, fund_rates, prev, cost):
    ret = 0.0
    turn = 0.0
    names = set(weights) | set(prev)
    for sym in names:
        w = weights.get(sym, 0.0)
        ret += w * price_rets.get(sym, 0.0)
        ret -= w * fund_rates.get(sym, 0.0)
        turn += abs(w - prev.get(sym, 0.0))
    ret -= turn * cost
    return equity * ret, ret


def load_prices():
    rows = list(csv.reader(PRICES.open()))
    header = rows[0]
    idx = {sym: header.index(sym) for sym in SYMS}
    out = []
    for row in rows[1:]:
        if row[0] >= DEV_END:
            break
        px = {}
        for sym, j in idx.items():
            px[sym] = float(row[j]) if row[j] else None
        out.append((row[0], px))
    return out


_TAKER = {}


def taker_mean(sym: str, day: str):
    key = (sym, day)
    if key in _TAKER:
        return _TAKER[key]
    path = ROOT / 'data' / 'metrics' / sym / f'{sym}-metrics-{day}.zip'
    if not path.exists():
        _TAKER[key] = None
        return None
    with zipfile.ZipFile(path) as archive:
        text = archive.read(archive.namelist()[0]).decode()
    vals = []
    for line in text.splitlines():
        cols = line.split(',')
        if len(cols) != 8 or cols[0] == 'create_time':
            continue
        raw = cols[7]
        if raw in ('', '""'):
            continue
        vals.append(float(raw))
    got = sum(vals) / len(vals) if vals else None
    _TAKER[key] = got
    return got


def load_funding():
    out = {sym: {} for sym in SYMS}
    for sym in SYMS:
        events = json.loads((FUNDING / f'{sym}.json').read_text())
        for ms, rate in events:
            day = datetime.fromtimestamp(ms / 1000, timezone.utc).strftime('%Y-%m-%d')
            if day >= DEV_END:
                continue
            out[sym][day] = out[sym].get(day, 0.0) + rate
    return out


def weights_for(signal, gross):
    active = {sym: side(ratio) for sym, ratio in signal.items() if side(ratio)}
    n = len(active)
    if n == 0:
        return {}
    leg = gross / n
    return {sym: sign * leg for sym, sign in active.items()}


def run(prices, funding, gross, cost, invert=False):
    equity = WALLET
    prev = {}
    pnls = []
    for i in range(1, len(prices)):
        day, px = prices[i]
        prev_day, prev_px = prices[i - 1]
        signal = {}
        for sym in SYMS:
            ratio = taker_mean(sym, prev_day)
            if ratio is not None:
                signal[sym] = (1 / ratio) if invert and ratio else ratio
        w = weights_for(signal, gross)
        rets = {}
        for sym in SYMS:
            a, b = prev_px[sym], px[sym]
            if a and b:
                rets[sym] = b / a - 1
        funds = {sym: funding[sym].get(day, 0.0) for sym in SYMS}
        pnl, ret = day_return(equity, rets, w, funds, prev, cost)
        equity += pnl
        prev = w
        pnls.append(pnl)
    n = len(pnls)
    net = sum(pnls)
    worst = min(pnls) if pnls else 0.0
    return {
        'days': n,
        'net': net,
        'mean': net / n if n else 0.0,
        'worst': worst,
        'endEquity': equity,
        'daysBeyondSoft': sum(1 for x in pnls if x <= -5.9),
        'daysBeyond12': sum(1 for x in pnls if x <= -12),
    }


def main():
    self_check()
    prices = load_prices()
    funding = load_funding()
    report = {
        'status': 'DEV_ONLY_ONE_RULE',
        'rule': 'taker_ratio_continuation_next_day_B5',
        'devReturnDatesBefore': DEV_END,
        'goalMean': GOAL,
        'cases': {},
    }
    for gross in (1, GROSS_CAP):
        for cost_name, cost in COSTS.items():
            for invert, tag in ((False, 'continuation'), (True, 'invert')):
                key = f'g{gross}_{cost_name}_{tag}'
                report['cases'][key] = run(prices, funding, gross, cost, invert)
                row = report['cases'][key]
                print(f"{key} days {row['days']} net {row['net']:.4f} mean {row['mean']:.6f} "
                      f"worst {row['worst']:.4f} soft {row['daysBeyondSoft']} cap {row['daysBeyond12']}",
                      flush=True)
    goal = report['cases'][f'g{GROSS_CAP}_stress_continuation']
    report['verdict'] = (
        'REACHES_DEV_GOAL' if goal['mean'] >= GOAL and goal['daysBeyond12'] == 0 else 'MISSES_DEV_GOAL'
    )
    (ROOT / 'dev-taker-goal.json').write_text(json.dumps(report, indent=2) + '\n')
    print(report['verdict'])


if __name__ == '__main__':
    main()
