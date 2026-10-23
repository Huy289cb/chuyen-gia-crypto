"""Research screen only: idealized next-hour reversal, not account ROI or executable plans."""
import json,math,statistics,random,hashlib
from pathlib import Path

def signal_indices(bars, lookback=72, threshold=2):
    if lookback<2 or threshold<=0: raise ValueError('invalid_screen')
    returns=[]; signals=[]
    for i,b in enumerate(bars):
        if len(b)<5 or not all(math.isfinite(x) for x in b[:5]) or min(b[1:5])<=0:
            raise ValueError('invalid_bar')
        if b[3]>min(b[1],b[4]) or b[2]<max(b[1],b[4]): raise ValueError('invalid_ohlc')
        if i and b[0]-bars[i-1][0]!=3600000: raise ValueError('hour_gap')
        if not i:continue
        change=b[4]/bars[i-1][4]-1
        if len(returns)>=lookback:
            sigma=statistics.pstdev(returns[-lookback:])
            if sigma>0 and abs(change)>=threshold*sigma:
                signals.append((i,-1 if change>0 else 1,sigma))
        returns.append(change)
    return signals

def main():
    root=Path(__file__).resolve().parents[2]/'docs/audits/2026-09-11-opportunity-testbed'
    raw=(root/'train-data.json').read_bytes();data=json.loads(raw)
    assert hashlib.sha256(raw).hexdigest()==json.loads((root/'train-data-manifest.json').read_text())['sha256']
    bars=data['byTf']['1h']; signals=signal_indices(bars);rows=[]
    for i,side,sigma in signals:
        if i+1>=len(bars):continue
        b=bars[i+1];entry,exit=b[1],b[4]
        gross=side*(exit/entry-1);fees=(1+exit/entry)*.0005
        rows.append({'signalTime':bars[i][0]+3600000,'side':side,'priorSigma':sigma,'grossBps':gross*10000,
                     'baseNetBps':(gross-fees-.001)*10000,'stressNetBps':(gross-fees-.002)*10000})
    summaries={}
    for key in ['grossBps','baseNetBps','stressNetBps']:
        values=[x[key] for x in rows];weeks={}
        for x in rows:
            w=int((x['signalTime']+25200000)//604800000);weeks.setdefault(w,[]).append(x[key])
        rng=random.Random(20260913);blocks=list(weeks.values());boot=[]
        for _ in range(10000):
            sample=[v for _ in blocks for v in rng.choice(blocks)] if blocks else []
            if sample:boot.append(statistics.mean(sample))
        boot.sort()
        summaries[key]={'n':len(values),'meanBps':statistics.mean(values) if values else None,
                        'medianBps':statistics.median(values) if values else None,
                        'descriptiveWeekResampleLower5PercentBps':boot[len(boot)//20] if boot else None}
    report={'source':'https://ledgerjournal.org/ojs/ledger/article/view/213','scope':'TRAIN screening inspired by abstract, not replication; chosen72h prior volatility and2sigma threshold. Ideal next-bar-open entry/next-hour-close exit, no latency, funding, SL/TP, lot constraints or account circuits. Per-notional returns, NOT portfolio ROI or promotion evidence.',
            'summaries':summaries,'rows':rows,'promotionEligible':False}
    (root/'trial-013-screen.json').write_text(json.dumps(report,indent=2)+'\n');print(json.dumps(summaries,indent=2))
if __name__=='__main__':main()
