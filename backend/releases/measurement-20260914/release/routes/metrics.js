"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const entry_trace_audit_1 = require("../utils/entry-trace-audit");
/**
 * Metrics Routes
 * Provides endpoints for risk, playbooks, no-trade reasons, and execution costs
 */
const express_1 = require("express");
const risk_manager_service_1 = require("../services/risk-manager.service");
const memory_service_1 = require("../services/memory.service");
const signal_gate_service_1 = require("../services/signal-gate.service");
const prisma_1 = require("../lib/prisma");
const risk_policy_1 = require("../config/risk-policy");
const account_circuit_service_1 = require("../services/account-circuit.service");
const expectancy_rollup_service_1 = require("../services/expectancy-rollup.service");
const account_performance_service_1 = require("../services/account-performance.service");
const testnet_repository_1 = require("../repositories/testnet.repository");
const transition_retest_policy_1 = require("../config/transition-retest-policy");
const adaptive_setup_policy_1 = require("../config/adaptive-setup-policy");
const router = (0, express_1.Router)();
/**
 * GET /api/metrics/risk
 * Get current risk state and statistics
 */
router.get('/risk', async (_req, res) => {
    try {
        const config = risk_manager_service_1.riskManagerService.getConfig();
        const policy = (0, risk_policy_1.getRiskPolicy)();
        const account = await prisma_1.prisma.testnetAccount.findFirst({
            where: { symbol: 'BTC', method_id: 'kim_nghia' },
        });
        const circuit = account ? await (0, account_circuit_service_1.getAccountCircuitStatus)(account.id) : null;
        const fullHistory = account ? await (0, account_performance_service_1.getFullHistoryWalletMetrics)(prisma_1.prisma, account) : null;
        res.json({
            config: {
                risk_per_trade_percent: policy.riskPerTradePercent,
                max_effective_risk_per_trade_percent: policy.maxEffectiveRiskPerTradePercent,
                max_effective_risk_per_trade_usd: policy.maxEffectiveRiskPerTradeUsd ?? null,
                effective_risk_cap_mode: policy.maxEffectiveRiskPerTradeUsd ? 'usd' : 'percent',
                minimum_lot_stop_normalization_enabled: policy.minimumLotStopNormalizationEnabled,
                minimum_lot_normalized_stop_max_percent: policy.minimumLotNormalizedStopMaxPercent,
                daily_loss_limit_percent: policy.dailyLossLimitPercent,
                max_drawdown_percent: policy.maxDrawdownPercent,
                max_consecutive_losses: config.maxConsecutiveLosses,
                consecutive_loss_cooldown_hours: config.consecutiveLossCooldownHours,
                max_spread_percent: config.maxSpreadPercent,
                max_slippage_percent: config.maxSlippagePercent,
                max_fee_percent: config.maxFeePercent,
                min_signal_grade: config.minSignalGrade,
                min_signal_confidence: config.minSignalConfidence,
                max_positions_per_symbol: config.maxPositionsPerSymbol,
                max_total_positions: config.maxTotalPositions,
                circuit_daily_loss_enabled: policy.circuitDailyLossEnabled,
                circuit_drawdown_enabled: policy.circuitDrawdownEnabled,
                circuit_expectancy_kill_enabled: policy.circuitExpectancyKillEnabled,
                circuit_expectancy_window: policy.circuitExpectancyWindow,
                circuit_expectancy_min_sum_r: policy.circuitExpectancyMinSumR,
            },
            circuit: circuit
                ? {
                    scope: circuit.scope,
                    starts_at: circuit.epochStart,
                    allowed: circuit.allowed,
                    reason: circuit.reason,
                    daily_loss_usd: circuit.dailyLossUsd,
                    daily_loss_percent: circuit.dailyLossPercent,
                    drawdown_percent: circuit.drawdownPercent,
                    peak_equity: circuit.peakEquity,
                    peak_equity_source: circuit.peakEquitySource,
                    expectancy_since: circuit.expectancySince,
                    expectancy: circuit.expectancy,
                }
                : null,
            full_history: fullHistory
                ? {
                    scope: fullHistory.scope,
                    baseline_balance: fullHistory.baselineBalance,
                    current_balance: fullHistory.currentBalance,
                    current_equity: fullHistory.currentEquity,
                    wallet_pnl: fullHistory.walletPnl,
                    wallet_return_percent: fullHistory.walletReturnPercent,
                    peak_equity: fullHistory.peakEquity,
                    peak_equity_at: fullHistory.peakEquityAt,
                    current_drawdown_percent: fullHistory.currentDrawdownPercent,
                    max_drawdown_percent: fullHistory.maxDrawdownPercent,
                    max_drawdown_at: fullHistory.maxDrawdownAt,
                    first_snapshot_at: fullHistory.firstSnapshotAt,
                    last_snapshot_at: fullHistory.lastSnapshotAt,
                    snapshot_count: fullHistory.snapshotCount,
                }
                : null,
            strategy_epoch: circuit
                ? {
                    scope: circuit.scope,
                    starts_at: circuit.epochStart,
                    peak_equity: circuit.peakEquity,
                    peak_equity_source: circuit.peakEquitySource,
                    drawdown_percent: circuit.drawdownPercent,
                    expectancy_since: circuit.expectancySince,
                    expectancy: circuit.expectancy,
                    trading_allowed: circuit.allowed,
                    circuit_reason: circuit.reason,
                }
                : null,
            trading_allowed: circuit ? circuit.allowed : true,
            timestamp: new Date().toISOString(),
        });
    }
    catch (error) {
        console.error('[Metrics] Error getting risk metrics:', error.message);
        res.status(500).json({ error: 'Failed to get risk metrics' });
    }
});
/**
 * GET /api/metrics/expectancy?n=20&days=
 * Rollup avgR / PF / n from trade_outcomes.
 */
