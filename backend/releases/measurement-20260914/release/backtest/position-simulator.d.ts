import type { BacktestCandle, BacktestTrade } from './types';
import type { TradeSide } from './signal-direction';
export interface OpenSimPosition {
    id: number;
    side: TradeSide;
    timeframe: string;
    playbookKey: string | null;
    grade: string;
    entryTime: number;
    entryPrice: number;
    stopLoss: number;
    takeProfit: number;
    slDistancePct: number;
    rr: number;
    notionalUsd: number;
    feePctPerSide: number;
    slippagePct?: number;
    entryBarIndex: number;
}
export declare function checkBarForExit(pos: OpenSimPosition, bar: BacktestCandle): {
    closePrice: number;
    closeReason: 'stop_loss' | 'take_profit';
} | null;
export declare function closePositionAt(pos: OpenSimPosition, closeTime: number, closePrice: number, closeReason: BacktestTrade['closeReason'], barsHeld: number): Omit<BacktestTrade, 'id'>;
/** Scan forward from fromBarIndex for SL/TP (end-of-run flush). */
export declare function simulatePositionExit(pos: OpenSimPosition, bars: BacktestCandle[], fromBarIndex: number): Omit<BacktestTrade, 'id'> | null;
//# sourceMappingURL=position-simulator.d.ts.map