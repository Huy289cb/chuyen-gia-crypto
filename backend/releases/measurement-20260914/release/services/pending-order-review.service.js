"use strict";
/**
 * LLM review of unfilled limit pending orders (hold / cancel / modify).
 * Runs when pending exists — does not block new-trade dispatch path.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.runPendingOrderReview = runPendingOrderReview;
const prisma_1 = require("../lib/prisma");
const market_repository_1 = require("../repositories/market.repository");
const groq_client_1 = require("./groq-client");
const groq_models_1 = require("../config/groq-models");
const memory_service_1 = require("./memory.service");
const pending_order_policy_1 = require("../config/pending-order-policy");
const pending_order_actions_1 = require("./pending-order-actions");
const pending_order_decisions_1 = require("../utils/pending-order-decisions");
const market_scan_scheduler_1 = require("../schedulers/market-scan.scheduler");
const REVIEW_SYSTEM_PROMPT = `You are a crypto futures risk reviewer for UNFILLED LIMIT orders only.
Return valid JSON only (no markdown):
{
  "pending_order_decisions": [
    {
      "order_id": "string (exact from context)",
      "action": "hold|cancel|modify",
      "confidence": 0.0-1.0,
      "reason": "short explanation",
      "new_entry": number|null,
      "new_sl": number|null,
      "new_tp": number|null
    }
  ]
}
Rules:
- Prefer hold for young pullback limits (age_hours low) — waiting for fill is normal
- cancel: only when order is old / TTL nearly up, OR HTF thesis clearly broken (not mere distance from mark)
- Do NOT cancel just because mark is away from limit entry — that is expected for limit pulls
- hold: limit entry still valid and worth waiting
- modify: only minor SL/TP tweaks in DB (exchange order price unchanged)
- Use confidence >= 0.85 only when very sure about cancel
- One decision per order_id in context`;
async function buildPendingReviewUserPrompt(symbol, orders, markPrice) {
    const now = Date.now();
    const lines = [
        `Symbol: ${symbol}`,
        `Mark price: ${markPrice}`,
        '',
        'PENDING LIMIT ORDERS:',
    ];
    for (const o of orders) {
        const ageHours = (now - new Date(o.created_at).getTime()) / (3600 * 1000);
        const tf = await (0, pending_order_actions_1.resolveTimeframeForPendingOrder)(o.order_id);
        const ttl = (0, pending_order_policy_1.getPendingOrderTtlHours)(tf);
        lines.push(`- order_id=${o.order_id} side=${o.side} entry=${o.entry_price} sl=${o.stop_loss} tp=${o.take_profit} size_usd=${o.size_usd.toFixed(0)} age_hours=${ageHours.toFixed(2)} ttl_hours=${ttl} tf=${tf ?? 'unknown'}`);
    }
    const scan15 = (0, market_scan_scheduler_1.getScanResult)(symbol, '15m');
    if (scan15?.signalResult) {
        lines.push('');
        lines.push(`Market (15m): regime=${scan15.signalResult.setupResult?.regime ?? 'unknown'} grade=${scan15.signalResult.setupResult?.grade ?? '?'} gate_pass=${scan15.signalResult.pass}`);
    }
    const reflection = await memory_service_1.memoryService.formatRecentReflectionsForPrompt(symbol);
    if (reflection) {
        lines.push('');
        lines.push(reflection);
    }
    lines.push('');
    lines.push('Respond with pending_order_decisions for every order above.');
    return lines.join('\n');
}
/**
 * Ask LLM to review pending limits; apply cancel/modify when confidence passes threshold.
 */
async function runPendingOrderReview(symbol = 'BTC') {
    const empty = {
        reviewed: 0,
        llmCalled: false,
        cancelled: 0,
        modified: 0,
        held: 0,
        skipped: 0,
    };
    if (!(0, pending_order_policy_1.isPendingOrderReviewEnabled)()) {
        return empty;
    }
    const pending = await prisma_1.prisma.testnetPendingOrder.findMany({
        where: { symbol: symbol.toUpperCase(), status: 'pending' },
        orderBy: { created_at: 'asc' },
    });
    if (pending.length === 0) {
        return empty;
    }
    const latest = await (0, market_repository_1.getLatestPrice)(symbol);
    const markPrice = latest?.price ?? 0;
    if (markPrice <= 0) {
        console.warn('[PendingReview] No mark price — skip LLM review');
        return { ...empty, reviewed: pending.length };
    }
    const client = (0, groq_client_1.createGroqClient)();
    if (!client) {
        console.warn('[PendingReview] Groq unavailable — skip');
        return { ...empty, reviewed: pending.length };
    }
    const userPrompt = await buildPendingReviewUserPrompt(symbol, pending, markPrice);
    try {
        const analysis = await client.analyze({
            systemPrompt: REVIEW_SYSTEM_PROMPT,
            userPrompt,
            temperature: 0.2,
            maxRetries: 1,
            preferredModels: (0, groq_models_1.getGroqAuxiliaryModelChain)(2),
        });
        const decisions = (0, pending_order_decisions_1.parsePendingOrderDecisions)(analysis.pending_order_decisions);
        if (decisions.length === 0) {
            console.log('[PendingReview] No valid pending_order_decisions in LLM response');
            return { ...empty, reviewed: pending.length, llmCalled: true };
        }
        const applied = await (0, pending_order_decisions_1.applyPendingOrderDecisions)(decisions, (0, pending_order_policy_1.getPendingOrderReviewMinConfidence)());
        console.log(`[PendingReview] Applied: cancelled=${applied.cancelled} modified=${applied.modified} held=${applied.held} skipped=${applied.skipped}`);
        return {
            reviewed: pending.length,
            llmCalled: true,
            cancelled: applied.cancelled,
            modified: applied.modified,
            held: applied.held,
            skipped: applied.skipped,
        };
    }
    catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        console.error(`[PendingReview] LLM review failed: ${msg}`);
        return { ...empty, reviewed: pending.length, llmCalled: true };
    }
}
//# sourceMappingURL=pending-order-review.service.js.map