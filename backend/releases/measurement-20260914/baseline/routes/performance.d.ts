import { prisma } from '../lib/prisma';
import { type CircuitStatus } from '../services/account-circuit.service';
declare const router: import("express-serve-static-core").Router;
declare global {
    namespace Express {
        interface Request {
            prisma?: typeof prisma;
        }
    }
}
export declare function resolveAccount(prismaClient: typeof prisma, symbol: string, method?: string): Promise<{
    symbol: string;
    id: number;
    updated_at: Date;
    equity: number;
    unrealized_pnl: number;
    realized_pnl: number;
    method_id: string;
    starting_balance: number;
    current_balance: number;
    total_trades: number;
    winning_trades: number;
    losing_trades: number;
    max_drawdown: number;
    consecutive_losses: number;
    last_trade_time: Date | null;
    cooldown_until: Date | null;
    precision_error_count: number;
    precision_cooldown_until: Date | null;
    last_precision_error_time: Date | null;
    last_precision_error_code: string | null;
    last_precision_error_message: string | null;
    accumulated_trading_fees: number;
    accumulated_funding_fee: number;
    api_key_hash: string | null;
    created_at: Date;
} | null>;
type CircuitLoader = (accountId: number) => Promise<CircuitStatus>;
export declare function buildPerformanceMetrics(prismaClient: typeof prisma, account: any, loadCircuit?: CircuitLoader): Promise<{
    symbol: any;
    method_id: any;
    starting_balance: number;
    current_balance: number;
    current_equity: number;
    total_return_percent: number;
    total_trades: number;
    winning_trades: number;
    losing_trades: number;
    breakeven_trades: number;
    win_rate: number;
    win_rate_all_closed: number;
    gross_profit: number;
    gross_loss: number;
    avg_win: number;
    avg_loss: number;
    profit_factor: number | null;
    max_drawdown: number;
    current_drawdown: number;
    avg_r_multiple: number;
    realized_pnl: number;
    wallet_pnl: number;
    position_pnl: number;
    stored_fees: number;
    pnl_gap_vs_positions: number;
    pnl_source: string;
    full_history: {
        scope: "full_history";
        baseline_balance: number;
        current_balance: number;
        current_equity: number;
        wallet_pnl: number;
        wallet_return_percent: number;
        peak_equity: number;
        peak_equity_at: Date | null;
        current_drawdown_percent: number;
        max_drawdown_percent: number;
        max_drawdown_at: Date | null;
        first_snapshot_at: Date | null;
        last_snapshot_at: Date | null;
        snapshot_count: number;
    };
    strategy_epoch: {
        scope: "strategy_epoch";
        starts_at: Date | null;
        peak_equity: number;
        peak_equity_source: "override" | "override_ratcheted" | "strategy_epoch_snapshots" | "full_history_snapshots";
        drawdown_percent: number;
        expectancy_since: Date | null;
        expectancy: {
            n: number;
            sumR: number;
            avgR: number;
            profitFactor: number | null;
        };
        trading_allowed: boolean;
        circuit_reason: string;
    };
}>;
export default router;
//# sourceMappingURL=performance.d.ts.map