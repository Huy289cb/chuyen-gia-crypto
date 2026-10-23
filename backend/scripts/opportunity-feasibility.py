#!/usr/bin/env python3
"""Descriptive TRAIN diagnostics: minimum-lot feasibility and same-path extra costs."""
import pathlib,json,math,datetime,collections
p=pathlib.Path(__file__).resolve().parents[2]/'docs/audits/2026-09-11-opportunity-testbed'
data=json.loads((p/'train-data.json').read_text());wallet=33.59964603;months=collections.defaultdict(lambda:collections.Counter())
for row in data['byTf']['15m']:
 price=row[4];q=max(.001,math.ceil(50/price/.001-1e-9)*.001);notional=price*q
 # Best-case structural stop at exact0.8% floor, costs0.2%; not a real valid setup.
 key=datetime.datetime.fromtimestamp(row[0]/1000,datetime.timezone.utc).strftime('%Y-%m');m=months[key];m['bars']+=1
 if notional>100+1e-9:m['blocked_exposure']+=1
 elif notional*.01>wallet*.03+1e-9:m['blocked_risk']+=1
 else:m['financially_possible_only']+=1
base=json.loads((p/'structure-reclaim-portfolio-structure_reclaim_confirmed-base.json').read_text());stress=json.loads((p/'structure-reclaim-portfolio-structure_reclaim_confirmed-stress.json').read_text())
fills=[e for e in base['events'] if e['type']=='fill'];increment=sum(e['plan']['entry']*e['plan']['quantity']*.001 for e in fills)
bids={e['plan']['id'] for e in fills};sids={e['plan']['id'] for e in stress['events'] if e['type']=='fill'}
r={'fixedWallet':wallet,'maxExposureUsd':100,'minimumStopFraction':.008,'riskAndCostFractionOfNotional':.01,
 'monthlyTheoreticalFeasibility':months,'reclaimSamePathCostDiagnostic':{'baseNetUsd':base['summary']['netCashUsd'],
 'extraSlippageSameFilledOrdersUsd':increment,'samePathStressNetUsd':base['summary']['netCashUsd']-increment,
 'commonFilledPlanIds':len(bids&sids),'baseOnlyPlanIds':len(bids-sids),'stressOnlyPlanIds':len(sids-bids)},
 'limitations':['Minimum-stop feasibility ignores structural stop/TP, funding, cooldown and every signal filter; not an executable signal count.',
 'Same-path cost deduction freezes baseline inventory; separate stress portfolio revalidates changing wallet and can take different trades.',
 'TRAIN only; no out-of-sample or causal treatment-effect claim.']}
(p/'trial-005-feasibility.json').write_text(json.dumps(r,indent=2)+'\n');print(json.dumps(r,indent=2))
