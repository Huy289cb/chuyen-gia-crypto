/**
 * Sweep TF confirmation stacks for 5m entries (rule SMA, no LLM).
 * Includes LIVE (current env stack) as baseline + 1h→30m variants.
 *
 * Usage: npx tsx scripts/backtest-tf-stack.ts [--days=360] [--rr=2]
 */
import { evaluateTrendPullbackEntry } from '../src/config/v3-entry-policy';

type Side = 'long' | 'short';
type Path = 'TP' | 'SL' | 'NONE';
type Bar = { t: number; o: number; h: number; l: number; c: number };
type Htf = '1h' | '30m';

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

function trendSide(closes: number[], i: number): Side | null {
  const s20 = sma(closes, 20, i);
  const s50 = sma(closes, 50, i);
  if (s20 == null || s50 == null) return null;
  const px = closes[i];
  if (px > s20 && s20 > s50) return 'long';
  if (px < s20 && s20 < s50) return 'short';
  return null;
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

function idxAtOrBefore(bars: Bar[], t: number): number {
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

function arg(name: string, fallback: string): string {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
}

/** How HTF + 15m combine into a trade side. */
type SideRule = '5m' | '15m' | 'htf' | 'or' | 'and';

interface Mode {
  id: string;
  /** Mark current production stack for easy scan in output. */
  liveRef?: boolean;
  side: SideRule;
  htf: Htf | null;
  pullback: boolean;
}

/**
 * LIVE ≈ env now: HTF=1h + flex 15m + pullback 15m + side-align via HTF/15m OR.
 * (Rule proxy — not full signal-gate/LLM.)
 */
const MODES: Mode[] = [
  // --- reference: current live ---
  {
    id: 'LIVE',
    liveRef: true,
    side: 'or',
    htf: '1h',
    pullback: true,
  },
  { id: 'LIVE_strict1h', liveRef: true, side: 'htf', htf: '1h', pullback: true },

  // --- 1h family (existing) ---
  { id: '5m_only', side: '5m', htf: null, pullback: false },
  { id: '5m+15m', side: '15m', htf: null, pullback: false },
  { id: '5m+1h', side: 'htf', htf: '1h', pullback: false },
  { id: '15m|1h', side: 'or', htf: '1h', pullback: false },
  { id: '15m&1h', side: 'and', htf: '1h', pullback: false },
  { id: 'lite_15_pb', side: '15m', htf: null, pullback: true },
  { id: '15m&1h_pb', side: 'and', htf: '1h', pullback: true },

  // --- 30m swap (1h → 30m) ---
  { id: '5m+30m', side: 'htf', htf: '30m', pullback: false },
  { id: '15m|30m', side: 'or', htf: '30m', pullback: false },
  { id: '15m&30m', side: 'and', htf: '30m', pullback: false },
  { id: '30m_pb', side: 'htf', htf: '30m', pullback: true },
  { id: '15m|30m_pb', side: 'or', htf: '30m', pullback: true },
  { id: '15m&30m_pb', side: 'and', htf: '30m', pullback: true },
];

interface Row {
  id: string;
  liveRef: boolean;
  n: number;
  wr: number;
  avgR: number;
  sumR: number;
  tp: number;
  sl: number;
  none: number;
}

function score(id: string, liveRef: boolean, paths: Path[], rr: number, fee = 0.05): Row {
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
  const wr = decided > 0 ? (tp / decided) * 100 : 0;
  return {
    id,
    liveRef,
    n,
    wr: +wr.toFixed(1),
    avgR: n ? +(sum / n).toFixed(4) : 0,
    sumR: +sum.toFixed(1),
    tp,
    sl,
    none,
  };
}

function resolveSide(
  rule: SideRule,
  t5: Side | null,
  t15: Side | null,
  tHtf: Side | null
): Side | null {
  switch (rule) {
    case '5m':
      return t5;
    case '15m':
      return t15;
    case 'htf':
      return tHtf;
    case 'or': {
      if (t15 && tHtf) return t15 === tHtf ? t15 : null;
      return t15 ?? tHtf;
    }
    case 'and':
      return t15 && tHtf && t15 === tHtf ? t15 : null;
    default:
      return null;
  }
}

async function main(): Promise<void> {
  const days = parseInt(arg('days', '360'), 10);
  const rr = parseFloat(arg('rr', '2'));
  const SL_PCT = 0.008;
  const maxAbove = 0.25;
  const maxBelow = 1.0;
  const step = 3;

  const endMs = Date.now();
  const startMs = endMs - days * 864e5;
  console.log('FETCH', { days, rr, SL_PCT, step, maxAbove, maxBelow });
  console.log('Downloading 5m/15m/30m/1h…');
  const [bars5, bars15, bars30, bars1h] = await Promise.all([
    fetchKlines('5m', startMs, endMs),
    fetchKlines('15m', startMs, endMs),
    fetchKlines('30m', startMs, endMs),
    fetchKlines('1h', startMs, endMs),
  ]);
  const c5 = bars5.map((b) => b.c);
  const c15 = bars15.map((b) => b.c);
  const c30 = bars30.map((b) => b.c);
  const c1h = bars1h.map((b) => b.c);
  console.log(
    `bars 5m=${bars5.length} 15m=${bars15.length} 30m=${bars30.length} 1h=${bars1h.length}`
  );
  console.log(
    'LIVE ref = env now: HTF=1h flex15m + pb15 (or); LIVE_strict1h = 1h-only + pb15'
  );

  const windows = [
    { label: '60d', days: 60 },
    { label: '180d', days: 180 },
    { label: '360d', days: Math.min(days, 360) },
  ].filter((w, i, a) => a.findIndex((x) => x.days === w.days) === i && w.days <= days);

  for (const w of windows) {
    const wStart = endMs - w.days * 864e5;
    console.log(`\n=== ${w.label} RR=${rr} SL=${SL_PCT * 100}% entry=5m ===`);
    console.log(
      'mode'.padEnd(16),
      'n'.padStart(5),
      'WR%'.padStart(6),
      'avgR'.padStart(8),
      'sumR'.padStart(8),
      'TP'.padStart(5),
      'SL'.padStart(5),
      'NONE'.padStart(5),
      'vsLIVE'.padStart(8),
      'verdict'
    );

    const rows: Row[] = [];
    for (const mode of MODES) {
      const paths: Path[] = [];
      for (let i = 50; i < bars5.length - 2; i++) {
        if (i % step !== 0) continue;
        const b = bars5[i];
        if (b.t < wStart || b.t > endMs) continue;

        const i15 = idxAtOrBefore(bars15, b.t);
        const i30 = idxAtOrBefore(bars30, b.t);
        const i1h = idxAtOrBefore(bars1h, b.t);
        if (i15 < 50) continue;
        if (mode.htf === '1h' && i1h < 50) continue;
        if (mode.htf === '30m' && i30 < 50) continue;

        const t5 = trendSide(c5, i);
        const t15 = trendSide(c15, i15);
        const tHtf =
          mode.htf === '1h'
            ? trendSide(c1h, i1h)
            : mode.htf === '30m'
              ? trendSide(c30, i30)
              : null;
        const side = resolveSide(mode.side, t5, t15, tHtf);
        if (!side) continue;

        if (mode.pullback) {
          const hist = c15.slice(Math.max(0, i15 - 19), i15 + 1);
          const pb = evaluateTrendPullbackEntry({
            side,
            entry: b.c,
            closes: hist,
            smaPeriod: 20,
            maxAbovePct: maxAbove,
            maxBelowPct: maxBelow,
            enabled: true,
          });
          if (!pb.pass) continue;
        }

        const entry = b.c;
        const sl = side === 'long' ? entry * (1 - SL_PCT) : entry * (1 + SL_PCT);
        const tpDist = SL_PCT * rr;
        const tp = side === 'long' ? entry * (1 + tpDist) : entry * (1 - tpDist);
        paths.push(pathAfter(bars5, i, side, sl, tp));
      }

      const row = score(mode.id, Boolean(mode.liveRef), paths, rr);
      rows.push(row);
    }

    const live = rows.find((r) => r.id === 'LIVE');
    const beWr = 100 / (1 + rr);
    for (const row of rows) {
      const ok = row.avgR > 0 && row.wr > beWr;
      const delta =
        live && row.id !== 'LIVE' ? (row.avgR - live.avgR).toFixed(4) : row.id === 'LIVE' ? 'REF' : '—';
      const tag = row.liveRef ? '*' : ' ';
      console.log(
        `${tag}${row.id}`.padEnd(16),
        String(row.n).padStart(5),
        String(row.wr).padStart(6),
        String(row.avgR).padStart(8),
        String(row.sumR).padStart(8),
        String(row.tp).padStart(5),
        String(row.sl).padStart(5),
        String(row.none).padStart(5),
        String(delta).padStart(8),
        ok ? 'PNL+' : 'PNL-'
      );
    }

    const bestAvg = [...rows].sort((a, b) => b.avgR - a.avgR)[0];
    const bestSum = [...rows].sort((a, b) => b.sumR - a.sumR)[0];
    const best30 = [...rows]
      .filter((r) => r.id.includes('30m'))
      .sort((a, b) => b.avgR - a.avgR)[0];
    console.log(
      `BEST_avgR: ${bestAvg.id} avgR=${bestAvg.avgR} | BEST_sumR: ${bestSum.id} sumR=${bestSum.sumR}`
    );
    if (live && best30) {
      const beat = best30.avgR > live.avgR ? 'BEATS LIVE' : 'below LIVE';
      console.log(
        `30m_best: ${best30.id} avgR=${best30.avgR} sumR=${best30.sumR} vs LIVE avgR=${live.avgR} → ${beat}`
      );
    }
  }

  console.log(
    '\nNOTE: Rule SMA20/50 + optional live pullback band. Entry path on 5m. Not LLM/signal-gate.'
  );
  console.log('* = live reference. vsLIVE = avgR delta vs LIVE (1h|15m + pb15).');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
