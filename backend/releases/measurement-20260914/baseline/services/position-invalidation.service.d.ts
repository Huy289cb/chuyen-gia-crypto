/**
 * Structure invalidation → market exit when score≥min (green or red).
 * No BE tighten — profit-protect owns price-based BE/trail.
 * docs/position-invalidation-plan.md
 */
import { type ProfitProtectPosition } from './profit-protect.service';
export type InvalidationPosition = ProfitProtectPosition & {
    account_id: number;
    account: {
        current_balance: number;
    };
    size_usd?: number;
    take_profit?: number;
    expected_rr?: number;
    risk_usd?: number;
    entry_fee?: number;
    binance_order_id?: string | null;
    binance_tp_order_id?: string | null;
    status?: string;
};
export declare function maybeApplyInvalidationProtect(position: InvalidationPosition, mark: number): Promise<{
    applied: boolean;
    exited?: boolean;
    reason: string;
    newSl?: number;
    score?: number;
}>;
/** Clear in-memory cooldown (tests). */
export declare function clearInvalidationCooldownState(): void;
//# sourceMappingURL=position-invalidation.service.d.ts.map