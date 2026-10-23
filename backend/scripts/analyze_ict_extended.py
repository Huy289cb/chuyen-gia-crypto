"""Audit chronological results and attribute constraints without changing strategy."""
import collections,datetime,hashlib,json,math,pathlib,random,statistics
ROOT=pathlib.Path(__file__).resolve().parents[2]
OUT=ROOT/'docs/audits/2026-09-20-ict-extended'

def date(ms):return datetime.datetime.fromtimestamp(ms/1000,datetime.timezone.utc)

def main():
    summary=json.loads((OUT/'summary.json').read_text());protocol=summary['protocol'];wallet=protocol['wallet']
    diagnostics={};checks=collections.Counter();cohorts=[];windows=[];fixed_fill_cost=[]
    for path,sha in summary['sourceHashes'].items():
        p=pathlib.Path(path) if path.startswith('/') else ROOT/'backend'/path
        assert hashlib.sha256(p.read_bytes()).hexdigest()==sha
    for split,(start,end) in protocol['splits'].items():
        start=int(datetime.datetime.fromisoformat(start).replace(tzinfo=datetime.timezone.utc).timestamp()*1000)
        end=int(datetime.datetime.fromisoformat(end).replace(tzinfo=datetime.timezone.utc).timestamp()*1000)
        candidate_file=json.loads((OUT/f'{split}-candidates.json').read_text())
        raw=pathlib.Path(candidate_file['dataset']).read_bytes();assert hashlib.sha256(raw).hexdigest()==candidate_file['datasetSha256']
        data=json.loads(raw);funding=data['funding'];bars=data['byTf']['1m']
        assert bars[0][0]<start and bars[-1][0]+60000==end
        assert all(all(math.isfinite(v) for v in b[:6]) and (not i or b[0]-bars[i-1][0]==60000) for i,b in enumerate(bars))
        assert all(math.isfinite(f['rate']) and math.isfinite(f['markPrice']) and f['markPrice']>0 and (not i or f['time']>funding[i-1]['time']) for i,f in enumerate(funding))
        diagnostics[split]={'minuteRows':len(bars),'fundingRows':len(funding),'maxFundingGapHours':max((b['time']-a['time'])/3600000 for a,b in zip(funding,funding[1:])),'variants':{}}
        del raw,data,bars
        for variant in protocol['variants']:
            cs=[c for c in candidate_file['edge' if variant.startswith('edge') else 'midpoint'] if start<=c['confirmedAt']+1<end]
            lookup={c['id']:c for c in cs};assert len(lookup)==len(cs)
            counter=collections.Counter();qty_hist=collections.Counter();rrs=[]
            for c in cs:
                if not c['target'] or abs(c['target']['price']-c['entry'])<=.1:counter['missing_or_tick_target']+=1;continue
                entry=c['entry'];distance=abs(entry-c['stopLoss']);rrs.append(c['rr'])
                desired=min(100,wallet*.005/(distance/entry))
                quantity=max(.001,math.ceil(50/entry/.001-1e-9)*.001,math.floor(desired/entry/.001+1e-9)*.001)
                qty_hist[f'{quantity:.3f}']+=1
                risk=quantity*(distance+entry*.003)
                reasons=[]
                if risk>wallet*.03+1e-9:reasons.append('risk_3pct')
                if entry*quantity>100+1e-9:reasons.append('exposure_100')
                if variant=='midpoint_rr3' and c['rr']<3-1e-9:reasons.append('rr3')
                for reason in reasons:counter[reason]+=1
                if not reasons:counter['static_geometry_and_budget_eligible']+=1
                gross=abs(c['target']['price']-entry)*quantity
                fees=(entry+c['target']['price'])*quantity*.0005
                if gross-fees-entry*quantity*.002<=0:counter['tp_net_nonpositive_before_funding_stress']+=1
            diagnostics[split]['variants'][variant]={'candidates':len(cs),'isolatedStartingWalletCounts':dict(counter),'quantityDistribution':dict(qty_hist),'medianGrossRr':statistics.median(rrs) if rrs else None,'note':'Overlapping static reasons, not live chronological admission; no funding or circuit veto here.'}
            for cost in ['base','stress']:
                result=json.loads((OUT/f'{split}-{variant}-{cost}.json').read_text());s=result['summary'];closed=result['closes']
                submitted={e['plan']['id']:e for e in result['events'] if e['type']=='submitted'}
                filled={e['id']:e for e in result['events'] if e['type']=='fill'}
                for key,e in filled.items():
                    assert e['time']>=lookup[key]['confirmedAt']+60001
                    assert e['time']<submitted[key]['plan']['expiresAt']
                    assert abs(e['quantity']/.001-round(e['quantity']/.001))<1e-7
                    checks['fillCausality']+=1
                assert len(closed)==s['trades']
                if not s['open']:assert abs(sum(c['netUsd'] for c in closed)-s['netCashUsd'])<1e-7
                for c in closed:assert c['time']>=filled[c['planId']]['time'];checks['closeCausality']+=1
                checks['scenarios']+=1
                if cost=='base':
                    fixed_fill_cost.append({'split':split,'variant':variant,'baseClosedTrades':len(closed),
                        'baseNetUsd':sum(c['netUsd'] for c in closed),
                        'fixedBaseFillsStressNetUsd':sum(c['netUsd']-c['slippageUsd'] for c in closed),
                        'note':'Double charged slippage on identical base fills/exits; same fees/funding. Cost diagnostic only, not executable stress portfolio; guards are not replayed on altered wallet.'})
                monthly={};weekly=collections.defaultdict(list)
                for c in closed:
                    key=date(c['time']).strftime('%Y-%m');row=monthly.setdefault(key,{'trades':0,'wins':0,'netUsd':0})
                    row['trades']+=1;row['wins']+=c['netUsd']>0;row['netUsd']+=c['netUsd']
                    weekly[date(c['time']).strftime('%G-W%V')].append(c['netUsd'])
                interval=None
                if len(weekly)>=2:
                    rng=random.Random(20260920);clusters=list(weekly.values());means=[]
                    for _ in range(5000):
                        sample=[v for block in rng.choices(clusters,k=len(clusters)) for v in block];means.append(sum(sample)/len(sample))
                    means.sort();interval=[means[125],means[4874]]
                windows.append({'split':split,'variant':variant,'cost':cost,'activeCloseWeeks':len(weekly),'exploratoryWeeklyClusterMeanNet95CI':interval,'monthly':monthly,'caution':'Descriptive conditional-on-executed-trades bootstrap; small clusters, selection and circuit censoring prevent a promotion claim.'})
        for cost in ['base','stress']:
            runs={v:json.loads((OUT/f'{split}-{v}-{cost}.json').read_text()) for v in protocol['variants']}
            for comparator in ['midpoint_rr3','midpoint_structural_target']:
                a={c['planId']:c for c in runs[comparator]['closes']};b={c['planId']:c for c in runs['edge_structural_target']['closes']}
                added=b.keys()-a.keys();removed=a.keys()-b.keys();shared=a.keys()&b.keys()
                cohorts.append({'split':split,'cost':cost,'comparator':comparator,'candidate':'edge_structural_target','added':len(added),'removed':len(removed),'shared':len(shared),
                  'addedNetUsd':sum(b[k]['netUsd'] for k in added),'removedComparatorNetUsd':sum(a[k]['netUsd'] for k in removed),
                  'sharedDeltaNetUsd':sum(b[k]['netUsd']-a[k]['netUsd'] for k in shared),
                  'netCashDeltaUsd':runs['edge_structural_target']['summary']['netCashUsd']-runs[comparator]['summary']['netCashUsd'],
                  'note':'Accounting attribution across same-window paths, not causal isolated trade effects; funding, wallet and cooldown compete.'})
    (OUT/'analysis.json').write_text(json.dumps({'checks':dict(checks),'diagnostics':diagnostics,'windows':windows,'cohorts':cohorts,'fixedFillCostDiagnostics':fixed_fill_cost},indent=2)+'\n')
    print(json.dumps({'checks':dict(checks),'cohorts':cohorts},indent=2))

if __name__=='__main__':main()
