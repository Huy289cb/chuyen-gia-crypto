import { Decimal } from '@prisma/client/runtime/library';
import type { Numeric, SymbolFilter } from './types';

export const CCT_PROJECTION_REVISION = 'cct-finite-coordinate-v1';
const Money = Decimal.clone({ precision: 40, rounding: Decimal.ROUND_HALF_EVEN });
const d = (x: Numeric): Decimal => {
  const z = new Money(x);
  if (!z.isFinite()) throw new Error('Nonfinite projection input');
  return z;
};
const zero = (): Decimal => d(0);
const str = (x: Decimal): string => x.isZero() ? '0' : x.toString();
type Position = Numeric | { quantity: Numeric };
interface Filter { step: Decimal; min: Decimal; max: Decimal; notional: Decimal }
interface Leg { quantity: Decimal; reducing: boolean }
type ExactVector = [Decimal, Decimal, Decimal, Decimal, Decimal, Decimal];
type FloatVector = [number, number, number, number, number, number];
type Selection = Record<string, string>;
interface Option { q: Decimal; legs: Leg[]; exact: ExactVector; numeric: FloatVector }

export interface CctProjectionInput {
  weights: Record<string, Numeric>;
  positions: Record<string, Position>;
  equity: Numeric;
  marks: Record<string, Numeric>;
  filters: Record<string, SymbolFilter>;
  grossCap?: Numeric;
  feeRate: Numeric;
  slippageBps: Numeric;
  references?: Record<string, Numeric>;
  leverage?: Numeric | null;
  dayAnchor?: Numeric;
  dayNetCashflow?: Numeric;
  dailyLossBudget?: Numeric;
  closeBuffer?: Numeric;
}
export interface CctProjectedOrder {
  symbol: string; quantity: string; reduceOnly: boolean;
  referencePrice: string; fillPrice: string; fee: string;
}
export interface CctProjectionResult {
  feasible: boolean; reason: string; quantities: Record<string, string>; orders: CctProjectedOrder[];
  preEquity: string; estimatedPostEquity: string; gross: string;
  trackingErrorUsd: string; netDeviationUsd: string; targetNetUsd: string; actualNetUsd: string;
  immediateCostUsd: string; closeReserveUsd: string; objectiveUsd: string; iterations: number;
}

const positionQuantity = (position: Position | undefined): Decimal => d(typeof position === 'object' ? position.quantity : position ?? 0);
function marketFilter(raw: SymbolFilter): Filter {
  if (!raw) throw new Error('Missing MARKET filter');
  const f = { step: d(raw.marketStepSize ?? raw.stepSize), min: d(raw.marketMinQty ?? raw.minQty),
    max: d(raw.marketMaxQty ?? raw.maxQty ?? '1e30'), notional: d(raw.minNotional) };
  if (f.step.lte(0) || f.min.lte(0) || f.notional.lte(0) || f.max.lt(f.min)) throw new Error('Invalid or unsupported MARKET filter');
  return f;
}
const roundLot = (x: Decimal, step: Decimal, up = false): Decimal => x.div(step).toDecimalPlaces(0, up ? Decimal.ROUND_CEIL : Decimal.ROUND_FLOOR).mul(step);
function validDelta(delta: Decimal, reducing: boolean, f: Filter, mark: Decimal): boolean {
  const absolute = delta.abs();
  return absolute.gte(f.min) && absolute.lte(f.max) && absolute.mod(f.step).isZero() && (reducing || absolute.mul(mark).gte(f.notional));
}
function plan(old: Decimal, next: Decimal, f: Filter, mark: Decimal): Leg[] | null {
  if (old.eq(next)) return [];
  const retained = old.mul(next).gt(0) ? Money.min(old.abs(), next.abs()).mul(old.gt(0) ? 1 : -1) : zero();
  const legs: Leg[] = [];
  if (!old.eq(retained)) legs.push({ quantity: retained.sub(old), reducing: true });
  if (!next.eq(retained)) legs.push({ quantity: next.sub(retained), reducing: false });
  return legs.every(leg => validDelta(leg.quantity, leg.reducing, f, mark)) ? legs : null;
}
function candidates(old: Decimal, desired: Decimal, f: Filter, mark: Decimal): Decimal[] {
  const qtyMin = roundLot(f.min, f.step, true), qtyMax = roundLot(f.max, f.step);
  const addMin = Money.max(qtyMin, roundLot(f.notional.div(mark), f.step, true));
  const values = new Map<string, Decimal>([[str(old), old]]);
  const addInterval = (base: Decimal, direction: number, lo: Decimal, hi: Decimal): void => {
    if (lo.gt(hi)) return;
    const goal = desired.sub(base).mul(direction);
    const clamped = Money.min(Money.max(goal, lo), hi);
    for (const size of [lo, hi, roundLot(clamped, f.step), roundLot(clamped, f.step, true)]) {
      if (size.gte(lo) && size.lte(hi)) { const q = base.add(size.mul(direction)); values.set(str(q), q); }
    }
  };
  if (old.isZero()) {
    addInterval(zero(), 1, addMin, qtyMax); addInterval(zero(), -1, addMin, qtyMax);
  } else {
    const sign = old.gt(0) ? 1 : -1;
    addInterval(old, -sign, qtyMin, Money.min(qtyMax, roundLot(old.abs(), f.step)));
    addInterval(old, sign, addMin, qtyMax);
    if (validDelta(old.neg(), true, f, mark)) {
      values.set('0', zero()); addInterval(zero(), -sign, addMin, qtyMax);
    }
  }
  return [...values.values()].filter(q => plan(old, q, f, mark) !== null).sort((a, b) => a.comparedTo(b));
}
const compare = (a: number[], b: number[]): number => {
  for (let i = 0; i < a.length; i++) { if (a[i] < b[i]) return -1; if (a[i] > b[i]) return 1; }
  return 0;
};
const compareSymbolQuantity = (a: { rank: number[]; symbol: string; q: Decimal }, b: { rank: number[]; symbol: string; q: Decimal }): number =>
  compare(a.rank, b.rank) || (a.symbol < b.symbol ? -1 : a.symbol > b.symbol ? 1 : a.q.comparedTo(b.q));

