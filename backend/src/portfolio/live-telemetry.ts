import { promises as fs } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { Decimal } from '@prisma/client/runtime/library';
import type { LivePortfolioWallet } from './live-service';

const Money = Decimal.clone({ precision: 40, rounding: Decimal.ROUND_HALF_EVEN });
const DAY = 86_400_000, MINUTE = 60_000;
const decimal = (value: unknown): Decimal | null => {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  try { const n = new Money(value); return n.isFinite() ? n : null; } catch { return null; }
};
const str = (value: Decimal): string => value.isZero() ? '0' : value.toString();
const object = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value)
  ? value as Record<string, unknown> : {};
const financial = (value: unknown): string | null => { const n = decimal(value); return n ? str(n) : null; };
const number = (value: unknown): number | null => Number.isSafeInteger(value) && Number(value) >= 0 ? Number(value) : null;
const ref = (value: unknown): string | null => typeof value === 'string' || typeof value === 'number' ? String(value) : null;

export interface LiveTelemetryRecord {
  schema: 'live-equity-telemetry-v1';
  /** A real sample from this process, never a reconstruction of missing minutes. */
  recordedAtMs: number; observedAtMs: number; observedMinuteMs: number;
  kind: 'minute' | 'event' | 'error';
  values: {
    initialCapital: string | null; allocatedEquity: string | null; accountEquity: string | null;
    authenticatedCashBalance: string | null; availableBalance: string | null;
    netPnl: string | null; dayNetPnl: string | null; dayAnchorEquity: string | null;
    externalCashflow: string | null; realizedPnl: string | null; fundingPnl: string | null;
    feesPaid: string | null; unrealizedMarkPnl: string | null;
  };
  exitEstimate: {
    /** Diagnostics, not a guarantee or a booked expense. Favourable spread is not counted as a gain. */
    model: 'adverse-book-slippage-taker-v1'; takerFeeRate: string | null; slippageBps: string | null;
    fee: string | null; adverseMarkToFill: string | null; totalCost: string | null;
    netPnlAfterEstimatedExit: string | null; missingSymbols: string[];
  };
  positions: Array<{ symbol: string; quantity: string | null; averageEntry: string | null;
    mark: string | null; bid: string | null; ask: string | null; unrealizedMarkPnl: string | null }>;
  quality: {
    equityQuality: LivePortfolioWallet['equityQuality']; unreconciledWalletDelta: string | null;
    observationFresh: boolean; quoteFresh: boolean; observationAgeMs: number; oldestQuoteAtMs: number | null;
    inventorySource: 'authenticated_positions' | 'confirmed_fill_ledger'; inventoryReconciled: boolean | null;
    historyThroughMs: number | null; backgroundErrorLanes: string[];
    workerErrorCode: string | null; droppedRecordsBeforeSample: number;
  };
  state: { status: LivePortfolioWallet['status']; blocked: boolean; day: string; riskLatched: boolean;
    latchReason: string | null; dailyLossLimit: string; softLossThreshold: string; closeBuffer: string;
    sourceCursorMs: number; sourceId: string | null; recoveryPhase: string | null };
  references: { fillCount: number; intentCount: number; incomeCount: number; recentFills: Array<Record<string, unknown>>;
    recentIntents: Array<Record<string, unknown>>; officialLedger: 'live-wallet.json' };
}

