/**
 * Offensive: flat RR2 vs 50%@1R + runner@2R vs flat RR3 (LIVE pullback proposals).
 * Usage: npx tsx scripts/eval-partial-tp.ts [--days=360]
 */
import { evaluateTrendPullbackEntry } from '../src/config/v3-entry-policy';

type Side = 'long' | 'short';
type Bar = { t: number; o: number; h: number; l: number; c: number };

async function fetchKlines(interval: string, startMs: number, endMs: number): Promise<Bar[]> {
  const out: Bar[] = [];
  let cursor = startMs;
  while (cursor < endMs) {
    const url =
      `https://fapi.binance.com/fapi/v1/klines?symbol=BTCUSDT&interval=${interval}` +
      `&startTime=${cursor}&endTime=${endMs}&limit=1500`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const ks = (await res.json()) as [number, string, string, string, string][];
    if (!ks.length) break;
    for (const k of ks) out.push({ t: k[0], o: +k[1], h: +k[2], l: +k[3], c: +k[4] });
    const next = ks[ks.length - 1][0] + 1;
    if (next <= cursor) break;
    cursor = next;
    if (ks.length < 1500) break;
    await new Promise((r) => setTimeout(r, 50));
  }
  return [...new Map(out.map((b) => [b.t, b])).values()].sort((a, b) => a.t - b.t);
}

function sma(c: number[], p: number, i: number): number | null {
  if (i + 1 < p) return null;
  let s = 0;
  for (let j = i - p + 1; j <= i; j++) s += c[j];
  return s / p;
}

function hIdx(bars: Bar[], t: number): number {
  let lo = 0;
  let hi = bars.length - 1;
  let ans = -1;
  while (lo <= hi) {
    const m = (lo + hi) >> 1;
    if (bars[m].t <= t) {
      ans = m;
      lo = m + 1;
    } else hi = m - 1;
  }
  return ans;
}

/** 50% @1R then BE; 50% runner to 2R. Same-bar: SL before TP (conservative). */
function pathPartial(
  bars: Bar[],
  i: number,
  side: Side,
  entry: number,
  sl0: number,
  tp1: number,
  tp2: number
): number {
  const fee = 0.05;
  let halfDone = false;
  let r = 0;
  let sl = sl0;
  for (let j = i + 1; j < bars.length; j++) {
    const b = bars[j];
    if (side === 'long') {
      if (!halfDone) {
        if (b.l <= sl) return -1 - fee;
        if (b.h >= tp1) {
          halfDone = true;
          r += 0.5;
          sl = entry;
          continue;
        }
      } else {
        if (b.l <= sl) return r - fee;
        if (b.h >= tp2) return r + 1 - fee; // 0.5 * 2R
      }
    } else {
      if (!halfDone) {
        if (b.h >= sl) return -1 - fee;
        if (b.l <= tp1) {
          halfDone = true;
          r += 0.5;
          sl = entry;
          continue;
        }
      } else {
        if (b.h >= sl) return r - fee;
        if (b.l <= tp2) return r + 1 - fee;
      }
    }
  }
  return r - fee;
}

function pathFlat(bars: Bar[], i: number, side: Side, sl: number, tp: number, rr: number): number {
  const fee = 0.05;
  for (let j = i + 1; j < bars.length; j++) {
    const b = bars[j];
    if (side === 'long') {
      if (b.l <= sl) return -1 - fee;
      if (b.h >= tp) return rr - fee;
    } else {
      if (b.h >= sl) return -1 - fee;
      if (b.l <= tp) return rr - fee;
    }
  }
  return -fee;
}

function summarize(xs: number[]) {
  const n = xs.length;
  const sum = xs.reduce((a, b) => a + b, 0);
  return { n, avgR: n ? +(sum / n).toFixed(4) : 0, sumR: +sum.toFixed(1) };
}

async function main(): Promise<void> {
  const daysArg = process.argv.find((a) => a.startsWith('--days='));
  const days = daysArg ? parseInt(daysArg.split('=')[1], 10) : 360;
  const end = Date.now();
  const start = end - days * 864e5;
  console.log('OFFENSIVE TP geometry — LIVE pullback proposals, SL=0.8%');
  console.log('Downloading…');
  const [bars15, bars1h] = await Promise.all([
    fetchKlines('15m', start, end),
    fetchKlines('1h', start, end),
  ]);
  const c15 = bars15.map((b) => b.c);
  const c1h = bars1h.map((b) => b.c);

  for (const d of [60, 180, days].filter((x, i, a) => a.indexOf(x) === i && x <= days)) {
    const wStart = end - d * 864e5;
    const flat2: number[] = [];
    const part: number[] = [];
    const flat3: number[] = [];
    for (let i = 50; i < bars15.length - 2; i++) {
      if (i % 16 !== 0) continue;
      const b = bars15[i];
      if (b.t < wStart) continue;
      const hi = hIdx(bars1h, b.t);
      if (hi < 50) continue;
      const s20 = sma(c1h, 20, hi);
      const s50 = sma(c1h, 50, hi);
      if (s20 == null || s50 == null) continue;
      const px = c1h[hi];
      let side: Side | null = null;
      if (px > s20 && s20 > s50) side = 'long';
      else if (px < s20 && s20 < s50) side = 'short';
      if (!side) continue;
      const entry = b.c;
      const hist = c15.slice(Math.max(0, i - 19), i + 1);
      const pb = evaluateTrendPullbackEntry({
        side,
        entry,
        closes: hist,
        smaPeriod: 20,
        maxAbovePct: 0.25,
        maxBelowPct: 1,
        enabled: true,
      });
      if (!pb.pass) continue;
      const slP = 0.008;
      const sl = side === 'long' ? entry * (1 - slP) : entry * (1 + slP);
      const tp1 = side === 'long' ? entry * (1 + slP) : entry * (1 - slP);
      const tp2 = side === 'long' ? entry * (1 + 2 * slP) : entry * (1 - 2 * slP);
      const tp3 = side === 'long' ? entry * (1 + 3 * slP) : entry * (1 - 3 * slP);
      flat2.push(pathFlat(bars15, i, side, sl, tp2, 2));
      part.push(pathPartial(bars15, i, side, entry, sl, tp1, tp2));
      flat3.push(pathFlat(bars15, i, side, sl, tp3, 3));
    }
    console.log(`\n=== ${d}d ===`);
    console.log('flat_RR2          ', summarize(flat2));
    console.log('partial_1R+run2R  ', summarize(part));
    console.log('flat_RR3          ', summarize(flat3));
    const a = summarize(flat2).avgR;
    const b = summarize(part).avgR;
    console.log(
      b > a
        ? `→ partial BEATS flat2 by +${(b - a).toFixed(4)} avgR`
        : `→ flat2 still ahead of partial by +${(a - b).toFixed(4)} avgR`
    );
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
