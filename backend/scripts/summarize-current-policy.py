import pathlib,json,datetime
out=pathlib.Path(__file__).resolve().parents[2]/'docs/audits/2026-09-09-current-policy-replay'
rows=[]
for period in ['recent','prior']:
 for cost in ['base','stress']:
  p=out/period/('current_'+cost+'.json')
  if not p.exists():continue
  d=json.loads(p.read_text());a=d['account'];trades=d['outcomes'];peak=equity=a['initialWallet'];dd=0
  for t in sorted(trades,key=lambda t:t['closedAt']):
   equity+=t['financial']['netUsd'];peak=max(peak,equity);dd=max(dd,peak-equity)
  wins=sum(t['financial']['netUsd']>0 for t in trades);gains=sum(max(0,t['financial']['netUsd']) for t in trades);loss=-sum(min(0,t['financial']['netUsd']) for t in trades)
  rows.append({'period':period,'cost':cost,'trades':len(trades),'wins':wins,'losses':len(trades)-wins,'netUsd':a['endingWallet']-a['initialWallet'],'profitFactorUsd':gains/loss if loss else None,'closedTradeMaxDrawdownUsd':dd,'blocks':a['blocks']})
s={'computedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'complete':len(rows)==4,'rows':rows,'riskPolicy':'Pinned 1h cooldown / daily 10% / per-trade 3%; no fixed USD cap','initialWallet':33.59964603,'limitations':['No full LLM/limit-fill/latency/mark-to-market/full portfolio circuit; retest waiting remains approximate.','Previously examined historical data, not an untouched holdout.','Stress changes admission as well as repricing.','This is range-only, not whole-account ROI.'],'liveChanges':False}
(out/'summary.json').write_text(json.dumps(s,indent=2));print(json.dumps(s,indent=2))
