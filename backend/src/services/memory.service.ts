/**
 * Memory Service
 * Stores and retrieves trading decisions, outcomes, and reflections
 * Builds context for LLM to learn from past trades
 */

import * as MemoryRepository from '../repositories/memory.repository';
import * as TradeRepository from '../repositories/trade.repository';

export interface DecisionInput {
  symbol: string;
  timeframe: string;
  playbook_key: string;
  grade: string;
  confidence: number;
  regime: string;
  decision: string;
  reason: string;
  entry_price?: number;
  stop_loss?: number;
  take_profit?: number;
  expected_rr?: number;
  candle_hash?: string;
  method_id?: string;
}

export interface OutcomeInput {
  decision_id: number;
  symbol: string;
  outcome: string;
  entry_price: number;
  exit_price: number;
  realized_pnl: number;
  realized_rr: number;
  execution_cost?: number;
  duration_minutes?: number;
  close_reason: string;
}

export interface ReflectionInput {
  outcome_id: number;
  symbol: string;
  what_went_wrong?: string;
  what_worked?: string;
  lesson_learned?: string;
}

export interface MemoryContext {
  similar_trades: any[];
  recent_failures: any[];
  playbook_stats: any;
  current_winrate: number;
}

/**
 * Memory Service
 */
export class MemoryService {
  /**
   * Store a trading decision
   */
  async storeDecision(input: DecisionInput) {
    try {
      const decision = await MemoryRepository.storeTradeDecision(input);
      console.log(`[MemoryService] Stored decision for ${input.symbol}: ${input.decision}`);
      return decision;
    } catch (error) {
      console.error('[MemoryService] Error storing decision:', error);
      throw error;
    }
  }

  /**
   * Store a trade outcome
   */
  async storeOutcome(input: OutcomeInput) {
    try {
      const outcome = await MemoryRepository.storeTradeOutcome(input);
      
      // Update playbook stats
      const decision = await TradeRepository.getTradeDecisionById(input.decision_id);
      if (decision) {
        await MemoryRepository.updatePlaybookStats(
          decision.playbook_key,
          decision.symbol,
          input.outcome,
          input.realized_pnl,
          input.realized_rr
        );
      }
      
      console.log(`[MemoryService] Stored outcome for ${input.symbol}: ${input.outcome}`);
      return outcome;
    } catch (error) {
      console.error('[MemoryService] Error storing outcome:', error);
      throw error;
    }
  }

  /**
   * Store a trade reflection
   */
  async storeReflection(input: ReflectionInput) {
    try {
      const reflection = await MemoryRepository.storeTradeReflection(input);
      console.log(`[MemoryService] Stored reflection for ${input.symbol}`);
      return reflection;
    } catch (error) {
      console.error('[MemoryService] Error storing reflection:', error);
      throw error;
    }
  }

  /**
   * Generate reflection automatically based on outcome
   */
  async generateReflection(outcomeId: number, outcome: string, pnl: number) {
    const reflection: ReflectionInput = {
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
  async buildContextForLLM(
    symbol: string,
    playbook_key: string,
    regime: string
  ): Promise<MemoryContext> {
    // Get last 3 similar trades
    const similarTrades = await MemoryRepository.getSimilarTrades(
      playbook_key,
      regime,
      symbol,
      3
    );

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
  formatContextForPrompt(context: MemoryContext): string {
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
   * Analyze loss reason (simple heuristic)
   */
  private analyzeLossReason(pnl: number): string {
    if (pnl < -1) {
      return 'Large loss - possible SL hit or market moved against position quickly';
    } else if (pnl < -0.5) {
      return 'Moderate loss - possible early exit or partial SL hit';
    } else {
      return 'Small loss - possible fee impact or minor adverse move';
    }
  }

  /**
   * Analyze win reason (simple heuristic)
   */
  private analyzeWinReason(pnl: number): string {
    if (pnl > 1) {
      return 'Large win - TP hit or favorable market move';
    } else if (pnl > 0.5) {
      return 'Moderate win - partial TP or good market move';
    } else {
      return 'Small win - quick exit or minor favorable move';
    }
  }

  /**
   * Generate lesson from outcome
   */
  private generateLesson(outcome: string, pnl: number): string {
    if (outcome === 'loss') {
      return `Review setup quality and entry timing. Loss of ${pnl.toFixed(2)} suggests need for better risk management or setup filtering.`;
    } else if (outcome === 'win') {
      return `Setup worked well with ${pnl.toFixed(2)} profit. Consider replicating similar conditions in future.`;
    } else {
      return 'Breakeven trade - review entry and exit timing for improvement.';
    }
  }

  /**
   * Get playbook performance summary
   */
  async getPlaybookPerformance(symbol: string) {
    const allStats = await MemoryRepository.getAllPlaybookStats(symbol);
    
    return allStats.map((stat: any) => ({
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

// Export singleton instance
export const memoryService = new MemoryService();
