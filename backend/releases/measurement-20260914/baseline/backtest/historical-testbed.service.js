"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.runHistoricalTestbed = runHistoricalTestbed;
exports.runHistoricalTestbedSlSweep = runHistoricalTestbedSlSweep;
exports.formatTestbedReport = formatTestbedReport;
const execution_risk_1 = require("../utils/execution-risk");
/**
 * Walk-forward historical testbed — signal gate + HTF guard + rule-based SL/TP (no LLM).
 */
const signal_gate_service_1 = require("../services/signal-gate.service");
const risk_policy_1 = require("../config/risk-policy");
const v3_schedulers_1 = require("../config/v3-schedulers");
const v3_entry_policy_1 = require("../config/v3-entry-policy");
const v3_structure_bias_policy_1 = require("../config/v3-structure-bias-policy");
const v3_regime_policy_1 = require("../config/v3-regime-policy");
const testbed_variants_1 = require("../config/testbed-variants");
const breakdown_1 = require("./breakdown");
const cooldown_simulator_1 = require("./cooldown-simulator");
const signal_gate_ranking_1 = require("../utils/signal-gate-ranking");
const trade_levels_1 = require("../utils/trade-levels");
const market_regime_analyzer_1 = require("../analyzers/market-regime.analyzer");
const signal_gate_windows_1 = require("../config/signal-gate-windows");
const candle_loader_1 = require("./candle-loader");
const setup_trade_side_1 = require("../utils/setup-trade-side");
const position_simulator_1 = require("./position-simulator");
const parity_1 = require("./parity");
function slBucket(pct) {
    if (pct < 0.35)
        return '<0.35%';
    if (pct < 0.4)
        return '0.35-0.40%';
    if (pct < 0.5)
        return '0.40-0.50%';
    if (pct < 0.7)
        return '0.50-0.70%';
    return '>=0.70%';
}
function buildSlBuckets(trades) {
    const buckets = new Map();
    for (const t of trades) {
        const b = slBucket(t.slDistancePct);
        const row = buckets.get(b) ?? { n: 0, wins: 0, losses: 0, netPnl: 0 };
        row.n += 1;
        row.netPnl += t.pnlUsd;
        if (t.pnlUsd > 0)
            row.wins += 1;
        else if (t.pnlUsd < 0)
            row.losses += 1;
        buckets.set(b, row);
    }
    return [...buckets.entries()].map(([bucket, v]) => ({ bucket, ...v }));
}
function maxLossStreak(trades) {
    let max = 0;
    let cur = 0;
    for (const t of trades) {
        if (t.pnlUsd < 0) {
            cur += 1;
            max = Math.max(max, cur);
        }
        else {
            cur = 0;
        }
    }
    return max;
}
async function runHistoricalTestbed(options = {}) {
    const symbol = (options.symbol ?? 'BTC').toUpperCase();
    const weeks = options.days ? options.days / 7 : (options.weeks ?? 3);
    const variant = (0, testbed_variants_1.resolveTestbedVariant)(options.variant);
    const policy = (0, risk_policy_1.getRiskPolicy)();
    const minSlPct = options.minSlPct ?? policy.minSlDistancePercent;
    const minRr = (0, parity_1.resolveBacktestMinRr)(options.minRr);
    const notionalUsd = options.notionalUsd ?? 2000;
    const feePctPerSide = options.feePctPerSide ?? 0.0004;
    const timeframes = [...(0, v3_schedulers_1.getV3SignalGateTimeframes)()];
    const structTf = (0, v3_structure_bias_policy_1.getV3StructureBiasTf)();
    const pullbackTf = (0, v3_entry_policy_1.getV3PullbackTf)();
    const structureEnabledForRun = variant.structureBiasEnabled ?? (0, v3_structure_bias_policy_1.isV3StructureBiasEnabled)();
    const requirePullbackForRun = variant.requirePullback ?? (0, v3_entry_policy_1.isV3RequirePullback)();
    const loadTfs = [...timeframes];
    if (structureEnabledForRun && !loadTfs.includes(structTf)) {
        loadTfs.push(structTf);
    }
    if (requirePullbackForRun && !loadTfs.includes(pullbackTf)) {
        loadTfs.push(pullbackTf);
    }
    const entryRank = (0, v3_schedulers_1.getV3EntryTfPriorityRank)();
    const endDate = options.endDate ?? new Date();
    const startDate = options.startDate ??
        new Date(endDate.getTime() - (options.days ?? weeks * 7) * 24 * 60 * 60_000);
    const loaded = await (0, candle_loader_1.loadBacktestCandles)({
        symbol,
        weeks,
        timeframes: loadTfs,
        startDate,
        endDate,
        extraWarmupBarsPerTf: options.warmupBarsPerTf ?? options.warmupBars5m ?? 150,
    });
    const candles5m = loaded.byTf['5m'] ?? [];
    const periodStartTs = loaded.period.start.getTime();
    const walkBars = candles5m.filter((c) => c.timestamp >= periodStartTs);
    const gate = new signal_gate_service_1.SignalGateService({
        minGrade: variant.minGrade ?? policy.minSignalGrade,
        minConfidence: variant.minConfidence ?? policy.minSignalConfidence,
        allowedRegimes: variant.allowedRegimes ?? (0, v3_entry_policy_1.getSignalGateAllowedRegimes)(),
        enableDuplicateFilter: false,
    });
    const requiredHtfTf = (0, v3_entry_policy_1.getV3RequireHtfTrend)();
    const htfTf = (0, v3_entry_policy_1.getV3LtfAlignRegimeHtf)() ?? requiredHtfTf ?? '1h';
    const altTf = (0, v3_entry_policy_1.getV3HtfTrendAlt)();
    const alignTf = (0, v3_entry_policy_1.getV3HtfSideAlignTf)();
    const structureLookback = (0, v3_structure_bias_policy_1.getV3StructureBiasCandleLimit)();
    const blocks = {
        signal_gate: 0,
        regime: 0,
        htf: 0,
        no_direction: 0,
        open_position: 0,
        duplicate_signal: 0,
        entry_5m_guard: 0,
        grade_playbook: 0,
        pullback: 0,
        cooldown: 0,
        structure_bias: 0,
        side_align: 0,
        execution_risk: 0,
    };
    const seenSignals = new Set();
    const cooldown = variant.enableCooldown ? new cooldown_simulator_1.BacktestCooldownState() : null;
    const trades = [];
    let signalsPassed = 0;
    let open = null;
    let tradeId = 0;
    const getHtfRegime = (tf, ts) => {
        const slice = (0, candle_loader_1.closedCandlesUpTo)(loaded.byTf[tf] ?? [], ts, tf);
        if (slice.length < 50)
            return null;
        const w = (0, signal_gate_windows_1.getSignalGateWindows)(tf);
        return (0, market_regime_analyzer_1.computeRegimeEvidence)(slice, { regimeBars: w.regimeBars, timeframe: tf }).regime;
    };
    const getHtfState = (tf, ts) => {
        const slice = (0, candle_loader_1.closedCandlesUpTo)(loaded.byTf[tf] ?? [], ts, tf);
        if (slice.length < 50) {
            return { regime: null, trendDirection: null };
        }
        const w = (0, signal_gate_windows_1.getSignalGateWindows)(tf);
        const ev = (0, market_regime_analyzer_1.computeRegimeEvidence)(slice, { regimeBars: w.regimeBars, timeframe: tf });
        return { regime: ev.regime, trendDirection: ev.trendDirection };
    };
    for (let barIdx = 0; barIdx < walkBars.length; barIdx++) {
        const bar = walkBars[barIdx];
        const ts = (0, candle_loader_1.candleCloseTimestamp)(bar, '5m');
        if (open) {
            if (barIdx > open.entryBarIndex) {
                const hit = (0, position_simulator_1.checkBarForExit)(open, bar);
                if (hit) {
                    const closed = (0, position_simulator_1.closePositionAt)(open, ts, hit.closePrice, hit.closeReason, barIdx - open.entryBarIndex);
                    trades.push({ id: ++tradeId, ...closed });
                    cooldown?.onTradeClose(closed.pnlUsd, ts);
                    open = null;
                }
                else {
                    blocks.open_position += 1;
                    continue;
                }
            }
            else {
                blocks.open_position += 1;
                continue;
            }
        }
        const htfRegime1h = getHtfRegime(htfTf, ts);
        const htfRegimeAlt = altTf ? getHtfRegime(altTf, ts) : undefined;
        const state1h = getHtfState('1h', ts);
        const state15m = getHtfState('15m', ts);
        if (cooldown?.isBlocked(ts)) {
            blocks.cooldown += 1;
            continue;
        }
        const evaluations = [];
        for (const tf of timeframes) {
            const slice = (0, candle_loader_1.closedCandlesUpTo)(loaded.byTf[tf] ?? [], ts, tf);
            if (slice.length < 50)
                continue;
            const result = await gate.evaluate({
                candles: slice,
                symbol,
                timeframe: tf,
                htfRegime: tf !== htfTf ? htfRegime1h : undefined,
            });
            evaluations.push({ timeframe: tf, result, candles: slice });
        }
        const passing = evaluations.filter((e) => e.result.pass);
        if (passing.length === 0) {
            blocks.signal_gate += 1;
            continue;
        }
        passing.sort((a, b) => (0, signal_gate_ranking_1.compareSignalGateForEntry)({ timeframe: a.timeframe, result: a.result }, { timeframe: b.timeframe, result: b.result }));
        const pick = passing[0];
        const signalBarTs = pick.result.setupResult.evidence.lastCandleTime ?? ts;
        const signalKey = `${pick.timeframe}:${signalBarTs}`;
        if (seenSignals.has(signalKey)) {
            blocks.duplicate_signal += 1;
            continue;
        }
        seenSignals.add(signalKey);
        signalsPassed += 1;
        const gateRegime = pick.result.gateRegime ?? pick.result.setupResult.regime;
        const rangeLike = gateRegime === 'range' || gateRegime === 'chop';
        const rangeBlocked = variant.blockRangeEntries ?? (0, v3_entry_policy_1.isRangeEntryBlocked)(gateRegime);
        const rangePlaybookBlocked = rangeLike &&
            variant.rangeAllowedPlaybooks != null &&
            !variant.rangeAllowedPlaybooks.includes(pick.result.setupResult.playbookKey ?? '');
        if (rangeBlocked || rangePlaybookBlocked) {
            blocks.regime += 1;
            continue;
        }
        const side = (0, setup_trade_side_1.inferSetupTradeSide)(pick.result.setupResult, pick.timeframe, pick.candles);
        if (!side) {
            blocks.no_direction += 1;
            continue;
        }
        // Grade A breakout skips 1h-trend only for longs (shorts need HTF).
        const breakoutImpulse = (0, v3_regime_policy_1.shouldBypassRegimeForBreakout)(pick.timeframe, pick.result.setupResult.playbookKey, pick.result.setupResult.grade) && side === 'long';
        const skipHtfForRange = rangeLike && variant.skipHtfTrendForRange === true;
        if (requiredHtfTf && !breakoutImpulse && !skipHtfForRange) {
            const requiredHtfRegime = requiredHtfTf === htfTf ? htfRegime1h : getHtfRegime(requiredHtfTf, ts);
            const htfCheck = (0, v3_entry_policy_1.evaluateHtfTrendRequirement)({
                entryTimeframe: pick.timeframe,
                primaryTf: requiredHtfTf,
                primaryRegime: requiredHtfRegime,
                altTf: altTf ?? undefined,
                altRegime: htfRegimeAlt,
            });
            if (!htfCheck.pass) {
                blocks.htf += 1;
                continue;
            }
        }
        let structBias;
        if (structureEnabledForRun) {
            const structSlice = (0, candle_loader_1.closedCandlesUpTo)(loaded.byTf[structTf] ?? [], ts, structTf, structureLookback);
            const structCheck = (0, v3_structure_bias_policy_1.evaluateStructureSidePermission)({
                side,
                candles: structSlice,
                enabled: structureEnabledForRun,
                shortRequireBos: variant.structureShortRequireBos,
                longRequireBos: variant.structureLongRequireBos,
            });
            if (!structCheck.pass) {
                blocks.structure_bias += 1;
                continue;
            }
            structBias = structCheck.bias;
        }
        const alignState = getHtfState(alignTf, ts);
        const sideAlign = (0, v3_entry_policy_1.evaluateHtfSideAlign)({
            side,
            htfTf: alignTf,
            htf: alignState,
            structureBias: structBias,
            enabled: variant.requireHtfSideAlign,
            failClosed: variant.htfSideAlignFailClosed,
        });
        if (!sideAlign.pass) {
            blocks.side_align += 1;
            continue;
        }
        const gradeFilter = (0, v3_entry_policy_1.evaluateSetupGradePlaybookFilter)({
            grade: pick.result.setupResult.grade,
            confidence: pick.result.setupResult.confidence,
            playbookKey: pick.result.setupResult.playbookKey,
            minGrade: variant.minGrade,
            gradeBMinConfidence: variant.gradeBMinConfidence,
            gradeBAllowedPlaybooks: variant.gradeBAllowedPlaybooks,
        });
        if (!gradeFilter.pass) {
            blocks.grade_playbook += 1;
            continue;
        }
        const fiveMGuard = (0, v3_entry_policy_1.evaluate5mEntryGuards)({
            entryTimeframe: pick.timeframe,
            side,
            tf1h: state1h,
            tf15m: state15m,
            block5mWhen1hRange: variant.block5mWhen1hRange,
            require5mHtfConfirm: variant.require5mHtfConfirm,
        });
        if (!fiveMGuard.pass) {
            blocks.entry_5m_guard += 1;
            continue;
        }
        const action = side === 'long' ? 'buy' : 'sell';
        const entry = bar.close;
        if (requirePullbackForRun) {
            const period = (0, v3_entry_policy_1.getV3PullbackSmaPeriod)();
            const pullbackCandles = (0, candle_loader_1.closedCandlesUpTo)(loaded.byTf[pullbackTf] ?? [], ts, pullbackTf);
            const maxAbovePct = breakoutImpulse
                ? variant.breakoutPullbackMaxAbovePct ?? (0, v3_entry_policy_1.getV3BreakoutPullbackMaxAbovePct)()
                : variant.pullbackMaxAbovePct ?? (0, v3_entry_policy_1.getV3PullbackMaxAbovePct)();
            const pullback = (0, v3_entry_policy_1.evaluateTrendPullbackEntry)({
                side,
                entry,
                closes: pullbackCandles.map((c) => c.close),
                smaPeriod: period,
                maxAbovePct,
                maxBelowPct: variant.pullbackMaxBelowPct ?? (0, v3_entry_policy_1.getV3PullbackMaxBelowPct)(),
                tfLabel: `SMA${period}@${pullbackTf}`,
            });
            if (!pullback.pass) {
                blocks.pullback += 1;
                continue;
            }
        }
        const levels = (0, trade_levels_1.computePolicyCompliantStopAndTarget)({
            action,
            entry,
            minSlPct,
            minRr,
        });
        if (!levels)
            continue;
        const slDistancePct = (Math.abs(entry - levels.stopLoss) / entry) * 100;
        const rr = Math.abs(levels.takeProfit - entry) / Math.abs(entry - levels.stopLoss);
        let executableNotional = notionalUsd;
        if (options.executionWalletUsd != null) {
            const wallet = options.executionWalletUsd + trades.reduce((sum, trade) => sum + trade.pnlUsd, 0);
            const stopFraction = Math.abs(entry - levels.stopLoss) / entry;
            const desired = Math.min(policy.maxTotalExposureUsd, wallet * policy.riskPerTradePercent / 100 / stopFraction);
            const qty = Math.max(0.001, Math.ceil(50 / entry / 0.001 - 1e-9) * 0.001, Math.floor(desired / entry / 0.001 + 1e-9) * 0.001);
            executableNotional = qty * entry;
            const dayKey = (time) => Math.floor((time + 7 * 3600_000) / 86400_000);
            const dayPnl = trades.filter(t => dayKey(t.closeTime) === dayKey(ts)).reduce((sum, t) => sum + t.pnlUsd, 0);
            const dayStart = wallet - dayPnl;
            const risk = wallet > 0 ? (0, execution_risk_1.computeExecutionRisk)({ entry, stopLoss: levels.stopLoss, quantity: qty, balance: wallet,
                roundTripFeePercent: Math.max(0.1, feePctPerSide * 200), slippagePercent: Math.max(0.1, (options.slippagePct ?? 0.001) * 100) }) : null;
            if (!risk || executableNotional > policy.maxTotalExposureUsd + 1e-9 ||
                risk.totalRiskUsd > (0, execution_risk_1.resolveExecutionRiskCapUsd)({ balance: wallet, maxRiskPercent: policy.maxEffectiveRiskPerTradePercent, maxRiskUsd: policy.maxEffectiveRiskPerTradeUsd }) + 1e-9 ||
                (policy.circuitDailyLossEnabled && risk.totalRiskUsd > dayStart * policy.dailyLossLimitPercent / 100 + Math.min(0, dayPnl))) {
                blocks.execution_risk = (blocks.execution_risk ?? 0) + 1;
                continue;
            }
        }
        open = {
            id: tradeId + 1,
            side,
            timeframe: pick.timeframe,
            playbookKey: pick.result.setupResult.playbookKey,
            grade: pick.result.setupResult.grade,
            entryTime: ts,
            entryPrice: entry,
            stopLoss: levels.stopLoss,
            takeProfit: levels.takeProfit,
            slDistancePct,
            rr,
            notionalUsd: executableNotional,
            feePctPerSide,
            slippagePct: options.slippagePct ?? (options.executionWalletUsd != null ? 0.001 : 0),
            entryBarIndex: barIdx,
        };
    }
    if (open) {
        const closed = (0, position_simulator_1.simulatePositionExit)(open, walkBars, open.entryBarIndex + 1);
        if (closed) {
            trades.push({ id: ++tradeId, ...closed });
            cooldown?.onTradeClose(closed.pnlUsd, closed.closeTime);
        }
    }
    const wins = trades.filter((t) => t.pnlUsd > 0).length;
    const losses = trades.filter((t) => t.pnlUsd < 0).length;
    const grossPnl = trades.reduce((s, t) => s + t.pnlUsd + (t.feeUsd ?? 0) + (t.slippageUsd ?? 0), 0);
    const fees = trades.reduce((s, t) => s + (t.feeUsd ?? 0), 0);
    const netPnl = trades.reduce((s, t) => s + t.pnlUsd, 0);
    return {
        symbol,
        period: {
            start: loaded.period.start.toISOString(),
            end: loaded.period.end.toISOString(),
            weeks: options.days ? options.days / 7 : weeks,
        },
        config: {
            minSlPct,
            minRr,
            notionalUsd,
            feePctPerSide,
            timeframes,
            entryTfPriority: Object.entries(entryRank)
                .sort((a, b) => a[1] - b[1])
                .map(([tf]) => tf),
        },
        variant,
        summary: {
            steps: walkBars.length,
            signalsPassed,
            entries: trades.length,
            wins,
            losses,
            winRate: trades.length ? wins / trades.length : 0,
            netPnlUsd: netPnl,
            grossPnlUsd: grossPnl,
            feesUsd: fees,
            avgSlPct: trades.length
                ? trades.reduce((s, t) => s + t.slDistancePct, 0) / trades.length
                : 0,
            avgBarsHeld: trades.length
                ? trades.reduce((s, t) => s + t.barsHeld, 0) / trades.length
                : 0,
            maxConsecutiveLosses: maxLossStreak(trades),
        },
        blocks,
        slBuckets: buildSlBuckets(trades),
        breakdown: (0, breakdown_1.buildAllBreakdowns)(trades),
        trades,
    };
}
/** Compare multiple min-SL settings on the same period (offline sweep). */
async function runHistoricalTestbedSlSweep(slPcts, baseOptions = {}) {
    const results = [];
    for (const minSlPct of slPcts) {
        results.push(await runHistoricalTestbed({ ...baseOptions, minSlPct }));
    }
    return results;
}
function formatTestbedReport(result) {
    const s = result.summary;
    const variantLine = result.variant ? `Variant: ${result.variant.id} — ${result.variant.label}` : '';
    const lines = [
        `=== Historical Testbed: ${result.symbol} ===`,
        variantLine,
        `Period: ${result.period.start.slice(0, 10)} → ${result.period.end.slice(0, 10)} (~${result.period.weeks.toFixed(1)}w)`,
        `Config: minSL=${(result.config.minSlPct * 100).toFixed(2)}% RR>=${result.config.minRr} notional=$${result.config.notionalUsd}`,
        `TFs: ${result.config.timeframes.join(', ')} | entry priority: ${result.config.entryTfPriority.join(' → ')}`,
        '',
        `Steps (5m bars): ${s.steps}`,
        `Unique gate-pass signals: ${s.signalsPassed} → entries: ${s.entries}`,
        `W/L: ${s.wins}/${s.losses} (${(s.winRate * 100).toFixed(1)}% WR)`,
        `Net PnL: $${s.netPnlUsd.toFixed(2)} (fees ~$${s.feesUsd.toFixed(2)})`,
        `Avg SL: ${s.avgSlPct.toFixed(3)}% | avg hold: ${s.avgBarsHeld.toFixed(1)} bars (5m)`,
        `Max loss streak: ${s.maxConsecutiveLosses}`,
        '',
        'Blocks:',
        `  signal_gate: ${result.blocks.signal_gate}`,
        `  regime: ${result.blocks.regime}`,
        `  htf: ${result.blocks.htf}`,
        `  structure_bias: ${result.blocks.structure_bias}`,
        `  side_align: ${result.blocks.side_align}`,
        `  entry_5m_guard: ${result.blocks.entry_5m_guard}`,
        `  grade_playbook: ${result.blocks.grade_playbook}`,
        `  pullback: ${result.blocks.pullback}`,
        `  cooldown: ${result.blocks.cooldown}`,
        `  no_direction: ${result.blocks.no_direction}`,
        `  duplicate_signal: ${result.blocks.duplicate_signal}`,
        `  skipped_open_position: ${result.blocks.open_position}`,
        '',
        'SL buckets:',
        ...result.slBuckets.map((b) => `  ${b.bucket}: n=${b.n} W/L=${b.wins}/${b.losses} net=$${b.netPnl.toFixed(2)}`),
    ];
    if (result.breakdown) {
        lines.push('', ...(0, breakdown_1.formatBreakdownSection)('By timeframe', result.breakdown.byTimeframe), '', ...(0, breakdown_1.formatBreakdownSection)('By playbook', result.breakdown.byPlaybook), '', ...(0, breakdown_1.formatBreakdownSection)('By grade', result.breakdown.byGrade), '', ...(0, breakdown_1.formatBreakdownSection)('By side', result.breakdown.bySide), '', ...(0, breakdown_1.formatBreakdownSection)('By day (UTC)', result.breakdown.byDay), '', ...(0, breakdown_1.formatBreakdownSection)('By week (UTC)', result.breakdown.byWeek));
    }
    if (result.trades.length > 0) {
        lines.push('', 'Trades:');
        for (const t of result.trades) {
            lines.push(`  ${new Date(t.entryTime).toISOString().slice(0, 16)} ${t.side} ${t.timeframe} ` +
                `SL=${t.slDistancePct.toFixed(2)}% → ${t.closeReason} PnL=$${t.pnlUsd.toFixed(2)}`);
        }
    }
    return lines.join('\n');
}
//# sourceMappingURL=historical-testbed.service.js.map