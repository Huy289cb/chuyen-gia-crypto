"""Validate frozen outputs; historical source snapshots take precedence over later source edits."""
import hashlib
import json
from pathlib import Path

root = Path(__file__).resolve().parents[2]
audit = root / 'docs/audits/2026-09-23-entry-exit'
checked = 0
for directory, expected in [(audit, 32), (audit / 'structural', 24), (audit / 'cash-breakeven', 24)]:
    report = json.loads((directory / 'summary.json').read_text())
    protocol, rows = report['protocol'], report['summaries']
    assert len(rows) == expected
    assert len({(r['split'], r['variant'], r['cost']) for r in rows}) == expected
    for path, digest in protocol['sourceHashes'].items():
        source = Path(path)
        snapshot = directory / 'source-snapshot' / source.relative_to(root)
        raw = snapshot.read_bytes() if snapshot.exists() else source.read_bytes()
        assert hashlib.sha256(raw).hexdigest() == digest, str(source)
        if not snapshot.exists():
            snapshot.parent.mkdir(parents=True, exist_ok=True)
            snapshot.write_bytes(raw)
    for r in rows:
        data = json.loads((directory / f"{r['split']}-{r['variant']}-{r['cost']}.json").read_text())
        assert data['summary'] == {k: r[k] for k in data['summary']}
        assert r['trades'] == r['fills'] == len(data['closes'])
        assert abs(sum(c['netUsd'] for c in data['closes']) - r['netUsd']) < 1e-8
        assert abs(r['roiPercent'] - r['netUsd'] / protocol['wallet'] * 100) < 1e-8
        wallet = protocol['wallet']
        for close in data['closes']:
            assert close['entryTime'] <= close['time']
            wallet += close['netUsd']
            assert abs(wallet - close['wallet']) < 1e-8
        c = r['comparison']
        assert abs(c['delta'] - (c['addedNet'] - c['removedNet'] + c['commonDelta'])) < 1e-8
        plans, fills = {}, {}
        for e in data['events']:
            if e['type'] == 'submit':
                plans[e['plan']['id']] = dict(e['plan'])
            elif e['type'] == 'fill':
                fills[e['id']] = e['time']
            elif e['type'] == 'protect_stop':
                p = plans[e['id']]
                direction = 1 if p['side'] == 'long' else -1
                assert e['time'] > fills[e['id']]
                assert direction * (e['stopLoss'] - p['stopLoss']) > 0
                p['stopLoss'] = e['stopLoss']
        checked += 1
result = {'passed': True, 'scenarios': checked, 'checks': ['complete unique matrices', 'cash and ROI reconciliation',
          'cohort attribution', 'protective stops never loosen or predate entry', 'frozen source snapshots'],
          'limitations': 'Output checks do not establish live fill parity or statistical profitability.'}
(audit / 'verification.json').write_text(json.dumps(result, indent=2) + '\n')
print(json.dumps(result, indent=2))
