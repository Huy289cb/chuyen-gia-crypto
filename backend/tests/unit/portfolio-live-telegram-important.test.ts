import { afterEach, describe, expect, it, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { LiveTelegramNotifier } from '../../src/portfolio/live-telegram';
import type { LivePortfolioWallet } from '../../src/portfolio/live-service';
vi.setConfig({ testTimeout: 30_000, hookTimeout: 30_000 });
const directories: string[] = [];
afterEach(async () => { vi.restoreAllMocks(); for (const dir of directories.splice(0)) await fs.rm(dir, { recursive: true, force: true }); });
function wallet(): LivePortfolioWallet {
  const time = Date.parse('2026-10-16T12:00:00Z');
  return { schema: 'authenticated-portfolio-live-v1', policyId: 'CONSTANT_DIRECTION_B5_S6_DAILY15_V1',
    config: { initialCash: '31.47744546', dailyLossLimitUsd: '15', closeBufferUsd: '6.1', softLossThresholdUsd: '-8.9',
      grossCap: '8', leverage: '10', bandThreshold: '.2', slippageBps: '2' }, accountIdentity: 'test-private-account',
    handoffSha256: 'private-handoff', startedAtMs: time - 1000, lastObservedAtMs: time,
    bootstrapAccountEquity: '31.47744546', accountEquity: '31.47744546', availableBalance: '31.47744546',
    equity: '31.47744546', netCashflow: '0', netPnl: '0', equityQuality: 'reconciled', unreconciledWalletDelta: '0',
    positions: {}, actualPositions: [], totalFees: '0', fundingPnl: '0', realizedPnl: '0', trades: [], incomes: [],
    processedTradeIds: [], processedIncomeIds: [], intents: [], currentDay: { day: '2026-10-16', anchorEquity: '31.47744546',
      anchorTimeMs: time - 1000, anchorQuality: 'initial_partial', netCashflow: '0', netPnl: '0', worstNetPnl: '0',
      breachUsd: '0', riskLatched: false, latchReason: null }, days: [], sourceCursorMs: 0, lastSourceId: null,
    sourceDisposition: 'bootstrap_flat_until_next_utc', status: 'flat', blockedReason: null, continuousRiskGuarantee: false, lastObservation: {} };
}
async function fixture(chats = ['configured-a']) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'live-telegram-'));
  directories.push(directory); const w = wallet(); let now = w.lastObservedAtMs;
  const send = vi.fn(async (_chat: string, _text: string) => '123');
  const options = { directory, enabled: true, importantOnly: true, chatIds: chats, send, now: () => now, automatic: false };
  return { directory, w, send, options, notifier: new LiveTelegramNotifier(options), advance: (ms = 1000) => { now += ms; w.lastObservedAtMs = now; },
    state: async () => JSON.parse(await fs.readFile(path.join(directory, 'telegram/outbox.json'), 'utf8')) };
}
const buy = (time: number) => ({ symbol: 'ETHUSDT', id: '9007199254740993', orderId: '9007199254740994', side: 'BUY',
  qty: '2', price: '100', commission: '.2', commissionAsset: 'USDT', realizedPnl: '0', time });
const sell = (time: number) => ({ ...buy(time), id: '9007199254740995', orderId: '9007199254740996', side: 'SELL',
  qty: '.5', price: '102', commission: '.05', realizedPnl: '1' });
function pendingAck(w: LivePortfolioWallet): void {
  w.status = 'reconciliation_required'; w.blockedReason = 'unresolved_or_partial_order';
  w.intents = [{ clientOrderId: 'test-owned-full-ack', sourceId: 'test-source', symbol: 'ETHUSDT',
    quantity: '2', reduceOnly: false, createdAtMs: w.lastObservedAtMs, submittedOnce: true,
    status: 'FILLED', orderId: '9007199254740994', executedQty: '2', observedFillQty: '0', lastError: null }];
}

