import { computeExecutionRisk, resolveExecutionRiskCapUsd } from '../utils/execution-risk';
import { BacktestCooldownState } from './cooldown-simulator';
import { resolveQuantityForMinNotional } from '../utils/order-quantity';
import { resolveTargetPositionNotionalUsd } from '../config/v3-entry-policy';

export interface ReplayFunding { time: number; rate: number; markPrice: number }
export interface ReplayAccountOptions {
  initialWallet: number; maxRiskUsd?: number | null; maxRiskPercent: number;
  targetRiskPercent: number; maxExposureUsd: number; dailyLossPercent: number;
  feePerSide: number; slippageFraction: number; funding: ReplayFunding[];
  postCloseCooldown?: { winMinutes: number; lossMinutes: number };
  /** Supply the captured exchange/policy values for current-live comparisons. */
  quantityFilters?: { minQty: number; stepSize: number; minNotionalUsd: number; tolerancePercent: number };
  /** Admission reserve is live policy, separate from modeled realized execution costs. */
  admissionReserve?: { roundTripFeePercent: number; slippagePercent: number };
}
interface Holding {
  key: string; side: 'long' | 'short'; entry: number; time: number; quantity: number;
  entryFee: number; entrySlippage: number; fundingCost: number; initialPriceRisk: number;
}

