/**
 * Align testnet_accounts with Binance wallet + income (fix starting_balance / realized gap).
 */

import { prisma } from '../lib/prisma';
import { buildWalletReconcileUpdate } from '../utils/wallet-reconcile-update';
import { randomUUID } from 'node:crypto';
import { PIPELINE_EVENT_POSITION_ID } from '../repositories/testnet.repository';
import {
  fetchBinanceBalanceSnapshot,
} from './binance-balance-sync.service';
import {
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

/**
 * Reconcile account stats from Binance wallet + income API.
 *
 * Preserve capital baseline. Closed position PnL is NET of signed costs.
 * Report wallet/income discrepancies; never silently redefine capital to hide them.
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

  const newStartingBalance = account.starting_balance;
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
    select: { realized_pnl: true, entry_fee: true, exit_fee: true, funding_fee: true },
  });
  const accountUpdate = buildWalletReconcileUpdate(newStartingBalance, snap, closedPositions, new Date());
  const positionRealizedSum = accountUpdate.realized_pnl;
  const recordedUpdate = JSON.parse(JSON.stringify({schema:'wallet-reconcile-update-v1',reconcile_attempt_id:randomUUID(),account_id:accountId,
    input:{starting_balance:newStartingBalance,snapshot:{walletBalance:snap.walletBalance,equity:snap.equity,unrealizedPnl:snap.unrealizedPnl},positions:closedPositions},
    update:accountUpdate,source:'normalized_wallet_and_local_closed_positions'}));

  await prisma.testnetAccount.update({
    where: { id: accountId },
    data: accountUpdate,
  });

  const appliedAt = new Date().toISOString();
  void import('../utils/account-wallet-journal').then(module => module.persistAccountWalletObservation(
    {...recordedUpdate,applied_at:appliedAt},'account_wallet_reconcile_applied'))
    .catch(() => console.warn('[WalletReconcile] Account reconciliation journal persistence failed'));

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
