"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.groqDispatchService = exports.GroqDispatchService = void 0;
const entry_feasibility_observation_1 = require("../utils/entry-feasibility-observation");
const entry_trace_1 = require("../utils/entry-trace");
const candle_hash_1 = require("../utils/candle-hash");
const plan_feasibility_1 = require("../utils/plan-feasibility");
/**
 * Groq Dispatch Service
 * Orchestrates LLM calls with strict validation and memory context
 * Only calls Groq when signal gate and risk engine approve
 */
const groq_client_1 = require("./groq-client");
const memory_service_1 = require("./memory.service");
const signal_gate_service_1 = require("./signal-gate.service");
const risk_manager_service_1 = require("./risk-manager.service");
const testnet_repository_1 = require("../repositories/testnet.repository");
const methods_1 = require("../config/methods");
const trade_levels_1 = require("../utils/trade-levels");
const risk_policy_1 = require("../config/risk-policy");
const v3_entry_policy_1 = require("../config/v3-entry-policy");
const v3_structure_bias_policy_1 = require("../config/v3-structure-bias-policy");
const setup_trade_side_1 = require("../utils/setup-trade-side");
const funding_veto_1 = require("../config/funding-veto");
const market_1 = require("./binance/market");
const account_risk_guard_service_1 = require("./account-risk-guard.service");
const market_scan_scheduler_1 = require("../schedulers/market-scan.scheduler");
const candle_service_1 = require("./candle.service");
const candle_hash_2 = require("../utils/candle-hash");
const closed_candles_1 = require("../utils/closed-candles");
const scan_freshness_1 = require("../utils/scan-freshness");
const groq_levels_adapter_service_1 = require("./groq-levels-adapter.service");
const llm_dispatch_dedup_1 = require("../utils/llm-dispatch-dedup");
const v3_regime_policy_1 = require("../config/v3-regime-policy");
const structure_bias_1 = require("../utils/structure-bias");
const trade_levels_2 = require("../utils/trade-levels");
const adaptive_retest_dispatch_1 = require("../utils/adaptive-retest-dispatch");
// SAFETY: Critical safety features are hardcoded to true per Big Update Plan v3
// These cannot be disabled at runtime to prevent unsafe configurations
const DEFAULT_CONFIG = {
    enableMemory: true,
    enableSignalGate: true, // MANDATORY - cannot be disabled
    enableRiskCheck: true, // MANDATORY - cannot be disabled
    maxRetries: 1
};
function readFreshHtfScanState(symbol, timeframe) {
    const scan = (0, market_scan_scheduler_1.getScanResult)(symbol, timeframe);
    const freshness = (0, scan_freshness_1.evaluateScanFreshness)(scan?.timestamp, {
        label: `HTF ${timeframe}`,
    });
    if (!scan || !freshness.pass) {
        return {
            fresh: false,
            regime: 'unknown',
            trendDirection: null,
            reason: freshness.reason ?? `HTF ${timeframe} scan unavailable`,
        };
    }
    return {
        fresh: true,
        regime: (0, v3_entry_policy_1.resolveGateRegimeFromSignal)(scan.signalResult),
        trendDirection: scan.signalResult.setupResult.evidence.regime.trendDirection ?? null,
    };
}
/**
 * Groq Dispatch Service
 */