router.get('/expectancy', async (req, res) => {
    try {
        const n = Math.min(200, Math.max(1, parseInt(String(req.query.n || '20'), 10) || 20));
        const days = parseFloat(String(req.query.days || '0')) || 0;
        const policy = (0, risk_policy_1.getRiskPolicy)();
        const rows = await prisma_1.prisma.tradeOutcome.findMany({
            orderBy: { timestamp: 'desc' },
            select: { realized_rr: true, realized_pnl: true, close_reason: true, timestamp: true },
        });
        const requestedSince = days > 0 ? new Date(Date.now() - days * 86_400_000) : null;
        const window = requestedSince
            ? rows.filter((row) => row.timestamp >= requestedSince)
            : rows.slice(0, n);
        const rollup = (0, expectancy_rollup_service_1.rollupExpectancyFromOutcomes)(window);
        const fullHistory = (0, expectancy_rollup_service_1.rollupExpectancyFromOutcomes)(rows);
        const strategyEpochRows = policy.circuitExpectancySince
            ? rows.filter((row) => row.timestamp >= policy.circuitExpectancySince)
            : rows;
        const circuitWindow = strategyEpochRows.slice(0, policy.circuitExpectancyWindow);
        const strategyEpoch = (0, expectancy_rollup_service_1.rollupExpectancyFromOutcomes)(circuitWindow);
        res.json({
            scope: 'requested_window',
            window: days > 0 ? `last_${days}d` : `last_${n}`,
            ...rollup,
            profit_factor_label: (0, expectancy_rollup_service_1.profitFactorLabel)(rollup.profitFactor, rollup.wins, rollup.losses),
            kill_armed: strategyEpoch.n >= policy.circuitExpectancyWindow &&
                strategyEpoch.sumR <= policy.circuitExpectancyMinSumR,
            full_history: {
                scope: 'full_history',
                ...fullHistory,
                profit_factor_label: (0, expectancy_rollup_service_1.profitFactorLabel)(fullHistory.profitFactor, fullHistory.wins, fullHistory.losses),
            },
            strategy_epoch: {
                scope: 'strategy_epoch',
                starts_at: policy.circuitExpectancySince,
                window_size: policy.circuitExpectancyWindow,
                ...strategyEpoch,
                profit_factor_label: (0, expectancy_rollup_service_1.profitFactorLabel)(strategyEpoch.profitFactor, strategyEpoch.wins, strategyEpoch.losses),
                kill_armed: strategyEpoch.n >= policy.circuitExpectancyWindow &&
                    strategyEpoch.sumR <= policy.circuitExpectancyMinSumR,
            },
            timestamp: new Date().toISOString(),
        });
    }
    catch (error) {
        console.error('[Metrics] Error getting expectancy:', error.message);
        res.status(500).json({ error: 'Failed to get expectancy' });
    }
});
/**
 * GET /api/metrics/playbooks
 * Get playbook performance statistics
 */
