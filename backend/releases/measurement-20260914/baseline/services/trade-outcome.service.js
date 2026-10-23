"use strict";
/**
 * Persist trade_outcomes on every confirmed close for edge measurement.
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
exports.resolveDecisionIdForPosition = resolveDecisionIdForPosition;
exports.recordTradeOutcomeOnClose = recordTradeOutcomeOnClose;
const prisma_1 = require("../lib/prisma");
const memory_service_1 = require("./memory.service");
function outcomeLabel(pnl) {
    if (pnl > 0.01)
        return 'win';
    if (pnl < -0.01)
        return 'loss';
    return 'breakeven';
}
/**
 * Resolve trade_decision id for a closed position (no schema migration required).
 */
async function resolveDecisionIdForPosition(ctx) {
    if (ctx.decision_id != null && ctx.decision_id > 0) {
        return ctx.decision_id;
    }
    const position = await prisma_1.prisma.testnetPosition.findUnique({
        where: { position_id: ctx.position_id },
        select: { binance_order_id: true },
    });
    if (position?.binance_order_id) {
        const pending = await prisma_1.prisma.testnetPendingOrder.findFirst({
            where: { binance_order_id: position.binance_order_id },
            select: { order_id: true },
        });
        if (pending?.order_id) {
            const { PIPELINE_EVENT_POSITION_ID } = await Promise.resolve().then(() => __importStar(require('../repositories/testnet.repository')));
            const linkEvents = await prisma_1.prisma.testnetTradeEvent.findMany({
                where: {
                    position_id: PIPELINE_EVENT_POSITION_ID,
                    event_type: 'pending_order_linked',
                },
                orderBy: { timestamp: 'desc' },
            });
            for (const ev of linkEvents) {
                if (!ev.event_data)
                    continue;
                try {
                    const data = JSON.parse(ev.event_data);
                    if (data.order_id === pending.order_id && typeof data.decision_id === 'number') {
                        return data.decision_id;
                    }
                }
                catch {
                    /* ignore */
                }
            }
        }
    }
    const events = await prisma_1.prisma.testnetTradeEvent.findMany({
        where: { position_id: ctx.position_id },
        orderBy: { timestamp: 'asc' },
        take: 20,
    });
    for (const ev of events) {
        if (!ev.event_data)
            continue;
        try {
            const data = JSON.parse(ev.event_data);
            if (typeof data.decision_id === 'number' && data.decision_id > 0) {
                return data.decision_id;
            }
        }
        catch {
            /* ignore */
        }
    }
    if (ctx.strict_link)
        return null;
    const windowStart = new Date(ctx.entry_time.getTime() - 6 * 60 * 60 * 1000);
    const candidates = await prisma_1.prisma.tradeDecision.findMany({
        where: {
            symbol: ctx.symbol,
            decision: 'trade',
            method_id: 'kim_nghia',
            timestamp: { gte: windowStart, lte: ctx.entry_time },
            trade_outcome: null,
        },
        orderBy: { timestamp: 'desc' },
        take: 10,
    });
    for (const d of candidates) {
        if (d.entry_price == null)
            continue;
        const diff = Math.abs(d.entry_price - ctx.entry_price) / ctx.entry_price;
        if (diff <= 0.02)
            return d.id;
    }
    if (candidates.length > 0)
        return candidates[0].id;
    return null;
}
/**
 * Record trade_outcome + playbook stats after a confirmed close.
 */
async function recordTradeOutcomeOnClose(ctx, closePrice, realizedPnl, options) {
    const decisionId = await resolveDecisionIdForPosition(ctx);
    if (decisionId == null) {
        console.warn(`[TradeOutcome] No trade_decision linked for ${ctx.position_id} — outcome not stored`);
        return;
    }
    const existing = await prisma_1.prisma.tradeOutcome.findUnique({
        where: { decision_id: decisionId },
    });
    if (existing) {
        console.log(`[TradeOutcome] Outcome already exists for decision ${decisionId}`);
        return;
    }
    if (!(ctx.risk_usd > 0)) {
        console.warn(`[TradeOutcome] Missing initial risk for ${ctx.position_id}`);
        return;
    }
    const riskUsd = ctx.risk_usd;
    const realizedRr = realizedPnl / riskUsd;
    const fees = (ctx.entry_fee ?? 0) + (ctx.exit_fee ?? 0) + (ctx.funding_fee ?? 0);
    const durationMinutes = Math.max(0, Math.round(((ctx.close_time?.getTime() ?? Date.now()) - ctx.entry_time.getTime()) / 60000));
    const label = outcomeLabel(realizedPnl);
    try {
        const outcome = await memory_service_1.memoryService.storeOutcome({
            decision_id: decisionId,
            symbol: ctx.symbol,
            outcome: label,
            entry_price: ctx.entry_price,
            exit_price: closePrice,
            realized_pnl: realizedPnl,
            realized_rr: realizedRr,
            execution_cost: fees,
            duration_minutes: durationMinutes,
            close_reason: ctx.close_reason,
        });
        const skipReflection = options?.skipReflection === true ||
            (ctx.fill_verified === false &&
                (ctx.close_reason.startsWith('reconciliation') || ctx.close_reason === 'backfill_pnl'));
        if (!skipReflection) {
            await memory_service_1.memoryService.generateReflection(outcome.id, label, realizedPnl);
        }
        else {
            console.log(`[TradeOutcome] Skipped reflection for ${ctx.position_id} (${ctx.close_reason}, unverified fill)`);
        }
        console.log(`[TradeOutcome] Stored ${label} for ${ctx.symbol} decision=${decisionId} pnl=${realizedPnl.toFixed(2)} rr=${realizedRr.toFixed(2)}`);
    }
    catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`[TradeOutcome] Failed to store outcome for ${ctx.position_id}: ${msg}`);
    }
}
//# sourceMappingURL=trade-outcome.service.js.map