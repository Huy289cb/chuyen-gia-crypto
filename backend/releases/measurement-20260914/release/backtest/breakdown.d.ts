import type { BacktestTrade } from './types';
export interface BreakdownRow {
    key: string;
    n: number;
    wins: number;
    losses: number;
    netPnl: number;
    winRate: number;
}
export declare function buildBreakdown(trades: BacktestTrade[], dim: (t: BacktestTrade) => string): BreakdownRow[];
export declare function utcDayKey(ts: number): string;
export declare function utcWeekKey(ts: number): string;
export interface BacktestBreakdown {
    byTimeframe: BreakdownRow[];
    byPlaybook: BreakdownRow[];
    byGrade: BreakdownRow[];
    bySide: BreakdownRow[];
    byDay: BreakdownRow[];
    byWeek: BreakdownRow[];
}
export declare function buildAllBreakdowns(trades: BacktestTrade[]): BacktestBreakdown;
export declare function formatBreakdownSection(title: string, rows: BreakdownRow[]): string[];
//# sourceMappingURL=breakdown.d.ts.map