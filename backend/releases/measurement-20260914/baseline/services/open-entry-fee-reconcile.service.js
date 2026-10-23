"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.reconcileOpenEntryFees = reconcileOpenEntryFees;
const prisma_1 = require("../lib/prisma");
const binance_trade_history_service_1 = require("./binance-trade-history.service");
/** Reconcile metadata only. Binance wallet sync already accounts for the cash debit. */
async function reconcileOpenEntryFees(accountId) {
    if (process.env.BINANCE_ENABLED !== 'true')
        return 0;
    const positions = await prisma_1.prisma.testnetPosition.findMany({
        where: { account_id: accountId, status: 'open', size_qty: { gt: 0 },
            partial_closed: 0, binance_order_id: { not: null } },
        select: { position_id: true, symbol: true, side: true, size_qty: true,
            entry_time: true, binance_order_id: true, entry_fee: true },
    });
    let updated = 0;
    for (const p of positions) {
        try {
            const now = Date.now();
            const fills = await (0, binance_trade_history_service_1.fetchUserTradesByTimeWindows)(`${p.symbol.replace(/USDT$/i, '')}USDT`, now, now - p.entry_time.getTime() + 24 * 3600_000);
            const matched = fills.filter(f => String(f.orderId) === p.binance_order_id);
            const expectedSide = p.side === 'long' ? 'BUY' : p.side === 'short' ? 'SELL' : null;
            if (!expectedSide || !matched.length || matched.some(f => f.side.toUpperCase() !== expectedSide ||
                f.commissionAsset !== 'USDT' || !Number.isFinite(f.commission) || !(f.qty > 0))) {
                console.warn(`[OpenEntryFee] ${p.position_id}: incomplete or unsupported fill evidence`);
                continue;
            }
            const quantity = matched.reduce((sum, f) => sum + f.qty, 0);
            if (Math.abs(quantity - p.size_qty) > Math.max(1e-8, p.size_qty * 1e-6)) {
                console.warn(`[OpenEntryFee] ${p.position_id}: fill quantity mismatch`);
                continue;
            }
            const entryFee = matched.reduce((sum, f) => sum + f.commission, 0);
            if (Math.abs(entryFee - p.entry_fee) < 1e-10)
                continue;
            // A concurrent close owns the complete net ledger; never overwrite its result.
            const result = await prisma_1.prisma.testnetPosition.updateMany({
                where: { position_id: p.position_id, status: 'open', size_qty: p.size_qty,
                    partial_closed: 0, binance_order_id: p.binance_order_id, entry_fee: p.entry_fee },
                data: { entry_fee: entryFee },
            });
            updated += result.count;
            if (result.count)
                console.log(`[OpenEntryFee] ${p.position_id}: verified entry fee ${entryFee} USDT`);
        }
        catch (error) {
            console.warn(`[OpenEntryFee] ${p.position_id}: ${error instanceof Error ? error.message : String(error)}`);
        }
    }
    return updated;
}
//# sourceMappingURL=open-entry-fee-reconcile.service.js.map