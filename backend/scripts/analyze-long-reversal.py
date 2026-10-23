"""Paired conditional replay, not an executable portfolio or out-of-sample test."""
import json, pathlib, datetime, hashlib
ROOT=pathlib.Path(__file__).resolve().parents[2]/'docs/audits/2026-09-24-long-reversal'
read=lambda f:json.loads((ROOT/f).read_text())
ms=lambda s:int(datetime.datetime.fromisoformat(s.replace('Z','+00:00')).timestamp()*1000)
db=read('db.json'); protocol=read('protocol.json')
assert hashlib.sha256((ROOT/'db.json').read_bytes()).hexdigest()==protocol['dbSha256']
for f,h in read('market-manifest.json').items(): assert hashlib.sha256((ROOT/f).read_bytes()).hexdigest()==h
entrybars=read('entry-minutes.json'); results=[]
for p in db['positions']:
 ev=[json.loads(e['event_data']) for e in db['events'] if e['position_id']==p['position_id'] and e['event_type']=='entry_order_filled']; assert len(ev)==1
 ev=ev[0]; d=next(d for d in db['decisions'] if d['id']==ev['decision_id']); m=read(p['position_id']+'-market.json')
 E=p['entry_price']; Q=p['size_qty']; S=ev['stop_loss']; T=ev['take_profit']; assert S<E<T
 bars=m['minutes']; assert all(b['openTime']==m['start']+60000*i for i,b in enumerate(bars))
 preclose=[b for b in bars if b['closeTime']<ms(p['close_time'])]
 row={'id':p['position_id'],'entryTime':p['entry_time'],'decision':d,'actualNet':p['realized_pnl'],'entry':E,'initialSL':S,'initialTP':T,'quantity':Q,'balance':ev['account_balance'],'full72h':m['full72h'],'mfeBeforeCloseR':max([0]+[(b['high']-E)/(E-S) for b in preclose]),'variants':{}}
 for name,side,sl,tp in [('long',1,S,T),('mirror',-1,2*E-S,2*E-T),('swap',-1,T,S)]:
  eb=entrybars[p['position_id']]; assert len(eb)==1
  ambiguous=eb[0]['low']<=min(sl,tp) or eb[0]['high']>=max(sl,tp)
  outcome='time_exit' if m['full72h'] else 'censored'; X=bars[-1]['close']; end=bars[-1]['closeTime']; dual=False
  for b in bars:
   stop=b['low']<=sl if side==1 else b['high']>=sl
   take=b['high']>=tp if side==1 else b['low']<=tp
   if stop or take:
    outcome='sl' if stop else 'tp'; dual=stop and take
    X=(min(sl,b['open']) if side==1 else max(sl,b['open'])) if stop else tp
    end=b['openTime'];break
  # Exit minute timing unknown: include any debit, exclude any credit in that minute.
  funding=0
  for f in m['funding']:
   t=f['fundingTime']; cash=-side*Q*float(f['markPrice'])*float(f['fundingRate'])
   if ms(p['entry_time'])<t<end or (end<=t<=end+59999 and cash<0): funding+=cash
  fee=.0005*Q*(E+X); gross=side*(X-E)*Q
  riskunit=abs(sl-E)+.0005*(E+sl)+E*.001
  row['variants'][name]={'outcome':outcome,'exit':X,'exitTime':end,'entryMinuteAmbiguous':ambiguous,'dualHit':dual,'gross':gross,'fundingCash':funding,'baseNet':gross-fee-E*Q*.001+funding,'stressNet':gross-fee-E*Q*.002+funding,'sameQtyRiskPct':riskunit*Q/ev['account_balance']*100,'minLotRiskPct':riskunit*.001/ev['account_balance']*100,'minLotStressRiskPct':(riskunit+E*.001)*.001/ev['account_balance']*100}
 results.append(row)
summaries={}
for cohort,rows in [('latest6',results[:6]),('september',results[:4]),('all17',results)]:
 summary={'actualNet':sum(r['actualNet'] for r in rows),'actualWins':sum(r['actualNet']>0 for r in rows),'n':len(rows)}
 for v in ['long','mirror','swap']:
  rs=[r['variants'][v] for r in rows]; closed=[r for r in rs if r['outcome']!='censored' and not r['entryMinuteAmbiguous']]
  summary[v]={'resolved':len(closed),'censored':sum(r['outcome']=='censored' for r in rs),'entryAmbiguous':sum(r['entryMinuteAmbiguous'] for r in rs),'tp':sum(r['outcome']=='tp' for r in closed),'sl':sum(r['outcome']=='sl' for r in closed),'netWins':sum(r['baseNet']>0 for r in closed),'baseNet':sum(r['baseNet'] for r in closed),'stressNet':sum(r['stressNet'] for r in closed),'minLotOver3pct':sum(r['minLotRiskPct']>3 for r in rs),'sameQuantityOver3pct':sum(r['sameQtyRiskPct']>3 for r in rs),'minLotBaseNet':sum(r['variants'][v]['baseNet']*.001/r['quantity'] for r in rows if r['variants'][v] in closed),'minLotStressNet':sum(r['variants'][v]['stressNet']*.001/r['quantity'] for r in rows if r['variants'][v] in closed)}
 summaries[cohort]=summary
(ROOT/'results.json').write_text(json.dumps({'method':'Stop-first OHLC conditional replay; costs conservative; see protocol and report.','summaries':summaries,'positions':results},indent=2))
print(json.dumps(summaries,indent=2))
for r in results[:6]: print(r['entryTime'], 'MFE',round(r['mfeBeforeCloseR'],2),[(v,x['outcome'],round(x['baseNet'],3),round(x['minLotRiskPct'],2),x['entryMinuteAmbiguous']) for v,x in r['variants'].items()])
