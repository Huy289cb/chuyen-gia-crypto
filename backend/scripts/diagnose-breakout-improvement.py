import json,pathlib,statistics,bisect
root=pathlib.Path(__file__).resolve().parents[2];prior=root/'docs/audits/2026-09-25-trend-research';out=root/'docs/audits/2026-09-25-breakout-improvement';read=lambda p:json.loads(p.read_text())
allrows=[]
for sub in ['history_2024','history_2023','train','validation','']:
 p=prior/sub;file=pathlib.Path(read(p/'dataset.json')['file'])if sub else root/'docs/audits/2026-09-24-live-testbed/market.json';data=read(file);bars=data['byTf']['15m'];times=[b[0]for b in bars];h=data['byTf']['1h'];ht=[b[0]+3600000 for b in h];signals={c['id']:c for c in read(p/'signals.json')['compression_breakout']};run=read(p/'full-compression_breakout-stress.json')
 for c in run['closes']:
  sig=signals[c['planId']];i=bisect.bisect_left(times,sig['sourceClose']-900000);b=bars[i];d=1 if sig['side']=='long'else -1;j=bisect.bisect_right(ht,sig['sourceClose'])-1
  atr=sum(max(x[2]-x[3],abs(x[2]-bars[i-15+k][4]),abs(x[3]-bars[i-15+k][4]))for k,x in enumerate(bars[i-14:i]))/14
  box=bars[i-12:i];width=max(x[2]for x in box)-min(x[3]for x in box);vr=b[5]/statistics.mean(x[5]for x in bars[i-20:i]);closepos=(b[4]-b[3])/(b[2]-b[3])if d==1 else(b[2]-b[4])/(b[2]-b[3]);er=abs(h[j][4]-h[j-20][4])/sum(abs(h[k][4]-h[k-1][4])for k in range(j-19,j+1))
  allrows.append({'dataset':sub or'recent','id':c['planId'],'side':sig['side'],'net':c['netUsd'],'holdHours':(c['time']-c['entryTime'])/3600000,'volumeRatio':vr,'closePosition':closepos,'widthATR':width/atr,'atrPct':atr/b[4]*100,'h1Efficiency':er,'breakoutExtensionATR':d*(b[4]-sig['entry'])/atr,'mfeR':c['mfeRUpperBound']})
result=[]
for name in ['history_2024','history_2023','train','recent']:
 xs=[r for r in allrows if r['dataset']==name]
 for label,fn in [('all',lambda r:True),('long',lambda r:r['side']=='long'),('short',lambda r:r['side']=='short'),('close_strong>=.75',lambda r:r['closePosition']>=.75),('h1_efficiency>=.3',lambda r:r['h1Efficiency']>=.3),('volume>=2',lambda r:r['volumeRatio']>=2),('extension<=.5ATR',lambda r:r['breakoutExtensionATR']<=.5)]:
  a=[r for r in xs if fn(r)];result.append({'dataset':name,'group':label,'n':len(a),'wins':sum(r['net']>0 for r in a),'net':sum(r['net']for r in a)})
(out/'diagnosis.json').write_text(json.dumps({'method':'Descriptive partitions of actually simulated fills, not fresh portfolio runs; overlapping filters are NOT parameter selection evidence. Features measured using closed candles at signal.','rows':allrows,'groups':result},indent=2))
for r in result:print(r)
