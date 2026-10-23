import { afterEach, describe, expect, it, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { LiveTelegramNotifier } from '../../src/portfolio/live-telegram';
import { LiveTelegramDeliveryError } from '../../src/portfolio/live-telegram-transport';
import type { LivePortfolioWallet } from '../../src/portfolio/live-service';
import * as store from '../../src/portfolio/paper-store';

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
  const options = { directory, enabled: true, chatIds: chats, send, now: () => now, automatic: false };
  return { directory, w, send, options, notifier: new LiveTelegramNotifier(options), advance: (ms = 1000) => { now += ms; },
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
async function isolateFirstEntry(f: Awaited<ReturnType<typeof fixture>>): Promise<void> {
  const state = await f.state();
  for (const entry of state.entries.slice(1)) { entry.status = 'sent'; entry.messageId = 'fixture-ack'; }
  await fs.writeFile(path.join(f.directory, 'telegram/outbox.json'), JSON.stringify(state));
}

describe('live Telegram durable actual-data outbox', () => {
  it('alerts a second technical incident on the same day without duplicating a continuing incident', async () => {
    const f = await fixture(); f.w.status = 'risk_latched'; f.w.currentDay.riskLatched = true;
    f.w.currentDay.latchReason = 'live_monitoring_gap';
    f.w.technicalRecovery = { incidentId: 'fault-one', day: f.w.currentDay.day, detectedAtMs: f.w.lastObservedAtMs,
      phase: 'reconciling', healthySinceMs: null, healthyObservations: 0, lastHealthyAtMs: null,
      attemptSourceId: null, blockedReason: 'waiting_reconciliation' };
    await f.notifier.observe(f.w); await f.notifier.observe(f.w);
    expect((await f.state()).entries.filter((e: any) => e.kind === 'risk')).toHaveLength(1);
    f.w.technicalRecovery.incidentId = 'fault-two';
    await f.notifier.observe(f.w); await f.notifier.observe(f.w);
    expect((await f.state()).entries.filter((e: any) => e.kind === 'risk')).toHaveLength(2);
  });
  it('announces each technical recovery phase once and waits for real reconciliation before completion', async () => {
    const f = await fixture();
    f.w.technicalRecovery = { incidentId: 'incident-a', day: f.w.currentDay.day, detectedAtMs: f.w.lastObservedAtMs - 31_000,
      phase: 'resuming', healthySinceMs: f.w.lastObservedAtMs - 30_000, healthyObservations: 16,
      lastHealthyAtMs: f.w.lastObservedAtMs, attemptSourceId: 'recovery-a', blockedReason: null };
    await f.notifier.observe(f.w); await f.notifier.observe(f.w);
    const restarted = new LiveTelegramNotifier(f.options); await restarted.observe(f.w);
    expect((await f.state()).entries.filter((e: any) => e.eventId === 'technical-recovery:incident-a:resuming')).toHaveLength(1);
    f.w.technicalRecovery.phase = 'resumed'; f.w.technicalRecovery.resumedAtMs = f.w.lastObservedAtMs;
    f.w.equityQuality = 'conservative_pending_income';
    await restarted.observe(f.w);
    expect((await f.state()).events).not.toContain('technical-recovery:incident-a:resumed');
    f.w.equityQuality = 'reconciled'; await restarted.observe(f.w); await restarted.observe(f.w);
    expect((await f.state()).entries.filter((e: any) => e.eventId === 'technical-recovery:incident-a:resumed')).toHaveLength(1);
    await restarted.recordError('Later unrelated connectivity failure', f.w);
    await restarted.observe(f.w);
    expect((await f.state()).entries.filter((e: any) => /^recovery:\d+$/.test(e.eventId))).toHaveLength(1);
  });
  it('never announces technical recovery while a financial latch remains active', async () => {
    const f = await fixture(); f.w.status = 'risk_latched'; f.w.currentDay.riskLatched = true;
    f.w.currentDay.latchReason = 'fixed_daily_loss_close_reserve';
    f.w.technicalRecovery = { incidentId: 'incident-money', day: f.w.currentDay.day, detectedAtMs: f.w.lastObservedAtMs,
      phase: 'resumed', healthySinceMs: null, healthyObservations: 0, lastHealthyAtMs: null,
      attemptSourceId: 'recovery-money', blockedReason: null, resumedAtMs: f.w.lastObservedAtMs };
    await f.notifier.observe(f.w);
    expect((await f.state()).entries.filter((e: any) => e.kind === 'recovery')).toHaveLength(0);
  });
  it('suppresses a generic recovered message while technical reconciliation is still pending', async () => {
    const f = await fixture(); await f.notifier.recordError('Technical outage', f.w);
    f.w.technicalRecovery = { incidentId: 'incident-pending', day: f.w.currentDay.day, detectedAtMs: f.w.lastObservedAtMs,
      phase: 'stabilizing', healthySinceMs: f.w.lastObservedAtMs, healthyObservations: 1, lastHealthyAtMs: f.w.lastObservedAtMs,
      attemptSourceId: null, blockedReason: 'waiting_health' };
    await f.notifier.observe(f.w);
    expect((await f.state()).entries.filter((e: any) => e.kind === 'recovery')).toHaveLength(0);
  });
  it('delivers activation/status snapshots once across repeated observations and restarts', async () => {
    const f = await fixture(); const original = JSON.stringify(f.w);
    await f.notifier.observe(f.w); expect(f.send).not.toHaveBeenCalled();
    await f.notifier.flush(); await f.notifier.flush(); expect(f.send).toHaveBeenCalledTimes(2);
    expect((await f.state()).entries.every((e: any) => e.status === 'sent' && e.messageId === '123')).toBe(true);
    const restarted = new LiveTelegramNotifier(f.options); await restarted.observe(f.w); await restarted.flush();
    expect(f.send).toHaveBeenCalledTimes(2); expect(JSON.stringify(f.w)).toBe(original);
    expect(await fs.readdir(f.directory)).toEqual(['telegram']);
  });
  it('uses confirmed fill IDs, sorts actual history and allocates real opening fees', async () => {
    const f = await fixture(); f.w.trades = [sell(f.w.lastObservedAtMs + 1), buy(f.w.lastObservedAtMs)];
    await f.notifier.observe(f.w); const state = await f.state();
    const events = state.entries.filter((e: any) => e.kind === 'trade'); expect(events).toHaveLength(2);
    expect(events[0].text).toContain('MỞ LỆNH ETH — MUA');
    expect(events[1].text).toContain('ĐÓNG MỘT PHẦN LỆNH ETH');
    expect(events[1].text).toContain('Lãi/lỗ phần đã đóng: +0.9 USDT');
    await f.notifier.observe({ ...f.w, lastObservedAtMs: f.w.lastObservedAtMs + 1000, equity: '35' });
    expect((await f.state()).entries.filter((e: any) => e.kind === 'trade')).toHaveLength(2);
  });
  it('keeps previously persisted message text and event identities through a formatting upgrade', async () => {
    const f = await fixture(); f.w.trades = [buy(f.w.lastObservedAtMs)];
    await f.notifier.observe(f.w);
    const original = await f.state();
    for (const entry of original.entries) entry.text = `PREVIOUS FORMAT ${entry.eventId}`;
    const sent = original.entries.find((e: any) => e.kind === 'trade');
    sent.status = 'sent'; sent.messageId = 'previous-confirmed-message';
    await fs.writeFile(path.join(f.directory, 'telegram/outbox.json'), JSON.stringify(original));
    const restarted = new LiveTelegramNotifier(f.options); await restarted.observe(f.w);
    const state = await f.state();
    expect(state.events).toEqual(original.events);
    expect(state.entries.map((e: any) => [e.id, e.eventId, e.text, e.status, e.messageId]))
      .toEqual(original.entries.map((e: any) => [e.id, e.eventId, e.text, e.status, e.messageId]));
    expect(f.send).not.toHaveBeenCalled();
    f.w.trades.push(sell(f.w.lastObservedAtMs + 1)); await restarted.observe(f.w);
    const added = (await f.state()).entries.filter((e: any) => !original.events.includes(e.eventId));
    expect(added).toHaveLength(1);
    expect(added[0].text).toContain('ĐÓNG MỘT PHẦN LỆNH ETH');
    expect(added[0].text).toContain('Lãi/lỗ phần đã đóng: +0.9 USDT');
  });
  it('never calls an order ACK a fill and notifies the later authenticated trade once', async () => {
    const f = await fixture(); f.w.intents = [{ status: 'FILLED', executedQty: '2' } as any];
    await f.notifier.observe(f.w); expect((await f.state()).entries.some((e: any) => e.kind === 'trade')).toBe(false);
    f.w.trades = [buy(f.w.lastObservedAtMs)]; await f.notifier.observe(f.w); await f.notifier.observe(f.w);
    expect((await f.state()).entries.filter((e: any) => e.kind === 'trade')).toHaveLength(1);
  });
  it('reports a normal full ACK publication wait once, then the actual fill without a false error or recovery', async () => {
    const f = await fixture(); pendingAck(f.w);
    f.w.equityQuality = 'conservative_pending_income'; f.w.unreconciledWalletDelta = '-.2';
    const original = JSON.stringify(f.w);
    await f.notifier.observe(f.w); await f.notifier.observe(f.w);
    let state = await f.state(); const progress = state.entries.filter((e: any) => e.kind === 'progress');
    expect(progress).toHaveLength(1); expect(progress[0].text).toContain('Số tiền còn chờ kiểm tra: -0.2 USDT');
    expect(progress[0].text).not.toMatch(/\b(?:ACK|FILLED|intent|PnL|NAV|ETHUSDT)\b/);
    expect(state.entries.filter((e: any) => ['trade', 'error', 'recovery'].includes(e.kind))).toHaveLength(0);
    expect(JSON.stringify(f.w)).toBe(original);
    f.advance(10_000); f.w.lastObservedAtMs += 10_000;
    const restarted = new LiveTelegramNotifier(f.options); await restarted.observe(f.w);
    expect((await f.state()).entries.filter((e: any) => e.kind === 'progress')).toHaveLength(1);
    f.w.trades = [buy(f.w.lastObservedAtMs)]; f.w.incomes = [{ incomeType: 'COMMISSION', income: '-.2',
      asset: 'USDT', time: f.w.lastObservedAtMs, tranId: '9007199254740997' }];
    f.w.intents[0].observedFillQty = '2'; f.w.equityQuality = 'reconciled'; f.w.unreconciledWalletDelta = '0';
    f.w.status = 'active'; f.w.blockedReason = null;
    await restarted.observe(f.w); await restarted.observe(f.w);
    state = await f.state(); expect(state.entries.filter((e: any) => e.kind === 'trade')).toHaveLength(1);
    expect(state.entries.filter((e: any) => ['error', 'recovery'].includes(e.kind))).toHaveLength(0);
  });
  it('ends the publication grace after 30 seconds and debounces the unresolved order error', async () => {
    const f = await fixture(); pendingAck(f.w); await f.notifier.observe(f.w);
    f.advance(29_999); f.w.lastObservedAtMs += 29_999; await f.notifier.observe(f.w);
    expect((await f.state()).entries.filter((e: any) => e.kind === 'error')).toHaveLength(0);
    f.advance(1); f.w.lastObservedAtMs++; await f.notifier.observe(f.w); await f.notifier.observe(f.w);
    const restarted = new LiveTelegramNotifier(f.options); await restarted.observe(f.w);
    const state = await f.state(); expect(state.entries.filter((e: any) => e.kind === 'error')).toHaveLength(1);
    expect(state.entries.filter((e: any) => e.kind === 'recovery')).toHaveLength(0);
  });
  it('never lets a newer full ACK extend the grace for an older unresolved ACK', async () => {
    const f = await fixture(); pendingAck(f.w); await f.notifier.observe(f.w);
    f.advance(31_000); f.w.lastObservedAtMs += 31_000;
    f.w.intents.push({ ...f.w.intents[0], clientOrderId: 'newer-owned-ack', orderId: '9007199254740998',
      createdAtMs: f.w.lastObservedAtMs });
    await f.notifier.observe(f.w);
    expect((await f.state()).entries.filter((e: any) => e.kind === 'error')).toHaveLength(1);
  });
  it.each(['UNKNOWN', 'PREPARED', 'SUBMITTING', 'PARTIALLY_FILLED'])('alerts %s outcomes immediately during a recent ACK wait', async status => {
    const f = await fixture(); pendingAck(f.w); f.w.intents[0].status = status;
    await f.notifier.observe(f.w); const state = await f.state();
    expect(state.entries.filter((e: any) => e.kind === 'error')).toHaveLength(1);
    expect(state.entries.filter((e: any) => e.kind === 'progress')).toHaveLength(0);
  });
  it.each([
    { executedQty: '1' }, { observedFillQty: '3' }, { orderId: null }, { orderId: 'unsafe-id' },
    { submittedOnce: false }, { lastError: 'Order identity query failed' },
  ])('does not grant publication grace to an incomplete or unverified ACK: %j', async patch => {
    const f = await fixture(); pendingAck(f.w); Object.assign(f.w.intents[0], patch);
    await f.notifier.observe(f.w); const state = await f.state();
    expect(state.entries.filter((e: any) => e.kind === 'error')).toHaveLength(1);
    expect(state.entries.filter((e: any) => e.kind === 'progress')).toHaveLength(0);
  });
  it('prioritizes a simultaneous external failure over a normal full ACK publication wait', async () => {
    const f = await fixture(); pendingAck(f.w);
    await f.notifier.observe(f.w, 'Source preparation failed'); const state = await f.state();
    const errors = state.entries.filter((e: any) => e.kind === 'error'); expect(errors).toHaveLength(1);
    expect(errors[0].text).toContain('Chưa lấy được dữ liệu để chọn lệnh');
    expect(state.entries.filter((e: any) => e.kind === 'progress')).toHaveLength(0);
  });
  it.each(['UNKNOWN', 'PARTIALLY_FILLED'])('captures both source failure and genuine %s order incidents without a false recovery', async status => {
    const f = await fixture(); pendingAck(f.w); f.w.intents[0].status = status;
    for (let tick = 0; tick < 3; tick++) await f.notifier.observe(f.w, 'Source preparation failed');
    const restarted = new LiveTelegramNotifier(f.options); await restarted.observe(f.w, 'Source preparation failed');
    const state = await f.state(), errors = state.entries.filter((e: any) => e.kind === 'error');
    expect(errors).toHaveLength(2); expect(errors.some((e: any) => e.text.includes('Chưa lấy được dữ liệu để chọn lệnh'))).toBe(true);
    expect(errors.some((e: any) => e.text.includes('Chưa xác nhận đủ kết quả mua/bán'))).toBe(true);
    expect(state.entries.filter((e: any) => ['progress', 'recovery'].includes(e.kind))).toHaveLength(0);
  });
  it('never masks a background income failure or an unrelated conservative cash mismatch', async () => {
    const f = await fixture(); pendingAck(f.w);
    f.w.lastObservation.background = { errors: { history: 'Authenticated income unavailable' } };
    await f.notifier.observe(f.w); expect((await f.state()).entries.filter((e: any) => e.kind === 'error')).toHaveLength(1);
    const g = await fixture(); g.w.status = 'reconciliation_required';
    g.w.blockedReason = 'Authenticated wallet/income coverage mismatch; conservative risk only';
    g.w.equityQuality = 'conservative_pending_income'; g.w.unreconciledWalletDelta = '-10';
    await g.notifier.observe(g.w); const state = await g.state();
    expect(state.entries.filter((e: any) => e.kind === 'error')).toHaveLength(1);
    expect(state.entries.filter((e: any) => e.kind === 'progress')).toHaveLength(0);
  });
  it.each([
    ['Stale venue quote: ETHUSDT', 'Giá từ sàn cập nhật chậm'],
    ['Authenticated history unavailable; conservative risk only', 'Số dư, phí hoặc lịch sử giao dịch'],
    ['Account position mode mismatch', 'không khớp dữ liệu của bot'],
  ])('never masks another blocked reason while a full ACK is pending: %s', async (reason, explanation) => {
    const f = await fixture(); pendingAck(f.w); f.w.blockedReason = reason;
    await f.notifier.observe(f.w); const state = await f.state();
    const errors = state.entries.filter((e: any) => e.kind === 'error'); expect(errors).toHaveLength(1);
    expect(errors[0].text).toContain(explanation);
    expect(errors[0].text).not.toContain(reason);
    expect(state.entries.filter((e: any) => e.kind === 'progress')).toHaveLength(0);
  });
  it('alerts a financial stop immediately even when a recent full ACK is awaiting publication', async () => {
    const f = await fixture(); pendingAck(f.w); f.w.currentDay.riskLatched = true;
    f.w.currentDay.latchReason = 'fixed_daily_loss_close_reserve';
    f.w.currentDay.worstNetPnl = '-16'; f.w.currentDay.breachUsd = '1';
    await f.notifier.observe(f.w); const state = await f.state();
    expect(state.entries.filter((e: any) => e.kind === 'risk')).toHaveLength(2);
    expect(state.entries.filter((e: any) => e.kind === 'progress')).toHaveLength(0);
  });
  it('does not use a stale monitoring snapshot to grant publication grace', async () => {
    const f = await fixture(); pendingAck(f.w); f.advance(5001); await f.notifier.observe(f.w);
    expect((await f.state()).entries.filter((e: any) => e.kind === 'error')).toHaveLength(1);
  });
  it('respects disabled risk notifications for ledger publication progress', async () => {
    const f = await fixture(); pendingAck(f.w);
    const notifier = new LiveTelegramNotifier({ ...f.options, notifyRisk: false });
    await notifier.observe(f.w); const state = await f.state();
    expect(state.events.some((id: string) => id.startsWith('ledger-publication:'))).toBe(true);
    expect(state.entries.filter((e: any) => e.kind === 'progress')).toHaveLength(0);
  });
  it('tracks recipient acknowledgements independently and does not resend a successful recipient', async () => {
    const f = await fixture(['configured-a', 'configured-b']); let rejected = false;
    f.send.mockImplementation(async chat => {
      if (chat === 'configured-b' && !rejected) { rejected = true; throw new LiveTelegramDeliveryError('telegram_http_429', 5000); }
      return '123';
    });
    await f.notifier.observe(f.w); await f.notifier.flush(); await f.notifier.flush();
    expect(f.send).toHaveBeenCalledTimes(2); await f.notifier.flush(); expect(f.send).toHaveBeenCalledTimes(2);
    f.advance(6000); const restarted = new LiveTelegramNotifier(f.options); await restarted.observe(f.w);
    for (let i = 0; i < 4; i++) await restarted.flush();
    expect(f.send.mock.calls.filter(([chat]) => chat === 'configured-a')).toHaveLength(2);
    expect((await f.state()).entries.every((e: any) => e.status === 'sent')).toBe(true);
  });
  it('deduplicates a continuing error despite changing NAV timestamps and emits one recovery', async () => {
    const f = await fixture(); f.w.status = 'reconciliation_required'; f.w.blockedReason = 'Unresolved Binance order';
    await f.notifier.observe(f.w); await f.notifier.observe({ ...f.w, lastObservedAtMs: f.w.lastObservedAtMs + 7000 });
    expect((await f.state()).entries.filter((e: any) => e.kind === 'error')).toHaveLength(1);
    f.w.status = 'risk_latched'; f.w.currentDay.riskLatched = true; await f.notifier.observe(f.w);
    expect((await f.state()).entries.filter((e: any) => e.kind === 'recovery')).toHaveLength(0);
    f.w.status = 'flat'; f.w.blockedReason = null; f.w.currentDay.riskLatched = false;
    await f.notifier.observe(f.w); await f.notifier.observe(f.w);
    expect((await f.state()).entries.filter((e: any) => e.kind === 'recovery')).toHaveLength(1);
  });
  it('alerts risk latch and a subsequently observed budget overshoot without hiding the breach', async () => {
    const f = await fixture(); f.w.currentDay.riskLatched = true; f.w.currentDay.latchReason = 'fixed_daily_loss_close_reserve';
    await f.notifier.observe(f.w); await f.notifier.observe(f.w);
    expect((await f.state()).entries.filter((e: any) => e.kind === 'risk')).toHaveLength(1);
    f.w.currentDay.breachUsd = '2.25'; f.w.currentDay.worstNetPnl = '-17.25'; await f.notifier.observe(f.w);
    const risks = (await f.state()).entries.filter((e: any) => e.kind === 'risk');
    expect(risks).toHaveLength(2); expect(risks[1].text).toContain('2.25 USDT');
  });
  it('does not alternate source-error/recovery messages while authenticated risk monitoring is healthy', async () => {
    const f = await fixture();
    for (let tick = 0; tick < 3; tick++) {
      await f.notifier.observe({ ...f.w, lastObservedAtMs: f.w.lastObservedAtMs + tick * 7000 }, 'Source preparation failed');
    }
    const pending = await f.state(); expect(pending.entries.filter((e: any) => e.kind === 'error')).toHaveLength(1);
    expect(pending.entries.filter((e: any) => e.kind === 'recovery')).toHaveLength(0);
    await f.notifier.observe(f.w); expect((await f.state()).entries.filter((e: any) => e.kind === 'recovery')).toHaveLength(1);
  });
  it('debounces stale portfolio quotes across symbols and healthy ticks without repeating recoveries', async () => {
    const f = await fixture();
    await f.notifier.recordError('Stale venue quote: BTCUSDT', f.w);
    f.advance(1000); await f.notifier.recordError('Stale venue quote: XRPUSDT', f.w);
    await f.notifier.observe(f.w);
    for (let tick = 0; tick < 3; tick++) {
      f.advance(1000); await f.notifier.recordError(`Stale venue quote: ${tick % 2 ? 'BTCUSDT' : 'XRPUSDT'}`, f.w);
      await f.notifier.observe(f.w);
    }
    const state = await f.state();
    expect(state.entries.filter((e: any) => e.kind === 'error')).toHaveLength(1);
    expect(state.entries.filter((e: any) => e.kind === 'recovery')).toHaveLength(1);
    expect(state.errorSequence).toBe(1);
    f.advance(300_000); await f.notifier.recordError('Stale venue quote: BTCUSDT', f.w);
    await f.notifier.observe(f.w);
    expect((await f.state()).entries.filter((e: any) => e.kind === 'error')).toHaveLength(2);
    expect((await f.state()).entries.filter((e: any) => e.kind === 'recovery')).toHaveLength(2);
  });
  it('persists independent error-category cooldowns across notifier restarts', async () => {
    const f = await fixture();
    await f.notifier.recordError('Stale venue quote: BTCUSDT', f.w); await f.notifier.observe(f.w);
    await f.notifier.recordError('Account endpoint unavailable', f.w); await f.notifier.observe(f.w);
    f.advance(60_000); const restarted = new LiveTelegramNotifier(f.options);
    await restarted.recordError('Stale venue quote: XRPUSDT', f.w); await restarted.observe(f.w);
    await restarted.recordError('Account endpoint unavailable', f.w); await restarted.observe(f.w);
    const state = await f.state();
    expect(state.entries.filter((e: any) => e.kind === 'error')).toHaveLength(2);
    expect(state.entries.filter((e: any) => e.kind === 'recovery')).toHaveLength(2);
    expect(Object.keys(state.errorAlerts)).toHaveLength(2);
    f.w.trades = [buy(f.w.lastObservedAtMs)]; f.w.currentDay.riskLatched = true;
    f.w.currentDay.latchReason = 'fixed_daily_loss_close_reserve'; await restarted.observe(f.w);
    expect((await f.state()).entries.filter((e: any) => e.kind === 'trade')).toHaveLength(1);
    expect((await f.state()).entries.filter((e: any) => e.kind === 'risk')).toHaveLength(1);
  });
  it('migrates an existing v1 outbox without re-alerting its recent per-symbol stale quote', async () => {
    const f = await fixture(); await f.notifier.recordError('Stale venue quote: BTCUSDT', f.w);
    await f.notifier.observe(f.w); const legacy = await f.state(); delete legacy.errorAlerts;
    legacy.activeError = 'old-per-symbol-error-hash';
    await fs.writeFile(path.join(f.directory, 'telegram/outbox.json'), JSON.stringify(legacy));
    f.advance(1000); const restarted = new LiveTelegramNotifier(f.options);
    await restarted.recordError('Stale venue quote: XRPUSDT', f.w); await restarted.observe(f.w);
    const state = await f.state(); expect(state.errorSequence).toBe(1);
    expect(state.entries.filter((e: any) => e.kind === 'error')).toHaveLength(1);
    expect(state.entries.filter((e: any) => e.kind === 'recovery')).toHaveLength(1);
    expect(Object.values(state.errorAlerts)).toHaveLength(1);
  });
  it('migrates genuine legacy raw-text errors without fingerprint metadata after the wording upgrade', async () => {
    const f = await fixture(); await f.notifier.recordError('Stale venue quote: BTCUSDT', f.w);
    await f.notifier.observe(f.w); const legacy = await f.state(); delete legacy.errorAlerts;
    legacy.activeError = 'old-per-symbol-error-hash';
    for (const entry of legacy.entries.filter((item: any) => item.kind === 'error')) {
      delete entry.errorFingerprint;
      entry.text = 'LEGACY ERROR\nStale venue quote: BTCUSDT\nPrevious account snapshot';
    }
    await fs.writeFile(path.join(f.directory, 'telegram/outbox.json'), JSON.stringify(legacy));
    f.advance(1000); const restarted = new LiveTelegramNotifier(f.options);
    await restarted.recordError('Stale venue quote: XRPUSDT', f.w); await restarted.observe(f.w);
    const state = await f.state(); expect(state.errorSequence).toBe(1);
    expect(state.entries.filter((entry: any) => entry.kind === 'error')).toHaveLength(1);
    expect(state.entries.filter((entry: any) => entry.kind === 'recovery')).toHaveLength(1);
  });
  it('survives a bootstrap error before binding to the verified real wallet', async () => {
    const f = await fixture(); await f.notifier.recordError('Bootstrap unavailable');
    expect((await f.state()).accountIdentity).toBe('unbound');
    await f.notifier.observe(f.w); const state = await f.state(); expect(state.accountIdentity).toBe(f.w.accountIdentity);
    expect(state.entries.some((e: any) => e.kind === 'error')).toBe(true);
    const g = await fixture(); await g.notifier.recordError('Error with prior wallet', g.w);
    expect((await g.state()).accountIdentity).toBe(g.w.accountIdentity);
  });
  it('does not let network delivery hold up capturing risk and newly confirmed fills', async () => {
    const f = await fixture(); let release!: (value: string) => void, entered!: () => void;
    const started = new Promise<void>(r => { entered = r; });
    f.send.mockImplementation(() => { entered(); return new Promise<string>(r => { release = r; }); });
    await f.notifier.observe(f.w); const sending = f.notifier.flush(); await started;
    f.w.trades = [buy(f.w.lastObservedAtMs)]; await f.notifier.observe(f.w);
    expect((await f.state()).entries.some((e: any) => e.kind === 'trade')).toBe(true);
    release('123'); await sending;
  });
  it.each(['before_rename', 'after_rename'])('retries a failed ACK completion write %s without resending the acknowledged message', async phase => {
    const f = await fixture(); await f.notifier.observe(f.w); await isolateFirstEntry(f);
    const realWrite = store.writeJsonAtomic; let failed = false;
    vi.spyOn(store, 'writeJsonAtomic').mockImplementation(async (file, value) => {
      const candidate = value as { entries?: any[] };
      if (!failed && file.endsWith('/outbox.json') && candidate.entries?.[0]?.status === 'sent') {
        failed = true;
        if (phase === 'after_rename') await realWrite(file, value);
        throw new Error('injected_outbox_finalize_failure');
      }
      await realWrite(file, value);
    });
    await expect(f.notifier.flush()).rejects.toThrow('injected_outbox_finalize_failure');
    expect(f.send).toHaveBeenCalledTimes(1);
    f.advance(31_000); f.w.lastObservedAtMs += 31_000;
    const concurrent = new LiveTelegramNotifier(f.options); await concurrent.observe(f.w); await concurrent.flush();
    expect(f.send).toHaveBeenCalledTimes(1);
    await f.notifier.flush(); await f.notifier.flush();
    expect(f.send).toHaveBeenCalledTimes(1);
    const entry = (await f.state()).entries[0]; expect(entry.status).toBe('sent'); expect(entry.messageId).toBe('123');
    expect(entry.uncertain).toBe(false);
  });
  it('recovers an ambiguous selection write after its bounded lease without restarting the notifier', async () => {
    const f = await fixture(); await f.notifier.observe(f.w); await isolateFirstEntry(f);
    const realWrite = store.writeJsonAtomic; let failed = false;
    vi.spyOn(store, 'writeJsonAtomic').mockImplementation(async (file, value) => {
      const candidate = value as { entries?: any[] };
      await realWrite(file, value);
      if (!failed && file.endsWith('/outbox.json') && candidate.entries?.[0]?.status === 'sending') {
        failed = true; throw new Error('injected_selection_fsync_failure');
      }
    });
    await expect(f.notifier.flush()).rejects.toThrow('injected_selection_fsync_failure');
    expect(f.send).not.toHaveBeenCalled();
    await f.notifier.observe(f.w); expect((await f.state()).entries[0].status).toBe('sending');
    f.advance(31_000); f.w.lastObservedAtMs += 31_000; await f.notifier.observe(f.w);
    let entry = (await f.state()).entries[0]; expect(entry.status).toBe('pending'); expect(entry.uncertain).toBe(true);
    await f.notifier.flush(); expect(f.send).not.toHaveBeenCalled();
    f.advance(5000); await f.notifier.flush(); expect(f.send).toHaveBeenCalledTimes(1);
    expect(f.send.mock.calls[0][1]).toContain('Gửi lại: lần trước chưa xác nhận');
    entry = (await f.state()).entries[0]; expect(entry.status).toBe('sent'); expect(entry.attempts).toBe(2);
  });
  it('never steals a real in-flight send from another notifier in the same process, even after its lease', async () => {
    const f = await fixture(); await f.notifier.observe(f.w); await isolateFirstEntry(f);
    let release!: (value: string) => void, entered!: () => void;
    const started = new Promise<void>(resolve => { entered = resolve; });
    f.send.mockImplementation(() => { entered(); return new Promise<string>(resolve => { release = resolve; }); });
    const sending = f.notifier.flush(); await started;
    f.advance(31_000); f.w.lastObservedAtMs += 31_000;
    const concurrent = new LiveTelegramNotifier(f.options); await concurrent.observe(f.w); await concurrent.flush();
    expect(f.send).toHaveBeenCalledTimes(1); expect((await f.state()).entries[0].status).toBe('sending');
    release('123'); await sending; expect((await f.state()).entries[0].status).toBe('sent');
  });
  it('does not reclaim an expired lease while the different recorded sender process is still alive', async () => {
    const f = await fixture(); await f.notifier.observe(f.w); await isolateFirstEntry(f);
    const state = await f.state(); Object.assign(state.entries[0], { status: 'sending', attempts: 1,
      senderPid: process.ppid, sendLeaseUntilMs: f.w.lastObservedAtMs - 1 });
    await fs.writeFile(path.join(f.directory, 'telegram/outbox.json'), JSON.stringify(state));
    const concurrent = new LiveTelegramNotifier(f.options); await concurrent.observe(f.w); await concurrent.flush();
    expect(f.send).not.toHaveBeenCalled(); expect((await f.state()).entries[0].status).toBe('sending');
  });
  it('recovers an interrupted sending record as uncertain, waits, and discloses possible duplicate delivery', async () => {
    const f = await fixture(); await f.notifier.observe(f.w); const state = await f.state();
    state.entries[0].status = 'sending'; state.entries[0].attempts = 1; state.entries[0].senderPid = 99999999;
    await fs.writeFile(path.join(f.directory, 'telegram/outbox.json'), JSON.stringify(state));
    const restarted = new LiveTelegramNotifier(f.options); await restarted.observe(f.w);
    // The other, non-interrupted snapshot may proceed immediately.
    await restarted.flush(); f.advance(6000); await restarted.flush();
    expect(f.send.mock.calls.some(([, text]) => text.includes('Gửi lại: lần trước chưa xác nhận'))).toBe(true);
  });
  it('records a closed-day report once and publishes a correction when timed funding arrives late', async () => {
    const f = await fixture(); await f.notifier.observe(f.w);
    const previous = { ...f.w.currentDay }; f.w.days = [previous]; f.w.currentDay = { ...previous, day: '2026-10-17' };
    f.w.lastObservedAtMs = Date.parse('2026-10-16T17:00:00Z'); await f.notifier.observe(f.w); await f.notifier.observe(f.w);
    expect((await f.state()).entries.filter((e: any) => e.eventId === 'closed-day:2026-10-16')).toHaveLength(1);
    f.w.incomes.push({ time: Date.parse('2026-10-16T16:59:00Z'), incomeType: 'FUNDING_FEE', income: '-.0123' });
    await f.notifier.observe(f.w); await f.notifier.observe(f.w);
    const corrections = (await f.state()).entries.filter((e: any) => e.eventId.startsWith('closed-day:2026-10-16:correction:'));
    expect(corrections).toHaveLength(1); expect(corrections[0].text).toContain('-0.0123 USDT');
    expect(corrections[0].text).toContain('xấp xỉ');
  });
  it('does not consume the fresh scheduled report slot with stale observations', async () => {
    const f = await fixture(); await f.notifier.observe(f.w); f.advance(30_000);
    await f.notifier.reportCurrentDay();
    expect((await f.state()).entries.some((e: any) => e.eventId.startsWith('scheduled-stale:'))).toBe(true);
    f.w.lastObservedAtMs += 30_000; await f.notifier.observe(f.w); await f.notifier.reportCurrentDay();
    await f.notifier.reportCurrentDay(); expect((await f.state()).entries.filter((e: any) => e.eventId.startsWith('scheduled-day:'))).toHaveLength(1);
  });
  it('completes a stale scheduled report automatically on the next fresh observation, including a notifier restart', async () => {
    const f = await fixture(); await f.notifier.observe(f.w); f.advance(30_000); await f.notifier.reportCurrentDay();
    expect((await f.state()).pendingDailyReport.day).toBe(f.w.currentDay.day);
    f.w.lastObservedAtMs += 30_000;
    const restarted = new LiveTelegramNotifier(f.options); await restarted.observe(f.w); await restarted.observe(f.w);
    const state = await f.state(); expect(state.pendingDailyReport).toBeUndefined();
    expect(state.entries.filter((e: any) => e.eventId === `scheduled-day:${f.w.currentDay.day}`)).toHaveLength(1);
  });
  it('catches up a missed fixed daily slot after restart without duplicating the day report', async () => {
    const f = await fixture(); await f.notifier.observe(f.w);
    f.advance(3 * 3_600_000); f.w.lastObservedAtMs += 3 * 3_600_000;
    const restarted = new LiveTelegramNotifier(f.options); await restarted.observe(f.w); await restarted.observe(f.w);
    const secondRestart = new LiveTelegramNotifier(f.options); await secondRestart.observe(f.w);
    const state = await f.state(); expect(state.entries.filter((e: any) => e.eventId === 'scheduled-day:2026-10-16')).toHaveLength(1);
    expect(state.pendingDailyReport).toBeUndefined();
  });
  it('uses the configured fixed daily slot, including an explicit seconds field', async () => {
    const f = await fixture(); const notifier = new LiveTelegramNotifier({ ...f.options, dailyCron: '30 0 20 * * *' });
    await notifier.observe(f.w); expect((await f.state()).events.some((id: string) => id.startsWith('scheduled-day:'))).toBe(false);
    f.advance(3_629_000); f.w.lastObservedAtMs += 3_629_000; await notifier.observe(f.w);
    expect((await f.state()).events.some((id: string) => id.startsWith('scheduled-day:'))).toBe(false);
    f.advance(1000); f.w.lastObservedAtMs += 1000; await notifier.observe(f.w);
    expect((await f.state()).entries.filter((e: any) => e.eventId === 'scheduled-day:2026-10-16')).toHaveLength(1);
  });
  it('never fills an older missed report with the new day wallet', async () => {
    const f = await fixture(); await f.notifier.observe(f.w); f.advance(30_000); await f.notifier.reportCurrentDay();
    f.advance(5 * 3_600_000); f.w.lastObservedAtMs += 5 * 3_600_000 + 30_000;
    f.w.currentDay = { ...f.w.currentDay, day: '2026-10-17' };
    const restarted = new LiveTelegramNotifier(f.options); await restarted.observe(f.w);
    const state = await f.state(); expect(state.pendingDailyReport).toBeUndefined();
    expect(state.events).not.toContain('scheduled-day:2026-10-16');
    expect(state.events).not.toContain('scheduled-day:2026-10-17');
  });
  it('retains a real pending callback for a non-daily cron without inferring a different schedule', async () => {
    const f = await fixture(); const options = { ...f.options, dailyCron: '0 21 * * 1-5' };
    const notifier = new LiveTelegramNotifier(options); await notifier.observe(f.w);
    f.advance(3 * 3_600_000); f.w.lastObservedAtMs += 3 * 3_600_000; await notifier.observe(f.w);
    expect((await f.state()).events).not.toContain('scheduled-day:2026-10-16');
    f.advance(30_000); await notifier.reportCurrentDay();
    f.w.lastObservedAtMs += 30_000;
    const restarted = new LiveTelegramNotifier(options); await restarted.observe(f.w);
    expect((await f.state()).entries.filter((e: any) => e.eventId === 'scheduled-day:2026-10-16')).toHaveLength(1);
  });
  it('emits explicit context corrections for earlier fills published after a close notice', async () => {
    const f = await fixture(); f.w.trades = [buy(f.w.lastObservedAtMs), sell(f.w.lastObservedAtMs + 10)];
    await f.notifier.observe(f.w);
    f.w.trades.push({ ...buy(f.w.lastObservedAtMs - 1), id: '9007199254740991', qty: '1', commission: '.3' });
    await f.notifier.observe(f.w); await f.notifier.observe(f.w);
    const corrections = (await f.state()).entries.filter((e: any) => e.kind === 'trade' && e.eventId.includes(':correction:'));
    expect(corrections).toHaveLength(2); expect(corrections[0].text).toContain('ĐÍNH CHÍNH');
  });
  it('keeps failed destinations separate, redacts delivery errors, and rejects another wallet identity', async () => {
    const f = await fixture(); await f.notifier.observe(f.w);
    f.send.mockRejectedValue(new Error('https://api.telegram.org/botSECRET/sendMessage token=SECRET'));
    await f.notifier.flush(); const state = await f.state();
    expect(JSON.stringify(state)).not.toContain('SECRET'); expect(state.entries[0].status).toBe('pending');
    await expect(f.notifier.observe({ ...f.w, accountIdentity: 'different-account' })).rejects.toThrow('different live wallet');
  });
  it('disabled notifications neither send nor write an outbox', async () => {
    const f = await fixture(); const notifier = new LiveTelegramNotifier({ ...f.options, enabled: false });
    await notifier.observe(f.w); await notifier.flush(); await notifier.reportCurrentDay(); await notifier.recordError('ignored');
    expect(f.send).not.toHaveBeenCalled(); expect(await fs.readdir(f.directory)).toEqual([]);
  });
  it('does not flush or append to a foreign bound outbox after ownership rejection', async () => {
    const f = await fixture(); await f.notifier.observe(f.w);
    const before = await fs.readFile(path.join(f.directory, 'telegram/outbox.json'), 'utf8');
    const other = { ...f.w, accountIdentity: 'different-account' };
    const notifier = new LiveTelegramNotifier(f.options);
    await expect(notifier.observe(other)).rejects.toThrow('different live wallet');
    await expect(notifier.flush()).rejects.toThrow('different live wallet');
    await expect(notifier.recordError('Foreign incident', other)).rejects.toThrow('different live wallet');
    await notifier.reportCurrentDay();
    expect(f.send).not.toHaveBeenCalled();
    expect(await fs.readFile(path.join(f.directory, 'telegram/outbox.json'), 'utf8')).toBe(before);
  });
  it('waits for an authenticated owner before draining an existing bound outbox on restart', async () => {
    const f = await fixture(); await f.notifier.observe(f.w);
    const restarted = new LiveTelegramNotifier(f.options);
    await expect(restarted.flush()).rejects.toThrow('different live wallet');
    expect(f.send).not.toHaveBeenCalled();
    await restarted.observe(f.w); await restarted.flush();
    expect(f.send).toHaveBeenCalledTimes(1);
  });
  it('retains an ACK without finalizing a replaced foreign outbox, then restores its own completion', async () => {
    const f = await fixture(); await f.notifier.observe(f.w); await isolateFirstEntry(f);
    let entered!: () => void, release!: (value: string) => void;
    const started = new Promise<void>(resolve => { entered = resolve; });
    f.send.mockImplementation(() => { entered(); return new Promise<string>(resolve => { release = resolve; }); });
    const sending = f.notifier.flush(); await started;
    const own = await f.state(), foreign = structuredClone(own); foreign.accountIdentity = 'replaced-account';
    const file = path.join(f.directory, 'telegram/outbox.json');
    await fs.writeFile(file, JSON.stringify(foreign)); release('123');
    await expect(sending).rejects.toThrow('different live wallet');
    await expect(f.notifier.flush()).rejects.toThrow('different live wallet');
    expect((await f.state()).entries[0].status).toBe('sending'); expect(f.send).toHaveBeenCalledTimes(1);
    await fs.writeFile(file, JSON.stringify(own)); await f.notifier.flush();
    expect((await f.state()).entries[0].status).toBe('sent'); expect(f.send).toHaveBeenCalledTimes(1);
  });
});
