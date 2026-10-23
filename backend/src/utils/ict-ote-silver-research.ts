/** New offline hypotheses; prior frozen research module remains unchanged. */
import {buildIctH1Structure,ictStructurePermits,type IctBar,type IctCandidate} from './ict-research';
const ny = new Intl.DateTimeFormat('en-US',{timeZone:'America/New_York',weekday:'short',hour:'2-digit',hourCycle:'h23'});
export function isSilverWindow(time:number):boolean {
 const parts=Object.fromEntries(ny.formatToParts(time).map(p=>[p.type,p.value]));
 return !['Sat','Sun'].includes(parts.weekday) && parts.hour==='10';
}
export function oteEntry(origin:number,extreme:number):number {return Math.round((extreme+.705*(origin-extreme))*10)/10;}
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

export function buildIctSearchCandidates(candles: Record<'5m' | '15m' | '1h' | '4h',IctBar[]>, mode:'ote'|'silver'): IctCandidate[] {
  const signalTf=mode==='ote'?'15m':'5m', step=mode==='ote'?900000:300000;
  const steps={'5m':300000,'15m':900000,'1h':3600000,'4h':14400000};
  const indexed: Record<string,Pivot[]> = {};
  for(const tf of [signalTf,'1h','4h'] as const){validateBars(candles[tf],steps[tf]);indexed[tf]=indexPivots(candles[tf],steps[tf]);}
  const h1=buildIctH1Structure(candles['1h']), bars=candles[signalTf], pivots=indexed[signalTf];
  const latest: Partial<Record<'high' | 'low',Pivot>> = {}, used=new Set<string>();
  const result: IctCandidate[] = [];let pointer=0;
  for(let j=0;j+(mode==='silver'?1:0)<bars.length;j++){
    const c=bars[j];
    while(pointer<pivots.length&&pivots[pointer].confirmedAt<c.timestamp){const p=pivots[pointer++];latest[p.kind]=p;}
    if(j<15)continue;
    let atr=0;for(let k=j-14;k<j;k++)atr+=Math.max(bars[k].high-bars[k].low,Math.abs(bars[k].high-bars[k-1].close),Math.abs(bars[k].low-bars[k-1].close));atr/=14;
    for(const side of ['long','short'] as const){
      const d=side==='long'?1:-1,ref=latest[side==='long'?'high':'low'],protection=latest[side==='long'?'low':'high'];
      if(!ref||!protection||used.has(`${side}:${ref.index}`))continue;
      if(!(d*(c.close-ref.price)>0&&d*(bars[j-1].close-ref.price)<=0&&d*(c.close-c.open)>=atr))continue;
      used.add(`${side}:${ref.index}`);
      const a=bars[j-1],z=mode==='silver'?bars[j+1]:c,confirmedAt=z.timestamp+step-1;
      if(mode==='silver'&&!isSilverWindow(confirmedAt+1))continue;
      const [low,high]=side==='long'?[a.high,z.low]:[z.high,a.low];
      if((mode==='silver'&&low>=high) || (side==='long'?Math.min(c.low,z.low)<=protection.price:Math.max(c.high,z.high)>=protection.price) ||
          !ictStructurePermits(h1,side,c.timestamp+step-1,confirmedAt))continue;
      const extreme=side==='long'?c.high:c.low;
      const entry=mode==='ote'?oteEntry(protection.price,extreme):Math.round((low+high)/2*10)/10;
      if(d*(c.close-entry)<=0||d*(entry-protection.price)<=0)continue;
      const rawStop=side==='long'?Math.min(protection.price-.1,entry*(1-.008)):Math.max(protection.price+.1,entry*(1+.008));
      const stopLoss=(side==='long'?Math.floor(rawStop*10):Math.ceil(rawStop*10))/10;
      const targets: Array<{price:number;tf:string;confirmedAt:number}> = [];
      for(const [tf,ps] of Object.entries(indexed))for(const p of ps){
        if(p.confirmedAt>confirmedAt)break;
        if(p.kind===(side==='long'?'high':'low')&&d*(p.price-entry)>0&&p.touchedAt>confirmedAt)targets.push({price:p.price,tf,confirmedAt:p.confirmedAt});
      }
      if(mode==='ote')targets.push({price:extreme,tf:'impulse',confirmedAt:c.timestamp+step-1});
      targets.sort((x,y)=>d*(x.price-y.price));const target=targets[0]??null;
      result.push({id:`${mode}:${c.timestamp}:${side}`,side,confirmedAt,entry,stopLoss,target,
        rr:target?d*(target.price-entry)/Math.abs(entry-stopLoss):null,setup:mode==='ote'?'ict_ote_bos':'ict_silver_m5',fvg:mode==='silver'?[low,high]:undefined,mssAt:c.timestamp+step-1});
    }
  }
  return result.sort((a,b)=>a.confirmedAt-b.confirmedAt||a.id.localeCompare(b.id));
}