/** Exact actual-inventory 20% band; count changes and flat positions use the source request. */
export function applyCctActualInventoryBand(input: {
  weights: Record<string, Numeric>; positions: Record<string, Position>; equity: Numeric; marks: Record<string, Numeric>;
  metadata: Record<string, { signalCountChanged: boolean }>; threshold?: Numeric;
}): Record<string, string> {
  const nav = d(input.equity), threshold = d(input.threshold ?? '.20');
  if (nav.lte(0) || threshold.lt(0)) throw new Error('Invalid CCT band equity/threshold');
  const effective: Record<string, string> = {};
  for (const [s, weight] of Object.entries(input.weights)) {
    const desired = d(weight), held = positionQuantity(input.positions[s]);
    let chosen = desired;
    if (!held.isZero()) {
      if (!input.metadata[s]) throw new Error(`Missing CCT count metadata for held symbol ${s}`);
      const mark = d(input.marks[s]);
      if (mark.lte(0)) throw new Error('Invalid CCT band mark');
      const actual = held.mul(mark).div(nav);
      if (!input.metadata[s].signalCountChanged && actual.mul(desired).gt(0) && desired.sub(actual).abs().lte(threshold.mul(actual.abs()))) chosen = actual;
    }
    effective[s] = str(chosen);
  }
  return effective;
}

/**
 * Port of frozen candidate_projection.py (3be3fc71a33d9e13).
 * Finite legal order-delta endpoints, repair, then coordinate descent. Float64
 * chooses candidates; Decimal40 alone authorizes final post-cost reservations.
 * This is a deterministic feasible solver, not a global optimum guarantee.
 */
