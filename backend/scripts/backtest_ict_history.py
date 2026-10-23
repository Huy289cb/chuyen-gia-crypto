"""Offline candidate generator; equivalent v1 geometry with indexed pivot lifetimes."""
import bisect, hashlib, json, math, pathlib, sys
from research_ict_fvg import pivots, scan

ROOT=pathlib.Path(__file__).resolve().parents[2]
OUT=ROOT/'docs/audits/2026-09-20-ict-backtest'
STEPS={'15m':900000,'1h':3600000,'4h':14400000}

def convert(data):
    return {tf:[dict(timestamp=b[0],open=b[1],high=b[2],low=b[3],close=b[4],volume=b[5],closeTime=b[0]+step-1) for b in data['byTf'][tf]] for tf,step in STEPS.items()}

def indexed(rows):
    touch={}
    for kind in ('high','low'):
        stack=[]; nxt=[math.inf]*len(rows)
        for i,b in enumerate(rows):
            while stack and (b[kind]>=rows[stack[-1]][kind] if kind=='high' else b[kind]<=rows[stack[-1]][kind]):
                nxt[stack.pop()]=b['timestamp']
            stack.append(i)
        touch[kind]=nxt
    return [{**p,'touchAt':touch[p['kind']][p['index']]} for p in pivots(rows)]

def fast_scan(candles,entry_rule='midpoint'):
    bars=candles['15m']; bytf={tf:indexed(rows) for tf,rows in candles.items()};ps=bytf['15m'];times=[p['confirmedAt'] for p in ps]
    candidates=[];pointer=0;active={'high':[],'low':[]};latest={}
    for i in range(len(bars)):
        b=bars[i]
        while pointer<len(ps) and ps[pointer]['confirmedAt']<b['timestamp']:
            p=ps[pointer];pointer+=1;latest[p['kind']]=p;active[p['kind']].append(p)
        for kind in active:active[kind]=[p for p in active[kind] if p['touchAt']>=b['timestamp']]
        if i<16:continue
        for side,kind,opposite in [('long','low','high'),('short','high','low')]:
            d=1 if side=='long' else -1
            levels=[p for p in active[kind] if (b['low']<p['price']<b['close'] if d==1 else b['high']>p['price']>b['close'])]
            if not levels:continue
            sweep=max(levels,key=lambda p:p['index'])
            if opposite not in latest:continue
            ref=latest[opposite]
            for j in range(i+1,min(i+5,len(bars))):
                c=bars[j]
                if (c['low']<b['low'] if d==1 else c['high']>b['high']):break
                atr=sum(max(bars[k]['high']-bars[k]['low'],abs(bars[k]['high']-bars[k-1]['close']),abs(bars[k]['low']-bars[k-1]['close'])) for k in range(j-14,j))/14
                if not(d*(c['close']-ref['price'])>0 and d*(bars[j-1]['close']-ref['price'])<=0 and d*(c['close']-c['open'])>=atr):continue
                if j+1>=len(bars):break
                a,z=bars[j-1],bars[j+1];lo,hi=(a['high'],z['low']) if d==1 else (z['high'],a['low'])
                if lo>=hi:break
                if (z['low']<b['low'] if d==1 else z['high']>b['high']):break
                entry=round((lo+hi)/2 if entry_rule=='midpoint' else (hi if d==1 else lo),1)
                rawstop=min(b['low']-.1,entry*(1-.008)) if d==1 else max(b['high']+.1,entry*(1+.008))
                stop=(math.floor(rawstop*10) if d==1 else math.ceil(rawstop*10))/10;born=z['closeTime'];targets=[]
                for tf,allps in bytf.items():
                    for p in allps:
                        if p['confirmedAt']>born:break
                        if p['kind']==opposite and d*(p['price']-entry)>0 and p['touchAt']+STEPS[tf]-1>born:
                            targets.append({'tf':tf,**{k:v for k,v in p.items() if k!='touchAt'}})
                target=min(targets,key=lambda p:d*(p['price']-entry)) if targets else None
                candidates.append({'id':f"{b['timestamp']}:{side}",'side':side,'sweepAt':b['closeTime'],'sweptLevel':sweep['price'],'mssLevel':ref['price'],'mssAt':c['closeTime'],'confirmedAt':born,'fvg':[lo,hi],'entry':entry,'stopLoss':stop,'target':target,'rr':d*(target['price']-entry)/abs(entry-stop) if target else None,'status':'geometry_candidate' if target else 'missing_target','probability':None,'roi':None})
                break
    return sorted(candidates,key=lambda c:(c['confirmedAt'],c['id']))

def main():
    OUT.mkdir(parents=True,exist_ok=True)
    paths={'train':ROOT/'docs/audits/2026-09-11-opportunity-testbed/train-data.json','validation':ROOT/'docs/audits/2026-09-11-opportunity-testbed/validation/validation-data.json'}
    for name,path in paths.items():
        raw=path.read_bytes();data=json.loads(raw);manifest=json.loads(path.with_name(path.stem+'-manifest.json').read_text())
        assert hashlib.sha256(raw).hexdigest()==manifest['sha256']
        candles=convert(data)
        for tf,rows in candles.items():
            assert all(r['low']<=min(r['open'],r['close'])<=max(r['open'],r['close'])<=r['high'] and (not i or r['timestamp']-rows[i-1]['timestamp']==STEPS[tf]) for i,r in enumerate(rows))
        # Compare accelerated implementation against unchanged original on three prefixes.
        for n in [299,600,1000]:
            asof=candles['15m'][n-1]['closeTime']+1;part={tf:[r for r in rows if r['closeTime']<asof] for tf,rows in candles.items()}
            expected=scan({'candles':part,'asOf':asof})['candidates'];actual=fast_scan(part)
            assert sorted(expected,key=lambda c:c['id'])==sorted(actual,key=lambda c:c['id']),f'parity {name} {n}'
        print(name+' original parity passed',flush=True)
        midpoint=fast_scan(candles);edge=fast_scan(candles,'edge')
        # Prefix invariance includes positions near sample boundaries and both entry hypotheses.
        for n in [1500,5000,len(candles['15m'])-500]:
            asof=candles['15m'][n-1]['closeTime']+1;part={tf:[r for r in rows if r['closeTime']<asof] for tf,rows in candles.items()}
            for rule,full in [('midpoint',midpoint),('edge',edge)]:
                assert fast_scan(part,rule)==[c for c in full if c['confirmedAt']<asof],f'prefix {name} {rule} {n}'
        result={'dataset':str(path),'datasetSha256':manifest['sha256'],'midpoint':midpoint,'edge':edge,'tests':{'originalParityPrefixes':3,'prefixInvariantChecks':6}}
        (OUT/f'{name}-candidates.json').write_text(json.dumps(result,indent=2)+'\n')
        print(json.dumps({'split':name,'midpoint':len(midpoint),'edge':len(edge),'parity':'passed'}),flush=True)

if __name__=='__main__':main()
