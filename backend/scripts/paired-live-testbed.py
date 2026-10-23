import json,pathlib,hashlib
ROOT=pathlib.Path(__file__).resolve().parents[2];P=ROOT/'docs/audits/2026-09-24-live-testbed';read=lambda p:json.loads(p.read_text());protocol=read(P/'protocol.json');market=read(P/'market.json');ops=read(P/'opportunities.json');reviews=read(P/'reviews.json');approved={r['id']for r in reviews if r['decision']=='trade'}
rows=[]
for x in ops:
 p=x['opportunity'];E=p['entry_price'];L=p['stop_loss'];T=round(E+2*(E-L),1)
 for variant,side,SL,TP in [('current_range_long',1,L,p['take_profit']),('long_2R',1,L,T),('swap_short_0.5R',-1,T,L)]:
  start=x['time']+60000;end=protocol['end'];bs=[b for b in market['byTf']['1m']if start<=b[0]<end];reason='end_liquidation';price=bs[-1][4];time=end;dual=False
  for b in bs:
   stop=b[3]<=SL if side==1 else b[2]>=SL;take=b[2]>=TP if side==1 else b[3]<=TP
   if stop or take:reason='sl'if stop else'tp';price=(min(SL,b[1])if side==1 else max(SL,b[1]))if stop else TP;time=b[0];dual=stop and take;break
  Q=.001;fund=0
  for f in market['funding']:
   cash=-side*Q*f['markPrice']*f['rate']
   if start<f['time']<time or(time<=f['time']<time+60000 and cash<0):fund+=cash
  gross=side*(price-E)*Q;fee=(E+price)*Q*.0005
  rows.append({'id':p['candidate_key'],'time':x['time'],'variant':variant,'approved':p['candidate_key']in approved,'outcome':reason,'dualHit':dual,'baseNet':gross-fee-E*Q*.001+fund,'stressNet':gross-fee-E*Q*.002+fund,'riskStressPct':((abs(E-SL)+max(E,SL)*.001+E*.002)*Q/protocol['wallet']*100)})
summary=[]
for cohort in ['all_regenerated','ai_approved']:
 for v in protocol['variants']:
  rs=[r for r in rows if r['variant']==v and(cohort=='all_regenerated'or r['approved'])];summary.append({'cohort':cohort,'variant':v,'n':len(rs),'tp':sum(r['outcome']=='tp'for r in rs),'sl':sum(r['outcome']=='sl'for r in rs),'endLiquidation':sum(r['outcome']=='end_liquidation'for r in rs),'baseNet':sum(r['baseNet']for r in rs),'stressNet':sum(r['stressNet']for r in rs),'riskOver3pct':sum(r['riskStressPct']>3 for r in rs)})
(P/'paired.json').write_text(json.dumps({'method':'Signal-only conditional same entry .001BTC at first modeled execution minute; ignores fill probability and portfolio admission; all end-liquidation outcomes shown. Not executable portfolio ROI. Historical funding and fee/slip included; no AI overhead.','scriptHash':hashlib.sha256(pathlib.Path(__file__).read_bytes()).hexdigest(),'summary':summary,'rows':rows},indent=2));print(json.dumps(summary,indent=2))
