import pathlib,json,datetime,statistics,sys
root=pathlib.Path(sys.argv[1]);output=pathlib.Path(sys.argv[2])
reg=json.loads((root/'control-regime-reconstruction.json').read_text())
resp=json.loads((root/'broader-directional-response.json').read_text())['rows']
summary=json.loads((root/'broader-directional-summary.json').read_text())
ids=set(next(g for g in summary['groups'] if g['group']==['breakout_volume','bull','long'])['selectedEventIds'])
signals=sorted((r for r in resp if r['eventId'] in ids),key=lambda r:r['time'])
controls=[r for r in reg['rows'] if r['side'] is None and r['reconstructed']=='bull' and r['reference'] and r['reference']>0]
bars={b['openTime']:b for f in (root/'broader-candles').glob('*.json') for b in json.loads(f.read_text())}
used=set();pairs=[];missing=[]
for r in signals:
 t=datetime.datetime.fromisoformat(r['time'].replace('Z','+00:00')).timestamp()*1000
 eligible=[c for c in controls if c['eventId'] not in used and c['timeframe']==r['timeframe'] and datetime.datetime.fromtimestamp(c['asOf']/1000,datetime.timezone.utc).date().isoformat()==r['time'][:10] and 0<t-c['asOf']<=14400000]
 if not eligible:missing.append(r['eventId']);continue
 c=max(eligible,key=lambda c:c['asOf']);used.add(c['eventId'])
 start=int((c['asOf']+59999)//60000*60000)
 path=[bars.get(start+i*60000) for i in range(240)]
 if any(b is None for b in path):missing.append(r['eventId']);continue
 controlReturn=(path[-1]['close']/c['reference']-1)*100
 signalReturn=r['horizons'][1]['directionalReturnPct']
 pairs.append(dict(signal=r['eventId'],control=c['eventId'],minutesApart=(t-c['asOf'])/60000,signalReturnPct=signalReturn,controlReturnPct=controlReturn,excessPct=signalReturn-controlReturn))
report=dict(schema='no-setup-control-comparison-v1',pairs=pairs,unmatched=missing,
 meanSignalPct=statistics.mean(p['signalReturnPct'] for p in pairs) if pairs else None,
 meanControlPct=statistics.mean(p['controlReturnPct'] for p in pairs) if pairs else None,
 meanExcessPct=statistics.mean(p['excessPct'] for p in pairs) if pairs else None,
 limits=['Different-time observational matching, not causal attribution.','Same UTC day/timeframe/reconstructed bull, nearest prior<=4h, no reuse; chosen without inspecting returns.','Overlapping outcome windows; not independent.','Closed-bar proxy returns, no fills/costs/net ROI.','Already viewed development; does not repair selection bias.'])
with output.open('x') as f:json.dump(report,f,indent=2)
print(json.dumps({k:v for k,v in report.items() if k not in ['pairs','limits']},indent=2))
