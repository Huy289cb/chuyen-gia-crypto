#!/usr/bin/env python3
"""Independent Decimal reconstruction from fills/funding and public close marks."""
import csv
import hashlib
import json
import sys
from decimal import Decimal, getcontext
from pathlib import Path

getcontext().prec = 50
D = Decimal
ROOT = Path(__file__).resolve().parents[2]
PKG = ROOT / 'docs/audits/futures-quick-win/momentum-paper-implementation-20261014T043000Z'
TOLERANCE = D('0.000000000001')

def audit(name):
    out = PKG / 'outputs' / name
    report = json.loads((out / 'report.json').read_text())
    dataset = json.loads((PKG / 'data/manifest.json').read_text())
    filters = {r['symbol']: {f['filterType']: f for f in r['filters']}
               for r in json.loads((PKG / 'data/exchange-info.json').read_text())['symbols']}
    funding = {}
    streams = {}
    for symbol in dataset['symbols']:
        streams[symbol] = csv.DictReader((PKG / 'data' / (symbol + '-5m.csv')).open())
        for row in json.loads((PKG / 'data' / (symbol + '-funding.json')).read_text()):
            funding[row['id']] = row
    events = [json.loads(line) for line in (out / 'events.ndjson').open()]
    assert len({e['id'] for e in events}) == len(events)
    assert all(events[i]['time'] >= events[i-1]['time'] for i in range(1, len(events)))
    positions, seen_funding = {}, set()
    cash, fees, slip, realized_total, funding_total = D(100), D(0), D(0), D(0), D(0)
    event_index = 0
    maximum_error = D(0)
    checks, fills, frames = 0, 0, 0
    anchor = D(100)
    def check(actual, expected, label):
        nonlocal maximum_error, checks
        error = abs(D(str(actual)) - expected)
        maximum_error = max(maximum_error, error)
        checks += 1
        assert error <= TOLERANCE, (name, label, str(actual), str(expected), str(error))
    def mtm(marks):
        return cash + sum((q * (marks[s] - entry) for s, (q, entry) in positions.items()), D(0))
    for line in (out / 'frames.ndjson').open():
        frame = json.loads(line)
        bars = {s: next(streams[s]) for s in streams}
        open_time = frame['time'] + 1 - dataset['barIntervalMs']
        assert all(int(b['openTimeMs']) == open_time for b in bars.values())
        while event_index < len(events) and events[event_index]['time'] <= frame['time']:
            event = events[event_index]; event_index += 1
            symbol = event.get('symbol')
            if event['kind'] == 'day_roll':
                assert event['time'] == open_time
                anchor = mtm({s: D(b['markOpen']) for s, b in bars.items()})
            elif event['kind'] == 'fill':
                q, price, reference = D(event['quantity']), D(event['fillPrice']), D(event['referencePrice'])
                old, entry = positions.get(symbol, (D(0), price))
                new = old + q
                earned = D(0)
                average = entry
                if old and old * q < 0:
                    closed = min(abs(old), abs(q))
                    earned = closed * (price - entry) * (1 if old > 0 else -1)
                    if new and old * new < 0: average = price
                elif new:
                    average = (abs(old) * entry + abs(q) * price) / abs(new)
                expected_price = reference * (D(1) + D(report['config']['slippageBps']) / D(10000) * (1 if q > 0 else -1))
                fee = abs(q) * price * D(report['config']['feeRate'])
                check(price, expected_price, 'fill price')
                check(event['fee'], fee, 'fee')
                check(event['realizedPnl'], earned, 'realized')
                check(event['cashDelta'], earned-fee, 'cash delta')
                lot = filters[symbol].get('MARKET_LOT_SIZE', filters[symbol]['LOT_SIZE'])
                assert abs(q) >= D(lot['minQty']) and abs(q) % D(lot['stepSize']) == 0
                if event['reason'] == 'target_increase':
                    assert abs(q) * D(bars[symbol]['markOpen']) >= D(filters[symbol]['MIN_NOTIONAL']['notional'])
                if new: positions[symbol] = (new, average)
                else: positions.pop(symbol, None)
                cash += earned-fee; fees += fee; realized_total += earned
                slip += abs(q) * abs(price-reference); fills += 1
            elif event['kind'] == 'funding':
                identifier = event['reason']; assert identifier not in seen_funding
                seen_funding.add(identifier)
                raw = funding[identifier]
                assert raw['time'] == event['time'] and raw['symbol'] == symbol
                quantity = positions.get(symbol, (D(0), D(0)))[0]
                check(event['quantity'], quantity, 'funding held quantity')
                mark = D(raw.get('markPrice', bars[symbol]['markOpen']))
                delta = -quantity * mark * D(raw['rate'])
                check(event['cashDelta'], delta, 'funding cash')
                cash += delta; funding_total += delta
            elif event['kind'] == 'cashflow':
                raise AssertionError('Registered historical wallet cannot have external cashflows')
        marks = {s: D(b['markClose']) for s, b in bars.items()}
        equity = mtm(marks)
        gross = sum((abs(q) * marks[s] for s, (q, _) in positions.items()), D(0))
        check(frame['cash'], cash, 'frame cash'); check(frame['equity'], equity, 'frame equity')
        check(frame['grossNotional'], gross, 'gross'); check(frame['marginUsed'], gross / D(10), 'margin')
        check(frame['totalFees'], fees, 'fees total'); check(frame['fundingPnl'], funding_total, 'funding total')
        check(frame['realizedPnl'], realized_total, 'realized total')
        check(frame['currentDay']['anchorEquity'], anchor, 'ICT anchor')
        check(frame['currentDay']['netPnl'], equity-anchor, 'ICT net day')
        assert set(frame['positions']) == set(positions)
        for symbol, (q, entry) in positions.items():
            check(frame['positions'][symbol]['quantity'], q, 'position quantity')
            check(frame['positions'][symbol]['averageEntry'], entry, 'average entry')
        frames += 1
    assert event_index == len(events) and not positions
    summary = report['summary']
    check(summary['netPnl'], cash-D(100), 'final net')
    check(summary['totalFees'], fees, 'final fees'); check(summary['totalSlippage'], slip, 'final slip')
    check(summary['fundingPnl'], funding_total, 'final funding')
    check(summary['meanNetPerCalendarDay'], (cash-D(100))/D(14), 'calendar mean')
    assert fills == summary['fillCount'] and frames == 4032
    assert len(seen_funding) == dataset['fundingEvents']
    return {'status':'PASS','case':name,'frames':frames,'fills':fills,'fundingEvents':len(seen_funding),
            'independentMonetaryChecks':checks,'maxAbsoluteErrorUsdt':str(maximum_error),'toleranceUsdt':str(TOLERANCE),
            'scope':'cash, independent realized/average-entry, signed funding, fees/slippage, close MTM, lot/minimum, exact ICT anchors and final calendar denominator. Not continuous risk or exchange liquidation proof.'}

names = sys.argv[1:] or ['base', 'stress']
assert names in [['base'], ['stress'], ['base', 'stress']]
results = [audit(name) for name in names]
receipt = {'status':'PASS','cases':results,'auditorSha256':hashlib.sha256(Path(__file__).read_bytes()).hexdigest()}
filename = 'independent-ledger-audit.json' if len(names)==2 else 'independent-ledger-audit-'+names[0]+'.json'
(PKG / 'receipts' / filename).write_text(json.dumps(receipt,indent=2)+'\n')
print(json.dumps(receipt,indent=2))
