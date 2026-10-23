"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.evaluateEntryGateFunnel = evaluateEntryGateFunnel;
exports.recordEntryGateFunnel = recordEntryGateFunnel;
exports.clearEntryGateFunnelDedupForTests = clearEntryGateFunnelDedupForTests;
const entry_feasibility_observation_1 = require("../utils/entry-feasibility-observation");
const risk_policy_1 = require("../config/risk-policy");
const methods_1 = require("../config/methods");
const candle_service_1 = require("./candle.service");
const v3_entry_policy_1 = require("../config/v3-entry-policy");
const v3_structure_bias_policy_1 = require("../config/v3-structure-bias-policy");
const funding_veto_1 = require("../config/funding-veto");
const market_1 = require("./binance/market");
const setup_trade_side_1 = require("../utils/setup-trade-side");
const closed_candles_1 = require("../utils/closed-candles");
const candle_hash_1 = require("../utils/candle-hash");
const scan_freshness_1 = require("../utils/scan-freshness");
const v3_entry_eligibility_service_1 = require("./v3-entry-eligibility.service");
const testnet_repository_1 = require("../repositories/testnet.repository");
const recordedKeys = new Set();
function gate(pass, reason, observed) {
    return { status: pass ? 'pass' : 'block', reason, observed };
}
function unavailable(reason) {
    return { status: 'unavailable', reason };
}
function notApplicable(reason) {
    return { status: 'not_applicable', reason };
}
function readFreshScan(input, timeframe) {
    const scan = input.getScan(timeframe);
    const freshness = (0, scan_freshness_1.evaluateScanFreshness)(scan?.timestamp, { label: `HTF ${timeframe}` });
    if (!scan || !freshness.pass) {
        return {
            fresh: false,
            regime: 'unknown',
            trendDirection: null,
            reason: freshness.reason ?? `HTF ${timeframe} unavailable`,
        };
    }
    return {
        fresh: true,
        regime: (0, v3_entry_policy_1.resolveGateRegimeFromSignal)(scan.signalResult),
        trendDirection: scan.signalResult.setupResult.evidence.regime.trendDirection ?? null,
    };
}
function breakoutMetrics(signalResult) {
    const evidence = signalResult.setupResult.evidence.playbooks.find((row) => row.playbook === 'breakout_volume');
    return evidence?.metrics ? { ...evidence.metrics } : null;
}
async function evaluateEntryGateFunnel(input) {
    const asOf = Date.now();
    let structureCandles = [];
    const setup = input.signalResult.setupResult;
    const side = (0, setup_trade_side_1.inferSetupTradeSide)(setup, input.timeframe, input.candles);
    const gateRegime = (0, v3_entry_policy_1.resolveGateRegimeFromSignal)(input.signalResult);
    const gates = {};
    gates.signal_gate = gate(input.signalResult.pass, input.signalResult.reason, {
        grade: setup.grade,
        confidence: setup.confidence,
        local_regime: setup.regime,
        gate_regime: gateRegime,
    });
    gates.direction = side
        ? gate(true, `playbook side ${side}`)
        : gate(false, 'playbook direction unavailable');
    gates.regime = gate(!(0, v3_entry_policy_1.isRangeEntryBlocked)(gateRegime), `gate regime ${gateRegime}`);
    const gradeCheck = (0, v3_entry_policy_1.evaluateSetupGradePlaybookFilter)({
        grade: setup.grade,
        confidence: setup.confidence,
        playbookKey: setup.playbookKey,
    });
    gates.grade_playbook = gate(gradeCheck.pass, gradeCheck.reason);
    let structureBias = null;
    let structureDetail = null;
    if (!side) {
        gates.structure = gate(false, 'structure cannot evaluate without side');
    }
    else if (!(0, v3_structure_bias_policy_1.isV3StructureBiasEnabled)()) {
        gates.structure = notApplicable('structure disabled');
    }
    else {
        try {
            const tf = (0, v3_structure_bias_policy_1.getV3StructureBiasTf)();
            const limit = (0, v3_structure_bias_policy_1.getV3StructureBiasCandleLimit)();
            const { candles: fetched } = await (0, candle_service_1.getCandles)({
                symbol: input.symbol,
                timeframe: tf,
                limit: limit + 1,
            });
            const closed = (0, closed_candles_1.closedCandlesOnly)(fetched, tf).slice(-limit);
            structureCandles = closed;
            const check = (0, v3_structure_bias_policy_1.evaluateStructureSidePermission)({ side, candles: closed });
            structureBias = check.bias;
            structureDetail = check.detail ?? null;
            gates.structure = gate(check.pass, check.reason, {
                bias: check.bias,
                swing_highs: check.detail?.swingHighs ?? [],
                swing_lows: check.detail?.swingLows ?? [],
            });
        }
        catch (error) {
            const reason = error instanceof Error ? error.message : String(error);
            gates.structure = unavailable(`structure unavailable: ${reason}`);
        }
    }
    const primaryTf = (0, v3_entry_policy_1.getV3RequireHtfTrend)();
    if (!primaryTf) {
        gates.htf_trend = notApplicable('HTF trend requirement disabled');
    }
    else {
        const primary = readFreshScan(input, primaryTf);
        const altTf = (0, v3_entry_policy_1.getV3HtfTrendAlt)();
        const alt = altTf ? readFreshScan(input, altTf) : null;
        if (!primary.fresh) {
            gates.htf_trend = unavailable(primary.reason ?? `${primaryTf} unavailable`);
        }
        else {
            const check = (0, v3_entry_policy_1.evaluateHtfTrendRequirement)({
                entryTimeframe: input.timeframe,
                primaryTf,
                primaryRegime: primary.regime,
                altTf,
                altRegime: alt?.fresh ? alt.regime : 'unknown',
            });
            gates.htf_trend = gate(check.pass, check.reason, {
                primary_tf: primaryTf,
                primary_regime: primary.regime,
                alt_tf: altTf,
                alt_regime: alt?.regime,
            });
        }
    }
    if (!side) {
        gates.side_align = gate(false, 'side align cannot evaluate without side');
    }
    else if (!(0, v3_entry_policy_1.isV3RequireHtfSideAlign)()) {
        gates.side_align = notApplicable('HTF side alignment disabled');
    }
    else {
        const alignTf = (0, v3_entry_policy_1.getV3HtfSideAlignTf)();
        const align = readFreshScan(input, alignTf);
        if (!align.fresh) {
            gates.side_align = unavailable(align.reason ?? `${alignTf} unavailable`);
        }
        else {
            const check = (0, v3_entry_policy_1.evaluateHtfSideAlign)({
                side,
                htfTf: alignTf,
                htf: align,
                structureBias: structureBias ?? undefined,
            });
            gates.side_align = gate(check.pass, check.reason, {
                htf_tf: alignTf,
                regime: align.regime,
                trend_direction: align.trendDirection,
            });
        }
    }
    if (input.timeframe !== '5m') {
        gates.entry_5m_guard = notApplicable('entry timeframe is not 5m');
    }
    else if (!side) {
        gates.entry_5m_guard = gate(false, '5m guard cannot evaluate without side');
    }
    else {
        const tf1h = readFreshScan(input, '1h');
        const tf15m = readFreshScan(input, '15m');
        const check = (0, v3_entry_policy_1.evaluate5mEntryGuards)({
            entryTimeframe: input.timeframe,
            side,
            tf1h,
            tf15m,
        });
        gates.entry_5m_guard = gate(check.pass, check.reason);
    }
    if (!side || !(0, funding_veto_1.isFundingVetoEnabled)()) {
        gates.funding = notApplicable(!side ? 'funding requires side' : 'funding veto disabled');
    }
    else {
        const pair = `${input.symbol.toUpperCase().replace(/USDT$/i, '')}USDT`;
        const rate = await (0, funding_veto_1.fetchCachedFundingRate)(pair, market_1.getPremiumIndex);
        const check = (0, funding_veto_1.evaluateFundingVeto)({ side, fundingRate: rate });
        gates.funding = gate(check.pass, check.reason, { funding_rate: rate });
    }
    if (!side || !(0, v3_entry_policy_1.isV3RequirePullback)()) {
        gates.pullback_proxy = notApplicable(!side ? 'pullback requires side' : 'pullback disabled');
    }
    else {
        try {
            const tf = (0, v3_entry_policy_1.getV3PullbackTf)();
            const period = (0, v3_entry_policy_1.getV3PullbackSmaPeriod)();
            const { candles: fetched } = await (0, candle_service_1.getCandles)({
                symbol: input.symbol,
                timeframe: tf,
                limit: period + 6,
            });
            const closes = (0, closed_candles_1.closedCandlesOnly)(fetched, tf).map((row) => row.close);
            const entry = input.candles.at(-1)?.close;
            if (!(entry && Number.isFinite(entry))) {
                gates.pullback_proxy = unavailable('candidate close unavailable');
            }
            else {
                const maxAbove = setup.playbookKey === 'breakout_volume'
                    ? (0, v3_entry_policy_1.getV3BreakoutPullbackMaxAbovePct)()
                    : (0, v3_entry_policy_1.getV3PullbackMaxAbovePct)();
                const check = (0, v3_entry_policy_1.evaluateTrendPullbackEntry)({
                    side,
                    entry,
                    closes,
                    smaPeriod: period,
                    maxAbovePct: maxAbove,
                    maxBelowPct: (0, v3_entry_policy_1.getV3PullbackMaxBelowPct)(),
                    tfLabel: `SMA${period}@${tf}`,
                });
                gates.pullback_proxy = gate(check.pass, check.reason, {
                    proxy_entry: true,
                    entry,
                    sma: check.sma,
                    dist_pct: check.distPct,
                });
            }
        }
        catch (error) {
            const reason = error instanceof Error ? error.message : String(error);
            gates.pullback_proxy = unavailable(`pullback unavailable: ${reason}`);
        }
    }
    try {
        const eligibility = await (0, v3_entry_eligibility_service_1.canRunLlmDispatchForSymbol)(input.symbol, input.methodId ?? 'kim_nghia');
        gates.account_eligibility = gate(eligibility.allowed, eligibility.reason);
    }
    catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        gates.account_eligibility = unavailable(`eligibility unavailable: ${reason}`);
    }
    const allBlocks = Object.entries(gates)
        .filter(([, result]) => result.status === 'block' || result.status === 'unavailable')
        .map(([name]) => name);
    const diagnosticGates = { ...gates };
    if (!side) {
        diagnosticGates.direction = unavailable('playbook direction unavailable');
        for (const key of ['structure', 'side_align', 'entry_5m_guard']) {
            if (diagnosticGates[key].status !== 'not_applicable')
                diagnosticGates[key] = notApplicable('requires a directional setup');
        }
    }
    const diagnosticBlocks = Object.entries(diagnosticGates)
        .filter(([, g]) => g.status === 'block' || g.status === 'unavailable').map(([key]) => key);
    const barKey = (0, candle_hash_1.generateCandleBarKey)(input.candles);
    return {
        schema_version: 1,
        measurement_version: 2,
        diagnostic_gates: diagnosticGates,
        diagnostic_blocks: diagnosticBlocks,
        legacy_control_fields_preserved: true,
        classification: !side && !input.signalResult.pass && (setup.grade === 'D' || !setup.playbookKey || setup.playbookKey === 'unknown') ? 'no_setup' :
            Object.values(diagnosticGates).some(g => g.status === 'unavailable') ? 'missing_data' : diagnosticBlocks.length ? 'blocked' : 'proxy_pass',
        // Legacy dispatch checks signal/regime and structure before AI; remaining proxies run after AI.
        pre_ai_proxy_pass: ['signal_gate', 'regime', 'direction', 'structure'].every(k => gates[k].status === 'pass' || gates[k].status === 'not_applicable'),
        post_ai_proxy_blocks: allBlocks.filter(k => !['signal_gate', 'regime', 'direction', 'structure'].includes(k)),
        feasibility: (0, entry_feasibility_observation_1.observeEntryFeasibility)({ asOf, timeframe: input.timeframe, candles: input.candles,
            structureCandles, structureTimeframe: (0, v3_structure_bias_policy_1.getV3StructureBiasTf)(), side,
            minSlFraction: (0, risk_policy_1.getRiskPolicy)().minSlDistancePercent,
            minRr: (0, methods_1.getMethodConfig)(input.methodId ?? 'kim_nghia').autoEntry.minRRRatio }),
        observation_key: `${input.symbol.toUpperCase()}:${input.timeframe}:${input.methodId ?? 'kim_nghia'}:${barKey}`,
        bar_key: barKey,
        symbol: input.symbol.toUpperCase(),
        timeframe: input.timeframe,
        evaluated_at: new Date().toISOString(),
        grade: setup.grade,
        confidence: setup.confidence,
        playbook: setup.playbookKey ?? 'unknown',
        side,
        local_regime: setup.regime,
        gate_regime: gateRegime,
        first_block: allBlocks[0] ?? null,
        all_blocks: allBlocks,
        would_pass_pre_llm: allBlocks.length === 0,
        structure_bias: structureBias,
        structure_detail: structureDetail,
        breakout_metrics: breakoutMetrics(input.signalResult),
        gates,
    };
}
async function recordEntryGateFunnel(input) {
    const barKey = (0, candle_hash_1.generateCandleBarKey)(input.candles);
    const dedupKey = `${input.symbol}:${input.timeframe}:${input.methodId ?? 'kim_nghia'}:${barKey}`;
    if (recordedKeys.has(dedupKey))
        return null;
    if (await (0, testnet_repository_1.hasSilentPipelineEventKey)('gate_funnel_shadow', 'observation_key', dedupKey)) {
        return null;
    }
    const observation = await evaluateEntryGateFunnel(input);
    const eventId = await (0, testnet_repository_1.recordSilentPipelineEvent)('gate_funnel_shadow', observation);
    if (eventId === null)
        throw new Error('Gate funnel persistence failed');
    recordedKeys.add(dedupKey);
    if (recordedKeys.size > 4096)
        recordedKeys.delete(recordedKeys.values().next().value);
    return observation;
}
function clearEntryGateFunnelDedupForTests() {
    recordedKeys.clear();
}
