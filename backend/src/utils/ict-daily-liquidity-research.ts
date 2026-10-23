/** Offline daily liquidity hypotheses; no environment or execution access. */
import type {IctBar,IctCandidate,IctSide} from './ict-research';
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

export type DailyVariant='daily_reclaim_mid'|'daily_reclaim_far'|'daily_mss_mid'|'daily_mss_far';
export const DAILY_VARIANTS:DailyVariant[]=['daily_reclaim_mid','daily_reclaim_far','daily_mss_mid','daily_mss_far'];
interface Day {high:number;low:number;count:number}
interface Sweep {side:IctSide;started:number;extreme:number;edge:number;opposite:number;mid:number;ref:number|null;reclaimed:number|null;done:boolean}
export function buildDailyLiquidityCandidates(context:Record<'15m'|'1h'|'4h',IctBar[]>,variant:DailyVariant):IctCandidate[]{
 const bars=context['15m'],step=900000,dayMs=86400000;
 validateBars(bars,step);validateBars(context['1h'],3600000);validateBars(context['4h'],14400000);
 const pivots=indexPivots(bars,step),targets=[...indexPivots(context['1h'],3600000).map(p=>({...p,tf:'1h'})),...indexPivots(context['4h'],14400000).map(p=>({...p,tf:'4h'}))];
 const days=new Map<number,Day>();
 // A complete prior UTC day only; future aggregates are never looked up.
 for(const b of bars){const key=Math.floor(b.timestamp/dayMs);const d=days.get(key)??{high:-Infinity,low:Infinity,count:0};d.high=Math.max(d.high,b.high);d.low=Math.min(d.low,b.low);d.count++;days.set(key,d);}
 const latest:Partial<Record<'high'|'low',Pivot>>={};let pointer=0,currentDay=-Infinity;
 let seen=new Set<IctSide>(),active:Sweep[]=[],dayHigh=-Infinity,dayLow=Infinity;const result:IctCandidate[]=[];
 const mss=variant.includes('_mss_');
 for(let i=15;i<bars.length;i++){
  const b=bars[i],day=Math.floor(b.timestamp/dayMs),knownAt=b.timestamp+step-1;
  while(pointer<pivots.length&&pivots[pointer].confirmedAt<b.timestamp){const p=pivots[pointer++];latest[p.kind]=p;}
  if(day!==currentDay){currentDay=day;seen=new Set();active=[];dayHigh=-Infinity;dayLow=Infinity;}
  dayHigh=Math.max(dayHigh,b.high);dayLow=Math.min(dayLow,b.low);
  const prior=days.get(day-1);if(!prior||prior.count!==96)continue;
  if(dayLow<=prior.low&&dayHigh>=prior.high){seen.add('long');seen.add('short');active=[];continue;}
  for(const side of ['long','short'] as const){
   if(seen.has(side)||!(side==='long'?b.low<prior.low:b.high>prior.high))continue;
   seen.add(side);active.push({side,started:i,extreme:side==='long'?b.low:b.high,edge:side==='long'?prior.low:prior.high,
    opposite:side==='long'?prior.high:prior.low,mid:(prior.high+prior.low)/2,ref:latest[side==='long'?'high':'low']?.price??null,reclaimed:null,done:false});
  }
  for(const a of active){
   if(a.done)continue;const d=a.side==='long'?1:-1;
   if(d===1?b.high>=a.opposite:b.low<=a.opposite){a.done=true;continue;}
   a.extreme=d===1?Math.min(a.extreme,b.low):Math.max(a.extreme,b.high);
   if(a.reclaimed===null){
    if(i-a.started>4){a.done=true;continue;}
    if(d*(b.close-a.edge)<=0)continue;
    a.reclaimed=i;
   }
   if(i-a.reclaimed>4){a.done=true;continue;}
   let entry=a.edge,confirmedAt=knownAt,fvg:number[]|undefined;
   if(mss){
    if(a.ref===null) {a.done=true;continue;}
    let atr=0;for(let k=i-14;k<i;k++)atr+=Math.max(bars[k].high-bars[k].low,Math.abs(bars[k].high-bars[k-1].close),Math.abs(bars[k].low-bars[k-1].close));atr/=14;
    if(!(d*(b.close-a.ref)>0&&d*(bars[i-1].close-a.ref)<=0&&d*(b.close-b.open)>=atr))continue;
    if(i+1>=bars.length)continue;
    const z=bars[i+1],prev=bars[i-1];
    const [low,high]=d===1?[prev.high,z.low]:[z.high,prev.low];
    if(low>=high|| (d===1?z.low<=a.extreme:z.high>=a.extreme)){a.done=true;continue;}
    if(d===1?z.high>=a.opposite:z.low<=a.opposite){a.done=true;continue;}
    entry=Math.round((low+high)*5)/10;confirmedAt=z.timestamp+step-1;fvg=[low,high];
   }
   a.done=true;
   const desired=variant.endsWith('_mid')?a.mid:a.opposite;
   if(d*(desired-entry)<=0)continue;
   // An already reached objective is not resurrected as unconsumed liquidity.
   const endIndex=mss?i+1:i;
   if(bars.slice(a.started,endIndex+1).some(c=>d===1?c.high>=desired:c.low<=desired))continue;
   const available=targets.filter(p=>p.kind===(d===1?'high':'low')&&p.confirmedAt<=confirmedAt&&p.touchedAt>confirmedAt&&d*(p.price-entry)>0&&d*(desired-p.price)>0);
   available.sort((x,y)=>d*(x.price-y.price));
   const target=available[0]??{price:desired,tf:'previous_utc_day',confirmedAt:day*dayMs-1};
   const raw=d===1?Math.min(a.extreme-.1,entry*.992):Math.max(a.extreme+.1,entry*1.008);
   const stopLoss=(d===1?Math.floor(raw*10):Math.ceil(raw*10))/10;
   result.push({id:`${variant}:${day}:${a.side}`,side:a.side,confirmedAt,entry,stopLoss,target:{price:Math.round(target.price*10)/10,tf:target.tf,confirmedAt:target.confirmedAt},
    rr:d*(Math.round(target.price*10)/10-entry)/Math.abs(entry-stopLoss),setup:variant,fvg,mssAt:mss?knownAt:undefined});
  }
 }
 return result.sort((a,b)=>a.confirmedAt-b.confirmedAt||a.id.localeCompare(b.id));
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
