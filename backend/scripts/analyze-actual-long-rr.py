"""Conditional TP sensitivity on all17 observed longs. Not chronological executable ROI."""
import json,pathlib,datetime,hashlib
ROOT=pathlib.Path(__file__).resolve().parents[2]
SRC=ROOT/'docs/audits/2026-09-24-long-reversal';OUT=ROOT/'docs/audits/2026-09-24-range-rr'
read=lambda f:json.loads(f.read_text())
ms=lambda s:int(datetime.datetime.fromisoformat(s.replace('Z','+00:00')).timestamp()*1000)
db=read(SRC/'db.json');entrybars=read(SRC/'entry-minutes.json');results=[]
protocol={'rrs':[.5,1,1.5,2],'cohort':'All17 actual longs since Aug1; latest6 and September range3 separately, selected retrospectively','source':str(SRC),'dbHash':hashlib.sha256((SRC/'db.json').read_bytes()).hexdigest(),'scriptHash':hashlib.sha256(pathlib.Path(__file__).read_bytes()).hexdigest(),'costs':{'feeEachSide':.0005,'baseSlip':.001,'stressSlip':.002},'interpretation':'Conditional entry at original fill, fixed original SL, varied TP only. Excludes entry minute and flags any barrier touched there. Horizon72h or frozen snapshot. PnL before AI/infrastructure. No promotion eligibility.'}
with open(OUT/'actual-protocol.json','x')as f:json.dump(protocol,f,indent=2)
for p in db['positions']:
 event=next(json.loads(e['event_data']) for e in db['events'] if e['position_id']==p['position_id'] and e['event_type']=='entry_order_filled')
 decision=next(d for d in db['decisions'] if d['id']==event['decision_id'])
 m=read(SRC/(p['position_id']+'-market.json'));E=p['entry_price'];S=event['stop_loss'];Q=p['size_qty'];R=E-S;assert R>0
 eb=entrybars[p['position_id']][0]
 row={'id':p['position_id'],'entryTime':p['entry_time'],'setup':decision['playbook_key'],'actualNet':p['realized_pnl'],'entry':E,'initialSL':S,'quantity':Q,'paths':[]}
 stopindex=next((i for i,b in enumerate(m['minutes']) if b['low']<=S),len(m['minutes']))
 row['mfeBeforeFirstSLFullMinutesR']=max([0]+[(b['high']-E)/R for b in m['minutes'][:stopindex]])
 for rr in protocol['rrs']:
  target=E+R*rr;reason='time_exit' if m['full72h'] else 'pending';X=m['minutes'][-1]['close'];end=m['minutes'][-1]['closeTime'];dual=False
  for b in m['minutes']:
   stop=b['low']<=S;take=b['high']>=target
   if stop or take:
    reason='sl' if stop else 'tp';X=min(S,b['open']) if stop else target;end=b['openTime'];dual=stop and take;break
  funding=0
  for f in m['funding']:
   cash=-Q*float(f['markPrice'])*float(f['fundingRate']);t=f['fundingTime']
   if ms(p['entry_time'])<t<end or (end<=t<=end+59999 and cash<0):funding+=cash
  net=(X-E)*Q-.0005*Q*(E+X)+funding
  ambiguous=eb['low']<=S or eb['high']>=target
  row['paths'].append({'rr':rr,'reason':reason,'exitTime':end,'entryMinuteAmbiguous':ambiguous,'dualHit':dual,'baseNet':None if reason=='pending' else net-E*Q*.001,'stressNet':None if reason=='pending' else net-E*Q*.002})
 results.append(row)
summaries={}
for cohort,rows in [('all17',results),('latest6',results[:6]),('september_range3',[r for r in results[:4] if r['setup']=='liquidity_sweep_reclaim'])]:
 s={'actualNet':sum(r['actualNet'] for r in rows),'n':len(rows),'mfeBeforeSL':{str(t):sum(r['mfeBeforeFirstSLFullMinutesR']>=t for r in rows)for t in [.5,1,1.5,2]},'variants':[]}
 for rr in protocol['rrs']:
  paths=[(r,next(v for v in r['paths'] if v['rr']==rr))for r in rows];valid=[(r,v)for r,v in paths if not v['entryMinuteAmbiguous'] and v['reason']!='pending']
  s['variants'].append({'rr':rr,'resolved':len(valid),'excludedEntryAmbiguous':sum(v['entryMinuteAmbiguous'] for _,v in paths),'pending':sum(v['reason']=='pending' for _,v in paths),'tp':sum(v['reason']=='tp' for _,v in valid),'sl':sum(v['reason']=='sl' for _,v in valid),'baseNet':sum(v['baseNet'] for _,v in valid),'stressNet':sum(v['stressNet'] for _,v in valid),'minLotBaseNet':sum(v['baseNet']*.001/r['quantity'] for r,v in valid),'minLotStressNet':sum(v['stressNet']*.001/r['quantity'] for r,v in valid)})
 summaries[cohort]=s
(OUT/'actual-results.json').write_text(json.dumps({'summaries':summaries,'positions':results},indent=2));print(json.dumps(summaries,indent=2))
