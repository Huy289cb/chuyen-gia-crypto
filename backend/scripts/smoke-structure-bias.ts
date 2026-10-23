/**
 * Smoke: live structure bias + side-align fail-closed (no LLM / no orders).
 * Usage: npx tsx scripts/smoke-structure-bias.ts
 */
import 'dotenv/config';
import { getCandles } from '../src/services/candle.service';
import { computeRegimeEvidence } from '../src/analyzers/market-regime.analyzer';
import { getSignalGateWindows } from '../src/config/signal-gate-windows';
import { evaluateHtfSideAlign, getV3HtfSideAlignTf } from '../src/config/v3-entry-policy';
import {
  evaluateStructureSidePermission,
  getV3StructureBiasCandleLimit,
  getV3StructureBiasTf,
  isV3StructureBiasEnabled,
} from '../src/config/v3-structure-bias-policy';
import { isBreakoutRegimeBypassEnabled } from '../src/config/v3-regime-policy';

async function main() {
  const symbol = (process.env.SMOKE_SYMBOL || 'BTC').toUpperCase();
  const structTf = getV3StructureBiasTf();
  const alignTf = getV3HtfSideAlignTf();

  console.log('=== smoke-structure-bias ===');
  console.log({
    symbol,
    structureEnabled: isV3StructureBiasEnabled(),
    structTf,
    alignTf,
    breakoutBypass: isBreakoutRegimeBypassEnabled(),
  });

  const { candles: structCandles, source: structSrc } = await getCandles({
    symbol,
    timeframe: structTf,
    limit: getV3StructureBiasCandleLimit(),
  });
  console.log(`structure candles: ${structCandles.length} (${structSrc})`);

  const longStruct = evaluateStructureSidePermission({ side: 'long', candles: structCandles });
  const shortStruct = evaluateStructureSidePermission({ side: 'short', candles: structCandles });
  console.log(`structure long:`, { pass: longStruct.pass, bias: longStruct.bias, reason: longStruct.reason });
  console.log(`structure short:`, { pass: shortStruct.pass, bias: shortStruct.bias, reason: shortStruct.reason });

  const { candles: alignCandles } = await getCandles({
    symbol,
    timeframe: alignTf,
    limit: 80,
  });
  const w = getSignalGateWindows(alignTf);
  const ev = computeRegimeEvidence(alignCandles, { regimeBars: w.regimeBars, timeframe: alignTf });
  console.log(`HTF ${alignTf}:`, { regime: ev.regime, trendDirection: ev.trendDirection });

  for (const side of ['long', 'short'] as const) {
    const struct = side === 'long' ? longStruct : shortStruct;
    const a = evaluateHtfSideAlign({
      side,
      htfTf: alignTf,
      htf: { regime: ev.regime, trendDirection: ev.trendDirection },
      structureBias: struct.bias,
    });
    console.log(`side_align ${side}:`, { pass: a.pass, reason: a.reason });
  }

  console.log('smoke OK');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
