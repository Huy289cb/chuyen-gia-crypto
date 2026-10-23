/**
 * Apply profit-protect SL (breakeven / trail) on Binance + local DB.
 */
export declare function rememberInitialRisk(positionId: string, entry: number, stopLoss: number, side: string): number;
export declare function getRememberedInitialRisk(positionId: string): number | undefined;
export declare function clearProfitProtectState(positionId: string): void;
export interface ProfitProtectPosition {
    position_id: string;
    symbol: string;
    side: string;
    entry_price: number;
    stop_loss: number;
    size_qty: number;
    entry_time: Date;
    binance_sl_order_id?: string | null;
}
export declare function maybeApplyProfitProtectSl(position: ProfitProtectPosition, mark: number): Promise<{
    applied: boolean;
    reason: string;
    newSl?: number;
}>;
//# sourceMappingURL=profit-protect.service.d.ts.map