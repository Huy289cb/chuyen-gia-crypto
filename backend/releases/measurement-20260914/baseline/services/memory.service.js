"use strict";
/**
 * Memory Service
 * Stores and retrieves trading decisions, outcomes, and reflections
 * Builds context for LLM to learn from past trades
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.memoryService = exports.MemoryService = void 0;
const MemoryRepository = __importStar(require("../repositories/memory.repository"));
const TradeRepository = __importStar(require("../repositories/trade.repository"));
/**
 * Memory Service
 */
class MemoryService {
    /**
     * Store a trading decision
     */
    async storeDecision(input) {
        try {
            const methodId = input.method_id ?? 'kim_nghia';
            if (input.candle_hash) {
                const existing = await MemoryRepository.findTradeDecisionForBar(input.symbol, input.timeframe, input.candle_hash, methodId);
                if (existing) {
                    console.log(`[MemoryService] Skip duplicate bar ${input.candle_hash} for ${input.symbol} ${input.timeframe} (id=${existing.id})`);
                    return existing;
                }
            }
            const decision = await MemoryRepository.storeTradeDecision({
                ...input,
                method_id: methodId,
            });
            console.log(`[MemoryService] Stored decision for ${input.symbol}: ${input.decision}`);
            return decision;
        }
        catch (error) {
            console.error('[MemoryService] Error storing decision:', error);
            throw error;
        }
    }
    /** Existing decision for this candle bar (LLM dedup before Groq call). */
    async findDecisionForBar(symbol, timeframe, candle_hash, method_id = 'kim_nghia') {
        return MemoryRepository.findTradeDecisionForBar(symbol, timeframe, candle_hash, method_id);
    }
    /** After LLM approved trade but Binance/order path failed */
    async recordExecutionBlocked(decisionId, _symbol, summaryLine, blockReason) {
        const reason = `${summaryLine} | Execution blocked: ${blockReason}`;
        await MemoryRepository.updateTradeDecisionReason(decisionId, reason);
        console.log(`[MemoryService] Execution blocked for decision ${decisionId}: ${blockReason}`);
    }
    /**
     * Store a trade outcome
     */
    async storeOutcome(input) {
        try {
            const outcome = await MemoryRepository.storeTradeOutcome(input);
            // Update playbook stats
            const decision = await TradeRepository.getTradeDecisionById(input.decision_id);
            if (decision) {
                await MemoryRepository.updatePlaybookStats(decision.playbook_key, decision.symbol, input.outcome, input.realized_pnl, input.realized_rr);
            }
            console.log(`[MemoryService] Stored outcome for ${input.symbol}: ${input.outcome}`);
            return outcome;
        }
        catch (error) {
            console.error('[MemoryService] Error storing outcome:', error);
            throw error;
        }
    }
    /**
     * Store a trade reflection
     */
    async storeReflection(input) {
        try {
            const reflection = await MemoryRepository.storeTradeReflection(input);
            console.log(`[MemoryService] Stored reflection for ${input.symbol}`);
            return reflection;
        }
        catch (error) {
            console.error('[MemoryService] Error storing reflection:', error);
            throw error;
        }
    }
    /**
     * Generate reflection automatically based on outcome
     */
    async generateReflection(outcomeId, outcome, pnl) {
        const reflection = {
            outcome_id: outcomeId,
            symbol: '', // Will be filled from outcome
            what_went_wrong: outcome === 'loss' ? this.analyzeLossReason(pnl) : undefined,
            what_worked: outcome === 'win' ? this.analyzeWinReason(pnl) : undefined,
            lesson_learned: this.generateLesson(outcome, pnl)
        };
        // Get symbol from outcome
        const tradeOutcome = await TradeRepository.getTradeOutcomeByDecisionId(outcomeId);
        if (tradeOutcome) {
            reflection.symbol = tradeOutcome.symbol;
        }
        return await this.storeReflection(reflection);
    }
    /**
     * Build context for LLM based on current setup
     */
    async buildContextForLLM(symbol, playbook_key, regime) {
        // Get last 3 similar trades
        const similarTrades = await MemoryRepository.getSimilarTrades(playbook_key, regime, symbol, 3);
        // Get last 2 failures
        const recentFailures = await MemoryRepository.getRecentFailures(symbol, 2);
        // Get playbook stats
        const playbookStats = await MemoryRepository.getPlaybookStats(playbook_key, symbol);
        // Calculate current winrate
        const currentWinrate = playbookStats.total_trades > 0
            ? playbookStats.win_rate
            : 0;
        return {
            similar_trades: similarTrades,
            recent_failures: recentFailures,
            playbook_stats: playbookStats,
            current_winrate: currentWinrate
        };
    }
    /**
     * Format memory context for LLM prompt
     */
    formatContextForPrompt(context) {
        let prompt = 'RELEVANT TRADING MEMORY:\n\n';
        // Similar trades
        if (context.similar_trades.length > 0) {
            prompt += 'SIMILAR TRADES:\n';
            context.similar_trades.forEach((trade, i) => {
                const outcome = trade.trade_outcome;
                prompt += `${i + 1}. ${trade.decision.toUpperCase()} - Grade: ${trade.grade}, Confidence: ${(trade.confidence * 100).toFixed(0)}%\n`;
                if (outcome) {
                    prompt += `   Outcome: ${outcome.outcome.toUpperCase()}, PnL: ${outcome.realized_pnl.toFixed(2)}, RR: ${outcome.realized_rr.toFixed(2)}\n`;
                }
            });
            prompt += '\n';
        }
        // Recent failures
        if (context.recent_failures.length > 0) {
            prompt += 'RECENT FAILURES:\n';
            context.recent_failures.forEach((failure, i) => {
                prompt += `${i + 1}. PnL: ${failure.realized_pnl.toFixed(2)}, RR: ${failure.realized_rr.toFixed(2)}\n`;
                if (failure.reflection) {
                    prompt += `   Lesson: ${failure.reflection.lesson_learned || 'N/A'}\n`;
                }
            });
            prompt += '\n';
        }
        // Playbook stats
        prompt += `PLAYBOOK STATS:\n`;
        prompt += `Total Trades: ${context.playbook_stats.total_trades}\n`;
        prompt += `Win Rate: ${context.current_winrate.toFixed(1)}%\n`;
        prompt += `Avg R:R: ${context.playbook_stats.avg_rr.toFixed(2)}\n`;
        prompt += `Avg PnL: ${context.playbook_stats.avg_pnl.toFixed(2)}\n`;
        return prompt;
    }
    /**
     * Recent trade reflections for groq dispatch / pending review (TradingAgents-style learning).
     */
    async formatRecentReflectionsForPrompt(symbol) {
        const outcomes = await MemoryRepository.getRecentOutcomesWithReflection(symbol, 5);
        if (outcomes.length === 0) {
            return '';
        }
        const lines = ['RECENT TRADE REFLECTIONS (learn from outcomes):'];
        for (const o of outcomes) {
            const r = o.reflection;
            const lesson = r?.lesson_learned?.trim();
            if (!lesson)
                continue;
            lines.push(`- ${o.outcome.toUpperCase()} PnL ${o.realized_pnl.toFixed(2)} RR ${o.realized_rr.toFixed(2)} (${o.close_reason}): ${lesson}`);
            if (r?.what_went_wrong) {
                lines.push(`  Avoid: ${r.what_went_wrong}`);
            }
            if (r?.what_worked) {
                lines.push(`  Repeat: ${r.what_worked}`);
            }
        }
        return lines.length > 1 ? lines.join('\n') : '';
    }
    /**
     * Analyze loss reason (simple heuristic)
     */
    analyzeLossReason(pnl) {
        if (pnl < -1) {
            return 'Large loss - possible SL hit or market moved against position quickly';
        }
        else if (pnl < -0.5) {
            return 'Moderate loss - possible early exit or partial SL hit';
        }
        else {
            return 'Small loss - possible fee impact or minor adverse move';
        }
    }
    /**
     * Analyze win reason (simple heuristic)
     */
    analyzeWinReason(pnl) {
        if (pnl > 1) {
            return 'Large win - TP hit or favorable market move';
        }
        else if (pnl > 0.5) {
            return 'Moderate win - partial TP or good market move';
        }
        else {
            return 'Small win - quick exit or minor favorable move';
        }
    }
    /**
     * Generate lesson from outcome
     */
    generateLesson(outcome, pnl) {
        if (outcome === 'loss') {
            return `Review setup quality and entry timing. Loss of ${pnl.toFixed(2)} suggests need for better risk management or setup filtering.`;
        }
        else if (outcome === 'win') {
            return `Setup worked well with ${pnl.toFixed(2)} profit. Consider replicating similar conditions in future.`;
        }
        else {
            return 'Breakeven trade - review entry and exit timing for improvement.';
        }
    }
    /**
     * Get playbook performance summary
     */
    async getPlaybookPerformance(symbol) {
        const allStats = await MemoryRepository.getAllPlaybookStats(symbol);
        return allStats.map((stat) => ({
            playbook_key: stat.playbook_key,
            total_trades: stat.total_trades,
            win_rate: stat.win_rate,
            avg_rr: stat.avg_rr,
            avg_pnl: stat.avg_pnl,
            total_pnl: stat.total_pnl,
            last_updated: stat.last_updated
        }));
    }
}
exports.MemoryService = MemoryService;
// Export singleton instance
exports.memoryService = new MemoryService();
//# sourceMappingURL=memory.service.js.map