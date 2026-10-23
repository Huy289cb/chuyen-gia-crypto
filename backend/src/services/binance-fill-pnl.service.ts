import { selectCloseExchangeRound } from '../utils/close-round-match';
/** Resolve only complete exchange rounds tied to the actual entry order. */
import { fetchUserTradesByTimeWindows } from './binance-trade-history.service';
import { fetchBinanceIncomeRows } from './binance-income.service';
import { reconstructExchangeRounds, type ExchangeRound } from '../utils/exchange-rounds';
export type { ExchangeFill as UserTradeRow } from '../utils/exchange-rounds';
export interface FillPnlResolution {
  closePrice: number; realizedPnl: number; closeQty: number; tradeIds: number[];
  verified: boolean; source: 'user_trades' | 'mark_estimate';
  entryFee?: number; exitFee?: number; fundingFee?: number; round?: ExchangeRound;
}
export async function resolveClosePnlFromUserTrades(params: {
  symbol: string; side: string; entryTime: Date; closeTime?: Date;
  entryOrderId?: string | null; partialReduction?: boolean; sizeQty: number; entryPrice: number; fallbackClosePrice: number;
  /** Reuse one complete exchange snapshot for a reconciliation batch. */
  rounds?: ExchangeRound[];
  /** Optional failsoft observer; does not change resolution or issue extra queries. */
  onEvidence?: (evidence: unknown) => void;
}): Promise<FillPnlResolution> {
  const fallback: FillPnlResolution = { closePrice: params.fallbackClosePrice,
    realizedPnl: estimatePnl(params.side, params.entryPrice, params.fallbackClosePrice, params.sizeQty),
    closeQty: 0, tradeIds: [], verified: false, source: 'mark_estimate' };
  if (process.env.BINANCE_ENABLED !== 'true' || !params.entryOrderId) return fallback;
  const symbol = `${params.symbol.toUpperCase().replace(/USDT$/, '')}USDT`;
  const endTime = Math.min(Date.now(), (params.closeTime ?? new Date()).getTime() + 60_000);
  // Local materialization can lag the actual fill. Entry order identity anchors the round.
  const startTime = params.entryTime.getTime() - 24 * 3600_000;
  try {
    let rounds = params.rounds;
    let queriedFills: unknown[] | null = null;
    let queriedIncome: unknown[] | null = null;
    if (!rounds) {
      const fills = await fetchUserTradesByTimeWindows(symbol, endTime, endTime - startTime + 1);
      const income = await fetchBinanceIncomeRows({ symbol, startTime, endTime });
      rounds = reconstructExchangeRounds(fills, income);
      queriedFills = fills; queriedIncome = income;
    }
    if (params.onEvidence) {
      const whitelist = (rows: unknown[], fields: string[]) => rows.map(raw => {
        const row = raw as Record<string, unknown>;
        return Object.fromEntries(fields.map(field => { const value = row[field]; return [field,
          typeof value === 'string' || typeof value === 'number' && Number.isFinite(value) ? value : null]; }));
      });
      try { params.onEvidence({ schema: 'close-round-query-v1',
        input: { symbol, side: params.side.toLowerCase(), entry_order_id: String(params.entryOrderId), size_qty: params.sizeQty, partial_reduction: params.partialReduction === true,
          window_start: startTime, window_end: endTime },
        observations: { source: queriedFills ? 'binance_window_queries' : 'supplied_rounds',
          fills_complete: queriedFills !== null, income_complete: queriedIncome !== null, received_at: new Date().toISOString(),
          fills: queriedFills ? whitelist(queriedFills, ['tradeId','orderId','side','price','qty','commission','commissionAsset','realizedPnl','time']) : [],
          income: queriedIncome ? whitelist(queriedIncome, ['incomeType','income','time','asset','tranId']) : [] } });
      } catch { /* optional telemetry cannot change close resolution */ }
    }
    const round = selectCloseExchangeRound(rounds, params.side, params.entryOrderId, params.sizeQty, params.partialReduction === true);
    if (!round) return fallback;
    return { closePrice: round.closePrice, realizedPnl: round.netPnl, closeQty: round.quantity,
      tradeIds: [...new Set(round.fills.flatMap(f => f.tradeId != null ? [Number(f.tradeId)] : []))],
      verified: true, source: 'user_trades', entryFee: round.entryFee, exitFee: round.exitFee,
      fundingFee: round.fundingFee, round };
  } catch (error: unknown) {
    console.warn(`[BinanceFillPnl] Verification unavailable: ${error instanceof Error ? error.message : String(error)}`);
    return fallback;
  }
}

export function estimatePnl(side: string, entry: number, close: number, qty: number): number {
  const raw = (close - entry) * Math.abs(qty);
  const isLong = side.toLowerCase() === 'long' || side.toLowerCase() === 'buy';
  return isLong ? raw : -raw;
}
