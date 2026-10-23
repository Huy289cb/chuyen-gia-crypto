"use strict";
/**
 * Sync testnet account balances from Binance Futures account API (source of truth).
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.fetchBinanceBalanceSnapshot = fetchBinanceBalanceSnapshot;
exports.syncTestnetAccountFromBinance = syncTestnetAccountFromBinance;
exports.syncTestnetAccountBySymbol = syncTestnetAccountBySymbol;
exports.resolveTestnetAccountBalances = resolveTestnetAccountBalances;
exports.syncAllTestnetAccountsFromBinance = syncAllTestnetAccountsFromBinance;
const prisma_1 = require("../lib/prisma");
const account_1 = require("./binance/account");
const binance_account_health_service_1 = require("./binance-account-health.service");
/**
 * Fetch wallet + equity from Binance /fapi/v2/account (not /balance sum, which double-counts assets).
 */
async function fetchBinanceBalanceSnapshot() {
    const account = await (0, account_1.getAccount)();
    const usdt = account.assets.find((a) => a.asset === 'USDT');
    const walletBalance = usdt?.walletBalance ?? account.totalWalletBalance;
    const unrealizedPnl = account.totalUnrealizedProfit;
    const equity = account.totalMarginBalance;
    return {
        walletBalance,
        unrealizedPnl,
        equity,
    };
}
/**
 * Write Binance wallet/equity into testnet_accounts for one account row.
 * On demo-fapi, balance/account often return -1109 — returns null and keeps local ledger.
 */
async function syncTestnetAccountFromBinance(accountId) {
    let snap;
    try {
        snap = await fetchBinanceBalanceSnapshot();
    }
    catch (error) {
        if ((0, binance_account_health_service_1.isBinanceDemoMetadataUnavailableError)(error)) {
            console.warn(`[BinanceBalanceSync] account=${accountId} demo metadata unavailable (-1109); using local ledger`);
            return null;
        }
        throw error;
    }
    await prisma_1.prisma.testnetAccount.update({
        where: { id: accountId },
        data: {
            current_balance: snap.walletBalance,
            equity: snap.equity,
            unrealized_pnl: snap.unrealizedPnl,
            updated_at: new Date(),
        },
    });
    console.log(`[BinanceBalanceSync] account=${accountId} wallet=${snap.walletBalance.toFixed(2)} equity=${snap.equity.toFixed(2)} uPnL=${snap.unrealizedPnl.toFixed(2)}`);
    return snap;
}
async function syncTestnetAccountBySymbol(symbol, methodId) {
    const account = await prisma_1.prisma.testnetAccount.findUnique({
        where: { symbol_method_id: { symbol: symbol.toUpperCase(), method_id: methodId } },
    });
    if (!account)
        return null;
    return syncTestnetAccountFromBinance(account.id);
}
/** Wallet/equity for Telegram trade notifications (syncs from Binance when enabled). */
async function resolveTestnetAccountBalances(accountId, syncFromBinance = true) {
    if (syncFromBinance && process.env.BINANCE_ENABLED === 'true') {
        try {
            const snap = await syncTestnetAccountFromBinance(accountId);
            if (snap) {
                return { account_balance: snap.walletBalance, account_equity: snap.equity };
            }
        }
        catch (error) {
            const msg = error instanceof Error ? error.message : String(error);
            console.warn(`[BinanceBalanceSync] resolveTestnetAccountBalances sync failed: ${msg}`);
        }
    }
    const row = await prisma_1.prisma.testnetAccount.findUnique({ where: { id: accountId } });
    const balance = Number(row?.current_balance ?? 0);
    const equity = Number(row?.equity ?? balance);
    return { account_balance: balance, account_equity: equity };
}
/** Sync all testnet accounts when Binance is enabled (worker periodic job). */
let lastWalletReconcileAt = 0;
function walletReconcileIntervalMs() {
    const raw = process.env.WALLET_RECONCILE_INTERVAL_MS?.trim();
    const parsed = raw ? parseInt(raw, 10) : 900_000;
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 900_000;
}
async function syncAllTestnetAccountsFromBinance() {
    if (process.env.BINANCE_ENABLED !== 'true')
        return;
    const accounts = await prisma_1.prisma.testnetAccount.findMany({ select: { id: true, symbol: true, method_id: true } });
    for (const account of accounts) {
        try {
            await syncTestnetAccountFromBinance(account.id);
            const { reconcileOpenEntryFees } = await Promise.resolve().then(() => __importStar(require('./open-entry-fee-reconcile.service')));
            await reconcileOpenEntryFees(account.id);
        }
        catch (error) {
            const msg = error instanceof Error ? error.message : String(error);
            console.warn(`[BinanceBalanceSync] Failed for ${account.symbol}/${account.method_id}: ${msg}`);
        }
    }
    const now = Date.now();
    if (now - lastWalletReconcileAt >= walletReconcileIntervalMs()) {
        lastWalletReconcileAt = now;
        try {
            const { reconcileTestnetWalletFromBinance } = await Promise.resolve().then(() => __importStar(require('./wallet-reconcile.service')));
            const { runClosedPositionPnlReconcile } = await Promise.resolve().then(() => __importStar(require('./position-pnl-reconcile.service')));
            for (const account of accounts) {
                await runClosedPositionPnlReconcile({ symbol: account.symbol, methodId: account.method_id, dryRun: false, recentOnly: true });
                await reconcileTestnetWalletFromBinance(account.id);
            }
        }
        catch (error) {
            const msg = error instanceof Error ? error.message : String(error);
            console.warn(`[BinanceBalanceSync] Wallet reconcile skipped: ${msg}`);
        }
    }
}
//# sourceMappingURL=binance-balance-sync.service.js.map