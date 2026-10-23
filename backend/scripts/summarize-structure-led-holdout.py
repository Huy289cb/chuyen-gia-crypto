#!/usr/bin/env python3
"""All outcomes and paired weekly resampling, no strategy selection/retuning."""
import pathlib,json,random,datetime
ROOT=pathlib.Path('../docs/audits/2026-09-22-structure-led-m5/holdout-2022')
def ms(s):return int(datetime.datetime.fromisoformat(s).replace(tzinfo=datetime.timezone.utc).timestamp()*1000)
def quantile(xs,p):return sorted(xs)[int((len(xs)-1)*p)] if xs else None
def main():
 summary=json.loads((ROOT/'summary.json').read_text());p=summary['protocol'];stats=[]
 for variant in ['structure_led_m5','structure_led_m5_bounded']:
  for cost in ['base','stress']:
   windows=[];actual_n=0;actual_net=0;actual_delta=0
   for split,(start,end) in p['splits'].items():
    bucket=lambda t:int((t+3*86400000)//(7*86400000))
    keys=sorted(set(bucket(t) for t in range(ms(start),ms(end),86400000)));weeks={k:[0.,0.,0] for k in keys}
    a=json.loads((ROOT/f'{split}-current_core-{cost}.json').read_text())['closes'];b=json.loads((ROOT/f'{split}-{variant}-{cost}.json').read_text())['closes']
    for c in a:weeks.setdefault(bucket(c['time']),[0.,0.,0])[1]+=c['netUsd']
    for c in b:
     w=weeks.setdefault(bucket(c['time']),[0.,0.,0]);w[0]+=c['netUsd'];w[2]+=1
    windows.append(list(weeks.values()));actual_n+=len(b);actual_net+=sum(c['netUsd'] for c in b);actual_delta+=sum(c['netUsd'] for c in b)-sum(c['netUsd'] for c in a)
   rng=random.Random(20220922);pnls=[];deltas=[];expectancies=[]
   for _ in range(2000):
    pnl=base=n=0
    for weeks in windows:
     for _ in weeks:
      c,b,k=rng.choice(weeks);pnl+=c;base+=b;n+=k
    pnls.append(pnl);deltas.append(pnl-base)
    if n:expectancies.append(pnl/n)
   stats.append({'variant':variant,'cost':cost,'trades':actual_n,'netCashSumUsd':actual_net,'deltaCashSumUsd':actual_delta,
    'weeklyBootstrap95Net':[quantile(pnls,.025),quantile(pnls,.975)],'weeklyBootstrap95Delta':[quantile(deltas,.025),quantile(deltas,.975)],
    'weeklyBootstrap95Expectancy':[quantile(expectancies,.025),quantile(expectancies,.975)],'zeroTradeBootstrapReplicates':2000-len(expectancies)})
 (ROOT/'uncertainty.json').write_text(json.dumps({'method':'Exploratory paired calendar-week bootstrap within each separate window;2000 resamples,seed20220922; approximate intervals, not guaranteed coverage or future-profit probability. Windows reset wallet. Earlier historical holdout, not chronological forward test.','results':stats},indent=2))
 for r in summary['summaries']:print(r['split'],r['variant'],r['cost'],r['trades'],round(r['roiPercent'],3))
 print(json.dumps(stats,indent=2))
if __name__=='__main__':main()
