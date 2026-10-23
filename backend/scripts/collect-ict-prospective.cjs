/** One-shot catch-up for frozen ICT prospective-v1. Public fapi GET only; no orders/AI/DB/runtime. */
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const {spawnSync} = require('node:child_process');
const {createJournal} = require('./prospective-journal.cjs');

const ROOT = path.resolve(__dirname, '../..');
const FREEZE = path.join(ROOT, 'docs/audits/2026-09-15-ict-opportunities/prospective-v1');
const OUT = path.join(ROOT, 'docs/audits/2026-09-15-ict-opportunities/prospective-collection');
const PUBLIC = 'https://fapi.binance.com';
const STEPS = { '4h': 14400000, '1h': 3600000, '15m': 900000, '1m': 60000 };
const TTL_MS = 3600000;

function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function verifyFreeze(manifest) {
  const mismatches = [];
  for (const [name, expected] of Object.entries(manifest.hashes)) {
    const got = sha256(path.join(FREEZE, name));
    if (got !== expected) mismatches.push({ name, expected, got });
  }
  if (mismatches.length) throw new Error('freeze_hash_mismatch ' + JSON.stringify(mismatches));
  return true;
}

function filterWindowCandidates(candidates, windowStart, windowEndExclusive) {
  return candidates.filter(
    (c) =>
      Number.isFinite(c.confirmedAt) &&
      c.confirmedAt >= windowStart &&
      c.confirmedAt < windowEndExclusive
  );
}

async function publicGet(endpoint) {
  const response = await fetch(PUBLIC + endpoint, { signal: AbortSignal.timeout(20000) });
  if (!response.ok) throw new Error('public_get_failed ' + endpoint + ' ' + response.status);
  return response.json();
}

async function serverTime() {
  const body = await publicGet('/fapi/v1/time');
  const t = Number(body.serverTime);
  if (!Number.isFinite(t)) throw new Error('bad_server_time');
  return t;
}

function mapBar(row) {
  return {
    openTime: Number(row[0]),
    timestamp: Number(row[0]),
    open: Number(row[1]),
    high: Number(row[2]),
    low: Number(row[3]),
    close: Number(row[4]),
    volume: Number(row[5]),
    closeTime: Number(row[6]),
    quoteVolume: Number(row[7]),
    trades: Number(row[8]),
    takerBuyBaseVolume: Number(row[9]),
    takerBuyQuoteVolume: Number(row[10]),
  };
}

function assertContinuous(bars, step, label) {
  if (!bars.length) throw new Error('empty_' + label);
  for (let i = 0; i < bars.length; i++) {
    const b = bars[i];
    if (![b.open, b.high, b.low, b.close, b.volume].every(Number.isFinite)) throw new Error('nan_' + label);
    if (b.low > Math.min(b.open, b.close) || b.high < Math.max(b.open, b.close) || b.volume < 0) {
      throw new Error('ohlc_' + label);
    }
    if (i && b.timestamp - bars[i - 1].timestamp !== step) throw new Error('gap_' + label + '_' + i);
  }
}

async function fetchKlines(interval, startTime, endExclusive) {
  const step = STEPS[interval];
  const out = [];
  let cursor = startTime;
  while (cursor < endExclusive) {
    const q =
      `/fapi/v1/klines?symbol=BTCUSDT&interval=${interval}` +
      `&startTime=${cursor}&endTime=${endExclusive - 1}&limit=1500`;
    const page = await publicGet(q);
    if (!Array.isArray(page) || !page.length) break;
    for (const row of page) {
      const b = mapBar(row);
      if (b.closeTime >= endExclusive) continue;
      if (!out.length || b.timestamp > out[out.length - 1].timestamp) out.push(b);
    }
    const lastOpen = Number(page[page.length - 1][0]);
    const next = lastOpen + step;
    if (next <= cursor) throw new Error('klines_pagination_stalled_' + interval);
    if (page.length < 1500) break;
    cursor = next;
  }
  assertContinuous(out, step, interval);
  return out;
}

async function fetchFunding(from, through) {
  const rows = [];
  let cursor = from;
  let pages = 0;
  while (cursor < through) {
    const page = await publicGet(
      `/fapi/v1/fundingRate?symbol=BTCUSDT&startTime=${cursor}&endTime=${through - 1}&limit=1000`
    );
    if (!Array.isArray(page)) throw new Error('bad_funding');
    pages++;
    for (const x of page) {
      rows.push({
        timestamp: Number(x.fundingTime),
        rate: Number(x.fundingRate),
        markPrice: Number(x.markPrice),
      });
    }
    if (page.length < 1000) break;
    const next = Number(page[page.length - 1].fundingTime) + 1;
    if (next <= cursor) throw new Error('funding_pagination_stalled');
    cursor = next;
  }
  for (let i = 0; i < rows.length; i++) {
    const x = rows[i];
    if (![x.timestamp, x.rate, x.markPrice].every(Number.isFinite) || x.markPrice <= 0) {
      throw new Error('invalid_funding_row');
    }
    if (i && x.timestamp <= rows[i - 1].timestamp) throw new Error('funding_order');
  }
  return { from, through, rows, pages, source: 'fapi.binance.com' };
}