router.get('/playbooks', async (req, res) => {
    try {
        const symbol = req.query.symbol || 'BTC';
        const performance = await memory_service_1.memoryService.getPlaybookPerformance(symbol);
        res.json({
            symbol,
            playbooks: performance,
            timestamp: new Date().toISOString()
        });
    }
    catch (error) {
        console.error('[Metrics] Error getting playbook metrics:', error.message);
        res.status(500).json({ error: 'Failed to get playbook metrics' });
    }
});
/**
 * GET /api/metrics/no-trade
 * Get recent no-trade decisions and reasons
 */
router.get('/no-trade', async (req, res) => {
    try {
        const symbol = req.query.symbol || 'BTC';
        const limit = Math.min(200, Math.max(1, parseInt(String(req.query.limit || '20'), 10) || 20));
        const rows = await prisma_1.prisma.tradeDecision.findMany({
            where: { symbol: symbol.toUpperCase(), decision: 'no_trade' },
            orderBy: { timestamp: 'desc' },
            take: limit,
            select: {
                id: true,
                timeframe: true,
                playbook_key: true,
                grade: true,
                confidence: true,
                regime: true,
                reason: true,
                timestamp: true,
                candle_hash: true,
            },
        });
        res.json({
            symbol,
            no_trade_decisions: rows,
            total_count: rows.length,
            timestamp: new Date().toISOString()
        });
    }
    catch (error) {
        console.error('[Metrics] Error getting no-trade metrics:', error.message);
        res.status(500).json({ error: 'Failed to get no-trade metrics' });
    }
});
/**
 * GET /api/metrics/gate-funnel?symbol=BTC&days=7
 * Unique deterministic pre-LLM observations, including all blockers (not only first).
 */
