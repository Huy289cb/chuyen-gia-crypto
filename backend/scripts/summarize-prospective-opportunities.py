#!/usr/bin/env python3
"""Read-only cohort health summary. Counts are not a performance certificate."""
import pathlib,json,datetime,sys
from prospective_coverage import capture_coverage,utc_timestamp_ms
from prospective_review_audit import review_links,known_cost
if sys.argv[1:] not in ([], ['--union-study']): raise ValueError('unknown study')
p=pathlib.Path(__file__).resolve().parents[2]/('docs/audits/2026-09-13-prospective-union' if sys.argv[1:] else 'docs/audits/2026-09-12-prospective-opportunity')
protocol=json.loads((p/'protocol.json').read_text())
cutoff=utc_timestamp_ms(protocol['frozenAt'])
snapshots=[json.loads(f.read_text()) for f in p.glob('snapshot-*.json')]
result_files={f.name:json.loads(f.read_text()) for f in p.glob('result-*.json')}
claim_files={f.name:json.loads(f.read_text()) for f in p.glob('quota-*.json')}
results=list(result_files.values());claims=list(claim_files.values())
links=review_links(claim_files,result_files)
eligible=[s for s in snapshots if s['snapshot']['asOf']>=cutoff]
known=[r['costUsd'] for r in results if known_cost(r.get('costUsd'))]
observed=datetime.datetime.now(datetime.timezone.utc)
coverage=capture_coverage(snapshots,cutoff,cutoff+int(protocol['durationHours']*3600000),int(observed.timestamp()*1000))
r={'at':observed.isoformat(),'scheduledCoverage':coverage,'capturedSnapshotsIncludingPilot':len(snapshots),
 'postFreezeSnapshots':len(eligible),'postFreezeSnapshotsWithPlans':sum(bool(s['snapshot']['plans']) for s in eligible),
 'postFreezeAllPlans':sum(len(s['snapshot']['plans']) for s in eligible),'claimedProviderCalls':len(claims),'providerResults':len(results),
 'validChoices':sum(r.get('valid',False) for r in results),'knownCostUsd':sum(known),
 'unknownCostResults':len(results)-len(known),'claimsWithoutResult':links['claimsWithoutResult'],'reviewJournalIntegrity':links,
 'captureErrors':len(list(p.glob('error-*.json'))),'latestSnapshotAsOf':max((s['snapshot']['asOf'] for s in snapshots),default=None),
 'ordersPossible':False,'pnlEvaluated':False,'promotionEligible':False}
(p/'coverage-summary.json').write_text(json.dumps(r,indent=2)+'\n');print(json.dumps(r,indent=2))
