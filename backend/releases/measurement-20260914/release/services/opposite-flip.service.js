"use strict";
/**
 * When a new LLM entry opposes open Binance exposure, evaluate early close (flip) via Groq.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.tryOppositeFlipBeforeEntry = tryOppositeFlipBeforeEntry;
const groq_client_1 = require("./groq-client");
const groq_models_1 = require("../config/groq-models");
const v3_entry_policy_1 = require("../config/v3-entry-policy");
const binance_exposure_service_1 = require("./binance-exposure.service");
const testnet_repository_1 = require("../repositories/testnet.repository");
const prisma_1 = require("../lib/prisma");
const position_close_service_1 = require("./position-close.service");
const v3_entry_eligibility_service_1 = require("./v3-entry-eligibility.service");
async function evaluateFlipWithGroq(input, held) {
    const groq = (0, groq_client_1.createGroqClient)();
    if (!groq)
        return null;
    const systemPrompt = 'You are a crypto futures risk reviewer. Return JSON only: {"close_existing":boolean,"confidence":0-1,"reason":"short"}';
    const userPrompt = [
        `Open ${held.side.toUpperCase()} on ${input.symbol}: entry≈${held.entryPrice}, mark≈${held.markPrice}, qty≈${held.sizeQty}`,
        `New signal (${input.timeframe}): ${input.newSide.toUpperCase()} entry=${input.analysis.suggested_entry} SL=${input.analysis.suggested_stop_loss} TP=${input.analysis.suggested_take_profit}`,
        `LLM confidence=${((input.analysis.confidence ?? 0) * 100).toFixed(0)}% bias=${input.analysis.bias} reason=${input.analysis.reason_summary ?? ''}`,
        'Should we market-close the existing position to allow the opposite entry?',
        'close_existing=true only if structure clearly reversed and new setup is strong; else false.',
    ].join('\n');
    try {
        const content = await groq.completeText({
            systemPrompt,
            userPrompt,
            temperature: 0.15,
            maxRetries: 1,
            maxTokens: 256,
            preferredModels: (0, groq_models_1.getGroqAuxiliaryModelChain)(2),
        });
        const start = content.indexOf('{');
        const end = content.lastIndexOf('}');
        if (start === -1 || end <= start)
            return null;
        const parsed = JSON.parse(content.slice(start, end + 1));
        if (typeof parsed.close_existing === 'boolean' && typeof parsed.confidence === 'number') {
            return parsed;
        }
        return null;
    }
    catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.warn(`[OppositeFlip] Groq evaluation failed: ${msg}`);
        return null;
    }
}
async function tryOppositeFlipBeforeEntry(input) {
    if (!(0, v3_entry_policy_1.isV3OppositeFlipEnabled)()) {
        return {
            flipped: false,
            reason: `Cannot open ${input.newSide}: opposite exposure (flip disabled)`,
        };
    }
    const opposite = (0, v3_entry_eligibility_service_1.oppositeLocalSide)(input.newSide);
    const [dbOpens, binanceNet] = await Promise.all([
        (0, testnet_repository_1.getActiveTestnetPositions)({ symbol: input.symbol, methodId: input.methodId }),
        (0, binance_exposure_service_1.fetchBinanceNetPosition)(input.symbol).catch(() => null),
    ]);
    const oppositeDb = dbOpens.filter((p) => String(p.side).toLowerCase() === opposite);
    const hasBinanceOpposite = binanceNet != null && binanceNet.side === opposite && binanceNet.positionAmt > 0;
    if (oppositeDb.length === 0 && !hasBinanceOpposite) {
        return { flipped: false, reason: 'no opposite exposure' };
    }
    const heldSide = opposite;
    const heldEntry = binanceNet?.entryPrice ??
        Number(oppositeDb[0]?.entry_price) ??
        0;
    const heldMark = binanceNet?.markPrice ?? heldEntry;
    const heldQty = binanceNet?.positionAmt ??
        oppositeDb.reduce((s, p) => s + Math.abs(Number(p.size_qty) || 0), 0);
    const decision = await evaluateFlipWithGroq(input, {
        side: heldSide,
        entryPrice: heldEntry,
        markPrice: heldMark,
        sizeQty: heldQty,
    });
    const minConf = (0, v3_entry_policy_1.getV3OppositeFlipMinConfidence)();
    const newConf = input.analysis.confidence ?? 0;
    const shouldClose = decision?.close_existing === true &&
        (decision.confidence ?? 0) >= minConf &&
        newConf >= minConf;
    if (!shouldClose) {
        const why = decision?.reason ??
            (decision
                ? `flip rejected (decision conf ${((decision.confidence ?? 0) * 100).toFixed(0)}% / min ${(minConf * 100).toFixed(0)}%)`
                : 'flip evaluation unavailable');
        return {
            flipped: false,
            reason: `Cannot open ${input.newSide}: opposite ${heldSide} held — ${why}`,
        };
    }
    console.log(`[OppositeFlip] Closing opposite ${heldSide} before ${input.newSide} entry (${decision?.reason ?? 'LLM flip'})`);
    if (hasBinanceOpposite && heldQty > 0) {
        const closeResult = await (0, position_close_service_1.closePositionOnBinanceMarket)({
            symbol: input.symbol,
            side: heldSide,
            size_qty: heldQty,
        });
        if (!closeResult.ok) {
            return {
                flipped: false,
                reason: `Opposite ${heldSide} close failed: ${closeResult.reason}`,
            };
        }
    }
    for (const pos of oppositeDb) {
        const full = await prisma_1.prisma.testnetPosition.findUnique({
            where: { position_id: pos.position_id },
            include: { account: true },
        });
        if (!full || full.status !== 'open' || !full.account)
            continue;
        const closePrice = heldMark > 0 ? heldMark : full.current_price;
        await (0, position_close_service_1.closeLocalPosition)({ ...full, account: full.account }, closePrice, 'llm_opposite_flip', { verified_binance_zero: true, flip_to: input.newSide });
        await (0, testnet_repository_1.recordTestnetTradeEvent)(full.position_id, 'opposite_flip_close', {
            new_side: input.newSide,
            timeframe: input.timeframe,
            llm_confidence: newConf,
            flip_reason: decision?.reason,
        });
    }
    return { flipped: true, reason: `Closed opposite ${heldSide} for ${input.newSide} flip` };
}
//# sourceMappingURL=opposite-flip.service.js.map