router.get('/entry-traces', async (req, res) => {
    try {
        const days = Math.min(30, Math.max(1, Number(req.query.days) || 1));
        const since = new Date(Date.now() - days * 86400000);
        const rows = await prisma_1.prisma.testnetTradeEvent.findMany({
            where: { timestamp: { gte: since }, event_type: { in: ['entry_trace', 'llm_provider_request',
                        'llm_provider_result', 'pending_order_linked', 'entry_order_filled', 'retest_feasibility_pair'] } },
            orderBy: { id: 'desc' }, take: 10001, select: { event_type: true, event_data: true },
        });
        let malformed = 0;
        const events = rows.slice(0, 10000).reverse().flatMap(row => {
            try {
                return [{ event_type: row.event_type, event_data: JSON.parse(row.event_data ?? '{}') }];
            }
            catch {
                malformed++;
                return [];
            }
        });
        res.json({ since, truncated: rows.length > 10000, malformed, ...(0, entry_trace_audit_1.auditEntryTraces)(events) });
    }
    catch {
        res.status(500).json({ error: 'Failed to read entry traces' });
    }
});
router.get('/gate-funnel', async (req, res) => {
    try {
        const symbol = String(req.query.symbol || 'BTC').toUpperCase();
        const days = Math.min(90, Math.max(1, Number(req.query.days || 7) || 7));
        const since = new Date(Date.now() - days * 86_400_000);
        const rows = await prisma_1.prisma.testnetTradeEvent.findMany({
            where: {
                position_id: testnet_repository_1.PIPELINE_EVENT_POSITION_ID,
                event_type: 'gate_funnel_shadow',
                timestamp: { gte: since },
            },
            orderBy: { timestamp: 'desc' },
            take: 10_000,
            select: { id: true, event_data: true, timestamp: true },
        });
        const unique = new Map();
        let malformed = 0;
        for (const row of rows) {
            try {
                const parsed = JSON.parse(row.event_data || '{}');
                if (parsed.symbol !== symbol || !parsed.observation_key)
                    continue;
                if (!unique.has(parsed.observation_key))
                    unique.set(parsed.observation_key, parsed);
            }
            catch {
                malformed += 1;
            }
        }
        const observations = [...unique.values()];
        const countBy = (values) => values.reduce((out, value) => {
            out[value] = (out[value] ?? 0) + 1;
            return out;
        }, {});
        const gateNames = [...new Set(observations.flatMap((row) => Object.keys(row.gates || {})))];
        const gateStats = Object.fromEntries(gateNames.map((name) => {
            const statuses = countBy(observations.map((row) => row.gates?.[name]?.status ?? 'unavailable'));
            return [name, statuses];
        }));
        res.json({
            symbol,
            window_days: days,
            unique_candidates: observations.length,
            raw_events: rows.length,
            duplicate_events: Math.max(0, rows.length - observations.length - malformed),
            malformed_events: malformed,
            would_pass_pre_llm: observations.filter((row) => row.would_pass_pre_llm).length,
            would_pass_pre_llm_semantics: 'deprecated_all_gate_proxy_not_actual_provider_calls',
            pre_ai_proxy_pass: observations.filter(row => row.pre_ai_proxy_pass === true).length,
            v2_observations: observations.filter(row => row.measurement_version === 2).length,
            classifications: countBy(observations.map(row => row.classification ?? 'legacy_unclassified')),
            feasibility: countBy(observations.map(row => row.feasibility?.status ?? 'unavailable')),
            by_timeframe: countBy(observations.map((row) => row.timeframe)),
            by_grade: countBy(observations.map((row) => row.grade)),
            by_playbook: countBy(observations.map((row) => row.playbook)),
            by_side: countBy(observations.map((row) => row.side ?? 'unknown')),
            first_blocks: countBy(observations.map((row) => row.first_block ?? 'pass')),
            all_blocks: countBy(observations.flatMap((row) => row.all_blocks)),
            gates: gateStats,
            recent: observations.slice(0, 50),
            timestamp: new Date().toISOString(),
        });
    }
    catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error('[Metrics] Error getting gate funnel:', message);
        res.status(500).json({ error: 'Failed to get gate funnel metrics' });
    }
});
/**
 * GET /api/metrics/transition-retest?symbol=BTC&days=30
 * Breakout -> retest lifecycle, including shadow outcomes and any live LLM
 * dispatch. Gross-R shadow results remain separate from live trade expectancy.
 */
