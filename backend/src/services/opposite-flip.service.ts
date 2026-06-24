/**
 * When a new LLM entry opposes open Binance exposure, evaluate early close (flip) via Groq.
 */

import type { GroqAnalysis } from './groq-client';
import { createGroqClient } from './groq-client';
import { getGroqAuxiliaryModelChain } from '../config/groq-models';
import {
  getV3OppositeFlipMinConfidence,
  isV3OppositeFlipEnabled,
} from '../config/v3-entry-policy';
import { fetchBinanceNetPosition } from './binance-exposure.service';
import {
  getActiveTestnetPositions,
  recordTestnetTradeEvent,
} from '../repositories/testnet.repository';
import { prisma } from '../lib/prisma';
import {
  closeLocalPosition,
  closePositionOnBinanceMarket,
} from './position-close.service';
import type { LocalSide } from './v3-entry-eligibility.service';
import { oppositeLocalSide } from './v3-entry-eligibility.service';

export interface OppositeFlipInput {
  symbol: string;
  methodId: string;
  newSide: LocalSide;
  analysis: GroqAnalysis;
  timeframe: string;
}

export interface OppositeFlipResult {
  flipped: boolean;
  reason: string;
}

interface FlipDecision {
  close_existing: boolean;
  confidence: number;
  reason?: string;
}

async function evaluateFlipWithGroq(input: OppositeFlipInput, held: {
  side: LocalSide;
  entryPrice: number;
  markPrice: number;
  sizeQty: number;
  unrealizedHint?: number;
}): Promise<FlipDecision | null> {
  const groq = createGroqClient();
  if (!groq) return null;

  const systemPrompt =
    'You are a crypto futures risk reviewer. Return JSON only: {"close_existing":boolean,"confidence":0-1,"reason":"short"}';

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
      preferredModels: getGroqAuxiliaryModelChain(2),
    });
    const start = content.indexOf('{');
    const end = content.lastIndexOf('}');
    if (start === -1 || end <= start) return null;
    const parsed = JSON.parse(content.slice(start, end + 1)) as FlipDecision;
    if (typeof parsed.close_existing === 'boolean' && typeof parsed.confidence === 'number') {
      return parsed;
    }
    return null;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[OppositeFlip] Groq evaluation failed: ${msg}`);
    return null;
  }
}

export async function tryOppositeFlipBeforeEntry(
  input: OppositeFlipInput
): Promise<OppositeFlipResult> {
  if (!isV3OppositeFlipEnabled()) {
    return {
      flipped: false,
      reason: `Cannot open ${input.newSide}: opposite exposure (flip disabled)`,
    };
  }

  const opposite = oppositeLocalSide(input.newSide);
  const [dbOpens, binanceNet] = await Promise.all([
    getActiveTestnetPositions({ symbol: input.symbol, methodId: input.methodId }),
    fetchBinanceNetPosition(input.symbol).catch(() => null),
  ]);

  const oppositeDb = dbOpens.filter((p) => String(p.side).toLowerCase() === opposite);
  const hasBinanceOpposite =
    binanceNet != null && binanceNet.side === opposite && binanceNet.positionAmt > 0;

  if (oppositeDb.length === 0 && !hasBinanceOpposite) {
    return { flipped: false, reason: 'no opposite exposure' };
  }

  const heldSide = opposite;
  const heldEntry =
    binanceNet?.entryPrice ??
    Number(oppositeDb[0]?.entry_price) ??
    0;
  const heldMark = binanceNet?.markPrice ?? heldEntry;
  const heldQty =
    binanceNet?.positionAmt ??
    oppositeDb.reduce((s, p) => s + Math.abs(Number(p.size_qty) || 0), 0);

  const decision = await evaluateFlipWithGroq(input, {
    side: heldSide,
    entryPrice: heldEntry,
    markPrice: heldMark,
    sizeQty: heldQty,
  });

  const minConf = getV3OppositeFlipMinConfidence();
  const newConf = input.analysis.confidence ?? 0;

  const shouldClose =
    decision?.close_existing === true &&
    (decision.confidence ?? 0) >= minConf &&
    newConf >= minConf;

  if (!shouldClose) {
    const why =
      decision?.reason ??
      (decision
        ? `flip rejected (decision conf ${((decision.confidence ?? 0) * 100).toFixed(0)}% / min ${(minConf * 100).toFixed(0)}%)`
        : 'flip evaluation unavailable');
    return {
      flipped: false,
      reason: `Cannot open ${input.newSide}: opposite ${heldSide} held — ${why}`,
    };
  }

  console.log(
    `[OppositeFlip] Closing opposite ${heldSide} before ${input.newSide} entry (${decision?.reason ?? 'LLM flip'})`
  );

  if (hasBinanceOpposite && heldQty > 0) {
    const closeResult = await closePositionOnBinanceMarket({
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
    const full = await prisma.testnetPosition.findUnique({
      where: { position_id: pos.position_id },
      include: { account: true },
    });
    if (!full || full.status !== 'open' || !full.account) continue;

    const closePrice = heldMark > 0 ? heldMark : full.current_price;
    await closeLocalPosition(
      { ...full, account: full.account },
      closePrice,
      'llm_opposite_flip',
      { verified_binance_zero: true, flip_to: input.newSide }
    );
    await recordTestnetTradeEvent(full.position_id, 'opposite_flip_close', {
      new_side: input.newSide,
      timeframe: input.timeframe,
      llm_confidence: newConf,
      flip_reason: decision?.reason,
    });
  }

  return { flipped: true, reason: `Closed opposite ${heldSide} for ${input.newSide} flip` };
}
