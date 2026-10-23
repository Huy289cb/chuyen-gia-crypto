"""Independent barrier and accounting checks for the paired replay artifacts."""
import json,pathlib,math
P=pathlib.Path(__file__).resolve().parents[2]/'docs/audits/2026-09-24-long-reversal'
r=json.loads((P/'results.json').read_text())
assert len(r['positions'])==17
for p in r['positions']:
 m=json.loads((P/(p['id']+'-market.json')).read_text()); e=p['entry']; q=p['quantity']
 for name,v in p['variants'].items():
  side=1 if name=='long' else -1
  sl=p['initialSL'] if name=='long' else 2*e-p['initialSL'] if name=='mirror' else p['initialTP']
  tp=p['initialTP'] if name=='long' else 2*e-p['initialTP'] if name=='mirror' else p['initialSL']
  hits=[b for b in m['minutes'] if not (b['low']>min(sl,tp) and b['high']<max(sl,tp))]
  if hits:
   b=hits[0]; assert b['openTime']==v['exitTime']
   stop=(b['low']<=sl) if side==1 else (b['high']>=sl)
   assert v['outcome']==('sl' if stop else 'tp')
   x=(min(sl,b['open']) if side==1 else max(sl,b['open'])) if stop else tp
   assert math.isclose(x,v['exit'])
  else: assert v['outcome']==('time_exit' if m['full72h'] else 'censored')
  for cost,slip in [('baseNet',.001),('stressNet',.002)]:
   expected=q*(side*(v['exit']-e)-.0005*(e+v['exit'])-slip*e)+v['fundingCash']
   assert math.isclose(expected,v[cost],abs_tol=1e-10)
  assert math.isclose(v['baseNet']-v['stressNet'],e*q*.001,abs_tol=1e-10)
assert r['summaries']['latest6']['mirror']['tp']==3
assert r['summaries']['latest6']['swap']['minLotOver3pct']==6
assert r['summaries']['all17']['mirror']['minLotStressNet']<0
print('PASS: 51 replay paths, first barrier, exit prices, net cost accounting, cost sensitivity and cohort checks')
