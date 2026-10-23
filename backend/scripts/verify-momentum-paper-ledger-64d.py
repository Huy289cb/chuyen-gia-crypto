#!/usr/bin/env python3
"""Independent Decimal audit of the explicitly registered 64 ICT day replay.

Uses emitted fills, public marks and raw funding settlements rather than the TS
engine. Does not execute strategy decisions or change financial results. The
original 14-day auditor and artifacts remain untouched.
"""
import argparse
import csv
import hashlib
import json
from contextlib import ExitStack
from datetime import datetime, timedelta, timezone
from decimal import Decimal, getcontext
from pathlib import Path

getcontext().prec = 50
D = Decimal
DAY_MS = 86_400_000
ICT_OFFSET_MS = 7 * 3_600_000
TOLERANCE = D('0.000000000001')
COMMON = {'initialCash': '100', 'dailyLossLimitUsd': '10', 'leverage': '10',
          'maintenanceRate': '0.005', 'closeBufferUsd': '0.10'}
CASES = {'base': {'feeRate': '0.0005', 'slippageBps': '2'},
         'stress': {'feeRate': '0.0007', 'slippageBps': '5'}}


def digest(path):
    hasher = hashlib.sha256()
    with Path(path).open('rb') as source:
        for block in iter(lambda: source.read(1_048_576), b''):
            hasher.update(block)
    return hasher.hexdigest()


def ict_day(time):
    return (datetime.fromtimestamp(time / 1000, timezone.utc)
            + timedelta(hours=7)).date().isoformat()


