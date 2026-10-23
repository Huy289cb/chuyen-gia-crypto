import {causalPlanBlock,causalAnalysisBlock,causalPlanPrompt,type CausalPlanContract} from '../utils/causal-plan-contract';
import {buildCausalPlanSelectorPrompt,causalPlanSelectorEnabled,decodeCausalPlanSelector} from '../utils/causal-plan-selector';
import {revalidateCausalPlan,type CausalPlanEvidence} from '../utils/causal-plan-evidence';
import {causalScoringEnabled} from '../analyzers/causal-setup-gate.analyzer';
import {causalRangePermissionEnabled,evaluateCausalRangePermission,type CausalRangePermission} from '../utils/causal-range-permission';
import {withProviderPurpose} from '../utils/provider-purpose-context';
import { identifyAnchoredSetup } from '../utils/setup-identity';
import { observeEntryFeasibility } from '../utils/entry-feasibility-observation';
import { evaluateRecordedPullback } from '../utils/pullback-evaluation';
import { createEntryTrace, currentEntryTrace, withEntryTrace, recordEntryStage, type EntryTrace } from '../utils/entry-trace';
import { generateCandleBarKey } from '../utils/candle-hash';
import { measurePlanGeometry } from '../utils/plan-feasibility';
import {evaluatePreAiEntryGates} from '../utils/pre-ai-entry-gates';
/**
 * Groq Dispatch Service
 * Orchestrates LLM calls with strict validation and memory context
 * Only calls Groq when signal gate and risk engine approve
 */

import { createGroqClient, GroqAnalysis } from './groq-client';
import { memoryService, MemoryContext } from './memory.service';
import { signalGateService, type SignalGateOutput } from './signal-gate.service';
import { riskManagerService } from './risk-manager.service';
import { getOrCreateTestnetAccount } from '../repositories/testnet.repository';
import { getMethodConfig } from '../config/methods';
import {
  checkMinSlDistance,
  formatLlmTradeSummary,
  reconcileExpectedRr,
} from '../utils/trade-levels';
import { getRiskPolicy } from '../config/risk-policy';
import {
  evaluateHtfTrendRequirement,
  evaluate5mEntryGuards,
  evaluateHtfSideAlign,
  evaluateEntryExtension,
  evaluateSetupGradePlaybookFilter,
  getV3EntryExtensionBars,
  getV3EntryExtensionTf,
  getV3HtfSideAlignTf,
  getV3HtfTrendAlt,
  getV3MaxEntryExtensionPct,
  getV3BreakoutPullbackMaxAbovePct,
  getV3PullbackMaxAbovePct,
  getV3PullbackMaxBelowPct,
  getV3PullbackSmaPeriod,
  getV3PullbackTf,
  getV3RequireHtfTrend,
  isRangeEntryBlocked,
  isRegimeAllowedForEntry,
  isV3BlockEntryExtension,
  isV3RequirePullback,
  isV3RequireHtfSideAlign,
  resolveGateRegimeFromSignal,
} from '../config/v3-entry-policy';
import {
  evaluatePlaybookSideMatch,
  evaluateStructureSidePermission,
  formatLlmGateContext,
  getV3StructureBiasCandleLimit,
  getV3StructureBiasStrength,
  getV3StructureBiasTf,
  isV3StructureBiasEnabled,
  isV3StructureShortRequireBos,
  isV3StructureLongRequireBos,
} from '../config/v3-structure-bias-policy';
import { inferSetupTradeSide } from '../utils/setup-trade-side';
import {
  evaluateFundingVeto,
  fetchCachedFundingRate,
  isFundingVetoEnabled,
} from '../config/funding-veto';
import { getPremiumIndex } from './binance/market';
import { assertTestnetAccountCanOpenTrade } from './account-risk-guard.service';
import { getScanResult } from '../schedulers/market-scan.scheduler';
import { getCandles, type UnifiedCandle } from './candle.service';
import { generateCandleHash } from '../utils/candle-hash';
import { closedCandlesOnly, getClosedCandleFinalizationGraceMs } from '../utils/closed-candles';
import { evaluateScanFreshness } from '../utils/scan-freshness';
import {
  tryRepairLevelsWithSecondaryKey,
} from './groq-levels-adapter.service';
import {
  buildDispatchOutputFromStoredDecision,
  shouldRevalidateStoredTrade,
} from '../utils/llm-dispatch-dedup';
import { shouldBypassRegimeForBreakout } from '../config/v3-regime-policy';
import { classifyStructureBias } from '../utils/structure-bias';
import { computePolicyCompliantStopAndTarget } from '../utils/trade-levels';
import {
  buildRangeRetestReviewPrompt,
  isOptimizedRangeRetest,
  validateOptimizedRangeRetest,
  type RetestDispatchContext,
} from '../utils/adaptive-retest-dispatch';
import { observeOpenRouterShadowDecision } from './openrouter-shadow.service';

export interface GroqDispatchInput {
  causalPlan?: CausalPlanContract;
  causalEvidence?: CausalPlanEvidence;
  symbol: string;
  timeframe: string;
  candles: UnifiedCandle[];
  systemPrompt: string;
  method_id?: string;
  /** Precomputed by MarketScan — avoids second signal-gate evaluation */
  signalResult?: SignalGateOutput;
  /**
   * A previously valid breakout which has now retested its boundary. The side
   * comes from immutable breakout evidence because the retest bar itself is no
   * longer expected to classify as a breakout.
   */
  retestContext?: RetestDispatchContext;
}

export interface GroqDispatchOutput {
  trace?: EntryTrace;
  decision: 'trade' | 'no_trade';
  analysis?: GroqAnalysis;
  reason: string;
  memory_context?: MemoryContext;
  /** DB row id when memory stored the decision */
  decisionRecordId?: number;
}

export interface GroqDispatchConfig {
  enableMemory: boolean;
  enableSignalGate: boolean;
  enableRiskCheck: boolean;
  maxRetries: number;
}

// SAFETY: Critical safety features are hardcoded to true per Big Update Plan v3
// These cannot be disabled at runtime to prevent unsafe configurations
const DEFAULT_CONFIG: GroqDispatchConfig = {
  enableMemory: true,
  enableSignalGate: true, // MANDATORY - cannot be disabled
  enableRiskCheck: true,  // MANDATORY - cannot be disabled
  maxRetries: 1
};