describe('important live Telegram policy', () => {
  it('waits for a persistent failed account GET while never delaying an unknown submitted order', async () => {
    const reason = 'Binance portfolio GET /fapi/v3/account failed (request_failed).';
    const f = await fixture(); await f.notifier.recordError(reason, f.w); f.advance(30000);
    await f.notifier.recordError(reason, f.w); expect((await f.state()).entries).toHaveLength(0);
    f.advance(30000); await f.notifier.recordError(reason, f.w);
    expect((await f.state()).entries).toHaveLength(1);
    expect((await f.state()).entries[0].text).toContain('DỮ LIỆU TỪ SÀN CHƯA ỔN ĐỊNH');
    f.advance(60000); await f.notifier.recordError(reason, f.w); expect((await f.state()).entries).toHaveLength(1);
    const u = await fixture(); pendingAck(u.w); u.w.intents[0].status = 'UNKNOWN';
    await u.notifier.recordError(reason, u.w); expect((await u.state()).entries).toHaveLength(1);
  });
  it.each(['Binance portfolio POST /fapi/v1/order failed (request_failed).',
    'Binance portfolio GET /fapi/v1/order failed (request_failed).',
    'Binance portfolio GET /fapi/v3/account failed (request_failed, code -2015).',
    'Binance portfolio GET /fapi/v3/account failed (invalid_response).'])('keeps an unrecognized or order-related failure immediate: %s', async reason => {
    const f = await fixture(); await f.notifier.recordError(reason, f.w);
    expect((await f.state()).entries).toHaveLength(1);
  });
  it('keeps routine startup, partial-publication wait and resuming quiet', async () => {
    const f = await fixture(); await f.notifier.observe(f.w); pendingAck(f.w);
    await f.notifier.observe(f.w);
    f.w.technicalRecovery = { incidentId: 'x', day: f.w.currentDay.day, detectedAtMs: f.w.lastObservedAtMs,
      phase: 'resuming', healthySinceMs: null, healthyObservations: 0, lastHealthyAtMs: null, attemptSourceId: null, blockedReason: null };
    await f.notifier.observe(f.w);
    const state = await f.state(); expect(state.entries).toEqual([]);
    expect(state.events).toContain('activation'); expect(state.suppressedEvents).toBeGreaterThan(2);
  });
  it('keeps real opens and closes with exact allocated-fee result and no wallet changes', async () => {
    const f = await fixture(); f.w.trades = [buy(f.w.lastObservedAtMs), sell(f.w.lastObservedAtMs + 1)];
    const before = JSON.stringify(f.w); await f.notifier.observe(f.w); await f.notifier.observe(f.w);
    const entries = (await f.state()).entries;
    expect(entries).toHaveLength(2); expect(entries.every((e: any) => e.kind === 'trade')).toBe(true);
    expect(entries[0].text).toContain('MỞ LỆNH ETH'); expect(entries[1].text).toContain('0,90');
    expect(JSON.stringify(f.w)).toBe(before);
  });
  it('does not alert or announce recovery for a short technical interruption', async () => {
    const f = await fixture(); await f.notifier.recordError('Network timeout', f.w);
    f.advance(6000); await f.notifier.observe(f.w); f.advance(120000); await f.notifier.observe(f.w);
    expect((await f.state()).entries).toEqual([]); expect((await f.state()).importantNotice).toBeUndefined();
  });
  it('sends one prolonged technical incident even when technical fingerprints change', async () => {
    const f = await fixture(); await f.notifier.recordError('Network timeout', f.w);
    f.advance(30000); await f.notifier.recordError('Stale venue quote BTCUSDT', f.w);
    f.advance(30000); await f.notifier.recordError('Stale venue quote ETHUSDT', f.w);
    f.advance(30000); await f.notifier.recordError('Connection unavailable', f.w);
    expect((await f.state()).entries.filter((e: any) => e.kind === 'error')).toHaveLength(1);
  });
  it('does not turn a short metadata failure into an urgent failure or a recovery message', async () => {
    const f = await fixture(); await f.notifier.recordError('Authenticated background metadata unavailable', f.w);
    f.advance(6000); await f.notifier.observe(f.w); f.advance(120000); await f.notifier.observe(f.w);
    expect((await f.state()).entries).toEqual([]); expect((await f.state()).importantNotice).toBeUndefined();
  });
  it('coalesces different auxiliary and quote delays and waits120 healthy seconds before recovery', async () => {
    const f = await fixture(); await f.notifier.recordError('Authenticated background metadata unavailable', f.w);
    f.advance(30000); await f.notifier.recordError('Live public book quote unavailable for BNBUSDT (missing).', f.w);
    f.advance(30000); await f.notifier.recordError('Authenticated background orders unavailable; Authenticated background history unavailable', f.w);
    expect((await f.state()).entries.filter((e: any) => e.kind === 'error')).toHaveLength(1);
    expect((await f.state()).entries[0].text).toContain('DỮ LIỆU TỪ SÀN CHƯA ỔN ĐỊNH');
    await f.notifier.flush(); f.advance(6000); await f.notifier.observe(f.w);
    f.advance(90000); await f.notifier.observe(f.w);
    expect((await f.state()).entries.filter((e: any) => e.kind === 'recovery')).toHaveLength(0);
    await f.notifier.recordError('Authenticated background metadata unavailable', f.w);
    f.advance(6000); await f.notifier.observe(f.w); f.advance(119000); await f.notifier.observe(f.w);
    expect((await f.state()).entries).toHaveLength(1);
    f.advance(1000); await f.notifier.observe(f.w); await f.notifier.observe(f.w);
    const entries = (await f.state()).entries;
    expect(entries.filter((e: any) => e.kind === 'error')).toHaveLength(1);
    expect(entries.filter((e: any) => e.kind === 'recovery')).toHaveLength(1);
  });
  it('can report a persistent recurrence after debounce expires instead of hiding it forever', async () => {
    const f = await fixture(), reason = 'Authenticated background metadata unavailable';
    await f.notifier.recordError(reason, f.w); f.advance(60000); await f.notifier.recordError(reason, f.w);
    await f.notifier.flush(); f.advance(6000); await f.notifier.observe(f.w);
    f.advance(120000); await f.notifier.observe(f.w);
    f.advance(1000); await f.notifier.recordError(reason, f.w);
    f.advance(60000); await f.notifier.recordError(reason, f.w);
    expect((await f.state()).entries.filter((e: any) => e.kind === 'error')).toHaveLength(1);
    f.advance(180000); await f.notifier.recordError(reason, f.w);
    expect((await f.state()).entries.filter((e: any) => e.kind === 'error')).toHaveLength(2);
  });
  it('does not delay financial uncertainty even when the external reason is a recognized read failure', async () => {
    const f = await fixture(); f.w.blockedReason = 'unowned position mismatch';
    await f.notifier.recordError('Authenticated background metadata unavailable', f.w);
    expect((await f.state()).entries).toHaveLength(1);
    expect((await f.state()).entries[0].text).toContain('🚨 BOT ĐANG GẶP SỰ CỐ');
  });
  it('immediately escalates the identical read error if an UNKNOWN order appears after a technical notice', async () => {
    const f = await fixture(), reason = 'Binance portfolio GET /fapi/v3/account failed (request_failed).';
    await f.notifier.recordError(reason, f.w); f.advance(60000); await f.notifier.recordError(reason, f.w);
    expect((await f.state()).entries).toHaveLength(1);
    expect((await f.state()).entries[0].text).toContain('DỮ LIỆU TỪ SÀN CHƯA ỔN ĐỊNH');
    pendingAck(f.w); f.w.intents[0].status = 'UNKNOWN';
    await f.notifier.recordError(reason, f.w); await f.notifier.recordError(reason, f.w);
    const entries = (await f.state()).entries;
    expect(entries).toHaveLength(2); expect(entries[1].text).toContain('🚨 BOT ĐANG GẶP SỰ CỐ');
  });
  it('does not let the five-minute technical debounce hide a critical recurrence after recovery', async () => {
    const f = await fixture(), reason = 'Binance portfolio GET /fapi/v3/account failed (request_failed).';
    await f.notifier.recordError(reason, f.w); f.advance(60000); await f.notifier.recordError(reason, f.w);
    await f.notifier.flush(); f.advance(6000); await f.notifier.observe(f.w);
    f.advance(120000); await f.notifier.observe(f.w);
    pendingAck(f.w); f.w.intents[0].status = 'UNKNOWN';
    await f.notifier.recordError(reason, f.w);
    expect((await f.state()).entries.filter((e: any) => e.kind === 'error')).toHaveLength(2);
  });
  it('counts a persistent outage across sparse callbacks without assuming a healthy interval', async () => {
    const f = await fixture(); await f.notifier.recordError('Network timeout', f.w);
    f.advance(40000); await f.notifier.recordError('Network timeout', f.w);
    f.advance(40000); await f.notifier.recordError('Network timeout', f.w);
    expect((await f.state()).entries.filter((e: any) => e.kind === 'error')).toHaveLength(1);
  });
  it('never announces recovery before the associated alert is acknowledged', async () => {
    const f = await fixture(); await f.notifier.recordError('Unowned position mismatch', f.w);
    f.advance(6000); await f.notifier.observe(f.w); f.advance(31000); await f.notifier.observe(f.w);
    expect((await f.state()).entries.filter((e: any) => e.kind === 'recovery')).toHaveLength(0);
    await f.notifier.flush(); await f.notifier.observe(f.w);
    expect((await f.state()).entries.filter((e: any) => e.kind === 'recovery')).toHaveLength(1);
  });
  it('keeps elapsed interruption time across notifier restart', async () => {
    const f = await fixture(); await f.notifier.recordError('Network timeout', f.w);
    f.advance(30000); await f.notifier.recordError('Network timeout', f.w);
    const restarted = new LiveTelegramNotifier(f.options);
    f.advance(30000); await restarted.recordError('Network timeout', f.w);
    expect((await f.state()).entries.filter((e: any) => e.kind === 'error')).toHaveLength(1);
  });
  it('alerts immediately for an UNKNOWN order even when the external error says timeout', async () => {
    const f = await fixture(); pendingAck(f.w); f.w.intents[0]!.status = 'UNKNOWN';
    await f.notifier.recordError('Network timeout', f.w);
    expect((await f.state()).entries.filter((e: any) => e.kind === 'error')).toHaveLength(1);
  });
  it('alerts immediately when acknowledged fill publication exceeds its grace', async () => {
    const f = await fixture(); pendingAck(f.w); f.w.intents[0]!.createdAtMs -= 31000;
    await f.notifier.observe(f.w);
    expect((await f.state()).entries.filter((e: any) => e.kind === 'error')).toHaveLength(1);
  });
  it('announces one recovery only after30 continuously healthy seconds', async () => {
    const f = await fixture(); await f.notifier.recordError('Unowned position mismatch', f.w); await f.notifier.flush();
    f.advance(6000); await f.notifier.observe(f.w); f.advance(29000); await f.notifier.observe(f.w);
    expect((await f.state()).entries.filter((e: any) => e.kind === 'recovery')).toHaveLength(0);
    f.advance(1000); await f.notifier.observe(f.w); await f.notifier.observe(f.w);
    expect((await f.state()).entries.filter((e: any) => e.kind === 'recovery')).toHaveLength(1);
  });
  it('keeps recovery silent while technical reconciliation or errors remain', async () => {
    const f = await fixture(); await f.notifier.recordError('Unowned position mismatch', f.w);
    f.w.lastObservation.background = { errors: { history: 'waiting' } };
    f.advance(6000); await f.notifier.observe(f.w); f.advance(40000); await f.notifier.observe(f.w);
    expect((await f.state()).entries.filter((e: any) => e.kind === 'recovery')).toHaveLength(0);
  });
  it('never delays a loss protection or a later monetary breach behind a technical incident', async () => {
    const f = await fixture(); await f.notifier.recordError('Network timeout', f.w);
    f.w.status = 'risk_latched'; f.w.currentDay.riskLatched = true; f.w.currentDay.latchReason = 'live_monitoring_gap';
    await f.notifier.observe(f.w); expect((await f.state()).entries.filter((e: any) => e.kind === 'risk')).toHaveLength(1);
    f.w.currentDay.latchReason = 'fixed_daily_loss_observed'; f.w.currentDay.breachUsd = '1';
    await f.notifier.observe(f.w); expect((await f.state()).entries.filter((e: any) => e.eventId.startsWith('breach:'))).toHaveLength(1);
  });
  it('sends just the scheduled daily report and silences midnight/archive duplicates', async () => {
    const f = await fixture(); f.advance(2 * 3600000);
    f.w.days.push({ ...f.w.currentDay, day: '2026-10-15' });
    await f.notifier.observe(f.w); await f.notifier.reportCurrentDay(); await f.notifier.reportCurrentDay();
    const entries = (await f.state()).entries;
    expect(entries).toHaveLength(1); expect(entries[0].eventId).toBe('scheduled-day:2026-10-16');
  });
  it('waits for fresh numbers instead of emitting a second stale daily report', async () => {
    const f = await fixture(); f.advance(2 * 3600000); f.w.lastObservedAtMs -= 20000;
    await f.notifier.observe(f.w); await f.notifier.reportCurrentDay(); expect((await f.state()).entries).toHaveLength(0);
    f.advance(1000); await f.notifier.observe(f.w); expect((await f.state()).entries).toHaveLength(1);
  });
  it('migrates only untouched low priority backlog and never resends historical trade notices', async () => {
    const f = await fixture(); f.w.trades = [buy(f.w.lastObservedAtMs)];
    const old = new LiveTelegramNotifier({ ...f.options, importantOnly: false }); await old.observe(f.w);
    const state = await f.state(); const activation = state.entries.find((e: any) => e.kind === 'status');
    activation.status = 'sent'; activation.messageId = 'confirmed';
    const trade = state.entries.find((e: any) => e.kind === 'trade'), oldTrade = JSON.stringify(trade);
    state.entries.push({ ...activation, id: 'uncertain-progress', eventId: 'uncertain-progress', kind: 'progress',
      status: 'pending', attempts: 1, messageId: null, uncertain: true });
    await fs.writeFile(path.join(f.directory, 'telegram/outbox.json'), JSON.stringify(state));
    await f.notifier.observe(f.w); const next = await f.state();
    expect(next.entries.find((e: any) => e.kind === 'status')).toEqual(activation);
    expect(next.entries.find((e: any) => e.kind === 'trade')).toEqual(JSON.parse(oldTrade));
    expect(next.entries.filter((e: any) => e.kind === 'trade')).toHaveLength(1);
    expect(next.entries.find((e: any) => e.eventId === 'activation_snapshot').status).toBe('suppressed');
    expect(next.entries.find((e: any) => e.eventId === 'uncertain-progress').status).toBe('pending');
  });
});
