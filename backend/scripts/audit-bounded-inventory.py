import json,hashlib,collections
from pathlib import Path
base=Path('/home/ubuntu/chuyen-gia-crypto');out=base/'docs/audits/2026-10-02-bounded-baseline'
p=base/'docs/audits/2026-09-27-feasibility/current-geometry-inventory.json';d=json.loads(p.read_text())
events=d['events'];ids=[e['id'] for e in events];keys=[e['event_data'].get('observation_key') for e in events]
duplicates=lambda a:{str(k):v for k,v in collections.Counter(a).items() if v>1}
rows=[]
for e in events:
 x=e['event_data'];f=x.get('feasibility',{});rows.append({'eventId':e['id'],'observedAt':e['timestamp'],'observationKey':x.get('observation_key'),'timeframe':x.get('timeframe'),'side':x.get('side'),'playbook':x.get('playbook'),'sourceCutoff':f.get('sourceCutoff'),'structureCutoff':f.get('structureCutoff'),'status':f.get('status'),'preAiProxyPass':x.get('pre_ai_proxy_pass'),'independentSetupId':None})
coverage={}
for tf,candles in d['candles'].items():
 step={'5m':300000,'15m':900000,'1h':3600000,'4h':14400000}.get(tf);ts=sorted(c['timestamp'] for c in candles);gaps=[{'before':a,'after':b,'deltaMs':b-a} for a,b in zip(ts,ts[1:]) if step and b-a!=step]
 coverage[tf]={'count':len(ts),'firstOpenMs':ts[0] if ts else None,'lastOpenMs':ts[-1] if ts else None,'expectedStepMs':step,'duplicateOpenTimes':duplicates(ts),'gaps':gaps}
result={'schema':'bounded-inventory-coverage-v1','sourceSha256':hashlib.sha256(p.read_bytes()).hexdigest(),'since':d['since'],'through':d['through'],'source':d['source'],'observations':len(events),'directionalObservations':sum(r['side'] in ('long','short') for r in rows),'duplicateEventIds':duplicates(ids),'duplicateObservationKeys':duplicates(keys),'missingObservationKeys':sum(k is None for k in keys),'candles':coverage,'rows':rows,'independentSetupCount':None,'executablePlanCount':None,'limits':['Observation key deduplicates bar/timeframe/method only; lacks verified setup/wave identity across bars/timeframes.','Retrospective public candles do not prove the worker saw identical data on time.','Per-row cutoffs retained; global through is not permission to use later candles.','This historical window is development, not current runtime end-to-end replay or new holdout.','Financial snapshot on Oct2 cannot be substituted for historical account state in Sept27-28.','No independent fills rate or ROI inferred from diagnostic observations.']}
(out/'inventory-coverage.json').write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n')
files=[]
for folder in ['2026-09-27-feasibility','2026-10-02-execution','2026-09-26-live-diagnosis','2026-09-20-ict-backtest','2026-09-20-ict-implementation','2026-09-20-ict-ote-silver','2026-09-20-ict-extended','2026-09-26-opportunity-rr2-ai','2026-09-26-entry-quality']:
 for f in sorted((base/'docs/audits'/folder).glob('*')):
  if f.is_file() and f.suffix in ('.json','.md'):
   row={'path':str(f.relative_to(base)),'sha256':hashlib.sha256(f.read_bytes()).hexdigest(),'bytes':f.stat().st_size,'classification':'previously exposed development/audit evidence; never fresh holdout'}
   if f.suffix=='.json':
    try:
     j=json.loads(f.read_text());row['recordedBounds']={k:j[k] for k in ('since','through','capturedAt','asOf','query') if isinstance(j,dict) and k in j}
    except (ValueError,UnicodeError):row['parseStatus']='unreadable'
   files.append(row)
(out/'evidence-registry.json').write_text(json.dumps({'schema':'bounded-evidence-registry-v1','scope':'Top-level audit artifacts in listed existing evidence directories; runtime archives separately frozen. Not exhaustive proof of historical data exposure.','files':files,'reservedDataStatus':'Unknown; no reserved dataset opened in this goal. Must audit full experiment/cache lineage before claiming unseen holdout.','comparisonWindow':{'since':d['since'],'through':d['through'],'purpose':'bounded component inventory reconstruction, not historical full current-live replay'},'historicalInitialState':'Unavailable for a full portfolio comparison; current account snapshot is not substituted.'},ensure_ascii=False,indent=2)+'\n')
assert not result['duplicateEventIds'];assert result['observations']==370 and result['directionalObservations']==40
print(json.dumps({'registryFiles':len(files),'observations':len(events),'duplicateKeys':len(result['duplicateObservationKeys']),'candles':{k:{'count':v['count'],'gaps':len(v['gaps']),'duplicates':len(v['duplicateOpenTimes'])} for k,v in coverage.items()},'independentSetups':'unknown'}))
