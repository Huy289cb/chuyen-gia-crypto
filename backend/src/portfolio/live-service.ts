import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { Decimal } from '@prisma/client/runtime/library';
import type { LiveBroker } from './live-broker';
import type { SymbolFilter } from './types';
import type { ConstantDirectionSourcePortfolioTargets } from './source-constant-direction';
import { applyCctActualInventoryBand, projectCctTargets } from './target-projection';
import { readLiveWallet, writeLiveWallet, withLiveWalletLock } from './live-store';
import { LiveBackgroundSupport, type LiveBackgroundSnapshot } from './live-background';

const Money = Decimal.clone({ precision: 40, rounding: Decimal.ROUND_HALF_EVEN });
const d = (x: unknown): Decimal => {
  if (typeof x !== 'string' && typeof x !== 'number') throw new Error('Missing financial observation');
  const n = new Money(x); if (!n.isFinite()) throw new Error('Nonfinite financial observation'); return n;
};
const s = (x: Decimal): string => x.isZero() ? '0' : x.toString();
const DAY = 86_400_000, ICT = 7 * 3_600_000;
export const LIVE_POLICY_ID = 'CONSTANT_DIRECTION_B5_S6_DAILY15_V1' as const;
export const LIVE_SYMBOLS = ['BTCUSDT', 'ETHUSDT', 'BNBUSDT', 'SOLUSDT', 'XRPUSDT'] as const;
// Keep the existing execution owner and ledger namespace; the numeric risk policy is versioned below.
export const LIVE_CONFIG = Object.freeze({ initialCash: '100', dailyLossLimitUsd: '12', closeBufferUsd: '6.1',
  softLossThresholdUsd: '-5.9', grossCap: '8', leverage: '10', bandThreshold: '.2', slippageBps: '2' });
export type LiveResolvedConfig = Omit<typeof LIVE_CONFIG, 'initialCash' | 'dailyLossLimitUsd' | 'softLossThresholdUsd'>
  & { readonly initialCash: string; readonly dailyLossLimitUsd: string; readonly softLossThresholdUsd: string };
export const LIVE_TECHNICAL_RECOVERY_POLICY = Object.freeze({ stableForMs: 30_000, maxHealthyGapMs: 5_000, minObservations: 3 });
type Row = Record<string, unknown>;
const row = (value: unknown): Row => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid exchange observation');
  return value as Row;
};
const rows = (value: unknown): Row[] => {
  if (!Array.isArray(value)) throw new Error('Missing exchange observations'); return value.map(row);
};
const epoch = (value: unknown): number => {
  const n = Number(value); if (!Number.isSafeInteger(n) || n < 0) throw new Error('Invalid exchange timestamp'); return n;
};
const dayOf = (time: number): string => new Date(time + ICT).toISOString().slice(0, 10);
const boundaryOf = (time: number): number => Math.floor((time + ICT) / DAY) * DAY - ICT;
const utcOf = (time: number): number => Math.floor(time / DAY) * DAY;
const hash = (text: string): string => createHash('sha256').update(text).digest('hex');
const notFound = (error: unknown): boolean => Number((error as { binanceCode?: unknown })?.binanceCode) === -2013;
const terminal = (status: string): boolean => ['FILLED', 'CANCELED', 'CANCELLED', 'REJECTED', 'EXPIRED', 'EXPIRED_IN_MATCH'].includes(status);

