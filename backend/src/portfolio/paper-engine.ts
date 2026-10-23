import { createHash } from 'node:crypto';
import { Decimal } from '@prisma/client/runtime/library';
import type {
  Numeric, PortfolioDay, PortfolioPaperConfig, PortfolioPaperEvent, PortfolioPaperResult,
  PortfolioPaperState, PortfolioPaperStep, PortfolioPaperSummary, SourcePortfolioTargets, SymbolFilter,
  PortfolioPaperTransition, PortfolioPaperObservation, PortfolioPaperWalletObservation,
} from './types';
import { applyCctActualInventoryBand, projectCctTargets } from './target-projection';
import { CCT_PAPER_POLICY, CONSTANT_DIRECTION_POLICY } from './policy-registry';

const Money = Decimal.clone({ precision: 40, rounding: Decimal.ROUND_HALF_EVEN });
const DAY = 86_400_000;
const ICT = 7 * 3_600_000;
// Decimal arithmetic returns new values. Reuse parsed string operands, which
// never leave this module, instead of reparsing quotes and ledger strings at
// every risk check. Bound the cache independently of replay duration.
const parsedValues = new Map<string, Decimal>();
const value = (input: Numeric): Decimal => {
  if (typeof input === 'string') {
    const parsed = parsedValues.get(input);
    if (parsed) return parsed;
  }
  const result = new Money(input);
  if (!result.isFinite()) throw new Error('Non-finite portfolio monetary value');
  if (typeof input === 'string') {
    if (parsedValues.size >= 4096) parsedValues.clear();
    parsedValues.set(input, result);
  }
  return result;
};
const str = (input: Decimal): string => input.isZero() ? '0' : input.toString();
const copy = <T>(input: T): T => JSON.parse(JSON.stringify(input)) as T;
const ictStart = (time: number): number => Math.floor((time + ICT) / DAY) * DAY - ICT;
const ictDay = (time: number): string => new Date(time + ICT).toISOString().slice(0, 10);

/** Pure paper broker: no exchange, network, DB, env or order-client dependency. */
export class PortfolioPaperEngine {
  private readonly cfg: Required<Omit<PortfolioPaperConfig, 'filters' | 'strategy' | 'policyId' | 'sourceRevision' | 'solverRevision' | 'grossCap' | 'bandThreshold'>> & {
    filters: Record<string, SymbolFilter>; strategy: 'momentum-v1' | 'cct-lc-b5-v1' | 'constant-direction-b5-v1'; policyId?: string;
    sourceRevision?: string; solverRevision?: string; grossCap: Numeric; bandThreshold: Numeric;
  };
  private state: PortfolioPaperState;
  private readonly steps: Set<string>;
  private readonly funding: Set<string>;
  private readonly cashflows: Set<string>;
  private events: PortfolioPaperEvent[] = [];
  private eventPrefix = '';
  private walletCurrent = false;
  private closeReserveMemo?: { prices: Record<string, Numeric>; cost: Decimal };
  private readonly usesProjection: boolean;

