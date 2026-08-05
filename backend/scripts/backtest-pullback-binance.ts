/**
 * Binance OHLCV backtest: pullback EMA vs take_all / extension (no LLM).
 *
 * Pulls BTCUSDT 15m + 1h futures klines, simulates:
 *   - Proposal each 15m bar when 1h SMA20 trend clear
 *   - entry=close, SL=0.8%, TP=1.6% (approx live RR)
 *   - Gates: none | extension 0.8% on 12×1h range | pullback SMA20 band
 *   - One position at a time; path = first hit SL/TP on subsequent 15m bars
 *
 * Usage:
 *   npx tsx scripts/backtest-pullback-binance.ts
 *   npx tsx scripts/backtest-pullback-binance.ts --days=180
 *   npx tsx scripts/backtest-pullback-binance.ts --days=360 --strict
 */
import {
  evaluateEntryExtension,
  evaluateTrendPullbackEntry,
} from '../src/config/v3-entry-policy';

type Side = 'long' | 'short';
type Path = 'TP' | 'SL' | 'NONE';

interface Bar {
  t: number;
  o: number;
  h: number;
  l: number;
  c: number;
}

function arg(name: string, fallback?: string): string | undefined {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  if (!hit) return fallback;
  return hit.slice(name.length + 3);
}

function argFlag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

