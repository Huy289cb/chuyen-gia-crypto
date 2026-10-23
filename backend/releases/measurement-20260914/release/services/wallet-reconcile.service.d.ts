/**
 * Align testnet_accounts with Binance wallet + income (fix starting_balance / realized gap).
 */
import { type BinanceIncomeSummary } from './binance-income.service';
export interface WalletReconcileResult {
    accountId: number;
    walletBalance: number;
    previousStartingBalance: number;
    newStartingBalance: number;
    previousRealizedPnl: number;
    binanceRealizedPnl: number;
    netTradingPnl: number;
    transferNet: number;
    commission: number;
    fundingFee: number;
    positionRealizedSum: number;
    walletDelta: number;
    gapAfterFix: number;
    incomeRows: number;
}
/**
 * Reconcile account stats from Binance wallet + income API.
 *
 * Preserve capital baseline. Closed position PnL is NET of signed costs.
 * Report wallet/income discrepancies; never silently redefine capital to hide them.
 */
export declare function reconcileTestnetWalletFromBinance(accountId: number): Promise<WalletReconcileResult>;
export declare function reconcileTestnetWalletBySymbol(symbol: string, methodId: string): Promise<WalletReconcileResult | null>;
/** Remove pipeline anchor from trade_outcomes (not a real trade). */
export declare function removePipelineAnchorOutcome(): Promise<number>;
export type { BinanceIncomeSummary };
//# sourceMappingURL=wallet-reconcile.service.d.ts.map