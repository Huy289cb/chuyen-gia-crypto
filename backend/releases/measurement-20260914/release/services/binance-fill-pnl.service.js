"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.resolveClosePnlFromUserTrades = resolveClosePnlFromUserTrades;
exports.estimatePnl = estimatePnl;
/** Resolve only complete exchange rounds tied to the actual entry order. */
const binance_trade_history_service_1 = require("./binance-trade-history.service");
const binance_income_service_1 = require("./binance-income.service");
const exchange_rounds_1 = require("../utils/exchange-rounds");
async function resolveClosePnlFromUserTrades(params) {
    const fallback = { closePrice: params.fallbackClosePrice,
        realizedPnl: estimatePnl(params.side, params.entryPrice, params.fallbackClosePrice, params.sizeQty),
        closeQty: 0, tradeIds: [], verified: false, source: 'mark_estimate' };
    if (process.env.BINANCE_ENABLED !== 'true' || !params.entryOrderId)
        return fallback;
    const symbol = `${params.symbol.toUpperCase().replace(/USDT$/, '')}USDT`;
    const endTime = Math.min(Date.now(), (params.closeTime ?? new Date()).getTime() + 60_000);
    // Local materialization can lag the actual fill. Entry order identity anchors the round.
    const startTime = params.entryTime.getTime() - 24 * 3600_000;
    try {
        let rounds = params.rounds;
        if (!rounds) {
            const fills = await (0, binance_trade_history_service_1.fetchUserTradesByTimeWindows)(symbol, endTime, endTime - startTime + 1);
            const income = await (0, binance_income_service_1.fetchBinanceIncomeRows)({ symbol, startTime, endTime });
            rounds = (0, exchange_rounds_1.reconstructExchangeRounds)(fills, income);
        }
        const side = ['long', 'buy'].includes(params.side.toLowerCase()) ? 'long' : 'short';
        const matches = rounds.filter(r => r.side === side &&
            r.fills.some(f => String(f.orderId) === String(params.entryOrderId) &&
                f.side.toUpperCase() === (side === 'long' ? 'BUY' : 'SELL')));
        if (matches.length !== 1)
            return fallback;
        const round = matches[0];
        if (Math.abs(round.quantity - Math.abs(params.sizeQty)) > Math.max(1e-8, Math.abs(params.sizeQty) * 1e-6))
            return fallback;
        return { closePrice: round.closePrice, realizedPnl: round.netPnl, closeQty: round.quantity,
            tradeIds: [...new Set(round.fills.flatMap(f => f.tradeId != null ? [Number(f.tradeId)] : []))],
            verified: true, source: 'user_trades', entryFee: round.entryFee, exitFee: round.exitFee,
            fundingFee: round.fundingFee, round };
    }
    catch (error) {
        console.warn(`[BinanceFillPnl] Verification unavailable: ${error instanceof Error ? error.message : String(error)}`);
        return fallback;
    }
}
function estimatePnl(side, entry, close, qty) {
    const raw = (close - entry) * Math.abs(qty);
    const isLong = side.toLowerCase() === 'long' || side.toLowerCase() === 'buy';
    return isLong ? raw : -raw;
}
//# sourceMappingURL=binance-fill-pnl.service.js.map