class GroqDispatchService {
    config;
    constructor(config) {
        // SAFETY: Prevent disabling critical safety features
        const safeConfig = {
            ...config,
            enableSignalGate: true, // Force true - cannot be disabled
            enableRiskCheck: true // Force true - cannot be disabled
        };
        this.config = { ...DEFAULT_CONFIG, ...safeConfig };
        // Log safety enforcement
        if (config && (config.enableSignalGate === false || config.enableRiskCheck === false)) {
            console.warn('[GroqDispatch] WARNING: Attempted to disable safety features - overridden to true');
        }
    }
    /**
     * Main dispatch method - evaluates whether to call Groq and executes if approved
     */
    async dispatch(input) {
        const trace = (0, entry_trace_1.createEntryTrace)({
            observation_key: `${input.symbol.toUpperCase()}:${input.timeframe}:${input.method_id ?? 'kim_nghia'}:${(0, candle_hash_1.generateCandleBarKey)(input.candles)}`,
            candidate_key: input.retestContext?.candidateKey,
            candle_cutoff: input.candles.at(-1)?.timestamp,
            lane: input.retestContext ? 'legacy_retest' : 'legacy_signal',
        }, { risk: (0, risk_policy_1.getRiskPolicy)(), auto: (0, methods_1.getMethodConfig)(input.method_id ?? 'kim_nghia').autoEntry });
        return (0, entry_trace_1.withEntryTrace)(trace, async () => {
            await (0, entry_trace_1.recordEntryStage)('dispatch_started');
            try {
                const result = await this.dispatchTraced(input);
                trace.decision_id = result.decisionRecordId ?? trace.decision_id;
                await (0, entry_trace_1.recordEntryStage)('dispatch_result', { decision: result.decision, reason: result.reason });
                return { ...result, decisionRecordId: trace.decision_id, trace: { ...trace } };
            }
            catch (error) {
                await (0, entry_trace_1.recordEntryStage)('dispatch_error');
                throw error;
            }
        });
    }
    async dispatchTraced(input) {
        const { symbol, timeframe, candles, systemPrompt, method_id = 'kim_nghia', signalResult: precomputed, retestContext, } = input;
        let diagnosticStructure = [];
        const optimizedRangeRetest = (0, adaptive_retest_dispatch_1.isOptimizedRangeRetest)(retestContext);
        if (retestContext?.candidateKind === 'range_sweep_reclaim' && !optimizedRangeRetest) {
            return { decision: 'no_trade', reason: 'adaptive range retest context is not live-policy eligible' };
        }
        const candleHash = (0, candle_hash_2.generateCandleHash)(candles.map((c) => ({
            timestamp: c.timestamp,
            high: c.high,
            low: c.low,
            close: c.close,
        })));
        let signalResult = precomputed;
        let cachedTradeAnalysis;
        // Step 1: Signal Gate — use MarketScan result when provided (single evaluation per cycle)
        if (this.config.enableSignalGate) {
            if (!signalResult) {
                signalResult = await signal_gate_service_1.signalGateService.evaluate({
                    candles,
                    symbol,
                    timeframe
                });
            }
            if (signalResult.isDuplicate) {
                return {
                    decision: 'no_trade',
                    reason: `Signal gate duplicate skip: ${signalResult.reason}`,
                };
            }
            if (!signalResult.shouldCallGroq) {
                return {
                    decision: 'no_trade',
                    reason: `Signal gate blocked: ${signalResult.reason}`
                };
            }
            const gateRegime = (0, v3_entry_policy_1.resolveGateRegimeFromSignal)(signalResult);
            if (!optimizedRangeRetest && !(0, v3_entry_policy_1.isRegimeAllowedForEntry)(gateRegime)) {
                return {
                    decision: 'no_trade',
                    reason: `Regime ${gateRegime} not in V3_ALLOWED_REGIMES (${process.env.V3_ALLOWED_REGIMES ?? 'trend'})`,
                };
            }
        }
        let adaptiveRangeStructureBias;
        if (optimizedRangeRetest && retestContext) {
            try {
                const structTf = (0, v3_structure_bias_policy_1.getV3StructureBiasTf)();
                const structLimit = (0, v3_structure_bias_policy_1.getV3StructureBiasCandleLimit)();
                const { candles: fetched } = await (0, candle_service_1.getCandles)({
                    symbol,
                    timeframe: structTf,
                    limit: structLimit + 1,
                });
                const closed = (0, closed_candles_1.closedCandlesOnly)(fetched, structTf).slice(-structLimit);
                diagnosticStructure = closed;
                adaptiveRangeStructureBias = (0, structure_bias_1.classifyStructureBias)(closed, {
                    strength: (0, v3_structure_bias_policy_1.getV3StructureBiasStrength)(),
                }).bias;
                const validation = (0, adaptive_retest_dispatch_1.validateOptimizedRangeRetest)({
                    context: retestContext,
                    timeframe,
                    signalResult,
                    htf1h: readFreshHtfScanState(symbol, '1h'),
                    structureBias: adaptiveRangeStructureBias,
                });
                if (!validation.pass) {
                    return { decision: 'no_trade', reason: validation.reason };
                }
                console.log(`[GroqDispatch] ${validation.reason}`);
            }
            catch (error) {
                const reason = error instanceof Error ? error.message : String(error);
                return {
                    decision: 'no_trade',
                    reason: `adaptive range retest revalidation unavailable: ${reason}`,
                };
            }
        }
        // Range candidates are already claimed/deduplicated by their stateful key.
        // A trend decision on the same candle is not a review of this range plan.
        if (this.config.enableMemory && !optimizedRangeRetest) {
            const existing = await memory_service_1.memoryService.findDecisionForBar(symbol, timeframe, candleHash, method_id);
            if (existing) {
                const cached = (0, llm_dispatch_dedup_1.buildDispatchOutputFromStoredDecision)(existing);
                if (!(0, llm_dispatch_dedup_1.shouldRevalidateStoredTrade)(cached)) {
                    console.log(`[GroqDispatch] Skip duplicate bar ${candleHash} for ${symbol} ${timeframe} — reusing safe no-trade id=${existing.id}`);
                    return cached.decision === 'no_trade'
                        ? cached
                        : {
                            decision: 'no_trade',
                            reason: 'Cached trade analysis unavailable — fail-closed',
                            decisionRecordId: cached.decisionRecordId,
                        };
                }
                cachedTradeAnalysis = cached.analysis;
                console.log(`[GroqDispatch] Cached trade id=${existing.id} for ${symbol} ${timeframe} — revalidating current hard gates`);
            }
        }
        // Step 2: Build Memory Context (reuse signal gate result — no second evaluate)
        let memoryContext;
        if (this.config.enableMemory && signalResult) {
            memoryContext = await memory_service_1.memoryService.buildContextForLLM(symbol, signalResult.setupResult.playbookKey || 'unknown', signalResult.setupResult.regime);
        }
        // Step 3: Build User Prompt with Memory
        let userPrompt = this.buildBasePrompt(candles, symbol, timeframe);
        let reviewSystemPrompt = systemPrompt;
        const rangeLevels = optimizedRangeRetest && retestContext
            ? (0, trade_levels_2.computePolicyCompliantStopAndTarget)({
                action: 'buy', entry: retestContext.confirmedEntryPrice,
                minSlPct: (0, risk_policy_1.getRiskPolicy)().minSlDistancePercent, minRr: retestContext.minRr,
            })
            : null;
        if (optimizedRangeRetest && retestContext) {
            if (!rangeLevels) {
                return { decision: 'no_trade', reason: 'adaptive range retest deterministic levels unavailable' };
            }
            const review = (0, adaptive_retest_dispatch_1.buildRangeRetestReviewPrompt)({
                systemPrompt, context: retestContext,
                stopLoss: rangeLevels.stopLoss, takeProfit: rangeLevels.takeProfit,
            });
            reviewSystemPrompt = review.systemPrompt;
            userPrompt += review.userContext;
        }
        else if (retestContext) {
            userPrompt +=
                `\n\nSTATEFUL BREAKOUT RETEST:\n` +
                    `Candidate: ${retestContext.candidateKey}\n` +
                    `Original side: ${retestContext.side}\n` +
                    `Breakout boundary: ${retestContext.boundaryPrice}\n` +
                    `Price has retested and held the boundary on a later closed bar. ` +
                    `Re-evaluate the current market; HOLD is still valid if continuation quality is poor.`;
        }
        if (memoryContext) {
            userPrompt += '\n\n' + memory_service_1.memoryService.formatContextForPrompt(memoryContext);
        }
        const reflectionPrompt = await memory_service_1.memoryService.formatRecentReflectionsForPrompt(symbol);
        if (reflectionPrompt) {
            userPrompt += '\n\n' + reflectionPrompt;
        }
        // Step 3b: Structure-first bias + playbook side (pre-LLM — avoid burning tokens)
        const gatePlaybookPre = signalResult?.setupResult.playbookKey || 'unknown';
        const gateGradePre = signalResult?.setupResult.grade ?? 'D';
        const gateConfidencePre = signalResult?.setupResult.confidence ?? 0;
        const gateRegimePre = (0, v3_entry_policy_1.resolveGateRegimeFromSignal)(signalResult ?? undefined);
        const playbookSide = retestContext?.side ??
            (signalResult?.setupResult != null
                ? (0, setup_trade_side_1.inferSetupTradeSide)(signalResult.setupResult, timeframe, candles)
                : null);
        let structureBias = adaptiveRangeStructureBias;
        if (!optimizedRangeRetest && (0, v3_structure_bias_policy_1.isV3StructureBiasEnabled)() && playbookSide) {
            try {
                const structTf = (0, v3_structure_bias_policy_1.getV3StructureBiasTf)();
                const structLimit = (0, v3_structure_bias_policy_1.getV3StructureBiasCandleLimit)();
                const { candles: structCandles } = await (0, candle_service_1.getCandles)({
                    symbol,
                    timeframe: structTf,
                    limit: structLimit + 1,
                });
                const closedStructCandles = (0, closed_candles_1.closedCandlesOnly)(structCandles, structTf).slice(-structLimit);
                diagnosticStructure = closedStructCandles;
                const structCheck = (0, v3_structure_bias_policy_1.evaluateStructureSidePermission)({
                    side: playbookSide,
                    candles: closedStructCandles,
                });
                structureBias = structCheck.bias;
                if (!structCheck.pass) {
                    const reason = structCheck.reason ?? 'structure bias blocked';
                    console.log(`[GroqDispatch] Pre-LLM structure block: ${reason}`);
                    if (this.config.enableMemory) {
                        await memory_service_1.memoryService.storeDecision({
                            symbol,
                            timeframe,
                            playbook_key: gatePlaybookPre,
                            grade: gateGradePre,
                            confidence: gateConfidencePre,
                            regime: gateRegimePre,
                            decision: 'no_trade',
                            reason: `Pre-LLM: ${reason}`,
                            method_id,
                            candle_hash: candleHash,
                        });
                    }
                    return {
                        decision: 'no_trade',
                        reason,
                        memory_context: memoryContext,
                    };
                }
            }
            catch (structErr) {
                const msg = structErr instanceof Error ? structErr.message : String(structErr);
                console.warn(`[GroqDispatch] Structure bias fetch failed (fail-closed): ${msg}`);
                if (this.config.enableMemory) {
                    await memory_service_1.memoryService.storeDecision({
                        symbol,
                        timeframe,
                        playbook_key: gatePlaybookPre,
                        grade: gateGradePre,
                        confidence: gateConfidencePre,
                        regime: gateRegimePre,
                        decision: 'no_trade',
                        reason: `Pre-LLM: structure bias unavailable — ${msg}`,
                        method_id,
                        candle_hash: candleHash,
                    });
                }
                return {
                    decision: 'no_trade',
                    reason: `structure bias unavailable: ${msg}`,
                    memory_context: memoryContext,
                };
            }
        }
        else if (!optimizedRangeRetest && (0, v3_structure_bias_policy_1.isV3StructureBiasEnabled)() && !playbookSide) {
            const reason = 'Pre-LLM: playbook has no direction for structure check (V3_STRUCTURE_BIAS)';
            if (this.config.enableMemory) {
                await memory_service_1.memoryService.storeDecision({
                    symbol,
                    timeframe,
                    playbook_key: gatePlaybookPre,
                    grade: gateGradePre,
                    confidence: gateConfidencePre,
                    regime: gateRegimePre,
                    decision: 'no_trade',
                    reason,
                    method_id,
                    candle_hash: candleHash,
                });
            }
            return { decision: 'no_trade', reason, memory_context: memoryContext };
        }
        const alignTfPre = (0, v3_entry_policy_1.getV3HtfSideAlignTf)();
        const htfPre = readFreshHtfScanState(symbol, alignTfPre);
        userPrompt +=
            '\n\n' +
                (0, v3_structure_bias_policy_1.formatLlmGateContext)({
                    timeframe,
                    playbookKey: gatePlaybookPre,
                    playbookSide,
                    structureBias,
                    htfTf: alignTfPre,
                    htfRegime: htfPre.regime,
                    htfDirection: htfPre.trendDirection,
                });
        await (0, entry_trace_1.recordEntryStage)('feasibility_before_ai', {
            measurement: (0, entry_feasibility_observation_1.observeEntryFeasibility)({ asOf: Date.now(), timeframe, candles,
                structureCandles: diagnosticStructure, structureTimeframe: (0, v3_structure_bias_policy_1.getV3StructureBiasTf)(),
                side: playbookSide, entry: retestContext?.confirmedEntryPrice,
                minSlFraction: (0, risk_policy_1.getRiskPolicy)().minSlDistancePercent,
                minRr: optimizedRangeRetest && retestContext ? retestContext.minRr : (0, methods_1.getMethodConfig)(method_id).autoEntry.minRRRatio }),
        });
        await (0, entry_trace_1.recordEntryStage)('pre_ai_passed', { cached_analysis: !!cachedTradeAnalysis });
        // Step 4: Reuse only the LLM payload; cached trades still pass every current hard gate below.
        let analysis = cachedTradeAnalysis ?? (await this.callGroqWithValidation(reviewSystemPrompt, userPrompt));
        if (!analysis) {
            if (this.config.enableMemory) {
                await memory_service_1.memoryService.storeDecision({
                    symbol,
                    timeframe,
                    playbook_key: 'unknown',
                    grade: 'D',
                    confidence: 0,
                    regime: 'unknown',
                    decision: 'no_trade',
                    reason: 'LLM: invalid JSON or failed validation after retries',
                    method_id,
                    candle_hash: candleHash,
                });
            }
            return {
                decision: 'no_trade',
                reason: 'Groq validation failed or returned invalid response',
                memory_context: memoryContext
            };
        }
        if (optimizedRangeRetest && retestContext && analysis.action !== 'hold') {
            if (analysis.action !== 'buy') {
                return {
                    decision: 'no_trade',
                    reason: 'LLM opposed validated range-long retest',
                    analysis,
                    memory_context: memoryContext,
                };
            }
            const levels = rangeLevels;
            if (!levels) {
                return {
                    decision: 'no_trade',
                    reason: 'adaptive range retest deterministic levels unavailable',
                    memory_context: memoryContext,
                };
            }
            analysis = {
                ...analysis,
                suggested_entry: retestContext.confirmedEntryPrice,
                suggested_stop_loss: levels.stopLoss,
                suggested_take_profit: levels.takeProfit,
                expected_rr: retestContext.minRr,
            };
        }
        if (analysis.action !== 'hold') {
            await (0, entry_trace_1.recordEntryStage)('plan_geometry', {
                source: 'ai_output_before_repair', entry: analysis.suggested_entry,
                stop_loss: analysis.suggested_stop_loss, take_profit: analysis.suggested_take_profit,
                measurement: (0, plan_feasibility_1.measurePlanGeometry)({ side: analysis.action === 'buy' ? 'long' : 'short',
                    entry: Number(analysis.suggested_entry), stopLoss: Number(analysis.suggested_stop_loss),
                    takeProfit: Number(analysis.suggested_take_profit),
                    minSlFraction: (0, risk_policy_1.getRiskPolicy)().minSlDistancePercent,
                    minRr: optimizedRangeRetest && retestContext ? retestContext.minRr : (0, methods_1.getMethodConfig)(method_id).autoEntry.minRRRatio }),
            });
        }
        else
            await (0, entry_trace_1.recordEntryStage)('ai_veto');
        // Step 5a: Enforce minimum SL distance (before execution — avoids tight stops)
        if (analysis.action !== 'hold' &&
            analysis.suggested_entry &&
            analysis.suggested_stop_loss &&
            analysis.suggested_take_profit) {
            const entry = Number(analysis.suggested_entry);
            let sl = Number(analysis.suggested_stop_loss);
            const minSlPct = (0, risk_policy_1.getRiskPolicy)().minSlDistancePercent;
            let slCheck = (0, trade_levels_1.checkMinSlDistance)(entry, sl, minSlPct);
            if (!slCheck.ok) {
                const repaired = await (0, groq_levels_adapter_service_1.tryRepairLevelsWithSecondaryKey)({
                    symbol,
                    timeframe,
                    methodId: method_id,
                    analysis,
                });
                if (repaired) {
                    analysis = repaired;
                    sl = Number(analysis.suggested_stop_loss);
                    slCheck = (0, trade_levels_1.checkMinSlDistance)(entry, sl, minSlPct);
                }
            }
            if (!slCheck.ok) {
                const reason = `SL distance ${(slCheck.distancePct * 100).toFixed(2)}% below min ${(slCheck.minPct * 100).toFixed(2)}%`;
                let decisionRecordId;
                if (this.config.enableMemory) {
                    const row = await memory_service_1.memoryService.storeDecision({
                        symbol,
                        timeframe,
                        playbook_key: 'unknown',
                        grade: 'A',
                        confidence: analysis.confidence || 0,
                        regime: 'unknown',
                        decision: 'no_trade',
                        reason: `Risk engine: ${reason} · ${(0, trade_levels_1.formatLlmTradeSummary)(analysis)}`,
                        entry_price: entry,
                        stop_loss: sl,
                        take_profit: Number(analysis.suggested_take_profit),
                        expected_rr: analysis.expected_rr,
                        method_id,
                        candle_hash: candleHash,
                    });
                    decisionRecordId = row?.id;
                }
                return {
                    decision: 'no_trade',
                    reason: `Risk engine blocked: ${reason}`,
                    analysis,
                    memory_context: memoryContext,
                    decisionRecordId,
                };
            }
        }
        // Step 5b: Enforce minimum R:R from prices (LLM claims are not trusted)
        if (analysis.action !== 'hold' && analysis.suggested_entry && analysis.suggested_stop_loss && analysis.suggested_take_profit) {
            let { analysis: withRr, computedRr } = (0, trade_levels_1.reconcileExpectedRr)(analysis);
            analysis = withRr;
            const methodConfig = (0, methods_1.getMethodConfig)(method_id);
            const minRr = optimizedRangeRetest && retestContext
                ? retestContext.minRr
                : methodConfig.autoEntry.minRRRatio;
            if (computedRr != null && computedRr + 1e-9 < minRr) {
                const reason = `R:R ${computedRr.toFixed(2)} below minimum ${minRr} (from entry/SL/TP)`;
                if (this.config.enableMemory) {
                    await memory_service_1.memoryService.storeDecision({
                        symbol,
                        timeframe,
                        playbook_key: 'unknown',
                        grade: 'A',
                        confidence: analysis.confidence || 0,
                        regime: 'unknown',
                        decision: 'no_trade',
                        reason: `Risk engine: ${reason}`,
                        method_id,
                        candle_hash: candleHash,
                    });
                }
                return {
                    decision: 'no_trade',
                    reason: `Risk engine blocked: ${reason}`,
                    memory_context: memoryContext,
                };
            }
        }
        // Step 5: Risk Check before allowing trade
        if (this.config.enableRiskCheck && analysis.action !== 'hold') {
            const account = await (0, testnet_repository_1.getOrCreateTestnetAccount)(symbol, method_id, 10000);
            const accountGuard = await (0, account_risk_guard_service_1.assertTestnetAccountCanOpenTrade)(account.id, symbol);
            if (!accountGuard.allowed) {
                if (this.config.enableMemory) {
                    await memory_service_1.memoryService.storeDecision({
                        symbol,
                        timeframe,
                        playbook_key: signalResult?.setupResult.playbookKey || 'unknown',
                        grade: signalResult?.setupResult.grade ?? 'D',
                        confidence: signalResult?.setupResult.confidence ?? 0,
                        regime: (0, v3_entry_policy_1.resolveGateRegimeFromSignal)(signalResult ?? undefined),
                        decision: 'no_trade',
                        reason: `Account guard: ${accountGuard.reason}`,
                        method_id,
                        candle_hash: candleHash,
                    });
                }
                return {
                    decision: 'no_trade',
                    reason: `Account guard: ${accountGuard.reason}`,
                    memory_context: memoryContext,
                };
            }
            const accountBalance = Number(account.current_balance ?? account.equity ?? account.starting_balance ?? 10000);
            const riskCheck = risk_manager_service_1.riskManagerService.canOpenTrade({
                symbol,
                grade: signalResult?.setupResult.grade ?? 'B',
                confidence: Math.max(analysis.confidence || 0, signalResult?.setupResult.confidence ?? 0),
                entryPrice: analysis.suggested_entry || 0,
                stopLoss: analysis.suggested_stop_loss || 0,
                takeProfit: analysis.suggested_take_profit || 0,
                accountBalance,
            });
            if (!riskCheck.allowed) {
                // Store no-trade decision due to risk
                if (this.config.enableMemory) {
                    await memory_service_1.memoryService.storeDecision({
                        symbol,
                        timeframe,
                        playbook_key: 'unknown',
                        grade: 'A',
                        confidence: analysis.confidence || 0,
                        regime: 'unknown',
                        decision: 'no_trade',
                        reason: `Risk engine: ${riskCheck.reason}`,
                        method_id,
                        candle_hash: candleHash,
                    });
                }
                return {
                    decision: 'no_trade',
                    reason: `Risk engine blocked: ${riskCheck.reason}`,
                    memory_context: memoryContext
                };
            }
        }
        const gateGrade = signalResult?.setupResult.grade ?? 'D';
        const gateConfidence = signalResult?.setupResult.confidence ?? 0;
        const gateRegime = (0, v3_entry_policy_1.resolveGateRegimeFromSignal)(signalResult);
        const localRegime = signalResult?.setupResult.regime ?? 'unknown';
        const gatePlaybook = signalResult?.setupResult.playbookKey || 'unknown';
        // Grade A breakout may skip 1h-trend only for longs — shorts need HTF (Aug-24 short-into-bounce).
        const breakoutImpulse = (0, v3_regime_policy_1.shouldBypassRegimeForBreakout)(timeframe, gatePlaybook === 'unknown' ? null : gatePlaybook, gateGrade === 'A' || gateGrade === 'B' || gateGrade === 'C' || gateGrade === 'D'
            ? gateGrade
            : 'D') && playbookSide === 'long';
        // LLM veto-only: hold = veto; buy/sell = confirm signal gate pass
        const llmConfirms = analysis.action !== 'hold';
        const blockRange = (0, v3_entry_policy_1.isRangeEntryBlocked)(gateRegime);
        if (llmConfirms && blockRange && !optimizedRangeRetest) {
            const ltfNote = localRegime !== gateRegime ? ` (LTF ${localRegime}, gate ${gateRegime})` : '';
            const reason = `Regime ${gateRegime} blocked for entries (V3_BLOCK_RANGE_ENTRIES)${ltfNote}`;
            if (this.config.enableMemory) {
                await memory_service_1.memoryService.storeDecision({
                    symbol,
                    timeframe,
                    playbook_key: gatePlaybook,
                    grade: gateGrade,
                    confidence: gateConfidence,
                    regime: gateRegime,
                    decision: 'no_trade',
                    reason: `LLM confirmed but ${reason} · ${(0, trade_levels_1.formatLlmTradeSummary)(analysis)}`,
                    method_id,
                    candle_hash: candleHash,
                });
            }
            return {
                decision: 'no_trade',
                reason,
                analysis,
                memory_context: memoryContext,
            };
        }
        const htfTf = (0, v3_entry_policy_1.getV3RequireHtfTrend)();
        if (llmConfirms && htfTf && !breakoutImpulse && !optimizedRangeRetest) {
            const htfState = readFreshHtfScanState(symbol, htfTf);
            if (!htfState.fresh) {
                const reason = htfState.reason ?? `HTF ${htfTf} scan unavailable`;
                if (this.config.enableMemory) {
                    await memory_service_1.memoryService.storeDecision({
                        symbol,
                        timeframe,
                        playbook_key: gatePlaybook,
                        grade: gateGrade,
                        confidence: gateConfidence,
                        regime: gateRegime,
                        decision: 'no_trade',
                        reason: `LLM confirmed but ${reason} · ${(0, trade_levels_1.formatLlmTradeSummary)(analysis)}`,
                        method_id,
                        candle_hash: candleHash,
                    });
                }
                return { decision: 'no_trade', reason, analysis, memory_context: memoryContext };
            }
            const htfRegime = htfState.regime;
            const altTf = (0, v3_entry_policy_1.getV3HtfTrendAlt)();
            let altRegime;
            let altUnavailableReason;
            if (altTf && htfRegime !== 'trend') {
                const altState = readFreshHtfScanState(symbol, altTf);
                if (altState.fresh) {
                    altRegime = altState.regime;
                }
                else {
                    altRegime = 'unknown';
                    altUnavailableReason = altState.reason ?? `HTF ${altTf} scan unavailable`;
                }
            }
            const htfCheck = (0, v3_entry_policy_1.evaluateHtfTrendRequirement)({
                entryTimeframe: timeframe,
                primaryTf: htfTf,
                primaryRegime: htfRegime,
                altTf,
                altRegime,
            });
            if (!htfCheck.pass) {
                const reason = altUnavailableReason ??
                    htfCheck.reason ??
                    `HTF ${htfTf} regime ${htfRegime} !== trend (V3_REQUIRE_HTF_TREND)`;
                if (this.config.enableMemory) {
                    await memory_service_1.memoryService.storeDecision({
                        symbol,
                        timeframe,
                        playbook_key: gatePlaybook,
                        grade: gateGrade,
                        confidence: gateConfidence,
                        regime: gateRegime,
                        decision: 'no_trade',
                        reason: `LLM confirmed but ${reason} · ${(0, trade_levels_1.formatLlmTradeSummary)(analysis)}`,
                        method_id,
                        candle_hash: candleHash,
                    });
                }
                return {
                    decision: 'no_trade',
                    reason,
                    analysis,
                    memory_context: memoryContext,
                };
            }
        }
        if (llmConfirms && !optimizedRangeRetest) {
            const gradeFilter = (0, v3_entry_policy_1.evaluateSetupGradePlaybookFilter)({
                grade: gateGrade,
                confidence: gateConfidence,
                playbookKey: gatePlaybook === 'unknown' ? null : gatePlaybook,
            });
            if (!gradeFilter.pass) {
                const reason = gradeFilter.reason ?? 'grade/playbook filter blocked entry';
                if (this.config.enableMemory) {
                    await memory_service_1.memoryService.storeDecision({
                        symbol,
                        timeframe,
                        playbook_key: gatePlaybook,
                        grade: gateGrade,
                        confidence: gateConfidence,
                        regime: gateRegime,
                        decision: 'no_trade',
                        reason: `LLM confirmed but ${reason} · ${(0, trade_levels_1.formatLlmTradeSummary)(analysis)}`,
                        method_id,
                        candle_hash: candleHash,
                    });
                }
                return { decision: 'no_trade', reason, analysis, memory_context: memoryContext };
            }
        }
        if (llmConfirms) {
            const scanState = (tf) => readFreshHtfScanState(symbol, tf);
            const side = analysis.action === 'buy' ? 'long' : 'short';
            // Phase B: LLM side must match playbook direction
            const pbMatch = (0, v3_structure_bias_policy_1.evaluatePlaybookSideMatch)({
                llmSide: side,
                playbookSide,
            });
            if (!pbMatch.pass) {
                const reason = pbMatch.reason ?? 'playbook side mismatch';
                if (this.config.enableMemory) {
                    await memory_service_1.memoryService.storeDecision({
                        symbol,
                        timeframe,
                        playbook_key: gatePlaybook,
                        grade: gateGrade,
                        confidence: gateConfidence,
                        regime: gateRegime,
                        decision: 'no_trade',
                        reason: `LLM confirmed but ${reason} · ${(0, trade_levels_1.formatLlmTradeSummary)(analysis)}`,
                        method_id,
                        candle_hash: candleHash,
                    });
                }
                return { decision: 'no_trade', reason, analysis, memory_context: memoryContext };
            }
            // Phase A post-LLM assert (LLM may flip side vs playbook — already matched above)
            if (!optimizedRangeRetest && (0, v3_structure_bias_policy_1.isV3StructureBiasEnabled)()) {
                try {
                    const structTf = (0, v3_structure_bias_policy_1.getV3StructureBiasTf)();
                    const structLimit = (0, v3_structure_bias_policy_1.getV3StructureBiasCandleLimit)();
                    const { candles: structCandles } = await (0, candle_service_1.getCandles)({
                        symbol,
                        timeframe: structTf,
                        limit: structLimit + 1,
                    });
                    const closedStructCandles = (0, closed_candles_1.closedCandlesOnly)(structCandles, structTf).slice(-structLimit);
                    const structCheck = (0, v3_structure_bias_policy_1.evaluateStructureSidePermission)({
                        side,
                        candles: closedStructCandles,
                    });
                    structureBias = structCheck.bias;
                    if (!structCheck.pass) {
                        const reason = structCheck.reason ?? 'structure bias blocked';
                        if (this.config.enableMemory) {
                            await memory_service_1.memoryService.storeDecision({
                                symbol,
                                timeframe,
                                playbook_key: gatePlaybook,
                                grade: gateGrade,
                                confidence: gateConfidence,
                                regime: gateRegime,
                                decision: 'no_trade',
                                reason: `LLM confirmed but ${reason} · ${(0, trade_levels_1.formatLlmTradeSummary)(analysis)}`,
                                method_id,
                                candle_hash: candleHash,
                            });
                        }
                        return { decision: 'no_trade', reason, analysis, memory_context: memoryContext };
                    }
                }
                catch (structErr) {
                    const msg = structErr instanceof Error ? structErr.message : String(structErr);
                    const reason = `structure bias unavailable: ${msg}`;
                    if (this.config.enableMemory) {
                        await memory_service_1.memoryService.storeDecision({
                            symbol,
                            timeframe,
                            playbook_key: gatePlaybook,
                            grade: gateGrade,
                            confidence: gateConfidence,
                            regime: gateRegime,
                            decision: 'no_trade',
                            reason: `LLM confirmed but ${reason}`,
                            method_id,
                            candle_hash: candleHash,
                        });
                    }
                    return { decision: 'no_trade', reason, analysis, memory_context: memoryContext };
                }
            }
            const alignTf = (0, v3_entry_policy_1.getV3HtfSideAlignTf)();
            const alignState = scanState(alignTf);
            if (!optimizedRangeRetest && (0, v3_entry_policy_1.isV3RequireHtfSideAlign)() && !alignState.fresh) {
                const reason = alignState.reason ?? `HTF ${alignTf} scan unavailable`;
                if (this.config.enableMemory) {
                    await memory_service_1.memoryService.storeDecision({
                        symbol,
                        timeframe,
                        playbook_key: gatePlaybook,
                        grade: gateGrade,
                        confidence: gateConfidence,
                        regime: gateRegime,
                        decision: 'no_trade',
                        reason: `LLM confirmed but ${reason} · ${(0, trade_levels_1.formatLlmTradeSummary)(analysis)}`,
                        method_id,
                        candle_hash: candleHash,
                    });
                }
                return { decision: 'no_trade', reason, analysis, memory_context: memoryContext };
            }
            const sideAlign = (0, v3_entry_policy_1.evaluateHtfSideAlign)({
                side,
                htfTf: alignTf,
                htf: alignState,
                structureBias,
            });
            if (!optimizedRangeRetest && !sideAlign.pass) {
                const reason = sideAlign.reason ?? 'HTF side align blocked';
                if (this.config.enableMemory) {
                    await memory_service_1.memoryService.storeDecision({
                        symbol,
                        timeframe,
                        playbook_key: gatePlaybook,
                        grade: gateGrade,
                        confidence: gateConfidence,
                        regime: gateRegime,
                        decision: 'no_trade',
                        reason: `LLM confirmed but ${reason} · ${(0, trade_levels_1.formatLlmTradeSummary)(analysis)}`,
                        method_id,
                        candle_hash: candleHash,
                    });
                }
                return { decision: 'no_trade', reason, analysis, memory_context: memoryContext };
            }
            if ((0, funding_veto_1.isFundingVetoEnabled)()) {
                const pair = `${symbol.toUpperCase().replace(/USDT$/i, '')}USDT`;
                const fundingRate = await (0, funding_veto_1.fetchCachedFundingRate)(pair, market_1.getPremiumIndex);
                const fundingCheck = (0, funding_veto_1.evaluateFundingVeto)({ side, fundingRate });
                if (!fundingCheck.pass) {
                    const reason = fundingCheck.reason ?? 'funding veto blocked';
                    if (this.config.enableMemory) {
                        await memory_service_1.memoryService.storeDecision({
                            symbol,
                            timeframe,
                            playbook_key: gatePlaybook,
                            grade: gateGrade,
                            confidence: gateConfidence,
                            regime: gateRegime,
                            decision: 'no_trade',
                            reason: `LLM confirmed but ${reason} · ${(0, trade_levels_1.formatLlmTradeSummary)(analysis)}`,
                            method_id,
                            candle_hash: candleHash,
                        });
                    }
                    return { decision: 'no_trade', reason, analysis, memory_context: memoryContext };
                }
            }
            if (!optimizedRangeRetest && (0, v3_entry_policy_1.isV3RequirePullback)() && analysis.suggested_entry != null) {
                try {
                    const pbTf = (0, v3_entry_policy_1.getV3PullbackTf)();
                    const period = (0, v3_entry_policy_1.getV3PullbackSmaPeriod)();
                    const { candles: pbCandles } = await (0, candle_service_1.getCandles)({
                        symbol,
                        timeframe: pbTf,
                        limit: period + 5,
                    });
                    const closes = pbCandles.map((c) => c.close);
                    const maxAbove = breakoutImpulse
                        ? (0, v3_entry_policy_1.getV3BreakoutPullbackMaxAbovePct)()
                        : (0, v3_entry_policy_1.getV3PullbackMaxAbovePct)();
                    const pb = (0, v3_entry_policy_1.evaluateTrendPullbackEntry)({
                        side,
                        entry: analysis.suggested_entry,
                        closes,
                        smaPeriod: period,
                        maxAbovePct: maxAbove,
                        maxBelowPct: (0, v3_entry_policy_1.getV3PullbackMaxBelowPct)(),
                        tfLabel: `SMA${period}@${pbTf}`,
                    });
                    if (!pb.pass) {
                        const reason = pb.reason ?? 'pullback entry blocked';
                        if (this.config.enableMemory) {
                            await memory_service_1.memoryService.storeDecision({
                                symbol,
                                timeframe,
                                playbook_key: gatePlaybook,
                                grade: gateGrade,
                                confidence: gateConfidence,
                                regime: gateRegime,
                                decision: 'no_trade',
                                reason: `LLM confirmed but ${reason} · ${(0, trade_levels_1.formatLlmTradeSummary)(analysis)}`,
                                method_id,
                                candle_hash: candleHash,
                            });
                        }
                        return { decision: 'no_trade', reason, analysis, memory_context: memoryContext };
                    }
                }
                catch (pbErr) {
                    const msg = pbErr instanceof Error ? pbErr.message : String(pbErr);
                    console.warn(`[GroqDispatch] Pullback check skipped: ${msg}`);
                }
            }
            else if ((0, v3_entry_policy_1.isV3BlockEntryExtension)() && analysis.suggested_entry != null) {
                try {
                    const extTf = (0, v3_entry_policy_1.getV3EntryExtensionTf)();
                    const extBars = (0, v3_entry_policy_1.getV3EntryExtensionBars)();
                    const { candles: extCandles } = await (0, candle_service_1.getCandles)({
                        symbol,
                        timeframe: extTf,
                        limit: extBars + 2,
                    });
                    const window = extCandles.slice(-extBars);
                    if (window.length >= 3) {
                        const rangeHigh = Math.max(...window.map((c) => c.high));
                        const rangeLow = Math.min(...window.map((c) => c.low));
                        const ext = (0, v3_entry_policy_1.evaluateEntryExtension)({
                            side,
                            entry: analysis.suggested_entry,
                            rangeHigh,
                            rangeLow,
                            maxExtensionPct: (0, v3_entry_policy_1.getV3MaxEntryExtensionPct)(),
                            tfLabel: `${extBars}×${extTf}`,
                        });
                        if (!ext.pass) {
                            const reason = ext.reason ?? 'entry extension blocked';
                            if (this.config.enableMemory) {
                                await memory_service_1.memoryService.storeDecision({
                                    symbol,
                                    timeframe,
                                    playbook_key: gatePlaybook,
                                    grade: gateGrade,
                                    confidence: gateConfidence,
                                    regime: gateRegime,
                                    decision: 'no_trade',
                                    reason: `LLM confirmed but ${reason} · ${(0, trade_levels_1.formatLlmTradeSummary)(analysis)}`,
                                    method_id,
                                    candle_hash: candleHash,
                                });
                            }
                            return { decision: 'no_trade', reason, analysis, memory_context: memoryContext };
                        }
                    }
                }
                catch (extErr) {
                    const msg = extErr instanceof Error ? extErr.message : String(extErr);
                    console.warn(`[GroqDispatch] Entry extension check skipped: ${msg}`);
                }
            }
            if (timeframe === '5m' && !optimizedRangeRetest) {
                const fiveMGuard = (0, v3_entry_policy_1.evaluate5mEntryGuards)({
                    entryTimeframe: timeframe,
                    side,
                    tf1h: scanState('1h'),
                    tf15m: scanState('15m'),
                });
                if (!fiveMGuard.pass) {
                    const reason = fiveMGuard.reason ?? '5m entry guard blocked';
                    if (this.config.enableMemory) {
                        await memory_service_1.memoryService.storeDecision({
                            symbol,
                            timeframe,
                            playbook_key: gatePlaybook,
                            grade: gateGrade,
                            confidence: gateConfidence,
                            regime: gateRegime,
                            decision: 'no_trade',
                            reason: `LLM confirmed but ${reason} · ${(0, trade_levels_1.formatLlmTradeSummary)(analysis)}`,
                            method_id,
                            candle_hash: candleHash,
                        });
                    }
                    return { decision: 'no_trade', reason, analysis, memory_context: memoryContext };
                }
            }
        }
        const minLlmConf = parseFloat(process.env.V3_MIN_LLM_CONFIRM_CONFIDENCE || '0.75');
        if (llmConfirms && (analysis.confidence ?? 0) < minLlmConf) {
            const reason = `LLM confidence ${((analysis.confidence ?? 0) * 100).toFixed(0)}% below min ${(minLlmConf * 100).toFixed(0)}%`;
            if (this.config.enableMemory) {
                await memory_service_1.memoryService.storeDecision({
                    symbol,
                    timeframe,
                    playbook_key: gatePlaybook,
                    grade: gateGrade,
                    confidence: analysis.confidence || 0,
                    regime: gateRegime,
                    decision: 'no_trade',
                    reason: `LLM veto: ${reason}`,
                    method_id,
                    candle_hash: candleHash,
                });
            }
            return {
                decision: 'no_trade',
                reason,
                analysis,
                memory_context: memoryContext,
            };
        }
        // Step 6: Store decision
        let decisionRecordId;
        const isTrade = llmConfirms;
        const llmSummary = isTrade
            ? (0, trade_levels_1.formatLlmTradeSummary)(analysis)
            : analysis.reason_summary || 'LLM: hold (veto)';
        if (this.config.enableMemory) {
            const row = await memory_service_1.memoryService.storeDecision({
                symbol,
                timeframe,
                playbook_key: gatePlaybook,
                grade: gateGrade,
                confidence: gateConfidence,
                regime: gateRegime,
                decision: isTrade ? 'trade' : 'no_trade',
                reason: isTrade ? llmSummary : `LLM veto (hold) · gate passed · ${llmSummary}`,
                entry_price: analysis.suggested_entry,
                stop_loss: analysis.suggested_stop_loss,
                take_profit: analysis.suggested_take_profit,
                expected_rr: analysis.expected_rr,
                method_id,
                candle_hash: candleHash,
            });
            decisionRecordId = row?.id;
        }
        return {
            decision: isTrade ? 'trade' : 'no_trade',
            analysis,
            reason: isTrade
                ? `LLM confirmed trade · ${llmSummary}`
                : 'LLM veto (hold) — no entry',
            memory_context: memoryContext,
            decisionRecordId,
        };
    }
    /**
     * Call Groq with strict validation and retry logic
     */
    async callGroqWithValidation(systemPrompt, userPrompt) {
        const client = (0, groq_client_1.createGroqClient)();
        if (!client) {
            console.error('[GroqDispatch] No Groq client available');
            return null;
        }
        for (let attempt = 0; attempt <= this.config.maxRetries; attempt++) {
            try {
                console.log(`[GroqDispatch] Attempt ${attempt + 1}/${this.config.maxRetries + 1}`);
                const raw = await client.analyze({
                    systemPrompt,
                    userPrompt,
                    temperature: 0.2,
                    maxRetries: 0 // We handle retries at dispatch level
                });
                const analysis = this.normalizeGroqAnalysis(raw);
                if (!this.validateResponse(analysis)) {
                    throw new Error('Invalid response structure from Groq');
                }
                console.log('[GroqDispatch] Successfully validated response');
                return analysis;
            }
            catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                console.error(`[GroqDispatch] Attempt ${attempt + 1} failed:`, message);
                if (attempt < this.config.maxRetries) {
                    const delay = Math.pow(2, attempt) * 1000;
                    console.log(`[GroqDispatch] Retrying in ${delay}ms...`);
                    await new Promise(resolve => setTimeout(resolve, delay));
                }
            }
        }
        console.error('[GroqDispatch] All attempts failed, returning NO_TRADE');
        return null;
    }
    /**
     * Unwrap symbol-keyed payloads ({ "btc": { ... } }) from Kim Nghia / ICT prompts.
     */
    normalizeGroqAnalysis(raw) {
        if (!raw || typeof raw !== 'object')
            return null;
        const record = raw;
        const nested = record.btc ??
            record.BTC ??
            record.eth ??
            record.ETH ??
            (typeof record.symbol === 'string'
                ? record[record.symbol.toLowerCase()]
                : undefined);
        const base = nested && typeof nested === 'object' && !Array.isArray(nested)
            ? { ...nested }
            : raw;
        if (typeof base.confidence === 'string') {
            const parsed = parseFloat(base.confidence);
            if (!Number.isNaN(parsed))
                base.confidence = parsed;
        }
        if (typeof base.confidence === 'number' && base.confidence > 1) {
            base.confidence = base.confidence / 100;
        }
        const { analysis: withRr } = (0, trade_levels_1.reconcileExpectedRr)(base);
        return withRr;
    }
    /**
     * Validate Groq response structure
     */
    validateResponse(analysis) {
        if (!analysis)
            return false;
        // Check required fields
        if (typeof analysis.bias !== 'string')
            return false;
        if (typeof analysis.action !== 'string')
            return false;
        if (typeof analysis.confidence !== 'number' || Number.isNaN(analysis.confidence))
            return false;
        // Check bias-action consistency
        if (analysis.bias === 'bullish' && analysis.action !== 'buy')
            return false;
        if (analysis.bias === 'bearish' && analysis.action !== 'sell')
            return false;
        if (analysis.bias === 'neutral' && analysis.action !== 'hold')
            return false;
        // Check SL/TP placement if provided
        if (analysis.suggested_entry && analysis.suggested_stop_loss && analysis.suggested_take_profit) {
            if (analysis.bias === 'bullish') {
                if (analysis.suggested_stop_loss >= analysis.suggested_entry)
                    return false;
                if (analysis.suggested_take_profit <= analysis.suggested_entry)
                    return false;
            }
            else if (analysis.bias === 'bearish') {
                if (analysis.suggested_stop_loss <= analysis.suggested_entry)
                    return false;
                if (analysis.suggested_take_profit >= analysis.suggested_entry)
                    return false;
            }
        }
        return true;
    }
    /**
     * Build base prompt from candle data
     */
    buildBasePrompt(candles, symbol, timeframe) {
        const recentCandles = candles.slice(-60); // Last 60 candles
        const currentPrice = recentCandles[recentCandles.length - 1]?.close || 0;
        let prompt = `MARKET DATA:\n`;
        prompt += `Symbol: ${symbol}\n`;
        prompt += `Timeframe: ${timeframe}\n`;
        prompt += `Current Price: ${currentPrice}\n\n`;
        prompt += `RECENT CANDLES (last 20):\n`;
        recentCandles.slice(-20).forEach((candle, i) => {
            prompt += `${i + 1}. O: ${candle.open} H: ${candle.high} L: ${candle.low} C: ${candle.close} V: ${candle.volume}\n`;
        });
        const minSlPct = (0, risk_policy_1.getRiskPolicy)().minSlDistancePercent;
        const minSlLabel = (minSlPct * 100).toFixed(2);
        prompt +=
            '\nCRITICAL — YOUR ROLE IS VETO / CONFIRM ONLY:\n' +
                '- Signal gate already approved this setup. Respond "hold" to VETO (skip trade).\n' +
                '- Respond "buy" or "sell" ONLY to CONFIRM entry with valid SL/TP.\n' +
                '- Do not invent marginal trades; when uncertain, respond "hold".\n' +
                '\nCRITICAL — STOP LOSS (system rejects tighter stops):\n' +
                `- Minimum |entry - suggested_stop_loss| / entry >= ${minSlLabel}% (your last outputs near 0.3% were rejected).\n` +
                '- Place SL beyond the recent swing liquidity (swing high for SHORT, swing low for LONG), not only inside the current candle wick.\n' +
                `- On ${timeframe} BTC, aim SL roughly ${minSlLabel}%-0.8% from entry unless structure requires wider.\n` +
                '\nCRITICAL — R:R:\n' +
                'expected_rr MUST equal |take_profit - entry| / |entry - stop_loss| (2 decimal places). ' +
                'Compute from suggested_entry, suggested_stop_loss, suggested_take_profit — do not invent expected_rr.\n';
        return prompt;
    }
    /**
     * Update configuration
     */
    updateConfig(config) {
        this.config = { ...this.config, ...config };
    }
    /**
     * Get current configuration
     */
    getConfig() {
        return { ...this.config };
    }
}
exports.GroqDispatchService = GroqDispatchService;
// Export singleton instance
exports.groqDispatchService = new GroqDispatchService();
