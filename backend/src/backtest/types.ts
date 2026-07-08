import type { SignalGateOutput } from '../services/signal-gate.service';
import type { BacktestBreakdown } from './breakdown';
import type { TestbedVariant } from '../config/testbed-variants';

export interface BacktestCandle {
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  timestamp: number;
}

export interface BacktestTrade {
  id: number;
  side: 'long' | 'short';
  timeframe: string;
  playbookKey: string | null;
  grade: string;
  entryTime: number;
  entryPrice: number;
  stopLoss: number;
  takeProfit: number;
  slDistancePct: number;
  rr: number;
  closeTime: number;
  closePrice: number;
  closeReason: 'stop_loss' | 'take_profit' | 'end_of_data';
  pnlUsd: number;
  pnlPct: number;
  barsHeld: number;
}

export interface BacktestBlockStats {
  signal_gate: number;
  regime: number;
  htf: number;
  no_direction: number;
  open_position: number;
  duplicate_signal: number;
  entry_5m_guard: number;
  grade_playbook: number;
  cooldown: number;
}

export interface BacktestRunOptions {
  symbol?: string;
  weeks?: number;
  startDate?: Date;
  endDate?: Date;
  /** Override MIN_SL_DISTANCE_PERCENT (e.g. 0.004 = 0.40%) */
  minSlPct?: number;
  minRr?: number;
  notionalUsd?: number;
  feePctPerSide?: number;
  warmupBars5m?: number;
  /** Named variant preset (see config/testbed-variants.ts). */
  variant?: string;
  /** Explicit days window (overrides weeks when set). ~30 for one month. */
  days?: number;
}

export interface BacktestRunResult {
  symbol: string;
  period: { start: string; end: string; weeks: number };
  config: {
    minSlPct: number;
    minRr: number;
    notionalUsd: number;
    feePctPerSide: number;
    timeframes: string[];
    entryTfPriority: string[];
  };
  summary: {
    steps: number;
    signalsPassed: number;
    entries: number;
    wins: number;
    losses: number;
    winRate: number;
    netPnlUsd: number;
    grossPnlUsd: number;
    feesUsd: number;
    avgSlPct: number;
    avgBarsHeld: number;
    maxConsecutiveLosses: number;
  };
  blocks: BacktestBlockStats;
  slBuckets: Array<{ bucket: string; n: number; wins: number; losses: number; netPnl: number }>;
  breakdown?: BacktestBreakdown;
  variant?: TestbedVariant;
  trades: BacktestTrade[];
  /** Last gate evaluation snapshot per TF at end of run (debug). */
  lastGateByTf?: Record<string, SignalGateOutput>;
}
