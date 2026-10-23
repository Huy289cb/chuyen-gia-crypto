import json,pathlib,hashlib,math
ROOT=pathlib.Path(__file__).resolve().parents[2];P=ROOT/'docs/audits/2026-09-24-range-rr';read=lambda p:json.loads(p.read_text())
protocol=read(P/'protocol.json');rows=read(P/'summary.json');assert len(rows)==96
for f,h in protocol['sourceHashes'].items():assert hashlib.sha256((ROOT/'backend'/f).read_bytes()).hexdigest()==h
for d in protocol['datasets']:
 assert hashlib.sha256(pathlib.Path(d['file']).read_bytes()).hexdigest()==d['sha256']
 assert hashlib.sha256(pathlib.Path(d['inventory']).read_bytes()).hexdigest()==d['inventoryHash']
for r in rows:
 x=read(P/f"{r['split']}-{r['side']}-{r['rr'] if r['rr']%1 else int(r['rr'])}-{r['cost']}.json")
 assert len(x['closes'])==r['trades'];assert math.isclose(sum(c['netUsd']for c in x['closes']),r['netUsd'],abs_tol=1e-8)
 if r['rr']==1.5:assert x==read(ROOT/f"docs/audits/2026-09-24-range-implementation/{r['split']}-{r['side']}-{r['cost']}.json")
 for e in x['events']:
  if e['type']=='submit':
   p=e['plan'];ratio=abs(p['takeProfit']-p['entry'])/abs(p['entry']-p['stopLoss']);assert abs(ratio-r['rr'])<.002
   assert abs(p['entry']-p['stopLoss'])/p['entry']>=.008-1e-10
actual=read(P/'actual-results.json');assert len(actual['positions'])==17
assert all(v['tp']==0 and v['sl']==3 for v in actual['summaries']['september_range3']['variants'])
for p in actual['positions']:
 for v in p['paths']:
  if v['baseNet'] is not None:assert math.isclose(v['baseNet']-v['stressNet'],p['entry']*p['quantity']*.001,abs_tol=1e-9)
(P/'verification.json').write_text(json.dumps({'passed':True,'matrixRuns':96,'actualPaths':68,'baselineParityRuns':24,'checks':['immutable source/data hashes','cash reconciliation','SL floor','RR geometry','exact old baseline parity','actual path cost sensitivity']},indent=2))
print('PASS: 96 portfolio runs, 24 exact baseline parity, 68 actual-entry paths')
