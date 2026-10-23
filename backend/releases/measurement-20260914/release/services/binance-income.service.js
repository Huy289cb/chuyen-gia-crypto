"use strict";
/**
 * Binance Futures income history (/fapi/v1/income) — source of truth for wallet PnL.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.fetchBinanceIncomeRows = fetchBinanceIncomeRows;
exports.fetchBinanceIncomeSummary = fetchBinanceIncomeSummary;
exports.deriveWalletBaseline = deriveWalletBaseline;
const client_1 = require("./binance/client");
const endpoints_1 = require("./binance/endpoints");
/** Stable bounds + page pagination preserve multiple incomes at the same millisecond. */
async function fetchBinanceIncomeRows(options = {}) {
    const rows = new Map();
    const endTime = options.endTime ?? Date.now();
    const startTime = options.startTime ?? endTime - 90 * 86400_000;
    const params = { startTime: String(startTime), endTime: String(endTime), limit: '1000' };
    if (options.symbol)
        params.symbol = `${options.symbol.toUpperCase().replace(/USDT$/, '')}USDT`;
    for (let page = 1; page <= 100; page++) {
        const batch = await (0, client_1.get)(endpoints_1.endpoints.INCOME, { ...params, page: String(page) }, true);
        const prior = rows.size;
        for (const row of batch) {
            if (row.time < startTime || row.time > endTime || (row.asset && row.asset !== 'USDT'))
                continue;
            if (!Number.isFinite(Number(row.income)))
                throw new Error('Invalid Binance income');
            const key = row.tranId != null ? `${row.incomeType}:${row.tranId}` : JSON.stringify(row);
            rows.set(key, row);
        }
        if (batch.length < 1000)
            return [...rows.values()].sort((a, b) => a.time - b.time);
        if (rows.size === prior)
            throw new Error('Income pagination made no progress');
    }
    throw new Error('Income pagination exhausted; refusing partial totals');
}
async function fetchBinanceIncomeSummary(options) {
    const rows = await fetchBinanceIncomeRows(options);
    const sum = (kind) => rows.filter(row => row.incomeType === kind).reduce((n, row) => n + Number(row.income), 0);
    const realizedPnl = sum('REALIZED_PNL');
    const commission = sum('COMMISSION');
    const fundingFee = sum('FUNDING_FEE');
    return { realizedPnl, commission, fundingFee, transferNet: sum('TRANSFER'),
        netTradingPnl: realizedPnl + commission + fundingFee, rowCount: rows.length };
}
/**
 * Derive funding baseline: wallet minus trading PnL/fees (excludes demo TRANSFER top-ups).
 */
function deriveWalletBaseline(walletBalance, income) {
    return walletBalance - income.netTradingPnl;
}
//# sourceMappingURL=binance-income.service.js.map