/** Pure bounded snapshot. This module never reads credentials, sends requests, or writes financial state. */
export function buildLiveTelemetryRecord(wallet: LivePortfolioWallet, recordedAtMs: number,
  kind: LiveTelemetryRecord['kind'] = 'minute', workerErrorCode: string | null = null,
  droppedRecords = 0): LiveTelemetryRecord {
  const observation = wallet.lastObservation, marks = object(observation.marks), bids = object(observation.bids), asks = object(observation.asks);
  const fee = decimal(observation.feeRate), slipBps = decimal(wallet.config.slippageBps);
  const feeValid = fee !== null && fee.gt(0) && fee.lt('.01');
  const slipValid = slipBps !== null && slipBps.gte(0) && slipBps.lt('10000');
  let unrealized = new Money(0), estimatedFee = new Money(0), impact = new Money(0), completeUnrealized = true;
  const missingSymbols: string[] = [];
  // An ACK may have changed actual inventory before its fill/fee history arrives.
  // Measure the authenticated positions when present, without calling that ACK a fill.
  // A valid empty venue response proves flat inventory even while a closing
  // ACK is waiting for its fill/fee history. Only legacy snapshots without
  // explicit observation provenance may fall back to the confirmed ledger.
  const actualAvailable = observation.authenticatedPositionsObserved === true || wallet.actualPositions.length > 0;
  const actual: Record<string, { quantity: string; averageEntry: string }> = {};
  let actualValid = wallet.actualPositions.length <= 16;
  for (const item of wallet.actualPositions.slice(0, 16)) {
    const quantity = decimal(item.positionAmt), symbol = typeof item.symbol === 'string' ? item.symbol : null;
    if (!quantity || !symbol || Object.prototype.hasOwnProperty.call(actual, symbol)) { actualValid = false; continue; }
    if (quantity.isZero()) continue;
    const owned = wallet.positions[symbol], ownedQuantity = decimal(owned?.quantity);
    const entry = financial(item.entryPrice) ?? (ownedQuantity?.eq(quantity) ? owned?.averageEntry : undefined);
    actual[symbol] = { quantity: str(quantity), averageEntry: entry ?? '' };
  }
  const inventory = actualAvailable ? actual : wallet.positions;
  const inventoryReconciled = actualAvailable ? actualValid && [...new Set([...Object.keys(actual), ...Object.keys(wallet.positions)])]
    .every(symbol => decimal(actual[symbol]?.quantity ?? '0')?.eq(decimal(wallet.positions[symbol]?.quantity ?? '0') ?? 'NaN') === true) : null;
  if (!actualValid) { missingSymbols.push('invalid_authenticated_inventory'); completeUnrealized = false; }
  // The policy owns B5 only; a defensive bound keeps diagnostics cheap even on malformed input.
  const entries = Object.entries(inventory).slice(0, 16);
  const positions = entries.map(([symbol, position]) => {
    const quantity = decimal(position.quantity), entry = decimal(position.averageEntry), mark = decimal(marks[symbol]);
    const bid = decimal(bids[symbol]), ask = decimal(asks[symbol]);
    const markValid = mark !== null && mark.gt(0), entryValid = entry !== null && entry.gt(0);
    const pnl = quantity && entryValid && markValid ? quantity.mul(mark!.minus(entry!)) : null;
    if (pnl) unrealized = unrealized.plus(pnl); else completeUnrealized = false;
    if (!quantity || !markValid || !bid || !ask || bid.lte(0) || ask.lt(bid) || !feeValid || !slipValid) {
      missingSymbols.push(symbol);
    } else {
      const closeBook = quantity.lt(0) ? ask : bid;
      const fill = closeBook.mul(new Money(1).plus(slipBps!.div(10_000).mul(quantity.lt(0) ? 1 : -1)));
      estimatedFee = estimatedFee.plus(quantity.abs().mul(fill).mul(fee!));
      impact = impact.plus(Money.max(quantity.mul(mark!.minus(fill)), 0));
    }
    return { symbol, quantity: quantity ? str(quantity) : null, averageEntry: entryValid ? str(entry!) : null,
      mark: markValid ? str(mark!) : null, bid: bid ? str(bid) : null, ask: ask ? str(ask) : null,
      unrealizedMarkPnl: pnl ? str(pnl) : null };
  });
  if (Object.keys(inventory).length > entries.length) { missingSymbols.push('omitted_positions'); completeUnrealized = false; }
  const hasPositions = entries.length > 0;
  const completeExit = !missingSymbols.length && (!hasPositions || feeValid && slipValid);
  const cost = completeExit ? estimatedFee.plus(impact) : null, net = decimal(wallet.netPnl);
  const oldestQuoteAtMs = number(observation.oldestQuoteAtMs), age = recordedAtMs - wallet.lastObservedAtMs;
  const background = object(observation.background);
  return {
    schema: 'live-equity-telemetry-v1', recordedAtMs, observedAtMs: wallet.lastObservedAtMs,
    observedMinuteMs: Math.floor(wallet.lastObservedAtMs / MINUTE) * MINUTE, kind,
    values: { initialCapital: financial(wallet.config.initialCash), allocatedEquity: financial(wallet.equity),
      accountEquity: financial(wallet.accountEquity), authenticatedCashBalance: financial(observation.authenticatedCashBalance),
      availableBalance: financial(wallet.availableBalance), netPnl: financial(wallet.netPnl),
      dayNetPnl: financial(wallet.currentDay.netPnl), dayAnchorEquity: financial(wallet.currentDay.anchorEquity),
      externalCashflow: financial(wallet.netCashflow), realizedPnl: financial(wallet.realizedPnl), fundingPnl: financial(wallet.fundingPnl),
      feesPaid: financial(wallet.totalFees), unrealizedMarkPnl: completeUnrealized ? str(unrealized) : null },
    exitEstimate: { model: 'adverse-book-slippage-taker-v1', takerFeeRate: feeValid ? str(fee!) : null,
      slippageBps: slipValid ? str(slipBps!) : null, fee: completeExit ? str(estimatedFee) : null,
      adverseMarkToFill: completeExit ? str(impact) : null, totalCost: cost ? str(cost) : null,
      netPnlAfterEstimatedExit: cost && net ? str(net.minus(cost)) : null, missingSymbols },
    positions,
    quality: { equityQuality: wallet.equityQuality, unreconciledWalletDelta: financial(wallet.unreconciledWalletDelta),
      observationFresh: age >= 0 && age <= 5_000, quoteFresh: oldestQuoteAtMs !== null
        && recordedAtMs - oldestQuoteAtMs >= -2_000 && recordedAtMs - oldestQuoteAtMs <= 5_000,
      observationAgeMs: age, oldestQuoteAtMs, historyThroughMs: wallet.historyThroughMs ?? null,
      inventorySource: actualAvailable ? 'authenticated_positions' : 'confirmed_fill_ledger', inventoryReconciled,
      backgroundErrorLanes: Object.keys(object(background.errors)).slice(0, 16),
      workerErrorCode, droppedRecordsBeforeSample: droppedRecords },
    state: { status: wallet.status, blocked: wallet.blockedReason !== null, day: wallet.currentDay.day,
      riskLatched: wallet.currentDay.riskLatched, latchReason: wallet.currentDay.latchReason,
      dailyLossLimit: wallet.config.dailyLossLimitUsd, softLossThreshold: wallet.config.softLossThresholdUsd,
      closeBuffer: wallet.config.closeBufferUsd, sourceCursorMs: wallet.sourceCursorMs, sourceId: wallet.lastSourceId,
      recoveryPhase: wallet.technicalRecovery?.phase ?? null },
    references: { fillCount: wallet.trades.length, intentCount: wallet.intents.length, incomeCount: wallet.incomes.length,
      // Minute rows retain compact IDs. Detailed references are repeated only on
      // state changes, so existing history cannot crowd out a full day's curve.
      recentFills: wallet.trades.slice(kind === 'minute' ? -3 : -20).map(trade => ({ symbol: ref(trade.symbol),
        tradeId: ref(trade.id ?? trade.tradeId), orderId: ref(trade.orderId), timeMs: number(trade.time),
        ...(kind === 'minute' ? {} : { side: ref(trade.side), quantity: financial(trade.qty),
          price: financial(trade.price), commission: financial(trade.commission), realizedPnl: financial(trade.realizedPnl) }) })),
      recentIntents: wallet.intents.slice(kind === 'minute' ? -2 : -10).map(intent => ({ clientOrderId: intent.clientOrderId,
        sourceId: intent.sourceId, symbol: intent.symbol, orderId: intent.orderId, status: intent.status,
        ...(kind === 'minute' ? {} : { quantity: intent.quantity, reduceOnly: intent.reduceOnly,
          createdAtMs: intent.createdAtMs, executedQty: intent.executedQty, observedFillQty: intent.observedFillQty,
          ...(intent.executionContext ? { executionContext: { ...intent.executionContext } } : {}) }) })),
      officialLedger: 'live-wallet.json' },
  };
}

