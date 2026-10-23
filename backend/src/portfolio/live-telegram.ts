import { createHash } from 'node:crypto';
import path from 'node:path';
import cron, { type ScheduledTask } from 'node-cron';
import { Decimal } from '@prisma/client/runtime/library';
import { readJson, writeJsonAtomic, withPortfolioLock } from './paper-store';
import type { LiveIntent, LivePortfolioWallet } from './live-service';
// Type-checked against the live policy without loading the trading engine into notifications.
const LIVE_POLICY_ID: LivePortfolioWallet['policyId'] = 'CONSTANT_DIRECTION_B5_S6_DAILY15_V1';
import { formatLiveTradeMessage, formatLiveDailyReport, formatLiveStatusMessage,
  formatLiveRiskMessage, formatLiveErrorMessage, formatLivePendingMessage, sanitizeLiveTelegramReason } from './live-telegram-format';
import { LiveTelegramDeliveryError } from './live-telegram-transport';
import { isDeferrableLiveNotificationError } from './live-telegram-error-policy';
import { formatImportantTradeMessage, formatImportantDailyReport, formatImportantRiskMessage,
  formatImportantErrorMessage, formatImportantRecoveryMessage } from './live-telegram-important-format';

const Money = Decimal.clone({ precision: 40, rounding: Decimal.ROUND_HALF_EVEN });
const d = (value: unknown): Decimal => {
  if (typeof value !== 'string' && typeof value !== 'number') throw new Error('Invalid notification financial value');
  const result = new Money(value); if (!result.isFinite()) throw new Error('Invalid notification financial value'); return result;
};
const hash = (value: string): string => createHash('sha256').update(value).digest('hex');
const dayOf = (time: number): string => new Date(time + 25_200_000).toISOString().slice(0, 10);
const ERROR_DEBOUNCE_MS = 5 * 60_000;
const LEDGER_PUBLICATION_GRACE_MS = 30_000;
const SEND_LEASE_MS = 30_000;
const IMPORTANT_TRANSIENT_MS = 60_000, IMPORTANT_HEALTHY_MS = 30_000, TECHNICAL_NOTICE_HEALTHY_MS = 120_000;
// Share ownership across notifier instances in this process; a second instance
// must not mistake another live sender using the same PID for an orphan.
const activeSendAttempts = new Set<string>();
const TERMINAL_INTENT_STATUSES = ['FILLED', 'CANCELED', 'CANCELLED', 'REJECTED', 'EXPIRED', 'EXPIRED_IN_MATCH'];
/** An ACK can justify a short notification wait, but never supplies authenticated fills or fees. */
function expectedLedgerPublication(wallet: LivePortfolioWallet, now: number): LiveIntent[] | null {
  if (wallet.status !== 'reconciliation_required' || wallet.blockedReason !== 'unresolved_or_partial_order'
    || wallet.currentDay.riskLatched
    || wallet.currentDay.stopReasons?.some(reason => reason !== 'live_monitoring_gap')
    || d(wallet.currentDay.breachUsd).gt(0) || !Number.isSafeInteger(now)
    || !Number.isSafeInteger(wallet.lastObservedAtMs) || wallet.lastObservedAtMs > now
    || now - wallet.lastObservedAtMs > 5_000) return null;
  const background = wallet.lastObservation.background as { errors?: Record<string, unknown> } | undefined;
  if (background?.errors && Object.keys(background.errors).length) return null;
  try {
    const pending = wallet.intents.filter(intent => !TERMINAL_INTENT_STATUSES.includes(intent.status)
      || !d(intent.executedQty).eq(intent.observedFillQty));
    if (!pending.length) return null;
    for (const intent of pending) {
      const quantity = d(intent.quantity).abs(), executed = d(intent.executedQty), observed = d(intent.observedFillQty);
      if (intent.status !== 'FILLED' || !intent.submittedOnce || intent.lastError
        || typeof intent.orderId !== 'string' || !/^[1-9][0-9]*$/.test(intent.orderId)
        || !intent.clientOrderId || !intent.symbol || quantity.lte(0) || !executed.eq(quantity)
        || observed.lt(0) || !observed.lt(executed) || !Number.isSafeInteger(intent.createdAtMs)
        || intent.createdAtMs < wallet.startedAtMs || intent.createdAtMs > wallet.lastObservedAtMs
        || now - intent.createdAtMs >= LEDGER_PUBLICATION_GRACE_MS) return null;
    }
    return pending;
  } catch { return null; }
}
const errorFingerprint = (reason: string): string => {
  const safe = sanitizeLiveTelegramReason(reason);
  // Any stale constituent quote blocks this one portfolio; changing the symbol is not a new incident.
  return hash(/\bstale venue quote\b/i.test(safe) ? 'stale_venue_quote_portfolio' : safe);
};
type Kind = 'trade' | 'risk' | 'error' | 'recovery' | 'status' | 'daily' | 'progress';
export interface LiveTelegramEntry {
  id: string; eventId: string; kind: Kind; chatId: string; text: string; createdAtMs: number;
  status: 'pending' | 'sending' | 'sent' | 'failed' | 'suppressed'; attempts: number; nextAttemptAtMs: number;
  messageId: string | null; lastError: string | null; senderPid: number | null; uncertain: boolean;
  sendLeaseUntilMs?: number;
  /** Stable category identity survives human-readable wording changes and v1 migration. */
  errorFingerprint?: string;
}
interface State {
  schema: 'live-telegram-v1'; policyId: string; accountIdentity: string; walletStartedAtMs: number;
  createdAtMs: number; lastObservedAtMs: number; errorSequence: number; activeError: string | null;
  events: string[]; entries: LiveTelegramEntry[];
  sendNotBeforeMs?: number;
  errorAlerts?: Record<string, { lastAlertAtMs: number; sequence: number }>;
  tradeContexts?: Record<string, string>; dailyDigests?: Record<string, string>; dayLastObserved?: Record<string, number>;
  pendingDailyReport?: { day: string; dueAtMs: number };
  importantNotice?: { firstErrorAtMs: number; lastErrorAtMs: number; alerted: boolean;
    recoveryKey?: string; healthySinceMs?: number; technicalOnly?: boolean };
  suppressedEvents?: number;
}
class LiveTelegramOwnershipError extends Error {
  constructor() { super('Telegram outbox belongs to a different live wallet'); }
}
export interface LiveTelegramOptions {
  directory: string; enabled: boolean; chatIds: string[];
  notifyTrades?: boolean; notifyRisk?: boolean; dailyCron?: string;
  /** Plain business events only; legacy integrations retain their existing policy. */
  importantOnly?: boolean;
  send: (chatId: string, text: string) => Promise<string>;
  now?: () => number; automatic?: boolean;
}