function runPython(script, args) {
  const r = spawnSync('python3', [script, ...args], {
    cwd: FREEZE,
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
  });
  if (r.status !== 0) throw new Error((r.stderr || r.stdout || 'python_failed').slice(0, 2000));
  return r.stdout;
}

/** Isolated sizing probe mirroring ReplayAccount 3% cap + min lot — not full live admission. */
function probeAdmission(candidate, wallet = 33.59964603) {
  const entry = Number(candidate.entry);
  const stop = Number(candidate.stopLoss);
  if (![entry, stop, wallet].every((x) => Number.isFinite(x) && x > 0)) {
    return { accepted: false, reason: 'invalid_levels', quantity: null, totalRiskUsd: null, capUsd: wallet * 0.03 };
  }
  const stopFraction = Math.abs(entry - stop) / entry;
  if (!(stopFraction > 0)) {
    return { accepted: false, reason: 'invalid_stop', quantity: null, totalRiskUsd: null, capUsd: wallet * 0.03 };
  }
  const targetRiskPct = 0.5;
  const desired = Math.min(wallet * 50, (wallet * targetRiskPct) / 100 / stopFraction); // ponytail: exposure ceiling soft; full maxExposure from live unused
  const quantity = Math.max(
    0.001,
    Math.ceil(50 / entry / 0.001 - 1e-9) * 0.001,
    Math.floor(desired / entry / 0.001 + 1e-9) * 0.001
  );
  const priceRiskUsd = Math.abs(entry - stop) * quantity;
  const feeReserveUsd = Math.max(entry, stop) * quantity * 0.001;
  const slippageReserveUsd = entry * quantity * 0.001;
  const totalRiskUsd = priceRiskUsd + feeReserveUsd + slippageReserveUsd;
  const capUsd = wallet * 0.03;
  if (totalRiskUsd > capUsd + 1e-9) {
    return { accepted: false, reason: 'execution_risk', quantity, totalRiskUsd, capUsd };
  }
  return { accepted: true, reason: null, quantity, totalRiskUsd, capUsd };
}

function summarizeReplay(results) {
  const counts = {};
  for (const r of results) {
    counts[r.state] = (counts[r.state] || 0) + 1;
  }
  const n = results.length || 1;
  return {
    byState: counts,
    fillRate: (counts.closed_assumed_fill || 0) / n,
    expireRate: (counts.expired_without_fill || 0) / n,
    ambiguousRate: (counts.ambiguous_entry_exit_same_minute || 0) / n,
    invalidRate: (counts.invalid_levels || 0) / n,
  };
}