export interface LiveHandoffReceipt {
  owner: typeof LIVE_POLICY_ID; accountIdentity: string; legacyWorkerStopped: true; legacyMutationsBlocked: true;
  verifiedAtMs: number;
  initialCapital?: string;
  verifiedSetup: { positionMode: 'ONE_WAY'; marginType: 'CROSSED'; leverage: '10'; symbols: string[] };
}
export interface LiveDay {
  day: string; anchorEquity: string; anchorTimeMs: number;
  anchorQuality: 'initial_partial' | 'exact_boundary' | 'near_boundary' | 'missing_boundary';
  /** Raw authenticated cash at the boundary; late external flows can rebase this anchor once. */
  anchorAccounting?: 'authenticated_cash_v2';
  /** Transfers inside or after this account read are ambiguous and cannot lower the anchor. */
  anchorCashReadStartedAtMs?: number;
  netCashflow: string; netPnl: string; worstNetPnl: string; breachUsd: string; riskLatched: boolean; latchReason: string | null;
  /** All observed stops are sticky for the day, even when a technical stop happened first. */
  stopReasons?: string[];
}
export interface LiveTechnicalRecovery {
  incidentId: string; day: string; detectedAtMs: number;
  phase: 'reconciling' | 'stabilizing' | 'resuming' | 'resumed' | 'blocked';
  healthySinceMs: number | null; healthyObservations: number; lastHealthyAtMs: number | null;
  attemptSourceId: string | null; blockedReason: string | null; resumedAtMs?: number;
}
export interface LiveIntent {
  clientOrderId: string; sourceId: string; symbol: string; quantity: string; reduceOnly: boolean;
  createdAtMs: number; submittedOnce: boolean; status: string; orderId: string | null;
  executedQty: string; observedFillQty: string; lastError: string | null;
  /** Observation used to prepare this order; diagnostics only, never execution evidence. */
  executionContext?: { observedAtMs: number; oldestQuoteAtMs: number; markPrice: string; referencePrice: string;
    bidPrice: string; askPrice: string; takerFeeRate: string; slippageBps: string };
}
export interface LivePortfolioWallet {
  schema: 'authenticated-portfolio-live-v1'; policyId: typeof LIVE_POLICY_ID; config: LiveResolvedConfig;
  accountIdentity: string; handoffSha256: string; startedAtMs: number; lastObservedAtMs: number;
  bootstrapAccountEquity: string; accountEquity: string; availableBalance: string;
  /** Allocated100 plus actual exchange PnL; deposits/withdrawals do not resize this strategy. */
  equity: string; netCashflow: string; netPnl: string;
  equityQuality: 'reconciled' | 'conservative_pending_income'; unreconciledWalletDelta: string;
  positions: Record<string, { quantity: string; averageEntry: string }>;
  actualPositions: Row[]; totalFees: string; fundingPnl: string; realizedPnl: string;
  trades: Row[]; incomes: Row[]; processedTradeIds: string[]; processedIncomeIds: string[];
  /** Last fully applied ledger coverage reconciled with cash/fills, independent of fast observations. */
  historyThroughMs?: number;
  intents: LiveIntent[]; currentDay: LiveDay; days: LiveDay[];
  sourceCursorMs: number; lastSourceId: string | null; sourceDisposition: string;
  status: 'active' | 'flat' | 'risk_latched' | 'reconciliation_required'; blockedReason: string | null;
  continuousRiskGuarantee: false; lastObservation: Row;
  /** Durable continuation: a source is consumed once, while its legs wait for authenticated fills. */
  pendingSourcePlan?: { sourceId: string; scheduledAtMs: number; expiresAtMs: number;
    orders: Array<{ symbol: string; quantity: string; reduceOnly: boolean }>; nextIndex: number;
    kind?: 'recovery'; originalSourceId?: string };
  technicalRecovery?: LiveTechnicalRecovery;
  technicalRecoveryEvents?: Array<{ incidentId: string; timeMs: number; event: string; sourceId?: string }>;
  /** Validated auxiliary observations survive restart for risk reductions; never authorize alpha alone. */
  monitoringSupport?: Pick<LiveBackgroundSnapshot, 'metadata' | 'orders'>;
  /** One-way user-authorized budget tightening. Never resets cash, anchors, cursors or stops. */
  riskBudgetChanges?: Array<{ revision: 'DAILY12_20261019'; changedAtMs: number; day: string;
    fromDailyLossLimitUsd: '15'; toDailyLossLimitUsd: '12'; fromSoftLossThresholdUsd: '-8.9'; toSoftLossThresholdUsd: '-5.9';
    closeBufferUsd: '6.1'; dayAnchorEquity: string; worstNetPnlBeforeChange: string }>;
}
export interface AdvanceLivePortfolioOptions {
  broker: LiveBroker; directory: string; accountIdentity: string;
  initialCapital?: string;
  handoff: { owner: typeof LIVE_POLICY_ID; receiptPath: string };
  targets?: ConstantDirectionSourcePortfolioTargets | null;
  /** Public source work may run independently; never delay authenticated risk monitoring for it. */
  sourcePending?: boolean;
  /** UTC source epoch evaluated before the worker began this authenticated tick. */
  sourceEvaluationUtcMs?: number;
  nonBlockingMonitoring?: boolean;
  autoRecoverTechnical?: boolean;
  /** Current causal daily weights, reprojected at recovery time without rewriting source timestamps. */
  recoveryTargets?: ConstantDirectionSourcePortfolioTargets | null;
  now?: number | (() => number); maxQuoteAgeMs?: number; maxMonitoringGapMs?: number;
  /** Only an authenticated, independently captured boundary observation is accepted here. */
  boundaryEquity?: { timeMs: number; equity: string };
}
interface Observation {
  time: number; accountReadStartedAtMs: number; oldestQuoteMs: number; account: Row; positions: Row[]; openOrders: Row[]; algoOrders: Row[]; dual: boolean;
  marks: Record<string, string>; references: Record<string, string>; bids: Record<string, string>; asks: Record<string, string>; filters: Record<string, SymbolFilter>;
  feeRate: string; accountEquity: string; availableBalance: string; rawMarks: Row[];
  /** The detached auxiliary snapshot actually reconciled and validated for this observation. */
  auxiliary?: LiveBackgroundSnapshot;
}
const clockOf = (o: AdvanceLivePortfolioOptions): (() => number) => {
  const value = o.now; return typeof value === 'function' ? value : () => value ?? Date.now();
};
const metadataCache = new WeakMap<LiveBroker, { at: number; info: Row; fees: Row[]; setup: Row[]; dual: boolean }>();
const orderCache = new WeakMap<LiveBroker, { at: number; regular: Row[]; algo: Row[] }>();
const historyCache = new WeakMap<LivePortfolioWallet, number>();
const historyByDirectory = new Map<string, number>();
const backgroundByBroker = new WeakMap<LiveBroker, LiveBackgroundSupport>();
const recoveryStability = new WeakMap<LiveBroker, { incidentId: string; since: number; last: number; count: number }>();
function recoveryBoundary(wallet: LivePortfolioWallet): number {
  return Math.max(wallet.technicalRecovery?.detectedAtMs ?? 0,
    ...wallet.intents.map(intent => intent.createdAtMs), ...wallet.trades.map(trade => epoch(trade.time)));
}
function recoveryEvent(wallet: LivePortfolioWallet, event: string, timeMs: number): void {
  if (!wallet.technicalRecovery) return;
  wallet.technicalRecoveryEvents = [...(wallet.technicalRecoveryEvents ?? []), {
    incidentId: wallet.technicalRecovery.incidentId, timeMs, event,
    ...(wallet.technicalRecovery.attemptSourceId ? { sourceId: wallet.technicalRecovery.attemptSourceId } : {}),
  }].slice(-200);
}
function background(o: AdvanceLivePortfolioOptions): LiveBackgroundSupport {
  let support = backgroundByBroker.get(o.broker);
  if (!support) { support = new LiveBackgroundSupport(o.broker, clockOf(o)); backgroundByBroker.set(o.broker, support); }
  return support;
}
async function observe(o: AdvanceLivePortfolioOptions, forceOrders = false,
  auxiliary?: Pick<LiveBackgroundSnapshot, 'metadata' | 'orders'>): Promise<Observation> {
  const clock = clockOf(o), started = clock();
  let meta = auxiliary ? auxiliary.metadata ?? undefined : metadataCache.get(o.broker);
  if (auxiliary && !meta) throw new Error('Authenticated monitoring metadata warming');
  if (!auxiliary && (forceOrders || !meta || started - meta.at >= 60_000 || started < meta.at)) {
    const [info, fees, setup, mode] = await Promise.all([o.broker.getExchangeInfo(), Promise.all(LIVE_SYMBOLS.map(symbol => o.broker.getCommissionRate(symbol))), o.broker.getSymbolConfiguration(), o.broker.getPositionMode()]);
    if (typeof mode.dualSidePosition !== 'boolean') throw new Error('Unknown account position mode');
    meta = { at: clock(), info: row(info), fees: fees.map(row), setup: rows(setup), dual: mode.dualSidePosition }; metadataCache.set(o.broker, meta);
  }
  let orders = auxiliary ? auxiliary.orders ?? undefined : orderCache.get(o.broker);
  if (auxiliary && !orders) throw new Error('Authenticated monitoring order inventory warming');
  if (!auxiliary && (forceOrders || !orders || started - orders.at >= 30_000 || started < orders.at)) {
    const [regular, algo] = await Promise.all([o.broker.getOpenOrders(), o.broker.getOpenAlgoOrders()]);
    orders = { at: clock(), regular: rows(regular), algo: rows(algo) }; orderCache.set(o.broker, orders);
  }
  if (!meta || !orders) throw new Error('Missing authenticated monitoring support');
  const accountReadStartedAtMs = clock();
  const [accountValue, positionsValue, markValue, tickerValue] = await Promise.all([
    o.broker.getAccount(), o.broker.getPositions(), o.broker.getMarkPrices(), o.broker.getTickerPrices(),
  ]);
  const time = clock(), account = row(accountValue);
  if (account.canTrade === false) throw new Error('Exchange account cannot trade');
  const assets = rows(account.assets);
  if (assets.some(asset => String(asset.asset) !== 'USDT' && !d(asset.walletBalance ?? '0').isZero())) throw new Error('Unsupported non-USDT collateral');
  const usdt = assets.find(asset => asset.asset === 'USDT');
  if (!usdt) throw new Error('Missing USDT account collateral');
  const accountEquity = d(usdt.walletBalance).plus(d(usdt.unrealizedProfit ?? '0'));
  if (account.totalMarginBalance !== undefined && !d(account.totalMarginBalance).eq(accountEquity)) throw new Error('Account equity/collateral mismatch');
  const available = d(account.availableBalance ?? usdt.availableBalance);
  const marks: Record<string, string> = {}, references: Record<string, string> = {}, bids: Record<string, string> = {}, asks: Record<string, string> = {}, filters: Record<string, SymbolFilter> = {};
  const rawMarks = rows(markValue), tickers = rows(tickerValue), exchangeSymbols = rows(meta.info.symbols);
  let oldestQuoteMs = time;
  for (const symbol of LIVE_SYMBOLS) {
    const setting = meta.setup.find(item => item.symbol === symbol);
    if (!setting || !d(setting.leverage).eq(LIVE_CONFIG.leverage) || !['cross', 'crossed'].includes(String(setting.marginType).toLowerCase())) throw new Error(`Unsupported live leverage/margin configuration ${symbol}`);
    const mark = rawMarks.find(x => x.symbol === symbol), ticker = tickers.find(x => x.symbol === symbol);
    const contract = exchangeSymbols.find(x => x.symbol === symbol);
    if (!mark || !ticker || !contract || contract.status !== 'TRADING' || contract.contractType !== 'PERPETUAL'
      || contract.quoteAsset !== 'USDT' || contract.marginAsset !== 'USDT') throw new Error(`Unsupported/inactive contract ${symbol}`);
    for (const quote of [mark, ticker]) {
      const quoteTime = epoch(quote.time);
      if (time - quoteTime > (o.maxQuoteAgeMs ?? 5_000) || quoteTime - time > 2_000) throw new Error(`Stale venue quote ${symbol}`);
      oldestQuoteMs = Math.min(oldestQuoteMs, quoteTime);
    }
    marks[symbol] = s(d(mark.markPrice)); references[symbol] = s(d(ticker.price));
    bids[symbol] = s(d(ticker.bidPrice ?? ticker.price)); asks[symbol] = s(d(ticker.askPrice ?? ticker.price));
    if (d(bids[symbol]).lte(0) || d(asks[symbol]).lt(bids[symbol])) throw new Error('Invalid executable bid/ask');
    if (d(marks[symbol]).lte(0) || d(references[symbol]).lte(0)) throw new Error('Invalid live quote');
    const fs = rows(contract.filters), lot = fs.find(f => f.filterType === 'LOT_SIZE'), market = fs.find(f => f.filterType === 'MARKET_LOT_SIZE');
    const min = fs.find(f => ['MIN_NOTIONAL', 'NOTIONAL'].includes(String(f.filterType)));
    if (!lot || !market || !min) throw new Error(`Missing executable filters ${symbol}`);
    filters[symbol] = { stepSize: String(lot.stepSize), minQty: String(lot.minQty), maxQty: String(lot.maxQty),
      marketStepSize: String(market.stepSize), marketMinQty: String(market.minQty), marketMaxQty: String(market.maxQty),
      minNotional: String(min.notional ?? min.minNotional) };
  }
  const feeRate = s(meta.fees.reduce((fee, item) => Money.max(fee, d(item.takerCommissionRate)), d('0')));
  if (d(feeRate).lte(0) || d(feeRate).gte('.01')) throw new Error('Unsupported authenticated fee rate');
  return { time, accountReadStartedAtMs, oldestQuoteMs, account, positions: rows(positionsValue), dual: meta.dual,
    openOrders: orders.regular, algoOrders: orders.algo, marks, references, bids, asks, filters, feeRate,
    accountEquity: s(accountEquity), availableBalance: s(available), rawMarks };
}
async function handoff(o: AdvanceLivePortfolioOptions): Promise<string> {
  if (o.handoff.owner !== LIVE_POLICY_ID || !o.accountIdentity || o.accountIdentity.length < 8) throw new Error('Missing live account/owner identity');
  if (o.broker.identity !== o.accountIdentity) throw new Error('Broker identity differs from handed-over account');
  const text = await fs.readFile(o.handoff.receiptPath, 'utf8'), receipt = JSON.parse(text) as LiveHandoffReceipt;
  if (receipt.owner !== LIVE_POLICY_ID || receipt.accountIdentity !== o.accountIdentity || receipt.legacyWorkerStopped !== true
    || receipt.legacyMutationsBlocked !== true || !Number.isSafeInteger(receipt.verifiedAtMs)
    || receipt.verifiedAtMs > clockOf(o)() + 2_000) throw new Error('Exchange handoff is not verified');
  if (receipt.initialCapital !== undefined && !d(receipt.initialCapital).eq(o.initialCapital ?? LIVE_CONFIG.initialCash)) throw new Error('Handoff capital does not match the live allocation');
  const setup = receipt.verifiedSetup;
  if (!setup || setup.positionMode !== 'ONE_WAY' || setup.marginType !== 'CROSSED' || setup.leverage !== '10'
    || [...setup.symbols].sort().join() !== [...LIVE_SYMBOLS].sort().join()) throw new Error('Missing verified venue setup');
  return hash(text);
}
function latch(wallet: LivePortfolioWallet, reason: string): void {
  const current = wallet.currentDay, wasLatched = current.riskLatched;
  current.stopReasons = [...new Set([...(current.stopReasons ?? []), ...(current.latchReason ? [current.latchReason] : []), reason])];
  current.riskLatched = true;
  if (!current.latchReason || current.latchReason === 'live_monitoring_gap' && reason !== 'live_monitoring_gap') current.latchReason = reason;
  if (!wasLatched && reason === 'live_monitoring_gap') delete wallet.technicalRecovery;
  if (reason !== 'live_monitoring_gap' && wallet.technicalRecovery) {
    wallet.technicalRecovery.phase = 'blocked'; wallet.technicalRecovery.blockedReason = current.latchReason;
    wallet.technicalRecovery.healthySinceMs = null; wallet.technicalRecovery.healthyObservations = 0;
    wallet.technicalRecovery.lastHealthyAtMs = null;
  }
  wallet.status = 'risk_latched'; wallet.blockedReason = current.latchReason;
}
function day(time: number, equity: string, quality: LiveDay['anchorQuality']): LiveDay {
  return { day: dayOf(time), anchorEquity: equity, anchorTimeMs: time, anchorQuality: quality,
    anchorAccounting: 'authenticated_cash_v2',
    netCashflow: '0', netPnl: '0', worstNetPnl: '0', breachUsd: '0', riskLatched: false, latchReason: null };
}
function activePositions(observation: Observation): Row[] { return observation.positions.filter(p => !d(p.positionAmt).isZero()); }
/** Same mark/reference and adverse-fill arithmetic used by the exact projector. */
function closingReserve(quantities: Record<string, Decimal>, observation: Observation): Decimal {
  const slip = d(LIVE_CONFIG.slippageBps).div(10_000), fee = d(observation.feeRate);
  return Object.entries(quantities).reduce((total, [symbol, quantity]) => {
    if (quantity.isZero()) return total;
    const fill = d(quantity.lt(0) ? observation.asks[symbol] : observation.bids[symbol]).mul(d('1').plus(slip.mul(quantity.lt(0) ? 1 : -1)));
    return total.plus(Money.max(quantity.mul(d(observation.marks[symbol]).minus(fill)), 0))
      .plus(quantity.abs().mul(fill).mul(fee));
  }, d('0'));
}
function assertModeAndSetup(observation: Observation): void {
  if (observation.dual) throw new Error('Live portfolio requires verified ONE_WAY position mode');
  for (const p of observation.positions) {
    if (!LIVE_SYMBOLS.includes(String(p.symbol) as typeof LIVE_SYMBOLS[number])) {
      if (!d(p.positionAmt).isZero()) throw new Error('External account position'); continue;
    }
    if (p.positionSide !== 'BOTH') throw new Error('Unsupported live position side');
    if (p.leverage !== undefined && !d(p.leverage).eq(LIVE_CONFIG.leverage)) throw new Error('Venue leverage changed');
    if (p.marginType !== undefined && !['cross', 'crossed'].includes(String(p.marginType).toLowerCase())) throw new Error('Venue margin mode changed');
    if (p.isolated === true || (p.isolatedWallet !== undefined && d(p.isolatedWallet).gt(0))) throw new Error('Isolated live collateral is unsupported');
  }
}
function assertNoForeignOrders(wallet: LivePortfolioWallet, observation: Observation): void {
  const ids = new Set(wallet.intents.map(x => x.clientOrderId));
  if (observation.algoOrders.length) throw new Error('Unowned exchange algo order');
  if (observation.openOrders.some(order => !ids.has(String(order.clientOrderId)))) throw new Error('Unowned exchange regular order');
}
function checkPositionBook(wallet: LivePortfolioWallet, observation: Observation): void {
  const actual = Object.fromEntries(activePositions(observation).map(p => [String(p.symbol), d(p.positionAmt)]));
  for (const symbol of new Set([...Object.keys(actual), ...Object.keys(wallet.positions)])) {
    // A query/ack proves executed quantity even when userTrades has not published the fee/fill details yet.
    // This bridge authorizes owned risk reductions only; it never manufactures a trade or commission.
    const pending = wallet.intents.filter(intent => intent.symbol === symbol && intent.orderId !== null)
      .reduce((n, intent) => {
        const missing = d(intent.executedQty).minus(intent.observedFillQty);
        if (missing.lt(0) || d(intent.executedQty).gt(d(intent.quantity).abs())) throw new Error('Authenticated order/fill accounting mismatch');
        return n.plus(missing.mul(d(intent.quantity).gt(0) ? 1 : -1));
      }, d('0'));
    const expected = d(wallet.positions[symbol]?.quantity ?? '0').plus(pending);
    if (!expected.eq(actual[symbol] ?? d('0'))) throw new Error(`External/unreconciled position mismatch ${symbol}`);
    if (expected.lt(0)) throw new Error('Constant-direction live book became short');
  }
}
function recordTrade(wallet: LivePortfolioWallet, trade: Row): void {
  const symbol = String(trade.symbol), id = `${symbol}:${String(trade.id ?? trade.tradeId)}`;
  if (wallet.processedTradeIds.includes(id)) return;
  if (trade.id === undefined && trade.tradeId === undefined) throw new Error('Missing authenticated trade ID');
  const intent = wallet.intents.find(x => x.symbol === symbol && x.orderId === String(trade.orderId));
  if (!intent) throw new Error(`Unowned authenticated trade ${symbol}`);
  if (trade.commissionAsset !== 'USDT') throw new Error('Non-USDT commission needs authenticated conversion');
  const qty = d(trade.qty), price = d(trade.price), fee = d(trade.commission);
  if (qty.lte(0) || price.lte(0) || fee.lt(0) || !['BUY', 'SELL'].includes(String(trade.side))) throw new Error('Invalid authenticated fill');
  const signed = qty.mul(trade.side === 'BUY' ? 1 : -1), old = wallet.positions[symbol];
  if (signed.mul(d(intent.quantity)).lte(0) || d(intent.observedFillQty).plus(qty).gt(d(intent.quantity).abs())) throw new Error('Actual fill differs from submitted order contract');
  const previous = d(old?.quantity ?? '0'), next = previous.plus(signed);
  if (next.lt(0) || (intent.reduceOnly && (signed.gt(0) || next.gt(previous)))) throw new Error('Actual fill violated long/reduction contract');
  const average = signed.gt(0) ? previous.mul(d(old?.averageEntry ?? '0')).plus(qty.mul(price)).div(next) : d(old?.averageEntry ?? '0');
  if (next.isZero()) delete wallet.positions[symbol]; else wallet.positions[symbol] = { quantity: s(next), averageEntry: s(average) };
  wallet.totalFees = s(d(wallet.totalFees).plus(fee));
  wallet.realizedPnl = s(d(wallet.realizedPnl).plus(d(trade.realizedPnl ?? '0')));
  intent.observedFillQty = s(d(intent.observedFillQty).plus(qty));
  // A genuine trade may publish before a query/ACK update; it is execution evidence itself.
  intent.executedQty = s(Money.max(d(intent.executedQty), d(intent.observedFillQty)));
  if (d(intent.observedFillQty).eq(d(intent.quantity).abs())) {
    intent.status = 'FILLED'; intent.lastError = null;
  }
  wallet.processedTradeIds.push(id); wallet.trades.push(trade);
}
async function reconcileIntents(o: AdvanceLivePortfolioOptions, wallet: LivePortfolioWallet): Promise<void> {
  for (const intent of wallet.intents.filter(x => !terminal(x.status) || !d(x.observedFillQty).eq(x.executedQty))) {
    try {
      const order = row(await o.broker.queryOrder(intent.symbol, intent.clientOrderId));
      if (order.clientOrderId !== intent.clientOrderId || order.symbol !== intent.symbol) throw new Error('Order identity mismatch');
      intent.orderId = String(order.orderId); intent.status = String(order.status); intent.executedQty = s(d(order.executedQty)); intent.lastError = null;
    } catch (error) {
      if (!notFound(error)) throw error;
      if (rejectNeverSubmittedAbsentIntent(intent)) continue;
      // Absence after a possible submit is not permission to submit again.
      intent.lastError = 'Order not found after durable intent; manual reconciliation required';
    }
  }
}
function rejectNeverSubmittedAbsentIntent(intent: LiveIntent): boolean {
  if (intent.status !== 'PREPARED' || intent.submittedOnce !== false || intent.orderId !== null
    || !d(intent.executedQty).isZero() || !d(intent.observedFillQty).isZero()) return false;
  // The durable pre-POST flag proves this intent never reached a submission.
  // Reject this skipped leg; never rewind its source plan or submit it again.
  intent.status = 'REJECTED'; intent.lastError = 'Preflight ended before submission; authenticated order query confirms absence';
  return true;
}
async function reconcileHistory(o: AdvanceLivePortfolioOptions, wallet: LivePortfolioWallet, through: number): Promise<number> {
  // Stable bounds, overlap and transaction/trade IDs handle late publication without double counting.
  const from = Math.max(wallet.startedAtMs, (wallet.historyThroughMs ?? wallet.startedAtMs) - DAY);
  const incomeRows: Row[] = [];
  let incomeRequests = 0;
  for (let start = from; start <= through; start += 7 * DAY) {
    for (let page = 1; ; page++) {
      if (++incomeRequests > 100) throw new Error('Income coverage incomplete');
      const batch = rows(await o.broker.getIncome({ startTime: start, endTime: Math.min(through, start + 7 * DAY - 1), limit: 1000, page }));
      incomeRows.push(...batch);
      if (batch.length < 1000) break;
    }
  }
  applyIncomeRows(wallet, incomeRows, through);
  const trades: Row[] = [];
  for (const symbol of LIVE_SYMBOLS) {
    for (let start = from; start <= through; start += 7 * DAY) {
      const end = Math.min(through, start + 7 * DAY - 1);
      const complete = async (low: number, high: number): Promise<void> => {
        const batch = rows(await o.broker.getUserTrades({ symbol, startTime: low, endTime: high, limit: 1000 }));
        if (batch.length >= 1000) {
          if (low === high) throw new Error('Trade coverage saturated at one millisecond');
          const middle = Math.floor((low + high) / 2); await complete(low, middle); await complete(middle + 1, high); return;
        }
        for (const trade of batch) {
          if (epoch(trade.time) < low || epoch(trade.time) > high || trade.symbol !== symbol) throw new Error('Trade outside requested bounds');
          trades.push(trade);
        }
      };
      await complete(start, end);
    }
  }
  applyTradeRows(wallet, trades);
  return through;
}
function applyIncomeRows(wallet: LivePortfolioWallet, incomeRows: Row[], through: number): void {
  for (const income of incomeRows.sort((a, b) => epoch(a.time) - epoch(b.time))) {
    const time = epoch(income.time);
    if (time < wallet.startedAtMs || time > through) throw new Error('Income outside requested bounds');
    if (income.asset !== 'USDT' || income.tranId === undefined) throw new Error('Unsupported/missing authenticated income identity');
    const id = `${String(income.incomeType)}:${String(income.tranId)}`;
    if (wallet.processedIncomeIds.includes(id)) continue;
    const amount = d(income.income), type = String(income.incomeType);
    if (['REALIZED_PNL', 'COMMISSION', 'FUNDING_FEE'].includes(type) && !LIVE_SYMBOLS.includes(String(income.symbol) as typeof LIVE_SYMBOLS[number])) throw new Error('Unowned symbol income');
    if (type === 'TRANSFER' || type === 'INTERNAL_TRANSFER') {
      wallet.netCashflow = s(d(wallet.netCashflow).plus(amount));
      if (dayOf(time) === wallet.currentDay.day) wallet.currentDay.netCashflow = s(d(wallet.currentDay.netCashflow).plus(amount));
      // Only anchors created from authenticated raw boundary cash can be rebased.
      // Global income dedup makes a late transfer correction durable and exactly once.
      if (wallet.currentDay.anchorAccounting === 'authenticated_cash_v2'
        && wallet.currentDay.anchorCashReadStartedAtMs !== undefined && time < wallet.currentDay.anchorCashReadStartedAtMs) {
        wallet.currentDay.anchorEquity = s(d(wallet.currentDay.anchorEquity).minus(amount));
      }
    } else if (type === 'FUNDING_FEE') wallet.fundingPnl = s(d(wallet.fundingPnl).plus(amount));
    else if (!['REALIZED_PNL', 'COMMISSION'].includes(type)) throw new Error(`Unsupported account income ${type}`);
    wallet.processedIncomeIds.push(id); wallet.incomes.push(income);
  }
}
function applyTradeRows(wallet: LivePortfolioWallet, trades: Row[]): void {
  for (const trade of trades.sort((a, b) => {
    const delta = epoch(a.time) - epoch(b.time); if (delta) return delta;
    const left = BigInt(String(a.id ?? a.tradeId)), right = BigInt(String(b.id ?? b.tradeId));
    return left < right ? -1 : left > right ? 1 : 0;
  })) recordTrade(wallet, trade);
}
function applyObservation(o: AdvanceLivePortfolioOptions, wallet: LivePortfolioWallet, obs: Observation): void {
  const previousTime = wallet.lastObservedAtMs;
  const heldAcrossObservation = activePositions(obs).length > 0
    || Object.values(wallet.positions).some(p => !d(p.quantity).isZero())
    || wallet.actualPositions.some(p => !d(p.positionAmt).isZero());
  wallet.accountEquity = obs.accountEquity; wallet.availableBalance = obs.availableBalance;
  wallet.equity = s(d(wallet.config.initialCash).plus(d(obs.accountEquity).minus(wallet.bootstrapAccountEquity)).minus(wallet.netCashflow)
    .minus(Money.max(d(wallet.unreconciledWalletDelta), 0)));
  wallet.netPnl = s(d(wallet.equity).minus(wallet.config.initialCash)); wallet.actualPositions = obs.positions;
  if (wallet.currentDay.day !== dayOf(obs.time)) {
    const boundary = boundaryOf(obs.time), old = wallet.currentDay;
    // A later quote cannot certify the previous day's unobserved terminal PnL.
    const held = heldAcrossObservation;
    const explicit = o.boundaryEquity?.timeMs === boundary ? o.boundaryEquity : null;
    let quality: LiveDay['anchorQuality'] = explicit || !held ? 'exact_boundary' :
      obs.time - boundary <= 2_000 && boundary - previousTime <= 2_000 ? 'near_boundary' : 'missing_boundary';
    // An unclassified positive receipt already in boundary cash is not today's
    // profit when its prior-day funding/trade record is published later.
    const anchor = explicit ? s(d(explicit.equity)) : s(d(wallet.equity).plus(Money.max(d(wallet.unreconciledWalletDelta), 0)));
    wallet.days.push(old); wallet.currentDay = day(explicit ? boundary : obs.time, anchor, quality);
    // Explicit anchors have their own external provenance; never guess a correction.
    if (explicit) delete wallet.currentDay.anchorAccounting;
    else wallet.currentDay.anchorCashReadStartedAtMs = obs.accountReadStartedAtMs;
    if (quality === 'missing_boundary') latch(wallet, 'missing_authenticated_ict_boundary');
    else if (o.autoRecoverTechnical && !held && old.riskLatched && old.latchReason === 'live_monitoring_gap'
      && !(old.stopReasons ?? []).some(reason => reason !== 'live_monitoring_gap')
      && d(old.worstNetPnl).gt(LIVE_CONFIG.softLossThresholdUsd) && d(old.breachUsd).isZero()) {
      recoveryEvent(wallet, 'technical_pause_carried_to_next_day', obs.time);
      latch(wallet, 'live_monitoring_gap');
    }
  }
  const current = wallet.currentDay;
  current.netCashflow = s(wallet.incomes.filter(income => ['TRANSFER', 'INTERNAL_TRANSFER'].includes(String(income.incomeType))
    && dayOf(epoch(income.time)) === current.day).reduce((n, income) => n.plus(d(income.income)), d('0')));
  // equity already excludes all external flows; do not subtract cashflows twice.
  current.netPnl = s(d(wallet.equity).minus(current.anchorEquity));
  current.worstNetPnl = s(Money.min(d(current.worstNetPnl), d(current.netPnl)));
  current.breachUsd = s(Money.max(d(current.breachUsd), d(current.netPnl).negated().minus(LIVE_CONFIG.dailyLossLimitUsd), 0));
  wallet.lastObservedAtMs = obs.time;
  wallet.lastObservation = { observedAtMs: obs.time, oldestQuoteAtMs: obs.oldestQuoteMs,
    marks: obs.marks, references: obs.references, bids: obs.bids, asks: obs.asks, feeRate: obs.feeRate,
    authenticatedPositionsObserved: true,
    authenticatedCashBalance: String(rows(obs.account.assets).find(asset => asset.asset === 'USDT')!.walletBalance),
    accountEquity: obs.accountEquity, availableBalance: obs.availableBalance, continuousRiskMonitoring: false };
  if (heldAcrossObservation && obs.time - previousTime > (o.maxMonitoringGapMs ?? 15_000)) latch(wallet, 'live_monitoring_gap');
  if (d(wallet.equity).lte(0)) latch(wallet, 'allocated_equity_nonpositive');
  const gross = activePositions(obs).reduce((n, position) => n.plus(d(position.positionAmt).abs().mul(obs.marks[String(position.symbol)])), d('0'));
  const reserve = closingReserve(Object.fromEntries(activePositions(obs).map(p => [String(p.symbol), d(p.positionAmt)])), obs);
  if (d(current.netPnl).lte(d(LIVE_CONFIG.dailyLossLimitUsd).negated())) latch(wallet, 'fixed_daily_loss_observed');
  if (gross.gt(0) && d(current.netPnl).minus(reserve).lte(LIVE_CONFIG.softLossThresholdUsd)) latch(wallet, 'fixed_daily_loss_close_reserve');
  const venueMaintenance = obs.account.totalMaintMargin === undefined ? gross.mul('.005') : Money.max(gross.mul('.005'), d(obs.account.totalMaintMargin));
  if (gross.gt(0) && d(wallet.equity).lte(venueMaintenance.plus(reserve))) latch(wallet, 'maintenance_margin_reserve');
  if (current.riskLatched) { wallet.status = 'risk_latched'; wallet.blockedReason = current.latchReason; }
  else { wallet.status = gross.isZero() ? 'flat' : 'active'; wallet.blockedReason = null; }
}
const unresolved = (wallet: LivePortfolioWallet): boolean => wallet.intents.some(intent => !terminal(intent.status)
  || !d(intent.observedFillQty).eq(intent.executedQty));