export function projectCctTargets(input: CctProjectionInput): CctProjectionResult {
  const nav = d(input.equity), cap = d(input.grossCap ?? 8), fee = d(input.feeRate), slip = d(input.slippageBps).div(10000);
  const lev = input.leverage === null ? null : d(input.leverage ?? 10);
  const anchor = input.dayAnchor === undefined ? null : d(input.dayAnchor);
  const flow = d(input.dayNetCashflow ?? 0), budget = d(input.dailyLossBudget ?? 10), buffer = d(input.closeBuffer ?? '1.1');
  if (nav.lte(0) || cap.lt(0) || fee.lt(0) || slip.lt(0) || slip.gte(1) || (lev !== null && lev.lte(0))) throw new Error('Invalid equity/cap/cost/leverage');
  if (budget.lte(0) || buffer.lt(0) || buffer.gte(budget)) throw new Error('Invalid daily budget or close buffer');
  const symbols = [...new Set([...Object.keys(input.weights), ...Object.keys(input.positions)])].sort();
  const references = input.references ?? input.marks;
  const old: Selection = {}, tables: Record<string, Map<string, Option>> = {}, refs: Record<string, Decimal> = {};
  let targetNet = zero();
  for (const s of symbols) {
    const quantity = positionQuantity(input.positions[s]), mark = d(input.marks[s]), ref = d(references[s]), f = marketFilter(input.filters[s]);
    if (mark.lte(0) || ref.lte(0)) throw new Error('Invalid mark/reference');
    old[s] = str(quantity); refs[s] = ref;
    const desired = nav.mul(d(input.weights[s] ?? 0));
    targetNet = targetNet.add(desired);
    const table = new Map<string, Option>();
    for (const q of candidates(quantity, desired.div(mark), f, mark)) {
      const legs = plan(quantity, q, f, mark)!;
      let cost = zero(), turnover = zero();
      for (const leg of legs) {
        const fill = ref.mul(d(1).add(slip.mul(leg.quantity.gt(0) ? 1 : -1)));
        cost = cost.add(leg.quantity.abs().mul(fill).mul(fee).sub(leg.quantity.mul(mark.sub(fill))));
        turnover = turnover.add(leg.quantity.abs().mul(ref));
      }
      const closeFill = ref.mul(d(1).add(slip.mul(q.lt(0) ? 1 : -1)));
      const reserve = Money.max(q.mul(mark.sub(closeFill)), 0).add(q.abs().mul(closeFill).mul(fee));
      const exact: ExactVector = [q.mul(mark).sub(desired).abs(), q.mul(mark), q.abs().mul(mark), cost, reserve, turnover];
      table.set(str(q), { q, legs, exact, numeric: exact.map(x => x.toNumber()) as FloatVector });
    }
    tables[s] = table;
  }
  const totalExact = (selection: Selection): ExactVector => {
    const z: ExactVector = [zero(), zero(), zero(), zero(), zero(), zero()];
    for (const s of symbols) { const v = tables[s].get(selection[s])!.exact; for (let i = 0; i < 6; i++) z[i] = z[i].add(v[i]); }
    return z;
  };
  const totalFloat = (selection: Selection): FloatVector => {
    const z: FloatVector = [0, 0, 0, 0, 0, 0];
    for (const s of symbols) { const v = tables[s].get(selection[s])!.numeric; for (let i = 0; i < 6; i++) z[i] += v[i]; }
    return z;
  };
  const validExact = (z: ExactVector): boolean => {
    const after = nav.sub(z[3]);
    return after.gt(0) && z[2].lte(cap.mul(after)) && (lev === null || z[2].div(lev).add(z[4]).lte(after)) &&
      (anchor === null || after.sub(anchor).sub(flow).sub(z[4]).gt(budget.neg().add(buffer)));
  };
  const fnav = nav.toNumber(), fcap = cap.toNumber(), fnet = targetNet.toNumber();
  const flev = lev?.toNumber() ?? null, fanchor = anchor?.toNumber() ?? null;
  const fflow = flow.toNumber(), fbudget = budget.toNumber(), fbuffer = buffer.toNumber();
  const validFloat = (z: FloatVector): boolean => {
    const after = fnav - z[3], epsilon = Math.max(1, Math.abs(fnav)) * 1e-12;
    return after > 0 && z[2] <= fcap * after - epsilon &&
      (flev === null || z[2] / flev + z[4] <= after - epsilon) &&
      (fanchor === null || after - fanchor - fflow - z[4] > -fbudget + fbuffer + epsilon);
  };
  const key = (z: FloatVector): number[] => {
    const deviation = Math.abs(z[1] - fnet);
    return [z[0] + deviation + Math.max(z[3], 0), deviation, z[0], z[3], z[5]];
  };
  const violation = (z: FloatVector): number => {
    const after = fnav - z[3];
    let value = Math.max(-after, 0) + Math.max(z[2] - fcap * after, 0);
    if (flev !== null) value += Math.max(z[2] / flev + z[4] - after, 0);
    if (fanchor !== null) value += Math.max(-fbudget + fbuffer - (after - fanchor - fflow - z[4]), 0);
    return value;
  };
  let selected: Selection = {};
  for (const s of symbols) {
    const values = [...tables[s].values()];
    values.sort((a, b) => compare([a.numeric[0] + Math.max(a.numeric[3], 0), a.numeric[0], a.numeric[5]],
      [b.numeric[0] + Math.max(b.numeric[3], 0), b.numeric[0], b.numeric[5]]) || a.q.comparedTo(b.q));
    selected[s] = str(values[0].q);
  }
  const starts: Selection[] = [selected, old];
  if (symbols.every(s => tables[s].has('0'))) starts.push(Object.fromEntries(symbols.map(s => [s, '0'])));
  const repair = { ...selected };
  let repairSteps = 0, rz = totalFloat(repair);
  for (let iteration = 0; iteration < Math.max(1, symbols.length) * 4; iteration++) {
    if (validExact(totalExact(repair))) { starts.push({ ...repair }); break; }
    const before = violation(rz);
    let best: { rank: number[]; symbol: string; q: Decimal; trial: FloatVector } | null = null;
    for (const s of symbols) {
      const previous = tables[s].get(repair[s])!.numeric;
      for (const option of tables[s].values()) {
        if (str(option.q) === repair[s]) continue;
        const trial = rz.map((x, i) => x + option.numeric[i] - previous[i]) as FloatVector;
        const drop = before - violation(trial);
        if (drop <= Math.max(1, Math.abs(fnav)) * 1e-14) continue;
        const increase = Math.max(key(trial)[0] - key(rz)[0], 0);
        const candidate = { rank: [increase / drop, ...key(trial)], symbol: s, q: option.q, trial };
        if (best === null || compareSymbolQuantity(candidate, best) < 0) best = candidate;
      }
    }
    if (best === null) break;
    repair[best.symbol] = str(best.q); rz = best.trial; repairSteps++;
  }
  if (validExact(totalExact(repair))) starts.push({ ...repair });
  const safe = starts.filter(selection => validExact(totalExact(selection)));
  const result = (feasible: boolean, reason: string, selection: Selection, orders: CctProjectedOrder[], z: ExactVector, iterations: number): CctProjectionResult => {
    const deviation = z[1].sub(targetNet).abs();
    return { feasible, reason, quantities: { ...selection }, orders, preEquity: str(nav), estimatedPostEquity: str(nav.sub(z[3])),
      gross: str(z[2]), trackingErrorUsd: str(z[0]), netDeviationUsd: str(deviation), targetNetUsd: str(targetNet),
      actualNetUsd: str(z[1]), immediateCostUsd: str(z[3]), closeReserveUsd: str(z[4]),
      objectiveUsd: str(z[0].add(deviation).add(Money.max(z[3], 0))), iterations };
  };
  if (!safe.length) return result(false, 'NO_FEASIBLE_SHARED_RESERVATION', old, [], totalExact(old), repairSteps);
  safe.sort((a, b) => compare(key(totalFloat(a)), key(totalFloat(b))));
  selected = { ...safe[0] };
  const fallback = { ...selected };
  let z = totalFloat(selected), iterations = repairSteps;
  for (let iteration = 0; iteration < Math.max(1, symbols.length) * 4; iteration++) {
    const baseKey = key(z);
    let best: { rank: number[]; symbol: string; q: Decimal; trial: FloatVector } | null = null;
    for (const s of symbols) {
      const previous = tables[s].get(selected[s])!.numeric;
      for (const option of tables[s].values()) {
        if (str(option.q) === selected[s]) continue;
        const trial = z.map((x, i) => x + option.numeric[i] - previous[i]) as FloatVector;
        const candidate = { rank: key(trial), symbol: s, q: option.q, trial };
        if (validFloat(trial) && compare(candidate.rank, baseKey) < 0 && (best === null || compareSymbolQuantity(candidate, best) < 0)) best = candidate;
      }
    }
    if (best === null) break;
    selected[best.symbol] = str(best.q); z = best.trial; iterations++;
  }
  let exact = totalExact(selected);
  if (!validExact(exact)) { selected = fallback; exact = totalExact(fallback); }
  if (!validExact(exact)) throw new Error('Projection final Decimal reservation invariant failed');
  const reductions: CctProjectedOrder[] = [], increases: CctProjectedOrder[] = [];
  for (const s of symbols) for (const leg of tables[s].get(selected[s])!.legs) {
    const fill = refs[s].mul(d(1).add(slip.mul(leg.quantity.gt(0) ? 1 : -1)));
    const order = { symbol: s, quantity: str(leg.quantity), reduceOnly: leg.reducing,
      referencePrice: str(refs[s]), fillPrice: str(fill), fee: str(leg.quantity.abs().mul(fill).mul(fee)) };
    (leg.reducing ? reductions : increases).push(order);
  }
  return result(true, 'FEASIBLE_STATIC_PROJECTION', selected, [...reductions, ...increases], exact, iterations);
}
