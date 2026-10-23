/** Deterministic ICT research primitives. No environment, database, provider or order access. */
export type IctSide = 'long' | 'short';
export interface IctBar { timestamp: number; open: number; high: number; low: number; close: number; volume: number }
export interface IctCandidate {
  id: string; side: IctSide; confirmedAt: number; entry: number; stopLoss: number;
  target: { price: number; tf?: string; confirmedAt?: number } | null;
  rr: number | null; setup?: string; fvg?: number[]; mssAt?: number;
}
export const ICT_RESEARCH_VERSION = 'ict-economic-structure-continuation-v1';
export const ICT_RESEARCH_RULES = Object.freeze({
  pivotStrength: 2, atrBars: 14, minSlFraction: .008, tick: .1,
  feePerSide: .0005, stressSlippageFraction: .002, ttlMs: 3600000,
});

/** Positive net-at-target is necessary under these costs, not a probability or expectancy. */
export function evaluateIctTargetEconomics(input: {
  side: IctSide; entry: number; target: number; quantity: number;
  feePerSide: number; slippageFraction: number;
  fundingReserveUsd: number; aiCostUsd: number;
}): { allowed: boolean; reason: 'ok' | 'invalid_economics' | 'target_net_nonpositive'; netAtTargetUsd: number | null } {
  const { side, entry, target, quantity, feePerSide, slippageFraction, fundingReserveUsd, aiCostUsd } = input;
  if (!['long', 'short'].includes(side) || ![entry,target,quantity].every(x => Number.isFinite(x) && x > 0) ||
      ![feePerSide,slippageFraction,fundingReserveUsd,aiCostUsd].every(x => Number.isFinite(x) && x >= 0)) {
    return { allowed: false, reason: 'invalid_economics', netAtTargetUsd: null };
  }
  const reward = (side === 'long' ? 1 : -1) * (target - entry) * quantity;
  if (reward <= 0) return { allowed: false, reason: 'invalid_economics', netAtTargetUsd: null };
  const net = reward - (entry + target) * quantity * feePerSide - entry * quantity * slippageFraction - fundingReserveUsd - aiCostUsd;
  return { allowed: net > 1e-12, reason: net > 1e-12 ? 'ok' : 'target_net_nonpositive', netAtTargetUsd: net };
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

export interface IctStructurePoint {
  knownAt: number; side: IctSide | null; protectedLevel: number | null;
  bosAt: number | null; referenceIndex: number | null;
  event: 'bos' | 'protected_break' | 'unchanged';
}
/** H1 permission: fresh confirmed swing close-break, invalidated immediately on protected-level close-break. */
export function buildIctH1Structure(rows: IctBar[]): IctStructurePoint[] {
  const step = 3600000; validateBars(rows,step);
  const pivots = indexPivots(rows,step), points: IctStructurePoint[] = [];
  const latest: Partial<Record<'high' | 'low',Pivot>> = {};
  const consumed = new Set<string>(); let pointer = 0;
  let state: Omit<IctStructurePoint,'knownAt' | 'event'> = {side:null,protectedLevel:null,bosAt:null,referenceIndex:null};
  for (let i = 0; i < rows.length; i++) {
    const b = rows[i];
    while (pointer < pivots.length && pivots[pointer].confirmedAt < b.timestamp) {
      const p = pivots[pointer++]; latest[p.kind] = p;
    }
    let event: IctStructurePoint['event'] = 'unchanged';
    if (state.side && state.protectedLevel !== null && (state.side === 'long' ? b.close < state.protectedLevel : b.close > state.protectedLevel)) {
      state = {side:null,protectedLevel:null,bosAt:null,referenceIndex:null}; event = 'protected_break';
      // A loss of protection is transition, not an automatic opposite permission on the same bar.
    } else if (i > 0) {
      for (const side of ['long','short'] as const) {
        const d = side === 'long' ? 1 : -1, ref = latest[side === 'long' ? 'high' : 'low'];
        const protection = latest[side === 'long' ? 'low' : 'high'];
        if (!ref || !protection || consumed.has(`${side}:${ref.index}`)) continue;
        if (d*(b.close-ref.price)>0 && d*(rows[i-1].close-ref.price)<=0 && d*(b.close-protection.price)>0) {
          consumed.add(`${side}:${ref.index}`);
          state = {side,protectedLevel:protection.price,bosAt:b.timestamp+step-1,referenceIndex:ref.index}; event = 'bos'; break;
        }
      }
    }
    points.push({knownAt:b.timestamp+step-1,...state,event});
  }
  return points;
}
function pointIndex(points: IctStructurePoint[], asOf: number): number {
  let lo=0,hi=points.length;
  while(lo<hi){const mid=(lo+hi)>>>1;if(points[mid].knownAt<=asOf)lo=mid+1;else hi=mid;}
  return lo-1;
}
export function ictStructureAt(points: IctStructurePoint[], asOf: number): IctStructurePoint | null {
  const i=pointIndex(points,asOf);if(i<0 || asOf-points[i].knownAt>3600000)return null;
  return points[i];
}
/** Pending plans cannot regain permission after an invalidation during their lifetime. */
export function ictStructurePermits(points: IctStructurePoint[], side: IctSide, from: number, through: number): boolean {
  if (!Number.isFinite(from) || !Number.isFinite(through) || through<from ||
      ictStructureAt(points,from)?.side!==side || ictStructureAt(points,through)?.side!==side) return false;
  for(let i=pointIndex(points,from)+1;i<points.length && points[i].knownAt<=through;i++)if(points[i].side!==side)return false;
  return true;
}

/** M15 displacement/BOS -> confirmed three-candle FVG; entry at midpoint on a later bar. */
export function buildIctContinuationCandidates(candles: Record<'15m' | '1h' | '4h',IctBar[]>): IctCandidate[] {
  const steps={'15m':900000,'1h':3600000,'4h':14400000};
  const indexed: Record<string,Pivot[]> = {};
  for(const tf of ['15m','1h','4h'] as const){validateBars(candles[tf],steps[tf]);indexed[tf]=indexPivots(candles[tf],steps[tf]);}
  const h1=buildIctH1Structure(candles['1h']), bars=candles['15m'], pivots=indexed['15m'];
  const latest: Partial<Record<'high' | 'low',Pivot>> = {}, used=new Set<string>();
  const result: IctCandidate[] = [];let pointer=0;
  for(let j=0;j+1<bars.length;j++){
    const c=bars[j];
    while(pointer<pivots.length&&pivots[pointer].confirmedAt<c.timestamp){const p=pivots[pointer++];latest[p.kind]=p;}
    if(j<15)continue;
    let atr=0;for(let k=j-14;k<j;k++)atr+=Math.max(bars[k].high-bars[k].low,Math.abs(bars[k].high-bars[k-1].close),Math.abs(bars[k].low-bars[k-1].close));atr/=14;
    for(const side of ['long','short'] as const){
      const d=side==='long'?1:-1,ref=latest[side==='long'?'high':'low'],protection=latest[side==='long'?'low':'high'];
      if(!ref||!protection||used.has(`${side}:${ref.index}`))continue;
      if(!(d*(c.close-ref.price)>0&&d*(bars[j-1].close-ref.price)<=0&&d*(c.close-c.open)>=atr))continue;
      used.add(`${side}:${ref.index}`);
      const a=bars[j-1],z=bars[j+1],confirmedAt=z.timestamp+900000-1;
      const [low,high]=side==='long'?[a.high,z.low]:[z.high,a.low];
      if(low>=high || (side==='long'?Math.min(c.low,z.low)<=protection.price:Math.max(c.high,z.high)>=protection.price) ||
          !ictStructurePermits(h1,side,c.timestamp+900000-1,confirmedAt))continue;
      const entry=Math.round((low+high)/2*10)/10;
      const rawStop=side==='long'?Math.min(protection.price-.1,entry*(1-.008)):Math.max(protection.price+.1,entry*(1+.008));
      const stopLoss=(side==='long'?Math.floor(rawStop*10):Math.ceil(rawStop*10))/10;
      const targets: Array<{price:number;tf:string;confirmedAt:number}> = [];
      for(const [tf,ps] of Object.entries(indexed))for(const p of ps){
        if(p.confirmedAt>confirmedAt)break;
        if(p.kind===(side==='long'?'high':'low')&&d*(p.price-entry)>0&&p.touchedAt>confirmedAt)targets.push({price:p.price,tf,confirmedAt:p.confirmedAt});
      }
      targets.sort((x,y)=>d*(x.price-y.price));const target=targets[0]??null;
      result.push({id:`continuation:${c.timestamp}:${side}`,side,confirmedAt,entry,stopLoss,target,
        rr:target?d*(target.price-entry)/Math.abs(entry-stopLoss):null,setup:'ict_continuation_fvg',fvg:[low,high],mssAt:c.timestamp+900000-1});
    }
  }
  return result.sort((a,b)=>a.confirmedAt-b.confirmedAt||a.id.localeCompare(b.id));
}

export const ICT_RESEARCH_VARIANTS = ['edge_baseline','sweep_cost','sweep_h1','sweep_cost_h1','continuation_cost_h1','combined_cost_h1'] as const;
export type IctResearchVariant = typeof ICT_RESEARCH_VARIANTS[number];
export function ictResearchGates(variant: IctResearchVariant): {cost:boolean;h1:boolean} {
  return {cost:variant.includes('cost'),h1:variant.includes('h1')};
}
export function selectIctResearchCandidates(variant: IctResearchVariant, sweep: IctCandidate[], continuation: IctCandidate[]): IctCandidate[] {
  const rows=variant==='continuation_cost_h1'?continuation:variant==='combined_cost_h1'?[...sweep,...continuation]:sweep;
  // Sweep has fixed priority at identical confirmation times; never use future profitability to choose.
  return [...rows].sort((a,b)=>a.confirmedAt-b.confirmedAt||Number(a.id.startsWith('continuation:'))-Number(b.id.startsWith('continuation:'))||a.id.localeCompare(b.id));
}
