/**
 * Binance Futures income history (/fapi/v1/income) — source of truth for wallet PnL.
 */

import { get } from './binance/client';
import { endpoints } from './binance/endpoints';

export interface BinanceIncomeSummary {
  realizedPnl: number;
  commission: number;
  fundingFee: number;
  transferNet: number;
  /** REALIZED_PNL + COMMISSION + FUNDING_FEE (excludes TRANSFER). */
  netTradingPnl: number;
  rowCount: number;
}

interface IncomeRow {
  incomeType: string;
  income: string;
  time: number;
}

/**
 * Paginate income history and aggregate by type.
 */
export async function fetchBinanceIncomeSummary(options?: {
  symbol?: string;
  startTime?: number;
}): Promise<BinanceIncomeSummary> {
  const byType: Record<string, number> = {};
  let rowCount = 0;
  let cursor = options?.startTime ?? 0;

  for (let page = 0; page < 50; page++) {
    const params: Record<string, string> = {
      startTime: String(cursor),
      limit: '1000',
    };
    if (options?.symbol) {
      params.symbol = `${options.symbol.toUpperCase()}USDT`.replace(/USDTUSDT$/, 'USDT');
    }

    const batch = (await get(endpoints.INCOME, params, true)) as IncomeRow[];
    if (!batch.length) break;

    for (const row of batch) {
      const amount = parseFloat(row.income) || 0;
      byType[row.incomeType] = (byType[row.incomeType] ?? 0) + amount;
      rowCount += 1;
    }

    cursor = batch[batch.length - 1]!.time + 1;
    if (batch.length < 1000) break;
  }

  const realizedPnl = byType.REALIZED_PNL ?? 0;
  const commission = byType.COMMISSION ?? 0;
  const fundingFee = byType.FUNDING_FEE ?? 0;
  const transferNet = byType.TRANSFER ?? 0;
  const netTradingPnl = realizedPnl + commission + fundingFee;

  return {
    realizedPnl,
    commission,
    fundingFee,
    transferNet,
    netTradingPnl,
    rowCount,
  };
}

/**
 * Derive funding baseline: wallet minus trading PnL/fees (excludes demo TRANSFER top-ups).
 */
export function deriveWalletBaseline(walletBalance: number, income: BinanceIncomeSummary): number {
  return walletBalance - income.netTradingPnl;
}
