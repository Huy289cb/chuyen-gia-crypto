"""Audit the eight fixed replay scenarios; arithmetic/admission checks, not exchange parity."""
import json, hashlib
from pathlib import Path
from opportunity_accounting_audit import audit_run

root=Path(__file__).resolve().parents[2]
base=root/'docs/audits/2026-09-11-opportunity-testbed'
rows=[]
for split in ['train','independent-2023']:
    folder=base if split=='train' else base/split
    for variant in ['opening_range_breakout','opening_range_failure']:
        for cost in ['base','stress']:
            path=folder/f'{variant}-portfolio-{variant}-{cost}.json'
            raw=path.read_bytes(); run=json.loads(raw); errors=audit_run(run)
            reserved=None; occupied=False; blocked_until=0; reservations=0
            for event in run['events']:
                kind=event['type']; time=event['time']
                if kind=='reserve':
                    reservations+=1
                    if reserved or occupied: errors.append('overlapping_reservation')
                    if time<blocked_until: errors.append('cooldown_violation')
                    p=event['plan']; reserved=p
                    if p['setup']!=variant: errors.append('wrong_setup')
                    if split!='train' and not 1672531200000<=time<1688169600000: errors.append('outside_validation')
                    cap=event['wallet']*.03
                    if p['riskUsd']>cap+1e-7: errors.append('risk_cap')
                    remaining=event['dayStart']*.1-max(0,event['dayStart']-event['wallet'])
                    if p['riskUsd']>remaining+1e-7: errors.append('daily_budget')
                    if abs(p['entry']-p['stopLoss'])/p['entry']<.008-1e-9 or p['rr']<3-1e-9: errors.append('geometry')
                    notional=p['quantity']*p['entry']
                    if not 50-1e-7<=notional<=100+1e-7: errors.append('notional')
                    if abs(p['quantity']/.001-round(p['quantity']/.001))>1e-7: errors.append('lot_step')
                elif kind=='fill':
                    if not reserved or occupied: errors.append('invalid_fill_sequence')
                    reserved=None; occupied=True
                elif kind in ['ttl_cancel','drift_cancel']:
                    if not reserved or occupied: errors.append('invalid_cancel_sequence')
                    reserved=None; blocked_until=time+3600000
                elif kind=='close':
                    if not occupied: errors.append('invalid_close_sequence')
                    occupied=False; blocked_until=time+3600000
            if occupied or reserved: errors.append('unfinished_outcome')
            rows.append({'artifact':str(path.relative_to(root)),'sha256':hashlib.sha256(raw).hexdigest(),
                'summary':run['summary'],'reservations':reservations,'errors':sorted(set(errors))})
report={'runs':rows,'failedRuns':sum(bool(r['errors']) for r in rows),
    'scope':'Eight frozen scenarios: cash arithmetic, sequential account use, entry window, lot/notional, planned admission risk, daily reservation budget and one-hour cooldown. Does not prove exchange fills, full lifecycle parity, or bound realized stress/gap losses by planned risk.',
    'promotionEligible':False}
(root/'docs/audits/2026-09-13-bounded-research/replay-audit.json').write_text(json.dumps(report,indent=2)+'\n')
print(json.dumps({'runs':len(rows),'failedRuns':report['failedRuns']}))
if report['failedRuns']: raise SystemExit(1)
