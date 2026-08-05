/**
 * Eval pullback gate for PnL+ proxy (counterfactual on LLM proposals).
 *
 * Compares strategies on same proposals + 15m first-hit SL/TP path:
 *   take_all | extension_0.8 | pullback_ema | pullback_better?
 *
 * Verdict PnL+:
 *   - pullback avgR > 0  AND
 *   - pullback avgR > take_all avgR  (strictly better than ungated)
 * else NOT_PNL_PLUS (exit 1 with --strict)
 *
 * Usage:
 *   npm run eval:pullback
 *   npm run eval:pullback -- --since=2026-07-27T14:13:00Z
 *   npm run eval:pullback -- --strict   # exit 1 if not PnL+
 */
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import {
  evaluateEntryExtension,
  evaluateTrendPullbackEntry,
  getV3PullbackMaxAbovePct,
  getV3PullbackMaxBelowPct,
  getV3PullbackSmaPeriod,
} from '../src/config/v3-entry-policy';

type Side = 'long' | 'short';
type Path = 'TP' | 'SL' | 'NONE';

interface Proposal {
  t: Date;
  side: Side;
  entry: number;
  sl: number;
  tp: number;
}

function argFlag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

function arg(name: string, fallback?: string): string | undefined {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  if (!hit) return fallback;
  return hit.slice(name.length + 3);
}

function parseProposal(reason: string, ts: Date): Proposal | null {
  const lm = reason.match(/entry ([0-9,.]+) · SL ([0-9,.]+) · TP ([0-9,.]+)/);
  if (!lm) return null;
  const side: Side | null = /LLM: buy/i.test(reason)
    ? 'long'
    : /LLM: sell/i.test(reason)
      ? 'short'
      : null;
  if (!side) return null;
  return {
    t: ts,
    side,
    entry: parseFloat(lm[1].replace(/,/g, '')),
    sl: parseFloat(lm[2].replace(/,/g, '')),
    tp: parseFloat(lm[3].replace(/,/g, '')),
  };
}

function rrMultiple(p: Proposal): number {
  const risk = Math.abs(p.entry - p.sl);
  if (!(risk > 0)) return 1.6;
  return Math.abs(p.tp - p.entry) / risk;
}

/** Realized R if entered: TP = +RR, SL = -1, NONE = 0 (scratch / open). Fee drag ~0.05R. */
function realizedR(path: Path, rr: number, feeR = 0.05): number {
  if (path === 'TP') return rr - feeR;
  if (path === 'SL') return -1 - feeR;
  return -feeR; // occupied capital / scratch tax if never hit (conservative)
}

async function pathFirstHit(
  side: Side,
  entry: number,
  sl: number,
  tp: number,
  fromIso: string,
  horizonH = 36
): Promise<Path> {
  const start = Date.parse(fromIso);
  const end = Math.min(start + horizonH * 3600_000, Date.now());
  const url =
    `https://fapi.binance.com/fapi/v1/klines?symbol=BTCUSDT&interval=15m` +
    `&startTime=${start}&endTime=${end}&limit=500`;
  const res = await fetch(url);
  if (!res.ok) return 'NONE';
  const ks = (await res.json()) as [number, string, string, string, string][];
  let hitSl: number | null = null;
  let hitTp: number | null = null;
  for (const k of ks) {
    const h = parseFloat(k[2]);
    const l = parseFloat(k[3]);
    const t = k[0];
    if (side === 'long') {
      if (hitSl == null && l <= sl) hitSl = t;
      if (hitTp == null && h >= tp) hitTp = t;
    } else {
      if (hitSl == null && h >= sl) hitSl = t;
      if (hitTp == null && l <= tp) hitTp = t;
    }
  }
  if (hitSl != null && hitTp != null) return hitSl <= hitTp ? 'SL' : 'TP';
  if (hitSl != null) return 'SL';
  if (hitTp != null) return 'TP';
  return 'NONE';
}

function selfCheck(): void {
  const flat = Array.from({ length: 20 }, () => 64000);
  const chase = evaluateTrendPullbackEntry({
    side: 'long',
    entry: 64500,
    closes: flat,
    enabled: true,
    maxAbovePct: 0.25,
    maxBelowPct: 1.0,
  });
  const atSma = evaluateTrendPullbackEntry({
    side: 'long',
    entry: 64000,
    closes: flat,
    enabled: true,
  });
  if (chase.pass || !atSma.pass) {
    throw new Error('self-check fail: chase must block, at-SMA must pass');
  }
  console.log('SELF_CHECK ok');
}

interface StratStats {
  name: string;
  nEnter: number;
  nSkip: number;
  tp: number;
  sl: number;
  none: number;
  sumR: number;
  avgR: number | null;
}

function emptyStats(name: string): StratStats {
  return { name, nEnter: 0, nSkip: 0, tp: 0, sl: 0, none: 0, sumR: 0, avgR: null };
}

function addTrade(s: StratStats, path: Path, rr: number): void {
  s.nEnter++;
  const r = realizedR(path, rr);
  s.sumR += r;
  if (path === 'TP') s.tp++;
  else if (path === 'SL') s.sl++;
  else s.none++;
}

function finalize(s: StratStats): StratStats {
  s.avgR = s.nEnter > 0 ? s.sumR / s.nEnter : null;
  return s;
}

