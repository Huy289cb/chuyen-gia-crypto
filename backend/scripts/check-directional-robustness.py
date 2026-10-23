"""Descriptive robustness and limited observational controls; never trading ROI."""
import json, pathlib, statistics, datetime, hashlib, sys
root=pathlib.Path(sys.argv[1]); out=pathlib.Path(sys.argv[2])
responses=(root/'broader-directional-response.json').read_bytes()
summary=(root/'broader-directional-summary.json').read_bytes()
rows=json.loads(responses)['rows']
group=next(g for g in json.loads(summary)['groups'] if g['group']==['breakout_volume','bull','long'])
ids=set(group['selectedEventIds'])
chosen=sorted([r for r in rows if r['eventId'] in ids],key=lambda r:r['time'])
value=lambda r:r['horizons'][1]['directionalReturnPct']
ts=lambda r:datetime.datetime.fromisoformat(r['time'].replace('Z','+00:00')).timestamp()
values=[value(r) for r in chosen]
controls=[r for r in rows if r['side']=='long' and r['structureBias']=='bull' and r['playbook']!='breakout_volume' and r['horizons'][1]['status']=='observed']
used=set();pairs=[]
for r in chosen:
    # Prespecified metadata matching: previous <=4h, same UTC day and timeframe,
    # nearest observation, without looking at returns and without reuse.
    eligible=[c for c in controls if c['eventId'] not in used and c['time'][:10]==r['time'][:10] and c['timeframe']==r['timeframe'] and 0<ts(r)-ts(c)<=14400]
    if not eligible:continue
    c=max(eligible,key=ts);used.add(c['eventId'])
    pairs.append(dict(eventId=r['eventId'],controlEventId=c['eventId'],controlPlaybook=c['playbook'],deltaPct=value(r)-value(c)))
best=max(chosen,key=value)
daily={day:statistics.mean(value(r) for r in chosen if r['time'][:10]==day) for day in sorted(set(r['time'][:10] for r in chosen))}
report=dict(schema='directional-robustness-v1',sourceHashes=dict(responses=hashlib.sha256(responses).hexdigest(),summary=hashlib.sha256(summary).hexdigest()),
 selectedEventIds=sorted(ids),meanPct=statistics.mean(values),medianPct=statistics.median(values),
 bestEventId=best['eventId'],bestReturnPct=value(best),bestContributionToSum=value(best)/sum(values),
 meanWithoutBestPct=statistics.mean(value(r) for r in chosen if r['eventId']!=best['eventId']),dailyMeans=daily,
 leaveOneDayOutMeans={day:statistics.mean(value(r) for r in chosen if r['time'][:10]!=day) for day in daily},
 pairs=pairs,matchedCount=len(pairs),unmatchedCount=len(chosen)-len(pairs),
 limits=['Post-selection diagnostics on previously viewed development data.','Different-detector controls are not random/no-signal controls; residual confounding and overlapping windows remain.','Directional price returns are not fill outcomes or portfolio ROI.','No fee/funding/slippage/AI accounting; no evidence of net edge from these statistics alone.'])
with out.open('x') as f:json.dump(report,f,indent=2)
print(json.dumps({k:report[k] for k in ['meanPct','meanWithoutBestPct','bestContributionToSum','matchedCount','unmatchedCount','leaveOneDayOutMeans']},indent=2))
