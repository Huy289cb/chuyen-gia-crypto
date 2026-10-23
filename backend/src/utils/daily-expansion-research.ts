import {buildIctH1Structure,ictStructurePermits,type IctStructurePoint,type IctBar,type IctCandidate} from './ict-research';
/** Scaling timestamps maps H4 to the existing causal H1 state machine exactly. */
export function expansionH4Structure(rows:IctBar[]):IctStructurePoint[]{
 validateBars(rows,14400000);
 return buildIctH1Structure(rows.map(b=>({...b,timestamp:b.timestamp/4})));
}
export function expansionH4Permits(points:IctStructurePoint[],side:'long'|'short',from:number,through:number):boolean{
 // Closed-bar timestamps are end-exclusive minus one millisecond in both clocks.
 return ictStructurePermits(points,side,Math.floor((from+1)/4)-1,Math.floor((through+1)/4)-1);
}
export function buildDailyExpansionCandidates(context:Record<'1h'|'4h',IctBar[]>,requireH4:boolean):IctCandidate[]{
 const bars=context['1h'],step=3600000,dayMs=86400000;validateBars(bars,step);
 const h4=expansionH4Structure(context['4h']),pivots=indexPivots(context['4h'],14400000);
 const days=new Map<number,{high:number;low:number;count:number}>();
 for(const b of bars){const key=Math.floor(b.timestamp/dayMs),d=days.get(key)??{high:-Infinity,low:Infinity,count:0};d.high=Math.max(d.high,b.high);d.low=Math.min(d.low,b.low);d.count++;days.set(key,d);}
 const used=new Set<string>(),result:IctCandidate[]=[];
 for(let i=15;i<bars.length;i++){
  const b=bars[i],day=Math.floor(b.timestamp/dayMs),previous=days.get(day-1);if(!previous||previous.count!==24)continue;
  let atr=0;for(let k=i-14;k<i;k++)atr+=Math.max(bars[k].high-bars[k].low,Math.abs(bars[k].high-bars[k-1].close),Math.abs(bars[k].low-bars[k-1].close));atr/=14;
  for(const side of ['long','short'] as const){
   const d=side==='long'?1:-1,entry=d===1?previous.high:previous.low,key=`${day}:${side}`;
   if(used.has(key)||!(d*(b.close-entry)>0&&d*(bars[i-1].close-entry)<=0))continue;
   used.add(key);const confirmedAt=b.timestamp+step-1;
   if(d*(b.close-b.open)<atr*.5||(requireH4&&!expansionH4Permits(h4,side,confirmedAt,confirmedAt)))continue;
   const desired=entry+d*(previous.high-previous.low);
   if(d===1?b.high>=desired:b.low<=desired)continue;
   const available=pivots.filter(p=>p.confirmedAt<=confirmedAt&&p.touchedAt>confirmedAt&&p.kind===(d===1?'high':'low')&&d*(p.price-entry)>0&&d*(desired-p.price)>0);
   available.sort((a,b)=>d*(a.price-b.price));const target=available[0]??{price:desired,confirmedAt:day*dayMs-1};
   const raw=d===1?Math.min(b.low-.1,entry*.992):Math.max(b.high+.1,entry*1.008),stopLoss=(d===1?Math.floor(raw*10):Math.ceil(raw*10))/10;
   const netReward=d*(target.price-entry)-(entry+target.price)*.0005-entry*.002;
   const effectiveRisk=Math.abs(entry-stopLoss)+(entry+stopLoss)*.0005+entry*.002;
   if(netReward<effectiveRisk)continue;
   result.push({id:`${requireH4?'expansion_h4':'expansion'}:${key}`,setup:requireH4?'expansion_h4':'expansion',side,confirmedAt,entry,stopLoss,
    target:{price:target.price,tf:available.length?'4h':'prior_day_range_projection',confirmedAt:target.confirmedAt},rr:d*(target.price-entry)/Math.abs(entry-stopLoss)});
  }
 }
 return result.sort((a,b)=>a.confirmedAt-b.confirmedAt||a.id.localeCompare(b.id));
}
function validateBars(rows: IctBar[], step: number): void {
  for (let i = 0; i < rows.length; i++) {
    const b = rows[i];
    if (!Number.isInteger(b.timestamp) || b.timestamp % step !== 0 ||
        ![b.open,b.high,b.low,b.close].every(x => Number.isFinite(x) && x > 0) ||
        !Number.isFinite(b.volume) || b.volume < 0 || b.low > Math.min(b.open,b.close) ||
        b.high < Math.max(b.open,b.close) || (i > 0 && b.timestamp - rows[i-1].timestamp !== step)) {
      throw new Error('invalid_ict_candle_series');
    }
  }
}

interface Pivot { index: number; kind: 'high' | 'low'; price: number; confirmedAt: number; touchedAt: number }
function indexPivots(rows: IctBar[], step: number): Pivot[] {
  const next = {high: new Array<number>(rows.length).fill(Infinity), low: new Array<number>(rows.length).fill(Infinity)};
  for (const kind of ['high','low'] as const) {
    const stack: number[] = [];
    for (let i = 0; i < rows.length; i++) {
      while (stack.length && (kind === 'high' ? rows[i].high >= rows[stack.at(-1)!].high : rows[i].low <= rows[stack.at(-1)!].low)) {
        // Only a CLOSED higher-timeframe candle may consume a target.
        next[kind][stack.pop()!] = rows[i].timestamp + step - 1;
      }
      stack.push(i);
    }
  }
  const pivots: Pivot[] = [];
  for (let i = 2; i < rows.length - 2; i++) for (const kind of ['high','low'] as const) {
    if (rows.slice(i-2,i+3).every((b,j) => j === 2 || (kind === 'high' ? rows[i].high > b.high : rows[i].low < b.low))) {
      pivots.push({index:i,kind,price:rows[i][kind],confirmedAt:rows[i+2].timestamp+step-1,touchedAt:next[kind][i]});
    }
  }
  return pivots;
}
