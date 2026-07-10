/**
 * Align testnet_accounts with Binance wallet + income (fix starting_balance / realized gap).
 */

import { prisma } from '../lib/prisma';
import { PIPELINE_EVENT_POSITION_ID } from '../repositories/testnet.repository';
import {
  fetchBinanceBalanceSnapshot,
} from './binance-balance-sync.service';
import {
  deriveWalletBaseline,
  fetchBinanceIncomeSummary,
  type BinanceIncomeSummary,
} from './binance-income.service';
import { isBinanceDemoMetadataUnavailableError } from './binance-account-health.service';

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

function sumClosedPositionPnl(
  rows: Array<{ realized_pnl: number | null }>
): number {
  return rows.reduce((sum, row) => sum + (Number(row.realized_pnl) || 0), 0);
}

/**
 * Reconcile account stats from Binance wallet + income API.
 *
 * starting_balance := wallet - (realized + commission + funding)
 * so wallet - starting_balance ≈ net trading PnL on Binance.
 */
export async function reconcileTestnetWalletFromBinance(
  accountId: number
): Promise<WalletReconcileResult> {
  const account = await prisma.testnetAccount.findUnique({ where: { id: accountId } });
  if (!account) {
    throw new Error(`Testnet account ${accountId} not found`);
  }

  let snap;
  try {
    snap = await fetchBinanceBalanceSnapshot();
  } catch (error: unknown) {
    if (isBinanceDemoMetadataUnavailableError(error)) {
      throw new Error(
        'Wallet reconcile skipped: Binance balance/account unavailable (-1109 on demo)'
      );
    }
    throw error;
  }
  const income = await fetchBinanceIncomeSummary();

  const newStartingBalance = deriveWalletBaseline(snap.walletBalance, income);
  const previousStartingBalance = account.starting_balance;
  const previousRealizedPnl = account.realized_pnl;

  const closedPositions = await prisma.testnetPosition.findMany({
    where: {
      account_id: accountId,
      status: 'closed',
      position_id: { not: PIPELINE_EVENT_POSITION_ID },
      side: { notIn: ['NONE', 'none'] },
      size_qty: { gt: 0 },
    },
    select: { realized_pnl: true },
  });
  const positionRealizedSum = sumClosedPositionPnl(closedPositions);

  await prisma.testnetAccount.update({
    where: { id: accountId },
    data: {
      starting_balance: newStartingBalance,
      current_balance: snap.walletBalance,
      equity: snap.equity,
      unrealized_pnl: snap.unrealizedPnl,
      realized_pnl: income.realizedPnl,
      accumulated_trading_fees: Math.abs(income.commission),
      accumulated_funding_fee: Math.abs(income.fundingFee),
      updated_at: new Date(),
    },
  });

  const walletDelta = snap.walletBalance - newStartingBalance;
  const gapAfterFix = walletDelta - income.netTradingPnl;

  console.log(
    `[WalletReconcile] account=${accountId} wallet=${snap.walletBalance.toFixed(2)} ` +
      `baseline=${newStartingBalance.toFixed(2)} binanceRealized=${income.realizedPnl.toFixed(2)} ` +
      `posSum=${positionRealizedSum.toFixed(2)} transferNet=${income.transferNet.toFixed(2)}`
  );

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

export async function reconcileTestnetWalletBySymbol(
  symbol: string,
  methodId: string
): Promise<WalletReconcileResult | null> {
  const account = await prisma.testnetAccount.findUnique({
    where: { symbol_method_id: { symbol: symbol.toUpperCase(), method_id: methodId } },
  });
  if (!account) return null;
  return reconcileTestnetWalletFromBinance(account.id);
}

/** Remove pipeline anchor from trade_outcomes (not a real trade). */
export async function removePipelineAnchorOutcome(): Promise<number> {
  const bad = await prisma.tradeOutcome.findFirst({
    where: {
      OR: [
        { close_reason: 'pipeline_event_anchor' },
        { close_reason: 'backfill_pnl', realized_pnl: 0 },
      ],
      decision_id: 1,
    },
  });
  if (!bad) return 0;
  await prisma.tradeReflection.deleteMany({ where: { outcome_id: bad.id } });
  await prisma.tradeOutcome.delete({ where: { id: bad.id } });
  return bad.id;
}

export type { BinanceIncomeSummary };
