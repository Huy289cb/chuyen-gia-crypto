"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.runAdaptiveSetupReplay = runAdaptiveSetupReplay;
const setup_gate_analyzer_1 = require("../analyzers/setup-gate.analyzer");
const market_regime_analyzer_1 = require("../analyzers/market-regime.analyzer");
const adaptive_setup_policy_1 = require("../config/adaptive-setup-policy");
const v3_structure_bias_policy_1 = require("../config/v3-structure-bias-policy");
const risk_policy_1 = require("../config/risk-policy");
const setup_trade_side_1 = require("../utils/setup-trade-side");
const structure_bias_1 = require("../utils/structure-bias");
const adaptive_setup_1 = require("../utils/adaptive-setup");
const candle_loader_1 = require("./candle-loader");
const KINDS = [
    'early_structure_flip',
    'aligned_micro_bos',
    'range_sweep_reclaim',
];
function finite(value) {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
}
function state(candles, timeframe) {
    if (candles.length < 50) {
        return { fresh: false, regime: 'unknown', trendDirection: null, candles };
    }
    const evidence = (0, market_regime_analyzer_1.computeRegimeEvidence)(candles, { timeframe });
    return {
        fresh: true,
        regime: evidence.regime,
        trendDirection: evidence.trendDirection,
        candles,
    };
}
function candidatePassesRetest(input) {
    if (!(0, adaptive_setup_1.retestCandleRejects)(input.candidate.side, input.candle))
        return false;
    const expected = input.candidate.side === 'long' ? 'bullish' : 'bearish';
    const opposed = input.candidate.side === 'long' ? 'bearish' : 'bullish';
    if (input.candidate.kind === 'early_structure_flip') {
        return (input.htf1h.fresh &&
            input.htf1h.regime === 'trend' &&
            input.htf1h.trendDirection === expected);
    }
    if (input.candidate.kind === 'aligned_micro_bos') {
        return (input.htf1h.fresh &&
            input.htf1h.trendDirection !== opposed &&
            input.htf15m.fresh &&
            (0, adaptive_setup_1.hasMicroBos)(input.candidate.side, input.htf15m.candles, input.microBosStrength).pass);
    }
    return (input.htf1h.fresh &&
        input.htf1h.regime === 'range' &&
        (!input.rangeRequireMicroBos ||
            (0, adaptive_setup_1.hasMicroBos)(input.candidate.side, input.localCandles, input.microBosStrength).pass));
}
function emptyStats() {
    return {
        candidates: 0,
        confirmed: 0,
        expired: 0,
        invalidated: 0,
        outcomes: 0,
        wins: 0,
        losses: 0,
        sumNetR: 0,
        avgNetR: 0,
        profitFactorNet: 0,
    };
}
function finishStats(stats, outcomes) {
    for (const kind of KINDS) {
        const values = outcomes.filter((row) => row.kind === kind).map((row) => row.netR);
        const wins = values.filter((value) => value > 0);
        const losses = values.filter((value) => value < 0);
        const profit = wins.reduce((sum, value) => sum + value, 0);
        const loss = Math.abs(losses.reduce((sum, value) => sum + value, 0));
        Object.assign(stats[kind], {
            outcomes: values.length,
            wins: wins.length,
            losses: losses.length,
            sumNetR: values.reduce((sum, value) => sum + value, 0),
            avgNetR: values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0,
            profitFactorNet: loss > 0 ? profit / loss : profit > 0 ? null : 0,
        });
    }
}
function closePosition(position, bar, closePrice, closeReason, feePctPerSide) {
    const risk = Math.abs(position.entryPrice - position.stopLoss);
    const move = position.side === 'long'
        ? closePrice - position.entryPrice
        : position.entryPrice - closePrice;
    const grossR = risk > 0 ? move / risk : 0;
    const feeR = risk > 0 ? (position.entryPrice * feePctPerSide * 2) / risk : 0;
    return {
        kind: position.kind,
        side: position.side,
        timeframe: position.timeframe,
        grade: position.grade,
        detectedAt: position.detectedAt,
        confirmedAt: position.confirmedAt,
        closedAt: (0, candle_loader_1.candleCloseTimestamp)(bar, '5m'),
        entryPrice: position.entryPrice,
        stopLoss: position.stopLoss,
        takeProfit: position.takeProfit,
        closePrice,
        closeReason,
        grossR,
        netR: grossR - feeR,
        barsHeld: position.barsHeld,
        context: position.context,
    };
}
/**
 * Closed-candle, stateful replay of candidate -> later retest -> fixed SL/TP.
 * Each setup family is evaluated as an independent strategy so one family
 * cannot hide another merely by occupying the single live position slot.
 */
