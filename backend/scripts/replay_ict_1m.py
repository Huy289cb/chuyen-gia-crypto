"""Per-candidate research replay, NOT portfolio ROI or live admission parity."""
import argparse,json,pathlib,hashlib,math
POLICY={'version':'ict-fill-diagnostic-v1','ttl_ms':3600000,'latency_ms':60000,'tick':.1,'quantity_btc':.001,'entry_fee_rate':.0005,'exit_fee_rate':.0005,'base_exit_slippage':.0005,'stress_exit_slippage':.001,'ambiguous_order':'no outcome assigned','entry_model':'strict penetration after latency; resting limit fill assumption','funding':'unknown unless explicitly supplied with full coverage','ai_cost':'zero: deterministic offline detector, no AI calls'}

def replay(c,bars,asof,funding=None):
    start=c['confirmedAt']+1;expiry=start+POLICY['ttl_ms'];eligible=start+POLICY['latency_ms']
    result={'id':c['id'],'quantity':POLICY['quantity_btc'],'state':'pending','fillAt':None,'exitAt':None,'netBaseUsd':None,'netStressUsd':None,'portfolioRoi':None}
    if c.get('target') is None:return {**result,'state':'missing_target'}
    end=min(asof,expiry)
    required=list(range(start,end-59999,60000))
    lookup={b['timestamp']:b for b in bars}
    if len(lookup)!=len(bars):raise ValueError('Duplicate 1m candle')
    if any(t not in lookup for t in required):return {**result,'state':'missing_data'}
    for b in bars:
        if not all(math.isfinite(b[k]) and b[k]>0 for k in ('open','high','low','close')) or not b['low']<=min(b['open'],b['close'])<=max(b['open'],b['close'])<=b['high']:raise ValueError('Invalid OHLC')
    side=1 if c['side']=='long' else -1;entry=c['entry'];stop=c['stopLoss'];target=c['target']['price'];qty=result['quantity']
    if not(side*(entry-stop)>0 and side*(target-entry)>0):return {**result,'state':'invalid_levels'}
    # Root cause of many ambiguous_entry_exit_same_minute: target within 1 tick of entry (RR≈0).
    # Classify as invalid geometry — do not invent a fill/exit order.
    if abs(target-entry)<=POLICY['tick']:
        return {**result,'state':'invalid_levels','reason':'target_within_tick'}
    filled=False
    for b in sorted(bars,key=lambda x:x['timestamp']):
        t=b['timestamp']
        if t<eligible or t+60000>asof:continue
        if not filled and t>=expiry:break
        sl=b['low']<=stop if side==1 else b['high']>=stop
        tp=b['high']>=target if side==1 else b['low']<=target
        newfill=False
        if not filled:
            # If opening beyond SL, placement is invalid; don't assume a favorable limit execution.
            if (b['open']<=stop if side==1 else b['open']>=stop):return {**result,'state':'invalidated_before_fill'}
            penetrate=b['low']<=entry-POLICY['tick'] if side==1 else b['high']>=entry+POLICY['tick']
            if not penetrate:continue
            if sl or tp:return {**result,'state':'ambiguous_entry_exit_same_minute','possibleFillAt':t}
            filled=True;newfill=True;result['fillAt']=t;result['state']='open_at_cutoff'
        if newfill:continue
        previous=t-60000
        if previous not in lookup:return {**result,'state':'missing_data_after_fill'}
        if sl and tp:return {**result,'state':'ambiguous_sl_tp_same_minute'}
        if sl or tp:
            exitprice=(min(stop,b['open']) if side==1 else max(stop,b['open'])) if sl else target
            result.update(state='closed_assumed_fill',exitAt=t,exitReason='sl' if sl else 'tp',exitPrice=exitprice)
            costs={}
            for name,slip in [('Base',POLICY['base_exit_slippage']),('Stress',POLICY['stress_exit_slippage'])]:
                px=exitprice*(1-side*slip);gross=side*(px-entry)*qty;commission=qty*(entry*POLICY['entry_fee_rate']+px*POLICY['exit_fee_rate'])
                costs[name]={'grossAfterSlippageUsd':gross,'commissionUsd':commission,'slippageUsd':abs(px-exitprice)*qty,'aiUsd':0,'fundingUsd':None}
                if funding is not None and funding['from']<=result['fillAt'] and funding['through']>=t+60000:
                    # Settlement within fill/exit minute has unresolved order; do not invent timing.
                    rows=[x for x in funding['rows'] if result['fillAt']<=x['timestamp']<t+60000]
                    if all(not(result['fillAt']<=x['timestamp']<result['fillAt']+60000 or t<=x['timestamp']<t+60000) for x in rows):
                        cash=sum(-side*qty*x['markPrice']*x['rate'] for x in rows)
                        costs[name]['fundingUsd']=cash;result['net'+name+'Usd']=gross-commission+cash
            result['costs']=costs;return result
    if filled and (not bars or max(b['timestamp'] for b in bars)+60000<asof):
        result['state']='missing_data_after_fill'
    if not filled:
        result['state']='expired_without_fill' if asof>=expiry else 'pending'
        result.update(netBaseUsd=0,netStressUsd=0,commissionUsd=0,fundingUsd=0,aiUsd=0)
    return result

if __name__=='__main__':
    ap=argparse.ArgumentParser();ap.add_argument('candidates',type=pathlib.Path);ap.add_argument('candles',type=pathlib.Path);ap.add_argument('out',type=pathlib.Path);a=ap.parse_args()
    cs=json.loads(a.candidates.read_text())['candidates'];data=json.loads(a.candles.read_text())
    result={'policy':POLICY,'results':[replay(c,data['windows'][c['id']],data['asOf']) for c in cs],'portfolioRoi':None,'limitations':['Fixed 0.001 BTC diagnostic; no wallet, filters, cooldown or baseline parity.','Penetration is a fill assumption, not proof of actual execution.','Unknown funding prevents reporting net outcome on filled trades.'],'hashes':{str(p):hashlib.sha256(p.read_bytes()).hexdigest() for p in [a.candidates,a.candles,pathlib.Path(__file__)]}}
    a.out.write_text(json.dumps(result,indent=2)+'\n');print(json.dumps(result['results']))
