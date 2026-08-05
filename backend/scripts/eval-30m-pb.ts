/**
 * Deep eval: 5m + 30m + pullback15 vs LIVE (1h|15m + pb15).
 * Windows, monthly stability, L/S split, RR & band sensitivity.
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
    await new Promise((r) => setTimeout(r, 60));
  }
  return [...new Map(out.map((b) => [b.t, b])).values()].sort((a, b) => a.t - b.t);
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
  let lo = 0, hi = bars.length - 1, ans = -1;
  while (lo <= hi) {
    const m = (lo + hi) >> 1;
    if (bars[m].t <= t) { ans = m; lo = m + 1; } else hi = m - 1;
  }
  return ans;
}

type Mode = 'LIVE' | '30m_pb' | 'LIVE_strict1h' | '5m+30m_nopb';

interface Trade {
  t: number;
  side: Side;
  path: Path;
  mode: Mode;
}

function orSide(t15: Side | null, tHtf: Side | null): Side | null {
  if (t15 && tHtf) return t15 === tHtf ? t15 : null;
  return t15 ?? tHtf;
}

function collect(
  mode: Mode,
  bars5: Bar[], c5: number[],
  bars15: Bar[], c15: number[],
  bars30: Bar[], c30: number[],
  bars1h: Bar[], c1h: number[],
  wStart: number, endMs: number,
  rr: number, slPct: number,
  maxAbove: number, maxBelow: number,
  step: number
): Trade[] {
  const out: Trade[] = [];
  for (let i = 50; i < bars5.length - 2; i++) {
    if (i % step !== 0) continue;
    const b = bars5[i];
    if (b.t < wStart || b.t > endMs) continue;
    const i15 = idxAtOrBefore(bars15, b.t);
    const i30 = idxAtOrBefore(bars30, b.t);
    const i1h = idxAtOrBefore(bars1h, b.t);
    if (i15 < 50) continue;

    let side: Side | null = null;
    if (mode === 'LIVE') {
      if (i1h < 50) continue;
      side = orSide(trendSide(c15, i15), trendSide(c1h, i1h));
    } else if (mode === 'LIVE_strict1h') {
      if (i1h < 50) continue;
      side = trendSide(c1h, i1h);
    } else if (mode === '30m_pb' || mode === '5m+30m_nopb') {
      if (i30 < 50) continue;
      side = trendSide(c30, i30);
    }
    if (!side) continue;

    if (mode !== '5m+30m_nopb') {
      const hist = c15.slice(Math.max(0, i15 - 19), i15 + 1);
      const pb = evaluateTrendPullbackEntry({
        side, entry: b.c, closes: hist, smaPeriod: 20,
        maxAbovePct: maxAbove, maxBelowPct: maxBelow, enabled: true,
      });
      if (!pb.pass) continue;
    }

    const entry = b.c;
    const sl = side === 'long' ? entry * (1 - slPct) : entry * (1 + slPct);
    const tp = side === 'long' ? entry * (1 + slPct * rr) : entry * (1 - slPct * rr);
    out.push({ t: b.t, side, path: pathAfter(bars5, i, side, sl, tp), mode });
  }
  return out;
}

function metrics(trades: Trade[], rr: number, fee = 0.05) {
  let tp = 0, sl = 0, none = 0, sum = 0;
  let longN = 0, shortN = 0, longSum = 0, shortSum = 0;
  for (const tr of trades) {
    let r = -fee;
    if (tr.path === 'TP') { tp++; r = rr - fee; }
    else if (tr.path === 'SL') { sl++; r = -1 - fee; }
    else none++;
    sum += r;
    if (tr.side === 'long') { longN++; longSum += r; }
    else { shortN++; shortSum += r; }
  }
  const n = trades.length;
  const decided = tp + sl;
  const wr = decided > 0 ? (tp / decided) * 100 : 0;
  const beWr = 100 / (1 + rr);
  const avgR = n ? sum / n : 0;
  // profit factor approx in R
  let winR = 0, lossR = 0;
  for (const tr of trades) {
    if (tr.path === 'TP') winR += rr - fee;
    else if (tr.path === 'SL') lossR += 1 + fee;
  }
  const pf = lossR > 0 ? winR / lossR : winR > 0 ? Infinity : 0;
  return {
    n, tp, sl, none,
    wr: +wr.toFixed(1),
    beWr: +beWr.toFixed(1),
    avgR: +avgR.toFixed(4),
    sumR: +sum.toFixed(1),
    pf: +pf.toFixed(3),
    edgeVsBe: +(wr - beWr).toFixed(1),
    longN, shortN,
    longAvg: longN ? +(longSum / longN).toFixed(4) : 0,
    shortAvg: shortN ? +(shortSum / shortN).toFixed(4) : 0,
  };
}

function monthKey(t: number): string {
  const d = new Date(t);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

async function main() {
  const days = 360;
  const endMs = Date.now();
  const startMs = endMs - days * 864e5;
  const SL = 0.008;
  const step = 3;
  const maxAbove = 0.25;
  const maxBelow = 1.0;
  const rr = 2;

  console.log('DEEP EVAL: 5m + 30m + pb15 vs LIVE');
  console.log('Downloading…');
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
  console.log(`bars 5m=${bars5.length} 15m=${bars15.length} 30m=${bars30.length} 1h=${bars1h.length}\n`);

  const modes: Mode[] = ['LIVE', 'LIVE_strict1h', '30m_pb', '5m+30m_nopb'];
  const windows = [
    { label: '30d', d: 30 },
    { label: '60d', d: 60 },
    { label: '90d', d: 90 },
    { label: '180d', d: 180 },
    { label: '360d', d: 360 },
  ];

  console.log('=== A) Multi-window head-to-head (RR=2, pb band live) ===');
  console.log(
    'win'.padEnd(6), 'mode'.padEnd(14),
    'n'.padStart(5), 'WR'.padStart(6), 'need'.padStart(6), 'edge'.padStart(6),
    'avgR'.padStart(8), 'sumR'.padStart(8), 'PF'.padStart(6),
    'Lavg'.padStart(8), 'Savg'.padStart(8)
  );
  for (const w of windows) {
    const wStart = endMs - w.d * 864e5;
    for (const mode of modes) {
      const tr = collect(mode, bars5, c5, bars15, c15, bars30, c30, bars1h, c1h, wStart, endMs, rr, SL, maxAbove, maxBelow, step);
      const m = metrics(tr, rr);
      console.log(
        w.label.padEnd(6), mode.padEnd(14),
        String(m.n).padStart(5), String(m.wr).padStart(6), String(m.beWr).padStart(6), String(m.edgeVsBe).padStart(6),
        String(m.avgR).padStart(8), String(m.sumR).padStart(8), String(m.pf).padStart(6),
        String(m.longAvg).padStart(8), String(m.shortAvg).padStart(8)
      );
    }
    console.log('');
  }

  // Monthly walk for LIVE vs 30m_pb
  console.log('=== B) Monthly stability (last 12 months, LIVE vs 30m_pb) ===');
  const allLive = collect('LIVE', bars5, c5, bars15, c15, bars30, c30, bars1h, c1h, startMs, endMs, rr, SL, maxAbove, maxBelow, step);
  const all30 = collect('30m_pb', bars5, c5, bars15, c15, bars30, c30, bars1h, c1h, startMs, endMs, rr, SL, maxAbove, maxBelow, step);
  const months = [...new Set([...allLive, ...all30].map((t) => monthKey(t.t)))].sort();
  const last12 = months.slice(-12);
  console.log('month'.padEnd(9), 'LIVE_n'.padStart(6), 'LIVE_aR'.padStart(8), 'LIVE_sR'.padStart(8), '30_n'.padStart(6), '30_aR'.padStart(8), '30_sR'.padStart(8), 'winner'.padStart(8));
  let liveWinM = 0, m30WinM = 0, tieM = 0;
  for (const mk of last12) {
    const l = metrics(allLive.filter((t) => monthKey(t.t) === mk), rr);
    const t = metrics(all30.filter((t) => monthKey(t.t) === mk), rr);
    let winner = 'tie';
    if (t.avgR > l.avgR + 0.001) { winner = '30m_pb'; m30WinM++; }
    else if (l.avgR > t.avgR + 0.001) { winner = 'LIVE'; liveWinM++; }
    else tieM++;
    console.log(
      mk.padEnd(9),
      String(l.n).padStart(6), String(l.avgR).padStart(8), String(l.sumR).padStart(8),
      String(t.n).padStart(6), String(t.avgR).padStart(8), String(t.sumR).padStart(8),
      winner.padStart(8)
    );
  }
  console.log(`Month wins: LIVE=${liveWinM} 30m_pb=${m30WinM} tie=${tieM}\n`);

  // RR sensitivity
  console.log('=== C) RR sensitivity (360d) ===');
  console.log('rr'.padStart(4), 'mode'.padEnd(10), 'n'.padStart(5), 'WR'.padStart(6), 'avgR'.padStart(8), 'sumR'.padStart(8), 'PF'.padStart(6));
  for (const r of [1.5, 2, 2.5, 3]) {
    for (const mode of ['LIVE', '30m_pb'] as Mode[]) {
      const tr = collect(mode, bars5, c5, bars15, c15, bars30, c30, bars1h, c1h, startMs, endMs, r, SL, maxAbove, maxBelow, step);
      const m = metrics(tr, r);
      console.log(String(r).padStart(4), mode.padEnd(10), String(m.n).padStart(5), String(m.wr).padStart(6), String(m.avgR).padStart(8), String(m.sumR).padStart(8), String(m.pf).padStart(6));
    }
  }
  console.log('');

  // Pullback band sensitivity
  console.log('=== D) Pullback band sensitivity (360d, RR=2) ===');
  console.log('band'.padEnd(12), 'mode'.padEnd(10), 'n'.padStart(5), 'avgR'.padStart(8), 'sumR'.padStart(8), 'WR'.padStart(6));
  const bands: [number, number, string][] = [
    [0.15, 0.8, 'tight'],
    [0.25, 1.0, 'live'],
    [0.4, 1.5, 'loose'],
    [0.5, 2.0, 'very_loose'],
  ];
  for (const [a, b, name] of bands) {
    for (const mode of ['LIVE', '30m_pb'] as Mode[]) {
      const tr = collect(mode, bars5, c5, bars15, c15, bars30, c30, bars1h, c1h, startMs, endMs, 2, SL, a, b, step);
      const m = metrics(tr, 2);
      console.log(name.padEnd(12), mode.padEnd(10), String(m.n).padStart(5), String(m.avgR).padStart(8), String(m.sumR).padStart(8), String(m.wr).padStart(6));
    }
  }
  console.log('');

  // Overlap / disagreement
  console.log('=== E) Agreement LIVE vs 30m_pb (360d, same bar) ===');
  // rebuild bar-keyed sides for both at same sample points
  type Cand = { t: number; i: number; live: Side | null; m30: Side | null; livePb: boolean; m30Pb: boolean };
  const cands: Cand[] = [];
  for (let i = 50; i < bars5.length - 2; i++) {
    if (i % step !== 0) continue;
    const b = bars5[i];
    if (b.t < startMs) continue;
    const i15 = idxAtOrBefore(bars15, b.t);
    const i30 = idxAtOrBefore(bars30, b.t);
    const i1h = idxAtOrBefore(bars1h, b.t);
    if (i15 < 50 || i30 < 50 || i1h < 50) continue;
    const liveSide = orSide(trendSide(c15, i15), trendSide(c1h, i1h));
    const m30Side = trendSide(c30, i30);
    const pb = (side: Side) => {
      const hist = c15.slice(Math.max(0, i15 - 19), i15 + 1);
      return evaluateTrendPullbackEntry({
        side, entry: b.c, closes: hist, smaPeriod: 20,
        maxAbovePct: maxAbove, maxBelowPct: maxBelow, enabled: true,
      }).pass;
    };
    cands.push({
      t: b.t, i,
      live: liveSide,
      m30: m30Side,
      livePb: liveSide ? pb(liveSide) : false,
      m30Pb: m30Side ? pb(m30Side) : false,
    });
  }
  const bothTake = cands.filter((c) => c.live && c.livePb && c.m30 && c.m30Pb);
  const agree = bothTake.filter((c) => c.live === c.m30);
  const disagree = bothTake.filter((c) => c.live !== c.m30);
  const onlyLive = cands.filter((c) => c.live && c.livePb && !(c.m30 && c.m30Pb));
  const only30 = cands.filter((c) => c.m30 && c.m30Pb && !(c.live && c.livePb));
  console.log({
    sampleBars: cands.length,
    bothPassPb: bothTake.length,
    sameSide: agree.length,
    oppositeSide: disagree.length,
    onlyLIVE: onlyLive.length,
    only30m_pb: only30.length,
  });

  // Path quality on exclusive sets
  function pathScore(list: Cand[], pick: 'live' | 'm30') {
    const paths: Path[] = [];
    for (const c of list) {
      const side = pick === 'live' ? c.live! : c.m30!;
      const entry = bars5[c.i].c;
      const sl = side === 'long' ? entry * (1 - SL) : entry * (1 + SL);
      const tp = side === 'long' ? entry * (1 + SL * rr) : entry * (1 - SL * rr);
      paths.push(pathAfter(bars5, c.i, side, sl, tp));
    }
    const fake: Trade[] = paths.map((p, idx) => ({ t: list[idx].t, side: 'long', path: p, mode: 'LIVE' as Mode }));
    return metrics(fake, rr);
  }
  if (onlyLive.length) {
    const m = pathScore(onlyLive, 'live');
    console.log('onlyLIVE trades:', { n: m.n, avgR: m.avgR, wr: m.wr, sumR: m.sumR });
  }
  if (only30.length) {
    const m = pathScore(only30, 'm30');
    console.log('only30m_pb trades:', { n: m.n, avgR: m.avgR, wr: m.wr, sumR: m.sumR });
  }
  if (agree.length) {
    const m = pathScore(agree, 'm30');
    console.log('both_agree trades:', { n: m.n, avgR: m.avgR, wr: m.wr, sumR: m.sumR });
  }
  if (disagree.length) {
    const mL = pathScore(disagree, 'live');
    const m3 = pathScore(disagree, 'm30');
    console.log('disagree LIVE side:', { n: mL.n, avgR: mL.avgR, wr: mL.wr });
    console.log('disagree 30m side:', { n: m3.n, avgR: m3.avgR, wr: m3.wr });
  }

  console.log('\n=== VERDICT NOTES ===');
  const mLive = metrics(allLive, rr);
  const m30 = metrics(all30, rr);
  console.log('360d LIVE:', mLive);
  console.log('360d 30m_pb:', m30);
  console.log(
    `avgR delta 30m-LIVE = ${(m30.avgR - mLive.avgR).toFixed(4)}; sumR delta = ${(m30.sumR - mLive.sumR).toFixed(1)}; n ratio = ${(m30.n / mLive.n).toFixed(2)}`
  );
}
main().catch((e) => { console.error(e); process.exit(1); });
