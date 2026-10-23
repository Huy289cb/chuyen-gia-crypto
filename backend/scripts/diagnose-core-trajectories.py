"""Baseline development diagnosis using only minute bars wholly inside the holding period."""
import json
import statistics
from pathlib import Path

root = Path(__file__).resolve().parents[2]
prior = root / 'docs/audits/2026-09-21-core-ablation'
out = root / 'docs/audits/2026-09-23-entry-exit'
protocol = json.loads((prior / 'protocol.json').read_text())
trades = []
for dataset in protocol['datasets']:
    bars = json.loads(Path(dataset['file']).read_text())['byTf']['1m']
    lookup = {b[0]: i for i, b in enumerate(bars)}
    result = json.loads((prior / f"{dataset['id']}-current_core-stress.json").read_text())
    for close in result['closes']:
        begin = lookup[close['entryTime']] + 1
        end = lookup.get(close['time'], len(bars))
        path = [b for b in bars[begin:end] if b[0] + 60000 < close['time']]
        direction = 1 if close['side'] == 'long' else -1
        distance = abs(close['entry'] - close['stopLoss'])

        def excursion(rows):
            return max([0] + [direction * ((b[2] if direction == 1 else b[3]) - close['entry']) / distance for b in rows])

        trades.append({'split': dataset['id'], 'id': close['planId'], 'net': close['netUsd'],
                       'hours': (close['time'] - close['entryTime']) / 3600000, 'reason': close['reason'],
                       'completePreExitMfeR': excursion(path),
                       'firstHourMfeR': excursion([b for b in path if b[0] < close['entryTime'] + 3600000]),
                       'completeMinutes': len(path)})
losses, wins = [t for t in trades if t['net'] < 0], [t for t in trades if t['net'] > 0]
summary = {'trades': len(trades), 'losses': len(losses), 'wins': len(wins),
           'lossesWithMfeHalfR': sum(t['completePreExitMfeR'] >= .5 for t in losses),
           'lossesWithMfeOneR': sum(t['completePreExitMfeR'] >= 1 for t in losses),
           'lossesLowFirstHour': sum(t['firstHourMfeR'] < .25 for t in losses),
           'medianLossHours': statistics.median(t['hours'] for t in losses),
           'medianWinHours': statistics.median(t['hours'] for t in wins)}
report = {'scope': 'Development baseline stress only. Fully contained minute bars strictly after entry minute and before exit bar; observed excursion is conservative/incomplete, not post-exit extrema. No live order causal diagnosis.',
          'trades': trades, 'summary': summary}
out.mkdir(parents=True, exist_ok=True)
target = out / 'trajectory-diagnosis.json'
if target.exists():
    assert json.loads(target.read_text()) == report, 'Diagnosis changed'
else:
    target.write_text(json.dumps(report, indent=2))
print(json.dumps(summary, indent=2))
