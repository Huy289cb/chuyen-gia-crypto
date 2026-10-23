"use strict";
/**
 * Reconstruct Groq dispatch output from a stored trade_decisions row.
 * Used to skip duplicate LLM calls for the same candle bar.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.shouldRevalidateStoredTrade = shouldRevalidateStoredTrade;
exports.parseActionFromStoredReason = parseActionFromStoredReason;
exports.analysisFromStoredDecision = analysisFromStoredDecision;
exports.buildDispatchOutputFromStoredDecision = buildDispatchOutputFromStoredDecision;
/**
 * A stored trade is an LLM-result cache hit, not an execution authorization.
 * It must pass all current live hard gates again before it can be returned.
 */
function shouldRevalidateStoredTrade(output) {
    return output.decision === 'trade' && output.analysis != null;
}
const ACTION_RE = /LLM:\s*(buy|sell|hold|long|short)\b/i;
function parseActionFromStoredReason(reason) {
    const match = reason.match(ACTION_RE);
    if (!match)
        return null;
    const raw = match[1].toLowerCase();
    if (raw === 'long')
        return 'buy';
    if (raw === 'short')
        return 'sell';
    if (raw === 'buy' || raw === 'sell' || raw === 'hold')
        return raw;
    return null;
}
function analysisFromStoredDecision(row) {
    if (row.decision !== 'trade' || row.entry_price == null)
        return undefined;
    const action = parseActionFromStoredReason(row.reason) ?? 'hold';
    const bias = action === 'buy' ? 'bullish' : action === 'sell' ? 'bearish' : 'neutral';
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
function buildDispatchOutputFromStoredDecision(row) {
    const isTrade = row.decision === 'trade' && row.entry_price != null;
    const analysis = isTrade ? analysisFromStoredDecision(row) : undefined;
    return {
        decision: isTrade && analysis?.action && analysis.action !== 'hold' ? 'trade' : 'no_trade',
        analysis,
        reason: row.reason,
        decisionRecordId: row.id,
    };
}
//# sourceMappingURL=llm-dispatch-dedup.js.map