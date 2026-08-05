/**
 * Compare strategy styles: WR vs avgR (180d BTCUSDT futures).
 * Usage: npx tsx scripts/compare-strategy-styles.ts
 */
import { evaluateTrendPullbackEntry } from '../src/config/v3-entry-policy';

type Side = 'long' | 'short';
type Path = 'TP' | 'SL' | 'NONE';
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
    for (const k of ks) {
      out.push({ t: k[0], o: +k[1], h: +k[2], l: +k[3], c: +k[4] });
    }
    const next = ks[ks.length - 1][0] + 1;
    if (next <= cursor) break;
    cursor = next;
    if (ks.length < 1500) break;
    await new Promise((r) => setTimeout(r, 80));
  }
  const m = new Map(out.map((b) => [b.t, b]));
  return [...m.values()].sort((a, b) => a.t - b.t);
}

function sma(c: number[], p: number, i: number): number | null {
  if (i + 1 < p) return null;
  let s = 0;
  for (let j = i - p + 1; j <= i; j++) s += c[j];
  return s / p;
}

function pathAfter(bars: Bar[], i: number, side: Side, sl: number, tp: number): Path {
  for (let j = i + 1; j < bars.length; j++) {
    const b = bars[j];
    if (side === 'long') {
      if (b.l <= sl) return 'SL';
      if (b.h >= tp) return 'TP';
    } else {
      if (b.h >= sl) return 'SL';
      if (b.l <= tp) return 'TP';
    }
  }
  return 'NONE';
}

function score(name: string, rows: { path: Path; rr: number }[]) {
  const fee = 0.05;
  let tp = 0;
  let sl = 0;
  let sum = 0;
  for (const r of rows) {
    if (r.path === 'TP') {
      tp++;
      sum += r.rr - fee;
    } else if (r.path === 'SL') {
      sl++;
      sum += -1 - fee;
    } else {
      sum += -fee;
    }
  }
  const n = rows.length;
  const decided = tp + sl;
  const wr = decided > 0 ? (tp / decided) * 100 : 0;
  return {
    name,
    n,
    tp,
    sl,
    wr: +wr.toFixed(1),
    avgR: n ? +(sum / n).toFixed(3) : null,
    sumR: +sum.toFixed(1),
    pnlPlus: n > 0 && sum / n > 0,
  };
}

async function main(): Promise<void> {
  const end = Date.now();
  const start = end - 180 * 864e5;
  console.log('fetch 180d BTCUSDT…');
  const bars15 = await fetchKlines('15m', start, end);
  const bars1h = await fetchKlines('1h', start, end);
  const c15 = bars15.map((b) => b.c);
  const c1h = bars1h.map((b) => b.c);
  const hIdx = (t: number): number => {
    let lo = 0;
    let hi = bars1h.length - 1;
    let ans = -1;
    while (lo <= hi) {
      const m = (lo + hi) >> 1;
      if (bars1h[m].t <= t) {
        ans = m;
        lo = m + 1;
      } else hi = m - 1;
    }
    return ans;
  };

  const A: Record<string, { path: Path; rr: number }[]> = {
    'A_trend_pullback_RR2 (live)': [],
    'B_pullback_tighter_band_RR2': [],
    'C_pullback_TP1R (higher WR)': [],
    'D_mean_revert_range_RR1': [],
    'E_trend_any_RR2 (no pullback)': [],
  };

  for (let i = 50; i < bars15.length - 2; i++) {
    if (i % 16 !== 0) continue;
    const b = bars15[i];
    const hi = hIdx(b.t);
    if (hi < 50) continue;
    const s20 = sma(c1h, 20, hi);
    const s50 = sma(c1h, 50, hi);
    if (s20 == null || s50 == null) continue;
    const px = c1h[hi];
    const trendLong = px > s20 && s20 > s50;
    const trendShort = px < s20 && s20 < s50;
    const range = !trendLong && !trendShort;
    const entry = b.c;
    const hist = c15.slice(Math.max(0, i - 19), i + 1);

    if (trendLong || trendShort) {
      const side: Side = trendLong ? 'long' : 'short';
      const slP = 0.008;
      const sl = side === 'long' ? entry * (1 - slP) : entry * (1 + slP);
      const tp2 = side === 'long' ? entry * (1 + 0.016) : entry * (1 - 0.016);
      const tp1 = side === 'long' ? entry * (1 + slP) : entry * (1 - slP);
      const path2 = pathAfter(bars15, i, side, sl, tp2);
      const path1 = pathAfter(bars15, i, side, sl, tp1);
      const pb = evaluateTrendPullbackEntry({
        side,
        entry,
        closes: hist,
        smaPeriod: 20,
        maxAbovePct: 0.25,
        maxBelowPct: 1,
        enabled: true,
      });
      const pbT = evaluateTrendPullbackEntry({
        side,
        entry,
        closes: hist,
        smaPeriod: 20,
        maxAbovePct: 0.1,
        maxBelowPct: 0.5,
        enabled: true,
      });
      A['E_trend_any_RR2 (no pullback)'].push({ path: path2, rr: 2 });
      if (pb.pass) {
        A['A_trend_pullback_RR2 (live)'].push({ path: path2, rr: 2 });
        A['C_pullback_TP1R (higher WR)'].push({ path: path1, rr: 1 });
      }
      if (pbT.pass) A['B_pullback_tighter_band_RR2'].push({ path: path2, rr: 2 });
    }

    if (range) {
      const s15 = sma(c15, 20, i);
      if (s15 == null) continue;
      const dist = ((entry - s15) / s15) * 100;
      let side: Side | null = null;
      if (dist >= 0.4) side = 'short';
      else if (dist <= -0.4) side = 'long';
      if (!side) continue;
      const slP = 0.006;
      const sl = side === 'long' ? entry * (1 - slP) : entry * (1 + slP);
      const tp = side === 'long' ? entry * (1 + slP) : entry * (1 - slP);
      A['D_mean_revert_range_RR1'].push({
        path: pathAfter(bars15, i, side, sl, tp),
        rr: 1,
      });
    }
  }

  console.log('\n=== 180d compare: WR vs avgR (fee 0.05R) ===');
  console.log('Need WR>33% @RR2 for PnL+; need WR>52.5% @RR1 (w/ fee).\n');
  for (const k of Object.keys(A)) {
    console.log(score(k, A[k]));
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