async function main(): Promise<void> {
  selfCheck();

  const sinceIso = arg('since', '2026-07-27T14:13:00Z')!;
  const strict = argFlag('strict');
  const period = getV3PullbackSmaPeriod();
  const maxAbove = getV3PullbackMaxAbovePct();
  const maxBelow = getV3PullbackMaxBelowPct();
  const since = new Date(sinceIso);

  console.log('\nCONFIG', { since: sinceIso, period, maxAbove, maxBelow, strict });

  const prisma = new PrismaClient();
  const rows = await prisma.tradeDecision.findMany({
    where: {
      timestamp: { gte: since },
      method_id: 'kim_nghia',
      OR: [{ reason: { contains: 'LLM: buy' } }, { reason: { contains: 'LLM: sell' } }],
    },
    orderBy: { timestamp: 'asc' },
    select: { timestamp: true, reason: true },
  });

  const proposals: Proposal[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    const p = parseProposal(row.reason || '', row.timestamp);
    if (!p) continue;
    const key = `${p.side}:${Math.round(p.entry)}:${Math.floor(p.t.getTime() / 1_200_000)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    proposals.push(p);
  }
  console.log(`PROPOSALS ${proposals.length}\n`);

  const takeAll = emptyStats('take_all');
  const extOnly = emptyStats('extension_0.8');
  const pbOnly = emptyStats('pullback_ema');

  for (const p of proposals) {
    const endMs = p.t.getTime();
    const startMs = endMs - (period + 10) * 15 * 60_000;
    let histCloses: number[] = [];
    try {
      const res = await fetch(
        `https://fapi.binance.com/fapi/v1/klines?symbol=BTCUSDT&interval=15m&startTime=${startMs}&endTime=${endMs}&limit=${period + 5}`
      );
      if (res.ok) {
        const ks = (await res.json()) as [number, string, string, string, string][];
        histCloses = ks.map((k) => parseFloat(k[4]));
      }
    } catch {
      /* */
    }

    const pb = evaluateTrendPullbackEntry({
      side: p.side,
      entry: p.entry,
      closes: histCloses.length >= period ? histCloses : Array(period).fill(p.entry),
      smaPeriod: period,
      maxAbovePct: maxAbove,
      maxBelowPct: maxBelow,
      enabled: true,
    });

    let rangeHigh = p.entry * 1.01;
    let rangeLow = p.entry * 0.99;
    try {
      const hStart = endMs - 12 * 3600_000;
      const res = await fetch(
        `https://fapi.binance.com/fapi/v1/klines?symbol=BTCUSDT&interval=1h&startTime=${hStart}&endTime=${endMs}&limit=12`
      );
      if (res.ok) {
        const ks = (await res.json()) as [number, string, string, string, string][];
        if (ks.length >= 3) {
          rangeHigh = Math.max(...ks.map((k) => parseFloat(k[2])));
          rangeLow = Math.min(...ks.map((k) => parseFloat(k[3])));
        }
      }
    } catch {
      /* */
    }
    const ext = evaluateEntryExtension({
      side: p.side,
      entry: p.entry,
      rangeHigh,
      rangeLow,
      maxExtensionPct: 0.8,
      enabled: true,
    });

    const path = await pathFirstHit(p.side, p.entry, p.sl, p.tp, p.t.toISOString());
    const rr = rrMultiple(p);

    addTrade(takeAll, path, rr);
    if (ext.pass) addTrade(extOnly, path, rr);
    else extOnly.nSkip++;
    if (pb.pass) addTrade(pbOnly, path, rr);
    else pbOnly.nSkip++;
  }

  finalize(takeAll);
  finalize(extOnly);
  finalize(pbOnly);

  console.log('EXPECTANCY_PROXY (R per entered trade; fee≈0.05R; NONE≈-0.05R)');
  for (const s of [takeAll, extOnly, pbOnly]) {
    console.log(
      `${s.name.padEnd(16)} enter=${String(s.nEnter).padStart(2)} skip=${String(s.nSkip).padStart(2)} ` +
        `TP=${s.tp} SL=${s.sl} NONE=${s.none} sumR=${s.sumR.toFixed(2)} avgR=${s.avgR == null ? 'n/a' : s.avgR.toFixed(3)}`
    );
  }

  const pbAvg = pbOnly.avgR;
  const allAvg = takeAll.avgR;
  const extAvg = extOnly.avgR;

  const pbPositive = pbAvg != null && pbAvg > 0;
  const pbBetterThanAll = pbAvg != null && allAvg != null && pbAvg > allAvg;
  const pbBetterThanExt =
    pbAvg != null && extAvg != null && pbOnly.nEnter > 0 && pbAvg > extAvg;

  console.log('\nVERDICT');
  console.log({
    pullback_avgR_positive: pbPositive,
    pullback_better_than_take_all: pbBetterThanAll,
    pullback_better_than_extension: pbBetterThanExt,
    sample_enter_pullback: pbOnly.nEnter,
  });

  // PnL+: need positive avgR AND beat ungated baseline; need ≥5 enters for weak confidence
  const enoughSample = pbOnly.nEnter >= 5;
  const pnlPlus = enoughSample && pbPositive && pbBetterThanAll;

  if (!enoughSample) {
    console.log(
      `\nRESULT: INCONCLUSIVE — pullback only entered ${pbOnly.nEnter} (<5). Not enough to claim PnL+.`
    );
  } else if (pnlPlus) {
    console.log(
      `\nRESULT: PNL+_PROXY_YES — pullback avgR=${pbAvg!.toFixed(3)} > take_all ${allAvg!.toFixed(3)} and >0`
    );
  } else {
    console.log(
      `\nRESULT: PNL+_PROXY_NO — không hiệu quả trên sample này` +
        ` (avgR=${pbAvg == null ? 'n/a' : pbAvg.toFixed(3)}, take_all=${allAvg == null ? 'n/a' : allAvg.toFixed(3)},` +
        ` positive=${pbPositive}, better_than_all=${pbBetterThanAll})`
    );
  }

  await prisma.$disconnect();

  if (strict && !pnlPlus) {
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
