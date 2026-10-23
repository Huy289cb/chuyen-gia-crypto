"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.reconcileClosedPositionPnlFromFills = reconcileClosedPositionPnlFromFills;
exports.rebuildNetTradeStatistics = rebuildNetTradeStatistics;
exports.runClosedPositionPnlReconcile = runClosedPositionPnlReconcile;
const binance_trade_history_service_1 = require("./binance-trade-history.service");
const binance_income_service_1 = require("./binance-income.service");
const exchange_rounds_1 = require("../utils/exchange-rounds");
const prisma_1 = require("../lib/prisma");
const testnet_repository_1 = require("../repositories/testnet.repository");
const binance_fill_pnl_service_1 = require("./binance-fill-pnl.service");
const trade_outcome_service_1 = require("./trade-outcome.service");
const wallet_reconcile_service_1 = require("./wallet-reconcile.service");
const close_reason_resolve_service_1 = require("./close-reason-resolve.service");
async function reconcileClosedPositionPnlFromFills(position, options = {}) {
    const result = { position_id: position.position_id, skipped: true, old_pnl: position.realized_pnl };
    const fill = await (0, binance_fill_pnl_service_1.resolveClosePnlFromUserTrades)({
        symbol: position.symbol, side: position.side, entryTime: position.entry_time, rounds: options.rounds,
        closeTime: position.close_time ?? new Date(), entryOrderId: position.binance_order_id,
        sizeQty: position.size_qty, entryPrice: position.entry_price,
        fallbackClosePrice: position.close_price || position.current_price || position.entry_price,
    });
    if (!fill.verified || !fill.round)
        return { ...result, reason: 'incomplete_or_unmatched_exchange_round' };
    const round = fill.round;
    const decisionId = await (0, trade_outcome_service_1.resolveDecisionIdForPosition)({ ...position,
        close_reason: position.close_reason ?? 'reconciliation_fill', close_time: position.close_time ?? undefined, strict_link: true });
    if (decisionId == null || !(position.risk_usd > 0))
        return { ...result, reason: 'missing_durable_decision_link_or_initial_risk' };
    const closeReason = (0, close_reason_resolve_service_1.resolveVerifiedCloseReason)(position.close_reason ?? 'reconciliation_fill', { fill_verified: true }, position);
    const data = { entry_price: round.entryPrice, close_price: round.closePrice,
        entry_time: new Date(round.entryTime), close_time: new Date(round.closeTime),
        current_price: round.closePrice, realized_pnl: round.netPnl, unrealized_pnl: 0,
        entry_fee: round.entryFee, exit_fee: round.exitFee, funding_fee: round.fundingFee, close_reason: closeReason };
    const evidence = JSON.stringify({ version: 2, decision_id: decisionId, initial_risk_usd: position.risk_usd, ...round });
    const existing = await prisma_1.prisma.testnetTradeEvent.findFirst({ where: { position_id: position.position_id, event_type: 'pnl_ledger_v2' } });
    if (existing?.event_data === evidence && Math.abs(position.realized_pnl - round.netPnl) < 1e-9) {
        return { ...result, verified: true, new_pnl: round.netPnl, reason: 'already_reconciled' };
    }
    if (options.dryRun !== false)
        return { ...result, skipped: false, verified: true, new_pnl: round.netPnl, reason: 'dry_run' };
    const outcome = {
        symbol: position.symbol, outcome: round.netPnl > 0.01 ? 'win' : round.netPnl < -0.01 ? 'loss' : 'breakeven',
        entry_price: round.entryPrice, exit_price: round.closePrice, realized_pnl: round.netPnl,
        realized_rr: round.netPnl / position.risk_usd,
        execution_cost: round.entryFee + round.exitFee + round.fundingFee,
        duration_minutes: Math.max(0, Math.round((round.closeTime - round.entryTime) / 60000)),
        close_reason: closeReason, timestamp: new Date(round.closeTime),
    };
    await prisma_1.prisma.$transaction(async (tx) => {
        await tx.testnetPosition.update({ where: { position_id: position.position_id }, data });
        await tx.tradeOutcome.upsert({ where: { decision_id: decisionId }, create: { decision_id: decisionId, ...outcome }, update: outcome });
        if (existing)
            await tx.testnetTradeEvent.update({ where: { id: existing.id }, data: { event_data: evidence } });
        else
            await tx.testnetTradeEvent.create({ data: { position_id: position.position_id, event_type: 'pnl_ledger_v2', event_data: evidence } });
    });
    return { ...result, skipped: false, new_pnl: round.netPnl, verified: true };
}
async function rebuildNetTradeStatistics(accountId) {
    const positions = await prisma_1.prisma.testnetPosition.findMany({ where: { account_id: accountId, status: 'closed',
            position_id: { not: testnet_repository_1.PIPELINE_EVENT_POSITION_ID }, size_qty: { gt: 0 }, binance_order_id: { not: null } }, orderBy: { close_time: 'desc' } });
    let streak = 0;
    for (const p of positions) {
        if (p.realized_pnl >= -0.01)
            break;
        streak++;
    }
    await prisma_1.prisma.testnetAccount.update({ where: { id: accountId }, data: {
            total_trades: positions.length, winning_trades: positions.filter(p => p.realized_pnl > 0.01).length,
            losing_trades: positions.filter(p => p.realized_pnl < -0.01).length, consecutive_losses: streak,
            realized_pnl: positions.reduce((sum, p) => sum + p.realized_pnl, 0),
            accumulated_trading_fees: positions.reduce((sum, p) => sum + p.entry_fee + p.exit_fee, 0),
            accumulated_funding_fee: positions.reduce((sum, p) => sum + p.funding_fee, 0),
        } });
    const outcomes = await prisma_1.prisma.tradeOutcome.findMany({ include: { decision: { select: { playbook_key: true } } } });
    for (const key of new Set(outcomes.map(o => o.decision.playbook_key))) {
        const rows = outcomes.filter(o => o.decision.playbook_key === key);
        const wins = rows.filter(o => o.outcome === 'win').length;
        const data = { symbol: rows[0].symbol, total_trades: rows.length, winning_trades: wins,
            losing_trades: rows.filter(o => o.outcome === 'loss').length, win_rate: wins / rows.length * 100,
            avg_rr: rows.reduce((s, o) => s + o.realized_rr, 0) / rows.length,
            avg_pnl: rows.reduce((s, o) => s + o.realized_pnl, 0) / rows.length,
            total_pnl: rows.reduce((s, o) => s + o.realized_pnl, 0), last_updated: new Date() };
        await prisma_1.prisma.playbookStats.upsert({ where: { playbook_key: key }, create: { playbook_key: key, ...data }, update: data });
    }
}
async function runClosedPositionPnlReconcile(options = {}) {
    const account = await prisma_1.prisma.testnetAccount.findFirst({ where: { symbol: options.symbol ?? 'BTC', method_id: options.methodId ?? 'kim_nghia' } });
    if (!account)
        throw new Error('No account for reconciliation');
    const positions = await prisma_1.prisma.testnetPosition.findMany({ where: { account_id: account.id, status: 'closed',
            position_id: { not: testnet_repository_1.PIPELINE_EVENT_POSITION_ID }, side: { notIn: ['NONE', 'none'] }, size_qty: { gt: 0 },
            ...(options.recentOnly ? { close_time: { gte: new Date(Date.now() - 7 * 86400_000) } } : {}),
        }, orderBy: { close_time: 'asc' } });
    const summary = { scanned: positions.length, updated: 0, verified: 0, dry_run: options.dryRun !== false, results: [] };
    // Fetch the union of required history ONCE. Per-position income requests (weight 30)
    // can otherwise exhaust Binance's 2400/min limit during a historical backfill.
    let rounds;
    if (positions.length && process.env.BINANCE_ENABLED === 'true') {
        const startTime = Math.min(...positions.map(p => p.entry_time.getTime())) - 86400_000;
        const endTime = Math.min(Date.now(), Math.max(...positions.map(p => p.close_time?.getTime() ?? Date.now())) + 60_000);
        const symbol = `${account.symbol.toUpperCase().replace(/USDT$/, '')}USDT`;
        const fills = await (0, binance_trade_history_service_1.fetchUserTradesByTimeWindows)(symbol, endTime, endTime - startTime + 1);
        const income = await (0, binance_income_service_1.fetchBinanceIncomeRows)({ symbol, startTime, endTime });
        rounds = (0, exchange_rounds_1.reconstructExchangeRounds)(fills, income);
    }
    for (const p of positions) {
        const result = await reconcileClosedPositionPnlFromFills(p, { dryRun: summary.dry_run, rounds });
        summary.results.push(result);
        if (result.verified)
            summary.verified++;
        if (!result.skipped)
            summary.updated++;
    }
    if (!summary.dry_run && summary.updated) {
        await rebuildNetTradeStatistics(account.id);
        await (0, wallet_reconcile_service_1.reconcileTestnetWalletFromBinance)(account.id);
    }
    console.log(`[PnlLedger] scanned=${summary.scanned} verified=${summary.verified} changed=${summary.updated} dryRun=${summary.dry_run}`);
    return summary;
}
//# sourceMappingURL=position-pnl-reconcile.service.js.map