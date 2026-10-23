"""Reprice fixed simulated fills; does not rerun equity-dependent entry decisions."""
from pathlib import Path
import json, datetime
ROOT=Path(__file__).resolve().parents[2]
p=ROOT/'docs/audits/2026-09-07-entry-opportunity'
funding=json.loads((p/'historical-funding.json').read_text())['rows']
result=[]
for file in sorted(p.glob('*-wallet.json')):
 source=json.loads(file.read_text());trades=source['result']['trades'];net=0;fees_funding=0;positive=0;negative=0;stress=0;rows=[]
 for t in trades:
  qty=t['notionalUsd']/t['entryPrice']
  sign=1 if t['side']=='long' else -1
  events=[r for r in funding if t['entryTime']<r['fundingTime']<=t['closeTime']]
  cost=sum(sign*qty*float(r['markPrice'])*float(r['fundingRate']) for r in events)
  n=t['pnlUsd']-cost
  net+=n;fees_funding+=cost;positive+=max(n,0);negative+=max(-n,0)
  stressed=n-t['notionalUsd']*.001 # total slippage raised from .10% to .20%
  stress+=stressed
  rows.append({'entryTime':t['entryTime'],'closeTime':t['closeTime'],'netBeforeFunding':t['pnlUsd'],'fundingCost':cost,'netAfterFunding':n,'stressNet':stressed,'fundingEvents':len(events)})
 result.append({'variant':file.stem,'count':len(trades),'netBeforeFunding':source['summary']['net'],'signedFundingCost':fees_funding,'netAfterFunding':net,'profitFactorAfterFunding':positive/negative if negative else None,'netAtDoubleSlippage':stress,'trades':rows})
output={'computedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'method':'Fixed-fill cost sensitivity: historical funding mark price * rate * signed quantity, entryTime < fundingTime <= closeTime. Entry selection, wallet and cooldown are NOT recomputed after funding. Intrabar funding/exit ordering is approximate. Extra slippage stress adds 0.10% of entry notional. Screening only, not full live return estimation.','results':result}
(p/'screen-cost-sensitivity.json').write_text(json.dumps(output,indent=2))
for r in result:print(json.dumps({k:v for k,v in r.items() if k!='trades'}))