/** Single-position cash ledger. Charges fees/slippage and signed funding when incurred. */
export class ReplayAccount {
  wallet: number;
  private holding: Holding | null = null;
  private fundingIndex = 0;
  private dailyNet = new Map<number, number>();
  private cooldown = new BacktestCooldownState();
  private postCloseBlockedUntil = 0;
  readonly blocks: Record<string, number> = {};
  constructor(readonly options: ReplayAccountOptions) {
    this.wallet = options.initialWallet;
    if (!(this.wallet > 0) || !Number.isFinite(this.wallet)) throw new Error('Invalid replay wallet');
    if (!Number.isFinite(options.feePerSide) || options.feePerSide < 0 ||
        !Number.isFinite(options.slippageFraction) || options.slippageFraction < 0) throw new Error('Invalid replay costs');
    if (options.admissionReserve && ![options.admissionReserve.roundTripFeePercent, options.admissionReserve.slippagePercent]
      .every(n => Number.isFinite(n) && n >= 0)) throw new Error('Invalid admission reserve');
    for (let i = 0; i < options.funding.length; i++) {
      const f = options.funding[i];
      if (![f.time, f.rate, f.markPrice].every(Number.isFinite) || f.markPrice <= 0 ||
          (i > 0 && f.time <= options.funding[i - 1].time)) throw new Error('Invalid or unsorted funding history');
    }
  }
  private day(time: number) { return Math.floor((time + 7 * 3600_000) / 86400_000); }
  private post(amount: number, time: number) {
    this.wallet += amount;
    const day = this.day(time);
    this.dailyNet.set(day, (this.dailyNet.get(day) ?? 0) + amount);
  }
  advance(time: number): void {
    const rows = this.options.funding;
    while (this.fundingIndex < rows.length && rows[this.fundingIndex].time <= time) {
      const f = rows[this.fundingIndex++];
      if (this.holding && f.time > this.holding.time) {
        const cost = (this.holding.side === 'long' ? 1 : -1) * this.holding.quantity * f.markPrice * f.rate;
        this.holding.fundingCost += cost;
        this.post(-cost, f.time);
      }
    }
  }
  tryOpen(input: { key: string; side: 'long' | 'short'; entry: number; stopLoss: number; time: number }):
    { accepted: true; quantity: number } | { accepted: false; reason: string } {
    this.advance(input.time);
    const reject = (reason: string) => {
      this.blocks[reason] = (this.blocks[reason] ?? 0) + 1;
      return { accepted: false as const, reason };
    };
    if (this.holding) return reject('open_position');
    if (this.cooldown.isBlocked(input.time)) return reject('cooldown');
    if (input.time < this.postCloseBlockedUntil) return reject('post_close_cooldown');
    if (!(this.wallet > 0)) return reject('wallet');
    const stopFraction = Math.abs(input.entry - input.stopLoss) / input.entry;
    if (!(stopFraction > 0) || !Number.isFinite(stopFraction)) return reject('invalid_stop');
    // Legacy BTC defaults remain for archived studies. Live comparisons must supply
    // the observed filters; normalization itself is the production implementation.
    const filters = this.options.quantityFilters ?? {
      minQty: .001, stepSize: .001, minNotionalUsd: 50, tolerancePercent: 0,
    };
    const desired = resolveTargetPositionNotionalUsd({
      computedUsd: this.wallet * this.options.targetRiskPercent / 100 / stopFraction,
      minNotionalUsd: filters.minNotionalUsd, remainingCapacityUsd: this.options.maxExposureUsd,
    });
    const resolved = resolveQuantityForMinNotional({ quantity: desired / input.entry,
      entryPrice: input.entry, ...filters, maxNotionalUsd: this.options.maxExposureUsd });
    if (!resolved.valid) return reject('execution_risk');
    const quantity = resolved.normalizedQty;
    const notional = input.entry * quantity;
    const risk = computeExecutionRisk({ entry: input.entry, stopLoss: input.stopLoss, quantity, balance: this.wallet,
      roundTripFeePercent: Math.max(.1, this.options.admissionReserve?.roundTripFeePercent ?? this.options.feePerSide * 200),
      slippagePercent: Math.max(.1, this.options.admissionReserve?.slippagePercent ?? this.options.slippageFraction * 100) });
    const cap = resolveExecutionRiskCapUsd({ balance: this.wallet,
      maxRiskUsd: this.options.maxRiskUsd, maxRiskPercent: this.options.maxRiskPercent });
    if (notional > this.options.maxExposureUsd + 1e-9 || risk.totalRiskUsd > cap + 1e-9) return reject('execution_risk');
    const dayPnl = this.dailyNet.get(this.day(input.time)) ?? 0;
    const dayStart = this.wallet - dayPnl;
    if (this.options.dailyLossPercent > 0 &&
        risk.totalRiskUsd > dayStart * this.options.dailyLossPercent / 100 + Math.min(0, dayPnl) + 1e-9) {
      return reject('daily_budget');
    }
    const entryFee = notional * this.options.feePerSide;
    const entrySlippage = notional * this.options.slippageFraction / 2;
    this.holding = { ...input, quantity, entryFee, entrySlippage, fundingCost: 0,
      initialPriceRisk: Math.abs(input.entry - input.stopLoss) * quantity };
    this.post(-entryFee - entrySlippage, input.time);
    return { accepted: true, quantity };
  }
  close(key: string, price: number, time: number) {
    this.advance(time);
    const p = this.holding;
    if (!p || p.key !== key) throw new Error('Replay position/account mismatch');
    const grossUsd = (p.side === 'long' ? 1 : -1) * (price - p.entry) * p.quantity;
    const exitFee = price * p.quantity * this.options.feePerSide;
    const exitSlippage = p.entry * p.quantity * this.options.slippageFraction / 2;
    this.post(grossUsd - exitFee - exitSlippage, time);
    const feesUsd = p.entryFee + exitFee, slippageUsd = p.entrySlippage + exitSlippage;
    const netUsd = grossUsd - feesUsd - slippageUsd - p.fundingCost;
    this.cooldown.onTradeClose(netUsd, time);
    if (this.options.postCloseCooldown) {
      const minutes = netUsd < -0.01
        ? this.options.postCloseCooldown.lossMinutes : this.options.postCloseCooldown.winMinutes;
      this.postCloseBlockedUntil = time + Math.max(0, minutes) * 60_000;
    }
    this.holding = null;
    return { quantity: p.quantity, grossUsd, feesUsd, slippageUsd, fundingUsd: p.fundingCost,
      netUsd, netR: netUsd / p.initialPriceRisk, walletAfter: this.wallet };
  }
}
