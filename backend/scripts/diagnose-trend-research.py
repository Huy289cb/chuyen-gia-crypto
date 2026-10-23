import json,pathlib,statistics,hashlib
root=pathlib.Path(__file__).resolve().parents[2];out=root/'docs/audits/2026-09-25-trend-research';read=lambda p:json.loads(p.read_text())
market=read(root/'docs/audits/2026-09-24-live-testbed/market.json');bars=market['byTf']['1m'];start=bars[0][0];signals=read(out/'signals.json');results=[]
for variant,cs in signals.items():
 for hours in [1,4,24]:
  values=[]
  for c in cs:
   i=int((c['time']-start)//60000)-1;j=i+hours*60
   if j>=len(bars):continue
   assert bars[i][0]+60000==c['time']
   direction=1 if c['side']=='long' else -1
   values.append(direction*(bars[j][4]/bars[i][4]-1)*100)
  results.append({'variant':variant,'hours':hours,'n':len(values),'meanSignedReturnPct':statistics.mean(values),'medianSignedReturnPct':statistics.median(values),'fractionAboveApproxStressCost':sum(x>.3 for x in values)/len(values)})
(out/'trajectories.json').write_text(json.dumps({'method':'Directional returns from last known close at signal time to future close; all generated signals, overlapping horizons; NOT executable PnL or independent trades. No portfolio circuit filtering. 0.3% is illustrative fee/slippage threshold; funding excluded from this diagnostic only.','rows':results},indent=2));print(json.dumps(results,indent=2))
