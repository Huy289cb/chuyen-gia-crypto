/**
 * Sweep R:R on Binance pullback rule backtest (same gates as live).
 * SL fixed at 0.8% (live MIN_SL); TP = SL * rr.
 *
 * Usage: npx tsx scripts/backtest-rr-sweep.ts [--days=360]
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
    for (const k of ks) out.push({ t: k[0], o: +k[1], h: +k[2], l: +k[3], c: +k[4] });
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

function arg(name: string, fallback: string): string {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
}

interface Row {
  rr: number;
  n: number;
  tp: number;
  sl: number;
  none: number;
  wr: number;
  avgR: number;
  sumR: number;
  beWr: number;
  edge: number; // avgR vs 0
}

function score(rr: number, paths: Path[], fee = 0.05): Row {
  let tp = 0;
  let sl = 0;
  let none = 0;
  let sum = 0;
  for (const p of paths) {
    if (p === 'TP') {
      tp++;
      sum += rr - fee;
    } else if (p === 'SL') {
      sl++;
      sum += -1 - fee;
    } else {
      none++;
      sum += -fee;
    }
  }
  const n = paths.length;
  const decided = tp + sl;
  const wr = decided > 0 ? tp / decided : 0;
  const beWr = 1 / (1 + rr); // ignore fee
  return {
    rr,
    n,
    tp,
    sl,
    none,
    wr: +(wr * 100).toFixed(1),
    avgR: n ? +(sum / n).toFixed(4) : 0,
    sumR: +sum.toFixed(1),
    beWr: +(beWr * 100).toFixed(1),
    edge: n ? sum / n : 0,
  };
}

async function main(): Promise<void> {
  const days = parseInt(arg('days', '360'), 10);
  const SL_PCT = 0.008;
  const maxAbove = 0.25;
  const maxBelow = 1.0;
  const RRs = [1, 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 1.8, 1.9, 2];
  // optional override: --rrs=1,1.25,1.5,2
  const rrsArg = arg('rrs', '');
  const rrList = rrsArg
    ? rrsArg.split(',').map((x) => parseFloat(x.trim())).filter((x) => Number.isFinite(x) && x > 0)
    : RRs;

  const endMs = Date.now();
  const startMs = endMs - days * 864e5;
  console.log('FETCH', { days, SL_PCT, maxAbove, maxBelow, RRs: rrList });
  console.log('Downloading…');
  const bars15 = await fetchKlines('15m', startMs, endMs);
  const bars1h = await fetchKlines('1h', startMs, endMs);
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

  const windows = [
    { label: '60d', days: 60 },
    { label: '180d', days: 180 },
    { label: '360d', days: Math.min(days, 360) },
  ].filter((w, i, a) => a.findIndex((x) => x.days === w.days) === i && w.days <= days);

  // Collect proposal indices once (pullback passes)
  type Prop = { i: number; side: Side; entry: number };
  function proposals(wStart: number, wEnd: number): Prop[] {
    const out: Prop[] = [];
    for (let i = 50; i < bars15.length - 2; i++) {
      if (i % 16 !== 0) continue;
      const b = bars15[i];
      if (b.t < wStart || b.t > wEnd) continue;
      const hi = hIdx(b.t);
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
        maxAbovePct: maxAbove,
        maxBelowPct: maxBelow,
        enabled: true,
      });
      if (!pb.pass) continue;
      out.push({ i, side, entry });
    }
    return out;
  }

  for (const w of windows) {
    const wStart = endMs - w.days * 864e5;
    const props = proposals(wStart, endMs);
    console.log(`\n=== ${w.label} pullback proposals=${props.length} SL=${SL_PCT * 100}% ===`);
    console.log(
      'RR'.padStart(5),
      'n'.padStart(5),
      'WR%'.padStart(6),
      'need%'.padStart(6),
      'avgR'.padStart(8),
      'sumR'.padStart(8),
      'TP'.padStart(5),
      'SL'.padStart(5),
      'NONE'.padStart(5),
      'verdict'
    );
    const rows: Row[] = [];
    for (const rr of rrList) {
      const paths: Path[] = [];
      for (const pr of props) {
        const sl =
          pr.side === 'long' ? pr.entry * (1 - SL_PCT) : pr.entry * (1 + SL_PCT);
        const tpDist = SL_PCT * rr;
        const tp =
          pr.side === 'long' ? pr.entry * (1 + tpDist) : pr.entry * (1 - tpDist);
        paths.push(pathAfter(bars15, pr.i, pr.side, sl, tp));
      }
      const row = score(rr, paths);
      rows.push(row);
      const ok = row.avgR > 0 && row.wr > row.beWr;
      console.log(
        String(rr).padStart(5),
        String(row.n).padStart(5),
        String(row.wr).padStart(6),
        String(row.beWr).padStart(6),
        String(row.avgR).padStart(8),
        String(row.sumR).padStart(8),
        String(row.tp).padStart(5),
        String(row.sl).padStart(5),
        String(row.none).padStart(5),
        ok ? 'PNL+' : 'PNL-'
      );
    }
    const best = [...rows].sort((a, b) => b.avgR - a.avgR)[0];
    const bestSum = [...rows].sort((a, b) => b.sumR - a.sumR)[0];
    console.log(
      `BEST_avgR: RR=${best.rr} avgR=${best.avgR} WR=${best.wr}% | BEST_sumR: RR=${bestSum.rr} sumR=${bestSum.sumR}`
    );
  }

  console.log(
    '\nNOTE: Rule pullback (live band) + fee 0.05R. Not LLM replay. Same proposal set per window; only TP distance changes.'
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
