/**
 * Sync testnet account balances from Binance Futures account API (source of truth).
 */

import { prisma } from '../lib/prisma';
import { getAccount } from './binance/account';
import { isBinanceDemoMetadataUnavailableError } from './binance-account-health.service';

export interface BinanceBalanceSnapshot {
  walletBalance: number;
  unrealizedPnl: number;
  equity: number;
  availableBalance?: number;
}

/**
 * Fetch wallet + equity from Binance /fapi/v2/account (not /balance sum, which double-counts assets).
 */
export async function fetchBinanceBalanceSnapshot(): Promise<BinanceBalanceSnapshot> {
  const account = await getAccount();
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
export async function syncTestnetAccountFromBinance(
  accountId: number
): Promise<BinanceBalanceSnapshot | null> {
  let snap: BinanceBalanceSnapshot;
  try {
    snap = await fetchBinanceBalanceSnapshot();
  } catch (error: unknown) {
    if (isBinanceDemoMetadataUnavailableError(error)) {
      console.warn(
        `[BinanceBalanceSync] account=${accountId} demo metadata unavailable (-1109); using local ledger`
      );
      return null;
    }
    throw error;
  }

  await prisma.testnetAccount.update({
    where: { id: accountId },
    data: {
      current_balance: snap.walletBalance,
      equity: snap.equity,
      unrealized_pnl: snap.unrealizedPnl,
      updated_at: new Date(),
    },
  });

  console.log(
    `[BinanceBalanceSync] account=${accountId} wallet=${snap.walletBalance.toFixed(2)} equity=${snap.equity.toFixed(2)} uPnL=${snap.unrealizedPnl.toFixed(2)}`
  );

  return snap;
}

export async function syncTestnetAccountBySymbol(
  symbol: string,
  methodId: string
): Promise<BinanceBalanceSnapshot | null> {
  const account = await prisma.testnetAccount.findUnique({
    where: { symbol_method_id: { symbol: symbol.toUpperCase(), method_id: methodId } },
  });
  if (!account) return null;
  return syncTestnetAccountFromBinance(account.id);
}

/** Wallet/equity for Telegram trade notifications (syncs from Binance when enabled). */
export async function resolveTestnetAccountBalances(
  accountId: number,
  syncFromBinance = true
): Promise<{ account_balance: number; account_equity: number }> {
  if (syncFromBinance && process.env.BINANCE_ENABLED === 'true') {
    try {
      const snap = await syncTestnetAccountFromBinance(accountId);
      if (snap) {
        return { account_balance: snap.walletBalance, account_equity: snap.equity };
      }
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      console.warn(`[BinanceBalanceSync] resolveTestnetAccountBalances sync failed: ${msg}`);
    }
  }

  const row = await prisma.testnetAccount.findUnique({ where: { id: accountId } });
  const balance = Number(row?.current_balance ?? 0);
  const equity = Number(row?.equity ?? balance);
  return { account_balance: balance, account_equity: equity };
}

/** Sync all testnet accounts when Binance is enabled (worker periodic job). */
let lastWalletReconcileAt = 0;

function walletReconcileIntervalMs(): number {
  const raw = process.env.WALLET_RECONCILE_INTERVAL_MS?.trim();
  const parsed = raw ? parseInt(raw, 10) : 900_000;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 900_000;
}

export async function syncAllTestnetAccountsFromBinance(): Promise<void> {
  if (process.env.BINANCE_ENABLED !== 'true') return;

  const accounts = await prisma.testnetAccount.findMany({ select: { id: true, symbol: true, method_id: true } });
  for (const account of accounts) {
    try {
      await syncTestnetAccountFromBinance(account.id);
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      console.warn(
        `[BinanceBalanceSync] Failed for ${account.symbol}/${account.method_id}: ${msg}`
      );
    }
  }

  const now = Date.now();
  if (now - lastWalletReconcileAt >= walletReconcileIntervalMs()) {
    lastWalletReconcileAt = now;
    try {
      const { reconcileTestnetWalletFromBinance } = await import('./wallet-reconcile.service');
      for (const account of accounts) {
        await reconcileTestnetWalletFromBinance(account.id);
      }
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      console.warn(`[BinanceBalanceSync] Wallet reconcile skipped: ${msg}`);
    }
  }
}
