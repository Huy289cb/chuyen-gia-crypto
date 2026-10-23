#!/usr/bin/env python3
"""Read public candles; diagnose rejected signals without changing trading state.

Run with an audit directory containing protocol.json, observations.json, decisions.json.
This is an overlapping fixed-quantity barrier study, not a portfolio backtest.
"""
import bisect
import collections
import datetime as dt
import hashlib
import json
import pathlib
import re
import sys
import time
import urllib.parse
import urllib.request

MINUTE = 60_000


def timestamp(value):
    value = value.replace('Z', '+00:00')
    value = re.sub(r'\.(\d+)', lambda m: '.' + m[1][:6].ljust(6, '0'), value)
    parsed = dt.datetime.fromisoformat(value)
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=dt.timezone.utc)
    return int(parsed.timestamp() * 1000)


def hit(bar, side, sl, tp):
    opened, high, low = map(float, (bar[1], bar[2], bar[3]))
    # An open beyond a barrier proves that barrier has already been reached.
    if (side == 'long' and opened <= sl) or (side == 'short' and opened >= sl):
        return 'sl_first', opened
    if (side == 'long' and opened >= tp) or (side == 'short' and opened <= tp):
        return 'tp_first', tp
    stop = low <= sl if side == 'long' else high >= sl
    target = high >= tp if side == 'long' else low <= tp
    if stop and target:
        return 'ambiguous', None
    if stop:
        return 'sl_first', sl
    if target:
        return 'tp_first', tp
    return None, None


def download(directory, protocol):
    def request(endpoint, params):
        url = protocol['base_url'] + endpoint + '?' + urllib.parse.urlencode(params)
        for attempt in range(3):
            try:
                with urllib.request.urlopen(url, timeout=25) as response:
                    return json.load(response)
            except Exception:
                if attempt == 2:
                    raise
                time.sleep(1 + attempt)

    path = directory / 'candles-1m.json'
    if not path.exists():
        candles = []
        cursor = protocol['start_ms']
        while cursor < protocol['end_ms']:
            rows = request('/fapi/v1/klines', dict(symbol=protocol['symbol'], interval='1m', startTime=cursor, endTime=protocol['end_ms']-1, limit=1000))
            if not rows:
                raise RuntimeError('Incomplete candle response')
            candles.extend(rows)
            cursor = rows[-1][0] + MINUTE
            print('downloaded', len(candles), flush=True)
        path.write_text(json.dumps(candles))
    candles = json.loads(path.read_text())
    times = [b[0] for b in candles]
    if times != list(range(protocol['start_ms'], protocol['end_ms'], MINUTE)):
        raise RuntimeError('Candle coverage mismatch, gap, duplicate, or unsorted data')
    funding_path = directory / 'funding.json'
    if not funding_path.exists():
        funding_path.write_text(json.dumps(request('/fapi/v1/fundingRate', dict(symbol=protocol['symbol'], startTime=protocol['start_ms'], endTime=protocol['end_ms']-1, limit=1000))))
    funding = json.loads(funding_path.read_text())
    if not funding or any(float(f['markPrice']) <= 0 for f in funding):
        raise RuntimeError('Missing funding evidence')
    return candles, funding


def evaluate(plan, candles, times, funding, protocol):
    output = dict(plan)
    start = bisect.bisect_right(times, plan['decision_ms'])
    if start == len(candles):
        return dict(output, outcome='censored_before_entry')
    side = plan['side']
    if plan['kind'] == 'stored_levels':
        entry, sl, tp = plan['entry'], plan['sl'], plan['tp']
        ttl = plan['decision_ms'] + 45 * MINUTE
        while start < len(candles) and times[start] <= ttl:
            bar = candles[start]
            if float(bar[3]) <= entry <= float(bar[2]):
                break
            start += 1
        if start == len(candles) or times[start] > ttl:
            return dict(output, outcome='unfilled' if protocol['end_ms'] >= ttl else 'censored_before_fill')
        bar = candles[start]
        touches_sl = float(bar[3]) <= sl if side == 'long' else float(bar[2]) >= sl
        touches_tp = float(bar[2]) >= tp if side == 'long' else float(bar[3]) <= tp
        if touches_sl or touches_tp:
            return dict(output, outcome='entry_bar_ambiguous', entry_ms=times[start])
        entry_ms = times[start]
        first = start + 1
    else:
        entry = float(candles[start][1])
        direction = 1 if side == 'long' else -1
        sl = entry * (1 - direction * protocol['hypothetical_sl_fraction'])
        tp = entry * (1 + direction * protocol['hypothetical_sl_fraction'] * protocol['hypothetical_rr'])
        entry_ms = times[start]
        first = start
    output.update(entry=entry, sl=sl, tp=tp, entry_ms=entry_ms)
    deadline = entry_ms + protocol['horizon_hours'] * 3600_000
    for index in range(first, len(candles)):
        if times[index] >= deadline:
            break
        status, price = hit(candles[index], side, sl, tp)
        if status:
            output.update(outcome=status, exit_bar_ms=times[index], exit_price=price)
            if price is not None:
                direction = 1 if side == 'long' else -1
                quantity = .001
                # Funding at the opening instant is excluded; the exit minute
                # timestamp is an approximation, explicitly reported.
                funding_cost = sum(direction * quantity * float(f['markPrice']) * float(f['fundingRate']) for f in funding if entry_ms < f['fundingTime'] <= times[index])
                gross = direction * quantity * (price - entry)
                fees = quantity * (entry + price) * protocol['fee_fraction_per_side']
                output.update(gross_usd=gross, fees_usd=fees, funding_usd=funding_cost)
                for scenario in ['base', 'stress']:
                    output['net_' + scenario] = gross - fees - funding_cost - quantity * entry * protocol['slippage_round_trip_' + scenario]
            return output
    return dict(output, outcome='timeout_48h' if protocol['end_ms'] >= deadline else 'censored')


