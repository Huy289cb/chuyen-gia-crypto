"""Offline geometry discovery only; no order, AI, network or database access."""
import argparse, hashlib, json, pathlib
POLICY={'version':'ict-sweep-mss-fvg-v1','pivot_strength':2,'atr_period':14,'mss_window':4,'entry_ttl':4,'min_sl_fraction':.008,'tick':.1,'min_rr':None,'target':'nearest unswept confirmed M15/H1/H4 pivot','fill':'not modeled','roi':'not measured'}

def pivots(bars):
    result=[]
    for i in range(2,len(bars)-2):
        for kind in ('high','low'):
            price=bars[i][kind]
            if all((price>b[kind] if kind=='high' else price<b[kind]) for j,b in enumerate(bars[i-2:i+3]) if j!=2):
                result.append({'index':i,'kind':kind,'price':price,'confirmedAt':bars[i+2]['closeTime']})
    return result

def unswept(bars,p,end):
    return all(b['high']<p['price'] if p['kind']=='high' else b['low']>p['price'] for b in bars[p['index']+1:end])

def scan(data):
    bars=data['candles']['15m']; cutoff=data['asOf']; bars=[b for b in bars if b['closeTime']<cutoff]
    for tf,rows in data['candles'].items():
        step={'15m':900000,'1h':3600000,'4h':14400000}[tf]
        for i,b in enumerate(rows):
            assert b['low']<=min(b['open'],b['close'])<=max(b['open'],b['close'])<=b['high']
            assert not i or b['timestamp']-rows[i-1]['timestamp']==step,'Gapped data'
    ps=pivots(bars); candidates=[]; sweeps=0; mss_count=0
    for i in range(16,len(bars)):
        b=bars[i];known=[p for p in ps if p['confirmedAt']<b['timestamp']]
        for side,kind,opposite in [('long','low','high'),('short','high','low')]:
            d=1 if side=='long' else -1
            levels=[p for p in known if p['kind']==kind and unswept(bars,p,i) and (b['low']<p['price']<b['close'] if d==1 else b['high']>p['price']>b['close'])]
            if not levels:continue
            sweep=max(levels,key=lambda p:p['index']);sweeps+=1
            refs=[p for p in known if p['kind']==opposite]
            if not refs:continue
            ref=refs[-1]
            for j in range(i+1,min(i+5,len(bars))):
                c=bars[j]
                if (c['low']<b['low'] if d==1 else c['high']>b['high']):break
                atr=sum(max(bars[k]['high']-bars[k]['low'],abs(bars[k]['high']-bars[k-1]['close']),abs(bars[k]['low']-bars[k-1]['close'])) for k in range(j-14,j))/14
                if not (d*(c['close']-ref['price'])>0 and d*(bars[j-1]['close']-ref['price'])<=0 and d*(c['close']-c['open'])>=atr):continue
                mss_count+=1
                if j+1>=len(bars):break
                a,z=bars[j-1],bars[j+1]
                lo,hi=(a['high'],z['low']) if d==1 else (z['high'],a['low'])
                if lo>=hi:break
                if (z['low']<b['low'] if d==1 else z['high']>b['high']):break
                entry=round((lo+hi)/2,1);rawstop=min(b['low']-.1,entry*(1-.008)) if d==1 else max(b['high']+.1,entry*(1+.008))
                import math
                stop=(math.floor(rawstop*10) if d==1 else math.ceil(rawstop*10))/10
                born=z['closeTime'];targets=[]
                for tf,allrows in data['candles'].items():
                    rows=[x for x in allrows if x['closeTime']<=born]
                    for p in pivots(rows):
                        if p['kind']==opposite and d*(p['price']-entry)>0 and unswept(rows,p,len(rows)):
                            targets.append({'tf':tf,**p})
                target=min(targets,key=lambda p:d*(p['price']-entry)) if targets else None
                # Freeze the plan at confirmation. Touch observations are separate, never claimed as fills.
                candidates.append({'id':f"{b['timestamp']}:{side}",'side':side,'sweepAt':b['closeTime'],'sweptLevel':sweep['price'],'mssLevel':ref['price'],'mssAt':c['closeTime'],'confirmedAt':born,'fvg':[lo,hi],'entry':entry,'stopLoss':stop,'target':target,'rr':d*(target['price']-entry)/abs(entry-stop) if target else None,'status':'geometry_candidate' if target else 'missing_target','probability':None,'roi':None})
                break
    return {'policy':POLICY,'asOf':cutoff,'bars':len(bars),'sweeps':sweeps,'mss':mss_count,'candidates':candidates,'limitations':['Exploratory, not holdout; no portfolio or fill replay.','No claim of ROI, win rate or live admission.','H4/H1 target context only; directional HTF gate not implemented.','OB, EQH/EQL clusters, volume profile and OTE are not detectors in this version.']}

def observe_touches(result,data):
    rows=data['candles']['15m'];out=[]
    for c in result['candidates']:
        later=[b for b in rows if c['confirmedAt']<b['timestamp'] and b['closeTime']<data['asOf']][:4]
        state='expired_without_touch' if len(later)==4 else 'pending_observation'
        for b in later:
            invalid=b['low']<=c['stopLoss'] if c['side']=='long' else b['high']>=c['stopLoss']
            touch=b['low']<=c['entry']<=b['high']
            if invalid:state='ambiguous_touch_invalidation' if touch else 'invalidated_before_touch';break
            if touch:state='touched_not_proven_filled';break
        out.append({'id':c['id'],'state':state})
    return out

if __name__=='__main__':
    ap=argparse.ArgumentParser();ap.add_argument('input',type=pathlib.Path);ap.add_argument('output',type=pathlib.Path);a=ap.parse_args()
    raw=a.input.read_bytes();data=json.loads(raw);result=scan(data);result['touchObservations']=observe_touches(result,data)
    result['inputSha256']=hashlib.sha256(raw).hexdigest();result['codeSha256']=hashlib.sha256(pathlib.Path(__file__).read_bytes()).hexdigest()
    result['policySha256']=hashlib.sha256(json.dumps(POLICY,sort_keys=True).encode()).hexdigest()
    a.output.write_text(json.dumps(result,indent=2)+'\n');print(json.dumps({k:v for k,v in result.items() if k not in ['candidates','touchObservations','limitations','policy']}));print(json.dumps(result['candidates']))