/** Separate durable notification outbox. It never edits the financial wallet or calls Binance. */
export class LiveTelegramNotifier {
  private readonly directory: string;
  private tail: Promise<unknown> = Promise.resolve();
  private running = false;
  private stopped = false;
  private timer?: ReturnType<typeof setInterval>;
  private task?: ScheduledTask;
  private latest?: LivePortfolioWallet;
  private owner?: { accountIdentity: string; startedAtMs: number; policyId: string };
  private readonly pendingCompletions = new Map<string, { attempts: number; messageId: string | null;
    failure: LiveTelegramDeliveryError | null }>();
  private readonly dailyTime?: { hour: number; minute: number; second: number };
  private readonly clock: () => number;
  constructor(private readonly options: LiveTelegramOptions) {
    this.directory = path.join(options.directory, 'telegram'); this.clock = options.now ?? Date.now;
    const expression = options.dailyCron ?? '0 21 * * *';
    const fields = expression.trim().split(/\s+/), second = fields.length === 6 ? fields.shift()! : '0';
    // Infer missed slots only for a fixed daily schedule. Other valid cron
    // expressions still persist the due slot when their real callback runs.
    if (fields.length === 5 && fields.slice(2).every(field => field === '*')
      && [second, fields[0], fields[1]].every(field => /^\d+$/.test(field))) {
      const time = { second: Number(second), minute: Number(fields[0]), hour: Number(fields[1]) };
      if (time.second <= 59 && time.minute <= 59 && time.hour <= 23) this.dailyTime = time;
    }
    if (options.enabled && options.automatic !== false) {
      this.timer = setInterval(() => { void this.flush().catch(error => this.recordInternalFailure(error)); }, 1000);
      this.timer.unref();
      if (!cron.validate(expression)) throw new Error('Invalid live Telegram report schedule');
      this.task = cron.schedule(expression, () => {
        void this.reportCurrentDay().catch(error => this.recordInternalFailure(error));
      }, { timezone: 'Asia/Ho_Chi_Minh' });
    }
  }
  private bindWallet(wallet: LivePortfolioWallet): void {
    if (wallet.policyId !== LIVE_POLICY_ID || !wallet.accountIdentity || wallet.accountIdentity === 'unbound'
      || !Number.isSafeInteger(wallet.startedAtMs) || wallet.startedAtMs < 0
      || this.owner && (this.owner.accountIdentity !== wallet.accountIdentity
        || this.owner.startedAtMs !== wallet.startedAtMs || this.owner.policyId !== wallet.policyId)) {
      throw new LiveTelegramOwnershipError();
    }
    this.owner ??= { accountIdentity: wallet.accountIdentity, startedAtMs: wallet.startedAtMs, policyId: wallet.policyId };
  }
  private assertStateOwner(state: State | null): void {
    if (!state) return;
    if (state.schema !== 'live-telegram-v1' || state.policyId !== LIVE_POLICY_ID
      || !Array.isArray(state.entries) || !Array.isArray(state.events)) throw new LiveTelegramOwnershipError();
    // Bootstrap errors contain no authenticated wallet data and may be delivered
    // before the first successful account observation binds this notifier.
    if (state.accountIdentity === 'unbound' && state.walletStartedAtMs === 0
      && state.entries.every(entry => entry.kind === 'error')) return;
    if (!this.owner || state.accountIdentity !== this.owner.accountIdentity
      || state.walletStartedAtMs !== this.owner.startedAtMs) throw new LiveTelegramOwnershipError();
  }
  private async recordInternalFailure(error?: unknown): Promise<void> {
    if (error instanceof LiveTelegramOwnershipError) return;
    // No exception payload or recipient/token can reach logs or the public read model.
    await writeJsonAtomic(path.join(this.directory, 'health.json'), {
      enabled: this.options.enabled, status: 'notification_storage_error', updatedAt: new Date(this.clock()).toISOString(),
    }).catch(() => {});
  }
  private mutate<T>(fn: (state: State | null) => Promise<{ state: State | null; result: T }>): Promise<T> {
    const job = this.tail.then(() => withPortfolioLock(this.directory, async () => {
      const state = await readJson<State>(path.join(this.directory, 'outbox.json'));
      this.assertStateOwner(state);
      const before = JSON.stringify(state);
      if (state && this.options.importantOnly) for (const entry of state.entries) {
        // Only silence untouched low-priority backlog. Never alter an ACK,
        // in-flight request, uncertain retry or a money/transaction alert.
        if (entry.status === 'pending' && entry.attempts === 0 && !entry.uncertain
          && !entry.messageId && !entry.senderPid && this.muted(entry.kind, entry.eventId)) {
          entry.status = 'suppressed'; entry.lastError = 'muted_by_important_policy';
        }
      }
      const next = await fn(state);
      this.assertStateOwner(next.state);
      if (next.state && JSON.stringify(next.state) !== before) {
        await writeJsonAtomic(path.join(this.directory, 'outbox.json'), next.state);
        await this.health(next.state);
      }
      return next.result;
    }));
    this.tail = job.catch(() => {}); return job;
  }
  private async health(state: State): Promise<void> {
    const sent = state.entries.filter(e => e.status === 'sent');
    await writeJsonAtomic(path.join(this.directory, 'health.json'), {
      enabled: this.options.enabled, status: state.entries.some(e => e.status === 'failed') ? 'delivery_failed' : 'ready',
      notificationMode: this.options.importantOnly ? 'important_only' : 'all',
      suppressed: state.entries.filter(e => e.status === 'suppressed').length + (state.suppressedEvents ?? 0),
      pending: state.entries.filter(e => e.status === 'pending' || e.status === 'sending').length,
      sent: sent.length, failed: state.entries.filter(e => e.status === 'failed').length,
      uncertain: state.entries.filter(e => e.uncertain).length,
      lastMessageId: sent.at(-1)?.messageId ?? null, updatedAt: new Date(this.clock()).toISOString(),
    });
  }
  private muted(kind: Kind, eventId: string): boolean {
    return this.options.importantOnly === true && (kind === 'status' || kind === 'progress'
      || kind === 'daily' && !eventId.startsWith('scheduled-day:')
      || kind === 'recovery' && !eventId.startsWith('important-recovery:'));
  }
  private recoverImportantNotice(state: State, wallet: LivePortfolioWallet, externalError?: string): void {
    const notice = state.importantNotice; if (!this.options.importantOnly || !notice) return;
    const now = this.clock();
    const errors = (wallet.lastObservation.background as { errors?: Record<string, unknown> } | undefined)?.errors;
    const healthy = !externalError && !['reconciling', 'stabilizing', 'resuming', 'blocked'].includes(wallet.technicalRecovery?.phase ?? '')
      && ['active', 'flat'].includes(wallet.status) && !wallet.currentDay.riskLatched
      && wallet.equityQuality === 'reconciled' && d(wallet.unreconciledWalletDelta).isZero()
      && wallet.lastObservedAtMs <= now && now - wallet.lastObservedAtMs <= 5000
      && !Object.keys(errors ?? {}).length && wallet.intents.every(intent => TERMINAL_INTENT_STATUSES.includes(intent.status)
        && d(intent.executedQty).eq(intent.observedFillQty));
    if (!healthy || now - notice.lastErrorAtMs < 5000) { delete notice.healthySinceMs; return; }
    notice.healthySinceMs ??= now;
    if (now - notice.healthySinceMs < (notice.technicalOnly ? TECHNICAL_NOTICE_HEALTHY_MS : IMPORTANT_HEALTHY_MS)) return;
    if (notice.alerted && notice.recoveryKey && ![...new Set(this.options.chatIds)].every(chatId =>
      state.entries.some(entry => entry.eventId === notice.recoveryKey && entry.chatId === chatId && entry.status === 'sent'))) return;
    if (notice.alerted && notice.recoveryKey) this.add(state, `important-recovery:${notice.recoveryKey}`, 'recovery',
      formatImportantRecoveryMessage(wallet));
    delete state.importantNotice; state.activeError = null;
  }
  private add(state: State, eventId: string, kind: Kind, text: string, errorKey?: string): void {
    if (state.events.includes(eventId)) return;
    if (text.length > 3500) throw new Error('Live Telegram message exceeds durable outbox limit');
    state.events.push(eventId);
    if (this.muted(kind, eventId)) { state.suppressedEvents = (state.suppressedEvents ?? 0) + 1; return; }
    if ((kind === 'trade' && this.options.notifyTrades === false)
      || (['risk', 'error', 'recovery', 'progress'].includes(kind) && this.options.notifyRisk === false)) return;
    if (this.options.importantOnly && kind === 'risk' && this.options.chatIds.length) {
      const now = this.clock();
      state.importantNotice = { firstErrorAtMs: state.importantNotice?.firstErrorAtMs ?? now,
        lastErrorAtMs: now, alerted: true, recoveryKey: eventId, technicalOnly: false };
    }
    for (const chatId of new Set(this.options.chatIds)) {
      state.entries.push({ id: `${eventId}:${hash(chatId).slice(0, 12)}`, eventId, kind, chatId, text,
        createdAtMs: this.clock(), status: 'pending', attempts: 0, nextAttemptAtMs: this.clock(),
        messageId: null, lastError: null, senderPid: null, uncertain: false,
        ...(errorKey ? { errorFingerprint: errorKey } : {}) });
    }
  }
  private attemptKey(entry: Pick<LiveTelegramEntry, 'id' | 'attempts'>): string {
    return JSON.stringify([this.directory, entry.id, entry.attempts]);
  }
  private recoverSending(state: State): void {
    for (const entry of state.entries.filter(item => item.status === 'sending')) {
      if (activeSendAttempts.has(this.attemptKey(entry))
        || this.pendingCompletions.get(entry.id)?.attempts === entry.attempts) continue;
      if (entry.senderPid && entry.senderPid !== process.pid) {
        try { process.kill(entry.senderPid, 0); continue; }
        catch (error) {
          // EPERM does not prove that a sender has exited.
          if ((error as NodeJS.ErrnoException).code !== 'ESRCH') continue;
        }
      }
      if (Number.isSafeInteger(entry.sendLeaseUntilMs) && entry.sendLeaseUntilMs! > this.clock()) continue;
      entry.status = 'pending'; entry.uncertain = true; entry.senderPid = null;
      delete entry.sendLeaseUntilMs;
      entry.nextAttemptAtMs = this.clock() + 5000; entry.lastError = 'previous_send_unconfirmed';
    }
  }
  private captureDailyReport(state: State, wallet: LivePortfolioWallet, dueNow = false): void {
    const now = this.clock(), today = dayOf(now), eventId = `scheduled-day:${today}`;
    if (state.pendingDailyReport && state.pendingDailyReport.day !== today) delete state.pendingDailyReport;
    if (state.events.includes(eventId)) { delete state.pendingDailyReport; return; }
    const time = this.dailyTime;
    const inferredDue = time ? Date.parse(`${today}T00:00:00Z`) - 25_200_000
      + (time.hour * 3600 + time.minute * 60 + time.second) * 1000 : undefined;
    if (dueNow || inferredDue !== undefined && now >= inferredDue) {
      state.pendingDailyReport ??= { day: today, dueAtMs: dueNow ? now : inferredDue! };
    }
    if (state.pendingDailyReport?.day !== today || state.pendingDailyReport.dueAtMs > now) return;
    const fresh = wallet.currentDay.day === today && wallet.lastObservedAtMs <= now
      && now - wallet.lastObservedAtMs <= 15_000;
    if (fresh) {
      this.add(state, eventId, 'daily', this.options.importantOnly
        ? formatImportantDailyReport(wallet, wallet.currentDay) : formatLiveDailyReport(wallet, wallet.currentDay, false));
      delete state.pendingDailyReport;
    } else if (dueNow && !this.options.importantOnly) {
      this.add(state, `scheduled-stale:${today}:${wallet.currentDay.day}`, 'daily',
        '⚠️ BÁO CÁO TẠM DÙNG SỐ LIỆU CŨ; ĐANG CHỜ CẬP NHẬT TỪ SÀN.\n'
        + formatLiveDailyReport(wallet, wallet.currentDay, false));
    }
  }
  private async persistCompletions(): Promise<void> {
    if (!this.pendingCompletions.size) return;
    const completed = [...this.pendingCompletions];
    await this.mutate(async state => {
      for (const [id, completion] of completed) {
        const entry = state?.entries.find(item => item.id === id);
        if (!entry || entry.status !== 'sending' || entry.attempts !== completion.attempts) continue;
        entry.senderPid = null; delete entry.sendLeaseUntilMs;
        if (completion.messageId) { entry.status = 'sent'; entry.messageId = completion.messageId; entry.lastError = null; }
        else {
          const failure = completion.failure;
          entry.status = failure?.permanent ? 'failed' : 'pending'; entry.lastError = failure?.reason ?? 'telegram_delivery_unconfirmed';
          entry.uncertain = entry.uncertain || failure?.uncertain === true;
          entry.nextAttemptAtMs = this.clock() + Math.max(failure?.retryAfterMs ?? 0,
            Math.min(300_000, 2000 * 2 ** Math.min(entry.attempts - 1, 8)));
          if (state && (failure?.retryAfterMs ?? 0) > 0) state.sendNotBeforeMs = this.clock() + failure!.retryAfterMs;
        }
      }
      return { state, result: undefined };
    });
    // Keep the outcome until the complete durable write (including fsync) succeeds.
    for (const [id, completion] of completed) if (this.pendingCompletions.get(id) === completion) {
      this.pendingCompletions.delete(id);
      activeSendAttempts.delete(this.attemptKey({ id, attempts: completion.attempts }));
    }
  }
  async observe(wallet: LivePortfolioWallet, externalError?: string): Promise<void> {
    if (!this.options.enabled || this.stopped) return;
    this.bindWallet(wallet);
    await this.mutate(async prior => {
      const state: State = prior ?? { schema: 'live-telegram-v1', policyId: LIVE_POLICY_ID,
        accountIdentity: wallet.accountIdentity, walletStartedAtMs: wallet.startedAtMs,
        createdAtMs: this.clock(), lastObservedAtMs: wallet.lastObservedAtMs, errorSequence: 0,
        activeError: null, events: [], entries: [] };
      if (state.accountIdentity === 'unbound' && state.walletStartedAtMs === 0) {
        state.accountIdentity = wallet.accountIdentity; state.walletStartedAtMs = wallet.startedAtMs;
      }
      if (state.schema !== 'live-telegram-v1' || state.accountIdentity !== wallet.accountIdentity
        || state.walletStartedAtMs !== wallet.startedAtMs || state.policyId !== wallet.policyId) {
        throw new Error('Telegram outbox belongs to a different live wallet');
      }
      this.recoverSending(state);
      this.add(state, 'activation', 'status', formatLiveStatusMessage(wallet));
      // An actual-data snapshot also serves as the initial end-to-end delivery check.
      this.add(state, 'activation_snapshot', 'daily', formatLiveDailyReport(wallet, wallet.currentDay, false));
      state.tradeContexts ??= {}; state.dailyDigests ??= {}; state.dayLastObserved ??= {};
      state.dayLastObserved[wallet.currentDay.day] = wallet.lastObservedAtMs;
      const quantities: Record<string, Decimal> = {}, openingFees: Record<string, Decimal> = {};
      const trades = [...wallet.trades].sort((a, b) => Number(a.time) - Number(b.time)
        || String(a.symbol).localeCompare(String(b.symbol))
        || (BigInt(String(a.id ?? a.tradeId)) < BigInt(String(b.id ?? b.tradeId)) ? -1
          : BigInt(String(a.id ?? a.tradeId)) > BigInt(String(b.id ?? b.tradeId)) ? 1 : 0));
      for (const trade of trades) {
        const symbol = String(trade.symbol), id = String(trade.id ?? trade.tradeId), qty = d(trade.qty), fee = d(trade.commission);
        if (!/^[0-9]+$/.test(id) || !Number.isSafeInteger(Number(trade.time)) || qty.lte(0)
          || fee.lt(0) || trade.commissionAsset !== 'USDT' || !['BUY', 'SELL'].includes(String(trade.side))) {
          throw new Error('Invalid authenticated trade in notification ledger');
        }
        const before = quantities[symbol] ?? d('0'), feesBefore = openingFees[symbol] ?? d('0');
        const after = before.plus(qty.mul(trade.side === 'BUY' ? 1 : -1));
        if (after.lt(0)) throw new Error('Incomplete actual position history for Telegram PnL');
        const eventId = `trade:${symbol}:${id}`;
        const context = hash(JSON.stringify([symbol, id, trade.time, trade.side, trade.qty, trade.price,
          trade.commission, trade.realizedPnl, before.toString(), after.toString(), feesBefore.toString()]));
        const message = (this.options.importantOnly ? formatImportantTradeMessage : formatLiveTradeMessage)(wallet, trade, {
          positionBefore: before.toString(), positionAfter: after.toString(), openingFeesBefore: feesBefore.toString(),
        });
        if (state.tradeContexts[eventId] && state.tradeContexts[eventId] !== context) {
          this.add(state, `${eventId}:correction:${context}`, 'trade', `🔄 ĐÍNH CHÍNH: SÀN VỪA BỔ SUNG DỮ LIỆU GIAO DỊCH\n${message}`);
        } else this.add(state, eventId, 'trade', message);
        state.tradeContexts[eventId] = context;
        quantities[symbol] = after;
        openingFees[symbol] = trade.side === 'BUY' ? feesBefore.plus(fee)
          : after.isZero() ? d('0') : feesBefore.minus(feesBefore.mul(qty).div(before));
      }
      for (const day of [...wallet.days, wallet.currentDay]) {
        if (day.riskLatched || d(day.breachUsd).gt(0)) {
          const incident = day.riskLatched && day.latchReason === 'live_monitoring_gap'
            && wallet.technicalRecovery?.day === day.day ? `:${wallet.technicalRecovery.incidentId}` : '';
          this.add(state, `risk:${day.day}:${day.latchReason ?? 'breach'}${incident}`, 'risk',
            (this.options.importantOnly ? formatImportantRiskMessage : formatLiveRiskMessage)({ ...wallet, currentDay: day }, day.latchReason ?? 'daily_budget_breach'));
        }
        if (d(day.breachUsd).gt(0)) this.add(state, `breach:${day.day}`, 'risk',
          `🚨 MỨC LỖ ĐÃ VƯỢT GIỚI HẠN NGÀY\n${(this.options.importantOnly ? formatImportantRiskMessage : formatLiveRiskMessage)({ ...wallet, currentDay: day }, day.latchReason ?? 'daily_budget_breach')}`);
      }
      for (const day of wallet.days) {
        // Final means the stored boundary observation, not an invented intraday terminal quote.
        const digest = hash(JSON.stringify([day, wallet.trades.filter(t => dayOf(Number(t.time)) === day.day),
          wallet.incomes.filter(t => dayOf(Number(t.time)) === day.day)]));
        const end = state.dayLastObserved[day.day];
        const prefix = end ? `Lần kiểm tra cuối đã lưu: ${new Date(end + 25_200_000).toISOString().replace('T', ' ').slice(0, 19)} (giờ Việt Nam).\n`
          : 'Chưa lưu được thời điểm kiểm tra cuối ngày; kết quả ngày đã qua chỉ là xấp xỉ.\n';
        const message = prefix + formatLiveDailyReport(wallet, day, true);
        if (state.dailyDigests[day.day] && state.dailyDigests[day.day] !== digest) {
          this.add(state, `closed-day:${day.day}:correction:${digest}`, 'daily', `🔄 CẬP NHẬT KẾT QUẢ: SÀN VỪA BỔ SUNG SỐ LIỆU\n${message}`);
        } else this.add(state, `closed-day:${day.day}`, 'daily', message);
        state.dailyDigests[day.day] = digest;
      }
      const technical = wallet.technicalRecovery;
      const technicalPending = technical && ['reconciling', 'stabilizing', 'resuming'].includes(technical.phase);
      if (technical?.phase === 'resuming' && !wallet.currentDay.riskLatched) {
        this.add(state, `technical-recovery:${technical.incidentId}:resuming`, 'recovery',
          `🔄 BOT ĐANG TIẾP TỤC SAU SỰ CỐ\nĐã kiểm tra tài khoản và giới hạn lỗ; đang chuẩn bị các lệnh theo giá hiện tại. Sẽ báo riêng khi có giao dịch được sàn xác nhận.\n${formatLiveStatusMessage(wallet, false)}`);
      }
      const recoveryComplete = technical?.phase === 'resumed' && !wallet.currentDay.riskLatched
        && ['active', 'flat'].includes(wallet.status) && wallet.equityQuality === 'reconciled'
        && d(wallet.unreconciledWalletDelta).isZero() && Number.isSafeInteger(technical.resumedAtMs)
        && technical.resumedAtMs! <= wallet.lastObservedAtMs
        && wallet.intents.every(intent => ['FILLED', 'CANCELED', 'CANCELLED', 'REJECTED', 'EXPIRED', 'EXPIRED_IN_MATCH'].includes(intent.status)
          && d(intent.observedFillQty).eq(intent.executedQty));
      if (recoveryComplete) {
        const completionEvent = `technical-recovery:${technical!.incidentId}:resumed`;
        const firstCompletion = !state.events.includes(completionEvent);
        this.add(state, completionEvent, 'recovery',
          `✅ BOT ĐÃ HOẠT ĐỘNG LẠI SAU SỰ CỐ\nCác giao dịch và số dư đã được kiểm tra với sàn. Giới hạn lỗ vẫn là ${wallet.config.dailyLossLimitUsd} USDT/ngày.\n${formatLiveStatusMessage(wallet, false)}`);
        if (firstCompletion && !externalError && !this.options.importantOnly) state.activeError = null;
      }
      // Capture independent incidents. Neither a source failure nor a genuine
      // unresolved order is allowed to hide the other category.
      const ledgerWait = expectedLedgerPublication(wallet, this.clock());
      if (externalError) this.errorEvent(state, externalError, wallet);
      if (ledgerWait) {
        if (!externalError) for (const intent of ledgerWait) this.add(state,
          `ledger-publication:${intent.symbol}:${intent.orderId}:${intent.clientOrderId}`, 'progress',
          formatLivePendingMessage(wallet, intent.symbol));
      } else if (wallet.status === 'reconciliation_required' || wallet.blockedReason && !wallet.currentDay.riskLatched) {
        this.errorEvent(state, wallet.blockedReason ?? 'reconciliation_required', wallet);
      } else if (!this.options.importantOnly && !externalError && state.activeError && !technicalPending && ['active', 'flat'].includes(wallet.status) && !wallet.currentDay.riskLatched) {
        this.add(state, `recovery:${state.errorSequence}`, 'recovery',
          `✅ BOT ĐÃ KHÔI PHỤC SAU SỰ CỐ\n${formatLiveStatusMessage(wallet, false)}`);
        state.activeError = null;
      }
      this.recoverImportantNotice(state, wallet, externalError);
      this.captureDailyReport(state, wallet);
      state.lastObservedAtMs = wallet.lastObservedAtMs;
      return { state, result: undefined };
    });
    this.latest = wallet;
  }
  private errorEvent(state: State, reason: string, wallet?: LivePortfolioWallet): void {
    const transient = this.options.importantOnly === true && isDeferrableLiveNotificationError(reason, wallet);
    const text = this.options.importantOnly ? formatImportantErrorMessage(reason, wallet, transient)
      : formatLiveErrorMessage(reason, wallet);
    // A known read delay becoming an unresolved order/money issue must alert
    // immediately, even when the transport error string has not changed.
    const fingerprint = errorFingerprint(reason);
    const key = this.options.importantOnly ? `${fingerprint}:${transient ? 'technical' : 'critical'}` : fingerprint;
    if (this.options.importantOnly) {
      const now = this.clock();
      const notice = state.importantNotice ??= { firstErrorAtMs: now, lastErrorAtMs: now, alerted: false, technicalOnly: transient };
      notice.lastErrorAtMs = now; delete notice.healthySinceMs;
      notice.technicalOnly = (notice.technicalOnly ?? !notice.alerted) && transient;
      // Only recognized technical delays may wait. Unknown submissions and
      // ownership/money/anchor problems always keep immediate notification.
      if (transient && (notice.alerted || now - notice.firstErrorAtMs < IMPORTANT_TRANSIENT_MS)) return;
    }
    if (!state.errorAlerts) {
      state.errorAlerts = {};
      // Existing v1 outboxes predate category timestamps. Recover them from durable error messages.
      for (const entry of state.entries.filter(e => e.kind === 'error')) {
        const sequence = Number(/^error:(\d+)$/.exec(entry.eventId)?.[1]);
        if (!Number.isSafeInteger(sequence) || sequence < 1 || !Number.isFinite(entry.createdAtMs)) continue;
        const priorKey = entry.errorFingerprint ?? errorFingerprint(entry.text.split('\n')[1] ?? entry.text);
        if (!state.errorAlerts[priorKey] || state.errorAlerts[priorKey].lastAlertAtMs <= entry.createdAtMs) {
          state.errorAlerts[priorKey] = { lastAlertAtMs: entry.createdAtMs, sequence };
        }
      }
    }
    if (state.activeError === key) return;
    const previous = state.errorAlerts[key];
    // Keep the sequence on suppressed recurrences, so recovery also remains deduplicated.
    if (previous && this.clock() - previous.lastAlertAtMs < ERROR_DEBOUNCE_MS) {
      if (!this.options.importantOnly) state.activeError = key;
      return;
    }
    state.activeError = key;
    state.errorSequence++;
    state.errorAlerts[key] = { lastAlertAtMs: this.clock(), sequence: state.errorSequence };
    this.add(state, `error:${state.errorSequence}`, 'error', text, key);
    if (this.options.importantOnly && state.importantNotice && this.options.notifyRisk !== false
      && this.options.chatIds.length) {
      state.importantNotice.alerted = true; state.importantNotice.recoveryKey = `error:${state.errorSequence}`;
    }
  }
  async recordError(reason: string, wallet = this.latest): Promise<void> {
    if (!this.options.enabled || this.stopped) return;
    if (wallet) this.bindWallet(wallet);
    await this.mutate(async state => {
      // Bootstrap errors can still alert without inventing a live wallet or a PnL.
      if (!state) {
        state = { schema: 'live-telegram-v1', policyId: LIVE_POLICY_ID, accountIdentity: wallet?.accountIdentity ?? 'unbound',
          walletStartedAtMs: wallet?.startedAtMs ?? 0, createdAtMs: this.clock(), lastObservedAtMs: wallet?.lastObservedAtMs ?? 0, errorSequence: 0,
          activeError: null, events: [], entries: [] };
      }
      if (state) this.errorEvent(state, reason, wallet);
      return { state, result: undefined };
    });
  }
  async reportCurrentDay(): Promise<void> {
    const wallet = this.latest;
    if (!this.options.enabled || this.stopped || !wallet) return;
    await this.mutate(async state => {
      if (state) this.captureDailyReport(state, wallet, true);
      return { state, result: undefined };
    });
  }
  async flush(): Promise<void> {
    if (!this.options.enabled || this.stopped || this.running) return;
    this.running = true;
    let activeAttempt: string | undefined;
    try {
      // If an ACK was received while storage failed, retry its durable outcome
      // before another network send. Never resend that acknowledged message.
      await this.persistCompletions();
      const selected = await this.mutate(async state => {
        if (!state) return { state, result: null as LiveTelegramEntry | null };
        this.recoverSending(state);
        if ((state.sendNotBeforeMs ?? 0) > this.clock()) return { state, result: null as LiveTelegramEntry | null };
        const priority = (e: LiveTelegramEntry): number => ['risk', 'error'].includes(e.kind) ? 0 : e.kind === 'trade' ? 1 : 2;
        const entry = state.entries.filter(e => e.status === 'pending' && e.nextAttemptAtMs <= this.clock())
          .sort((a, b) => priority(a) - priority(b) || a.createdAtMs - b.createdAtMs)[0];
        if (!entry) return { state, result: null as LiveTelegramEntry | null };
        if (!this.options.chatIds.includes(entry.chatId)) {
          entry.status = 'failed'; entry.lastError = 'recipient_removed'; return { state, result: null as LiveTelegramEntry | null };
        }
        entry.status = 'sending'; entry.attempts++; entry.senderPid = process.pid;
        entry.sendLeaseUntilMs = this.clock() + SEND_LEASE_MS;
        activeAttempt = this.attemptKey(entry); activeSendAttempts.add(activeAttempt);
        return { state, result: { ...entry } };
      });
      if (!selected) return;
      let messageId: string | null = null, failure: LiveTelegramDeliveryError | null = null;
      try {
        const text = selected.uncertain ? `⚠️ Gửi lại: lần trước chưa xác nhận nhận tin.\n${selected.text}` : selected.text;
        messageId = await this.options.send(selected.chatId, text);
        if (!messageId) throw new LiveTelegramDeliveryError('telegram_missing_message_id', 0, true);
      } catch (error) {
        failure = error instanceof LiveTelegramDeliveryError ? error : new LiveTelegramDeliveryError('telegram_delivery_unconfirmed', 0, true);
      }
      this.pendingCompletions.set(selected.id, { attempts: selected.attempts, messageId, failure });
      await this.persistCompletions();
    } finally {
      if (activeAttempt && ![...this.pendingCompletions].some(([id, completion]) =>
        this.attemptKey({ id, attempts: completion.attempts }) === activeAttempt)) activeSendAttempts.delete(activeAttempt);
      this.running = false;
    }
  }
  stop(): void { this.stopped = true; if (this.timer) clearInterval(this.timer); this.task?.stop(); }
}
