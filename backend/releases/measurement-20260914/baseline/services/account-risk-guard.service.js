"use strict";
/**
 * Account-level guards before opening new trades (cooldown, consecutive losses).
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.assertTestnetAccountCanOpenTrade = assertTestnetAccountCanOpenTrade;
exports.applyConsecutiveLossCooldownIfNeeded = applyConsecutiveLossCooldownIfNeeded;
const prisma_1 = require("../lib/prisma");
const risk_policy_1 = require("../config/risk-policy");
const testnet_repository_1 = require("../repositories/testnet.repository");
const binance_trade_history_service_1 = require("./binance-trade-history.service");
const protective_exposure_state_1 = require("./protective-exposure-state");
const account_circuit_service_1 = require("./account-circuit.service");
async function resolveLossStreak(accountId, symbol) {
    if (process.env.BINANCE_ENABLED === 'true') {
        try {
            const streak = await (0, binance_trade_history_service_1.getBinanceLossStreak)(symbol);
            const account = await prisma_1.prisma.testnetAccount.findUnique({ where: { id: accountId } });
            if (account && account.consecutive_losses !== streak.consecutiveLosses) {
                await prisma_1.prisma.testnetAccount.update({
                    where: { id: accountId },
                    data: { consecutive_losses: streak.consecutiveLosses },
                });
            }
            return streak;
        }
        catch (error) {
            const msg = error instanceof Error ? error.message : String(error);
            console.warn(`[AccountRiskGuard] Binance loss streak check failed: ${msg}`);
        }
    }
    const account = await prisma_1.prisma.testnetAccount.findUnique({ where: { id: accountId } });
    return {
        consecutiveLosses: account?.consecutive_losses ?? 0,
        lastLossTime: 0,
    };
}
async function assertTestnetAccountCanOpenTrade(accountId, symbol) {
    const account = await prisma_1.prisma.testnetAccount.findUnique({
        where: { id: accountId },
    });
    if (!account) {
        return { allowed: false, reason: 'Testnet account not found' };
    }
    const policy = (0, risk_policy_1.getRiskPolicy)();
    const now = new Date();
    const protectiveBlock = (0, protective_exposure_state_1.getProtectiveExposureEntryBlock)();
    if (protectiveBlock) {
        return {
            allowed: false,
            reason: `Protective exposure audit blocked entries: ${protectiveBlock.reason}`,
        };
    }
    if (account.cooldown_until && account.cooldown_until > now) {
        return {
            allowed: false,
            reason: `Account cooldown active until ${account.cooldown_until.toISOString()} (${account.consecutive_losses ?? 0} consecutive losses, max ${policy.maxConsecutiveLosses})`,
        };
    }
    if (account.cooldown_until && account.cooldown_until <= now) {
        await prisma_1.prisma.testnetAccount.update({
            where: { id: accountId },
            data: { cooldown_until: null },
        });
    }
    if (process.env.BINANCE_ENABLED === 'true' && symbol) {
        const streak = await resolveLossStreak(accountId, symbol);
        if (streak.consecutiveLosses >= policy.lossCooldownTier2MinStreak && streak.lastLossTime > 0) {
            const until = (0, risk_policy_1.resolveLossCooldownUntil)(streak.consecutiveLosses, new Date(streak.lastLossTime));
            if (until && Date.now() < until.getTime()) {
                const remainingH = (until.getTime() - Date.now()) / 3_600_000;
                return {
                    allowed: false,
                    reason: `Binance loss streak ${streak.consecutiveLosses} — cooldown ${remainingH.toFixed(1)}h remaining (until ${until.toISOString()})`,
                };
            }
        }
    }
    const circuit = await (0, account_circuit_service_1.getAccountCircuitStatus)(accountId);
    if (!circuit.allowed) {
        await (0, account_circuit_service_1.applyExpectancyKillCooldownIfNeeded)(accountId, circuit);
        return { allowed: false, reason: circuit.reason };
    }
    return { allowed: true, reason: 'Account trade guard passed',
        remainingDailyRiskUsd: Math.max(0, (circuit.startEquity ?? account.equity) * policy.dailyLossLimitPercent / 100 - circuit.dailyLossUsd) };
}
/** After a verified losing close, set cooldown_until when Binance streak threshold reached. */
async function applyConsecutiveLossCooldownIfNeeded(accountId, symbol = 'BTC') {
    const policy = (0, risk_policy_1.getRiskPolicy)();
    const streak = await resolveLossStreak(accountId, symbol);
    if (streak.consecutiveLosses < policy.lossCooldownTier2MinStreak) {
        return;
    }
    const cooldownUntil = (0, risk_policy_1.resolveLossCooldownUntil)(streak.consecutiveLosses, new Date());
    if (!cooldownUntil) {
        return;
    }
    await (0, testnet_repository_1.setTestnetAccountCooldown)(accountId, cooldownUntil);
    console.log(`[AccountRiskGuard] ${streak.consecutiveLosses} consecutive losses, entering cooldown until ${cooldownUntil.toISOString()}`);
}
//# sourceMappingURL=account-risk-guard.service.js.map