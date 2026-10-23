"""Read-only consistency checks for chronological replay artifacts; not proof of trading edge."""
import json
import math
from pathlib import Path


def audit_run(run):
    s = run['summary']
    errors = []
    def same(a, b):
        return all(isinstance(x, (float, int)) and not isinstance(x, bool) and math.isfinite(x) for x in (a,b)) and abs(a-b) <= 1e-7
    closes = run['closes']
    initial = s.get('initialWallet', 33.59964603)
    wallet = initial
    plans = {e['plan']['id']: e['plan'] for e in run['events'] if e['type'] == 'reserve'}
    ids = set()
    previous = -math.inf
    for c in closes:
        pid = c['planId']
        if pid in ids: errors.append('duplicate_close')
        ids.add(pid)
        if c['time'] < previous: errors.append('nonchronological_close')
        previous = c['time']
        plan = plans.get(pid)
        if not plan: errors.append('close_without_reservation')
        elif not same(c['netR'] * plan['riskUsd'], c['netUsd']): errors.append('net_r_mismatch')
        wallet += c['netUsd']
        if not same(wallet, c['wallet']): errors.append('close_wallet_mismatch')
        if any(not isinstance(c[k], (int,float)) or not math.isfinite(c[k]) or c[k] < 0 for k in ('feesUsd','slippageUsd')):
            errors.append('invalid_execution_cost')
    if len(closes) != s['trades']: errors.append('trade_count_mismatch')
    if sum(c['netUsd'] > 0 for c in closes) != s['wins']: errors.append('win_count_mismatch')
    # Existing positions may have paid entry fees/funding without a closed trade yet.
    if not s['open'] and not s['pending']:
        if not same(wallet, s['wallet']): errors.append('final_wallet_mismatch')
        if not same(s['equity'], s['wallet']): errors.append('flat_equity_mismatch')
        if not same(s['netCashUsd'], wallet-initial): errors.append('net_cash_mismatch')
    if not same(s['roiEquityPercent'], (s['equity']/initial-1)*100): errors.append('roi_mismatch')
    return sorted(set(errors))


def main():
    root = Path(__file__).resolve().parents[2]/'docs/audits/2026-09-11-opportunity-testbed'
    rows = []
    for file in sorted(root.glob('*portfolio-*.json')):
        run = json.loads(file.read_text())
        if 'summary' not in run or 'closes' not in run: continue
        rows.append({'artifact': file.name, 'trades':run['summary']['trades'], 'errors':audit_run(run)})
    report = {'runs':rows,'checkedRuns':len(rows),'failedRuns':sum(bool(r['errors']) for r in rows),
              'scope':'Arithmetic consistency of top-level chronological TRAIN artifacts only. Does not prove valid fills, market data, full runtime parity, independence or profitability.'}
    (root/'accounting-consistency-audit.json').write_text(json.dumps(report,indent=2)+'\n')
    print(json.dumps(report,indent=2))
    if report['failedRuns']: raise SystemExit(1)

if __name__ == '__main__': main()
