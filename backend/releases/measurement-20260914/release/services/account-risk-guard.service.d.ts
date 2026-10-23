/**
 * Account-level guards before opening new trades (cooldown, consecutive losses).
 */
export interface AccountTradeGuardResult {
    allowed: boolean;
    reason: string;
    remainingDailyRiskUsd?: number;
}
export declare function assertTestnetAccountCanOpenTrade(accountId: number, symbol?: string): Promise<AccountTradeGuardResult>;
/** After a verified losing close, set cooldown_until when Binance streak threshold reached. */
export declare function applyConsecutiveLossCooldownIfNeeded(accountId: number, symbol?: string): Promise<void>;
//# sourceMappingURL=account-risk-guard.service.d.ts.map