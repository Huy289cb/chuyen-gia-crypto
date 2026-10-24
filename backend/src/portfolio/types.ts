export type Numeric = string | number;
export interface SymbolFilter {
  stepSize: Numeric; minQty: Numeric; minNotional: Numeric; maxQty?: Numeric;
  marketStepSize?: Numeric; marketMinQty?: Numeric; marketMaxQty?: Numeric;
}
export interface PortfolioPaperConfig {
  filters: Record<string, SymbolFilter>;
  initialCash?: Numeric; dailyLossLimitUsd?: Numeric; feeRate?: Numeric;
  slippageBps?: Numeric; leverage?: Numeric; maintenanceRate?: Numeric; closeBufferUsd?: Numeric;
  /** Absent means the original momentum policy, including its checkpoint hash. */
  strategy?: 'momentum-v1' | 'cct-lc-b5-v1' | 'constant-direction-b5-v1' | 'macro-momentum-calibrated-v1' | 'multi-sleeve-hybrid-v1';
  policyId?: string; sourceRevision?: string; solverRevision?: string;
  grossCap?: Numeric; bandThreshold?: Numeric;
}
export interface DailyPriceRow { openTimeMs: number; closes: Record<string, number | null> }
export interface SourcePortfolioTargets {
  weights: Record<string, number>; knownAtMs: number; executeAtMs: number;
  labelTimeMs: number; sourceId: string;
  /** Explicit paper-start delay; absent in the historical source-parity schedule. */
  scheduledExecuteAtMs?: number;
  strategy?: 'cct-lc-b5-v1' | 'constant-direction-b5-v1' | 'macro-momentum-calibrated-v1' | 'multi-sleeve-hybrid-v1'; originalSourceId?: string;
  policyId?: string; sourceRevision?: string;
  /** Decimal source-scaling bytes for execution; weights remains the display/source numeric view. */
  decimalWeights?: Record<string, string>;
  metadata?: Record<string, { signalCountChanged: boolean; [key: string]: unknown }>;
}
export interface PortfolioFunding { id: string; symbol: string; rate: Numeric; markPrice?: Numeric }
export interface PortfolioCashflow { id: string; amount: Numeric }
export interface PortfolioPaperStep {
  id: string; time: number; marks: Record<string, Numeric>; tradePrices?: Record<string, Numeric>;
  targets?: SourcePortfolioTargets; funding?: PortfolioFunding[]; cashflows?: PortfolioCashflow[];
  forceClose?: string;
}
export interface PortfolioPosition { quantity: string; averageEntry: string }
export interface PortfolioDay {
  day: string; startTime: number; anchorEquity: string; netCashflow: string;
  netPnl: string; worstNetPnl: string; endEquity: string; riskLatched: boolean;
  latchReason: string | null; anchorQuality: 'initial_empty_wallet' | 'exact_midnight' | 'missing_midnight';
  breachUsd: string; finalized: boolean;
}
export interface PortfolioPaperEvent {
  id: string; time: number; kind: 'fill' | 'funding' | 'cashflow' | 'risk_latch' | 'target' | 'rejected' | 'day_roll' | 'projection' | 'buffer_admission_reserve' | 'buffer_latch_context';
  symbol?: string; quantity?: string; referencePrice?: string; fillPrice?: string;
  cashDelta?: string; fee?: string; realizedPnl?: string; reason?: string;
  grossNotional?: string; targetWeight?: number; targetQuantity?: string;
  feasible?: boolean; trackingErrorUsd?: string; netDeviationUsd?: string; projectedQuantities?: Record<string, string>;
  effectiveWeights?: Record<string, string>; closeReserve?: string; closeBuffer?: string; softBudgetThreshold?: string;
  equityAfter?: string; anchorEquity?: string; reservedDayNetAfter?: string; candidateQuantity?: string;
  observedNet?: string; equity?: string; gross?: string; quantities?: Record<string, string>;
  marks?: Record<string, string>; references?: Record<string, Numeric>; latchReason?: string;
}
export interface PortfolioPaperState {
  schema: 'momentum-portfolio-paper-v1'; configHash: string; startedAt: number | null; lastTime: number | null;
  cash: string; equity: string; grossNotional: string; marginUsed: string;
  positions: Record<string, PortfolioPosition>; marks: Record<string, string>;
  targetWeights: Record<string, number>; targetQuantities: Record<string, string>;
  currentDay: PortfolioDay | null; days: PortfolioDay[];
  totalFees: string; totalSlippage: string; fundingPnl: string; realizedPnl: string; netCashflow: string;
  fillCount: number; rebalanceCount: number; rejectedCount: number;
  processedStepIds: string[]; processedFundingIds: string[]; processedCashflowIds: string[];
  lastTargets: SourcePortfolioTargets | null;
}
export interface PortfolioPaperResult { snapshot: PortfolioPaperState; events: PortfolioPaperEvent[]; duplicate: boolean }
export interface PortfolioPaperTransition { events: PortfolioPaperEvent[]; duplicate: boolean }
export type PortfolioPaperObservation = Omit<PortfolioPaperState, 'days' | 'processedStepIds' | 'processedFundingIds' | 'processedCashflowIds'>;
export type PortfolioPaperWalletObservation = Omit<PortfolioPaperObservation, 'targetWeights' | 'targetQuantities' | 'lastTargets'>;
export interface PortfolioPaperSummary {
  initialCash: string; equity: string; netPnl: string; netCashflow: string;
  totalFees: string; totalSlippage: string; fundingPnl: string; realizedPnl: string; unrealizedPnl: string;
  grossNotional: string; marginUsed: string; fillCount: number; rebalanceCount: number;
  rejectedCount: number; calendarDays: number; completedDays: number; meanNetPerCalendarDay: string | null;
  worstDayNetPnl: string | null; maxDailyBreachUsd: string; riskLatched: boolean;
}
