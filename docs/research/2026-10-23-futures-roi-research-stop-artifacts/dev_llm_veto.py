#!/usr/bin/env python3
"""One frozen OpenRouter veto on the DEV taker book.

The model may only allow or flat the already chosen B5 taker book.
It sees the signal day's ratios, past returns, settled funding, and the
last five unfiltered book results. It does not see the next return.
Invalid output counts as allow. Gross 1. Dates on or after 2025-05-20
are not sent and not scored. No orders.
"""
import json
import os
import threading
import time
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

import dev_taker_goal as book

ROOT = Path('/home/ubuntu/futures-new-data-feasibility-20261023')
CACHE = ROOT / 'llm-veto-cache.jsonl'
ENV = Path('/home/ubuntu/chuyen-gia-crypto/backend/.env')
MODEL = 'qwen/qwen3-30b-a3b-instruct-2507'
SYSTEM = (
    'You veto risk for a 31 USDT crypto futures account. '
    'The book for tomorrow is already chosen. '
    'Reply with only {"action":"allow"} or {"action":"flat"}. '
    'flat means hold cash tomorrow. You cannot add size, flip a side, or name a new coin. '
    'Use only the numbers given. Flat only when those past numbers show a crash-like day. '
    'Otherwise allow.'
)


def self_check() -> None:
    assert parse_action('{"action":"flat"}') == 'flat'
    assert parse_action('```json\n{"action":"allow"}\n```') == 'allow'
    assert parse_action('no') == 'allow'
    print('self_check PASS')


def env_key() -> str:
    for line in ENV.read_text().splitlines():
        if line.startswith('OPENROUTER_API_KEY='):
            return line.split('=', 1)[1].strip().strip('"').strip("'")
    raise SystemExit('missing OpenRouter key')


def parse_action(text: str) -> str:
    raw = text.strip()
    if raw.startswith('```'):
        raw = raw.strip('`')
        raw = raw.replace('json', '', 1).strip()
    try:
        action = json.loads(raw).get('action')
    except (json.JSONDecodeError, AttributeError):
        return 'allow'
    return action if action in ('allow', 'flat') else 'allow'


def load_cache() -> dict:
    out = {}
    if CACHE.exists():
        for line in CACHE.read_text().splitlines():
            if line:
                row = json.loads(line)
                out[row['day']] = row
    return out


def ask(api_key: str, day: str, payload: dict) -> str:
    body = {
        'model': MODEL,
        'temperature': 0,
        'max_tokens': 40,
        'messages': [
            {'role': 'system', 'content': SYSTEM},
            {'role': 'user', 'content': json.dumps(payload, separators=(',', ':'))},
        ],
    }
    req = urllib.request.Request(
        'https://openrouter.ai/api/v1/chat/completions',
        data=json.dumps(body).encode(),
        headers={
            'Authorization': f'Bearer {api_key}',
            'Content-Type': 'application/json',
            'HTTP-Referer': 'https://download-money-moi.vercel.app',
            'X-Title': 'chuyen-gia-crypto',
        },
        method='POST',
    )
    for attempt in range(4):
        try:
            with urllib.request.urlopen(req, timeout=40) as response:
                data = json.loads(response.read().decode())
            content = data['choices'][0]['message']['content']
            return parse_action(content if isinstance(content, str) else '')
        except urllib.error.HTTPError as exc:
            if attempt == 3 or exc.code not in (429, 500, 502, 503, 504):
                raise
        except (urllib.error.URLError, TimeoutError, KeyError, json.JSONDecodeError):
            if attempt == 3:
                return 'allow'
        time.sleep(1.5 * (attempt + 1))
    return 'allow'


