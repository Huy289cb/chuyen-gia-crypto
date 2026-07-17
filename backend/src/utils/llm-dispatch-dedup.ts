/**
 * Reconstruct Groq dispatch output from a stored trade_decisions row.
 * Used to skip duplicate LLM calls for the same candle bar.
 */

import type { TradeDecision } from '@prisma/client';
import type { GroqAnalysis } from '../services/groq-client';

export interface StoredDecisionDispatchOutput {
  decision: 'trade' | 'no_trade';
  analysis?: GroqAnalysis;
  reason: string;
  decisionRecordId?: number;
}

const ACTION_RE = /LLM:\s*(buy|sell|hold|long|short)\b/i;

export function parseActionFromStoredReason(reason: string): 'buy' | 'sell' | 'hold' | null {
  const match = reason.match(ACTION_RE);
  if (!match) return null;
  const raw = match[1].toLowerCase();
  if (raw === 'long') return 'buy';
  if (raw === 'short') return 'sell';
  if (raw === 'buy' || raw === 'sell' || raw === 'hold') return raw;
  return null;
}

export function analysisFromStoredDecision(row: TradeDecision): GroqAnalysis | undefined {
  if (row.decision !== 'trade' || row.entry_price == null) return undefined;

  const action = parseActionFromStoredReason(row.reason) ?? 'hold';
  const bias =
    action === 'buy' ? 'bullish' : action === 'sell' ? 'bearish' : 'neutral';

  return {
    bias,
    action,
    confidence: row.confidence,
    suggested_entry: row.entry_price,
    suggested_stop_loss: row.stop_loss ?? undefined,
    suggested_take_profit: row.take_profit ?? undefined,
    expected_rr: row.expected_rr ?? undefined,
    reason_summary: row.reason,
  };
}

export function buildDispatchOutputFromStoredDecision(row: TradeDecision): StoredDecisionDispatchOutput {
  const isTrade = row.decision === 'trade' && row.entry_price != null;
  const analysis = isTrade ? analysisFromStoredDecision(row) : undefined;

  return {
    decision: isTrade && analysis?.action && analysis.action !== 'hold' ? 'trade' : 'no_trade',
    analysis,
    reason: row.reason,
    decisionRecordId: row.id,
  };
}
