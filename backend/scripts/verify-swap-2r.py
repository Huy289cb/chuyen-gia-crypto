import json,pathlib,hashlib,math
ROOT=pathlib.Path(__file__).resolve().parents[2];P=ROOT/'docs/audits/2026-09-24-swap-2r';read=lambda p:json.loads(p.read_text());protocol=read(P/'protocol.json');rows=read(P/'summary.json');assert len(rows)==24
for f,h in protocol['sourceHashes'].items():assert hashlib.sha256((ROOT/'backend'/f).read_bytes()).hexdigest()==h
for d in protocol['datasets']:
 assert hashlib.sha256(pathlib.Path(d['file']).read_bytes()).hexdigest()==d['sha256'];assert hashlib.sha256(pathlib.Path(d['inventory']).read_bytes()).hexdigest()==d['inventoryHash']
 inventory={c['id']:c for c in read(pathlib.Path(d['inventory']))}
 for variant in protocol['variants']:
  for cost in ['base','stress']:
   x=read(P/f"{d['id']}-{variant}-{cost}.json");s=x['summary'];assert len(x['closes'])==s['trades'];assert math.isclose(sum(c['netUsd']for c in x['closes']),s['netUsd'],abs_tol=1e-9)
   if variant=='long_2R':assert x==read(ROOT/f"docs/audits/2026-09-24-range-rr/{d['id']}-long-2-{cost}.json")
   else:
    for e in x['events']:
     if e['type']=='submit':
      p=e['plan'];c=inventory[p['id']];assert p['side']=='short';assert p['takeProfit']==c['stopLoss'];assert abs((p['stopLoss']-c['entry'])-2*(c['entry']-c['stopLoss']))<=.051
      assert abs((p['entry']-p['takeProfit'])/(p['stopLoss']-p['entry'])-.5)<.002
actual=read(P/'actual-results.json');assert len(actual['positions'])==17
SRC=ROOT/'docs/audits/2026-09-24-long-reversal'
for r in actual['positions']:
 assert math.isclose(r['shortSL']-r['entry'],2*(r['entry']-r['shortTP']),abs_tol=1e-8)
 bars=read(SRC/(r['id']+'-market.json'))['minutes'];first=next((b for b in bars if b['high']>=r['shortSL']or b['low']<=r['shortTP']),None)
 if first:
  assert first['openTime']==r['exitTime'];assert r['outcome']==('sl'if first['high']>=r['shortSL']else'tp')
 assert math.isclose(r['baseNet']-r['stressNet'],r['entry']*r['quantity']*.001,abs_tol=1e-9)
assert actual['summary']['latest6']['tp']==6;assert actual['summary']['all17']['minLotStressNet']<0
(P/'verification.json').write_text(json.dumps({'passed':True,'portfolioRuns':24,'baselineParityRuns':12,'actualPaths':17,'checks':['source/data hashes','exact swapped boundaries','first barrier ordering','cash totals','cost sensitivity','baseline parity']},indent=2));print('PASS: 24 portfolio runs, 12 exact baseline parity, 17 exact-swap actual paths')
