"""Independent output-accounting and admission checks; does not rerun strategy selection."""
import hashlib
import json
from pathlib import Path

root = Path(__file__).resolve().parents[2]
audit = root / 'docs/audits/2026-09-22-geometry-feasibility'
result = json.loads((audit / 'summary.json').read_text())
protocol, rows = result['protocol'], result['summaries']
assert len(rows) == 32
assert len({(r['split'], r['variant'], r['cost']) for r in rows}) == 32
checked_submissions = 0
for row in rows:
    data = json.loads((audit / f"{row['split']}-{row['variant']}-{row['cost']}.json").read_text())
    assert data['summary'] == {k: row[k] for k in data['summary']}
    wallet = protocol['wallet']
    closes = data['closes']
    assert len(closes) == row['trades'] == row['fills']
    assert abs(sum(c['netUsd'] for c in closes) - row['netUsd']) < 1e-8
    assert abs(row['netUsd'] / wallet * 100 - row['roiPercent']) < 1e-8
    for c in closes:
        wallet += c['netUsd']
        assert abs(wallet - c['wallet']) < 1e-8
        assert c['entryTime'] <= c['time']
    for key in ('comparison', 'versusCore'):
        c = row[key]
        assert abs(c['delta'] - (c['addedNet'] - c['removedNet'] + c['commonDelta'])) < 1e-8
    variant = next(v for v in protocol['variants'] if v['id'] == row['variant'])
    wallet = protocol['wallet']
    for event in data['events']:
        if event['type'] == 'close':
            wallet = event['wallet']
        if event['type'] != 'submit':
            continue
        p = event['plan']
        policy = protocol['basePolicy']
        risk = (abs(p['entry'] - p['stopLoss']) * p['quantity']
                + max(p['entry'], p['stopLoss']) * p['quantity'] * policy['feePercent'] / 100
                + p['entry'] * p['quantity'] * policy['slippagePercent'] / 100)
        assert risk <= wallet * policy['maxRiskPercent'] / 100 + 1e-8
        cap = wallet * variant['equityCap'] / 100 if variant['equityCap'] else policy['maxExposure']
        assert p['entry'] * p['quantity'] <= cap + 1e-8
        assert abs(p['entry'] - p['stopLoss']) / p['entry'] >= variant['floor'] - 1e-10
        checked_submissions += 1
for path, expected in protocol['sourceHashes'].items():
    contents = Path(path).read_bytes()
    assert hashlib.sha256(contents).hexdigest() == expected, path
    relative = Path(path).relative_to(root)
    snapshot = audit / 'source-snapshot' / relative
    snapshot.parent.mkdir(parents=True, exist_ok=True)
    snapshot.write_bytes(contents)
report = {'passed': True, 'scenarios': len(rows), 'submissionsChecked': checked_submissions,
          'checks': ['unique matrix', 'cash reconciliation', 'ROI', 'trade counts', 'cohort attribution',
                     'entry before exit', '3% admission risk', 'exposure admission', 'SL floor', 'source hashes'],
          'scope': 'Checks saved outputs and planned admission limits; gap losses may exceed planned risk. Not exchange execution parity.'}
(audit / 'verification.json').write_text(json.dumps(report, indent=2) + '\n')
print(json.dumps(report, indent=2))