interface FreshHtfScanState {
  fresh: boolean;
  regime: string;
  trendDirection: 'bullish' | 'bearish' | null;
  reason?: string;
}

function readFreshHtfScanState(symbol: string, timeframe: string): FreshHtfScanState {
  const scan = getScanResult(symbol, timeframe);
  const freshness = evaluateScanFreshness(scan?.timestamp, {
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
    regime: resolveGateRegimeFromSignal(scan.signalResult),
    trendDirection: scan.signalResult.setupResult.evidence.regime.trendDirection ?? null,
  };
}

/**
 * Groq Dispatch Service
 */
export class GroqDispatchService {
  private config: GroqDispatchConfig;

  constructor(config?: Partial<GroqDispatchConfig>) {
    // SAFETY: Prevent disabling critical safety features
    const safeConfig: Partial<GroqDispatchConfig> = {
      ...config,
      enableSignalGate: true,  // Force true - cannot be disabled
      enableRiskCheck: true    // Force true - cannot be disabled
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
  async dispatch(input: GroqDispatchInput): Promise<GroqDispatchOutput> {
    input = { ...input, causalPlan: input.causalPlan ? JSON.parse(JSON.stringify(input.causalPlan)) : undefined,
      causalEvidence: input.causalEvidence ? JSON.parse(JSON.stringify(input.causalEvidence)) : undefined };
    const trace = createEntryTrace({
      observation_key: `${input.symbol.toUpperCase()}:${input.timeframe}:${input.method_id ?? 'kim_nghia'}:${generateCandleBarKey(input.candles)}`,
      candidate_key: input.causalPlan?.setupId ?? input.retestContext?.candidateKey,
      candle_cutoff: input.candles.at(-1)?.timestamp,
      lane: input.causalPlan ? 'causal_review' : input.retestContext ? 'legacy_retest' : 'legacy_signal',
    }, { risk: getRiskPolicy(), auto: getMethodConfig(input.method_id ?? 'kim_nghia').autoEntry });
    return withEntryTrace(trace, async () => {
      await recordEntryStage('dispatch_started');
      try {
        const result = await this.dispatchTraced(input);
        trace.decision_id = result.decisionRecordId ?? trace.decision_id;
        await recordEntryStage('dispatch_result', { decision: result.decision, reason: result.reason });
        return { ...result, decisionRecordId: trace.decision_id, trace: { ...trace } };
      } catch (error) { await recordEntryStage('dispatch_error'); throw error; }
    });
  }

  private async dispatchTraced(input: GroqDispatchInput): Promise<GroqDispatchOutput> {
    const {
      symbol,
      timeframe,
      candles,
      systemPrompt,
      method_id = 'kim_nghia',
      signalResult: precomputed,
      retestContext,
    } = input;
    if (input.causalPlan) {
      const block = causalPlanBlock(input.causalPlan,symbol,timeframe,Date.now());
      if (block || retestContext) return {decision:'no_trade',reason:block ?? 'causal_plan_retest_conflict'};
      const evidenceBlock = revalidateCausalPlan(input.causalPlan,input.causalEvidence,Date.now());
      if(evidenceBlock) return {decision:'no_trade',reason:evidenceBlock};
      await recordEntryStage('causal_plan_received',{plan:input.causalPlan});
    }
    let diagnosticStructure: UnifiedCandle[] = [];
    const optimizedRangeRetest = isOptimizedRangeRetest(retestContext);
    let causalRangePermission:CausalRangePermission|undefined;
    let rangePermissionActive=optimizedRangeRetest;
    const readCausalRangePermission=async ():Promise<CausalRangePermission>=>{
      const structTf=getV3StructureBiasTf(),structLimit=getV3StructureBiasCandleLimit();
      if(structTf!=='4h')return {pass:false,reason:'causal_existing_range_requires_current_4h_structure',version:'existing-long-range-v1',planHash:input.causalPlan!.hash};
      const fetched=await getCandles({symbol,timeframe:structTf,limit:structLimit+1});
      const structure=closedCandlesOnly(fetched.candles,structTf).slice(-structLimit);
      diagnosticStructure=structure;
      return evaluateCausalRangePermission({plan:input.causalPlan!,evidence:input.causalEvidence,now:Date.now(),
        htf1h:readFreshHtfScanState(symbol,'1h'),structure});
    };
    if (retestContext?.candidateKind === 'range_sweep_reclaim' && !optimizedRangeRetest) {
      return { decision: 'no_trade', reason: 'adaptive range retest context is not live-policy eligible' };
    }
    const candleHash = generateCandleHash(
      candles.map((c) => ({
        timestamp: c.timestamp,
        high: c.high,
        low: c.low,
        close: c.close,
      }))
    );

    let signalResult: SignalGateOutput | undefined = precomputed;
    let cachedTradeAnalysis: GroqAnalysis | undefined;

    // Step 1: Signal Gate — use MarketScan result when provided (single evaluation per cycle)
    if (this.config.enableSignalGate) {
      if(input.causalPlan&&causalScoringEnabled()) {
        // Never substitute a legacy scan's cached grade for this plan's evidence.
        const htf=readFreshHtfScanState(symbol,'1h');
        signalResult=await signalGateService.evaluate({candles,symbol,timeframe,
          causalPlan:input.causalPlan,causalEvidence:input.causalEvidence,
          htfRegime:htf.fresh&&['trend','range','chop'].includes(htf.regime)?htf.regime as 'trend'|'range'|'chop':null});
      }
      if (!signalResult) {
        signalResult = await signalGateService.evaluate({
          candles,
          symbol,
          timeframe
        });
      }

      if(input.causalPlan?.mechanism==='H2'&&input.causalPlan.side==='long'&&causalRangePermissionEnabled()&&
        ['A','B'].includes(signalResult.setupResult.grade)&&signalResult.setupResult.confidence>=getRiskPolicy().minSignalConfidence){
        try {causalRangePermission=await readCausalRangePermission();}
        catch {causalRangePermission={pass:false,reason:'causal_existing_range_inputs_unavailable',version:'existing-long-range-v1',planHash:input.causalPlan.hash};}
        await recordEntryStage('causal_existing_range_permission',{permission:causalRangePermission});
        if(causalRangePermission.pass){
          rangePermissionActive=true;
          signalResult={...signalResult,pass:true,shouldCallGroq:true,reason:causalRangePermission.reason};
        }else causalRangePermission=undefined;
      }

      const measuredSetup = signalResult.setupResult;
      const measuredEvidence = measuredSetup.evidence?.playbooks?.find(p => p.playbook === measuredSetup.playbookKey);
      const measuredIdentity = identifyAnchoredSetup({ symbol, timeframe,
        playbook: measuredSetup.playbookKey ?? 'unknown',
        side: inferSetupTradeSide(measuredSetup, timeframe, candles),
        detected: measuredEvidence?.detected ?? false, metrics: measuredEvidence?.metrics ?? {},
        asOf: Date.now(), graceMs: getClosedCandleFinalizationGraceMs(),
      });
      const activeTrace = currentEntryTrace();
      if (activeTrace) activeTrace.setup_identity = measuredIdentity;
      await recordEntryStage('setup_identified', { setup_identity: measuredIdentity });

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

      const gateRegime = resolveGateRegimeFromSignal(signalResult);
      if (!rangePermissionActive && !isRegimeAllowedForEntry(gateRegime)) {
        return {
          decision: 'no_trade',
          reason: `Regime ${gateRegime} not in V3_ALLOWED_REGIMES (${process.env.V3_ALLOWED_REGIMES ?? 'trend'})`,
        };
      }
    }

    let adaptiveRangeStructureBias: 'bull' | 'bear' | 'transition' | undefined;
    if (optimizedRangeRetest && retestContext) {
      try {
        const structTf = getV3StructureBiasTf();
        const structLimit = getV3StructureBiasCandleLimit();
        const { candles: fetched } = await getCandles({
          symbol,
          timeframe: structTf,
          limit: structLimit + 1,
        });
        const closed = closedCandlesOnly(fetched, structTf).slice(-structLimit);
        diagnosticStructure = closed;
        adaptiveRangeStructureBias = classifyStructureBias(closed, {
          strength: getV3StructureBiasStrength(),
        }).bias;
        const validation = validateOptimizedRangeRetest({
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
      } catch (error: unknown) {
        const reason = error instanceof Error ? error.message : String(error);
        return {
          decision: 'no_trade',
          reason: `adaptive range retest revalidation unavailable: ${reason}`,
        };
      }
    }

    // Range candidates are already claimed/deduplicated by their stateful key.
    // A trend decision on the same candle is not a review of this range plan.
    if (this.config.enableMemory && !optimizedRangeRetest && !input.causalPlan) {
      const existing = await memoryService.findDecisionForBar(
        symbol,
        timeframe,
        candleHash,
        method_id
      );
      if (existing) {
        const cached = buildDispatchOutputFromStoredDecision(existing);
        if (!shouldRevalidateStoredTrade(cached)) {
          console.log(
            `[GroqDispatch] Skip duplicate bar ${candleHash} for ${symbol} ${timeframe} — reusing safe no-trade id=${existing.id}`
          );
          return cached.decision === 'no_trade'
            ? cached
            : {
                decision: 'no_trade',
                reason: 'Cached trade analysis unavailable — fail-closed',
                decisionRecordId: cached.decisionRecordId,
              };
        }
        cachedTradeAnalysis = cached.analysis;
        console.log(
          `[GroqDispatch] Cached trade id=${existing.id} for ${symbol} ${timeframe} — revalidating current hard gates`
        );
      }
    }

    const preAiGates=evaluatePreAiEntryGates({
      optimizedRangeRetest:rangePermissionActive,timeframe,gateRegime:resolveGateRegimeFromSignal(signalResult),
      grade:signalResult?.setupResult.grade??'D',confidence:signalResult?.setupResult.confidence??0,
      playbookKey:signalResult?.setupResult.playbookKey??null,
      playbookSide:retestContext?.side??(signalResult?.setupResult?inferSetupTradeSide(signalResult.setupResult,timeframe,candles):null),
      scanState:tf=>readFreshHtfScanState(symbol,tf),
    });
    if(!preAiGates.pass){
      await recordEntryStage('pre_ai_gate_blocked',{gate:preAiGates.gate,reason:preAiGates.reason,cached_analysis:!!cachedTradeAnalysis});
      // Do not cache a temporary HTF block as a permanent no-trade for this candle.
      // A fresh scan can qualify on the next cycle; post-AI gates still revalidate.
      return {decision:'no_trade',reason:`Pre-LLM: ${preAiGates.reason}`};
    }

    // Step 2: Build Memory Context (reuse signal gate result — no second evaluate)
    let memoryContext: MemoryContext | undefined;
    if (this.config.enableMemory && signalResult) {
      memoryContext = await memoryService.buildContextForLLM(
        symbol,
        signalResult.setupResult.playbookKey || 'unknown',
        signalResult.setupResult.regime
      );
    }

    // Step 3: Build User Prompt with Memory
    let userPrompt = this.buildBasePrompt(candles, symbol, timeframe);
    if(input.causalPlan) {
      userPrompt += causalPlanSelectorEnabled()
        ? buildCausalPlanSelectorPrompt(input.causalPlan)
        : causalPlanPrompt(input.causalPlan);
      if(causalRangePermission?.pass)userPrompt += '\nExisting validated long5m range permission: '+JSON.stringify(causalRangePermission)+'. Review the exact immutable mean-reversion plan; HOLD is valid. No generic trend/BOS assumption replaces this range permission.';
      if(signalResult?.setupResult.confidenceKind==='rule_quality') userPrompt += '\nCausal setup score is deterministic candle evidence quality, not a win probability. Your confidence must be your independent assessment. Raw evidence: '+JSON.stringify(signalResult.setupResult.evidence);
    }
    let reviewSystemPrompt = systemPrompt;
    if(input.causalPlan && causalPlanSelectorEnabled()) {
      reviewSystemPrompt += '\nFor this H1/H2 review, the selector contract below replaces the earlier response schema. '
        + 'Assess the sealed plan; do not generate or repeat price levels.\n'
        + buildCausalPlanSelectorPrompt(input.causalPlan);
    }
    const rangeLevels = optimizedRangeRetest && retestContext
      ? computePolicyCompliantStopAndTarget({
          action: 'buy', entry: retestContext.confirmedEntryPrice,
          minSlPct: getRiskPolicy().minSlDistancePercent, minRr: retestContext.minRr,
        })
      : null;
    if (optimizedRangeRetest && retestContext) {
      if (!rangeLevels) {
        return { decision: 'no_trade', reason: 'adaptive range retest deterministic levels unavailable' };
      }
      const review = buildRangeRetestReviewPrompt({
        systemPrompt, context: retestContext,
        stopLoss: rangeLevels.stopLoss, takeProfit: rangeLevels.takeProfit,
      });
      reviewSystemPrompt = review.systemPrompt;
      userPrompt += review.userContext;
    } else if (retestContext) {
      userPrompt +=
        `\n\nSTATEFUL BREAKOUT RETEST:\n` +
        `Candidate: ${retestContext.candidateKey}\n` +
        `Original side: ${retestContext.side}\n` +
        `Breakout boundary: ${retestContext.boundaryPrice}\n` +
        `Price has retested and held the boundary on a later closed bar. ` +
        `Re-evaluate the current market; HOLD is still valid if continuation quality is poor.`;
    }
    
    if (memoryContext) {
      userPrompt += '\n\n' + memoryService.formatContextForPrompt(memoryContext);
    }

    const reflectionPrompt = await memoryService.formatRecentReflectionsForPrompt(symbol);
    if (reflectionPrompt) {
      userPrompt += '\n\n' + reflectionPrompt;
    }

    // Step 3b: Structure-first bias + playbook side (pre-LLM — avoid burning tokens)
    const gatePlaybookPre = signalResult?.setupResult.playbookKey || 'unknown';
    const gateGradePre = signalResult?.setupResult.grade ?? 'D';
    const gateConfidencePre = signalResult?.setupResult.confidence ?? 0;
    const gateRegimePre = resolveGateRegimeFromSignal(signalResult ?? undefined);
    const playbookSide =
      retestContext?.side ??
      (signalResult?.setupResult != null
        ? inferSetupTradeSide(signalResult.setupResult, timeframe, candles)
        : null);
    if(input.causalPlan && playbookSide!==input.causalPlan.side) {
      await recordEntryStage('causal_plan_gate_side_blocked',{gate_side:playbookSide,plan_side:input.causalPlan.side});
      return {decision:'no_trade',reason:'causal_plan_signal_side_mismatch'};
    }
    let structureBias: 'bull' | 'bear' | 'transition' | undefined =
      causalRangePermission?.structureBias??adaptiveRangeStructureBias;

    if (!rangePermissionActive && isV3StructureBiasEnabled() && playbookSide) {
      try {
        const structTf = getV3StructureBiasTf();
        const structLimit = getV3StructureBiasCandleLimit();
        const { candles: structCandles } = await getCandles({
          symbol,
          timeframe: structTf,
          limit: structLimit + 1,
        });
        const closedStructCandles = closedCandlesOnly(structCandles, structTf).slice(-structLimit);
        diagnosticStructure = closedStructCandles;
        const structureInput = {
          side: playbookSide,
          candles: closedStructCandles,
          enabled: isV3StructureBiasEnabled(), strength: getV3StructureBiasStrength(),
          shortRequireBos: isV3StructureShortRequireBos(), longRequireBos: isV3StructureLongRequireBos(),
        };
        const structCheck = evaluateStructureSidePermission(structureInput);
        await recordEntryStage('structure_permission_evaluated', {structure_permission:{
          schema:'structure-permission-v1',timeframe:structTf,observed_at:new Date().toISOString(),
          input:{...structureInput,candles:closedStructCandles.map(c=>({timestamp:c.timestamp,high:c.high,low:c.low,close:c.close}))},
          decision:structCheck,
        }});
        structureBias = structCheck.bias;
        if (!structCheck.pass) {
          const reason = structCheck.reason ?? 'structure bias blocked';
          console.log(`[GroqDispatch] Pre-LLM structure block: ${reason}`);
          if (this.config.enableMemory) {
            await memoryService.storeDecision({
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
      } catch (structErr: unknown) {
        const msg = structErr instanceof Error ? structErr.message : String(structErr);
        console.warn(`[GroqDispatch] Structure bias fetch failed (fail-closed): ${msg}`);
        if (this.config.enableMemory) {
          await memoryService.storeDecision({
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
    } else if (!rangePermissionActive && isV3StructureBiasEnabled() && !playbookSide) {
      const reason = 'Pre-LLM: playbook has no direction for structure check (V3_STRUCTURE_BIAS)';
      if (this.config.enableMemory) {
        await memoryService.storeDecision({
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

    const alignTfPre = getV3HtfSideAlignTf();
    const htfPre = readFreshHtfScanState(symbol, alignTfPre);
    userPrompt +=
      '\n\n' +
      formatLlmGateContext({
        timeframe,
        playbookKey: gatePlaybookPre,
        playbookSide,
        structureBias,
        htfTf: alignTfPre,
        htfRegime: htfPre.regime,
        htfDirection: htfPre.trendDirection,
      });

    // Freeze the exact diagnostic inputs before the asynchronous journal write.
    const diagnosticBar = ({ timestamp, high, low, close }: typeof candles[number]) =>
      ({ timestamp, high, low, close });
    const feasibilityInput: Parameters<typeof observeEntryFeasibility>[0] = {
      asOf: Date.now(), timeframe, candles: candles.map(diagnosticBar),
      structureCandles: diagnosticStructure.map(diagnosticBar),
      structureTimeframe: getV3StructureBiasTf(),
      side: playbookSide, entry: retestContext?.confirmedEntryPrice,
      minSlFraction: getRiskPolicy().minSlDistancePercent,
      minRr: optimizedRangeRetest && retestContext ? retestContext.minRr : getMethodConfig(method_id).autoEntry.minRRRatio,
      graceMs: getClosedCandleFinalizationGraceMs(),
    };
    await recordEntryStage('feasibility_before_ai', {
      input_schema: 'entry-feasibility-input-v1', input: feasibilityInput,
      measurement: observeEntryFeasibility(feasibilityInput),
    });
    await recordEntryStage('pre_ai_passed', { cached_analysis: !!cachedTradeAnalysis });

    // Step 4: Reuse only the LLM payload; cached trades still pass every current hard gate below.
    let analysis =
      cachedTradeAnalysis ?? (await this.callGroqWithValidation(reviewSystemPrompt, userPrompt, {
        symbol,
        timeframe,
        decisionCandleOpenMs: candles.at(-1)?.timestamp,
        candidateKey: retestContext?.candidateKey,
        expectedSide: playbookSide,
        causalPlan:input.causalPlan,
      }));

    if (!analysis) {
      if (this.config.enableMemory) {
        await memoryService.storeDecision({
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

    if(input.causalPlan) {
      const block = causalPlanBlock(input.causalPlan,symbol,timeframe,Date.now()) ?? causalAnalysisBlock(input.causalPlan,analysis);
      if(block) {
        await recordEntryStage('causal_plan_review_blocked',{reason:block,plan_hash:input.causalPlan.hash});
        return {decision:'no_trade',reason:block,analysis};
      }
    }
    if(causalRangePermission?.pass&&analysis.action!=='hold'){
      let renewed:CausalRangePermission;
      try {renewed=await readCausalRangePermission();}
      catch {return {decision:'no_trade',reason:'causal_existing_range_revalidation_unavailable'};}
      await recordEntryStage('causal_existing_range_revalidated',{permission:renewed});
      if(!renewed.pass||renewed.planHash!==causalRangePermission.planHash)return {decision:'no_trade',reason:renewed.reason};
      causalRangePermission=renewed;
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
      await recordEntryStage('plan_geometry', {
        source: 'ai_output_before_repair', entry: analysis.suggested_entry,
        stop_loss: analysis.suggested_stop_loss, take_profit: analysis.suggested_take_profit,
        measurement: measurePlanGeometry({ side: analysis.action === 'buy' ? 'long' : 'short',
          entry: Number(analysis.suggested_entry), stopLoss: Number(analysis.suggested_stop_loss),
          takeProfit: Number(analysis.suggested_take_profit),
          minSlFraction: getRiskPolicy().minSlDistancePercent,
          minRr: optimizedRangeRetest && retestContext ? retestContext.minRr : getMethodConfig(method_id).autoEntry.minRRRatio }),
      });
    } else await recordEntryStage('ai_veto');

    // Step 5a: Enforce minimum SL distance (before execution — avoids tight stops)
    if (
      analysis.action !== 'hold' &&
      analysis.suggested_entry &&
      analysis.suggested_stop_loss &&
      analysis.suggested_take_profit
    ) {
      const entry = Number(analysis.suggested_entry);
      let sl = Number(analysis.suggested_stop_loss);
      const minSlPct = getRiskPolicy().minSlDistancePercent;
      let slCheck = checkMinSlDistance(entry, sl, minSlPct);

      if (!slCheck.ok) {
        const repaired = await tryRepairLevelsWithSecondaryKey({
          symbol,
          timeframe,
          methodId: method_id,
          analysis,
        });
        if (repaired) {
          analysis = repaired;
          sl = Number(analysis.suggested_stop_loss);
          slCheck = checkMinSlDistance(entry, sl, minSlPct);
        }
      }

      if (!slCheck.ok) {
        const reason = `SL distance ${(slCheck.distancePct * 100).toFixed(2)}% below min ${(slCheck.minPct * 100).toFixed(2)}%`;
        let decisionRecordId: number | undefined;
        if (this.config.enableMemory) {
          const row = await memoryService.storeDecision({
            symbol,
            timeframe,
            playbook_key: 'unknown',
            grade: 'A',
            confidence: analysis.confidence || 0,
            regime: 'unknown',
            decision: 'no_trade',
            reason: `Risk engine: ${reason} · ${formatLlmTradeSummary(analysis)}`,
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
      let { analysis: withRr, computedRr } = reconcileExpectedRr(analysis);
      analysis = withRr;
      const methodConfig = getMethodConfig(method_id);
      const minRr = optimizedRangeRetest && retestContext
        ? retestContext.minRr
        : methodConfig.autoEntry.minRRRatio;

      if (computedRr != null && computedRr + 1e-9 < minRr) {
        const reason = `R:R ${computedRr.toFixed(2)} below minimum ${minRr} (from entry/SL/TP)`;
        if (this.config.enableMemory) {
          await memoryService.storeDecision({
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
      const account = await getOrCreateTestnetAccount(symbol, method_id, 10000);

      const accountGuard = await assertTestnetAccountCanOpenTrade(account.id, symbol);
      if (!accountGuard.allowed) {
        if (this.config.enableMemory) {
          await memoryService.storeDecision({
            symbol,
            timeframe,
            playbook_key: signalResult?.setupResult.playbookKey || 'unknown',
            grade: signalResult?.setupResult.grade ?? 'D',
            confidence: signalResult?.setupResult.confidence ?? 0,
            regime: resolveGateRegimeFromSignal(signalResult ?? undefined),
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

      const accountBalance = Number(
        account.current_balance ?? account.equity ?? account.starting_balance ?? 10000
      );

      const riskCheck = riskManagerService.canOpenTrade({
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
          await memoryService.storeDecision({
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
    const gateRegime = resolveGateRegimeFromSignal(signalResult);
    const localRegime = signalResult?.setupResult.regime ?? 'unknown';
    const gatePlaybook = signalResult?.setupResult.playbookKey || 'unknown';
    // Grade A breakout may skip 1h-trend only for longs — shorts need HTF (Aug-24 short-into-bounce).
    const breakoutImpulse =
      shouldBypassRegimeForBreakout(
        timeframe,
        gatePlaybook === 'unknown' ? null : gatePlaybook,
        gateGrade === 'A' || gateGrade === 'B' || gateGrade === 'C' || gateGrade === 'D'
          ? gateGrade
          : 'D'
      ) && playbookSide === 'long';

    // LLM veto-only: hold = veto; buy/sell = confirm signal gate pass
    const llmConfirms = analysis.action !== 'hold';
    const blockRange = isRangeEntryBlocked(gateRegime);

    if (llmConfirms && blockRange && !rangePermissionActive) {
      const ltfNote =
        localRegime !== gateRegime ? ` (LTF ${localRegime}, gate ${gateRegime})` : '';
      const reason = `Regime ${gateRegime} blocked for entries (V3_BLOCK_RANGE_ENTRIES)${ltfNote}`;
      if (this.config.enableMemory) {
        await memoryService.storeDecision({
          symbol,
          timeframe,
          playbook_key: gatePlaybook,
          grade: gateGrade,
          confidence: gateConfidence,
          regime: gateRegime,
          decision: 'no_trade',
          reason: `LLM confirmed but ${reason} · ${formatLlmTradeSummary(analysis)}`,
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

    const htfTf = getV3RequireHtfTrend();
    if (llmConfirms && htfTf && !breakoutImpulse && !rangePermissionActive) {
      const htfState = readFreshHtfScanState(symbol, htfTf);
      if (!htfState.fresh) {
        const reason = htfState.reason ?? `HTF ${htfTf} scan unavailable`;
        if (this.config.enableMemory) {
          await memoryService.storeDecision({
            symbol,
            timeframe,
            playbook_key: gatePlaybook,
            grade: gateGrade,
            confidence: gateConfidence,
            regime: gateRegime,
            decision: 'no_trade',
            reason: `LLM confirmed but ${reason} · ${formatLlmTradeSummary(analysis)}`,
            method_id,
            candle_hash: candleHash,
          });
        }
        return { decision: 'no_trade', reason, analysis, memory_context: memoryContext };
      }

      const htfRegime = htfState.regime;
      const altTf = getV3HtfTrendAlt();
      let altRegime: string | undefined;
      let altUnavailableReason: string | undefined;
      if (altTf && htfRegime !== 'trend') {
        const altState = readFreshHtfScanState(symbol, altTf);
        if (altState.fresh) {
          altRegime = altState.regime;
        } else {
          altRegime = 'unknown';
          altUnavailableReason = altState.reason ?? `HTF ${altTf} scan unavailable`;
        }
      }
      const htfCheck = evaluateHtfTrendRequirement({
        entryTimeframe: timeframe,
        primaryTf: htfTf,
        primaryRegime: htfRegime,
        altTf,
        altRegime,
      });
      if (!htfCheck.pass) {
        const reason =
          altUnavailableReason ??
          htfCheck.reason ??
          `HTF ${htfTf} regime ${htfRegime} !== trend (V3_REQUIRE_HTF_TREND)`;
        if (this.config.enableMemory) {
          await memoryService.storeDecision({
            symbol,
            timeframe,
            playbook_key: gatePlaybook,
            grade: gateGrade,
            confidence: gateConfidence,
            regime: gateRegime,
            decision: 'no_trade',
            reason: `LLM confirmed but ${reason} · ${formatLlmTradeSummary(analysis)}`,
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

    if (llmConfirms && !rangePermissionActive) {
      const gradeFilter = evaluateSetupGradePlaybookFilter({
        grade: gateGrade,
        confidence: gateConfidence,
        playbookKey: gatePlaybook === 'unknown' ? null : gatePlaybook,
      });
      if (!gradeFilter.pass) {
        const reason = gradeFilter.reason ?? 'grade/playbook filter blocked entry';
        if (this.config.enableMemory) {
          await memoryService.storeDecision({
            symbol,
            timeframe,
            playbook_key: gatePlaybook,
            grade: gateGrade,
            confidence: gateConfidence,
            regime: gateRegime,
            decision: 'no_trade',
            reason: `LLM confirmed but ${reason} · ${formatLlmTradeSummary(analysis)}`,
            method_id,
            candle_hash: candleHash,
          });
        }
        return { decision: 'no_trade', reason, analysis, memory_context: memoryContext };
      }
    }

    if (llmConfirms) {
      const scanState = (tf: string) => readFreshHtfScanState(symbol, tf);
      const side = analysis.action === 'buy' ? 'long' : 'short';

      // Phase B: LLM side must match playbook direction
      const pbMatch = evaluatePlaybookSideMatch({
        llmSide: side,
        playbookSide,
      });
      if (!pbMatch.pass) {
        const reason = pbMatch.reason ?? 'playbook side mismatch';
        if (this.config.enableMemory) {
          await memoryService.storeDecision({
            symbol,
            timeframe,
            playbook_key: gatePlaybook,
            grade: gateGrade,
            confidence: gateConfidence,
            regime: gateRegime,
            decision: 'no_trade',
            reason: `LLM confirmed but ${reason} · ${formatLlmTradeSummary(analysis)}`,
            method_id,
            candle_hash: candleHash,
          });
        }
        return { decision: 'no_trade', reason, analysis, memory_context: memoryContext };
      }

      // Phase A post-LLM assert (LLM may flip side vs playbook — already matched above)
      if (!rangePermissionActive && isV3StructureBiasEnabled()) {
        try {
          const structTf = getV3StructureBiasTf();
          const structLimit = getV3StructureBiasCandleLimit();
          const { candles: structCandles } = await getCandles({
            symbol,
            timeframe: structTf,
            limit: structLimit + 1,
          });
          const closedStructCandles = closedCandlesOnly(structCandles, structTf).slice(-structLimit);
          const structCheck = evaluateStructureSidePermission({
            side,
            candles: closedStructCandles,
          });
          structureBias = structCheck.bias;
          if (!structCheck.pass) {
            const reason = structCheck.reason ?? 'structure bias blocked';
            if (this.config.enableMemory) {
              await memoryService.storeDecision({
                symbol,
                timeframe,
                playbook_key: gatePlaybook,
                grade: gateGrade,
                confidence: gateConfidence,
                regime: gateRegime,
                decision: 'no_trade',
                reason: `LLM confirmed but ${reason} · ${formatLlmTradeSummary(analysis)}`,
                method_id,
                candle_hash: candleHash,
              });
            }
            return { decision: 'no_trade', reason, analysis, memory_context: memoryContext };
          }
        } catch (structErr: unknown) {
          const msg = structErr instanceof Error ? structErr.message : String(structErr);
          const reason = `structure bias unavailable: ${msg}`;
          if (this.config.enableMemory) {
            await memoryService.storeDecision({
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

      const alignTf = getV3HtfSideAlignTf();
      const alignState = scanState(alignTf);
      if (!rangePermissionActive && isV3RequireHtfSideAlign() && !alignState.fresh) {
        const reason = alignState.reason ?? `HTF ${alignTf} scan unavailable`;
        if (this.config.enableMemory) {
          await memoryService.storeDecision({
            symbol,
            timeframe,
            playbook_key: gatePlaybook,
            grade: gateGrade,
            confidence: gateConfidence,
            regime: gateRegime,
            decision: 'no_trade',
            reason: `LLM confirmed but ${reason} · ${formatLlmTradeSummary(analysis)}`,
            method_id,
            candle_hash: candleHash,
          });
        }
        return { decision: 'no_trade', reason, analysis, memory_context: memoryContext };
      }
      const sideAlign = evaluateHtfSideAlign({
        side,
        htfTf: alignTf,
        htf: alignState,
        structureBias,
      });
      if (!rangePermissionActive && !sideAlign.pass) {
        const reason = sideAlign.reason ?? 'HTF side align blocked';
        if (this.config.enableMemory) {
          await memoryService.storeDecision({
            symbol,
            timeframe,
            playbook_key: gatePlaybook,
            grade: gateGrade,
            confidence: gateConfidence,
            regime: gateRegime,
            decision: 'no_trade',
            reason: `LLM confirmed but ${reason} · ${formatLlmTradeSummary(analysis)}`,
            method_id,
            candle_hash: candleHash,
          });
        }
        return { decision: 'no_trade', reason, analysis, memory_context: memoryContext };
      }

      if (isFundingVetoEnabled()) {
        const pair = `${symbol.toUpperCase().replace(/USDT$/i, '')}USDT`;
        const fundingRate = await fetchCachedFundingRate(pair, getPremiumIndex);
        const fundingCheck = evaluateFundingVeto({ side, fundingRate });
        if (!fundingCheck.pass) {
          const reason = fundingCheck.reason ?? 'funding veto blocked';
          if (this.config.enableMemory) {
            await memoryService.storeDecision({
              symbol,
              timeframe,
              playbook_key: gatePlaybook,
              grade: gateGrade,
              confidence: gateConfidence,
              regime: gateRegime,
              decision: 'no_trade',
              reason: `LLM confirmed but ${reason} · ${formatLlmTradeSummary(analysis)}`,
              method_id,
              candle_hash: candleHash,
            });
          }
          return { decision: 'no_trade', reason, analysis, memory_context: memoryContext };
        }
      }

      if (!rangePermissionActive && isV3RequirePullback() && analysis.suggested_entry != null) {
        try {
          const pbTf = getV3PullbackTf();
          const period = getV3PullbackSmaPeriod();
          const { candles: pbCandles } = await getCandles({
            symbol,
            timeframe: pbTf,
            limit: period + 5,
          });
          const closes = closedCandlesOnly(pbCandles, pbTf).map((c) => c.close);
          const maxAbove = breakoutImpulse
            ? getV3BreakoutPullbackMaxAbovePct()
            : getV3PullbackMaxAbovePct();
          const evaluation = evaluateRecordedPullback({
            side,
            entry: analysis.suggested_entry,
            closes,
            smaPeriod: period,
            maxAbovePct: maxAbove,
            maxBelowPct: getV3PullbackMaxBelowPct(),
            tfLabel: `SMA${period}@${pbTf}`,
            enabled: isV3RequirePullback(),
          });
          const pb = evaluation.result;
          await recordEntryStage('pullback_evaluated', { evaluation,
            entry_source: 'analysis.suggested_entry', observed_at: Date.now() });
          if (!pb.pass) {
            const reason = pb.reason ?? 'pullback entry blocked';
            if (this.config.enableMemory) {
              await memoryService.storeDecision({
                symbol,
                timeframe,
                playbook_key: gatePlaybook,
                grade: gateGrade,
                confidence: gateConfidence,
                regime: gateRegime,
                decision: 'no_trade',
                reason: `LLM confirmed but ${reason} · ${formatLlmTradeSummary(analysis)}`,
                method_id,
                candle_hash: candleHash,
              });
            }
            return { decision: 'no_trade', reason, analysis, memory_context: memoryContext };
          }
        } catch (pbErr: unknown) {
          await recordEntryStage('pullback_unavailable', { data_status: 'unavailable' });
          const msg = pbErr instanceof Error ? pbErr.message : String(pbErr);
          console.warn(`[GroqDispatch] Pullback check skipped: ${msg}`);
        }
      } else if (isV3BlockEntryExtension() && analysis.suggested_entry != null) {
        try {
          const extTf = getV3EntryExtensionTf();
          const extBars = getV3EntryExtensionBars();
          const { candles: extCandles } = await getCandles({
            symbol,
            timeframe: extTf,
            limit: extBars + 2,
          });
          const window = extCandles.slice(-extBars);
          if (window.length >= 3) {
            const rangeHigh = Math.max(...window.map((c) => c.high));
            const rangeLow = Math.min(...window.map((c) => c.low));
            const ext = evaluateEntryExtension({
              side,
              entry: analysis.suggested_entry,
              rangeHigh,
              rangeLow,
              maxExtensionPct: getV3MaxEntryExtensionPct(),
              tfLabel: `${extBars}×${extTf}`,
            });
            if (!ext.pass) {
              const reason = ext.reason ?? 'entry extension blocked';
              if (this.config.enableMemory) {
                await memoryService.storeDecision({
                  symbol,
                  timeframe,
                  playbook_key: gatePlaybook,
                  grade: gateGrade,
                  confidence: gateConfidence,
                  regime: gateRegime,
                  decision: 'no_trade',
                  reason: `LLM confirmed but ${reason} · ${formatLlmTradeSummary(analysis)}`,
                  method_id,
                  candle_hash: candleHash,
                });
              }
              return { decision: 'no_trade', reason, analysis, memory_context: memoryContext };
            }
          }
        } catch (extErr: unknown) {
          const msg = extErr instanceof Error ? extErr.message : String(extErr);
          console.warn(`[GroqDispatch] Entry extension check skipped: ${msg}`);
        }
      }

      if (timeframe === '5m' && !rangePermissionActive) {
        const fiveMGuard = evaluate5mEntryGuards({
          entryTimeframe: timeframe,
          side,
          tf1h: scanState('1h'),
          tf15m: scanState('15m'),
        });
        if (!fiveMGuard.pass) {
          const reason = fiveMGuard.reason ?? '5m entry guard blocked';
          if (this.config.enableMemory) {
            await memoryService.storeDecision({
              symbol,
              timeframe,
              playbook_key: gatePlaybook,
              grade: gateGrade,
              confidence: gateConfidence,
              regime: gateRegime,
              decision: 'no_trade',
              reason: `LLM confirmed but ${reason} · ${formatLlmTradeSummary(analysis)}`,
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
        await memoryService.storeDecision({
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

    if(input.causalPlan) {
      const block = causalPlanBlock(input.causalPlan,symbol,timeframe,Date.now()) ?? causalAnalysisBlock(input.causalPlan,analysis);
      if(block) return {decision:'no_trade',reason:block,analysis};
    }
    // Step 6: Store decision
    let decisionRecordId: number | undefined;
    const isTrade = llmConfirms;
    const llmSummary = isTrade
      ? formatLlmTradeSummary(analysis)
      : analysis.reason_summary || 'LLM: hold (veto)';

    if (this.config.enableMemory) {
      const row = await memoryService.storeDecision({
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
  private async callGroqWithValidation(
    systemPrompt: string,
    userPrompt: string,
    shadowContext: {
      symbol: string;
      timeframe: string;
      decisionCandleOpenMs?: number;
      candidateKey?: string;
      expectedSide?: 'long' | 'short' | null;
      causalPlan?: CausalPlanContract;
    }
  ): Promise<GroqAnalysis | null> {
    const client = createGroqClient();
    const selectorPlan = shadowContext.causalPlan && causalPlanSelectorEnabled()
      ? shadowContext.causalPlan : undefined;
    
    if (!client) {
      console.error('[GroqDispatch] No Groq client available');
      return null;
    }

    for (let attempt = 0; attempt <= this.config.maxRetries; attempt++) {
      try {
        if(selectorPlan) {
          const block = causalPlanBlock(selectorPlan,shadowContext.symbol,shadowContext.timeframe,Date.now());
          if(block) {
            await recordEntryStage('causal_selector_blocked',{reason:block,plan_hash:selectorPlan.hash});
            return null;
          }
        }
        console.log(`[GroqDispatch] Attempt ${attempt + 1}/${this.config.maxRetries + 1}`);
        
        const raw = await withProviderPurpose('dispatch', () => client.analyze({
          systemPrompt,
          userPrompt,
          temperature: 0.2,
          maxRetries: 0, // We handle retries at dispatch level
          ...(selectorPlan ? {responseFormat:'json_object' as const}
            : shadowContext.causalPlan&&process.env.CAUSAL_REVIEW_RESPONSE_FORMAT==='json_schema'
              ? {responseFormat:'json_schema' as const} : {})
        }));

        const selected = selectorPlan
          ? decodeCausalPlanSelector(raw,selectorPlan,shadowContext.symbol,shadowContext.timeframe,Date.now())
          : undefined;
        if(selected) {
          await recordEntryStage('causal_selector_reviewed',{
            plan_hash:selectorPlan!.hash,reason:selected.reason,
            action:selected.analysis?.action,confidence:selected.analysis?.confidence,
          });
          if(!selected.analysis)throw new Error(selected.reason ?? 'causal_selector_invalid_response');
        }
        const analysis = selected?.analysis ?? this.normalizeGroqAnalysis(raw);
        if (!analysis || !this.validateResponse(analysis)) {
          throw new Error('Invalid response structure from Groq');
        }

        console.log('[GroqDispatch] Successfully validated response');
        if (process.env.NODE_ENV !== 'test') {
          void observeOpenRouterShadowDecision({
            systemPrompt,
            userPrompt,
            primaryAnalysis: analysis,
            ...shadowContext,
          });
        }
        return analysis;

      } catch (error: unknown) {
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
  private normalizeGroqAnalysis(raw: GroqAnalysis | null): GroqAnalysis | null {
    if (!raw || typeof raw !== 'object') return null;

    const record = raw as Record<string, unknown>;
    const nested =
      record.btc ??
      record.BTC ??
      record.eth ??
      record.ETH ??
      (typeof record.symbol === 'string'
        ? record[record.symbol.toLowerCase()]
        : undefined);

    const base =
      nested && typeof nested === 'object' && !Array.isArray(nested)
        ? ({ ...(nested as Record<string, unknown>) } as GroqAnalysis)
        : raw;

    if (typeof base.confidence === 'string') {
      const parsed = parseFloat(base.confidence);
      if (!Number.isNaN(parsed)) base.confidence = parsed;
    }
    if (typeof base.confidence === 'number' && base.confidence > 1) {
      base.confidence = base.confidence / 100;
    }

    const { analysis: withRr } = reconcileExpectedRr(base);
    return withRr;
  }

  /**
   * Validate Groq response structure
   */
  private validateResponse(analysis: GroqAnalysis | null): boolean {
    if (!analysis) return false;
    
    // Check required fields
    if (typeof analysis.bias !== 'string') return false;
    if (typeof analysis.action !== 'string') return false;
    if (typeof analysis.confidence !== 'number' || Number.isNaN(analysis.confidence)) return false;

    // Check bias-action consistency
    if (analysis.bias === 'bullish' && analysis.action !== 'buy') return false;
    if (analysis.bias === 'bearish' && analysis.action !== 'sell') return false;
    if (analysis.bias === 'neutral' && analysis.action !== 'hold') return false;

    // Check SL/TP placement if provided
    if (analysis.suggested_entry && analysis.suggested_stop_loss && analysis.suggested_take_profit) {
      if (analysis.bias === 'bullish') {
        if (analysis.suggested_stop_loss >= analysis.suggested_entry) return false;
        if (analysis.suggested_take_profit <= analysis.suggested_entry) return false;
      } else if (analysis.bias === 'bearish') {
        if (analysis.suggested_stop_loss <= analysis.suggested_entry) return false;
        if (analysis.suggested_take_profit >= analysis.suggested_entry) return false;
      }
    }

    return true;
  }

  /**
   * Build base prompt from candle data
   */
  private buildBasePrompt(candles: UnifiedCandle[], symbol: string, timeframe: string): string {
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

    const minSlPct = getRiskPolicy().minSlDistancePercent;
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
  updateConfig(config: Partial<GroqDispatchConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /**
   * Get current configuration
   */
  getConfig(): GroqDispatchConfig {
    return { ...this.config };
  }
}

// Export singleton instance
export const groqDispatchService = new GroqDispatchService();