const inFlight = (wallet: LivePortfolioWallet): boolean => wallet.intents.some(intent => !terminal(intent.status));
function legalOrder(symbol: string, quantity: string, reducing: boolean, obs: Observation): void {
  const filter = obs.filters[symbol], q = d(quantity).abs();
  if (!filter || q.isZero() || q.mod(d(filter.marketStepSize ?? filter.stepSize)).isZero() === false
    || q.lt(d(filter.marketMinQty ?? filter.minQty)) || q.gt(d(filter.marketMaxQty ?? filter.maxQty ?? '1e30'))
    || (!reducing && q.mul(obs.references[symbol]).lt(d(filter.minNotional)))) throw new Error('Illegal executable order delta');
}
async function submitOne(o: AdvanceLivePortfolioOptions, wallet: LivePortfolioWallet, obs: Observation,
  order: { symbol: string; quantity: string; reduceOnly: boolean }, sourceId: string): Promise<void> {
  legalOrder(order.symbol, order.quantity, order.reduceOnly, obs);
  if (unresolved(wallet) && (!order.reduceOnly || inFlight(wallet))) throw new Error('An unresolved order blocks new submissions');
  const old = wallet.actualPositions.filter(position => position.symbol === order.symbol && position.positionSide === 'BOTH')
    .reduce((q, position) => q.plus(d(position.positionAmt)), d('0')), signed = d(order.quantity);
  if ((order.reduceOnly && (signed.gte(0) || signed.abs().gt(old))) || (!order.reduceOnly && signed.lte(0))) throw new Error('Order contradicts owned inventory');
  const clientOrderId = `cd15_${hash(`${wallet.accountIdentity}:${sourceId}:${wallet.intents.length}:${order.symbol}:${order.quantity}:${order.reduceOnly}`).slice(0, 28)}`;
  const intent: LiveIntent = { clientOrderId, sourceId, symbol: order.symbol, quantity: order.quantity, reduceOnly: order.reduceOnly,
    createdAtMs: clockOf(o)(), submittedOnce: false, status: 'PREPARED', orderId: null, executedQty: '0', observedFillQty: '0', lastError: null,
    executionContext: { observedAtMs: obs.time, oldestQuoteAtMs: obs.oldestQuoteMs,
      markPrice: obs.marks[order.symbol]!, referencePrice: obs.references[order.symbol]!,
      bidPrice: obs.bids[order.symbol]!, askPrice: obs.asks[order.symbol]!, takerFeeRate: obs.feeRate,
      slippageBps: LIVE_CONFIG.slippageBps } };
  wallet.intents.push(intent); await writeLiveWallet(o.directory, wallet);
  try {
    const prior = row(await o.broker.queryOrder(order.symbol, clientOrderId));
    intent.orderId = String(prior.orderId); intent.status = String(prior.status); intent.executedQty = s(d(prior.executedQty));
    throw new Error('Client ID existed before a new order; reconcile before continuing');
  } catch (error) { if (!notFound(error)) throw error; }
  const latestPositions = rows(await o.broker.getPositions(order.symbol));
  const current = latestPositions.filter(p => p.symbol === order.symbol && p.positionSide === 'BOTH')
    .reduce((quantity, p) => quantity.plus(d(p.positionAmt)), d('0'));
  if (!current.eq(old) || latestPositions.some(p => p.symbol === order.symbol && p.positionSide !== 'BOTH' && !d(p.positionAmt).isZero())) {
    intent.status = 'REJECTED'; intent.lastError = 'Owned position changed before submission';
    await writeLiveWallet(o.directory, wallet); throw new Error(intent.lastError);
  }
  if (clockOf(o)() - obs.oldestQuoteMs > (o.maxQuoteAgeMs ?? 5_000)) {
    intent.status = 'REJECTED'; intent.lastError = 'Reservation quotes aged before submission';
    await writeLiveWallet(o.directory, wallet); throw new Error(intent.lastError);
  }
  // Persist before POST. A crash in this interval intentionally requires reconciliation rather than resending.
  intent.submittedOnce = true; intent.status = 'SUBMITTING'; await writeLiveWallet(o.directory, wallet);
  // Disk sync and the identity/position queries consume the original quotes' lifetime.
  // No network submission has happened on this branch; retain a terminal durable intent.
  if (clockOf(o)() - obs.oldestQuoteMs > (o.maxQuoteAgeMs ?? 5_000)) {
    intent.status = 'REJECTED'; intent.lastError = 'Reservation quotes aged during durable submission write';
    await writeLiveWallet(o.directory, wallet); throw new Error(intent.lastError);
  }
  try {
    const ack = row(await o.broker.submitMarketOrder({ symbol: order.symbol, side: signed.gt(0) ? 'BUY' : 'SELL',
      quantity: s(signed.abs()), clientOrderId, positionSide: 'BOTH', reduceOnly: order.reduceOnly }));
    if (ack.clientOrderId !== clientOrderId || ack.symbol !== order.symbol) throw new Error('Submission acknowledgement identity mismatch');
    intent.orderId = String(ack.orderId); intent.status = String(ack.status); intent.executedQty = s(d(ack.executedQty));
  } catch (error) {
    intent.status = 'UNKNOWN'; intent.lastError = error instanceof Error ? error.message : 'Submission outcome unknown';
    wallet.status = 'reconciliation_required'; wallet.blockedReason = 'ambiguous_order_submission';
    await writeLiveWallet(o.directory, wallet); return;
  }
  await writeLiveWallet(o.directory, wallet);
}
async function refresh(o: AdvanceLivePortfolioOptions, wallet: LivePortfolioWallet): Promise<Observation> {
  let auxiliary: LiveBackgroundSnapshot | undefined;
  let historyThroughMs: number | undefined;
  let historyFailure: string | null = null;
  const recovering = o.autoRecoverTechnical === true && wallet.currentDay.riskLatched
    && wallet.currentDay.latchReason === 'live_monitoring_gap';
  if (o.nonBlockingMonitoring) {
    const support = background(o);
    support.update({ startedAtMs: wallet.startedAtMs, lastObservedAtMs: wallet.lastObservedAtMs, historyThroughMs: wallet.historyThroughMs,
      accountIdentity: wallet.accountIdentity, intents: wallet.intents,
      urgentHistory: unresolved(wallet) || wallet.equityQuality !== 'reconciled',
      forceSinceMs: Math.max(recovering && wallet.technicalRecovery ? recoveryBoundary(wallet) : 0,
        o.targets && o.targets.executeAtMs > wallet.sourceCursorMs ? o.targets.executeAtMs : 0) || undefined });
    auxiliary = support.snapshot();
    try { for (const result of auxiliary.intents?.orders ?? []) {
      const intent = wallet.intents.find(item => item.clientOrderId === result.clientOrderId && item.symbol === result.symbol);
      if (!intent) continue;
      if (!result.order) {
        if (result.error === undefined && rejectNeverSubmittedAbsentIntent(intent)) continue;
        // A delayed failed query cannot revoke an already authenticated full ledger.
        if (terminal(intent.status) && d(intent.observedFillQty).eq(intent.executedQty)) continue;
        if (result.error || !terminal(intent.status)) intent.lastError = result.error ?? 'Order not found after durable intent; manual reconciliation required';
        continue;
      }
      const order = result.order, executed = d(order.executedQty);
      if (order.clientOrderId !== intent.clientOrderId || order.symbol !== intent.symbol || order.orderId === undefined
        || intent.orderId !== null && intent.orderId !== String(order.orderId)
        || executed.lt(0) || executed.gt(d(intent.quantity).abs())) throw new Error('Background order identity/quantity mismatch');
      // A query launched before a later ACK cannot roll the durable journal backwards.
      if (executed.lt(intent.executedQty) || terminal(intent.status) && !terminal(String(order.status))) continue;
      intent.orderId = String(order.orderId); intent.executedQty = s(executed);
      intent.status = String(order.status); intent.lastError = null;
    } } catch { historyFailure = 'Authenticated background intent reconciliation failed'; }
    if (auxiliary.history) {
      try {
        applyIncomeRows(wallet, auxiliary.history.incomes, auxiliary.history.through);
        applyTradeRows(wallet, auxiliary.history.trades);
        historyThroughMs = auxiliary.history.through;
      } catch { historyFailure = 'Authenticated background ledger reconciliation failed'; }
    }
    historyFailure ??= auxiliary.errors.history ?? (unresolved(wallet) ? auxiliary.errors.intents : undefined) ?? null;
  } else await reconcileIntents(o, wallet);
  const riskSupport = auxiliary ? { metadata: auxiliary.metadata ?? wallet.monitoringSupport?.metadata ?? null,
    orders: auxiliary.orders ?? wallet.monitoringSupport?.orders ?? null } : undefined;
  let obs = await observe(o, recovering || Boolean(o.targets && o.targets.sourceId !== wallet.lastSourceId), riskSupport);
  const observedCash = d(rows(obs.account.assets).find(asset => asset.asset === 'USDT')!.walletBalance);
  const knownCash = wallet.incomes.reduce((n, income) => n.plus(d(income.income)), d(wallet.bootstrapAccountEquity));
  const lastHistory = historyCache.get(wallet) ?? historyByDirectory.get(o.directory);
  if (!o.nonBlockingMonitoring && (lastHistory === undefined || obs.time - lastHistory >= 30_000 || obs.time < lastHistory
    || !observedCash.eq(knownCash) || unresolved(wallet) || recovering)) {
    try {
      historyThroughMs = await reconcileHistory(o, wallet, obs.time);
      historyCache.set(wallet, obs.time); historyByDirectory.set(o.directory, obs.time);
    } catch (error) { historyFailure = error instanceof Error ? error.message : 'Authenticated history unavailable'; }
    // Slow history calls cannot authorize an order using expired quotes.
    if (clockOf(o)() - obs.oldestQuoteMs > (o.maxQuoteAgeMs ?? 5_000) / 2) obs = await observe(o);
  }
  const observedWallet = d(rows(obs.account.assets).find(asset => asset.asset === 'USDT')!.walletBalance);
  const journalWallet = wallet.incomes.reduce((n, income) => n.plus(d(income.income)), d(wallet.bootstrapAccountEquity));
  wallet.unreconciledWalletDelta = s(observedWallet.minus(journalWallet));
  wallet.equityQuality = observedWallet.eq(journalWallet) && !historyFailure ? 'reconciled' : 'conservative_pending_income';
  assertModeAndSetup(obs); assertNoForeignOrders(wallet, obs); checkPositionBook(wallet, obs); applyObservation(o, wallet, obs);
  // A successful but incomplete publication is not coverage. Keep backfilling
  // from the prior durable watermark until both cash and executions reconcile.
  if (historyThroughMs !== undefined && wallet.equityQuality === 'reconciled' && !unresolved(wallet)) {
    wallet.historyThroughMs = Math.max(wallet.historyThroughMs ?? wallet.startedAtMs, historyThroughMs);
  }
  if (auxiliary) {
    obs.auxiliary = auxiliary;
    wallet.monitoringSupport = { metadata: riskSupport?.metadata ? { ...riskSupport.metadata,
      info: { symbols: rows(riskSupport.metadata.info.symbols).filter(contract => LIVE_SYMBOLS.includes(String(contract.symbol) as typeof LIVE_SYMBOLS[number])) } } : null,
      orders: riskSupport?.orders ?? null };
    wallet.lastObservation.background = { metadataAtMs: auxiliary.metadata?.at ?? null, ordersAtMs: auxiliary.orders?.at ?? null,
      historyThroughMs: auxiliary.history?.through ?? null, pending: auxiliary.pending, errors: auxiliary.errors };
  }
  if (wallet.equityQuality !== 'reconciled') {
    wallet.status = wallet.currentDay.riskLatched ? 'risk_latched' : 'reconciliation_required';
    wallet.blockedReason = historyFailure ? `Authenticated history unavailable; conservative risk only: ${historyFailure}` : 'Authenticated wallet/income coverage mismatch; conservative risk only';
  }
  if (unresolved(wallet)) { wallet.status = 'reconciliation_required'; wallet.blockedReason = 'unresolved_or_partial_order'; }
  if (o.nonBlockingMonitoring && !wallet.currentDay.riskLatched && !supportReady(o, wallet, obs)) {
    wallet.status = 'reconciliation_required'; wallet.blockedReason ??= 'Authenticated background support pending/stale; conservative risk only';
  }
  return obs;
}
function supportReady(o: AdvanceLivePortfolioOptions, wallet: LivePortfolioWallet, obs: Observation, scheduled?: number): boolean {
  if (!o.nonBlockingMonitoring) return true;
  // A background response arriving during observe() is not permission to trade:
  // its metadata/orders/history have not been checked against this observation.
  const cache = obs.auxiliary, now = clockOf(o)();
  if (!cache) return false;
  const fresh = (time: number | undefined, age: number): boolean => time !== undefined && time <= now
    && now - time <= age && (scheduled === undefined || time >= scheduled);
  return fresh(cache.metadata?.at, 90_000) && fresh(cache.orders?.at, 45_000)
    && fresh(cache.history?.through, 45_000) && Object.keys(cache.errors).filter(key => key !== 'intents').length === 0
    && wallet.equityQuality === 'reconciled' && !unresolved(wallet);
}
function reserveLeg(wallet: LivePortfolioWallet, obs: Observation,
  order: { symbol: string; quantity: string; reduceOnly: boolean }): boolean {
  if (order.reduceOnly) return true;
  const qty = d(order.quantity), price = d(qty.gt(0) ? obs.asks[order.symbol] : obs.bids[order.symbol]);
  const fill = price.mul(d('1').plus(d(LIVE_CONFIG.slippageBps).div(10_000).mul(qty.gt(0) ? 1 : -1)));
  const cost = qty.abs().mul(fill).mul(obs.feeRate).minus(qty.mul(d(obs.marks[order.symbol]).minus(fill)));
  const quantities = Object.fromEntries(activePositions(obs).map(p => [String(p.symbol), d(p.positionAmt)]));
  quantities[order.symbol] = (quantities[order.symbol] ?? d('0')).plus(qty);
  const gross = Object.entries(quantities).reduce((n, [symbol, quantity]) => n.plus(quantity.abs().mul(obs.marks[symbol])), d('0'));
  const after = d(wallet.equity).minus(cost), reserve = closingReserve(quantities, obs);
  return !(gross.gt(after.mul(LIVE_CONFIG.grossCap)) || gross.div(LIVE_CONFIG.leverage).plus(cost).plus(reserve).gt(after)
    || qty.abs().mul(price).div(LIVE_CONFIG.leverage).plus(cost).plus(reserve).gt(d(obs.availableBalance))
    || after.minus(wallet.currentDay.anchorEquity).minus(reserve).lte(LIVE_CONFIG.softLossThresholdUsd));
}
function recoveryTargetValid(target: ConstantDirectionSourcePortfolioTargets, obs: Observation): boolean {
  const utc = utcOf(obs.time);
  return target.executeAtMs === utc && target.labelTimeMs + DAY === utc && target.knownAtMs <= utc
    && target.knownAtMs <= obs.time && target.policyId === LIVE_POLICY_ID && target.strategy === 'constant-direction-b5-v1'
    && Boolean(target.sourceId && target.decimalWeights && target.metadata)
    && Object.keys(target.decimalWeights!).sort().join() === [...LIVE_SYMBOLS].sort().join()
    && LIVE_SYMBOLS.every(symbol => d(target.decimalWeights![symbol]).gte(0) && target.metadata![symbol]?.signalCountChanged === false);
}
async function prepareTechnicalRecovery(o: AdvanceLivePortfolioOptions, wallet: LivePortfolioWallet, obs: Observation): Promise<void> {
  if (!o.autoRecoverTechnical || !wallet.currentDay.riskLatched || wallet.currentDay.latchReason !== 'live_monitoring_gap') return;
  let recovery = wallet.technicalRecovery;
  if (!recovery || recovery.day !== wallet.currentDay.day) {
    recovery = { incidentId: hash(`${wallet.accountIdentity}:${wallet.currentDay.day}:${obs.time}:${wallet.intents.length}`).slice(0, 24),
      day: wallet.currentDay.day, detectedAtMs: obs.time, phase: 'reconciling', healthySinceMs: null,
      healthyObservations: 0, lastHealthyAtMs: null, attemptSourceId: null, blockedReason: 'post_incident_reconciliation' };
    wallet.technicalRecovery = recovery; recoveryEvent(wallet, 'technical_pause_detected', obs.time);
  }
  const pause = (reason: string, permanent = false): void => {
    recoveryStability.delete(o.broker); recovery!.phase = permanent ? 'blocked' : 'reconciling';
    recovery!.healthySinceMs = null; recovery!.healthyObservations = 0; recovery!.lastHealthyAtMs = null;
    recovery!.blockedReason = reason;
  };
  // A technical reason must never hide a monetary stop that occurred before flattening.
  if (d(wallet.currentDay.worstNetPnl).lte(d(LIVE_CONFIG.dailyLossLimitUsd).negated()) || d(wallet.currentDay.breachUsd).gt(0)) latch(wallet, 'fixed_daily_loss_observed');
  else if (d(wallet.currentDay.worstNetPnl).lte(LIVE_CONFIG.softLossThresholdUsd)) latch(wallet, 'fixed_daily_loss_close_reserve');
  if (wallet.currentDay.anchorQuality === 'missing_boundary') latch(wallet, 'missing_authenticated_ict_boundary');
  const otherStop = wallet.currentDay.stopReasons?.find(reason => reason !== 'live_monitoring_gap');
  if (otherStop) latch(wallet, otherStop);
  if (wallet.currentDay.latchReason !== 'live_monitoring_gap') { pause(wallet.currentDay.latchReason ?? 'financial_or_integrity_stop', true); return; }
  if (activePositions(obs).length || Object.values(wallet.positions).some(p => !d(p.quantity).isZero())) { pause('waiting_owned_flatten'); return; }
  if (unresolved(wallet)) { pause('waiting_authenticated_order_fills'); return; }
  if (obs.openOrders.length || obs.algoOrders.length) { pause('waiting_empty_order_inventory'); return; }
  if (wallet.equityQuality !== 'reconciled' || !d(wallet.unreconciledWalletDelta).isZero()) { pause('waiting_exact_income_reconciliation'); return; }
  const boundary = recoveryBoundary(wallet);
  if (!supportReady(o, wallet, obs, boundary)
    || !o.nonBlockingMonitoring && (historyByDirectory.get(o.directory) ?? 0) < boundary) { pause('waiting_post_incident_support'); return; }
  let stable = recoveryStability.get(o.broker);
  if (!stable || stable.incidentId !== recovery.incidentId || obs.time < stable.last
    || obs.time - stable.last > LIVE_TECHNICAL_RECOVERY_POLICY.maxHealthyGapMs) {
    stable = { incidentId: recovery.incidentId, since: obs.time, last: obs.time, count: 1 };
  } else if (obs.time > stable.last) { stable.last = obs.time; stable.count++; }
  recoveryStability.set(o.broker, stable); recovery.phase = 'stabilizing'; recovery.healthySinceMs = stable.since;
  recovery.healthyObservations = stable.count; recovery.lastHealthyAtMs = stable.last;
  recovery.blockedReason = 'waiting_30s_healthy_observations';
  if (obs.time - stable.since < LIVE_TECHNICAL_RECOVERY_POLICY.stableForMs || stable.count < LIVE_TECHNICAL_RECOVERY_POLICY.minObservations) return;
  const target = o.recoveryTargets;
  if (!target || !recoveryTargetValid(target, obs)) { recovery.blockedReason = 'waiting_current_causal_recovery_source'; return; }
  if (recovery.attemptSourceId) { pause('recovery_attempt_already_consumed', true); return; }
  const weights = applyCctActualInventoryBand({ weights: target.decimalWeights!, positions: wallet.positions,
    equity: wallet.equity, marks: obs.marks, metadata: target.metadata, threshold: LIVE_CONFIG.bandThreshold });
  const projection = projectCctTargets({ weights, positions: wallet.positions, equity: wallet.equity,
    marks: obs.marks, references: obs.references, filters: obs.filters, feeRate: obs.feeRate,
    slippageBps: LIVE_CONFIG.slippageBps, grossCap: LIVE_CONFIG.grossCap, leverage: LIVE_CONFIG.leverage,
    dayAnchor: wallet.currentDay.anchorEquity, dailyLossBudget: LIVE_CONFIG.dailyLossLimitUsd, closeBuffer: LIVE_CONFIG.closeBufferUsd });
  if (!projection.feasible || projection.orders.some(order => !reserveLeg(wallet, obs, order))) {
    recovery.blockedReason = `recovery_projection_rejected:${projection.reason ?? 'current_price_reserve'}`; return;
  }
  const executionId = `recovery:${recovery.incidentId}:${target.sourceId}`;
  recovery.attemptSourceId = executionId; recovery.phase = 'resuming'; recovery.blockedReason = null;
  wallet.pendingSourcePlan = { sourceId: executionId, originalSourceId: target.sourceId, kind: 'recovery',
    scheduledAtMs: target.executeAtMs, expiresAtMs: obs.time + 60_000, orders: projection.orders, nextIndex: 0 };
  wallet.currentDay.riskLatched = false; wallet.currentDay.latchReason = null;
  wallet.currentDay.stopReasons = (wallet.currentDay.stopReasons ?? []).filter(reason => reason !== 'live_monitoring_gap');
  wallet.status = 'flat'; wallet.blockedReason = null; wallet.sourceDisposition = 'technical_recovery_plan_prepared';
  recoveryEvent(wallet, 'recovery_plan_prepared', obs.time);
  // Plan and permission change are one durable transaction; no source timestamp or daily anchor is rewritten.
  await writeLiveWallet(o.directory, wallet);
}

