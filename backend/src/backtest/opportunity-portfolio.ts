import type { AiOpportunityPolicy } from '../config/ai-opportunity-policy';
import { opportunityPlanBlock, type OpportunityFinance, type OpportunityPlan } from '../utils/ai-opportunity';
import { computeExecutionRisk } from '../utils/execution-risk';

export interface PortfolioQuantityFilters {
  stepSize: number; minQty: number; minNotional: number;
}

export interface PortfolioCircuit {
  maxDrawdownPercent: number; drawdownEnabled: boolean;
  expectancyEnabled: boolean; expectancyWindow: number; expectancyMinSumR: number;
  maxExposurePercentOfEquity: number | null;
}
export interface PortfolioClose {
  planId: string; time: number; netUsd: number; netR: number; feesUsd: number;
  slippageUsd: number; fundingUsd: number; wallet: number;
}
/** Explicit flat-account snapshot. Missing historical state must not be called live parity. */
export interface PortfolioInitialState {
  asOf: number; dayStartEquity: number; peakEquity: number; blockedUntil: number;
  openPositions: 0; pendingOrders: 0;
  recentCloses: Array<{time: number; netR: number}>;
}
/** Chronological cash/equity ledger. No future outcomes or market data inside this class. */
export class OpportunityPortfolio {
  wallet: number;
  equity: number;
  peak: number;
  maxDrawdownPercent = 0;
  dayStart: number;
  blockedUntil = 0;
  readonly closes: PortfolioClose[] = [];
  pending: OpportunityPlan | null = null;
  holding: { plan: OpportunityPlan; entryTime: number; entryFee: number; entrySlip: number; funding: number; riskUsd: number } | null = null;
  private day: number | null = null;
  private time = -Infinity;
  private mark = 0;
  private priorCloses: Array<{time: number; netR: number}> = [];
  private readonly quantityFilters: PortfolioQuantityFilters;
  constructor(readonly initialWallet: number, readonly policy: AiOpportunityPolicy, readonly circuit: PortfolioCircuit,
    readonly feePerSide: number, readonly slippageFraction: number, initialState?: PortfolioInitialState,
    quantityFilters: PortfolioQuantityFilters = {stepSize:.001,minQty:.001,minNotional:50}) {
    if (![quantityFilters.stepSize,quantityFilters.minQty,quantityFilters.minNotional]
      .every(v=>Number.isFinite(v)&&v>0)) throw Error('invalid_quantity_filters');
    this.quantityFilters={...quantityFilters};
    if (!(initialWallet > 0) || !Number.isFinite(initialWallet) || !policy.pinned ||
      ![feePerSide,slippageFraction].every(v=>Number.isFinite(v)&&v>=0)) throw new Error('invalid_portfolio');
    this.wallet = this.equity = this.peak = this.dayStart = initialWallet;
    if (initialState) {
      const s=initialState;
      if (![s.asOf,s.dayStartEquity,s.peakEquity,s.blockedUntil].every(Number.isFinite) ||
        s.asOf<0 || s.dayStartEquity<=0 || s.peakEquity<initialWallet || s.blockedUntil<0 ||
        s.openPositions!==0 || s.pendingOrders!==0 || !Array.isArray(s.recentCloses) ||
        s.recentCloses.some((c,i)=>!Number.isFinite(c.time)||!Number.isFinite(c.netR)||c.time>s.asOf||
          (i>0&&c.time<s.recentCloses[i-1].time))) throw Error('invalid_initial_portfolio_state');
      this.time=s.asOf;this.day=Math.floor((s.asOf+7*3600000)/86400000);
      this.dayStart=s.dayStartEquity;this.peak=s.peakEquity;this.blockedUntil=s.blockedUntil;
      this.priorCloses=s.recentCloses.map(c=>({...c}));
      this.revalue();
    }
  }
  advance(time: number, mark: number): void {
    if (!Number.isFinite(time) || time < this.time || !Number.isFinite(mark) || mark <= 0) throw new Error('noncausal_clock_or_mark');
    this.time = time; this.mark = mark;
    this.revalue();
    const day = Math.floor((time + 7 * 3600000) / 86400000);
    if (day !== this.day) { this.day = day; this.dayStart = this.equity; }
  }
  private revalue(): void {
    const h = this.holding;
    this.equity = this.wallet + (h ? (h.plan.side === 'long' ? 1 : -1) * (this.mark - h.plan.entry) * h.plan.quantity : 0);
    this.peak = Math.max(this.peak, this.equity);
    this.maxDrawdownPercent = Math.max(this.maxDrawdownPercent, (this.peak - this.equity) / this.peak * 100);
  }
  block(): string | null {
    if (!Number.isFinite(this.time)) return 'uninitialized_clock';
    if (this.pending || this.holding) return 'occupied';
    if (this.time < this.blockedUntil) return 'cooldown';
    if (this.wallet <= 0) return 'wallet';
    if ((this.dayStart - this.equity) / this.dayStart * 100 >= this.policy.dailyPercent) return 'daily_circuit';
    if (this.circuit.drawdownEnabled && (this.peak - this.equity) / this.peak * 100 >= this.circuit.maxDrawdownPercent) return 'drawdown_circuit';
    const sample = [...this.priorCloses,...this.closes].slice(-this.circuit.expectancyWindow);
    // Runtime reevaluates the unchanged losing window after cooldown; never silently clear it here.
    if (this.circuit.expectancyEnabled && sample.length >= this.circuit.expectancyWindow &&
      sample.reduce((sum, c) => sum + c.netR, 0) <= this.circuit.expectancyMinSumR) return 'expectancy_circuit';
    return null;
  }
  finance(fundingRate: number): OpportunityFinance {
    const percent = this.circuit.maxExposurePercentOfEquity;
    const exposure = percent && percent > 0 ? this.wallet * percent / 100 : this.policy.maxExposure;
    return { balance: this.wallet, remainingDailyRiskUsd: Math.max(0, this.dayStart * this.policy.dailyPercent / 100 - Math.max(0, this.dayStart - this.equity)),
      remainingExposureUsd: Math.max(0, Math.min(exposure, this.policy.maxExposure)), allowed: this.block() === null,
      ...this.quantityFilters, fundingRate };
  }
  reserve(plan: OpportunityPlan, fundingRate: number): string | null {
    const block = this.block() ?? opportunityPlanBlock(plan, this.finance(fundingRate), this.policy, this.time);
    if (block) return block;
    this.pending = structuredClone(plan);
    return null;
  }
  fill(): void {
    const p = this.pending;
    if (!p || this.holding) throw new Error('invalid_fill');
    const entryFee = p.entry * p.quantity * this.feePerSide;
    const entrySlip = p.entry * p.quantity * this.slippageFraction / 2;
    const riskUsd = computeExecutionRisk({entry:p.entry,stopLoss:p.stopLoss,quantity:p.quantity,balance:this.wallet,
      roundTripFeePercent:this.policy.feePercent,slippagePercent:this.policy.slippagePercent}).totalRiskUsd;
    this.holding = {plan:p,entryTime:this.time,entryFee,entrySlip,funding:0,riskUsd};
    this.pending = null; this.wallet -= entryFee + entrySlip; this.revalue();
  }
  fund(rate: number, markPrice: number): void {
    if (![rate,markPrice].every(Number.isFinite) || markPrice <= 0) throw new Error('invalid_funding');
    const h = this.holding;
    if (h && this.time > h.entryTime) {
      const cost = (h.plan.side === 'long' ? 1 : -1) * h.plan.quantity * markPrice * rate;
      h.funding += cost; this.wallet -= cost; this.revalue();
    }
  }
  cancel(): void {
    if (!this.pending || this.holding) throw new Error('invalid_cancel');
    this.pending = null; this.blockedUntil = this.time + 3600000;
  }
  close(price: number): PortfolioClose {
    const h = this.holding;
    if (!h || !Number.isFinite(price) || price <= 0) throw new Error('invalid_close');
    const p = h.plan, gross = (p.side === 'long' ? 1 : -1) * (price - p.entry) * p.quantity;
    const exitFee = price * p.quantity * this.feePerSide, exitSlip = p.entry * p.quantity * this.slippageFraction / 2;
    this.wallet += gross - exitFee - exitSlip;
    const netUsd = gross - h.entryFee - exitFee - h.entrySlip - exitSlip - h.funding;
    const result = {planId:p.id,time:this.time,netUsd,netR:netUsd/h.riskUsd,feesUsd:h.entryFee+exitFee,
      slippageUsd:h.entrySlip+exitSlip,fundingUsd:h.funding,wallet:this.wallet};
    this.closes.push(result);this.holding=null;this.blockedUntil=this.time+3600000;this.revalue();return result;
  }
}
