"use strict";
/**
 * Align testnet_accounts with Binance wallet + income (fix starting_balance / realized gap).
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.reconcileTestnetWalletFromBinance = reconcileTestnetWalletFromBinance;
exports.reconcileTestnetWalletBySymbol = reconcileTestnetWalletBySymbol;
exports.removePipelineAnchorOutcome = removePipelineAnchorOutcome;
const prisma_1 = require("../lib/prisma");
const testnet_repository_1 = require("../repositories/testnet.repository");
const binance_balance_sync_service_1 = require("./binance-balance-sync.service");
const binance_income_service_1 = require("./binance-income.service");
const binance_account_health_service_1 = require("./binance-account-health.service");
function sumClosedPositionPnl(rows) {
    return rows.reduce((sum, row) => sum + (Number(row.realized_pnl) || 0), 0);
}
/**
 * Reconcile account stats from Binance wallet + income API.
 *
 * Preserve capital baseline. Closed position PnL is NET of signed costs.
 * Report wallet/income discrepancies; never silently redefine capital to hide them.
 */
async function reconcileTestnetWalletFromBinance(accountId) {
    const account = await prisma_1.prisma.testnetAccount.findUnique({ where: { id: accountId } });
    if (!account) {
        throw new Error(`Testnet account ${accountId} not found`);
    }
    let snap;
    try {
        snap = await (0, binance_balance_sync_service_1.fetchBinanceBalanceSnapshot)();
    }
    catch (error) {
        if ((0, binance_account_health_service_1.isBinanceDemoMetadataUnavailableError)(error)) {
            throw new Error('Wallet reconcile skipped: Binance balance/account unavailable (-1109 on demo)');
        }
        throw error;
    }
    const income = await (0, binance_income_service_1.fetchBinanceIncomeSummary)();
    const newStartingBalance = account.starting_balance;
    const previousStartingBalance = account.starting_balance;
    const previousRealizedPnl = account.realized_pnl;
    const closedPositions = await prisma_1.prisma.testnetPosition.findMany({
        where: {
            account_id: accountId,
            status: 'closed',
            position_id: { not: testnet_repository_1.PIPELINE_EVENT_POSITION_ID },
            side: { notIn: ['NONE', 'none'] },
            size_qty: { gt: 0 },
        },
        select: { realized_pnl: true, entry_fee: true, exit_fee: true, funding_fee: true },
    });
    const positionRealizedSum = sumClosedPositionPnl(closedPositions);
    await prisma_1.prisma.testnetAccount.update({
        where: { id: accountId },
        data: {
            starting_balance: newStartingBalance,
            current_balance: snap.walletBalance,
            equity: snap.equity,
            unrealized_pnl: snap.unrealizedPnl,
            realized_pnl: positionRealizedSum,
            accumulated_trading_fees: closedPositions.reduce((sum, p) => sum + p.entry_fee + p.exit_fee, 0),
            accumulated_funding_fee: closedPositions.reduce((sum, p) => sum + p.funding_fee, 0),
            updated_at: new Date(),
        },
    });
    const walletDelta = snap.walletBalance - newStartingBalance;
    const gapAfterFix = walletDelta - income.netTradingPnl;
    console.log(`[WalletReconcile] account=${accountId} wallet=${snap.walletBalance.toFixed(2)} ` +
        `baseline=${newStartingBalance.toFixed(2)} binanceRealized=${income.realizedPnl.toFixed(2)} ` +
        `posSum=${positionRealizedSum.toFixed(2)} transferNet=${income.transferNet.toFixed(2)}`);
    return {
        accountId,
        walletBalance: snap.walletBalance,
        previousStartingBalance,
        newStartingBalance,
        previousRealizedPnl,
        binanceRealizedPnl: income.realizedPnl,
        netTradingPnl: income.netTradingPnl,
        transferNet: income.transferNet,
        commission: income.commission,
        fundingFee: income.fundingFee,
        positionRealizedSum,
        walletDelta,
        gapAfterFix,
        incomeRows: income.rowCount,
    };
}
async function reconcileTestnetWalletBySymbol(symbol, methodId) {
    const account = await prisma_1.prisma.testnetAccount.findUnique({
        where: { symbol_method_id: { symbol: symbol.toUpperCase(), method_id: methodId } },
    });
    if (!account)
        return null;
    return reconcileTestnetWalletFromBinance(account.id);
}
/** Remove pipeline anchor from trade_outcomes (not a real trade). */
async function removePipelineAnchorOutcome() {
    const bad = await prisma_1.prisma.tradeOutcome.findFirst({
        where: {
            OR: [
                { close_reason: 'pipeline_event_anchor' },
                { close_reason: 'backfill_pnl', realized_pnl: 0 },
            ],
            decision_id: 1,
        },
    });
    if (!bad)
        return 0;
    await prisma_1.prisma.tradeReflection.deleteMany({ where: { outcome_id: bad.id } });
    await prisma_1.prisma.tradeOutcome.delete({ where: { id: bad.id } });
    return bad.id;
}
//# sourceMappingURL=wallet-reconcile.service.js.map