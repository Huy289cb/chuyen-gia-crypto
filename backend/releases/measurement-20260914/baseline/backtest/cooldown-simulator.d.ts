/** Walk-forward loss-streak cooldown (mirrors runtime tiered policy). */
export declare class BacktestCooldownState {
    private consecutiveLosses;
    private cooldownUntil;
    isBlocked(ts: number): boolean;
    onTradeClose(pnlUsd: number, closeTime: number): void;
}
//# sourceMappingURL=cooldown-simulator.d.ts.map