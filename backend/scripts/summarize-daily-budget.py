import pathlib,json,datetime
root=pathlib.Path(__file__).resolve().parents[2]/'docs/audits'
out=root/'2026-09-08-daily-budget-study'
rows=[]
for period in ['recent','prior']:
 for stress in ['base','stress']:
  for daily,label,directory in [(3,'consume_',root/'2026-09-08-admission-sensitivity'),(5,'daily5_',out)]:
   p=directory/period/(label+stress+'.json')
   if not p.exists():continue
   d=json.loads(p.read_text());a=d['account'];trades=d['outcomes'];equity=peak=a['initialWallet'];dd=0
   for t in sorted(trades,key=lambda t:t['closedAt']):
    equity+=t['financial']['netUsd'];peak=max(peak,equity);dd=max(dd,peak-equity)
   gains=sum(max(0,t['financial']['netUsd']) for t in trades);losses=-sum(min(0,t['financial']['netUsd']) for t in trades)
   rows.append({'period':period,'cost':stress,'dailyBudgetPercent':daily,'trades':len(trades),'netUsd':a['endingWallet']-a['initialWallet'],'profitFactorUsd':gains/losses if losses else None,'closedTradeMaxDrawdownUsd':dd,'blocks':a['blocks']})
result={'computedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'complete':len(rows)==8,'rows':rows,'limitations':['Closed-trade drawdown excludes intratrade equity lows.','Range-only native replay: no full LLM/limit fill/latency or combined regenerated core portfolio.','Historical data already examined; no independent future holdout.'],'liveDailyBudgetPercent':3,'riskCapUsd':1}
(out/'summary.json').write_text(json.dumps(result,indent=2));print(json.dumps(result,indent=2))
