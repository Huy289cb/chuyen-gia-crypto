#!/usr/bin/env python3
"""Normalize verified TRAIN archives, fail on gaps/duplicates, aggregate closed bars."""
import csv, io, json, pathlib, zipfile, hashlib, math, sys
ROOT=pathlib.Path(__file__).resolve().parents[2]
VALIDATION=sys.argv[1:]==['--validation']
INDEPENDENT = sys.argv[1:] == ['--independent-2023']
SUPPLEMENTAL = sys.argv[1:] == ['--supplemental-2024']
if sys.argv[1:] and not (VALIDATION or SUPPLEMENTAL or INDEPENDENT): raise ValueError('unknown split')
SPLIT='independent-2023' if INDEPENDENT else 'supplemental-2024' if SUPPLEMENTAL else 'validation' if VALIDATION else 'train'
OUT=ROOT/'docs/audits/2026-09-11-opportunity-testbed'
if VALIDATION or SUPPLEMENTAL or INDEPENDENT:
    OUT=OUT/SPLIT
    if not (OUT/'freeze.json').exists(): raise ValueError('candidate not frozen')

def rows(kind):
    manifest=json.loads((OUT/(SPLIT+'-download-manifest.json')).read_text())
    for key,item in sorted(manifest.items()):
        if not key.startswith(kind+'/'): continue
        data=(ROOT/item['file']).read_bytes()
        if hashlib.sha256(data).hexdigest()!=item['sha256']: raise ValueError('changed archive')
        with zipfile.ZipFile(io.BytesIO(data)) as z:
            with z.open(z.namelist()[0]) as f:
                yield from csv.DictReader(io.TextIOWrapper(f))

def main():
    minutes=[]
    for r in rows('klines'):
        b=[int(r['open_time'])]+[float(r[k]) for k in ['open','high','low','close','volume']]
        if b[0]%60000 or (minutes and b[0]-minutes[-1][0]!=60000): raise ValueError('candle gap or duplicate')
        if not all(math.isfinite(v) for v in b) or min(b[1:5])<=0 or b[3]>min(b[1],b[4]) or b[2]<max(b[1],b[4]): raise ValueError('invalid candle')
        minutes.append(b)
    mark={}
    def add_mark(r):
        t=int(r['open_time']); price=float(r['open'])
        if t in mark or t%60000 or not math.isfinite(price) or price<=0: raise ValueError('invalid or duplicate mark')
        mark[t]=price
    for r in rows('markPriceKlines'): add_mark(r)
    if INDEPENDENT:
        repair=OUT/'mark-repair-manifest.json'
        if repair.exists():
            info=json.loads(repair.read_text()); raw=(OUT/'mark-repair-2023-02-24.zip').read_bytes()
            if hashlib.sha256(raw).hexdigest()!=info['sha256']: raise ValueError('changed mark repair')
            with zipfile.ZipFile(io.BytesIO(raw)) as z:
                for r in csv.DictReader(io.TextIOWrapper(z.open(z.namelist()[0]))): add_mark(r)
    if set(mark)!=set(b[0] for b in minutes): raise ValueError('mark coverage mismatch')
    funding=[]
    for r in rows('fundingRate'):
        t=int(r['calc_time']); price=mark.get(t//60000*60000)
        if price is None: raise ValueError('missing funding mark price')
        rate=float(r['last_funding_rate'])
        if not math.isfinite(rate) or (funding and t<=funding[-1]['time']): raise ValueError('invalid funding')
        funding.append({'time':t,'rate':rate,'markPrice':price})
    by_tf={'1m':minutes}
    for tf,n in [('5m',5),('15m',15),('1h',60),('4h',240)]:
        agg=[]
        for i in range(0,len(minutes),n):
            group=minutes[i:i+n]
            if len(group)!=n or group[0][0]%(n*60000): raise ValueError('partial aggregate')
            agg.append([group[0][0],group[0][1],max(b[2] for b in group),min(b[3] for b in group),group[-1][4],sum(b[5] for b in group)])
        by_tf[tf]=agg
    dataset={'byTf':by_tf,'funding':funding,'fundingMarkApproximation':'1m mark open containing actual settlement timestamp'}
    p=OUT/(SPLIT+'-data.json');p.write_text(json.dumps(dataset,separators=(',',':')))
    summary={'sha256':hashlib.sha256(p.read_bytes()).hexdigest(),'rows':{tf:len(v) for tf,v in by_tf.items()},'funding_rows':len(funding),'start':minutes[0][0],'end_exclusive':minutes[-1][0]+60000,'split':SPLIT,'reserved_test_accessed':False,'validation_accessed':VALIDATION}
    (OUT/(SPLIT+'-data-manifest.json')).write_text(json.dumps(summary,indent=2)+'\n'); print(json.dumps(summary))
if __name__=='__main__': main()