async function fetchKlines(interval: string, startMs: number, endMs: number): Promise<Bar[]> {
  const out: Bar[] = [];
  let cursor = startMs;
  const limit = 1500;
  while (cursor < endMs) {
    const url =
      `https://fapi.binance.com/fapi/v1/klines?symbol=BTCUSDT&interval=${interval}` +
      `&startTime=${cursor}&endTime=${endMs}&limit=${limit}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`klines ${interval} HTTP ${res.status}`);
    const ks = (await res.json()) as [number, string, string, string, string][];
    if (!ks.length) break;
    for (const k of ks) {
      out.push({
        t: k[0],
        o: parseFloat(k[1]),
        h: parseFloat(k[2]),
        l: parseFloat(k[3]),
        c: parseFloat(k[4]),
      });
    }
    const lastT = ks[ks.length - 1][0];
    const next = lastT + 1;
    if (next <= cursor) break;
    cursor = next;
    if (ks.length < limit) break;
    await new Promise((r) => setTimeout(r, 120)); // be kind to API
  }
  // dedupe by t
  const byT = new Map<number, Bar>();
  for (const b of out) byT.set(b.t, b);
  return [...byT.values()].sort((a, b) => a.t - b.t);
}

function sma(closes: number[], period: number, i: number): number | null {
  if (i + 1 < period) return null;
  let s = 0;
  for (let j = i - period + 1; j <= i; j++) s += closes[j];
  return s / period;
}

function pathAfter(
  bars: Bar[],
  fromIdx: number,
  side: Side,
  entry: number,
  sl: number,
  tp: number
): Path {
  for (let i = fromIdx + 1; i < bars.length; i++) {
    const b = bars[i];
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

function realizedR(path: Path, rr = 2, feeR = 0.05): number {
  if (path === 'TP') return rr - feeR;
  if (path === 'SL') return -1 - feeR;
  return -feeR;
}

interface Strat {
  name: string;
  n: number;
  tp: number;
  sl: number;
  none: number;
  sumR: number;
  avgR: number | null;
}

function empty(name: string): Strat {
  return { name, n: 0, tp: 0, sl: 0, none: 0, sumR: 0, avgR: null };
}

function add(s: Strat, path: Path, rr: number): void {
  s.n++;
  s.sumR += realizedR(path, rr);
  if (path === 'TP') s.tp++;
  else if (path === 'SL') s.sl++;
  else s.none++;
}

function fin(s: Strat): Strat {
  s.avgR = s.n > 0 ? s.sumR / s.n : null;
  return s;
}

function runWindow(
  label: string,
  bars15: Bar[],
  bars1h: Bar[],
  startMs: number,
  endMs: number,
  maxAbove: number,
  maxBelow: number
): { takeAll: Strat; ext: Strat; pb: Strat } {
  const closes15 = bars15.map((b) => b.c);
  const closes1h = bars1h.map((b) => b.c);

  // map 1h index by time
  const hIdxAt = (t: number): number => {
    let lo = 0;
    let hi = bars1h.length - 1;
    let ans = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (bars1h[mid].t <= t) {
        ans = mid;
        lo = mid + 1;
      } else hi = mid - 1;
    }
    return ans;
  };

  const takeAll = empty('take_all');
  const ext = empty('extension_0.8');
  const pb = empty('pullback_ema');

  let proposals = 0;
  const SL_PCT = 0.008;
  const TP_PCT = 0.016;
  const rr = TP_PCT / SL_PCT; // 2

  for (let i = 50; i < bars15.length - 2; i++) {
    const b = bars15[i];
    if (b.t < startMs || b.t > endMs) continue;
    // sparse: one candidate per 4h
    if (i % 16 !== 0) continue;

    const hi = hIdxAt(b.t);
    if (hi < 50) continue;
    const sma1h = sma(closes1h, 20, hi);
    const sma1hPrev = sma(closes1h, 50, hi);
    if (sma1h == null || sma1hPrev == null) continue;

    let side: Side | null = null;
    if (closes1h[hi] > sma1h && sma1h > sma1hPrev) side = 'long';
    else if (closes1h[hi] < sma1h && sma1h < sma1hPrev) side = 'short';
    if (!side) continue;

    const entry = b.c;
    const sl = side === 'long' ? entry * (1 - SL_PCT) : entry * (1 + SL_PCT);
    const tp = side === 'long' ? entry * (1 + TP_PCT) : entry * (1 - TP_PCT);

    const hStart = Math.max(0, hi - 11);
    const sliceH = bars1h.slice(hStart, hi + 1);
    const rangeHigh = Math.max(...sliceH.map((x) => x.h));
    const rangeLow = Math.min(...sliceH.map((x) => x.l));

    const histCloses = closes15.slice(Math.max(0, i - 19), i + 1);
    const pbRes = evaluateTrendPullbackEntry({
      side,
      entry,
      closes: histCloses,
      smaPeriod: 20,
      maxAbovePct: maxAbove,
      maxBelowPct: maxBelow,
      enabled: true,
    });
    const extRes = evaluateEntryExtension({
      side,
      entry,
      rangeHigh,
      rangeLow,
      maxExtensionPct: 0.8,
      enabled: true,
    });

    const path = pathAfter(bars15, i, side, entry, sl, tp);
    proposals++;

    add(takeAll, path, rr);
    if (extRes.pass) add(ext, path, rr);
    if (pbRes.pass) add(pb, path, rr);
  }

  console.log(`\n=== ${label} (proposals=${proposals}) ===`);
  for (const s of [takeAll, ext, pb].map(fin)) {
    console.log(
      `${s.name.padEnd(16)} n=${String(s.n).padStart(4)} TP=${s.tp} SL=${s.sl} NONE=${s.none} ` +
        `sumR=${s.sumR.toFixed(1)} avgR=${s.avgR == null ? 'n/a' : s.avgR.toFixed(3)}`
    );
  }
  return { takeAll: fin(takeAll), ext: fin(ext), pb: fin(pb) };
}

async function main(): Promise<void> {
  const days = parseInt(arg('days', '360') || '360', 10);
  const maxAbove = parseFloat(arg('maxAbove', '0.25') || '0.25');
  const maxBelow = parseFloat(arg('maxBelow', '1.0') || '1.0');
  const strict = argFlag('strict');

  const endMs = Date.now();
  const startMs = endMs - days * 864e5;
  console.log('FETCH Binance BTCUSDT futures', {
    days,
    from: new Date(startMs).toISOString().slice(0, 10),
    to: new Date(endMs).toISOString().slice(0, 10),
    maxAbove,
    maxBelow,
  });

  console.log('Downloading 15m…');
  const bars15 = await fetchKlines('15m', startMs, endMs);
  console.log('Downloading 1h…');
  const bars1h = await fetchKlines('1h', startMs, endMs);
  console.log(`bars 15m=${bars15.length} 1h=${bars1h.length}`);

  if (bars15.length < 100 || bars1h.length < 50) {
    throw new Error('insufficient klines');
  }

  const windows: Array<{ label: string; days: number }> = [];
  if (days >= 360) windows.push({ label: 'LAST_360d', days: 360 });
  if (days >= 180) windows.push({ label: 'LAST_180d', days: 180 });
  windows.push({ label: `LAST_${Math.min(days, 60)}d`, days: Math.min(days, 60) });

  // dedupe window sizes
  const seen = new Set<number>();
  const unique = windows.filter((w) => {
    if (seen.has(w.days)) return false;
    seen.add(w.days);
    return true;
  });

  let anyPnlPlus = false;
  for (const w of unique) {
    const wStart = endMs - w.days * 864e5;
    const { takeAll, pb } = runWindow(w.label, bars15, bars1h, wStart, endMs, maxAbove, maxBelow);
    const pbAvg = pb.avgR;
    const allAvg = takeAll.avgR;
    const ok =
      pb.n >= 20 &&
      pbAvg != null &&
      allAvg != null &&
      pbAvg > 0 &&
      pbAvg > allAvg;
    console.log(
      `VERDICT_${w.label}`,
      ok ? 'PNL+_PROXY_YES' : 'PNL+_PROXY_NO',
      { pbAvg, allAvg, n: pb.n }
    );
    if (ok) anyPnlPlus = true;
  }

  console.log(
    '\nNOTE: Rule backtest (1h SMA trend + 15m propose every 4h) — not LLM replay. ' +
      'Fee≈0.05R. ONE position sequencing on take_all path.'
  );

  if (strict && !anyPnlPlus) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