  constructor(config: PortfolioPaperConfig, restored?: PortfolioPaperState) {
    if (config.strategy !== undefined && config.strategy !== 'momentum-v1' && config.strategy !== 'cct-lc-b5-v1' && config.strategy !== 'constant-direction-b5-v1') throw new Error('Unknown portfolio paper strategy');
    const constant = config.strategy === 'constant-direction-b5-v1';
    this.usesProjection = config.strategy === 'cct-lc-b5-v1' || constant;
    const policy = constant ? CONSTANT_DIRECTION_POLICY : CCT_PAPER_POLICY;
    if (!this.usesProjection && config.grossCap !== undefined && !value(config.grossCap).eq(2)) throw new Error('Momentum gross cap is fixed at2');
    this.cfg = {
      initialCash: config.initialCash ?? '100', dailyLossLimitUsd: config.dailyLossLimitUsd ?? (constant ? '15' : '10'),
      feeRate: config.feeRate ?? '0.0005', slippageBps: config.slippageBps ?? '2',
      leverage: config.leverage ?? '10', maintenanceRate: config.maintenanceRate ?? '0.005',
      closeBufferUsd: config.closeBufferUsd ?? (this.usesProjection ? policy.closeBufferUsd : '0.10'), filters: copy(config.filters),
      strategy: config.strategy ?? 'momentum-v1', grossCap: config.grossCap ?? (this.usesProjection ? '8' : '2'),
      bandThreshold: config.bandThreshold ?? '0.2',
      ...(this.usesProjection ? { policyId: config.policyId ?? policy.id,
        sourceRevision: config.sourceRevision ?? policy.sourceRevision,
        solverRevision: config.solverRevision ?? policy.solverRevision } : {}),
    };
    for (const key of ['initialCash', 'dailyLossLimitUsd', 'leverage', 'grossCap'] as const) {
      if (!value(this.cfg[key]).gt(0)) throw new Error(`Invalid ${key}`);
    }
    for (const key of ['feeRate', 'slippageBps', 'maintenanceRate', 'closeBufferUsd', 'bandThreshold'] as const) {
      if (value(this.cfg[key]).lt(0)) throw new Error(`Invalid ${key}`);
    }
    if (value(this.cfg.closeBufferUsd).gte(value(this.cfg.dailyLossLimitUsd))) throw new Error('Close buffer must be below the fixed daily loss limit');
    const canonical = {
      ...Object.fromEntries(Object.entries(this.cfg).filter(([key]) => !['filters','strategy','policyId','sourceRevision','solverRevision','grossCap','bandThreshold'].includes(key)).map(([key, item]) => [key, value(item as Numeric).toString()])),
      filters: Object.fromEntries(Object.keys(this.cfg.filters).sort().map(symbol => [symbol,
        Object.fromEntries(Object.entries(this.cfg.filters[symbol]).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, value(item).toString()]))])),
      ...(this.usesProjection ? { strategy: this.cfg.strategy, policyId: this.cfg.policyId, sourceRevision: this.cfg.sourceRevision,
        solverRevision: this.cfg.solverRevision, grossCap: str(value(this.cfg.grossCap)), bandThreshold: str(value(this.cfg.bandThreshold)) } : {}),
    };
    const configHash = createHash('sha256').update(JSON.stringify(canonical)).digest('hex');
    if (restored && (restored.schema !== 'momentum-portfolio-paper-v1' || restored.configHash !== configHash)) throw new Error('Paper restart schema/config mismatch');
    this.state = restored ? copy(restored) : {
      schema: 'momentum-portfolio-paper-v1', configHash, startedAt: null, lastTime: null,
      cash: value(this.cfg.initialCash).toString(), equity: value(this.cfg.initialCash).toString(),
      grossNotional: '0', marginUsed: '0', positions: {}, marks: {}, targetWeights: {}, targetQuantities: {},
      currentDay: null, days: [], totalFees: '0', totalSlippage: '0', fundingPnl: '0', realizedPnl: '0', netCashflow: '0',
      fillCount: 0, rebalanceCount: 0, rejectedCount: 0, processedStepIds: [], processedFundingIds: [],
      processedCashflowIds: [], lastTargets: null,
    };
    this.steps = new Set(this.state.processedStepIds);
    this.funding = new Set(this.state.processedFundingIds);
    this.cashflows = new Set(this.state.processedCashflowIds);
    this.validateRestoredState();
  }

  snapshot(): PortfolioPaperState { return copy(this.state); }

  /** Small, detached read model for streaming replays; checkpoints still use snapshot(). */
  observation(): PortfolioPaperObservation {
    const { days: _days, processedStepIds: _steps, processedFundingIds: _funding, processedCashflowIds: _flows, ...state } = this.state;
    return copy(state);
  }

  /** Detached wallet values without the daily source's indicator metadata. */
  walletObservation(): PortfolioPaperWalletObservation {
    const { days: _days, processedStepIds: _steps, processedFundingIds: _funding, processedCashflowIds: _flows,
      targetWeights: _weights, targetQuantities: _quantities, lastTargets: _targets, ...state } = this.state;
    return { ...state, marks: { ...state.marks }, currentDay: state.currentDay ? { ...state.currentDay } : null,
      positions: Object.fromEntries(Object.entries(state.positions).map(([symbol, position]) => [symbol, { ...position }])) };
  }

  step(input: PortfolioPaperStep): PortfolioPaperResult;
  step(input: PortfolioPaperStep, options: { snapshot: false }): PortfolioPaperTransition;
  step(input: PortfolioPaperStep, options?: { snapshot: false }): PortfolioPaperResult | PortfolioPaperTransition {
    if (!input.id || !Number.isSafeInteger(input.time)) throw new Error('Invalid paper step identity/time');
    if (this.steps.has(input.id)) return { ...(options ? {} : { snapshot: this.snapshot() }), events: [], duplicate: true };
    if (this.state.lastTime !== null && input.time < this.state.lastTime) throw new Error('Paper time cannot move backwards');
    // Validate the full frame before modifying the ledger, so malformed data cannot partially commit.
    for (const [symbol, price] of Object.entries(input.marks)) if (!value(price).gt(0)) throw new Error(`Invalid mark ${symbol}`);
    for (const symbol of Object.keys(this.state.positions)) if (input.marks[symbol] === undefined) throw new Error(`Missing current mark ${symbol}`);
    for (const [symbol, price] of Object.entries(input.tradePrices ?? {})) if (!value(price).gt(0)) throw new Error(`Invalid trade price ${symbol}`);
    for (const event of input.funding ?? []) {
      if (!event.id || !event.symbol) throw new Error('Funding identity required');
      value(event.rate);
      if (event.markPrice !== undefined && !value(event.markPrice).gt(0)) throw new Error('Invalid funding mark');
    }
    for (const flow of input.cashflows ?? []) { if (!flow.id) throw new Error('Cashflow identity required'); value(flow.amount); }
    if (input.targets) this.validateTargets(input.targets, input.time);
    // Completed history and identity arrays are append-only. Avoid quadratic
    // copying of hundreds of thousands of replay step IDs on every transition.
    // Marks, source rows and target maps are replaced, never edited in place.
    // Only inventory/currentDay need detached rollback copies.
    const rollback = { ...this.state, positions: copy(this.state.positions), currentDay: copy(this.state.currentDay) };
    const lengths = [rollback.days.length, rollback.processedStepIds.length, rollback.processedFundingIds.length, rollback.processedCashflowIds.length];
    this.events = []; this.eventPrefix = input.id;
    try {
      this.state.marks = Object.fromEntries(Object.entries(input.marks).map(([symbol, price]) => [symbol, str(value(price))]));
      this.walletCurrent = false; this.closeReserveMemo = undefined;
      this.markWallet();
      if (this.state.startedAt === null) this.state.startedAt = input.time;
      if (!this.state.currentDay) this.startDay(input.time, 'initial_empty_wallet');
      else if (this.state.currentDay.day !== ictDay(input.time)) {
        // The boundary price move belongs to the old budget; midnight funding belongs to the new day.
        this.enforceRisk(input.time, input.tradePrices ?? input.marks);
        this.updateDay(); this.state.currentDay.finalized = true;
        this.state.days.push(copy(this.state.currentDay));
        const quality = input.time === ictStart(input.time) ? 'exact_midnight' : 'missing_midnight';
        this.startDay(input.time, quality);
        if (quality === 'missing_midnight') this.latch(input.time, 'missing_ict_midnight_anchor');
        this.emit(input.time, 'day_roll', { reason: quality, ...(this.usesProjection ? { anchorEquity: this.state.equity } : {}) });
      }
      for (const flow of input.cashflows ?? []) {
        if (this.cashflows.has(flow.id)) continue;
        const amount = value(flow.amount);
        this.state.cash = str(value(this.state.cash).plus(amount));
        this.walletCurrent = false;
        this.state.netCashflow = str(value(this.state.netCashflow).plus(amount));
        this.state.currentDay!.netCashflow = str(value(this.state.currentDay!.netCashflow).plus(amount));
        this.cashflows.add(flow.id); this.state.processedCashflowIds.push(flow.id);
        this.emit(input.time, 'cashflow', { cashDelta: str(amount), reason: flow.id });
      }
      for (const event of input.funding ?? []) {
        if (this.funding.has(event.id)) continue;
        const quantity = value(this.state.positions[event.symbol]?.quantity ?? '0');
        const price = event.markPrice ?? input.marks[event.symbol];
        if (!quantity.isZero() && price === undefined) throw new Error(`Missing funding mark ${event.symbol}`);
        const delta = quantity.isZero() ? value('0') : quantity.mul(value(price!)).mul(value(event.rate)).negated();
        this.state.cash = str(value(this.state.cash).plus(delta));
        this.walletCurrent = false;
        this.state.fundingPnl = str(value(this.state.fundingPnl).plus(delta));
        this.funding.add(event.id); this.state.processedFundingIds.push(event.id);
        this.emit(input.time, 'funding', { symbol: event.symbol, quantity: str(quantity), cashDelta: str(delta), reason: event.id });
      }
      this.markWallet(); this.enforceRisk(input.time, input.tradePrices ?? input.marks);
      if (input.forceClose) this.flatten(input.time, input.tradePrices ?? input.marks, input.forceClose);
      else if (input.targets && input.targets.sourceId !== this.state.lastTargets?.sourceId) {
        if (this.state.currentDay!.riskLatched) this.reject(input.time, undefined, `risk_latched:${this.state.currentDay!.latchReason}`);
        else this.rebalance(input.targets, input.time, input.tradePrices ?? input.marks);
      }
      this.markWallet(); this.enforceRisk(input.time, input.tradePrices ?? input.marks); this.updateDay();
      this.state.lastTime = input.time;
      this.steps.add(input.id); this.state.processedStepIds.push(input.id);
      return { ...(options ? {} : { snapshot: this.snapshot() }), events: copy(this.events), duplicate: false };
    } catch (error) {
      for (const id of rollback.processedStepIds.splice(lengths[1])) this.steps.delete(id);
      for (const id of rollback.processedFundingIds.splice(lengths[2])) this.funding.delete(id);
      for (const id of rollback.processedCashflowIds.splice(lengths[3])) this.cashflows.delete(id);
      rollback.days.length = lengths[0];
      this.state = rollback;
      this.walletCurrent = false; this.closeReserveMemo = undefined;
      this.events = [];
      throw error;
    }
  }

  closeAll(time: number, prices: Record<string, Numeric>, reason = 'end_of_testbed'): PortfolioPaperResult {
    return this.step({ id: `close:${time}:${reason}`, time, marks: prices, tradePrices: prices, forceClose: reason });
  }

  summary(): PortfolioPaperSummary {
    const netPnl = value(this.state.equity).minus(value(this.cfg.initialCash)).minus(value(this.state.netCashflow));
    const days = [...this.state.days, ...(this.state.currentDay ? [this.state.currentDay] : [])];
    const calendarDays = this.state.startedAt === null || this.state.lastTime === null ? 0
      : Math.floor((ictStart(this.state.lastTime) - ictStart(this.state.startedAt)) / DAY) + (this.state.lastTime === ictStart(this.state.lastTime) && this.state.lastTime > this.state.startedAt ? 0 : 1);
    const worst = days.length ? Decimal.min(...days.map(day => value(day.worstNetPnl))) : null;
    const maxBreach = days.length ? Decimal.max(...days.map(day => value(day.breachUsd))) : value('0');
    return {
      initialCash: value(this.cfg.initialCash).toString(), equity: this.state.equity, netPnl: str(netPnl),
      netCashflow: this.state.netCashflow, totalFees: this.state.totalFees, totalSlippage: this.state.totalSlippage, fundingPnl: this.state.fundingPnl,
      realizedPnl: this.state.realizedPnl,
      unrealizedPnl: str(value(this.state.equity).minus(value(this.state.cash))),
      grossNotional: this.state.grossNotional, marginUsed: this.state.marginUsed,
      fillCount: this.state.fillCount, rebalanceCount: this.state.rebalanceCount, rejectedCount: this.state.rejectedCount,
      calendarDays, completedDays: this.state.days.length,
      meanNetPerCalendarDay: calendarDays > 0 ? str(netPnl.div(calendarDays)) : null,
      worstDayNetPnl: worst ? str(worst) : null, maxDailyBreachUsd: str(maxBreach),
      riskLatched: this.state.currentDay?.riskLatched ?? false,
    };
  }

  private validateRestoredState(): void {
    for (const field of ['cash','equity','grossNotional','marginUsed','totalFees','totalSlippage','fundingPnl','realizedPnl','netCashflow'] as const) value(this.state[field]);
    for (const [symbol, position] of Object.entries(this.state.positions)) {
      if (value(position.quantity).isZero() || !value(position.averageEntry).gt(0) || !value(this.state.marks[symbol]).gt(0)) throw new Error('Invalid restored position');
    }
    if (this.state.currentDay) {
      value(this.state.currentDay.anchorEquity); value(this.state.currentDay.netCashflow);
      if (this.state.lastTime === null || this.state.currentDay.day !== ictDay(this.state.lastTime)) throw new Error('Invalid restored day anchor');
    }
    const before = this.state.equity;
    this.markWallet();
    if (!value(before).eq(value(this.state.equity))) throw new Error('Restored wallet MTM mismatch');
  }

  private validateTargets(targets: SourcePortfolioTargets, time: number): void {
    if (!targets.sourceId || !Number.isSafeInteger(targets.knownAtMs) || !Number.isSafeInteger(targets.executeAtMs) ||
      targets.knownAtMs > time || targets.executeAtMs !== time || targets.knownAtMs > targets.executeAtMs) throw new Error('Stale or future source targets');
    if (targets.scheduledExecuteAtMs !== undefined && (!Number.isSafeInteger(targets.scheduledExecuteAtMs) ||
      targets.scheduledExecuteAtMs % DAY !== 0 || targets.knownAtMs > targets.scheduledExecuteAtMs ||
      targets.labelTimeMs !== targets.scheduledExecuteAtMs - DAY || targets.scheduledExecuteAtMs > time ||
      time >= targets.scheduledExecuteAtMs + DAY)) throw new Error('Invalid explicit paper-start delay');
    let gross = value('0');
    for (const [symbol, weight] of Object.entries(targets.weights)) {
      if (!Number.isFinite(weight)) throw new Error(`Non-finite target weight ${symbol}`);
      gross = gross.plus(value(weight).abs());
    }
    if (this.cfg.strategy === 'momentum-v1' && gross.gt('2.000000000001')) throw new Error('Source gross target exceeds 2 NAV');
    if (this.usesProjection) {
      if (targets.strategy !== this.cfg.strategy || !targets.metadata) throw new Error('Projected target strategy/metadata required');
      if (targets.policyId !== undefined && targets.policyId !== this.cfg.policyId) throw new Error('Target policy identity mismatch');
      if (targets.sourceRevision !== undefined && targets.sourceRevision !== this.cfg.sourceRevision) throw new Error('Target source revision mismatch');
      if (this.cfg.strategy === 'constant-direction-b5-v1' && (targets.policyId !== this.cfg.policyId || targets.sourceRevision !== this.cfg.sourceRevision)) throw new Error('Constant-direction policy/source identity required');
      for (const symbol of Object.keys(this.cfg.filters)) if (typeof targets.metadata[symbol]?.signalCountChanged !== 'boolean') throw new Error(`Missing projected count metadata ${symbol}`);
      if (this.cfg.strategy === 'constant-direction-b5-v1') for (const symbol of Object.keys(this.cfg.filters)) {
        if (targets.metadata[symbol].signalCountChanged !== false || targets.metadata[symbol].signedSignalCount !== 9) throw new Error(`Invalid constant-direction metadata ${symbol}`);
      }
      for (const [symbol, weight] of Object.entries(targets.weights)) {
        if (!this.cfg.filters[symbol] && weight !== 0) throw new Error(`Projected target outside registered filters ${symbol}`);
        if (this.cfg.strategy === 'constant-direction-b5-v1' && weight < 0) throw new Error(`Constant-direction target must be long only ${symbol}`);
        if (targets.decimalWeights?.[symbol] !== undefined && value(targets.decimalWeights[symbol]).toNumber() !== weight) throw new Error(`Inconsistent decimal source weight ${symbol}`);
      }
    }
  }

  private markWallet(): void {
    if (this.usesProjection && this.walletCurrent) return;
    let unrealized = value('0'), gross = value('0');
    for (const [symbol, position] of Object.entries(this.state.positions)) {
      const mark = value(this.state.marks[symbol]), quantity = value(position.quantity);
      unrealized = unrealized.plus(quantity.mul(mark.minus(value(position.averageEntry))));
      gross = gross.plus(quantity.abs().mul(mark));
    }
    this.state.equity = str(value(this.state.cash).plus(unrealized));
    this.state.grossNotional = str(gross);
    this.state.marginUsed = str(gross.div(value(this.cfg.leverage)));
    this.walletCurrent = true;
  }

  private startDay(time: number, quality: PortfolioDay['anchorQuality']): void {
    this.state.currentDay = { day: ictDay(time), startTime: ictStart(time), anchorEquity: this.state.equity,
      netCashflow: '0', netPnl: '0', worstNetPnl: '0', endEquity: this.state.equity,
      riskLatched: false, latchReason: null, anchorQuality: quality, breachUsd: '0', finalized: false };
  }

  private updateDay(): void {
    const day = this.state.currentDay;
    if (!day) return;
    const net = value(this.state.equity).minus(value(day.anchorEquity)).minus(value(day.netCashflow));
    day.netPnl = str(net); day.endEquity = this.state.equity;
    day.worstNetPnl = str(Decimal.min(value(day.worstNetPnl), net));
    day.breachUsd = str(Decimal.max(value(day.breachUsd), net.negated().minus(value(this.cfg.dailyLossLimitUsd)), 0));
  }

  private latch(time: number, reason: string): void {
    if (this.state.currentDay!.riskLatched) return;
    this.state.currentDay!.riskLatched = true; this.state.currentDay!.latchReason = reason;
    this.emit(time, 'risk_latch', { reason });
  }

  private exactCloseCost(prices: Record<string, Numeric>, candidate?: { symbol: string; quantity: Decimal }): Decimal {
    const memoize = this.usesProjection && !candidate;
    if (memoize && this.closeReserveMemo?.prices === prices) return this.closeReserveMemo.cost;
    const quantities = Object.fromEntries(Object.entries(this.state.positions).map(([symbol, position]) => [symbol, value(position.quantity)]));
    if (candidate) quantities[candidate.symbol] = candidate.quantity;
    const slip = value(this.cfg.slippageBps).div(10_000), fee = value(this.cfg.feeRate);
    const result = Object.entries(quantities).reduce((cost, [symbol, quantity]) => {
      if (quantity.isZero()) return cost;
      const mark = value(this.state.marks[symbol]), reference = value(prices[symbol] ?? mark);
      const fill = reference.mul(value(1).plus(slip.mul(quantity.isNegative() ? 1 : -1)));
      return cost.plus(Decimal.max(quantity.mul(mark.minus(fill)), 0)).plus(quantity.abs().mul(fill).mul(fee));
    }, value('0'));
    if (memoize) this.closeReserveMemo = { prices, cost: result };
    return result;
  }

  private enforceRisk(time: number, tradePrices: Record<string, Numeric>): void {
    this.updateDay();
    const day = this.state.currentDay!;
    const net = value(day.netPnl), equity = value(this.state.equity), gross = value(this.state.grossNotional);
    const reserve = this.exactCloseCost(tradePrices);
    const softLoss = gross.gt(0) && net.minus(reserve).lte(value(this.cfg.dailyLossLimitUsd).negated().plus(value(this.cfg.closeBufferUsd)));
    const maintenanceLoss = gross.gt(0) && equity.lte(gross.mul(value(this.cfg.maintenanceRate)).plus(reserve));
    const hardLoss = net.lte(value(this.cfg.dailyLossLimitUsd).negated());
    const before = this.usesProjection && !day.riskLatched && (softLoss || maintenanceLoss || hardLoss) ? {
      observedNet: str(net), equity: str(equity), anchorEquity: day.anchorEquity, gross: str(gross),
      closeReserve: str(reserve), closeBuffer: str(value(this.cfg.closeBufferUsd)),
      softBudgetThreshold: str(value(this.cfg.dailyLossLimitUsd).negated().plus(value(this.cfg.closeBufferUsd))),
      quantities: Object.fromEntries(Object.entries(this.state.positions).map(([symbol, p]) => [symbol, p.quantity])),
      marks: copy(this.state.marks), references: copy(tradePrices),
    } : undefined;
    if (softLoss) this.latch(time, 'fixed_daily_loss_close_reserve');
    if (maintenanceLoss) this.latch(time, 'modeled_maintenance_margin');
    if (hardLoss) this.latch(time, 'fixed_daily_loss_observed');
    if (day.riskLatched && gross.gt(0)) this.flatten(time, tradePrices, day.latchReason ?? 'risk_stop');
    this.updateDay();
    if (before && day.riskLatched) this.emit(time, 'buffer_latch_context', { ...before, latchReason: day.latchReason ?? undefined });
  }

  private filter(symbol: string): { step: Decimal; min: Decimal; max: Decimal | null; notional: Decimal } {
    const raw = this.cfg.filters[symbol];
    if (!raw) throw new Error(`Missing market filters ${symbol}`);
    const step = value(raw.marketStepSize ?? raw.stepSize), min = value(raw.marketMinQty ?? raw.minQty);
    const notional = value(raw.minNotional), maxValue = raw.marketMaxQty ?? raw.maxQty;
    const max = maxValue === undefined ? null : value(maxValue);
    if (!step.gt(0) || !min.gt(0) || !notional.gt(0) || (max && max.lt(min))) throw new Error(`Invalid market filters ${symbol}`);
    return { step, min, notional, max };
  }

  private rebalance(targets: SourcePortfolioTargets, time: number, prices: Record<string, Numeric>): void {
    if (this.usesProjection) return this.rebalanceProjected(targets, time, prices);
    const equity = value(this.state.equity), cap = Decimal.max(equity.mul(2), 0);
    const quantities: Record<string, Decimal> = {};
    const ideal: Record<string, Decimal> = {};
    const symbols = [...new Set([...Object.keys(targets.weights), ...Object.keys(this.state.positions)])].sort();
    for (const symbol of symbols) {
      const weight = targets.weights[symbol] ?? 0;
      if (weight === 0) { quantities[symbol] = value('0'); ideal[symbol] = value('0'); continue; }
      if (prices[symbol] === undefined || this.state.marks[symbol] === undefined) throw new Error(`Missing target price ${symbol}`);
      const price = value(prices[symbol]), filters = this.filter(symbol);
      const requested = equity.gt(0) ? equity.mul(value(weight)).div(price) : value('0'); ideal[symbol] = requested;
      const minimum = Decimal.max(filters.min.div(filters.step).ceil().mul(filters.step), filters.notional.div(value(this.state.marks[symbol])).div(filters.step).ceil().mul(filters.step));
      const floor = requested.abs().div(filters.step).floor().mul(filters.step);
      const candidates = [value('0'), Decimal.max(minimum, floor), Decimal.max(minimum, floor.plus(filters.step))]
        .filter(quantity => quantity.isZero() || (!filters.max || quantity.lte(filters.max)));
      candidates.sort((a, b) => a.minus(requested.abs()).abs().cmp(b.minus(requested.abs()).abs()) || a.cmp(b));
      const selected = candidates[0].mul(requested.isNegative() ? -1 : 1);
      quantities[symbol] = selected;
      if (!selected.eq(requested)) this.emit(time, 'target', { symbol, targetWeight: weight,
        targetQuantity: str(selected), reason: selected.isZero() ? 'nearest_zero_below_market_minimum' : 'nearest_valid_market_lot' });
    }
    const projectedGross = (): Decimal => Object.entries(quantities).reduce((total, [symbol, quantity]) => total.plus(quantity.abs().mul(value(this.state.marks[symbol]))), value('0'));
    // Independent nearest-lot projection can increase gross; prune the least tracking-cost target first.
    while (projectedGross().gt(cap)) {
      const choices = Object.keys(quantities).filter(symbol => !quantities[symbol].isZero()).sort((a, b) => {
        const ratio = (symbol: string): Decimal => ideal[symbol].abs().minus(quantities[symbol].minus(ideal[symbol]).abs()).div(quantities[symbol].abs());
        return ratio(a).cmp(ratio(b)) || a.localeCompare(b);
      });
      if (!choices.length) break;
      const symbol = choices[0]; quantities[symbol] = value('0');
      this.emit(time, 'target', { symbol, targetWeight: targets.weights[symbol] ?? 0, targetQuantity: '0', reason: 'pruned_to_source_gross_cap' });
    }
    this.state.targetWeights = copy(targets.weights);
    this.state.targetQuantities = Object.fromEntries(Object.entries(quantities).map(([symbol, quantity]) => [symbol, str(quantity)]));
    this.state.lastTargets = copy(targets); this.state.rebalanceCount++;
    // All reductions/old signs first; a flip is always close then open.
    for (const symbol of symbols) {
      const old = value(this.state.positions[symbol]?.quantity ?? '0'), target = quantities[symbol];
      if (old.isZero()) continue;
      const sameSign = old.isNegative() === target.isNegative() && !target.isZero();
      const retained = sameSign ? Decimal.min(old.abs(), target.abs()).mul(old.isNegative() ? -1 : 1) : value('0');
      const delta = retained.minus(old);
      if (!delta.isZero()) this.fill(symbol, delta, value(prices[symbol] ?? this.state.marks[symbol]), time, 'target_reduce', true);
    }
    this.markWallet();
    for (const symbol of symbols) {
      const old = value(this.state.positions[symbol]?.quantity ?? '0'), delta = quantities[symbol].minus(old);
      if (delta.isZero()) continue;
      if (!old.isZero() && old.isNegative() !== quantities[symbol].isNegative()) { this.reject(time, symbol, 'unclosed_opposite_inventory'); continue; }
      this.fill(symbol, delta, value(prices[symbol] ?? this.state.marks[symbol]), time, 'target_increase', false, prices);
      this.markWallet(); this.enforceRisk(time, prices);
      if (this.state.currentDay!.riskLatched) break;
    }
  }

  private rebalanceProjected(targets: SourcePortfolioTargets, time: number, prices: Record<string, Numeric>): void {
    this.state.lastTargets = copy(targets); this.state.targetWeights = copy(targets.weights); this.state.rebalanceCount++;
    if (!value(this.state.equity).gt(0)) { this.reject(time, undefined, 'insolvent_wallet'); return; }
    const weights = Object.fromEntries(Object.keys(this.cfg.filters).map(symbol => [symbol, targets.decimalWeights?.[symbol] ?? targets.weights[symbol] ?? 0]));
    const effective = applyCctActualInventoryBand({ weights, positions: this.state.positions, equity: this.state.equity,
      marks: this.state.marks, metadata: targets.metadata!, threshold: this.cfg.bandThreshold });
    const plan = projectCctTargets({ weights: effective, positions: this.state.positions, equity: this.state.equity,
      marks: this.state.marks, filters: this.cfg.filters, grossCap: this.cfg.grossCap, feeRate: this.cfg.feeRate,
      slippageBps: this.cfg.slippageBps, references: prices, leverage: this.cfg.leverage,
      dayAnchor: this.state.currentDay!.anchorEquity, dayNetCashflow: this.state.currentDay!.netCashflow,
      dailyLossBudget: this.cfg.dailyLossLimitUsd, closeBuffer: this.cfg.closeBufferUsd });
    this.state.targetQuantities = copy(plan.quantities);
    if (!plan.feasible) { this.reject(time, undefined, `projection_infeasible:${plan.reason}`); return; }
    for (const order of plan.orders) {
      this.fill(order.symbol, value(order.quantity), value(prices[order.symbol]), time,
        order.reduceOnly ? 'target_reduce' : 'target_increase', order.reduceOnly, prices);
      this.markWallet(); this.enforceRisk(time, prices);
      if (this.state.currentDay!.riskLatched) break;
    }
    this.emit(time, 'projection', { feasible: plan.feasible, trackingErrorUsd: plan.trackingErrorUsd,
      netDeviationUsd: plan.netDeviationUsd, projectedQuantities: copy(plan.quantities), effectiveWeights: effective });
  }

  private fill(symbol: string, requested: Decimal, reference: Decimal, time: number, reason: string, reducing: boolean,
    executionPrices: Record<string, Numeric> = {}): void {
    const filters = this.filter(symbol), quantity = requested.abs().div(filters.step).floor().mul(filters.step).mul(requested.isNegative() ? -1 : 1);
    if (quantity.isZero() || quantity.abs().lt(filters.min) || (filters.max && quantity.abs().gt(filters.max))) { this.reject(time, symbol, 'market_quantity_filter'); return; }
    const slip = value(this.cfg.slippageBps).div(10_000), price = reference.mul(value(1).plus(slip.mul(quantity.isNegative() ? -1 : 1)));
    const notional = quantity.abs().mul(price), fee = notional.mul(value(this.cfg.feeRate));
    if (!reducing && quantity.abs().mul(value(this.state.marks[symbol])).lt(filters.notional)) { this.reject(time, symbol, 'market_min_notional'); return; }
    const old = value(this.state.positions[symbol]?.quantity ?? '0'), entry = value(this.state.positions[symbol]?.averageEntry ?? price);
    const next = old.plus(quantity);
    if (!reducing) {
      const grossAfter = value(this.state.grossNotional).minus(old.abs().mul(value(this.state.marks[symbol]))).plus(next.abs().mul(value(this.state.marks[symbol])));
      const equityAfter = value(this.state.equity).minus(fee).plus(quantity.mul(value(this.state.marks[symbol]).minus(price)));
      const closeReserve = this.exactCloseCost({ ...executionPrices, [symbol]: str(reference) }, { symbol, quantity: next });
      const remainingAfter = equityAfter.minus(value(this.state.currentDay!.anchorEquity)).minus(value(this.state.currentDay!.netCashflow)).minus(closeReserve);
      if (grossAfter.gt(equityAfter.mul(value(this.cfg.grossCap)))) { this.reject(time, symbol, this.usesProjection ? 'post_cost_candidate_gross_cap' : 'post_cost_source_gross_cap'); return; }
      if (grossAfter.div(value(this.cfg.leverage)).plus(closeReserve).gt(equityAfter)) { this.reject(time, symbol, 'initial_margin_reservation'); return; }
      if (this.usesProjection) this.emit(time, 'buffer_admission_reserve', { symbol, quantity: str(quantity),
        candidateQuantity: str(next), equityAfter: str(equityAfter), anchorEquity: this.state.currentDay!.anchorEquity,
        closeReserve: str(closeReserve), reservedDayNetAfter: str(remainingAfter), closeBuffer: str(value(this.cfg.closeBufferUsd)),
        softBudgetThreshold: str(value(this.cfg.dailyLossLimitUsd).negated().plus(value(this.cfg.closeBufferUsd))) });
      if (remainingAfter.lte(value(this.cfg.dailyLossLimitUsd).negated().plus(value(this.cfg.closeBufferUsd)))) { this.reject(time, symbol, 'fixed_daily_budget_reservation'); return; }
    }
    let realized = value('0'), average = entry;
    if (!old.isZero() && old.isNegative() !== quantity.isNegative()) {
      // Static min() returns its constructor's Decimal type. Projected strategies keep
      // Money40 for the following arithmetic; preserve legacy rounding.
      const closed = this.usesProjection
        ? Money.min(old.abs(), quantity.abs()) : Decimal.min(old.abs(), quantity.abs());
      realized = closed.mul(price.minus(entry)).mul(old.isNegative() ? -1 : 1);
      if (!next.isZero() && old.isNegative() !== next.isNegative()) average = price;
    } else if (!next.isZero()) average = old.abs().mul(entry).plus(quantity.abs().mul(price)).div(next.abs());
    if (next.isZero()) delete this.state.positions[symbol];
    else this.state.positions[symbol] = { quantity: str(next), averageEntry: str(average) };
    const cashDelta = realized.minus(fee);
    this.state.cash = str(value(this.state.cash).plus(cashDelta));
    this.walletCurrent = false; this.closeReserveMemo = undefined;
    this.state.totalFees = str(value(this.state.totalFees).plus(fee));
    this.state.totalSlippage = str(value(this.state.totalSlippage).plus(quantity.abs().mul(price.minus(reference).abs())));
    this.state.realizedPnl = str(value(this.state.realizedPnl).plus(realized));
    this.state.fillCount++; this.markWallet();
    this.emit(time, 'fill', { symbol, quantity: str(quantity), referencePrice: str(reference), fillPrice: str(price),
      cashDelta: str(cashDelta), fee: str(fee), realizedPnl: str(realized), reason, grossNotional: this.state.grossNotional });
  }

  private flatten(time: number, prices: Record<string, Numeric>, reason: string): void {
    for (const symbol of Object.keys(this.state.positions).sort()) {
      this.fill(symbol, value(this.state.positions[symbol].quantity).negated(), value(prices[symbol] ?? this.state.marks[symbol]), time, reason, true);
    }
    this.markWallet(); this.updateDay();
  }

  private reject(time: number, symbol: string | undefined, reason: string): void {
    this.state.rejectedCount++; this.emit(time, 'rejected', { ...(symbol ? { symbol } : {}), reason });
  }

  private emit(time: number, kind: PortfolioPaperEvent['kind'], details: Omit<PortfolioPaperEvent, 'id' | 'time' | 'kind'>): void {
    this.events.push({ id: `${this.eventPrefix}:${this.events.length}`, time, kind, ...details });
  }
}