router.get('/transition-retest', async (req, res) => {
    try {
        const symbol = String(req.query.symbol || 'BTC').toUpperCase();
        const days = Math.min(180, Math.max(1, Number(req.query.days || 30) || 30));
        const since = new Date(Date.now() - days * 86_400_000);
        const eventTypes = [
            'transition_retest_candidate',
            'transition_retest_confirmed',
            'transition_retest_expired',
            'transition_retest_invalidated',
            'transition_retest_htf_blocked',
            'transition_retest_live_claimed',
            'transition_retest_live_dispatch',
            'transition_retest_shadow_outcome',
        ];
        const rows = await prisma_1.prisma.testnetTradeEvent.findMany({
            where: {
                position_id: testnet_repository_1.PIPELINE_EVENT_POSITION_ID,
                event_type: { in: eventTypes },
                timestamp: { gte: since },
            },
            orderBy: { timestamp: 'asc' },
            take: 10_000,
            select: { id: true, event_type: true, event_data: true, timestamp: true },
        });
        const unique = new Map();
        let malformed = 0;
        for (const row of rows) {
            try {
                const data = JSON.parse(row.event_data || '{}');
                const candidateKey = String(data.candidate_key || '');
                if (!candidateKey || String(data.symbol || '').toUpperCase() !== symbol)
                    continue;
                unique.set(`${row.event_type}:${candidateKey}`, {
                    event_type: row.event_type,
                    timestamp: row.timestamp,
                    data,
                });
            }
            catch {
                malformed += 1;
            }
        }
        const events = [...unique.values()].sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
        const count = (eventType) => events.filter((event) => event.event_type === eventType).length;
        const countBy = (values) => values.reduce((out, value) => {
            out[value] = (out[value] ?? 0) + 1;
            return out;
        }, {});
        const states = new Map();
        for (const event of events) {
            const key = String(event.data.candidate_key);
            if (event.event_type === 'transition_retest_candidate')
                states.set(key, 'pending');
            else if (event.event_type === 'transition_retest_confirmed')
                states.set(key, 'confirmed');
            else if (event.event_type === 'transition_retest_expired')
                states.set(key, 'expired');
            else if (event.event_type === 'transition_retest_invalidated')
                states.set(key, 'invalidated');
            else if (event.event_type === 'transition_retest_live_claimed')
                states.set(key, 'live_claimed');
            else if (event.event_type === 'transition_retest_live_dispatch') {
                states.set(key, `live_${String(event.data.decision || 'unknown')}`);
            }
            else if (event.event_type === 'transition_retest_shadow_outcome') {
                if (!states.get(key)?.startsWith('live_')) {
                    states.set(key, String(event.data.close_reason || 'closed'));
                }
            }
        }
        const candidateEvents = events.filter((event) => event.event_type === 'transition_retest_candidate');
        const outcomes = events.filter((event) => event.event_type === 'transition_retest_shadow_outcome');
        const realizedRs = outcomes
            .map((event) => Number(event.data.realized_r_gross))
            .filter(Number.isFinite);
        const realizedNetRs = outcomes
            .map((event) => Number(event.data.realized_r_net))
            .filter(Number.isFinite);
        const grossProfitR = realizedRs.filter((value) => value > 0).reduce((a, b) => a + b, 0);
        const grossLossR = Math.abs(realizedRs.filter((value) => value < 0).reduce((a, b) => a + b, 0));
        const profitFactor = grossLossR > 0
            ? grossProfitR / grossLossR
            : grossProfitR > 0
                ? null
                : 0;
        const netProfitR = realizedNetRs.filter((value) => value > 0).reduce((a, b) => a + b, 0);
        const netLossR = Math.abs(realizedNetRs.filter((value) => value < 0).reduce((a, b) => a + b, 0));
        const netProfitFactor = netLossR > 0
            ? netProfitR / netLossR
            : netProfitR > 0
                ? null
                : 0;
        const adaptiveKinds = [
            'early_structure_flip',
            'aligned_micro_bos',
            'range_sweep_reclaim',
        ];
        const adaptiveByKind = Object.fromEntries(adaptiveKinds.map((kind) => {
            const kindOutcomes = outcomes.filter((event) => event.data.candidate_kind === kind);
            const values = kindOutcomes
                .map((event) => Number(event.data.realized_r_net))
                .filter(Number.isFinite);
            const profit = values.filter((value) => value > 0).reduce((a, b) => a + b, 0);
            const loss = Math.abs(values.filter((value) => value < 0).reduce((a, b) => a + b, 0));
            return [kind, {
                    candidates: candidateEvents.filter((event) => event.data.candidate_kind === kind).length,
                    outcomes: values.length,
                    sum_net_r: values.reduce((a, b) => a + b, 0),
                    avg_net_r: values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0,
                    profit_factor_net: loss > 0 ? profit / loss : profit > 0 ? null : 0,
                }];
        }));
        res.json({
            symbol,
            window_days: days,
            mode: (0, transition_retest_policy_1.getTransitionRetestMode)(),
            execution: (0, transition_retest_policy_1.getTransitionRetestMode)() === 'live'
                ? (0, adaptive_setup_policy_1.getAdaptiveSetupMode)() === 'live'
                    ? 'trend_live_range_long_5m_live_transition_shadow'
                    : 'trend_live_transition_shadow'
                : (0, transition_retest_policy_1.getTransitionRetestMode)() === 'shadow_llm'
                    ? 'trend_shadow_llm_transition_shadow'
                    : 'shadow_only',
            policy: {
                trend_breakout_retest_enabled: (0, transition_retest_policy_1.isTrendBreakoutRetestEnabled)(),
                transition_resolution_enabled: (0, transition_retest_policy_1.isTransitionResolutionEnabled)(),
                minimum_grade: (0, transition_retest_policy_1.getTransitionRetestMinGrade)(),
                eligible_grades: (0, transition_retest_policy_1.getTransitionRetestGrades)(),
                ttl_minutes: (0, transition_retest_policy_1.getTransitionRetestTtlMinutes)(),
                transition_resolution_ttl_minutes: (0, transition_retest_policy_1.getTransitionResolutionTtlMinutes)(),
                required_htf: (0, transition_retest_policy_1.getTransitionRetestRequireHtfTf)(),
                adaptive_shadow_enabled: (0, adaptive_setup_policy_1.isAdaptiveSetupShadowEnabled)(),
                adaptive_mode: (0, adaptive_setup_policy_1.getAdaptiveSetupMode)(),
                adaptive: {
                    early_structure_flip: {
                        enabled: (0, adaptive_setup_policy_1.isEarlyStructureFlipEnabled)(),
                        ttl_minutes: (0, adaptive_setup_policy_1.getAdaptiveSetupTtlMinutes)('early_structure_flip'),
                        rr: (0, adaptive_setup_policy_1.getAdaptiveSetupRr)('early_structure_flip'),
                    },
                    aligned_micro_bos: {
                        enabled: (0, adaptive_setup_policy_1.isAlignedMicroBosEnabled)(),
                        ttl_minutes: (0, adaptive_setup_policy_1.getAdaptiveSetupTtlMinutes)('aligned_micro_bos'),
                        rr: (0, adaptive_setup_policy_1.getAdaptiveSetupRr)('aligned_micro_bos'),
                        bos_strength: (0, adaptive_setup_policy_1.getAdaptiveMicroBosStrength)(),
                        require_1h_align: (0, adaptive_setup_policy_1.isAlignedMicroBosRequire1hAlign)(),
                    },
                    range_sweep_reclaim: {
                        enabled: (0, adaptive_setup_policy_1.isRangeSweepReclaimEnabled)(),
                        ttl_minutes: (0, adaptive_setup_policy_1.getAdaptiveSetupTtlMinutes)('range_sweep_reclaim'),
                        rr: (0, adaptive_setup_policy_1.getAdaptiveSetupRr)('range_sweep_reclaim'),
                        edge_fraction: (0, adaptive_setup_policy_1.getRangeSweepEdgeFraction)(),
                        long_5m_only: (0, adaptive_setup_policy_1.isRangeSweepLong5mOnly)(),
                        retest_require_bos: (0, adaptive_setup_policy_1.isRangeSweepRetestBosRequired)(),
                    },
                },
            },
            candidates: count('transition_retest_candidate'),
            confirmed: count('transition_retest_confirmed'),
            expired: count('transition_retest_expired'),
            invalidated: count('transition_retest_invalidated'),
            htf_blocked: count('transition_retest_htf_blocked'),
            live_claimed: count('transition_retest_live_claimed'),
            live_dispatches: count('transition_retest_live_dispatch'),
            shadow_priority_bypasses: candidateEvents.filter((event) => event.data.shadow_wave_bypassed === true).length,
            outcomes: outcomes.length,
            active_pending: [...states.values()].filter((state) => state === 'pending').length,
            active_shadow_positions: [...states.values()].filter((state) => state === 'confirmed').length,
            outcome_reasons: countBy(outcomes.map((event) => String(event.data.close_reason || 'unknown'))),
            by_timeframe: countBy(candidateEvents.map((event) => String(event.data.timeframe || 'unknown'))),
            by_grade: countBy(candidateEvents.map((event) => String(event.data.grade || 'unknown'))),
            by_side: countBy(candidateEvents.map((event) => String(event.data.side || 'unknown'))),
            by_kind: countBy(candidateEvents.map((event) => String(event.data.candidate_kind || 'transition'))),
            gross_r: {
                n: realizedRs.length,
                sum_r: realizedRs.reduce((a, b) => a + b, 0),
                avg_r: realizedRs.length
                    ? realizedRs.reduce((a, b) => a + b, 0) / realizedRs.length
                    : 0,
                wins: realizedRs.filter((value) => value > 0).length,
                losses: realizedRs.filter((value) => value < 0).length,
                breakeven: realizedRs.filter((value) => value === 0).length,
                gross_profit_r: grossProfitR,
                gross_loss_r: grossLossR,
                profit_factor: profitFactor,
            },
            net_r: {
                n: realizedNetRs.length,
                sum_r: realizedNetRs.reduce((a, b) => a + b, 0),
                avg_r: realizedNetRs.length
                    ? realizedNetRs.reduce((a, b) => a + b, 0) / realizedNetRs.length
                    : 0,
                wins: realizedNetRs.filter((value) => value > 0).length,
                losses: realizedNetRs.filter((value) => value < 0).length,
                breakeven: realizedNetRs.filter((value) => value === 0).length,
                profit_factor: netProfitFactor,
            },
            adaptive_by_kind: adaptiveByKind,
            malformed_events: malformed,
            recent: events.slice(-50).reverse(),
            timestamp: new Date().toISOString(),
        });
    }
    catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error('[Metrics] Error getting transition retest metrics:', message);
        res.status(500).json({ error: 'Failed to get transition retest metrics' });
    }
});
/**
 * GET /api/metrics/costs
 * Get execution cost statistics
 */
