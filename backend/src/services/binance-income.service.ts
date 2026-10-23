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

export interface IncomeRow {
  incomeType: string;
  income: string;
  time: number;
  asset?: string;
  symbol?: string;
  tranId?: number | string;
}
export interface IncomeOptions { symbol?: string; startTime?: number; endTime?: number }

/** Stable bounds + page pagination preserve multiple incomes at the same millisecond. */
export async function fetchBinanceIncomeRows(options: IncomeOptions = {}): Promise<IncomeRow[]> {
  const rows = new Map<string, IncomeRow>();
  const endTime = options.endTime ?? Date.now();
  const startTime = options.startTime ?? endTime - 90 * 86400_000;
  const params: Record<string, string> = { startTime: String(startTime), endTime: String(endTime), limit: '1000' };
  if (options.symbol) params.symbol = `${options.symbol.toUpperCase().replace(/USDT$/, '')}USDT`;
  for (let page = 1; page <= 100; page++) {
    const batch = await get(endpoints.INCOME, { ...params, page: String(page) }, true) as IncomeRow[];
    const prior = rows.size;
    for (const row of batch) {
      if (row.time < startTime || row.time > endTime || (row.asset && row.asset !== 'USDT')) continue;
      if (!Number.isFinite(Number(row.income))) throw new Error('Invalid Binance income');
      const key = row.tranId != null ? `${row.incomeType}:${row.tranId}` : JSON.stringify(row);
      rows.set(key, row);
    }
    if (batch.length < 1000) return [...rows.values()].sort((a, b) => a.time - b.time);
    if (rows.size === prior) throw new Error('Income pagination made no progress');
  }
  throw new Error('Income pagination exhausted; refusing partial totals');
}

export async function fetchBinanceIncomeSummary(options?: IncomeOptions): Promise<BinanceIncomeSummary> {
  const rows = await fetchBinanceIncomeRows(options);
  const sum = (kind: string) => rows.filter(row => row.incomeType === kind).reduce((n, row) => n + Number(row.income), 0);
  const realizedPnl = sum('REALIZED_PNL');
  const commission = sum('COMMISSION');
  const fundingFee = sum('FUNDING_FEE');
  return { realizedPnl, commission, fundingFee, transferNet: sum('TRANSFER'),
    netTradingPnl: realizedPnl + commission + fundingFee, rowCount: rows.length };
}

/**
 * Derive funding baseline: wallet minus trading PnL/fees (excludes demo TRANSFER top-ups).
 */
export function deriveWalletBaseline(walletBalance: number, income: BinanceIncomeSummary): number {
  return walletBalance - income.netTradingPnl;
}