async function collectOnce(nowFn = serverTime) {
  const manifest = JSON.parse(fs.readFileSync(path.join(FREEZE, 'manifest.json'), 'utf8'));
  verifyFreeze(manifest);
  const windowStart = Date.parse(manifest.candidateWindowStart);
  const windowEnd = Date.parse(manifest.candidateWindowEndExclusive);
  if (![windowStart, windowEnd].every(Number.isFinite) || windowEnd <= windowStart) {
    throw new Error('bad_window');
  }
  const asOf = await nowFn();
  if (asOf < windowStart) throw new Error('before_window');
  const effectiveEnd = Math.min(asOf, windowEnd);
  const warmup = manifest.warmup;
  const candles = {};
  for (const tf of ['4h', '1h', '15m']) {
    const start = windowStart - warmup[tf] * STEPS[tf];
    candles[tf] = await fetchKlines(tf, start, effectiveEnd);
    if (candles[tf].length < warmup[tf]) throw new Error('warmup_short_' + tf);
  }
  fs.mkdirSync(OUT, { recursive: true, mode: 0o700 });
  const journal = createJournal(OUT);
  const runKey = 'run-' + Math.floor(asOf / 900000);
  const candlePath = path.join(OUT, runKey + '-candles.json');
  const detPath = path.join(OUT, runKey + '-detector.json');
  const candlePayload = {
    asOf,
    source: 'fapi.binance.com',
    symbol: 'BTCUSDT',
    role: 'prospective_v1_collection',
    windowStart,
    windowEndExclusive: windowEnd,
    candles,
  };
  fs.writeFileSync(candlePath, JSON.stringify(candlePayload, null, 2) + '\n', { mode: 0o600 });
  runPython(path.join(FREEZE, 'research_ict_fvg.py'), [candlePath, detPath]);
  const detector = JSON.parse(fs.readFileSync(detPath, 'utf8'));
  const inWindow = filterWindowCandidates(detector.candidates, windowStart, windowEnd);
  const windows = {};
  const pending = [];
  const ready = [];
  for (const c of inWindow) {
    const start = c.confirmedAt + 1;
    const expiry = start + TTL_MS;
    if (asOf < expiry) {
      pending.push({ id: c.id, confirmedAt: c.confirmedAt, reason: 'ttl_not_elapsed' });
      continue;
    }
    const bars = await fetchKlines('1m', start, expiry);
    if (bars.length !== 60) throw new Error('incomplete_1m_ttl_' + c.id + '_' + bars.length);
    windows[c.id] = bars;
    ready.push(c);
  }
  let replay = null;
  let funding = null;
  if (ready.length) {
    const candPath = path.join(OUT, runKey + '-ready-candidates.json');
    const onePath = path.join(OUT, runKey + '-1m.json');
    const replayPath = path.join(OUT, runKey + '-replay.json');
    fs.writeFileSync(candPath, JSON.stringify({ candidates: ready }, null, 2) + '\n', { mode: 0o600 });
    const onePayload = { asOf, source: 'fapi.binance.com', windows };
    fs.writeFileSync(onePath, JSON.stringify(onePayload, null, 2) + '\n', { mode: 0o600 });
    const fundFrom = Math.min(...ready.map((c) => c.confirmedAt + 1));
    const fundThrough = Math.max(...ready.map((c) => c.confirmedAt + 1 + TTL_MS));
    funding = await fetchFunding(fundFrom, Math.min(fundThrough, asOf));
    fs.writeFileSync(path.join(OUT, runKey + '-funding.json'), JSON.stringify(funding, null, 2) + '\n', {
      mode: 0o600,
    });
    runPython(path.join(FREEZE, 'replay_ict_1m.py'), [candPath, onePath, replayPath]);
    replay = JSON.parse(fs.readFileSync(replayPath, 'utf8'));
  }
  const admissionProbes = inWindow.map((c) => ({
    id: c.id,
    role: 'isolated_sizing_probe_not_live_admission_or_portfolio',
    side: c.side,
    entry: c.entry,
    stopLoss: c.stopLoss,
    rr: c.rr ?? null,
    admission: probeAdmission(c),
  }));
  fs.writeFileSync(path.join(OUT, runKey + '-admission-probe.json'), JSON.stringify(admissionProbes, null, 2) + '\n', {
    mode: 0o600,
  });
  const replayResults = replay ? replay.results : [];
  const replayRates = summarizeReplay(replayResults);
  const sizingRejects = admissionProbes.filter((p) => !p.admission.accepted);
  const summary = {
    asOf,
    asOfIso: new Date(asOf).toISOString(),
    source: 'fapi.binance.com',
    freeze: 'prospective-v1',
    freezeVersion: 'prospective-v1',
    freezeVerified: true,
    freezeHashes: manifest.hashes,
    detectorPolicy: detector.policy ?? null,
    detectorCodeSha256: detector.codeSha256 ?? null,
    detectorPolicySha256: detector.policySha256 ?? null,
    windowStart: manifest.candidateWindowStart,
    windowEndExclusive: manifest.candidateWindowEndExclusive,
    bars: Object.fromEntries(Object.entries(candles).map(([tf, rows]) => [tf, rows.length])),
    detectorCandidatesTotal: detector.candidates.length,
    inWindow: inWindow.length,
    readyForReplay: ready.length,
    pendingTtl: pending,
    replayResults,
    replayRates,
    admissionProbes,
    admissionRejectRate: inWindow.length ? sizingRejects.length / inWindow.length : 0,
    admissionRejectReasons: sizingRejects.reduce((acc, p) => {
      const r = p.admission.reason || 'unknown';
      acc[r] = (acc[r] || 0) + 1;
      return acc;
    }, {}),
    fundingRows: funding ? funding.rows.length : 0,
    portfolioRoi: null,
    ordersPossible: false,
    cooldownPolicyMinutes: 60,
    maxRiskPercent: 3,
    dailyLossPercent: 10,
    limitations: [
      'Catch-up one-shot; not continuous scheduler.',
      'Sizing probe uses 3% wallet cap + min lot; not full live guard/cooldown parity.',
      'No claim of ROI+; unresolved or zero-fill outcomes stay non-promotional.',
      'Freeze hashes verified; detector params not retuned mid-run.',
    ],
    hashes: {
      collector: sha256(__filename),
      candles: sha256(candlePath),
      detector: sha256(detPath),
      research: sha256(path.join(FREEZE, 'research_ict_fvg.py')),
      replay: sha256(path.join(FREEZE, 'replay_ict_1m.py')),
    },
  };
  if (!journal.exclusive(runKey, summary)) {
    return { ...summary, reason: 'run_already_recorded' };
  }
  return summary;
}

module.exports = {
  verifyFreeze,
  filterWindowCandidates,
  sha256,
  FREEZE,
  collectOnce,
  probeAdmission,
  summarizeReplay,
};

if (require.main === module) {
  collectOnce()
    .then((s) => {
      console.log(JSON.stringify(s, null, 2));
    })
    .catch((e) => {
      console.error(e.message || e);
      process.exitCode = 1;
    });
}