export interface LiveTelemetryOptions { directory: string; now?: () => number; retentionDays?: number;
  maxQueuedRecords?: number; maxJournalBytesPerDay?: number }

/** Optional, lossy measurement stream. Never awaited by the order/risk loop or the wallet lock. */
export class LiveEquityTelemetry {
  private readonly directory: string;
  private readonly clock: () => number;
  private readonly retentionDays: number;
  private readonly maxQueued: number;
  private readonly maxJournalBytes: number;
  private queue: LiveTelemetryRecord[] = [];
  private writing?: Promise<void>;
  private stopped = false;
  private minute?: number;
  private signal?: string;
  private acceptedAtMs?: number;
  private cleanedDay?: string;
  private written = 0;
  private dropped = 0;
  private failed = 0;
  private omittedJournalRecords = 0;
  private journalDay?: string;
  private journalBytes = 0;
  private lastWrittenAtMs: number | null = null;
  private lastObservedAtMs: number | null = null;
  constructor(options: LiveTelemetryOptions) {
    this.directory = path.join(options.directory, 'telemetry');
    this.clock = options.now ?? Date.now;
    this.retentionDays = Math.max(1, Math.min(366, Math.floor(options.retentionDays ?? 32)));
    this.maxQueued = Math.max(1, Math.min(16, Math.floor(options.maxQueuedRecords ?? 4)));
    this.maxJournalBytes = Math.max(1024, Math.min(64 * 1024 * 1024, Math.floor(options.maxJournalBytesPerDay ?? 16 * 1024 * 1024)));
  }
  health(): Record<string, unknown> {
    return { schema: 'live-equity-telemetry-health-v1', retentionDays: this.retentionDays,
      queuedRecords: this.queue.length, writing: this.writing !== undefined, recordsWritten: this.written,
      droppedRecords: this.dropped, failedRecords: this.failed, lastWrittenAtMs: this.lastWrittenAtMs,
      lastObservedAtMs: this.lastObservedAtMs, omittedJournalRecords: this.omittedJournalRecords,
      maxJournalBytesPerDay: this.maxJournalBytes, stopped: this.stopped };
  }
  observe(wallet: LivePortfolioWallet, workerErrorCode: string | null = null): void {
    if (this.stopped) return;
    try {
      const now = this.clock(), minute = Math.floor(now / MINUTE), lastIntent = wallet.intents[wallet.intents.length - 1];
      const signal = JSON.stringify([wallet.currentDay.day, wallet.status, wallet.currentDay.riskLatched,
        wallet.currentDay.latchReason, wallet.sourceCursorMs, wallet.lastSourceId, wallet.trades.length,
        wallet.incomes.length, wallet.intents.length, lastIntent?.status, lastIntent?.observedFillQty,
        wallet.technicalRecovery?.phase, wallet.equityQuality, workerErrorCode]);
      if (this.minute === minute && this.signal === signal) return;
      // State flapping cannot create a disk writer on every 2s financial tick.
      // A later sample retains cumulative counts and the official ledger remains complete.
      if (this.minute === minute && this.acceptedAtMs !== undefined && now - this.acceptedAtMs < 10_000) {
        this.dropped++; return;
      }
      const kind = workerErrorCode ? 'error' : this.minute !== minute ? 'minute' : 'event';
      const record = buildLiveTelemetryRecord(wallet, now, kind, workerErrorCode, this.dropped);
      this.minute = minute; this.signal = signal; this.acceptedAtMs = now;
      if (this.queue.length >= this.maxQueued) { this.queue.shift(); this.dropped++; }
      this.queue.push(record); this.start();
    } catch { this.failed++; }
  }
  private start(): void {
    if (this.writing || this.stopped) return;
    // Deferring the first I/O also keeps observe() itself independent of filesystem latency.
    this.writing = Promise.resolve().then(async () => {
      while (this.queue.length && !this.stopped) {
        const record = this.queue.shift()!;
        try {
          await this.persist(record);
          this.written++; this.lastWrittenAtMs = this.clock(); this.lastObservedAtMs = record.observedAtMs;
        } catch { this.failed++; }
      }
    }).finally(() => { this.writing = undefined; if (this.queue.length && !this.stopped) this.start(); });
  }
  private async replace(file: string, value: unknown): Promise<void> {
    const temporary = `${file}.${process.pid}.${randomUUID()}.tmp`;
    try {
      await fs.writeFile(temporary, `${JSON.stringify(value)}\n`, { flag: 'wx', mode: 0o600 });
      await fs.rename(temporary, file);
    } finally { await fs.rm(temporary, { force: true }).catch(() => {}); }
  }
  private async persist(record: LiveTelemetryRecord): Promise<void> {
    await fs.mkdir(this.directory, { recursive: true, mode: 0o700 });
    const day = new Date(record.recordedAtMs).toISOString().slice(0, 10);
    const journalFile = path.join(this.directory, `equity-${day}.jsonl`), line = `${JSON.stringify(record)}\n`;
    if (this.journalDay !== day) {
      try { this.journalBytes = (await fs.stat(journalFile)).size; }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; this.journalBytes = 0; }
      this.journalDay = day;
    }
    if (this.journalBytes + Buffer.byteLength(line) <= this.maxJournalBytes) {
      await fs.appendFile(journalFile, line, { mode: 0o600 }); this.journalBytes += Buffer.byteLength(line);
    } else this.omittedJournalRecords++;
    await this.replace(path.join(this.directory, 'latest.json'), record);
    await this.replace(path.join(this.directory, 'health.json'), { ...this.health(), recordsWritten: this.written + 1,
      lastWrittenAtMs: this.clock(), lastObservedAtMs: record.observedAtMs });
    if (this.cleanedDay !== day) {
      const oldest = Math.floor(record.recordedAtMs / DAY) * DAY - (this.retentionDays - 1) * DAY;
      for (const file of await fs.readdir(this.directory)) {
        const match = /^equity-(\d{4}-\d{2}-\d{2})\.jsonl$/.exec(file);
        if (match && Date.parse(`${match[1]}T00:00:00Z`) < oldest) await fs.unlink(path.join(this.directory, file));
      }
      this.cleanedDay = day;
    }
  }
  /** Offline tests/explicit readers only. Production monitoring never waits for optional telemetry. */
  async flush(): Promise<void> { while (this.writing) await this.writing; }
  stop(): void { this.stopped = true; this.dropped += this.queue.length; this.queue = []; }
}
