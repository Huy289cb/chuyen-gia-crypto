import { afterEach, describe, expect, it, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildLiveTelemetryRecord, LiveEquityTelemetry } from '../../src/portfolio/live-telemetry';
import type { LivePortfolioWallet } from '../../src/portfolio/live-service';

vi.setConfig({ testTimeout: 30_000, hookTimeout: 30_000 });
const directories: string[] = [];
afterEach(async () => { vi.restoreAllMocks(); for (const directory of directories.splice(0)) await fs.rm(directory, { recursive: true, force: true }); });
const time = Date.parse('2026-10-18T12:00:00Z');
function wallet(): LivePortfolioWallet {
  return { schema: 'authenticated-portfolio-live-v1', policyId: 'CONSTANT_DIRECTION_B5_S6_DAILY15_V1',
    config: { initialCash: '31.47744546', dailyLossLimitUsd: '15', closeBufferUsd: '6.1', softLossThresholdUsd: '-8.9',
      grossCap: '8', leverage: '10', bandThreshold: '.2', slippageBps: '2' }, accountIdentity: 'private-account-must-not-appear',
    handoffSha256: 'private-handoff-must-not-appear', startedAtMs: time - 3_600_000, lastObservedAtMs: time,
    bootstrapAccountEquity: '31.47744546', accountEquity: '31.67744546', availableBalance: '29',
    equity: '31.67744546', netCashflow: '0', netPnl: '.2', equityQuality: 'reconciled', unreconciledWalletDelta: '0',
    positions: { ETHUSDT: { quantity: '1', averageEntry: '100' } }, actualPositions: [],
    totalFees: '.20139548', fundingPnl: '-.00334354', realizedPnl: '-.11601', trades: [], incomes: [],
    processedTradeIds: [], processedIncomeIds: [], intents: [], currentDay: { day: '2026-10-18', anchorEquity: '31.28582681',
      anchorTimeMs: time - 1_000_000, anchorQuality: 'exact_boundary', netCashflow: '0', netPnl: '.39161865',
      worstNetPnl: '-.18733953', breachUsd: '0', riskLatched: false, latchReason: null }, days: [],
    historyThroughMs: time - 1000, sourceCursorMs: time - 43_200_000, lastSourceId: 'source-owned', sourceDisposition: 'consumed',
    status: 'active', blockedReason: null, continuousRiskGuarantee: false,
    lastObservation: { observedAtMs: time, oldestQuoteAtMs: time - 100, marks: { ETHUSDT: '102' },
      references: { ETHUSDT: '102' }, bids: { ETHUSDT: '101.9' }, asks: { ETHUSDT: '102.1' },
      feeRate: '.0005', authenticatedCashBalance: '29.67744546', background: { errors: {} } } };
}
async function fixture(options: { retentionDays?: number; maxQueuedRecords?: number; maxJournalBytesPerDay?: number } = {}) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'live-telemetry-')); directories.push(directory);
  let now = time;
  const recorder = new LiveEquityTelemetry({ directory, now: () => now, ...options });
  const read = async (name = 'equity-2026-10-18.jsonl') => (await fs.readFile(path.join(directory, 'telemetry', name), 'utf8'))
    .trim().split('\n').map(line => JSON.parse(line));
  return { directory, recorder, read, setNow: (value: number) => { now = value; },
    latest: async () => JSON.parse(await fs.readFile(path.join(directory, 'telemetry/latest.json'), 'utf8')) };
}