/** No network retry of an order, no synthetic fill, and no environment/venue mode mutations. */
export async function advanceLivePortfolio(o: AdvanceLivePortfolioOptions): Promise<LivePortfolioWallet> {
  return withLiveWalletLock(o.directory, async () => {
    const receiptHash = await handoff(o);
    const initialCapital = s(d(o.initialCapital ?? LIVE_CONFIG.initialCash));
    if (d(initialCapital).lte(0)) throw new Error('Invalid initial live capital');
    const config: LiveResolvedConfig = { ...LIVE_CONFIG, initialCash: initialCapital };
    let wallet = await readLiveWallet<LivePortfolioWallet>(o.directory);
    if (wallet && (wallet.schema !== 'authenticated-portfolio-live-v1' || wallet.policyId !== LIVE_POLICY_ID
      || wallet.accountIdentity !== o.accountIdentity || wallet.handoffSha256 !== receiptHash)) {
      throw new Error('Live wallet identity/policy/handoff mismatch; reconciliation required');
    }
    if (wallet && JSON.stringify(wallet.config) !== JSON.stringify(config)) {
      const legacy = { ...config, dailyLossLimitUsd: '15', softLossThresholdUsd: '-8.9' };
      // Accept only the exact former configuration on the same authenticated wallet.
      // An arbitrary mismatch or a second attempt to restore15u must still fail closed.
      if (JSON.stringify(wallet.config) !== JSON.stringify(legacy) || wallet.riskBudgetChanges?.length) {
        throw new Error('Live wallet identity/policy/handoff mismatch; reconciliation required');
      }
      const changedAtMs = epoch(clockOf(o)());
      wallet.riskBudgetChanges = [{ revision: 'DAILY12_20261019', changedAtMs, day: wallet.currentDay.day,
        fromDailyLossLimitUsd: '15', toDailyLossLimitUsd: '12', fromSoftLossThresholdUsd: '-8.9', toSoftLossThresholdUsd: '-5.9',
        closeBufferUsd: '6.1', dayAnchorEquity: wallet.currentDay.anchorEquity,
        worstNetPnlBeforeChange: wallet.currentDay.worstNetPnl }];
      wallet.config = config;
      if (wallet.currentDay.day === dayOf(changedAtMs)
        && d(wallet.currentDay.worstNetPnl).lte(d(config.dailyLossLimitUsd).negated())) {
        wallet.currentDay.breachUsd = s(Money.max(d(wallet.currentDay.breachUsd),
          d(wallet.currentDay.worstNetPnl).negated().minus(config.dailyLossLimitUsd), 0));
        latch(wallet, 'fixed_daily_loss_observed');
      } else if (wallet.currentDay.day === dayOf(changedAtMs)
        && d(wallet.currentDay.worstNetPnl).lte(config.softLossThresholdUsd)) {
        // Preserve the day's loss history rather than granting a fresh loss allowance on recovery.
        latch(wallet, 'fixed_daily_loss_close_reserve');
      }
      // Persist the tighter limit before any venue call; a timeout cannot silently restore15u.
      await writeLiveWallet(o.directory, wallet);
    }
    if (!wallet) {
      const obs = await observe(o, true); assertModeAndSetup(obs);
      if (activePositions(obs).length || obs.openOrders.length || obs.algoOrders.length) throw new Error('Live bootstrap requires a clean exchange account');
      if (d(obs.accountEquity).lt(initialCapital) || d(obs.availableBalance).lt(initialCapital)) throw new Error(`Insufficient unencumbered${initialCapital}u live capital`);
      wallet = { schema: 'authenticated-portfolio-live-v1', policyId: LIVE_POLICY_ID, config,
        accountIdentity: o.accountIdentity, handoffSha256: receiptHash, startedAtMs: obs.time, lastObservedAtMs: obs.time,
        bootstrapAccountEquity: obs.accountEquity, accountEquity: obs.accountEquity, availableBalance: obs.availableBalance,
        equity: initialCapital, netCashflow: '0', netPnl: '0', equityQuality: 'reconciled', unreconciledWalletDelta: '0', positions: {}, actualPositions: obs.positions,
        totalFees: '0', fundingPnl: '0', realizedPnl: '0', trades: [], incomes: [], processedTradeIds: [], processedIncomeIds: [],
        intents: [], currentDay: { ...day(obs.time, initialCapital, 'initial_partial'), anchorCashReadStartedAtMs: obs.accountReadStartedAtMs }, days: [],
        sourceCursorMs: obs.time === utcOf(obs.time) ? utcOf(obs.time) - DAY : utcOf(obs.time), lastSourceId: null,
        sourceDisposition: 'bootstrap_flat_until_next_utc', status: 'flat', blockedReason: null, continuousRiskGuarantee: false, lastObservation: {} };
      await writeLiveWallet(o.directory, wallet);
    }
    try {
      let obs = await refresh(o, wallet);
      if (wallet.currentDay.riskLatched && !inFlight(wallet)) {
        for (const symbol of activePositions(obs).map(position => String(position.symbol)).sort()) {
          const qty = activePositions(obs).find(position => position.symbol === symbol)?.positionAmt; if (!qty) continue;
          await submitOne(o, wallet, obs, { symbol, quantity: s(d(qty).negated()), reduceOnly: true }, `risk:${wallet.currentDay.day}`);
          obs = await refresh(o, wallet); await writeLiveWallet(o.directory, wallet);
          if (inFlight(wallet)) break;
        }
      }
      const targets = o.targets, scheduled = utcOf(obs.time);
      if (wallet.pendingSourcePlan?.kind === 'recovery' && wallet.pendingSourcePlan.scheduledAtMs !== scheduled) {
        if (wallet.technicalRecovery) {
          wallet.technicalRecovery.phase = 'blocked'; wallet.technicalRecovery.blockedReason = 'recovery_superseded_by_new_utc_source';
          recoveryEvent(wallet, 'recovery_superseded_by_new_utc_source', obs.time);
        }
        delete wallet.pendingSourcePlan;
      }
      const sourceDeferred = obs.time - scheduled <= 60_000 && (o.sourceEvaluationUtcMs !== undefined && o.sourceEvaluationUtcMs < scheduled
        || o.sourcePending === true && !targets
        || Boolean(targets && o.nonBlockingMonitoring && !wallet.currentDay.riskLatched && !supportReady(o, wallet, obs, scheduled)));
      if (scheduled > wallet.sourceCursorMs && !sourceDeferred) {
        // Consume every UTC attempt, including absent/missed/latched rows. ICT reset cannot replay it.
        wallet.sourceCursorMs = scheduled; wallet.sourceDisposition = 'missed_or_absent_source';
        await writeLiveWallet(o.directory, wallet);
        if (targets) {
          if (targets.executeAtMs !== scheduled || targets.knownAtMs > scheduled || targets.labelTimeMs + DAY !== scheduled
            || targets.knownAtMs > obs.time || obs.time - scheduled > 60_000) throw new Error('Source row is not causal/current UTC execution');
          if (targets.policyId !== LIVE_POLICY_ID || targets.strategy !== 'constant-direction-b5-v1'
            || !targets.sourceId || targets.sourceId === wallet.lastSourceId || !targets.decimalWeights || !targets.metadata
            || Object.keys(targets.decimalWeights).sort().join() !== [...LIVE_SYMBOLS].sort().join()) throw new Error('Invalid versioned constant-direction B5 target');
          if (LIVE_SYMBOLS.some(symbol => d(targets.decimalWeights![symbol]).lt(0) || targets.metadata![symbol]?.signalCountChanged !== false)) throw new Error('Constant-direction source metadata/long weights changed');
          wallet.lastSourceId = targets.sourceId;
          wallet.sourceDisposition = wallet.currentDay.riskLatched ? 'risk_latched' : unresolved(wallet) ? 'unresolved_order' :
            wallet.equityQuality !== 'reconciled' ? 'unreconciled_income' : 'submitted_once';
          await writeLiveWallet(o.directory, wallet);
          if (!wallet.currentDay.riskLatched && !unresolved(wallet) && wallet.equityQuality === 'reconciled') {
            const weights = applyCctActualInventoryBand({ weights: targets.decimalWeights, positions: wallet.positions,
              equity: wallet.equity, marks: obs.marks, metadata: targets.metadata, threshold: LIVE_CONFIG.bandThreshold });
            const projection = projectCctTargets({ weights, positions: wallet.positions, equity: wallet.equity,
              marks: obs.marks, references: obs.references, filters: obs.filters, feeRate: obs.feeRate,
              slippageBps: LIVE_CONFIG.slippageBps, grossCap: LIVE_CONFIG.grossCap, leverage: LIVE_CONFIG.leverage,
              dayAnchor: wallet.currentDay.anchorEquity, dailyLossBudget: LIVE_CONFIG.dailyLossLimitUsd, closeBuffer: LIVE_CONFIG.closeBufferUsd });
            if (!projection.feasible) wallet.sourceDisposition = `projection_rejected:${projection.reason}`;
            else if (o.nonBlockingMonitoring) {
              wallet.pendingSourcePlan = { sourceId: targets.sourceId, scheduledAtMs: scheduled,
                expiresAtMs: scheduled + 60_000, orders: projection.orders, nextIndex: 0 };
              await writeLiveWallet(o.directory, wallet);
            } else for (const order of projection.orders) {
              // Refresh and re-reserve each leg against actual fills; the projected multi-leg transaction is not atomic at the venue.
              obs = await refresh(o, wallet);
              if (unresolved(wallet) || wallet.currentDay.riskLatched || wallet.equityQuality !== 'reconciled') break;
              if (!reserveLeg(wallet, obs, order)) { wallet.sourceDisposition = 'actual_fill_reservation_rejected'; break; }
              await submitOne(o, wallet, obs, order, targets.sourceId);
              obs = await refresh(o, wallet); await writeLiveWallet(o.directory, wallet);
              if (unresolved(wallet) || wallet.currentDay.riskLatched) break;
            }
          }
        }
      }
      await prepareTechnicalRecovery(o, wallet, obs);
      const plan = wallet.pendingSourcePlan;
      if ((o.nonBlockingMonitoring || plan?.kind === 'recovery') && plan) {
        if (wallet.currentDay.riskLatched || clockOf(o)() > plan.expiresAtMs && plan.nextIndex < plan.orders.length || scheduled !== plan.scheduledAtMs) {
          wallet.sourceDisposition = wallet.currentDay.riskLatched ? 'risk_latched' : 'source_plan_expired';
          if (plan.kind === 'recovery' && wallet.technicalRecovery) {
            wallet.technicalRecovery.phase = 'blocked'; wallet.technicalRecovery.blockedReason = wallet.sourceDisposition;
            recoveryEvent(wallet, 'recovery_plan_stopped', obs.time);
          }
          delete wallet.pendingSourcePlan;
        } else if (plan.nextIndex >= plan.orders.length) {
          if (plan.kind !== 'recovery' || !unresolved(wallet) && wallet.equityQuality === 'reconciled' && supportReady(o, wallet, obs)) {
            wallet.sourceDisposition = plan.kind === 'recovery' ? 'technical_recovery_resumed' : 'submitted_once';
            if (plan.kind === 'recovery' && wallet.technicalRecovery) {
              wallet.technicalRecovery.phase = 'resumed'; wallet.technicalRecovery.resumedAtMs = obs.time;
              wallet.technicalRecovery.blockedReason = null; recoveryEvent(wallet, 'trading_resumed', obs.time);
            }
            delete wallet.pendingSourcePlan;
          }
        } else if (supportReady(o, wallet, obs, plan.scheduledAtMs) && obs.time >= plan.scheduledAtMs) {
          const order = plan.orders[plan.nextIndex]!;
          if (!reserveLeg(wallet, obs, order)) {
            wallet.sourceDisposition = 'actual_fill_reservation_rejected'; delete wallet.pendingSourcePlan;
            if (plan.kind === 'recovery' && wallet.technicalRecovery) {
              wallet.technicalRecovery.phase = 'blocked'; wallet.technicalRecovery.blockedReason = wallet.sourceDisposition;
            }
          } else {
            // Advance before the intent/POST: a crash skips this leg rather than submitting it twice.
            plan.nextIndex++; await writeLiveWallet(o.directory, wallet);
            await submitOne(o, wallet, obs, order, plan.sourceId);
            obs = await refresh(o, wallet);
            wallet.sourceDisposition = 'source_plan_waiting_authenticated_fills';
            if (wallet.currentDay.riskLatched) delete wallet.pendingSourcePlan;
          }
        }
      }
      await writeLiveWallet(o.directory, wallet); return wallet;
    } catch (error) {
      recoveryStability.delete(o.broker);
      if (wallet.technicalRecovery && wallet.currentDay.riskLatched && wallet.currentDay.latchReason === 'live_monitoring_gap') {
        wallet.technicalRecovery.phase = 'reconciling'; wallet.technicalRecovery.healthySinceMs = null;
        wallet.technicalRecovery.healthyObservations = 0; wallet.technicalRecovery.lastHealthyAtMs = null;
        wallet.technicalRecovery.blockedReason = 'authenticated_observation_or_reconciliation_failed';
      }
      wallet.status = 'reconciliation_required'; wallet.blockedReason = error instanceof Error ? error.message : 'Live reconciliation failed';
      await writeLiveWallet(o.directory, wallet); return wallet;
    }
  });
}
