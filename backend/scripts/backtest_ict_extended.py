"""Extend frozen ICT hypotheses to full historical windows, without tuning."""
import hashlib,json,pathlib
from backtest_ict_history import convert,fast_scan,scan,STEPS

ROOT=pathlib.Path(__file__).resolve().parents[2]
OUT=ROOT/'docs/audits/2026-09-20-ict-extended'

def main():
    protocol=json.loads((OUT/'protocol.json').read_text())
    lineage=json.loads((OUT/'lineage.json').read_text())
    for path,sha in lineage['parentSourcesVerified'].items():
        assert hashlib.sha256(pathlib.Path(path).read_bytes()).hexdigest()==sha,'Frozen source changed'
    for name,filename in protocol['datasets'].items():
        path=ROOT/filename;raw=path.read_bytes();manifest=json.loads(path.with_name(path.stem+'-manifest.json').read_text())
        assert hashlib.sha256(raw).hexdigest()==manifest['sha256']
        data=json.loads(raw);candles=convert(data)
        for tf,rows in candles.items():
            assert all(r['low']<=min(r['open'],r['close'])<=max(r['open'],r['close'])<=r['high'] and (not i or r['timestamp']-rows[i-1]['timestamp']==STEPS[tf]) for i,r in enumerate(rows))
        for n in [299,600,1000]:
            cutoff=candles['15m'][n-1]['closeTime']+1
            part={tf:[r for r in rows if r['closeTime']<cutoff] for tf,rows in candles.items()}
            assert sorted(scan({'candles':part,'asOf':cutoff})['candidates'],key=lambda c:c['id'])==sorted(fast_scan(part),key=lambda c:c['id'])
        print(name+' original-detector parity passed',flush=True)
        midpoint=fast_scan(candles);edge=fast_scan(candles,'edge')
        for n in [1500,5000,len(candles['15m'])-500]:
            cutoff=candles['15m'][n-1]['closeTime']+1
            part={tf:[r for r in rows if r['closeTime']<cutoff] for tf,rows in candles.items()}
            for rule,full in [('midpoint',midpoint),('edge',edge)]:
                assert fast_scan(part,rule)==[c for c in full if c['confirmedAt']<cutoff]
        result={'dataset':str(path),'datasetSha256':manifest['sha256'],'midpoint':midpoint,'edge':edge,'tests':{'originalParityPrefixes':3,'prefixInvariantChecks':6}}
        (OUT/f'{name}-candidates.json').write_text(json.dumps(result,indent=2)+'\n')
        print(json.dumps({'split':name,'midpoint':len(midpoint),'edge':len(edge),'tests':'passed'}),flush=True)

if __name__=='__main__':main()