describe('bounded live equity and cost telemetry', () => {
  it('uses exact capital31.47744546 and retains the15u financial limits without modifying the wallet', () => {
    const w = wallet(), before = JSON.stringify(w), record = buildLiveTelemetryRecord(w, time);
    expect(record.values.initialCapital).toBe('31.47744546');
    expect(record.state).toMatchObject({ dailyLossLimit: '15', softLossThreshold: '-8.9', closeBuffer: '6.1' });
    expect(record.values).toMatchObject({ netPnl: '0.2', feesPaid: '0.20139548', fundingPnl: '-0.00334354',
      realizedPnl: '-0.11601', authenticatedCashBalance: '29.67744546', unrealizedMarkPnl: '2' });
    expect(JSON.stringify(w)).toBe(before);
  });
  it('estimates closing from the observed bid, adverse slippage and taker fee, without deducting past costs twice', () => {
    const record = buildLiveTelemetryRecord(wallet(), time);
    expect(record.exitEstimate).toMatchObject({ model: 'adverse-book-slippage-taker-v1', takerFeeRate: '0.0005',
      fee: '0.05093981', adverseMarkToFill: '0.12038', totalCost: '0.17131981', netPnlAfterEstimatedExit: '0.02868019' });
    expect(record.values.netPnl).toBe('0.2');
  });
  it('never converts a favourable quote into guaranteed extra profit', () => {
    const w = wallet(); w.lastObservation.bids = { ETHUSDT: '103' }; w.lastObservation.asks = { ETHUSDT: '104' };
    const record = buildLiveTelemetryRecord(w, time);
    expect(record.exitEstimate.adverseMarkToFill).toBe('0');
    expect(record.exitEstimate.totalCost).toBe('0.0514897');
  });
  it('labels legacy missing quotes and cash as unknown, rather than synthesizing zero fees or cash', () => {
    const w = wallet(); delete w.lastObservation.bids; delete w.lastObservation.asks;
    delete w.lastObservation.authenticatedCashBalance; delete w.lastObservation.oldestQuoteAtMs;
    const record = buildLiveTelemetryRecord(w, time);
    expect(record.values.authenticatedCashBalance).toBeNull(); expect(record.quality.quoteFresh).toBe(false);
    expect(record.exitEstimate).toMatchObject({ fee: null, totalCost: null, netPnlAfterEstimatedExit: null, missingSymbols: ['ETHUSDT'] });
  });
  it('shows a zero close cost for genuinely flat inventory even before fee metadata is available', () => {
    const w = wallet(); w.positions = {}; w.lastObservation = {};
    const record = buildLiveTelemetryRecord(w, time);
    expect(record.exitEstimate.totalCost).toBe('0'); expect(record.exitEstimate.netPnlAfterEstimatedExit).toBe('0.2');
    expect(record.values.unrealizedMarkPnl).toBe('0');
  });
  it('preserves the true observation timestamp and conservative quality on an error/stale snapshot', () => {
    const w = wallet(); w.equityQuality = 'conservative_pending_income'; w.unreconciledWalletDelta = '-.3';
    const record = buildLiveTelemetryRecord(w, time + 60_000, 'error', 'live_worker_tick_failed');
    expect(record.observedAtMs).toBe(time); expect(record.recordedAtMs).toBe(time + 60_000);
    expect(record.quality).toMatchObject({ observationFresh: false, quoteFresh: false, observationAgeMs: 60_000,
      equityQuality: 'conservative_pending_income', unreconciledWalletDelta: '-0.3', workerErrorCode: 'live_worker_tick_failed' });
    expect(record.values.allocatedEquity).toBe('31.67744546');
  });
  it('measures actual exposure while an ACK is waiting for fill history, without inventing a confirmed fill', () => {
    const w = wallet(); w.positions = {}; w.actualPositions = [{ symbol: 'ETHUSDT', positionAmt: '1', entryPrice: '100' }];
    w.equityQuality = 'conservative_pending_income'; w.status = 'reconciliation_required';
    const record = buildLiveTelemetryRecord(w, time);
    expect(record.positions).toHaveLength(1); expect(record.positions[0].quantity).toBe('1');
    expect(record.quality).toMatchObject({ inventorySource: 'authenticated_positions', inventoryReconciled: false });
    expect(record.exitEstimate.totalCost).toBe('0.17131981'); expect(record.references.fillCount).toBe(0);
  });
  it('uses an authenticated empty position response after a close while the confirmed fill ledger is still stale', () => {
    const w = wallet(); w.lastObservation.authenticatedPositionsObserved = true;
    w.actualPositions = [];
    w.intents = [{ clientOrderId: 'owned-close', sourceId: 'source-owned', symbol: 'ETHUSDT', quantity: '-1',
      reduceOnly: true, createdAtMs: time, submittedOnce: true, status: 'FILLED', orderId: '9007199254740994',
      executedQty: '1', observedFillQty: '0', lastError: null }];
    w.equityQuality = 'conservative_pending_income'; w.status = 'reconciliation_required';
    const before = JSON.stringify(w), record = buildLiveTelemetryRecord(w, time);
    expect(record.positions).toEqual([]);
    expect(record.quality).toMatchObject({ observationFresh: true, inventorySource: 'authenticated_positions', inventoryReconciled: false });
    expect(record.values.unrealizedMarkPnl).toBe('0');
    expect(record.exitEstimate).toMatchObject({ fee: '0', adverseMarkToFill: '0', totalCost: '0', netPnlAfterEstimatedExit: '0.2' });
    expect(record.references.fillCount).toBe(0);
    expect(JSON.stringify(w)).toBe(before);
  });
  it('keeps legacy empty unproven inventory distinct from an authenticated flat observation', () => {
    const record = buildLiveTelemetryRecord(wallet(), time);
    expect(record.positions).toHaveLength(1);
    expect(record.quality).toMatchObject({ inventorySource: 'confirmed_fill_ledger', inventoryReconciled: null });
    expect(record.values.unrealizedMarkPnl).toBe('2');
  });
  it('does not estimate from malformed authenticated inventory or pretend it is a flat account', () => {
    const w = wallet(); w.actualPositions = [{ symbol: 'ETHUSDT', positionAmt: 'unknown', entryPrice: '100' }];
    const record = buildLiveTelemetryRecord(w, time);
    expect(record.quality.inventoryReconciled).toBe(false); expect(record.exitEstimate.totalCost).toBeNull();
    expect(record.exitEstimate.missingSymbols).toContain('invalid_authenticated_inventory');
  });
  it('omits account identity, handoff, raw errors and exchange object extras from diagnostic files', () => {
    const w = wallet(); w.trades = [{ symbol: 'ETHUSDT', id: '9007199254740993', orderId: '9007199254740994',
      time, side: 'BUY', qty: '1', price: '100', commission: '.05', realizedPnl: '0', apiKey: 'never-copy-extra-secret' }];
    w.lastObservation.background = { errors: { history: 'never-copy-http-token' } };
    const record = buildLiveTelemetryRecord(w, time), text = JSON.stringify(record);
    for (const secret of ['private-account-must-not-appear', 'private-handoff-must-not-appear', 'never-copy-extra-secret', 'never-copy-http-token']) {
      expect(text).not.toContain(secret);
    }
    expect(record.references.recentFills[0]).toMatchObject({ tradeId: '9007199254740993', orderId: '9007199254740994' });
    expect(record.quality.backgroundErrorLanes).toEqual(['history']);
  });
  it('writes one sample per observed minute and does not backfill unobserved minutes after a gap', async () => {
    const f = await fixture(), w = wallet(); f.recorder.observe(w); await f.recorder.flush();
    for (let offset = 1000; offset < 60_000; offset += 2000) { f.setNow(time + offset); w.lastObservedAtMs = time + offset; f.recorder.observe(w); }
    await f.recorder.flush(); expect(await f.read()).toHaveLength(1);
    f.setNow(time + 10 * 60_000); w.lastObservedAtMs = time + 10 * 60_000; f.recorder.observe(w); await f.recorder.flush();
    const records = await f.read(); expect(records).toHaveLength(2); expect(records[1].observedAtMs).toBe(time + 10 * 60_000);
    expect((await fs.stat(path.join(f.directory, 'telemetry/latest.json'))).mode & 0o777).toBe(0o600);
  });
  it('adds a bounded event sample when real fills or risk/source state changes between minute samples', async () => {
    const f = await fixture(), w = wallet(); f.recorder.observe(w); await f.recorder.flush();
    f.setNow(time + 11_000); w.lastObservedAtMs += 11_000; w.currentDay.riskLatched = true;
    w.currentDay.latchReason = 'fixed_daily_loss_close_reserve'; w.status = 'risk_latched';
    f.recorder.observe(w); await f.recorder.flush(); f.recorder.observe(w); await f.recorder.flush();
    const records = await f.read(); expect(records).toHaveLength(2); expect(records[1].kind).toBe('event');
    expect(records[1].state).toMatchObject({ riskLatched: true, latchReason: 'fixed_daily_loss_close_reserve' });
  });
  it('returns immediately while the disk writer is stalled and coalesces overload within the fixed queue bound', async () => {
    const f = await fixture({ maxQueuedRecords: 2 }), w = wallet();
    let release!: () => void, started!: () => void;
    const waiting = new Promise<void>(resolve => { release = resolve; });
    const began = new Promise<void>(resolve => { started = resolve; });
    const append = fs.appendFile.bind(fs);
    vi.spyOn(fs, 'appendFile').mockImplementationOnce(async (...args: Parameters<typeof fs.appendFile>) => {
      started(); await waiting; return append(...args);
    });
    expect(f.recorder.observe(w)).toBeUndefined(); await began;
    for (let index = 1; index <= 10; index++) {
      f.setNow(time + index * 60_000); w.lastObservedAtMs = time + index * 60_000;
      w.netPnl = String(index); f.recorder.observe(w);
    }
    expect(f.recorder.health()).toMatchObject({ queuedRecords: 2, writing: true, droppedRecords: 8 });
    // The queued measurement is detached from later wallet mutation.
    w.netPnl = '-999'; release(); await f.recorder.flush();
    const records = await f.read(); expect(records).toHaveLength(3); expect(records.at(-1).values.netPnl).toBe('10');
    expect(f.recorder.health()).toMatchObject({ queuedRecords: 0, recordsWritten: 3 });
  });
  it('contains I/O failures, reports them, and writes the next real observation without touching financial state', async () => {
    const f = await fixture(), w = wallet(), before = JSON.stringify(w);
    await fs.writeFile(path.join(f.directory, 'live-wallet.json'), 'official-wallet-untouched');
    vi.spyOn(fs, 'appendFile').mockRejectedValueOnce(Object.assign(new Error('simulated disk unavailable'), { code: 'EACCES' }));
    f.recorder.observe(w); await f.recorder.flush();
    expect(f.recorder.health()).toMatchObject({ failedRecords: 1, recordsWritten: 0 });
    f.setNow(time + 60_000); f.recorder.observe(w); await f.recorder.flush();
    expect(f.recorder.health()).toMatchObject({ failedRecords: 1, recordsWritten: 1 });
    expect(await fs.readFile(path.join(f.directory, 'live-wallet.json'), 'utf8')).toBe('official-wallet-untouched');
    expect(JSON.stringify(w)).toBe(before);
  });
  it('retains only its configured UTC journals and never deletes unrelated files or the official wallet', async () => {
    const f = await fixture({ retentionDays: 2 }), directory = path.join(f.directory, 'telemetry');
    await fs.mkdir(directory); await fs.writeFile(path.join(f.directory, 'live-wallet.json'), 'official-wallet-untouched');
    for (const file of ['equity-2026-10-01.jsonl', 'equity-2026-10-16.jsonl', 'equity-2026-10-17.jsonl', 'unrelated.jsonl']) {
      await fs.writeFile(path.join(directory, file), 'preserve-or-expire');
    }
    f.recorder.observe(wallet()); await f.recorder.flush();
    expect((await fs.readdir(directory)).sort()).toEqual(['equity-2026-10-17.jsonl', 'equity-2026-10-18.jsonl', 'health.json', 'latest.json', 'unrelated.jsonl']);
    expect(await fs.readFile(path.join(f.directory, 'live-wallet.json'), 'utf8')).toBe('official-wallet-untouched');
  });
  it('caps daily journal size and makes omitted records visible while latest status continues updating', async () => {
    const f = await fixture({ maxJournalBytesPerDay: 1024 }), w = wallet();
    f.recorder.observe(w); await f.recorder.flush();
    f.setNow(time + 60_000); w.netPnl = '.3'; f.recorder.observe(w); await f.recorder.flush();
    expect(f.recorder.health()).toMatchObject({ recordsWritten: 2, omittedJournalRecords: 2, maxJournalBytesPerDay: 1024 });
    expect((await f.latest()).values.netPnl).toBe('0.3');
    expect(await fs.readdir(path.join(f.directory, 'telemetry'))).not.toContain('equity-2026-10-18.jsonl');
  });
  it('keeps order preparation context distinct from an actual fill and bounds all reference arrays', () => {
    const w = wallet(); w.intents = Array.from({ length: 30 }, (_, i) => ({ clientOrderId: `owned-${i}`, sourceId: 'source',
      symbol: 'ETHUSDT', quantity: '1', reduceOnly: false, createdAtMs: time, submittedOnce: false, status: 'PREPARED',
      orderId: null, executedQty: '0', observedFillQty: '0', lastError: null,
      executionContext: { observedAtMs: time, oldestQuoteAtMs: time - 100, markPrice: '102', referencePrice: '102',
        bidPrice: '101.9', askPrice: '102.1', takerFeeRate: '.0005', slippageBps: '2' } }));
    const record = buildLiveTelemetryRecord(w, time, 'event');
    expect(record.references).toMatchObject({ fillCount: 0, intentCount: 30, officialLedger: 'live-wallet.json' });
    expect(record.references.recentFills).toHaveLength(0); expect(record.references.recentIntents).toHaveLength(10);
    const context = record.references.recentIntents[0].executionContext as Record<string, unknown>;
    w.intents[20].executionContext!.markPrice = '-999'; expect(context.markPrice).toBe('102');
  });
  it('retains a full24hminute curve with ample journal space at the real22fill/20intent history scale', () => {
    const w = wallet();
    for (const symbol of ['BTCUSDT', 'BNBUSDT', 'SOLUSDT', 'XRPUSDT']) {
      w.positions[symbol] = { quantity: '0.01234567', averageEntry: '2412.12345678' };
      (w.lastObservation.marks as Record<string, string>)[symbol] = '2431.12345678';
      (w.lastObservation.bids as Record<string, string>)[symbol] = '2431.02345678';
      (w.lastObservation.asks as Record<string, string>)[symbol] = '2431.22345678';
    }
    w.trades = Array.from({ length: 22 }, (_, index) => ({ symbol: 'ETHUSDT', id: `9007199254740${index}`,
      orderId: `9007199254750${index}`, time, side: 'BUY', qty: '.009', price: '2408.91', commission: '.010840095', realizedPnl: '0' }));
    w.intents = Array.from({ length: 20 }, (_, index) => ({ clientOrderId: `cd15_01234567890123456789012345${index}`,
      sourceId: 'constant-direction-012345678901234567890123456789abcdef', symbol: 'ETHUSDT', quantity: '.009', reduceOnly: false,
      orderId: `9007199254750${index}`, createdAtMs: time, submittedOnce: true, status: 'FILLED', executedQty: '.009', observedFillQty: '.009', lastError: null }));
    const record = buildLiveTelemetryRecord(w, time), bytesPerRow = Buffer.byteLength(`${JSON.stringify(record)}\n`);
    expect(record.references.recentFills).toHaveLength(3); expect(record.references.recentIntents).toHaveLength(2);
    // A full day must fit with at least40%headroom for discrete event rows.
    expect(bytesPerRow * 1440).toBeLessThan(16 * 1024 * 1024 * .6);
  });
  it('throttles state flapping and stops optional writes without changing the wallet', async () => {
    const f = await fixture(), w = wallet(); f.recorder.observe(w); await f.recorder.flush();
    for (let offset = 1000; offset < 10_000; offset += 1000) {
      f.setNow(time + offset); w.status = offset % 2000 ? 'flat' : 'active'; f.recorder.observe(w);
    }
    await f.recorder.flush(); expect(await f.read()).toHaveLength(1); expect(Number(f.recorder.health().droppedRecords)).toBeGreaterThan(0);
    f.recorder.stop(); f.setNow(time + 60_000); f.recorder.observe(w); await f.recorder.flush();
    expect(await f.read()).toHaveLength(1); expect(f.recorder.health().stopped).toBe(true);
  });
});
