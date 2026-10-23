"""Conditional exact boundary swap on all17 actual longs; preserve pre-reconciliation original SL."""
import json,pathlib,datetime,hashlib
ROOT=pathlib.Path(__file__).resolve().parents[2];SRC=ROOT/'docs/audits/2026-09-24-long-reversal';OUT=ROOT/'docs/audits/2026-09-24-swap-2r'
read=lambda p:json.loads(p.read_text());ms=lambda s:int(datetime.datetime.fromisoformat(s.replace('Z','+00:00')).timestamp()*1000)
db=read(SRC/'db.json');entrybars=read(SRC/'entry-minutes.json');protocol={'geometry':'For original actual fill E and initial stop L: construct longTP=E+2*(E-L); shortSL=longTP; shortTP=L. Price RR0.5, no same-stop mirror. Conditional fill, not guaranteed executable.', 'horizon':'Original frozen72h-or-snapshot market data','cohort':'All17 longs sinceAug1, winners included; latest6 and range3 retrospective subsets','feePerSide':.0005,'baseRoundTripSlip':.001,'stressRoundTripSlip':.002,'scriptSha':hashlib.sha256(pathlib.Path(__file__).read_bytes()).hexdigest(),'dbSha':hashlib.sha256((SRC/'db.json').read_bytes()).hexdigest()}
with open(OUT/'actual-protocol.json','x')as f:json.dump(protocol,f,indent=2)
for name,h in read(SRC/'market-manifest.json').items():assert hashlib.sha256((SRC/name).read_bytes()).hexdigest()==h
rows=[]
for p in db['positions']:
 ev=next(json.loads(e['event_data'])for e in db['events']if e['position_id']==p['position_id']and e['event_type']=='entry_order_filled');decision=next(d for d in db['decisions']if d['id']==ev['decision_id'])
 m=read(SRC/(p['position_id']+'-market.json'));E=p['entry_price'];Q=p['size_qty'];TP=ev['stop_loss'];SL=E+2*(E-TP);assert 0<TP<E<SL
 reason='time_exit'if m['full72h']else'pending';X=m['minutes'][-1]['close'];end=m['minutes'][-1]['closeTime'];dual=False
 for b in m['minutes']:
  s=b['high']>=SL;t=b['low']<=TP
  if s or t:reason='sl'if s else'tp';X=max(SL,b['open'])if s else TP;end=b['openTime'];dual=s and t;break
 fund=0
 for f in m['funding']:
  cash=Q*float(f['markPrice'])*float(f['fundingRate']);t=f['fundingTime']
  if ms(p['entry_time'])<t<end or(end<=t<=end+59999 and cash<0):fund+=cash
 eb=entrybars[p['position_id']][0];gross=(E-X)*Q;fee=(E+X)*Q*.0005
 def risk(q,slip):return ((SL-E)*q+max(E,SL)*q*.001+E*q*slip)/ev['account_balance']*100
 rows.append({'id':p['position_id'],'entryTime':p['entry_time'],'setup':decision['playbook_key'],'entry':E,'longSL':TP,'long2RTP':SL,'shortSL':SL,'shortTP':TP,'quantity':Q,'balance':ev['account_balance'],'actualLongNet':p['realized_pnl'],'outcome':reason,'exit':X,'exitTime':end,'dualHit':dual,'entryMinuteAmbiguous':eb['high']>=SL or eb['low']<=TP,'baseNet':None if reason=='pending'else gross-fee-E*Q*.001+fund,'stressNet':None if reason=='pending'else gross-fee-E*Q*.002+fund,'minLotBaseRiskPct':risk(.001,.001),'minLotStressRiskPct':risk(.001,.002),'sameQtyBaseRiskPct':risk(Q,.001),'sameQtyStressRiskPct':risk(Q,.002)})
summary={}
for name,cohort in [('latest6',rows[:6]),('september_range3',[r for r in rows[:4]if r['setup']=='liquidity_sweep_reclaim']),('all17',rows)]:
 valid=[r for r in cohort if not r['entryMinuteAmbiguous']and r['outcome']!='pending'];summary[name]={'n':len(cohort),'resolved':len(valid),'pending':sum(r['outcome']=='pending'for r in cohort),'entryAmbiguous':sum(r['entryMinuteAmbiguous']for r in cohort),'tp':sum(r['outcome']=='tp'for r in valid),'sl':sum(r['outcome']=='sl'for r in valid),'timeExit':sum(r['outcome']=='time_exit'for r in valid),'netWins':sum(r['baseNet']>0 for r in valid),'baseNet':sum(r['baseNet']for r in valid),'stressNet':sum(r['stressNet']for r in valid),'minLotBaseNet':sum(r['baseNet']*.001/r['quantity']for r in valid),'minLotStressNet':sum(r['stressNet']*.001/r['quantity']for r in valid),'minLotBaseOver3pct':sum(r['minLotBaseRiskPct']>3 for r in cohort),'minLotStressOver3pct':sum(r['minLotStressRiskPct']>3 for r in cohort)}
(OUT/'actual-results.json').write_text(json.dumps({'summary':summary,'positions':rows},indent=2));print(json.dumps(summary,indent=2));print('Latest risk%',[(r['entryTime'],round(r['minLotBaseRiskPct'],2),round(r['minLotStressRiskPct'],2))for r in rows[:6]])
