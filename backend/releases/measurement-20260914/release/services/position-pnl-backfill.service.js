"use strict";
/**
 * Backfill close_price / realized_pnl / trade_outcomes for historical DB rows.
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
exports.calculatePositionPnl = calculatePositionPnl;
exports.resolveBackfillClosePrice = resolveBackfillClosePrice;
exports.backfillClosedPositionPnl = backfillClosedPositionPnl;
exports.recomputeTestnetAccountTradeStats = recomputeTestnetAccountTradeStats;
exports.runTestnetPnlBackfill = runTestnetPnlBackfill;
const prisma_1 = require("../lib/prisma");
const testnet_repository_1 = require("../repositories/testnet.repository");
const bookkeeping_close_1 = require("../utils/bookkeeping-close");
const trade_outcome_service_1 = require("./trade-outcome.service");
function calculatePositionPnl(side, entry, close, qty) {
    const raw = (close - entry) * Math.abs(qty);
    const isLong = side.toLowerCase() === 'long' || side.toLowerCase() === 'buy';
    return isLong ? raw : -raw;
}
function resolveBackfillClosePrice(position) {
    if (position.close_price != null && position.close_price > 0) {
        return position.close_price;
    }
    if (position.current_price > 0) {
        return position.current_price;
    }
    return position.entry_price;
}
function needsBackfill(position) {
    const pnlMissing = !Number.isFinite(position.realized_pnl);
    const priceMissing = position.close_price == null || position.close_price <= 0;
    return pnlMissing || priceMissing;
}
/**
 * Backfill one closed (or closing) position row without double-counting live closes.
 */
async function backfillClosedPositionPnl(position, options) {
    if (!needsBackfill(position)) {
        return {
            position_id: position.position_id,
            skipped: true,
            reason: 'already_has_pnl',
        };
    }
    const closePrice = resolveBackfillClosePrice(position);
    const qty = Math.abs(position.size_qty);
    const realizedPnl = calculatePositionPnl(position.side, position.entry_price, closePrice, qty);
    if (options?.dryRun) {
        return {
            position_id: position.position_id,
            skipped: false,
            close_price: closePrice,
            realized_pnl: realizedPnl,
            reason: 'dry_run',
        };
    }
    const closeReason = position.close_reason ?? 'backfill_pnl';
    const closeTime = position.close_time ?? new Date();
    if (position.status === 'open') {
        await (0, testnet_repository_1.closeTestnetPosition)(position.position_id, closePrice, closeReason);
    }
    await (0, testnet_repository_1.updateTestnetPosition)(position.position_id, {
        close_price: closePrice,
        close_time: closeTime,
        close_reason: closeReason,
        current_price: closePrice,
        realized_pnl: realizedPnl,
        unrealized_pnl: 0,
        status: 'closed',
    });
    const outcomeCtx = {
        position_id: position.position_id,
        symbol: position.symbol,
        side: position.side,
        entry_price: position.entry_price,
        entry_time: position.entry_time,
        stop_loss: position.stop_loss,
        take_profit: position.take_profit,
        expected_rr: position.expected_rr,
        risk_usd: position.risk_usd,
        entry_fee: position.entry_fee,
        exit_fee: position.exit_fee,
        funding_fee: position.funding_fee,
        close_reason: closeReason,
    };
    await (0, trade_outcome_service_1.recordTradeOutcomeOnClose)(outcomeCtx, closePrice, realizedPnl);
    return {
        position_id: position.position_id,
        skipped: false,
        close_price: closePrice,
        realized_pnl: realizedPnl,
        outcome_stored: true,
    };
}
/**
 * Recompute account trade counters from closed positions (after batch backfill).
 */
async function recomputeTestnetAccountTradeStats(accountId) {
    const closed = await prisma_1.prisma.testnetPosition.findMany({
        where: {
            account_id: accountId,
            status: 'closed',
            position_id: { not: testnet_repository_1.PIPELINE_EVENT_POSITION_ID },
            side: { notIn: ['NONE', 'none'] },
            size_qty: { gt: 0 },
        },
    });
    let wins = 0;
    let losses = 0;
    let totalRealized = 0;
    const counted = closed.filter((p) => !(0, bookkeeping_close_1.isInternalCloseReason)(p.close_reason));
    for (const p of counted) {
        const pnl = Number(p.realized_pnl) || 0;
        totalRealized += pnl;
        if (pnl > 0.01)
            wins += 1;
        else if (pnl < -0.01)
            losses += 1;
    }
    await prisma_1.prisma.testnetAccount.update({
        where: { id: accountId },
        data: {
            total_trades: counted.length,
            winning_trades: wins,
            losing_trades: losses,
            updated_at: new Date(),
        },
    });
    if (process.env.BINANCE_ENABLED === 'true') {
        const { reconcileTestnetWalletFromBinance } = await Promise.resolve().then(() => __importStar(require('./wallet-reconcile.service')));
        await reconcileTestnetWalletFromBinance(accountId);
    }
    else {
        await prisma_1.prisma.testnetAccount.update({
            where: { id: accountId },
            data: {
                realized_pnl: totalRealized,
                updated_at: new Date(),
            },
        });
    }
}
/**
 * Backfill all closed positions for an account that lack PnL/close_price.
 */
async function runTestnetPnlBackfill(options) {
    const symbol = options?.symbol ?? 'BTC';
    const methodId = options?.methodId ?? 'kim_nghia';
    const dryRun = options?.dryRun ?? false;
    const account = await prisma_1.prisma.testnetAccount.findFirst({
        where: { symbol, method_id: methodId },
    });
    if (!account) {
        throw new Error(`No testnet account for ${symbol}/${methodId}`);
    }
    const candidates = await prisma_1.prisma.testnetPosition.findMany({
        where: {
            account_id: account.id,
            status: 'closed',
            position_id: { not: testnet_repository_1.PIPELINE_EVENT_POSITION_ID },
            side: { notIn: ['NONE', 'none'] },
            size_qty: { gt: 0 },
        },
        orderBy: { close_time: 'asc' },
    });
    const summary = {
        scanned: candidates.length,
        updated: 0,
        outcomes: 0,
        skipped: 0,
        dry_run: dryRun,
        results: [],
    };
    for (const position of candidates) {
        if (!needsBackfill(position)) {
            summary.skipped += 1;
            summary.results.push({
                position_id: position.position_id,
                skipped: true,
                reason: 'already_has_pnl',
            });
            continue;
        }
        const result = await backfillClosedPositionPnl(position, { dryRun });
        summary.results.push(result);
        if (result.skipped) {
            summary.skipped += 1;
        }
        else {
            summary.updated += 1;
            if (result.outcome_stored)
                summary.outcomes += 1;
        }
    }
    if (!dryRun && summary.updated > 0) {
        await recomputeTestnetAccountTradeStats(account.id);
    }
    return summary;
}
//# sourceMappingURL=position-pnl-backfill.service.js.map