def features(prices, funding):
    rows = []
    past = []
    equity = book.WALLET
    prev = {}
    cost = book.COSTS['stress']
    for i in range(1, len(prices)):
        day, px = prices[i]
        prev_day, prev_px = prices[i - 1]
        signal = {}
        view = []
        for sym in book.SYMS:
            ratio = book.taker_mean(sym, prev_day)
            if ratio is not None:
                signal[sym] = ratio
            a = prev_px[sym]
            b = prices[i - 2][1][sym] if i >= 2 else None
            older = prices[i - 8][1][sym] if i >= 8 else None
            view.append({
                'symbol': sym,
                'takerRatio': None if ratio is None else round(ratio, 4),
                'side': {1: 'long', -1: 'short', 0: 'flat'}[book.side(ratio) if ratio is not None else 0],
                'return1d': None if not (a and b) else round(a / b - 1, 4),
                'return7d': None if not (a and older) else round(a / older - 1, 4),
                'fundingSettled': round(funding[sym].get(prev_day, 0.0), 6),
            })
        w = book.weights_for(signal, 1)
        rets = {}
        for sym in book.SYMS:
            a, b = prev_px[sym], px[sym]
            if a and b:
                rets[sym] = b / a - 1
        funds = {sym: funding[sym].get(day, 0.0) for sym in book.SYMS}
        pnl, _ret = book.day_return(equity, rets, w, funds, prev, cost)
        rows.append({
            'day': day,
            'signalDay': prev_day,
            'weights': w,
            'rets': rets,
            'funds': funds,
            'payload': {
                'signalDay': prev_day,
                'recentBookPnl': [round(x, 4) for x in past[-5:]],
                'legs': view,
            },
        })
        equity += pnl
        prev = w
        past.append(pnl)
    return rows


def score(rows, actions, cost):
    equity = book.WALLET
    prev = {}
    pnls = []
    for row in rows:
        w = row['weights'] if actions.get(row['signalDay']) != 'flat' else {}
        pnl, _ret = book.day_return(equity, row['rets'], w, row['funds'], prev, cost)
        equity += pnl
        prev = w
        pnls.append(pnl)
    n = len(pnls)
    net = sum(pnls)
    worst = min(pnls) if pnls else 0.0
    return {'days': n, 'net': net, 'mean': net / n if n else 0.0, 'worst': worst,
            'year': (net / n * 365) if n else 0.0, 'flats': sum(1 for row in rows if actions.get(row['signalDay']) == 'flat')}


def main():
    self_check()
    prices = book.load_prices()
    funding = book.load_funding()
    rows = features(prices, funding)
    base = score(rows, {}, book.COSTS['stress'])
    print(f"allow_all mean {base['mean']:.6f} worst {base['worst']:.4f} year {base['year']:.2f}", flush=True)
    cache = load_cache()
    api_key = env_key()
    pending = [row for row in rows if row['signalDay'] not in cache]
    lock = threading.Lock()
    done = 0
    with CACHE.open('a') as handle:
        def one(row):
            action = ask(api_key, row['signalDay'], row['payload'])
            return row['signalDay'], action

        with ThreadPoolExecutor(max_workers=4) as pool:
            futures = [pool.submit(one, row) for row in pending]
            for future in as_completed(futures):
                day, action = future.result()
                record = {'day': day, 'action': action}
                with lock:
                    cache[day] = record
                    handle.write(json.dumps(record) + '\n')
                    handle.flush()
                    done += 1
                    if done % 25 == 0 or done == len(pending):
                        print(f'asked {done}/{len(pending)}', flush=True)
    actions = {day: row['action'] for day, row in cache.items()}
    vetoed = score(rows, actions, book.COSTS['stress'])
    report = {'model': MODEL, 'allowAll': base, 'vetoed': vetoed,
              'verdict': 'BETTER_TAIL_AND_MEAN' if vetoed['mean'] > base['mean'] and vetoed['worst'] > base['worst'] else 'NOT_BETTER'}
    (ROOT / 'dev-llm-veto.json').write_text(json.dumps(report, indent=2) + '\n')
    print(json.dumps(report, indent=2))


if __name__ == '__main__':
    main()