def summarize(rows):
    settled = [r for r in rows if r['outcome'] in ['sl_first', 'tp_first']]
    result = {'n': len(rows), 'outcomes': dict(collections.Counter(r['outcome'] for r in rows)), 'settled_n': len(settled)}
    for cost in ['base', 'stress']:
        values = [r['net_' + cost] for r in settled]
        gain = sum(max(0, x) for x in values)
        loss = -sum(min(0, x) for x in values)
        result[cost] = {'settled_net_sum_usd_NOT_portfolio_pnl': sum(values), 'settled_mean_usd': sum(values)/len(values) if values else None, 'settled_profit_factor': gain/loss if loss else None}
    return result


def main():
    directory = pathlib.Path(sys.argv[1])
    protocol = json.loads((directory / 'protocol.json').read_text())
    candles, funding = download(directory, protocol)
    times = [b[0] for b in candles]
    plans = []
    for row in json.loads((directory / 'observations.json').read_text()):
        data = row['data']
        if data['gates']['signal_gate']['status'] != 'pass' or not data['all_blocks'] or data['side'] not in ['long', 'short']:
            continue
        plans.append(dict(kind='hypothetical_core', key=data['observation_key'], side=data['side'], timeframe=data['timeframe'], decision_ms=timestamp(data['evaluated_at']), blocks=data['all_blocks']))
    rejected_invalid = []
    for row in json.loads((directory / 'decisions.json').read_text()):
        entry, sl, tp = [row[k] for k in ['entry_price', 'stop_loss', 'take_profit']]
        if not all(v and v > 0 for v in [entry, sl, tp]):
            continue
        side = 'long' if sl < entry < tp else 'short' if tp < entry < sl else None
        if not side:
            rejected_invalid.append(row['id'])
            continue
        plans.append(dict(kind='stored_levels', key=str(row['id']), side=side, timeframe=row['timeframe'], decision_ms=timestamp(row['timestamp']), entry=entry, sl=sl, tp=tp, reason=row['reason']))
    outcomes = [evaluate(p, candles, times, funding, protocol) for p in plans]
    summaries = {}
    for kind in ['hypothetical_core', 'stored_levels']:
        rows = [r for r in outcomes if r['kind'] == kind]
        summaries[kind] = summarize(rows)
        grouped = {}
        for row in sorted(rows, key=lambda r: r['decision_ms']):
            grouped.setdefault((row['side'], row['decision_ms']//3600_000), row)
        summaries[kind + '_first_per_hour_side'] = summarize(list(grouped.values()))
        summaries[kind + '_mature_48h'] = summarize([r for r in rows if r['decision_ms'] + (protocol['horizon_hours']*60 + 46)*MINUTE <= protocol['end_ms']])
    summaries['invalid_stored_level_ids'] = rejected_invalid
    summaries['limitations'] = ['Not original orders for hypothetical group; fixed floor stop/RR3 are counterfactual assumptions.', 'Stored limits: touch is only a fill proxy; TTL45min is assumed, no actual order existed.', 'Overlapping signals cannot be summed as account profit; hourly side grouping still not independent.', 'Settled-only totals exclude timeouts/censoring/ambiguity and can be selection-biased.', 'Funding uses actual marks/rates but entry/exit minute ordering is approximate.', 'No account admission, daily risk, cooldown, exposure, circuit, order latency, queue or LLM veto simulation.', 'A diagnostic win is neither proof of an executable trade nor future ROI+.']
    (directory / 'barrier-outcomes.json').write_text(json.dumps(outcomes, indent=2))
    (directory / 'barrier-summary.json').write_text(json.dumps(summaries, indent=2))
    manifest = {f.name: hashlib.sha256(f.read_bytes()).hexdigest() for f in directory.glob('*.json') if f.name != 'hashes.json'}
    (directory / 'hashes.json').write_text(json.dumps(manifest, indent=2))
    print(json.dumps(summaries, indent=2))


if __name__ == '__main__':
    main()
