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
  evaluateTrendPullbackEntry,
  evaluateSetupGradePlaybookFilter,
  getV3EntryExtensionBars,
  getV3EntryExtensionTf,
  getV3HtfSideAlignTf,
  getV3HtfTrendAlt,
  getV3MaxEntryExtensionPct,
  getV3PullbackMaxAbovePct,
  getV3PullbackMaxBelowPct,
  getV3PullbackSmaPeriod,
  getV3PullbackTf,
  getV3RequireHtfTrend,
  isRangeEntryBlocked,
  isRegimeAllowedForEntry,
  isV3BlockEntryExtension,
  isV3RequirePullback,
  resolveGateRegimeFromSignal,
} from '../config/v3-entry-policy';
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
import {
  tryRepairLevelsWithSecondaryKey,
  tryRepairTpForMinRrWithSecondaryKey,
} from './groq-levels-adapter.service';
import { buildDispatchOutputFromStoredDecision } from '../utils/llm-dispatch-dedup';

export interface GroqDispatchInput {
  symbol: string;
  timeframe: string;
  candles: UnifiedCandle[];
  systemPrompt: string;
  method_id?: string;
  /** Precomputed by MarketScan — avoids second signal-gate evaluation */
  signalResult?: SignalGateOutput;
}

export interface GroqDispatchOutput {
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
    const { symbol, timeframe, candles, systemPrompt, method_id = 'kim_nghia', signalResult: precomputed } = input;
    const candleHash = generateCandleHash(
      candles.map((c) => ({
        timestamp: c.timestamp,
        high: c.high,
        low: c.low,
        close: c.close,
      }))
    );

    let signalResult: SignalGateOutput | undefined = precomputed;

    // Step 1: Signal Gate — use MarketScan result when provided (single evaluation per cycle)
    if (this.config.enableSignalGate) {
      if (!signalResult) {
        signalResult = await signalGateService.evaluate({
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

      const gateRegime = resolveGateRegimeFromSignal(signalResult);
      if (!isRegimeAllowedForEntry(gateRegime)) {
        return {
          decision: 'no_trade',
          reason: `Regime ${gateRegime} not in V3_ALLOWED_REGIMES (${process.env.V3_ALLOWED_REGIMES ?? 'trend'})`,
        };
      }
    }

    if (this.config.enableMemory) {
      const existing = await memoryService.findDecisionForBar(
        symbol,
        timeframe,
        candleHash,
        method_id
      );
      if (existing) {
        const cached = buildDispatchOutputFromStoredDecision(existing);
        console.log(
          `[GroqDispatch] Skip duplicate bar ${candleHash} for ${symbol} ${timeframe} — reusing decision id=${existing.id} (${cached.decision})`
        );
        return cached;
      }
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
    
    if (memoryContext) {
      userPrompt += '\n\n' + memoryService.formatContextForPrompt(memoryContext);
    }

    const reflectionPrompt = await memoryService.formatRecentReflectionsForPrompt(symbol);
    if (reflectionPrompt) {
      userPrompt += '\n\n' + reflectionPrompt;
    }

    // Step 4: Call Groq with strict validation
    let analysis = await this.callGroqWithValidation(systemPrompt, userPrompt);

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
      const minRr = methodConfig.autoEntry.minRRRatio;

      if (computedRr != null && computedRr + 1e-9 < minRr) {
        const repairedRr = await tryRepairTpForMinRrWithSecondaryKey({
          symbol,
          timeframe,
          methodId: method_id,
          analysis,
        });
        if (repairedRr) {
          analysis = repairedRr;
          const again = reconcileExpectedRr(analysis);
          analysis = again.analysis;
          computedRr = again.computedRr;
        }
      }

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

    // LLM veto-only: hold = veto; buy/sell = confirm signal gate pass
    const llmConfirms = analysis.action !== 'hold';
    const blockRange = isRangeEntryBlocked(gateRegime);

    if (llmConfirms && blockRange) {
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
    if (llmConfirms && htfTf) {
      const htfScan = getScanResult(symbol, htfTf);
      const htfRegime = htfScan?.signalResult
        ? resolveGateRegimeFromSignal(htfScan.signalResult)
        : 'unknown';
      const altTf = getV3HtfTrendAlt();
      let altRegime: string | undefined;
      if (altTf) {
        const altScan = getScanResult(symbol, altTf);
        altRegime = altScan?.signalResult
          ? resolveGateRegimeFromSignal(altScan.signalResult)
          : 'unknown';
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
          htfCheck.reason ?? `HTF ${htfTf} regime ${htfRegime} !== trend (V3_REQUIRE_HTF_TREND)`;
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

    if (llmConfirms) {
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
      const scanState = (tf: string) => {
        const scan = getScanResult(symbol, tf);
        const regime = scan?.signalResult
          ? resolveGateRegimeFromSignal(scan.signalResult)
          : 'unknown';
        const trendDirection =
          scan?.signalResult?.setupResult.evidence.regime.trendDirection ?? null;
        return { regime, trendDirection };
      };
      const side = analysis.action === 'buy' ? 'long' : 'short';
      const alignTf = getV3HtfSideAlignTf();
      const sideAlign = evaluateHtfSideAlign({
        side,
        htfTf: alignTf,
        htf: scanState(alignTf),
      });
      if (!sideAlign.pass) {
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

      if (isV3RequirePullback() && analysis.suggested_entry != null) {
        try {
          const pbTf = getV3PullbackTf();
          const period = getV3PullbackSmaPeriod();
          const { candles: pbCandles } = await getCandles({
            symbol,
            timeframe: pbTf,
            limit: period + 5,
          });
          const closes = pbCandles.map((c) => c.close);
          const pb = evaluateTrendPullbackEntry({
            side,
            entry: analysis.suggested_entry,
            closes,
            smaPeriod: period,
            maxAbovePct: getV3PullbackMaxAbovePct(),
            maxBelowPct: getV3PullbackMaxBelowPct(),
            tfLabel: `SMA${period}@${pbTf}`,
          });
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

      if (timeframe === '5m') {
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
    userPrompt: string
  ): Promise<GroqAnalysis | null> {
    const client = createGroqClient();
    
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
