"use strict";
/**
 * Structure invalidation → market exit when score≥min (green or red).
 * No BE tighten — profit-protect owns price-based BE/trail.
 * docs/position-invalidation-plan.md
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.maybeApplyInvalidationProtect = maybeApplyInvalidationProtect;
exports.clearInvalidationCooldownState = clearInvalidationCooldownState;
const position_invalidation_policy_1 = require("../config/position-invalidation-policy");
const profit_protect_policy_1 = require("../config/profit-protect-policy");
const market_scan_scheduler_1 = require("../schedulers/market-scan.scheduler");
const position_invalidation_1 = require("../utils/position-invalidation");
const binance_balance_sync_service_1 = require("./binance-balance-sync.service");
const position_close_service_1 = require("./position-close.service");
const profit_protect_service_1 = require("./profit-protect.service");
const testnet_repository_1 = require("../repositories/testnet.repository");
const lastAmendAt = new Map();
function toSnap(symbol, timeframe) {
    const scan = (0, market_scan_scheduler_1.getScanResult)(symbol, timeframe);
    if (!scan)
        return null;
    const setup = scan.signalResult.setupResult;
    const regimeEv = setup.evidence?.regime;
    return {
        timeframe,
        regime: setup.regime ?? regimeEv?.regime ?? 'unknown',
        trendDirection: regimeEv?.trendDirection ?? null,
        playbooks: setup.evidence?.playbooks?.map((pb) => ({
            playbook: pb.playbook,
            detected: pb.detected,
            grade: pb.grade,
            summary: pb.summary,
            metrics: pb.metrics,
        })),
    };
}
async function maybeApplyInvalidationProtect(position, mark) {
    if (!(0, position_invalidation_policy_1.isInvalidationEnabled)()) {
        return { applied: false, reason: 'invalidation disabled' };
    }
    if (process.env.BINANCE_ENABLED !== 'true') {
        return { applied: false, reason: 'binance disabled' };
    }
    const allowExit = (0, position_invalidation_policy_1.isInvalidationExitEnabled)();
    if (!allowExit) {
        return { applied: false, reason: 'invalidation exit disabled' };
    }
    const cooldownUntil = (lastAmendAt.get(position.position_id) ?? 0) + (0, position_invalidation_policy_1.getInvalidationCooldownMs)();
    if (Date.now() < cooldownUntil) {
        return { applied: false, reason: 'invalidation cooldown' };
    }
    const side = position.side.toLowerCase() === 'short' ? 'short' : 'long';
    const ageMinutes = (Date.now() - position.entry_time.getTime()) / 60_000;
    const initialRisk = (0, profit_protect_service_1.getRememberedInitialRisk)(position.position_id) ??
        (0, profit_protect_service_1.rememberInitialRisk)(position.position_id, position.entry_price, position.stop_loss, side);
    const htfTf = (0, position_invalidation_policy_1.getInvalidationHtfTf)();
    const ltfTf = (0, position_invalidation_policy_1.getInvalidationLtfTf)();
    const decision = (0, position_invalidation_1.evaluatePositionInvalidation)({
        side,
        entry: position.entry_price,
        mark,
        currentSl: position.stop_loss,
        ageMinutes,
        initialRisk: initialRisk > 0 ? initialRisk : undefined,
        htf: toSnap(position.symbol, htfTf),
        ltf: toSnap(position.symbol, ltfTf),
        minScore: (0, position_invalidation_policy_1.getInvalidationMinScore)(),
        minAgeMinutes: (0, position_invalidation_policy_1.getInvalidationMinMinutes)(),
        minUpnlPct: (0, position_invalidation_policy_1.getInvalidationMinUpnlPct)(),
        htfLostMinHours: (0, position_invalidation_policy_1.getInvalidationHtfLostMinHours)(),
        beFeeBufferPct: (0, profit_protect_policy_1.getBreakevenFeeBufferPct)(),
        allowExitWhenRed: allowExit,
    });
    if (decision.action !== 'exit') {
        if (decision.score > 0) {
            console.log(`[Invalidation] ${position.position_id} hold score=${decision.score} — ${decision.reason}`);
        }
        return { applied: false, reason: decision.reason, score: decision.score };
    }
    const closeResult = await (0, position_close_service_1.closePositionOnBinanceMarket)(position, undefined, {
        guardSource: 'invalidation_exit',
        positionId: position.position_id,
        entryTime: position.entry_time ?? null,
    });
    if (!closeResult.ok) {
        console.error(`[Invalidation] Exit failed for ${position.position_id}: ${closeResult.reason}`);
        return { applied: false, reason: closeResult.reason ?? 'exit failed', score: decision.score };
    }
    await (0, position_close_service_1.closeLocalPosition)({ ...position, account: position.account }, mark, 'invalidation_exit', {
        score: decision.score,
        signals: decision.signals,
        unrealized_pct: decision.unrealizedPct,
        reason: decision.reason,
    });
    await (0, testnet_repository_1.recordTestnetTradeEvent)(position.position_id, 'position_invalidation', {
        action: 'exit',
        reason: decision.reason,
        score: decision.score,
        signals: decision.signals,
        unrealized_pct: decision.unrealizedPct,
        mark,
    });
    lastAmendAt.set(position.position_id, Date.now());
    try {
        await (0, binance_balance_sync_service_1.syncTestnetAccountFromBinance)(position.account_id);
    }
    catch (syncErr) {
        const msg = syncErr instanceof Error ? syncErr.message : String(syncErr);
        console.warn(`[Invalidation] Balance sync after exit failed: ${msg}`);
    }
    console.log(`[Invalidation] ${position.position_id} EXIT @ ${mark} — ${decision.reason}`);
    return {
        applied: true,
        exited: true,
        reason: decision.reason,
        score: decision.score,
    };
}
/** Clear in-memory cooldown (tests). */
function clearInvalidationCooldownState() {
    lastAmendAt.clear();
}
//# sourceMappingURL=position-invalidation.service.js.map