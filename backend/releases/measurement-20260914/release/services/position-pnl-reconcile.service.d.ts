import { type ExchangeRound } from '../utils/exchange-rounds';
/** Idempotent, fill-backed NET accounting. Historical correction never emits trade alerts/reflections. */
import type { TestnetPosition } from '@prisma/client';
export interface PositionPnlReconcileResult {
    position_id: string;
    skipped: boolean;
    reason?: string;
    old_pnl?: number;
    new_pnl?: number;
    verified?: boolean;
}
export interface PositionPnlReconcileSummary {
    scanned: number;
    updated: number;
    verified: number;
    dry_run: boolean;
    results: PositionPnlReconcileResult[];
}
export declare function reconcileClosedPositionPnlFromFills(position: TestnetPosition, options?: {
    dryRun?: boolean;
    rounds?: ExchangeRound[];
}): Promise<PositionPnlReconcileResult>;
export declare function rebuildNetTradeStatistics(accountId: number): Promise<void>;
export declare function runClosedPositionPnlReconcile(options?: {
    symbol?: string;
    methodId?: string;
    dryRun?: boolean;
    recentOnly?: boolean;
}): Promise<PositionPnlReconcileSummary>;
//# sourceMappingURL=position-pnl-reconcile.service.d.ts.map