def audit(package, name, expected_days=64):
    """Return a receipt without writing, also permitting readonly fixture checks."""
    package = Path(package).resolve()
    out = package / 'outputs' / name
    report = json.loads((out / 'report.json').read_text())
    dataset = json.loads((package / 'data/manifest.json').read_text())
    start, end = dataset['startTimeMs'], dataset['endTimeMs']
    interval = dataset['barIntervalMs']
    assert interval == 300_000
    assert (start + ICT_OFFSET_MS) % DAY_MS == 0
    assert (end + ICT_OFFSET_MS) % DAY_MS == 0
    assert end - start == expected_days * DAY_MS
    expected_frames = expected_days * DAY_MS // interval
    assert dataset['barsPerSymbol'] == expected_frames
    assert len(dataset['symbols']) == 40 and len(set(dataset['symbols'])) == 40
    assert dataset['rawCandles'] == expected_frames * 40 * 2
    for field, value in {**COMMON, **CASES[name]}.items():
        assert D(report['config'][field]) == D(value), (name, 'config', field)
    summary = report['summary']
    assert summary['calendarDays'] == expected_days
    assert summary['completedDays'] == expected_days - 1
    assert report['metrics']['frames'] == expected_frames
    assert report['metrics']['sourceRebalances'] == expected_days
    checkpoint = json.loads((out / 'checkpoint.json').read_text())
    assert checkpoint['startedAt'] == start and checkpoint['lastTime'] == end - 1
    assert not checkpoint['positions']
    days = json.loads((out / 'days.json').read_text())
    assert len(days) == expected_days
    assert checkpoint['days'] == days[:-1] and checkpoint['currentDay'] == days[-1]
    for index, day in enumerate(days):
        assert day['day'] == ict_day(start + index * DAY_MS)
        assert day['startTime'] == start + index * DAY_MS
        assert day['finalized'] == (index < expected_days - 1)
        assert day['anchorQuality'] == ('initial_empty_wallet' if index == 0 else 'exact_midnight')
        assert D(day['netCashflow']) == 0

    filters = {row['symbol']: {f['filterType']: f for f in row['filters']}
               for row in json.loads((package / 'data/exchange-info.json').read_text())['symbols']}
    funding = {}
    for symbol in dataset['symbols']:
        for row in json.loads((package / 'data' / (symbol + '-funding.json')).read_text()):
            assert row['id'] not in funding
            assert row['symbol'] == symbol and start <= row['time'] < end
            funding[row['id']] = row
    assert len(funding) == dataset['fundingEvents']

    positions, seen_funding, seen_events = {}, set(), set()
    cash, fees, slip, realized_total, funding_total = D(100), D(0), D(0), D(0), D(0)
    maximum_error, checks, fills, frame_count, rolls = D(0), 0, 0, 0, 0
    anchor = D(100)
    last_event_time = start
    rejection_count = 0
    reconstructed_days = []
    observed_day_close_minimum = D(0)

    def check(actual, expected, label):
        nonlocal maximum_error, checks
        error = abs(D(str(actual)) - expected)
        maximum_error = max(maximum_error, error)
        checks += 1
        assert error <= TOLERANCE, (name, label, str(actual), str(expected), str(error))

    def mtm(marks):
        return cash + sum((quantity * (marks[symbol] - entry)
                           for symbol, (quantity, entry) in positions.items()), D(0))

    with ExitStack() as stack:
        streams = {symbol: csv.DictReader(stack.enter_context(
            (package / 'data' / (symbol + '-5m.csv')).open())) for symbol in dataset['symbols']}
        events = (json.loads(line) for line in stack.enter_context((out / 'events.ndjson').open()))
        event = next(events, None)
        for line in stack.enter_context((out / 'frames.ndjson').open()):
            frame = json.loads(line)
            open_time = start + frame_count * interval
            assert frame['time'] == open_time + interval - 1
            bars = {symbol: next(stream) for symbol, stream in streams.items()}
            assert all(int(bar['openTimeMs']) == open_time for bar in bars.values())
            while event is not None and event['time'] <= frame['time']:
                assert start <= event['time'] < end and event['time'] >= last_event_time
                assert event['id'] not in seen_events
                seen_events.add(event['id'])
                last_event_time = event['time']
                symbol, kind = event.get('symbol'), event['kind']
                assert kind in {'day_roll', 'fill', 'funding', 'cashflow', 'risk_latch', 'target', 'rejected'}
                if kind == 'day_roll':
                    assert event['time'] == open_time == start + (rolls + 1) * DAY_MS
                    assert event['reason'] == 'exact_midnight'
                    boundary_equity = mtm({s: D(bar['markOpen']) for s, bar in bars.items()})
                    prior = days[rolls]
                    check(prior['anchorEquity'], anchor, 'archived anchor')
                    check(prior['endEquity'], boundary_equity, 'archived boundary equity')
                    check(prior['netPnl'], boundary_equity - anchor, 'archived net day')
                    reconstructed_days.append(boundary_equity - anchor)
                    anchor = boundary_equity
                    rolls += 1
                elif kind == 'fill':
                    quantity, price = D(event['quantity']), D(event['fillPrice'])
                    reference = D(event['referencePrice'])
                    old, entry = positions.get(symbol, (D(0), price))
                    new, earned, average = old + quantity, D(0), entry
                    if old and old * quantity < 0:
                        closed = min(abs(old), abs(quantity))
                        earned = closed * (price - entry) * (1 if old > 0 else -1)
                        if new and old * new < 0:
                            average = price
                    elif new:
                        average = (abs(old) * entry + abs(quantity) * price) / abs(new)
                    expected_price = reference * (D(1) + D(report['config']['slippageBps'])
                                                   / D(10_000) * (1 if quantity > 0 else -1))
                    fee = abs(quantity) * price * D(report['config']['feeRate'])
                    check(price, expected_price, 'fill price')
                    check(event['fee'], fee, 'fee')
                    check(event['realizedPnl'], earned, 'realized')
                    check(event['cashDelta'], earned - fee, 'cash delta')
                    lot = filters[symbol].get('MARKET_LOT_SIZE', filters[symbol]['LOT_SIZE'])
                    assert abs(quantity) >= D(lot['minQty'])
                    assert abs(quantity) % D(lot['stepSize']) == 0
                    assert abs(quantity) <= D(lot['maxQty'])
                    if event['reason'] == 'target_increase':
                        assert abs(quantity) * D(bars[symbol]['markOpen']) >= D(filters[symbol]['MIN_NOTIONAL']['notional'])
                    if new:
                        positions[symbol] = (new, average)
                    else:
                        positions.pop(symbol, None)
                    cash += earned - fee
                    fees += fee
                    realized_total += earned
                    slip += abs(quantity) * abs(price - reference)
                    fills += 1
                elif kind == 'funding':
                    identifier = event['reason']
                    assert identifier not in seen_funding
                    seen_funding.add(identifier)
                    raw = funding[identifier]
                    assert raw['time'] == event['time'] and raw['symbol'] == symbol
                    quantity = positions.get(symbol, (D(0), D(0)))[0]
                    check(event['quantity'], quantity, 'funding held quantity')
                    mark = D(raw.get('markPrice', bars[symbol]['markOpen']))
                    delta = -quantity * mark * D(raw['rate'])
                    check(event['cashDelta'], delta, 'funding cash')
                    cash += delta
                    funding_total += delta
                elif kind == 'cashflow':
                    raise AssertionError('Registered historical wallet cannot have external cashflows')
                elif kind == 'rejected':
                    rejection_count += 1
                event = next(events, None)
            marks = {symbol: D(bar['markClose']) for symbol, bar in bars.items()}
            equity = mtm(marks)
            gross = sum((abs(quantity) * marks[symbol]
                         for symbol, (quantity, _) in positions.items()), D(0))
            check(frame['cash'], cash, 'frame cash')
            check(frame['equity'], equity, 'frame equity')
            check(frame['grossNotional'], gross, 'gross')
            check(frame['marginUsed'], gross / D(report['config']['leverage']), 'margin')
            check(frame['totalFees'], fees, 'fees total')
            check(frame['fundingPnl'], funding_total, 'funding total')
            check(frame['realizedPnl'], realized_total, 'realized total')
            check(frame['currentDay']['anchorEquity'], anchor, 'ICT anchor')
            check(frame['currentDay']['netPnl'], equity - anchor, 'ICT net day')
            assert frame['currentDay']['day'] == ict_day(frame['time'])
            assert D(frame['currentDay']['worstNetPnl']) <= equity - anchor + TOLERANCE
            assert D(frame['currentDay']['breachUsd']) == max(
                D(0), -D(frame['currentDay']['worstNetPnl']) - D(COMMON['dailyLossLimitUsd']))
            observed_day_close_minimum = min(observed_day_close_minimum, equity - anchor)
            assert set(frame['positions']) == set(positions)
            for symbol, (quantity, entry) in positions.items():
                check(frame['positions'][symbol]['quantity'], quantity, 'position quantity')
                check(frame['positions'][symbol]['averageEntry'], entry, 'average entry')
            frame_count += 1
        assert event is None and next(events, None) is None
        assert all(next(stream, None) is None for stream in streams.values())
    assert frame_count == expected_frames and rolls == expected_days - 1 and not positions
    assert fills == summary['fillCount'] and rejection_count == summary['rejectedCount']
    assert len(seen_events) == report['metrics']['emittedEvents']
    assert seen_funding == set(funding)
    assert report['metrics']['fundingSettlements'] == len(seen_funding)
    check(days[-1]['anchorEquity'], anchor, 'final day anchor')
    check(days[-1]['endEquity'], cash, 'final day equity')
    check(days[-1]['netPnl'], cash - anchor, 'final day net')
    reconstructed_days.append(cash - anchor)
    check(sum(reconstructed_days, D(0)), cash - D(100), 'sum of calendar days')
    check(summary['initialCash'], D(100), 'initial cash')
    check(summary['netPnl'], cash - D(100), 'final net')
    check(summary['equity'], cash, 'final equity')
    check(summary['totalFees'], fees, 'final fees')
    check(summary['totalSlippage'], slip, 'final slip')
    check(summary['fundingPnl'], funding_total, 'final funding')
    check(summary['realizedPnl'], realized_total, 'final realized')
    check(summary['meanNetPerCalendarDay'], (cash - D(100)) / D(expected_days), 'calendar mean')
    for field, value in {'cash': cash, 'equity': cash, 'totalFees': fees, 'totalSlippage': slip,
                         'fundingPnl': funding_total, 'realizedPnl': realized_total}.items():
        check(checkpoint[field], value, 'checkpoint ' + field)
    assert D(checkpoint['netCashflow']) == D(summary['netCashflow']) == 0
    assert D(summary['unrealizedPnl']) == D(summary['grossNotional']) == D(summary['marginUsed']) == 0
    worst = min(D(day['worstNetPnl']) for day in days)
    breach = max(D(day['breachUsd']) for day in days)
    check(summary['worstDayNetPnl'], worst, 'reported worst day')
    check(summary['maxDailyBreachUsd'], breach, 'reported maximum breach')
    assert report['metrics']['dailyBudgetBreached'] == (breach > 0)
    assert report['metrics']['missingMidnightAnchors'] == 0
    assert worst <= observed_day_close_minimum + TOLERANCE
    return {'status': 'PASS', 'case': name, 'calendarDays': expected_days,
            'frames': frame_count, 'fills': fills, 'fundingEvents': len(seen_funding),
            'independentMonetaryChecks': checks, 'maxAbsoluteErrorUsdt': str(maximum_error),
            'toleranceUsdt': str(TOLERANCE), 'netPnlUsdt': str(cash - D(100)),
            'meanNetPerCalendarDayUsdt': str((cash - D(100)) / D(expected_days)),
            'positiveCalendarMean': cash > D(100),
            'reportedWorstDayNetPnlUsdt': str(worst), 'reportedMaxDailyBreachUsdt': str(breach),
            'observedCloseWorstDayNetPnlUsdt': str(observed_day_close_minimum),
            'files': {filename: digest(out / filename) for filename in
                      ['report.json', 'events.ndjson', 'frames.ndjson', 'checkpoint.json', 'days.json']},
            'scope': 'Independent cash, realized PnL/average entry, signed funding, fees/slippage, close MTM, market lot/minimum, exact ICT anchors, daily sum and full calendar denominator. Reported intrabar worst/breach consistency only; not independent continuous risk, venue liquidation or profitability expectation proof.'}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--package-dir', required=True, type=Path)
    parser.add_argument('cases', nargs='*', choices=['base', 'stress'])
    args = parser.parse_args()
    names = args.cases or ['base', 'stress']
    assert names in [['base'], ['stress'], ['base', 'stress']]
    package = args.package_dir.resolve()
    dataset = json.loads((package / 'data/manifest.json').read_text())
    for item in dataset['files']:
        path = package / 'data' / item['path']
        assert path.stat().st_size == item['bytes'] and digest(path) == item['sha256']
    results = [audit(package, name) for name in names]
    receipt = {'status': 'PASS', 'cases': results,
               'auditorSha256': digest(Path(__file__)), 'datasetManifestSha256': digest(package / 'data/manifest.json')}
    filename = ('independent-ledger-64d-audit.json' if len(names) == 2 else
                'independent-ledger-64d-audit-' + names[0] + '.json')
    (package / 'receipts').mkdir(parents=True, exist_ok=True)
    with (package / 'receipts' / filename).open('x') as output:
        output.write(json.dumps(receipt, indent=2) + '\n')
    print(json.dumps(receipt, indent=2))


if __name__ == '__main__':
    main()