router.get('/costs', async (_req, res) => {
    try {
        const config = risk_manager_service_1.riskManagerService.getConfig();
        const positions = await prisma_1.prisma.testnetPosition.findMany({
            where: { status: 'closed', size_qty: { gt: 0 }, position_id: { not: testnet_repository_1.PIPELINE_EVENT_POSITION_ID } },
            orderBy: { close_time: 'desc' }, take: 100,
            include: { trade_events: { where: { event_type: 'pnl_ledger_v2' }, select: { id: true } } },
        });
        const recentCosts = positions.map(p => ({ position_id: p.position_id, closed_at: p.close_time,
            verified: p.trade_events.length > 0, entry_fee: p.entry_fee, exit_fee: p.exit_fee,
            funding_cost: p.funding_fee, total_cost: p.entry_fee + p.exit_fee + p.funding_fee,
            cost_percent: p.size_usd > 0 ? (p.entry_fee + p.exit_fee + p.funding_fee) / p.size_usd * 100 : null,
            net_pnl: p.realized_pnl }));
        const verified = recentCosts.filter(p => p.verified);
        res.json({
            limits: {
                max_spread_percent: config.maxSpreadPercent,
                max_slippage_percent: config.maxSlippagePercent,
                max_fee_percent: config.maxFeePercent,
                max_total_cost_percent: config.maxSpreadPercent + config.maxSlippagePercent + config.maxFeePercent
            },
            source: 'verified_exchange_rounds',
            coverage: { verified: verified.length, observed: positions.length },
            recent_costs: recentCosts,
            total_trades: positions.length,
            avg_cost_percent: verified.length ? verified.reduce((sum, p) => sum + (p.cost_percent ?? 0), 0) / verified.length : null,
            timestamp: new Date().toISOString()
        });
    }
    catch (error) {
        console.error('[Metrics] Error getting cost metrics:', error.message);
        res.status(500).json({ error: 'Failed to get cost metrics' });
    }
});
/**
 * GET /api/metrics/signal-gate
 * Get signal gate statistics
 */
router.get('/signal-gate', async (_req, res) => {
    try {
        const config = signal_gate_service_1.signalGateService.getConfig();
        res.json({
            config: {
                min_grade: config.minGrade,
                min_confidence: config.minConfidence,
                allowed_regimes: config.allowedRegimes,
                enable_duplicate_filter: config.enableDuplicateFilter
            },
            timestamp: new Date().toISOString()
        });
    }
    catch (error) {
        console.error('[Metrics] Error getting signal gate metrics:', error.message);
        res.status(500).json({ error: 'Failed to get signal gate metrics' });
    }
});
exports.default = router;
