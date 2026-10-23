/**
 * Throttle mark-price / unrealized PnL writes — trading correctness uses exchange state;
 * DB marks are for dashboard display and can lag briefly.
 */
export declare function shouldPersistPositionMark(positionId: string, markPrice: number, storedMark: number, unrealizedPnL: number, storedUnrealized: number, force?: boolean): boolean;
export declare function notePositionMarkPersisted(positionId: string): void;
//# sourceMappingURL=position-mark-persist.d.ts.map