#!/usr/bin/env python3
"""TRAIN-only descriptive resampling; never an OOS promotion certificate."""
import json,pathlib,random
p=pathlib.Path(__file__).resolve().parents[2]/'docs/audits/2026-09-11-opportunity-testbed'
result=[]
for f in sorted(p.glob('portfolio-*-*.json')):
 d=json.loads(f.read_text());s=d['summary'];weeks={}
 for c in d['closes']:
  w=int((c['time']+7*3600000)//604800000);weeks[w]=weeks.get(w,0)+c['netUsd']
 start=int((1735689600000+7*3600000)//604800000);end=int((1751328000000-1+7*3600000)//604800000)
 values=[weeks.get(w,0) for w in range(start,end+1)]
 rng=random.Random(20260911);dist=sorted(sum(rng.choice(values) for _ in values) for _ in range(20000))
 result.append({'setup':s['setup'],'cost':s['cost'],'closed':s['trades'],'netUsd':s['netCashUsd'],
  'weeklyBlocks':len(values),'activeWeeks':len(weeks),'lowerTailProbability':.05/6,
  'trainWeekResampleLowerNetUsd':dist[int(len(dist)*(.05/6))],
  'notIndependentOosEvidence':True,'note':'TRAIN diagnostic; nonstationarity and sparse dependent blocks prevent a robust performance claim.'})
(p/'train-weekly-diagnostics.json').write_text(json.dumps(result,indent=2)+'\n')
print(json.dumps(result,indent=2))