async function runAdaptiveSetupReplay(input) {
    const symbol = input.symbol ?? 'BTC';
    const minSlPct = input.minSlPct ?? (0, risk_policy_1.getRiskPolicy)().minSlDistancePercent;
    const feePctPerSide = input.feePctPerSide ?? (0, adaptive_setup_policy_1.getAdaptiveFeePctPerSide)();
    const maxHoldHours = input.maxHoldHours ?? 48;
    const rangeEdgeFraction = input.rangeEdgeFraction ?? (0, adaptive_setup_policy_1.getRangeSweepEdgeFraction)();
    const microBosStrength = input.microBosStrength ?? (0, adaptive_setup_policy_1.getAdaptiveMicroBosStrength)();
    const rangeRequireMicroBos = input.rangeRequireMicroBos ?? (0, adaptive_setup_policy_1.isRangeSweepRetestBosRequired)();
    const microRequire1hAlign = input.microRequire1hAlign ?? (0, adaptive_setup_policy_1.isAlignedMicroBosRequire1hAlign)();
    const rangeLong5mOnly = input.rangeLong5mOnly ?? (0, adaptive_setup_policy_1.isRangeSweepLong5mOnly)();
    const master = (input.byTf['5m'] ?? []).filter((bar) => bar.timestamp >= input.start.getTime() && (0, candle_loader_1.candleCloseTimestamp)(bar, '5m') <= input.end.getTime());
    const stats = Object.fromEntries(KINDS.map((kind) => [kind, emptyStats()]));
    const candidates = new Map();
    const positions = new Map();
    const seenWaves = new Set();
    const outcomes = [];
    const lastProcessed = new Map();
    let cached1h = null;
    let cached15m = null;
    let cachedStructure = null;
    for (const bar of master) {
        const decisionTs = (0, candle_loader_1.candleCloseTimestamp)(bar, '5m');
        const htf1hCandles = (0, candle_loader_1.closedCandlesUpTo)(input.byTf['1h'] ?? [], decisionTs, '1h', 150);
        const htf15mCandles = (0, candle_loader_1.closedCandlesUpTo)(input.byTf['15m'] ?? [], decisionTs, '15m', 150);
        const structureCandles = (0, candle_loader_1.closedCandlesUpTo)(input.byTf['4h'] ?? [], decisionTs, '4h', (0, v3_structure_bias_policy_1.getV3StructureBiasCandleLimit)());
        const key1h = htf1hCandles.at(-1)?.timestamp ?? null;
        const key15m = htf15mCandles.at(-1)?.timestamp ?? null;
        const keyStructure = structureCandles.at(-1)?.timestamp ?? null;
        if (!cached1h || cached1h.key !== key1h) {
            cached1h = { key: key1h, value: state(htf1hCandles, '1h') };
        }
        if (!cached15m || cached15m.key !== key15m) {
            cached15m = { key: key15m, value: state(htf15mCandles, '15m') };
        }
        if (!cachedStructure || cachedStructure.key !== keyStructure) {
            cachedStructure = {
                key: keyStructure,
                value: (0, structure_bias_1.classifyStructureBias)(structureCandles, {
                    strength: (0, v3_structure_bias_policy_1.getV3StructureBiasStrength)(),
                }),
            };
        }
        const htf1h = cached1h.value;
        const htf15m = cached15m.value;
        const structure = cachedStructure.value;
        for (const [kind, position] of [...positions.entries()]) {
            if (bar.timestamp <= position.entryBarOpenMs)
                continue;
            position.barsHeld += 1;
            const slHit = position.side === 'long'
                ? bar.low <= position.stopLoss
                : bar.high >= position.stopLoss;
            const tpHit = position.side === 'long'
                ? bar.high >= position.takeProfit
                : bar.low <= position.takeProfit;
            let closePrice = null;
            let reason = null;
            // Conservative same-bar ordering, identical to the existing simulator.
            if (slHit) {
                closePrice = position.stopLoss;
                reason = 'stop_loss';
            }
            else if (tpHit) {
                closePrice = position.takeProfit;
                reason = 'take_profit';
            }
            else if (decisionTs - position.confirmedAt >= maxHoldHours * 3_600_000) {
                closePrice = bar.close;
                reason = 'max_hold';
            }
            if (reason && closePrice != null) {
                outcomes.push(closePosition(position, bar, closePrice, reason, feePctPerSide));
                positions.delete(kind);
            }
        }
        for (const timeframe of ['15m', '5m']) {
            const localCandles = (0, candle_loader_1.closedCandlesUpTo)(input.byTf[timeframe] ?? [], decisionTs, timeframe, 150);
            const latest = localCandles.at(-1);
            if (!latest || (0, candle_loader_1.candleCloseTimestamp)(latest, timeframe) !== decisionTs)
                continue;
            if (lastProcessed.get(timeframe) === latest.timestamp)
                continue;
            lastProcessed.set(timeframe, latest.timestamp);
            for (const [slot, candidate] of [...candidates.entries()]) {
                if (candidate.timeframe !== timeframe || latest.timestamp <= candidate.breakoutBarOpenMs)
                    continue;
                if (decisionTs >= candidate.expiresAt) {
                    stats[candidate.kind].expired += 1;
                    candidates.delete(slot);
                    continue;
                }
                const invalidation = 0.0025;
                const invalidated = candidate.side === 'long'
                    ? latest.close < candidate.boundary * (1 - invalidation)
                    : latest.close > candidate.boundary * (1 + invalidation);
                if (invalidated) {
                    stats[candidate.kind].invalidated += 1;
                    candidates.delete(slot);
                    continue;
                }
                const tolerance = 0.0015;
                const touches = candidate.side === 'long'
                    ? latest.low <= candidate.boundary * (1 + tolerance)
                    : latest.high >= candidate.boundary * (1 - tolerance);
                const holds = candidate.side === 'long'
                    ? latest.close >= candidate.boundary
                    : latest.close <= candidate.boundary;
                if (!touches || !holds || positions.has(candidate.kind))
                    continue;
                if (!candidatePassesRetest({
                    candidate,
                    candle: latest,
                    localCandles,
                    htf1h,
                    htf15m,
                    microBosStrength,
                    rangeRequireMicroBos,
                })) {
                    continue;
                }
                const rr = input.rrByKind?.[candidate.kind] ?? (0, adaptive_setup_policy_1.getAdaptiveSetupRr)(candidate.kind);
                const entry = latest.close;
                const riskDistance = entry * minSlPct;
                positions.set(candidate.kind, {
                    ...candidate,
                    confirmedAt: decisionTs,
                    entryBarOpenMs: latest.timestamp,
                    entryPrice: entry,
                    stopLoss: candidate.side === 'long' ? entry - riskDistance : entry + riskDistance,
                    takeProfit: candidate.side === 'long'
                        ? entry + riskDistance * rr
                        : entry - riskDistance * rr,
                    rr,
                    barsHeld: 0,
                });
                stats[candidate.kind].confirmed += 1;
                candidates.delete(slot);
            }
            const setup = await (0, setup_gate_analyzer_1.analyzeSetupGate)({ candles: localCandles, symbol, timeframe });
            if (setup.grade !== 'A' && setup.grade !== 'B')
                continue;
            const side = (0, setup_trade_side_1.inferSetupTradeSide)(setup, timeframe, localCandles);
            if (!side || !setup.playbookKey)
                continue;
            const evidence = setup.evidence.playbooks.find((row) => setup.playbookKey === 'liquidity_sweep_reclaim'
                ? row.playbook === 'liquidity_sweep'
                : row.playbook === setup.playbookKey);
            const boundary = finite(side === 'long' ? evidence?.metrics.resistance : evidence?.metrics.support);
            const detected = (0, adaptive_setup_1.detectAdaptiveSetup)({
                side,
                timeframe,
                playbook: setup.playbookKey,
                grade: setup.grade,
                close: latest.close,
                boundary,
                structureBias: structure.bias,
                structureDetail: structure,
                htf1h,
                htf15m,
                selectedMetrics: evidence?.metrics ?? null,
                rangeEdgeFraction,
                microBosStrength,
                microRequire1hAlign,
                rangeLong5mOnly,
            });
            if (!detected)
                continue;
            const waveKey = `${detected.kind}:${side}:${Math.floor(decisionTs / 3_600_000)}`;
            const slot = `${detected.kind}:${timeframe}:${side}`;
            if (seenWaves.has(waveKey) || candidates.has(slot) || positions.has(detected.kind))
                continue;
            const replayCandidate = {
                kind: detected.kind,
                side,
                timeframe,
                grade: setup.grade,
                boundary: detected.boundary,
                detectedAt: decisionTs,
                breakoutBarOpenMs: latest.timestamp,
                expiresAt: decisionTs +
                    (input.ttlByKind?.[detected.kind] ?? (0, adaptive_setup_policy_1.getAdaptiveSetupTtlMinutes)(detected.kind)) * 60_000,
                context: {
                    ...detected.evidence,
                    structure_bias: structure.bias,
                    htf_1h_regime: htf1h.regime,
                    htf_1h_direction: htf1h.trendDirection,
                    htf_15m_regime: htf15m.regime,
                    htf_15m_direction: htf15m.trendDirection,
                },
            };
            if (input.candidateFilter && !input.candidateFilter(replayCandidate))
                continue;
            seenWaves.add(waveKey);
            candidates.set(slot, replayCandidate);
            stats[detected.kind].candidates += 1;
        }
    }
    const finalBar = master.at(-1);
    if (finalBar) {
        for (const position of positions.values()) {
            outcomes.push(closePosition(position, finalBar, finalBar.close, 'end_of_data', feePctPerSide));
        }
    }
    finishStats(stats, outcomes);
    return {
        period: { start: input.start.toISOString(), end: input.end.toISOString() },
        config: {
            minSlPct,
            feePctPerSide,
            maxHoldHours,
            rangeEdgeFraction,
            microBosStrength,
            rangeRequireMicroBos,
            microRequire1hAlign,
            rangeLong5mOnly,
        },
        byKind: stats,
        outcomes,
    };
}
//# sourceMappingURL=adaptive-setup-replay.js.map